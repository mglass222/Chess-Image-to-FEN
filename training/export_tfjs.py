"""Export trained Keras model to TensorFlow.js format."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from config import CHECKPOINTS_DIR, TFJS_MODEL_DIR

import tensorflow as tf
import tensorflowjs as tfjs


def export_model(model_path=None, output_dir=None, quantize=True):
    """Convert a Keras model to TensorFlow.js Layers format."""
    model_path = model_path or str(CHECKPOINTS_DIR / "best.keras")
    output_dir = output_dir or str(TFJS_MODEL_DIR)

    print(f"Loading model from: {model_path}")
    model = tf.keras.models.load_model(model_path)
    model.summary()

    Path(output_dir).mkdir(parents=True, exist_ok=True)

    print(f"Exporting to TensorFlow.js format: {output_dir}")
    if quantize:
        print("  Using float16 quantization")
        tfjs.converters.save_keras_model(
            model,
            output_dir,
            quantization_dtype_map={"float16": "*"},
        )
    else:
        tfjs.converters.save_keras_model(model, output_dir)

    # Report output file sizes
    total_size = 0
    for f in Path(output_dir).iterdir():
        size = f.stat().st_size
        total_size += size
        print(f"  {f.name}: {size / 1024:.1f} KB")
    print(f"  Total: {total_size / 1024:.1f} KB")

    print("Done!")


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="Export model to TensorFlow.js")
    parser.add_argument(
        "--model", type=str, default=None,
        help="Path to Keras model file (default: best.keras checkpoint)"
    )
    parser.add_argument(
        "--output", type=str, default=None,
        help="Output directory for TF.js files (default: docs/model/)"
    )
    parser.add_argument(
        "--no-quantize", action="store_true",
        help="Skip float16 quantization"
    )
    args = parser.parse_args()

    export_model(args.model, args.output, quantize=not args.no_quantize)
