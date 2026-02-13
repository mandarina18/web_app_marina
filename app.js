// app.js — AI Decision Maker + UI Update + GAS Logging (with action_taken)
// Based on your current file: :contentReference[oaicite:0]{index=0}

import { pipeline } from "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.7.6/dist/transformers.min.js";

// ====== CONFIG (REPLACED PER YOUR REQUEST) ======
const HF_TOKEN_DEFAULT = "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"; // UI compatibility only (local inference does not use it)
const GAS_URL =
  "https://script.google.com/macros/s/AKfycbzaL6QGFxfhBXx2v7SlJOIge_uMsVvU1M3FHD36jMx0RWxHJuW0tFh303JzAk1FV4ST/exec";

// Global variables
let reviews = [];
let sentimentPipeline = null;

// DOM elements
const analyzeBtn = document.getElementById("analyze-btn");
const reviewText = document.getElementById("review-text");
const sentimentResult = document.getElementById("sentiment-result");
const actionResult = document.getElementById("action-result"); // NEW UI block
const loadingElement = document.querySelector(".loading");
const errorElement = document.getElementById("error-message");
const apiTokenInput = document.getElementById("api-token");
const statusElement = document.getElementById("status");

// Initialize the app
document.addEventListener("DOMContentLoaded", function () {
  loadReviews();

  // Pseudo user id for logs
  if (!localStorage.getItem("pseudoId")) {
    localStorage.setItem("pseudoId", "user_" + Math.random().toString(36).slice(2, 11));
  }

  // UI compatibility: prefill token if empty (not used for local inference)
  if (apiTokenInput && !apiTokenInput.value) {
    apiTokenInput.value = HF_TOKEN_DEFAULT;
  }

  analyzeBtn.addEventListener("click", analyzeRandomReview);
  initSentimentModel();
});

// Load Transformers.js model
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

// Load reviews from TSV
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
            .filter((text) => text && text.trim() !== "");
          console.log("Loaded", reviews.length, "reviews");
        },
      });
    })
    .catch(() => showError("TSV file not found."));
}

/**
 * Determines business action based on sentiment results.
 * Normalizes into 0 (worst) → 1 (best).
 */
function determineBusinessAction(confidence, label) {
  const L = String(label || "").toUpperCase();
  const c = Number(confidence ?? 0);

  let normalizedScore = 0.5;
  if (L === "POSITIVE") normalizedScore = c;        // 0.9 => 0.9 (good)
  else if (L === "NEGATIVE") normalizedScore = 1 - c; // 0.9 => 0.1 (bad)

  if (normalizedScore <= 0.4) {
    return {
      actionCode: "OFFER_COUPON",
      uiTitle: "🚨 Churn risk detected",
      uiMessage: "We are truly sorry. Please accept this 50% discount coupon.",
      uiColor: "#ef4444",
      cta: { type: "button", label: "Get 50% Coupon", href: null },
    };
  } else if (normalizedScore < 0.7) {
    return {
      actionCode: "REQUEST_FEEDBACK",
      uiTitle: "📝 Need more details",
      uiMessage: "Thank you! Could you tell us how we can improve?",
      uiColor: "#6b7280",
      cta: { type: "link", label: "Open feedback survey", href: "https://example.com/survey" },
    };
  } else {
    return {
      actionCode: "ASK_REFERRAL",
      uiTitle: "⭐ Loyal customer detected",
      uiMessage: "Glad you liked it! Refer a friend and earn rewards.",
      uiColor: "#3b82f6",
      cta: { type: "button", label: "Refer a Friend", href: null },
    };
  }
}

// Main analysis
async function analyzeRandomReview() {
  hideError();

  if (!sentimentPipeline) {
    showError("Model is still loading. Please try again in a moment.");
    return;
  }
  if (reviews.length === 0) {
    showError("No reviews loaded.");
    return;
  }

  const selectedReview = reviews[Math.floor(Math.random() * reviews.length)];
  reviewText.textContent = selectedReview;

  loadingElement.style.display = "block";
  analyzeBtn.disabled = true;
  sentimentResult.innerHTML = "";
  if (actionResult) {
    actionResult.style.display = "none";
    actionResult.innerHTML = "";
  }

  try {
    const output = await sentimentPipeline(selectedReview);
    const result = output[0]; // {label: 'POSITIVE'|'NEGATIVE', score: 0..1}

    displaySentiment(result);

    // Decision maker layer (NEW)
    const decision = determineBusinessAction(result.score, result.label);
    displayDecision(decision);

    // Log with action_taken (NEW)
    await sendLogToGAS(selectedReview, result.label, result.score, decision.actionCode);
  } catch (error) {
    console.error(error);
    showError("Analysis failed.");
  } finally {
    loadingElement.style.display = "none";
    analyzeBtn.disabled = false;
  }
}

// Logging to Google Sheets (adds action_taken)
async function sendLogToGAS(reviewTextValue, label, score, actionTaken) {
  const payload = {
    ts_iso: new Date().toISOString(), // ISO timestamp (required)
    review: reviewTextValue,
    sentiment: `${String(label).toUpperCase()} (${(Number(score) * 100).toFixed(1)}%)`,
    meta: JSON.stringify(getClientMeta()),
    action_taken: actionTaken, // NEW required column
  };

  try {
    // mode:'no-cors' avoids preflight (you won't see response, but it reaches GAS if deployed correctly)
    await fetch(GAS_URL, {
      method: "POST",
      mode: "no-cors",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(payload).toString(),
    });
    console.log("Log sent to Google Sheets:", payload);
  } catch (e) {
    console.warn("Log failed (possibly CORS), payload was:", payload);
  }
}

function getClientMeta() {
  return {
    userId: localStorage.getItem("pseudoId"),
    page: location.href,
    referrer: document.referrer || null,
    ua: navigator.userAgent,
    language: navigator.language,
    platform: navigator.platform,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    tz_offset_min: new Date().getTimezoneOffset(),
    screen: {
      w: window.screen?.width,
      h: window.screen?.height,
    },
  };
}

// Sentiment UI
function displaySentiment(data) {
  const label = String(data.label).toUpperCase();
  const score = Number(data.score);
  const type = label === "POSITIVE" ? "positive" : "negative";

  sentimentResult.className = `sentiment-result ${type}`;
  sentimentResult.innerHTML = `
    <i class="fas ${type === "positive" ? "fa-thumbs-up" : "fa-thumbs-down"} icon"></i>
    <span>${label} (${(score * 100).toFixed(1)}% confidence)</span>
  `;
}

// Decision UI (NEW)
function displayDecision(decision) {
  if (!actionResult) return;

  actionResult.style.display = "block";
  actionResult.style.borderLeft = `4px solid ${decision.uiColor}`;
  actionResult.style.background = "rgba(148, 163, 184, 0.15)";
  actionResult.style.padding = "12px";
  actionResult.style.borderRadius = "8px";
  actionResult.style.marginTop = "12px";

  const ctaHtml =
    decision.cta?.type === "link"
      ? `<a href="${decision.cta.href}" target="_blank" rel="noopener noreferrer"
            style="display:inline-block;margin-top:10px;font-weight:700;text-decoration:underline;">
            ${escapeHtml(decision.cta.label)}
         </a>`
      : `<button id="action-cta"
            style="margin-top:10px;padding:10px 12px;border:0;border-radius:8px;cursor:pointer;font-weight:700;">
            ${escapeHtml(decision.cta?.label || "Continue")}
         </button>`;

  actionResult.innerHTML = `
    <div style="font-weight:800;margin-bottom:6px;color:${decision.uiColor}">
      ${escapeHtml(decision.uiTitle)}
    </div>
    <div style="line-height:1.35">${escapeHtml(decision.uiMessage)}</div>
    <div style="margin-top:6px;font-size:12px;opacity:0.85">
      action_taken: <b>${escapeHtml(decision.actionCode)}</b>
    </div>
    ${ctaHtml}
  `;

  // Button behavior (optional, UI only)
  const btn = document.getElementById("action-cta");
  if (btn) {
    btn.style.background = decision.uiColor;
    btn.style.color = "white";
    btn.onclick = () => {
      alert(`Action: ${decision.actionCode}`);
    };
  }
}

function escapeHtml(str) {
  return String(str ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function showError(m) {
  if (!errorElement) return;
  errorElement.textContent = m;
  errorElement.style.display = "block";
}
function hideError() {
  if (!errorElement) return;
  errorElement.style.display = "none";
}
