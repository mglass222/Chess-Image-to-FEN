/**
 * Assemble a FEN string from 64 square classifications.
 */

export const CLASS_NAMES = [
    'empty',
    'wP', 'wN', 'wB', 'wR', 'wQ', 'wK',
    'bP', 'bN', 'bB', 'bR', 'bQ', 'bK',
];

const PIECE_TO_FEN = {
    'wP': 'P', 'wN': 'N', 'wB': 'B', 'wR': 'R', 'wQ': 'Q', 'wK': 'K',
    'bP': 'p', 'bN': 'n', 'bB': 'b', 'bR': 'r', 'bQ': 'q', 'bK': 'k',
    'empty': null,
};

/**
 * Build a FEN string from classification predictions.
 * @param {{classIndex: number, confidence: number}[]} predictions - 64 predictions, top-left to bottom-right
 * @param {boolean} isFlipped - True if the board image has black on bottom
 * @returns {string} FEN string
 */
export function buildFEN(predictions, isFlipped) {
    // Convert predictions to an 8x8 grid of class names
    let board = [];
    for (let rank = 0; rank < 8; rank++) {
        let row = [];
        for (let file = 0; file < 8; file++) {
            const idx = rank * 8 + file;
            row.push(CLASS_NAMES[predictions[idx].classIndex]);
        }
        board.push(row);
    }

    // If board is flipped (black on bottom), reverse rows and columns
    if (isFlipped) {
        board = board.reverse().map(row => row.reverse());
    }

    // Convert to FEN piece placement
    let fenRows = [];
    for (let rank = 0; rank < 8; rank++) {
        let fenRow = '';
        let emptyCount = 0;
        for (let file = 0; file < 8; file++) {
            const piece = PIECE_TO_FEN[board[rank][file]];
            if (piece === null) {
                emptyCount++;
            } else {
                if (emptyCount > 0) {
                    fenRow += emptyCount;
                    emptyCount = 0;
                }
                fenRow += piece;
            }
        }
        if (emptyCount > 0) fenRow += emptyCount;
        fenRows.push(fenRow);
    }

    // Default the non-deducible fields
    return fenRows.join('/') + ' w KQkq - 0 1';
}

/**
 * Auto-detect board orientation from predictions.
 * If rank 8 (top of image) has mostly black pieces -> white is on bottom (standard).
 * If rank 8 has mostly white pieces -> black is on bottom (flipped).
 * @param {{classIndex: number}[]} predictions - 64 predictions
 * @returns {boolean} true if board appears flipped (black on bottom)
 */
export function detectOrientation(predictions) {
    // Check the top row (first 8 squares in the image)
    let topWhite = 0;
    let topBlack = 0;
    for (let i = 0; i < 8; i++) {
        const name = CLASS_NAMES[predictions[i].classIndex];
        if (name.startsWith('w')) topWhite++;
        if (name.startsWith('b')) topBlack++;
    }

    // Check the bottom row (last 8 squares)
    let bottomWhite = 0;
    let bottomBlack = 0;
    for (let i = 56; i < 64; i++) {
        const name = CLASS_NAMES[predictions[i].classIndex];
        if (name.startsWith('w')) bottomWhite++;
        if (name.startsWith('b')) bottomBlack++;
    }

    // Standard orientation: black on top, white on bottom
    // Flipped: white on top, black on bottom
    // If top has more white pieces than black, it's likely flipped
    return topWhite > topBlack && bottomBlack > bottomWhite;
}
