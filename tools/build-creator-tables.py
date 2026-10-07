#!/usr/bin/env python3
"""Generate module/rules/creator-tables.mjs: the rules the GM creators (module/apps/creators.mjs) fill in.

Monster creator:
  - DMG Table 31 Creature Experience Point Values and Table 32 Hit Dice Value Modifiers ("Experience Tables (DMG)"); the
    procedure and its worked example are regex-checked in "Experience Point Awards (DMG)": the Table 32 modifiers are added
    to the Hit Dice ("a 1 + 1 Hit Die creature with +2 Hit Dice of special abilities becomes a 3 + 1 Hit Dice creature")
    and the adjusted Hit Dice read on Table 31 (orc 15, rust monster 5 + 2 = 420, green slime 2 + 3 = 175, asserted).
    "Level 3 or greater spells, not cumulative with previous award": the two spell rows exclude each other.
  - Monstrous Manual size, intelligence and morale bands ("How to use this Book (MM)").
Magic item creator: charges when found for wands, rods and staves (`CHARGES` of build-magic-item-data.py, each pattern
checked again on its DMG page here). Magical weapon and armour experience values come from TREASURE_ROLLS.arms (DMG
Tables 105/107, build-treasure-tables.py).
Patron creator: DMG Table 70 General Traits (1d20 general trait, d100 specific trait; "DMG Table 70") and the appearance
word lists of "Personality (DMG)" (Age, Height, Weight, Hair, Manner of speech, Facial characteristics; the DM "can
randomly determine everything (1d20 for a major trait, percentile dice for characteristics)").
Run from the repo root:  python3 tools/build-creator-tables.py
"""
import importlib.util
import json
import re

_spec = importlib.util.spec_from_file_location("classdata", "tools/build-class-data.py")
classdata = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(classdata)


def need(text, pattern, what):
    assert re.search(pattern, text), f"rule changed: {what}"


def slug(s):
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")


def hd_bound(text):
    """'3+1' -> 3.5, '4' -> 4, '1-1' -> 0.5, '10+' -> 10.5, '12+' -> 12.5 (the scale of xpForHitDice in creators.mjs)."""
    m = re.match(r"^(\d+)\s*([+-])\s*(\d*)$", text.strip())
    if m:
        return int(m.group(1)) + (0.5 if m.group(2) == "+" else -0.5)
    return float(text)


def table31(wiki):
    rows = classdata.table_rows(wiki, "Table 31")
    out = []
    for label, xp in rows:
        value = int(re.match(r"[\d,]+", xp.replace(" ", "")).group(0).replace(",", ""))
        if label.startswith("Less than"):
            out.append({"label": label, "min": None, "max": 0.5, "xp": value, "maxOpen": True})
        elif "to" in label:
            lo, hi = [x.strip() for x in label.split("to")]
            out.append({"label": label, "min": hd_bound(lo), "max": hd_bound(hi), "xp": value})
        else:
            m = re.match(r"^(\d+)\+$", label.strip())
            assert m, label
            per = re.search(r"\+ ([\d,]+) per additional Hit Die over (\d+)", xp)
            assert per, xp
            out.append({"label": label, "min": int(m.group(1)), "max": None, "xp": value,
                        "perDie": int(per.group(1).replace(",", "")), "over": int(per.group(2))})
    return out


def table32(wiki):
    rows = classdata.table_rows(wiki, "Table 32")
    out = []
    for label, mod in rows:
        label = re.sub(r"\{\{frac\|1\|2\}\}", "1/2", label)
        out.append({"key": slug(label), "label": label, "hd": int(mod)})
    return out


def xp_for(hd, rows):
    for r in rows:
        if r["max"] is None and hd >= r["min"]:
            return r["xp"] + r["perDie"] * (int(hd) - r["over"])
        if r["min"] is None and hd < r["max"]:
            return r["xp"]
        if r["min"] is not None and r["max"] is not None and r["min"] <= hd <= r["max"]:
            return r["xp"]
    raise AssertionError(hd)


def bands(wiki, title):
    i = wiki.index(f"'''{title}'''")
    block = wiki[i:wiki.index("|}", i)]
    out = []
    for m in re.finditer(r"\|\s*(\d+)(?:\s*-\s*(\d+))?(\+)?\s*(?:\|\||\n\|)\s*([^\n|]+)", block):
        lo, hi, plus, label = int(m.group(1)), m.group(2), m.group(3), m.group(4).strip()
        out.append({"min": lo, "max": None if plus else int(hi or lo), "label": label})
    return out


if __name__ == "__main__":
    xw, xrev, _ = classdata.page("Experience Tables (DMG)")
    aw, arev, _ = classdata.page("Experience Point Awards (DMG)")
    mw, mrev, _ = classdata.page("How to use this Book (MM)")
    aflat, mflat = re.sub(r"\s+", " ", aw), re.sub(r"\s+", " ", mw)
    t31, t32 = table31(xw), table32(xw)
    need(aflat, r"Find the Hit Dice of the creature on the table\. Add the additional Hit Dice for special powers from .{0,40}Table 32.{0,40} and "
                r"find the adjusted Hit Dice\. Add this number to the current Hit Dice value, so that a 1 \+ 1 Hit Die creature with \+2 Hit Dice "
                r"of special abilities becomes a 3 \+ 1 Hit Dice creature", "XP procedure")
    need(aflat, r"Each orc is worth 15 XP, since they are one Hit Die each and have no special abilities\. The rust monster is worth 420 XP\. "
                r"It has five Hit Dice but gains a bonus of \+2 for a special magical attack form", "worked example")
    need(aflat, r"The green slime is worth 175 XP, since its base two Hit Dice are increased by 3", "worked example (slime)")
    assert xp_for(1, t31) == 15 and xp_for(5 + 2, t31) == 420 and xp_for(2 + 3, t31) == 175, "Table 31 lookup"
    assert xp_for(1.5 + 2, t31) == 120 and xp_for(14, t31) == 4000 and xp_for(0.25, t31) == 7, "Table 31 bounds"
    spells = [r["key"] for r in t32 if "spells" in r["key"]]
    assert len(spells) == 2 and "not cumulative" in t32[[r["key"] for r in t32].index(spells[1])]["label"], spells
    assert len(t32) == 29, len(t32)
    sizes = [{"key": k, "label": re.search(rf":{k} = ([^:]+?)(?=;|\.| :)", mflat).group(1).strip()} for k in "TSMLHG"]
    intelligence = bands(mw, "INTELLIGENCE")
    morale = bands(mw, "MORALE")
    assert [b["label"] for b in morale][-1] == "Fearless" and len(morale) == 8, morale
    assert intelligence[0]["label"].startswith("Nonintelligent") and intelligence[-1]["max"] is None and len(intelligence) == 11, intelligence
    _mspec = importlib.util.spec_from_file_location("magicdata", "tools/build-magic-item-data.py")
    magicdata = importlib.util.module_from_spec(_mspec)
    _mspec.loader.exec_module(magicdata)
    charges, crev = {}, {}
    for cat, (formula, most, page, pattern) in magicdata.CHARGES.items():
        w, crev[page], _ = classdata.page(page)
        need(re.sub(r"\s+", " ", w), pattern, f"{page} charges")
        charges[cat] = {"formula": formula, "max": most}
    tw, trev, _ = classdata.page("DMG Table 70")
    traits = []
    for row in classdata.table_rows(tw, "Table 70"):
        if len(row) != 4:
            continue
        roll, general, pct, specific = row
        if roll.strip():
            traits.append({"roll": int(roll), "trait": general.strip(), "specific": []})
        traits[-1]["specific"].append({"roll": 100 if pct.strip() == "00" else int(pct), "trait": specific.strip()})
    assert [t["roll"] for t in traits] == list(range(1, 21)), [t["roll"] for t in traits]
    assert all(len(t["specific"]) == 5 for t in traits)
    assert [s["roll"] for t in traits for s in t["specific"]] == list(range(1, 101))
    pw, prev_, _ = classdata.page("Personality (DMG)")
    pflat = re.sub(r"\s+", " ", pw)
    need(pflat, r"he can randomly determine everything \(1d20 for a major trait, percentile dice for characteristics\)", "Table 70 use")
    looks = {}
    for key, label in (("age", "Age"), ("height", "Height"), ("weight", "Weight"), ("hair", "Hair"), ("speech", "Manner of speech"),
                       ("face", "Facial characteristics")):
        m = re.search("'''" + re.escape(label) + r":''' (.+?)(?:\.(?= )|(?= '''))", pflat)
        assert m, label
        looks[key] = [w.strip().rstrip(".") for w in m.group(1).split(",") if w.strip() and "(any)" not in w]
        assert len(looks[key]) >= 9, (label, looks[key])
    # Spell creator: the PHB schools and spheres, and the DMG's spell research guidelines.
    sw, srev, _ = classdata.page("The Schools of Magic (PHB)")
    m = re.search(r"The nine schools of magic are (.+?)\. ", re.sub(r"\s+", " ", sw))
    assert m, "schools"
    schools = [s.strip() for s in re.sub(r"'''|\band\b", "", m.group(1)).split(",") if s.strip()]
    assert len(schools) == 9 and "Lesser Divination" in schools, schools
    qw, qrev, _ = classdata.page("Priest (PHB)")
    m = re.search(r"The 16 spheres of influence are as follows: (.+?)\. ", re.sub(r"\s+", " ", qw))
    assert m, "spheres"
    spheres = [s.strip() for s in re.sub(r"\band\b", "", m.group(1)).split(",") if s.strip()]
    assert len(spheres) == 16 and spheres[0] == "All", spheres
    rw, rrev, _ = classdata.page("Spell Research (DMG)")
    rflat = re.sub(r"\s+", " ", rw)
    need(rflat, r"a spell which inflicts 5d6 points of damage should be about 3rd to 5th level", "damage dice and level")
    need(rflat, r"If the spell is an improvement of an existing spell, it should be at least two levels greater than that spell", "improvement")
    need(rflat, r"The minimum amount of time needed to research a spell is two weeks per spell level", "research time")
    need(rflat, r"For wizards, this is the same as their chance to learn a spell \(be sure to account for any specialization\)\. For priests a Wisdom check is made",
         "research check")
    need(rflat, r"If the check fails, the character must spend another week in study before making another check", "retry")
    need(rflat, r"the cost of research is 100-1,000 gp per spell level", "research cost")
    need(rflat, r"perhaps 1,000 to 10,000 gp", "laboratory cost")
    spell = {"schools": schools, "spheres": spheres,
             "research": {"weeksPerLevel": 2, "retryWeeks": 1, "costPerLevel": [100, 1000], "laboratory": [1000, 10000],
                          "damageLevelsBelowDice": 2, "improvementLevels": 2}}
    # Trap creator: the Complete Thief's Handbook difficulty modifier and silent attempts; the PHB's 96-100 springs the trap.
    cw, crev2, _ = classdata.page("Advanced Locks and Traps (CTH)")
    cflat = re.sub(r"\s+", " ", cw)
    need(cflat, r"A device can be listed with a modifier of \+ or - up to 30%, reflecting the ease or difficulty with which a thief might "
                r"pick the lock or find and remove a trap", "trap modifier")
    need(cflat, r"The many varieties of traps are too great to list, but the same principle of modification applies", "trap modifier applies")
    need(cflat, r"He suffers a -10% chance to his ability rating, but will perform the task quietly on any roll except 01-10%", "silent")
    tw2, trev2, _ = classdata.page("Thief Skill Explanations (PHB)")
    need(re.sub(r"\s+", " ", tw2), r"If the dice roll is 96-100, the thief accidentally triggers the trap", "96-100 springs")
    trap = {"modifierMax": 30, "silent": -10, "silentNoise": 10, "springOn": 96}
    # Automatic encounter XP: DMG Table 34 individual class awards per Hit Die of creatures defeated (warriors, bards).
    t34 = {re.sub(r"\s+", " ", r[0]).strip(): r[1].strip() for r in classdata.table_rows(xw, "Table 34") if len(r) == 2}
    assert t34.get("Per Hit Die of creature defeated") == "10 XP/level", t34
    assert t34.get("Per Hit Die of creatures defeated (bard only)") == "5 XP", t34
    need(aflat, r"Individual awards are optional", "individual awards optional")
    class_awards = {"warrior": 10, "bard": 5}
    data = {"classAwards": class_awards, "trap": trap, "spell": spell, "patron": {"traits": traits, "looks": looks}, "magic": {"charges": charges}, "monster": {"xp": t31, "hdModifiers": t32, "exclusive": [spells], "sizes": sizes, "intelligence": intelligence, "morale": morale}}
    lines = ["/**",
             " * GENERATED by tools/build-creator-tables.py - do not edit by hand.",
             f" *   DMG Tables 31/32: {classdata.url('Experience Tables (DMG)')} (revision {xrev});",
             f" *   procedure: {classdata.url('Experience Point Awards (DMG)')} (revision {arev});",
             f" *   size, intelligence and morale bands: {classdata.url('How to use this Book (MM)')} (revision {mrev}).",
             *[f" *   charges: {classdata.url(p)} (revision {r})" for p, r in crev.items()],
             f" *   Table 70: {classdata.url('DMG Table 70')} (revision {trev}); appearance: {classdata.url('Personality (DMG)')} (revision {prev_}).",
             f" *   Schools: {classdata.url('The Schools of Magic (PHB)')} (revision {srev}); spheres: {classdata.url('Priest (PHB)')} (revision {qrev});",
             f" *   research: {classdata.url('Spell Research (DMG)')} (revision {rrev}).",
             f" *   Traps: {classdata.url('Advanced Locks and Traps (CTH)')} (revision {crev2}); {classdata.url('Thief Skill Explanations (PHB)')} (revision {trev2}).",
             " */",
             "export const CREATOR_TABLES = " + json.dumps(data, ensure_ascii=False) + ";", ""]
    open("module/rules/creator-tables.mjs", "w").write("\n".join(lines))
    print(f"wrote module/rules/creator-tables.mjs: {len(t31)} XP rows, {len(t32)} Hit Dice modifiers, "
          f"{len(intelligence)} intelligence and {len(morale)} morale bands")
