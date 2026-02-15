/**
 * Interactive grid overlay editor.
 * Stores 9 vertical (x) and 9 horizontal (y) line positions.
 * All lines are independently draggable. Outer edges also serve as
 * the bounding box; internal lines allow non-uniform tile sizes.
 */

const HIT_THRESHOLD = 8; // pixels (in display coords)
const MIN_GAP = 6;       // minimum gap between adjacent lines in image coords

let _canvas = null;
let _ctx = null;
let _img = null;
let _xLines = null; // 9 x-positions in image coords (vertical lines, left to right)
let _yLines = null; // 9 y-positions in image coords (horizontal lines, top to bottom)
let _scale = 1;
let _onChange = null;

// Drag state: { axis: 'x'|'y', index: 0-8 } or null
let _dragging = null;
let _listeners = {};

/**
 * Enable interactive grid editing on a canvas.
 * @param {HTMLCanvasElement} canvas
 * @param {HTMLImageElement} img
 * @param {{x: number, y: number, width: number, height: number}} rect - in image coords
 * @param {number} scale - display scale factor (display = image * scale)
 * @param {function} onChange - called with { xLines: number[], yLines: number[] } on each drag
 * @param {{xLines: number[], yLines: number[]}} [gridLines] - optional pre-existing lines (overrides rect)
 */
export function enableGridEditor(canvas, img, rect, scale, onChange, gridLines) {
    _canvas = canvas;
    _ctx = canvas.getContext('2d');
    _img = img;
    _scale = scale;
    _onChange = onChange;
    _dragging = null;

    if (gridLines) {
        _xLines = [...gridLines.xLines];
        _yLines = [...gridLines.yLines];
    } else {
        // Initialize 9 evenly spaced lines from the rect
        _xLines = [];
        _yLines = [];
        for (let i = 0; i <= 8; i++) {
            _xLines.push(rect.x + (rect.width / 8) * i);
            _yLines.push(rect.y + (rect.height / 8) * i);
        }
    }

    _listeners.mousedown = onMouseDown;
    _listeners.mousemove = onMouseMove;
    _listeners.mouseup = onMouseUp;
    _listeners.mouseleave = onMouseLeave;

    canvas.addEventListener('mousedown', _listeners.mousedown);
    canvas.addEventListener('mousemove', _listeners.mousemove);
    canvas.addEventListener('mouseup', _listeners.mouseup);
    canvas.addEventListener('mouseleave', _listeners.mouseleave);

    // Touch support
    _listeners.touchstart = onTouchStart;
    _listeners.touchmove = onTouchMove;
    _listeners.touchend = onTouchEnd;

    canvas.addEventListener('touchstart', _listeners.touchstart, { passive: false });
    canvas.addEventListener('touchmove', _listeners.touchmove, { passive: false });
    canvas.addEventListener('touchend', _listeners.touchend);

    redraw();
}

/**
 * Disable interactive grid editing and clean up listeners.
 */
export function disableGridEditor() {
    if (!_canvas) return;

    _canvas.removeEventListener('mousedown', _listeners.mousedown);
    _canvas.removeEventListener('mousemove', _listeners.mousemove);
    _canvas.removeEventListener('mouseup', _listeners.mouseup);
    _canvas.removeEventListener('mouseleave', _listeners.mouseleave);
    _canvas.removeEventListener('touchstart', _listeners.touchstart);
    _canvas.removeEventListener('touchmove', _listeners.touchmove);
    _canvas.removeEventListener('touchend', _listeners.touchend);

    _canvas.style.cursor = '';
    _listeners = {};
    _canvas = null;
    _dragging = null;
}

/**
 * Get current grid line positions (image coordinates).
 * @returns {{ xLines: number[], yLines: number[] }}
 */
export function getGridLines() {
    return { xLines: [..._xLines], yLines: [..._yLines] };
}

// --- Hit testing ---

/**
 * Find the closest draggable element to the given display coordinates.
 * Corners (intersections of outer edges) take priority over lines.
 * @returns {{ axis: 'x'|'y'|'corner', index?: number, xi?: number, yi?: number } | null}
 */
function hitTest(displayX, displayY) {
    const top = _yLines[0] * _scale;
    const bottom = _yLines[8] * _scale;
    const left = _xLines[0] * _scale;
    const right = _xLines[8] * _scale;

    // Check corners first (all 4 outer corners)
    const cornerThreshold = HIT_THRESHOLD * 1.5;
    const corners = [
        { xi: 0, yi: 0 }, { xi: 8, yi: 0 },
        { xi: 0, yi: 8 }, { xi: 8, yi: 8 },
    ];
    let bestCorner = null;
    let bestCornerDist = cornerThreshold + 1;
    for (const c of corners) {
        const cx = _xLines[c.xi] * _scale;
        const cy = _yLines[c.yi] * _scale;
        const dist = Math.sqrt((displayX - cx) ** 2 + (displayY - cy) ** 2);
        if (dist < bestCornerDist) {
            bestCornerDist = dist;
            bestCorner = { axis: 'corner', xi: c.xi, yi: c.yi };
        }
    }
    if (bestCorner) return bestCorner;

    // Test lines
    let best = null;
    let bestDist = HIT_THRESHOLD + 1;

    // Test vertical lines (x-axis) — only if mouse is within vertical range
    if (displayY >= top - HIT_THRESHOLD && displayY <= bottom + HIT_THRESHOLD) {
        for (let i = 0; i <= 8; i++) {
            const lineX = _xLines[i] * _scale;
            const dist = Math.abs(displayX - lineX);
            if (dist < bestDist) {
                bestDist = dist;
                best = { axis: 'x', index: i };
            }
        }
    }

    // Test horizontal lines (y-axis) — only if mouse is within horizontal range
    if (displayX >= left - HIT_THRESHOLD && displayX <= right + HIT_THRESHOLD) {
        for (let i = 0; i <= 8; i++) {
            const lineY = _yLines[i] * _scale;
            const dist = Math.abs(displayY - lineY);
            if (dist < bestDist) {
                bestDist = dist;
                best = { axis: 'y', index: i };
            }
        }
    }

    return best;
}

function getCursorForHit(hit) {
    if (!hit) return '';
    if (hit.axis === 'corner') {
        if ((hit.xi === 0 && hit.yi === 0) || (hit.xi === 8 && hit.yi === 8)) return 'nwse-resize';
        return 'nesw-resize';
    }
    return hit.axis === 'x' ? 'ew-resize' : 'ns-resize';
}

// --- Mouse handlers ---

function getCanvasPos(e) {
    const bounds = _canvas.getBoundingClientRect();
    const scaleX = _canvas.width / bounds.width;
    const scaleY = _canvas.height / bounds.height;
    return {
        x: (e.clientX - bounds.left) * scaleX,
        y: (e.clientY - bounds.top) * scaleY,
    };
}

function onMouseDown(e) {
    const pos = getCanvasPos(e);
    const hit = hitTest(pos.x, pos.y);
    if (hit) {
        _dragging = hit;
        e.preventDefault();
    }
}

function onMouseMove(e) {
    const pos = getCanvasPos(e);

    if (_dragging) {
        applyDrag(_dragging, pos);
        redraw();
        if (_onChange) _onChange({ xLines: [..._xLines], yLines: [..._yLines] });
    } else {
        const hit = hitTest(pos.x, pos.y);
        _canvas.style.cursor = getCursorForHit(hit);
    }
}

function onMouseUp() {
    _dragging = null;
}

function onMouseLeave() {
    _dragging = null;
    if (_canvas) _canvas.style.cursor = '';
}

// --- Touch handlers ---

function getTouchPos(e) {
    const touch = e.touches[0] || e.changedTouches[0];
    const bounds = _canvas.getBoundingClientRect();
    const scaleX = _canvas.width / bounds.width;
    const scaleY = _canvas.height / bounds.height;
    return {
        x: (touch.clientX - bounds.left) * scaleX,
        y: (touch.clientY - bounds.top) * scaleY,
    };
}

function onTouchStart(e) {
    const pos = getTouchPos(e);
    const hit = hitTest(pos.x, pos.y);
    if (hit) {
        _dragging = hit;
        e.preventDefault();
    }
}

function onTouchMove(e) {
    if (!_dragging) return;
    e.preventDefault();
    const pos = getTouchPos(e);
    applyDrag(_dragging, pos);
    redraw();
    if (_onChange) _onChange({ xLines: [..._xLines], yLines: [..._yLines] });
}

function onTouchEnd() {
    _dragging = null;
}

// --- Drag logic ---

function applyDrag(hit, displayPos) {
    const imgW = _img.naturalWidth || _img.width;
    const imgH = _img.naturalHeight || _img.height;
    const imgX = displayPos.x / _scale;
    const imgY = displayPos.y / _scale;

    if (hit.axis === 'corner') {
        // Move both edges at once
        const xLo = hit.xi === 0 ? 0 : _xLines[hit.xi - 1] + MIN_GAP;
        const xHi = hit.xi === 8 ? imgW : _xLines[hit.xi + 1] - MIN_GAP;
        _xLines[hit.xi] = Math.max(xLo, Math.min(xHi, imgX));

        const yLo = hit.yi === 0 ? 0 : _yLines[hit.yi - 1] + MIN_GAP;
        const yHi = hit.yi === 8 ? imgH : _yLines[hit.yi + 1] - MIN_GAP;
        _yLines[hit.yi] = Math.max(yLo, Math.min(yHi, imgY));
    } else if (hit.axis === 'x') {
        const lo = hit.index === 0 ? 0 : _xLines[hit.index - 1] + MIN_GAP;
        const hi = hit.index === 8 ? imgW : _xLines[hit.index + 1] - MIN_GAP;
        _xLines[hit.index] = Math.max(lo, Math.min(hi, imgX));
    } else {
        const lo = hit.index === 0 ? 0 : _yLines[hit.index - 1] + MIN_GAP;
        const hi = hit.index === 8 ? imgH : _yLines[hit.index + 1] - MIN_GAP;
        _yLines[hit.index] = Math.max(lo, Math.min(hi, imgY));
    }
}

// --- Drawing ---

function redraw() {
    const w = _canvas.width;
    const h = _canvas.height;
    _ctx.clearRect(0, 0, w, h);

    // Draw image
    _ctx.drawImage(_img, 0, 0, w, h);

    // Display-space grid bounds
    const left = _xLines[0] * _scale;
    const right = _xLines[8] * _scale;
    const top = _yLines[0] * _scale;
    const bottom = _yLines[8] * _scale;

    // Dim area outside the grid
    _ctx.fillStyle = 'rgba(0, 0, 0, 0.4)';
    _ctx.fillRect(0, 0, w, top);                              // top
    _ctx.fillRect(0, bottom, w, h - bottom);                   // bottom
    _ctx.fillRect(0, top, left, bottom - top);                 // left
    _ctx.fillRect(right, top, w - right, bottom - top);        // right

    // Draw outer border
    _ctx.strokeStyle = '#6c63ff';
    _ctx.lineWidth = 3;
    _ctx.strokeRect(left, top, right - left, bottom - top);

    // Draw internal vertical lines
    _ctx.strokeStyle = 'rgba(108, 99, 255, 0.7)';
    _ctx.lineWidth = 2;
    for (let i = 1; i <= 7; i++) {
        const x = _xLines[i] * _scale;
        _ctx.beginPath();
        _ctx.moveTo(x, top);
        _ctx.lineTo(x, bottom);
        _ctx.stroke();
    }

    // Draw internal horizontal lines
    for (let i = 1; i <= 7; i++) {
        const y = _yLines[i] * _scale;
        _ctx.beginPath();
        _ctx.moveTo(left, y);
        _ctx.lineTo(right, y);
        _ctx.stroke();
    }

    // Draw handles at all grid intersections
    _ctx.fillStyle = '#6c63ff';
    for (let xi = 0; xi <= 8; xi++) {
        const x = _xLines[xi] * _scale;
        for (let yi = 0; yi <= 8; yi++) {
            const y = _yLines[yi] * _scale;
            const isCorner = (xi === 0 || xi === 8) && (yi === 0 || yi === 8);
            const hs = isCorner ? 10 : 6;
            _ctx.fillRect(x - hs / 2, y - hs / 2, hs, hs);
        }
    }
}
