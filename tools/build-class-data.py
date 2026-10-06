#!/usr/bin/env python3
"""Generate compendium source documents for PHB classes and Complete Handbook kits.

Output: packs/_source/classes/*.json and packs/_source/kits/*.json (Item documents of type
"class" and "kit"), compiled into LevelDB packs by tools/compile-packs.mjs at release time.

Sources (AD&D 2e fandom wiki, via the MediaWiki API; the HTML pages return a JS challenge):
  * PHB Table 13 (Class Ability Minimums) and Table 22 (Wizard Specialist Requirements).
  * PHB class pages for prime requisites and alignment rules (curated below, with the
    sentence each value comes from).
  * Kit lists from the wiki categories of the Complete Handbooks (CFH, CPaH, CRH, CWH,
    CPrH, CTH, CBH), Al-Qadim, and Player's Option: Skills & Powers (POSP_REQ). Kit ability minimums are curated below from each kit page, because
    the pages phrase requirements too inconsistently to parse safely.

Only mechanical facts are emitted (names, minimums, flags, links); no rulebook prose.
Run from the repo root:  python3 tools/build-class-data.py
"""
import hashlib, json, os, re, shutil, sys, time, urllib.error, urllib.parse, urllib.request

API = "https://adnd2e.fandom.com/api.php"
WIKI = "https://adnd2e.fandom.com/wiki/"
UA = {"User-Agent": "coldhobbits-ad2e-table-builder"}
ABIL = {"Str": "str", "Dex": "dex", "Con": "con", "Int": "int", "Wis": "wis", "Cha": "cha"}


def api(**params):
    """MediaWiki API call; on HTTP 429 (rate limit) waits (Retry-After, else 10, 20, 40 ... s) and retries."""
    params["format"] = "json"
    req = urllib.request.Request(API + "?" + urllib.parse.urlencode(params), headers=UA)
    for attempt in range(8):
        try:
            with urllib.request.urlopen(req) as r:
                return json.load(r)
        except urllib.error.HTTPError as e:
            if e.code != 429 or attempt == 7:
                raise
            wait = int(e.headers.get("Retry-After") or 0) or 10 * 2 ** attempt
            print(f"rate limited; retrying in {wait}s", file=sys.stderr)
            time.sleep(wait)


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
    # "Clerics ... can have any alignment acceptable to their order." / "A cleric who has a Wisdom of 16 or more
    # gains a 10% bonus to the experience points he earns." (Cleric (PHB) rev 67226); Wisdom "is the prime
    # requisite of priests" (Wisdom (PHB) rev 177327).
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
    "Character Kit AA": ("Al-Qadim: Arabian Adventures", None),       # classes per kit: "Kits (AA)" Table 3
    "Character Kit CShaH": ("The Complete Sha'ir's Handbook", ["mage"]),  # "the new wizard kits" (Wizard Kits (CShaH))
    "Character Kit POSP": ("Player's Option: Skills & Powers", None),  # classes per kit: POSP_REQ
}
AL_QADIM = {"Character Kit AA", "Character Kit CShaH"}
WARRIORS, ROGUES = ["fighter", "paladin", "ranger"], ["thief", "bard"]
WIZARDS = ["mage", "abjurer", "conjurer", "diviner", "enchanter", "illusionist", "invoker", "necromancer", "transmuter"]
# "Kits (AA)" Table 3 "Eligible Classes" -> class identifiers. "Clerics*": "Uses Druid Experience Table" (kahin).
AA_CLASSES = {"All warriors": WARRIORS, "Fighters, paladins": ["fighter", "paladin"], "Mages": ["mage"],
              "All wizards": WIZARDS, "All rogues": ROGUES, "Thieves": ["thief"], "Bards": ["bard"],
              "Clerics": ["cleric"], "Clerics*": ["cleric"], "All priests": ["cleric", "druid"]}
# Table 3 links two kits under a misspelt title ("Al-Quadim"); the category pages are "Al-Qadim".
AA_ALIASES = {"Corsair - Al-Quadim (Character Kit)": "Corsair - Al-Qadim (Character Kit)",
              "Mystic - Al-Quadim (Character Kit)": "Mystic - Al-Qadim (Character Kit)"}
# Al-Qadim kit requirements: (ability minimums, other restriction, regex the kit page must contain).
REQ_NONE = r"'''Requirements:''' None\."
AQ_REQ = {
    "Ajami (Character Kit)": ({}, False, REQ_NONE + r" All races"),
    "Askar (Character Kit)": ({}, False, r"'''Requirements:''' None; all races"),
    "Barber (Character Kit)": ({}, False, r"Barbers may be of either gender and any race"),
    "Beggar-Thief (Character Kit)": ({}, False, r"members of this kit must be thieves"),
    "Corsair - Al-Qadim (Character Kit)": ({}, False, r"All warriors except rangers are eligible"),
    "Desert Rider (Character Kit)": ({}, True, r"only humans, elves, and human-elf crossbreeds may assume this role"),
    "Elemental Mage (Character Kit)": ({}, False, REQ_NONE + r" Either gender, all races, and all alignments"),
    "Ethoist (Character Kit)": ({}, True, r"Characters of chaotic alignment are not eligible"),
    "Faris (Character Kit)": ({}, False, REQ_NONE + r" Although all alignments"),
    "Hakima (Character Kit)": ({"wis": 15}, True, r"must be female clerics, and they must have a Wisdom of 15 or higher"),
    "Holy Slayer (Character Kit)": ({}, True, r"must always be lawful\. They must also be thieves"),
    "Kahin (Character Kit)": ({"wis": 12, "con": 14}, True, r"They are always neutral.*Wisdom of at least 12 and a Constitution of at least 14"),
    "Mamluk (Character Kit)": ({}, False, REQ_NONE),
    "Matrud (Character Kit)": ({}, False, r"Only thieves are matruds"),
    "Mercenary Barbarian (Character Kit)": ({}, False, r"Either gender and all races are allowed"),
    "Merchant-Rogue (Character Kit)": ({}, False, r"Only members of the thief class may be merchant-rogues"),
    "Moralist (Character Kit)": ({}, True, r"Moralist clerics must be lawful"),
    "Mystic - Al-Qadim (Character Kit)": ({}, False, r"any race or faith which allows standard priests"),
    "Outland Priest (Character Kit)": ({}, True, r"Natives of Zakhara cannot be outland priests"),
    "Outland Warrior (Character Kit)": ({}, False, r"Any race and both genders are eligible"),
    "Pragmatist (Character Kit)": ({}, False, r"No specialty priest is eligible"),
    "Rawun (Character Kit)": ({}, False, r"Rawuns must first be bards"),
    "Sa'luk (Character Kit)": ({}, False, r"Any rogue class is eligible"),
    "Sha'ir (Character Kit)": ({}, False, REQ_NONE + r" Both genders are allowed"),
    "Sorcerer (Character Kit)": ({}, False, REQ_NONE),
    "Astrologer - Sha'ir (Character Kit)": ({}, True, r"Astrologers must be of a lawful alignment"),
    "Clockwork Mage (Character Kit)": ({"int": 14, "dex": 16}, False, r"at least an \[\[Intelligence\]\] of 14 and a \[\[Dexterity\]\] of 16"),
    "Digitalogist (Character Kit)": ({}, True, r"Digitalogists can be of any lawful alignment"),
    "Ghul Lord (Character Kit)": ({}, True, r"All ghul lords are of chaotic alignments"),
    "Jackal (Character Kit)": ({}, True, r"Jackals cannot be of lawful alignments"),
    "Mageweaver (Character Kit)": ({}, False, REQ_NONE + r" Anyone may become a mageweaver"),
    "Mystic of Nog (Character Kit)": ({}, True, r"must be of any alignment that is not neutral"),
    "Spellslayer (Character Kit)": ({}, True, r"may only be of non-good, chaotic alignments"),
}
# Player's Option: Skills & Powers kits ("Character Kits (POSP)": "With some exceptions, a character of any class can
# choose any kit"). Requirements curated from each kit page: (ability minimums, classes, barred standard races, other
# restriction, regex the page's "Requirements" text must contain; links removed, spacing normalized). Subabilities are
# not used (owner's ruling), so a subability minimum (Dexterity/Balance 14) applies to its ability (Dexterity 14).
# The minimums add to the class's (`minStacks`: the higher applies). Optional S&P races (half-ogres, aarakocra...) are
# not in this system; only the standard races are barred. "other": alignment, sex, prime requisite or DM approval.
POSP_ALL = ["fighter", "paladin", "ranger"] + ["mage", "abjurer", "conjurer", "diviner", "enchanter", "illusionist",
                                              "invoker", "necromancer", "transmuter"] + ["cleric", "druid", "thief", "bard"]
POSP_WIZ = POSP_ALL[3:12]


def posp_without(*barred):
    return [c for c in POSP_ALL if c not in barred]


POSP_REQ = {
    "Acrobat - POSP (Character Kit)": ({"dex": 14, "str": 12}, POSP_ALL, [], False,
        r"minimum Dexterity/Balance of 14 and a minimum Strength/Stamina of 12"),
    "Amazon - POSP (Character Kit)": ({}, POSP_ALL, [], True, r"Female characters of any demihuman or humanoid race can choose this kit"),
    "Animal Master - POSP (Character Kit)": ({"con": 10, "wis": 12}, POSP_ALL, [], False,
        r"minimum Constitution/Fitness of 10 and a minimum Wisdom/Intuition of 12\. This kit is open to all player character races"),
    "Assassin - POSP (Character Kit)": ({"int": 10, "wis": 12}, posp_without("paladin", "ranger", "druid"), [], True,
        r"minimum Intelligence/Reason of 10 and a minimum Wisdom/Willpower of 12\. The assassin kit is barred to paladins, "
        r"rangers, and druids\. This kit is open to all player character races\. The character must have evil alignment"),
    "Barbarian - POSP (Character Kit)": ({"str": 13, "con": 13}, posp_without("paladin", "cleric", "bard"), [], False,
        r"minimum Strength/Stamina and Constitution/Health scores of 13\. The barbarian kit is barred to paladins, clerics, "
        r"and bards\. This kit is open to all player character races"),
    "Beggar - POSP (Character Kit)": ({"cha": 10}, posp_without("paladin", "ranger", "druid", *POSP_WIZ), [], True,
        r"Beggars must be chaotic in alignment and have a Charisma/Leadership score of at least 10\. This kit is barred to all "
        r"optional races except kobolds, goblins, and mongrelmen, as well as paladins, rangers, druids, and wizards of all types"),
    "Cavalier - POSP (Character Kit)": ({"cha": 14}, posp_without("ranger", "thief", "druid", "bard"), ["gnome", "halfling"], True,
        r"minimum score of 13 in their class's prime requisite\. Also, all cavaliers must a minimum Charisma/Leadership of 14\. "
        r"Cavaliers can be humans, elves, half-elves, or dwarves; this kit is barred to rangers, thieves, druids, and bards"),
    "Diplomat - POSP (Character Kit)": ({"int": 10, "wis": 12, "cha": 12}, POSP_ALL, [], False,
        r"minimum Intelligence/Knowledge score of 10 and minimum Wisdom/Intuition and Charisma/Appearance scores of 12\. "
        r"The diplomat kit is barred to half-orcs, half-ogres, and any of the optional races"),
    "Explorer - POSP (Character Kit)": ({"wis": 12, "int": 12}, POSP_ALL, [], False,
        r"minimum of 12 for Wisdom/Willpower and Intelligence/Knowledge scores\. This kit is open to all player character races and classes"),
    "Gladiator - POSP (Character Kit)": ({"str": 13, "con": 13}, posp_without("paladin", "ranger", "thief", "bard", *POSP_WIZ), [], False,
        r"Strength/Muscle and Constitution/Fitness scores of 13 or greater\. This kit is barred to satyrs and swanmays\. In addition, "
        r"paladins, rangers, wizards, thieves, and bards may not choose this kit"),
    "Jester - POSP (Character Kit)": ({"int": 12, "cha": 13}, ["thief", "bard"], ["dwarf", "elf"], False,
        r"minimum Intelligence/Reason of 12 and a minimum Charisma/Leadership of 13\. Dwarves, elves, and any of the optional PC "
        r"races except for kobolds or goblins may not choose this kit\. Only bards and thieves may choose this kit"),
    "Mariner - POSP (Character Kit)": ({"int": 9}, POSP_ALL, ["dwarf"], False,
        r"minimum Intelligence/Knowledge score of 9\. The mariner kit is prohibited for dwarves"),
    "Merchant - POSP (Character Kit)": ({"int": 9, "cha": 9}, posp_without("paladin", "ranger", "druid"), [], False,
        r"minimum Intelligence/Knowledge and Charisma/Appearance scores of 9\. This kit is closed to paladins, rangers, druids and"),
    "Mystic - POSP (Character Kit)": ({"wis": 13}, posp_without("thief", "bard"), ["dwarf"], False,
        r"minimum Wisdom/Intuition score of 13\. This kit is closed to thieves and bards\. Only characters of the following races "
        r"can choose this kit: human, elf, half-elf, gnome, halfling,"),
    "Noble - POSP (Character Kit)": ({}, POSP_ALL, [], False,
        r"Nobles need only meet the requirements of their adventuring class\. This kit is open to all classes and races except mongrelmen"),
    "Outlaw - POSP (Character Kit)": ({"str": 12, "con": 12}, POSP_ALL, [], True,
        r"minimum Strength/Stamina and Constitution/Health scores of 12\. This kit is open to all races and classes, but paladin "
        r"outlaws require special approval from the DM"),
    "Peasant Hero - POSP (Character Kit)": ({}, POSP_ALL, [], False,
        r"This kit is open to all classes and races\. There are no ability score requirements"),
    "Pirate - POSP (Character Kit)": ({"con": 12, "dex": 12}, POSP_ALL, ["dwarf"], False,
        r"minimum Constitution/Health and Dexterity/Balance scores of 12\. The pirate kit is prohibited for dwarves,.*?This kit is open to all classes"),
    "Pugilist - POSP (Character Kit)": ({"str": 14, "dex": 14}, posp_without(*POSP_WIZ), [], False,
        r"minimum Strength/Muscle and Dexterity/Balance scores of 14\..*?The kit is open to all classes except wizards"),
    "Rider - POSP (Character Kit)": ({"cha": 13}, POSP_ALL, [], False,
        r"minimum Charisma/Leadership of 13\. This kit is open to the standard player character races,.*?The kit is open to all classes"),
    "Savage - POSP (Character Kit)": ({"con": 13}, posp_without("paladin"), [], False,
        r"minimum Constitution/Fitness score of 13\. This kit is open to all races except githzerai and swanmays, and to all classes except paladins"),
    "Scholar - POSP (Character Kit)": ({"int": 13}, posp_without("fighter"), [], False,
        r"minimum Intelligence/Knowledge of 13\. This kit is open to all standard player chacter races.*?Fighters may not be scholars"),
    "Scout - POSP (Character Kit)": ({"wis": 12}, POSP_ALL, [], False,
        r"minimum Wisdom/Intuition score of 12\. This kit is open to all races and classes"),
    "Sharpshooter - POSP (Character Kit)": ({"dex": 13}, posp_without("cleric", "druid", *POSP_WIZ), [], True,
        r"minimum Dexterity/Aim of 13\..*?This kit is barred to wizards and priests \(although the DM may allow some specialty priests, "
        r"such as druids, to become sharpshooters\)"),
    "Smuggler - POSP (Character Kit)": ({"wis": 12}, POSP_ALL, [], True,
        r"minimum Wisdom/Willpower score of 12,.*?This kit is open to all races and classes, but paladin smugglers require special approval from the DM"),
    "Soldier - POSP (Character Kit)": ({"con": 12}, POSP_ALL, [], False,
        r"minimum Constitution/Fitness score of 12,.*?The kit is open to all classes"),
    "Spy - POSP (Character Kit)": ({"int": 13, "cha": 13}, POSP_ALL, [], False,
        r"minimum Intelligence/Reason and Charisma/Appearance scores of 13\..*?The kit is open to all classes"),
    "Swashbuckler - POSP (Character Kit)": ({"dex": 12, "int": 12}, posp_without("ranger", "druid"), [], False,
        r"minimum Dexterity/Balance and Intelligence/Reason scores of 12\. This kit is closed to the optional player character races, and to rangers and druids"),
    "Thug - POSP (Character Kit)": ({"str": 10, "cha": 10}, ["fighter", "thief"], [], False,
        r"Thugs must have minimum Strength/Muscle and Charisma/Appearance scores of 10\..*?Only fighters and thieves may select this kit"),
    "Weapon Master - POSP (Character Kit)": ({"str": 13, "dex": 13}, ["fighter", "cleric", "druid", "thief"], [], False,
        r"Only fighters, priests, and thieves can become weapon masters\. Further, they must have minimum Strength/Stamina and "
        r"Dexterity/Aim scores of 13\. The kit is open to all races"),
}
KIT_NOTES_POSP = {
    "Amazon - POSP (Character Kit)": "Female characters only.",
    "Assassin - POSP (Character Kit)": "Evil alignment required.",
    "Beggar - POSP (Character Kit)": "Chaotic alignment required.",
    "Cavalier - POSP (Character Kit)": "A score of 13 or more in the class's prime requisite is required.",
    "Outlaw - POSP (Character Kit)": "Paladins need the DM's approval.",
    "Sharpshooter - POSP (Character Kit)": "The DM may allow some specialty priests (such as druids).",
    "Smuggler - POSP (Character Kit)": "Paladins need the DM's approval.",
}


def flat_text(wiki):
    """Wikitext with links, bold/italic markup and spacing normalized (for the curated regexes)."""
    t = re.sub(r"\[\[(?:[^\]|]*\|)?([^\]]*)\]\]", r"\1", wiki)
    t = re.sub(r"'{2,}", "", t)
    return re.sub(r"\s+", " ", t)


KIT_NOTES = {"Kahin (Character Kit)": "Uses the druid experience table (Kits (AA), Table 3)."}
# Kits with another class's experience table: Table 3 "Clerics*" with the footnote "* Uses Druid Experience Table".
KIT_XP = {"Kahin (Character Kit)": "druid"}
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
#   Herald: "Demihumans can become Heralds of up to 6th level." (read literally: all non-human races, half-elves
#   included; confirmed by the repo owner)
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
    name = re.sub(r" - Al-Qadim$", " (Al-Qadim)", name)
    name = re.sub(r" - POSP$", " (POSP)", name)  # Skills & Powers kits share names with Complete Handbook kits  # Corsair, Mystic: other books have kits of these names
    return re.sub(r" - (Fighter|Paladin|Ranger|Wizard|Thief|Bard|Sha'ir)$", "", name)


def aa_classes():
    """Kit title -> class identifiers from "Kits (AA)" Table 3 (Eligible Classes)."""
    wiki, _, _ = page("Kits (AA)")
    out, starred = {}, set()
    for r in table_rows(wiki, "Table 3: Character Kit Summary"):
        m = re.search(r"\[\[([^\]|]+)\|", r[0])
        if not m:
            continue  # group heading rows
        title = AA_ALIASES.get(m.group(1).strip(), m.group(1).strip())
        out[title] = AA_CLASSES[r[1].strip()]
        if r[1].strip().endswith("*"):
            starred.add(title)
    # "* Uses Druid Experience Table": the starred kits are exactly those in KIT_XP (as druid).
    assert re.search(r"\* Uses Druid Experience Table", wiki), "Table 3 footnote changed"
    assert starred == {t for t, c in KIT_XP.items() if c == "druid"}, starred
    return out


def slug(title):
    return re.sub(r"[^a-z0-9]+", "-", title.replace(" (Character Kit)", "").lower()).strip("-")


def build_kits():
    kits, seen = {}, set()
    table3 = aa_classes()
    for cat, (book, classes) in KIT_SOURCES.items():
        members = api(action="query", list="categorymembers", cmtitle="Category:" + cat, cmlimit=500)["query"]["categorymembers"]
        for m in members:
            title = m["title"]
            if m["ns"] != 0 or not title.endswith("(Character Kit)"):
                continue
            if cat in AL_QADIM:
                if title not in AQ_REQ:
                    raise SystemExit(f"No curated requirements for {title!r}; add it to AQ_REQ.")
                mins, other, pattern = AQ_REQ[title]
                wiki, revid, _ = page(title)
                if not re.search(pattern, wiki, re.S):
                    raise SystemExit(f"{title}: requirement text changed (AQ_REQ pattern {pattern!r} not found)")
                req = {"min": mins, "other": other}
                if classes is None and title not in table3:
                    raise SystemExit(f"{title} is not in Kits (AA) Table 3")
                kit_classes = table3[title] if classes is None else classes
            elif cat == "Character Kit POSP":
                if title not in POSP_REQ:
                    raise SystemExit(f"No curated requirements for {title!r}; add it to POSP_REQ.")
                mins, kit_classes, barred, other, pattern = POSP_REQ[title]
                wiki, revid, _ = page(title)
                if not re.search(pattern, flat_text(wiki)):
                    raise SystemExit(f"{title}: requirement text changed (POSP_REQ pattern {pattern!r} not found)")
                req = {"min": mins, "other": other, "barred": barred, "stacks": True}
            else:
                if title not in KIT_REQ:
                    raise SystemExit(f"No curated requirements for {title!r}; add it to KIT_REQ.")
                rev = api(action="query", prop="revisions", titles=title, rvprop="ids")["query"]["pages"]
                revid = next(iter(rev.values()))["revisions"][0]["revid"]
                req, kit_classes = KIT_REQ[title], classes
            race_limits, race_only = KIT_RACES.get(title, ({}, False))
            key = slug(title)
            if key in kits and cat in AL_QADIM:
                key += "-al-qadim"  # "Beggar-Thief" (AA) and "Beggar - Thief" (CTH) give the same slug
            if key in kits:
                raise SystemExit(f"Duplicate kit identifier {key!r} ({title})")
            kits[key] = {"name": kit_name(title), "classes": kit_classes, "source": book,
                                 "min": req.get("min", {}), "otherRequirements": req.get("other", False),
                                 "raceLimits": race_limits, "raceOnly": race_only, "alQadim": cat in AL_QADIM,
                                 "racesBarred": req.get("barred", []), "minStacks": req.get("stacks", False),
                                 "posp": cat == "Character Kit POSP",
                                 "notes": KIT_NOTES.get(title, KIT_NOTES_POSP.get(title, "")), "xpTable": KIT_XP.get(title, ""), "url": url(title), "revid": revid}
            seen.add(title)
    if set(table3) - seen:
        raise SystemExit(f"Kits (AA) Table 3 kits missing from the category: {sorted(set(table3) - seen)}")
    stale = (set(KIT_REQ) | set(KIT_RACES) | set(AQ_REQ) | set(POSP_REQ)) - seen
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
        name = d["system"]["identifier"] if "system" in d else f"_folder-{d['_key'].split('!')[-1]}"
        with open(os.path.join(folder, f"{name}.json"), "w") as f:
            json.dump(d, f, indent=2, ensure_ascii=False)
            f.write("\n")


def folder_doc(key, name, parent=None, sort=0):
    """Compendium Folder document (same shape as dnd5e's packs/_source/**/_folder.yml)."""
    _id = doc_id("folder", key)
    return {"_id": _id, "_key": f"!folders!{_id}", "name": name, "type": "Item", "sorting": "a",
            "folder": parent, "sort": sort, "color": None, "flags": {}}


GROUP_FOLDERS = {"warrior": "Warrior", "wizard": "Wizard", "priest": "Priest", "rogue": "Rogue"}
# Kit folders: group -> sub-folder per class line. Wizard (mage + specialists) and priest (cleric + druid)
# kits apply to the whole group, so they sit directly in the group folder.
KIT_FOLDERS = {"fighter": ("warrior", "Fighter"), "paladin": ("warrior", "Paladin"), "ranger": ("warrior", "Ranger"),
               "mage": ("wizard", None), "cleric": ("priest", None),
               "thief": ("rogue", "Thief"), "bard": ("rogue", "Bard")}


def item_doc(kind, key, name, img, system, sort):
    _id = doc_id(kind, key)
    return {"_id": _id, "_key": f"!items!{_id}", "name": name, "type": kind, "img": img,
            "system": system, "effects": [], "folder": None, "sort": sort,
            "ownership": {"default": 0}, "flags": {}}


if __name__ == "__main__":
    classes, sources = build_classes()
    kits = build_kits()
    group_ids = {}
    class_folders, kit_folders = [], []
    for i, (g, label) in enumerate(GROUP_FOLDERS.items()):
        f = folder_doc(f"classes.{g}", label, sort=i * 1000)
        class_folders.append(f)
        kf = folder_doc(f"kits.{g}", label, sort=i * 1000)
        kit_folders.append(kf)
        group_ids[g] = (f["_id"], kf["_id"])
    kit_folder_for = {}
    for cls, (g, label) in KIT_FOLDERS.items():
        if label is None:
            kit_folder_for[cls] = group_ids[g][1]
        else:
            sub = folder_doc(f"kits.{g}.{cls}", label, parent=group_ids[g][1], sort=len(kit_folders) * 1000)
            kit_folders.append(sub)
            kit_folder_for[cls] = sub["_id"]
    # Al-Qadim kits: one "Al-Qadim" folder per group (most of them apply to the whole group).
    group_of = {c["key"]: c["group"] for c in CLASS_FACTS.values()}
    aq_folder = {}
    for g in GROUP_FOLDERS:
        sub = folder_doc(f"kits.{g}.alqadim", "Al-Qadim", parent=group_ids[g][1], sort=90000)
        kit_folders.append(sub)
        aq_folder[g] = sub["_id"]
    # Skills & Powers kits are open to most classes: one top-level folder.
    posp_folder = folder_doc("kits.posp", "Skills & Powers (POSP)", sort=len(GROUP_FOLDERS) * 1000)
    kit_folders.append(posp_folder)

    class_docs = []
    for i, (key, c) in enumerate(classes.items()):
        class_docs.append(item_doc("class", key, c["name"], "icons/svg/book.svg", {
            "identifier": key, "group": c["group"],
            "min": {a: c["min"].get(a) for a in MINS},
            "prime": c["prime"], "alignments": c["alignments"],
            "school": c.get("school", ""), "opposition": c.get("opposition", ""), "races": c.get("races", []),
            "url": c["url"], "notes": ""}, i * 1000))
        class_docs[-1]["folder"] = group_ids[c["group"]][0]
    kit_docs = []
    for i, (key, k) in enumerate(kits.items()):
        kit_docs.append(item_doc("kit", key, k["name"], "icons/svg/item-bag.svg", {
            "identifier": key, "classes": k["classes"], "source": k["source"],
            "min": {a: k["min"].get(a) for a in MINS},
            "otherRequirements": k["otherRequirements"], "raceLimits": k["raceLimits"], "raceOnly": k["raceOnly"],
            "racesBarred": k["racesBarred"], "minStacks": k["minStacks"],
            "xpTable": k.get("xpTable", ""), "url": k["url"], "notes": k["notes"]}, i * 1000))
        kit_docs[-1]["folder"] = (posp_folder["_id"] if k["posp"] else aq_folder[group_of[k["classes"][0]]] if k["alQadim"]
                                  else kit_folder_for[k["classes"][0]])
    write_docs("packs/_source/classes", class_folders + class_docs)
    write_docs("packs/_source/kits", kit_folders + kit_docs)
    print(f"wrote packs/_source: {len(class_docs)} classes, {len(kit_docs)} kits "
          f"(Table 13 rev {sources['table13']['revid']}, Table 22 rev {sources['table22']['revid']})")
