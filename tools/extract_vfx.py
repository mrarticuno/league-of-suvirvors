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


def skn_to_mesh(data):
    # skinned mesh (particle balls, swords): drawn static in its bind pose
    magic, major, _minor = struct.unpack_from("<IHH", data, 0)
    assert magic == 0x00112233, "not an SKN"
    o = 8
    if major > 0:
        n = struct.unpack_from("<I", data, o)[0]
        o += 4 + n * 80  # name[64] + 4 u32
    if major >= 4:
        o += 4  # flags
    ni, nv = struct.unpack_from("<II", data, o)
    o += 8
    size, vtype = 52, 0
    if major >= 4:
        size, vtype = struct.unpack_from("<II", data, o)
        o += 8 + 40  # bounding box + sphere
    idx = struct.unpack_from(f"<{ni}H", data, o)
    o += 2 * ni
    verts = [(struct.unpack_from("<3f", data, o + size * i), struct.unpack_from("<2f", data, o + size * i + 44)) for i in range(nv)]
    pos, uv = [], []
    for i in idx:
        pos += verts[i][0]
        uv += verts[i][1]
    return {"pos": pos, "uv": uv}


def skl_bones(data):
    """Bind-pose position of each joint of a (new format) .skl, by name: where child particles spawn."""
    assert struct.unpack_from("<I", data, 4)[0] == 0x22FD4FC3, "not a new-format SKL"
    count = struct.unpack_from("<H", data, 14)[0]
    joints = struct.unpack_from("<i", data, 20)[0]
    out = {}
    for i in range(count):
        o = joints + 100 * i
        t = struct.unpack_from("<3f", data, o + 56)
        sc = struct.unpack_from("<3f", data, o + 68)
        x, y, z, w = struct.unpack_from("<4f", data, o + 80)
        name_at = o + 96 + struct.unpack_from("<i", data, o + 96)[0]
        name = data[name_at:data.index(b"\0", name_at)].decode()
        # world position = inverse of the inverse bind matrix (T R S) applied to the origin: S^-1 R^-1 (-t)
        v = (-t[0], -t[1], -t[2])
        qx, qy, qz = -x, -y, -z  # conjugate
        cx = qy * v[2] - qz * v[1] + w * v[0]
        cy = qz * v[0] - qx * v[2] + w * v[1]
        cz = qx * v[1] - qy * v[0] + w * v[2]
        r = (v[0] + 2 * (qy * cz - qz * cy), v[1] + 2 * (qz * cx - qx * cz), v[2] + 2 * (qx * cy - qy * cx))
        out[name] = [round(r[k] / (sc[k] or 1), 3) for k in range(3)]
    return out


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
