"""Download SVG piece sets from the Lichess lila repository."""

import urllib.request
import os
import sys
from pathlib import Path

# Add parent to path for config
sys.path.insert(0, str(Path(__file__).parent.parent))
from config import PIECE_SETS, PIECE_TYPES, PIECE_COLORS, PIECE_SETS_DIR

BASE_URL = (
    "https://raw.githubusercontent.com/lichess-org/lila"
    "/master/public/piece/{set_name}/{color}{piece}.svg"
)


def download_piece_sets(sets=None):
    """Download SVG piece sets from Lichess."""
    sets = sets or PIECE_SETS

    for set_name in sets:
        set_dir = PIECE_SETS_DIR / set_name
        set_dir.mkdir(parents=True, exist_ok=True)

        print(f"Downloading piece set: {set_name}")
        success = 0

        for color in PIECE_COLORS:
            for piece in PIECE_TYPES:
                filename = f"{color}{piece}.svg"
                filepath = set_dir / filename
                url = BASE_URL.format(
                    set_name=set_name, color=color, piece=piece
                )

                if filepath.exists():
                    success += 1
                    continue

                try:
                    urllib.request.urlretrieve(url, filepath)
                    success += 1
                except urllib.error.HTTPError as e:
                    print(f"  Failed to download {filename}: {e}")
                except Exception as e:
                    print(f"  Error downloading {filename}: {e}")

        print(f"  {success}/12 pieces downloaded")

    print("Done!")


if __name__ == "__main__":
    download_piece_sets()
