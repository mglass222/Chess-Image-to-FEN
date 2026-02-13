"""Generate training tiles: individual pieces on square backgrounds.

For each piece set and board theme, render every piece on both light and dark
squares.  Also generate empty square tiles.  No full-board rendering needed --
the classifier just needs to learn what each piece looks like on a coloured
background.
"""

import io
import sys
from pathlib import Path

from PIL import Image
from svglib.svglib import svg2rlg
from reportlab.graphics import renderPM

sys.path.insert(0, str(Path(__file__).parent))
from config import (
    BOARD_THEMES,
    CLASS_NAMES,
    PIECE_COLORS,
    PIECE_SETS,
    PIECE_SETS_DIR,
    PIECE_TYPES,
    TILE_SIZE,
    TILES_DIR,
)

# Cache SVG drawings so we only parse each SVG once
_svg_cache = {}


# ---------------------------------------------------------------------------
# Piece SVG loading
# ---------------------------------------------------------------------------

def get_available_piece_sets():
    """Return list of piece set names that have been downloaded.

    Skips sets whose SVGs use gradients, which svglib cannot render.
    """
    available = []
    for name in PIECE_SETS:
        set_dir = PIECE_SETS_DIR / name
        if not set_dir.exists():
            continue
        svgs = list(set_dir.glob("*.svg"))
        if len(svgs) < 12:
            continue
        # Skip sets with gradients (svglib renders them incorrectly)
        has_gradient = any(
            "Gradient" in svg.read_text(encoding="utf-8", errors="ignore")
            for svg in svgs
        )
        if has_gradient:
            continue
        available.append(name)
    return available


def _get_svg_drawing(set_name, color, piece):
    """Parse and cache an SVG drawing, scaled to TILE_SIZE."""
    cache_key = (set_name, color, piece)
    if cache_key in _svg_cache:
        return _svg_cache[cache_key]

    filepath = PIECE_SETS_DIR / set_name / f"{color}{piece}.svg"
    if not filepath.exists():
        return None

    try:
        drawing = svg2rlg(str(filepath))
        if drawing is None:
            return None

        sx = TILE_SIZE / drawing.width
        sy = TILE_SIZE / drawing.height
        drawing.width = TILE_SIZE
        drawing.height = TILE_SIZE
        drawing.scale(sx, sy)

        _svg_cache[cache_key] = drawing
        return drawing
    except Exception as e:
        print(f"  Warning: could not parse {filepath.name}: {e}")
        return None


def render_piece_on_bg(drawing, bg_hex):
    """Render a piece SVG drawing onto a coloured background, return RGB PIL Image."""
    from copy import deepcopy
    d = deepcopy(drawing)

    bg_int = int(bg_hex.lstrip("#"), 16)
    png_data = renderPM.drawToString(d, fmt="PNG", bg=bg_int)
    img = Image.open(io.BytesIO(png_data)).convert("RGB")
    img = img.resize((TILE_SIZE, TILE_SIZE), Image.LANCZOS)
    return img


def make_empty_square(bg_hex):
    """Create a solid-colour TILE_SIZE x TILE_SIZE RGB image."""
    return Image.new("RGB", (TILE_SIZE, TILE_SIZE), bg_hex)


# ---------------------------------------------------------------------------
# Tile saving
# ---------------------------------------------------------------------------

def save_tile(tile_image, label, index):
    """Save a tile image to the appropriate class directory."""
    class_dir = TILES_DIR / label
    class_dir.mkdir(parents=True, exist_ok=True)
    filepath = class_dir / f"tile_{index:07d}.png"
    tile_image.save(filepath)


# ---------------------------------------------------------------------------
# Real board processing
# ---------------------------------------------------------------------------

REAL_BOARDS_DIR = Path(__file__).parent / "real_boards"

_STARTING_LABELS = [
    ["bR", "bN", "bB", "bQ", "bK", "bB", "bN", "bR"],
    ["bP", "bP", "bP", "bP", "bP", "bP", "bP", "bP"],
    ["empty"] * 8,
    ["empty"] * 8,
    ["empty"] * 8,
    ["empty"] * 8,
    ["wP", "wP", "wP", "wP", "wP", "wP", "wP", "wP"],
    ["wR", "wN", "wB", "wQ", "wK", "wB", "wN", "wR"],
]


def process_real_boards(tile_counter):
    """Slice real board screenshots into labelled tiles (starting position)."""
    if not REAL_BOARDS_DIR.exists():
        return tile_counter

    images = list(REAL_BOARDS_DIR.glob("*.png")) + list(REAL_BOARDS_DIR.glob("*.jpg"))
    if not images:
        return tile_counter

    board_size = TILE_SIZE * 8
    print(f"\nProcessing {len(images)} real board screenshots...")
    for img_path in images:
        try:
            img = Image.open(img_path).convert("RGB")
            img = img.resize((board_size, board_size), Image.LANCZOS)

            for rank in range(8):
                for file in range(8):
                    x = file * TILE_SIZE
                    y = rank * TILE_SIZE
                    tile = img.crop((x, y, x + TILE_SIZE, y + TILE_SIZE))
                    label = _STARTING_LABELS[rank][file]
                    save_tile(tile, label, tile_counter)
                    tile_counter += 1

            print(f"  Sliced {img_path.name}")
        except Exception as e:
            print(f"  Error processing {img_path.name}: {e}")

    return tile_counter


# ---------------------------------------------------------------------------
# Main dataset generation
# ---------------------------------------------------------------------------

def generate_dataset():
    """Generate training tiles: every piece x piece set x background colour."""
    available_sets = get_available_piece_sets()
    if not available_sets:
        print("No piece sets found! Run download_pieces.py first.")
        print("  python training/piece_sets/download_pieces.py")
        sys.exit(1)

    print(f"Found {len(available_sets)} piece sets: {', '.join(available_sets)}")

    # Parse all piece SVGs
    print("Parsing piece SVGs...")
    for s in available_sets:
        for color in PIECE_COLORS:
            for piece in PIECE_TYPES:
                _get_svg_drawing(s, color, piece)
    print(f"  Cached {len(_svg_cache)} SVG drawings")

    # Create output directories
    for class_name in CLASS_NAMES:
        (TILES_DIR / class_name).mkdir(parents=True, exist_ok=True)

    # Background colours: light and dark square from each theme
    bg_colors = []
    for light, dark in BOARD_THEMES:
        bg_colors.append(light)
        bg_colors.append(dark)

    print(f"  {len(bg_colors)} background colours")

    tile_counter = 0

    # --- Piece tiles ---
    total_piece_combos = len(available_sets) * 12 * len(bg_colors)
    print(f"\nGenerating {total_piece_combos} piece tiles...")

    for set_name in available_sets:
        for color in PIECE_COLORS:
            for piece in PIECE_TYPES:
                drawing = _get_svg_drawing(set_name, color, piece)
                if drawing is None:
                    continue
                label = f"{color}{piece}"
                for bg in bg_colors:
                    tile = render_piece_on_bg(drawing, bg)
                    save_tile(tile, label, tile_counter)
                    tile_counter += 1

    print(f"  Saved {tile_counter} piece tiles")

    # --- Empty tiles ---
    empty_before = tile_counter
    for bg in bg_colors:
        square = make_empty_square(bg)
        save_tile(square, "empty", tile_counter)
        tile_counter += 1

    print(f"  Saved {tile_counter - empty_before} empty tiles")

    # --- Summary ---
    print(f"\nDone! Generated {tile_counter} tiles total.")
    print(f"Output directory: {TILES_DIR}")
    print("\nClass distribution:")
    for class_name in CLASS_NAMES:
        class_dir = TILES_DIR / class_name
        if class_dir.exists():
            count = len(list(class_dir.glob("*.png")))
            print(f"  {class_name}: {count}")


if __name__ == "__main__":
    generate_dataset()
