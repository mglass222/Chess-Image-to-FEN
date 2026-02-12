/**
 * Board detection and segmentation.
 * v1: Simple grid division with basic edge-based border trimming.
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
 * Uses edge detection to find the largest square-ish region with grid lines.
 * Falls back to using the full image if detection fails.
 * @param {HTMLCanvasElement} canvas
 * @returns {{x: number, y: number, width: number, height: number}}
 */
function findBoardRect(canvas) {
    const ctx = canvas.getContext('2d');
    const w = canvas.width;
    const h = canvas.height;
    const imageData = ctx.getImageData(0, 0, w, h);
    const pixels = imageData.data;

    // Convert to grayscale
    const gray = new Float32Array(w * h);
    for (let i = 0; i < w * h; i++) {
        const r = pixels[i * 4];
        const g = pixels[i * 4 + 1];
        const b = pixels[i * 4 + 2];
        gray[i] = 0.299 * r + 0.587 * g + 0.114 * b;
    }

    // Compute horizontal and vertical Sobel gradients
    const sobelH = new Float32Array(w * h);
    const sobelV = new Float32Array(w * h);
    for (let y = 1; y < h - 1; y++) {
        for (let x = 1; x < w - 1; x++) {
            const idx = y * w + x;
            // Horizontal gradient (detects vertical edges)
            sobelH[idx] = Math.abs(
                -gray[(y-1)*w + (x-1)] + gray[(y-1)*w + (x+1)]
                -2*gray[y*w + (x-1)] + 2*gray[y*w + (x+1)]
                -gray[(y+1)*w + (x-1)] + gray[(y+1)*w + (x+1)]
            );
            // Vertical gradient (detects horizontal edges)
            sobelV[idx] = Math.abs(
                -gray[(y-1)*w + (x-1)] - 2*gray[(y-1)*w + x] - gray[(y-1)*w + (x+1)]
                +gray[(y+1)*w + (x-1)] + 2*gray[(y+1)*w + x] + gray[(y+1)*w + (x+1)]
            );
        }
    }

    // Project gradients onto axes to find grid lines
    // Vertical edge projection (sum along rows for each column)
    const vProj = new Float32Array(w);
    for (let x = 0; x < w; x++) {
        let sum = 0;
        for (let y = 0; y < h; y++) {
            sum += sobelH[y * w + x];
        }
        vProj[x] = sum;
    }

    // Horizontal edge projection (sum along columns for each row)
    const hProj = new Float32Array(h);
    for (let y = 0; y < h; y++) {
        let sum = 0;
        for (let x = 0; x < w; x++) {
            sum += sobelV[y * w + x];
        }
        hProj[y] = sum;
    }

    // Find board boundaries from projections
    const xBounds = findBoardBounds(vProj, w);
    const yBounds = findBoardBounds(hProj, h);

    if (xBounds && yBounds) {
        // Make it square (chess boards are square)
        let bw = xBounds.end - xBounds.start;
        let bh = yBounds.end - yBounds.start;
        const size = Math.min(bw, bh);

        return {
            x: xBounds.start + Math.floor((bw - size) / 2),
            y: yBounds.start + Math.floor((bh - size) / 2),
            width: size,
            height: size,
        };
    }

    // Fallback: assume the board is centered and square
    const size = Math.min(w, h);
    return {
        x: Math.floor((w - size) / 2),
        y: Math.floor((h - size) / 2),
        width: size,
        height: size,
    };
}

/**
 * Find board boundaries from an edge projection array.
 * Looks for a region with high edge density (the board) surrounded by low density (background).
 * @param {Float32Array} projection
 * @param {number} length
 * @returns {{start: number, end: number}|null}
 */
function findBoardBounds(projection, length) {
    // Smooth the projection
    const smoothed = new Float32Array(length);
    const kernel = 5;
    for (let i = 0; i < length; i++) {
        let sum = 0;
        let count = 0;
        for (let j = Math.max(0, i - kernel); j <= Math.min(length - 1, i + kernel); j++) {
            sum += projection[j];
            count++;
        }
        smoothed[i] = sum / count;
    }

    // Find threshold (mean + 0.5 * std)
    let mean = 0;
    for (let i = 0; i < length; i++) mean += smoothed[i];
    mean /= length;

    let variance = 0;
    for (let i = 0; i < length; i++) variance += (smoothed[i] - mean) ** 2;
    const std = Math.sqrt(variance / length);
    const threshold = mean + 0.5 * std;

    // Find the longest contiguous region above threshold
    let bestStart = 0, bestEnd = length, bestLen = 0;
    let start = -1;

    for (let i = 0; i < length; i++) {
        if (smoothed[i] > threshold) {
            if (start === -1) start = i;
        } else {
            if (start !== -1) {
                const len = i - start;
                if (len > bestLen) {
                    bestLen = len;
                    bestStart = start;
                    bestEnd = i;
                }
                start = -1;
            }
        }
    }
    // Check if the last segment extends to the end
    if (start !== -1) {
        const len = length - start;
        if (len > bestLen) {
            bestStart = start;
            bestEnd = length;
        }
    }

    // Only return if we found a substantial region (at least 30% of image)
    if (bestEnd - bestStart > length * 0.3) {
        return { start: bestStart, end: bestEnd };
    }
    return null;
}

/**
 * Refine rough board bounds by searching for the grid alignment that best
 * matches the alternating light/dark chessboard pattern.
 * @param {HTMLCanvasElement} canvas
 * @param {{x: number, y: number, width: number, height: number}} rough
 * @returns {{x: number, y: number, width: number, height: number}}
 */
function refineBoardRect(canvas, rough) {
    const ctx = canvas.getContext('2d');
    const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    const imgW = canvas.width;

    const maxTrim = Math.round(Math.min(rough.width, rough.height) * 0.15);
    const steps = 12;
    const step = Math.max(1, Math.round(maxTrim / steps));

    let bestScore = -1;
    let bestRect = rough;

    for (let dx = 0; dx <= maxTrim; dx += step) {
        for (let dy = 0; dy <= maxTrim; dy += step) {
            for (let ds = 0; ds <= maxTrim; ds += step) {
                const size = Math.min(rough.width - dx, rough.height - dy) - ds;
                if (size < rough.width * 0.7) continue;

                const rect = {
                    x: rough.x + dx,
                    y: rough.y + dy,
                    width: size,
                    height: size,
                };

                const score = chessboardScore(pixels, imgW, rect);
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
