#!/usr/bin/env python3
"""Skills & Powers nonweapon proficiency ratings (world setting "spProficiencies", module/sp-proficiencies.mjs).

Sources (AD&D 2e fandom wiki, MediaWiki API):
  * "POSP Table 44" (Table 44: Ability Modifiers to Proficiency Scores).
  * "Nonweapon Proficiency Groups (POSP)" (Table 45: initial rating and relevant abilities per group list).
  * "Improving Proficiencies (POSP)" (unmodified ratings cannot be raised above 16; a 20 always fails).
  * "Using Proficiencies in Play (POSP)" (with two listed abilities the player chooses which one modifies the rating).
Writes module/rules/sp-proficiency-tables.mjs and sets `system.sp` { ability, rating, cost } of the Table 45
proficiencies in packs/_source/proficiencies (the first listing; ratings that differ between group lists are kept per
group in `byGroup`). Character points are not used (owner's ruling): `cost` is informational only. Subabilities are
not used either (owner's ruling): "Wisdom/Intuition" counts as Wisdom.
Run from the repo root after build-proficiency-data.py:  python3 tools/build-sp-proficiency-data.py
"""
import glob
import importlib.util
import json
import re
import urllib.parse

_spec = importlib.util.spec_from_file_location("classdata", "tools/build-class-data.py")
classdata = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(classdata)

GROUPS = {"GENERAL": "general", "PRIEST": "priest", "ROGUE": "rogue", "WIZARD": "wizard", "WARRIOR": "warrior"}
ABILITIES = {"Strength": "str", "Dexterity": "dex", "Constitution": "con", "Intelligence": "int", "Wisdom": "wis",
             "Charisma": "cha"}


def rows(table):
    out = []
    for chunk in re.split(r"\n\s*\|-", table)[1:]:
        cells = [c.strip()[1:].strip() for c in chunk.strip().split("\n") if c.strip().startswith("|") and not c.strip().startswith(("|}", "|+"))]
        if cells:
            out.append(cells)
    return out


def table44():
    wiki, rev, _ = classdata.page("POSP Table 44")
    t = wiki[wiki.index("{|", wiki.index("==Table 44")):]
    t = t[:t.index("|}")]
    mods = {}
    for score, mod in rows(t):
        value = int(mod.replace("–", "-").replace("+", "").strip())
        m = re.fullmatch(r"(\d+)(?:–(\d+)|(\+))?", score.strip())
        assert m, score
        lo = int(m.group(1))
        hi = int(m.group(2)) if m.group(2) else lo
        for s in range(lo, hi + 1):
            mods[s] = value
        if m.group(3):
            assert lo == 18, score  # "18+": every higher score too
    assert sorted(mods) == list(range(3, 19)), sorted(mods)
    assert mods[3] == -5 and mods[8] == 0 and mods[13] == 0 and mods[14] == 1 and mods[18] == 5, mods
    return mods, rev


def table45():
    wiki, rev, _ = classdata.page("Nonweapon Proficiency Groups (POSP)")
    out = {}  # wiki title -> [(group, cost, rating, ability text)]
    for m in re.finditer(r"===\s*([A-Z]+)\s*===\s*\n(\{\|.*?\n\s*\|\})", wiki, re.S):
        group = GROUPS[m.group(1)]
        for cells in rows(m.group(2)):
            name, cost, rating, ability = cells[:4]
            title = re.match(r"\[\[([^\]|]+)", name).group(1).strip()
            cost = int(re.fullmatch(r"(\d+) CP", cost).group(1))
            # "NA/6" (blind-fighting): no rating (the PHB proficiency has no check either).
            rating = None if rating.startswith("NA") else int(rating)
            ability = re.sub(r"\s*\{\{br\}\}\s*", " ", ability)
            ability = re.sub(r"\s*/\s*", "/", ability)
            out.setdefault(title, []).append((group, cost, rating, ability))
    assert set(g for v in out.values() for g, *_ in v) == set(GROUPS.values())
    assert re.search(r"<nowiki>\*</nowiki>Cost in character points", wiki), "Table 45 footnote changed"
    return out, rev


def keys(ability):
    found = [ABILITIES[w] for w in re.findall(r"(Strength|Dexterity|Constitution|Intelligence|Wisdom|Charisma)/", ability)]
    assert found and len(found) == len(re.findall(r"/", ability)), ability
    return found


if __name__ == "__main__":
    mods, rev44 = table44()
    t45, rev45 = table45()
    improve, rev_imp, _ = classdata.page("Improving Proficiencies (POSP)")
    flat = re.sub(r"\s+", " ", improve)
    m = re.search(r"Characters cannot improve their unmodified ratings in nonweapon proficiencies above (\d+)", flat)
    assert m, "Improving Proficiencies (POSP): maximum rating text changed"
    max_rating = int(m.group(1))
    assert re.search(r"a roll of 20 on a proficiency check is always a failure", flat), "automatic failure text changed"
    play, rev_play, _ = classdata.page("Using Proficiencies in Play (POSP)")
    assert re.search(r"In cases where two abilities are listed, the player can choose which ability modifies the proficiency", play), \
        "Using Proficiencies in Play (POSP): ability choice text changed"

    files = {}
    for f in glob.glob("packs/_source/proficiencies/*.json"):
        d = json.load(open(f))
        if d.get("type") == "proficiency" and d["system"].get("kind") == "nonweapon":
            title = urllib.parse.unquote(d["system"]["url"].split("/wiki/", 1)[1]).replace("_", " ")
            files[title] = (f, d)
    by_group, abilities, updated = {}, {}, 0
    for title, listings in sorted(t45.items()):
        assert title in files, f"Table 45 proficiency {title!r} has no item in packs/_source/proficiencies"
        f, d = files[title]
        ident = d["system"]["identifier"]
        group, cost, rating, ability = listings[0]
        assert all(keys(a) == keys(ability) for _, _, _, a in listings), (title, listings)
        if len({r for _, _, r, _ in listings}) > 1:
            by_group[ident] = {g: r for g, _, r, _ in listings}
        abilities[ident] = keys(ability)
        sp = {"ability": ability, "rating": rating, "cost": cost}
        if d["system"].get("sp") != sp:
            d["system"]["sp"] = sp
            with open(f, "w") as out:
                json.dump(d, out, indent=2, ensure_ascii=False)
                out.write("\n")
            updated += 1
    data = {"abilityModifier": {str(k): v for k, v in sorted(mods.items())}, "maxRating": max_rating, "byGroup": by_group,
            "abilities": abilities}
    with open("module/rules/sp-proficiency-tables.mjs", "w") as out:
        out.write("// GENERATED by tools/build-sp-proficiency-data.py - do not edit by hand.\n")
        out.write(f"// Player's Option: Skills & Powers: POSP Table 44 (rev {rev44}), Table 45 (Nonweapon Proficiency Groups (POSP) "
                  f"rev {rev45}), Improving Proficiencies (POSP) rev {rev_imp}, Using Proficiencies in Play (POSP) rev {rev_play}.\n")
        out.write("// abilityModifier: Table 44 by score (18 = 18 or more); maxRating: highest unmodified rating;\n")
        out.write("// abilities: relevant ability keys per proficiency identifier (subabilities -> abilities, owner's ruling);\n")
        out.write("// byGroup: proficiencies whose initial rating differs between the Table 45 group lists.\n")
        out.write("export const SP_PROFICIENCY = " + json.dumps(data, separators=(", ", ": ")) + ";\n")
    print(f"wrote module/rules/sp-proficiency-tables.mjs: {len(abilities)} Table 45 proficiencies ({len(by_group)} with "
          f"per-group ratings), max rating {max_rating}; updated {updated} proficiency items")
