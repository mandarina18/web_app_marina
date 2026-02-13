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
function decideBusinessAction(labelRaw, score) {
  const label = String(labelRaw || "").toUpperCase();

  // Simple mapping (extend if you add NEUTRAL later)
  if (label === "NEGATIVE") {
    // Optionally you can vary by confidence:
    // if (score >= 0.85) -> coupon; else -> "APOLOGIZE_ONLY"
    return "OFFER_COUPON";
  }

  if (label === "POSITIVE") {
    return "UPSELL";
  }

  return "NO_ACTION";
}

function buildUserMessage(actionTaken, label, score) {
  const confPct = (score * 100).toFixed(1);

  if (actionTaken === "OFFER_COUPON") {
    return {
      title: "We’re sorry — we’ll make it right",
      text: `The review looks ${label} (${confPct}% confidence). Apology + coupon offer triggered.`,
      cssClass: "negative",
    };
  }

  if (actionTaken === "UPSELL") {
    return {
      title: "Thanks — here’s something you may like",
      text: `The review looks ${label} (${confPct}% confidence). Upsell message triggered.`,
      cssClass: "positive",
    };
  }

  return {
    title: "Thanks for the feedback",
    text: `The review looks ${label} (${confPct}% confidence). No automated action triggered.`,
    cssClass: "neutral",
  };
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
    const actionTaken = decideBusinessAction(result.label, result.score);

    // 3) Update UI with dynamic business message
    const msg = buildUserMessage(actionTaken, result.label.toUpperCase(), result.score);
    displayDecision(msg);

    // 4) Log to Google Sheets (with action_taken)
    await sendLogToGAS(selectedReview, result.label, result.score, actionTaken);
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

function displayDecision(msg) {
  if (!decisionBox || !decisionTitle || !decisionText) return;

  decisionBox.className = `sentiment-result ${msg.cssClass}`;
  decisionTitle.textContent = msg.title;
  decisionText.textContent = msg.text;
  decisionBox.style.display = "flex";
}

function showError(m) {
  errorElement.textContent = m;
  errorElement.style.display = "block";
}
function hideError() {
  errorElement.style.display = "none";
}
