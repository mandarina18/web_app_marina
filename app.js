// Global variables
let reviews = [];
let apiToken = '';

// DOM elements
const analyzeBtn = document.getElementById('analyze-btn');
const reviewText = document.getElementById('review-text');
const sentimentResult = document.getElementById('sentiment-result');
const loadingElement = document.querySelector('.loading');
const errorElement = document.getElementById('error-message');
const apiTokenInput = document.getElementById('api-token');

// Initialize the app
document.addEventListener('DOMContentLoaded', function() {
    // Load the TSV file (Papa Parse 활성화)
    loadReviews();
    
    // Set up event listeners
    analyzeBtn.addEventListener('click', analyzeRandomReview);
    apiTokenInput.addEventListener('input', saveApiToken);
    
    // Load saved API token if exists
    const savedToken = localStorage.getItem('hfApiToken');
    if (savedToken) {
        apiTokenInput.value = savedToken;
        apiToken = savedToken;
    }
});

// Load and parse the TSV file using Papa Parse
function loadReviews() {
    fetch('reviews_test.tsv')
        .then(response => {
            if (!response.ok) throw new Error('Failed to load TSV file');
            return response.text();
        })
        .then(tsvData => {
            Papa.parse(tsvData, {
                header: true,
                delimiter: '\t',
                complete: (results) => {
                    reviews = results.data
                        .map(row => row.text)
                        .filter(text => text && text.trim() !== '');
                    console.log('Loaded', reviews.length, 'reviews');
                },
                error: (error) => {
                    console.error('TSV parse error:', error);
                    showError('Failed to parse TSV file: ' + error.message);
                }
            });
        })
        .catch(error => {
            console.error('TSV load error:', error);
            showError('Failed to load TSV file: ' + error.message);
        });
}

// Save API token to localStorage
function saveApiToken() {
    apiToken = apiTokenInput.value.trim();
    if (apiToken) {
        localStorage.setItem('hfApiToken', apiToken);
    } else {
        localStorage.removeItem('hfApiToken');
    }
}


// Analyze a random review
function analyzeRandomReview() {
    hideError();
    saveApiToken(); // ensure latest token is used even if input didn't lose focus

    if (reviews.length === 0) {
        showError('No reviews available. Please try again later.');
        return;
    }

    const selectedReview = reviews[Math.floor(Math.random() * reviews.length)];

    // Display the review
    reviewText.textContent = selectedReview;

    // Show loading state
    loadingElement.style.display = 'block';
    analyzeBtn.disabled = true;
    sentimentResult.innerHTML = '';
    sentimentResult.className = 'sentiment-result';

    analyzeSentiment(selectedReview)
        .then(result => displaySentiment(result))
        .catch(err => {
            console.error(err);
            showError('Failed to analyze sentiment: ' + (err?.message || err));
        })
        .finally(() => {
            loadingElement.style.display = 'none';
            analyzeBtn.disabled = false;
        });
}


// Call Hugging Face API for sentiment analysis
async function analyzeSentiment(text, attempt = 1) {
    const url = 'https://api-inference.huggingface.co/models/siebert/sentiment-roberta-large-english';

    // Always read the latest value (extra safety)
    const token = (apiTokenInput?.value || apiToken || '').trim();

    const headers = { 'Content-Type': 'application/json' };
    if (token) headers.Authorization = `Bearer ${token}`;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000);

    try {
        const response = await fetch(url, {
            method: 'POST',
            headers,
            signal: controller.signal,
            body: JSON.stringify({
                inputs: text,
                options: { wait_for_model: false }
            }),
        });

        if (response.status === 503) {
            if (attempt >= 3) {
                const raw = await response.text().catch(() => '');
                throw new Error(`Model still loading / API busy after ${attempt} attempts. ${raw}`);
            }

            const data = await response.json().catch(() => ({}));
            const eta = data.estimated_time ? Math.ceil(data.estimated_time) : 20;

            showError(`Model is loading / API busy. Retrying in ~${eta}s (attempt ${attempt + 1}/3)...`);
            await new Promise(r => setTimeout(r, (eta + 1) * 1000));

            return analyzeSentiment(text, attempt + 1);
        }

        if (!response.ok) {
            const errText = await response.text().catch(() => '');
            throw new Error(`API error: ${response.status} ${response.statusText}${errText ? ' - ' + errText : ''}`);
        }

        return await response.json();
    } catch (e) {
        if (e.name === 'AbortError') {
            throw new Error('Request timed out after 30s (API slow/busy). Try again.');
        }
        throw e;
    } finally {
        clearTimeout(timeoutId);
    }
}


// Display sentiment result
function displaySentiment(result) {
    // Default to neutral if we can't parse the result
    let sentiment = 'neutral';
    let score = 0.5;
    let label = 'NEUTRAL';
    
    // Parse the API response (format: [[{label: 'POSITIVE', score: 0.99}]])
    if (Array.isArray(result) && result.length > 0 && Array.isArray(result[0]) && result[0].length > 0) {
        const sentimentData = result[0][0];
        label = sentimentData.label?.toUpperCase() || 'NEUTRAL';
        score = sentimentData.score ?? 0.5;
        
        // Determine sentiment
        if (label === 'POSITIVE' && score > 0.5) {
            sentiment = 'positive';
        } else if (label === 'NEGATIVE' && score > 0.5) {
            sentiment = 'negative';
        }
    }
    
    // Update UI
    sentimentResult.classList.add(sentiment);
    sentimentResult.innerHTML = `
        <i class="fas ${getSentimentIcon(sentiment)} icon"></i>
        <span>${label} (${(score * 100).toFixed(1)}% confidence)</span>
    `;
}

// Get appropriate icon for sentiment
function getSentimentIcon(sentiment) {
    switch(sentiment) {
        case 'positive':
            return 'fa-thumbs-up';
        case 'negative':
            return 'fa-thumbs-down';
        default:
            return 'fa-question-circle';
    }
}

// Show error message
function showError(message) {
    errorElement.textContent = message;
    errorElement.style.display = 'block';
}

// Hide error message
function hideError() {
    errorElement.style.display = 'none';
}
