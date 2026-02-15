"""Centralized configuration for the training pipeline."""

from pathlib import Path

# Paths
ROOT_DIR = Path(__file__).parent
PIECE_SETS_DIR = ROOT_DIR / "piece_sets"
DATA_DIR = ROOT_DIR / "data"
TILES_SYNTHETIC_DIR = DATA_DIR / "tiles_synthetic"
TILES_CHESSCOM_DIR = DATA_DIR / "tiles_chesscom"
CHECKPOINTS_DIR = ROOT_DIR / "checkpoints"
TFJS_MODEL_DIR = ROOT_DIR.parent / "docs" / "model"

# Image settings
BOARD_SIZE = 400  # Full board render size in pixels
TILE_SIZE = 50    # Individual square size (BOARD_SIZE / 8)

# Class labels (13 classes)
CLASS_NAMES = [
    "empty",
    "wP", "wN", "wB", "wR", "wQ", "wK",
    "bP", "bN", "bB", "bR", "bQ", "bK",
]
NUM_CLASSES = len(CLASS_NAMES)

# Piece set names to download from Lichess (all 40 available sets)
PIECE_SETS = [
    "alpha",
    "anarcandy",
    "caliente",
    "california",
    "cardinal",
    "cburnett",
    "celtic",
    "chess7",
    "chessnut",
    "companion",
    "cooke",
    "disguised",
    "dubrovny",
    "fantasy",
    "firi",
    "fresca",
    "gioco",
    "governor",
    "horsey",
    "icpieces",
    "kiwen-suwi",
    "kosal",
    "leipzig",
    "letter",
    "maestro",
    "merida",
    "mpchess",
    "pirouetti",
    "pixel",
    "reillycraig",
    "rhosgfx",
    "riohacha",
    "shahi-ivory-brown",
    "shapes",
    "spatial",
    "staunty",
    "tatiana",
    "xkcd",
]

# Piece file naming: color + piece type
PIECE_TYPES = ["P", "N", "B", "R", "Q", "K"]
PIECE_COLORS = ["w", "b"]

# Board color themes: (light_square, dark_square)
BOARD_THEMES = [
    ("#eeeed2", "#769656"),  # chess.com green
    ("#f0d9b5", "#b58863"),  # chess.com / lichess brown
    ("#dee3e6", "#8ca2ad"),  # lichess blue
    ("#e8e9b7", "#b7c0d4"),  # lichess purple
    ("#efefef", "#8b8b8b"),  # gray
    ("#e0e0e0", "#a0a0b0"),  # ice
    ("#f5f5dc", "#6b8e23"),  # olive
    ("#fce4ec", "#c62828"),  # red
    ("#e8eaf6", "#3f51b5"),  # indigo
    ("#fff8e1", "#ff8f00"),  # amber
]

# Training settings
BATCH_SIZE = 96
EPOCHS = 30
LEARNING_RATE = 1e-4
VALIDATION_SPLIT = 0.15
