"""Generate src/items.json from Riot Data Dragon (pt_BR): stats, recipes and icon ids for Ezreal's build items.

Usage: python tools/build_items.py <ddragon version>

Legendaries come from current Ezreal builds (Trinity/Muramana core + on-hit/crit alternatives);
every component in their recipe trees is included so runs can assemble them piece by piece.
"""
import json
import re
import sys
import urllib.request

LEGENDARIES = ["3078", "3004", "3161", "6694", "2517", "3110", "3026", "3071", "6672", "3153", "3031", "3508", "3085", "3068"]
# intermediates of the evolution lines (src/items.ts LINES) that no legendary recipe above pulls in
EXTRA = ["6670", "3086"]
STAT_KEYS = {
    "FlatPhysicalDamageMod": "ad", "PercentAttackSpeedMod": "as", "FlatHPPoolMod": "hp", "FlatMPPoolMod": "mana",
    "FlatCritChanceMod": "crit", "FlatArmorMod": "armor", "PercentMovementSpeedMod": "msPct", "PercentLifeStealMod": "lifesteal",
}
# stats Data Dragon only lists inside the description text
DESC_STATS = {
    "ah": r"(\d+)\s+de Aceleração de Habilidade",
    "armorPen": r"(\d+)%\s+de Penetração de Armadura",
    "omnivamp": r"(\d+)%\s+de Vampirismo Universal",
    "critDamage": r"(\d+)%\s+de Dano de Acerto Crítico",
}


def main(version):
    url = f"https://ddragon.leagueoflegends.com/cdn/{version}/data/pt_BR/item.json"
    data = json.load(urllib.request.urlopen(url))["data"]
    items = {}

    def add(i):
        if i in items:
            return
        v = data[i]
        desc = re.sub(r"<[^>]+>", " ", v["description"])
        stats = {STAT_KEYS[k]: x for k, x in v["stats"].items() if k in STAT_KEYS}
        for key, pat in DESC_STATS.items():
            m = re.search(pat, desc)
            if m:
                stats[key] = int(m.group(1)) / (1 if key == "ah" else 100)
        frm = v.get("from") or []
        items[i] = {
            "id": i, "name": v["name"], "stats": stats, "from": frm,
            "tier": "legendary" if i in LEGENDARIES else "epic" if frm else "basic",
            "into": [],
        }
        for c in frm:
            add(c)

    for i in LEGENDARIES + EXTRA:
        add(i)
    for i, it in items.items():
        for c in set(it["from"]):
            items[c]["into"].append(i)
    out = {"version": version, "items": items}
    with open("src/items.json", "w") as f:
        json.dump(out, f, ensure_ascii=False, indent=1)
    print(f"{len(items)} items -> src/items.json")


if __name__ == "__main__":
    main(sys.argv[1])
