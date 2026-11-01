"""Generate src/championItems.json: per champion, the items players buy on it (League of Graphs) that exist in the game,
with their popularity, and the core of the most popular build (src/items.ts rollOffers / offerScore).

Usage: python tools/build_champion_items.py <patch>

Input: tools/lolgraphs/<champion id>.json, the raw output of the snippet below (unfiltered). League of Graphs blocks
bots, so refresh it from a real browser: for each champion id of src/champions/index.ts open
https://www.leagueofgraphs.com/champions/items/<id> (default filters), run the snippet in the console and save its
output to tools/lolgraphs/<id>.json. Then run this tool.

    const panel = (t) => [...document.querySelectorAll('.lolg-panel')].find((p) => p.querySelector('.lolg-panel__title')?.textContent.trim() === t);
    const ids = (row) => [...row.querySelectorAll('img[tooltip-var]')].map((i) => i.getAttribute('tooltip-var').replace('item-', ''));
    JSON.stringify({
      items: [...panel('Items').querySelectorAll('.lolg-table__row')].map((r) => [ids(r)[0], +(+r.dataset.sortPopularity).toPrecision(3)]),
      core: ids(panel('Core Build').querySelector('.lolg-table__row')),
    });

`items` keeps only ids of src/items.json `items` (drops components, boots, items not in the game). `core` is the first
"Core Build" row with the same filter, in buy order; a core id missing from `items` is appended with popularity 0.
"""
import json
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent


def build(raw: dict, known: set) -> dict:
    items = sorted(([i, p] for i, p in raw["items"] if i in known), key=lambda x: -x[1])
    core = [i for i in raw["core"] if i in known]
    have = {i for i, _ in items}
    items += [[i, 0] for i in core if i not in have]
    return {"items": items, "core": core}


def main():
    patch = sys.argv[1]
    known = set(json.loads((ROOT / "src/items.json").read_text())["items"])
    out = {}
    for f in sorted((ROOT / "tools/lolgraphs").glob("*.json")):
        c = build(json.loads(f.read_text()), known)
        if not c["core"]:
            sys.exit(f"{f.stem}: empty core")
        out[f.stem] = c
    (ROOT / "src/championItems.json").write_text(json.dumps({"patch": patch, "champions": out}, indent=1) + "\n")
    print(f"{len(out)} champions:", ", ".join(f"{k} {len(v['items'])} items, core {v['core']}" for k, v in out.items()))


if __name__ == "__main__":
    assert build({"items": [["1", 0.1], ["9", 0.5], ["2", 0.3]], "core": ["8", "3", "1"]}, {"1", "2", "3"}) == {
        "items": [["2", 0.3], ["1", 0.1], ["3", 0]], "core": ["3", "1"]}
    main()
