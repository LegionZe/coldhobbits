#!/usr/bin/env python3
"""Generate the "Spell Components (POSM)" compendium (packs/_source/components).

Source (AD&D 2e fandom wiki, MediaWiki API): "Spell Components (POSM)", Table 16: Spell Components (Player's Option:
Spells & Magic): every row as an equipment Item (category "component") with its Table 16 group, acquisition (FS field
search, TM town or market, SO special order, Auto), scarcity and cost. Name markers: "+" = "Items commonly available in
wizard's laboratory", "**" = "Perishable items" (both asserted in the page's key). Wiki formatting: empty rows are
skipped and a name continued on the next row ("Skin, from magic-resistant" / "creature") is joined.
Spell imports link these items by identifier (module/importers/spell-components.mjs). No descriptions are copied.
Run from the repo root after build-equipment-data.py:  python3 tools/build-component-data.py
"""
import importlib.util
import re

_spec = importlib.util.spec_from_file_location("classdata", "tools/build-class-data.py")
classdata = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(classdata)

PAGE = "Spell Components (POSM)"
GROUPS = ["Models and Miniatures", "Refined/Finished Items", "Minerals", "Common/Household Materials", "Animal Specimens",
          "Herbs and Plant Specimens", "Other Components"]


def slug(name):
    return re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")


def rows(wiki):
    """[(group, name, acquisition, scarcity, cost)] from Table 16."""
    t = wiki[wiki.index("Table 16: Spell Components"):]
    t = t[:t.index("\n|}")]
    out, group = [], None
    for chunk in re.split(r"\n\|-", t):
        h = re.search(r"<h4>([^<]+)</h4>", chunk)
        if h:
            group = h.group(1).strip()
            continue
        cells = [x.lstrip("|").strip() for x in chunk.strip().split("\n") if x.startswith("|") and not x.startswith(("|+", "|}"))]
        if len(cells) != 4 or not cells[0]:
            continue
        # A name split over two rows: the first has no other cells, the second starts in lower case.
        if out and not any(out[-1][2:]) and cells[0][:1].islower():
            prev = out.pop()
            cells[0] = f"{prev[1]} {cells[0]}"
        out.append([group, *cells])
    return out


if __name__ == "__main__":
    wiki, rev, _ = classdata.page(PAGE)
    assert re.search(r"\+ Items commonly available in wizard's laboratory", wiki), "key: laboratory marker"
    assert re.search(r"<nowiki>\*\*</nowiki> Perishable items", wiki), "key: perishable marker"
    data = rows(wiki)
    assert {r[0] for r in data} == set(GROUPS), {r[0] for r in data}
    assert any(r[1] == "Skin, from magic-resistant creature" for r in data), "joined row"
    folders = [classdata.folder_doc(f"components.{slug(g)}", g, sort=i * 100) for i, g in enumerate(GROUPS)]
    fid = dict(zip(GROUPS, (f["_id"] for f in folders)))
    docs, seen = [], set()
    for i, (group, raw, acq, scarcity, cost) in enumerate(data):
        lab = raw.startswith("+")
        perishable = raw.endswith("**")
        name = raw.lstrip("+").rstrip("*").strip()
        key = slug(name)
        assert key not in seen, f"duplicate {name}"
        seen.add(key)
        system = {"identifier": key, "category": "component", "cost": "" if cost in ("—", "-") else cost, "weight": None,
                  "quantity": 1, "carried": True, "container": "",
                  "capacity": {"weight": None, "volume": ""}, "load": {"full": None, "half": None, "quarter": None},
                  "component": {"group": group, "acquisition": "" if acq in ("—", "-") else acq,
                                "scarcity": scarcity, "laboratory": lab, "perishable": perishable},
                  "source": "Player's Option: Spells & Magic, Table 16", "url": classdata.url(PAGE), "notes": ""}
        doc = classdata.item_doc("equipment", "component." + key, name, "icons/svg/item-bag.svg", system, i * 10)
        doc["folder"] = fid[group]
        docs.append(doc)
    classdata.write_docs("packs/_source/components", folders + docs)
    print(f"wrote packs/_source/components: {len(docs)} components in {len(folders)} groups ({PAGE} rev {rev})")
