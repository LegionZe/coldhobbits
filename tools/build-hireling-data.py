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
Human stat blocks give no attacks: hirelings attack with their weapon items. Armoured hirelings: equipped armour sets
their AC (base 10). Run from the repo root after build-monster-data.py:  python3 tools/build-hireling-data.py
"""
import importlib.util
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
               actor_folder("mounts", "Mounts (Monstrous Manual)", 2000)]
    fid = {k: f["_id"] for k, f in zip(("soldiers", "civilians", "mounts"), folders)}
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
    for key, name, page, column, animal, tack in MOUNTS:
        block, revs[page] = monsters.column_block(page, column)
        src = monsters.load_source("equipment", animal)["system"]
        d = monsters.actor(f"hire.{key}", name, "mount", block, page, ANIMAL, damage_attacks(block), items=tack, load=dict(src["load"]))
        d["system"]["identifier"] = key
        d["system"]["damageText"] = re.sub(r"/;\s*", "/", d["system"]["damageText"])  # a line break inside "2-16/2-16/{{br}}2-12"
        d["system"]["cost"] = src.get("cost") or ""
        d["system"]["notes"] = f"<p>Statistics: {page}, {column.replace(chr(39) * 3, '')} column. Load and price: PHB {animal}.</p>"
        d["folder"] = fid["mounts"]
        docs.append(d)
    for i, d in enumerate(docs):
        d["sort"] = i * 100
    classdata.write_docs("packs/_source/hirelings", folders + docs)
    print(f"wrote packs/_source/hirelings: {len(SOLDIERS)} soldiers, {len(CIVILIANS)} civilians, {len(MOUNTS)} mounts; "
          f"skipped {SKIP_SOLDIERS}; revisions {revs}")
