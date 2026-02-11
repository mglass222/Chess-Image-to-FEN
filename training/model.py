"""CNN model architecture for chess piece classification."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from config import NUM_CLASSES, TILE_SIZE

import tensorflow as tf
from tensorflow import keras
from tensorflow.keras import layers


def build_model(input_shape=(TILE_SIZE, TILE_SIZE, 3), num_classes=NUM_CLASSES):
    """Build a small CNN for classifying chess piece tiles.

    Architecture: 3 conv blocks (32->64->128), GlobalAvgPool, Dense head.
    ~300K parameters, suitable for TensorFlow.js browser inference.
    """
    model = keras.Sequential([
        # Normalize pixel values to [0, 1]
        layers.Rescaling(1.0 / 255, input_shape=input_shape),

        # Block 1: 32 filters
        layers.Conv2D(32, (3, 3), activation="relu", padding="same"),
        layers.BatchNormalization(),
        layers.Conv2D(32, (3, 3), activation="relu", padding="same"),
        layers.MaxPooling2D((2, 2)),  # -> 25x25x32

        # Block 2: 64 filters
        layers.Conv2D(64, (3, 3), activation="relu", padding="same"),
        layers.BatchNormalization(),
        layers.Conv2D(64, (3, 3), activation="relu", padding="same"),
        layers.MaxPooling2D((2, 2)),  # -> 12x12x64

        # Block 3: 128 filters
        layers.Conv2D(128, (3, 3), activation="relu", padding="same"),
        layers.BatchNormalization(),
        layers.MaxPooling2D((2, 2)),  # -> 6x6x128

        # Classifier head
        layers.GlobalAveragePooling2D(),  # -> 128
        layers.Dense(128, activation="relu"),
        layers.Dropout(0.3),
        layers.Dense(num_classes, activation="softmax"),
    ])

    return model


if __name__ == "__main__":
    model = build_model()
    model.summary()
