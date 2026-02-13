/**
 * Board detection and segmentation.
 * v2: Chessboard pattern scoring to locate the board, with refinement.
 */

/**
 * Detect the chess board region in an image and segment it into 64 tiles.
 * @param {HTMLImageElement} img - The source image
 * @returns {HTMLCanvasElement[]} Array of 64 tile canvases (top-left to bottom-right)
 */
export function detectAndSegment(img) {
    // Draw image to a working canvas
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth || img.width;
    canvas.height = img.naturalHeight || img.height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0);

    // Detect the board bounding box and refine alignment
    const rough = findBoardRect(canvas);
    const rect = refineBoardRect(canvas, rough);

    // Segment into 64 tiles
    return extractTiles(canvas, rect);
}

/**
 * Find the bounding rectangle of the chess board in the image.
 * Uses chessboard pattern scoring to locate the board region.
 * Two-phase search: coarse grid then fine refinement around best candidate.
 * @param {HTMLCanvasElement} canvas
 * @returns {{x: number, y: number, width: number, height: number}}
 */
function findBoardRect(canvas) {
    const ctx = canvas.getContext('2d');
    const w = canvas.width;
    const h = canvas.height;
    const pixels = ctx.getImageData(0, 0, w, h).data;

    // Try the largest centered square first (handles board-only screenshots)
    const size = Math.min(w, h);
    const centeredRect = {
        x: Math.floor((w - size) / 2),
        y: Math.floor((h - size) / 2),
        width: size,
        height: size,
    };

    if (chessboardScore(pixels, w, centeredRect) >= 50) {
        return centeredRect;
    }

    // Sliding window search across positions and sizes (50%-100% of min dimension)
    let bestScore = -1;
    let bestRect = centeredRect;

    const minSize = Math.floor(size * 0.5);
    const sizeSteps = 10;
    const posSteps = 12;

    for (let si = 0; si <= sizeSteps; si++) {
        const s = Math.floor(minSize + (size - minSize) * si / sizeSteps);
        const xRange = w - s;
        const yRange = h - s;

        for (let xi = 0; xi <= posSteps; xi++) {
            for (let yi = 0; yi <= posSteps; yi++) {
                const x = Math.floor(xRange * xi / posSteps);
                const y = Math.floor(yRange * yi / posSteps);

                const rect = { x, y, width: s, height: s };
                const score = chessboardScore(pixels, w, rect);

                if (score > bestScore) {
                    bestScore = score;
                    bestRect = rect;
                }
            }
        }
    }

    return bestRect;
}

/**
 * Refine rough board bounds by searching for the grid alignment that best
 * matches the alternating light/dark chessboard pattern.
 * Uses contrastScore as tiebreaker for pixel-level precision.
 * @param {HTMLCanvasElement} canvas
 * @param {{x: number, y: number, width: number, height: number}} rough
 * @returns {{x: number, y: number, width: number, height: number}}
 */
function refineBoardRect(canvas, rough) {
    const ctx = canvas.getContext('2d');
    const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    const imgW = canvas.width;
    const imgH = canvas.height;

    const nomTileW = rough.width / 8;
    const nomTileH = rough.height / 8;
    const halfTile = Math.floor(Math.min(nomTileW, nomTileH) / 2);

    // Build horizontal gradient across the full image width (not just rough rect)
    const hGrad = new Float32Array(imgW);
    for (let row = 0; row < 8; row++) {
        for (const frac of [0.1, 0.9]) {
            const sy = Math.round(rough.y + (row + frac) * nomTileH);
            if (sy < 0 || sy >= imgH) continue;
            for (let x = 0; x < imgW - 1; x++) {
                const idx1 = (sy * imgW + x) * 4;
                const idx2 = (sy * imgW + x + 1) * 4;
                const b1 = 0.299 * pixels[idx1] + 0.587 * pixels[idx1 + 1] + 0.114 * pixels[idx1 + 2];
                const b2 = 0.299 * pixels[idx2] + 0.587 * pixels[idx2 + 1] + 0.114 * pixels[idx2 + 2];
                hGrad[x] += Math.abs(b2 - b1);
            }
        }
    }

    // Search over offset AND tile size to find best horizontal alignment
    // Grid lines at positions: offset + k * tw for k=1..7 (in image coordinates)
    let bestHScore = -1;
    let bestOffset = rough.x;
    let bestTW = nomTileW;

    const minTW = nomTileW * 0.85;
    const maxTW = nomTileW * 1.15;
    const twStep = 0.5;

    for (let tw = minTW; tw <= maxTW; tw += twStep) {
        const searchMin = Math.max(0, rough.x - halfTile);
        const searchMax = Math.min(imgW - Math.round(8 * tw), rough.x + halfTile);
        for (let off = searchMin; off <= searchMax; off++) {
            let score = 0;
            for (let k = 1; k <= 7; k++) {
                const pos = Math.round(off + k * tw);
                for (let d = -2; d <= 2; d++) {
                    const p = pos + d;
                    if (p >= 0 && p < imgW) score += hGrad[p];
                }
            }
            if (score > bestHScore) {
                bestHScore = score;
                bestOffset = off;
                bestTW = tw;
            }
        }
    }

    // Build vertical gradient across full image height
    const vGrad = new Float32Array(imgH);
    for (let col = 0; col < 8; col++) {
        for (const frac of [0.1, 0.9]) {
            const sx = Math.round(bestOffset + (col + frac) * bestTW);
            if (sx < 0 || sx >= imgW) continue;
            for (let y = 0; y < imgH - 1; y++) {
                const idx1 = (y * imgW + sx) * 4;
                const idx2 = ((y + 1) * imgW + sx) * 4;
                const b1 = 0.299 * pixels[idx1] + 0.587 * pixels[idx1 + 1] + 0.114 * pixels[idx1 + 2];
                const b2 = 0.299 * pixels[idx2] + 0.587 * pixels[idx2 + 1] + 0.114 * pixels[idx2 + 2];
                vGrad[y] += Math.abs(b2 - b1);
            }
        }
    }

    // Search over offset AND tile size for vertical alignment
    let bestVScore = -1;
    let bestYOffset = rough.y;
    let bestTH = nomTileH;

    const minTH = nomTileH * 0.85;
    const maxTH = nomTileH * 1.15;

    for (let th = minTH; th <= maxTH; th += twStep) {
        const searchMin = Math.max(0, rough.y - halfTile);
        const searchMax = Math.min(imgH - Math.round(8 * th), rough.y + halfTile);
        for (let off = searchMin; off <= searchMax; off++) {
            let score = 0;
            for (let k = 1; k <= 7; k++) {
                const pos = Math.round(off + k * th);
                for (let d = -2; d <= 2; d++) {
                    const p = pos + d;
                    if (p >= 0 && p < imgH) score += vGrad[p];
                }
            }
            if (score > bestVScore) {
                bestVScore = score;
                bestYOffset = off;
                bestTH = th;
            }
        }
    }

    const finalW = Math.round(8 * bestTW);
    const finalH = Math.round(8 * bestTH);
    const finalSize = Math.min(finalW, finalH);

    const result = {
        x: bestOffset,
        y: bestYOffset,
        width: finalSize,
        height: finalSize,
    };

    return result;
}

/**
 * Score how well a candidate rectangle matches an 8x8 alternating color grid.
 * Samples tile corners (to avoid piece pixels) and checks light/dark parity.
 * @returns {number} 0–64 (higher = better alignment)
 */
function chessboardScore(pixels, imgW, rect) {
    const tileW = rect.width / 8;
    const tileH = rect.height / 8;
    const margin = 0.15;

    const brightness = [];
    for (let row = 0; row < 8; row++) {
        for (let col = 0; col < 8; col++) {
            const corners = [
                [rect.x + (col + margin) * tileW, rect.y + (row + margin) * tileH],
                [rect.x + (col + 1 - margin) * tileW, rect.y + (row + margin) * tileH],
                [rect.x + (col + margin) * tileW, rect.y + (row + 1 - margin) * tileH],
                [rect.x + (col + 1 - margin) * tileW, rect.y + (row + 1 - margin) * tileH],
            ];

            let maxB = 0;
            for (const [cx, cy] of corners) {
                const px = Math.round(cx);
                const py = Math.round(cy);
                if (px < 0 || py < 0 || px >= imgW) continue;
                const idx = (py * imgW + px) * 4;
                const b = 0.299 * pixels[idx] + 0.587 * pixels[idx + 1] + 0.114 * pixels[idx + 2];
                if (b > maxB) maxB = b;
            }
            brightness.push(maxB);
        }
    }

    // Median brightness as threshold
    const sorted = [...brightness].sort((a, b) => a - b);
    const threshold = sorted[32];

    // Try both parities
    let score0 = 0, score1 = 0;
    for (let row = 0; row < 8; row++) {
        for (let col = 0; col < 8; col++) {
            const isLight = brightness[row * 8 + col] > threshold;
            if (isLight === ((row + col) % 2 === 0)) score0++;
            if (isLight === ((row + col) % 2 === 1)) score1++;
        }
    }

    return Math.max(score0, score1);
}

/**
 * Extract 64 tile canvases from the board region.
 * @param {HTMLCanvasElement} canvas - Full image canvas
 * @param {{x: number, y: number, width: number, height: number}} rect - Board bounding box
 * @returns {HTMLCanvasElement[]} Array of 64 tile canvases
 */
function extractTiles(canvas, rect) {
    const tileW = rect.width / 8;
    const tileH = rect.height / 8;
    const ctx = canvas.getContext('2d');
    const tiles = [];

    for (let rank = 0; rank < 8; rank++) {
        for (let file = 0; file < 8; file++) {
            const sx = rect.x + file * tileW;
            const sy = rect.y + rank * tileH;

            const tileCanvas = document.createElement('canvas');
            tileCanvas.width = 50;
            tileCanvas.height = 50;
            const tileCtx = tileCanvas.getContext('2d');

            tileCtx.drawImage(
                canvas,
                sx, sy, tileW, tileH,  // Source
                0, 0, 50, 50            // Destination (resize to 50x50)
            );

            tiles.push(tileCanvas);
        }
    }

    return tiles;
}

/**
 * Get the detected board rectangle (for overlay drawing).
 * @param {HTMLImageElement} img
 * @returns {{x: number, y: number, width: number, height: number}}
 */
export function getBoardRect(img) {
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth || img.width;
    canvas.height = img.naturalHeight || img.height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0);
    const rough = findBoardRect(canvas);
    return refineBoardRect(canvas, rough);
}
