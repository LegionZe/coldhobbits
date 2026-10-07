#!/usr/bin/env python3
"""Generate module/rules/follower-tables.mjs: name-level followers (PHB).

Sources (AD&D 2e fandom wiki, MediaWiki API), each rule regex-checked:
  - "Fighter (PHB)": at 9th level, with "a castle or stronghold", men-at-arms from Table 16 ("Warrior Tables (PHB)": three
    subtables, leader, troops and elite unit, rolled once each).
  - "Ranger (PHB)": "At 10th level, a ranger attracts 2d6 followers" from Table 19 ("*": roll again for a second one).
  - "Cleric (PHB)": at 8th level with "a place of worship of significant size", "20 to 200" 0-level soldiers ("The DM
    decides the exact number and types"; rolled 2d10 x 10: owner's ruling).
  - "Thief (PHB)": at 10th level "The thief attracts 4d6 of these fellows" from Table 31 ("Rogue Tables (PHB)").
  - "Bard (PHB)": at 9th level, with a stronghold, "10d6 0th-level soldiers".
  - "Paladin (PHB)": "does not attract a body of followers" (none).
  - "Followers (PHB)": "Followers appear only once." (each class is rolled once).
Table 16 units are parsed into count, level, kind and equipment; equipment names map to compendium identifiers
(`ITEMS`, asserted to exist), anything else (magical items named, mounts, choices) goes to the unit's notes. 0-level
soldiers use the Mercenary stat block of packs/_source/monsters (Human (MM)). Table 19 creatures map to Hirelings & Mounts
actors where one exists (`CREATURE_ACTORS`, asserted), else a blank actor with the wiki link.
Run from the repo root after build-monster-data.py and build-hireling-data.py:  python3 tools/build-follower-tables.py
"""
import importlib.util
import json
import os
import re

_spec = importlib.util.spec_from_file_location("classdata", "tools/build-class-data.py")
classdata = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(classdata)

# Equipment name (as in Table 16) -> (pack folder, identifier, quantity).
ITEMS = {"plate mail": ("armor", "plate-mail"), "shield": ("armor", "medium-shield"), "battle axe": ("weapons", "battle-axe"),
         "spear": ("weapons", "spear"), "dagger": ("weapons", "dagger-or-dirk"), "splint mail": ("armor", "splint-mail"),
         "broad sword": ("weapons", "broad-sword"), "ring mail": ("armor", "ring-mail"), "javelins": ("weapons", "javelin"),
         "long sword": ("weapons", "long-sword"), "hand axe": ("weapons", "hand-or-throwing-axe"), "scale mail": ("armor", "scale-mail"),
         "club": ("weapons", "club"), "morning star": ("weapons", "morning-star"), "leather armor": ("armor", "leather"),
         "pike": ("weapons", "awl-pike"), "short sword": ("weapons", "short-sword"), "chain mail": ("armor", "chain-mail"),
         "heavy crossbow": ("weapons", "heavy-crossbow"), "light crossbow": ("weapons", "light-crossbow"),
         "military fork": ("weapons", "military-fork"), "banded mail": ("armor", "banded-mail"), "bastard sword": ("weapons", "bastard-sword"),
         "mace": ("weapons", "footman-s-mace"), "studded leather armor": ("armor", "studded-leather"), "field plate": ("armor", "field-plate"),
         "long bow": ("weapons", "long-bow"), "body shield": ("armor", "body-shield")}
# Kept as notes: "shield +1" etc. become the item with a bonus; these stay text.
NOTES_ONLY = {"polearm*", "lance", "large shield", "crossbow of distance", "heavy war horse with full barding",
              "heavy war horse with horseshoes of speed", "long bows or crossbows"}
CREATURE_ACTORS = {"Falcon": "companion-falcon", "Raven": "companion-raven", "Dog/wolf": "companion-wolf"}
NPC = re.compile(r"^(Cleric|Druid|Fighter|Fighter/mage|Ranger|Thief) \((\w[\w-]*)\)$")
GROUP = {"Cleric": "priest", "Druid": "priest", "Fighter": "warrior", "Fighter/mage": "warrior", "Ranger": "warrior", "Thief": "rogue"}


def need(text, pattern, what):
    assert re.search(pattern, text), f"rule changed: {what}"


def strip_links(s):
    return re.sub(r"\[\[([^\]|]+\|)?([^\]]+)\]\]", r"\2", s).strip()


def ordinal(n):
    return int(re.match(r"(\d+)", n).group(1))


def gear(text):
    """Comma list -> ([{pack, identifier, qty, bonus}], [notes])."""
    items, notes = [], []
    for raw in re.split(r",\s*(?:and\s+)?|\s+and\s+(?=[a-z])", text.strip().rstrip(".")):
        name = raw.strip()
        if not name:
            continue
        qty = 1
        m = re.match(r"(\d+) (.*)", name)
        if m:
            qty, name = int(m.group(1)), m.group(2)
        bonus = 0
        b = re.match(r"(.*) \+(\d)$", name)
        if b:
            name, bonus = b.group(1), int(b.group(2))
        if name in ITEMS:
            pack, ident = ITEMS[name]
            assert os.path.exists(f"packs/_source/{pack}/{ident}.json"), ident
            items.append({"pack": pack, "identifier": ident, "qty": qty, "bonus": bonus})
        else:
            assert raw.strip() in NOTES_ONLY or name in NOTES_ONLY, f"unmapped equipment: {raw!r}"
            notes.append(raw.strip())
    return items, notes


def subtable(wiki, caption):
    t = wiki[wiki.index(f"|+ {caption}"):]
    t = t[:t.index("\n|}")]
    rows = []
    for chunk in re.split(r"\n\|-", t)[1:]:
        cells = [c.lstrip("|").strip() for c in chunk.strip().split("\n") if c.startswith("|")]
        if len(cells) == 1 and "||" in cells[0]:
            cells = [c.strip() for c in cells[0].split("||")]
        if len(cells) >= 2:
            rows.append(cells)
    return rows


def rng(s):
    m = re.fullmatch(r"(\d+)(?:-(\d+))?", s.strip().replace("–", "-"))
    lo, hi = int(m.group(1)), int(m.group(2) or m.group(1))
    return (100 if lo == 0 else lo), (100 if hi == 0 else hi)


def build():
    wt, wrev, _ = classdata.page("Warrior Tables (PHB)")
    need(wt, r"once for the leader of the troops, once for troops, and once for a bodyguard", "three rolls")
    leader, troops, elite = [], [], []
    for r, text in subtable(wt, "Leader"):
        lo, hi = rng(r)
        if text.startswith("DM's Option"):
            leader.append({"min": lo, "max": hi, "dm": True, "text": text}); continue
        units = []
        for part in text.split(", plus "):
            m = re.match(r"(\d+(?:st|nd|rd|th))-level fighter, (.*)", part)
            assert m, part
            items, notes = gear(m.group(2))
            units.append({"count": 1, "level": ordinal(m.group(1)), "group": "warrior", "name": f"{m.group(1)}-level fighter", "items": items, "notes": notes})
        leader.append({"min": lo, "max": hi, "text": text, "units": units})
    for r, text in subtable(wt, "Troops/Followers"):
        lo, hi = rng(r)
        if text.startswith("DM's Option"):
            troops.append({"min": lo, "max": hi, "dm": True, "text": text}); continue
        units = []
        for part in text.rstrip(".").split("; "):
            m = re.match(r"(\d+) (cavalry|infantry) with (.*)", part)
            assert m, part
            items, notes = gear(m.group(3))
            units.append({"count": int(m.group(1)), "level": 0, "group": "warrior", "name": m.group(2), "items": items, "notes": notes})
        troops.append({"min": lo, "max": hi, "text": text, "units": units})
    for r, text in subtable(wt, "Elite Units"):
        lo, hi = rng(r)
        if text.startswith("DM's Option"):
            elite.append({"min": lo, "max": hi, "dm": True, "text": text}); continue
        note = re.findall(r"\(([^)]*)\)", text)
        body = re.sub(r"\s*\([^)]*\)", "", text)
        m = re.match(r"(\d+) (?:([^:;]+?)[:;] )?(\d+(?:st|nd|rd|th))-level ([\w/ ]+?) with (.*)", body)
        assert m, text
        items, notes = gear(m.group(5))
        kind = m.group(4)
        group = "warrior" if re.search(r"fighter|ranger", kind) else "warrior"
        elite.append({"min": lo, "max": hi, "text": text, "units": [{"count": int(m.group(1)), "level": ordinal(m.group(3)), "group": group,
            "name": (m.group(2) or kind).strip(), "items": items, "notes": notes + note}]})
    for t in (leader, troops, elite):
        assert t[0]["min"] == 1 and t[-1]["max"] == 100, t
    rng19 = []
    t19 = wt[wt.index("Table 19: Ranger's Followers"):]
    need(t19, r"If the ranger already has a follower of this type, ignore this result and roll again", "reroll")
    for r, label in subtable(t19, "Table 19: Ranger's Followers"):
        lo, hi = rng(r)
        name = strip_links(label)
        reroll = name.endswith("*")
        name = name.rstrip("*").strip()
        entry = {"min": lo, "max": hi, "label": name, "reroll": reroll}
        npc = NPC.match(name)
        if npc:
            entry.update({"kind": "npc", "group": GROUP[npc.group(1)], "race": npc.group(2), "className": npc.group(1)})
        elif name.startswith("Other"):
            entry["dm"] = True
        else:
            entry["kind"] = "creature"
            if name in CREATURE_ACTORS:
                assert os.path.exists(f"packs/_source/hirelings/{CREATURE_ACTORS[name]}.json"), name
                entry["actor"] = CREATURE_ACTORS[name]
            m = re.search(r"\[\[([^\]|]+)", label)
            if m:
                entry["url"] = classdata.url(m.group(1))
        rng19.append(entry)
    assert rng19[0]["min"] == 1 and rng19[-1]["max"] == 100
    rt, rrev, _ = classdata.page("Rogue Tables (PHB)")
    t31 = []
    for cells in subtable(rt[rt.index("Table 31: Thief's Followers"):], "Table 31: Thief's Followers"):
        lo, hi = rng(cells[0])
        label = cells[1]
        if label.startswith("Other"):
            t31.append({"min": lo, "max": hi, "label": label, "dm": True}); continue
        lv = re.match(r"(\d+)-(\d+)", cells[2])
        race = label.split(" ")[0].lower()
        t31.append({"min": lo, "max": hi, "label": label, "race": race, "levels": f"1d{int(lv.group(2))}" if lv.group(1) == "1" else cells[2],
                    "group": "rogue"})
    assert t31[0]["min"] == 1 and t31[-1]["max"] == 100
    pages = {k: re.sub(r"\s+", " ", classdata.page(f"{k} (PHB)")[0]) for k in ("Fighter", "Ranger", "Cleric", "Thief", "Bard", "Paladin")}
    need(pages["Fighter"], r"When a fighter attains 9th level .{0,40}he can automatically attract men-at-arms", "fighter level")
    need(pages["Fighter"], r"the fighter must have a castle or stronghold", "fighter stronghold")
    need(pages["Ranger"], r"At 10th level, a ranger attracts 2d6 followers", "ranger")
    need(pages["Cleric"], r"Upon reaching 8th level, the cleric automatically attracts .{0,80}provided the character has established a place of worship", "cleric")
    need(pages["Cleric"], r"The cleric attracts 20 to 200 of these followers", "cleric number")
    need(pages["Thief"], r"Once a thief reaches 10th level", "thief level")
    need(pages["Thief"], r"The thief attracts 4d6 of these fellows", "thief number")
    need(pages["Bard"], r"a bard can build a stronghold and attract followers upon reaching 9th level\. The bard attracts 10d6 0th-level soldiers", "bard")
    need(pages["Paladin"], r"A paladin does not attract a body of followers", "paladin")
    need(re.sub(r"\s+", " ", classdata.page("Followers (PHB)")[0]), r"Followers appear only once\.", "followers once")
    merc = json.load(open("packs/_source/monsters/mercenary.json"))["system"]
    classes = {
        "fighter": {"level": 9, "stronghold": "castle", "table": "table16"},
        "ranger": {"level": 10, "stronghold": "", "table": "table19", "number": "2d6"},
        "cleric": {"level": 8, "stronghold": "worship", "number": "2d10*10", "min": 20, "max": 200},
        "thief": {"level": 10, "stronghold": "", "table": "table31", "number": "4d6"},
        "bard": {"level": 9, "stronghold": "castle", "number": "10d6"}}
    return {"classes": classes, "table16": {"leader": leader, "troops": troops, "elite": elite}, "table19": rng19, "table31": t31,
            "soldier": {"hitDice": merc["hitDice"], "morale": merc["morale"]["value"], "url": merc["url"]},
            "urls": {k: classdata.url(f"{k} (PHB)") for k in ("Fighter", "Ranger", "Cleric", "Thief", "Bard", "Followers")}}, (wrev, rrev)


if __name__ == "__main__":
    data, revs = build()
    with open("module/rules/follower-tables.mjs", "w") as f:
        f.write("// GENERATED by tools/build-follower-tables.py from the AD&D 2e fandom wiki (MediaWiki API): do not edit.\n")
        f.write(f"// Sources: Warrior Tables (PHB) rev {revs[0]} (Tables 16, 19), Rogue Tables (PHB) rev {revs[1]} (Table 31), class pages.\n")
        f.write(f"export const FOLLOWERS = {json.dumps(data, ensure_ascii=False)};\n")
    for k in ("leader", "troops", "elite"):
        for r in data["table16"][k]:
            print(k, r["min"], [(u["count"], u["name"], u["level"], [i["identifier"] for i in u["items"]], u["notes"]) for u in r.get("units", [])])
