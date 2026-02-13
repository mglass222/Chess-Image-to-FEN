/**
 * Render a chess board preview from a FEN string using canvas.
 * Uses lichess cburnett piece images.
 */

const LIGHT_COLOR = '#f0d9b5';
const DARK_COLOR = '#b58863';
const SQUARE_SIZE = 50;
const BOARD_PX = SQUARE_SIZE * 8;

// Map FEN characters to piece image filenames
const PIECE_FILES = {
    'K': 'wK', 'Q': 'wQ', 'R': 'wR', 'B': 'wB', 'N': 'wN', 'P': 'wP',
    'k': 'bK', 'q': 'bQ', 'r': 'bR', 'b': 'bB', 'n': 'bN', 'p': 'bP',
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
 * @param {HTMLCanvasElement} canvas - Target canvas (should be 400x400)
 * @param {string} fen - FEN string
 */
export function renderBoard(canvas, fen) {
    canvas.width = BOARD_PX;
    canvas.height = BOARD_PX;
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
                    drawSquare(ctx, file, rank);
                    file++;
                }
            } else {
                // Piece
                drawSquare(ctx, file, rank);
                drawPiece(ctx, file, rank, ch);
                file++;
            }
        }

        // Fill remaining squares if rank string was short
        while (file < 8) {
            drawSquare(ctx, file, rank);
            file++;
        }
    }

    // Draw grid lines for clarity
    ctx.strokeStyle = '#333';
    ctx.lineWidth = 0.5;
    ctx.strokeRect(0, 0, BOARD_PX, BOARD_PX);
}

function drawSquare(ctx, file, rank) {
    const isLight = (file + rank) % 2 === 0;
    ctx.fillStyle = isLight ? LIGHT_COLOR : DARK_COLOR;
    ctx.fillRect(file * SQUARE_SIZE, rank * SQUARE_SIZE, SQUARE_SIZE, SQUARE_SIZE);
}

function drawPiece(ctx, file, rank, piece) {
    const x = file * SQUARE_SIZE;
    const y = rank * SQUARE_SIZE;

    // Use SVG image if loaded
    const img = pieceImages[piece];
    if (img) {
        ctx.drawImage(img, x, y, SQUARE_SIZE, SQUARE_SIZE);
        return;
    }

    // Fallback to Unicode
    const PIECE_UNICODE = {
        'K': '\u2654', 'Q': '\u2655', 'R': '\u2656', 'B': '\u2657', 'N': '\u2658', 'P': '\u2659',
        'k': '\u265A', 'q': '\u265B', 'r': '\u265C', 'b': '\u265D', 'n': '\u265E', 'p': '\u265F',
    };
    const unicode = PIECE_UNICODE[piece];
    if (!unicode) return;

    const cx = x + SQUARE_SIZE / 2;
    const cy = y + SQUARE_SIZE / 2;
    ctx.font = `${SQUARE_SIZE * 0.8}px serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
    ctx.fillText(unicode, cx + 1, cy + 1);
    ctx.fillStyle = piece === piece.toUpperCase() ? '#fff' : '#000';
    ctx.fillText(unicode, cx, cy);
}
