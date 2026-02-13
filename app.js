// app.js (Decision Maker: Local Inference + GAS Logging + UI Actions)
import { pipeline } from "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.7.6/dist/transformers.min.js";

// ====== CONFIG (REPLACED) ======
const GAS_URL =
  "https://script.google.com/macros/s/AKfycbzaL6QGFxfhBXx2v7SlJOIge_uMsVvU1M3FHD36jMx0RWxHJuW0tFh303JzAk1FV4ST/exec";

// Hugging Face token (UI compatibility only; local inference does NOT need it)
const HF_TOKEN_UI_ONLY = "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";

// ====== GLOBALS ======
let reviews = [];
let sentimentPipeline = null;

// ====== DOM ======
const analyzeBtn = document.getElementById("analyze-btn");
const reviewText = document.getElementById("review-text");
const sentimentResult = document.getElementById("sentiment-result");
const decisionBox = document.getElementById("decision-box");     // (add in HTML below)
const decisionTitle = document.getElementById("decision-title"); // (add in HTML below)
const decisionText = document.getElementById("decision-text");   // (add in HTML below)
const loadingElement = document.querySelector(".loading");
const errorElement = document.getElementById("error-message");
const apiTokenInput = document.getElementById("api-token");
const statusElement = document.getElementById("status");

// ====== INIT ======
document.addEventListener("DOMContentLoaded", function () {
  loadReviews();

  // Create pseudo user id once
  if (!localStorage.getItem("pseudoId")) {
    localStorage.setItem("pseudoId", "user_" + Math.random().toString(36).slice(2, 11));
  }

  // UI compatibility: prefill token field (NOT used for local inference)
  if (apiTokenInput && !apiTokenInput.value) {
    apiTokenInput.value = HF_TOKEN_UI_ONLY;
  }

  analyzeBtn.addEventListener("click", analyzeRandomReview);
  initSentimentModel();
});

// ====== MODEL ======
async function initSentimentModel() {
  try {
    if (statusElement) statusElement.textContent = "Loading sentiment model...";
    sentimentPipeline = await pipeline(
      "text-classification",
      "Xenova/distilbert-base-uncased-finetuned-sst-2-english"
    );
    if (statusElement) statusElement.textContent = "Sentiment model ready ✅";
  } catch (error) {
    console.error("Failed to load model:", error);
    showError("Failed to load AI model.");
  }
}

// ====== REVIEWS ======
function loadReviews() {
  fetch("reviews_test.tsv")
    .then((response) => response.text())
    .then((tsvData) => {
      Papa.parse(tsvData, {
        header: true,
        delimiter: "\t",
        skipEmptyLines: true,
        complete: (results) => {
          reviews = results.data
            .map((row) => row.text)
            .filter((text) => text && String(text).trim() !== "");
          console.log("Loaded", reviews.length, "reviews");
        },
      });
    })
    .catch(() => showError("TSV file not found."));
}

// ====== DECISION LOGIC ======
function determineBusinessAction(confidence, labelRaw) {
  const label = String(labelRaw || "").toUpperCase();

  // Normalize to 0..1 (0 = worst, 1 = best)
  let normalizedScore = 0.5;
  if (label === "POSITIVE") normalizedScore = confidence;
  else if (label === "NEGATIVE") normalizedScore = 1.0 - confidence;

  if (normalizedScore <= 0.4) {
    return {
      actionCode: "OFFER_COUPON",
      uiTitle: "We’re sorry — here’s 50% off",
      uiMessage: "We are truly sorry. Please accept this 50% discount coupon.",
      uiType: "negative",
    };
  } else if (normalizedScore < 0.7) {
    return {
      actionCode: "REQUEST_FEEDBACK",
      uiTitle: "Help us improve",
      uiMessage: "Thank you! Could you tell us how we can improve?",
      uiType: "neutral",
    };
  } else {
    return {
      actionCode: "ASK_REFERRAL",
      uiTitle: "Glad you liked it!",
      uiMessage: "Refer a friend and earn rewards.",
      uiType: "positive",
    };
  }
}


// ====== MAIN ======
async function analyzeRandomReview() {
  hideError();
  if (reviews.length === 0 || !sentimentPipeline) return;

  const selectedReview = reviews[Math.floor(Math.random() * reviews.length)];
  reviewText.textContent = selectedReview;

  loadingElement.style.display = "block";
  analyzeBtn.disabled = true;
  sentimentResult.innerHTML = "";
  if (decisionBox) decisionBox.style.display = "none";

  try {
    const output = await sentimentPipeline(selectedReview);
    const result = output[0]; // { label: "POSITIVE"|"NEGATIVE", score: 0..1 }

    // 1) Show sentiment
    displaySentiment(result);

    // 2) Decide action
    const decision = determineBusinessAction(result.score, result.label);

    // Show system decision in UI (with the right button/link)
    displayDecision(decision);

    // Log action_taken as required
    await sendLogToGAS(selectedReview, result.label, result.score, decision.actionCode);

  } catch (error) {
    console.error(error);
    showError("Analysis failed.");
  } finally {
    loadingElement.style.display = "none";
    analyzeBtn.disabled = false;
  }
}

// ====== LOGGING (Required columns + action_taken) ======
async function sendLogToGAS(text, label, score, actionTaken) {
  const payload = {
    // REQUIRED: ISO timestamp
    ts_iso: new Date().toISOString(),
    // REQUIRED: review text
    review: text,
    // REQUIRED: label + confidence
    sentiment: `${String(label).toUpperCase()} (${(score * 100).toFixed(1)}%)`,
    // REQUIRED: meta (client info)
    meta: JSON.stringify({
      userId: localStorage.getItem("pseudoId"),
      ua: navigator.userAgent,
      lang: navigator.language,
      tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
      platform: navigator.platform,
      screen: { w: screen.width, h: screen.height },
      page: location.href,
      ref: document.referrer || null,
    }),
    // REQUIRED: action_taken
    action_taken: actionTaken,
  };

  try {
    // mode:'no-cors' avoids preflight issues for many GAS deployments
    await fetch(GAS_URL, {
      method: "POST",
      mode: "no-cors",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(payload).toString(),
    });
    console.log("Log sent to Google Sheets (no-cors).");
  } catch (e) {
    console.warn("Log failed (possibly CORS), but GAS may still receive it.", e);
  }
}

// ====== UI RENDER ======
function displaySentiment(data) {
  const label = String(data.label || "").toUpperCase();
  const score = Number(data.score || 0);

  let type = "neutral";
  if (label === "POSITIVE") type = "positive";
  if (label === "NEGATIVE") type = "negative";

  sentimentResult.className = `sentiment-result ${type}`;
  sentimentResult.innerHTML = `
    <i class="fas ${type === "positive" ? "fa-thumbs-up" : type === "negative" ? "fa-thumbs-down" : "fa-circle-info"} icon"></i>
    <span>${label} (${(score * 100).toFixed(1)}% confidence)</span>
  `;
}

function displayDecision(decision) {
  if (!decisionBox || !decisionTitle || !decisionText) return;

  decisionBox.className = `sentiment-result ${decision.uiType}`;
  decisionTitle.textContent = decision.uiTitle;
  decisionText.textContent = decision.uiMessage;

  // Remove any previous action control
  const existing = decisionBox.querySelector(".action-cta");
  if (existing) existing.remove();

  // Add the correct CTA per action
  const cta = document.createElement("a");
  cta.className = "action-cta";
  cta.style.marginTop = "8px";
  cta.style.display = "inline-block";
  cta.style.padding = "10px 12px";
  cta.style.borderRadius = "10px";
  cta.style.fontWeight = "800";
  cta.style.textDecoration = "none";
  cta.style.border = "1px solid rgba(0,0,0,0.15)";

  if (decision.actionCode === "OFFER_COUPON") {
    cta.href = "#";
    cta.textContent = "Get 50% Coupon";
    cta.onclick = (e) => {
      e.preventDefault();
      alert("COUPON CODE: SAVE50");
    };
  } else if (decision.actionCode === "REQUEST_FEEDBACK") {
    cta.href = "https://example.com/survey"; // replace with your real survey link
    cta.target = "_blank";
    cta.rel = "noopener noreferrer";
    cta.textContent = "Open Survey";
  } else if (decision.actionCode === "ASK_REFERRAL") {
    cta.href = "https://example.com/referral"; // replace with your referral page
    cta.target = "_blank";
    cta.rel = "noopener noreferrer";
    cta.textContent = "Refer a Friend";
  }

  decisionBox.appendChild(cta);
  decisionBox.style.display = "flex";
}

