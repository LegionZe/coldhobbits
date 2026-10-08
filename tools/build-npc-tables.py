#!/usr/bin/env python3
"""Generate module/rules/npc-tables.mjs: data for the random NPC builder (module/npc-builder.mjs).

Sources (AD&D 2e fandom wiki, MediaWiki API), tables parsed and rules regex-checked:
  - "Hirelings (DMG)": Table 60 NPC professions (names only); experts' skills "can be determined by using the optional
    proficiency system"; Table 65 wages come from the Hirelings & Mounts sources (build-hireling-data.py).
  - "Soldiers (DMG)": Table 64 military occupations (title, monthly wage); each must be a Hirelings & Mounts actor.
  - "DMG Table 61" (sage fields of study, frequency), "The Assassin, the Spy, and the Sage (DMG)" ("Sage ability is equal
    to 14 plus 1d6").
  - "DMG Table 66" / "67" / "68" (titles by culture column), "DMG Table 69" (NPC spell costs).
  - "Personality (DMG)": base morale ("The base morale for henchmen is 12 and the base for a hireling is 10").
  - "Character Race Tables (PHB)": Table 10 heights (base male/female inches + dice).
Curated (asserted against the compendium sources): `PROFESSION_PROFS` (Table 60 profession -> nonweapon proficiency,
implementation choice: the proficiency the trade names), `CLASS_GEAR` (implementation choice: a basic weapon and armour
set per class within its weapon and armour rules).
Run from the repo root (after build-hireling-data.py and build-travel-tables.py):  python3 tools/build-npc-tables.py
"""
import importlib.util
import json
import os
import re

_spec = importlib.util.spec_from_file_location("classdata", "tools/build-class-data.py")
classdata = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(classdata)
_tspec = importlib.util.spec_from_file_location("travel", "tools/build-travel-tables.py")
travel = importlib.util.module_from_spec(_tspec)
_tspec.loader.exec_module(travel)
need, table = travel.need, travel.table

PROFESSION_PROFS = {
    "Apothecary": "herbalism", "Architect": "engineering", "Armorer": "armorer", "Arrowsmith": "bowyer-fletcher",
    "Astrologer": "astrology", "Baker": "cooking", "Barber": "healing", "Barrister": "law", "Beggar": "begging",
    "Blacksmith": "blacksmithing", "Bladesmith": "weaponsmithing", "Bookbinder": "bookbinding", "Bowyer": "bowyer-fletcher",
    "Brewer": "brewing", "Bricklayer": "stonemasonry", "Carpenter": "carpentry", "Carter": "animal-handling",
    "Cartwright": "carpentry", "Carver": "sculpting", "Clerk": "reading-writing", "Cobbler": "cobbling", "Cook": "cooking",
    "Cordwainer": "cobbling", "Dragoman": "languages-modern", "Embroiderer": "seamstress-tailor", "Farrier": "blacksmithing",
    "Fisherman": "fishing", "Fletcher": "bowyer-fletcher", "Furrier": "leatherworking", "Gem-cutter": "gem-cutting",
    "Glassblower": "glassblowing", "Glover": "leatherworking", "Goldsmith": "metalworking", "Groom": "animal-handling",
    "Herald": "heraldry", "Herbalist": "herbalism", "Interpreter": "languages-modern", "Leech": "healing", "Limner": "painting",
    "Locksmith": "locksmithing", "Mason": "stonemasonry", "Miner": "mining", "Minstrel": "musical-instrument",
    "Navigator": "navigation", "Painter": "painting", "Ploughman": "agriculture", "Potter": "pottery", "Saddler": "leatherworking",
    "Sailor": "seamanship", "Scribe": "scribe", "Scrivener": "reading-writing", "Seamstress": "seamstress-tailor",
    "Shepherd": "herding", "Shipwright": "shipwright", "Skinner": "leatherworking", "Swineherd": "herding",
    "Tailor": "seamstress-tailor", "Tanner": "leatherworking", "Teamster": "animal-handling", "Trapper": "set-snares",
    "Vintner": "winemaking", "Weaver": "weaving", "Wheelwright": "carpentry"}
# Table 60 professions that are their own builder purposes.
OWN_PURPOSE = {"Assassin", "Sage", "Spy"}
PROFESSION_HIRELINGS = {"Mason": "stonemason"}
# Table 64 rows without a Hirelings & Mounts actor (build-hireling-data.py leaves out the optional firearm).
NO_HIRELING = {"handgunner-optional"}
CLASS_GEAR = {
    "fighter": [("armor", "chain-mail"), ("armor", "medium-shield"), ("weapons", "long-sword"), ("weapons", "dagger-or-dirk")],
    "paladin": [("armor", "plate-mail"), ("armor", "medium-shield"), ("weapons", "long-sword")],
    "ranger": [("armor", "studded-leather"), ("weapons", "long-sword"), ("weapons", "short-sword"), ("weapons", "long-bow")],
    "cleric": [("armor", "chain-mail"), ("armor", "medium-shield"), ("weapons", "footman-s-mace")],
    "druid": [("armor", "leather"), ("weapons", "scimitar"), ("weapons", "dagger-or-dirk")],
    "thief": [("armor", "leather"), ("weapons", "short-sword"), ("weapons", "dagger-or-dirk")],
    "bard": [("armor", "leather"), ("weapons", "long-sword"), ("weapons", "dagger-or-dirk")],
    "wizard": [("weapons", "quarterstaff"), ("weapons", "dagger-or-dirk")]}


def identifiers(folder):
    out = set()
    for f in os.listdir(folder):
        if f.endswith(".json") and not f.startswith("_folder"):
            out.add(json.load(open(os.path.join(folder, f)))["system"].get("identifier", ""))
    return out


def cost_text(text):
    return re.sub(r"''", "", text).strip()


def build():
    hw, h_rev, _ = classdata.page("Hirelings (DMG)")
    h = re.sub(r"\s+", " ", hw)
    need(h, r"The skills and abilities of expert hirelings can be determined by using the \[\[Proficiencies \(PHB\)\|optional proficiency system\]\]", "experts' proficiencies")
    t60 = hw[hw.index("Table 60: NPC Professions"):]
    t60 = t60[:t60.index("\n|}")]
    names = [l.split("||")[0].strip("| ").strip() for l in t60.split("\n") if l.startswith("|") and "||" in l]
    names = [n[0].upper() + n[1:] for n in names]
    assert len(names) == 134 and names[0] == "Apothecary", (len(names), names[:3])
    profs = identifiers("packs/_source/proficiencies")
    missing = [p for p in PROFESSION_PROFS.values() if p not in profs]
    assert not missing, missing
    assert set(PROFESSION_PROFS) <= set(names), set(PROFESSION_PROFS) - set(names)
    hire_ids = identifiers("packs/_source/hirelings")
    professions = []
    for n in names:
        if n in OWN_PURPOSE:
            continue
        slug = PROFESSION_HIRELINGS.get(n, re.sub(r"[^a-z0-9]+", "-", n.lower()).strip("-"))
        professions.append({"name": n, "prof": PROFESSION_PROFS.get(n), "hireling": slug if slug in hire_ids else None})

    sw, s_rev, _ = classdata.page("Soldiers (DMG)")
    soldiers = []
    for title, wage in table(sw, "Table 64: Military Occupations"):
        slug = re.sub(r"[^a-z0-9]+", "-", title.lower()).strip("-")
        assert slug in hire_ids or slug in NO_HIRELING, slug
        soldiers.append({"name": title, "hireling": slug if slug in hire_ids else None, "wage": wage})
    assert len(soldiers) == 19, len(soldiers)

    t61, t61_rev, _ = classdata.page("DMG Table 61")
    fields = []
    for row in table(t61, "{|"):
        name, freq = row[0], row[1]
        fields.append({"name": name, "freq": int(freq.rstrip("%")), "limits": row[2] if len(row) > 2 else ""})
    assert fields[0] == {"name": "Alchemy", "freq": 10, "limits": "Can attempt to brew poisons and acids"}, fields[0]
    aw, a_rev, _ = classdata.page("The Assassin, the Spy, and the Sage (DMG)")
    need(re.sub(r"\s+", " ", aw), r"Sage ability is equal to 14 plus 1d6", "sage ability")

    titles = {}
    revs = {}
    for key, page in (("european", "DMG Table 66"), ("oriental", "DMG Table 67"), ("religious", "DMG Table 68")):
        w, rev, _ = classdata.page(page)
        revs[page] = rev
        heads = re.findall(r"^! (.+?)\s*$", w, flags=re.M)
        rows = table(w, "{|")
        cols = {hd: [r[i] for r in rows if i < len(r) and r[i].strip()] for i, hd in enumerate(heads)}
        titles[key] = cols
    assert "General" in titles["european"] and titles["european"]["General"][0] == "Emperor/Empress", titles["european"].keys()

    t69, t69_rev, _ = classdata.page("DMG Table 69")
    costs = [{"spell": cost_text(a), "cost": cost_text(b)} for a, b in table(t69, "{|")]
    assert costs[0]["spell"] == "Astral spell" and len(costs) > 30, costs[:2]

    pw, p_rev, _ = classdata.page("Personality (DMG)")
    need(re.sub(r"\s+", " ", pw), r"The base morale for henchmen is 12 and the base for a hireling is 10", "base morale")

    rw, r_rev, _ = classdata.page("Character Race Tables (PHB)")
    t10 = rw[rw.index("==Table 10: Average Height and Weight=="):]
    t10 = t10[:t10.index("|}")]
    heights = {}
    for m in re.finditer(r"\|\s*\[\[([^\]]+)\]\]\s*\n\|\s*(\d+)/(\d+)\s*\n\|\s*(\d+d\d+)", t10):
        heights[classdata.link_text(m.group(1)).lower() if hasattr(classdata, "link_text") else m.group(1).split("|")[-1].lower()] = \
            {"male": int(m.group(2)), "female": int(m.group(3)), "dice": m.group(4)}
    heights = {re.sub(r".*\|", "", k).replace(" (phb)", "").strip(): v for k, v in heights.items()}
    assert set(heights) == {"dwarf", "elf", "gnome", "half-elf", "halfling", "human"}, heights

    weapons, armor = identifiers("packs/_source/weapons"), identifiers("packs/_source/armor")
    for cls, gear in CLASS_GEAR.items():
        for pack, ident in gear:
            assert ident in (weapons if pack == "weapons" else armor), (cls, ident)

    return {"professions": professions, "soldiers": soldiers, "sageFields": fields, "sageAbility": "14 + 1d6",
            "titles": titles, "spellCosts": costs, "morale": {"henchman": 12, "hireling": 10}, "heights": heights,
            "gear": {k: [{"pack": p, "identifier": i} for p, i in v] for k, v in CLASS_GEAR.items()},
            "urls": {"professions": classdata.url("Hirelings (DMG)"), "soldiers": classdata.url("Soldiers (DMG)"),
                     "sages": classdata.url("The Assassin, the Spy, and the Sage (DMG)"), "titles": classdata.url("Officials and Social Rank (DMG)"),
                     "costs": classdata.url("DMG Table 69"), "personality": classdata.url("Personality (DMG)")}}, \
        {"Hirelings (DMG)": h_rev, "Soldiers (DMG)": s_rev, "DMG Table 61": t61_rev, "The Assassin, the Spy, and the Sage (DMG)": a_rev,
         **revs, "DMG Table 69": t69_rev, "Personality (DMG)": p_rev, "Character Race Tables (PHB)": r_rev}


if __name__ == "__main__":
    data, revs = build()
    with open("module/rules/npc-tables.mjs", "w") as f:
        f.write("// GENERATED by tools/build-npc-tables.py from the AD&D 2e fandom wiki (MediaWiki API): do not edit.\n")
        f.write("// Sources: " + ", ".join(f"{k} rev {v}" for k, v in revs.items()) + ".\n")
        f.write(f"export const NPC_TABLES = {json.dumps(data, ensure_ascii=False)};\n")
    print(len(data["professions"]), "professions,", len(data["soldiers"]), "soldiers,", len(data["sageFields"]), "sage fields,",
          {k: list(v) for k, v in data["titles"].items()}, len(data["spellCosts"]), "spell costs")
