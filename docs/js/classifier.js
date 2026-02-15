/**
 * ONNX Runtime Web model loading and chess piece classification.
 */

const MODEL_INPUT_SIZE = 224;

let session = null;

/**
 * Load the ONNX model.
 * @returns {Promise<void>}
 */
export async function loadModel() {
    session = await ort.InferenceSession.create('./model/model.onnx', {
        executionProviders: ['wasm'],
    });
    // Warm up with a dummy prediction
    const dummy = new ort.Tensor('float32', new Float32Array(1 * 3 * MODEL_INPUT_SIZE * MODEL_INPUT_SIZE), [1, 3, MODEL_INPUT_SIZE, MODEL_INPUT_SIZE]);
    await session.run({ input: dummy });
}

/**
 * Check if the model is loaded.
 * @returns {boolean}
 */
export function isModelLoaded() {
    return session !== null;
}

/**
 * Extract pixel data from a canvas tile and resize to MODEL_INPUT_SIZE.
 * Returns CHW float32 array in [0, 255] range.
 * @param {HTMLCanvasElement} tile
 * @returns {Float32Array}
 */
function tileToTensor(tile) {
    // Draw tile resized to MODEL_INPUT_SIZE x MODEL_INPUT_SIZE
    const resizeCanvas = document.createElement('canvas');
    resizeCanvas.width = MODEL_INPUT_SIZE;
    resizeCanvas.height = MODEL_INPUT_SIZE;
    const ctx = resizeCanvas.getContext('2d');
    ctx.drawImage(tile, 0, 0, MODEL_INPUT_SIZE, MODEL_INPUT_SIZE);

    const imageData = ctx.getImageData(0, 0, MODEL_INPUT_SIZE, MODEL_INPUT_SIZE);
    const { data } = imageData;
    const pixels = MODEL_INPUT_SIZE * MODEL_INPUT_SIZE;

    // Convert RGBA HWC to RGB CHW float32 in [0, 255]
    const chw = new Float32Array(3 * pixels);
    for (let i = 0; i < pixels; i++) {
        chw[i] = data[i * 4];               // R
        chw[pixels + i] = data[i * 4 + 1];  // G
        chw[2 * pixels + i] = data[i * 4 + 2]; // B
    }
    return chw;
}

/**
 * Classify a batch of 64 tile canvases.
 * @param {HTMLCanvasElement[]} tiles - Array of 64 canvas elements, each containing a square tile
 * @returns {Promise<{classIndex: number, confidence: number}[]>}
 */
export async function classifyBoard(tiles) {
    if (!session) throw new Error('Model not loaded');

    const batchSize = tiles.length;
    const pixelsPerImage = 3 * MODEL_INPUT_SIZE * MODEL_INPUT_SIZE;
    const batchData = new Float32Array(batchSize * pixelsPerImage);

    // Fill batch buffer
    for (let i = 0; i < batchSize; i++) {
        const chw = tileToTensor(tiles[i]);
        batchData.set(chw, i * pixelsPerImage);
    }

    // Run inference
    const inputTensor = new ort.Tensor('float32', batchData, [batchSize, 3, MODEL_INPUT_SIZE, MODEL_INPUT_SIZE]);
    const results = await session.run({ input: inputTensor });
    const output = results.output.data; // flat Float32Array [batchSize * numClasses]
    const numClasses = output.length / batchSize;

    // Extract argmax, confidence, and full softmax probabilities per tile
    return Array.from({ length: batchSize }, (_, i) => {
        const offset = i * numClasses;
        const logits = Array.from({ length: numClasses }, (_, c) => output[offset + c]);

        // Softmax for stable probabilities
        const maxLogit = Math.max(...logits);
        const exps = logits.map(l => Math.exp(l - maxLogit));
        const sumExp = exps.reduce((a, b) => a + b, 0);
        const probs = exps.map(e => e / sumExp);

        let maxIdx = 0;
        let maxVal = probs[0];
        for (let c = 1; c < numClasses; c++) {
            if (probs[c] > maxVal) {
                maxVal = probs[c];
                maxIdx = c;
            }
        }
        return { classIndex: maxIdx, confidence: maxVal, probs };
    });
}
