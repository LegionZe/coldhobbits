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
    data = {"magic": {"charges": charges}, "monster": {"xp": t31, "hdModifiers": t32, "exclusive": [spells], "sizes": sizes, "intelligence": intelligence, "morale": morale}}
    lines = ["/**",
             " * GENERATED by tools/build-creator-tables.py - do not edit by hand.",
             f" *   DMG Tables 31/32: {classdata.url('Experience Tables (DMG)')} (revision {xrev});",
             f" *   procedure: {classdata.url('Experience Point Awards (DMG)')} (revision {arev});",
             f" *   size, intelligence and morale bands: {classdata.url('How to use this Book (MM)')} (revision {mrev}).",
             *[f" *   charges: {classdata.url(p)} (revision {r})" for p, r in crev.items()],
             " */",
             "export const CREATOR_TABLES = " + json.dumps(data, ensure_ascii=False) + ";", ""]
    open("module/rules/creator-tables.mjs", "w").write("\n".join(lines))
    print(f"wrote module/rules/creator-tables.mjs: {len(t31)} XP rows, {len(t32)} Hit Dice modifiers, "
          f"{len(intelligence)} intelligence and {len(morale)} morale bands")
