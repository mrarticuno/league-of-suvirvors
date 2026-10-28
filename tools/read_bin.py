"""Read League .bin (PROP) property files into plain JSON-able Python values.

Usage: python tools/read_bin.py <hashes_dir> <bin path inside WAD> <wad.client>... > out.json

Names come from CommunityDragon hash lists in <hashes_dir>: hashes.bin{entries,fields,types,hashes}.txt
(FNV-1a 32 of the lowercase name) and hashes.game.txt (xxh64 of file paths).
Embeds/pointers become {"__type": ClassName, field: value...}; unresolved hashes stay as "0x........".
"""
import json
import struct
import sys
from pathlib import Path

from extract_lol import Wad


def fnv1a(s):
    h = 0x811C9DC5
    for c in s.lower().encode():
        h = ((h ^ c) * 0x01000193) & 0xFFFFFFFF
    return h


class Names:
    def __init__(self, hashes_dir):
        self.d = Path(hashes_dir)
        self.bin = {}
        for f in ("hashes.binfields.txt", "hashes.bintypes.txt", "hashes.binentries.txt", "hashes.binhashes.txt"):
            with open(self.d / f) as fh:
                for line in fh:
                    h, _, name = line.rstrip("\n").partition(" ")
                    self.bin[int(h, 16)] = name
        self.files = None

    def h32(self, h):
        return self.bin.get(h, f"0x{h:08x}")

    def file(self, h):
        if self.files is None:  # 2M+ lines: load only when a bin actually contains file hashes
            self.files = {}
            with open(self.d / "hashes.game.txt") as fh:
                for line in fh:
                    k, _, name = line.rstrip("\n").partition(" ")
                    self.files[int(k, 16)] = name
        return self.files.get(h, f"0x{h:016x}")


class Reader:
    def __init__(self, data, names):
        self.b, self.o, self.n = data, 0, names

    def u(self, fmt):
        v = struct.unpack_from("<" + fmt, self.b, self.o)
        self.o += struct.calcsize("<" + fmt)
        return v if len(v) > 1 else v[0]

    def value(self, t):
        n = self.n
        if t == 0: return None
        if t == 1: return bool(self.u("B"))
        if t in (2, 3, 4, 5, 6, 7, 8, 9):
            return self.u("bBhHiIqQ"[t - 2])
        if t == 10: return self.u("f")
        if t in (11, 12, 13): return list(self.u(f"{t - 9}f"))
        if t == 14: return list(self.u("16f"))
        if t == 15: return list(self.u("4B"))
        if t == 16: return self.string()
        if t in (17, 0x84): return n.h32(self.u("I"))
        if t == 18: return n.file(self.u("Q"))
        if t == 0x87: return bool(self.u("B"))
        if t in (0x80, 0x81):
            vt, _size, count = self.u("BII")
            return [self.value(vt) for _ in range(count)]
        if t in (0x82, 0x83):
            cls = self.u("I")
            if cls == 0:
                return None
            _size, count = self.u("IH")
            obj = {"__type": n.h32(cls)}
            for _ in range(count):
                name, ft = self.u("IB")
                obj[n.h32(name)] = self.value(ft)
            return obj
        if t == 0x85:
            vt, count = self.u("BB")
            return self.value(vt) if count else None
        if t == 0x86:
            kt, vt, _size, count = self.u("BBII")
            out = {}
            for _ in range(count):
                k = self.value(kt)
                out[str(k)] = self.value(vt)
            return out
        raise ValueError(f"unknown bin type {t} at {self.o}")

    def string(self):
        ln = self.u("H")
        s = self.b[self.o:self.o + ln].decode("utf-8", "replace")
        self.o += ln
        return s


def read_bin(data, names):
    r = Reader(data, names)
    magic = r.b[:4]
    if magic == b"PTCH":
        r.o = 12
        magic = r.b[12:16]
    assert magic == b"PROP", f"not a PROP bin: {magic}"
    r.o += 4
    version = r.u("I")
    linked = [r.string() for _ in range(r.u("I"))] if version >= 2 else []
    count = r.u("I")
    types = [r.u("I") for _ in range(count)]
    entries = {}
    for t in types:
        size = r.u("I")
        end = r.o + size
        key, nfields = r.u("IH")
        obj = {"__type": names.h32(t)}
        for _ in range(nfields):
            name, ft = r.u("IB")
            obj[names.h32(name)] = r.value(ft)
        assert r.o == end, f"entry {key:08x} size mismatch ({r.o} != {end})"
        entries[names.h32(key)] = obj
    return {"linked": linked, "entries": entries}


def main(hashes_dir, bin_path, *wad_paths):
    # follows "linked" bins (shared multi-skin VFX, the champion's spell bin) and merges all entries
    names = Names(hashes_dir)
    wads = [Wad(w) for w in wad_paths]
    todo, seen, entries = [bin_path], set(), {}
    while todo:
        p = todo.pop().lower()
        if p in seen:
            continue
        seen.add(p)
        data = next((d for d in (w.read(p) for w in wads) if d is not None), None)
        if data is None:
            print(f"missing {p}", file=sys.stderr)
            continue
        b = read_bin(data, names)
        entries.update(b["entries"])
        todo += b["linked"]
    json.dump({"bins": sorted(seen), "entries": entries}, sys.stdout, indent=1)


if __name__ == "__main__":
    main(*sys.argv[1:])
