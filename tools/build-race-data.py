#!/usr/bin/env python3
"""Generate packs/_source/races/*.json: the six PHB races as Items of type "race".

Sources (AD&D 2e fandom wiki, MediaWiki API):
  * Table 7 (Racial Ability Requirements) and Table 8 (Racial Abilities), page
    "Character Race Tables (PHB)" - parsed.
  * Race pages (Dwarf/Elf/Gnome/Half-Elf/Halfling/Human (PHB)) for allowed classes, the
    Constitution saving-throw bonus (Table 9) and infravision - curated below with the
    sentence each value comes from.
  * Table 64 (Base Movement Rates, "Movement (PHB)") for the base movement rate (via build-movement-tables.py).
  * Specialist wizard schools open to a race come from Table 22 (the `races` of the
    generated class documents in packs/_source/classes; run build-class-data.py first).
Run from the repo root:  python3 tools/build-race-data.py
"""
import glob, json, os, re, urllib.parse, urllib.request

import importlib.util
_spec = importlib.util.spec_from_file_location("classdata", "tools/build-class-data.py")
classdata = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(classdata)
_mspec = importlib.util.spec_from_file_location("movement", "tools/build-movement-tables.py")
movement = importlib.util.module_from_spec(_mspec)
_mspec.loader.exec_module(movement)

ABIL = {"STR": "str", "DEX": "dex", "CON": "con", "INT": "int", "WIS": "wis", "CHA": "cha",
        "Strength": "str", "Dexterity": "dex", "Constitution": "con", "Intelligence": "int",
        "Wisdom": "wis", "Charisma": "cha"}
SPECIALISTS = ["abjurer", "conjurer", "diviner", "enchanter", "illusionist", "invoker", "necromancer", "transmuter"]

# Curated from the race pages (quoted sentence per value).
RACE_FACTS = {
    # "They can be of any character class and rise to any level in any class."
    "Human": {"page": "Human (PHB)", "classes": "all", "conSaves": False, "conPoison": False, "infravision": 0},
    # "A character of the dwarven race can be a cleric, a fighter, or a thief." / bonus "against attacks from magical
    # wands, staves, rods, and spells" / "saving throws against poison with the same bonuses" / infravision 60 feet
    "Dwarf": {"page": "Dwarf (PHB)", "classes": ["cleric", "fighter", "thief"], "conSaves": True, "conPoison": True, "infravision": 60},
    # "A player character elf can be a cleric, fighter, wizard, thief, or ranger." (wizard: mage + Table 22 schools)
    # "Elven infravision enables them to see up to 60 feet in darkness."
    "Elf": {"page": "Elf (PHB)", "classes": ["cleric", "fighter", "mage", "thief", "ranger"], "conSaves": False, "conPoison": False, "infravision": 60},
    # "A gnome character can elect to be a fighter, a thief, a cleric, or an illusionist." / "This bonus applies to saving
    # throws against magical wands, staves, rods, and spells." / "Gnomish infravision ... up to 60 feet"
    "Gnome": {"page": "Gnome (PHB)", "classes": ["fighter", "thief", "cleric", "illusionist"], "conSaves": True, "conPoison": False, "infravision": 60},
    # "A half-elf can choose to be a cleric, druid, fighter, ranger, mage, specialist wizard, thief, or bard."
    # "Half-elven infravision enables them to see up to 60 feet in darkness."
    "Half-Elf": {"page": "Half-Elf (PHB)", "classes": ["cleric", "druid", "fighter", "ranger", "mage", "thief", "bard"], "conSaves": False, "conPoison": False, "infravision": 60},
    # "A halfling character can choose to be a cleric, fighter, thief" / "+1 bonus on saving throws vs. wands, staves,
    # rods, and spells" / "a Constitution bonus identical ... when they make saving throws vs. poison" /
    # infravision depends on lineage (15% 60 ft, else 25% 30 ft) -> 0 with lineage flag
    "Halfling": {"page": "Halfling (PHB)", "classes": ["cleric", "fighter", "thief"], "conSaves": True, "conPoison": True,
                 "infravision": 0, "infravisionByLineage": True},
}
# Size category per race (for weapon size: "A character can always wield a weapon equal to his own size or less ...
# A character can also use a weapon one size greater than himself although it must be gripped with two hands",
# Weapons (PHB)). The PHB race pages give no size; the Monstrous Manual entries do (regex checked below). Humans and
# half-elves are man-sized (M) by definition. Hill dwarves are "S to M (4' and taller)", mountain dwarves M: M is used.
RACE_SIZE = {
    "human": ("M", None, None),
    "half-elf": ("M", None, None),
    "elf": ("M", "Elf (MM)", r"size=M \(5'\+ tall\)"),
    "dwarf": ("M", "Dwarf (MM)", r"size2 = M \(4\{\{frac\|1\|2\}\}' and taller\)"),
    "gnome": ("S", "Gnome (MM)", r"!Size:\n\|S \("),
    "halfling": ("S", "Halfling (MM)", r"size1 = S \(3'\)"),
}


def race_sizes():
    out, revs = {}, {}
    for key, (size, title, pattern) in RACE_SIZE.items():
        if title:
            wiki, rev, _ = classdata.page(title)
            assert re.search(pattern, wiki), f"{title}: size text not found ({pattern})"
            revs[title] = rev
        out[key] = size
    return out, revs


# Racial class level limits, as supplied by the repository owner (2026-10-03):
#            Human  Half-elf  Elf  Gnome  Dwarf  Halfling
# Paladin    20+    -         -    -      -      -
# Bard       20+    20+       -    -      -      -
# Druid      20+    9         -    -      -      -
# Illus.     20+    -         -    15     -      -
# Mage       20+    12        15   -      -      -
# Ranger     20+    16        15   -      -      -
# Cleric     20+    14        12   9      10     8
# Fighter    20+    14        12   11     15     9
# Thief      20+    12        12   13     12     15
# "20+" = no limit (null). "-" = class not allowed (already excluded by the class lists).
# Specialist schools other than illusionist are not in the table; they use the Mage limit.
LEVEL_LIMITS = {
    "Human": {},
    "Half-Elf": {"bard": None, "druid": 9, "mage": 12, "ranger": 16, "cleric": 14, "fighter": 14, "thief": 12},
    "Elf": {"mage": 15, "ranger": 15, "cleric": 12, "fighter": 12, "thief": 12},
    "Gnome": {"illusionist": 15, "cleric": 9, "fighter": 11, "thief": 13},
    "Dwarf": {"cleric": 10, "fighter": 15, "thief": 12},
    "Halfling": {"cleric": 8, "fighter": 9, "thief": 15},
}

RACE_TO_TABLE22 = {"Human": "human", "Elf": "elf", "Half-Elf": "half-elf", "Gnome": "gnome", "Dwarf": "dwarf", "Halfling": "halfling"}


def link_text(c):
    return re.sub(r"\[\[(?:[^\]|]*\|)?([^\]]*)\]\]", r"\1", c).replace("*", "").strip()


def level_limits(race, classes):
    """Max level per allowed class (null = unlimited); specialists without an entry use the Mage limit."""
    table = LEVEL_LIMITS[race]
    out = {}
    for c in classes:
        if c in table:
            out[c] = table[c]
        elif c in SPECIALISTS:
            out[c] = table.get("mage")
        else:
            out[c] = None
    return out


# Multi-class combinations ("Multi-Class Combinations", Multi-Class and Dual-Class Characters (PHB)): class names per
# race, "*" = "or Druid" (the cleric may be a druid). Parsed from the page; checked against the curated count per race.
MULTI_PAGE = "Multi-Class and Dual-Class Characters (PHB)"
MULTI_COUNT = {"Dwarf": 2, "Elf": 4, "Gnome": 6, "Halfling": 1, "Half-Elf": 7}


def multi_class_combinations():
    """Race name -> sorted list of combinations, each a "/"-joined list of class identifiers (cleric* also as druid)."""
    wiki, rev, _ = classdata.page(MULTI_PAGE)
    sec = wiki[wiki.index("==Multi-Class Combinations=="):wiki.index("==Multi-Class Benefits")]
    assert re.search(r"<nowiki>\*</nowiki> or Druid", sec), "Multi-Class Combinations: footnote changed"
    assert re.search(r"specialist wizards cannot be multi-class \(gnome illusionists are the single exception to this rule\)", sec), \
        "Multi-Class Combinations: specialist rule changed"
    out, race = {}, None
    for line in sec.splitlines():
        m = re.match(r"\[\[([^\]|]+)\]\]\s*$", line.strip())
        if m:
            race = m.group(1)
            out[race] = []
            continue
        m = re.match(r"\*\s*([A-Za-z/*]+)\s*$", line.strip())
        if m and race:
            names = m.group(1).split("/")
            variants = [[]]
            for n in names:
                ids = ["cleric", "druid"] if n.endswith("*") else [n.lower()]
                variants = [v + [i] for v in variants for i in ids]
            for v in variants:
                out[race].append("/".join(v))
    for race, n in MULTI_COUNT.items():
        listed = len({c.replace("druid", "cleric") for c in out.get(race, [])})
        assert listed == n, f"Multi-Class Combinations: {race} has {listed} combinations, expected {n}"
    return out, rev


# Complete Bard's Handbook multi-class bards ("Multi-Classed Bards Dual-Classed Bards (CBH)"): each combination is another
# class and the bard with one of the listed kits ("True" = the True Bard: that kit or no kit, the only choice without kits).
# Parsed from the page; kit names map to kit identifiers (checked against the kit sources); counts checked per race.
BARD_MULTI_PAGE = "Multi-Classed Bards Dual-Classed Bards (CBH)"
BARD_MULTI_COUNT = {"Dwarf": 1, "Elf": 2, "Gnome": 2, "Half-Elf": 6, "Halfling": 1}
BARD_KITS = {"True": "true-bard", "Chanter": "dwarven-chanter", "Skald": "skald", "Minstrel": "elven-minstrel", "Gypsy": "gypsy-bard",
             "Professor": "gnome-professor", "Jongleur": "jongleur", "Blade": "blade", "Gallant": "gallant",
             "Meistersinger": "meistersinger", "Loremaster": "loremaster", "Riddlemaster": "riddlemaster", "Thespian": "thespian"}


def bard_multi_class():
    """Race name -> {combination ("bard/<class>" sorted): [bard kit identifiers]}."""
    wiki, rev, _ = classdata.page(BARD_MULTI_PAGE)
    assert re.search(r"If the kits are not used in your campaign, only those combinations that include the True Bard can be used", wiki), \
        "CBH multi-class bards: True Bard rule changed"
    assert re.search(r"multi-class options are not open to human characters", wiki), "CBH multi-class bards: human rule changed"
    sec = wiki[wiki.index("'''Dwarf'''"):wiki.index("==Dual-Classed Bards==")]
    kits = {json.load(open(f))["system"]["identifier"] for f in glob.glob("packs/_source/kits/*.json") if not os.path.basename(f).startswith("_folder")}
    out, race = {}, None
    for line in sec.splitlines():
        line = line.strip()
        m = re.match(r"'''([A-Za-z-]+)'''$", line)
        if m:
            race = m.group(1)
            out[race] = {}
            continue
        m = re.match(r"([A-Za-z]+)/([A-Za-z* ]+)$", line)
        if m and race:
            cls = m.group(1).lower()
            names = [n.strip() for n in m.group(2).split("*")]
            ids = [BARD_KITS[n] for n in names]
            assert all(i in kits for i in ids), (line, ids)
            out[race]["/".join(sorted(["bard", cls]))] = ids
    for race, n in BARD_MULTI_COUNT.items():
        assert len(out.get(race, {})) == n, f"CBH multi-class bards: {race} has {len(out.get(race, {}))} combinations, expected {n}"
    return out, rev


def build():
    base_move, _ = movement.build_base_move()
    multi, multi_rev = multi_class_combinations()
    bard_multi, bard_rev = bard_multi_class()
    wiki, rev, _ = classdata.page("Character Race Tables (PHB)")
    t7 = classdata.table_rows(wiki, "Table 7: Racial Ability Requirements")
    header = [link_text(h) for h in re.findall(r"!\s*scope=\"col\"\|\s*([^\n]+)", wiki[wiki.index("Table 7: Racial Ability Requirements"):])[1:7]]
    req = {race: {"min": {}, "max": {}} for race in header}
    for row in t7:
        ab = ABIL[row[0].strip()]
        for race, cell in zip(header, row[1:]):
            m = re.match(r"(\d+)/(\d+)", cell.strip())
            req[race]["min"][ab] = int(m.group(1)) if m else None
            req[race]["max"][ab] = int(m.group(2)) if m else None

    t8 = wiki[wiki.index("Table 8: Racial Abilities"):]
    t8 = t8[:t8.index("|}")]
    adjust = {race: {} for race in header}
    for race, text in re.findall(r"\|\s*\[\[([^\]]+)\]\]\s*\n\|\s*([^\n]+)", t8):
        for sign, n, ab in re.findall(r"([+-])(\d+)\s+(\w+)", text):
            adjust[link_text(race)][ABIL[ab]] = int(n) * (1 if sign == "+" else -1)

    specialists = {}
    for f in glob.glob("packs/_source/classes/[!_]*.json"):
        d = json.load(open(f))
        for race in d["system"].get("races", []):
            specialists.setdefault(race, []).append(d["system"]["identifier"])

    all_classes = sorted(json.load(open(f))["system"]["identifier"] for f in glob.glob("packs/_source/classes/[!_]*.json"))
    docs = []
    for i, (name, f) in enumerate(RACE_FACTS.items()):
        key = name.lower()
        if f["classes"] == "all":
            classes = all_classes
        else:
            classes = f["classes"] + sorted(s for s in specialists.get(RACE_TO_TABLE22[name], []) if s not in f["classes"])
        _, page_rev, _ = classdata.page(f["page"])
        # Classes this race can only take through a kit that lists the race (Complete Bard's Handbook).
        kit_classes = sorted({c for kf in glob.glob("packs/_source/kits/[!_]*.json")
                              for kd in [json.load(open(kf))["system"]] if key in kd.get("raceLimits", {})
                              for c in kd["classes"] if c not in classes})
        r = req.get(name, {"min": {}, "max": {}})
        system = {"identifier": key, "move": base_move[key],
                  "min": {a: r["min"].get(a) for a in classdata.MINS},
                  "max": {a: r["max"].get(a) for a in classdata.MINS},
                  "adjust": {a: adjust.get(name, {}).get(a, 0) for a in classdata.MINS},
                  "classes": classes, "kitClasses": kit_classes, "conSaves": f["conSaves"], "conPoison": f["conPoison"],
                  "infravision": f["infravision"], "infravisionByLineage": f.get("infravisionByLineage", False),
                  "levelLimits": level_limits(name, classes),
                  "multiClass": sorted(multi.get(name, [])),
                  "multiClassKits": bard_multi.get(name, {}),
                  "url": classdata.url(f["page"]), "notes": ""}
        docs.append(classdata.item_doc("race", key, name, "icons/svg/mystery-man.svg", system, i * 1000))
        print(f"{name}: page rev {page_rev}, classes {classes}, via kit {kit_classes}, multi-class {sorted(multi.get(name, []))} (rev {multi_rev}), bard {bard_multi.get(name, {})} (rev {bard_rev})")
    classdata.write_docs("packs/_source/races", docs)

    # Table 9: Constitution Saving Throw Bonuses (dwarf, gnome, halfling).
    t9 = wiki[wiki.index("Table 9: Constitution Saving Throw Bonuses"):]
    t9 = t9[:t9.index("|}")]
    rows = re.findall(r"\|\s*(\d+)-(\d+)\s*\n\|\s*\+(\d+)", t9)
    con_bonus = [{"min": int(a), "max": int(b), "bonus": int(c)} for a, b, c in rows]
    assert len(con_bonus) == 5, con_bonus
    sizes, size_revs = race_sizes()
    # Table 10: Average Height and Weight (weight columns: male/female base and the modifier dice).
    t10 = wiki[wiki.index("==Table 10: Average Height and Weight=="):]
    t10 = t10[:t10.index("|}")]
    body = {}
    for m in re.finditer(r"\|\s*\[\[([^\]]+)\]\]\s*\n\|\s*\d+/\d+\s*\n\|\s*\d+d\d+\s*\n\|\s*(\d+)/(\d+)\s*\n\|\s*(\d+d\d+)", t10):
        body[link_text(m.group(1)).lower()] = {"male": int(m.group(2)), "female": int(m.group(3)), "dice": m.group(4)}
    assert set(body) == set(sizes), body
    open("module/rules/race-tables.mjs", "w").write("\n".join([
        "/**",
        " * GENERATED by tools/build-race-data.py - do not edit by hand.",
        " * PHB Table 9: Constitution Saving Throw Bonuses (dwarves, gnomes, halflings), from",
        f" *   {classdata.url('Character Race Tables (PHB)')} (revision {rev})",
        " * Applies to saves vs. rod/staff/wand and spells; dwarves and halflings also vs. poison.",
        " */",
        "export const CON_SAVE_BONUS = " + json.dumps(con_bonus) + ";",
        "",
        "/**",
        " * Size category per race (weapon size, Weapons (PHB)): Monstrous Manual entries "
        + ", ".join(f"{t} (revision {r})" for t, r in size_revs.items()) + ";",
        " * humans and half-elves are man-sized (M); hill dwarves are \"S to M\", M is used.",
        " */",
        "export const RACE_SIZE = " + json.dumps(sizes) + ";",
        "",
        "/** PHB Table 10: Average Height and Weight, weight in pounds: base (male/female) + modifier dice (same revision as Table 9). */",
        "export const RACE_WEIGHT = " + json.dumps(body) + ";", ""]))
    print("wrote module/rules/race-tables.mjs:", con_bonus)
    print(f"wrote packs/_source/races: {len(docs)} races (Tables 7/8 from rev {rev})")


if __name__ == "__main__":
    build()
