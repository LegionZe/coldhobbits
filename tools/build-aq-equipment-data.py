#!/usr/bin/env python3
"""Generate the "Al-Qadim Equipment (AA)" compendium (packs/_source/aq-equipment).

Sources (AD&D 2e fandom wiki, MediaWiki API):
  * "Equipment Lists (AA)": the Arabian Adventures price lists (Clothing, Food and Lodgings, Household Provisions and
    Bulk Goods, Animals, Tack and Harness, Transport, Miscellaneous Equipment) and "New Zakharan Weapons" (cost, weight,
    size, type, speed, damage). Each list gives three prices, "A" asking, "N" normal, "B" bargain ("At the Bazaar (AA)");
    the item cost is the normal price, the other two are kept in the notes. The Services and Slaves lists are not items
    and are left out; the familiar weapons and armour of the list are the PHB items (Weapons (PHB), Armour (PHB) packs).
  * "Equipment Descriptions (AA)": weapon rules the table does not show (jambiya and katar thrown or not, tufenk),
    lamellar armour and the daraq shield. Lamellar's Armor Class comes from "Armor in Fiery Zakhara (AA)" Table 6.
Price cells on the wiki contain scanning errors ("6 pg", "5 pp" between gold prices): "Electrum and platinum pieces
are not commonly available in the Land of Fate" and prices are "given in standard AD&D game currency: copper, silver,
and gold" (At the Bazaar (AA)), so pp/pg are read as gp. A price without a number is left blank (noted).
Weapon proficiencies for the new weapons are included (one slot each, as PHB weapons).
Run from the repo root after build-proficiency-data.py and build-armor-data.py:  python3 tools/build-aq-equipment-data.py
"""
import importlib.util
import json
import re

_spec = importlib.util.spec_from_file_location("classdata", "tools/build-class-data.py")
classdata = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(classdata)

SOURCE = "Al-Qadim: Arabian Adventures"
LISTS = "Equipment Lists (AA)"
# Section heading -> (equipment category, folder label, carried by default)
SECTIONS = {
    "Clothing": ("clothing", "Clothing", True),
    "Food and Lodgings": ("lodging", "Food and Lodgings", False),
    "Household Provisions and Bulk Goods": ("provisions", "Household Provisions and Bulk Goods", True),
    "Animals": ("animal", "Animals", False),
    "Tack and Harness": ("tack", "Tack and Harness", False),
    "Transport": ("transport", "Transport", False),
    "Miscellaneous Equipment": ("gear", "Miscellaneous Equipment", True),
}
# New Zakharan weapons: rules from "Equipment Descriptions (AA)" (regex that must match, and what it sets).
WEAPON_RULES = {
    "Jambiya": (r"poor throwing weapon; its maximum range is 1", "Thrown: maximum range 1 (Equipment Descriptions (AA))."),
    "Katar (punch dagger)": (r"The katar cannot serve as a thrown weapon", ""),
    "Scythe": (r"The scythe is a two-handed weapon", "Two-handed; the blade can be locked straight to receive a charge."),
    "Sword, cutlass": (r"\+1 benefit while parrying.*increase punching damage to 1d3",
                       "+1 when parrying (optional rule); punches with the hilt do 1d3."),
    "Tufenk": (r"maximum range is 10 feet.*2d6 points of damage in round two, and 1d6 in rounds three and four.*"
               r"rate of fire is one attack every three rounds.*statistics match those of a quarterstaff",
               "Projects Greek fire 10 ft: lit in round 1, 2d6 in round 2, 1d6 in rounds 3 and 4; one attack every three "
               "rounds; two-handed. As a melee weapon it is a quarterstaff."),
}


def clean(cell):
    cell = re.sub(r"\{\{br\}\}", " ", cell)
    cell = re.sub(r"\{\{frac\|(\d+)\|(\d+)\}\}", r"\1/\2", cell)
    cell = re.sub(r"style=\"[^\"]*\"\s*\|", "", cell)
    return re.sub(r"\s+", " ", cell.replace("&nbsp;", " ")).strip()


def price(cell):
    """'15 gp' -> '15 gp'; scanning errors pp/pg -> gp; no number -> ''."""
    c = clean(cell).replace(",", ",")
    m = re.fullmatch(r"([\d,]+)\s*(cp|sp|gp|pp|pg)", c.replace(" ", " "))
    if not m:
        m = re.fullmatch(r"([\d,]+)(cp|sp|gp|pp|pg)", c.replace(" ", ""))
    if not m:
        return ""
    unit = {"pp": "gp", "pg": "gp"}.get(m.group(2), m.group(2))
    return f"{m.group(1)} {unit}"


def weight(cell):
    """Pounds: '*' = 0.1 (ten to a pound), '**' = 0 (no appreciable weight), '1/2' = 0.5; ranges, blanks -> None."""
    c = clean(cell)
    if c == "*":
        return 0.1
    if c == "**":
        return 0.0
    m = re.fullmatch(r"(\d+)(?:/(\d+))?", c)
    if not m:
        return None
    return int(m.group(1)) / int(m.group(2)) if m.group(2) else float(m.group(1))


def tables(wiki):
    """{section heading: [row cells]} for every ==Section== table (header rows start with '!')."""
    out = {}
    for m in re.finditer(r"^==([^=]+)==\s*$", wiki, re.M):
        start = wiki.find("{|", m.end())
        nxt = re.search(r"^==[^=]", wiki[m.end():], re.M)
        if start < 0 or (nxt and start > m.end() + nxt.start()):
            continue
        t = wiki[start:wiki.index("\n|}", start)]
        rows = []
        for chunk in re.split(r"\n\|-", t)[1:]:
            lines = [l for l in chunk.strip().split("\n") if l.startswith("|") and not l.startswith(("|+", "|}"))]
            if not lines:
                continue
            cells = [clean(c) for l in lines for c in l[1:].split("||")]
            rows.append(cells)
        out[m.group(1).strip()] = rows
    return out


def slug(s):
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")


def load(path):
    return json.load(open(path))


def write_docs(folder, docs):
    """As classdata.write_docs, but file names carry the item type (a weapon and its proficiency share an identifier)."""
    import os
    import shutil
    if os.path.isdir(folder):
        shutil.rmtree(folder)
    os.makedirs(folder)
    seen = set()
    for d in docs:
        name = f"{d['type']}-{d['system']['identifier']}" if "system" in d else f"_folder-{d['_key'].split('!')[-1]}"
        if d.get("type") == "equipment":
            name = f"{d['system']['category']}-{d['system']['identifier']}"
        assert name not in seen, f"duplicate file {name}"
        seen.add(name)
        with open(os.path.join(folder, f"{name}.json"), "w") as f:
            json.dump(d, f, indent=2, ensure_ascii=False)
            f.write("\n")


if __name__ == "__main__":
    wiki, rev, _ = classdata.page(LISTS)
    desc, rev_desc, _ = classdata.page("Equipment Descriptions (AA)")
    armor_wiki, rev_armor, _ = classdata.page("Armor in Fiery Zakhara (AA)")
    bazaar, rev_bazaar, _ = classdata.page("At the Bazaar (AA)")
    assert re.search(r'"A" stands for asking price.*"N" is the normal price, while "B" is the bargain price', bazaar), "price columns changed"
    assert re.search(r"Electrum and platinum pieces are not commonly available", bazaar), "currency note changed"
    secs = tables(wiki)
    folders, docs, counts, blank = {}, [], {}, []
    for i, (section, (category, label, carried)) in enumerate(SECTIONS.items()):
        assert section in secs, f"{LISTS}: no table under =={section}=="
        folder = classdata.folder_doc(f"aq.{category}", label, sort=(i + 2) * 1000)
        folders[section] = folder
        n = 0
        for cells in secs[section]:
            name = cells[0]
            if not name or len(cells) < 4:
                continue
            a, norm, b = cells[1:4]
            wt = cells[4] if len(cells) > 4 else ""
            cost = price(norm)
            if not cost:
                blank.append(name)
            notes = [f"Asking {price(a) or '—'}, bargain {price(b) or '—'} (Arabian Adventures; bargain price with haggling)."]
            if not cost:
                notes.append("No normal price on the source page.")
            w = weight(wt) if wt else None
            if wt and w is None:
                notes.append(f"Weight: {wt} lb.")
            name = name.rstrip("*").strip()
            system = {"identifier": slug(name), "category": category, "cost": cost, "weight": w, "quantity": 1,
                      "carried": carried, "capacity": {"weight": None, "volume": ""},
                      "load": {"full": None, "half": None, "quarter": None},
                      "source": SOURCE, "url": classdata.url(LISTS), "notes": " ".join(notes)}
            doc = classdata.item_doc("equipment", f"aq.e.{category}.{slug(name)}", name, "icons/svg/item-bag.svg", system, n * 100)
            doc["folder"] = folder["_id"]
            docs.append(doc)
            n += 1
        counts[label] = n

    # New Zakharan weapons (and their proficiencies).
    wfolder = classdata.folder_doc("aq.weapons", "New Zakharan Weapons", sort=0)
    pfolder = classdata.folder_doc("aq.proficiencies", "Weapon Proficiencies", sort=500)
    staff = load("packs/_source/weapons/quarterstaff.json")["system"]["weapon"]
    weapons = [c for c in secs["New Zakharan Weapons"] if len(c) >= 10]
    assert len(weapons) == 9, weapons
    for pat, _ in WEAPON_RULES.values():
        assert re.search(pat, desc, re.S), f"Equipment Descriptions (AA) changed: {pat}"
    wdocs = []
    for j, c in enumerate(weapons):
        name, a, norm, b, wt, size, wtype, speed, sm, l = c[:10]
        dmg = lambda d: d.replace(" ", "")
        if name == "Tufenk":
            # Melee: quarterstaff statistics. The Greek fire attack (damage over three rounds, no Strength bonus) is
            # described in the notes and rolled by hand; the weapon damage roll would add Strength.
            weapon = dict(staff, size=size, speed=int(speed))
        else:
            weapon = {"size": size, "type": wtype, "speed": int(speed),
                      "damage": [{"label": "", "sm": dmg(sm), "l": dmg(l), "speed": None}], "melee": True, "missile": False,
                      "range": {"rof": "", "short": "", "medium": "", "long": ""}, "family": "other", "missileColumn": "",
                      "strength": "full"}
        key = slug(name)
        note = WEAPON_RULES.get(name, ("", ""))[1]
        prof = {"identifier": key, "kind": "weapon", "slots": 1, "ability": None, "modifier": None, "groups": [],
                "sp": {"ability": "", "rating": None, "cost": None}, "weapon": weapon, "source": SOURCE,
                "url": classdata.url("Equipment Descriptions (AA)"), "notes": note}
        pdoc = classdata.item_doc("proficiency", f"aq.p.{key}", name, "icons/svg/sword.svg", prof, j * 100)
        pdoc["folder"] = pfolder["_id"]
        item = {"identifier": key, "proficiency": key, "weapon": weapon, "cost": price(norm), "weight": weight(wt),
                "quantity": 1, "equipped": False, "bonus": {"hit": 0, "dmg": 0}, "source": SOURCE,
                "url": classdata.url(LISTS),
                "notes": " ".join(x for x in [note, f"Asking {price(a)}, bargain {price(b)} (Arabian Adventures)."] if x)}
        wdoc = classdata.item_doc("weapon", f"aq.w.{key}", name, "icons/svg/sword.svg", item, j * 100)
        wdoc["folder"] = wfolder["_id"]
        wdocs += [wdoc, pdoc]

    # Armour: lamellar (Table 6 AC; Armor list cost and weight) and the daraq (as the PHB buckler).
    afolder = classdata.folder_doc("aq.armor", "Armour", sort=1000)
    t6 = {r[0]: r for r in classdata.table_rows(armor_wiki, "Table 6: Armor Class Ratings and Penalties")}
    lam_ac = int(t6["Lamellar Armor"][1])
    lam = next(c for c in secs["Armor"] if c[0] == "Lamellar")
    assert re.search(r"Lamellar is a type of scale mail", desc) and re.search(r"Similar to the western buckler", desc)
    buckler = load("packs/_source/armor/buckler.json")["system"]
    adocs = []
    lamellar = {"identifier": "lamellar", "kind": "body", "ac": lam_ac, "shield": {"melee": 0, "missile": 0, "attacks": None},
                "bonus": 0, "equipped": False, "cost": price(lam[2]), "weight": weight(lam[4]), "source": SOURCE,
                "url": classdata.url("Equipment Descriptions (AA)"),
                "notes": f"Asking {price(lam[1])}, bargain {price(lam[3])} (Arabian Adventures). AC from Armor in Fiery Zakhara (AA) Table 6."}
    daraq = dict(buckler, identifier="daraq", cost="", source=SOURCE, url=classdata.url("Equipment Descriptions (AA)"),
                 notes="As the buckler (\"Similar to the western buckler\"): fends off one opponent per round. No price on the AA lists; "
                       "the PHB buckler costs " + buckler["cost"] + ".")
    for k, (key, name, system, img) in enumerate([("lamellar", "Lamellar", lamellar, "icons/svg/statue.svg"),
                                                  ("daraq", "Shield, daraq", daraq, "icons/svg/shield.svg")]):
        d = classdata.item_doc("armor", f"aq.a.{key}", name, img, system, k * 100)
        d["folder"] = afolder["_id"]
        adocs.append(d)

    write_docs("packs/_source/aq-equipment", [wfolder, pfolder, afolder, *folders.values(), *wdocs, *adocs, *docs])
    print(f"wrote packs/_source/aq-equipment: {len(weapons)} weapons (+ proficiencies), 2 armour, {sum(counts.values())} items "
          f"{counts}; no normal price: {blank}; revs: lists {rev}, descriptions {rev_desc}, armor {rev_armor}, bazaar {rev_bazaar}")
