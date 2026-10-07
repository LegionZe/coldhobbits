#!/usr/bin/env python3
"""Generate module/rules/construction-tables.mjs: stronghold construction (DMGR2 The Castle Guide, Chapter 5).

Sources (AD&D 2e fandom wiki, MediaWiki API), every value parsed and every rule regex-checked:
  - "The Construction Site (TCG)": the production modifiers (PM) of climate, geography, ground cover, resources, local
    social structure, worker skill and worker morale ("=== Name (x.xx) ===" headings), multiplied together and rounded
    to two decimal places.
  - "Types of Castles (TCG)": the technological levels (TL 1-8).
  - "Castle Design (TCG)": the castle modules (tech level, time in man/weeks, gold).
  - "Average Construction Time & Cost (TCG)": ornate +50%, spartan -25%, overhead +10%, totals times the PM.
  - "The Work Force (TCG)": workers = time / 52; 10 gp a week per worker; double the work force 75% of the time, quadruple
    50%; 75% of it double the time, 50% four times; heroic characters (a man per level, plus a man per spell level castable
    a day), magical items and monsters (5% or 1% of their XP); work weeks a year = 52 / (climate PM x ground cover PM).
  - "Monthly Events (TCG)": the d100 table and each event's figures.
The worked example ("Castle on the Moors": PM 2.81, 298,452 gp with overhead, 838,650 gp and 51,322 man/weeks after the
PM, 987 workers, 1,811 more hired for 26 weeks = 470,860 gp, a 12th-level paladin counting 18, a 5th-level wizard 16,
21 work weeks a year) is recomputed and asserted.
Run from the repo root (after build-travel-tables.py, whose table parser it uses):  python3 tools/build-construction-tables.py
"""
import importlib.util
import json
import math
import re

_spec = importlib.util.spec_from_file_location("classdata", "tools/build-class-data.py")
classdata = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(classdata)
_tspec = importlib.util.spec_from_file_location("travel", "tools/build-travel-tables.py")
travel = importlib.util.module_from_spec(_tspec)
_tspec.loader.exec_module(travel)
need, table = travel.need, travel.table

SECTIONS = {"Climate Type": "climate", "Geography": "geography", "Ground Cover": "cover", "Resource Availability": "resources",
            "Local Social Structure": "social", "Worker Skill": "skill", "Worker Morale": "morale"}
EVENTS = {"No unusual event": "none", "Bad weather": "badWeather", "Severe weather": "severeWeather", "Monster attack": "monster",
          "Highwaymen": "highwaymen", "Local unrest": "unrest", "Labor dispute": "labor", "Raid": "raid", "Call to arms": "callToArms",
          "Civil war": "civilWar", "Royal visit": "royalVisit", "Bad omens": "omens", "Natural disaster": "disaster"}


def captioned(wiki, caption):
    """Rows of the table whose caption (inside the table) is `caption`."""
    i = wiki.index(caption)
    return table(wiki[wiki.rindex("{|", 0, i):], "{|")


def slug(label):
    words = re.sub(r"[^a-z0-9& ]+", " ", label.lower()).replace("&", "and").split()
    return words[0] + "".join(w.capitalize() for w in words[1:])


def site_modifiers(wiki):
    """{ section: [{ key, label, pm }] } from the "==Section==" / "===Name (x.xx)===" headings."""
    out = {}
    current = None
    for line in wiki.split("\n"):
        m2 = re.match(r"^==([^=].*?)==\s*$", line)
        m3 = re.match(r"^===(.+?) \((\d+\.\d\d)\)===\s*$", line)
        if m2:
            current = SECTIONS.get(m2.group(1).strip())
            if current:
                out[current] = []
        elif m3 and current:
            label = m3.group(1).strip()
            out[current].append({"key": slug(label), "label": label, "pm": float(m3.group(2))})
    return out


def build():
    site_w, site_rev, _ = classdata.page("The Construction Site (TCG)")
    s = re.sub(r"\s+", " ", site_w)
    need(s, r'A value of "1\.00" is the average from which all other numbers deviate', "PM 1.00 average")
    need(s, r"simply multiply all of the PMs that have been generated so far together\. It is recommended that you round off your figure to two decimal places", "PM product")
    site = site_modifiers(site_w)
    assert list(site) == list(SECTIONS.values()), list(site)
    assert [len(site[k]) for k in site] == [6, 6, 8, 4, 5, 5, 5], {k: len(v) for k, v in site.items()}
    pm = {k: {e["key"]: e["pm"] for e in v} for k, v in site.items()}
    moors = [pm["climate"]["temperate"], pm["geography"]["rollingHills"], pm["cover"]["swamp"], pm["resources"]["distantAndGood"],
             pm["social"]["agricultural"], pm["skill"]["average"], pm["morale"]["high"]]
    moors_pm = round(math.prod(moors), 2)
    assert moors_pm == 2.81, moors_pm

    types_w, types_rev, _ = classdata.page("Types of Castles (TCG)")
    tech = [{"level": int(a), "label": b} for a, b in captioned(types_w, "Technological Levels")]
    assert [t["level"] for t in tech] == list(range(1, 9)), tech

    design_w, design_rev, _ = classdata.page("Castle Design (TCG)")
    d = re.sub(r"\s+", " ", design_w)
    need(d, r"Castle design is a modular process", "modular")
    need(d, r"be sure to take into account the tech level of the area", "tech level")
    modules = []
    for row in table(design_w, "==Castle Modules=="):
        if not row[0] or row[0] == "Module Type":
            continue
        name, techl, time, gold = row
        label = re.sub(r"[.,]\s*", ", ", name, count=1)
        modules.append({"key": slug(label), "label": label, "tech": int(techl), "time": int(time.replace(",", "")), "gold": int(gold.replace(",", ""))})
    assert len(modules) == 34, len(modules)
    mod = {m["key"]: m for m in modules}
    assert mod["towerSmallSquare"] == {"key": "towerSmallSquare", "label": "Tower, Small Square", "tech": 3, "time": 840, "gold": 14000}
    assert mod["wallStoneAndGlacis"]["time"] == 44 and mod["wallStoneAndGlacis"]["gold"] == 720 and mod["wallWooden"]["gold"] == 5

    cost_w, cost_rev, _ = classdata.page("Average Construction Time & Cost (TCG)")
    c = re.sub(r"\s+", " ", cost_w)
    need(c, r"adding an additional 50% to the cost and time required", "ornate +50%")
    need(c, r"Spartan castles cost 25% less to build and require 25% less time", "spartan -25%")
    need(c, r"overhead is always assumed to add an extra 10% to the castle's cost and time", "overhead 10%")
    need(c, r"multiply them both by the production modifier \(PM\)", "times PM")
    # Castle on the Moors: 8 small square towers, 70 glacis walls, 214 stone walls, 384 wooden walls.
    parts = [("towerSmallSquare", 8), ("wallStoneAndGlacis", 70), ("wallStone", 214), ("wallWooden", 384)]
    base_gold = sum(mod[k]["gold"] * n for k, n in parts)
    base_time = sum(mod[k]["time"] * n for k, n in parts)
    assert (base_gold, base_time) == (271320, 16604), (base_gold, base_time)
    need(c, r"271,320 gold pieces", "example base gold")
    need(c, r"298,452", "example overhead gold")
    need(c, r"838,650 gold pieces", "example gold")
    need(c, r"51,322 man/weeks", "example time")
    gold = math.floor(base_gold * 1.1 * moors_pm + 1e-6)
    weeks = math.floor(base_time * 1.1 * moors_pm + 1e-6)
    assert (round(base_gold * 1.1), gold, weeks) == (298452, 838650, 51322), (base_gold * 1.1, gold, weeks)

    wf_w, wf_rev, _ = classdata.page("The Work Force (TCG)")
    w = re.sub(r"\s+", " ", wf_w)
    need(w, r"take the construction time that you have and divide it by 52\. The product of this calculation is the number of men that must be hired to complete the job in one year", "workers / 52")
    need(w, r"the cost to hire a worker is assumed to average out at 10 gold pieces a week", "10 gp a week")
    need(w, r"to increase his work force to twice its standard value, construction will be completed in 75% of the established time\. If the work force is quadrupled, the construction time is cut to 50% of its calculated value\. Larger work forces are not permitted", "larger work forces")
    need(w, r"to reduce the work force to 75% of its standard value, then construction time is doubled\. If the work force is cut to half its standard value, then construction time is quadrupled\. No reduction below 50%", "smaller work forces")
    need(w, r"any non-magic using character will be able to do the work of one man for every level", "heroic level")
    need(w, r"they count for one man for each spell level that they can cast in a given day\. Be sure to include any bonus spells for wisdom", "spell levels")
    need(w, r"it will be worth a number of men equal to 5% of the experience point award for its discovery", "item 5%")
    need(w, r"then it is worth 1% of its associated experience point award", "item 1%")
    need(w, r"it is worth 5% of the experience value that a player would receive for defeating it in combat", "monster 5%")
    need(w, r"If a monster is somewhat suitable, but has drawbacks, it is worth 1% of its XP value", "monster 1%")
    need(w, r"Multiply these two numbers together to determine the Work Time Modifier \(WTM\)", "WTM")
    need(w, r"divide 52 \(the number of weeks in a year\) by the WTM to determine how many weeks are available for work in a given year", "work weeks")
    need(w, r"The result, 987, is the number of men", "example 987")
    need(w, r"At 10 gold pieces each this works out to be a total of 470,860 gold pieces", "example hire cost")
    need(w, r"a 5th level wizard would be able to do the work of 16 men", "wizard 16")
    need(w, r"only 21 weeks out of the year will be suitable for work", "example 21 weeks")
    workers = round(weeks / 52)
    assert workers == 987, workers
    assert (workers * 4 - workers - 1150) * 26 * 10 == 470860
    assert 5 + 4 * 1 + 2 * 2 + 1 * 3 == 16
    assert round(52 / (pm["climate"]["temperate"] * pm["cover"]["swamp"])) == 21

    ev_w, ev_rev, _ = classdata.page("Monthly Events (TCG)")
    e = re.sub(r"\s+", " ", ev_w)
    events = []
    for rng, name in table(ev_w, "{|"):
        if rng == "1d100":
            continue
        lo, _, hi = rng.partition("-")
        lo_n, hi_n = (100, 100) if lo == "00" else (int(lo), int(hi or lo))
        events.append({"key": EVENTS[name], "label": name, "min": lo_n, "max": hi_n})
    assert events[0] == {"key": "none", "label": "No unusual event", "min": 1, "max": 65} and events[-1]["min"] == 100
    need(e, r"Each month, the referee should roll 1d100", "monthly d100")
    need(e, r"a full four weeks of construction is completed", "month = four weeks")
    need(e, r"no work is possible for the entire month", "bad weather")
    need(e, r"set the project back by 2-8 \(2d4\) weeks", "severe weather 2d4")
    need(e, r"The construction crew will lose 2-20 \(2d10\) laborers .{0,60}Funeral expenses will be 100 gold pieces for each man", "monster")
    need(e, r"No work on the castle can be done until after the beast is hunted down", "monster halt")
    need(e, r"work is reduced to half speed \(that is, one week of work is done every two weeks\) until they are dealt with", "highwaymen")
    need(e, r"Work will stop for 1d4 weeks\. After that time, construction may continue, but if the problem is not resolved it will be at half speed", "unrest")
    need(e, r"all work will stop for 318 \(3d6\) weeks while new workers are recruited\. In order to avoid the shut down, an additional 5 gold pieces per week must be paid to each man", "labor (3d6, 5 gp)")
    need(e, r"the elimination of 33-90% \(30\+ 3d20\) of the laborers", "raid 30+3d20")
    need(e, r"new workers must be hired at 10 gold pieces each per week for the rest of the project", "raid rehire")
    need(e, r"they are expected to send gold equal to 5% of the castle's total projected cost", "call to arms gold")
    need(e, r"they must give up 25% of their laborers for the rest of the project\. Regardless of the new number of workers, construction on the castle slows to half speed", "call to arms troops")
    need(e, r"A total of 1-4 \(1d4\) weeks of work will be lost", "royal visit")
    need(e, r"stop all work on the castle for 1 to 6 \(1d6\) weeks", "omens stop")
    need(e, r"they must roll on the event table once per week for the duration of the crisis\. In addition, any roll of 10 or less is re-rolled .{0,160}requires all rolls of 20 or less to be re-rolled", "omens ignored")
    need(e, r"All work to date is lost", "disaster")

    return {
        "site": site, "tech": tech, "modules": modules,
        "styles": {"normal": 1, "ornate": 1.5, "spartan": 0.75}, "overhead": 0.1,
        "work": {"weeksPerYear": 52, "wage": 10, "steps": [{"ratio": 4, "time": 0.5}, {"ratio": 2, "time": 0.75}, {"ratio": 1, "time": 1},
                                                            {"ratio": 0.75, "time": 2}, {"ratio": 0.5, "time": 4}],
                 "goodItem": 0.05, "someItem": 0.01, "goodMonster": 0.05, "someMonster": 0.01},
        "events": events, "monthWeeks": 4,
        "eventRules": {"severeWeeks": "2d4", "monsterLost": "2d10", "funeral": 100, "unrestWeeks": "1d4", "laborWeeks": "3d6", "laborPay": 5,
                       "raidPercent": "30 + 3d20", "callGold": 0.05, "callTroops": 0.25, "royalWeeks": "1d4", "omensWeeks": "1d6",
                       "omensReroll": [10, 20]},
        "example": {"pm": moors_pm, "gold": gold, "weeks": weeks, "workers": workers},
        "urls": {"site": classdata.url("The Construction Site (TCG)"), "design": classdata.url("Castle Design (TCG)"),
                 "cost": classdata.url("Average Construction Time & Cost (TCG)"), "work": classdata.url("The Work Force (TCG)"),
                 "events": classdata.url("Monthly Events (TCG)"), "types": classdata.url("Types of Castles (TCG)")}
    }, {"The Construction Site (TCG)": site_rev, "Types of Castles (TCG)": types_rev, "Castle Design (TCG)": design_rev,
        "Average Construction Time & Cost (TCG)": cost_rev, "The Work Force (TCG)": wf_rev, "Monthly Events (TCG)": ev_rev}


if __name__ == "__main__":
    data, revs = build()
    with open("module/rules/construction-tables.mjs", "w") as f:
        f.write("// GENERATED by tools/build-construction-tables.py from the AD&D 2e fandom wiki (MediaWiki API): do not edit.\n")
        f.write("// Sources: " + ", ".join(f"{k} rev {v}" for k, v in revs.items()) + ".\n")
        f.write(f"export const CONSTRUCTION = {json.dumps(data, ensure_ascii=False)};\n")
    print(len(data["modules"]), "modules;", {k: len(v) for k, v in data["site"].items()}, data["example"])
