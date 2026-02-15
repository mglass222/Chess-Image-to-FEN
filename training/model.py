"""ResNet-18-based chess piece classifier with built-in normalization."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from config import NUM_CLASSES

import torch
import torch.nn as nn
from torchvision.models import resnet18, ResNet18_Weights


class ChessPieceClassifier(nn.Module):
    """ResNet-18 fine-tuned for chess piece classification.

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

        # Load pretrained ResNet-18 backbone (remove final FC layer)
        backbone = resnet18(weights=ResNet18_Weights.IMAGENET1K_V1)
        self.features = nn.Sequential(
            backbone.conv1,
            backbone.bn1,
            backbone.relu,
            backbone.maxpool,
            backbone.layer1,
            backbone.layer2,
            backbone.layer3,
            backbone.layer4,
        )
        self.pool = nn.AdaptiveAvgPool2d(1)

        # Classifier head (ResNet-18 outputs 512 features)
        self.classifier = nn.Sequential(
            nn.Dropout(0.2),
            nn.Linear(512, num_classes),
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
