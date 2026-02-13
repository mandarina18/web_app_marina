// app.js (ES module version using transformers.js for local sentiment classification)
import { pipeline } from "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.7.6/dist/transformers.min.js";

// ------------------------------
// Config
// ------------------------------
// You MUST set this to your Apps Script Web App URL (Deploy -> Web app -> /exec).
// Alternatively, paste it in the UI field "Google Sheets Web App URL".
let googleSheetsEndpoint =
  "https://script.google.com/macros/s/AKfycbzaL6QGFxfhBXx2v7SlJOIge_uMsVvU1M3FHD36jMx0RWxHJuW0tFh303JzAk1FV4ST/exec";


// Optional: destinations for UI buttons
const SURVEY_URL = "https://example.com/survey";
const REFERRAL_URL = "https://example.com/referral";
const COUPON_CODE = "SAVE50";

// ------------------------------
// State
// ------------------------------
let reviews = [];
let apiToken = ""; // kept for UI compatibility; not used with local inference
let sentimentPipeline = null;

// ------------------------------
// DOM elements
// ------------------------------
const analyzeBtn = document.getElementById("analyze-btn");
const reviewText = document.getElementById("review-text");
const sentimentResult = document.getElementById("sentiment-result");
const loadingElement = document.querySelector(".loading");
const errorElement = document.getElementById("error-message");
const apiTokenInput = document.getElementById("api-token");
const statusElement = document.getElementById("status");

const gsEndpointInput = document.getElementById("gs-endpoint");

const actionCard = document.getElementById("action-result");
const actionMessageEl = document.getElementById("action-message");
const actionButtonsEl = document.getElementById("action-buttons");

// ------------------------------
// Init
// ------------------------------
document.addEventListener("DOMContentLoaded", () => {
  loadReviews();

  analyzeBtn.addEventListener("click", analyzeRandomReview);
  apiTokenInput.addEventListener("change", saveApiToken);
  gsEndpointInput.addEventListener("change", saveGoogleSheetsEndpoint);

  const savedToken = localStorage.getItem("hfApiToken");
  if (savedToken) {
    apiTokenInput.value = savedToken;
    apiToken = savedToken;
  }

  const savedGs = localStorage.getItem("googleSheetsEndpoint");
if (savedGs) {
  gsEndpointInput.value = savedGs;
  googleSheetsEndpoint = savedGs;
} else {
  // reflect the default in the UI
  gsEndpointInput.value = googleSheetsEndpoint;
}

  initSentimentModel();
});

// ------------------------------
// Model init
// ------------------------------
async function initSentimentModel() {
  try {
    setStatus("Loading sentiment model...");

    sentimentPipeline = await pipeline(
      "text-classification",
      "Xenova/distilbert-base-uncased-finetuned-sst-2-english"
    );

    setStatus("Sentiment model ready");
  } catch (error) {
    console.error("Failed to load sentiment model:", error);
    showError("Failed to load sentiment model. Please refresh and try again.");
    setStatus("Model load failed");
  }
}

function setStatus(text) {
  if (statusElement) statusElement.textContent = text;
}

// ------------------------------
// Reviews TSV
// ------------------------------
function loadReviews() {
  fetch("reviews_test.tsv")
    .then((response) => {
      if (!response.ok) throw new Error("Failed to load TSV file");
      return response.text();
    })
    .then((tsvData) => {
      Papa.parse(tsvData, {
        header: true,
        delimiter: "\t",
        complete: (results) => {
          reviews = (results.data || [])
            .map((row) => row?.text)
            .filter((text) => typeof text === "string" && text.trim() !== "");

          console.log("Loaded", reviews.length, "reviews");
        },
        error: (error) => {
          console.error("TSV parse error:", error);
          showError("Failed to parse TSV file: " + error.message);
        },
      });
    })
    .catch((error) => {
      console.error("TSV load error:", error);
      showError("Failed to load TSV file: " + error.message);
    });
}

// ------------------------------
// Persist settings (UI compatibility)
// ------------------------------
function saveApiToken() {
  apiToken = apiTokenInput.value.trim();
  if (apiToken) localStorage.setItem("hfApiToken", apiToken);
  else localStorage.removeItem("hfApiToken");
}

function saveGoogleSheetsEndpoint() {
  googleSheetsEndpoint = (gsEndpointInput.value || "").trim();
  if (googleSheetsEndpoint) localStorage.setItem("googleSheetsEndpoint", googleSheetsEndpoint);
  else localStorage.removeItem("googleSheetsEndpoint");
}

// ------------------------------
// Main flow
// ------------------------------
function analyzeRandomReview() {
  hideError();
  hideActionCard();

  if (!Array.isArray(reviews) || reviews.length === 0) {
    showError("No reviews available. Please try again later.");
    return;
  }

  if (!sentimentPipeline) {
    showError("Sentiment model is not ready yet. Please wait a moment.");
    return;
  }

  const selectedReview = reviews[Math.floor(Math.random() * reviews.length)];
  reviewText.textContent = selectedReview;

  loadingElement.style.display = "block";
  analyzeBtn.disabled = true;

  sentimentResult.innerHTML = "";
  sentimentResult.className = "sentiment-result";

  analyzeSentiment(selectedReview)
    .then(({ label, score }) => {
      // 1) Sentiment UI
      const sentimentBucket = bucketizeSentiment(label, score);
      renderSentiment(label, score, sentimentBucket);

      // 2) Business logic + UI
      const decision = determineBusinessAction(score, label);
      renderDecision(decision);

      // 3) Logging
      const tsIso = new Date().toISOString();
      const meta = collectClientMeta();

      const sentimentText = `${label} (${(score * 100).toFixed(1)}%)`;
      return logToGoogleSheet({
        ts_iso: tsIso,
        review: selectedReview,
        sentiment: sentimentText,
        meta: JSON.stringify(meta),
        action_taken: decision.actionCode,
      });
    })
    .catch((error) => {
      console.error("Error:", error);
      showError(error?.message || "Failed to analyze sentiment.");
    })
    .finally(() => {
      loadingElement.style.display = "none";
      analyzeBtn.disabled = false;
    });
}

// transformers.js inference
async function analyzeSentiment(text) {
  if (!sentimentPipeline) throw new Error("Sentiment model is not initialized.");

  const output = await sentimentPipeline(text);
  if (!Array.isArray(output) || output.length === 0) {
    throw new Error("Invalid sentiment output from local model.");
  }

  const top = output[0];
  const label = typeof top?.label === "string" ? top.label.toUpperCase() : "NEUTRAL";
  const score = typeof top?.score === "number" ? top.score : 0.5;

  return { label, score };
}

// ------------------------------
// Sentiment UI helpers
// ------------------------------
function bucketizeSentiment(label, score) {
  if (label === "POSITIVE" && score > 0.5) return "positive";
  if (label === "NEGATIVE" && score > 0.5) return "negative";
  return "neutral";
}

function renderSentiment(label, score, bucket) {
  sentimentResult.classList.add(bucket);
  sentimentResult.innerHTML = `
    <i class="fas ${getSentimentIcon(bucket)} icon"></i>
    <span>${label} (${(score * 100).toFixed(1)}% confidence)</span>
  `;
}

function getSentimentIcon(bucket) {
  switch (bucket) {
    case "positive":
      return "fa-thumbs-up";
    case "negative":
      return "fa-thumbs-down";
    default:
      return "fa-question-circle";
  }
}

// ------------------------------
// Business logic (from Readme(2))
// ------------------------------
function determineBusinessAction(confidence, label) {
  // Normalize to 0 (worst) .. 1 (best)
  let normalizedScore = 0.5;
  if (label === "POSITIVE") normalizedScore = confidence;
  else if (label === "NEGATIVE") normalizedScore = 1.0 - confidence;

  if (normalizedScore <= 0.4) {
    return {
      normalizedScore,
      actionCode: "OFFER_COUPON",
      uiMessage: `We are truly sorry. Please accept this 50% discount coupon: ${COUPON_CODE}`,
      uiColor: "#ef4444",
    };
  } else if (normalizedScore < 0.7) {
    return {
      normalizedScore,
      actionCode: "REQUEST_FEEDBACK",
      uiMessage: "Thank you! Could you tell us how we can improve? Please fill out a quick survey.",
      uiColor: "#6b7280",
    };
  } else {
    return {
      normalizedScore,
      actionCode: "ASK_REFERRAL",
      uiMessage: "Glad you liked it! Refer a friend and earn rewards.",
      uiColor: "#3b82f6",
    };
  }
}

// ------------------------------
// Decision UI
// ------------------------------
function renderDecision(decision) {
  actionCard.style.display = "block";
  actionCard.style.borderLeftColor = decision.uiColor;

  actionMessageEl.textContent = `${decision.uiMessage} (Action: ${decision.actionCode})`;

  // Clear and rebuild buttons per action
  actionButtonsEl.innerHTML = "";

  if (decision.actionCode === "OFFER_COUPON") {
    const copyBtn = document.createElement("button");
    copyBtn.className = "secondary";
    copyBtn.innerHTML = `<i class="fas fa-ticket"></i> Copy Coupon Code`;
    copyBtn.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(COUPON_CODE);
        copyBtn.textContent = "Copied!";
        setTimeout(() => {
          copyBtn.innerHTML = `<i class="fas fa-ticket"></i> Copy Coupon Code`;
        }, 1200);
      } catch {
        showError("Could not copy coupon code. Please copy it manually: " + COUPON_CODE);
      }
    });
    actionButtonsEl.appendChild(copyBtn);
  }

  if (decision.actionCode === "REQUEST_FEEDBACK") {
    const surveyLink = document.createElement("a");
    surveyLink.href = SURVEY_URL;
    surveyLink.target = "_blank";
    surveyLink.rel = "noreferrer";
    surveyLink.innerHTML = `<i class="fas fa-list-check"></i> Open Survey`;
    actionButtonsEl.appendChild(surveyLink);
  }

  if (decision.actionCode === "ASK_REFERRAL") {
    const referralLink = document.createElement("a");
    referralLink.href = REFERRAL_URL;
    referralLink.target = "_blank";
    referralLink.rel = "noreferrer";
    referralLink.innerHTML = `<i class="fas fa-user-plus"></i> Refer a Friend`;
    actionButtonsEl.appendChild(referralLink);
  }
}

function hideActionCard() {
  actionCard.style.display = "none";
  actionButtonsEl.innerHTML = "";
  actionMessageEl.textContent = "";
}

// ------------------------------
// Logging
// ------------------------------
// Sends exactly the required columns:
// ts_iso, review, sentiment, meta, action_taken
async function logToGoogleSheet(row) {
  const endpoint = (googleSheetsEndpoint || "").trim();
  if (!endpoint) {
    console.warn("Google Sheets endpoint is not set. Skipping logging.", row);
    return;
  }

  try {
    // Use JSON; Apps Script doPost should parse JSON body.
    const res = await fetch(endpoint, {
      method: "POST",
      mode: "cors",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(row),
      keepalive: true,
    });

    // Apps Script often returns 200 even on errors in content; still try to read response.
    const text = await res.text().catch(() => "");
    if (!res.ok) {
      console.error("Logging failed:", res.status, text);
      // Do not block UX; just surface as console warning.
    } else {
      console.log("Logged to Google Sheet:", text || "(ok)");
    }
  } catch (e) {
    console.error("Logging request error:", e);
    // Do not block UX; just console.
  }
}

// "Meta" = all client info (browser-side)
function collectClientMeta() {
  const nav = navigator || {};
  const scr = window.screen || {};
  return {
    href: window.location.href,
    referrer: document.referrer || "",
    userAgent: nav.userAgent || "",
    language: nav.language || "",
    languages: Array.isArray(nav.languages) ? nav.languages : [],
    platform: nav.platform || "",
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || "",
    timezoneOffsetMinutes: new Date().getTimezoneOffset(),
    screen: {
      width: scr.width,
      height: scr.height,
      availWidth: scr.availWidth,
      availHeight: scr.availHeight,
      devicePixelRatio: window.devicePixelRatio || 1,
    },
  };
}

// ------------------------------
// Errors
// ------------------------------
function showError(message) {
  errorElement.textContent = message;
  errorElement.style.display = "block";
}

function hideError() {
  errorElement.style.display = "none";
  errorElement.textContent = "";
}
