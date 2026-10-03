#!/usr/bin/env python3
"""Generate module/rules/level-tables.mjs: saving throws, hit dice and XP by class group/level.

Sources (AD&D 2e fandom wiki, MediaWiki API):
  * Table 60: Character Saving Throws (The Saving Throw (PHB)).
  * Tables 14/20/23/25: Warrior/Wizard/Priest/Rogue Experience Levels (XP per class, Hit Dice).
Run from the repo root:  python3 tools/build-level-tables.py
"""
import json, re, urllib.parse, urllib.request

API = "https://adnd2e.fandom.com/api.php"
WIKI = "https://adnd2e.fandom.com/wiki/"
UA = {"User-Agent": "coldhobbits-ad2e-table-builder"}
SAVES = ["par", "rsw", "pet", "br", "sp"]
GROUP_NAMES = {"Priests": "priest", "Rogues": "rogue", "Warriors": "warrior", "Wizards": "wizard"}
SPECIALISTS = ["abjurer", "conjurer", "diviner", "enchanter", "illusionist", "invoker", "necromancer", "transmuter"]
# XP column header -> class identifiers (class items use these identifiers).
XP_COLUMNS = {"Fighter": ["fighter"], "Paladin/Ranger": ["paladin", "ranger"],
              "Mage/Specialist": ["mage"] + SPECIALISTS, "Cleric": ["cleric"], "Druid": ["druid"],
              "XP needed": ["thief", "bard"]}
XP_TABLES = {"warrior": ("Warrior Tables (PHB)", "Table 14: Warrior Experience Levels"),
             "wizard": ("Wizard Tables (PHB)", "Table 20: Wizard Experience Levels"),
             "priest": ("Priest Tables (PHB)", "Table 23: Priest Experience Levels"),
             "rogue": ("Rogue Tables (PHB)", "Table 25: Rogue Experience Levels")}


def page(title):
    q = urllib.parse.urlencode({"action": "parse", "page": title, "prop": "wikitext|revid", "format": "json"})
    with urllib.request.urlopen(urllib.request.Request(f"{API}?{q}", headers=UA)) as r:
        p = json.load(r)["parse"]
    return p["wikitext"]["*"], p["revid"]


def table(wiki, caption):
    """Header row + data rows of the article-table whose caption contains `caption`."""
    start = re.search(r"\|\+\s*" + re.escape(caption), wiki).start()  # the table caption, not a heading
    t = wiki[wiki.rindex("{|", 0, start):wiki.index("|}", start)]
    header, rows = [], []
    for chunk in re.split(r"\n\|-", t):
        cells, is_header = [], False
        for line in chunk.split("\n"):
            line = line.strip()
            if line.startswith("!"):
                is_header = True
                cells += [c.strip() for c in re.split(r"!!|\|\|", line[1:])]
            elif line.startswith("|") and not line.startswith(("|+", "|}", "{|")):
                cells += [c.strip() for c in line[1:].split("||")]
        clean = [re.sub(r"\{\{br\}\}", " ", re.sub(r"'''|<[^>]+>", "", c)).strip() for c in cells]
        if is_header:
            header.append(clean)
        elif clean:
            rows.append(clean)
    return header, rows


def level_range(s):
    s = s.strip()
    if s.endswith("+"):
        return int(s[:-1]), 99
    a, _, b = s.partition("-")
    return int(a), int(b or a)


def build_saves():
    wiki, rev = page("The Saving Throw (PHB)")
    t = wiki[wiki.index("Table 60: Character Saving Throws"):]
    t = t[:t.index("|}")]
    saves, group = {}, None
    for line in t.split("\n"):
        m = re.search(r"'''(Priests|Rogues|Warriors|Wizards)'''", line)
        if m:
            group = GROUP_NAMES[m.group(1)]
            saves[group] = []
        elif group and line.strip().startswith("|") and "||" in line:
            cells = [c.strip() for c in line.strip()[1:].split("||")]
            lo, hi = level_range(cells[0])
            saves[group].append({"min": lo, "max": hi, **{k: int(v) for k, v in zip(SAVES, cells[1:6])}})
    return saves, {"page": WIKI + "The_Saving_Throw_(PHB)", "revid": rev}


def build_levels():
    hit_dice, xp, sources = {}, {}, {}
    for group, (title, caption) in XP_TABLES.items():
        wiki, rev = page(title)
        sources[group] = {"page": WIKI + urllib.parse.quote(title.replace(" ", "_"), safe="()"), "revid": rev}
        header, rows = table(wiki, caption)
        cols = header[-1]
        die = int(re.search(r"\(d(\d+)\)", cols[-1]).group(1))
        levels = []
        for r in rows:
            m = re.match(r"(\d+)(?:\+(\d+))?", r[-1])
            levels.append({"level": int(r[0]), "dice": int(m.group(1)), "bonus": int(m.group(2) or 0)})
        hit_dice[group] = {"die": die, "levels": levels}
        for i, col in enumerate(cols[1:-1], start=1):
            for cls in XP_COLUMNS[re.sub(r"\s*/\s*", "/", col)]:
                # digits only: Table 23 marks druid level 17 "500,000*" (footnote: hierophant druids)
                xp[cls] = [int(re.sub(r"\D", "", r[i])) for r in rows]
    return hit_dice, xp, sources


def build_thac0():
    """Table 53: Calculated THAC0s (page "Calculating THAC0 (PHB)"), levels 1-20 per group."""
    wiki, rev = page("Calculating THAC0 (PHB)")
    t = wiki[wiki.index("Table 53"):]
    t = t[:t.index("|}")]
    out = {}
    for name, row in re.findall(r"\|\s*(Priest|Rogue|Warrior|Wizard)\s*\|\|([^\n]+)", t):
        out[name.lower()] = [int(c) for c in row.split("||")]
        assert len(out[name.lower()]) == 20, name
    # The progression in module/config.mjs (used past level 20) must reproduce Table 53.
    prog = {"warrior": (1, 1), "priest": (3, 2), "rogue": (2, 1), "wizard": (3, 1)}
    for g, (div, step) in prog.items():
        assert out[g] == [20 - ((l - 1) // div) * step for l in range(1, 21)], f"THAC0 progression mismatch: {g}"
    return out, {"page": WIKI + "Calculating_THAC0_(PHB)", "revid": rev}


if __name__ == "__main__":
    thac0, thac0_src = build_thac0()
    saves, save_src = build_saves()
    hit_dice, xp, lvl_src = build_levels()
    for g in GROUP_NAMES.values():
        covered = {n for r in saves[g] for n in range(r["min"], min(r["max"], 30) + 1)}
        assert set(range(1, 31)) <= covered, f"saves for {g} do not cover levels 1-30"
        assert [l["level"] for l in hit_dice[g]["levels"]] == list(range(1, 21)), f"hit dice for {g} not 1-20"
    lines = ["/**",
             " * GENERATED by tools/build-level-tables.py - do not edit by hand.",
             " * Saving throws (PHB Table 60), hit dice and XP (PHB Tables 14, 20, 23, 25) from the",
             " * AD&D 2e fandom wiki. Verify against an owned Player's Handbook.",
             f" *   Table 60: {save_src['page']} (revision {save_src['revid']})"]
    lines += [f" *   {g}: {s['page']} (revision {s['revid']})" for g, s in lvl_src.items()]
    lines += [" */",
              "export const SAVE_TABLE = " + json.dumps(saves, indent=2) + ";", "",
              f"/** PHB Table 53 (Calculated THAC0s), levels 1-20 per group: {thac0_src['page']} (revision {thac0_src['revid']}). */",
              "export const THAC0_TABLE = " + json.dumps(thac0) + ";", "",
              "/** Per group: hit die size and, per level, number of dice and fixed bonus HP. */",
              "export const HIT_DICE = " + json.dumps(hit_dice, indent=2) + ";", "",
              "/** Per class identifier: total XP needed for levels 1..20 (index 0 = level 1). */",
              "export const XP_TABLE = " + json.dumps(xp) + ";", ""]
    open("module/rules/level-tables.mjs", "w").write("\n".join(lines))
    print("wrote module/rules/level-tables.mjs:", {g: len(v) for g, v in saves.items()}, sorted(xp))
