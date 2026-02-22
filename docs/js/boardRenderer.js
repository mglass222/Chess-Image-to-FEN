/**
 * Render a chess board preview from a FEN string using canvas.
 * Uses lichess cburnett piece images.
 */

const LIGHT_COLOR = '#f0d9b5';
const DARK_COLOR = '#b58863';
const DEFAULT_BOARD_PX = 400;

// Map FEN characters to piece image filenames
const PIECE_FILES = {
    'K': 'wK', 'Q': 'wQ', 'R': 'wR', 'B': 'wB', 'N': 'wN', 'P': 'wP',
    'k': 'bK', 'q': 'bQ', 'r': 'bR', 'b': 'bB', 'n': 'bN', 'p': 'bP',
};

// Overlay colors by piece type (both colors share same overlay)
const PIECE_OVERLAY = {
    'K': 'rgba(255, 0, 0, 0.8)',   'k': 'rgba(255, 0, 0, 0.8)',     // King - Red
    'Q': 'rgba(128, 0, 128, 0.8)', 'q': 'rgba(128, 0, 128, 0.8)',   // Queen - Purple
    'R': 'rgba(200, 120, 0, 0.8)', 'r': 'rgba(200, 120, 0, 0.8)',   // Rook - Dark Orange
    'N': 'rgba(100, 149, 255, 0.8)', 'n': 'rgba(100, 149, 255, 0.8)', // Knight - Light Blue
    'B': 'rgba(255, 255, 0, 0.8)', 'b': 'rgba(255, 255, 0, 0.8)',   // Bishop - Yellow
    'P': 'rgba(0, 128, 0, 0.8)',   'p': 'rgba(0, 128, 0, 0.8)',     // Pawn - Green
};

// Preloaded piece images
const pieceImages = {};
let piecesReady = false;

/**
 * Preload all piece SVG images. Call once at startup.
 * @returns {Promise<void>}
 */
export function preloadPieces() {
    const promises = Object.entries(PIECE_FILES).map(([fen, file]) => {
        return new Promise((resolve) => {
            const img = new Image();
            img.onload = () => {
                pieceImages[fen] = img;
                resolve();
            };
            img.onerror = () => resolve();
            img.src = `pieces/${file}.svg`;
        });
    });
    return Promise.all(promises).then(() => { piecesReady = true; });
}

/**
 * Render a FEN position onto a canvas element.
 * @param {HTMLCanvasElement} canvas - Target canvas
 * @param {string} fen - FEN string
 * @param {number} [boardPx] - Total board size in pixels (default 400)
 */
export function renderBoard(canvas, fen, boardPx) {
    const size = boardPx || DEFAULT_BOARD_PX;
    const sq = size / 8;
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');

    // Parse FEN piece placement (first field only)
    const placement = fen.split(' ')[0];
    const ranks = placement.split('/');

    // Draw squares and pieces
    for (let rank = 0; rank < 8; rank++) {
        let file = 0;
        const rankStr = ranks[rank] || '';

        for (const ch of rankStr) {
            if (ch >= '1' && ch <= '8') {
                // Empty squares
                const count = parseInt(ch);
                for (let i = 0; i < count; i++) {
                    drawSquare(ctx, file, rank, sq);
                    file++;
                }
            } else {
                // Piece
                drawSquare(ctx, file, rank, sq);
                drawPiece(ctx, file, rank, ch, sq);
                file++;
            }
        }

        // Fill remaining squares if rank string was short
        while (file < 8) {
            drawSquare(ctx, file, rank, sq);
            file++;
        }
    }

    // Draw grid lines for clarity
    ctx.strokeStyle = '#ccc';
    ctx.lineWidth = 1;
    for (let i = 0; i <= 8; i++) {
        const pos = i * sq;
        ctx.beginPath(); ctx.moveTo(pos, 0); ctx.lineTo(pos, size); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(0, pos); ctx.lineTo(size, pos); ctx.stroke();
    }
}

function drawSquare(ctx, file, rank, sq) {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(file * sq, rank * sq, sq, sq);
}

function drawPiece(ctx, file, rank, piece, sq) {
    const x = file * sq;
    const y = rank * sq;

    // Use SVG image if loaded
    const img = pieceImages[piece];
    if (img) {
        ctx.drawImage(img, x, y, sq, sq);
    } else {
        // Fallback to Unicode
        const PIECE_UNICODE = {
            'K': '\u2654', 'Q': '\u2655', 'R': '\u2656', 'B': '\u2657', 'N': '\u2658', 'P': '\u2659',
            'k': '\u265A', 'q': '\u265B', 'r': '\u265C', 'b': '\u265D', 'n': '\u265E', 'p': '\u265F',
        };
        const unicode = PIECE_UNICODE[piece];
        if (unicode) {
            const cx = x + sq / 2;
            const cy = y + sq / 2;
            ctx.font = `${sq * 0.8}px serif`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
            ctx.fillText(unicode, cx + 1, cy + 1);
            ctx.fillStyle = piece === piece.toUpperCase() ? '#fff' : '#000';
            ctx.fillText(unicode, cx, cy);
        }
    }

}
