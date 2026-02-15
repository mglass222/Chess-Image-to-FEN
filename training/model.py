"""MobileNetV2-based chess piece classifier with built-in normalization."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from config import NUM_CLASSES

import torch
import torch.nn as nn
from torchvision.models import mobilenet_v2, MobileNet_V2_Weights


class ChessPieceClassifier(nn.Module):
    """MobileNetV2 fine-tuned for chess piece classification.

    Accepts raw [0, 255] float32 input and normalizes internally,
    so the browser can pass pixel values directly without preprocessing.
    """

    def __init__(self, num_classes=NUM_CLASSES):
        super().__init__()

        # ImageNet normalization constants (baked into the model for ONNX export)
        self.register_buffer(
            "mean", torch.tensor([0.485, 0.456, 0.406]).view(1, 3, 1, 1)
        )
        self.register_buffer(
            "std", torch.tensor([0.229, 0.224, 0.225]).view(1, 3, 1, 1)
        )

        # Load pretrained MobileNetV2 backbone
        backbone = mobilenet_v2(weights=MobileNet_V2_Weights.IMAGENET1K_V1)
        self.features = backbone.features
        self.pool = nn.AdaptiveAvgPool2d(1)

        # Classifier head (MobileNetV2 outputs 1280 features)
        self.classifier = nn.Sequential(
            nn.Dropout(0.2),
            nn.Linear(1280, num_classes),
        )

    def forward(self, x):
        # x: (N, 3, 224, 224) float32 in [0, 255]
        x = x / 255.0
        x = (x - self.mean) / self.std

        x = self.features(x)
        x = self.pool(x)
        x = torch.flatten(x, 1)
        x = self.classifier(x)
        return x  # raw logits for CrossEntropyLoss


class ChessPieceClassifierSoftmax(nn.Module):
    """Wrapper that adds softmax for export (browser expects probabilities)."""

    def __init__(self, base_model):
        super().__init__()
        self.model = base_model

    def forward(self, x):
        logits = self.model(x)
        return torch.softmax(logits, dim=1)


if __name__ == "__main__":
    model = ChessPieceClassifier()
    print(f"Parameters: {sum(p.numel() for p in model.parameters()):,}")
    dummy = torch.randn(1, 3, 224, 224)
    out = model(dummy)
    print(f"Output shape: {out.shape}")
