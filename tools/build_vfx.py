"""Build a character's particle systems from its skin bin: emitter data + every texture/mesh they reference.

Usage: python tools/build_vfx.py <hashes_dir> <character> <out_dir> <DATA/FINAL dir>

Reads data/characters/<c>/skins/skin0.bin (and the bins it links), keeps the VfxSystemDefinitionData reachable
from the skin's ResourceResolver, and writes <out_dir>/systems.json ({effect key: system}) and spells.json.
Asset paths inside the systems are rewritten to the extracted file names (<stem>.png / <stem>.json).
Assets shared with other champions live in other WADs, so missing paths are looked up in every WAD under FINAL.
"""
import io
import json
import sys
from pathlib import Path

from PIL import Image

from extract_lol import Wad, tex_to_png
from extract_vfx import scb_to_mesh, sco_to_mesh
from read_bin import Names, read_bin

ASSET_EXT = (".tex", ".dds", ".scb", ".sco")


def read_linked(names, wads, path):
    todo, seen, entries = [path], set(), {}
    while todo:
        p = todo.pop().lower()
        if p in seen:
            continue
        seen.add(p)
        data = next((d for d in (w.read(p) for w in wads) if d is not None), None)
        if data is not None:
            b = read_bin(data, names)
            entries.update(b["entries"])
            todo += b["linked"]
    return entries


def collect_assets(v, out):
    if isinstance(v, str) and v.lower().endswith(ASSET_EXT):
        out.add(v)
    elif isinstance(v, dict):
        for x in v.values():
            collect_assets(x, out)
    elif isinstance(v, list):
        for x in v:
            collect_assets(x, out)


def rewrite(v, names):
    if isinstance(v, str) and v in names:
        return names[v]
    if isinstance(v, dict):
        return {k: rewrite(x, names) for k, x in v.items()}
    if isinstance(v, list):
        return [rewrite(x, names) for x in v]
    return v


def convert(path, data, out):
    stem = Path(path).stem.lower()
    if path.lower().endswith(".scb"):
        (out / f"{stem}.json").write_text(json.dumps(scb_to_mesh(data), separators=(",", ":")))
        return f"{stem}.json"
    if path.lower().endswith(".sco"):
        (out / f"{stem}.json").write_text(json.dumps(sco_to_mesh(data), separators=(",", ":")))
        return f"{stem}.json"
    img = tex_to_png(data) if data[:4] == b"TEX\0" else Image.open(io.BytesIO(data))
    img.save(out / f"{stem}.png")
    return f"{stem}.png"


def candidates(p):
    # bins sometimes still say .dds where the WAD ships the converted .tex (and vice versa)
    p = p.lower()
    alt = p[:-4] + (".tex" if p.endswith(".dds") else ".dds") if p.endswith((".dds", ".tex")) else None
    return [p] + ([alt] if alt else [])


def open_wad(path):
    try:
        return Wad(path)
    except (AssertionError, OSError):  # localized/empty stub WADs
        return None


def spell_data(entries):
    out = {}
    for k, e in entries.items():
        if e["__type"] != "SpellObject" or not e.get("mSpell"):
            continue
        s = e["mSpell"]
        spec = s.get("mMissileSpec") or {}
        move = spec.get("movementComponent") or {}
        out[k.split("/")[-1]] = {
            "speed": move.get("mSpeed") or s.get("missileSpeed"),
            "width": spec.get("mMissileWidth") or s.get("mLineWidth"),
            "range": (s.get("castRangeDisplayOverride") or s.get("castRange") or [None])[0],
            "castFrame": s.get("castFrame"),
            "animation": s.get("mAnimationName"),
        }
    return out


def main(hashes_dir, char, out_dir, final_dir):
    names = Names(hashes_dir)
    final = Path(final_dir)
    main_wad = Wad(final / "Champions" / f"{char.capitalize()}.wad.client")
    entries = read_linked(names, [main_wad], f"data/characters/{char}/skins/skin0.bin")
    resolver = next(e for e in entries.values() if e["__type"] == "ResourceResolver")
    systems = {k: entries[p] for k, p in resolver["resourceMap"].items()
               if entries.get(p, {}).get("__type") == "VfxSystemDefinitionData"}

    assets = set()
    collect_assets(systems, assets)
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    renamed, missing, other_wads = {}, [], None
    for a in sorted(assets):
        data = next((d for d in (main_wad.read(c) for c in candidates(a)) if d is not None), None)
        if data is None:
            if other_wads is None:  # opening ~400 WAD headers is slow-ish: only when needed
                other_wads = [w for w in map(open_wad, sorted(final.rglob("*.wad.client"))) if w]
            data = next((d for w in other_wads for c in candidates(a) if (d := w.read(c)) is not None), None)
        if data is None:
            missing.append(a)
            continue
        try:
            renamed[a] = convert(a, data, out)
        except Exception as e:  # odd formats are reported, not fatal
            missing.append(f"{a} ({e})")
    (out / "systems.json").write_text(json.dumps(rewrite(systems, renamed), separators=(",", ":")))
    (out / "spells.json").write_text(json.dumps(spell_data(entries), indent=1))
    print(f"{char}: {len(systems)} systems, {len(renamed)}/{len(assets)} assets")
    for m in missing:
        print(f"missing {m}")


if __name__ == "__main__":
    main(*sys.argv[1:])
