#!/usr/bin/env python3
"""Generate the "Traits & Disadvantages (POSP)" compendium (packs/_source/traits): Player's Option: Skills & Powers
Table 46 (traits, cost in character points) and Table 47 (disadvantages, moderate / severe points).

Sources (AD&D 2e fandom wiki, MediaWiki API): "Traits & Disadvantages (POSP)" (Tables 46, 47) and "Traits &
Disadvantages Descriptions (POSP)" (effects; descriptions are not copied, each item links to its section).
Owner's ruling: there are no character points; a character may take traits whose total cost is at most the points of
the disadvantages it takes (shown on the character sheet).
Racial adjustments ("Elves can purchase this trait for 1 less character point", "Dwarves receive 1 extra character
point when they choose this disadvantage") are read from each description. Effects the system can apply are curated
in `EFFECTS` (kit-modifier format: tick boxes in roll dialogs when conditional), each with the text it must match;
Ambidexterity and Fast Healer are applied by code (module/data/character.mjs, module/combat-options.mjs).
Run from the repo root:  python3 tools/build-trait-data.py
"""
import glob
import importlib.util
import json
import os
import re

_spec = importlib.util.spec_from_file_location("classdata", "tools/build-class-data.py")
classdata = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(classdata)

TABLES = "Traits & Disadvantages (POSP)"
DESCRIPTIONS = "Traits & Disadvantages Descriptions (POSP)"
SOURCE = "Player's Option: Skills & Powers"
# Table names that differ from the description headings.
HEADING = {"Doublejointed": "Double-jointed", "Keen Smell": "Keen Olfactory Sense", "Keen Taste": "Keen Taste Sense",
           "Keen Touch": "Keen Touch Sense", "Tonguetied": "Tongue-Tied", "Phobia: Monster (specific)": "Phobia: Monster"}
RACES = {"Elves": "elf", "Halflings": "halfling", "Dwarves": "dwarf", "Gnomes": "gnome"}
# The descriptions page repeats Greed and Phobia: Snakes in place of these two (wiki revision checked): they link to
# the tables page instead. Any other missing description fails the build.
NO_DESCRIPTION = {"Irritating Personality", "Phobia: Spiders"}


def mod(target, value, key="", condition=""):
    return {"target": target, "key": key, "value": value, "every": 0, "step": 0, "from": 1, "condition": condition,
            "armor": "", "max": None}


# identifier -> (modifiers, [patterns that must occur in the item's description section]). Paraphrased conditions.
EFFECTS = {
    "alertness": ([mod("surprise", 1)],
                  [r"Such characters receive a \+1 bonus when the DM determines if the alert characters and their party must roll for surprise"]),
    "ambidexterity": ([], [r"suffering no penalty for the first hand, and only a –2 penalty for off-hand use"]),
    "fast-healer": ([], [r"the character naturally heals at a rate of 2 hit points, not 1, per day"]),
    "allure": ([mod("reaction", 3, condition="romantic attention (up to +3, the DM's call)")], [r"perhaps by as much as \+3"]),
    "impersonation": ([mod("proficiency", 2, "disguise")], [r"gains a \+2 bonus to all rolls made using the disguise proficiency"]),
    "inherent-immunity-poison": ([mod("save", 1, condition="against poison or any toxin")],
                                 [r"receives a \+1 bonus to all saving throws versus any kind of toxin"]),
    "inherent-immunity-disease": ([mod("save", 3, condition="against an infection")],
                                  [r"When a saving throw is allowed against a possible infection, the character gains a \+3 bonus"]),
    "inherent-immunity-cold": ([mod("save", 2, condition="against physical cold (not a wight's chill)")],
                               [r"the character gains a \+2 bonus to saving throws against cold attacks"]),
    "inherent-immunity-heat": ([mod("save", 1, condition="against fire, lava or red dragon breath")],
                               [r"The saving throw bonus is a \+1, and applies to saving throws against such magical infernos as red dragon breath "
                                r"and against the effects of lava or normal fire"]),
    "internal-compass": ([mod("proficiency", 1, "navigation")],
                         [r"When using the navigation proficiency, characters with this trait receive a \+1 bonus to their proficiency score"]),
    "keen-eyesight": ([mod("attack", 1, condition="missile attack at long range")],
                      [r"receives a \+1 bonus on all rolls to hit with a missile weapon at long range"]),
    "keen-hearing": ([mod("surprise", 1, condition="hearing can help avoid surprise"), mod("skill", 10, "dn", condition="a thief")],
                     [r"In cases where hearing can be a factor in avoiding surprise, this character receives a \+1 bonus",
                      r"If the character is a thief, this trait adds \+10% to every attempt to ''detect noise''"]),
    "keen-smell": ([mod("surprise", 1, condition="smelling the other party"), mod("proficiency", 2, "hunting")],
                   [r"this character gets a \+1 bonus on chances of being surprised",
                    r"this trait gives the character a \+2 bonus when using the hunting proficiency"]),
    "keen-taste": ([mod("ability", 3, "wis", condition="tasting (Wisdom check)")], [r"Characters can make Wisdom/Intuition checks with a \+3 modifier"]),
    "keen-touch": ([mod("skill", 5, "pp,ol", condition="a thief")],
                   [r"If the character with this trait is a thief, this inherent advantage gives a \+5% bonus to pick pockets and open locks attempts"]),
    "music-singing": ([mod("proficiency", 2, "singing")], [r"adds \+2 bonus to the character's singing proficiency score"]),
    "tonguetied": ([mod("reaction", -2)], [r"the DM should modify NPC reaction rolls, typically by –2"]),
}


def slug(s):
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")


def table_rows(wiki, caption):
    t = wiki[wiki.index(caption):]
    t = t[t.index("{|"):t.index("|}")]
    out = []
    for chunk in re.split(r"\n\|-", t)[1:]:
        cells = [c[1:].strip() for c in chunk.strip().split("\n") if c.startswith("|") and not c.startswith(("|+", "|}"))]
        if cells:
            out.append(cells)
    return out


def name_of(cell):
    m = re.search(r"\[\[[^\]|]*\|([^\]]*)\]\]", cell)
    return (m.group(1) + cell[m.end():]).strip() if m else cell.strip()


def sections(wiki):
    """Description heading -> section text."""
    out = {}
    for m in re.finditer(r"^===\s*([^=\n]+?)\s*===\s*$", wiki, re.M):
        end = wiki.find("\n==", m.end())
        out.setdefault(m.group(1), wiki[m.end():end if end >= 0 else len(wiki)])
    return out


def points(cell):
    return int(cell) if re.fullmatch(r"\d+", cell.strip()) else None


if __name__ == "__main__":
    tw, trev, _ = classdata.page(TABLES)
    dw, drev, _ = classdata.page(DESCRIPTIONS)
    desc = sections(re.sub(r"\[\[(?:[^|\]]*\|)?([^\]]*)\]\]", r"\1", dw))
    traits = [(name_of(r[0]), points(r[1])) for r in table_rows(tw, "Table 46: Traits")]
    disadvantages = [(name_of(r[0]), points(r[1]), points(r[2])) for r in table_rows(tw, "Table 47: Disadvantages")]
    assert len(traits) >= 25 and all(c for _, c in traits), traits
    assert len(disadvantages) >= 25 and all(m for _, m, _ in disadvantages), disadvantages
    folder_t = classdata.folder_doc("traits.traits", "Traits (Table 46)", sort=0)
    folder_d = classdata.folder_doc("traits.disadvantages", "Disadvantages (Table 47)", sort=1000)
    docs, seen = [], set()
    for kind, rows, folder in (("trait", [(n, c, None) for n, c in traits], folder_t), ("disadvantage", disadvantages, folder_d)):
        for k, (name, moderate, severe) in enumerate(rows):
            ident = slug(name.replace(" (specific)", ""))
            heading = HEADING.get(name, name)
            text = desc.get(heading)
            if name in NO_DESCRIPTION:
                assert text is None, f"{name}: the description now exists; remove it from NO_DESCRIPTION"
                text = ""
            assert text is not None, f"{name}: no description section {heading!r}"
            flat = re.sub(r"\s+", " ", text)
            race = []
            for m in re.finditer(r"(\w+) can purchase this trait for 1 less character point", flat):
                race.append({"race": RACES[m.group(1)], "delta": -1})
            for m in re.finditer(r"(\w+) receive 1 extra character point when they choose this disadvantage", flat):
                race.append({"race": RACES[m.group(1)], "delta": 1})
            modifiers, patterns = EFFECTS.get(ident, ([], []))
            for p in patterns:
                assert re.search(p, flat), f"{name}: effect text changed ({p})"
            system = {"identifier": ident, "kind": kind, "cost": moderate if kind == "trait" else None,
                      "points": {"moderate": moderate if kind == "disadvantage" else None, "severe": severe},
                      "severity": "moderate", "race": race, "modifiers": modifiers, "source": SOURCE,
                      "url": (classdata.url(TABLES) if name in NO_DESCRIPTION else classdata.url(DESCRIPTIONS) + "#" + heading.replace(" ", "_")),
                      "notes": ""}
            doc = classdata.item_doc("trait", f"trait.{ident}", name, "icons/svg/aura.svg" if kind == "trait" else "icons/svg/hazard.svg",
                                     system, k * 100)
            doc["folder"] = folder["_id"]
            assert ident not in seen, ident
            seen.add(ident)
            docs.append(doc)
    assert set(EFFECTS) <= seen, set(EFFECTS) - seen
    os.makedirs("packs/_source/traits", exist_ok=True)
    for f in glob.glob("packs/_source/traits/*.json"):
        os.remove(f)
    for d in [folder_t, folder_d] + docs:
        name = f"_folder-{d['_id']}" if d.get("type") == "Item" and "system" not in d else d["system"]["identifier"]
        with open(f"packs/_source/traits/{name}.json", "w") as f:
            json.dump(d, f, indent=2, ensure_ascii=False)
            f.write("\n")
    print(f"wrote {len(traits)} traits and {len(disadvantages)} disadvantages ({TABLES} rev {trev}, {DESCRIPTIONS} rev {drev}); "
          f"racial adjustments: {sum(bool(d['system']['race']) for d in docs)}, with effects: {len(EFFECTS)}")
