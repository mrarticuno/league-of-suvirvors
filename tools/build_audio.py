"""Extract the game's sounds (Ezreal, monsters, HUD, Summoner's Rift music) from Wwise banks into mp3 files.

Usage: python tools/build_audio.py <wwiser.py> <out_dir> <DATA/FINAL dir>

Needs vgmstream-cli and ffmpeg on PATH (brew install vgmstream ffmpeg) and wwiser (github.com/bnnm/wwiser).
Each bank (<name>_events.bnk + <name>_audio.bnk/.wpk) is extracted, wwiser writes one .txtp per event
(the event -> action -> container -> .wem tree) and vgmstream renders it. Events are matched by id
(FNV-1 of the lowercase event name, the names come from the champion/monster .bin files), so no
wwnames.txt is needed. Random containers render up to MAX_VARIANTS takes; switch containers (music)
render every state. Writes <out_dir>/<key>_<n>.mp3 and <out_dir>/sounds.json ({key: [files]}).
"""
import json
import re
import shutil
import struct
import subprocess
import sys
import tempfile
from pathlib import Path

from extract_lol import Wad

MAX_VARIANTS = 4
SFX = "assets/sounds/wwise2016/sfx/"
SHARED = SFX + "shared/"
EZ = "Play_sfx_Ezreal_Ezreal"

# bank path (without _events/_audio) -> {sound key: event name candidates (first match wins) or an event id}
BANKS: dict[str, dict[str, list[str] | int]] = {
    SFX + "characters/ezreal/skins/base/ezreal_base_sfx": {
        "ezreal_auto": [EZ + "BasicAttack_OnCast"],
        "ezreal_auto2": [EZ + "BasicAttack2_OnCast"],
        "ezreal_auto_hit": [EZ + "BasicAttack_OnHit"],
        "ezreal_crit": [EZ + "CritAttack_OnCast"],
        "ezreal_crit_hit": [EZ + "CritAttack_OnHit"],
        "ezreal_Q": [EZ + "Q_OnCast"],
        "ezreal_Q_hit": [EZ + "Q_OnHit"],
        "ezreal_W": [EZ + "W_OnCast"],
        "ezreal_W_hit": [EZ + "W_OnHit"],
        "ezreal_W_detonate": [EZ + "WAttach_detonate"],
        "ezreal_E": [EZ + "E_OnCast"],
        "ezreal_E_hit": [EZ + "EMissile_OnHit"],
        "ezreal_R": [EZ + "R_OnCast"],
        "ezreal_R_launch": [EZ + "R_OnMissileCast"],
        "ezreal_R_hit": [EZ + "R_OnHit"],
        "ezreal_death": ["Play_sfx_Ezreal_Death3D_cast"],
    },
    SHARED + "hud_global": {
        "hud_levelup": ["Play_sfx_hud_base_spell_levelup"],
        "hud_item": ["Play_sfx_hud_base_store_item_buy_basic"],
        "hud_legendary": ["Play_sfx_hud_base_store_item_buy_legendary"],
        "hud_open": ["Play_sfx_hud_base_options_open"],
        "hud_close": ["Play_sfx_hud_base_options_close"],
        "hud_click": ["Play_sfx_hud_base_generic_click"],
    },
    # no name known for the in-game music event: a switch container whose states are the music phases
    SHARED + "mus_map11": {"music": 3832820115},
}


def monster(bank, char, key, spawn=False):
    """Monster banks follow the LoL naming scheme: Play_sfx_<char>_<spell>_OnHit, Play_sfx_<char>_death_cast."""
    c = char
    sounds = {
        f"{key}_hit": [f"Play_sfx_{c}_{c}BasicAttack_OnHit", f"Play_sfx_{c}BasicAttack_OnHit", f"Play_sfx_{c}_BasicAttack_OnHit"],
        f"{key}_death": [f"Play_sfx_{c}_death_cast", f"Play_sfx_{c}_Death3D_cast", f"Play_sfx_{c}_death", f"Play_sfx_{c}_Death"],
    }
    if spawn:
        sounds[f"{key}_spawn"] = [f"Play_sfx_{c}_spawn_cast", f"Play_sfx_{c}_spawn", f"Play_sfx_{c}_Spawn"]
    BANKS.setdefault(SHARED + bank, {}).update(sounds)


# keys are the game's EnemyDef.model ids (src/data.ts)
monster("npc_global_minions_chaosmelee_sfx", "SRU_ChaosMinionMelee", "minion_melee")
monster("npc_global_minions_chaosrange_sfx", "SRU_ChaosMinionRanged", "minion_caster")
monster("npc_global_minions_chaossiege_sfx", "SRU_ChaosMinionSiege", "minion_siege")
monster("npc_global_minions_chaossuper_sfx", "SRU_ChaosMinionSuper", "minion_super")
monster("npc_map11_razorbeakmini_sfx", "SRU_RazorbeakMini", "razorbeak_mini")
monster("npc_map11_razorbeak_sfx", "SRU_Razorbeak", "razorbeak")
monster("npc_map11_murkwolf_sfx", "SRU_Murkwolf", "murkwolf")
monster("npc_map11_krug_sfx", "SRU_Krug", "krug")
monster("npc_map11_gromp_sfx", "SRU_Gromp", "gromp")
monster("npc_map11_blue_sfx", "SRU_Blue", "blue", spawn=True)
monster("npc_map11_red_sfx", "SRU_Red", "red", spawn=True)
monster("npc_map11_crab_sfx", "SRU_Crab", "scuttle", spawn=True)
monster("npc_map11_riftherald_sfx", "SRU_RiftHerald", "riftherald", spawn=True)
monster("npc_map11_baron_sfx", "SRU_Baron", "baron")
BA = "Play_sfx_SRU_Baron_"
BANKS[SHARED + "npc_map11_baron_sfx"].update({
    "baron_spawn": [BA + "spawn_cast_vox"],
    "baron_bite": [BA + "BaronAttackMelee_OnHit"],
    "baron_whip": [BA + "BaronTail_cast"],
    "baron_knockup": [BA + "BaronSpike_OnCast"],
    "baron_knockup_hit": [BA + "BaronSpike_OnHit"],
    "baron_tentacle": [BA + "NewSpellLivingArtillery_hit"],
    "baron_spit": [BA + "BaronAcidBall_Cast"],
    "baron_spit_launch": [BA + "BaronAcidBall_OnMissileLaunch"],
    "baron_pull": [BA + "BaronPullSpellMissile_cast"],
})
monster("npc_map11_dragons_sfx", "SRU_Dragon", "dragon", spawn=True)
for model, element in [("air", "Cloud"), ("fire", "Infernal"), ("earth", "Mountain"), ("water", "Ocean"), ("hextech", "Hextech"), ("chemtech", "Chemtech")]:
    BANKS.setdefault(SHARED + f"npc_map11_dragons_{element.lower()}_sfx", {})[f"dragon_{model}_hit"] = [
        f"Play_sfx_SRU_Dragon_{element}_Attack_OnHitLocation", f"Play_sfx_SRU_Dragon_{element}_Attack_OnHit"]


def fnv1(s):
    # Wwise ids: FNV-1 32 of the lowercase name
    h = 0x811C9DC5
    for c in s.lower().encode():
        h = ((h * 0x01000193) & 0xFFFFFFFF) ^ c
    return h


def unpack_wpk(data, out):
    # r3d2 wem pack: u32 count, offset table, entries of (u32 offset, u32 size, u32 name length, utf-16 name)
    (count,) = struct.unpack_from("<I", data, 8)
    for i in range(count):
        (o,) = struct.unpack_from("<I", data, 12 + 4 * i)
        off, size, nlen = struct.unpack_from("<III", data, o)
        (out / data[o + 12:o + 12 + nlen * 2].decode("utf-16le")).write_bytes(data[off:off + size])


def variants(txtp):
    """A single top-level random group ('group = -R3>1' picks take 1) becomes one txtp per take."""
    groups = re.findall(r"^group = -R(\d+)>1", txtp, re.M)
    if len(groups) != 1:
        return [txtp]
    n = min(int(groups[0]), MAX_VARIANTS)
    return [re.sub(r"^(group = -R\d+)>1", rf"\g<1>>{k}", txtp, flags=re.M) for k in range(1, n + 1)]


def render(txtp_path, mp3, music):
    wav = txtp_path.with_suffix(".wav")
    # -i: play once without looping (the game loops music itself)
    subprocess.run(["vgmstream-cli", "-i", "-o", str(wav), str(txtp_path)], check=True, capture_output=True)
    q = ["-b:a", "128k"] if music else ["-q:a", "5"]
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", str(wav), "-codec:a", "libmp3lame", *q, str(mp3)], check=True)
    wav.unlink()


def main(wwiser, out_dir, final_dir):
    final = Path(final_dir)
    wads = [Wad(final / w) for w in ("Champions/Ezreal.wad.client", "Maps/Shipping/Map11.wad.client", "Maps/Shipping/Common.wad.client")]
    read = lambda p: next((d for d in (w.read(p) for w in wads) if d is not None), None)
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    manifest = {}
    with tempfile.TemporaryDirectory() as tmp:
        for bank, wanted in BANKS.items():
            work = Path(tmp) / Path(bank).name
            work.mkdir()
            for suffix in ("_events.bnk", "_audio.bnk", "_audio.wpk"):
                data = read(bank + suffix)
                if data is None:
                    continue
                if suffix.endswith(".wpk"):
                    unpack_wpk(data, work)
                else:
                    (work / Path(bank + suffix).name).write_bytes(data)
            banks = sorted(str(p) for p in work.glob("*.bnk"))
            if not banks:
                print(f"missing bank {bank}")
                continue
            subprocess.run([sys.executable, wwiser, "-g", "-gd", *banks], cwd=work, check=True, capture_output=True)
            txtps = [(p, p.read_text(errors="replace")) for p in sorted((work / "txtp").glob("*.txtp"))]
            for key, names in wanted.items():
                ids = [names] if isinstance(names, int) else [fnv1(n) for n in names]
                found = []
                for eid in ids:
                    found = [t for _, t in txtps if re.search(rf"CAkEvent\[\d+\] {eid}\b", t)]
                    if found:
                        break
                if not found:
                    print(f"{key}: no event in {Path(bank).name}")
                    continue
                # -gd also writes txtp that only differ in their comments (same event reached by several paths)
                unique = {re.sub(r"^#.*$", "", t, flags=re.M).strip(): t for t in found}
                takes = [v for t in unique.values() for v in variants(t)][: 8 if key == "music" else MAX_VARIANTS]
                files = []
                for i, t in enumerate(takes):
                    p = work / "txtp" / f"_{key}_{i}.txtp"  # txtp paths to the wems are relative to txtp/
                    p.write_text(t)
                    name = f"{key}_{i}.mp3"
                    render(p, out / name, key == "music")
                    files.append(name)
                manifest[key] = files
                print(f"{key}: {len(files)}")
            shutil.rmtree(work)
    (out / "sounds.json").write_text(json.dumps(manifest, indent=1))


if __name__ == "__main__":
    main(*sys.argv[1:])
