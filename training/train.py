"""Train the chess piece classifier CNN."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from config import (
    BATCH_SIZE,
    CHECKPOINTS_DIR,
    CLASS_NAMES,
    EPOCHS,
    LEARNING_RATE,
    TILE_SIZE,
    TILES_DIR,
    VALIDATION_SPLIT,
)
from model import build_model

import tensorflow as tf
from tensorflow import keras


def load_datasets():
    """Load training and validation datasets from tile directory structure."""
    train_ds = tf.keras.utils.image_dataset_from_directory(
        TILES_DIR,
        validation_split=VALIDATION_SPLIT,
        subset="training",
        seed=42,
        image_size=(TILE_SIZE, TILE_SIZE),
        batch_size=BATCH_SIZE,
        label_mode="categorical",
        class_names=CLASS_NAMES,
    )

    val_ds = tf.keras.utils.image_dataset_from_directory(
        TILES_DIR,
        validation_split=VALIDATION_SPLIT,
        subset="validation",
        seed=42,
        image_size=(TILE_SIZE, TILE_SIZE),
        batch_size=BATCH_SIZE,
        label_mode="categorical",
        class_names=CLASS_NAMES,
    )

    # Performance optimization
    train_ds = train_ds.prefetch(tf.data.AUTOTUNE)
    val_ds = val_ds.prefetch(tf.data.AUTOTUNE)

    return train_ds, val_ds


def train():
    """Train the model and save the best checkpoint."""
    CHECKPOINTS_DIR.mkdir(parents=True, exist_ok=True)

    print("Loading datasets...")
    train_ds, val_ds = load_datasets()

    print("Building model...")
    model = build_model()
    model.summary()

    model.compile(
        optimizer=keras.optimizers.Adam(learning_rate=LEARNING_RATE),
        loss="categorical_crossentropy",
        metrics=["accuracy"],
    )

    callbacks = [
        keras.callbacks.EarlyStopping(
            monitor="val_accuracy",
            patience=5,
            restore_best_weights=True,
        ),
        keras.callbacks.ReduceLROnPlateau(
            monitor="val_loss",
            factor=0.5,
            patience=3,
            min_lr=1e-6,
        ),
        keras.callbacks.ModelCheckpoint(
            str(CHECKPOINTS_DIR / "best.keras"),
            monitor="val_accuracy",
            save_best_only=True,
        ),
    ]

    print("Training...")
    history = model.fit(
        train_ds,
        validation_data=val_ds,
        epochs=EPOCHS,
        callbacks=callbacks,
    )

    # Final evaluation
    print("\nFinal evaluation on validation set:")
    loss, accuracy = model.evaluate(val_ds)
    print(f"  Loss: {loss:.4f}")
    print(f"  Accuracy: {accuracy:.4f}")

    # Save final model
    model.save(str(CHECKPOINTS_DIR / "final.keras"))
    print(f"\nModel saved to {CHECKPOINTS_DIR / 'final.keras'}")

    return model, history


if __name__ == "__main__":
    train()
