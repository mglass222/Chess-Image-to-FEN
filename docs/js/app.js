/**
 * Main application: drag-and-drop orchestration, UI management.
 */

import { loadModel, classifyBoard, isModelLoaded } from './classifier.js';
import { buildFEN, detectOrientation } from './fenBuilder.js';
import { detectAndSegment, getBoardRect } from './boardDetector.js';
import { renderBoard, preloadPieces } from './boardRenderer.js';

// DOM elements
const statusEl = document.getElementById('status');
const dropZone = document.getElementById('drop-zone');
const fileInput = document.getElementById('file-input');
const resultsEl = document.getElementById('results');
const originalCanvas = document.getElementById('original-canvas');
const previewCanvas = document.getElementById('preview-canvas');
const fenText = document.getElementById('fen-text');
const copyBtn = document.getElementById('copy-btn');
const flipBtn = document.getElementById('flip-btn');
const lichessLink = document.getElementById('lichess-link');
const pasteBtn = document.getElementById('paste-btn');

// State
let currentPredictions = null;
let isFlipped = false;

// --- Status management ---

function setStatus(message, type = '') {
    statusEl.textContent = message;
    statusEl.className = 'status' + (type ? ` ${type}` : '');
}

// --- Initialization ---

async function init() {
    setStatus('Loading AI model...', '');

    try {
        await Promise.all([loadModel(), preloadPieces()]);
        setStatus('Ready! Drop a chess board screenshot.', 'ready');
    } catch (err) {
        setStatus(`Failed to load model: ${err.message}`, 'error');
        console.error('Model loading error:', err);
    }
}

// --- Drag and drop ---

dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropZone.classList.add('drag-over');
});

dropZone.addEventListener('dragleave', () => {
    dropZone.classList.remove('drag-over');
});

dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.remove('drag-over');

    const file = e.dataTransfer.files[0];
    if (file && file.type.startsWith('image/')) {
        processFile(file);
    } else {
        setStatus('Please drop an image file.', 'error');
    }
});

dropZone.addEventListener('click', (e) => {
    if (e.target === pasteBtn || pasteBtn.contains(e.target)) return;
    fileInput.click();
});

fileInput.addEventListener('change', () => {
    const file = fileInput.files[0];
    if (file) {
        processFile(file);
    }
});

// --- Clipboard paste ---

window.addEventListener('paste', (e) => {
    const items = e.clipboardData?.items;
    if (!items) return;

    for (const item of items) {
        if (item.type.startsWith('image/')) {
            e.preventDefault();
            const file = item.getAsFile();
            if (file) processFile(file);
            return;
        }
    }
});

async function pasteFromClipboard() {
    try {
        const clipboardItems = await navigator.clipboard.read();
        for (const item of clipboardItems) {
            const imageType = item.types.find(t => t.startsWith('image/'));
            if (imageType) {
                const blob = await item.getType(imageType);
                processFile(blob);
                return;
            }
        }
        setStatus('No image found in clipboard.', 'error');
    } catch (err) {
        setStatus('Clipboard access denied. Try Ctrl+V instead.', 'error');
    }
}

pasteBtn.addEventListener('click', pasteFromClipboard);

// --- Image processing pipeline ---

async function processFile(file) {
    if (!isModelLoaded()) {
        setStatus('Model is still loading, please wait...', 'error');
        return;
    }

    setStatus('Processing image...', 'processing');

    try {
        const img = await loadImage(file);
        await processImage(img);
    } catch (err) {
        setStatus(`Error: ${err.message}`, 'error');
        console.error('Processing error:', err);
    }
}

function loadImage(file) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error('Failed to load image'));
        img.src = URL.createObjectURL(file);
    });
}

async function processImage(img) {
    // Draw original image with board overlay
    setStatus('Detecting board...', 'processing');
    const boardRect = getBoardRect(img);
    drawOriginal(img, boardRect);

    // Segment into tiles
    setStatus('Segmenting squares...', 'processing');
    const tiles = detectAndSegment(img);

    // Classify
    setStatus('Classifying pieces...', 'processing');
    currentPredictions = await classifyBoard(tiles);

    // Detect orientation
    isFlipped = detectOrientation(currentPredictions);

    // Build FEN and display
    updateFEN();

    setStatus('Done!', 'ready');
    resultsEl.classList.remove('hidden');
}

function drawOriginal(img, rect) {
    // Scale to fit the panel (max 400px wide)
    const maxW = 400;
    const scale = Math.min(maxW / img.width, maxW / img.height, 1);
    const w = Math.round(img.width * scale);
    const h = Math.round(img.height * scale);

    originalCanvas.width = w;
    originalCanvas.height = h;
    const ctx = originalCanvas.getContext('2d');
    ctx.drawImage(img, 0, 0, w, h);

    // Draw board detection overlay
    ctx.strokeStyle = '#6c63ff';
    ctx.lineWidth = 2;
    ctx.strokeRect(
        rect.x * scale,
        rect.y * scale,
        rect.width * scale,
        rect.height * scale
    );

    // Draw grid lines
    ctx.strokeStyle = 'rgba(108, 99, 255, 0.3)';
    ctx.lineWidth = 1;
    for (let i = 1; i < 8; i++) {
        const xLine = (rect.x + (rect.width / 8) * i) * scale;
        const yLine = (rect.y + (rect.height / 8) * i) * scale;

        ctx.beginPath();
        ctx.moveTo(xLine, rect.y * scale);
        ctx.lineTo(xLine, (rect.y + rect.height) * scale);
        ctx.stroke();

        ctx.beginPath();
        ctx.moveTo(rect.x * scale, yLine);
        ctx.lineTo((rect.x + rect.width) * scale, yLine);
        ctx.stroke();
    }
}

function updateFEN() {
    if (!currentPredictions) return;

    const { fen, warnings } = buildFEN(currentPredictions, isFlipped);
    fenText.value = fen;

    // Update preview board
    renderBoard(previewCanvas, fen);

    // Update Lichess link
    const fenEncoded = encodeURIComponent(fen);
    lichessLink.href = `https://lichess.org/analysis/${fenEncoded}`;

    // Show warnings if any corrections were made
    if (warnings.length > 0) {
        setStatus(`Done! (fixed: ${warnings.join(', ')})`, 'ready');
    }
}

// --- Controls ---

copyBtn.addEventListener('click', async () => {
    try {
        await navigator.clipboard.writeText(fenText.value);
        copyBtn.textContent = 'Copied!';
        setTimeout(() => { copyBtn.textContent = 'Copy'; }, 2000);
    } catch {
        // Fallback
        fenText.select();
        document.execCommand('copy');
        copyBtn.textContent = 'Copied!';
        setTimeout(() => { copyBtn.textContent = 'Copy'; }, 2000);
    }
});

flipBtn.addEventListener('click', () => {
    isFlipped = !isFlipped;
    updateFEN();
});

// --- Start ---
init();
