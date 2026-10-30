"""Generate src/items.json from Riot Data Dragon: stats, recipes and icon ids for the champions' build items. Item names go to
every src/locales/<lang>.json as `item.<id>` (other keys are kept). Stats are parsed from the pt_BR descriptions.

Usage: python tools/build_items.py <ddragon version>

Legendaries come from current Ezreal builds (Trinity/Muramana core + on-hit/crit alternatives) and mage builds
(Brand: Luden's/Liandry's/Rabadon's...); every component in their recipe trees is included so runs can assemble them piece by piece.
"""
import json
import re
import sys
import urllib.request

LEGENDARIES = ["3078", "3004", "3161", "6694", "2517", "3110", "3026", "3071", "6672", "3153", "3031", "3508", "3085", "3068",
               "6655", "3118", "2503", "4645", "6653", "4646", "3089", "3157", "3116", "3003"]
# intermediates of the evolution lines (src/items.ts LINES) that no legendary recipe above pulls in
EXTRA = ["6670", "3086"]
STAT_KEYS = {
    "FlatPhysicalDamageMod": "ad", "FlatMagicDamageMod": "ap", "PercentAttackSpeedMod": "as", "FlatHPPoolMod": "hp", "FlatMPPoolMod": "mana",
    "FlatCritChanceMod": "crit", "FlatArmorMod": "armor", "PercentMovementSpeedMod": "msPct", "PercentLifeStealMod": "lifesteal",
}
# src/locales file -> Data Dragon locale (new game language: add it here and rerun)
LOCALES = {"en": "en_US", "pt": "pt_BR", "es": "es_MX", "zh": "zh_CN"}
# stats Data Dragon only lists inside the description text
DESC_STATS = {
    "ah": r"(\d+)\s+de Aceleração de Habilidade",
    "armorPen": r"(\d+)%\s+de Penetração de Armadura",
    "omnivamp": r"(\d+)%\s+de Vampirismo Universal",
    "critDamage": r"(\d+)%\s+de Dano de Acerto Crítico",
}


def main(version):
    url = "https://ddragon.leagueoflegends.com/cdn/{}/data/{}/item.json"
    names = {lang: json.load(urllib.request.urlopen(url.format(version, loc)))["data"] for lang, loc in LOCALES.items()}
    data = names["pt"]
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
            "id": i, "stats": stats, "from": frm,
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
    for lang, d in names.items():
        path = f"src/locales/{lang}.json"
        with open(path) as f:
            texts = json.load(f)
        texts.update({f"item.{i}": d[i]["name"] for i in items})
        with open(path, "w") as f:
            json.dump(texts, f, ensure_ascii=False, indent=1)
            f.write("\n")
    out = {"version": version, "items": items}
    with open("src/items.json", "w") as f:
        json.dump(out, f, ensure_ascii=False, indent=1)
    print(f"{len(items)} items -> src/items.json")


if __name__ == "__main__":
    main(sys.argv[1])
