#!/usr/bin/env python3
"""Generate module/rules/throw-tables.mjs: thrown objects (grenade-like missiles) and the Throwing proficiency
(module/throwing.mjs).

Sources (AD&D 2e fandom wiki, MediaWiki API):
  - "Missile Weapons in Combat (DMG)": Table 45 Grenade-Like Missile Effects parsed (ranges read as dice); the rules
    regex-checked: 5 lb or less about 30 feet, short 10 / medium 20 feet, heavier items decided by the DM, bend bars /
    lift gates for exceptionally heavy items, no heavier than the character can lift, scatter (1d10 on the Scatter Diagram,
    1d6 / 1d10 / 2d10 feet by range), splash within 3 feet, flaming oil 2d6 then 1d6, boulders scatter twice as far.
  - "Missile Weapons in Combat (PHB)": the same 30-foot rule and the range modifiers (-2 medium, -5 long).
  - "Strength (PHB)": Maximum Press is the heaviest weight a character can lift over the head (the lift limit used).
  - "Throwing (Proficiency)" (Player's Option: Skills & Powers): +10 feet to each range category of thrown weapons and
    +1 to damage or the attack roll per throw; +5 feet per further character point.
Curated: `SCATTER` (the Scatter Diagram is a picture: directions read from File:Scatter_Diagram.png, degrees clockwise from
the line of the throw, 1 = short of the target towards the thrower), `CONTENTS` (equipment identifier -> Table 45 row,
asserted against the pack sources). Implementation choices are noted in module/throwing.mjs.
Run from the repo root (after build-equipment-data.py and build-component-data.py):  python3 tools/build-throw-tables.py
"""
import glob
import importlib.util
import json
import re

_spec = importlib.util.spec_from_file_location("classdata", "tools/build-class-data.py")
classdata = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(classdata)
_tspec = importlib.util.spec_from_file_location("travel", "tools/build-travel-tables.py")
travel = importlib.util.module_from_spec(_tspec)
_tspec.loader.exec_module(travel)
need = travel.need

DMG = "Missile Weapons in Combat (DMG)"
PHB = "Missile Weapons in Combat (PHB)"
STR = "Strength (PHB)"
PROF = "Throwing (Proficiency)"

# Scatter Diagram (DMG): 1d10 result -> degrees clockwise from the line of the throw (0 = beyond the target point).
SCATTER = {"1": 180, "2": 270, "3": 90, "4": 300, "5": 60, "6": 330, "7": 30, "8": 0, "9": 0, "10": 0}
# Table 45 row keys and the items that default to them (oil defaults to lit: "Oil causes damage only when it is lit").
ROWS = {"Acid": "acid", "Holy water": "holyWater", "Oil (lit)": "oil", "Poison": "poison"}
CONTENTS = {"oil-lamp-per-flask": "oil", "oil-greek-fire-per-flask": "oil", "holy-item-symbol-water-etc": "holyWater",
            "holy-item": "holyWater", "acid": "acid", "acid-nitric": "acid", "acid-citric": "acid"}


def dice(text):
    """'2-8' -> '2d4', '2-7' -> '1d6+1', '1-3' -> '1d3', '1' -> '1'."""
    m = re.fullmatch(r"(\d+)(?:-(\d+))?", text)
    assert m, text
    lo, hi = int(m.group(1)), int(m.group(2) or m.group(1))
    if lo == hi:
        return str(lo)
    if hi % lo == 0:
        return f"{lo}d{hi // lo}"
    return f"1d{hi - lo + 1}+{lo - 1}"


def table45(wiki):
    t = wiki[wiki.index("Table 45: Grenade-Like Missile Effects"):]
    t = t[:t.index("|}")]
    rows = {}
    for block in t.split("|-")[1:]:
        cells = [re.sub(r"\s+", " ", x.replace("&nbsp;", " ")).strip() for x in re.findall(r"^\|\s*(.*)$", block, re.M)]
        if len(cells) != 4 or cells[0] not in ROWS:
            continue
        name, area, direct, splash = cells
        feet = int(re.fullmatch(r"(\d+)' diameter", area).group(1))
        row = {"name": name, "area": feet, "areaText": area, "directText": direct, "splashText": splash}
        if direct == "special":
            row.update(direct=None, splash=None)
        else:
            parts = [dice(p) for p in direct.replace(" hp", "").split("/")]
            row.update(direct=parts[0], later=parts[1:], splash=dice(splash.replace(" hp", "")))
        rows[ROWS[name]] = row
    return rows


def main():
    w, rev, _ = classdata.page(DMG)
    t = re.sub(r"\s+", " ", w)
    need(t, r"A missile of five pounds or less can be thrown about 30 feet\. Short range is 10 feet, medium range is 20 feet, and everything beyond is maximum range\. Heavier items have reduced ranges\. Just how far an object can be thrown is decided by the DM", "30-foot rule (DMG)")
    need(t, r"Exceptionally heavy items can be thrown only if the character rolls a successful bend bars/lift gates check\. In no case can a character throw an item heavier than his Strength would allow him to lift", "heavy items")
    need(t, r"First roll 1d10 and consult the Scatter Diagram", "scatter direction")
    need(t, r"If the throw is at short range, use a 6-sided die\. If the range is medium, use a 10-sided die\. If thrown to long range, roll 2d10\. The number rolled is the number of feet away from the intended target", "scatter distance")
    need(t, r"All creatures within 3' of the area of effect are subject to splash damage", "splash")
    need(t, r"A direct hit from flaming oil burns for two rounds, causing 2d6 points of damage in the first round and 1d6 points in the second", "flaming oil")
    need(t, r"The distance the boulder scatters should be doubled", "boulder scatter")
    rows = table45(w)
    assert rows["acid"]["direct"] == "2d4" and rows["acid"]["splash"] == "1", rows["acid"]
    assert rows["holyWater"]["direct"] == "1d6+1" and rows["holyWater"]["splash"] == "2", rows["holyWater"]
    assert rows["oil"]["direct"] == "2d6" and rows["oil"]["later"] == ["1d6"] and rows["oil"]["splash"] == "1d3", rows["oil"]
    assert rows["oil"]["area"] == 3 and rows["poison"]["direct"] is None and len(rows) == 4, rows
    pw, prev, _ = classdata.page(PHB)
    pt = re.sub(r"\s+", " ", pw)
    need(pt, r"A missile of five pounds or less can be thrown about 30 feet\. Short range is 10 feet, medium range is 20 feet", "30-foot rule (PHB)")
    need(pt, r"Medium-range attacks suffer a -2 penalty to the attack roll\. Long-range attacks suffer a -5 penalty", "range modifiers")
    sw, srev, _ = classdata.page(STR)
    need(re.sub(r"\s+", " ", sw), r"Maximum Press'*\s*is the heaviest weight a character can pick up and lift over their head", "maximum press")
    tw, trev, _ = classdata.page(PROF)
    tt = re.sub(r"\s+", " ", tw)
    prof = need(tt, r"add (\d+)' to each range category of thrown weapons, and increases the damage or the attack roll by \+(\d+) each time they throw a weapon", "Throwing proficiency")
    extra = need(tt, r"For each character point spent on this proficiency \(after its initial purchase\) a character adds another (\d+)' to thrown weapon ranges", "Throwing extra points")
    ids = {json.load(open(f)).get("system", {}).get("identifier") for d in ("equipment", "aq-equipment", "components")
           for f in glob.glob(f"packs/_source/{d}/*.json") if not f.split("/")[-1].startswith("_folder")}
    assert set(CONTENTS) <= ids, set(CONTENTS) - ids
    data = {
        "lightWeight": 5, "ranges": {"short": 10, "medium": 20, "long": 30},
        "scatter": {"direction": "1d10", "dice": {"short": "1d6", "medium": "1d10", "long": "2d10"}, "degrees": SCATTER, "boulderFactor": 2},
        "splashFeet": 3, "rows": rows, "contents": CONTENTS,
        "proficiency": {"identifier": "throwing", "feet": int(prof.group(1)), "bonus": int(prof.group(2)), "perPoint": int(extra.group(1))},
        "urls": {"dmg": classdata.url(DMG), "phb": classdata.url(PHB), "strength": classdata.url(STR), "proficiency": classdata.url(PROF),
                 "scatter": "https://adnd2e.fandom.com/wiki/File:Scatter_Diagram.png"},
    }
    with open("module/rules/throw-tables.mjs", "w") as f:
        f.write("// GENERATED by tools/build-throw-tables.py from the AD&D 2e fandom wiki (MediaWiki API): do not edit.\n")
        f.write(f"// Sources: {DMG} rev {rev} (Table 45, rules), {PHB} rev {prev}, {STR} rev {srev}, {PROF} rev {trev}.\n")
        f.write(f"export const THROW_TABLES = {json.dumps(data, ensure_ascii=False)};\n")
    print({k: (v["direct"], v["splash"], v["area"]) for k, v in rows.items()}, data["proficiency"])


if __name__ == "__main__":
    main()
