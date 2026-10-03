#!/usr/bin/env python3
"""Generate module/rules/monster-tables.mjs (creature THAC0) and the prototype monster Actors (packs/_source/monsters).

Sources (AD&D 2e fandom wiki, MediaWiki API):
  * Table 39: Creature THAC0 ("Calculating THAC0 (DMG)"): "When a creature has three or more points added to its
    Hit Dice, count another die when consulting the table."
  * Prototype stat blocks (Monstrous Manual): "Horse" (Riding column) as a mount, "Orc (Creature)" (Orc) as a monster,
    "Human (MM)" (Mercenary column) as a hireling (movement from PHB Table 64, which the MM page does not list). Their equipment is copied from the generated weapon, armour and
    equipment sources (run after build-proficiency-data.py, build-armor-data.py and build-equipment-data.py).
Run from the repo root:  python3 tools/build-monster-data.py
"""
import copy
import importlib.util
import json
import re

_spec = importlib.util.spec_from_file_location("classdata", "tools/build-class-data.py")
classdata = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(classdata)
_mspec = importlib.util.spec_from_file_location("movement", "tools/build-movement-tables.py")
movement = importlib.util.module_from_spec(_mspec)
_mspec.loader.exec_module(movement)

# Stat block row labels (Monstrous Manual) -> keys.
LABELS = {"climate/terrain": "climate", "frequency": "frequency", "organization": "organization",
          "activity cycle": "activity", "diet": "diet", "intelligence": "intelligence", "treasure": "treasure",
          "alignment": "alignment", "no. appearing": "numberAppearing", "armor class": "ac", "movement": "movement",
          "hit dice": "hitDice", "thac0": "thac0", "no. of attacks": "attacks", "damage/attack": "damage",
          "special attacks": "specialAttacks", "special defenses": "specialDefenses",
          "magic resistance": "magicResistance", "size": "size", "morale": "morale", "xp value": "xp"}
# {{Creature}} infobox keys -> keys.
INFOBOX = {"terrain": "climate", "frequency": "frequency", "organization": "organization", "activitycycle": "activity",
           "diet": "diet", "intelligence": "intelligence", "treasure": "treasure", "alignment": "alignment",
           "numberappearing": "numberAppearing", "armorclass": "ac", "movement": "movement", "hitdice": "hitDice",
           "thac0": "thac0", "noofattacks": "attacks", "damageattack": "damage", "specialattack": "specialAttacks",
           "specialdefenses": "specialDefenses", "magicalresistance": "magicResistance", "size": "size",
           "moral": "morale", "xp": "xp"}


def clean(v):
    v = re.sub(r"\{\{br\}\}", "; ", v)
    v = re.sub(r"\{\{frac\|(\d+)\|(\d+)\}\}", r"\1/\2", v)
    return re.sub(r"\s+", " ", v.replace("&nbsp;", " ")).strip()


def creature_thac0():
    wiki, rev, _ = classdata.page("Calculating THAC0 (DMG)")
    t = wiki[wiki.index("<h4>Table 39: Creature THAC0"):]  # the table caption, not the link in the text
    t = t[:t.index("|}")]
    rows = [[clean(l.lstrip("|!")) for l in chunk.strip().split("\n") if l.startswith(("|", "!")) and not l.startswith(("|+", "|}"))]
            for chunk in re.split(r"\n\|-", t)[1:]]
    header, values = [r for r in rows if r and r[0].startswith("1/2")][0], [r for r in rows if r and r[0].isdigit()][0]
    assert len(header) == len(values) == 18, (header, values)
    assert header[:3] == ["1/2 or less", "1-1", "1+"] and header[-1] == "16+", header
    # index 0 = less than one Hit Die ("1/2 or less", "1-1"); index n = n Hit Dice ("n+"), 16 and more = last.
    table = [int(values[0])] + [int(v) for v in values[2:]]
    return table, rev


def column_block(title, column):
    """Stat block from a page with column tables (Horse, Human (MM))."""
    wiki, rev, _ = classdata.page(title)
    for t in re.findall(r"\{\|.*?\n\|\}", wiki, re.S):
        chunks = re.split(r"\n\|-", t)
        head = [clean(c) for c in re.split(r"\n!", chunks[0])[1:]]
        if column not in head:
            continue
        idx = head.index(column)
        block = {}
        for chunk in chunks[1:]:
            lines = [l.strip() for l in chunk.strip().split("\n") if l.strip()]
            label = clean(lines[0].lstrip("!")).rstrip(":").lower()
            cells = [clean(l.lstrip("|")) for l in lines[1:]]
            if label in LABELS:
                block[LABELS[label]] = cells[idx - 1]
        return block, rev
    raise AssertionError(f"{title}: no column {column}")


def infobox_block(title, name):
    wiki, rev, _ = classdata.page(title)
    box = dict(re.findall(r"\|\s*(\w+?)\s*=\s*([^\n]*)", wiki[:wiki.index("}}\n'''")]))
    n = [k[4:] for k, v in box.items() if re.fullmatch(r"name\d+", k) and clean(v) == name][0]
    return {key: clean(box.get(f"{src}{n}", "")) for src, key in INFOBOX.items()}, rev


def damage_formula(text):
    """'1-8' -> '1d8', '2-8' -> '2d4', '1-2' -> '1d2'."""
    lo, hi = (int(x) for x in re.match(r"(\d+)-(\d+)", text).groups())
    if lo == 1:
        return f"1d{hi}"
    if hi % lo == 0:
        return f"{lo}d{hi // lo}"
    return f"1d{hi - lo + 1}+{lo - 1}"


def first_int(text):
    return int(re.search(r"-?\d+", text).group())


def morale_value(text):
    """'Steady (11-12)' -> 12 (top of the range; the DM picks within it)."""
    return int(re.findall(r"\d+", text)[-1])


def load_source(pack, name):
    for path in sorted(__import__("glob").glob(f"packs/_source/{pack}/[!_]*.json")):
        d = json.load(open(path))
        if d["name"] == name:
            return d
    raise AssertionError(f"{pack}: no {name}")


def embed(actor_id, pack, name, **system):
    d = copy.deepcopy(load_source(pack, name))
    d["_id"] = classdata.doc_id("embedded", f"{actor_id}.{name}")
    d["_key"] = f"!actors.items!{actor_id}.{d['_id']}"
    d["folder"] = None
    d["system"].update(system)
    return d


def actor(key, name, role, block, source_title, img, attacks, items=(), load=None):
    actor_id = classdata.doc_id("actor", key)
    mv = block["movement"]
    system = {
        "identifier": key, "role": role,
        "climate": block.get("climate", ""), "frequency": block.get("frequency", ""),
        "organization": block.get("organization", ""), "activity": block.get("activity", ""),
        "diet": block.get("diet", ""), "intelligence": block.get("intelligence", ""), "treasure": block.get("treasure", ""),
        "alignment": block.get("alignment", ""), "numberAppearing": block.get("numberAppearing", ""),
        "ac": {"base": first_int(block["ac"]), "text": block["ac"]},
        "movement": {"base": first_int(mv), "text": mv},
        "hitDice": block["hitDice"],
        "thac0": {"override": None},
        "attacks": attacks,
        "attacksText": block.get("attacks", ""), "damageText": block.get("damage", ""),
        "specialAttacks": block.get("specialAttacks", ""), "specialDefenses": block.get("specialDefenses", ""),
        "magicResistance": block.get("magicResistance", ""), "size": block.get("size", ""),
        "morale": {"value": morale_value(block["morale"]), "text": block["morale"]},
        "xp": first_int(block["xp"]),
        "load": load or {"full": None, "half": None, "quarter": None},
        "url": classdata.url(source_title), "notes": ""}
    return {"_id": actor_id, "_key": f"!actors!{actor_id}", "name": name, "type": "monster", "img": img,
            "system": system, "items": [embed(actor_id, *i[:2], **(i[2] if len(i) > 2 else {})) for i in items],
            "effects": [], "folder": None, "sort": 0, "ownership": {"default": 0}, "flags": {}}


if __name__ == "__main__":
    table, rev39 = creature_thac0()
    horse, rev_h = column_block("Horse", "Riding")
    orc, rev_o = infobox_block("Orc (Creature)", "Orc")
    merc, rev_m = column_block("Human (MM)", "Mercenary")
    assert (horse["hitDice"], horse["thac0"], horse["damage"]) == ("3", "17", "1-2/1-2"), horse
    assert (orc["hitDice"], orc["thac0"], orc["damage"]) == ("1", "19", "1-8 (weapon)"), orc
    assert (merc["hitDice"], merc["thac0"]) == ("2-8 hp", "20"), merc
    # Human (MM) gives no movement or size for its human types: human base movement from PHB Table 64.
    merc.setdefault("movement", str(movement.build_base_move()[0]["human"]))
    merc.setdefault("size", "M")
    horse_load = load_source("equipment", "Horse, riding")["system"]["load"]
    hoof = {"name": "Hoof", "damage": damage_formula("1-2"), "bonus": 0}
    docs = [
        actor("orc", "Orc (prototype monster)", "monster", orc, "Orc (Creature)", "icons/svg/mystery-man.svg",
              [{"name": "Weapon", "damage": damage_formula(orc["damage"]), "bonus": 0}]),
        actor("horse-riding", "Riding horse (prototype mount)", "mount", horse, "Horse", "icons/svg/pawprint.svg",
              [hoof, dict(hoof)],
              items=[("equipment", "Saddle, riding", {"carried": True}), ("equipment", "Bit and bridle", {"carried": True}),
                     ("equipment", "Saddle bags, large", {"carried": True})],
              load=horse_load),
        actor("mercenary", "Mercenary (prototype hireling)", "hireling", merc, "Human (MM)", "icons/svg/mystery-man.svg", [],
              items=[("weapons", "Spear"), ("weapons", "Short sword"), ("armor", "Studded leather", {"equipped": True}),
                     ("equipment", "Backpack")])]
    for i, d in enumerate(docs):
        d["sort"] = i * 100
    classdata.write_docs("packs/_source/monsters", docs)
    lines = ["/**",
             " * GENERATED by tools/build-monster-data.py - do not edit by hand.",
             f" * DMG Table 39 (Creature THAC0): {classdata.url('Calculating THAC0 (DMG)')} (revision {rev39}).",
             " * Index 0 = less than one Hit Die; index n = n Hit Dice (\"n+\"); the last entry covers 16 and more.",
             " */",
             "export const CREATURE_THAC0 = " + json.dumps(table) + ";", ""]
    open("module/rules/monster-tables.mjs", "w").write("\n".join(lines))
    print("wrote module/rules/monster-tables.mjs", table, "and packs/_source/monsters:",
          [(d["name"], d["system"]["hitDice"], len(d["items"])) for d in docs], {"horse": rev_h, "orc": rev_o, "human": rev_m})
