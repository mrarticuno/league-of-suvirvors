"""Build the runtime map assets from a local League of Legends install.

Usage: python tools/build_map.py textures <hashes.txt> <out_dir> <wad.client>...

Writes <out_dir>/tex/<name>.png for every entry of TEXTURE_MAP (the names the map
renderer loads). The SR terrain textures are 2048px whole-map paint atlases, so each
entry carries a crop box: (x, y, side) in source pixels of a tileable patch.
"""
import io
import sys
from pathlib import Path

from PIL import Image

sys.path.insert(0, str(Path(__file__).parent))  # reuse the WAD reader + .tex decoder
from extract_lol import Wad, tex_to_png

SRX = "assets/maps/kitpieces/srx/base/textures/"
SR = "assets/maps/kitpieces/summoners_rift/textures/"

# canonical name -> (source path inside the WAD, crop box)
TEXTURE_MAP = {
    "ground_jungle": (SRX + "terrain_botlane_ground_b.tex", (620, 180, 400)),  # grass field
    "ground_river": (SRX + "terrain_botlane_ground_b.tex", (1250, 1000, 400)),  # grass + bank stones
    "ground_lane": (SRX + "terrain_botlane_ground_a.tex", (600, 1330, 400)),  # flagstone path
    "ground_base": (SRX + "terrain_base_north_ground_a.tex", (1350, 780, 420)),  # plaza pavement
    "water": (SR + "grnd_terrain_s.tex", (1150, 420, 400)),  # open river
}


def extract_textures(hashes_file, out_dir, *wad_paths):
    # the hash list is the only local name table: use it to catch typos in TEXTURE_MAP
    wanted = {src for src, _ in TEXTURE_MAP.values()}
    listed = set()
    with open(hashes_file) as f:
        for line in f:
            path = line.split(" ", 1)[1].strip()
            if path in wanted:
                listed.add(path)

    wads = [Wad(w) for w in wad_paths]
    images = {}
    missing = []
    for name, (src, (x, y, side)) in TEXTURE_MAP.items():
        data = next((d for d in (w.read(src) for w in wads) if d is not None), None)
        if data is None:
            missing.append(src if src not in listed else f"{src} (listed but absent from the WADs)")
            continue
        img = tex_to_png(data) if src.endswith(".tex") else Image.open(io.BytesIO(data))
        if x + side > img.width or y + side > img.height:  # else PIL pads with black bars
            missing.append(f"{src}: crop box {x},{y},{side} outside {img.width}x{img.height}")
            continue
        images[name] = img.convert("RGBA").crop((x, y, x + side, y + side))
    if missing:
        for m in dict.fromkeys(missing):  # two names can share one source
            print(f"warning: {m}", file=sys.stderr)
        sys.exit(1)  # no partial output: every canonical name must exist

    out = Path(out_dir) / "tex"
    out.mkdir(parents=True, exist_ok=True)
    for name, img in images.items():
        img.save(out / f"{name}.png")
        print(f"{name}.png {img.width}x{img.height}")


def main(cmd, *args):
    if cmd != "textures" or len(args) < 3:
        sys.exit(f"usage: {sys.argv[0]} textures <hashes.txt> <out_dir> <wad.client>...")
    extract_textures(*args)


if __name__ == "__main__":
    main(*sys.argv[1:])
