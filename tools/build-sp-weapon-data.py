#!/usr/bin/env python3
"""Generate the Skills & Powers weapon rules (Player's Option: Skills & Powers, chapter 7):

  module/rules/sp-weapon-tables.mjs   Tables 48-54 and the costs and bonuses stated in the chapter's text
  packs/_source/proficiencies/sp-*.json  weapon group, fighting style, armour and shield proficiencies
                                         (folder "Skills & Powers (POSP)")

Sources (AD&D 2e fandom wiki, MediaWiki API): Weapon Proficiency and Mastery (POSP) (Table 48), Weapon Groups (POSP)
(Table 49), Nonproficiency and Weapon Familiarity (POSP) (Table 50), Shield Proficiency (POSP) (Table 51), Fighting
Style Specialization (POSP) (Table 52), Weapon Specialization and Mastery (POSP) (Tables 53, 54), Weapon Group
Proficiencies (POSP), Armor Proficiency (POSP).
Character point (CP) costs are converted to weapon proficiency slots by the owner's ruling: CP / Table 48 cost per slot,
rounded up, per purchase (module/sp-weapons.mjs). Every rule taken from the text has a regex that must still match its
page (the script fails otherwise). Table 49 weapon names are matched to weapon proficiency identifiers (PHB and Al-Qadim
items) by name, with the curated `ALIASES`; unmatched names are listed (no item to link).

Run after build-proficiency-data.py (which rewrites packs/_source/proficiencies), build-armor-data.py and
build-aq-equipment-data.py:  python3 tools/build-sp-weapon-data.py
"""
import glob
import importlib.util
import json
import os
import re

_spec = importlib.util.spec_from_file_location("classdata", "tools/build-class-data.py")
classdata = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(classdata)

OUT_DIR = "packs/_source/proficiencies"
GROUPS = ["warrior", "wizard", "priest", "rogue"]
CLASS_WORDS = {"Warrior": "warrior", "Warriors": "warrior", "Wizard": "wizard", "Wizards": "wizard", "Mages": "wizard",
               "Priest": "priest", "Priests": "priest", "Rogue": "rogue", "Rogues": "rogue"}

# Table 49 names that differ from the item names (name -> proficiency identifier).
ALIASES = {
    "hand/throwing axe": "hand-or-throwing-axe", "war hammer": "warhammer", "dagger": "dagger-or-dirk",
    "broadsword": "broad-sword", "two-handed sword": "two-hand-sword", "cutlass": "sword-cutlass",
    "great scimitar": "sword-great-scimitar", "ankus": "elephant-goad-ankus", "katar": "katar-punch-dagger",
}
# Lances (Table 49 lists "Light, medium, heavy, jousting").
LANCES = {"light": "light-horse-lance", "medium": "medium-horse-lance", "heavy": "heavy-horse-lance",
          "jousting": "jousting-lance"}

# Shield types of Table 51 -> shield armour item identifiers (the Al-Qadim daraq is not one of them).
SHIELD_ITEMS = {"buckler": ["buckler"], "small": ["small-shield"], "medium": ["medium-shield"], "body": ["body-shield"]}

STYLE_KEYS = {"One-handed Weapon": "one-handed", "Weapon and Shield": "weapon-shield", "Two-handed Weapon": "two-handed",
              "Two Weapon": "two-weapon", "Missile": "missile", "Horse Archer": "horse-archery",
              "Thrown Weapon/Sling": "thrown", "Special*": "special"}

# Rules from the pages' text: (page, regex that must match, value).
RULES = {
    "groupSlots": ("Weapon Group Proficiencies (POSP)",
                   r"By spending 2 proficiency slots \(4 character points\), a warrior can gain a proficiency in all the weapons in a specific tight group.*?"
                   r"By spending 3 slots \(6 character points\), a warrior can learn a broad group weapon proficiency.*?"
                   r"This group proficiency option is only available to warriors",
                   {"tight": 2, "broad": 3, "classes": ["warrior"]}),
    "choiceCp": ("Weapon Specialization and Mastery (POSP)",
                 r"Warriors can do so for a cost of 2 character points, rogues and priests for 3 points, and wizards must spend 4 points",
                 {"warrior": 2, "rogue": 3, "priest": 3, "wizard": 4}),
    "choiceHit": ("Weapon Specialization and Mastery (POSP)",
                  r"receives a \+1 bonus on all attack rolls when using his weapon of choice", 1),
    "expertiseCp": ("Weapon Specialization and Mastery (POSP)",
                    r"Weapon expertise costs a ranger, paladin, or multi-classed warrior 2 character points \(or 1 if the weapon is already the "
                    r"character's weapon of choice\)\. Rogues and priests must spend 4 character points \(or 3, if the weapon is already the weapon "
                    r"of choice\)\. Wizards can purchase weapon expertise for a cost of 5 character points, though if the weapon is already the "
                    r"character's weapon of choice the cost is only 4",
                    {"warrior": [2, 1], "rogue": [4, 3], "priest": [4, 3], "wizard": [5, 4]}),
    "expertiseAttacks": ("Weapon Specialization and Mastery (POSP)",
                         r"Weapon expertise allows a character to gain extra attacks as if a weapon specialist", True),
    "masteryBonus": ("Weapon Specialization and Mastery (POSP)",
                     r"A master's attack and damage bonuses with a melee weapon are both \+3\. With a missile weapon, the attack bonus becomes a "
                     r"\+2 at all ranges beyond point blank\. At point blank range the attack and damage bonuses are each \+3",
                     {"meleeHit": 3, "meleeDamage": 3, "missileHit": 2, "pointBlankHit": 3, "pointBlankDamage": 3}),
    "missileSpec": ("Weapon Specialization and Mastery (POSP)",
                    r"The character gains a \+1 attack bonus at all range categories.*?Point blank shots inflict \+2 points of damage",
                    {"hit": 1, "pointBlankDamage": 2}),
    "masteryNeedsSpec": ("Weapon Specialization and Mastery (POSP)",
                         r"A character must possess weapon specialization in the weapon he will attempt to master", True),
    "styleExtraCp": ("Fighting Style Specialization (POSP)",
                     r"A character can spend an additional character point when he purchases a weapon proficiency to learn a style that is not "
                     r"normally provided to his character class", 1),
    "styleOnlyOne": ("Fighting Style Specialization (POSP)",
                     r"Warriors can specialize in as many styles as they wish to purchase\. Priests and rogues can only specialize in one style\. "
                     r"Wizards can specialize in a single fighting style, but only by paying an extra character point",
                     {"single": ["priest", "rogue", "wizard"], "wizardExtraCp": 1}),
    "oneHanded": ("Fighting Style Specialization (POSP)",
                  r"gains an AC bonus of \+1 when he fights with a weapon in one hand, and no shield or weapon in his other hand\. By spending 2 "
                  r"additional character points, the character can improve this AC bonus to a maximum of \+2",
                  {"ac": 1, "improvedAc": 2, "improvedCp": 2}),
    "weaponShield": ("Fighting Style Specialization (POSP)",
                     r"can gain a \+1 benefit to his AC \(in addition to his regular shield effects\) or a \+1 on his attack roll during any melee "
                     r"round when he holds a shield and wields a weapon", {"ac": 1, "hit": 1}),
    "twoHanded": ("Fighting Style Specialization (POSP)",
                  r"improves \(lowers\) the speed factor of a weapon by 3.if that weapon is wielded with two hands\. In addition, if the character "
                  r"is using a one-handed weapon with two hands, the weapon gains a \+1 bonus to all damage rolls", {"speed": -3, "damage": 1}),
    "twoWeapon": ("Fighting Style Specialization (POSP)",
                  r"requires 1 additional character point when it is first acquired.except for rangers.*?"
                  r"this specialization reduces the penalty to 0 for the primary hand, and .2 for the secondary hand.*?"
                  r"If a character spends 2 additional character points on this specialization, however, he can learn to use two weapons of "
                  r"equal size",
                  {"extraCp": 1, "exempt": ["ranger"], "main": 0, "off": -2, "improvedCp": 2}),
    "missileStyle": ("Fighting Style Specialization (POSP)",
                     r"He can move up to half his normal movement rate and still make all of his allowed missile attacks during a turn\. Or he "
                     r"can move his full movement rate and make half as many attacks.*?gains a \+1 bonus to his AC when attacked by missile "
                     r"fire, but only if the specialist character is also using a missile weapon and attacking on that round",
                     {"halfMoveAttacks": 1, "fullMoveAttacks": 0.5, "acVsMissiles": 1}),
    "horseArchery": ("Fighting Style Specialization (POSP)",
                     r"The normal penalties for shooting from the saddle are reduced by 2\. Thus, archers suffer no penalty if the horse is "
                     r"moving at up to half its normal speed, and they suffer only a .2 penalty if the horse is moving faster",
                     {"upToHalf": 0, "faster": -2}),
    "thrownStyle": ("Fighting Style Specialization (POSP)",
                    r"Thrown Weapon=*\s*A character who specializes in this fighting style gains the same bonuses as a character who specializes "
                    r"in the missile fighting style", True),
    "armor": ("Armor Proficiency (POSP)",
              r"A character with the armor proficiency suffers only half the normal encumbrance load of his armor", {"factor": 0.5, "slots": 1}),
    "shieldSlots": ("Shield Proficiency (POSP)",
                    r"Warriors can gain this proficiency by spending 1 slot; other characters must spend 2 weapon proficiency slots",
                    {"warrior": 1, "other": 2}),
    "familiar": ("Nonproficiency and Weapon Familiarity (POSP)",
                 r"Weapons in the same tight group as a character's weapon of proficiency are familiar to that character\. If a character has "
                 r"proficiency in an entire tight group of weapons, he is familiar with all weapons in a related broad group", True),
}

PAGES = sorted({p for p, _, _ in RULES.values()} | {"Weapon Proficiency and Mastery (POSP)", "Weapon Groups (POSP)"})


def num(text):
    return int(text.replace("–", "-").replace("−", "-").strip())


def slug(s):
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")


def cell(text):
    return re.sub(r"'''?", "", text).strip()


def class_list(text):
    t = cell(text)
    if t in ("All", "Varies"):
        return list(GROUPS)
    out = [CLASS_WORDS[w.strip()] for w in t.split(",")]
    return out


def weapon_names():
    """Weapon proficiency name (lower case) -> identifier, from the PHB and Al-Qadim sources."""
    out = {}
    for f in glob.glob("packs/_source/proficiencies/*.json") + glob.glob("packs/_source/aq-equipment/*.json"):
        d = json.load(open(f))
        if d.get("type") == "proficiency" and d["system"].get("kind") == "weapon":
            out[d["name"].lower()] = d["system"]["identifier"]
    return out


def parse_groups(wiki, names):
    """Table 49: {key: {label, kind, broad, weapons: [names], ids: [identifiers]}} and the unmatched names."""
    body = wiki.split("==Table 49: Weapon Groups==", 1)[1]
    groups, unmatched = {}, set()
    broad = None

    def resolve(name, group_key):
        n = name.strip().lower().replace("’", "'")
        if group_key == "lances" and n in LANCES:
            return LANCES[n]
        return ALIASES.get(n) or names.get(n)

    def add(key, label, kind, parent, items):
        ids = []
        for it in items:
            i = resolve(it, key)
            if i:
                ids.append(i)
            else:
                unmatched.add(it.strip())
        g = groups.setdefault(key, {"label": label, "kind": kind, "broad": parent, "weapons": [], "ids": []})
        g["weapons"] += [it.strip() for it in items]
        g["ids"] += [i for i in ids if i not in g["ids"]]
        return g

    lines = [l.strip() for l in body.split("\n") if l.strip()]
    i = 0
    while i < len(lines):
        line = lines[i]
        bi = re.fullmatch(r"'''''(.+?)'''''", line)       # bold italic: a group that is both (no sub-groups)
        b = re.fullmatch(r"'''(.+?)'''", line)              # bold: broad group
        t = re.fullmatch(r"''(.+?):''\s*(.+)", line)        # italic: tight group within the current broad group
        if bi:
            label = bi.group(1).strip()
            items = [x for x in lines[i + 1].split(",")]
            add(slug(label), label, "tight", None, items)
            broad = None
            i += 2
            continue
        if b:
            broad = slug(b.group(1))
            groups[broad] = {"label": b.group(1).strip(), "kind": "broad", "broad": None, "weapons": [], "ids": []}
        elif t and broad:
            label, items = t.group(1).strip(), t.group(2).split(",")
            if label == "Unrelated":
                add(broad, groups[broad]["label"], "broad", None, items)
            else:
                add(f"{broad}.{slug(label)}", label, "tight", broad, items)
                add(broad, groups[broad]["label"], "broad", None, items)
        elif line.startswith("If a weapon does not appear") or line.startswith("{{"):
            break
        i += 1
    for g in groups.values():
        g["weapons"] = list(dict.fromkeys(g["weapons"]))
    return groups, sorted(unmatched)


def armor_items():
    out = []
    for f in sorted(glob.glob("packs/_source/armor/*.json")) + sorted(glob.glob("packs/_source/aq-equipment/*armor*.json")):
        d = json.load(open(f))
        if d.get("type") == "armor" and d["system"]["kind"] == "body":
            out.append((d["system"]["identifier"], d["name"]))
    return out


def prof_system(identifier, kind, url, **extra):
    s = {"identifier": identifier, "kind": kind, "slots": 1, "ability": None, "modifier": None, "groups": [],
         "sp": {"ability": "", "rating": None, "cost": None}, "source": "Player's Option: Skills & Powers", "url": url,
         "notes": "", "spGroup": "", "style": "", "improved": False, "armorType": "", "shieldType": ""}
    s.update(extra)
    return s


if __name__ == "__main__":
    wiki, revs = {}, {}
    for title in PAGES:
        w, rev, _ = classdata.page(title)
        wiki[title], revs[title] = w, rev
    plain = {t: re.sub(r"\[\[(?:[^|\]]*\|)?([^\]]*)\]\]", r"\1", w).replace("'''", "").replace("''", "") for t, w in wiki.items()}
    rules = {}
    for key, (title, pattern, value) in RULES.items():
        assert re.search(pattern, plain[title], flags=re.S), f"{key}: pattern no longer matches {title}"
        rules[key] = value

    # Table 48: CP per weapon proficiency slot.
    t48 = {CLASS_WORDS[cell(r[0])]: int(r[1]) for r in classdata.table_rows(wiki["Weapon Proficiency and Mastery (POSP)"], "Table 48")}
    assert t48 == {"warrior": 2, "rogue": 3, "priest": 3, "wizard": 3}, t48
    # Table 50: non-proficiency and familiarity penalties.
    t50 = {}
    for r in classdata.table_rows(wiki["Nonproficiency and Weapon Familiarity (POSP)"], "Table 50"):
        key = CLASS_WORDS.get(cell(r[0])) or slug(cell(r[0]))
        t50[key] = {"nonproficient": num(r[1]), "familiar": num(r[2])}
    assert t50["warrior"] == {"nonproficient": -2, "familiar": -1} and t50["wizard"] == {"nonproficient": -5, "familiar": -3}, t50
    # Table 51: shield proficiency.
    t51 = {}
    for r in classdata.table_rows(wiki["Shield Proficiency (POSP)"], "Table 51"):
        m = re.fullmatch(r"\+(\d)(?:/\+(\d) vs\. missiles)?", cell(r[1]))
        words = {"One": 1, "Two": 2, "Three": 3, "Four": 4}
        t51[cell(r[0]).lower()] = {"ac": int(m.group(1)), "missile": int(m.group(2) or m.group(1)), "attackers": words[cell(r[2])],
                                   "items": SHIELD_ITEMS[cell(r[0]).lower()]}
    assert t51["body"] == {"ac": 3, "missile": 4, "attackers": 4, "items": ["body-shield"]}, t51["body"]
    # Table 52: fighting styles by class.
    t52 = {STYLE_KEYS[cell(r[0])]: {"label": cell(r[0]).rstrip("*"), "classes": class_list(r[1])}
           for r in classdata.table_rows(wiki["Fighting Style Specialization (POSP)"], "Table 52")}
    assert t52["two-handed"]["classes"] == ["warrior", "priest", "wizard"] and t52["one-handed"]["classes"] == GROUPS, t52
    # Tables 53, 54: specialization and mastery (CP cost, minimum level).
    rows = {"Fighter": "fighter", "Multi-class Fighter": "multiclass", "Ranger/Paladin": "ranger-paladin",
            "Priest": "priest", "Rogues": "rogue", "Wizards": "wizard"}
    spec_page = wiki["Weapon Specialization and Mastery (POSP)"]
    t53 = {rows[cell(r[0])]: {"cp": int(r[1]), "level": int(r[2])} for r in classdata.table_rows(spec_page, "Table 53")}
    t54 = {rows[cell(r[0])]: {"cp": int(r[1]), "level": int(r[2])} for r in classdata.table_rows(spec_page, "Table 54")}
    assert t53["fighter"] == {"cp": 2, "level": 1} and t53["wizard"] == {"cp": 10, "level": 7}, t53
    assert t54 == {"fighter": {"cp": 2, "level": 5}, "multiclass": {"cp": 8, "level": 6}, "ranger-paladin": {"cp": 8, "level": 7}}, t54
    # "The minimum level for weapon mastery in every character class is 4 higher than the minimum for specialization".
    assert all(t54[k]["level"] == t53[k]["level"] + 4 for k in t54), (t53, t54)

    names = weapon_names()
    groups, unmatched = parse_groups(wiki["Weapon Groups (POSP)"], names)
    assert groups["swords.medium"]["ids"][:2] == ["broad-sword", "long-sword"], groups["swords.medium"]
    assert groups["bows"]["kind"] == "tight" and "long-bow" in groups["bows"]["ids"], groups["bows"]
    assert "voulge" in groups["polearms"]["ids"] and groups["polearms.poleaxes"]["broad"] == "polearms", groups["polearms"]
    assert groups["lances"]["ids"] == ["light-horse-lance", "medium-horse-lance", "heavy-horse-lance", "jousting-lance"], groups["lances"]

    tables = {"sources": {t: {"url": classdata.url(t), "revision": revs[t]} for t in PAGES},
              "cpPerSlot": t48, "nonproficiency": t50, "shields": t51, "styles": t52,
              "specialization": t53, "mastery": t54, "groups": groups, **rules}
    with open("module/rules/sp-weapon-tables.mjs", "w") as f:
        f.write("\n".join([
            "/**",
            " * GENERATED by tools/build-sp-weapon-data.py - do not edit by hand.",
            " * Player's Option: Skills & Powers, chapter 7 (weapon proficiencies): Tables 48-54 and the costs and bonuses of the text.",
            *[f" * {t}: {classdata.url(t)} (revision {revs[t]})." for t in PAGES],
            " * Groups (Table 49): key -> { label, kind (broad | tight), broad (parent key), weapons (names), ids (proficiency",
            " * identifiers found) }; a bold italic group (e.g. Bows) has no sub-groups and is taken as a tight group.",
            " */",
            "export const SP_WEAPONS = " + json.dumps(tables, ensure_ascii=False) + ";", ""]))

    # Proficiency items (folder "Skills & Powers (POSP)" with sub-folders).
    root = classdata.folder_doc("profs.sp", "Skills & Powers (POSP)", sort=3000)
    subs = {k: classdata.folder_doc(f"profs.sp.{k}", label, parent=root["_id"], sort=i * 1000)
            for i, (k, label) in enumerate([("groups", "Weapon Groups"), ("styles", "Fighting Styles"), ("armor", "Armor Proficiency"),
                                             ("shields", "Shield Proficiency")])}
    docs = []
    group_url = classdata.url("Weapon Group Proficiencies (POSP)")
    for n, (key, g) in enumerate(sorted(groups.items())):
        label = g["label"] if g["kind"] == "broad" or not g["broad"] else f"{groups[g['broad']]['label']}: {g['label']}"
        ident = f"group-{key.replace('.', '-')}"
        d = classdata.item_doc("proficiency", ident, f"Weapon group: {label} ({g['kind']})", "icons/svg/combat.svg",
                               prof_system(ident, "group", group_url, slots=rules["groupSlots"][g["kind"]], spGroup=key), n * 100)
        d["folder"] = subs["groups"]["_id"]
        docs.append(d)
    style_url = classdata.url("Fighting Style Specialization (POSP)")
    for n, (key, s) in enumerate(t52.items()):
        ident = f"style-{key}"
        d = classdata.item_doc("proficiency", ident, f"Fighting style: {s['label']}", "icons/svg/combat.svg",
                               prof_system(ident, "style", style_url, style=key), n * 100)
        d["folder"] = subs["styles"]["_id"]
        docs.append(d)
    armor_url = classdata.url("Armor Proficiency (POSP)")
    for n, (ident_a, name) in enumerate(armor_items()):
        ident = f"armor-{ident_a}"
        d = classdata.item_doc("proficiency", ident, f"Armor proficiency: {name}", "icons/svg/shield.svg",
                               prof_system(ident, "armor", armor_url, armorType=ident_a), n * 100)
        d["folder"] = subs["armor"]["_id"]
        docs.append(d)
    shield_url = classdata.url("Shield Proficiency (POSP)")
    for n, key in enumerate(t51):
        ident = f"shield-{key}"
        d = classdata.item_doc("proficiency", ident, f"Shield proficiency: {key.capitalize()}", "icons/svg/shield.svg",
                               prof_system(ident, "shield", shield_url, slots=rules["shieldSlots"]["warrior"], shieldType=key), n * 100)
        d["folder"] = subs["shields"]["_id"]
        docs.append(d)

    # Replace this script's earlier output only (build-proficiency-data.py owns the rest of the folder).
    folder_files = [f"_folder-{f['_id']}.json" for f in [root, *subs.values()]]
    for f in glob.glob(f"{OUT_DIR}/sp-*.json"):
        os.remove(f)
    for d in [root, *subs.values()]:
        with open(f"{OUT_DIR}/_folder-{d['_id']}.json", "w") as f:
            json.dump(d, f, indent=2, ensure_ascii=False)
            f.write("\n")
    for d in docs:
        with open(f"{OUT_DIR}/sp-{d['system']['identifier']}.json", "w") as f:
            json.dump(d, f, indent=2, ensure_ascii=False)
            f.write("\n")
    print(f"wrote module/rules/sp-weapon-tables.mjs ({len(groups)} groups) and {len(docs)} proficiencies in {OUT_DIR}/sp-*.json")
    print("Table 49 names without a weapon proficiency item:", ", ".join(unmatched))
