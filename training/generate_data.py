"""Generate synthetic chess board images and slice into labeled tiles.

Uses Pillow for board composition and svglib+reportlab for SVG piece rasterization.
No native Cairo dependency required.
"""

import io
import random
import sys
from pathlib import Path

import chess
import numpy as np
from PIL import Image, ImageDraw
from svglib.svglib import svg2rlg
from reportlab.graphics import renderPM

sys.path.insert(0, str(Path(__file__).parent))
from config import (
    BOARD_SIZE,
    BOARD_THEMES,
    CLASS_NAMES,
    ENDGAME_RATIO,
    NUM_BOARDS,
    PIECE_SETS,
    PIECE_SETS_DIR,
    RANDOM_GAME_RATIO,
    RANDOM_PLACEMENT_RATIO,
    TILE_SIZE,
    TILES_DIR,
)

# Cache for rasterized piece images: (set_name, color, piece) -> PIL.Image (RGBA)
_piece_cache = {}


def get_available_piece_sets():
    """Return list of piece set names that have been downloaded."""
    available = []
    for name in PIECE_SETS:
        set_dir = PIECE_SETS_DIR / name
        if set_dir.exists():
            svgs = list(set_dir.glob("*.svg"))
            if len(svgs) >= 12:
                available.append(name)
    return available


def load_piece_image(set_name, color, piece):
    """Load a piece SVG and rasterize to a TILE_SIZE x TILE_SIZE RGBA PIL Image."""
    cache_key = (set_name, color, piece)
    if cache_key in _piece_cache:
        return _piece_cache[cache_key]

    filepath = PIECE_SETS_DIR / set_name / f"{color}{piece}.svg"
    if not filepath.exists():
        return None

    try:
        drawing = svg2rlg(str(filepath))
        if drawing is None:
            return None

        # Scale to tile size
        sx = TILE_SIZE / drawing.width
        sy = TILE_SIZE / drawing.height
        drawing.width = TILE_SIZE
        drawing.height = TILE_SIZE
        drawing.scale(sx, sy)

        # Render to PNG bytes
        png_data = renderPM.drawToString(drawing, fmt="PNG")
        img = Image.open(io.BytesIO(png_data)).convert("RGBA")
        img = img.resize((TILE_SIZE, TILE_SIZE), Image.LANCZOS)

        _piece_cache[cache_key] = img
        return img
    except Exception as e:
        print(f"  Warning: could not rasterize {filepath.name}: {e}")
        return None


def preload_piece_set(set_name):
    """Pre-rasterize all pieces in a set to warm the cache."""
    for color in ("w", "b"):
        for piece in ("P", "N", "B", "R", "Q", "K"):
            load_piece_image(set_name, color, piece)


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

    squares = random.sample(range(64), 2)
    board.set_piece_at(squares[0], chess.Piece(chess.KING, chess.WHITE))
    board.set_piece_at(squares[1], chess.Piece(chess.KING, chess.BLACK))

    num_extra = random.randint(0, 14)
    remaining_squares = [s for s in range(64) if s not in squares]
    extra_squares = random.sample(
        remaining_squares, min(num_extra, len(remaining_squares))
    )

    piece_types = [chess.PAWN, chess.KNIGHT, chess.BISHOP, chess.ROOK, chess.QUEEN]

    for sq in extra_squares:
        rank = chess.square_rank(sq)
        if rank in (0, 7):
            pt = random.choice(
                [chess.KNIGHT, chess.BISHOP, chess.ROOK, chess.QUEEN]
            )
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

    num_extra = random.randint(1, 4)
    remaining = [s for s in range(64) if s not in squares]
    extra_squares = random.sample(remaining, min(num_extra, len(remaining)))

    for sq in extra_squares:
        rank = chess.square_rank(sq)
        if rank in (0, 7):
            pt = random.choice(
                [chess.KNIGHT, chess.BISHOP, chess.ROOK, chess.QUEEN]
            )
        else:
            pt = random.choice(
                [chess.PAWN, chess.KNIGHT, chess.BISHOP, chess.ROOK, chess.QUEEN]
            )
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


def render_board(board, piece_set, light_color, dark_color):
    """Render a chess board as a PIL Image using Pillow compositing."""
    img = Image.new("RGB", (BOARD_SIZE, BOARD_SIZE))
    draw = ImageDraw.Draw(img)

    # Draw squares
    for rank in range(8):
        for file in range(8):
            x = file * TILE_SIZE
            y = rank * TILE_SIZE
            is_light = (rank + file) % 2 == 0
            color = light_color if is_light else dark_color
            draw.rectangle([x, y, x + TILE_SIZE - 1, y + TILE_SIZE - 1], fill=color)

    # Place pieces
    for rank in range(8):
        for file in range(8):
            chess_square = chess.square(file, 7 - rank)
            piece = board.piece_at(chess_square)
            if piece is not None:
                pc = "w" if piece.color == chess.WHITE else "b"
                piece_char = piece.symbol().upper()
                piece_img = load_piece_image(piece_set, pc, piece_char)
                if piece_img is not None:
                    x = file * TILE_SIZE
                    y = rank * TILE_SIZE
                    # Paste with alpha mask for transparency
                    img.paste(piece_img, (x, y), piece_img)

    return img


def slice_board_to_tiles(board_image, board):
    """Slice a board image into 64 labeled tiles."""
    tiles = []
    for rank in range(8):
        for file in range(8):
            x = file * TILE_SIZE
            y = rank * TILE_SIZE
            tile = board_image.crop((x, y, x + TILE_SIZE, y + TILE_SIZE))

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

    brightness = random.uniform(0.9, 1.1)
    img_array = np.clip(img_array * brightness, 0, 255)

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

    available_sets = get_available_piece_sets()
    if not available_sets:
        print("No piece sets found! Run download_pieces.py first.")
        print("  python training/piece_sets/download_pieces.py")
        sys.exit(1)

    print(f"Found {len(available_sets)} piece sets: {', '.join(available_sets)}")

    # Preload all piece sets
    print("Pre-rasterizing piece SVGs...")
    for s in available_sets:
        preload_piece_set(s)
    print(f"  Cached {len(_piece_cache)} piece images")

    # Create output directories
    for class_name in CLASS_NAMES:
        (TILES_DIR / class_name).mkdir(parents=True, exist_ok=True)

    # Generate positions
    positions = generate_positions(num_boards)

    tile_counter = 0
    for i, board in enumerate(positions):
        if (i + 1) % 500 == 0:
            print(f"Processing board {i + 1}/{num_boards}...")

        piece_set = random.choice(available_sets)
        light_color, dark_color = random.choice(BOARD_THEMES)

        try:
            board_image = render_board(board, piece_set, light_color, dark_color)
        except Exception as e:
            print(f"  Error rendering board {i}: {e}")
            continue

        tiles = slice_board_to_tiles(board_image, board)
        for tile_image, label in tiles:
            save_tile(tile_image, label, tile_counter)

            if random.random() < 0.3:
                aug_tile = apply_augmentation(tile_image)
                save_tile(aug_tile, label, tile_counter, augmented=True)

            tile_counter += 1

    print(f"\nDone! Generated {tile_counter} tiles.")
    print(f"Output directory: {TILES_DIR}")

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
        help=f"Number of boards to generate (default: {NUM_BOARDS})",
    )
    args = parser.parse_args()

    generate_dataset(args.num_boards)
