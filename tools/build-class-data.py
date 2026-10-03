#!/usr/bin/env python3
"""Generate compendium source documents for PHB classes and Complete Handbook kits.

Output: packs/_source/classes/*.json and packs/_source/kits/*.json (Item documents of type
"class" and "kit"), compiled into LevelDB packs by tools/compile-packs.mjs at release time.

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
import hashlib, json, os, re, shutil, urllib.parse, urllib.request

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


# Kit-specific racial level limits (null = unlimited) and race-exclusive kits, curated from
# the Complete Bard's Handbook kit pages ("Qualifications"); no other kit page states any.
#   Charlatan: "Gnomes may become Charlatans and advance up to 6th level."
#   Dwarven Chanter: "Only dwarves can become Chanters and they are limited to 15th level"
#   Elven Minstrel: "Only elves and half-elves can become Minstrels. Elves can advance up to 15th level ...
#                    half-elves are limited to 12th level."
#   Gnome Professor: "Only gnomes can become Professors, and they can advance up to 15th level."
#   Gypsy-bard: "Elves can become Gypsy-bards able to advance to the 9th level."
#   Halfling Whistler: "Halflings are the only race able to become Whistlers. They are limited to 15th level."
#   Herald: "Demihumans can become Heralds of up to 6th level." (read literally: all non-human races)
#   Jester: "Gnomes may advance to 15th level as Jesters, while halflings cannot rise above 8th level."
#   Jongleur: "Gnomes can advance to the 9th level as Jongleurs. Halflings can attain 12th level."
#   Loremaster: "Elves can advance up to 12th level as Lore masters."
#   Meistersinger: "Elves can become Meistersingers and reach 15th level."
#   Riddlemaster: "Gnomes can rise to become 8th-level Riddlemasters. Halflings can advance up to 9th level."
#   Skald: "Dwarves can advance up to the 12th level as Skalds."
KIT_RACES = {
    "Charlatan (Character Kit)": ({"gnome": 6}, False),
    "Dwarven Chanter (Character Kit)": ({"dwarf": 15}, True),
    "Elven Minstrel (Character Kit)": ({"elf": 15, "half-elf": 12}, True),
    "Gnome Professor (Character Kit)": ({"gnome": 15}, True),
    "Gypsy-bard (Character Kit)": ({"elf": 9}, False),
    "Halfling Whistler (Character Kit)": ({"halfling": 15}, True),
    "Herald (Character Kit)": ({"dwarf": 6, "elf": 6, "gnome": 6, "half-elf": 6, "halfling": 6}, False),
    "Jester - Bard (Character Kit)": ({"gnome": 15, "halfling": 8}, False),
    "Jongleur (Character Kit)": ({"gnome": 9, "halfling": 12}, False),
    "Loremaster (Character Kit)": ({"elf": 12}, False),
    "Meistersinger (Character Kit)": ({"elf": 15}, False),
    "Riddlemaster (Character Kit)": ({"gnome": 8, "halfling": 9}, False),
    "Skald (Character Kit)": ({"dwarf": 12}, False),
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
            race_limits, race_only = KIT_RACES.get(title, ({}, False))
            kits[slug(title)] = {"name": kit_name(title), "classes": classes, "source": book,
                                 "min": req.get("min", {}), "otherRequirements": req.get("other", False),
                                 "raceLimits": race_limits, "raceOnly": race_only,
                                 "url": url(title), "revid": revid}
            seen.add(title)
    stale = (set(KIT_REQ) | set(KIT_RACES)) - seen
    if stale:
        raise SystemExit(f"Curated kits not found on the wiki: {sorted(stale)}")
    return dict(sorted(kits.items(), key=lambda kv: kv[1]["name"].lower()))


def doc_id(kind, key):
    """Stable 16-character document id derived from the identifier."""
    alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"
    n = int(hashlib.sha1(f"ad2e.{kind}.{key}".encode()).hexdigest(), 16)
    return "".join(alphabet[(n >> (6 * i)) % 62] for i in range(16))


MINS = ["str", "dex", "con", "int", "wis", "cha"]


def write_docs(folder, docs):
    if os.path.isdir(folder):
        shutil.rmtree(folder)
    os.makedirs(folder)
    for d in docs:
        with open(os.path.join(folder, f"{d['system']['identifier']}.json"), "w") as f:
            json.dump(d, f, indent=2, ensure_ascii=False)
            f.write("\n")


def item_doc(kind, key, name, img, system, sort):
    _id = doc_id(kind, key)
    return {"_id": _id, "_key": f"!items!{_id}", "name": name, "type": kind, "img": img,
            "system": system, "effects": [], "folder": None, "sort": sort,
            "ownership": {"default": 0}, "flags": {}}


if __name__ == "__main__":
    classes, sources = build_classes()
    kits = build_kits()
    class_docs = []
    for i, (key, c) in enumerate(classes.items()):
        class_docs.append(item_doc("class", key, c["name"], "icons/svg/book.svg", {
            "identifier": key, "group": c["group"],
            "min": {a: c["min"].get(a) for a in MINS},
            "prime": c["prime"], "alignments": c["alignments"],
            "school": c.get("school", ""), "opposition": c.get("opposition", ""), "races": c.get("races", []),
            "url": c["url"], "notes": ""}, i * 1000))
    kit_docs = []
    for i, (key, k) in enumerate(kits.items()):
        kit_docs.append(item_doc("kit", key, k["name"], "icons/svg/item-bag.svg", {
            "identifier": key, "classes": k["classes"], "source": k["source"],
            "min": {a: k["min"].get(a) for a in MINS},
            "otherRequirements": k["otherRequirements"], "raceLimits": k["raceLimits"], "raceOnly": k["raceOnly"],
            "url": k["url"], "notes": ""}, i * 1000))
    write_docs("packs/_source/classes", class_docs)
    write_docs("packs/_source/kits", kit_docs)
    print(f"wrote packs/_source: {len(class_docs)} classes, {len(kit_docs)} kits "
          f"(Table 13 rev {sources['table13']['revid']}, Table 22 rev {sources['table22']['revid']})")
