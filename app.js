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

// Main ana
