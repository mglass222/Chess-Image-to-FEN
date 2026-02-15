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

// Class index constants for readability
const IDX_EMPTY = 0;
const IDX_WP = 1, IDX_WN = 2, IDX_WB = 3, IDX_WR = 4, IDX_WQ = 5, IDX_WK = 6;
const IDX_BP = 7, IDX_BN = 8, IDX_BB = 9, IDX_BR = 10, IDX_BQ = 11, IDX_BK = 12;

const WHITE_PAWNS = new Set([IDX_WP]);
const BLACK_PAWNS = new Set([IDX_BP]);
const ALL_PAWNS = new Set([IDX_WP, IDX_BP]);
const WHITE_KINGS = new Set([IDX_WK]);
const BLACK_KINGS = new Set([IDX_BK]);
const WHITE_PIECES = new Set([IDX_WP, IDX_WN, IDX_WB, IDX_WR, IDX_WQ, IDX_WK]);
const BLACK_PIECES = new Set([IDX_BP, IDX_BN, IDX_BB, IDX_BR, IDX_BQ, IDX_BK]);

/**
 * Pick the best alternative class from a square's probability distribution.
 * @param {number[]} probs - 13-class probability array
 * @param {Set<number>} excludeSet - class indices to skip
 * @returns {number} best alternative class index
 */
function bestAlternative(probs, excludeSet) {
    let bestIdx = IDX_EMPTY;
    let bestProb = -1;
    for (let c = 0; c < probs.length; c++) {
        if (excludeSet.has(c)) continue;
        if (probs[c] > bestProb) {
            bestProb = probs[c];
            bestIdx = c;
        }
    }
    return bestIdx;
}

/**
 * Validate and correct illegal positions on the board grid.
 * Modifies the board and probs arrays in place.
 * @param {number[][]} board - 8x8 grid of class indices
 * @param {number[][][]} probs - 8x8 grid of probability arrays
 * @returns {string[]} warnings describing corrections made
 */
function validateAndCorrect(board, probs) {
    const warnings = [];

    // Rule 1: No pawns on ranks 1 (index 0) or 8 (index 7)
    for (const rankIdx of [0, 7]) {
        for (let file = 0; file < 8; file++) {
            const cls = board[rankIdx][file];
            if (ALL_PAWNS.has(cls)) {
                const oldName = CLASS_NAMES[cls];
                const newIdx = bestAlternative(probs[rankIdx][file], ALL_PAWNS);
                board[rankIdx][file] = newIdx;
                const newName = CLASS_NAMES[newIdx];
                warnings.push(`${oldName} on rank ${rankIdx === 0 ? 8 : 1} → ${newName}`);
            }
        }
    }

    // Rule 2: Exactly 1 king per side
    for (const [kingSet, side] of [[WHITE_KINGS, 'w'], [BLACK_KINGS, 'b']]) {
        const kingIdx = side === 'w' ? IDX_WK : IDX_BK;
        const kings = [];
        for (let r = 0; r < 8; r++) {
            for (let f = 0; f < 8; f++) {
                if (board[r][f] === kingIdx) {
                    kings.push({ r, f, conf: probs[r][f][kingIdx] });
                }
            }
        }
        if (kings.length > 1) {
            // Keep highest confidence, replace others
            kings.sort((a, b) => b.conf - a.conf);
            for (let i = 1; i < kings.length; i++) {
                const { r, f } = kings[i];
                const newIdx = bestAlternative(probs[r][f], kingSet);
                board[r][f] = newIdx;
                warnings.push(`extra ${side}K → ${CLASS_NAMES[newIdx]}`);
            }
        } else if (kings.length === 0) {
            warnings.push(`no ${side}K found`);
        }
    }

    // Rule 3: Max 8 pawns per side
    for (const [pawnIdx, side] of [[IDX_WP, 'w'], [IDX_BP, 'b']]) {
        const pawnSet = side === 'w' ? WHITE_PAWNS : BLACK_PAWNS;
        let pawns = [];
        for (let r = 0; r < 8; r++) {
            for (let f = 0; f < 8; f++) {
                if (board[r][f] === pawnIdx) {
                    pawns.push({ r, f, conf: probs[r][f][pawnIdx] });
                }
            }
        }
        while (pawns.length > 8) {
            // Demote lowest-confidence pawn
            pawns.sort((a, b) => a.conf - b.conf);
            const { r, f } = pawns.shift();
            const newIdx = bestAlternative(probs[r][f], pawnSet);
            board[r][f] = newIdx;
            warnings.push(`excess ${side}P → ${CLASS_NAMES[newIdx]}`);
        }
    }

    // Rule 4: Max 15 non-king pieces per side (king + 15 = 16 total)
    for (const [pieceSet, kingIdx, side] of [
        [WHITE_PIECES, IDX_WK, 'w'],
        [BLACK_PIECES, IDX_BK, 'b']
    ]) {
        let pieces = [];
        for (let r = 0; r < 8; r++) {
            for (let f = 0; f < 8; f++) {
                if (pieceSet.has(board[r][f]) && board[r][f] !== kingIdx) {
                    pieces.push({ r, f, cls: board[r][f], conf: probs[r][f][board[r][f]] });
                }
            }
        }
        while (pieces.length > 15) {
            pieces.sort((a, b) => a.conf - b.conf);
            const { r, f, cls } = pieces.shift();
            board[r][f] = IDX_EMPTY;
            warnings.push(`excess ${CLASS_NAMES[cls]} → empty`);
        }
    }

    return warnings;
}

/**
 * Build a FEN string from classification predictions.
 * @param {{classIndex: number, confidence: number, probs: number[]}[]} predictions - 64 predictions, top-left to bottom-right
 * @param {boolean} isFlipped - True if the board image has black on bottom
 * @returns {{fen: string, warnings: string[]}}
 */
export function buildFEN(predictions, isFlipped) {
    // Convert predictions to an 8x8 grid of class indices and probs
    let board = [];
    let boardProbs = [];
    for (let rank = 0; rank < 8; rank++) {
        let row = [];
        let probRow = [];
        for (let file = 0; file < 8; file++) {
            const idx = rank * 8 + file;
            row.push(predictions[idx].classIndex);
            probRow.push(predictions[idx].probs);
        }
        board.push(row);
        boardProbs.push(probRow);
    }

    // If board is flipped (black on bottom), reverse rows and columns
    if (isFlipped) {
        board = board.reverse().map(row => row.reverse());
        boardProbs = boardProbs.reverse().map(row => row.reverse());
    }

    // Validate and correct illegal positions
    const warnings = validateAndCorrect(board, boardProbs);

    // Convert to FEN piece placement
    let fenRows = [];
    for (let rank = 0; rank < 8; rank++) {
        let fenRow = '';
        let emptyCount = 0;
        for (let file = 0; file < 8; file++) {
            const piece = PIECE_TO_FEN[CLASS_NAMES[board[rank][file]]];
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
    const fen = fenRows.join('/') + ' w KQkq - 0 1';
    return { fen, warnings };
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
