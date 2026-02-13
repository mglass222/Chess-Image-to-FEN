"""Export trained PyTorch model to ONNX for browser inference via ONNX Runtime Web.

Pipeline: PyTorch (.pt) → ONNX (.onnx)

Only requires torch (already installed). No extra dependencies needed.
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from config import CHECKPOINTS_DIR, NUM_CLASSES, TFJS_MODEL_DIR

import torch
from model import ChessPieceClassifier, ChessPieceClassifierSoftmax


def export_model(checkpoint_path=None, output_dir=None):
    """Export PyTorch checkpoint to ONNX with softmax for browser inference."""
    checkpoint_path = Path(checkpoint_path or CHECKPOINTS_DIR / "best.pt")
    output_dir = Path(output_dir or TFJS_MODEL_DIR)
    output_dir.mkdir(parents=True, exist_ok=True)
    onnx_path = output_dir / "model.onnx"

    if not checkpoint_path.exists():
        print(f"Checkpoint not found: {checkpoint_path}")
        sys.exit(1)

    # Load checkpoint
    print(f"Loading checkpoint: {checkpoint_path}")
    checkpoint = torch.load(checkpoint_path, map_location="cpu", weights_only=False)
    print(f"  Epoch: {checkpoint['epoch']}, Val Acc: {checkpoint['val_acc']:.4f}")

    # Build model with softmax wrapper
    base_model = ChessPieceClassifier(num_classes=NUM_CLASSES)
    base_model.load_state_dict(checkpoint["model_state_dict"])
    base_model.eval()

    model = ChessPieceClassifierSoftmax(base_model)
    model.eval()

    # Export to ONNX
    dummy_input = torch.randn(1, 3, 224, 224)
    print(f"Exporting to: {onnx_path}")
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
        dynamo=False,  # use legacy exporter (no onnxscript dependency)
    )

    size_kb = onnx_path.stat().st_size / 1024
    print(f"  Exported: {size_kb:.0f} KB ({size_kb / 1024:.2f} MB)")
    print(f"\nDone! Model saved to: {onnx_path}")


if __name__ == "__main__":
    export_model()
