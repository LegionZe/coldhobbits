#!/usr/bin/env python3
"""Generate module/rules/attack-option-tables.mjs: called shots and the Combat & Tactics attack options.

Sources (AD&D 2e fandom wiki, MediaWiki API), each figure regex-checked:
  - "Hitting a Specific Target (DMG)": called shot "+1 penalty to his initiative", "attack roll suffers a -4 penalty".
  - "Attack Options (POCT)": called shots -4 (DMG may make it -6 or -8); block (an attack roll against AC 4 against the
    opponent's attack; the lower successful roll wins); disarm, grab and trap (the attacker against AC 0, the victim against
    AC 4; a two-handed weapon gets 4 points on the target AC; no disarming a weapon two sizes larger; a disarmed weapon
    falls 1-10 feet away); grab (opposed Strength for the item, -3 with one hand); sap (-4, -8 against a helmet, Small or
    Medium only, 5% per point of damage up to 40%, 10% up to 80% against a surprised, asleep, restrained or held victim,
    3d10 rounds, 25% of the damage real); shield-punch (the table: damage and knockdown die by shield size; -2 primary /
    -4 punch, or substitute with no penalty); shield-rush (knockdown bonus by shield size, 4 per size step, +3 unaware,
    -2 four or more legs; a miss: Dexterity check or fall); pull/trip (the weapons named; opposed Strength as the lasso,
    without its +4: module/lasso.mjs).
Pull/trip weapons are mapped to item identifiers (polearms: the Skills & Powers Table 49 polearm group); identifiers are
asserted against packs/_source (weapons, aq-equipment) except `MISSING_OK`.
Run from the repo root after build-sp-weapon-data.py:  python3 tools/build-attack-option-tables.py
"""
import importlib.util
import json
import os
import re

_spec = importlib.util.spec_from_file_location("classdata", "tools/build-class-data.py")
classdata = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(classdata)

PULL_TRIP = {"bill": ["bill"], "bola": ["bola", "bolas"], "bow": ["short-bow", "composite-short-bow", "long-bow", "composite-long-bow"],
             "light or heavy crossbow": ["light-crossbow", "heavy-crossbow"], "horseman's flail": ["horseman-s-flail"],
             "harpoon": ["harpoon"], "javelin": ["javelin"], "khopesh": ["khopesh"], "lasso": ["lasso"], "mancatcher": ["mancatcher"],
             "net": ["net"], "footman's or horseman's pick": ["footman-s-pick", "horseman-s-pick"], "any polearm": ["POLEARMS"],
             "quarterstaff": ["quarterstaff"], "scourge": ["scourge"], "spear": ["spear", "long-spear"], "staff sling": ["staff-sling"],
             "whip": ["whip"]}
MISSING_OK = {"bola", "bolas"}
SHIELDS = {"Small": ["small-shield"], "Medium": ["medium-shield"], "Large": ["body-shield"]}  # body shield = large (implementation choice)


def need(text, pattern, what):
    m = re.search(pattern, text)
    assert m, f"rule changed: {what}"
    return m


def identifiers():
    ids = set()
    for folder in ("packs/_source/weapons", "packs/_source/aq-equipment"):
        for f in os.listdir(folder):
            if f.endswith(".json") and not f.startswith("_folder"):
                ids.add(json.load(open(os.path.join(folder, f)))["system"].get("identifier", "").removeprefix("poct-"))
    return ids


def build():
    dw, drev, _ = classdata.page("Hitting a Specific Target (DMG)")
    dflat = re.sub(r"\s+", " ", dw)
    need(dflat, r"he suffers a \+1 penalty to his initiative", "called shot initiative")
    need(dflat, r"his attack roll suffers a -4 penalty", "called shot -4")
    w, rev, _ = classdata.page("Attack Options (POCT)")
    f = re.sub(r"\s+", " ", w)
    need(f, r"Called shots normally present the attacker with a –4 penalty .{0,400}may inflict a –6 or even a –8 penalty", "harder called shots")
    need(f, r"she makes a normal attack roll against AC 4\. Her opponent makes a normal attack roll against her Armor Class", "block")
    need(f, r"the character attempting the disarm must roll against AC 0, while the intended victim of the disarm still rolls against an AC 4", "disarm ACs")
    need(f, r"using a two-handed weapon receives a 4-point bonus to the target Armor Class", "two-handed +4")
    need(f, r"It's impossible to disarm a weapon two sizes larger than your own", "disarm size")
    need(f, r"it falls 1–10 feet away", "disarmed weapon")
    need(f, r"must make an opposed roll against AC 0 while the intended victim rolls against AC 4", "grab ACs")
    need(f, r"If a character only grabs \(or was originally holding\) the item with one hand, then his Strength is reduced by 3 points", "grab one hand")
    need(f, r"rolling an opposed attack roll versus AC 0 while his opponent rolls against AC 4", "trap ACs")
    need(f, r"A sap is a type of called shot; it has a one-phase initiative penalty, and the attacker has a –4 penalty to hit\. The penalty increases to –8 if the defender is wearing some kind of helmet", "sap penalties")
    need(f, r"Only Small or Medium creatures can be sapped", "sap sizes")
    need(f, r"There is a 5% chance per point of damage of knocking out the victim, up to a maximum of 40%", "sap 5%")
    need(f, r"Sapping damage is like unarmed combat damage; 25% is real", "sap damage")
    need(f, r"increases to 10% per point of damage \(max 80%\) if the victim is surprised, asleep, restrained, or magically held", "sap 10%")
    need(f, r"Sapped characters remain unconcious for 3d10 full rounds", "sap duration")
    need(f, r"the primary weapon suffers a –2 penalty to attack rolls that round and the shield-punch attack is rolled with a –4 penalty", "shield-punch penalties")
    need(f, r"the character can ''substitute'' his normal attack for a shield punch, with no penalties", "shield-punch substitute")
    punch = {}
    for size, letter, dmg, kd in re.findall(r"\| (Small|Medium|Large) \|\| ([SML]) \|\| [^|]+\|\| 1 \|\| (1d\d) \|\| (d\d+)", w):
        punch[size] = {"size": letter, "damage": dmg, "knockdown": kd}
    assert list(punch) == ["Small", "Medium", "Large"], punch
    rush = {}
    for size, dmg, bonus in re.findall(r"\| (Small|Medium|Large) \|\| [SML] \|\| Base\* \|\| 1 \|\| (1d\d) \|\| (\+?\d)", w):
        rush[size] = {"damage": dmg, "knockdown": int(bonus)}
    assert rush == {"Small": {"damage": "1d3", "knockdown": 0}, "Medium": {"damage": "1d4", "knockdown": 1},
                    "Large": {"damage": "1d6", "knockdown": 3}}, rush
    need(f, r"4-point bonus or penalty for each size difference of the attacker versus the defender; \* \+3 if the defender was unaware of the shield-rush; \* –2 if the defender has four legs or more", "rush modifiers")
    need(f, r"must roll a successful Dexterity check to stay on his feet", "rush miss")
    m = need(f, r"The following weapons all qualify: ([^.]+)\.", "pull/trip weapons")
    names = [n.strip() for n in re.split(r",\s*(?:and\s+)?", m.group(1))]
    assert set(names) == set(PULL_TRIP), (set(names) ^ set(PULL_TRIP))
    ids = identifiers()
    from_sp = re.search(r'"polearms": \{[^}]*"ids": (\[[^\]]*\])', open("module/rules/sp-weapon-tables.mjs").read())
    assert from_sp, "polearm group"
    polearms = json.loads(from_sp.group(1))
    pull = sorted({i for n in names for i in (polearms if PULL_TRIP[n] == ["POLEARMS"] else PULL_TRIP[n])})
    missing = [i for i in pull if i not in ids and i not in MISSING_OK and i not in polearms]
    assert not missing, missing
    return {
        "calledShot": {"hit": -4, "harder": [-6, -8], "init": 1},
        "block": {"ac": 4}, "disarm": {"attackerAc": 0, "victimAc": 4, "twoHanded": 4, "maxSteps": 1, "falls": "1d10"},
        "grab": {"attackerAc": 0, "victimAc": 4, "oneHand": -3}, "trap": {"attackerAc": 0, "victimAc": 4},
        "sap": {"hit": -4, "helmet": -8, "sizes": ["S", "M"], "perPoint": 5, "max": 40, "helplessPerPoint": 10, "helplessMax": 80,
                "rounds": "3d10", "lasting": 0.25},
        "shieldPunch": {"primary": -2, "punch": -4, "shields": {k: punch[s] for s, ks in SHIELDS.items() for k in ks}},
        "shieldRush": {"perSize": 4, "unaware": 3, "fourLegs": -2, "shields": {k: rush[s] for s, ks in SHIELDS.items() for k in ks}},
        "pullTrip": pull, "url": classdata.url("Attack Options (POCT)"), "calledShotUrl": classdata.url("Hitting a Specific Target (DMG)")
    }, (drev, rev)


if __name__ == "__main__":
    data, revs = build()
    with open("module/rules/attack-option-tables.mjs", "w") as f:
        f.write("// GENERATED by tools/build-attack-option-tables.py from the AD&D 2e fandom wiki (MediaWiki API): do not edit.\n")
        f.write(f"// Sources: Hitting a Specific Target (DMG) rev {revs[0]}, Attack Options (POCT) rev {revs[1]}.\n")
        f.write(f"export const ATTACK_OPTIONS = {json.dumps(data, ensure_ascii=False)};\n")
    print(len(data["pullTrip"]), "pull/trip weapons;", data["shieldPunch"]["shields"])
