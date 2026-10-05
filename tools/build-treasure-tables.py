#!/usr/bin/env python3
"""Generate module/rules/treasure-tables.mjs: magical item categories and gem classes (DMG).

Sources (AD&D 2e fandom wiki, MediaWiki API):
  * "Magical Item Tables (DMG)": Table 88 (category per DMG table). Armour, shields and weapons (Tables 105, 108) are
    left out: magical armour and weapons are armour and weapon items with a magical bonus.
  * "Treasure Tables (DMG)": Table 85 Gem Table (base value per class; uncut stones 10% of it) and Table 87 Objects of
    Art (value ranges).
  * Rolling treasure (module/treasure.mjs): Table 84 Treasure Types (amount ranges, chances, magical items text
    parsed into item specs, each letter's spec asserted), Table 85 d100 ranges, Table 86 Gem Variations (rules
    regex-checked), Table 87 d100 ranges, Table 88 d100 ranges (Tables 105 and 108 included for rolling), Tables 89-104
    (subtable die and d20 rows; a linked row names a "Magical Items (DMG)" item by the identifier
    build-magic-item-data.py gives it, other rows are text), Tables 105-110 (armour type, AC adjustment, special armours,
    weapon type, attack adjustment, special weapons). Generic weapon and armour names ("Sword", "Shield", "Pole Arm")
    list the PHB items of that kind (`BASE_ITEMS`, owner's ruling: one picked at random).
Run from the repo root:  python3 tools/build-treasure-tables.py
"""
import importlib.util
import json
import re

_spec = importlib.util.spec_from_file_location("classdata", "tools/build-class-data.py")
classdata = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(classdata)

# Table 88 category -> item category key (the magical item `category` field).
CATEGORY_KEYS = {
    "Potions and Oils": "potion", "Scrolls": "scroll", "Rings": "ring", "Rods": "rod", "Staves": "staff", "Wands": "wand",
    "Miscellaneous Magic: Books and Tomes": "book", "Miscellaneous Magic: Jewels and Jewelry": "jewel",
    "Miscellaneous Magic: Cloaks and Robes": "cloak", "Miscellaneous Magic: Boots and Gloves": "boots",
    "Miscellaneous Magic: Girdles and Helms": "girdle", "Miscellaneous Magic: Bags and Bottles": "bag",
    "Miscellaneous Magic: Dusts and Stones": "dust", "Miscellaneous Magic: Household Items and Tools": "household",
    "Miscellaneous Magic: Musical Instruments": "instrument", "Miscellaneous Magic: The Weird Stuff": "weird",
}
SKIP = {"Armor and Shields", "Weapons"}
GEM_KEYS = {"Ornamental": "ornamental", "Semi-precious": "semiprecious", "Fancy": "fancy", "Precious": "precious",
            "Gems": "gem", "Jewels": "jewel"}


def table(wiki, caption):
    i = wiki.index(caption)
    return wiki[i:wiki.index("|}", i)]


def rows(t):
    out = []
    for chunk in re.split(r"\n\|-", t)[1:]:
        cells = [re.sub(r"\[\[(?:[^\]|]*\|)?([^\]]*)\]\]", r"\1", l.lstrip("|!")).strip()
                 for l in chunk.strip().split("\n") if l.startswith("|") and not l.startswith(("|+", "|}"))]
        if cells:
            out.append(cells)
    return out


def gp(text):
    return int(text.replace(",", "").replace("gp", "").strip())


# Table 105 / 108 names -> PHB armour / weapon item names (the roller picks one at random; owner's ruling).
POLEARMS = ["Awl pike", "Bardiche", "Bec de corbin", "Bill-guisarme", "Fauchard", "Fauchard-fork", "Glaive", "Glaive-guisarme",
            "Guisarme", "Guisarme-voulge", "Halberd", "Hook fauchard", "Lucern hammer", "Military fork", "Partisan", "Ranseur",
            "Spetum", "Voulge"]
BASE_ITEMS = {
    "armor": {"Banded mail": ["Banded mail"], "Brigandine": ["Brigandine"], "Chain mail": ["Chain mail"], "Field plate": ["Field plate"],
              "Full plate": ["Full plate"], "Leather": ["Leather"], "Plate mail": ["Plate mail"], "Ring mail": ["Ring mail"],
              "Scale mail": ["Scale mail"], "Shield": ["Buckler", "Small shield", "Medium shield", "Body shield"],
              "Splint mail": ["Splint mail"], "Studded leather": ["Studded leather"]},
    "weapons": {"Arrow": ["Flight arrow", "Sheaf arrow"], "Axe": ["Hand or throwing axe"], "Battle axe": ["Battle axe"],
                "Bolt": ["Light quarrel", "Heavy quarrel"], "Bullet, Sling": ["Sling bullet"], "Dagger": ["Dagger or dirk"],
                "Dart": ["Dart"], "Flail": ["Footman's flail", "Horseman's flail"], "Javelin": ["Javelin"], "Knife": ["Knife"],
                "Lance": ["Light horse lance", "Medium horse lance", "Heavy horse lance"], "Mace": ["Footman's mace", "Horseman's mace"],
                "Military Pick": ["Footman's pick", "Horseman's pick"], "Morning Star": ["Morning star"], "Pole Arm": POLEARMS,
                "Scimitar": ["Scimitar"], "Spear": ["Spear"],
                "Sword": ["Bastard sword", "Broad sword", "Long sword", "Short sword", "Two-hand. sword"], "Trident": ["Trident"],
                "Warhammer": ["Warhammer"]},
}
# Table 84 "Magical Item" column -> item specs, asserted per letter: kind any / potion / scroll / armorWeapon; count n or dice.
MAGIC_SPECS = {
    "A": [("any", 3)], "B": [("armorWeapon", 1)], "C": [("any", 2)], "D": [("any", 2), ("potion", 1)], "E": [("any", 3), ("scroll", 1)],
    "F": [("anyNoWeapon", 5)], "G": [("any", 5)], "H": [("any", 6)], "I": [("any", 1)], "S": [("potion", "1d8")], "T": [("scroll", "1d4")],
    "U": [("any", 1)], "V": [("any", 2)], "W": [("any", 2)], "X": [("potion", 2)], "Z": [("any", 3)],
}
GEM_VARIATION_RULES = [
    r"there is a 10% chance that any given stone will be above or below its normal value",
    r"Stone increases to the next higher base value\.\s*(?:\{\{br\}\})?\s*Roll again, ignoring all results but 1",
    r"Stone is double base value", r"Stone is 10-60% above the base value", r"Stone is 10-40% below the base value",
    r"Stone is half base value", r"Stone decreased to next lower base value\.\s*(?:\{\{br\}\})?\s*Roll again, ignoring all results but 6",
    r"Above 5,000 gp, the base value of the stone doubles each time\. No stone can be greater than 100,000 gp",
    r"Below 10 gp, values decrease to 5 gp, 1 gp, 5 sp, 1 sp\. No stone can be worth less than 1 sp and no stone can decrease more than five places",
]


def roll_range(text):
    """'01-25' -> (1, 25); '00' / '100' -> (100, 100); '5' -> (5, 5)."""
    t = text.strip().replace("–", "-")
    if t in ("00", "100"):
        return 100, 100
    a, _, b = t.partition("-")
    return int(a), int(b or a)


def amount(text):
    """'1,000-{{br}}3,000' -> [1000, 3000]; '—' -> None."""
    t = re.sub(r"\{\{br\}\}|\s", "", text).replace(",", "")
    m = re.match(r"(\d+)-(\d+)$", t)
    return [int(m.group(1)), int(m.group(2))] if m else None


def magic_spec(text):
    t = re.sub(r"\{\{br\}\}|\s+", " ", text).strip()
    out = []
    if re.search(r"Armor Weapon", t):
        out.append(("armorWeapon", 1))
    m = re.search(r"Any (\d+)(?! potions)", t)
    if m:
        out.append(("anyNoWeapon" if "except weapons" in t else "any", int(m.group(1))))
    m = re.search(r"\+ (\d+) (potion|scroll)", t)
    if m:
        out.append((m.group(2), int(m.group(1))))
    m = re.match(r"(\d+)-(\d+) (potions|scrolls)", t)
    if m:
        out.append((m.group(3)[:-1], f"1d{m.group(2)}"))
        assert m.group(1) == "1", t
    m = re.match(r"Any (\d+) potions", t)
    if m:
        out.append(("potion", int(m.group(1))))
    return out


def treasure_types(tw):
    """Table 84: {letter: {cp, sp, gp, pe, gems, art: {range, chance}, magic: {items, chance}}}."""
    cols = ["cp", "sp", "gp", "pe", "gems", "art", "magic"]
    out = {}
    start = tw.index("Table 84: Treasure Types</h3>")
    body = tw[start:tw.index("DM's choice", start)]
    for t in re.findall(r"\{\|.*?\n\|\}", tw[start - 400:start + len(body) + 50], re.S):
        chunks = re.split(r"\n\|-", t)[1:]
        rowsx = []
        for ch in chunks:
            cells = []
            for line in ch.strip().split("\n"):
                if line.startswith(("|+", "|}", "!")):
                    continue
                if line.startswith("|"):
                    cells.append(line.lstrip("|").strip())
                elif cells and line.strip():
                    cells[-1] += " " + line.strip()  # a cell continued on the next line (E: "Any 3" / "+ 1 scroll")
            rowsx.append(cells)
        rowsx = [r for r in rowsx if r]
        i = 0
        while i < len(rowsx):
            r = rowsx[i]
            if r and re.fullmatch(r"[A-Z]", r[0]):
                vals = r[1:] + [""] * (7 - len(r[1:]))
                # values may continue on following lines of the same cell (E's "Any 3 + 1 scroll")
                chances = rowsx[i + 1][1:] if i + 1 < len(rowsx) and rowsx[i + 1] and rowsx[i + 1][0] == "" else []
                chances = chances + [""] * (7 - len(chances))
                entry = {}
                for k, v, c in zip(cols, vals, chances):
                    c = c.strip()
                    chance = int(c[:-1]) if c.endswith("%") else 100
                    if k == "magic":
                        items = magic_spec(v)
                        if items:
                            entry[k] = {"items": [{"kind": a, "count": b} for a, b in items], "chance": chance}
                    else:
                        rng = amount(v)
                        if rng:
                            entry[k] = {"range": rng, "chance": chance}
                out[r[0]] = entry
            i += 1
    return out


def magic_tables(tables):
    """Tables 89-104: {table: {die, subtables: [{min, max, rows: [{min, max, id | text, xp}]}]}}."""
    _mspec = importlib.util.spec_from_file_location("magicdata", "tools/build-magic-item-data.py")
    magicdata = importlib.util.module_from_spec(_mspec)
    _mspec.loader.exec_module(magicdata)
    out, revs = {}, {}
    for table in tables:
        title = f"DMG Table {table}"
        w, revs[title], _ = classdata.page(title)
        die = re.search(r"==\s*Table \d+[^=\n]*?\(D(\d+)\)", w)
        subs = []
        for t in re.finditer(r"\{\|.*?\n\|\}", w, re.S):
            before = w[max(0, t.start() - 120):t.start()] + t.group(0)[:200]
            m = re.search(r"Subtable ([A-Z]) \(?(\d+)(?:-(\d+))?\)?", before)
            rows_ = []
            for line in t.group(0).split("\n"):
                if not line.startswith("|") or "||" not in line or line.startswith("|+"):
                    continue
                cells = [x.strip() for x in line[1:].split("||")]
                if len(cells) < 3 or not re.match(r"\d", cells[0]):
                    continue
                lo, hi = roll_range(cells[0])
                link = re.search(r"\[\[([^\]|#]+)(#[^\]|]*)?(?:\|([^\]]*))?\]\]", cells[1])
                row = {"min": lo, "max": hi}
                if link and not link.group(2):
                    row["id"] = classdata.slug(magicdata.item_name(link.group(1).strip()))
                    row["name"] = magicdata.item_name(link.group(1).strip())
                else:
                    text = re.sub(r"\[\[(?:[^\]|]*\|)?([^\]]*)\]\]", r"\1", cells[1]).replace("'" * 3, "").strip()
                    if table == 90 and re.match(r"\d spells?$", text):
                        # "Ranges marked with double asterisks (**) are used to determine priest spells."
                        assert re.search(r"Ranges marked with double asterisks \(\*\*\) are used to determine priest spells", w)
                        levels = re.sub(r"\((\d+-\d+)\*\*\)", r"(priest \1)", cells[2])
                        text = f"Spell scroll: {text}, levels {levels}"
                    row["text"] = text
                rows_.append(row)
            if not rows_:
                continue
            lo, hi = (int(m.group(2)), int(m.group(3) or m.group(2))) if m else (1, int(die.group(1)) if die else 1)
            subs.append({"min": lo, "max": hi, "rows": rows_})
        for sub in subs:
            got = sorted((r["min"], r["max"]) for r in sub["rows"])
            assert got[0][0] == 1 and got[-1][1] == 20 and all(a[1] + 1 == b[0] for a, b in zip(got, got[1:])), (table, got)
        dmax = int(die.group(1)) if die else None
        if dmax:
            spans = sorted((s["min"], s["max"]) for s in subs)
            assert spans[0][0] == 1 and spans[-1][1] == dmax and all(a[1] + 1 == b[0] for a, b in zip(spans, spans[1:])), (table, spans)
        else:
            assert len(subs) == 1, (table, len(subs))
        out[table] = {"die": f"1d{dmax}" if dmax else None, "subtables": subs}
    return out, revs


def simple_table(w, caption_re, cols):
    """Rows of a d20 table under a heading/caption: [{min, max, <cols>...}]."""
    m = re.search(caption_re, w)
    t = w[m.end():]
    t = t[t.index("{|"):t.index("|}")]
    out = []
    for chunk in re.split(r"\n\|-", t)[1:]:
        cells = [re.sub(r"\[\[(?:[^\]|]*\|)?([^\]]*)\]\]", r"\1", c.lstrip("|").strip()).strip()
                 for line in chunk.strip().split("\n") if line.startswith("|") and not line.startswith(("|+", "|}"))
                 for c in line[1:].split("||")]
        if len(cells) >= len(cols) + 1 and re.match(r"\d", cells[0]):
            lo, hi = roll_range(cells[0])
            out.append({"min": lo, "max": hi, **dict(zip(cols, cells[1:]))})
    return out


def arms_tables():
    """Tables 105-110."""
    w5, rev5, _ = classdata.page("DMG Table 105")
    w8, rev8, _ = classdata.page("DMG Table 108")
    armor = simple_table(w5, r"==Table 105: Armor Type==", ["name"])
    ac = [{"min": r["min"], "max": r["max"], "adj": int(r["adj"].replace("–", "-")), "xp": xp(r["xp"])}
          for r in simple_table(w5, r"==Table 106: Armor Class Adjustment==", ["adj", "xp"])]
    special_armor = [{"min": r["min"], "max": r["max"], "name": r["name"], "xp": r["xp"]}
                     for r in simple_table(w5, r"==Table 107: Special Armors==", ["name", "xp"])]
    # Table 108: one wiki table with two subtables side by side (roll, weapon, roll, weapon).
    t = w8[w8.index("==Table 108"):]
    t = t[t.index("{|"):t.index("|}")]
    a, b = [], []
    for line in t.split("\n"):
        if line.startswith("|") and "||" in line:
            cells = [x.strip() for x in line[1:].split("||")]
            if cells[0] and re.match(r"\d", cells[0]):
                a.append({**dict(zip(("min", "max"), roll_range(cells[0]))), "name": cells[1]})
            if len(cells) > 3 and cells[2] and re.match(r"\d", cells[2]):
                b.append({**dict(zip(("min", "max"), roll_range(cells[2]))), "name": cells[3]})
    assert re.search(r"Subtable A \(1-2\).*Subtable B \(3-6\)", t, re.S), "Table 108 subtables changed"
    weapon = {"die": "1d6", "subtables": [{"min": 1, "max": 2, "rows": a}, {"min": 3, "max": 6, "rows": b}]}
    attack = [{"min": r["min"], "max": r["max"], "sword": int(r["sword"]), "swordXp": xp(r["swordXp"]), "other": int(r["other"]), "otherXp": xp(r["otherXp"])}
              for r in simple_table(w8, r"==Table 109: Attack Roll Adjustment==", ["sword", "swordXp", "other", "otherXp"])]
    # Table 110: subtables (D10), linked special weapons as text with their page.
    t10 = w8[w8.index("==Table 110"):]
    special = []
    for m in re.finditer(r"===Subtable ([A-Z]) \((\d+)(?:-(\d+))?\)===", t10):
        part = t10[m.end():]
        part = part[part.index("{|"):part.index("|}")]
        rows_ = []
        for line in part.split("\n"):
            if line.startswith("|") and "||" in line and not line.startswith("|+"):
                cells = [x.strip() for x in line[1:].split("||")]
                if re.match(r"\d", cells[0]):
                    link = re.search(r"\[\[([^\]|]+)(?:\|([^\]]*))?\]\]", cells[1])
                    row = {**dict(zip(("min", "max"), roll_range(cells[0]))),
                           "text": (link.group(2) or link.group(1)).strip() if link else cells[1], "xp": cells[2]}
                    if link:
                        row["url"] = classdata.url(link.group(1).strip())
                    rows_.append(row)
        special.append({"min": int(m.group(2)), "max": int(m.group(3) or m.group(2)), "rows": rows_})
    for r in special_armor:
        link = re.search(r"\[\[([^\]|]+)", r["name"])
    for tbl, name in ((armor, "105"), (ac, "106"), (special_armor, "107"), (a, "108A"), (b, "108B"), (attack, "109")):
        got = sorted((r["min"], r["max"]) for r in tbl)
        assert got[0][0] == 1 and got[-1][1] == 20 and all(x[1] + 1 == y[0] for x, y in zip(got, got[1:])), (name, got)
    for sub in special:
        got = sorted((r["min"], r["max"]) for r in sub["rows"])
        assert got[0][0] == 1 and got[-1][1] == 20, ("110", got)
    assert [(s["min"], s["max"]) for s in special] == [(1, 3), (4, 6), (7, 9), (10, 10)], special
    # Every Table 105/108 name is either "Special" or a BASE_ITEMS key.
    for r in armor:
        assert r["name"] == "Special" or r["name"] in BASE_ITEMS["armor"], r
    for r in a + b:
        base = re.sub(r"\s*\(.*\)$", "", r["name"]).strip()
        assert r["name"].startswith("Special") or base in BASE_ITEMS["weapons"], r
        q = re.search(r"\((\d+d\d+)\)", r["name"])
        r["base"] = base
        if q:
            r["quantity"] = q.group(1)
    return {"armor": armor, "acAdjust": ac, "specialArmor": special_armor, "weapon": weapon, "attackAdjust": attack,
            "specialWeapons": {"die": "1d10", "subtables": special}}, {"DMG Table 105": rev5, "DMG Table 108": rev8}


def xp(text):
    m = re.search(r"\d[\d,]*", text or "")
    return int(m.group().replace(",", "")) if m else None


if __name__ == "__main__":
    mw, rev88, _ = classdata.page("Magical Item Tables (DMG)")
    categories = []
    for roll, cat in rows(table(mw, "Table 88: Magical Items")):
        m = re.match(r"Table (\d+): (.+)", cat)
        name = m.group(2).strip()
        if name in SKIP:
            continue
        categories.append({"key": CATEGORY_KEYS[name], "table": int(m.group(1)), "name": name})
    assert [c["table"] for c in categories] == list(range(89, 105)), categories

    tw, rev85, _ = classdata.page("Treasure Tables (DMG)")
    gems = [{"key": GEM_KEYS[r[2]], "name": r[2], "value": gp(r[1])} for r in rows(table(tw, "Table 85: Gem Table"))]
    assert [g["value"] for g in gems] == [10, 50, 100, 500, 1000, 5000], gems
    assert "base value reduced to 10%" in tw, "uncut stone rule changed"
    art = [[gp(x) for x in r[1].split("-")] for r in rows(table(tw, "Table 87: Objects of Art"))]
    assert art[0] == [10, 100] and art[-1] == [2000, 12000] and len(art) == 12, art

    # Table 88 with roll ranges (armour and weapons included for rolling).
    t88 = []
    for roll, cat in rows(table(mw, "Table 88: Magical Items")):
        m = re.match(r"Table (\d+): (.+)", cat)
        lo, hi = roll_range(roll)
        key = CATEGORY_KEYS.get(m.group(2).strip()) or {"Armor and Shields": "armor", "Weapons": "weapon"}[m.group(2).strip()]
        t88.append({"min": lo, "max": hi, "key": key, "table": int(m.group(1))})
    assert t88[0]["min"] == 1 and t88[-1]["max"] == 100 and all(a["max"] + 1 == b["min"] for a, b in zip(t88, t88[1:])), t88
    gem_rolls = [{"min": roll_range(r[0])[0], "max": roll_range(r[0])[1], "key": GEM_KEYS[r[2]]} for r in rows(table(tw, "Table 85: Gem Table"))]
    assert gem_rolls[-1] == {"min": 100, "max": 100, "key": "jewel"}, gem_rolls
    art_rolls = [{"min": roll_range(r[0])[0], "max": roll_range(r[0])[1], "range": [gp(x) for x in r[1].split("-")]}
                 for r in rows(table(tw, "Table 87: Objects of Art"))]
    assert art_rolls[0]["min"] == 1 and art_rolls[-1]["max"] == 100, art_rolls
    flat = re.sub(r"\s+", " ", tw)
    for pattern in GEM_VARIATION_RULES:
        assert re.search(pattern, flat), f"Table 86 rule changed: {pattern}"
    types = treasure_types(tw)
    assert sorted(types) == [chr(c) for c in range(ord("A"), ord("Z") + 1)], sorted(types)
    for letter, spec in MAGIC_SPECS.items():
        got = [(x["kind"], x["count"]) for x in types[letter].get("magic", {}).get("items", [])]
        assert got == spec, (letter, got, spec)
    assert all("magic" not in types[x] for x in "JKLMNOPQRY"), "unexpected magic in small treasures"
    assert types["A"]["cp"] == {"range": [1000, 3000], "chance": 25} and types["J"]["cp"] == {"range": [3, 24], "chance": 100}, (types["A"], types["J"])
    assert types["Z"]["magic"]["chance"] == 50 and types["S"]["magic"]["chance"] == 100, types["Z"]
    magic, mrevs = magic_tables(range(89, 105))
    arms, arevs = arms_tables()
    rolling = {"types": types, "magicTable": t88, "gemRolls": gem_rolls, "artRolls": art_rolls,
               "gemLadder": [0.1, 0.5, 1, 5, 10, 50, 100, 500, 1000, 5000], "gemMax": 100000, "gemVariationChance": 10,
               "maxSteps": 5, "magic": magic, "arms": arms, "baseItems": BASE_ITEMS}
    data = {"magicCategories": categories, "gemClasses": gems, "uncutFactor": 0.1, "artValues": art}
    lines = ["/**",
             " * GENERATED by tools/build-treasure-tables.py - do not edit by hand.",
             f" *   Table 88 (magical item categories, DMG Tables 89-104): {classdata.url('Magical Item Tables (DMG)')} (revision {rev88})",
             f" *   Table 85 (gem base values; uncut stones 10%), Table 87 (objects of art): {classdata.url('Treasure Tables (DMG)')} (revision {rev85})",
             " */",
             "export const TREASURE_TABLES = " + json.dumps(data) + ";", "",
             "/**",
             " * Rolling treasure (module/treasure.mjs): Table 84 types, Tables 85-87 rolls, Table 88 ranges, Tables 89-110.",
             *[f" *   {t}: {classdata.url(t)} (revision {r})" for t, r in {**mrevs, **arevs}.items()],
             " */",
             "export const TREASURE_ROLLS = " + json.dumps(rolling) + ";", ""]
    open("module/rules/treasure-tables.mjs", "w").write("\n".join(lines))
    print("wrote module/rules/treasure-tables.mjs:", [c["key"] for c in categories], [(g["key"], g["value"]) for g in gems])
