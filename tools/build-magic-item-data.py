#!/usr/bin/env python3
"""Generate the "Magical Items (DMG)" and "Gems (DMG)" compendiums (packs/_source/magic-items, packs/_source/gems).

Sources (AD&D 2e fandom wiki, MediaWiki API):
  * Magical items: DMG Tables 89-104 ("DMG Table 89" ... "DMG Table 104"): each named item once (an item listed in
    several subtables is one entry), with its XP value and the groups that may use it ("(Priest, Wizard)"; none = any).
    Spell scrolls (Table 90 "1 spell" ... "7 spells" rows), maps and "DM's Choice" rows are not items and are left out.
    Name = the item's wiki page title without its "(Magic Ring)"-style suffix; the item links to that page (no
    description is copied). Charges when found: wands 1d20+80 ("Wands (DMG)"), rods 1d10+40 ("Rods (DMG)"), staves
    1d6+19 ("Staves (DMG)"); the item stores the formula and its maximum, and its sheet rolls the charges. Only items
    whose own page mentions charges get them (e.g. the Staff-Mace and the Rod of Cancellation do not).
    Magical containers (MAGIC_CONTAINERS, each checked by regex against its page): Bag of Holding (contents add no
    weight; size rolled, set by the GM), Heward's Handy Haversack (20 + 20 + 80 lb), Portable Hole (contents add no
    weight).
    Magical armour and weapons (Tables 105-108) are armour and weapon items with a magical bonus, not included here.
  * Gems: "Treasure Tables (DMG)" stone lists (Ornamental, Semi-Precious, Fancy to Precious, Gems and Jewels) with
    their Table 85 class; a listed value range (e.g. 100-500 gp) is kept in the notes. Descriptions are not copied.
Run from the repo root after build-treasure-tables.py:  python3 tools/build-magic-item-data.py
"""
import importlib.util
import re
import urllib.parse

_spec = importlib.util.spec_from_file_location("classdata", "tools/build-class-data.py")
classdata = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(classdata)

TABLES = {89: "potion", 90: "scroll", 91: "ring", 92: "rod", 93: "staff", 94: "wand", 95: "book", 96: "jewel", 97: "cloak",
          98: "boots", 99: "girdle", 100: "bag", 101: "dust", 102: "household", 103: "instrument", 104: "weird"}
CHARGES = {"wand": ("1d20+80", 100, "Wands (DMG)", r"typically contains 1d20\+80 charges"),
           "rod": ("1d10+40", 50, "Rods (DMG)", r"normally contains 41 to 50 \(1d10\+40\) charges"),
           "staff": ("1d6+19", 25, "Staves (DMG)", r"typically has 1d6\+19 charges")}
# Magical containers (module/containers.mjs): stowage capacity and whether the contents add weight, each checked by
# regex against the item's own page. A bag of holding's size is rolled (its page's table), so the GM sets it.
MAGIC_CONTAINERS = {
    "Bag of Holding (Magic Bag)": ({"weight": None, "volume": "", "weightless": True},
                                   [r"the bag always weighs a fixed amount"]),
    "Heward's Handy Haversack (Magic Bag)": ({"weight": 120, "volume": "8 cu. ft. + 2 pouches of 2 cu. ft.", "weightless": False},
                                             [r"two cubic feet in volume or 20 pounds in weight",
                                              r"eight cubic feet or 80 pounds"]),
    "Portable Hole (Magic Container)": ({"weight": None, "volume": "6 ft. across, 10 ft. deep", "weightless": True},
                                        [r"does not accumulate weight", r"6 feet in diameter", r"10 feet deep"]),
}
GROUPS = {"Priest", "Wizard", "Rogue", "Warrior", "Druid", "Paladin", "Bard", "Thief", "Fighter", "Ranger", "Cleric"}
ICONS = {"book": "icons/svg/book.svg", "scroll": "icons/svg/book.svg"}
GEM_SECTIONS = {"Ornamental Stones": 10, "Semi-Precious Stones": 50, "Fancy to Precious": None, "Gems and Jewels": None}
GEM_CLASS = {10: "ornamental", 50: "semiprecious", 100: "fancy", 500: "precious", 1000: "gem", 5000: "jewel"}


def xp_value(text):
    m = re.search(r"\d[\d,]*", text)
    return int(m.group().replace(",", "")) if m else None


def item_rows(wiki):
    """(page title, label, usable-by groups, XP) for each linked item row of a DMG item table page."""
    out = []
    for line in wiki.split("\n"):
        if not line.startswith("|") or "||" not in line or line.startswith("|+"):
            continue
        cells = [x.strip() for x in line[1:].split("||")]
        if len(cells) < 3:
            continue
        link = re.search(r"\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|([^\]]*))?\]\]", cells[1])
        if not link or "#" in cells[1].split("]]")[0]:
            continue  # unlinked rows (spell scrolls, DM's Choice) and section links (maps)
        rest = cells[1][link.end():].replace("{{br}}", " ")
        groups = [g for m in re.findall(r"\(([^)]*)\)", rest) for g in re.split(r"[,\s]+", m) if g in GROUPS]
        out.append((link.group(1).strip(), (link.group(2) or link.group(1)).strip(), groups, xp_value(cells[2])))
    return out


def mentions_charges(titles):
    """{title: True if the item's page (redirects followed) mentions charges}."""
    out = {}
    for k in range(0, len(titles), 40):
        batch = titles[k:k + 40]
        r = classdata.api(action="query", prop="revisions", rvprop="content", rvslots="main", titles="|".join(batch), redirects=1)
        alias = {x["from"]: x["to"] for x in r["query"].get("redirects", [])}
        alias.update({x["from"]: x["to"] for x in r["query"].get("normalized", [])})
        text = {p["title"]: p.get("revisions", [{}])[0].get("slots", {}).get("main", {}).get("*", "") for p in r["query"]["pages"].values()}
        for t in batch:
            target = alias.get(alias.get(t, t), alias.get(t, t))
            out[t] = bool(re.search(r"\bcharges?\b", text.get(target, ""), re.I))
    return out


def item_name(title):
    return re.sub(r"\s*\((?:Magic|Magical) [^)]*\)$", "", title).strip()


if __name__ == "__main__":
    revs, docs, folders = {}, [], []
    seen = {}
    charge_rules = {}
    for cat, (formula, mx, page, pattern) in CHARGES.items():
        w, rev, _ = classdata.page(page)
        assert re.search(pattern, w), f"{page}: charge rule changed"
        revs[page] = rev
        charge_rules[cat] = (formula, mx)
    for i, (table, cat) in enumerate(TABLES.items()):
        title = f"DMG Table {table}"
        wiki, revs[title], _ = classdata.page(title)
        rows = item_rows(wiki)
        assert rows, title
        folder = classdata.folder_doc(f"magic.{cat}", f"Table {table}", sort=i * 100)
        folders.append((cat, table, folder))
        for page, label, groups, xp in rows:
            if page in seen:
                continue
            seen[page] = True
            formula, mx = charge_rules.get(cat, ("", None))
            system = {"identifier": classdata.slug(item_name(page)), "category": cat, "quantity": 1, "weight": None,
                      "carried": True, "equipped": False,
                      "capacity": {"weight": None, "volume": "", "weightless": False}, "container": "",
                      "charges": {"value": mx or 0, "max": mx, "formula": formula},
                      "usableBy": ", ".join(groups), "identified": True, "xpValue": xp, "gpValue": None,
                      "url": classdata.url(page), "notes": ""}
            docs.append((cat, classdata.item_doc("magic", f"magic.{page}", item_name(page),
                                                 ICONS.get(cat, "icons/svg/item-bag.svg"), system, 0)))
    charged = [d for _, d in docs if d["system"]["charges"]["max"]]
    page_of = lambda d: urllib.parse.unquote(d["system"]["url"].split("/wiki/", 1)[1]).replace("_", " ")
    has = mentions_charges([page_of(d) for d in charged])
    no_charges = []
    for d in charged:
        if not has[page_of(d)]:
            d["system"]["charges"] = {"value": 0, "max": None, "formula": ""}
            no_charges.append(d["name"])
    by_page = {page_of(d): d for _, d in docs}
    for page, (capacity, patterns) in MAGIC_CONTAINERS.items():
        assert page in by_page, f"{page}: not in the DMG tables"
        w, revs[page], _ = classdata.page(page)
        for pattern in patterns:
            assert re.search(pattern, w), f"{page}: {pattern!r} not found"
        by_page[page]["system"]["capacity"] = capacity
    tw, revs["Treasure Tables (DMG)"], _ = classdata.page("Treasure Tables (DMG)")
    gems = []
    for section, default in GEM_SECTIONS.items():
        body = tw[tw.index(f"==={section}===") + len(section) + 6:]
        body = body[:body.index("\n=") if "\n=" in body else len(body)]
        body = body[:body.index("{|")] if "{|" in body else body
        for m in re.finditer(r"^:\s*([^:\n]+?):[^\n]*$", body, re.M):
            name, line = m.group(1).strip(), m.group(0)
            v = re.search(r"\((\d[\d,]*)(?:\s*-\s*(\d[\d,]*))?\s*gp\)?", line)
            low = int(v.group(1).replace(",", "")) if v else default
            high = int(v.group(2).replace(",", "")) if v and v.group(2) else None
            assert low in GEM_CLASS, (section, name, low)
            gems.append({"name": name, "class": GEM_CLASS[low], "range": f"{low:,}-{high:,} gp" if high else ""})
    assert len(gems) > 40 and {g["class"] for g in gems} == set(GEM_CLASS.values()), gems
    revs_text = ", ".join(f"{k} rev {v}" for k, v in revs.items())

    # Folders: magical items by DMG table; gems by class.
    labels = {c["key"]: c["name"] for c in __import__("json").loads(
        open("module/rules/treasure-tables.mjs").read().split("TREASURE_TABLES = ", 1)[1].split(";\n", 1)[0])["magicCategories"]}
    magic_docs = []
    for cat, table, folder in folders:
        folder["name"] = f"Table {table}: {labels[cat].replace('Miscellaneous Magic: ', '')}"
        magic_docs.append(folder)
        for j, (c, d) in enumerate(sorted([x for x in docs if x[0] == cat], key=lambda x: x[1]["name"])):
            d["folder"] = folder["_id"]
            d["sort"] = j * 100
            magic_docs.append(d)
    classdata.write_docs("packs/_source/magic-items", magic_docs)

    gem_docs = []
    for i, (key, label) in enumerate([("ornamental", "Ornamental (10 gp)"), ("semiprecious", "Semi-precious (50 gp)"),
                                      ("fancy", "Fancy (100 gp)"), ("precious", "Precious (500 gp)"),
                                      ("gem", "Gems (1,000 gp)"), ("jewel", "Jewels (5,000 gp)")]):
        folder = classdata.folder_doc(f"gems.{key}", label, sort=i * 100)
        gem_docs.append(folder)
        for j, g in enumerate(sorted([g for g in gems if g["class"] == key], key=lambda g: g["name"])):
            system = {"identifier": classdata.slug(g["name"]), "kind": "gem", "gemClass": key, "uncut": False, "value": None,
                      "quantity": 1, "weight": None, "carried": True, "url": classdata.url("Treasure Tables (DMG)"),
                      "notes": f"DMG value range: {g['range']}" if g["range"] else ""}
            d = classdata.item_doc("jewellery", f"gem.{g['name']}", g["name"], "icons/svg/item-bag.svg", system, j * 100)
            d["folder"] = folder["_id"]
            gem_docs.append(d)
    classdata.write_docs("packs/_source/gems", gem_docs)
    print(f"wrote packs/_source/magic-items: {len(docs)} items in {len(folders)} folders (no charges: {no_charges}); "
          f"packs/_source/gems: {len(gems)} gems; {revs_text}")
