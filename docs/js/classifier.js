/**
 * TensorFlow.js model loading and chess piece classification.
 */

const TILE_SIZE = 50;

let model = null;

/**
 * Load the TensorFlow.js model.
 * @returns {Promise<void>}
 */
export async function loadModel() {
    model = await tf.loadGraphModel('./model/model.json');
    // Warm up the model with a dummy prediction
    const dummy = tf.zeros([1, TILE_SIZE, TILE_SIZE, 3]);
    model.predict(dummy).dispose();
    dummy.dispose();
}

/**
 * Check if the model is loaded.
 * @returns {boolean}
 */
export function isModelLoaded() {
    return model !== null;
}

/**
 * Classify a batch of 64 tile canvases.
 * @param {HTMLCanvasElement[]} tiles - Array of 64 canvas elements, each containing a square tile
 * @returns {Promise<{classIndex: number, confidence: number}[]>}
 */
export async function classifyBoard(tiles) {
    if (!model) throw new Error('Model not loaded');

    // Convert all tiles to tensors and stack into a batch
    const tensors = tiles.map(tile => {
        return tf.browser.fromPixels(tile).resizeBilinear([TILE_SIZE, TILE_SIZE]);
    });
    const batch = tf.stack(tensors);

    // Run inference
    const predictions = model.predict(batch);
    const classIndices = await predictions.argMax(-1).data();
    const maxConfidences = await predictions.max(-1).data();

    // Cleanup tensors
    tensors.forEach(t => t.dispose());
    batch.dispose();
    predictions.dispose();

    return Array.from(classIndices).map((idx, i) => ({
        classIndex: idx,
        confidence: maxConfidences[i],
    }));
}
