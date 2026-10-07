#!/usr/bin/env python3
"""Generate module/rules/encounter-check-tables.mjs: random encounter checks, encounter tables and encounter distance.

Sources (AD&D 2e fandom wiki, MediaWiki API), every table parsed and every rule regex-checked:
  - "DMing Encounters (DMG)": "the number or less that must be rolled on 1d10"; patrolled or sparsely settled +1,
    heavily populated +2; dungeons "one encounter check is made every hour, with an encounter occurring on a roll of 1 on
    1d10", dangerous parts "once per turn (10 minutes of game time)".
  - "DMG Table 56": encounter chance and the six times of day (x = a check).
  - "Random Encounters (DMG)": frequencies 70% / 20% / 7% / 3%; unique creatures never on random tables.
  - "Creating Encounter Tables (DMG)" and "DMG Table 54": the 2-20 table (1d8 + 1d12) positions by frequency, with its
    two footnotes (two very rare instead of an uncommon, two rare instead of a common, 50% each); the percentile table
    (each frequency's percentage divided among its creatures).
  - "DMG Table 55": XP -> creature (dungeon) level.
  - "Encounter Distance (DMG)": Table 58.
Run from the repo root (after build-travel-tables.py, whose table parser it uses):
  python3 tools/build-encounter-check-tables.py
"""
import importlib.util
import json
import re

_spec = importlib.util.spec_from_file_location("classdata", "tools/build-class-data.py")
classdata = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(classdata)
_tspec = importlib.util.spec_from_file_location("travel", "tools/build-travel-tables.py")
travel = importlib.util.module_from_spec(_tspec)
_tspec.loader.exec_module(travel)
need, table = travel.need, travel.table

TERRAIN56 = {"Plain": "plain", "Scrub/brush": "scrub", "Forest": "forest", "Desert": "desert", "Hills": "hills",
             "Mountains": "mountains", "Swamp": "swamp", "Jungle": "jungle", "Ocean": "ocean", "Arctic": "arctic"}
# Start hours of the Table 56 time-of-day columns (7-10 a.m., 11 a.m.-2 p.m., 3-6 p.m., 7-10 p.m., 11 p.m.-2 a.m., 3-6 a.m.).
SLOTS = [7, 11, 15, 19, 23, 3]
SLOT_HEADERS = ["7-10 a.m.", "11 a.m.-2 p.m.", "3-6 p.m.", "7-10 p.m.", "11 p.m.-2 a.m.", "3-6 a.m."]
FREQ = {"Very rare": "veryRare", "Rare": "rare", "Uncommon*": "uncommon", "Common**": "common",
        "Very rare or rare (DM's choice)": "veryRareOrRare"}
DISTANCE = {"Both groups surprised": "both", "One group surprised": "one", "Smoke or heavy fog": "fog",
            "Jungle or dense forest": "jungle", "Light forest": "lightForest", "Scrub, brush or bush": "scrub",
            "Grassland, little cover": "grassland", "Nighttime or dungeon": "night"}


def dice(text):
    """Table 58 range: "3d6", "1d10 x 10" -> "1d10 * 10"; "Limit of sight" -> None."""
    t = text.strip()
    if t.lower().startswith("limit"):
        return None
    m = re.fullmatch(r"(\d+d\d+)(?: x (\d+))?", t)
    assert m, t
    return m.group(1) + (f" * {m.group(2)}" if m.group(2) else "")


def build():
    dm, dm_rev, _ = classdata.page("DMing Encounters (DMG)")
    d = re.sub(r"\s+", " ", dm)
    need(d, r"This lists the number or less that must be rolled on 1d10 for an encounter to occur", "1d10 or less")
    need(d, r"If an x appears under a specific time of day, an encounter check should be made", "x = check")
    need(d, r"If the region is patrolled or sparsely settled, the chance of an encounter increases by one\. In heavily populated areas, the chance of an encounter increases by two", "population")
    need(d, r"Normally, one encounter check is made every hour, with an encounter occurring on a roll of 1 on 1d10", "dungeon hourly")
    need(d, r"the number of checks can be increased to once per turn \(10 minutes of game time\)", "dungeon turn")
    need(d, r"If the characters engage in an activity that makes excessive noise .{0,80}an encounter check should be made immediately", "noise")
    need(d, r"The ''Monstrous Compendium'' lists a typical encounter size for each monster", "encounter size")

    t56, t56_rev, _ = classdata.page("DMG Table 56")
    headers = re.findall(r"^! (.+?)\s*$", t56, flags=re.M)
    assert [h for h in headers if h in SLOT_HEADERS] == SLOT_HEADERS, headers
    terrain = []
    for row in table(t56, "{|"):
        name, chance, *marks = row
        assert len(marks) == 6, row
        terrain.append({"key": TERRAIN56[name], "label": name, "chance": int(chance),
                        "slots": [h for h, m in zip(SLOTS, marks) if m == "x"]})
    assert len(terrain) == 10
    by = {t["key"]: t for t in terrain}
    assert by["swamp"]["chance"] == 4 and by["swamp"]["slots"] == SLOTS and by["plain"]["slots"] == [7, 15, 23]

    re_w, re_rev, _ = classdata.page("Random Encounters (DMG)")
    r = re.sub(r"\s+", " ", re_w)
    need(r, r"''Common'' creatures normally account for 70% of the local population", "common 70")
    need(r, r"''Uncommon'' monsters fill the next 20%", "uncommon 20")
    need(r, r"''Rare'' creatures account for another 7%", "rare 7")
    need(r, r"''Very rare'' creatures constitute only 3% of the population", "very rare 3")
    need(r, r"Such creatures should never be used on random encounter tables", "unique")
    need(r, r"a creature or NPC determined by the encounter tables will arrive in the area in the next few minutes", "arrival")

    ct, ct_rev, _ = classdata.page("Creating Encounter Tables (DMG)")
    c = re.sub(r"\s+", " ", ct)
    need(c, r"The 2-20 number is generated by adding the roll of 1d8 to that of 1d12", "1d8+1d12")
    need(c, r"If he has fewer of a given type than the chart provides for, he can repeat entries\. If he has more, he either drops some creatures or doubles up some entries", "repeat / double up")
    need(c, r"Then the number of creatures at each frequency is divided into the percentage for that frequency \(70%, 20%, 7%, and 3%, respectively", "percentile split")
    need(c, r"each level of difference between creature and table decreases the frequency of appearance by one", "level difference")

    t54, t54_rev, _ = classdata.page("DMG Table 54")
    need(re.sub(r"\s+", " ", t54), r"Or choice of two very rare creatures, 50% chance of each", "footnote *")
    need(re.sub(r"\s+", " ", t54), r"Or choice of two rare creatures, 50% chance of each", "footnote **")
    positions = {}
    for roll, freq in table(t54, "{|"):
        positions[int(roll)] = FREQ[freq]
    assert sorted(positions) == list(range(2, 21)), positions
    assert positions[9] == "common" and positions[4] == "veryRareOrRare" and positions[20] == "veryRare"

    t55, t55_rev, _ = classdata.page("DMG Table 55")
    levels = []
    for xp, lvl in table(t55, "{|"):
        lo = re.match(r"([\d,]+)", xp).group(1).replace(",", "")
        levels.append({"min": int(lo), "level": int(lvl)})
    assert levels[0] == {"min": 1, "level": 1} and levels[-1] == {"min": 10001, "level": 10}

    dist_w, dist_rev, _ = classdata.page("Encounter Distance (DMG)")
    need(re.sub(r"\s+", " ", dist_w), r"In situations where no cover is possible, encounters will occur at the limit of vision", "no cover")
    distance = {}
    for row in table(dist_w, "{|"):
        if row[0] == "No surprise:":
            continue
        distance[DISTANCE[row[0]]] = dice(row[1])
    assert distance == {"both": "3d6", "one": "4d6", "fog": "6d6", "jungle": "1d10 * 10", "lightForest": "2d6 * 10",
                        "scrub": "2d12 * 10", "grassland": "5d10 * 10", "night": None}, distance

    return {
        "die": "1d10", "population": {"wild": 0, "sparse": 1, "dense": 2},
        "dungeon": {"chance": 1, "hour": 3600, "turn": 600},
        "terrain": terrain, "slotHours": 4,
        "frequencies": {"common": 70, "uncommon": 20, "rare": 7, "veryRare": 3},
        "twoTwenty": {"formula": "1d8 + 1d12", "positions": positions, "doubleUp": {"uncommon": "veryRare", "common": "rare"}},
        "percentile": {"formula": "1d100"},
        "levels": levels, "distance": distance,
        "urls": {"checks": classdata.url("DMing Encounters (DMG)"), "table56": classdata.url("DMG Table 56"),
                 "tables": classdata.url("Creating Encounter Tables (DMG)"), "distance": classdata.url("Encounter Distance (DMG)")}
    }, {"DMing Encounters (DMG)": dm_rev, "DMG Table 56": t56_rev, "Random Encounters (DMG)": re_rev,
        "Creating Encounter Tables (DMG)": ct_rev, "DMG Table 54": t54_rev, "DMG Table 55": t55_rev, "Encounter Distance (DMG)": dist_rev}


if __name__ == "__main__":
    data, revs = build()
    with open("module/rules/encounter-check-tables.mjs", "w") as f:
        f.write("// GENERATED by tools/build-encounter-check-tables.py from the AD&D 2e fandom wiki (MediaWiki API): do not edit.\n")
        f.write("// Sources: " + ", ".join(f"{k} rev {v}" for k, v in revs.items()) + ".\n")
        f.write(f"export const ENCOUNTER_CHECKS = {json.dumps(data, ensure_ascii=False)};\n")
    print(len(data["terrain"]), "terrains;", data["distance"])
