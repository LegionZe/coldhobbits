#!/usr/bin/env python3
"""Generate module/rules/forage-tables.mjs: living off the land (module/forage.mjs; owner's request 1.0.55).

Sources (AD&D 2e fandom wiki, MediaWiki API), each rule regex-checked:
- "Hunting (Proficiency)": Player's Handbook section (a -1 penalty per nonproficient hunter in the party; a success
  comes within 101 to 200 yards (100+1d100) of an animal; a check for each 20 yards closed; the hunter surprises the
  game) and The Complete Barbarian's Handbook "Table 33: Rations Produced Per Animal" (S/M/L/H; left of the slash = average
  butchering, right = with the animal rending proficiency; a ration feeds an average adult for one day).
- "Fishing (Proficiency)": Player's Handbook section (a check each hour; fish = Wisdom score minus the die roll; a net
  catches three times as many) and The Complete Barbarian's Handbook modifications ("An adult can live on two typical game
  fish ... per day"; "Table 32: Quality of Fishing Spots" poor 1/2 (round down), average 1, good 2).
- "Survival (Proficiency)": Player's Handbook section (food or water found with a proficiency check; "If the check is
  failed, no more attempts can be made that day") and Skills & Powers ("2d6 turns to forage enough food for one person",
  "1d6 hours to find water"; owner's ruling 1.0.55: a success gives one day's food or water for the character).
Run from the repo root:  python3 tools/build-forage-tables.py
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
need = travel.need

HUNT, FISH, SURV = "Hunting (Proficiency)", "Fishing (Proficiency)", "Survival (Proficiency)"
WORDS = {"two": 2, "three": 3}
FRACTIONS = {"{{frac|1|2}} (round down)": 0.5, "1": 1, "2": 2}


def flat(w):
    w = re.sub(r"\[\[[^\]|]*\|([^\]]*)\]\]", r"\1", w).replace("[[", "").replace("]]", "")
    return re.sub(r"\s+", " ", w.replace("'''", "").replace("''", ""))


def rows(w, caption):
    """Rows of the article table whose caption contains `caption` (cells stripped)."""
    m = re.search(r"\{\|[^\n]*\n\|\+[^\n]*" + re.escape(caption) + r".*?\n\|\}", w, flags=re.S)
    assert m, f"table missing: {caption}"
    out = []
    for line in m.group(0).split("\n"):
        if line.startswith("|") and not line.startswith(("|+", "|-", "|}")):
            out.append([c.strip() for c in line[1:].split("||")])
    return out


def main():
    hw, hrev, _ = classdata.page(HUNT)
    h = flat(hw)
    need(h, r"A proficiency check must be made with a -1 penalty to the ability score for every nonproficient hunter in the party", "hunting penalty")
    need(h, r"have come within 101 to 200 yards \(100\+1d100\) of an animal", "hunting distance")
    need(h, r"a proficiency check must be made for each 20 yards closed", "closing")
    need(h, r"If the stalking is successful, the hunter automatically surprises the game", "surprise")
    need(h, r"A ration is the food necessary to feed an average adult for one day", "ration")
    need(h, r"The figures to the left of the slash indicate the number of rations obtained when a character of average skill handles the butchering\. The figures to the right show the number of rations obtained by a character with the animal rending proficiency", "slash")
    rations = {}
    for size, cell in rows(hw, "Table 33: Rations Produced Per Animal"):
        m = re.fullmatch(r"(\d+)-(\d+)/(\d+)-(\d+)\*?", cell)
        assert m and size in "SMLH", (size, cell)
        a, b, c, d = map(int, m.groups())
        rations[size] = {"average": f"1d{b - a + 1}+{a - 1}" if a > 1 else f"1d{b}", "rending": f"1d{d - c + 1}+{c - 1}" if c > 1 else f"1d{d}",
                         "text": cell}
    assert list(rations) == ["S", "M", "L", "H"] and rations["M"]["text"] == "3-4/4-6", rations

    fw, frev, _ = classdata.page(FISH)
    f = flat(fw)
    need(f, r"Each hour the character spends fishing, roll a proficiency check\. If the roll is failed, no fish are caught that hour", "fishing hourly")
    need(f, r"land fish equal to the difference between the die roll and the character's Wisdom score", "fish count")
    net = need(f, r"A net will catch (\w+) times this amount", "net")
    per = need(f, r"An adult can live on (\w+) typical game fish \(such as trout, bass, or bullhead\) per day", "fish per day")
    spots = {q.lower(): FRACTIONS[v] for q, v in rows(fw, "Table 32: Quality of Fishing Spots")}
    assert spots == {"poor": 0.5, "average": 1, "good": 2}, spots

    sw, srev, _ = classdata.page(SURV)
    s = flat(sw)
    need(s, r"He knows the methods to locate or gather drinkable water\. He knows how to find basic, not necessarily appetizing, food where none is apparent", "food and water")
    need(s, r"When using the proficiency to find food or water, the character must roll a proficiency check\. If the check is failed, no more attempts can be made that day", "once a day")
    turns = need(s, r"Typically it will take (1d6) hours to find water, and (2d6) turns to forage enough food for one person", "S&P times")

    data = {
        "hunting": {"penaltyPerNonhunter": -1, "distance": "100+1d100", "closeYards": 20, "rations": rations,
                    "rending": "animal-rending", "url": classdata.url(HUNT)},
        "fishing": {"netMultiplier": WORDS[net.group(1)], "fishPerRation": WORDS[per.group(1)], "spots": spots, "url": classdata.url(FISH)},
        "survival": {"waterTime": turns.group(1), "foodTurns": turns.group(2), "perSuccess": 1, "url": classdata.url(SURV)},
        "foodId": "foraged-food-per-day"
    }
    assert data["fishing"]["netMultiplier"] == 3 and data["fishing"]["fishPerRation"] == 2, data
    with open("module/rules/forage-tables.mjs", "w") as out:
        out.write("// GENERATED by tools/build-forage-tables.py from the AD&D 2e fandom wiki (MediaWiki API): do not edit.\n")
        out.write(f"// Sources: {HUNT} rev {hrev}, {FISH} rev {frev}, {SURV} rev {srev} (rules regex-checked).\n")
        out.write(f"export const FORAGE = {json.dumps(data, ensure_ascii=False)};\n")
    print(json.dumps(data, indent=1))


if __name__ == "__main__":
    main()
