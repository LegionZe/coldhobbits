#!/usr/bin/env python3
"""Write kit mechanics (modifiers, thief skill adjustments, thief skill points) into packs/_source/kits.

The kit pages (AD&D 2e fandom wiki, "Special Benefits" / "Special Hindrances") state their mechanics in prose, so they
are curated here, one entry per stated modifier. Each entry carries `match`, a short regular expression that must occur
in the kit page's current text (wikitext with links, bold/italic markup and spacing normalized); the script fails if
it does not, so a changed page is noticed. Conditions are paraphrased (no rule text is copied); the kit link on the
sheet has the full rules.

Modifier fields (stored on the kit item as system.modifiers):
  target    attack | damage | save | ac | skill | proficiency | ability | initiative | surprise | reaction | hp | score
  key       save key (par/rsw/pet/br/sp), thief skill key, proficiency identifiers ("a,b"), ability key; "" = all
  value     the bonus (+) or penalty (-); "ac": positive = better Armour Class; "initiative": positive = acts sooner
  every, step, from   level scaling: value + step x floor((level - from) / every) from level `from` on (every 0 = flat)
  condition when it applies; "" = always (applied automatically). Conditional ones are offered in the roll dialog.
  armor     "" | "none" (no body armour) | "light" (none, leather or padded) | "studded" (light or studded leather) |
            "any" (any body armour): applied
            automatically only while the character's equipped body armour matches.
  max       "score" only: the bonus cannot raise the score above this.
Unconditional thief skill adjustments go into system.skillAdjust; kit skill point budgets into system.skillPoints.
Run from the repo root after build-proficiency-data.py:  python3 tools/build-kit-mechanics.py
"""
import glob
import importlib.util
import json
import re
import urllib.parse

_spec = importlib.util.spec_from_file_location("classdata", "tools/build-class-data.py")
classdata = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(classdata)

SKILLS = ["pp", "ol", "rt", "ms", "hs", "dn", "cw", "rl"]
ALL_SKILLS = {k: 5 for k in SKILLS}


def m(target, value, match, key="", condition="", armor="", every=0, step=0, start=1, max=None):
    return {"target": target, "key": key, "value": value, "every": every, "step": step, "from": start,
            "condition": condition, "armor": armor, "max": max, "match": match}


def surprise(v, match, condition=""):
    return m("surprise", v, match, condition=condition)


def reaction(v, match, condition):
    return m("reaction", v, match, condition=condition)


# kit identifier -> list of modifiers
KIT_MODIFIERS = {
    # --- Al-Qadim (Arabian Adventures; The Complete Sha'ir's Handbook) ---
    "askar": [
        m("proficiency", 2, r"While askars are in their home town, they gain a \+2 bonus to proficiencies used while interacting with natives",
          condition="in the home town, dealing with its natives"),
    ],
    "astrologer-sha-ir": [
        m("proficiency", 1, r"the astrologer gains a \+1 to this ability check for every three levels", key="astrology",
          every=3, step=1, start=3),
        m("initiative", 2, r"An astrologer gains a -2 bonus to initiative rolls when using a \"hung\" spell", condition="casting a hung spell"),
    ],
    "barber": [
        m("proficiency", 2, r"A demihuman barber tending a member of the same race gains a \+2 bonus to the grooming proficiency",
          key="grooming", condition="demihuman tending a member of the same race"),
    ],
    "beggar-thief-al-qadim": [
        reaction(-4, r"members of this kit suffer a 4-point penalty to all reaction rolls involving other intelligent creatures",
                 "other intelligent creatures"),
        m("proficiency", -5, r"Even modest clothing reduces the opportunities for begging by -5", key="begging",
          condition="wearing even modest clothing"),
        m("proficiency", -5, r"magical items \(especially those in good shape\) reduce the opportunity to beg or pass unnoticed by -5",
          key="begging", condition="carrying visible magical items"),
    ],
    "clockwork-mage": [
        m("proficiency", 1, r"Gnomes, in particular, are adept at working with clockwork mechanisms and receive a \+1",
          key="clockwork-creation", condition="gnome"),
    ],
    "corsair-al-qadim": [
        reaction(-2, r"corsairs are considered marginal members of society, and as such they suffer a 2-point penalty to initial reactions",
                 "initial reactions"),
    ],
    "desert-rider": [
        m("proficiency", -1, r"When not in a desert or desertlike area, they make all proficiency checks at -1",
          condition="not in a desert or desertlike area"),
    ],
    "elemental-mage": [
        m("save", 2, r"a \+2 bonus to all saving throws against attacks using that element", condition="vs. the chosen element"),
        m("proficiency", 2, r"\+2 to all proficiency and ability checks involving that element", condition="involving the chosen element"),
        m("ability", 2, r"\+2 to all proficiency and ability checks involving that element", condition="involving the chosen element"),
    ],
    "faris": [
        reaction(4, r"A faris gains a \+4 benefit to encounter reactions with other members of his or her personal faith",
                 "members of the same faith"),
    ],
    "matrud": [
        reaction(-2, r"When dealing with desert tribes, members of this kit suffer a 2-point penalty", "desert tribes"),
    ],
    "mercenary-barbarian": [
        reaction(-2, r"When barbarians interact with those who are not of the same homeland, all reaction checks are made with a 2-point penalty",
                 "anyone not of the same homeland (best reaction: indifferent)"),
        reaction(2, r"If a barbarian attempts a \"hostile\" or \"threatening\" approach toward human or humanoid natives of Zakhara, he or she gains a 2-point bonus",
                 "hostile or threatening approach to natives of Zakhara"),
        reaction(-2, r"If a barbarian attempts a \"friendly\" or \"indifferent\" approach toward human and humanoid natives of Zakhara, he or she suffers a 2- point penalty",
                 "friendly or indifferent approach to natives of Zakhara"),
    ],
    "moralist": [
        reaction(-3, r"moralists suffer a 3-point penalty to all initial encounter reactions", "initial encounter reactions"),
    ],
    "mystic-al-qadim": [
        reaction(-2, r"Mystics also suffer a 2-point penalty to reaction rolls when dealing with pragmatist and ethoist clergy",
                 "pragmatist and ethoist clergy"),
        reaction(-4, r"and a 4-point penalty for moralist clergy", "moralist clergy"),
    ],
    "mystic-of-nog": [
        m("attack", 1, r"If used as a means of closing to attack, the wizard gains a \+1 attack bonus on his first attack",
          condition="first attack after a leap"),
    ],
    "outland-priest": [
        reaction(-2, r"they suffer a -2 penalty to reaction rolls when encountering other human and humanoid natives of Zakhara",
                 "human and humanoid natives of Zakhara"),
        reaction(-3, r"This penalty becomes -3 when they're dealing with pragmatists", "pragmatists"),
        reaction(-4, r"and -4 with ethoists and moralists", "ethoists and moralists"),
    ],
    "rawun": [
        m("proficiency", 1, r"Rawuns who own such libraries gain a \+1 bonus to all proficiency checks involving the research of an item",
          condition="researching an item, with access to own library"),
    ],
    # --- Complete Handbooks ---
    "academician": [
        reaction(3, r"receives a \+3 reaction bo", "NPCs who know his reputation, correspondents, scholars, authors, teachers"),
        m("ability", 1, r"flat \+1 to his Intelligence and Wisdom Checks", key="int"),
        m("ability", 1, r"flat \+1 to his Intelligence and Wisdom Checks", key="wis"),
        m("attack", -1, r"-1 penalty to hit on his first blow", condition="first melee blow against each new opponent"),
    ],
    "acrobat-thief": [
        m("proficiency", 1, r"bonus of \+1 whenever a proficiency check is required", key="jumping,tumbling,tightrope-walking"),
        m("proficiency", 1, r"This bonus is \+2 if the Acrobat is wearing no armor", key="jumping,tumbling,tightrope-walking",
          armor="none"),
    ],
    **{k: [
        m("attack", 3, r"\+3 (to attack rolls and \+3 damage|to hit and \+3 damage|bonus to hit and \+3 to damage)",
          condition="first blow against a male opponent who underestimates her (see kit)"),
        m("damage", 3, r"\+3 (to attack rolls and \+3 damage|to hit and \+3 damage|bonus to hit and \+3 to damage)",
          condition="first blow against a male opponent who underestimates her (see kit)"),
        reaction(-3, r"3 reaction roll adjustment from NPCs (who are )?from male-?\s?dominated societies",
                 "NPCs from male-dominated societies"),
    ] for k in ("amazon-fighter", "amazon-priestess", "amazon-sorceress")},
    "anagakok": [
        reaction(-2, r"suffers a -2 reaction penalty from all NPCs unfamiliar", "NPCs unfamiliar with the Anagakok's culture"),
        *[m(t, -1, r"suffers a -1 penalty to all attack rolls, damage rolls, Ability Checks, and saving throws",
            condition="in a climate opposite to his own (frigid: above 100 F; torrid: below 0 F)")
          for t in ("attack", "damage", "ability", "save")],
    ],
    "assassin-thief": [
        reaction(-4, r"-4 reaction penalty with non-evil NPCs", "non-evil NPCs aware of his profession"),
    ],
    "bandit": [
        surprise(1, r"Bandits gain \+1 on their attempt to surprise in a wilderness setting", "ambush in the wilderness"),
        reaction(-2, r"suffers a -2 reaction penalty among non-Bandit NPCs", "non-Bandit NPCs who recognize him"),
    ],
    "barbarian-berserker-priest": [
        reaction(1, r"receive a \+1 reaction adjustment bonus when encountering NPCs", "NPCs (+3 among his own culture)"),
        reaction(-3, r"-3 reaction adjustment penalty when encountering NPCs in positions of power",
                 "NPCs in positions of power"),
    ],
    "barbarian-fighter": [
        reaction(3, r"\+3 reaction adjustment bonus in certain situations", "reaction roll of 8 or less: 3 better"),
        reaction(-3, r"reaction roll of 14 or more, he takes an additional .3 modifier", "reaction roll of 14 or more: 3 worse"),
    ],
    "beast-rider": [
        reaction(5, r"\+5 positive reaction adjustment whenever dealing with these animals", "animals of his mount's kind"),
        reaction(-3, r"3 negative reaction adjustment when meeting NPCs from any culture but his own", "NPCs of other cultures"),
    ],
    "beastmaster-ranger": [
        *[m(t, -2, r"suffering a -2 penalty to all rolls in the next round",
            condition="round after one of his animal henchmen is wounded (24 hours if a linked one dies)")
          for t in ("attack", "damage", "save", "ability", "proficiency", "skill")],
        reaction(-1, r"-1 penalty to reaction rolls by common NPCs", "common NPCs (-2 civilized aristocracy)"),
    ],
    "beggar-thief": [
        reaction(-2, r"Beggars suffer -2 on reaction rolls with NPCs who aren't thieves", "NPCs who are not thieves"),
    ],
    "berserker": [
        reaction(3, r"receive a \+3 reaction adjustment bonus from NPCs belonging to any tribe", "tribes that have Berserkers"),
        reaction(-3, r"receives a .3 reaction from all NPCs", "all other NPCs"),
        m("attack", 1, r"While Berserk, the character gets \+1 to attack, \+3 to damage", condition="while Berserk"),
        m("damage", 3, r"While Berserk, the character gets \+1 to attack, \+3 to damage", condition="while Berserk"),
        m("save", 4, r"He gets a \+4 to save against the wizard spells blindness",
          condition="while Berserk, vs. blindness, hideous laughter, hold person/animal, charm monster, confusion"),
    ],
    "buccaneer": [
        m("skill", 5, r"bonus of \+5% on climbing rolls if ropes are involved", key="cw",
          condition="climbing ropes (+10% on a ship's ropes)"),
        m("skill", -10, r"suffer a penalty of -10% when they attempt to climb without one", key="cw",
          condition="climbing without a rope"),
        m("attack", 1, r"\+1 on attack and saving throw rolls in rope combat", condition="rope combat (+2 on shipboard ropes)"),
        m("save", 1, r"\+1 on attack and saving throw rolls in rope combat",
          condition="rope combat, where agility helps (+2 on shipboard ropes)"),
    ],
    "cavalier-fighter": [
        m("attack", 1, r"At 1st level, he gets a \+1 to attack rolls with any lance", every=6, step=1, start=1,
          condition="lance from horseback (proficient)"),
        m("attack", 1, r"At 3rd level, he gets a \+1 to attack rolls with any one type of sword", every=6, step=1, start=3,
          condition="his chosen type of sword"),
        m("attack", 1, r"At 5th level, he gets a \+1 to attack rolls with either horseman's mace", every=6, step=1, start=5,
          condition="his chosen horseman's mace, flail or pick"),
        m("save", 4, r"The Cavalier is \+4 to save vs\. all magic which would affect his mind",
          condition="magic that would affect his mind (charm, sleep, scare, command, ...)"),
        reaction(3, r"receives a \+3 reaction from anyone of his own culture", "his own culture (-3 from criminals and evil)"),
    ],
    "cutpurse": [
        m("proficiency", -5, r"the Cutpurse suffers a penalty of -5 on his proficiency check", key="observation",
          condition="checking out someone in disguise"),
    ],
    "elven-minstrel": [
        m("save", 2, r"gain a \+2 saving throw bonus against all magical effects based on music",
          condition="magical effects based on music"),
    ],
    "envoy": [
        reaction(2, r"receives a \+2 modifier on reaction rolls from all NPCs", "all NPCs, including evil ones"),
    ],
    "equerry": [
        *[m(t, -2, r"suffers a .2 penalty to all of her attack rolls, saving throws, and proficiency checks until she reunites",
            condition="separated from her mount, or mourning it (see kit)")
          for t in ("attack", "save", "proficiency")],
    ],
    "expatriate": [
        reaction(2, r"he receives a \+2 modifier to his reaction rolls",
                 "people of his homeland not tied to its former rulers; commoners elsewhere who know of him"),
        reaction(-2, r"all characters in positions of power suffer a .2 modifier to their reaction rolls",
                 "characters in positions of power"),
    ],
    "explorer-ranger": [
        reaction(1, r"gives the Explorer a \+1 reaction adjustment when encountering any other members",
                 "members of a settlement whose customs he has studied"),
    ],
    "falconer": [
        m("attack", -2, r"the Falconer makes all attack rolls and ability checks at a -2 penalty", condition="mourning his falcon"),
        m("ability", -2, r"the Falconer makes all attack rolls and ability checks at a -2 penalty", condition="mourning his falcon"),
    ],
    "fence": [
        reaction(3, r"Fences receive a bonus of \+3 on reactions with NPC thieves", "NPC thieves who recognize his profession"),
    ],
    "feralan": [
        m("attack", 2, r"the rage gives the Feralan a \+2 bonus to all attack and damage rolls", condition="during his rage"),
        m("damage", 2, r"the rage gives the Feralan a \+2 bonus to all attack and damage rolls", condition="during his rage"),
        m("ac", 2, r"his base Armor Class improves by 2", condition="during his rage"),
        reaction(-3, r"inflicts a -3 penalty when encountering human, demihuman, or humanoid NPCs",
                 "human, demihuman and humanoid NPCs"),
    ],
    "forest-runner": [
        reaction(1, r"receives a \+1 reaction modifier from peasants of good or neutral alignment",
                 "good or neutral peasants"),
    ],
    "gallant": [
        m("hp", 1, r"Gallants gain a bonus of 1 hit point each level"),
        *[m(t, 2, r"results in a \+2 bonus that can be applied to either his attack roll, damage roll, Armor Class, or saving thr",
            condition="code of the Gallant: one roll per round") for t in ("attack", "damage", "save")],
    ],
    "giant-killer": [
        m("damage", 1, r"\+1 point of damage for every level of the Giant Killer", every=1, step=1,
          condition="attacking giants"),
    ],
    "greenwood-ranger": [
        m("save", -4, r"suffers a -4 penalty to all saving throws involving fire-based attacks", condition="fire-based attacks"),
        reaction(-3, r"suffers a -3 reaction adjustment penalty when encountering any NPCs", "NPCs (see kit for exceptions)"),
    ],
    "gypsy-bard": [
        m("skill", -25, r"they suffer a 25% penalty when scaling these surfaces", key="cw",
          condition="cliffs, built walls or cave walls"),
    ],
    "jester-bard": [
        m("save", 1, r"Jesters receive a \+1 bonus \(\+5% on percentile rolls\) to most die rolls"),
        m("initiative", 1, r"Jesters receive a \+1 bonus \(\+5% on percentile rolls\) to most die rolls"),
        m("surprise", 1, r"Jesters receive a \+1 bonus \(\+5% on percentile rolls\) to most die rolls"),
        m("proficiency", 1, r"Jesters receive a \+1 bonus \(\+5% on percentile rolls\) to most die rolls"),
        m("ability", 1, r"Jesters receive a \+1 bonus \(\+5% on percentile rolls\) to most die rolls"),
        m("ac", 1, r"The fool's luck also adds a \+1 bonus to the Jester's Armor Class"),
    ],
    "medician": [
        m("proficiency", 1, r"A \+1 bonus to all Diagnostics proficiency checks", key="diagnostics"),
        m("proficiency", 1, r"A \+1 bonus for all Healing proficiency checks", key="healing"),
    ],
    "militarist": [
        m("damage", 1, r"When making an attack with his preferred weapon, the Militarist has a \+1 damage bonus",
          condition="his preferred weapon (not in jousts or tournaments)"),
        reaction(2, r"receives a \+2 reaction roll from all good and neutral characters of his own culture",
                 "good and neutral characters of his own culture"),
    ],
    "mountain-man": [
        m("save", 2, r"death magic would be fatal, the Mountain Man receives a \+2 saving throw bonus", key="par",
          condition="death magic that would kill him"),
        reaction(-1, r"He suffers a -1 reaction adjustment from all NPCs", "all NPCs (-2 nobles and cultural elite)"),
    ],
    "noble-warrior": [
        reaction(3, r"The Noble Warrior receives a \+3 reaction from anyone of his own culture", "his own culture"),
    ],
    "nobleman-priest": [
        reaction(3, r"receives a \+3 reaction from any noble of his own culture", "nobles of his own culture (+2 other nobles)"),
    ],
    "pacifist-priest": [
        m("score", 2, r"He receives a \+2 to his Charisma score \(his Charisma cannot exceed 18 from this bonus\)", key="cha", max=18),
        reaction(2, r"he receives a \+2 reaction from anyone who is not utterly opposed to his philosophy",
                 "anyone not opposed to his philosophy"),
    ],
    "patrician-wizard": [
        reaction(3, r"receives a \+3 reaction modifier from any noble from his own culture",
                 "nobles of his own culture (+2 other nobles)"),
    ],
    "peasant-priest": [
        reaction(2, r"he receives a \+2 reaction adjustment from all peasants", "peasants"),
    ],
    "peasant-wizard": [
        reaction(2, r"he always receives a \+2 reaction modifier from peasants in any culture", "peasants"),
    ],
    "prophet-priest": [
        reaction(-2, r"react to them at a -2 reaction adjustment", "ordinary people (never worse than Cautious)"),
    ],
    "riddlemaster": [
        m("ac", 1, r"The Riddlemaster has a \+1 adjustment to his Armor Class"),
        *[m(t, 1, r"A Riddlemaster receives a \+1 \(or 5%\) bonus to many die rolls")
          for t in ("save", "initiative", "attack", "damage", "proficiency", "ability")],
    ],
    "savage-fighter": [
        *[m(t, -1, r"he suffers a .1 to all attack, damage and nonweapon proficiency rolls",
            condition="wearing civilized clothing") for t in ("attack", "damage", "proficiency")],
        *[m(t, -3, r"he will suffer a .3 to all attack, damage, and nonweapon proficiency rolls while wearing any sort of armor",
            armor="any") for t in ("attack", "damage", "proficiency")],
    ],
    "savage-priest": [
        reaction(-2, r"he suffers a -2 reaction adjustment from all civilized folk", "civilized NPCs"),
    ],
    "savage-wizard": [
        reaction(-2, r"he suffers a -2 reaction adjustment from all NPCs not from his own tribe", "NPCs not of his tribe"),
    ],
    "scholar-priest": [
        reaction(3, r"the Scholar receives a \+3 reaction bonus from other scholars", "scholars and admirers (1 in 6 scholars: -6)"),
    ],
    "scout-thief": [
        m("skill", 10, r"Scouts gain \+10% on two thief skills when in the wilderness", key="ms", condition="in the wilderness"),
        m("skill", 10, r"Scouts gain \+10% on two thief skills when in the wilderness", key="hs", condition="in the wilderness"),
        m("skill", -5, r"In the city, consequently, the Scout suffers a -5% penalty on all thieves' skills", condition="in a city"),
    ],
    "sea-ranger": [
        m("save", 2, r"any saving throws or Dexterity checks made to maintain his balance are made at a \+2 bonus",
          condition="keeping his balance (on a ship)"),
        m("ability", 2, r"any saving throws or Dexterity checks made to maintain his balance are made at a \+2 bonus", key="dex",
          condition="keeping his balance (on a ship)"),
    ],
    "seeker": [
        m("attack", -1, r"suffers a -1 penalty to all ability checks and attack rolls the following day",
          condition="the day after neglected meditation"),
        m("ability", -1, r"suffers a -1 penalty to all ability checks and attack rolls the following day",
          condition="the day after neglected meditation"),
    ],
    "skald": [
        m("attack", 1, r"The Skald fights with a \+1 attack roll bonus any time he is singing or chanting during combat",
          condition="singing or chanting in combat"),
        m("damage", 1, r"the Skald gains a \+1 damage bonus when using a broadsword, axe \(any type\), or spear while he is chanting",
          condition="chanting with a broad sword, axe or spear he is proficient with"),
    ],
    "skyrider": [
        m("attack", 1, r"all nonmissile attacks made by either the bonded mount or the Skyrider receive a \+1 modifier to hit",
          condition="nonmissile attack while airborne"),
        *[m(t, -2, r"the Skyrider suffers a .2 penalty to all attack, ability, and proficiency rolls",
            condition="mourning his bonded mount") for t in ("attack", "ability", "proficiency")],
    ],
    "smuggler-thief": [
        surprise(1, r"they therefore get a \+1 bonus to their surprise roll"),
    ],
    "swashbuckler-fighter": [
        m("ac", 2, r"when he's wearing light or no armor \(i\.e\., no armor, leather armor, or padded armor\), he receives a .2 bonus to his AC",
          armor="light"),
        reaction(2, r"he always receives a \+2 adjustment on his reaction roll from NPC members of the opposite sex",
                 "NPCs of the opposite sex"),
    ],
    "swashbuckler-thief": [
        reaction(2, r"a \+2 reaction adjustment with members of the opposite sex", "NPCs of the opposite sex"),
    ],
    "thespian": [
        m("ac", 2, r"In any round that a Thespian wins initiative, he gains a \+2 bonus to his Armor Class and saving throws",
          condition="a round in which he wins initiative"),
        m("save", 2, r"In any round that a Thespian wins initiative, he gains a \+2 bonus to his Armor Class and saving throws",
          condition="a round in which he wins initiative"),
        m("attack", 1, r"and a \+1 bonus to attack rolls", condition="a round in which he wins initiative"),
    ],
    "thug-thief": [
        m("attack", 1, r"Thugs receive \+1 on their \"to hit\" rolls"),
    ],
    "votary": [
        m("attack", 4, r"A Votary earn a \+4 bonus to her attack rolls when fighting priests or followers of the hated faith",
          condition="priests or followers of the hated faith, recognized as such"),
    ],
    "warden": [
        reaction(2, r"a Warden receives a \+2 bonus to his reaction checks with all good and neutral characters of high social status",
                 "representing his overlord, with good or neutral people of high status"),
    ],
    "wilderness-warrior": [
        m("proficiency", 5, r"The Wilderness Warrior gets a special bonus of \+5 to his Survival proficiency roll", key="survival"),
    ],
    "witch": [
        reaction(-3, r"the Witch receives a -3 reaction roll", "most NPCs (-5 uneducated or superstitious)"),
        m("attack", -2, r"The Witch suffers a -2 penalty to her attack rolls and a -2 penalty to her saving throws",
          condition="internal struggle (full moon nights, by the DM's option)"),
        m("save", -2, r"The Witch suffers a -2 penalty to her attack rolls and a -2 penalty to her saving throws",
          condition="internal struggle (full moon nights, by the DM's option)"),
    ],
    "wyrmslayer": [
        m("save", 4, r"He gains a \+4 bonus to his saving throws to avoid the effects of fear from all other species of evil dragons",
          condition="fear from evil dragons other than his principal foe"),
        m("damage", 1, r"he receives a damage bonus equal to his level", every=1, step=1, condition="hitting his principal foe"),
        m("damage", 1, r"against an evil dragon other than his principal foe, he receives a \+1 damage bonus",
          condition="other evil dragons"),
        reaction(-4, r"the Wyrmslayer suffers a .4 penalty to all encounter reactions with his principal foe",
                 "his principal foe"),
    ],
    # --- Player's Option: Skills & Powers kits (Benefits / Hindrances); subabilities are not used (owner's ruling) ---
    "acrobat-posp": [
        m("proficiency", 2, r"If unarmored, acrobats receive a \+2 bonus to tumbling, tightrope-walking, and jumping proficiency checks",
          key="tumbling,tightrope-walking,jumping", armor="none"),
        m("ac", 2, r"they gain a \+2 bonus to Armor Class versus hurled missile weapons",
          condition="against hurled missiles, with room to dodge"),
        m("proficiency", -1, r"Any acrobat who wears armor heavier than studded leather \(AC 7\) suffers a .1 penalty to tumbling, tightrope-walking, and jumping",
          key="tumbling,tightrope-walking,jumping", condition="armour better than AC 7: -1 per point (tick once per point)"),
    ],
    "amazon-posp": [
        m("attack", 2, r"in any melee combat where an Amazon is fighting a male opponent, the Amazon gains a \+2 bonus to her first attack and damage roll",
          condition="first attack of a melee against a male opponent"),
        m("damage", 2, r"in any melee combat where an Amazon is fighting a male opponent, the Amazon gains a \+2 bonus to her first attack and damage roll",
          condition="first damage roll of a melee against a male opponent"),
        reaction(-2, r"Amazons suffer a .2 reaction roll penalty from NPCs of male-dominated societies", "NPCs of male-dominated societies"),
    ],
    "assassin-posp": [
        m("proficiency", 1, r"An assassin with the healing proficiency can treat poison victims with a \+1 bonus to his proficiency check",
          key="healing", condition="treating a poison victim"),
        reaction(-4, r"Assassins suffer a .4 reaction roll penalty whenever they encounter someone who knows their profession",
                 "someone who knows the profession"),
    ],
    "beggar-posp": [
        reaction(-4, r"This equates to a .4 reaction roll penalty if the beggar is trying to socialize with the upper crust",
                 "socializing with the upper classes"),
    ],
    "cavalier-posp": [
        m("save", 2, r"he gains a \+2 saving throw bonus against all mind-affecting magics", condition="against mind-affecting magic"),
    ],
    "diplomat-posp": [
        reaction(2, r"he receives a \+2 bonus to all reaction rolls", ""),
    ],
    "gladiator-posp": [
        m("attack", 1, r"Gladiators enjoy a \+1 bonus on attack rolls with one particular melee weapon", condition="the chosen melee weapon"),
        m("initiative", -1, r"they suffer a \+1 penalty to their initiative rolls"),
    ],
    "jester-posp": [
        m("ability", 1, r"Jesters enjoy a \+1 bonus to Charisma when they are working an audience", key="cha", condition="working an audience"),
        reaction(-1, r"When trying to conduct business deals or when socializing, NPCs have a .1 reaction roll penalty toward them",
                 "business deals or socializing"),
    ],
    "mariner-posp": [
        reaction(2, r"Mariners enjoy a \+2 bonus on reaction rolls from sailors, ship captains, and aquatic races",
                 "sailors, ship captains and aquatic races"),
        m("attack", 1, r"they gain a \+1 to hit bonus with nets", condition="with a net"),
        reaction(-2, r"When there is no water in sight, they are out of their element, and they suffer a .2 reaction roll penalty",
                 "no water in sight"),
    ],
    "merchant-posp": [
        reaction(1, r"merchants receive a \+1 reaction roll bonus in city settings", "in a city"),
        m("proficiency", 2, r"merchants with the appraising proficiency gain a permanent \+2 bonus to that skill", key="appraising"),
        reaction(-2, r"he suffers a .2 penalty to all reaction rolls until his innocence is proven",
                 "publicly accused of cheating (replaces the +1)"),
    ],
    "noble-posp": [
        reaction(2, r"Player character nobles receive a \+2 reaction roll bonus when interacting with individuals from the upper class and upper middle class",
                 "upper and upper middle class"),
    ],
    "pirate-posp": [
        m("attack", 1, r"They gain a \+1 bonus to their attack rolls while fighting at sea", condition="fighting at sea"),
        reaction(-2, r"Pirates suffer a .2 penalty on reaction rolls when they enter a port", "entering a port"),
    ],
    "savage-posp": [
        m("initiative", -2, r"They suffer a .2 initiative penalty when traveling within the confines of a town or keep",
          condition="in a town or keep"),
    ],
    "scholar-posp": [
        m("ability", 1, r"Scholars gain a \+1 bonus either to Intelligence or Wisdom checks \(player's choice\)", key="int",
          condition="if Intelligence was chosen (player's choice: Intelligence or Wisdom)"),
        m("ability", 1, r"Scholars gain a \+1 bonus either to Intelligence or Wisdom checks \(player's choice\)", key="wis",
          condition="if Wisdom was chosen (player's choice: Intelligence or Wisdom)"),
        m("proficiency", 1, r"including proficiency checks based on Intelligence or Wisdom",
          condition="proficiency based on the chosen ability (Intelligence or Wisdom)"),
        m("initiative", -1, r"All scholars suffer a .1 penalty on their initiative rolls when fighting"),
    ],
    "scout-posp": [
        m("proficiency", 1, r"Scouts gain a \+1 bonus to all nonweapon proficiency checks while in the wilderness or natural cave settings",
          condition="in the wilderness or natural caves"),
        m("proficiency", -1, r"They suffer a .1 penalty on all nonweapon proficiency checks when in such locales",
          condition="in a town or dungeon"),
    ],
    "sharpshooter-posp": [
        m("attack", 1, r"Sharpshooters gain a \+1 bonus to attack and damage rolls with one particular missile weapon",
          condition="the chosen missile weapon, used as a missile"),
        m("damage", 1, r"Sharpshooters gain a \+1 bonus to attack and damage rolls with one particular missile weapon",
          condition="the chosen missile weapon, used as a missile"),
        m("initiative", -1, r"he suffers a .1 penalty on initiative rolls for melee combat", condition="melee combat"),
    ],
    "smuggler-posp": [
        m("proficiency", 2, r"If a smuggler chooses the appraising nonweapon proficiency, he gains a \+2 bonus to that proficiency score",
          key="appraising"),
    ],
    "spy-posp": [
        reaction(2, r"he receives a \+2 bonus for all NPCs' reaction rolls", ""),
    ],
    "swashbuckler-posp": [
        m("ac", 2, r"When unarmored or wearing armor no heavier than studded leather, swashbucklers gain a \+2 armor class bonus",
          armor="studded"),
        reaction(2, r"swashbucklers gain a \+2 reaction roll bonus from NPC members of the opposite sex", "NPCs of the opposite sex"),
    ],
    "thug-posp": [
        m("damage", 1, r"thugs gain a \+1 bonus to all damage rolls"),
    ],
}

# Unconditional thief skill adjustments (percent). Ranger kits: the ranger's hide in shadows / move silently are rated
# "in natural surroundings" (Ranger (PHB)), so "+n% to hide in natural surroundings" applies to that skill.
KIT_SKILLS = {
    "beastmaster-ranger": ({"hs": 5}, r"The Beastmaster has a \+5% chance to hide in natural surroundings"),
    "feralan": ({"hs": 10, "ms": 10}, r"The Feralan receives a \+10% chance to hide in natural surroundings and a \+10% chance to move silently"),
    "forest-runner": ({"hs": 5, "ms": 5}, r"The Forest Runner has a \+5% chance to hide in natural surroundings and a \+5% chance to move silently"),
    "justifier": ({"hs": 5, "ms": 5}, r"The Justifier receives a \+5% bonus to his chance of hiding in natural surroundings and to his chance of moving silently"),
    "stalker-ranger": ({"hs": 10, "ms": 10}, r"A Stalker has a \+10% bonus to his base chance to hide in shadows/hide in natural surroundings and a \+10% bonus to his chances to move silently"),
    "greenwood-ranger": ({"ms": -5}, r"The Greenwood Ranger has a -5% penalty when trying to move silently"),
    "mountain-man": ({"hs": -5, "ms": -5}, r"The Mountain Man has a -5% chance to hide in natural surroundings and a -5% chance of moving silently"),
    "jester-bard": (ALL_SKILLS, r"\+5% on percentile rolls\) to most die rolls\. This includes saving throws, initiative, surprise, proficiency checks, thief skill checks"),
    "riddlemaster": (ALL_SKILLS, r"\+1 \(or 5%\) bonus to many die rolls, including saving throws, individual initiative, attacks rolls, damage rolls, proficiency checks, thief skill checks"),
}

# Thief skill discretionary points: [at 1st level, per level after] (default Thief (PHB): 60, 30).
KIT_POINTS = {
    # Barber: "only 40 percentage points are available to thieves using this kit, and only 10 points to bards who are
    # barbers" (per level: the class default). Third value: bards' points at 1st level.
    "barber": ([40, None, 10], r"only 40 percentage points are available to thieves using this kit, and only 10 points to bards who are barbers"
                               r".*?additional percentage points are gained as usual for advancement in level"),
    "assassin-thief": ([40, 20], r"They start with only 40 discretionary points to allocate at 1st level, and with each level gained they receive only 20 points"),
    "thug-thief": ([40, 30], r"has only 40 points to distribute initially among his thief skills"),
}


# Weapon specialization exceptions stated on kit pages (Weapon Specialization (PHB): fighters only, one weapon).
# mode: "allowed" (the kit's class may specialize), "required" (allowed, and the kit must take one), "forbidden";
# free: weapon proficiency identifiers specialized at no slot cost (allowed even if the class may not specialize).
KIT_SPECIALIZATION = {
    # "Like a fighter, the holy slayer is allowed to specialize in the use of one weapon."
    "holy-slayer": ({"mode": "allowed", "free": []}, r"Like a fighter, the holy slayer is allowed to specialize in the use of one weapon"),
    # "the Justifier must use some of his initial proficiency slots to take one weapon specialization"
    "justifier": ({"mode": "required", "free": []}, r"must use some of his initial proficiency slots to take one weapon specialization"),
    # "The Errant receives a free specialization in the jousting lance."
    "errant": ({"mode": "", "free": ["jousting-lance"]}, r"receives a free specialization in the jousting lance"),
    # "Mystics may not specialize in weapons."
    "mystic-al-qadim": ({"mode": "forbidden", "free": []}, r"Mystics may not specialize in weapons"),
}


def normalize(wiki):
    w = re.sub(r"\[\[(?:[^\]|]*\|)?([^\]]*)\]\]", r"\1", wiki)
    w = w.replace("'''", "").replace("''", "").replace("&nbsp;", " ")
    return " ".join(w.split())


def kit_pages(docs):
    titles = {d["system"]["identifier"]: urllib.parse.unquote(d["system"]["url"].split("/wiki/", 1)[1]).replace("_", " ")
              for d in docs}
    text, revs = {}, {}
    items = list(titles.items())
    for i in range(0, len(items), 40):
        batch = dict(items[i:i + 40])
        r = classdata.api(action="query", prop="revisions", rvprop="content|ids", rvslots="main", titles="|".join(batch.values()))
        by_title = {p["title"]: p for p in r["query"]["pages"].values()}
        for ident, title in batch.items():
            p = by_title[title]
            text[ident] = normalize(p["revisions"][0]["slots"]["main"]["*"])
            revs[ident] = p["revisions"][0]["revid"]
    return text, revs


if __name__ == "__main__":
    files = sorted(glob.glob("packs/_source/kits/[!_]*.json"))
    docs = [json.load(open(f)) for f in files]
    idents = {d["system"]["identifier"] for d in docs}
    unknown = (set(KIT_MODIFIERS) | set(KIT_SKILLS) | set(KIT_POINTS) | set(KIT_SPECIALIZATION)) - idents
    assert not unknown, f"curated kits not in packs/_source/kits: {sorted(unknown)}"
    text, revs = kit_pages(docs)
    problems = []
    check = lambda ident, pattern: re.search(pattern, text[ident]) or problems.append(f"{ident}: /{pattern}/")
    counts = {"modifiers": 0, "skills": 0, "points": 0}
    for f, doc in zip(files, docs):
        ident = doc["system"]["identifier"]
        mods = []
        for entry in KIT_MODIFIERS.get(ident, []):
            check(ident, entry["match"])
            mods.append({k: v for k, v in entry.items() if k != "match"})
        adjust = {k: 0 for k in SKILLS}
        if ident in KIT_SKILLS:
            values, pattern = KIT_SKILLS[ident]
            check(ident, pattern)
            adjust.update(values)
        points = None
        if ident in KIT_POINTS:
            points, pattern = KIT_POINTS[ident]
            check(ident, pattern)
        spec = {"mode": "", "free": []}
        if ident in KIT_SPECIALIZATION:
            spec, pattern = KIT_SPECIALIZATION[ident]
            check(ident, pattern)
        doc["system"]["specialization"] = spec
        doc["system"]["modifiers"] = mods
        doc["system"]["skillAdjust"] = adjust
        doc["system"]["skillPoints"] = ({"first": points[0], "perLevel": points[1], "bardFirst": points[2] if len(points) > 2 else None}
                                        if points else {"first": None, "perLevel": None, "bardFirst": None})
        counts["modifiers"] += len(mods)
        counts["skills"] += ident in KIT_SKILLS
        counts["points"] += ident in KIT_POINTS
    if problems:
        raise SystemExit("Kit text no longer matches (check the page and update KIT_MODIFIERS):\n  " + "\n  ".join(problems))
    for f, doc in zip(files, docs):
        with open(f, "w") as out:
            json.dump(doc, out, indent=2, ensure_ascii=False)
            out.write("\n")
    print(f"kits updated: {counts['modifiers']} modifiers in {len(KIT_MODIFIERS)} kits, skill adjustments in "
          f"{counts['skills']}, skill points in {counts['points']}, specialization rules in {len(KIT_SPECIALIZATION)}")
