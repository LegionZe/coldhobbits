#!/usr/bin/env python3
"""Generate module/rules/poison-tables.mjs and the "Poisons (DMG)" compendium (packs/_source/poisons).

Source (AD&D 2e fandom wiki, MediaWiki API): "Poison (DMG)", Table 51: Poison Strength (class, method, onset, strength).
Each rule the module uses is regex-checked in the page text:
  - strength "failed/saved": "The number before the slash lists the hit points of damage suffered if the saving throw is
    failed. The number after the slash lists the damage taken (if any) if the saving throw is successful"; "death": "all
    hit points are immediately lost";
  - method: contact poisons have full effect by any route; "Injected and ingested have no effect on contact"; injected or
    ingested poisons given the other way have half effect: "the save damage being applied if the saving throw is failed
    and no damage occurring if the saving throw is successful";
  - onset "Immediate": "felt at the instant the poison is applied";
  - paralytic: "unable to move for 2d6 hours"; debilitating: "1d3 days", "All of the character's ability scores are
    reduced by half", "one-half his normal movement rate", "cannot heal by normal or magical means".
Ranges are read as dice (implementation choice): "2-12" = 2d6, "10-30" = 10d3, "2-5" = 1d4+1 (the lower bound divides
the upper: that many dice, else one die plus a constant).
Compendium: one equipment Item (category "poison") per class, one dose each; no cost (Table 51 lists none).
Run from the repo root:  python3 tools/build-poison-data.py
"""
import importlib.util
import json
import re

_spec = importlib.util.spec_from_file_location("classdata", "tools/build-class-data.py")
classdata = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(classdata)

PAGE = "Poison (DMG)"
UNITS = {"minute": 60, "hour": 3600, "day": 86400}


def need(text, pattern, what):
    assert re.search(pattern, text), f"rule changed: {what}"


def dice(lo, hi):
    """'2', '12' -> '2d6'; '2', '5' -> '1d4+1'; '1', '2' -> '1d2'; equal bounds -> the number."""
    lo, hi = int(lo), int(hi)
    assert 0 < lo <= hi, (lo, hi)
    if lo == hi:
        return str(lo)
    if hi % lo == 0:
        return f"{lo}d{hi // lo}"
    return f"1d{hi - lo + 1}+{lo - 1}"


def onset(text):
    t = text.replace("–", "-").strip()
    if t.lower() == "immediate":
        return {"text": text, "formula": "0", "unit": 0}
    m = re.fullmatch(r"(\d+)(?:-(\d+))? (minute|hour|day)s?", t)
    assert m, text
    return {"text": text, "formula": dice(m.group(1), m.group(2) or m.group(1)), "unit": UNITS[m.group(3)]}


def amount(text):
    t = text.replace("–", "-").strip()
    if t.lower() == "death":
        return "death"
    m = re.fullmatch(r"(\d+)(?:-(\d+))?", t)
    assert m, text
    return dice(m.group(1), m.group(2)) if m.group(2) else m.group(1)


def strength(text):
    if text == "Paralytic":
        return {"kind": "paralytic", "failed": "", "saved": "0"}
    if text == "Debilitative":
        return {"kind": "debilitating", "failed": "", "saved": "0"}
    failed, saved = text.split("/")
    return {"kind": "damage", "failed": amount(failed), "saved": amount(saved)}


def build():
    wiki, revid, title = classdata.page(PAGE)
    flat = re.sub(r"\s+", " ", wiki)
    need(flat, r"number before the slash lists the hit points of damage suffered if the saving throw is failed", "failed")
    need(flat, r"number after the slash lists the damage taken \(if any\) if the saving throw is successful", "saved")
    need(flat, r"Where \"death\" is listed, all hit points are immediately lost", "death")
    need(flat, r"Injected and ingested have no effect on contact", "contact route")
    need(flat, r"Contact poisons have full effect even if swallowed or injected", "contact poisons")
    need(flat, r"half their normal effect if administered in the opposite manner, resulting in the save damage being "
               r"applied if the saving throw is failed and no damage occurring if the saving throw is successful", "half")
    need(flat, r"effect of immediate poisons is felt at the instant the poison is applied", "immediate")
    par = re.search(r"Paralytic poisons leave the character unable to move for (\d+)d(\d+) hours", flat)
    deb = re.search(r"Debilitating poisons weaken the character for (\d+)d(\d+) days", flat)
    assert par and deb, "paralytic / debilitating durations"
    need(flat, r"All of the character's ability scores are reduced by half", "debilitating: abilities")
    need(flat, r"moves at one-half his normal movement rate", "debilitating: movement")
    need(flat, r"cannot heal by normal or magical means until the poison is neutralized", "debilitating: healing")
    rows = classdata.table_rows(wiki, "Table 51")
    classes = {}
    for row in rows:
        assert len(row) == 4, row
        cls, method, on, st = row
        assert re.fullmatch(r"[A-P]", cls) and method in ("Injected", "Ingested", "Contact"), row
        classes[cls] = {"method": method.lower(), "onset": onset(on), **strength(st)}
    assert list(classes) == [chr(c) for c in range(ord("A"), ord("P") + 1)], list(classes)
    # Worked spot checks against the table as printed.
    assert classes["B"]["saved"] == "1d3" and classes["C"]["saved"] == "2d4" and classes["D"]["saved"] == "2d6"
    assert classes["E"]["failed"] == "death" and classes["E"]["saved"] == "20" and classes["N"]["onset"]["unit"] == 60
    assert classes["A"]["onset"]["formula"] == "10d3" and classes["C"]["onset"]["formula"] == "1d4+1"
    assert classes["O"]["kind"] == "paralytic" and classes["P"]["kind"] == "debilitating"
    rules = {"paralysis": {"formula": f"{par.group(1)}d{par.group(2)}", "unit": UNITS["hour"]},
             "debilitation": {"formula": f"{deb.group(1)}d{deb.group(2)}", "unit": UNITS["day"]}}
    return classes, rules, revid


def write_tables(classes, rules, revid):
    data = {"classes": classes, **rules, "url": classdata.url(PAGE)}
    with open("module/rules/poison-tables.mjs", "w") as f:
        f.write("// GENERATED by tools/build-poison-data.py from the AD&D 2e fandom wiki (MediaWiki API): do not edit.\n")
        f.write(f"// Source: {PAGE} (revision {revid}), Table 51: Poison Strength. Ranges read as dice (2-12 = 2d6).\n")
        f.write(f"export const POISON_TABLES = {json.dumps(data, ensure_ascii=False)};\n")


def write_items(classes):
    docs = []
    for i, (cls, c) in enumerate(classes.items()):
        key = f"poison-class-{cls.lower()}"
        system = {"identifier": key, "category": "poison", "cost": "", "weight": None, "quantity": 1, "carried": True,
                  "container": "", "capacity": {"weight": None, "volume": ""},
                  "load": {"full": None, "half": None, "quarter": None},
                  "poison": {"class": cls},
                  "source": "Dungeon Master Guide, Table 51", "url": classdata.url(PAGE), "notes": ""}
        docs.append(classdata.item_doc("equipment", "poison." + key, f"Poison, Class {cls} ({c['method']})",
                                       "icons/svg/item-bag.svg", system, i * 10))
    classdata.write_docs("packs/_source/poisons", docs)


if __name__ == "__main__":
    classes, rules, revid = build()
    write_tables(classes, rules, revid)
    write_items(classes)
    print(f"{len(classes)} poison classes")
