"""Build the runtime map assets from a local League of Legends install.

Usage: python tools/build_map.py textures <hashes.txt> <out_dir> <wad.client>...
       python tools/build_map.py pieces <hashes.txt> <out_dir> <wad.client>...

Writes <out_dir>/tex/<name>.png for every entry of TEXTURE_MAP (the names the map
renderer loads). The SR terrain textures are 2048px whole-map paint atlases, so each
entry carries a crop box: (x, y, side) in source pixels of a tileable patch.

`pieces` writes <out_dir>/pieces/rock_{a,b,c}.glb + .png: the three biggest map
geometry sections whose material name says rock/cliff/wall, as unit-size meshes
(position + UV, unlit material) for the streamed world's scenery.
"""
import io
import json
import re
import struct
import sys
from pathlib import Path

import pygltflib
from PIL import Image

sys.path.insert(0, str(Path(__file__).parent))  # reuse the WAD reader + .tex decoder
from extract_lol import Wad, tex_to_png
from read_bin import Names, read_bin

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


MAPGEO = "data/maps/mapgeometry/map11/base.mapgeo"
MATERIALS = "data/maps/mapgeometry/map11/base.materials.bin"
PIECES = ("rock_a", "rock_b", "rock_c")
ROCKY = re.compile(r"rock|cliff|wall", re.I)
PROPERTY_BYTES = {1: 8, 2: 12, 4: 4}  # vertex property formats: Float2, Float3, Color32BGRA


def parse_mapgeo(d):
    """Split a version-14 .mapgeo into (format blocks, vertex blocks, tri blocks, objects).

    Header: "OEGM" + u32 version, then two length-prefixed strings (both empty on SR).
    Vertex format blocks: 15 property slots of (name u32, format u32), a count says how many
    are real. In this version every vertex/triangle block carries a u8 stream flag + u32 byte
    size before its payload (vertices: f32/Color32BGRA per the format block; triangles: u16),
    unlike the version-11 layout the public converters document. Objects follow the
    version-11 outline (minus the object name): vertexCount, vertex block count, format
    index, vertex blocks, tri index count, tri block, u8 flag, submesh count, then submeshes
    of (unused u32, material name, tri start, tri count, 2 unused u32), then a tail we skip:
    AABB, 4x4 matrix, material flags, lightmap + baked-paint names and UV rects. Each object
    is followed by a 20-byte zero stub that must be skipped.
    """
    u = lambda fmt, at: struct.unpack_from("<" + fmt, d, at)
    o = 4
    (version,) = u("I", o); o += 4
    assert version == 14, f"unsupported mapgeo version {version}"
    for _ in range(2):  # v9/v10 header strings
        (n,) = u("I", o); o += 4 + n
    (nf,) = u("I", o); o += 4
    formats = []
    for _ in range(nf):
        _type, count = u("II", o)
        formats.append([u("II", o + 8 + 8 * j) for j in range(count)])
        o += 8 + 8 * 15

    def blocks():
        nonlocal o
        (n,) = u("I", o); o += 4
        out = []
        for _ in range(n):
            (size,) = u("I", o + 1); o += 5
            out.append(d[o:o + size]); o += size
        return out

    vblocks, tblocks = blocks(), blocks()
    (nobj,) = u("I", o); o += 4
    objects = []
    for _ in range(nobj):
        vc, nb, fmt = u("3I", o); o += 12
        vend = list(u("%dI" % nb, o)); o += 4 * nb
        tic, tblk = u("2I", o); o += 8 + 1  # u8 stream flag
        (nsub,) = u("I", o); o += 4
        subs = []
        for _ in range(nsub):
            _unused, n = u("2I", o); o += 8
            mat = d[o:o + n].decode("utf-8", "replace"); o += n
            start, count, _u1, _u2 = u("4I", o); o += 16
            subs.append((mat, start, count))
        o += 1 + 24 + 64 + 3  # byte, AABB, matrix, 3 material flag bytes
        for _ in range(2):  # lightmap name + 16 bytes, baked-paint name + 16 bytes
            (n,) = u("I", o); o += 4 + n + 16
        assert d[o:o + 20] == b"\0" * 20, f"object {len(objects)} stub is not zero at {o}"
        o += 20
        objects.append({"vc": vc, "fmt": fmt, "vend": vend, "tic": tic, "tblk": tblk, "subs": subs})
    return formats, vblocks, tblocks, objects


def read_materials(bin_data, hashes_dir):
    """material name -> diffuse texture path (from samplerValues), via tools/read_bin.py."""
    names = Names(hashes_dir)
    out = {}
    for name, entry in read_bin(bin_data, names)["entries"].items():
        for sampler in (entry or {}).get("samplerValues") or []:
            if sampler and sampler.get("texturePath"):
                out[name] = sampler["texturePath"]
                break
    return out


def object_vertices(obj, formats, vblocks):
    """Decode the object's vertex blocks into (positions, uvs); LoL stores +X to the left."""
    props = formats[obj["fmt"]]
    stride = sum(PROPERTY_BYTES[f] for _, f in props)
    pos, uvs = [], []
    for index in obj["vend"]:
        blob = vblocks[index]
        ox = {name: None for name, _ in props}
        origin = 0
        for name, fmt in props:
            ox[name] = origin
            origin += PROPERTY_BYTES[fmt]
        for v in range(len(blob) // stride):
            base = v * stride
            x, y, z = struct.unpack_from("<3f", blob, base + ox[0])
            pos.append((-x, y, z))  # mapgeo X is negated vs world space
            u, w = struct.unpack_from("<2f", blob, base + ox[7])
            uvs.append((u, w))
    assert len(pos) == obj["vc"], f"{len(pos)} vertices decoded, object says {obj['vc']}"
    return pos, uvs


def build_piece(name, obj, sub, formats, vblocks, tblocks, texture):
    """Return the piece's GLB bytes (validated in memory) and its texture; writes nothing."""
    pos, uvs = object_vertices(obj, formats, vblocks)
    raw = tblocks[obj["tblk"]][2 * sub[1]:2 * (sub[1] + sub[2])]  # u16 indices
    indices = list(struct.unpack("<%dH" % (len(raw) // 2), raw))
    for i in range(0, len(indices), 3):
        indices[i + 1], indices[i + 2] = indices[i + 2], indices[i + 1]  # X flip mirrors winding
    assert max(indices) < len(pos), f"{name}: index past vertex count"

    lo = [min(p[k] for p in pos) for k in range(3)]
    hi = [max(p[k] for p in pos) for k in range(3)]
    scale = 1 / max(hi[k] - lo[k] for k in range(3))  # unit-size piece, bottom on y=0
    pos = [((p[0] - (lo[0] + hi[0]) / 2) * scale, (p[1] - lo[1]) * scale,
            (p[2] - (lo[2] + hi[2]) / 2) * scale) for p in pos]
    lo = [min(p[k] for p in pos) for k in range(3)]
    hi = [max(p[k] for p in pos) for k in range(3)]

    packed = b"".join(struct.pack("<3f", *p) for p in pos) + b"".join(struct.pack("<2f", *t) for t in uvs)
    index_bytes = struct.pack("<%dI" % len(indices), *indices)
    gltf = pygltflib.GLTF2(
        extensionsUsed=["KHR_materials_unlit"],
        scenes=[pygltflib.Scene(nodes=[0])],
        nodes=[pygltflib.Node(mesh=0)],
        meshes=[pygltflib.Mesh(primitives=[pygltflib.Primitive(
            attributes={pygltflib.POSITION: 0, pygltflib.TEXCOORD_0: 1},
            indices=2, material=0)])],
        materials=[pygltflib.Material(
            pbrMetallicRoughness=pygltflib.PbrMetallicRoughness(baseColorTexture=pygltflib.TextureInfo(index=0)),
            doubleSided=True, alphaMode=pygltflib.MASK,
            extensions={"KHR_materials_unlit": {}})],
        textures=[pygltflib.Texture(source=0)],
        images=[pygltflib.Image(uri=f"{name}.png")],
        accessors=[
            pygltflib.Accessor(bufferView=0, componentType=pygltflib.FLOAT, count=len(pos),
                               type=pygltflib.VEC3, min=lo, max=hi),
            pygltflib.Accessor(bufferView=1, componentType=pygltflib.FLOAT, count=len(uvs),
                               type=pygltflib.VEC2),
            pygltflib.Accessor(bufferView=2, componentType=pygltflib.UNSIGNED_INT, count=len(indices),
                               type=pygltflib.SCALAR),
        ],
        bufferViews=[
            pygltflib.BufferView(buffer=0, byteOffset=0, byteLength=len(packed) - len(uvs) * 8, target=pygltflib.ARRAY_BUFFER),
            pygltflib.BufferView(buffer=0, byteOffset=len(packed) - len(uvs) * 8, byteLength=len(uvs) * 8, target=pygltflib.ARRAY_BUFFER),
            pygltflib.BufferView(buffer=0, byteOffset=len(packed), byteLength=len(index_bytes), target=pygltflib.ELEMENT_ARRAY_BUFFER),
        ],
        buffers=[pygltflib.Buffer(byteLength=len(packed) + len(index_bytes))],
    )
    gltf.set_binary_blob(packed + index_bytes)
    glb = b"".join(gltf.save_to_bytes())
    (json_len,) = struct.unpack_from("<I", glb, 12)
    check = json.loads(glb[20:20 + json_len])
    assert [len(pos), len(uvs), len(indices)] == [a["count"] for a in check["accessors"]]
    assert check["meshes"][0]["primitives"][0]["attributes"] == {"POSITION": 0, "TEXCOORD_0": 1}
    print(f"{name} <- {sub[0].rsplit('/', 1)[-1]}  {len(indices) // 3} tris  {len(pos)} verts  "
          f"{texture.width}x{texture.height} tex  {len(glb) // 1024} KB")
    return glb


def extract_pieces(hashes_file, out_dir, *wad_paths):
    wads = [Wad(w) for w in wad_paths]
    read = lambda path: next((d for d in (w.read(path) for w in wads) if d is not None), None)
    formats, vblocks, tblocks, objects = parse_mapgeo(read(MAPGEO))
    textures = read_materials(read(MATERIALS), Path(hashes_file).parent)

    rock_format = [i for i, props in enumerate(formats) if {n for n, _ in props} >= {0, 7}]
    sections = [(s[2], i, s) for i, obj in enumerate(objects) if obj["fmt"] in rock_format
                for s in obj["subs"] if ROCKY.search(s[0]) and s[2] > 0]
    sections.sort(reverse=True)
    picks, seen = [], set()
    for _tris, i, sub in sections:
        if sub[0] not in seen:
            seen.add(sub[0])
            picks.append((i, sub))
        if len(picks) == len(PIECES):
            break
    if len(picks) < len(PIECES):
        sys.exit(f"only {len(picks)} rock/cliff/wall sections found, need {len(PIECES)}")

    built = []  # materialise every piece before touching the disk: no partial output
    for name, (i, sub) in zip(PIECES, picks):
        path = textures.get(sub[0])
        data = read(path) if path else None
        if data is None:
            sys.exit(f"{name}: no texture in the WADs for material {sub[0]} ({path})")
        img = (tex_to_png(data) if path.endswith(".tex") else Image.open(io.BytesIO(data))).convert("RGBA")
        built.append((name, build_piece(name, objects[i], sub, formats, vblocks, tblocks, img), img))

    out = Path(out_dir) / "pieces"
    out.mkdir(parents=True, exist_ok=True)
    for name, glb, img in built:
        (out / f"{name}.glb").write_bytes(glb)
        img.save(out / f"{name}.png")


def main(cmd, *args):
    if cmd not in ("textures", "pieces") or len(args) < 3:
        sys.exit(f"usage: {sys.argv[0]} textures|pieces <hashes.txt> <out_dir> <wad.client>...")
    (extract_textures if cmd == "textures" else extract_pieces)(*args)


if __name__ == "__main__":
    main(*sys.argv[1:])
