#!/usr/bin/env python3
"""Write the weapon limits of classes and kits into their sources (packs/_source/classes, packs/_source/kits).

Classes: `allowedWeapons` = the PHB class lists of tools/build-class-ability-tables.py `CLASS_WEAPONS` (wizards, druid,
thief); the cleric's rule is by weapon type (bludgeoning only) and stays in the generated rules (empty list).
Kits (curated `KITS`, each with a `match` regex that must occur in the kit page's text; the script fails otherwise):
  allowed   the kit's own list, replacing the class's ("*" = any weapon);
  extra     weapons added to the class's list;
  forbidden weapons the kit may never take;
  initial   the only weapons allowed at 1st level (owner's ruling, 1.0.27: warning at 1st level only);
  initialForbidden  weapons not allowed at 1st level;
  within    the kit's list applies only within the class's (e.g. "if his true priest-class allows them");
  note      weapons at an extra slot cost and similar (owner's ruling: allowed, the cost is noted, not charged).
Kit text that only requires or recommends weapons, or sets how slots are divided, is not a limit and is not recorded.
Implementation choices: a kit's "Any." entry means no kit-specific limit (the class's applies); names resolve to weapon
proficiency identifiers through `ALIAS` and `GROUPS` ("bow (any)" = every bow, "sword (any)" = every sword...);
weapons with no item in the system's compendiums (`UNAVAILABLE`) are left out.
Run from the repo root (after build-class-data.py, build-class-ability-tables.py, build-proficiency-data.py,
build-poct-weapon-data.py, build-kit-mechanics.py and build-aq-equipment-data.py):  python3 tools/build-kit-weapons.py
"""
import glob
import importlib.util
import json
import re
import urllib.parse

_spec = importlib.util.spec_from_file_location("classdata", "tools/build-class-data.py")
classdata = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(classdata)
_aspec = importlib.util.spec_from_file_location("abilities", "tools/build-class-ability-tables.py")
abilities = importlib.util.module_from_spec(_aspec)
_aspec.loader.exec_module(abilities)

GROUPS = {
    "bows": ["short-bow", "composite-short-bow", "long-bow", "composite-long-bow"],
    "short bows": ["short-bow", "composite-short-bow"],
    "crossbows": ["hand-crossbow", "light-crossbow", "heavy-crossbow", "pellet-bow", "cho-ku-no"],
    "swords": ["broad-sword", "sapara", "khopesh", "short-sword", "drusus", "gladius", "spatha", "scimitar", "sword-great-scimitar",
               "tulwar", "sword-cutlass", "katana", "wakizashi", "no-dachi", "ninja-to", "long-sword", "sabre", "falchion", "estoc",
               "bastard-sword", "claymore", "two-hand-sword", "rapier"],
    "axes": ["battle-axe", "hand-or-throwing-axe", "hatchet", "two-handed-axe"],
    "lances": ["light-horse-lance", "medium-horse-lance", "heavy-horse-lance", "jousting-lance"],
    "polearms": ["awl-pike", "partisan", "ranseur", "spetum", "bardiche", "halberd", "voulge", "bill", "bill-guisarme",
                 "glaive-guisarme", "guisarme-voulge", "hook-fauchard", "glaive", "fauchard", "naginata", "nagimaki", "fauchard-fork",
                 "bec-de-corbin", "lucern-hammer", "military-fork", "tetsubo", "lajatang"],
    "flails": ["footman-s-flail", "horseman-s-flail"],
    "maces": ["footman-s-mace", "horseman-s-mace"],
    "firearms": ["arquebus", "hand-gunne", "caliver", "musket", "belt-pistol", "horse-pistol"],
}
GROUPS["missile"] = GROUPS["bows"] + GROUPS["crossbows"] + GROUPS["firearms"] + ["sling", "staff-sling", "blowgun"]
ALIAS = {"bow (any)": "bows", "bow": "bows", "crossbow (any)": "crossbows", "crossbow": "crossbows", "sword (any)": "swords",
         "axe (any)": "axes", "lance (any)": "lances", "polearm (any)": "polearms", "flails (all)": "flails", "maces (all)": "maces",
         "short bow (either type)": "short bows",
         "staff": "quarterstaff", "dagger": "dagger-or-dirk", "hand axe": "hand-or-throwing-axe", "war hammer": "warhammer",
         "hammer": "warhammer", "two-handed sword": "two-hand-sword", "cutlass": "sword-cutlass", "broad sword": "broad-sword"}
UNAVAILABLE = {"garrote"}
# Weapons that can be hurled (Jongleur: "any weapon that can be thrown"); implementation choice from the PHB weapon list.
HURLED = ["dagger", "dart", "hand axe", "javelin", "knife", "spear", "harpoon", "trident", "club", "war hammer"]

KITS = {
    # --- lists that replace the class's
    "anagakok": {"match": r"A beginning Anagakok can buy weapons only from those listed in the Weapon Proficiency entry",
                 "allowed": ["bow (any)", "dagger", "harpoon", "javelin", "knife", "sling", "trident"]},
    "astrologer-sha-ir": {"match": r"The astrologer may only choose from the following weapon proficiencies: dagger, staff, knife, jambiya, dart, and sling",
                          "allowed": ["dagger", "staff", "knife", "jambiya", "dart", "sling"]},
    "clockwork-mage": {"match": r"The clockwork mage can use the following weapons: dagger, staff, knife, jambiya, dart, and sling\. An additional weapon proficiency, hammer, may be bought for two slots",
                       "allowed": ["dagger", "staff", "knife", "jambiya", "dart", "sling", "hammer"], "note": "hammer: two slots"},
    "digitalogist": {"match": r"Digitalogists are able to study the use of the sling, dart, staff, dagger, jambiya, and knife",
                     "allowed": ["sling", "dart", "staff", "dagger", "jambiya", "knife"]},
    "dwarven-chanter": {"match": r"The following weapons are available to Chanters: club, flails \(all\), maces \(all\), javelin, morning star, quarterstaff, sling, spear, staff sling, and the warhammer",
                        "allowed": ["club", "flails (all)", "maces (all)", "javelin", "morning star", "quarterstaff", "sling", "spear", "staff sling", "warhammer"]},
    "elemental-mage": {"match": r"they must choose from among the dagger, staff, knife, jambiya, dart, and sling",
                       "allowed": ["dagger", "staff", "knife", "jambiya", "dart", "sling"]},
    "elven-minstrel": {"match": r"Elven Minstrels are limited to the following weapon proficiencies: blowgun, bow \(any\), dagger, dart, hand axe, javelin, knife, quarterstaff, sling, spear, staff sling, long and short swords, and the trident",
                       "allowed": ["blowgun", "bow (any)", "dagger", "dart", "hand axe", "javelin", "knife", "quarterstaff", "sling", "spear", "staff sling", "long sword", "short sword", "trident"]},
    "explorer-ranger": {"match": r"his weapon proficiencies are confined to the following choices: short bow, light crossbow, dagger, dart, knife, sling, short sword",
                        "allowed": ["short bow", "light crossbow", "dagger", "dart", "knife", "sling", "short sword"]},
    "feralan": {"match": r"A Feralan's remaining slots must be spent on primitive weapons: blowgun \(rare\), dagger, short bow, dart, hand axe, sling, spear",
                "allowed": ["club", "knife", "blowgun", "dagger", "short bow", "dart", "hand axe", "sling", "spear"]},
    "ghul-lord": {"match": r"A ghul lord can choose from any of the following weapons: dagger, staff, jambiya, dart, sling, short sword, long sword, cutlass, and scimitar",
                  "allowed": ["dagger", "staff", "jambiya", "dart", "sling", "short sword", "long sword", "cutlass", "scimitar"]},
    "gnome-professor": {"match": r"Professors can become proficient in the following weapons: arquebus, blowgun, bow, crossbow, harpoon, mancatcher, scourge, sling, staff sling, and whip",
                        "allowed": ["arquebus", "blowgun", "bow", "crossbow", "harpoon", "mancatcher", "scourge", "sling", "staff sling", "whip"]},
    "greenwood-ranger": {"match": r"A Greenwood Ranger's weapon proficiencies are limited to the following choices: axe \(any\), bow \(any\), crossbow \(any\), dagger, knife, quarterstaff, sling, spear, long sword, short sword",
                         "allowed": ["axe (any)", "bow (any)", "crossbow (any)", "dagger", "knife", "quarterstaff", "sling", "spear", "long sword", "short sword"]},
    "hakima": {"match": r"Wise women are limited to the following weapons: club, staff, dart, blowgun, short sword, jambiya, dagger, knife, sling, war hammer, horseman's mace",
               "allowed": ["club", "staff", "dart", "blowgun", "short sword", "jambiya", "dagger", "knife", "sling", "war hammer", "horseman's mace"]},
    "halfling-whistler": {"match": r"Whistlers can select from among the following weapons: blowgun, short bow \(either type\), club, light crossbow, dagger, dart, footman's mace, hand axe, harpoon, javelin, knife, quarterstaff, sling, spear, staff sling, short sword, or war hammer",
                          "allowed": ["blowgun", "short bow (either type)", "club", "light crossbow", "dagger", "dart", "footman's mace", "hand axe", "harpoon", "javelin", "knife", "quarterstaff", "sling", "spear", "staff sling", "short sword", "war hammer"],
                          "note": "rock pitching (special proficiency)"},
    "jackal": {"match": r"They may use the dagger, staff, jambiya, knife, dart, and sling",
               "allowed": ["dagger", "staff", "jambiya", "knife", "dart", "sling"]},
    "jester-bard": {"match": r"Jesters may become proficient only in the blowgun, hand crossbow, dagger, dart, hand axe, javelin, knife, quarterstaff, scourge, sling, short sword, and whip",
                    "allowed": ["blowgun", "hand crossbow", "dagger", "dart", "hand axe", "javelin", "knife", "quarterstaff", "scourge", "sling", "short sword", "whip"]},
    "jongleur": {"match": r"Jongleurs can use all hurled weapons\..*?Otherwise, Jongleurs are restricted to the following weapons: polearms, quarterstaff, sling, staff sling, and whip",
                 "allowed": HURLED + ["polearm (any)", "quarterstaff", "sling", "staff sling", "whip"]},
    "kahin": {"match": r"Kahins are limited to the following weapons: club, dart, spear, light horse lance, jambiya, scimitar, sling, and staff",
              "allowed": ["club", "dart", "spear", "light horse lance", "jambiya", "scimitar", "sling", "staff"]},
    "loremaster": {"match": r"They are limited to selecting weapon proficiencies for blowgun, dagger, dart, hand crossbow, knife, quarterstaff, sling, and staff sling",
                   "allowed": ["blowgun", "dagger", "dart", "hand crossbow", "knife", "quarterstaff", "sling", "staff sling"]},
    "mageweaver": {"match": r"Mageweavers are able to study the use of the sling, dart, staff, dagger, jambiya, and knife",
                   "allowed": ["sling", "dart", "staff", "dagger", "jambiya", "knife"]},
    "riddlemaster": {"match": r"They can become proficient in the blowgun, bow, crossbow, dagger, dart, hand axe, javelin, knife, quarterstaff, sling, spear, staff sling, short sword, or whip",
                     "allowed": ["blowgun", "bow", "crossbow", "dagger", "dart", "hand axe", "javelin", "knife", "quarterstaff", "sling", "spear", "staff sling", "short sword", "whip"]},
    "sha-ir": {"match": r"Sha'irs must take the staff as their initial weapon proficiency\. For additional weapons, they are limited much like standard wizards; they must choose from among the dagger, knife, jambiya, dart, and sling",
               "allowed": ["staff", "dagger", "knife", "jambiya", "dart", "sling"]},
    "sorcerer": {"match": r"Sorcerers are limited much like standard wizards; they must choose from among the dagger, staff, knife, jambiya, dart, and sling",
                 "allowed": ["dagger", "staff", "knife", "jambiya", "dart", "sling"]},
    "spellslayer": {"match": r"Spellslayers are able to use of the sling, dart, staff, dagger, jambiya, knife, and short sword",
                    "allowed": ["sling", "dart", "staff", "dagger", "jambiya", "knife", "short sword"]},
    "stalker-ranger": {"match": r"Their weapon proficiencies are limited to blowgun, dagger, dart, knife, short sword, staff, and sling\. \* Optional: garrote, rapier \(walking stick\), stiletto",
                       "allowed": ["blowgun", "dagger", "dart", "knife", "short sword", "staff", "sling", "garrote", "rapier", "stiletto"]},
    "thespian": {"match": r"1st-level Thespians are proficient only with the dagger\. At 2nd level they become proficient with the knife, and at 5th level Thespians gain their final weapon proficiency.the short sword",
                 "allowed": ["dagger", "knife", "short sword"], "note": "knife from 2nd level, short sword from 5th"},
    "wyrmslayer": {"match": r"A Wyrmslayer may be proficient in the following weapons only, all of which inflict high damage to large targets: heavy horse lance, medium horse lance, awl pike, bardiche, glaive-guisarme, spetum, long sword, two-handed sword, trident",
                   "allowed": ["heavy horse lance", "medium horse lance", "awl pike", "bardiche", "glaive-guisarme", "spetum", "long sword", "two-handed sword", "trident"]},
    # lists within the class's
    "pacifist-priest": {"match": r"The Pacifist Priest may not know any Weapon Proficiency except bow and dart, and may know them only if his true priest-class allows them",
                        "allowed": ["bow", "dart"], "within": True, "note": "used only in competition"},
    "amazon-posp": {"match": r"Amazons can choose from: battle axe, bow \(any\), club, dagger, hand or throwing axe, javelin, knife, lance, spear, staff, sword \(any\)",
                    "allowed": ["battle axe", "bow (any)", "club", "dagger", "hand axe", "javelin", "knife", "lance (any)", "spear", "staff", "sword (any)"], "within": True},
    # --- any weapon
    "assassin-thief": {"match": r"Assassins, unlike thieves of other kits, are permitted the use of any weapon", "allowed": ["*"]},
    "bounty-hunter": {"match": r"The Bounty Hunter is permitted the use of any weapon\..*?Non-thief weapons take up two of the Bounty Hunter's weapon proficiency slots",
                      "allowed": ["*"], "note": "non-thief weapons: two slots"},
    "holy-slayer": {"match": r"A holy slayer may become proficient in the use of any one-handed weapon", "allowed": ["*"], "note": "one-handed weapons only"},
    "mystic-al-qadim": {"match": r"they may take weapons normally forbidden to priests if they fill twice the usual number of proficiency slots",
                        "allowed": ["*"], "note": "weapons forbidden to priests: double slots"},
    "thug-thief": {"match": r"They may choose non-thief weapons, but to gain proficiency in one requires an extra slot",
                   "allowed": ["*"], "note": "non-thief weapons: one extra slot"},
    # --- weapons added to the class's
    "amazon-sorceress": {"match": r"Recommended: Spear or long bow\. This is contrary to the weapons usually allowed wizards", "extra": ["spear", "long bow"]},
    "bandit": {"match": r"they may use the following cudgel-like weapons in addition to those normally permitted to thieves: flail, mace, morning star and warhammer",
               "extra": ["flails (all)", "maces (all)", "morning star", "warhammer"]},
    "barber": {"match": r"One of the barber's initial weapon proficiencies is the razor", "extra": ["razor"]},
    "militant-wizard": {"match": r"Battle axe, bow \(any\), crossbow \(any\), dagger, javelin, sling, spear, sword \(any\), warhammer\. These are different from the weapons normally associated with wizards",
                        "extra": ["battle axe", "bow (any)", "crossbow (any)", "javelin", "spear", "sword (any)", "warhammer"]},
    "peasant-wizard": {"match": r"Required \(player's choice\): Bow \(any\), dagger, knife, spear, dart, sling", "extra": ["bow (any)", "spear"]},
    "savage-wizard": {"match": r"Required \(one of the following, representing his tribe's weapon of choice\): spear, blowgun, dagger, knife, or sling",
                      "extra": ["spear", "blowgun"]},
    "swashbuckler-thief": {"match": r"The Swashbuckler receives an extra weapon proficiency slot which must be devoted to a weapon among the following: stiletto, main-gauche, rapier, and sabre",
                           "extra": ["stiletto", "main-gauche", "rapier", "sabre"]},
    "wu-jen": {"match": r"Required \(choose one of the following\): Blowgun, short bow, dagger, dart, sling\. Alternately, the Wu Jen can choose from the selection of oriental weapons",
               "extra": ["blowgun", "short bow"], "note": "or an oriental weapon of the kit's Table 9"},
    # --- forbidden
    "gypsy-bard": {"match": r"Gypsy-bards cannot become proficient in the following weapons: battle axe, lance \(any\), polearm \(any\), trident, two-handed sword, bastard sword, or warhammer",
                   "forbidden": ["battle axe", "lance (any)", "polearm (any)", "trident", "two-handed sword", "bastard sword", "warhammer"]},
    "mamluk": {"match": r"Horse-mounted weapons \(including lances and horseman's flails and maces\) are not used by mamluks, and may not be taken as proficiencies",
               "forbidden": ["lance (any)", "horseman's flail", "horseman's mace"]},
    "meistersinger": {"match": r"The following weapons are forbidden to the Meistersinger: harpoon, lances, mancatcher, polearms, and trident",
                      "forbidden": ["harpoon", "lance (any)", "mancatcher", "polearm (any)", "trident"]},
    "gladiator-posp": {"match": r"Only melee and hurled missile weapons.no bows, slings, etc\..can be used by such a character", "forbidden": ["missile"]},
    "witch": {"match": r"The Witch is not allowed an initial Weapon Proficiency, nor can she acquire a Weapon Proficiency as she advances in level",
              "forbidden": ["*"]},
    # --- at 1st level only
    "beastmaster-ranger": {"match": r"A Beastmaster is initially limited to weapons that he can make himself: axe \(any\), club, dagger, dart, javelin, knife, quarterstaff, sling, or spear",
                           "initial": ["axe (any)", "club", "dagger", "dart", "javelin", "knife", "quarterstaff", "sling", "spear"]},
    "beggar-thief": {"match": r"Beginning thieves with the Beggar kit should select their two proficient weapons from among the following: club, dagger, dart, knife, sling, or staff",
                     "initial": ["club", "dagger", "dart", "knife", "sling", "staff"]},
    "beggar-thief-al-qadim": {"match": r"A beggar-thief chooses his or her two initial weapons from the following list: club, dagger, dart, knife, sling, and staff",
                              "initial": ["club", "dagger", "dart", "knife", "sling", "staff"]},
    "berserker": {"match": r"he may not start out play having a proficiency in a ranged weapon", "initialForbidden": ["missile", "dart", "javelin"]},
    "mountain-man": {"match": r"A Mountain Man must choose his initial weapon proficiencies from among the following: axe \(any\), bow \(any\), crossbow \(any\), club, dagger, dart, javelin, knife, quarterstaff, spear, staff sling, warhammer",
                     "initial": ["axe (any)", "bow (any)", "crossbow (any)", "club", "dagger", "dart", "javelin", "knife", "quarterstaff", "spear", "staff sling", "warhammer"]},
    "mystic-of-nog": {"match": r"The Mystics of Nog are limited in their choice of weapons at the start of their careers\. They may only use the sling, dart, staff, dagger, jambiya, and knife",
                      "initial": ["sling", "dart", "staff", "dagger", "jambiya", "knife"], "note": "more weapons with level, as the DM decides"},
    "savage-fighter": {"match": r"A typical set, for classic \"noble savages\": blowgun, long bow, short bow, club, dagger, javelin, knife, sling, spear\. The character must make his first-level weapon proficiencies selections from these choices",
                       "initial": ["blowgun", "long bow", "short bow", "club", "dagger", "javelin", "knife", "sling", "spear"]},
    "savage-priest": {"match": r"further limited \(when he is first created\) to the following set of proficiencies: blowgun, long bow, short bow, club, dagger, javelin, knife, sling, spear",
                      "initial": ["blowgun", "long bow", "short bow", "club", "dagger", "javelin", "knife", "sling", "spear"]},
    "savage-posp": {"match": r"At the time of character creation, a savage must choose from the following wooden weapons: quarterstaff, spear, bow, and club",
                    "initial": ["quarterstaff", "spear", "bow", "club"]},
    "seeker": {"match": r"This proficiency must be spent on one of the following weapons: club, light crossbow, dagger, dart, knife, quarterstaff, or sickle, sling\. He cannot ever use a sword of any type",
               "initial": ["club", "light crossbow", "dagger", "dart", "knife", "quarterstaff", "sickle", "sling"], "forbidden": ["sword (any)"]},
}
FIELDS = ("allowed", "extra", "forbidden", "initial", "initialForbidden")


def resolve(name, known):
    n = name.strip().lower()
    if n in ("*",):
        return ["*"]
    if n in UNAVAILABLE:
        return []
    key = ALIAS.get(n, n)
    if key in GROUPS:
        return [i for i in GROUPS[key] if i in known]
    slug = re.sub(r"[^a-z0-9]+", "-", key).strip("-")
    assert slug in known, (name, slug)
    return [slug]


def plain(wiki):
    t = re.sub(r"\[\[(?:[^\]|]*\|)?([^\]]*)\]\]", r"\1", wiki)
    t = t.replace("'''", "").replace("''", "")
    return re.sub(r"\s+", " ", t)


def main():
    known = set()
    for f in glob.glob("packs/_source/proficiencies/*.json") + glob.glob("packs/_source/aq-equipment/*.json"):
        d = json.load(open(f))
        if d.get("type") == "proficiency" and d["system"].get("kind") == "weapon":
            known.add(d["system"]["identifier"])
    # Group members without a proficiency item are dropped by resolve().
    # Classes: the PHB lists (the cleric's type rule stays generated).
    classes = 0
    for f in sorted(glob.glob("packs/_source/classes/*.json")):
        d = json.load(open(f))
        if "system" not in d:
            continue
        rule = abilities.CLASS_WEAPONS.get(d["system"]["identifier"], {})
        d["system"]["allowedWeapons"] = list(rule.get("ids", []))
        for i in d["system"]["allowedWeapons"]:
            assert i in known, (d["name"], i)
        classes += bool(rule.get("ids"))
        with open(f, "w") as out:
            json.dump(d, out, indent=2, ensure_ascii=False)
            out.write("\n")
    problems, seen = [], set()
    files = sorted(glob.glob("packs/_source/kits/*.json"))
    docs = []
    for f in files:
        d = json.load(open(f))
        docs.append(d)
        if "system" not in d:
            continue
        ident = d["system"]["identifier"]
        rule = KITS.get(ident)
        s = d["system"]
        for k in FIELDS:
            s[{"allowed": "allowedWeapons", "extra": "extraWeapons", "forbidden": "forbiddenWeapons", "initial": "initialWeapons",
               "initialForbidden": "initialForbiddenWeapons"}[k]] = []
        s["weaponsWithinClass"] = False
        s["weaponNote"] = ""
        if not rule:
            continue
        seen.add(ident)
        title = urllib.parse.unquote(s["url"].split("/wiki/")[-1]).replace("_", " ")
        text = plain(classdata.page(title)[0])
        if not re.search(rule["match"], text):
            problems.append(f"{ident}: {rule['match'][:80]}")
            continue
        for k in FIELDS:
            ids = []
            for name in rule.get(k, []):
                for i in resolve(name, known):
                    if i not in ids:
                        ids.append(i)
            s[{"allowed": "allowedWeapons", "extra": "extraWeapons", "forbidden": "forbiddenWeapons", "initial": "initialWeapons",
               "initialForbidden": "initialForbiddenWeapons"}[k]] = ids
        s["weaponsWithinClass"] = bool(rule.get("within"))
        s["weaponNote"] = rule.get("note", "")
    unknown = set(KITS) - seen
    if problems or unknown:
        raise SystemExit("Kit weapon text no longer matches (update KITS):\n  " + "\n  ".join(problems + [f"no kit {u}" for u in unknown]))
    for f, d in zip(files, docs):
        with open(f, "w") as out:
            json.dump(d, out, indent=2, ensure_ascii=False)
            out.write("\n")
    print(f"classes with weapon lists: {classes}; kits with weapon limits: {len(seen)}")


if __name__ == "__main__":
    main()
