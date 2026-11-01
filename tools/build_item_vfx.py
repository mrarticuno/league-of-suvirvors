"""Build the item procs' particle systems from the client's item bin (Global.wad.client, path "items").

Usage: python tools/build_item_vfx.py <hashes_dir> <out_dir> <DATA/FINAL dir> <item id>...

Keeps the VfxSystemDefinitionData named Items/<id>/Particles/<key> of each item and writes <out_dir>/systems.json
({key: system}, e.g. "6655_Hit_Tar") with every texture/mesh they reference. Asset files are prefixed "item_" so they
never clash with a champion's files of the same name (both stay loaded at once).
"""
import json
import sys
from pathlib import Path

from build_vfx import candidates, collect_assets, convert, open_wad, rewrite
from extract_lol import Wad
from read_bin import Names, read_bin


def main(hashes_dir, out_dir, final_dir, *items):
    final = Path(final_dir)
    wad = Wad(final / "Global.wad.client")
    entries = read_bin(wad.read("items"), Names(hashes_dir))["entries"]
    systems = {k.split("/")[-1]: v for k, v in entries.items()
               if v["__type"] == "VfxSystemDefinitionData" and k.split("/")[1] in items and "/Particles/" in k}

    assets = set()
    collect_assets(systems, assets)
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    renamed, missing, other_wads = {}, [], None
    for a in sorted(assets):
        data = next((d for d in (wad.read(c) for c in candidates(a)) if d is not None), None)
        if data is None:
            if other_wads is None:  # shared textures (e.g. a dragon's) live in other WADs
                other_wads = [w for w in map(open_wad, sorted(final.rglob("*.wad.client"))) if w]
            data = next((d for w in other_wads for c in candidates(a) if (d := w.read(c)) is not None), None)
        if data is None:
            missing.append(a)
            continue
        try:
            name = convert(a, data, out)
        except Exception as e:  # odd formats are reported, not fatal
            missing.append(f"{a} ({e})")
            continue
        (out / name).replace(out / f"item_{name}")
        renamed[a] = f"item_{name}"
    (out / "systems.json").write_text(json.dumps(rewrite(systems, renamed), separators=(",", ":")))
    print(f"items {' '.join(items)}: {len(systems)} systems, {len(renamed)}/{len(assets)} assets")
    for m in missing:
        print(f"missing {m}")


if __name__ == "__main__":
    main(*sys.argv[1:])
