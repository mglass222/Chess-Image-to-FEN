"""Export trained PyTorch model to TensorFlow.js via ONNX.

Pipeline: PyTorch (.pt) → ONNX (.onnx) → TF SavedModel → TF.js (float16)

Required packages:
  - torch, torchvision (training venv)
  - onnx (pip install onnx)
  - onnx2tf (pip install onnx2tf)
  - tensorflowjs (pip install tensorflowjs)
  - tensorflow (pip install tensorflow)
"""

import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from config import CHECKPOINTS_DIR, NUM_CLASSES, TFJS_MODEL_DIR

import torch


def export_onnx(checkpoint_path, onnx_path):
    """Step 1: Load PyTorch checkpoint and export to ONNX with softmax."""
    from model import ChessPieceClassifier, ChessPieceClassifierSoftmax

    print(f"Loading checkpoint: {checkpoint_path}")
    checkpoint = torch.load(checkpoint_path, map_location="cpu", weights_only=False)
    print(f"  Epoch: {checkpoint['epoch']}, Val Acc: {checkpoint['val_acc']:.4f}")

    # Build model and load weights
    base_model = ChessPieceClassifier(num_classes=NUM_CLASSES)
    base_model.load_state_dict(checkpoint["model_state_dict"])
    base_model.eval()

    # Wrap with softmax for browser inference
    model = ChessPieceClassifierSoftmax(base_model)
    model.eval()

    # Export to ONNX
    dummy_input = torch.randn(1, 3, 224, 224)
    print(f"Exporting ONNX to: {onnx_path}")
    torch.onnx.export(
        model,
        dummy_input,
        str(onnx_path),
        input_names=["input"],
        output_names=["output"],
        dynamic_axes={
            "input": {0: "batch_size"},
            "output": {0: "batch_size"},
        },
        opset_version=17,
    )

    # Validate ONNX model
    import onnx
    onnx_model = onnx.load(str(onnx_path))
    onnx.checker.check_model(onnx_model)
    print(f"  ONNX model validated ({onnx_path.stat().st_size / 1024:.0f} KB)")


def convert_onnx_to_saved_model(onnx_path, saved_model_dir):
    """Step 2: Convert ONNX to TF SavedModel using onnx2tf."""
    print(f"\nConverting ONNX → TF SavedModel: {saved_model_dir}")
    import onnx2tf
    onnx2tf.convert(
        input_onnx_file_path=str(onnx_path),
        output_folder_path=str(saved_model_dir),
        non_verbose=True,
    )
    print(f"  SavedModel created at: {saved_model_dir}")


def convert_saved_model_to_tfjs(saved_model_dir, output_dir):
    """Step 3: Convert TF SavedModel to TF.js with float16 quantization."""
    print(f"\nConverting TF SavedModel → TF.js: {output_dir}")

    # Find tensorflowjs_converter - check cv venv first, then PATH
    converter = None
    cv_converter = Path("C:/Users/mglas/cv/Scripts/tensorflowjs_converter.exe")
    if cv_converter.exists():
        converter = str(cv_converter)
    else:
        converter = shutil.which("tensorflowjs_converter")

    if not converter:
        raise RuntimeError(
            "tensorflowjs_converter not found. Install with: pip install tensorflowjs"
        )

    Path(output_dir).mkdir(parents=True, exist_ok=True)

    cmd = [
        converter,
        "--input_format=tf_saved_model",
        "--output_format=tfjs_graph_model",
        "--quantize_float16", "*",
        str(saved_model_dir),
        str(output_dir),
    ]
    print(f"  Running: {' '.join(cmd)}")
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        print(f"  STDERR: {result.stderr}")
        raise RuntimeError(f"tensorflowjs_converter failed (exit code {result.returncode})")

    # Report output sizes
    total_size = 0
    for f in sorted(Path(output_dir).iterdir()):
        size = f.stat().st_size
        total_size += size
        print(f"  {f.name}: {size / 1024:.1f} KB")
    print(f"  Total: {total_size / 1024:.1f} KB ({total_size / 1024 / 1024:.2f} MB)")


def export_model(checkpoint_path=None, output_dir=None):
    """Full export pipeline: PyTorch → ONNX → TF SavedModel → TF.js."""
    checkpoint_path = Path(checkpoint_path or CHECKPOINTS_DIR / "best.pt")
    output_dir = Path(output_dir or TFJS_MODEL_DIR)

    if not checkpoint_path.exists():
        print(f"Checkpoint not found: {checkpoint_path}")
        sys.exit(1)

    with tempfile.TemporaryDirectory() as tmp_dir:
        tmp = Path(tmp_dir)
        onnx_path = tmp / "model.onnx"
        saved_model_dir = tmp / "saved_model"

        # Step 1: PyTorch → ONNX
        export_onnx(checkpoint_path, onnx_path)

        # Step 2: ONNX → TF SavedModel
        convert_onnx_to_saved_model(onnx_path, saved_model_dir)

        # Step 3: TF SavedModel → TF.js
        convert_saved_model_to_tfjs(saved_model_dir, output_dir)

    print("\nDone!")


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="Export PyTorch model to TensorFlow.js")
    parser.add_argument(
        "--checkpoint", type=str, default=None,
        help="Path to PyTorch checkpoint (default: best.pt)",
    )
    parser.add_argument(
        "--output", type=str, default=None,
        help="Output directory for TF.js files (default: docs/model/)",
    )
    args = parser.parse_args()

    export_model(args.checkpoint, args.output)
