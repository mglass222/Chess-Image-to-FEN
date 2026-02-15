"""Train the MobileNetV2 chess piece classifier (pure PyTorch)."""

import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from config import (
    BATCH_SIZE,
    CHECKPOINTS_DIR,
    CLASS_NAMES,
    EPOCHS,
    LEARNING_RATE,
    TILES_SYNTHETIC_DIR,
    TILES_CHESSCOM_DIR,
    VALIDATION_SPLIT,
)
from model import ChessPieceClassifier

import torch
import torch.nn as nn
from torch.utils.data import ConcatDataset, DataLoader, WeightedRandomSampler, random_split
from torchvision import transforms
from torchvision.datasets import ImageFolder


class ScaleTo255:
    """Scale [0, 1] float tensor back to [0, 255] range (picklable for Windows multiprocessing)."""
    def __call__(self, x):
        return x * 255.0


def build_transforms():
    """Build train and val transforms.

    Tiles are stored at 50x50 on disk. We resize to 224x224 and keep [0, 255]
    range since the model normalizes internally.
    """
    train_transform = transforms.Compose([
        transforms.Resize((224, 224)),
        transforms.ColorJitter(brightness=0.3, contrast=0.3, saturation=0.3, hue=0.05),
        transforms.RandomAdjustSharpness(sharpness_factor=2, p=0.3),
        transforms.PILToTensor(),
        transforms.ConvertImageDtype(torch.float32),
        ScaleTo255(),
    ])

    val_transform = transforms.Compose([
        transforms.Resize((224, 224)),
        transforms.PILToTensor(),
        transforms.ConvertImageDtype(torch.float32),
        ScaleTo255(),
    ])

    return train_transform, val_transform


class SubsetWithTransform(torch.utils.data.Dataset):
    """Wraps a Subset and overrides the transform of the underlying dataset."""

    def __init__(self, subset, transform):
        self.subset = subset
        self.transform = transform
        # Pre-resolve (path, label) for each index to work with ConcatDataset
        self._samples = []
        dataset = subset.dataset
        for i in subset.indices:
            if isinstance(dataset, ConcatDataset):
                # Walk ConcatDataset to find the right sub-dataset and local index
                offset = 0
                for ds in dataset.datasets:
                    if i < offset + len(ds):
                        path, label = ds.samples[i - offset]
                        break
                    offset += len(ds)
                else:
                    raise IndexError(f"Index {i} out of range for ConcatDataset")
            else:
                path, label = dataset.samples[i]
            self._samples.append((path, label))

    def __len__(self):
        return len(self._samples)

    def __getitem__(self, idx):
        path, label = self._samples[idx]
        from PIL import Image
        img = Image.open(path).convert("RGB")
        if self.transform:
            img = self.transform(img)
        return img, label


def _remap_imagefolder(dataset):
    """Remap ImageFolder labels from alphabetical order to CLASS_NAMES order."""
    folder_classes = dataset.classes  # alphabetical
    assert set(folder_classes) == set(CLASS_NAMES), (
        f"ImageFolder classes {folder_classes} != config {CLASS_NAMES}"
    )
    folder_to_config = {}
    for folder_idx, name in enumerate(folder_classes):
        folder_to_config[folder_idx] = CLASS_NAMES.index(name)
    dataset.samples = [
        (path, folder_to_config[label]) for path, label in dataset.samples
    ]
    dataset.targets = [s[1] for s in dataset.samples]
    dataset.classes = CLASS_NAMES
    dataset.class_to_idx = {name: idx for idx, name in enumerate(CLASS_NAMES)}


def load_datasets():
    """Load synthetic + chess.com tiles, combine with weighted sampling."""
    train_transform, val_transform = build_transforms()

    # Load both data sources
    synthetic_ds = ImageFolder(str(TILES_SYNTHETIC_DIR))
    chesscom_ds = ImageFolder(str(TILES_CHESSCOM_DIR))

    _remap_imagefolder(synthetic_ds)
    _remap_imagefolder(chesscom_ds)

    n_synthetic = len(synthetic_ds)
    n_chesscom = len(chesscom_ds)
    print(f"Data sources: {n_synthetic} synthetic, {n_chesscom} chess.com")

    # Concatenate into one dataset
    combined = ConcatDataset([synthetic_ds, chesscom_ds])
    n_total = len(combined)

    # Split into train/val
    n_val = int(n_total * VALIDATION_SPLIT)
    n_train = n_total - n_val

    generator = torch.Generator().manual_seed(42)
    train_subset, val_subset = random_split(combined, [n_train, n_val], generator=generator)

    train_dataset = SubsetWithTransform(train_subset, train_transform)
    val_dataset = SubsetWithTransform(val_subset, val_transform)

    print(f"Dataset: {n_total} total, {n_train} train, {n_val} val")

    # Build per-sample weights for WeightedRandomSampler (training only).
    # Samples from the smaller chess.com set get higher weight so both
    # sources contribute equally per epoch.
    sample_weights = []
    w_synthetic = 1.0 / n_synthetic
    w_chesscom = 1.0 / n_chesscom
    for idx in train_subset.indices:
        if idx < n_synthetic:
            sample_weights.append(w_synthetic)
        else:
            sample_weights.append(w_chesscom)

    sampler = WeightedRandomSampler(
        weights=sample_weights,
        num_samples=len(sample_weights),
        replacement=True,
    )

    train_loader = DataLoader(
        train_dataset,
        batch_size=BATCH_SIZE,
        sampler=sampler,
        num_workers=4,
        pin_memory=True,
        persistent_workers=True,
    )
    val_loader = DataLoader(
        val_dataset,
        batch_size=BATCH_SIZE,
        shuffle=False,
        num_workers=4,
        pin_memory=True,
        persistent_workers=True,
    )

    return train_loader, val_loader


def train():
    """Train the model and save the best checkpoint."""
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    print(f"Using device: {device}")
    if device.type == "cuda":
        print(f"  GPU: {torch.cuda.get_device_name(0)}")
        print(f"  VRAM: {torch.cuda.get_device_properties(0).total_memory / 1024**3:.1f} GB")

    CHECKPOINTS_DIR.mkdir(parents=True, exist_ok=True)

    print("\nLoading datasets...")
    train_loader, val_loader = load_datasets()

    print("\nBuilding model...")
    model = ChessPieceClassifier().to(device)
    total_params = sum(p.numel() for p in model.parameters())
    trainable_params = sum(p.numel() for p in model.parameters() if p.requires_grad)
    print(f"  Total parameters: {total_params:,}")
    print(f"  Trainable parameters: {trainable_params:,}")

    criterion = nn.CrossEntropyLoss()
    optimizer = torch.optim.Adam(model.parameters(), lr=LEARNING_RATE)
    scheduler = torch.optim.lr_scheduler.ReduceLROnPlateau(
        optimizer, mode="min", factor=0.5, patience=3, min_lr=1e-6
    )

    best_val_acc = 0.0
    patience_counter = 0
    patience = 5

    print(f"\nTraining for up to {EPOCHS} epochs (early stopping patience={patience})...")
    print(f"Batch size: {BATCH_SIZE}, LR: {LEARNING_RATE}\n")

    n_train_batches = len(train_loader)
    n_val_batches = len(val_loader)

    for epoch in range(EPOCHS):
        epoch_start = time.time()

        # ---- Training ----
        model.train()
        train_loss = 0.0
        train_correct = 0
        train_total = 0

        for batch_idx, (images, labels) in enumerate(train_loader):
            images, labels = images.to(device), labels.to(device)

            optimizer.zero_grad()
            outputs = model(images)
            loss = criterion(outputs, labels)
            loss.backward()
            optimizer.step()

            train_loss += loss.item() * images.size(0)
            _, predicted = outputs.max(1)
            train_total += labels.size(0)
            train_correct += predicted.eq(labels).sum().item()

            # Progress bar
            done = batch_idx + 1
            pct = done / n_train_batches
            bar_len = 40
            filled = int(bar_len * pct)
            bar = "=" * filled + "-" * (bar_len - filled)
            elapsed_so_far = time.time() - epoch_start
            eta = elapsed_so_far / pct - elapsed_so_far if pct > 0 else 0
            print(
                f"\rEpoch {epoch + 1}/{EPOCHS} [Train] [{bar}] "
                f"{done}/{n_train_batches} "
                f"({pct:.0%}) "
                f"ETA: {eta:.0f}s",
                end="", flush=True,
            )

        train_loss /= train_total
        train_acc = train_correct / train_total
        print()  # newline after train progress bar

        # ---- Validation ----
        model.eval()
        val_loss = 0.0
        val_correct = 0
        val_total = 0

        with torch.no_grad():
            for batch_idx, (images, labels) in enumerate(val_loader):
                images, labels = images.to(device), labels.to(device)
                outputs = model(images)
                loss = criterion(outputs, labels)

                val_loss += loss.item() * images.size(0)
                _, predicted = outputs.max(1)
                val_total += labels.size(0)
                val_correct += predicted.eq(labels).sum().item()

                done = batch_idx + 1
                pct = done / n_val_batches
                filled = int(bar_len * pct)
                bar = "=" * filled + "-" * (bar_len - filled)
                print(
                    f"\rEpoch {epoch + 1}/{EPOCHS} [Val]   [{bar}] "
                    f"{done}/{n_val_batches} "
                    f"({pct:.0%})",
                    end="", flush=True,
                )

        val_loss /= val_total
        val_acc = val_correct / val_total
        print()  # newline after val progress bar

        # Step scheduler
        scheduler.step(val_loss)
        current_lr = optimizer.param_groups[0]["lr"]

        elapsed = time.time() - epoch_start
        print(
            f"  Train Loss: {train_loss:.4f} Acc: {train_acc:.4f} | "
            f"Val Loss: {val_loss:.4f} Acc: {val_acc:.4f} | "
            f"LR: {current_lr:.1e} | {elapsed:.1f}s"
        )

        # Save best checkpoint
        if val_acc > best_val_acc:
            best_val_acc = val_acc
            patience_counter = 0
            checkpoint = {
                "epoch": epoch + 1,
                "model_state_dict": model.state_dict(),
                "optimizer_state_dict": optimizer.state_dict(),
                "val_acc": val_acc,
                "val_loss": val_loss,
            }
            torch.save(checkpoint, CHECKPOINTS_DIR / "best.pt")
            print(f"  -> Saved best checkpoint (val_acc={val_acc:.4f})")
        else:
            patience_counter += 1
            if patience_counter >= patience:
                print(f"\nEarly stopping after {epoch + 1} epochs (no improvement for {patience} epochs)")
                break

    # Load and report best model
    best_ckpt = torch.load(CHECKPOINTS_DIR / "best.pt", weights_only=False)
    print(f"\nBest model: epoch {best_ckpt['epoch']}, val_acc={best_ckpt['val_acc']:.4f}")
    print(f"Checkpoint saved to: {CHECKPOINTS_DIR / 'best.pt'}")

    return model


if __name__ == "__main__":
    train()
