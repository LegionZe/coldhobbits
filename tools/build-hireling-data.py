#!/usr/bin/env python3
"""Generate the "Hirelings & Mounts" compendium (packs/_source/hirelings): monster-type actors for hirelings and mounts.

Sources (AD&D 2e fandom wiki, MediaWiki API):
  * Soldiers: DMG Table 64 Military Occupations (title, monthly wage) on "Soldiers (DMG)". Equipment comes from the
    page's troop-type descriptions where they name it (SOLDIERS below; each `match` must occur in the description,
    the script fails otherwise); where the page says weapons vary, none are added and the notes say so.
    Statistics: the "Soldier" column of "Human (MM)" (AC, Hit Dice, THAC0, morale, XP); movement 12 (PHB Table 64).
  * Civilian hirelings: DMG Table 65 Common Wages (weekly, monthly) on "Employing Hirelings (DMG)"; statistics from the
    "Human (MM)" column in CIVILIANS (a curated match of profession to the closest Monstrous Manual human type).
  * Mounts: "Horse" (Draft, Heavy, Medium, Light, Riding, Pony, Mule columns), "Camel" (Desert, War), "Elephant"
    (Elephant (African) column, used for the PHB's labor and war elephants); load, cost from the PHB animal items
    (packs/_source/equipment, PHB Table 50 load).
  * Familiars (Find Familiar (Wizard Spell)): the d20 table (creature, sensory powers) and the spell's figures (hit points
    2-4 + 1 per caster level, AC 7, +1 to surprise, 1 hp lost per day apart, system shock and -1 Constitution when it
    dies; each checked by regex) are written to module/rules/familiar-tables.mjs; actors with role "familiar" (folder
    Familiars) take their other statistics from the creature's page (FAMILIARS; the toad has no stat block for a normal
    toad, so it carries the spell's figures only).
  * Animal companions and mounts (Skills & Powers kits Animal Master and Rider): Table 42 (d20) and Table 43 (d6 group,
    d8 mount) from the kit pages, the kits' rules (and Cavalier's and Noble's mount requirement) regex-checked, written to
    module/rules/companion-tables.mjs; one actor per creature (folder "Animal Companions & Mounts (POSP)", role pet or
    mount; CREATURES maps each table name to its Monstrous Manual page and entry; horse/pony, camel, mule and elephant
    are the Mounts actors). Variable-size creatures carry the first variant's experience value (noted on the actor).
Human stat blocks give no attacks: hirelings attack with their weapon items. Armoured hirelings: equipped armour sets
their AC (base 10). Run from the repo root after build-monster-data.py:  python3 tools/build-hireling-data.py
"""
import importlib.util
import json
import re

_spec = importlib.util.spec_from_file_location("monsters", "tools/build-monster-data.py")
monsters = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(monsters)
classdata = monsters.classdata

HUMAN = "icons/svg/mystery-man.svg"
ANIMAL = "icons/svg/pawprint.svg"
AMMO = 12  # pieces of ammunition given with a bow or crossbow (one PHB purchase unit of flight arrows)
VARIES = "Weapons vary (see the troop type on the DMG page): add them from the Weapons (PHB) compendium."

# Table 64 title -> (stated equipment [(pack, item name, extra system fields)], regex the description must contain, note)
W, A = "weapons", "armor"
SOLDIERS = {
    "Archer": ([(W, "Short bow"), (W, "Flight arrow", {"quantity": AMMO}), (W, "Short sword"), (A, "Leather", {"equipped": True})],
               r"typically armed with a shortbow, arrows, short sword, and leather armor", ""),
    "Artillerist": ([], r"they don't normally enter into combat", "Crews catapults and siege engines; outfits himself as he pleases."),
    "Bowman, mounted": ([(W, "Short bow"), (W, "Flight arrow", {"quantity": AMMO}), (W, "Long sword"), (A, "Leather", {"equipped": True})],
                        r"They carry short bows, a long sword or scimitar, and leather armor", "Rides a light war horse (Mounts folder)."),
    "Cavalry, heavy": ([(W, "Heavy horse lance"), (W, "Long sword"), (W, "Horseman's mace"), (A, "Plate mail", {"equipped": True})],
                       r"armed with heavy lance, long sword, and mace\. They wear plate mail or field plate armor",
                       "Rides a barded heavy war horse (Mounts folder); the mace is the horseman's mace."),
    "Cavalry, light": ([(A, "Padded", {"equipped": True}), (A, "Small shield", {"equipped": True})],
                       r"Their armor is nonexistent or very light.padded leathers and shields",
                       "Rides a light war horse. " + VARIES),
    "Cavalry, medium": ([(W, "Medium horse lance"), (W, "Long sword"), (W, "Horseman's mace"), (A, "Chain mail", {"equipped": True}),
                         (A, "Medium shield", {"equipped": True})],
                        r"wear scale, chain, or banded armor\. Typical arms include lance, long sword, mace, and medium shield",
                        "Rides an unarmoured medium war horse (Mounts folder)."),
    "Crossbowman, heavy": ([(W, "Heavy crossbow"), (W, "Heavy quarrel", {"quantity": AMMO}), (W, "Short sword"), (W, "Dagger or dirk"),
                            (A, "Chain mail", {"equipped": True})],
                           r"Each normally has a heavy crossbow, short sword, and dagger, and wears chain mail", ""),
    "Crossbowman, light": ([(W, "Light crossbow"), (W, "Light quarrel", {"quantity": AMMO}), (W, "Short sword"), (W, "Dagger or dirk")],
                           r"Each man normally has a light crossbow, short sword, and dagger\. Usually they do not wear armor", ""),
    "Crossbowman, mounted": ([(W, "Light crossbow"), (W, "Light quarrel", {"quantity": AMMO})],
                             r"All use light crossbows.*the rider normally wears little or no armor", "Rides an unbarded horse."),
    "Engineer": ([], r"Engineers normally supervise siege operations", "Siege specialist, not a common soldier."),
    "Footman, heavy": ([(A, "Chain mail", {"equipped": True}), (A, "Body shield", {"equipped": True})],
                       r"Heavy footmen normally have chain mail or better armor, a large shield, and any weapons",
                       "The large shield is the PHB body shield. " + VARIES),
    "Footman, irregular": ([], r"little or no armor and virtually no discipline", VARIES),
    "Footman, light": ([], r"Arms and armor are often the same as irregulars", VARIES),
    "Footman, militia": ([], r"somewhere between irregulars and light infantry in equipment", VARIES),
    "Longbowman": ([(W, "Long bow"), (W, "Flight arrow", {"quantity": AMMO}), (W, "Short sword"), (A, "Leather", {"equipped": True})],
                   r"typically wears padded or leather armor and carries a long bow with short sword or dirk", ""),
    "Marine": ([(A, "Chain mail", {"equipped": True}), (A, "Body shield", {"equipped": True})],
               r"These are heavy footmen who serve aboard large ships", "Equipped as a heavy footman. " + VARIES),
    "Sapper": ([], r"They wear no armor and carry tools", "Carries tools (picks, axes) that serve as weapons."),
    "Shieldbearer": ([(A, "Body shield", {"equipped": True})], r"shieldbearers have the same equipment as light infantry",
                     "Carries and sets up large shields (pavises) for archers and crossbowmen. " + VARIES),
}
SKIP_SOLDIERS = {"Handgunner (Optional)": "arquebuses only with the DM's approval"}

# Table 65 profession -> Human (MM) column with the closest description.
CIVILIANS = {"Clerk": "Middle Class", "Stonemason": "Tradesman/Craftsman", "Laborer": "Peasant/Serf",
             "Carpenter": "Tradesman/Craftsman", "Groom": "Peasant/Serf", "Huntsman": "Farmer/Herder",
             "Ambassador or official": "Gentry", "Architect": "Tradesman/Craftsman"}

# Mounts: (key, name, page, column, PHB animal item for load and cost, tack)
TACK = [("equipment", "Saddle, riding", {"carried": True}), ("equipment", "Bit and bridle", {"carried": True})]
MOUNTS = [
    ("horse-draft", "Horse, draft", "Horse", "Draft", "Horse, draft", []),
    ("horse-heavy", "Horse, heavy war", "Horse", "Heavy", "Horse, heavy war", TACK),
    ("horse-medium", "Horse, medium war", "Horse", "Medium", "Horse, medium war", TACK),
    ("horse-light", "Horse, light war", "Horse", "Light", "Horse, light war", TACK),
    ("horse-riding", "Horse, riding", "Horse", "Riding", "Horse, riding", TACK),
    ("pony", "Pony", "Horse", "Pony", "Pony", TACK),
    ("mule", "Mule", "Horse", "Mule", "Donkey, mule, or ass", [("equipment", "Saddle, pack", {"carried": True})]),
    ("camel", "Camel", "Camel", "Desert", "Camel", []),
    ("camel-war", "Camel, war", "Camel", "War", "Camel", []),
    ("elephant", "Elephant", "Elephant", "'''Elephant''' (African)", "Elephant, war", []),
]
# Pack and draft animals (PHB Table 49 loads, actor role "pack"): (key, name, page, column or None for a page with one
# creature whose infobox name is the page title, PHB animal item, tack). The ox uses the Herd Mammal (MM) Cattle column; the mule is ridden or packed.
PACK = [
    ("ox", "Ox", "Herd Mammal", "Cattle", "Ox", []),
    ("dog-war", "Dog, war", "War Dog", None, "Dog, war", []),
]
PACK_ROLE = {"mule"}
# Yak (owner's choice): the Yak page's own table row "Bull (wild ox)" (Monstrous Compendium Annual Volume Two, Mammal,
# Herd II: "This category indudes wild aurochs, oxen, and yaks"); load from the PHB Table 49 Yak row (no Table 44 price);
# the DMG travel rule as a note. Each text is regex-checked.
YAK = {"page": "Yak", "row": "Bull (wild ox)",
       "category": r"'{3}Bull:'{3} This category in(?:clu|du)des wild aurochs, oxen, and yaks",
       "size": (r"A typical bull is semi-intelligent and large", {"intelligence": "Semi-", "size": "L"}),
       "rule": ("Movement (DMG)", r"Their sure footing allows them to reduce all mountain movement rates by one",
                "Sure-footed: mountain movement rates reduced by one; unaffected by cold, prone to heat exhaustion in warm "
                "climates (Movement (DMG)).")}
# PHB Table 49 columns -> stat block fields for an article table ("! Name ! #AP ! AC ...").
ARTICLE_COLUMNS = {"#AP": "numberAppearing", "AC": "ac", "Mv": "movement", "HD": "hitDice", "#AT": "attacks", "Dmg": "damage",
                   "ML": "morale", "SA": "specialAttacks", "XP": "xp"}


def article_row_block(title, name):
    """Stat block from a page's article table (one row per creature: Name, #AP, AC, Mv, HD, THAC0, #AT, Dmg, ML, SA, XP)."""
    wiki, rev, _ = classdata.page(title)
    t = wiki[wiki.index('{| class="article-table"'):]
    chunks = re.split(r"\n\|-", t)
    head = [h.strip() for h in re.findall(r"^!\s*(.+)$", chunks[0], re.M)]
    for chunk in chunks[1:]:
        cells = [l[1:].strip() for l in chunk.strip().split("\n") if l.startswith("|") and not l.startswith(("|}", "|-"))]
        if cells and cells[0] == name:
            row = dict(zip(head, cells))
            return {ARTICLE_COLUMNS[k]: v for k, v in row.items() if k in ARTICLE_COLUMNS}, rev
    raise AssertionError(f"{title}: no row {name}")


def table49_load(name):
    """PHB Table 49 load for an animal row: {full, half, quarter} (upper limits in lb)."""
    wiki, rev, _ = classdata.page("Encumbrance Tables (PHB)")
    t = wiki[wiki.index("Table 49: Carrying Capacities of Animals"):]
    t = t[t.index("{|"):t.index("|}")]
    for chunk in re.split(r"\n\|-", t)[1:]:
        cells = [l[1:].strip() for l in chunk.strip().split("\n") if l.startswith("|") and not l.startswith(("|+", "|}"))]
        if len(cells) == 4 and cells[0] == name:
            full, half, quarter = (int(re.search(r"([\d,]+) lbs", c).group(1).replace(",", "")) for c in cells[1:])
            return {"full": full, "half": half, "quarter": quarter}, rev
    raise AssertionError(f"Table 49: no {name}")

# Familiars (Find Familiar (Wizard Spell) d20 table): table name -> (key, page, infobox entry name or None).
FAMILIAR_PAGE = "Find Familiar (Wizard Spell)"
FAMILIARS = {"Cat, black": ("cat-black", "Small Cat (MM)", "Domestic"), "Crow": ("crow", "Raven", "Ordinary"),
             "Hawk": ("hawk", "Hawk", "Large"), "Owl": ("owl", "Owl", "Common"),
             # Toad (owner's choice): no core stat block exists; Amphibian (Poisonous) (Dragon Magazine #237), Neotropical Toad.
             "Toad": ("toad", "Amphibian (Poisonous)", "Neotropical Toad"),
             "Weasel": ("weasel", "Weasel", "Wild")}
# The spell's figures, each with the text it must match on the page.
FAMILIAR_RULES = [("hp", {"dice": "1d3+1", "perLevel": 1}, r"Normal familiars have 2-4 hit points plus 1 hit point per caster level"),
                  ("ac", 7, r"an Armor Class of 7"),
                  ("surprise", 1, r"\+1 bonus to all surprise die rolls"),
                  ("separatedLoss", 1, r"If separated from the caster, the familiar loses 1 hit point each day"),
                  ("conLoss", 1, r"must successfully roll an immediate system shock check or die. Even if he survives this check, the wizard loses 1 point from his Constitution"),
                  ("range", "1 mile", r"mental commands at a distance of up to 1 mile"),
                  ("onceYear", True, r"can be attempted but once per year"),
                  ("castingTime", "2d12", r"castingTime = 2d12 hours"),
                  ("cost", "1,000 gp", r"adds 1,000 gp worth of incense and herbs"),
                  ("contact", {"saved": 0, "failed": 0.5},
                   r"When the familiar is in physical contact with its wizard, it gains the wizard's saving throws against special attacks\. "
                   r"If a special attack would normally cause damage, the familiar suffers no damage if the saving throw is successful and "
                   r"half damage if the saving throw is failed")]


def familiar_table(wiki):
    """d20 rows of the spell's table: [{min, max, name, senses}] (name "" = no familiar)."""
    t = wiki[wiki.index("{|", wiki.index("D20 Roll")-200):]
    t = t[:t.index("|}")]
    rows = []
    for chunk in re.split(r"\n\|-", t)[1:]:
        c = [x.strip() for x in chunk.strip().split("\n") if x.startswith("|")]
        c = [x.lstrip("|").strip() for x in c]
        if len(c) < 3:
            continue
        lo, _, hi = c[0].partition("-")
        rows.append({"min": int(lo), "max": int(hi or lo), "name": "" if c[1] in ("-", "—") else c[1], "senses": c[2]})
    assert rows[0]["min"] == 1 and rows[-1]["max"] == 20 and all(a["max"] + 1 == b["min"] for a, b in zip(rows, rows[1:])), rows
    return rows


# Skills & Powers animal companions (Animal Master, Table 42) and mounts (Rider, Table 43): table name -> (key, page,
# how, entry); how = "infobox" (entry name), "column" (column table), "rows" (one row per creature), "html" (Lizard (MM)'s
# HTML header), "existing" (actor identifiers already in the Mounts folder). Ambiguous names are owner's choices:
# dog = Wild Dog, snake = Poison (Normal), brush rat = Rat Common (note below), horse/pony, camel, mule and elephant =
# the Mounts actors, giant beetle = Rhinoceros, giant boar = Giant (Elothere), giant otter = Giant Mammal, giant ray =
# Manta, stag = Wild Stag, hawk = Large, falcon = Small (Falcon).
COMPANION_PAGE = "Animal Master - POSP (Character Kit)"
MOUNT_PAGE = "Rider - POSP (Character Kit)"
CREATURES = {
    "Badger": ("badger", "Badger", "infobox", "Common"), "Dog": ("dog-wild", "Wild Dog", "infobox", "Wild Dog"),
    "Wolf": ("wolf", "Wolf", "infobox", "Wolf"), "Snake": ("snake-poisonous", "Snake (MM)", "column", "Poison (Normal)"),
    "Brush rat": ("brush-rat", "Rat", "infobox", "Common"), "Owl": ("owl", "Owl", "infobox", "Common"),
    "Ferret": ("ferret", "Small Mammal", "rows", "Ferret"), "Raven": ("raven", "Raven", "infobox", "Ordinary"),
    "Otter": ("otter", "Small Mammal", "rows", "Otter"), "Pig": ("pig", "Small Mammal", "rows", "Pig, Domestic"),
    "Raccoon": ("raccoon", "Small Mammal", "rows", "Raccoon"), "Opossum": ("opossum", "Small Mammal", "rows", "Opossum"),
    "Fox": ("fox", "Small Mammal", "rows", "Fox"), "Skunk": ("skunk", "Skunk", "infobox", "Normal"),
    "Cat": ("cat", "Small Cat (MM)", "infobox", "Domestic"), "Falcon": ("falcon", "Hawk", "infobox", "Small (Falcon)"),
    "Monkey": ("monkey", "Small Mammal", "rows", "Monkey"), "Squirrel": ("squirrel", "Small Mammal", "rows", "Squirrel"),
    "Hawk": ("hawk", "Hawk", "infobox", "Large"), "Woodchuck": ("woodchuck", "Small Mammal", "rows", "Woodchuck"),
    "Horse/pony": ("", None, "existing", ["horse-riding", "pony"]), "Bull": ("bull", "Herd Mammal II", "rows", "Bull (wild ox)"),
    "Camel": ("", None, "existing", ["camel"]), "Buffalo": ("buffalo", "Herd Mammal", "column", "Buffalo"),
    "Mule": ("", None, "existing", ["mule"]), "Cave bear": ("bear-cave", "Bear", "column", "Cave"),
    "Stag": ("stag", "Stag", "infobox", "Wild Stag"), "Elephant": ("", None, "existing", ["elephant"]),
    "Griffon": ("griffon", "Griffon", "infobox", "Griffon"), "Huge raven": ("raven-huge", "Raven", "infobox", "Huge"),
    "Hippogriff": ("hippogriff", "Hippogriff", "infobox", "Hippogriff"), "Huge bat": ("bat-huge", "Bat", "column", "Huge"),
    "Giant owl": ("owl-giant", "Owl", "infobox", "Giant"), "Pegasus": ("pegasus", "Pegasus", "infobox", "Pegasus"),
    "Giant wasp": ("wasp-giant", "Insect (MM)", "rows", "Wasp, Giant"), "Giant eagle": ("eagle-giant", "Eagle", "infobox", "Giant"),
    "Giant beetle": ("beetle-rhinoceros", "Giant Beetle", "infobox", "Rhinoceros"), "Giant lizard": ("lizard-giant", "Lizard (MM)", "html", "Giant"),
    "Giant boar": ("boar-giant", "Boar", "infobox", "Giant (Elothere)"), "Giant weasel": ("weasel-giant", "Weasel", "infobox", "Giant"),
    "Giant frog": ("frog-giant", "Frog", "infobox", "Giant"), "Giant badger": ("badger-giant", "Badger", "infobox", "Giant"),
    "Giant goat": ("goat-giant", "Herd Mammal II", "rows", "Goat, giant"), "Giant skunk": ("skunk-giant", "Skunk", "infobox", "Giant"),
    "Hippocampus": ("hippocampus", "Hippocampus", "infobox", "Hippocampus"), "Giant crab": ("crab-giant", "Giant Crustacean", "infobox", "Giant Crab"),
    "Sea horse": ("sea-horse-giant", "Giant Sea Horse", "infobox", "Giant Sea Horse"), "Dolphin": ("dolphin", "Dolphin", "infobox", "Dolphin"),
    "Killer whale": ("whale-killer", "Whale", "column", "Killer '\'\'Whale'\'\' (Orca)"), "Sea lion": ("sea-lion", "Sea Lion", "infobox", "Sea Lion"),
    "Giant otter": ("otter-giant", "Giant Mammal", "rows", "Otter, giant"), "Giant ray": ("ray-manta", "Ray", "infobox", "Manta"),
}
CREATURE_NOTES = {"Brush rat": ("Rat", r"Pack rats are herbivores and will not attack humans\. They do not carry diseases",
                                "Brush rat: statistics of the common rat; brush rats are herbivores, do not attack humans and carry no disease (Rat).")}
# Rules of the two kits and the mount requirement of Cavalier and Noble: key -> (page, value, regex).
COMPANION_RULES = [
    ("companionSize", COMPANION_PAGE, "S", r"All animal companions should be size S \(small\)"),
    ("carelessLoss", COMPANION_PAGE, {"xpPercent": 10, "speciesBarred": True},
     r"Should an animal master lose his companion through carelessness or by capriciously placing the animal in danger, he loses "
     r"10% of his current experience point total, and he loses his affinity to that species"),
    ("naturalDeath", COMPANION_PAGE, "none", r"No penalties are assessed if the animal dies through natural causes"),
    ("mountBond", MOUNT_PAGE, ["health", "direction", "distance"],
     r"Each will know the general state of health of the other, the direction the other is in, and the distance by which they are separated"),
    ("mountDeath", MOUNT_PAGE, "2d6", r"when the rider's mount dies, the rider immediately suffers 2d6 points of damage"),
    ("negligence", MOUNT_PAGE, {"save": "sp", "hours": "2d6"},
     r"must attempt a saving throw vs\. spells\. Failure means the rider operates as if he were under a feeblemind spell for the next 2d6 hours"),
    ("fled", MOUNT_PAGE, "rapportLost", r"the rider can never again experience an empathic rapport with a animal"),
    ("mountGroups", MOUNT_PAGE, [{"min": 1, "max": 3, "group": "natural"}, {"min": 4, "max": 4, "group": "flying"},
                                 {"min": 5, "max": 5, "group": "land"}, {"min": 6, "max": 6, "group": "underwater"}],
     r"Roll 1d6\. A result of 1.3 indicates the player should roll on the natural creatures table; 4, flying creatures; 5, giant land creatures, and; 6, underwater creatures"),
    ("mountRace", MOUNT_PAGE, True, r"the character's race \(halflings would have a difficult time riding elephants, while half-ogres would be too big for a pony\)"),
    ("companionRace", COMPANION_PAGE, True,
     r"the character's race \(dwarves and gnomes might attract burrowing or underground creatures, while elves would attract forest creatures\)"),
    # Owner's ruling: a warning when the creature's good/evil axis opposes the master's (neutral creatures fit everyone).
    ("companionAlignment", COMPANION_PAGE, "goodEvil", r"companions are attracted only to animal masters of like demeanor"),
    ("cavalier", "Cavalier - POSP (Character Kit)", "cavalier-posp", r"a cavalier must purchase a mount as soon as he can afford one"),
    ("noble", "Noble - POSP (Character Kit)", "noble-posp", r"he must purchase a mount and tack"),
]
# Homeland subtables for the Rider's mount (owner's choice; the kit asks for "the climate and terrain of the character's
# homeland" and "the availability of the mount"): Table 43 entries only, one picked at random with equal chance; "any" =
# Table 43 as printed.
MOUNT_HOMELANDS = {
    "settled": ["Horse/pony", "Mule", "Bull", "Camel", "Buffalo", "Stag"],
    "desert": ["Camel", "Horse/pony", "Mule", "Giant lizard"],
    "jungle": ["Elephant", "Buffalo", "Giant lizard", "Giant beetle", "Giant frog"],
    "forest": ["Stag", "Giant badger", "Giant skunk", "Giant weasel", "Giant owl", "Pegasus"],
    "mountains": ["Mule", "Giant goat", "Griffon", "Giant eagle", "Hippogriff", "Cave bear"],
    "underground": ["Giant lizard", "Giant weasel", "Huge bat", "Giant beetle", "Cave bear"],
    "coast": ["Sea horse", "Dolphin", "Sea lion", "Hippocampus", "Giant crab", "Giant otter", "Giant ray", "Killer whale"],
}
# Fit to the character's race (owner's lists; warnings only). The kits name the factor: Rider "the character's race
# (halflings would have a difficult time riding elephants, while half-ogres would be too big for a pony)"; Animal Master
# "dwarves and gnomes might attract burrowing or underground creatures, while elves would attract forest creatures".
# Table 43 / Table 42 names; races without an entry have no limits.
MOUNT_RACE_FIT = {
    "tooBig": {race: ["Elephant", "Cave bear", "Giant lizard", "Huge bat", "Hippocampus", "Killer whale", "Giant ray"]
               for race in ("gnome", "halfling")},
    "tooSmall": {race: ["Huge raven", "Giant badger", "Giant frog", "Giant skunk"] for race in ("human", "half-elf", "elf", "dwarf")},
}
COMPANION_RACES = {
    "dwarf": ["Badger", "Woodchuck", "Brush rat", "Ferret", "Snake", "Skunk"],
    "gnome": ["Badger", "Woodchuck", "Brush rat", "Ferret", "Snake", "Skunk"],
    "elf": ["Owl", "Fox", "Squirrel", "Raccoon", "Hawk", "Falcon", "Wolf", "Badger", "Raven", "Skunk", "Opossum"],
}
MOUNT_GROUPS = {"Natural Creatures": "natural", "Flying Creatures": "flying", "Giant Land Creatures": "land", "Underwater Creatures": "underwater"}
ROW_COLUMNS = {"#AP": "numberAppearing", "#App.": "numberAppearing", "AC": "ac", "MV": "movement", "Mv": "movement", "HD": "hitDice",
               "THAC0": "thac0", "# AT": "attacks", "#AT": "attacks", "#Att": "attacks", "Dmg/AT": "damage", "Dmg/Att": "damage",
               "Dmg": "damage", "Morale": "morale", "ML": "morale", "XP Value": "xp", "XP": "xp", "SA": "specialAttacks"}


def unlink(v):
    return re.sub(r"\[\[(?:[^\]|]*\|)?([^\]]*)\]\]", r"\1", v)


def page_defaults(wiki):
    """Unnumbered {{Creature}} fields of a page (shared by its table rows): INFOBOX keys -> values."""
    i = wiki.index("{{Creature")
    box = wiki[i:wiki.index("}}\n", i)]
    pairs = dict(re.findall(r"\|\s*([a-z]+)\s*=\s*([^|\n}]*)", box))
    return {key: monsters.clean(pairs[src]) for src, key in monsters.INFOBOX.items() if pairs.get(src, "").strip()}


def rows_block(title, name):
    """Stat block from a table with one row per creature (Small Mammal, Insect (MM), Herd Mammal II, Giant Mammal)."""
    wiki, rev, _ = classdata.page(title)
    defaults = page_defaults(wiki)
    for t in re.findall(r"\{\|.*?\n\|\}", wiki, re.S):
        chunks = re.split(r"\n\|-", t)
        head = [monsters.clean(h) for h in re.findall(r"^![ \t]*(.*)$", chunks[0], re.M)]
        for chunk in chunks[1:]:
            cells = [monsters.clean(l[1:]) for l in chunk.strip().split("\n") if l.startswith("|") and not l.startswith(("|}", "|+"))]
            if cells and unlink(cells[0]) == name:
                block = dict(defaults)
                block.update({ROW_COLUMNS[h]: v for h, v in zip(head, cells) if h in ROW_COLUMNS and v})
                return block, rev
    raise AssertionError(f"{title}: no row {name}")


def html_column_block(title, column):
    """Stat block from a column table whose header is HTML (<th class="cn">Name ..., Lizard (MM))."""
    wiki, rev, _ = classdata.page(title)
    t = wiki[wiki.index("{|"):wiki.index("|}")]
    chunks = re.split(r"\n\|-", t)
    head = re.findall(r'<th class="cn">([^<]+)', chunks[0])
    idx = head.index(column)
    block = {}
    for chunk in chunks:
        label = re.search(r"^!\s*([^<\n]+?):?\s*$", chunk, re.M)
        cells = [monsters.clean(l[1:]) for l in chunk.split("\n") if l.startswith("|") and not l.startswith(("|}", "|-"))]
        if label and monsters.clean(label.group(1)).rstrip(":").lower() in monsters.LABELS and len(cells) == len(head):
            block[monsters.LABELS[monsters.clean(label.group(1)).rstrip(":").lower()]] = cells[idx]
    return block, rev


def creature_template(wiki):
    """{{Creature ...}} fields, split at top-level "|" (some pages put several fields on one line)."""
    i = wiki.index("{{Creature") + 2
    depth, j, parts, start = 1, i, [], i
    while depth:
        if wiki.startswith("{{", j):
            depth, j = depth + 1, j + 2
            continue
        if wiki.startswith("}}", j):
            depth -= 1
            if not depth:
                parts.append(wiki[start:j])
            j += 2
            continue
        if wiki[j] == "|" and depth == 1:
            parts.append(wiki[start:j])
            start = j + 1
        j += 1
    return {k.strip(): v.strip() for k, _, v in (p.partition("=") for p in parts[1:]) if _}


def infobox_entry(page, entry):
    """Stat block of one creature of a {{Creature}} infobox (numbered fields name1, armorclass1, ...; unnumbered for one)."""
    wiki, rev, _ = classdata.page(page)
    box = creature_template(wiki)
    found = [k[4:] for k, v in box.items() if re.fullmatch(r"name\d*", k) and monsters.clean(v) == entry]
    assert found, f"{page}: no infobox entry {entry}"
    n = next((x for x in found if x), found[0])
    return {key: monsters.clean(box.get(f"{src}{n}", "")) for src, key in monsters.INFOBOX.items()}, rev


def creature_block(page, how, entry):
    if how == "infobox":
        return infobox_entry(page, entry)
    if how == "column":
        block, rev = monsters.column_block(page, entry)
        if not block.get("xp"):
            # Snake (MM): "XP Value:{{br}}Elder{{br}}Jaculi" (normal, elder, jaculi values): the first is the normal snake's.
            wiki, _, _ = classdata.page(page)
            t = next(t for t in re.findall(r"\{\|.*?\n\|\}", wiki, re.S) if entry in t)
            head = [monsters.clean(c) for c in re.split(r"\n!", re.split(r"\n\|-", t)[0])[1:]]
            row = next(c for c in re.split(r"\n\|-", t) if re.match(r"\s*!\s*XP Value", c.strip()))
            cells = [l.strip()[1:] for l in row.strip().split("\n")[1:] if l.strip().startswith("|")]
            block["xp"] = monsters.clean(cells[head.index(entry) - 1]).split(";")[0]
        return block, rev
    if how == "rows":
        return rows_block(page, entry)
    return html_column_block(page, entry)


def creature_attacks(block):
    """Attacks from the damage text: "1-8/1-4" -> two attacks; a bare "1" is one point of damage. Alternatives ("A or B",
    "A, B, or C" by size) use the first; no more attacks than the number of attacks when that is a number."""
    text = re.sub(r"\(.*?\)", "", block.get("damage", ""))
    text = re.split(r",| or ", text)[0]
    parts = [re.sub(r"\s*-\s*", "-", p.strip()) for p in text.split("/")]
    out = []
    for p in parts:
        if re.fullmatch(r"\d+-\d+", p):
            out.append(monsters.damage_formula(p))
        elif re.fullmatch(r"\d+(d\d+)?([+-]\d+)?", p):
            out.append(p)
    n = re.fullmatch(r"\d+", block.get("attacks", "").strip())
    if n:
        out = out[:int(n.group())]
    return [{"name": f"Attack {i + 1}" if len(out) > 1 else "Attack", "damage": f, "bonus": 0} for i, f in enumerate(out)]


def first_variant_xp(text):
    """XP of the first (smallest) variant: "2 HD: 35; 3 HD: 65" -> "35"; "420 (4 HD)650 (5 HD)" -> "420"."""
    after = text.split(":", 1)[1] if "HD:" in text else text
    return str(monsters.first_int(after))


def kit_tables(revs):
    """Table 42 (d20 companions) and Table 43 (d8 mounts by group) from the kit pages."""
    cw, revs[COMPANION_PAGE], _ = classdata.page(COMPANION_PAGE)
    t = cw[cw.index("Table 42: Animal Companions"):]
    t = t[:t.index("|}")]
    companions = []
    for chunk in re.split(r"\n\|-", t)[1:]:
        c = [l[1:].strip() for l in chunk.strip().split("\n") if l.startswith("|") and not l.startswith("|}")]
        if len(c) == 4 and c[0].isdigit():
            companions += [{"roll": int(c[0]), "name": c[1]}, {"roll": int(c[2]), "name": c[3]}]
    companions.sort(key=lambda r: r["roll"])
    assert [r["roll"] for r in companions] == list(range(1, 21)), companions
    mw, revs[MOUNT_PAGE], _ = classdata.page(MOUNT_PAGE)
    t = mw[mw.index("Table 43: Mounts"):]
    t = t[:t.index("|}")]
    groups, current = {}, None
    for chunk in re.split(r"\n\|-", t):
        heads = re.findall(r"!\s*colspan\s*=\s*2\s*\|\s*([A-Za-z ]+?)\s*$", chunk, re.M)
        if heads:
            current = [MOUNT_GROUPS[h] for h in heads]
            for g in current:
                groups[g] = []
            continue
        c = [l[1:].strip() for l in chunk.strip().split("\n") if l.startswith("|") and not l.startswith(("|}", "|+"))]
        if current and len(c) == 4 and c[0].isdigit():
            groups[current[0]].append({"roll": int(c[0]), "name": c[1]})
            groups[current[1]].append({"roll": int(c[2]), "name": c[3]})
    assert set(groups) == set(MOUNT_GROUPS.values()) and all([r["roll"] for r in g] == list(range(1, 9)) for g in groups.values()), groups
    names = {r["name"] for r in companions} | {r["name"] for g in groups.values() for r in g}
    assert names == set(CREATURES), sorted(names ^ set(CREATURES))
    return companions, groups


def table(wiki, caption):
    i = wiki.index(caption)
    return wiki[i:wiki.index("|}", i)]


def cells(t):
    out = []
    for chunk in re.split(r"\n\|-", t)[1:]:
        row = [monsters.clean(l.lstrip("|!")) for l in chunk.strip().split("\n") if l.startswith(("|", "!")) and not l.startswith(("|+", "|}"))]
        if row:
            out.append(row)
    return out


def damage_attacks(block):
    """Stat block damage '1-8/1-8' -> attack rows (named Attack 1, 2, ...)."""
    parts = re.findall(r"\d+-\d+", block.get("damage", ""))
    return [{"name": f"Attack {i + 1}" if len(parts) > 1 else "Attack", "damage": monsters.damage_formula(p), "bonus": 0}
            for i, p in enumerate(parts)]


def human(key, name, column, source_title, items, wage, note, revs):
    block, rev = monsters.column_block("Human (MM)", column)
    revs["Human (MM)"] = rev
    block.setdefault("movement", str(monsters.movement.build_base_move()[0]["human"]))
    block.setdefault("size", "M")
    doc = monsters.actor(f"hire.{key}", name, "hireling", block, "Human (MM)", HUMAN, [], items=items)
    doc["system"]["ac"]["base"] = 10  # armour items set the AC; the block's range ("8 to 4") stays as text
    doc["system"]["identifier"] = key
    doc["system"]["cost"] = wage
    doc["system"]["url"] = classdata.url(source_title)
    doc["system"]["notes"] = (f"<p>{note}</p>" if note else "") + f"<p>Statistics: Human (MM), {column} column.</p>"
    return doc


def actor_folder(key, name, sort):
    f = classdata.folder_doc(f"hirelings.{key}", name, sort=sort)
    f["type"] = "Actor"
    return f


if __name__ == "__main__":
    revs = {}
    sw, revs["Soldiers (DMG)"], _ = classdata.page("Soldiers (DMG)")
    t64 = cells(table(sw, "Table 64: Military Occupations"))
    wages64 = {r[0]: r[1] for r in t64 if len(r) == 2 and r[0] != "Title"}
    assert len(wages64) == len(SOLDIERS) + len(SKIP_SOLDIERS), sorted(set(wages64) ^ (set(SOLDIERS) | set(SKIP_SOLDIERS)))
    desc = {m.group(1).strip(): m.group(2) for m in re.finditer(r"'''([^']+):'''(.*)", sw)}
    # Description headings use plurals ("Bowmen, mounted", "Crossbowmen, heavy", "Footmen, irregular", "Marines").
    singular = lambda s: s.replace("Bowmen", "Bowman").replace("Crossbowmen", "Crossbowman").replace("Footmen", "Footman").replace("Marines", "Marine")
    desc = {singular(k): v for k, v in desc.items()}
    problems = [f"{t}: /{m}/" for t, (_, m, _) in SOLDIERS.items() if not re.search(m, desc.get(t, ""))]

    ew, revs["Employing Hirelings (DMG)"], _ = classdata.page("Employing Hirelings (DMG)")
    t65 = {r[0]: (r[1], r[2]) for r in cells(table(ew, "Table 65: Common Wages")) if len(r) == 3 and r[0] != "Profession"}
    assert set(t65) == set(CIVILIANS), sorted(set(t65) ^ set(CIVILIANS))
    if problems:
        raise SystemExit("Soldier descriptions no longer match (update SOLDIERS):\n  " + "\n  ".join(problems))

    folders = [actor_folder("soldiers", "Soldiers (DMG Table 64)", 0), actor_folder("civilians", "Hirelings (DMG Table 65)", 1000),
               actor_folder("mounts", "Mounts (Monstrous Manual)", 2000), actor_folder("familiars", "Familiars (Find Familiar)", 3000),
               actor_folder("companions", "Animal Companions & Mounts (POSP)", 4000)]
    fid = {k: f["_id"] for k, f in zip(("soldiers", "civilians", "mounts", "familiars", "companions"), folders)}
    docs = []
    for title, (items, _, note) in SOLDIERS.items():
        key = classdata.slug(title)
        d = human(key, title, "Soldier", "Soldiers (DMG)", items, f"{wages64[title]} per month", note, revs)
        d["folder"] = fid["soldiers"]
        docs.append(d)
    for prof, column in CIVILIANS.items():
        weekly, monthly = t65[prof]
        d = human(classdata.slug(prof), prof, column, "Employing Hirelings (DMG)", [], f"{weekly} per week, {monthly} per month", "", revs)
        d["folder"] = fid["civilians"]
        docs.append(d)
    for key, name, page, column, animal, tack in MOUNTS + PACK:
        block, revs[page] = monsters.column_block(page, column) if column else monsters.infobox_block(page, page)
        src = monsters.load_source("equipment", animal)["system"]
        assert src["load"]["full"] is not None or key == "pony", f"{animal}: no Table 49 load"
        role = "pack" if (key in PACK_ROLE or any(key == p[0] for p in PACK)) else "mount"
        d = monsters.actor(f"hire.{key}", name, role, block, page, ANIMAL, damage_attacks(block), items=tack, load=dict(src["load"]))
        d["system"]["identifier"] = key
        d["system"]["damageText"] = re.sub(r"/;\s*", "/", d["system"]["damageText"])  # a line break inside "2-16/2-16/{{br}}2-12"
        d["system"]["cost"] = src.get("cost") or ""
        d["system"]["notes"] = (f"<p>Statistics: {page}, {column.replace(chr(39) * 3, '')} column. " if column else f"<p>Statistics: {page}. ") \
            + f"Load and price: PHB {animal}.</p>"
        d["folder"] = fid["mounts"]
        docs.append(d)
    # Yak (pack animal).
    ywiki, revs[YAK["page"]], _ = classdata.page(YAK["page"])
    assert re.search(YAK["category"], ywiki), "Yak: the Bull row no longer covers yaks"
    assert re.search(YAK["size"][0], ywiki), "Yak: size/intelligence text changed"
    block, _ = article_row_block(YAK["page"], YAK["row"])
    assert block["hitDice"] == "4" and block["damage"] == "1d6/1d6", block
    block.update(YAK["size"][1])
    rule_page, rule_pattern, rule_note = YAK["rule"]
    rwiki, revs[rule_page], _ = classdata.page(rule_page)
    assert re.search(rule_pattern, rwiki), f"{rule_page}: yak rule changed"
    load, revs["Encumbrance Tables (PHB)"] = table49_load("Yak")
    yak_attacks = [{"name": f"Attack {i + 1}", "damage": f, "bonus": 0} for i, f in enumerate(re.findall(r"\d+d\d+", block["damage"]))]
    d = monsters.actor("hire.yak", "Yak", "pack", block, YAK["page"], ANIMAL, yak_attacks, load=load)
    d["system"]["identifier"] = "yak"
    d["system"]["cost"] = ""
    d["system"]["notes"] = (f"<p>{rule_note}</p><p>Statistics: {YAK['page']}, {YAK['row']} row (the category includes yaks). "
                            "Load: PHB Table 49; no price in PHB Table 44.</p>")
    d["folder"] = fid["mounts"]
    docs.append(d)
    # Familiars: the spell's table and figures, and one actor per creature.
    fw, revs[FAMILIAR_PAGE], _ = classdata.page(FAMILIAR_PAGE)
    rules = {}
    for key, value, pattern in FAMILIAR_RULES:
        assert re.search(pattern, fw), f"{FAMILIAR_PAGE}: {pattern!r} not found"
        rules[key] = value
    frows = familiar_table(fw)
    assert {r["name"] for r in frows if r["name"]} == set(FAMILIARS), frows
    for r in frows:
        r["key"] = FAMILIARS[r["name"]][0] if r["name"] else ""
    for name, (key, page, entry) in FAMILIARS.items():
        if page:
            block, revs[page] = monsters.infobox_block(page, entry)
            source = page
        else:
            # No stat block: only the spell's figures; morale 10 is the actor default, movement and Hit Dice blank.
            block = {"ac": "7", "movement": "0", "hitDice": "", "morale": "10", "xp": "0"}
            source = FAMILIAR_PAGE
        block["ac"] = str(rules["ac"])  # "an Armor Class of 7 (due to size, speed, etc.)"
        senses = next(r["senses"] for r in frows if r["name"] == name)
        d = monsters.actor(f"hire.familiar-{key}", name, "familiar", block, source, ANIMAL, damage_attacks(block) if page else [])
        d["system"]["identifier"] = f"familiar-{key}"
        if not page:
            d["system"]["movement"]["text"] = ""
            d["system"]["morale"]["text"] = ""
        d["system"]["hp"] = {"value": 3, "max": 3}
        d["system"]["notes"] = (f"<p>Familiar (Find Familiar (Wizard Spell)): {senses}. Hit points 2-4 + 1 per caster level, AC 7. "
                                + (f"Other statistics: {page}, {entry}.</p>" if page else
                                   "No Monstrous Manual stat block for a normal toad: movement, Hit Dice and attacks are left to the DM.</p>"))
        d["folder"] = fid["familiars"]
        docs.append(d)
    # Skills & Powers animal companions (Table 42) and mounts (Table 43): one actor per creature (existing mounts reused).
    companions, mount_groups = kit_tables(revs)
    comp_rules = {}
    for key, page, value, pattern in COMPANION_RULES:
        w, revs[page], _ = classdata.page(page)
        assert re.search(pattern, w), f"{page}: {pattern!r} not found"
        comp_rules[key] = value
    existing = {d["system"]["identifier"] for d in docs}
    companion_names = {r["name"] for r in companions}
    actor_ids = {}
    for name, (key, page, how, entry) in CREATURES.items():
        if how == "existing":
            assert set(entry) <= existing, (name, entry)
            actor_ids[name] = list(entry)
            continue
        block, revs[page] = creature_block(page, how, entry)
        for field in ("ac", "movement", "hitDice", "morale", "xp"):
            assert block.get(field), f"{name}: {page} {entry} has no {field}: {block}"
        variant = ""
        if re.search(r"HD:|\(\d+ HD\)", block["xp"]):
            variant = f"Variable size: the actor uses the first variant's experience value ({block['xp']}); hit points and damage by the DM."
            block["xp"] = first_variant_xp(block["xp"])
        role = "pet" if name in companion_names else "mount"
        ident = f"{'companion' if role == 'pet' else 'mount'}-{key}"
        d = monsters.actor(f"hire.{ident}", name, role, block, page, ANIMAL, creature_attacks(block))
        d["system"]["identifier"] = ident
        d["system"]["cost"] = ""
        note = ""
        if name in CREATURE_NOTES:
            npage, pattern, text = CREATURE_NOTES[name]
            nw, _, _ = classdata.page(npage)
            assert re.search(pattern, nw), f"{npage}: {pattern!r} not found"
            note = f"<p>{text}</p>"
        if variant:
            note += f"<p>{variant}</p>"
        d["system"]["notes"] = note + (f"<p>{'Animal companion (Animal Master (POSP), Table 42)' if role == 'pet' else 'Mount (Rider (POSP), Table 43)'}. "
                                       f"Statistics: {page}, {entry.replace(chr(39) * 3, '')}.</p>")
        d["folder"] = fid["companions"]
        docs.append(d)
        actor_ids[name] = [ident]
    pack_id = {d["system"]["identifier"]: d["_id"] for d in docs}
    table43 = {r["name"] for g in mount_groups.values() for r in g}
    for land, names in MOUNT_HOMELANDS.items():
        assert set(names) <= table43, (land, set(names) - table43)
    homelands = {land: [{"name": n, "actors": [{"identifier": i, "id": pack_id[i]} for i in actor_ids[n]]} for n in names]
                 for land, names in MOUNT_HOMELANDS.items()}
    ids_of = lambda names: sorted({i for n in names for i in actor_ids[n]})
    for lists in MOUNT_RACE_FIT.values():
        for names in lists.values():
            assert set(names) <= table43, set(names) - table43
    for names in COMPANION_RACES.values():
        assert set(names) <= companion_names, set(names) - companion_names
    race_fit = {"mount": {k: {race: ids_of(n) for race, n in v.items()} for k, v in MOUNT_RACE_FIT.items()},
                "companion": {race: ids_of(n) for race, n in COMPANION_RACES.items()}}
    for r in companions + [r for g in mount_groups.values() for r in g]:
        r["actors"] = [{"identifier": i, "id": pack_id[i]} for i in actor_ids[r["name"]]]
    open("module/rules/companion-tables.mjs", "w").write("\n".join([
        "/**",
        " * GENERATED by tools/build-hireling-data.py - do not edit by hand.",
        f" * Animal Master (POSP) Table 42 and rules: {classdata.url(COMPANION_PAGE)} (revision {revs[COMPANION_PAGE]}).",
        f" * Rider (POSP) Table 43 and rules: {classdata.url(MOUNT_PAGE)} (revision {revs[MOUNT_PAGE]}).",
        " * Mount requirement: Cavalier (POSP), Noble (POSP). companions: d20 rows; mounts.groups: d6 -> group; mounts.<group>: d8",
        " * rows; homelands: owner's subtables of Table 43 entries (equal chance); actors: identifiers in the Hirelings & Mounts compendium.",
        " * raceFit: owner's lists (actor identifiers): mount { tooBig, tooSmall } and companion affinity by race id.",
        " */",
        "export const COMPANION_TABLES = " + json.dumps({"companions": companions, "mounts": mount_groups, "homelands": homelands, "raceFit": race_fit,
                                                          "rules": comp_rules}, ensure_ascii=False) + ";", ""]))

    open("module/rules/familiar-tables.mjs", "w").write("\n".join([
        "/**",
        " * GENERATED by tools/build-hireling-data.py - do not edit by hand.",
        f" * Find Familiar (Wizard Spell): {classdata.url(FAMILIAR_PAGE)} (revision {revs[FAMILIAR_PAGE]}).",
        " * rows: the d20 table (key \"\" = no familiar); rules: hit points, AC, surprise bonus, daily loss when apart,",
        " * Constitution loss on its death, command range, once per year, casting time, material cost.",
        " */",
        "export const FAMILIAR_TABLES = " + json.dumps({"rows": frows, "rules": rules}, ensure_ascii=False) + ";", ""]))

    for i, d in enumerate(docs):
        d["sort"] = i * 100
    classdata.write_docs("packs/_source/hirelings", folders + docs)
    print(f"wrote packs/_source/hirelings: {len(SOLDIERS)} soldiers, {len(CIVILIANS)} civilians, {len(MOUNTS)} mounts, {len(PACK)} pack animals, {len(FAMILIARS)} familiars, "
          f"{sum(1 for c in CREATURES.values() if c[2] != 'existing')} companions and mounts; "
          f"skipped {SKIP_SOLDIERS}; revisions {revs}")
