#!/usr/bin/env python3
"""Generate module/rules/travel-tables.mjs: overland travel, weather, water and air movement, getting lost.

Sources (AD&D 2e fandom wiki, MediaWiki API), every table parsed and every rule regex-checked:
  - "Movement (PHB)", Cross-Country Movement: a 10-hour marching day, "twice his movement rate in miles", force march
    "2 1/2 times", a Constitution check (creatures: save vs. death) with -1 per consecutive day, -1 to attack rolls per
    day (cumulative), half a day's rest per day of force marching.
  - "Movement (DMG)": mounts move "a number of miles per day equal to their movement rate"; hitched animals at half rate;
    Table 73 (optional, reductions for one round), darkness (1d12: 1-4 on course, 5-8 right, 9-12 left), Table 74
    (movement points per mile), trails (half cost), roads (1/2 point per mile on level or rolling ground, as a trail in
    mountains), vehicles only on cost 1 or less without a road or trail.
  - "Terrain Obstacles and Hindrances (DMG)": Table 75 (added points or multipliers).
  - "Movement on Water (DMG)": Table 76 (boats; sail triples "*" rows), Table 77 (ships), Table 78 (sailing/rowing
    modifiers, seaworthiness checks, -45%), Table 79 (2d6 by season; hurricane only after a gale), adverse winds 1d6 5-6,
    off course by half at storm strength, ports +50% seaworthiness, yards per round = speed x 30.
  - "Aerial Movement (DMG)": 1d6 precipitation (6 in summer and winter, 5-6 in spring and fall; storms and hurricanes
    automatic), Table 80 (cumulative multipliers).
  - "Getting Lost (DMG)": Tables 81/82, one check per day off roads, rivers and trails; the worked example (15%).
Run from the repo root:  python3 tools/build-travel-tables.py
"""
import importlib.util
import json
import re

_spec = importlib.util.spec_from_file_location("classdata", "tools/build-class-data.py")
classdata = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(classdata)


def need(text, pattern, what):
    m = re.search(pattern, text)
    assert m, f"rule changed: {what}"
    return m


def clean(cell):
    c = re.sub(r"\{\{frac\|(\d+)\|(\d+)\}\}", r"\1/\2", cell)
    c = re.sub(r"\{\{br\}\}", " ", c).replace("&nbsp;", " ")
    return re.sub(r"'''", "", c).strip()


def table(wiki, title):
    """Rows (lists of cells, header row excluded) of the article table that follows `title`."""
    i = wiki.index(title)
    start = wiki.index("{|", i)
    t = wiki[start:wiki.index("\n|}", start)]
    rows = []
    for chunk in re.split(r"\n\|-", t)[1:]:
        cells = []
        for line in chunk.split("\n"):
            if line.startswith("|") and not line.startswith(("|}", "|+")):
                cells += [clean(c) for c in line[1:].split("||")]
        if cells and not all(c.startswith("'''") for c in cells):
            rows.append(cells)
    return rows


def num(text):
    t = text.strip()
    if "/" in t:
        a, b = t.split("/")
        return int(a) / int(b)
    return float(t) if "." in t else int(t)


def slug(label):
    return re.sub(r"[^a-z0-9]+", "-", label.lower()).strip("-")


ROUND = {"Darkness": "darkness", "Heavy brush or forest": "brush", "Ice or slippery footing": "ice",
         "Rugged or rocky ground": "rugged", "Soft sand or snow, knee-deep": "kneeDeep",
         "Water or snow, waist-deep": "waistDeep", "Water or snow, shoulder-deep": "shoulderDeep"}
# Table 74 terrain -> Table 81 surroundings (implementation choice, the DM may pick another) and whether it is
# mountainous (roads there are only as good as trails) or level/rolling.
TERRAIN = {"Barren, wasteland": ("barren", "level", False), "Clear, farmland": ("clear", "level", False),
           "Desert, rocky": ("desertRocky", "rough", False), "Desert, sand": ("desertSand", "level", False),
           "Forest, heavy": ("forestHeavy", "thickForest", False), "Forest, light": ("forestLight", "lightWood", False),
           "Forest, medium": ("forestMedium", "lightWood", False), "Glacier": ("glacier", "level", False),
           "Hills, rolling": ("hillsRolling", "rolling", False), "Hills, steep (foothills)": ("hillsSteep", "rough", False),
           "Jungle, heavy": ("jungleHeavy", "jungle", False), "Jungle, medium": ("jungleMedium", "jungle", False),
           "Marsh, swamp": ("marsh", "swamp", False), "Moor": ("moor", "rolling", False),
           "Mountains, high": ("mountainsHigh", "mountain", True), "Mountains, low": ("mountainsLow", "mountain", True),
           "Mountains, medium": ("mountainsMedium", "mountain", True),
           "Untraveled plains, grassland, heath": ("plains", "level", False), "Scrub, brushland": ("scrub", "level", False),
           "Tundra": ("tundra", "level", False)}
OBSTACLES = {"Chasm": "chasm", "Cliff": "cliff", "Duststorm, sandstorm": "duststorm", "Freezing cold": "cold",
             "Gale-force winds": "galeWinds", "Heavy fog": "fog", "Ice storm": "iceStorm", "Mud": "mud",
             "Rain, heavy": "rainHeavy", "Rain, light": "rainLight", "Rain, torrential": "rainTorrential", "Ravine": "ravine",
             "Ridge": "ridge", "River": "river", "Scorching heat": "heat", "Snow, blizzard": "blizzard",
             "Snow, normal": "snow", "Stream": "stream"}
WIND = {"Becalmed": "becalmed", "Light breeze": "light", "Favorable": "favorable", "Strong winds": "strong", "Storm": "storm",
        "Gale": "gale", "Hurricane": "hurricane"}
SAIL = {"Adverse": "adverse", "Becalmed": "becalmed", "(average)": "favorable", "(strong)": "strong", "Gale": "gale",
        "Hurricane": "hurricane", "Light breeze": "light", "Storm": "storm"}
AIR = {"Hurricane": "hurricane", "Gale": "gale", "Storm": "storm", "Rain or snow": "precipitation", "Strong winds": "strong"}
LOST = {"Level, open ground": "level", "Rolling ground": "rolling", "Lightly wooded": "lightWood",
        "Rough (wooded and hilly)": "rough", "Swamp": "swamp", "Mountainous": "mountain", "Open sea": "sea",
        "Thick forest": "thickForest", "Jungle": "jungle"}
LOST_MODS = {"Featureless (no distinguishable landmarks)*": "featureless", "Darkness": "darkness", "Overcast": "overcast",
             "Navigator with group": "navigator", "Landmark sighted": "landmark", "Local guide": "guide",
             "Poor trail": "poorTrail", "Raining": "raining", "Directions": "directions", "Fog or mist": "fog"}


def mult(text):
    t = text.replace("x", "").replace("*", "").strip()
    return None if t in ("NA", "") else num(t)


def build():
    phb, phb_rev, _ = classdata.page("Movement (PHB)")
    p = re.sub(r"\s+", " ", phb)
    need(p, r"A normal day's marching lasts for 10 hours", "march hours")
    need(p, r"a character can walk twice his movement rate in miles in those 10 hours", "march x2")
    need(p, r"Force marching enables a character to travel 2 \{\{frac\|1\|2\}\} times his movement rate in miles", "force x2.5")
    need(p, r"At the end of each day of the march, the character or creature must roll a Constitution check", "con check")
    need(p, r"Large parties \(such as army units\) make the check at the average Constitution of the group", "average con")
    need(p, r"Creatures must roll a saving throw vs\. death at the end of each day's force marching", "creatures save")
    need(p, r"A -1 penalty is applied to the check for each consecutive day spent force marching", "check -1")
    need(p, r"Recovery requires half a day per day of force marching", "recovery")
    need(p, r"each day of force marching results in a -1 penalty to all attack rolls\. This modifier is cumulative\. Half a day's rest is required to remove one day's worth", "attack -1")

    dmg, dmg_rev, _ = classdata.page("Movement (DMG)")
    d = re.sub(r"\s+", " ", dmg)
    need(d, r"all mounts are able to move a number of miles per day equal to their movement rate", "mount miles")
    need(d, r"The movement rate of a horse or other animal is automatically reduced by half when hitched", "hitched half")
    need(d, r"On a 1-4 the character maintains the desired course\. On a 5-8 he veers to the right and on a 9-12 he goes to the left", "darkness d12")
    need(d, r"The reduction applies to all movement for a single round\. When a character is in two different types of terrain during the same round, use the worst", "Table 73 round")
    need(d, r"It is impossible for such vehicles to cross any terrain that has a movement point cost greater than 1 unless they are following a road or trail", "vehicles")
    need(d, r"When traveling along a trail, the movement point cost is half normal for the terrain type", "trail half")
    need(d, r"In areas of level or rolling ground, such as forests and plains, roads reduce the movement cost to one-half point per mile\. In areas of mountainous ground, roads are no better than trails", "roads")
    need(d, r"Trails through settled farmland offer no improvement", "farmland trails")
    t73 = table(dmg, "Table 73: Terrain Effects on Movement===")
    round_ = []
    for name, red in t73:
        round_.append({"key": ROUND[name], "label": name, "reduced": num(red.rstrip("*")), "faster": red.endswith("*")})
    assert [r["key"] for r in round_] == list(ROUND.values()), round_
    t74 = table(dmg, "Table 74: Terrain Costs for Overland Movement===")
    terrain = []
    for name, cost in t74:
        key, lost, mountain = TERRAIN[name]
        terrain.append({"key": key, "label": name, "cost": num(cost), "lost": lost, "mountain": mountain})
    assert len(terrain) == len(TERRAIN), len(terrain)
    assert next(t for t in terrain if t["key"] == "forestHeavy")["cost"] == 4 and next(t for t in terrain if t["key"] == "clear")["cost"] == 0.5

    obs_w, obs_rev, _ = classdata.page("Terrain Obstacles and Hindrances (DMG)")
    o = re.sub(r"\s+", " ", obs_w)
    need(o, r"crossing a ridge in the high mountains costs nine movement points for that mile instead of the normal eight", "ridge example")
    need(o, r"Snow, for example, doubles the cost of crossing the plains", "snow example")
    need(o, r"These extremes must be in excess of the norm expected of the character or creature", "extremes")
    need(o, r"This cost is negated by the presence of a bridge or ford", "bridge")
    obstacles = []
    for name, mod in table(obs_w, "Table 75: Terrain Modifiers=="):
        base = name.rstrip("*")
        stars = len(name) - len(base)
        m = mod.strip()
        entry = {"key": OBSTACLES[base], "label": base, "note": stars}
        if m.startswith("x"):
            entry["mult"] = num(m[1:])
        else:
            entry["add"] = num(m.lstrip("+"))
        obstacles.append(entry)
    assert len(obstacles) == len(OBSTACLES)
    by = {e["key"]: e for e in obstacles}
    assert by["ridge"]["add"] == 1 and by["snow"]["mult"] == 2 and by["ravine"]["add"] == 0.5 and by["blizzard"]["mult"] == 4

    water, water_rev, _ = classdata.page("Movement on Water (DMG)")
    w = re.sub(r"\s+", " ", water)
    need(w, r"If the boat is traveling downstream \(in the direction of the current\), add the speed of the current", "current")
    need(w, r"These vessels can triple their hourly movement when the sail is raised", "sail triple")
    need(w, r"multiply the current speed times 30\. This is the yards traveled per round", "yards per round")
    need(w, r"Ports and anchorages give a seaworthiness bonus of \+50%", "port +50")
    need(w, r"roll 2d6 and find the result on", "2d6 weather")
    need(w, r"'''Adverse winds''' are determined by rolling 1d6\. On a 5 or 6, the winds are unfavorable", "adverse 1d6")
    need(w, r"When adverse winds are storm strength or greater, the ship will be blown off-course by at least half its movement", "off course")
    need(w, r"A seaworthiness check with a -45% penalty is required", "-45")
    need(w, r"Hurricanes occur only if the previous day's weather was gale\. If not, treat the result as a gale", "hurricane after gale")
    need(w, r"make a Wisdom check \(modified for seamanship proficiency, if this is used\) to prevent capsizing", "capsizing")
    boats = []
    for vessel, feet, mph, cargo, length in table(water, "Table 76: Boat Movement==="):
        boats.append({"key": slug(vessel), "label": vessel, "feet": int(feet), "mph": num(mph.rstrip("*")), "sail": mph.endswith("*"),
                      "cargo": cargo, "length": length})
    assert len(boats) == 7 and boats[0]["key"] == "kayak" and boats[-1]["sail"]
    ships = []
    for name, base, emergency, sea in table(water, "Table 77: Ship Types==="):
        parts = [int(x) for x in base.split("/")]
        ships.append({"key": slug(name), "label": name, "sail": parts[0], "row": parts[1] if len(parts) > 1 else None,
                      "emergency": int(emergency), "seaworthiness": int(sea.rstrip("%"))})
    assert len(ships) == 10 and next(s for s in ships if s["key"] == "galleon")["seaworthiness"] == 75
    sailing = {}
    for row in table(water, "Table 78: Sailing Movement Modifiers==="):
        if row[0] == "Favorable":
            continue
        name, s, r = row
        check = 2 if "**" in s or "**" in r else (1 if "*" in s or "*" in r else 0)
        sailing[SAIL[name]] = {"sail": mult(s), "row": mult(r), "check": check}
    assert sailing["gale"] == {"sail": 4, "row": 0.5, "check": 1} and sailing["hurricane"]["check"] == 2 and sailing["becalmed"]["sail"] is None
    weather = {"spring": [], "summer": [], "winter": []}
    for roll, spring, summer, winter in table(water, "Table 79: Weather Conditions==="):
        for season, v in (("spring", spring), ("summer", summer), ("winter", winter)):
            weather[season].append(WIND[v.rstrip("*")])
    assert all(len(v) == 11 for v in weather.values()) and weather["summer"][0] == "becalmed" and weather["winter"][-1] == "hurricane"

    air, air_rev, _ = classdata.page("Aerial Movement (DMG)")
    a = re.sub(r"\s+", " ", air)
    need(a, r"the DM rolls 1d6 to determine precipitation \(although storms and hurricanes have automatic precipitation\)\. During summer and winter, a 6 on the die indicates rain or snow\. In spring and fall, a 5 or 6 is rain", "precipitation")
    need(a, r"These modifiers are cumulative", "cumulative")
    need(a, r"clear sky being treated as clear terrain", "clear sky")
    aerial = {}
    for name, mod in table(air, "Table 80: Aerial Movement Modifiers=="):
        aerial[AIR[name]] = None if mod == "Not possible" else mult(mod)
    assert aerial == {"hurricane": None, "gale": 0.25, "storm": 0.25, "precipitation": 0.5, "strong": 0.5}, aerial

    lost_w, lost_rev, _ = classdata.page("Getting Lost (DMG)")
    lw = re.sub(r"\s+", " ", lost_w)
    need(lw, r"One check should be made per day", "one per day")
    need(lw, r"If the die roll is less than the percentage, the characters are lost", "less than")
    need(lw, r"Once a group is lost, no further checks need be made", "no further checks")
    need(lw, r"Their chance of getting lost is 15%—40 for being in wooded hills minus 15 because they've got a landmark minus 10 because they're on a trail", "worked example")
    lost = [{"key": LOST[n], "label": n, "pct": int(v.rstrip("%"))} for n, v in table(lost_w, "Table 81: Chance of Getting Hopelessly Lost===")]
    assert len(lost) == 9
    lost_mods = []
    for n, v in table(lost_w, "Table 82: Lost Modifiers==="):
        lost_mods.append({"key": LOST_MODS[n], "label": n.rstrip("*"), "mod": None if v.startswith("Variable") else int(v)})
    lm = {m["key"]: m["mod"] for m in lost_mods}
    lc = {l["key"]: l["pct"] for l in lost}
    assert lc["rough"] + lm["landmark"] + lm["poorTrail"] == 15  # the worked example

    return {
        "march": {"hours": 10, "normal": 2, "force": 2.5, "checkPerDay": -1, "attackPerDay": -1, "restPerDay": 0.5, "creatureSave": "par"},
        "mounted": {"milesPerRate": 1, "hitched": 0.5},
        "round": round_, "darkness": {"die": "1d12", "course": [1, 4], "right": [5, 8], "left": [9, 12]},
        "terrain": terrain, "trail": 0.5, "road": 0.5, "vehicleMaxCost": 1,
        "obstacles": obstacles,
        "boats": boats, "sailFactor": 3, "ships": ships, "yardsPerRound": 30, "portBonus": 50,
        "sailing": sailing, "seaPenalty": 45,
        "weather": {"die": "2d6", "seasons": weather, "hurricaneAfter": "gale", "adverse": {"die": "1d6", "min": 5},
                    "offCourse": ["storm", "gale", "hurricane"], "precipitation": {"die": "1d6", "spring": 5, "fall": 5, "summer": 6, "winter": 6,
                                                                                     "always": ["storm", "hurricane"]}},
        "aerial": aerial, "lost": lost, "lostMods": lost_mods,
        "urls": {"phb": classdata.url("Movement (PHB)"), "dmg": classdata.url("Movement (DMG)"),
                 "obstacles": classdata.url("Terrain Obstacles and Hindrances (DMG)"), "water": classdata.url("Movement on Water (DMG)"),
                 "air": classdata.url("Aerial Movement (DMG)"), "lost": classdata.url("Getting Lost (DMG)")}
    }, {"Movement (PHB)": phb_rev, "Movement (DMG)": dmg_rev, "Terrain Obstacles and Hindrances (DMG)": obs_rev,
        "Movement on Water (DMG)": water_rev, "Aerial Movement (DMG)": air_rev, "Getting Lost (DMG)": lost_rev}


if __name__ == "__main__":
    data, revs = build()
    with open("module/rules/travel-tables.mjs", "w") as f:
        f.write("// GENERATED by tools/build-travel-tables.py from the AD&D 2e fandom wiki (MediaWiki API): do not edit.\n")
        f.write("// Sources: " + ", ".join(f"{k} rev {v}" for k, v in revs.items()) + ".\n")
        f.write(f"export const TRAVEL = {json.dumps(data, ensure_ascii=False)};\n")
    print(len(data["terrain"]), "terrains,", len(data["obstacles"]), "obstacles,", len(data["ships"]), "ships")
