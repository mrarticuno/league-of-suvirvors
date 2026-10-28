"""Convert extracted SKN/SKL/ANM/PNG (from extract_lol.py) into .glb files for the game.

Usage: python tools/build_models.py <lol2gltf binary>

Reads assets-raw/<character>/ and writes public/assets/models/<id>.glb + <id>.png (texture).
"""
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

RAW = Path("assets-raw")
OUT = Path("public/assets/models")

# id -> (raw folder, main texture, extra anm folders to borrow missing clips from[, use the folder's own clips])
MODELS = {
    "ezreal": ("ezreal", "ezreal_base_tx_cm.png", []),
    "minion_melee": ("sru_chaosminionmelee", "chaosminion_melee_tx_cm.png", ["sru_orderminionmelee"]),
    "minion_caster": ("sru_chaosminionranged", "red_caster_tx_cm.png", []),
    "minion_siege": ("sru_chaosminionsiege", "chaos_minion_siege_tx_cm.png", []),
    "minion_super": ("sru_chaosminionsuper", "red_superminion_tx_cm.png", []),
    "krug": ("sru_krug", "sru_krug_base_tx_cm.png", []),
    "murkwolf": ("sru_murkwolf", "sru_murkwolf.png", []),
    "razorbeak": ("sru_razorbeak", "sru_razorbeak_tx_cm.png", []),
    "razorbeak_mini": ("sru_razorbeakmini", "sru_razorbeak_mini_tx_cm.png", []),
    "gromp": ("sru_gromp", "sru_gromp_base_tx_cm.png", []),
    "blue": ("sru_blue", "sru_blue_golem_v2.png", []),
    "red": ("sru_red", "sru_red.png", []),
    "riftherald": ("sru_riftherald", "sru_riftherald_base_main_tx_cm.png", []),
    "baron": ("sru_baron", "baron_base_tx_cm.png", []),
    "scuttle": ("sru_crab", "sru_crab_tx_cm.png", []),
    # Drakes animate with the shared sru_dragon clip set. sru_dragon_air's own flying_attack1/spell1 collapse the
    # mesh, so its folder clips are skipped. Infernal and Mountain reuse the air drake mesh with their own texture,
    # like the game's skin bins do.
    "dragon_air": ("sru_dragon_air", "sru_dragon_air_tx_cm.png", ["sru_dragon"], False),
    "dragon_fire": ("sru_dragon_air", "../sru_dragon_fire/sru_dragon_fire_tx_cm.png", ["sru_dragon"], False),
    "dragon_earth": ("sru_dragon_air", "../sru_dragon_earth/sru_dragon_earth_tx_cm_2.png", ["sru_dragon"], False),
    "dragon_water": ("sru_dragon_water", "sru_dragon_water_tx_cm.png", ["sru_dragon"]),
    "dragon_hextech": ("sru_dragon_hextech", "sru_dragon_hextech_tx_cm.png", ["sru_dragon"]),
    "dragon_chemtech": ("sru_dragon_chemtech", "sru_dragon_chemtech_tx_cm.png", ["sru_dragon"]),
}


def build(lol2gltf, model_id, folder, texture, borrow, own_anm=True):
    src = RAW / folder
    if texture.startswith("../"):
        # texture-only skin of another model's mesh: the game loads that mesh's .glb (EnemyDef.mesh)
        shutil.copy(src / texture, OUT / f"{model_id}.png")
        print(f"{model_id} -> {OUT / model_id}.png (mesh {folder})")
        return
    skn = next(src.glob("*.skn"))
    skl = next(src.glob("*.skl"))
    with tempfile.TemporaryDirectory() as tmp:
        anm = Path(tmp) / "anm"
        anm.mkdir()
        for f in (src / "anm").glob("*.anm") if own_anm else []:
            shutil.copy(f, anm)
        # borrowed clips are matched by name suffix (e.g. order melee "run" fills chaos melee's missing "run")
        have = {f.stem.rsplit("_", 1)[-1] for f in anm.glob("*.anm")}
        for b in borrow:
            for f in (RAW / b / "anm").glob("*.anm"):
                if f.stem.rsplit("_", 1)[-1] not in have:
                    shutil.copy(f, anm)
        cmd = [lol2gltf, "skn2gltf", "-m", str(skn), "-s", str(skl), "-g", str(OUT / f"{model_id}.glb"), "-a", str(anm)]
        subprocess.run(cmd, check=True, stdout=subprocess.DEVNULL)
    # lol2gltf only embeds League .tex/.dds textures, so the PNG ships alongside and is applied at load time
    shutil.copy(src / texture, OUT / f"{model_id}.png")
    print(f"{model_id} -> {OUT / model_id}.glb")


if __name__ == "__main__":
    OUT.mkdir(parents=True, exist_ok=True)
    for model_id, entry in MODELS.items():
        build(sys.argv[1], model_id, *entry)
