#!/usr/bin/env python3
"""Generate module/rules/class-tables.mjs: thief/bard/ranger skills, backstab and turning undead.

Sources (AD&D 2e fandom wiki, MediaWiki API):
  * Rogue Tables (PHB): Table 26 Thieving Skill Base Scores, Table 27 Racial Adjustments, Table 28 Dexterity
    Adjustments, Table 29 Armor Adjustments, Table 30 Backstab Damage Multipliers, Table 33 Bard Abilities.
  * Warrior Tables (PHB): the ranger's Hide in Shadows / Move Silently by level (Table 18; captioned
    "Table 17: Ranger Spell Progression" on the wiki).
  * Turning Undead (PHB): Table 61 Turning Undead.
Run from the repo root:  python3 tools/build-class-ability-tables.py
"""
import glob
import os
import importlib.util
import json
import re

_spec = importlib.util.spec_from_file_location("classdata", "tools/build-class-data.py")
classdata = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(classdata)

SKILLS = {"Pick Pockets": "pp", "Open Locks": "ol", "Find/Remove Traps": "rt", "Move Silently": "ms",
          "Hide in Shadows": "hs", "Detect Noise": "dn", "Climb Walls": "cw", "Read Languages": "rl"}
RACES = ["dwarf", "elf", "gnome", "half-elf", "halfling"]
ARMOR = ["none", "elvenChain", "padded", "chain"]  # No Armor, Elven Chain, Padded/Hide/Studded Leather, Chain/Ring Mail


def table(wiki, caption):
    i = wiki.index(caption)
    return wiki[i:wiki.index("|}", i)]


def rows(t):
    out = []
    for chunk in re.split(r"\n\|-", t)[1:]:
        lines = [l.strip() for l in chunk.strip().split("\n") if l.strip().startswith("|") and not l.strip().startswith(("|+", "|}"))]
        cells = [re.sub(r"\[\[(?:[^\]|]*\|)?([^\]]*)\]\]", r"\1", c).strip() for l in lines for c in l[1:].split("||")]
        if cells:
            out.append(cells)
    return out


def pct(c):
    c = c.strip()
    if c in ("—", "-", ""):
        return 0
    return int(re.match(r"[+-]?\d+", c.replace("+", "")).group())


WIZARDS = ["mage", "abjurer", "conjurer", "diviner", "enchanter", "illusionist", "invoker", "necromancer", "transmuter"]
CLASS_ARMOR = {
    **{w: {"body": "none", "shield": "none"} for w in WIZARDS},
    "thief": {"body": ["leather", "studded-leather", "padded"], "elvenChain": True, "shield": "any"},
    "bard": {"body": {"maxAc": 5}, "shield": "none"},
    "druid": {"body": ["padded", "hide", "leather"], "shield": "wooden"},
}
CLASS_ARMOR_TEXT = {
    "wizard": ("Wizard (PHB)", r"Wizards cannot wear any armor"),
    "thief": ("Thief (PHB)", r"A thief can wear leather, studded leather, padded leather, or elven chain armor"),
    "bard": ("Bard (PHB)", r"He can wear any armor up to, and including, chain mail, but he cannot use a shield"),
    "druid": ("Druid (PHB)", r"padded, hide, or leather armor and wooden shields"),
}

# Class weapon limits (owner's ruling: a warning for every character; multi-class: a priest's limits always apply,
# otherwise the most permissive class's). Weapons are weapon proficiency identifiers (weapon item `proficiency`);
# "type" = Table 45 damage type, B alone for the standard cleric (owner's ruling).
WIZARD_WEAPONS = ["dagger-or-dirk", "quarterstaff", "dart", "knife", "sling"]
CLASS_WEAPONS = {
    **{w: {"ids": WIZARD_WEAPONS} for w in WIZARDS},
    "cleric": {"type": "B"},
    "druid": {"ids": ["club", "sickle", "dart", "spear", "dagger-or-dirk", "scimitar", "sling", "quarterstaff"]},
    "thief": {"ids": ["club", "dagger-or-dirk", "dart", "hand-crossbow", "knife", "lasso", "short-bow", "sling",
                      "broad-sword", "long-sword", "short-sword", "quarterstaff"]},
}
NO_WEAPON_ITEM = set()  # every listed weapon has an item (the lasso comes from Combat & Tactics since 0.0.128)
CLASS_WEAPON_TEXT = {
    "wizard": ("Wizard (PHB)", r"a wizard can use a dagger or a staff.*?Other weapons allowed are darts, knives, and slings"),
    "cleric": ("Cleric (PHB)", r"allowed to use only blunt, bludgeoning weapons"),
    "druid": ("Druid (PHB)", r"His weapons are limited to club, sickle, dart, spear, dagger, scimitar, sling, and staff"),
    "thief": ("Thief (PHB)", r"The allowed weapons are club, dagger, dart, hand crossbow, knife, lasso, short bow, sling, broad "
              r"sword, long sword, short sword, and staff"),
    "multi": ("Multi-Class and Dual-Class Characters (PHB)", r"a multi-classed priest must abide by the weapon restrictions of his mythos"),
}


if __name__ == "__main__":
    wiki, rev_rogue, _ = classdata.page("Rogue Tables (PHB)")
    base = {SKILLS[r[0]]: pct(r[1]) for r in rows(table(wiki, "|+ Table 26"))}
    race = {}
    for r in rows(table(wiki, "|+ Table 27")):
        race[SKILLS[r[0]]] = dict(zip(RACES, (pct(c) for c in r[1:6])))
    dex = []
    for r in rows(table(wiki, "|+ Table 28")):
        lo, _, hi = r[0].partition("-")
        dex.append({"min": int(lo), "max": int(hi or lo), **dict(zip(["pp", "ol", "rt", "ms", "hs"], (pct(c) for c in r[1:6])))})
    armor = {SKILLS[r[0]]: dict(zip(ARMOR, (pct(c) for c in r[1:5]))) for r in rows(table(wiki, "|+ Table 29"))}
    backstab = []
    for r in rows(table(wiki, "|+ Table 30")):
        lv = r[0]
        lo, hi = (int(lv[:-1]), 99) if lv.endswith("+") else tuple(int(x) for x in lv.split("-"))
        backstab.append({"min": lo, "max": hi, "multiplier": int(re.search(r"x(\d)", r[1]).group(1))})
    bard_t = table(wiki, "|+ Table 33")
    bard_vals = [pct(c) for c in re.findall(r"\|\s*([\d]+%)", bard_t)]
    bard = dict(zip(["cw", "dn", "pp", "rl"], bard_vals))
    assert set(base) == set(SKILLS.values()) and len(race) == 8 and len(armor) == 8 and len(dex) == 9, (base, race, dex)
    assert backstab[0] == {"min": 1, "max": 4, "multiplier": 2} and backstab[-1]["multiplier"] == 5, backstab
    assert bard == {"cw": 50, "dn": 20, "pp": 10, "rl": 5}, bard

    wwiki, rev_warrior, _ = classdata.page("Warrior Tables (PHB)")
    ranger = []
    for r in rows(table(wwiki, "|+ Table 17: Ranger Spell Progression")):
        if re.match(r"\d", r[0]):
            ranger.append({"level": int(r[0]), "hs": pct(r[1]), "ms": pct(r[2])})
    assert ranger[0] == {"level": 1, "hs": 10, "ms": 15} and len(ranger) == 16, ranger

    twiki, rev_turn, _ = classdata.page("Turning Undead (PHB)")
    t61 = table(twiki, "Table 61: Turning Undead")
    turn = []
    for r in rows(t61):
        if len(r) == 13 and not r[0].startswith("!"):
            label = re.sub(r"\*+$", "", r[0]).strip()
            turn.append({"undead": label, "results": [re.sub(r"\s", "", c) for c in r[1:]]})
    columns = [[1, 1], [2, 2], [3, 3], [4, 4], [5, 5], [6, 6], [7, 7], [8, 8], [9, 9], [10, 11], [12, 13], [14, 99]]
    assert len(turn) == 13 and turn[0]["undead"] == "Skeleton or 1 HD" and turn[0]["results"][:4] == ["10", "7", "4", "T"], turn[:2]

    # Class armour limits (curated from the class pages; each sentence is checked below). body: "any", "none", a list
    # of armour identifiers (names containing "elven chain" also count for thieves), or {"maxAc": n} ("up to, and
    # including, chain mail" = base AC 5 or worse); shield: "any", "none" or "wooden" (material is not recorded:
    # shown as a note only); helmet follows body "none". Cleric, fighter, paladin and ranger: any armour.
    revs_armor = {}
    for cls, (page, pattern) in CLASS_ARMOR_TEXT.items():
        w, r, _ = classdata.page(page)
        assert re.search(pattern, w), f"{page}: armour rule changed ({pattern})"
        revs_armor[page] = r
    revs_weapons = {}
    for cls, (page, pattern) in CLASS_WEAPON_TEXT.items():
        w, r, _ = classdata.page(page)
        assert re.search(pattern, w, flags=re.S), f"{page}: weapon rule changed ({pattern})"
        revs_weapons[page] = r
    known = {json.load(open(f))["system"]["identifier"] for f in glob.glob("packs/_source/proficiencies/*.json")
             if not os.path.basename(f).startswith("_folder") and json.load(open(f))["system"].get("kind") == "weapon"}
    for cls, rule in CLASS_WEAPONS.items():
        missing = set(rule.get("ids", [])) - known - NO_WEAPON_ITEM
        assert not missing, (cls, missing)
    data = {"thief": {"base": base, "race": race, "dex": dex, "armor": armor}, "bard": bard, "ranger": ranger,
            "backstab": backstab, "turnUndead": {"columns": columns, "rows": turn}, "classArmor": CLASS_ARMOR,
            "classWeapons": CLASS_WEAPONS}
    lines = ["/**",
             " * GENERATED by tools/build-class-ability-tables.py - do not edit by hand.",
             f" *   Tables 26-30, 33: {classdata.url('Rogue Tables (PHB)')} (revision {rev_rogue})",
             f" *   Ranger hide in shadows / move silently (Table 18): {classdata.url('Warrior Tables (PHB)')} (revision {rev_warrior})",
             f" *   Table 61 Turning Undead: {classdata.url('Turning Undead (PHB)')} (revision {rev_turn}); results: number = roll 1d20",
             " *   that high or higher, T = turned, D = dispelled (destroyed), D* = 2d4 more destroyed, - (empty) = cannot turn.",
             " *   Class armour limits: " + ", ".join(f"{classdata.url(p)} (revision {r})" for p, r in revs_armor.items()) + ".",
             " *   Class weapon limits: " + ", ".join(f"{classdata.url(p)} (revision {r})" for p, r in revs_weapons.items()) + ".",
             " */",
             "export const CLASS_TABLES = " + json.dumps(data) + ";", ""]
    open("module/rules/class-tables.mjs", "w").write("\n".join(lines))
    print("wrote module/rules/class-tables.mjs:", base, bard, len(ranger), "ranger levels,", len(turn), "undead rows")
