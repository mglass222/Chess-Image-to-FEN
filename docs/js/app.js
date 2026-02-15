/**
 * Main application: drag-and-drop orchestration, UI management.
 */

import { loadModel, classifyBoard, isModelLoaded } from './classifier.js';
import { buildFEN, detectOrientation } from './fenBuilder.js';
import { getBoardRect, extractTilesFromGrid } from './boardDetector.js';
import { renderBoard, preloadPieces } from './boardRenderer.js';
import { enableGridEditor, disableGridEditor, getGridLines } from './gridEditor.js';

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
const gridControls = document.getElementById('grid-controls');
const confirmGridBtn = document.getElementById('confirm-grid-btn');
const rotateCcwBtn = document.getElementById('rotate-ccw-btn');
const rotateCwBtn = document.getElementById('rotate-cw-btn');
const rotate90Btn = document.getElementById('rotate-90-btn');
const rotateAngleInput = document.getElementById('rotate-angle');
const piecePalette = document.getElementById('piece-palette');
const paletteBtns = document.querySelectorAll('.palette-btn');

// State
let currentPredictions = null;
let isFlipped = false;
let sourceImg = null;   // original uploaded image (never modified)
let currentImg = null;  // rotated version used by grid editor
let currentScale = 1;
let rotationDeg = 0;
let boardArray = null;  // 8x8 array of FEN chars (or '' for empty), set after confirm

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
        sourceImg = await loadImage(file);
        rotationDeg = 0;
        rotateAngleInput.value = '0';
        await applyRotationAndDetect();
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
    // Phase 1: detect board and show interactive grid
    setStatus('Detecting board...', 'processing');
    const boardRect = getBoardRect(img);

    // Scale to fit the panel
    const maxW = 700;
    const scale = Math.min(maxW / img.width, maxW / img.height, 1);
    const w = Math.round(img.width * scale);
    const h = Math.round(img.height * scale);

    originalCanvas.width = w;
    originalCanvas.height = h;

    // Store state for phase 2
    currentImg = img;
    currentScale = scale;

    // Enable interactive grid editor
    disableGridEditor(); // clean up any previous session
    enableGridEditor(originalCanvas, img, boardRect, scale, () => {});

    // Show grid controls, hide palette and FEN results until confirmed
    gridControls.classList.remove('hidden');
    piecePalette.classList.add('hidden');
    previewCanvas.classList.remove('editable');
    boardArray = null;
    resultsEl.classList.remove('hidden');
    setStatus('Adjust the grid if needed, then click Confirm.', 'ready');
}

async function confirmGrid() {
    // Grab grid lines before disabling the editor
    const { xLines, yLines } = getGridLines();

    setStatus('Segmenting squares...', 'processing');
    gridControls.classList.add('hidden');
    disableGridEditor();

    // Extract tiles using the (possibly adjusted) grid lines
    const tiles = extractTilesFromGrid(currentImg, xLines, yLines);

    // Classify
    setStatus('Classifying pieces...', 'processing');
    currentPredictions = await classifyBoard(tiles);

    // Detect orientation
    isFlipped = detectOrientation(currentPredictions);

    // Draw final overlay (non-interactive) using grid lines
    drawFinalOverlay(currentImg, xLines, yLines);

    // Build FEN and display
    updateFEN();

    // Enable board editing
    boardArray = fenToBoard(fenText.value);
    piecePalette.classList.remove('hidden');
    previewCanvas.classList.add('editable');

    setStatus('Done! Click squares on the board to edit pieces.', 'ready');
}

function drawFinalOverlay(img, xLines, yLines) {
    const scale = currentScale;
    const w = originalCanvas.width;
    const h = originalCanvas.height;

    const ctx = originalCanvas.getContext('2d');
    ctx.clearRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);

    // Draw outer border
    const left = xLines[0] * scale;
    const right = xLines[8] * scale;
    const top = yLines[0] * scale;
    const bottom = yLines[8] * scale;

    ctx.strokeStyle = '#6c63ff';
    ctx.lineWidth = 3;
    ctx.strokeRect(left, top, right - left, bottom - top);

    // Draw grid lines
    ctx.strokeStyle = 'rgba(108, 99, 255, 0.7)';
    ctx.lineWidth = 2;
    for (let i = 1; i <= 7; i++) {
        const x = xLines[i] * scale;
        ctx.beginPath();
        ctx.moveTo(x, top);
        ctx.lineTo(x, bottom);
        ctx.stroke();
    }
    for (let i = 1; i <= 7; i++) {
        const y = yLines[i] * scale;
        ctx.beginPath();
        ctx.moveTo(left, y);
        ctx.lineTo(right, y);
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

confirmGridBtn.addEventListener('click', () => {
    confirmGrid().catch(err => {
        setStatus(`Error: ${err.message}`, 'error');
        console.error('Classification error:', err);
    });
});

// --- Rotation controls ---

function adjustRotation(delta) {
    rotationDeg = Math.round((rotationDeg + delta) * 10) / 10;
    rotateAngleInput.value = rotationDeg;
    applyRotationAndDetect().catch(err => {
        setStatus(`Error: ${err.message}`, 'error');
        console.error('Rotate error:', err);
    });
}

rotateCcwBtn.addEventListener('click', () => adjustRotation(-0.1));
rotateCwBtn.addEventListener('click', () => adjustRotation(0.1));
rotate90Btn.addEventListener('click', () => adjustRotation(90));

rotateAngleInput.addEventListener('change', () => {
    rotationDeg = parseFloat(rotateAngleInput.value) || 0;
    applyRotationAndDetect().catch(err => {
        setStatus(`Error: ${err.message}`, 'error');
        console.error('Rotate error:', err);
    });
});

/**
 * Rotate sourceImg by rotationDeg and re-run board detection + grid editor.
 */
async function applyRotationAndDetect() {
    if (!sourceImg) return;

    setStatus('Rotating...', 'processing');
    disableGridEditor();

    const rotated = await rotateImage(sourceImg, rotationDeg);
    await processImage(rotated);
}

/**
 * Rotate an image by an arbitrary angle (degrees clockwise).
 * Returns a new HTMLImageElement.
 */
function rotateImage(img, degrees) {
    const srcW = img.naturalWidth || img.width;
    const srcH = img.naturalHeight || img.height;
    const rad = degrees * Math.PI / 180;

    // Compute bounding box of rotated image
    const cos = Math.abs(Math.cos(rad));
    const sin = Math.abs(Math.sin(rad));
    const newW = Math.ceil(srcW * cos + srcH * sin);
    const newH = Math.ceil(srcW * sin + srcH * cos);

    const offscreen = document.createElement('canvas');
    offscreen.width = newW;
    offscreen.height = newH;
    const ctx = offscreen.getContext('2d');
    ctx.translate(newW / 2, newH / 2);
    ctx.rotate(rad);
    ctx.drawImage(img, -srcW / 2, -srcH / 2);

    return new Promise((resolve, reject) => {
        const rotatedImg = new Image();
        rotatedImg.onload = () => resolve(rotatedImg);
        rotatedImg.onerror = () => reject(new Error('Failed to create rotated image'));
        rotatedImg.src = offscreen.toDataURL();
    });
}

// --- Board editing ---

/**
 * Parse a FEN string into an 8x8 board array.
 * Each cell is a FEN char ('K','q','P', etc.) or '' for empty.
 */
function fenToBoard(fen) {
    const placement = fen.split(' ')[0];
    const ranks = placement.split('/');
    const board = [];
    for (let rank = 0; rank < 8; rank++) {
        const row = [];
        const rankStr = ranks[rank] || '';
        for (const ch of rankStr) {
            if (ch >= '1' && ch <= '8') {
                for (let i = 0; i < parseInt(ch); i++) row.push('');
            } else {
                row.push(ch);
            }
        }
        while (row.length < 8) row.push('');
        board.push(row);
    }
    return board;
}

/**
 * Convert an 8x8 board array back to a full FEN string.
 */
function boardToFen(board) {
    const ranks = [];
    for (let rank = 0; rank < 8; rank++) {
        let rankStr = '';
        let empty = 0;
        for (let file = 0; file < 8; file++) {
            const piece = board[rank][file];
            if (piece === '') {
                empty++;
            } else {
                if (empty > 0) { rankStr += empty; empty = 0; }
                rankStr += piece;
            }
        }
        if (empty > 0) rankStr += empty;
        ranks.push(rankStr);
    }
    return ranks.join('/') + ' w KQkq - 0 1';
}

// --- Palette: drag pieces onto the board ---

paletteBtns.forEach(btn => {
    if (!btn.dataset.piece) return; // skip eraser
    btn.draggable = true;
    btn.addEventListener('dragstart', (e) => {
        e.dataTransfer.setData('text/plain', btn.dataset.piece);
        e.dataTransfer.effectAllowed = 'copy';
    });
});

// Board canvas: accept drops from palette
previewCanvas.addEventListener('dragover', (e) => {
    if (!boardArray) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
});

previewCanvas.addEventListener('drop', (e) => {
    if (!boardArray) return;
    e.preventDefault();
    const piece = e.dataTransfer.getData('text/plain');
    if (!piece) return;

    const { file, rank } = canvasToSquare(e);
    if (file < 0 || file > 7 || rank < 0 || rank > 7) return;

    boardArray[rank][file] = piece;
    refreshBoardDisplay();
});

// Board canvas: click to remove a piece
previewCanvas.addEventListener('click', (e) => {
    if (!boardArray) return;

    const { file, rank } = canvasToSquare(e);
    if (file < 0 || file > 7 || rank < 0 || rank > 7) return;

    if (boardArray[rank][file] === '') return; // already empty
    boardArray[rank][file] = '';
    refreshBoardDisplay();
});

function canvasToSquare(e) {
    const bounds = previewCanvas.getBoundingClientRect();
    const scaleX = previewCanvas.width / bounds.width;
    const scaleY = previewCanvas.height / bounds.height;
    const x = (e.clientX - bounds.left) * scaleX;
    const y = (e.clientY - bounds.top) * scaleY;
    return { file: Math.floor(x / 50), rank: Math.floor(y / 50) };
}

function refreshBoardDisplay() {
    const fen = boardToFen(boardArray);
    fenText.value = fen;
    renderBoard(previewCanvas, fen);
    const fenEncoded = encodeURIComponent(fen);
    lichessLink.href = `https://lichess.org/analysis/${fenEncoded}`;
}

// --- Start ---
init();
