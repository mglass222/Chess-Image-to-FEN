"""Generate synthetic chess board images and slice into labeled tiles."""

import io
import random
import sys
from pathlib import Path

import chess
import numpy as np
from PIL import Image

try:
    import cairosvg
except ImportError:
    cairosvg = None

sys.path.insert(0, str(Path(__file__).parent))
from config import (
    BOARD_SIZE,
    BOARD_THEMES,
    CLASS_NAMES,
    DATA_DIR,
    ENDGAME_RATIO,
    NUM_BOARDS,
    PIECE_COLORS,
    PIECE_SETS,
    PIECE_SETS_DIR,
    PIECE_TYPES,
    RANDOM_GAME_RATIO,
    RANDOM_PLACEMENT_RATIO,
    TILE_SIZE,
    TILES_DIR,
)


def get_available_piece_sets():
    """Return list of piece set names that have been downloaded."""
    available = []
    for name in PIECE_SETS:
        set_dir = PIECE_SETS_DIR / name
        if set_dir.exists():
            # Check it has at least some pieces
            svgs = list(set_dir.glob("*.svg"))
            if len(svgs) >= 12:
                available.append(name)
    return available


def load_piece_svg(set_name, color, piece):
    """Load an SVG piece file as a string."""
    filepath = PIECE_SETS_DIR / set_name / f"{color}{piece}.svg"
    if filepath.exists():
        return filepath.read_text(encoding="utf-8")
    return None


def generate_random_game_position(max_moves=120):
    """Generate a position by playing random legal moves."""
    board = chess.Board()
    num_moves = random.randint(1, max_moves)
    for _ in range(num_moves):
        legal_moves = list(board.legal_moves)
        if not legal_moves:
            break
        board.push(random.choice(legal_moves))
    return board


def generate_random_placement():
    """Generate a random piece placement (may not be legal)."""
    board = chess.Board.empty()

    # Always place both kings
    squares = random.sample(range(64), 2)
    board.set_piece_at(squares[0], chess.Piece(chess.KING, chess.WHITE))
    board.set_piece_at(squares[1], chess.Piece(chess.KING, chess.BLACK))

    # Place 0-14 additional pieces
    num_extra = random.randint(0, 14)
    remaining_squares = [s for s in range(64) if s not in squares]
    extra_squares = random.sample(remaining_squares, min(num_extra, len(remaining_squares)))

    piece_types = [chess.PAWN, chess.KNIGHT, chess.BISHOP, chess.ROOK, chess.QUEEN]

    for sq in extra_squares:
        # Don't place pawns on rank 1 or 8
        rank = chess.square_rank(sq)
        if rank in (0, 7):
            pt = random.choice([chess.KNIGHT, chess.BISHOP, chess.ROOK, chess.QUEEN])
        else:
            pt = random.choice(piece_types)
        color = random.choice([chess.WHITE, chess.BLACK])
        board.set_piece_at(sq, chess.Piece(pt, color))

    return board


def generate_endgame_position():
    """Generate an endgame-like position with few pieces."""
    board = chess.Board.empty()

    squares = random.sample(range(64), 2)
    board.set_piece_at(squares[0], chess.Piece(chess.KING, chess.WHITE))
    board.set_piece_at(squares[1], chess.Piece(chess.KING, chess.BLACK))

    # 1-4 extra pieces
    num_extra = random.randint(1, 4)
    remaining = [s for s in range(64) if s not in squares]
    extra_squares = random.sample(remaining, min(num_extra, len(remaining)))

    for sq in extra_squares:
        rank = chess.square_rank(sq)
        if rank in (0, 7):
            pt = random.choice([chess.KNIGHT, chess.BISHOP, chess.ROOK, chess.QUEEN])
        else:
            pt = random.choice([chess.PAWN, chess.KNIGHT, chess.BISHOP, chess.ROOK, chess.QUEEN])
        color = random.choice([chess.WHITE, chess.BLACK])
        board.set_piece_at(sq, chess.Piece(pt, color))

    return board


def generate_positions(num_boards):
    """Generate a mix of board positions."""
    positions = []
    n_random_game = int(num_boards * RANDOM_GAME_RATIO)
    n_random_place = int(num_boards * RANDOM_PLACEMENT_RATIO)
    n_endgame = num_boards - n_random_game - n_random_place

    print(f"Generating {n_random_game} random game positions...")
    for _ in range(n_random_game):
        positions.append(generate_random_game_position())

    print(f"Generating {n_random_place} random placement positions...")
    for _ in range(n_random_place):
        positions.append(generate_random_placement())

    print(f"Generating {n_endgame} endgame positions...")
    for _ in range(n_endgame):
        positions.append(generate_endgame_position())

    random.shuffle(positions)
    return positions


def build_board_svg(board, piece_set, light_color, dark_color):
    """Build an SVG string for a chess board with the given piece set and colors."""
    sq_size = TILE_SIZE
    board_px = BOARD_SIZE

    svg_parts = [
        f'<svg xmlns="http://www.w3.org/2000/svg" '
        f'xmlns:xlink="http://www.w3.org/1999/xlink" '
        f'width="{board_px}" height="{board_px}" viewBox="0 0 {board_px} {board_px}">'
    ]

    # Draw squares
    for rank in range(8):
        for file in range(8):
            x = file * sq_size
            y = rank * sq_size
            is_light = (rank + file) % 2 == 0
            color = light_color if is_light else dark_color
            svg_parts.append(
                f'<rect x="{x}" y="{y}" width="{sq_size}" height="{sq_size}" fill="{color}"/>'
            )

    # Place pieces
    # SVG coordinates: (0,0) is top-left = a8 square
    for rank in range(8):
        for file in range(8):
            # rank 0 in SVG = rank 8 in chess (top of board)
            chess_square = chess.square(file, 7 - rank)
            piece = board.piece_at(chess_square)
            if piece is not None:
                color = "w" if piece.color == chess.WHITE else "b"
                piece_char = piece.symbol().upper()
                piece_svg = load_piece_svg(piece_set, color, piece_char)
                if piece_svg is not None:
                    x = file * sq_size
                    y = rank * sq_size
                    # Embed the piece SVG as an image
                    svg_path = PIECE_SETS_DIR / piece_set / f"{color}{piece_char}.svg"
                    svg_uri = svg_path.as_uri()
                    svg_parts.append(
                        f'<image x="{x}" y="{y}" width="{sq_size}" height="{sq_size}" '
                        f'href="{svg_uri}"/>'
                    )

    svg_parts.append("</svg>")
    return "\n".join(svg_parts)


def svg_to_png(svg_string):
    """Convert an SVG string to a PIL Image."""
    if cairosvg is None:
        raise ImportError("cairosvg is required. Install with: pip install cairosvg")

    png_data = cairosvg.svg2png(
        bytestring=svg_string.encode("utf-8"),
        output_width=BOARD_SIZE,
        output_height=BOARD_SIZE,
    )
    return Image.open(io.BytesIO(png_data)).convert("RGB")


def slice_board_to_tiles(board_image, board):
    """Slice a board image into 64 labeled tiles.

    Returns list of (tile_image, class_name) tuples.
    """
    tiles = []
    for rank in range(8):
        for file in range(8):
            x = file * TILE_SIZE
            y = rank * TILE_SIZE
            tile = board_image.crop((x, y, x + TILE_SIZE, y + TILE_SIZE))

            # Determine the label
            chess_square = chess.square(file, 7 - rank)
            piece = board.piece_at(chess_square)
            if piece is None:
                label = "empty"
            else:
                color = "w" if piece.color == chess.WHITE else "b"
                label = f"{color}{piece.symbol().upper()}"

            tiles.append((tile, label))
    return tiles


def apply_augmentation(image):
    """Apply light augmentation to a tile image."""
    img_array = np.array(image, dtype=np.float32)

    # Random brightness adjustment (+-10%)
    brightness = random.uniform(0.9, 1.1)
    img_array = np.clip(img_array * brightness, 0, 255)

    # Random contrast adjustment (+-10%)
    mean = img_array.mean()
    contrast = random.uniform(0.9, 1.1)
    img_array = np.clip((img_array - mean) * contrast + mean, 0, 255)

    return Image.fromarray(img_array.astype(np.uint8))


def save_tile(tile_image, label, index, augmented=False):
    """Save a tile image to the appropriate class directory."""
    class_dir = TILES_DIR / label
    class_dir.mkdir(parents=True, exist_ok=True)
    suffix = "_aug" if augmented else ""
    filepath = class_dir / f"tile_{index:07d}{suffix}.png"
    tile_image.save(filepath)


def generate_dataset(num_boards=None):
    """Main entry point: generate the full training dataset."""
    num_boards = num_boards or NUM_BOARDS

    # Check available piece sets
    available_sets = get_available_piece_sets()
    if not available_sets:
        print("No piece sets found! Run download_pieces.py first.")
        print("  python training/piece_sets/download_pieces.py")
        sys.exit(1)

    print(f"Found {len(available_sets)} piece sets: {', '.join(available_sets)}")

    # Create output directories
    for class_name in CLASS_NAMES:
        (TILES_DIR / class_name).mkdir(parents=True, exist_ok=True)

    # Generate positions
    positions = generate_positions(num_boards)

    tile_counter = 0
    for i, board in enumerate(positions):
        if (i + 1) % 100 == 0:
            print(f"Processing board {i + 1}/{num_boards}...")

        # Random piece set and color theme
        piece_set = random.choice(available_sets)
        light_color, dark_color = random.choice(BOARD_THEMES)

        # Build SVG and convert to PNG
        try:
            svg = build_board_svg(board, piece_set, light_color, dark_color)
            board_image = svg_to_png(svg)
        except Exception as e:
            print(f"  Error rendering board {i}: {e}")
            continue

        # Slice into tiles and save
        tiles = slice_board_to_tiles(board_image, board)
        for tile_image, label in tiles:
            save_tile(tile_image, label, tile_counter)

            # 30% chance of saving an augmented version
            if random.random() < 0.3:
                aug_tile = apply_augmentation(tile_image)
                save_tile(aug_tile, label, tile_counter, augmented=True)

            tile_counter += 1

    print(f"\nDone! Generated {tile_counter} tiles.")
    print(f"Output directory: {TILES_DIR}")

    # Print class distribution
    print("\nClass distribution:")
    for class_name in CLASS_NAMES:
        class_dir = TILES_DIR / class_name
        if class_dir.exists():
            count = len(list(class_dir.glob("*.png")))
            print(f"  {class_name}: {count}")


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="Generate chess training data")
    parser.add_argument(
        "-n", "--num-boards", type=int, default=NUM_BOARDS,
        help=f"Number of boards to generate (default: {NUM_BOARDS})"
    )
    args = parser.parse_args()

    generate_dataset(args.num_boards)
