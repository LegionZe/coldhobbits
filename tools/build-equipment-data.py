#!/usr/bin/env python3
"""Generate equipment Items (packs/_source/equipment): the five PHB coins and the Table 44 equipment lists.

Sources (AD&D 2e fandom wiki, MediaWiki API):
  * Table 42: Standard Exchange Rates ("Money and Equipment (PHB)"): each coin's value in copper pieces (parsed by
    build-movement-tables.py build_coins). Coin weight (50 to the pound, DMG) is applied by the system, not stored.
  * Table 44 lists: Clothing, Daily Food and Lodging, Household Provisioning, Transport, Animals, Services, Tack and
    Harness, Miscellaneous Equipment (PHB). Rows with no cost are headings for the rows listed in SUBITEMS; weight
    "*" = "Ten of these items weigh one pound", "**" = "no appreciable weight" (Miscellaneous Equipment footnotes).
  * Table 50: Stowage Capacity and Table 49: Carrying Capacities of Animals ("Encumbrance Tables (PHB)").
Weapons and armour come from build-proficiency-data.py and build-armor-data.py.
Run from the repo root:  python3 tools/build-equipment-data.py
"""
import importlib.util
import re

_spec = importlib.util.spec_from_file_location("classdata", "tools/build-class-data.py")
classdata = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(classdata)
_mspec = importlib.util.spec_from_file_location("movement", "tools/build-movement-tables.py")
movement = importlib.util.module_from_spec(_mspec)
_mspec.loader.exec_module(movement)

# Foundry core icons (the same paths dnd5e uses in json/icon-migration.json and its packs).
ICONS = {"pp": "coins-assorted-mix-platinum", "gp": "coins-plain-stack-gold", "ep": "coin-plain-gold",
         "sp": "coins-assorted-mix-silver", "cp": "coins-assorted-mix-copper"}
NAMES = {"pp": "Platinum piece", "gp": "Gold piece", "ep": "Electrum piece", "sp": "Silver piece", "cp": "Copper piece"}

# page -> (category, folder label, carried by default)
PAGES = {
    "Clothing (PHB)": ("clothing", "Clothing", True),
    "Daily Food and Lodging (PHB)": ("lodging", "Daily Food and Lodging", False),
    "Household Provisioning (PHB)": ("provisions", "Household Provisioning", True),
    "Transport (PHB)": ("transport", "Transport", False),
    "Animals (PHB)": ("animal", "Animals", False),
    "Services (PHB)": ("service", "Services", False),
    "Tack and Harness (PHB)": ("tack", "Tack and Harness", False),
    "Miscellaneous Equipment (PHB)": ("gear", "Miscellaneous Equipment", True),
}
# Heading rows (no cost) and the rows listed under them, per page, in list order.
SUBITEMS = {
    "Clothing (PHB)": {"Boots": ["Riding", "Soft"], "Cloak": ["Good cloth", "Fine fur"], "Robe": ["Common", "Embroidered"]},
    "Daily Food and Lodging (PHB)": {"City rooms (per month)": ["Common", "Poor"],
                                     "Inn lodging (per day/week)": ["Common", "Poor"],
                                     "Meals (per day)": ["Good", "Common", "Poor"]},
    "Household Provisioning (PHB)": {"Spice (per lb.)": ["Exotic (for example, saffron, clove)",
                                                         "Rare (for example, pepper, ginger)", "Uncommon (cinnamon)"]},
    "Transport (PHB)": {"Canoe": ["Small", "War"], "Carriage": ["Common", "Coach, ornamented"], "Chariot": ["Riding", "War"],
                        "Oar": ["Common", "Galley"]},
    "Animals (PHB)": {"Dog": ["Guard", "Hunting", "War"], "Elephant": ["Labor", "War"],
                      "Horse": ["Draft", "Heavy war", "Light war", "Medium war", "Riding"]},
    "Services (PHB)": {},
    "Tack and Harness (PHB)": {"Barding": ["Chain", "Full plate", "Full scale", "Half brigandine", "Half padded", "Half scale",
                                           "Leather or padded"],
                               "Saddle": ["Pack", "Riding"], "Saddle bags": ["Large", "Small"], "Yoke": ["Horse", "Ox"]},
    "Miscellaneous Equipment (PHB)": {"Basket": ["Large", "Small"], "Belt pouch": ["Large", "Small"],
                                      "Chain (per ft.)": ["Heavy", "Light"], "Chest": ["Large", "Small"],
                                      "Cloth (per 10 sq. yds.)": ["Common", "Fine", "Rich"],
                                      "Lantern": ["Beacon", "Bullseye", "Hooded"], "Lock": ["Good", "Poor"],
                                      "Oil (per flask)": ["Greek fire", "Lamp"], "Rope (per 50 ft.)": ["Hemp", "Silk"],
                                      "Sack": ["Large", "Small"], "Tent": ["Large", "Pavilion", "Small"]},
}
PROPER = {"Greek fire"}
# Table 49 mount names -> equipment names.
TABLE49 = {"Camel": ["Camel"], "Dog": ["Dog, guard", "Dog, hunting", "Dog, war"], "Elephant": ["Elephant, labor", "Elephant, war"],
           "Horse, draft": ["Horse, draft"], "Horse, heavy": ["Horse, heavy war"], "Horse, light": ["Horse, light war"],
           "Horse, medium": ["Horse, medium war"], "Horse, riding": ["Horse, riding"], "Mule": ["Donkey, mule, or ass"],
           "Ox": ["Ox"], "Yak": []}


def slug(s):
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")


def clean(cell):
    cell = re.sub(r"\{\{br\}\}", " ", cell)
    cell = re.sub(r"\{\{frac\|(\d+)\|(\d+)\}\}", r"\1/\2", cell)
    return re.sub(r"\s+", " ", cell.replace("&nbsp;", " ").replace("<nowiki>", "").replace("</nowiki>", "")).strip()


def weight(cell):
    """Pounds; '*' = 0.1 (ten to a pound), '**' = 0 (no appreciable weight); ranges and blanks -> None."""
    if cell == "*":
        return 0.1
    if cell == "**":
        return 0.0
    m = re.fullmatch(r"(\d+)(?:/(\d+))?\s*lbs?\.?", cell)
    if not m:
        return None
    return int(m.group(1)) / int(m.group(2)) if m.group(2) else float(m.group(1))


def sub_name(heading, child):
    if "," in child.split("(")[0]:
        return child  # a full name of its own ("Coach, ornamented" under Carriage)
    child = child.replace("for example, ", "")
    base, _, paren = heading.partition(" (")
    child = child if child in PROPER else child[0].lower() + child[1:]
    return f"{base}, {child}" + (f" ({paren}" if paren else "")


def page_rows(title):
    wiki, rev, _ = classdata.page(title)
    t = wiki[wiki.index("{|"):wiki.index("|}")]
    rows = []
    for chunk in re.split(r"\n\|-", t)[1:]:
        cells = [clean(l[1:]) for l in chunk.strip().split("\n") if l.startswith("|") and not l.startswith(("|+", "|}"))]
        if cells:
            rows.append(cells + [""] * (3 - len(cells)))
    return rows, rev


def build_items():
    items, revs = [], {}
    for title, (category, _, carried) in PAGES.items():
        rows, revs[title] = page_rows(title)
        subs = {h: list(c) for h, c in SUBITEMS[title].items()}
        heading = None
        i = 0
        while i < len(rows):
            name, cost, wt = rows[i][:3]
            # a name split over two rows ("Separate latrine for rooms" / "(per month)"; "Exotic" / "(for example...)")
            if not cost and i + 1 < len(rows) and rows[i + 1][0].startswith("("):
                name, cost, wt = f"{name} {rows[i + 1][0]}", rows[i + 1][1], rows[i + 1][2]
                i += 1
            elif name.startswith("(") and items and items[-1]["page"] == title:
                # a second price for the previous item ("Eggs (per 100)" / "(per two dozen)")
                name = re.sub(r"\s*\(.*\)$", "", items[-1]["name"]) + " " + name
            i += 1
            if heading and subs.get(heading) and name == subs[heading][0]:
                subs[heading].pop(0)
                name = sub_name(heading, name)
            elif name in subs:
                heading = name
                assert cost in ("—", ""), f"{title}: heading {name} has a cost"
                continue
            else:
                heading = None
            assert cost not in ("—", ""), f"{title}: no cost for {name}"
            items.append({"page": title, "category": category, "carried": carried, "name": name,
                          "cost": cost.rstrip("*").strip(), "weight": weight(wt) if wt else None,
                          "weightText": "" if weight(wt) is not None or wt in ("", "—") else wt})
        left = {h: c for h, c in subs.items() if c}
        assert not left, f"{title}: sub-items not found: {left}"
    return items, revs


def build_capacities(items):
    wiki, rev, _ = classdata.page("Encumbrance Tables (PHB)")
    by_name = {it["name"]: it for it in items}
    t50 = wiki[wiki.index("Table 50: Stowage Capacity"):]
    t50 = t50[t50.index("{|"):t50.index("|}")]
    for chunk in re.split(r"\n\|-", t50)[1:]:
        cells = [clean(l[1:]) for l in chunk.strip().split("\n") if l.startswith("|") and not l.startswith(("|+", "|}"))]
        if len(cells) == 3:
            assert cells[0] in by_name, f"Table 50 item not in the equipment lists: {cells[0]}"
            by_name[cells[0]]["capacity"] = {"weight": int(re.match(r"\d+", cells[1]).group()), "volume": cells[2]}
    t49 = wiki[wiki.index("Table 49: Carrying Capacities of Animals"):]
    t49 = t49[t49.index("{|"):t49.index("|}")]
    for chunk in re.split(r"\n\|-", t49)[1:]:
        cells = [clean(l[1:]) for l in chunk.strip().split("\n") if l.startswith("|") and not l.startswith(("|+", "|}"))]
        if len(cells) == 4:
            limits = [int(re.search(r"([\d,]+) lbs", c).group(1).replace(",", "")) for c in cells[1:]]
            for name in TABLE49[cells[0]]:
                by_name[name]["load"] = {"full": limits[0], "half": limits[1], "quarter": limits[2]}
    return rev


if __name__ == "__main__":
    values, per_pound, rev42, _ = movement.build_coins()
    items, revs = build_items()
    rev_enc = build_capacities(items)
    names = [it["name"] for it in items]
    dupes = {n for n in names if names.count(n) > 1}
    assert not dupes, dupes

    coin_folder = classdata.folder_doc("equipment.coins", "Coins", sort=0)
    folders = {cat: classdata.folder_doc(f"equipment.{cat}", label, sort=(i + 1) * 1000)
               for i, (cat, label, _) in enumerate(PAGES.values())}
    docs = [coin_folder, *folders.values()]
    for i, key in enumerate(["pp", "gp", "ep", "sp", "cp"]):
        system = {"identifier": key, "denomination": key, "value": values[key], "quantity": 1,
                  "source": "Player's Handbook", "url": classdata.url("Money and Equipment (PHB)"), "notes": ""}
        doc = classdata.item_doc("coin", "c." + key, NAMES[key], f"icons/commodities/currency/{ICONS[key]}.webp",
                                 system, i * 100)
        doc["folder"] = coin_folder["_id"]
        docs.append(doc)
    for i, it in enumerate(items):
        system = {"identifier": slug(it["name"]), "category": it["category"], "cost": it["cost"],
                  "weight": it["weight"], "quantity": 1, "carried": it["carried"],
                  "capacity": it.get("capacity", {"weight": None, "volume": ""}),
                  "load": it.get("load", {"full": None, "half": None, "quarter": None}),
                  "source": "Player's Handbook", "url": classdata.url(it["page"]),
                  "notes": f"Weight: {it['weightText']}" if it["weightText"] else ""}
        doc = classdata.item_doc("equipment", "e." + slug(it["name"]), it["name"], "icons/svg/item-bag.svg", system, i * 100)
        doc["folder"] = folders[it["category"]]["_id"]
        docs.append(doc)
    classdata.write_docs("packs/_source/equipment", docs)
    counts = {cat: sum(it["category"] == cat for it in items) for cat in folders}
    print(f"wrote packs/_source/equipment: 5 coins (Table 42 rev {rev42}), {len(items)} items {counts}; "
          f"Tables 49/50 rev {rev_enc}; pages", revs)
