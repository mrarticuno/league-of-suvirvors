"""Extract a character's base-skin particle textures and meshes from a local League of Legends install.

Usage: python tools/extract_vfx.py <hashes.txt> <character> <out_dir> <wad.client>...

Textures (.tex/.dds) become PNG; static meshes (.scb binary, .sco text) become JSON
({"pos": [...], "uv": [...]}, non-indexed because League stores UVs per face corner).
Chroma variants (".<skin>.dds" etc.) are skipped.
"""
import io
import json
import struct
import sys
from pathlib import Path

from PIL import Image

from extract_lol import Wad, tex_to_png


def particle_paths(hashes_file, char):
    prefix = f"assets/characters/{char}/skins/base/particles/"
    with open(hashes_file) as f:
        for line in f:
            p = line.split(" ", 1)[1].strip()
            name = Path(p).name
            if p.startswith(prefix) and not name.startswith(("2x_", "4x_")) and name.count(".") == 1 and \
                    p.endswith((".tex", ".dds", ".scb", ".sco")):
                yield p


def scb_to_mesh(data):
    # r3d2Mesh: u16 major, u16 minor, name[128], u32 verts, u32 faces, u32 flags, bbox (6 floats)
    assert data[:8] == b"r3d2Mesh", "not an SCB"
    major, minor = struct.unpack_from("<HH", data, 8)
    o = 12 + 128
    nv, nf, _flags = struct.unpack_from("<III", data, o)
    o += 12 + 24
    colors = False
    if major == 3 and minor == 2:
        colors = struct.unpack_from("<I", data, o)[0] == 1
        o += 4
    verts = [struct.unpack_from("<3f", data, o + 12 * i) for i in range(nv)]
    o += 12 * nv + (4 * nv if colors else 0) + 12  # + central point
    pos, uv = [], []
    for _ in range(nf):
        idx = struct.unpack_from("<3I", data, o)
        us_vs = struct.unpack_from("<6f", data, o + 12 + 64)  # u0 u1 u2 v0 v1 v2
        o += 12 + 64 + 24
        for k in range(3):
            pos += verts[idx[k]]
            uv += (us_vs[k], us_vs[3 + k])
    return {"pos": pos, "uv": uv}


def sco_to_mesh(data):
    lines = [l.strip() for l in data.decode("latin-1").splitlines()]
    i = next(i for i, l in enumerate(lines) if l.startswith("Verts="))
    nv = int(lines[i].split("=")[1])
    verts = [tuple(map(float, lines[i + 1 + k].split())) for k in range(nv)]
    j = next(j for j, l in enumerate(lines) if l.startswith("Faces="))
    pos, uv = [], []
    for l in lines[j + 1:j + 1 + int(lines[j].split("=")[1])]:
        t = l.split()  # 3 i0 i1 i2 material u0 v0 u1 v1 u2 v2
        for k in range(3):
            pos += verts[int(t[1 + k])]
            uv += (float(t[5 + 2 * k]), float(t[6 + 2 * k]))
    return {"pos": pos, "uv": uv}


def main(hashes_file, char, out_dir, *wad_paths):
    wads = [Wad(w) for w in wad_paths]
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    found = 0
    for p in sorted(set(particle_paths(hashes_file, char))):
        data = next((d for d in (w.read(p) for w in wads) if d is not None), None)
        if data is None:
            continue
        stem = Path(p).stem
        try:
            if p.endswith(".tex"):
                tex_to_png(data).save(out / f"{stem}.png")
            elif p.endswith(".dds"):
                if not (out / f"{stem}.png").exists():  # prefer the .tex version when both exist
                    Image.open(io.BytesIO(data)).save(out / f"{stem}.png")
            else:
                mesh = scb_to_mesh(data) if p.endswith(".scb") else sco_to_mesh(data)
                (out / f"{stem}.json").write_text(json.dumps(mesh, separators=(",", ":")))
            found += 1
        except Exception as e:  # odd formats (e.g. unsupported DDS variants) are skipped, not fatal
            print(f"skip {p}: {e}")
    print(f"{char}: {found} vfx files")


if __name__ == "__main__":
    main(*sys.argv[1:])
