"""Extract a character's mesh, skeleton, textures and animations from a local League of Legends install.

Usage: python tools/extract_lol.py <hashes.txt> <character> <out_dir> <wad.client>...

Looks up every assets/characters/<character>/skins/base/ path in a CommunityDragon hash list
(hashes.game.txt) and extracts the ones present in the given WADs (textures converted to PNG).
"""
import io
import struct
import sys
import gzip
from pathlib import Path

import xxhash
import zstandard
from PIL import Image

ZSTD_MAGIC = b"\x28\xb5\x2f\xfd"


class Wad:
    def __init__(self, path):
        self.f = open(path, "rb")
        magic, major, minor = struct.unpack("<2sBB", self.f.read(4))
        assert magic == b"RW" and major == 3, f"unsupported WAD {magic} v{major}.{minor}"
        self.f.seek(4 + 256 + 8)
        (count,) = struct.unpack("<I", self.f.read(4))
        self.entries = {}
        for _ in range(count):
            h, off, csize, size, kind, _dup, _sub, _chk = struct.unpack("<QIIIBBHQ", self.f.read(32))
            self.entries[h] = (off, csize, size, kind & 0xF)

    def read(self, path):
        e = self.entries.get(xxhash.xxh64_intdigest(path.lower().encode()))
        if e is None:
            return None
        off, csize, size, kind = e
        self.f.seek(off)
        data = self.f.read(csize)
        if kind == 0:
            return data
        if kind == 1:
            return gzip.decompress(data)
        if kind in (3, 4):
            # kind 4 (zstd multi) may start with raw chunks before the first zstd frame
            i = data.find(ZSTD_MAGIC)
            reader = zstandard.ZstdDecompressor().stream_reader(io.BytesIO(data[i:]), read_across_frames=True)
            out = data[:i] + reader.read(size)
            assert len(out) == size, f"{path}: got {len(out)} of {size} bytes"
            return out
        raise ValueError(f"unsupported entry type {kind} for {path}")


def known_paths(hashes_file, char):
    # Bins reference textures/animations by xxh64 hash, so names come from CommunityDragon's hash list
    prefix = f"assets/characters/{char}/skins/base/"
    with open(hashes_file) as f:
        for line in f:
            p = line.split(" ", 1)[1].strip()
            if p.startswith(prefix) and not Path(p).name.startswith(("2x_", "4x_")) and \
                    p.endswith((".skn", ".skl", ".anm", ".tex", ".dds")) and "/particles/" not in p:
                yield p


def tex_to_png(data):
    # League .tex: "TEX\0", u16 w, u16 h, u8, u8 format, u8, u8 mipmaps; largest mip is stored last
    w, h, _, fmt, _, mips = struct.unpack("<HHBBBB", data[4:12])
    if fmt == 20:  # BGRA8
        n = w * h * 4
        return Image.frombytes("RGBA", (w, h), data[-n:], "raw", "BGRA")
    bcn = {10: 1, 12: 3}[fmt]  # DXT1, DXT5
    n = max(1, (w + 3) // 4) * max(1, (h + 3) // 4) * (8 if bcn == 1 else 16)
    return Image.frombytes("RGBA", (w, h), data[-n:] if mips else data[12:12 + n], "bcn", bcn)


def main(hashes_file, char, out_dir, *wad_paths):
    wads = [Wad(w) for w in wad_paths]
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    found = 0
    for p in sorted(set(known_paths(hashes_file, char))):
        data = next((d for d in (w.read(p) for w in wads) if d is not None), None)
        if data is None:
            continue
        found += 1
        name = Path(p).name
        if p.endswith(".anm"):
            (out / "anm").mkdir(exist_ok=True)
            (out / "anm" / name).write_bytes(data)
        elif p.endswith(".tex"):
            tex_to_png(data).save(out / (Path(p).stem + ".png"))
        elif p.endswith(".dds"):
            Image.open(io.BytesIO(data)).save(out / (Path(p).stem + ".png"))
        else:
            (out / name).write_bytes(data)
    print(f"{char}: {found} files")


if __name__ == "__main__":
    main(*sys.argv[1:])
