"""Generate src/items.json from Riot Data Dragon: stats and icon ids of the legendary items offered in runs. Item names go
to every src/locales/<lang>.json as `item.<id>` (stale `item.<id>` names are dropped; other keys, passives included, are
kept). Stats are parsed from the en_US description's <stats> block.

BOOTS are the boots of the boot slot (flat Move Speed: `ms`).

Usage: python tools/build_items.py <ddragon version>

ITEMS is every Summoner's Rift legendary except: items with an active (Zhonya's, Youmuu's, the Hydras, Randuin's,
Stridebreaker, Gunblade, Rocketbelt, Mercurial, Actualizer), support items (Censer, Helia, Moonstone, Flowing Water,
Dawncore, Mandate, Zeke's, Bandlepipes, Knight's Vow, Locket, Mikael's, Redemption, Shurelya's), anti-heal items
(Mortal Reminder, Chempunk, Morellonomicon) and items whose passive needs vision or champion shields (Umbral Glaive,
Serpent's Fang).
"""
import json
import re
import sys
import urllib.request

ITEMS = [
    # physical damage
    "6696", "2520", "3071", "3153", "3072", "6692", "3814", "2517", "3508", "3073", "2512", "3026", "3124", "2523", "6697",
    "3181", "6673", "3031", "6672", "3036", "3004", "3156", "2501", "3046", "3094", "3085", "6694", "3161", "3087", "3053",
    "3095", "6610", "3302", "6676", "3078", "6699", "3032", "3091", "6675",
    # magic damage
    "8020", "3003", "3102", "2503", "8010", "4629", "3137", "6653", "6655", "3118", "3089", "4633", "6657", "3116", "4645",
    "4646", "3135", "3115", "2510", "3100", "4628",
    # tank
    "2502", "3068", "6664", "3742", "6333", "4401", "3110", "3084", "6665", "2504", "2525", "3065", "3075", "3083", "3119",
    "6662",
]
# Boots: their own slot outside the six (src/items.ts BOOT_UPGRADES): Boots, the tier 2 picks, then each one's tier 3
BOOTS = ["1001", "3006", "3020", "3047", "3111", "3158", "3009", "3172", "3175", "3174", "3173", "3171", "3170"]
# <stats> line name -> src/items.ts ItemStats key (percent values become fractions); unlisted lines (regen, heal power) are ignored
STAT_NAMES = {
    "Attack Damage": "ad", "Ability Power": "ap", "Attack Speed": "as", "Health": "hp", "Mana": "mana",
    "Critical Strike Chance": "crit", "Critical Strike Damage": "critDamage", "Armor": "armor", "Magic Resist": "mr",
    "Move Speed": "ms", "Move Speed%": "msPct", "Life Steal": "lifesteal", "Omnivamp": "omnivamp", "Ability Haste": "ah", "Armor Penetration": "armorPen",
    "Lethality": "lethality", "Magic Penetration": "magicPenFlat", "Magic Penetration%": "magicPen", "Tenacity": "tenacity",
}
# src/locales file -> Data Dragon locale (new game language: add it here and rerun)
LOCALES = {"en": "en_US", "pt": "pt_BR", "es": "es_MX", "zh": "zh_CN"}


def parse_stats(description):
    block = re.search(r"<stats>(.*?)</stats>", description).group(1)
    stats = {}
    for line in re.split(r"<br\s*/?>", block):
        m = re.match(r"(\d+(?:\.\d+)?)(%?)\s+(.+)", re.sub(r"<[^>]+>", "", line).strip())
        if not m:
            continue
        value, pct, name = float(m.group(1)), m.group(2), m.group(3).strip()
        key = STAT_NAMES.get(name + pct) or STAT_NAMES.get(name)
        if key and value:
            stats[key] = value / 100 if pct else (int(value) if value.is_integer() else value)
    return stats


def main(version):
    url = "https://ddragon.leagueoflegends.com/cdn/{}/data/{}/item.json"
    names = {lang: json.load(urllib.request.urlopen(url.format(version, loc)))["data"] for lang, loc in LOCALES.items()}
    items = {i: {"id": i, "stats": parse_stats(names["en"][i]["description"])} for i in ITEMS}
    boots = {i: {"id": i, "stats": parse_stats(names["en"][i]["description"])} for i in BOOTS}
    for lang, d in names.items():
        path = f"src/locales/{lang}.json"
        with open(path) as f:
            texts = json.load(f)
        texts = {k: v for k, v in texts.items() if not re.fullmatch(r"item\.\d+", k)}
        texts.update({f"item.{i}": d[i]["name"] for i in [*items, *boots]})
        with open(path, "w") as f:
            json.dump(texts, f, ensure_ascii=False, indent=1)
            f.write("\n")
    out = {"version": version, "items": items, "boots": boots}
    with open("src/items.json", "w") as f:
        json.dump(out, f, ensure_ascii=False, indent=1)
    print(f"{len(items)} items, {len(boots)} boots -> src/items.json")


if __name__ == "__main__":
    main(sys.argv[1])
