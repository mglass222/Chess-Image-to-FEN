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
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
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

    if (chessboardScore(pixels, w, centeredRect) >= 40) {
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
                const score = chessboardScore(pixels, w, rect) * (s / size);

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
 * Extract luminance channel from RGBA pixel data.
 * @returns {Uint8Array} luminance values (0-255), row-major
 */
function extractLuminance(pixels, w, h) {
    const lum = new Uint8Array(w * h);
    for (let i = 0; i < w * h; i++) {
        const idx = i * 4;
        lum[i] = Math.round(0.299 * pixels[idx] + 0.587 * pixels[idx + 1] + 0.114 * pixels[idx + 2]);
    }
    return lum;
}

/**
 * CLAHE (Contrast Limited Adaptive Histogram Equalization).
 * Enhances local contrast so that low-contrast regions (grey boards) get
 * amplified to show strong edges at tile boundaries.
 * @param {Uint8Array} lum - luminance array (row-major)
 * @param {number} w - image width
 * @param {number} h - image height
 * @param {number} [clipLimit=3.0] - histogram clip factor
 * @param {number} [gridX=8] - number of horizontal tiles
 * @param {number} [gridY=8] - number of vertical tiles
 * @returns {Uint8Array} contrast-enhanced luminance
 */
function clahe(lum, w, h, clipLimit = 3.0, gridX = 8, gridY = 8) {
    const tileW = w / gridX;
    const tileH = h / gridY;
    const nBins = 256;

    // Compute clipped CDF for each grid tile
    const cdfs = [];  // [gridY][gridX] arrays of length 256
    for (let ty = 0; ty < gridY; ty++) {
        const row = [];
        for (let tx = 0; tx < gridX; tx++) {
            const x0 = Math.floor(tx * tileW);
            const y0 = Math.floor(ty * tileH);
            const x1 = Math.min(Math.floor((tx + 1) * tileW), w);
            const y1 = Math.min(Math.floor((ty + 1) * tileH), h);
            const nPixels = (x1 - x0) * (y1 - y0);

            // Build histogram
            const hist = new Float32Array(nBins);
            for (let y = y0; y < y1; y++) {
                for (let x = x0; x < x1; x++) {
                    hist[lum[y * w + x]]++;
                }
            }

            // Clip histogram and redistribute excess
            const limit = Math.max(1, Math.floor(clipLimit * nPixels / nBins));
            let excess = 0;
            for (let i = 0; i < nBins; i++) {
                if (hist[i] > limit) {
                    excess += hist[i] - limit;
                    hist[i] = limit;
                }
            }
            const perBin = excess / nBins;
            for (let i = 0; i < nBins; i++) {
                hist[i] += perBin;
            }

            // Build CDF, normalized to [0, 255]
            const cdf = new Float32Array(nBins);
            cdf[0] = hist[0];
            for (let i = 1; i < nBins; i++) {
                cdf[i] = cdf[i - 1] + hist[i];
            }
            const cdfMax = cdf[nBins - 1];
            if (cdfMax > 0) {
                for (let i = 0; i < nBins; i++) {
                    cdf[i] = (cdf[i] / cdfMax) * 255;
                }
            }
            row.push(cdf);
        }
        cdfs.push(row);
    }

    // Bilinear interpolation of CDFs for each pixel
    const out = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            const val = lum[y * w + x];

            // Fractional tile coordinates (centered on tile midpoints)
            const fx = (x / tileW) - 0.5;
            const fy = (y / tileH) - 0.5;

            const tx0 = Math.max(0, Math.floor(fx));
            const ty0 = Math.max(0, Math.floor(fy));
            const tx1 = Math.min(gridX - 1, tx0 + 1);
            const ty1 = Math.min(gridY - 1, ty0 + 1);

            const ax = Math.max(0, Math.min(1, fx - tx0));
            const ay = Math.max(0, Math.min(1, fy - ty0));

            // Bilinear interpolation of 4 surrounding tile CDFs
            const v00 = cdfs[ty0][tx0][val];
            const v10 = cdfs[ty0][tx1][val];
            const v01 = cdfs[ty1][tx0][val];
            const v11 = cdfs[ty1][tx1][val];

            const top = v00 * (1 - ax) + v10 * ax;
            const bot = v01 * (1 - ax) + v11 * ax;
            out[y * w + x] = Math.round(top * (1 - ay) + bot * ay);
        }
    }

    return out;
}

/**
 * Canny edge detection. Returns a binary edge map (0 or 255).
 * Pipeline: Gaussian blur → Sobel gradients → non-max suppression → hysteresis.
 * @param {Uint8Array} lum - luminance array (row-major)
 * @param {number} w - image width
 * @param {number} h - image height
 * @param {number} [lowT=30] - low hysteresis threshold
 * @param {number} [highT=80] - high hysteresis threshold
 * @returns {Uint8Array} binary edge map (0 or 255)
 */
function canny(lum, w, h, lowT = 30, highT = 80) {
    // 1. Gaussian blur (5x5, sigma ~1.4)
    const kernel = [
        2, 4, 5, 4, 2,
        4, 9, 12, 9, 4,
        5, 12, 15, 12, 5,
        4, 9, 12, 9, 4,
        2, 4, 5, 4, 2,
    ];
    const kSum = 159;
    const blurred = new Uint8Array(w * h);
    for (let y = 2; y < h - 2; y++) {
        for (let x = 2; x < w - 2; x++) {
            let sum = 0;
            for (let ky = -2; ky <= 2; ky++) {
                for (let kx = -2; kx <= 2; kx++) {
                    sum += lum[(y + ky) * w + (x + kx)] * kernel[(ky + 2) * 5 + (kx + 2)];
                }
            }
            blurred[y * w + x] = (sum / kSum + 0.5) | 0;
        }
    }

    // 2. Sobel gradients (magnitude + direction quantized to 4 angles)
    const mag = new Float32Array(w * h);
    const dir = new Uint8Array(w * h); // 0=horiz, 1=diag45, 2=vert, 3=diag135
    for (let y = 1; y < h - 1; y++) {
        for (let x = 1; x < w - 1; x++) {
            const i = y * w + x;
            const gx = -blurred[i - w - 1] + blurred[i - w + 1]
                      - 2 * blurred[i - 1] + 2 * blurred[i + 1]
                      - blurred[i + w - 1] + blurred[i + w + 1];
            const gy = -blurred[i - w - 1] - 2 * blurred[i - w] - blurred[i - w + 1]
                      + blurred[i + w - 1] + 2 * blurred[i + w] + blurred[i + w + 1];
            mag[i] = Math.sqrt(gx * gx + gy * gy);
            // Quantize angle to 4 directions
            const angle = Math.atan2(gy, gx) * 180 / Math.PI;
            const a = angle < 0 ? angle + 180 : angle;
            if (a < 22.5 || a >= 157.5) dir[i] = 0;
            else if (a < 67.5) dir[i] = 1;
            else if (a < 112.5) dir[i] = 2;
            else dir[i] = 3;
        }
    }

    // 3. Non-maximum suppression (thin edges to 1px)
    const nms = new Float32Array(w * h);
    for (let y = 1; y < h - 1; y++) {
        for (let x = 1; x < w - 1; x++) {
            const i = y * w + x;
            const m = mag[i];
            let m1, m2;
            switch (dir[i]) {
                case 0: m1 = mag[i - 1]; m2 = mag[i + 1]; break;           // horizontal edge → compare left/right
                case 1: m1 = mag[i - w + 1]; m2 = mag[i + w - 1]; break;   // 45° → compare NE/SW
                case 2: m1 = mag[i - w]; m2 = mag[i + w]; break;           // vertical edge → compare up/down
                case 3: m1 = mag[i - w - 1]; m2 = mag[i + w + 1]; break;   // 135° → compare NW/SE
            }
            nms[i] = (m >= m1 && m >= m2) ? m : 0;
        }
    }

    // 4. Hysteresis thresholding (strong/weak edge linking)
    const edge = new Uint8Array(w * h);
    const STRONG = 255, WEAK = 128;
    for (let i = 0; i < w * h; i++) {
        if (nms[i] >= highT) edge[i] = STRONG;
        else if (nms[i] >= lowT) edge[i] = WEAK;
    }
    // Connect weak edges adjacent to strong edges
    let changed = true;
    while (changed) {
        changed = false;
        for (let y = 1; y < h - 1; y++) {
            for (let x = 1; x < w - 1; x++) {
                const i = y * w + x;
                if (edge[i] !== WEAK) continue;
                // Check 8-connected neighbours for a strong edge
                if (edge[i - w - 1] === STRONG || edge[i - w] === STRONG || edge[i - w + 1] === STRONG ||
                    edge[i - 1] === STRONG || edge[i + 1] === STRONG ||
                    edge[i + w - 1] === STRONG || edge[i + w] === STRONG || edge[i + w + 1] === STRONG) {
                    edge[i] = STRONG;
                    changed = true;
                }
            }
        }
    }
    // Suppress remaining weak edges
    for (let i = 0; i < w * h; i++) {
        if (edge[i] !== STRONG) edge[i] = 0;
    }

    return edge;
}

/**
 * Refine rough board bounds by searching for the grid alignment that best
 * matches the alternating light/dark chessboard pattern.
 * Pipeline: CLAHE → Canny edge detection → accumulate edge pixels along scan lines.
 * @param {HTMLCanvasElement} canvas
 * @param {{x: number, y: number, width: number, height: number}} rough
 * @returns {{x: number, y: number, width: number, height: number}}
 */
function refineBoardRect(canvas, rough) {
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    const imgW = canvas.width;
    const imgH = canvas.height;

    // CLAHE → Canny: produces a clean binary edge map for any board contrast
    const rawLum = extractLuminance(pixels, imgW, imgH);
    const enhanced = clahe(rawLum, imgW, imgH);
    const edges = canny(enhanced, imgW, imgH);

    const nomTileW = rough.width / 8;
    const nomTileH = rough.height / 8;
    const halfTile = Math.floor(Math.min(nomTileW, nomTileH) / 2);

    // Build horizontal edge accumulator along scan lines near tile edges
    const hGrad = new Float32Array(imgW);
    for (let row = 0; row < 8; row++) {
        for (const frac of [0.1, 0.9]) {
            const sy = Math.round(rough.y + (row + frac) * nomTileH);
            if (sy < 0 || sy >= imgH) continue;
            for (let x = 0; x < imgW; x++) {
                hGrad[x] += edges[sy * imgW + x];
            }
        }
    }

    // Search over offset AND tile size to find best horizontal alignment
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

    // Build vertical edge accumulator along scan lines near tile edges
    const vGrad = new Float32Array(imgH);
    for (let col = 0; col < 8; col++) {
        for (const frac of [0.1, 0.9]) {
            const sx = Math.round(bestOffset + (col + frac) * bestTW);
            if (sx < 0 || sx >= imgW) continue;
            for (let y = 0; y < imgH; y++) {
                vGrad[y] += edges[y * imgW + sx];
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
 * Samples multiple points per tile (avoiding piece centers) and uses average
 * brightness with variance-aware scoring for robustness on low-contrast boards.
 * @returns {number} Score (higher = better alignment, includes contrast bonus)
 */
function chessboardScore(pixels, imgW, rect) {
    const tileW = rect.width / 8;
    const tileH = rect.height / 8;
    const m = 0.15; // margin inset to avoid pieces

    // Sample 8 points per tile: 4 corners + 4 edge midpoints, all within margin
    const sampleOffsets = [
        [m, m], [1 - m, m], [m, 1 - m], [1 - m, 1 - m],       // corners
        [0.5, m], [0.5, 1 - m], [m, 0.5], [1 - m, 0.5],        // edge mids
    ];

    const brightness = [];
    for (let row = 0; row < 8; row++) {
        for (let col = 0; col < 8; col++) {
            let sum = 0;
            let count = 0;
            for (const [dx, dy] of sampleOffsets) {
                const px = Math.round(rect.x + (col + dx) * tileW);
                const py = Math.round(rect.y + (row + dy) * tileH);
                if (px < 0 || py < 0 || px >= imgW) continue;
                const idx = (py * imgW + px) * 4;
                sum += 0.299 * pixels[idx] + 0.587 * pixels[idx + 1] + 0.114 * pixels[idx + 2];
                count++;
            }
            brightness.push(count > 0 ? sum / count : 0);
        }
    }

    // Pairwise comparison: adjacent tiles on the same rank or file should differ.
    // This is robust to pieces because a piece on a light square still differs
    // from the adjacent dark square in brightness.
    let pairMatches = 0;
    let pairTotal = 0;

    // Horizontal pairs (same rank, adjacent files)
    for (let row = 0; row < 8; row++) {
        for (let col = 0; col < 7; col++) {
            const b1 = brightness[row * 8 + col];
            const b2 = brightness[row * 8 + col + 1];
            const diff = Math.abs(b1 - b2);
            if (diff > 5) pairMatches++;
            pairTotal++;
        }
    }

    // Vertical pairs (same file, adjacent ranks)
    for (let col = 0; col < 8; col++) {
        for (let row = 0; row < 7; row++) {
            const b1 = brightness[row * 8 + col];
            const b2 = brightness[(row + 1) * 8 + col];
            const diff = Math.abs(b1 - b2);
            if (diff > 5) pairMatches++;
            pairTotal++;
        }
    }

    // Scale to match the old scoring range (~0-72) so thresholds still work.
    // pairTotal = 112 (56 horizontal + 56 vertical). Max raw = 112.
    // Map to 0-64 range (like the old parity score) plus contrast bonus.
    const pairScore = (pairMatches / pairTotal) * 64;

    // Contrast bonus: reward boards where the brightest and darkest tiles differ
    const sorted = [...brightness].sort((a, b) => a - b);
    const lightMean = sorted.slice(32).reduce((a, b) => a + b, 0) / 32;
    const darkMean = sorted.slice(0, 32).reduce((a, b) => a + b, 0) / 32;
    const contrast = (lightMean - darkMean) / 255; // 0..1

    return pairScore + contrast * 8;
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
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
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
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0);
    const rough = findBoardRect(canvas);
    return refineBoardRect(canvas, rough);
}
