#!/usr/bin/env python3
"""Generate proficiency data: compendium items, slot rules, and kit bonus/required proficiencies.

Sources (AD&D 2e fandom wiki, MediaWiki API):
  * Table 34 Proficiency Slots (page "Proficiencies (PHB)"): initial weapon/nonweapon slots, levels per
    new slot ("A new proficiency slot is gained at every experience level that is evenly divisible by the
    number listed"), non-proficiency penalty.
  * Table 37 Nonweapon Proficiency Groups and Table 38 Group Crossovers ("Nonweapon Proficiencies Tables
    (PHB)"). Cross-group cost: "When a player selects a proficiency from any other category, it requires
    one additional proficiency slot beyond the number listed." ("Nonweapon Proficiencies II (PHB)").
  * Every page in Category:Proficiencies ({{Infobox Proficiency}}: Groups, Ability, Modifier, Slots and the
    Skills & Powers fields); PHB entries use Table 37 values.
  * Weapon List (PHB): "Each weapon listed in Table 44 (Weapons) requires its own proficiency"
    ("Weapon Proficiencies (PHB)"); ammunition and heading rows are not proficiencies.
    Each weapon proficiency carries `system.weapon`: size, type, speed, damage (ammunition rows are added to
    their launchers, the One-/Two-handed rows to the bastard sword), Table 45 rate of fire and ranges
    ("Combat Tables (PHB)"), bow/crossbow family and the Table 35 column for missile use.
  * The same data, with cost and weight, as weapon Items (packs/_source/weapons), linked to the weapon
    proficiency by identifier (`system.proficiency`); ammunition rows as ammunition Items with the
    identifiers of the launchers they fit (`system.launchers`) and the bundle size from the cost ("3 sp/12").
  * Kit pages (Nonweapon Proficiencies "Bonus"/"Required" lines) -> written into packs/_source/kits.
Run after build-class-data.py (it adds fields to the kit sources):  python3 tools/build-proficiency-data.py
"""
import glob, json, os, re, urllib.parse, urllib.request
import importlib.util

_spec = importlib.util.spec_from_file_location("classdata", "tools/build-class-data.py")
classdata = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(classdata)

API = classdata.API
UA = classdata.UA
ABIL = {"strength": "str", "dexterity": "dex", "constitution": "con", "intelligence": "int",
        "wisdom": "wis", "charisma": "cha"}
GROUPS = ["general", "priest", "rogue", "warrior", "wizard"]
TABLE34_ROWS = {"Fighter": "warrior", "Wizard": "wizard", "Cleric": "priest", "Thief": "rogue"}
SPECIALISTS = ["abjurer", "conjurer", "diviner", "enchanter", "illusionist", "invoker", "necromancer", "transmuter"]


def api(**p):
    return classdata.api(**p)  # retries on HTTP 429


def slug(s):
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")


def unlink(s):
    return re.sub(r"\[\[(?:[^\]|]*\|)?([^\]]*)\]\]", r"\1", s)


# --- Tables 34 / 37 / 38 -----------------------------------------------------------------------
def build_tables():
    wiki, rev34, _ = classdata.page("Proficiencies (PHB)")
    t = wiki[wiki.index("Table 34: Proficiency Slots"):]
    t = t[:t.index("|}")]
    slots = {}
    for row in re.findall(r"\|\s*(Cleric|Thief|Fighter|Wizard)\s*\|\|([^\n]+)", t):
        cells = [c.strip() for c in row[1].split("||")]
        slots[TABLE34_ROWS[row[0]]] = {"weaponInitial": int(cells[0]), "weaponRate": int(cells[1]),
                                       "penalty": int(cells[2]), "nonweaponInitial": int(cells[3]),
                                       "nonweaponRate": int(cells[4])}
    assert len(slots) == 4, slots

    wiki37, rev37, _ = classdata.page("Nonweapon Proficiencies Tables (PHB)")
    phb = {}
    t37 = wiki37[wiki37.index("Table 37"):wiki37.index("Table 38")]
    for block in re.split(r"\{\|", t37)[1:]:
        cap = re.search(r"\|\+\s*([^\n]+)", block)
        group = cap.group(1).strip().lower() if cap else None
        for name, n, ab, mod in re.findall(r"\|\s*\[\[[^\]|]*\|([^\]]+)\]\]\s*\|\|\s*(\d+)\s*\|\|\s*(\w+)\s*\|\|\s*([+-]?\d+)", block):
            e = phb.setdefault(name.strip(), {"slots": int(n), "ability": ABIL[ab.lower()], "modifier": int(mod), "groups": []})
            if group in GROUPS and group not in e["groups"]:
                e["groups"].append(group)
    t38 = wiki37[wiki37.index("Table 38"):]
    t38 = t38[:t38.index("|}")]
    crossover = {}
    for cls, groups in re.findall(r"\|\s*(\w+)\s*\n\|\s*([^\n]+)", t38):
        crossover[cls.lower()] = [g.strip().lower() for g in groups.split(",")]
    for s in SPECIALISTS:  # Table 38 lists Mage and Illusionist; other schools follow the same row
        crossover.setdefault(s, crossover["mage"])
    return slots, phb, crossover, {"table34": rev34, "table37_38": rev37}


# --- Proficiency pages ------------------------------------------------------------------------
def first(v):
    return re.split(r"\{\{br\}\}", v)[0].strip()


def norm_ability(v):
    v = first(unlink(v)).lower()
    for key, code in [("int", "int"), ("wis", "wis"), ("dex", "dex"), ("dez", "dex"), ("cha", "cha"),
                      ("str", "str"), ("con", "con")]:
        if v.startswith(key):
            return code
    return None  # N/A, Special, Varies, Unknown


def norm_int(v):
    m = re.match(r"\s*([+-]?\d+)", first(unlink(v)))
    return int(m.group(1)) if m else None


def norm_groups(v):
    v = first(unlink(v)).lower()
    return [g for g in GROUPS if g in v]


SOURCE_LABEL = {"Player's_Handbook_Proficiencies": "Player's Handbook"}


def build_nonweapon(phb):
    titles = [m["title"] for m in api(action="query", list="categorymembers", cmtitle="Category:Proficiencies",
                                      cmlimit=500)["query"]["categorymembers"] if m["ns"] == 0]
    docs, names = [], {}
    for i in range(0, len(titles), 50):
        r = api(action="query", prop="revisions|categories", rvprop="content|ids", rvslots="main", cllimit=500,
                titles="|".join(titles[i:i + 50]))
        for p in r["query"]["pages"].values():
            wiki = p["revisions"][0]["slots"]["main"]["*"]
            info = dict(re.findall(r"\|\s*(\w+)\s*=\s*([^\n]*)", re.search(r"\{\{Infobox Proficiency(.*?)\n\}\}", wiki, re.S).group(1)))
            name = p["title"].replace(" (Proficiency)", "")
            cats = [c["title"].replace("Category:", "").replace(" ", "_") for c in p.get("categories", [])]
            books = [c for c in cats if c.endswith("_Proficiencies")]
            source = ("Player's Handbook" if "Player's_Handbook_Proficiencies" in books
                      else (books[0].replace("_Proficiencies", "").replace("_", " ") if books else "Other"))
            if name in phb:
                e = phb[name]
                sys = {"slots": e["slots"], "ability": e["ability"], "modifier": e["modifier"], "groups": e["groups"]}
            else:
                sys = {"slots": norm_int(info.get("Slots", "")) or 1, "ability": norm_ability(info.get("Ability", "")),
                       "modifier": norm_int(info.get("Modifier", "")), "groups": norm_groups(info.get("Groups", ""))}
            sp = {"ability": first(unlink(info.get("Ability_SP", ""))), "rating": norm_int(info.get("Rating_SP", "")),
                  "cost": norm_int(info.get("Cost_SP", ""))}
            key = slug(name)
            docs.append({"key": key, "name": name, "source": source, "revid": p["revisions"][0]["revid"],
                         "system": {"identifier": key, "kind": "nonweapon", **sys, "sp": sp,
                                    "source": source, "url": classdata.url(p["title"]), "notes": ""}})
            names[name] = key
    missing = set(phb) - set(names)
    assert not missing, f"Table 37 proficiencies without a page: {missing}"
    return docs, names


# --- Weapon proficiencies -----------------------------------------------------------------------
AMMO = re.compile(r"arrow|quarrel|bullet|stone|barbed dart|needle", re.I)

# Table 45 (Missile Weapon Ranges) names -> Weapon List names.
T45_NAMES = {"Comp. long bow": "Composite long bow", "Comp. short bow": "Composite short bow", "Longbow": "Long bow",
             "Short bow": "Short bow", "Hand crossbow": "Hand crossbow", "Heavy crossbow": "Heavy crossbow",
             "Light crossbow": "Light crossbow", "Dagger": "Dagger or dirk", "Hammer": "Warhammer",
             "Hand axe": "Hand or throwing axe", "Sling": "Sling", "Staff sling": "Staff sling"}
# Weapons used only as missiles (no melee use); every other Table 45 weapon is a thrown melee weapon.
MISSILE_ONLY = {"Arquebus", "Blowgun", "Composite long bow", "Composite short bow", "Long bow", "Short bow",
                "Hand crossbow", "Heavy crossbow", "Light crossbow", "Dart", "Sling", "Staff sling"}
BOWS = {"Composite long bow", "Composite short bow", "Long bow", "Short bow"}
CROSSBOWS = {"Hand crossbow", "Heavy crossbow", "Light crossbow"}
# Table 35 column used for a weapon's missile attacks ("Other (Non-bow) Missiles" unless named).
T35_MISSILE = {"Light crossbow": "lightCrossbow", "Heavy crossbow": "heavyCrossbow", "Dagger or dirk": "thrownDagger",
               "Dart": "thrownDart"}
# Weapon List (PHB) gives no damage ("—") for these; footnote 2: "This weapon can dismount a rider on a successful hit."
NO_DAMAGE = {"Mancatcher"}


def strength_use(name, missile):
    """How Strength applies when the weapon is used as a missile ("The Attack Roll (PHB)" rev 158151:
    "This modifier is always applied to melees and attacks with hurled missile weapons (a spear or an axe)."
    / "Characters with Strength penalties always suffer them when using a bow weapon." / "Characters never
    have Strength modifiers when using crossbows"; "Strength (PHB)" rev 177331: "The damage adjustment also
    applies to missile weapons"). full = hit and damage; damage = damage only; penalty = penalties only
    (bows; a special bow for a positive bonus is not modelled); none."""
    if not missile:
        return "full"
    if name in BOWS:
        return "penalty"
    if name in CROSSBOWS or name in ("Arquebus", "Blowgun"):
        return "none"  # crossbows per the PHB; the arquebus and blowgun are not hurled (interpretation)
    if name in ("Sling", "Staff sling"):
        return "damage"
    return "full"  # hurled: thrown melee weapons and darts


def build_ranges():
    """Table 45 (Combat Tables (PHB)): rate of fire and S/M/L range in yards, per weapon."""
    wiki, rev, _ = classdata.page("Combat Tables (PHB)")
    t = wiki[wiki.index("Table 45: Missile Weapon Ranges"):]
    t = t[:t.index("|}")]
    t = re.sub(r"\{\{frac\|(\d+)\|(\d+)\}\}", r"\1/\2", t)          # before splitting on "|"
    t = re.sub(r"\n<nowiki>\s*</nowiki>", " ", t)                       # names wrapped onto a 2nd line
    ranges = {}
    for r in re.split(r"\n\s*\|-", t)[1:]:
        cells = [l.strip()[1:].strip() for l in r.split("\n") if l.strip().startswith("|") and not l.strip().startswith("|+")]
        if len(cells) < 5:
            continue  # caption / header rows
        name = re.sub(r"\s+", " ", cells[0].split(",")[0]).strip()
        name = re.sub(r" (bullet|stone)$", "", name)
        weapon = T45_NAMES.get(name, name)
        # first listed ammunition per weapon (e.g. flight arrow, sling bullet) gives the range
        nw = lambda v: re.sub(r"</?nowiki>", "", v).strip()
        ranges.setdefault(weapon, {"rof": nw(cells[1]), "short": nw(cells[2]), "medium": nw(cells[3]), "long": nw(cells[4])})
    return ranges, rev


def weight(v):
    """Weight in pounds; "*" = "Ten of these weigh one pound" (Weapon List (PHB) footnote)."""
    v = v.strip()
    if v == "*":
        return 0.1
    m = re.fullmatch(r"\{\{frac\|(\d+)\|(\d+)\}\}", v)
    if m:
        return int(m.group(1)) / int(m.group(2))
    return float(v) if re.fullmatch(r"\d+(\.\d+)?", v) else None


def ammo_targets(ammo, launchers):
    """Which launchers an ammunition row belongs to (Weapon List (PHB) groups ammunition under its launcher)."""
    n = ammo.lower()
    if "arrow" in n:
        return [l for l in launchers if l in BOWS]
    if "quarrel" in n:
        return [l for l in launchers if l in CROSSBOWS and l.split()[0].lower() == n.split()[0]]
    if n in ("barbed dart", "needle"):
        return ["Blowgun"]
    if n.startswith("sling"):
        return ["Sling", "Staff sling"]
    return []


def build_weapons():
    ranges, _ = build_ranges()
    wiki, rev, _ = classdata.page("Weapon List (PHB)")
    t = wiki[wiki.index("{|"):wiki.index("|}")]
    dash = lambda v: None if v in ("—", "-", "", "*") else v
    rows = []
    for chunk in re.split(r"\n\|-", t)[1:]:
        cells = [l[1:].strip() for l in chunk.strip().split("\n") if l.startswith("|") and not l.startswith(("|}", "|+"))]
        if cells:
            rows.append([re.sub(r"<sup>.*?</sup>|\s+\d$", "", cells[0]).strip()] + cells[1:])
    weapons, order, items, ammo = {}, [], {}, []
    for name, cost, wt, size, typ, speed, sm, lg in rows:
        if AMMO.search(name) or name in ("One-handed", "Two-handed") or name in ("Bow", "Crossbow", "Lance", "Polearm", "Sword"):
            continue
        weapons[name] = {"size": dash(size), "type": dash(typ), "speed": int(speed) if speed.isdigit() else None,
                         "damage": [{"label": "", "sm": dash(sm), "l": dash(lg), "speed": None}] if dash(sm) else []}
        items[name] = {"cost": dash(cost) or "", "weight": weight(wt)}
        order.append(name)
    # Damage that lives on other rows: ammunition (launchers) and the bastard sword's grips.
    for i, (name, cost, wt, size, typ, speed, sm, lg) in enumerate(rows):
        if AMMO.search(name):
            bundle = re.search(r"/\s*(\d+)\s*$", cost or "")
            ammo.append({"key": slug(name), "name": name, "system": {
                "identifier": slug(name), "launchers": [slug(l) for l in ammo_targets(name, order)],
                "size": dash(size), "type": dash(typ), "damage": {"sm": dash(sm), "l": dash(lg)},
                "cost": dash(cost) or "", "weight": weight(wt), "quantity": int(bundle.group(1)) if bundle else 1,
                "bonus": {"hit": 0, "dmg": 0}, "source": "Player's Handbook", "url": classdata.url("Weapon List (PHB)"),
                "notes": ""}})
            for launcher in ammo_targets(name, order):
                weapons[launcher]["damage"].append({"label": name, "sm": dash(sm), "l": dash(lg), "speed": None})
                weapons[launcher]["type"] = weapons[launcher]["type"] or dash(typ)  # damage type is the ammunition's
        elif name in ("One-handed", "Two-handed"):
            # speed factor per grip (one-handed 6, two-handed 8); the weapon's speed is the first grip's
            weapons["Bastard sword"]["damage"].append({"label": name, "sm": dash(sm), "l": dash(lg), "speed": int(speed)})
            weapons["Bastard sword"]["speed"] = weapons["Bastard sword"]["speed"] or int(speed)
            weapons["Bastard sword"]["size"], weapons["Bastard sword"]["type"] = dash(size), dash(typ)
            items["Bastard sword"] = {"cost": dash(cost) or "", "weight": weight(wt)}
    docs, gear = [], []
    for name in order:
        w = weapons[name]
        assert w["damage"] or name in NO_DAMAGE, f"no damage found for {name}"
        rng = ranges.get(name)
        key = slug(name)
        weapon = {**w, "melee": name not in MISSILE_ONLY, "missile": rng is not None,
                  "range": rng or {"rof": "", "short": "", "medium": "", "long": ""},
                  "family": "bow" if name in BOWS else ("crossbow" if name in CROSSBOWS else "other"),
                  "missileColumn": T35_MISSILE.get(name, "otherMissile") if rng else "",
                  "strength": strength_use(name, rng is not None)}
        docs.append({"key": key, "name": name, "source": "Player's Handbook", "revid": rev,
                     "system": {"identifier": key, "kind": "weapon", "slots": 1, "ability": None, "modifier": None,
                                "groups": [], "sp": {"ability": "", "rating": None, "cost": None}, "weapon": weapon,
                                "source": "Player's Handbook", "url": classdata.url("Weapon List (PHB)"), "notes": ""}})
        # The weapon item: same weapon data, linked to its proficiency by identifier.
        gear.append({"key": key, "name": name, "system": {
            "identifier": key, "proficiency": key, "weapon": weapon, **items[name], "quantity": 1, "equipped": False,
            "bonus": {"hit": 0, "dmg": 0}, "source": "Player's Handbook", "url": classdata.url("Weapon List (PHB)"),
            "notes": ""}})
    for a in ammo:
        assert a["system"]["launchers"], f"no launcher for {a['name']}"
    return docs, gear, ammo


# --- Kit bonus / required proficiencies -----------------------------------------------------------
# Curated overrides where the kit text is not a plain list (quoted reason per kit).
KIT_OVERRIDES = {
    # "Bonus: Airborne Riding."
    "Skyrider (Character Kit)": {"bonus": ["Riding, Airborne"]},
    # "Bonus: None, but see Special Benefits."
    "Beastmaster - Ranger (Character Kit)": {"bonus": []},
    # "Bonus: Survival; the Explorer receives the benefits of this proficiency in all terrain types."
    "Explorer - Ranger (Character Kit)": {"bonus": ["Survival"]},
    # No bonus proficiencies (the parser matched "Bonus" elsewhere on the page); "Primary Terrain:
    # Required: Forest or Jungle" is a terrain, not a proficiency.
    "Greenwood Ranger (Character Kit)": {"bonus": [], "required": []},
    # "Bonus: Survival; in addition to having this proficiency in his primary terrain, ..."
    "Justifier (Character Kit)": {"bonus": ["Survival"]},
    # "Bonus: Herbalism, Spellcasting." - no "Spellcasting" proficiency page exists; kept as a note.
    "Witch (Character Kit)": {"bonus": ["Herbalism"], "note": "Bonus: Spellcasting (no proficiency page on the source wiki)"},
    # "Bonus: Etiquette, Artistic Ability (Painting, Calligraphy, or Origami)"
    "Wu Jen (Character Kit)": {"bonus": ["Etiquette", "Artistic Ability"]},
    # Special Benefits: "they gain 'gather intelligence' as a bonus nonweapon proficiency ... They also receive
    # 'appraising' as a bonus proficiency"
    "Fence (Character Kit)": {"bonus": ["Information Gathering", "Appraising"]},
    # Special Benefits: "the large number of bonus nonweapon proficiencies" = its Required list.
    "Beggar - Thief (Character Kit)": {"bonus": ["Begging", "Disguise", "Information Gathering", "Observation"], "required": []},
    # Al-Qadim (Arabian Adventures, Complete Sha'ir's Handbook):
    # "Bonus Proficiencies: Riding, horse specialization (alternately, camel specialization, but not both); survival (desert)."
    "Desert Rider (Character Kit)": {"bonus": [{"choice": ["Riding, Horse Specialization", "Riding, Camel Specialization"]}, "Survival"]},
    # "Bonus Proficiencies: None, unless provided for by another kit approved by the DM."
    "Outland Warrior (Character Kit)": {"bonus": []},
    # "Fire-building (flame), weather sense (wind), swimming (sea), or desert survival (sand). The mage's bonus
    # proficiency matches his or her specialty."
    "Elemental Mage (Character Kit)": {"bonus": [{"choice": ["Fire-building", "Weather Sense", "Swimming", "Survival"]}]},
    # "Survival (in same type as character's homeland); modern language, Midani (in addition to the character's native tongue)"
    "Mercenary Barbarian (Character Kit)": {"bonus": ["Survival", "Languages, Modern"],
                                            "note": "Bonus modern language: Midani (Zakharan Common), in addition to the native tongue."},
    # "Healing, herbalism; for bards also modern language and reading/writing."
    "Barber (Character Kit)": {"bonus": ["Healing", "Herbalism"],
                               "note": "Bards also gain Languages, Modern and Reading/Writing as bonus proficiencies."},
    # "Religion, plus one priest or general proficiency that reflects the action required to receive spells (player's choice)."
    "Mystic - Al-Qadim (Character Kit)": {"bonus": ["Religion"],
                                          "note": "Bonus: one priest or general proficiency for the action that brings spells (player's choice; none for solitude and meditation)."},
    # "Reading/writing, plus any one general proficiency (player's choice)."
    "Askar (Character Kit)": {"bonus": ["Reading/Writing"], "note": "Bonus: one general proficiency of the player's choice."},
    # "Choose one from among blind-fighting, awareness, or display weapons."
    "Spellslayer (Character Kit)": {"bonus": [{"choice": ["Blind-fighting", "Awareness", "Display Weapon Prowess"]}]},
    # "The clockwork mage receives the clockwork creation nonweapon proficiency"
    "Clockwork Mage (Character Kit)": {"bonus": ["Clockwork Creation"]},
}
# Extra proficiency slots granted by a kit.
KIT_SLOTS = {
    "Forest Runner (Character Kit)": {"weapon": 1},   # "receives a bonus weapon proficiency slot"
    "Bounty Hunter (Character Kit)": {"weapon": 1},   # "he is granted a bonus slot at 1st level"
    "Thug - Thief (Character Kit)": {"weapon": 1},    # "permitted an extra weapon proficiency slot at first level"
}


def kit_entries(wiki, label, names):
    """Parse the 'Bonus' or 'Required' nonweapon-proficiency line into names / {choice: [...]}."""
    def norm(s):
        return re.sub(r"[^a-z]", "", s.lower())
    index = {}
    for n in names:
        index[norm(n)] = n
        m = re.match(r"(.+), (.+)", n)
        if m:
            index[norm(f"{m.group(1)} ({m.group(2)})")] = n
            index[norm(m.group(2) + " " + m.group(1))] = n
    index.setdefault(norm("Veterinary Medicine"), "Veterinary Healing")
    index.setdefault(norm("Riding"), "Riding, Land-Based")

    head = re.search(r"Nonweapon Proficienc([^\n]*)((?:\n(?!'''(?:Equipment|Special|Wealth|Weapon|Armor|Role|Secondary|Description|Skill))[^\n]*){0,10})", wiki)
    if not head:
        return [], []
    text = head.group(1) + head.group(2)
    pattern = {"bonus": r"Bonus(?:es)?(?: Proficienc(?:y|ies))?", "required": r"Required"}[label]
    m = re.search(pattern + r"\s*:?\s*'*\s*:?\s*(.*?)(?=\n\*|\n\n|''(?:Recommended|Suggested|Required|Bonus)|Recommended:|Suggested:|$)", text, re.S)
    if not m:
        return [], []
    seg, links = m.group(1).strip(), []
    seg = re.sub(r"\[\[[^\]]*\]\]", lambda mm: (links.append(mm.group(0)), f"@@{len(links) - 1}@@")[1], seg)
    depth, cut = 0, len(seg)
    for i, ch in enumerate(seg):
        depth += ch == "("
        depth -= ch == ")"
        if ch == "." and depth <= 0:
            cut = i
            break
    seg = seg[:cut]
    one_of = re.search(r"one of the following\s*:?", seg)
    if one_of:
        seg = seg[one_of.end():].replace(",", " or ")
    seg = re.sub(r"@@(\d+)@@", lambda mm: links[int(mm.group(1))], seg)
    parts, buf, depth = [], "", 0
    for ch in seg:
        depth += ch in "(["
        depth -= ch in ")]"
        if ch in ",;" and depth <= 0:
            parts.append(buf)
            buf = ""
        else:
            buf += ch
    parts.append(buf)

    def resolve(tok):
        linked = re.findall(r"\[\[([^\]|]+)\(Proficiency\)", tok)
        if linked:
            return [l.strip() for l in linked]
        t = unlink(tok)
        t = re.sub(r"\((General|Warrior|Rogue|Priest|Wizard)[^)]*\)", "", t)
        t = re.sub(r"\((?:player choice|any|native tongue|for [^)]*|[^)]*slot[^)]*)\)", "", t, flags=re.I)
        t = t.replace("*", "").replace("''", "").strip(" .:;")
        if not t or t.lower() in ("none", "standard", "all"):
            return []
        for cand in (t, re.sub(r"\(.*?\)", "", t)):
            if norm(cand) in index:
                return [index[norm(cand)]]
        return ["?" + t]

    entries, unresolved = [], []
    for part in parts:
        if not part.strip():
            continue
        if re.search(r"''or''|\bor\b", part):
            opts = [x for o in re.split(r"''or''|\bor\b", part) for x in resolve(o)]
            if opts:
                entries.append({"choice": opts})
        else:
            entries.extend(resolve(part))
    for e in entries:
        for x in (e["choice"] if isinstance(e, dict) else [e]):
            if x.startswith("?"):
                unresolved.append(x)
    return entries, unresolved


BOLD = "'" * 3
WEAPON_PROF_NAMES = {}  # weapon proficiency name -> identifier (filled from build_weapons)


def kit_recommended(wiki, names, weapon_names=None):
    """Recommended / suggested proficiencies on a kit page: a list of proficiency identifiers.
    Nonweapon: the "Recommended"/"Suggested" bullets (and their "**" sub-bullets) of the Nonweapon Proficiencies
    section; linked proficiency pages resolve exactly, plain names through the same index as bonus/required entries.
    Weapon recommendations resolve only on an exact weapon proficiency name. Anything else ("Any", a name that is not
    a proficiency, "sword (any)") is left out, never guessed; the kit page (linked on the kit) has the full wording."""
    def norm(x):
        return re.sub(r"[^a-z]", "", x.lower())
    index = {}
    for n in names:
        index[norm(n)] = n
        m = re.match(r"(.+), (.+)", n)
        if m:
            index[norm(f"{m.group(1)} ({m.group(2)})")] = n
            index[norm(m.group(2) + " " + m.group(1))] = n
    found = []
    start = wiki.find("Nonweapon Proficienc")
    section = []
    if start >= 0:
        lines = wiki[start:].split("\n")
        section.append(re.sub(r"^Nonweapon Proficienc[^:]*:" + BOLD + r"?", "", lines[0]))  # text on the heading line
        for line in lines[1:61]:
            if line.startswith(BOLD) and re.match(BOLD + r"[A-Z][^'\n]*:" + BOLD, line):
                break
            section.append(line)
    groups, current = [], None
    rec = r"(?:Pirate's )?(?:Recommended|Suggested)[^:\n]*:"
    any_label = r"(?:(?:Pirate's )?(?:Recommended|Suggested)|Forbidden|Bonus(?:es)?(?: Proficienc(?:y|ies))?|Required)[^:\n]{0,30}:"
    for line in section:
        st = line.strip()
        if st.startswith("**") and current is not None:
            current.append(st.lstrip("*"))
            continue
        body = st.lstrip("*").strip().replace("''", "")
        labels = list(re.finditer(any_label, body))
        current = None
        for i, m in enumerate(labels):
            if not re.match(rec, m.group(0)):
                continue
            # A bullet counts only when it starts with its label; text runs to the next label on the line.
            if st.startswith("*") and i == 0 and not body.startswith(m.group(0)):
                continue
            current = [body[m.end():labels[i + 1].start() if i + 1 < len(labels) else len(body)]]
            groups.append(current)
    for g in groups:
        text = " ".join(g)
        for target in re.findall(r"\[\[([^\]|]+?) \(Proficiency\)", text):
            n = target if target in names else index.get(norm(target))
            if n and n not in found:
                found.append(n)
        rest = re.sub(r"\[\[[^\]]*\]\]\*?", ",", text)
        rest = re.sub(r"\((?:General|Warrior|Rogue|Priest|Wizard|Psionicist)[^)]*\)", ",", rest)
        for tok in re.split(r"[,;]|\band\b", rest):
            t = unlink(tok).replace("*", "").replace("''", "").strip(" .:()")
            if not t or re.fullmatch(r"(?i)(none|any|all|or|and|see .*|if .*|any .*|unless .*)", t):
                continue
            n = index.get(norm(t)) or index.get(norm(re.sub(r"\(.*?\)", "", t)))
            if n:
                if n not in found:
                    found.append(n)
    weapons = []
    weapon = re.search(r"Weapon Proficienc[^\n]*?(?:''|\b)Recommended:?(?:'')?:?\s*([^\n]*?)(?:\.\s|\.?$|\n)", wiki, re.M)
    if weapon and weapon_names:
        windex = {}
        for n, k in weapon_names.items():
            # "Dagger or dirk" answers to "dagger" and "dirk" too.
            for v in [n, *re.split(r" or ", n)]:
                windex.setdefault(norm(v), k)
        for tok in re.split(r"[,;]|\bor\b|\band\b", unlink(weapon.group(1))):
            k = windex.get(norm(tok.replace("*", "").strip(" .")))
            if k and k not in weapons:
                weapons.append(k)
    return [names[n] for n in found] + weapons


def apply_kits(prof_names):
    """Add bonusProficiencies / requiredProficiencies / bonusSlots to the generated kit sources."""
    key_of = dict(prof_names)
    # Every entry is stored as {"choice": [identifiers]}; a single proficiency is a choice of one.
    to_key = lambda e: {"choice": [key_of[x] for x in (e["choice"] if isinstance(e, dict) else [e])]}
    problems = []
    for f in glob.glob("packs/_source/kits/[!_]*.json"):
        doc = json.load(open(f))
        title = re.sub(r"^https://adnd2e\.fandom\.com/wiki/", "", doc["system"]["url"])
        title = urllib.parse.unquote(title).replace("_", " ")
        wiki = api(action="parse", page=title, prop="wikitext")["parse"]["wikitext"]["*"]
        result = {}
        for label in ("bonus", "required"):
            entries, unresolved = kit_entries(wiki, label, prof_names.keys())
            over = KIT_OVERRIDES.get(title, {})
            if label in over:
                entries, unresolved = over[label], []
            if unresolved:
                problems.append(f"{title} [{label}]: {unresolved}")
            result[label] = entries
        if problems:
            continue
        doc["system"]["bonusProficiencies"] = [to_key(e) for e in result["bonus"]]
        doc["system"]["requiredProficiencies"] = [to_key(e) for e in result["required"]]
        doc["system"]["bonusSlots"] = {"weapon": 0, "nonweapon": 0, **KIT_SLOTS.get(title, {})}
        doc["system"]["recommendedProficiencies"] = kit_recommended(wiki, prof_names, WEAPON_PROF_NAMES)
        if KIT_OVERRIDES.get(title, {}).get("note"):
            doc["system"]["notes"] = KIT_OVERRIDES[title]["note"]
        with open(f, "w") as out:
            json.dump(doc, out, indent=2, ensure_ascii=False)
            out.write("\n")
    if problems:
        raise SystemExit("Unresolved kit proficiencies (add to KIT_OVERRIDES):\n  " + "\n  ".join(problems))


if __name__ == "__main__":
    slots, phb, crossover, revs = build_tables()
    nonweapon, names = build_nonweapon(phb)
    weapons, gear, ammo = build_weapons()
    WEAPON_PROF_NAMES.update({d["name"]: d["key"] for d in weapons})

    folders, folder_of = [], {}
    sources = sorted({d["source"] for d in nonweapon}, key=lambda s: (s != "Player's Handbook", s))
    nw_root = classdata.folder_doc("profs.nonweapon", "Nonweapon Proficiencies", sort=0)
    w_root = classdata.folder_doc("profs.weapon", "Weapon Proficiencies (PHB)", sort=1000)
    folders += [nw_root, w_root]
    for i, src in enumerate(sources):
        f = classdata.folder_doc(f"profs.nonweapon.{slug(src)}", src, parent=nw_root["_id"], sort=i * 1000)
        folders.append(f)
        folder_of[src] = f["_id"]
    docs = list(folders)
    for i, d in enumerate(sorted(nonweapon, key=lambda d: d["name"].lower())):
        item = classdata.item_doc("proficiency", "nw." + d["key"], d["name"], "icons/svg/book.svg", d["system"], i * 100)
        item["folder"] = folder_of[d["source"]]
        docs.append(item)
    for i, d in enumerate(weapons):
        item = classdata.item_doc("proficiency", "w." + d["key"], d["name"], "icons/svg/sword.svg", d["system"], i * 100)
        item["folder"] = w_root["_id"]
        docs.append(item)
    classdata.write_docs("packs/_source/proficiencies", docs)

    w_folder = classdata.folder_doc("weapons.weapons", "Weapons", sort=0)
    a_folder = classdata.folder_doc("weapons.ammunition", "Ammunition", sort=1000)
    wdocs = [w_folder, a_folder]
    for i, d in enumerate(sorted(gear, key=lambda d: d["name"].lower())):
        wdocs.append({**classdata.item_doc("weapon", "w." + d["key"], d["name"], "icons/svg/sword.svg", d["system"], i * 100),
                      "folder": w_folder["_id"]})
    for i, d in enumerate(sorted(ammo, key=lambda d: d["name"].lower())):
        wdocs.append({**classdata.item_doc("ammunition", "a." + d["key"], d["name"], "icons/svg/target.svg", d["system"], i * 100),
                      "folder": a_folder["_id"]})
    classdata.write_docs("packs/_source/weapons", wdocs)

    apply_kits(names)

    open("module/rules/proficiency-tables.mjs", "w").write("\n".join([
        "/**",
        " * GENERATED by tools/build-proficiency-data.py - do not edit by hand.",
        " * PHB Table 34 (proficiency slots) and Table 38 (nonweapon proficiency groups per class), from",
        f" *   {classdata.url('Proficiencies (PHB)')} (revision {revs['table34']})",
        f" *   {classdata.url('Nonweapon Proficiencies Tables (PHB)')} (revision {revs['table37_38']})",
        " * A new slot is gained at every level evenly divisible by the rate; nonweapon proficiencies from",
        " * a group outside the class's groups cost one additional slot.",
        " */",
        "export const PROFICIENCY_SLOTS = " + json.dumps(slots, indent=2) + ";", "",
        "export const PROFICIENCY_GROUPS = " + json.dumps(crossover, indent=2) + ";", ""]))
    print(f"wrote packs/_source/proficiencies: {len(nonweapon)} nonweapon, {len(weapons)} weapon, "
          f"{len(folders)} folders; packs/_source/weapons: {len(gear)} weapons, {len(ammo)} ammunition; kits updated; module/rules/proficiency-tables.mjs")
