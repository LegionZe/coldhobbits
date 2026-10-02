#!/usr/bin/env python3
"""Generate module/rules/class-data.mjs: PHB classes and Complete Handbook kits.

Sources (AD&D 2e fandom wiki, via the MediaWiki API; the HTML pages return a JS challenge):
  * PHB Table 13 (Class Ability Minimums) and Table 22 (Wizard Specialist Requirements).
  * PHB class pages for prime requisites and alignment rules (curated below, with the
    sentence each value comes from).
  * Kit lists from the wiki categories of the Complete Handbooks (CFH, CPaH, CRH, CWH,
    CPrH, CTH, CBH). Kit ability minimums are curated below from each kit page, because
    the pages phrase requirements too inconsistently to parse safely.

Only mechanical facts are emitted (names, minimums, flags, links); no rulebook prose.
Run from the repo root:  python3 tools/build-class-data.py
"""
import json, re, urllib.parse, urllib.request

API = "https://adnd2e.fandom.com/api.php"
WIKI = "https://adnd2e.fandom.com/wiki/"
UA = {"User-Agent": "coldhobbits-ad2e-table-builder"}
ABIL = {"Str": "str", "Dex": "dex", "Con": "con", "Int": "int", "Wis": "wis", "Cha": "cha"}


def api(**params):
    params["format"] = "json"
    req = urllib.request.Request(API + "?" + urllib.parse.urlencode(params), headers=UA)
    with urllib.request.urlopen(req) as r:
        return json.load(r)


def page(title):
    p = api(action="parse", page=title, prop="wikitext|revid", redirects=1)["parse"]
    return p["wikitext"]["*"], p["revid"], p["title"]


def url(title):
    return WIKI + urllib.parse.quote(title.replace(" ", "_"), safe="()/'")


def table_rows(wiki, caption):
    t = re.search(r"\{\|[^\n]*\n\|\+[^\n]*" + re.escape(caption) + r".*?\n\|\}", wiki, flags=re.S).group(0)
    rows = []
    for chunk in re.split(r"\n\|-", t)[1:]:
        cells = []
        for line in chunk.split("\n"):
            if line.startswith("|") and not line.startswith(("|}", "|+")):
                cells += [c.strip() for c in line[1:].split("||")]
        if cells:
            rows.append(cells)
    return rows


def link_text(c):
    m = re.search(r"\[\[(?:[^\]|]*\|)?([^\]]*)\]\]", c)
    return (m.group(1) if m else c).replace("*", "").strip()


# --- Classes ---------------------------------------------------------------------------
# prime requisites / alignment: curated from the PHB class pages (sentence quoted per class).
ALL = ["lg", "ng", "cg", "ln", "n", "cn", "le", "ne", "ce"]
CLASS_FACTS = {
    # "A fighter who has a Strength score (his prime requisite) of 16 or more..." / "Fighters can have any alignment"
    "Fighter": {"key": "fighter", "group": "warrior", "page": "Fighter (PHB)", "prime": ["str"], "alignments": ALL},
    # "Strength and Charisma are the prime requisites of the paladin." / "A paladin must be lawful good"
    "Paladin": {"key": "paladin", "group": "warrior", "page": "Paladin (PHB)", "prime": ["str", "cha"], "alignments": ["lg"]},
    # "The prime requisites of the ranger are Strength, Dexterity, and Wisdom." / "must always retain his good alignment"
    "Ranger": {"key": "ranger", "group": "warrior", "page": "Ranger (PHB)", "prime": ["str", "dex", "wis"], "alignments": ["lg", "ng", "cg"]},
    # "A mage who has an Intelligence score of 16 or higher gains a 10% bonus" (no alignment limit stated)
    "Mage": {"key": "mage", "group": "wizard", "page": "Mage (PHB)", "prime": ["int"], "alignments": ALL},
    # "Clerics ... can have any alignment acceptable to their order." Prime requisite Wisdom (Table 13 minimum;
    # not stated as a sentence on the wiki page - verify against the PHB).
    "Cleric": {"key": "cleric", "group": "priest", "page": "Cleric (PHB)", "prime": ["wis"], "alignments": ALL},
    # "Wisdom ... 12 and a Charisma score of 15 ... Both of these abilities are prime requisites." / "must be neutral"
    "Druid": {"key": "druid", "group": "priest", "page": "Druid (PHB)", "prime": ["wis", "cha"], "alignments": ["n"]},
    # "The thief's prime requisite is Dexterity" / "any alignment except lawful good"
    "Thief": {"key": "thief", "group": "rogue", "page": "Thief (PHB)", "prime": ["dex"], "alignments": [a for a in ALL if a != "lg"]},
    # "The prime requisites are Dexterity and Charisma." / "must always be partially neutral"
    "Bard": {"key": "bard", "group": "rogue", "page": "Bard (PHB)", "prime": ["dex", "cha"], "alignments": ["ng", "ln", "n", "cn", "ne"]},
}
# Specialist Wizard (PHB): "Prime Requisite: Intelligence", "Alignment Allowed: Any"; Table 22 gives the rest.
RACES = {"H": "human", "E": "elf", "½E": "half-elf", "1/2E": "half-elf", "G": "gnome"}


def build_classes():
    wiki, rev13, title13 = page("PHB Table 13")
    classes, sources = {}, {"table13": {"page": url(title13), "revid": rev13}}
    for r in table_rows(wiki, "Table 13: Class Ability Minimums"):
        name = link_text(r[0])
        if name not in CLASS_FACTS:
            continue  # "Specialist" row ("Var") is expanded from Table 22 below
        f = CLASS_FACTS[name]
        mins = {k: int(v) for k, v in zip(["str", "dex", "con", "int", "wis", "cha"], r[1:7]) if v.strip().isdigit()}
        classes[f["key"]] = {"name": name, "group": f["group"], "min": mins, "prime": f["prime"],
                             "alignments": f["alignments"], "url": url(f["page"])}

    wiki22, rev22, _ = page("Specialist Wizard (PHB)")
    sources["table22"] = {"page": url("Specialist Wizard (PHB)"), "revid": rev22}
    mage_int = classes["mage"]["min"]["int"]
    for r in table_rows(wiki22, "Table 22: Wizard Specialist Requirements"):
        cells = [re.sub(r"\[\[(?:[^\]|]*\|)?([^\]]*)\]\]", r"\1", c) for c in r[:5]]
        name, school, races, ability, opposition = [re.sub(r"\{\{frac\|1\|2\}\}\s*", "½", c).strip() for c in cells]
        val, abil = ability.split()
        races = [RACES.get(x.strip(), x.strip()) for x in races.split(",")]
        classes[name.lower()] = {"name": name, "group": "wizard", "min": {"int": mage_int, ABIL[abil]: int(val)},
                                 "prime": ["int"], "alignments": ALL, "school": school,
                                 "opposition": opposition, "races": races, "url": url("Specialist Wizard (PHB)")}
    return classes, sources


# --- Kits ------------------------------------------------------------------------------
KIT_SOURCES = {  # category -> (book, classes the kits apply to)
    "Character Kit CFH": ("Complete Fighter's Handbook", ["fighter"]),
    "Character Kit CPaH": ("Complete Paladin's Handbook", ["paladin"]),
    "Character Kit CRH": ("Complete Ranger's Handbook", ["ranger"]),
    "Character Kit CWH": ("Complete Wizard's Handbook", ["mage", "abjurer", "conjurer", "diviner", "enchanter",
                                                          "illusionist", "invoker", "necromancer", "transmuter"]),
    "Character Kit CPrH": ("Complete Priest's Handbook", ["cleric", "druid"]),
    "Character Kit CTH": ("Complete Thief's Handbook", ["thief"]),
    "The_Complete_Bard's_Handbook": ("Complete Bard's Handbook", ["bard"]),
}
# Ability minimums per kit page (overrides the class minimum for that ability; 0 removes it).
# "other": the kit page states race/alignment/other restrictions - shown as a flag + link.
KIT_REQ = {
    "Amazon - Fighter (Character Kit)": {},
    "Barbarian - Fighter (Character Kit)": {"min": {"str": 15}},
    "Beast-Rider (Character Kit)": {"min": {"cha": 13}},
    "Berserker (Character Kit)": {"min": {"str": 15}},
    "Cavalier - Fighter (Character Kit)": {"min": {"str": 15, "dex": 15, "con": 15, "int": 10, "wis": 10}, "other": True},
    "Gladiator - Fighter (Character Kit)": {},
    "Myrmidon (Character Kit)": {"min": {"str": 12, "con": 12}},
    "Noble Warrior (Character Kit)": {"min": {"str": 13, "con": 13}},
    "Peasant Hero - Fighter (Character Kit)": {},
    "Pirate/Outlaw (Character Kit)": {},
    "Samurai - Fighter (Character Kit)": {"min": {"str": 13, "wis": 13, "con": 13, "int": 14}},
    "Savage - Fighter (Character Kit)": {"min": {"str": 11, "con": 15}},
    "Swashbuckler - Fighter (Character Kit)": {"min": {"int": 13, "dex": 13}},
    "Wilderness Warrior (Character Kit)": {"min": {"con": 13}},
    "Chevalier (Character Kit)": {"other": True},
    "Divinate (Character Kit)": {"other": True},
    "Envoy (Character Kit)": {"min": {"int": 12}},
    "Equerry (Character Kit)": {"min": {"wis": 14}},
    "Errant (Character Kit)": {},
    "Expatriate (Character Kit)": {},
    "Ghosthunter (Character Kit)": {},
    "Inquisitor (Character Kit)": {"min": {"int": 11}},
    "Medician (Character Kit)": {"min": {"int": 10}},
    "Militarist (Character Kit)": {"min": {"dex": 12, "con": 12}},
    "Skyrider (Character Kit)": {},
    "Squire - Paladin (Character Kit)": {},
    "True Paladin (Character Kit)": {},
    "Votary (Character Kit)": {},
    "Wyrmslayer (Character Kit)": {"min": {"str": 14, "dex": 10, "con": 10}},
    "Beastmaster - Ranger (Character Kit)": {},
    "Explorer - Ranger (Character Kit)": {"min": {"int": 12}},
    "Falconer (Character Kit)": {},
    "Feralan (Character Kit)": {"min": {"con": 15, "str": 14}, "other": True},
    "Forest Runner (Character Kit)": {"min": {"cha": 12}},
    "Giant Killer (Character Kit)": {"min": {"str": 15, "dex": 15}},
    "Greenwood Ranger (Character Kit)": {"other": True},
    "Guardian - Ranger (Character Kit)": {},
    "Justifier (Character Kit)": {"min": {"str": 14, "dex": 14}, "other": True},
    "Mountain Man (Character Kit)": {"min": {"str": 14, "con": 15}, "other": True},
    "Pathfinder - Ranger (Character Kit)": {},
    "Sea Ranger (Character Kit)": {"min": {"int": 12}},
    "Seeker (Character Kit)": {"min": {"wis": 15}, "other": True},
    "Stalker - Ranger (Character Kit)": {"min": {"int": 14}, "other": True},
    "Warden (Character Kit)": {"min": {"cha": 12}, "other": True},
    "Academician (Character Kit)": {"min": {"int": 13, "wis": 11}},
    "Amazon Sorceress (Character Kit)": {},
    "Anagakok (Character Kit)": {"min": {"con": 13}},
    "Militant Wizard (Character Kit)": {"min": {"str": 13}},
    "Mystic - Wizard (Character Kit)": {"min": {"wis": 13}},
    "Patrician - Wizard (Character Kit)": {},
    "Peasant Wizard (Character Kit)": {},
    "Savage Wizard (Character Kit)": {"min": {"str": 11, "con": 13}},
    "Witch (Character Kit)": {"min": {"int": 13, "wis": 13, "con": 13}},
    "Wu Jen (Character Kit)": {"min": {"int": 13}},
    "Amazon Priestess (Character Kit)": {},
    "Barbarian/Berserker Priest (Character Kit)": {},
    "Fighting-Monk (Character Kit)": {"min": {"dex": 12}},
    "Nobleman Priest (Character Kit)": {},
    "Outlaw Priest (Character Kit)": {},
    "Pacifist Priest (Character Kit)": {},
    "Peasant Priest (Character Kit)": {},
    "Prophet Priest (Character Kit)": {"min": {"wis": 15}},
    "Savage Priest (Character Kit)": {"min": {"str": 11, "con": 13}},
    "Scholar Priest (Character Kit)": {"min": {"int": 13}},
    "Acrobat - Thief (Character Kit)": {"min": {"str": 12, "dex": 14}},
    "Adventurer (Character Kit)": {},
    "Assassin - Thief (Character Kit)": {"min": {"str": 12, "dex": 12, "int": 11}},
    "Bandit (Character Kit)": {"min": {"str": 10, "con": 10}},
    "Beggar - Thief (Character Kit)": {},
    "Bounty Hunter (Character Kit)": {"min": {"str": 11, "dex": 11, "con": 11, "int": 11, "wis": 11}},
    "Buccaneer (Character Kit)": {"min": {"con": 10}},
    "Burglar (Character Kit)": {"min": {"str": 10, "dex": 13}},
    "Cutpurse (Character Kit)": {},
    "Fence (Character Kit)": {"min": {"int": 12}},
    "Investigator - Thief (Character Kit)": {},
    "Scout - Thief (Character Kit)": {},
    "Smuggler - Thief (Character Kit)": {},
    "Spy - Thief (Character Kit)": {"min": {"int": 11}},
    "Swashbuckler - Thief (Character Kit)": {"min": {"str": 13, "dex": 13, "int": 13, "cha": 13}},
    "Swindler (Character Kit)": {"min": {"cha": 12}},
    "Thug - Thief (Character Kit)": {},
    "Troubleshooter (Character Kit)": {},
    "Blade (Character Kit)": {"min": {"dex": 13, "int": 13, "cha": 15}},
    "Charlatan (Character Kit)": {"other": True},
    "Dwarven Chanter (Character Kit)": {"min": {"con": 13, "int": 0}, "other": True},
    "Elven Minstrel (Character Kit)": {"other": True},
    "Gallant (Character Kit)": {"other": True},
    "Gnome Professor (Character Kit)": {"min": {"int": 15, "cha": 13}, "other": True},
    "Gypsy-bard (Character Kit)": {"other": True},
    "Halfling Whistler (Character Kit)": {"min": {"wis": 13, "int": 10}, "other": True},
    "Herald (Character Kit)": {},
    "Jester - Bard (Character Kit)": {"min": {"dex": 14}, "other": True},
    "Jongleur (Character Kit)": {"min": {"dex": 14}},
    "Loremaster (Character Kit)": {"min": {"int": 14, "wis": 14}},
    "Meistersinger (Character Kit)": {},
    "Riddlemaster (Character Kit)": {"min": {"int": 15}},
    "Skald (Character Kit)": {},
    "Thespian (Character Kit)": {},
    "True Bard (Character Kit)": {},
}


def kit_name(title):
    name = title.replace(" (Character Kit)", "")
    return re.sub(r" - (Fighter|Paladin|Ranger|Wizard|Thief|Bard)$", "", name)


def slug(title):
    return re.sub(r"[^a-z0-9]+", "-", title.replace(" (Character Kit)", "").lower()).strip("-")


def build_kits():
    kits, seen = {}, set()
    for cat, (book, classes) in KIT_SOURCES.items():
        members = api(action="query", list="categorymembers", cmtitle="Category:" + cat, cmlimit=500)["query"]["categorymembers"]
        for m in members:
            title = m["title"]
            if m["ns"] != 0 or not title.endswith("(Character Kit)"):
                continue
            if title not in KIT_REQ:
                raise SystemExit(f"No curated requirements for {title!r}; add it to KIT_REQ.")
            rev = api(action="query", prop="revisions", titles=title, rvprop="ids")["query"]["pages"]
            revid = next(iter(rev.values()))["revisions"][0]["revid"]
            req = KIT_REQ[title]
            kits[slug(title)] = {"name": kit_name(title), "classes": classes, "source": book,
                                 "min": req.get("min", {}), "otherRequirements": req.get("other", False),
                                 "url": url(title), "revid": revid}
            seen.add(title)
    stale = set(KIT_REQ) - seen
    if stale:
        raise SystemExit(f"Curated kits not found on the wiki: {sorted(stale)}")
    return dict(sorted(kits.items(), key=lambda kv: kv[1]["name"].lower()))


if __name__ == "__main__":
    classes, sources = build_classes()
    kits = build_kits()
    lines = ["/**",
             " * GENERATED by tools/build-class-data.py - do not edit by hand.",
             " * PHB classes (Table 13 minimums, Table 22 specialists) and Complete Handbook kits,",
             " * from the AD&D 2e fandom wiki. Mechanical facts and links only; verify against the books.",
             f" *   Table 13: {sources['table13']['page']} (revision {sources['table13']['revid']})",
             f" *   Table 22: {sources['table22']['page']} (revision {sources['table22']['revid']})",
             " *   Kits: one wiki page each (url + revid per entry).",
             " */",
             "export const CLASSES = " + json.dumps(classes, indent=2, ensure_ascii=False) + ";",
             "",
             "export const KITS = " + json.dumps(kits, indent=2, ensure_ascii=False) + ";",
             ""]
    open("module/rules/class-data.mjs", "w").write("\n".join(lines))
    print(f"wrote module/rules/class-data.mjs: {len(classes)} classes, {len(kits)} kits")
