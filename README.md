# coldhobbits — AD&D 2e system for Foundry VTT (unofficial)

Mechanics-only system; no copyrighted rule text. System id: `ad2e`.

> **AI-generated code.** This repository is generated with [Claude Code](https://claude.com/claude-code) (Anthropic), under the direction and review of the repository owner. Rules tables and mechanics must be verified against an owned copy of the AD&D 2e rulebooks.

## Regenerating data
`tools/build-all.sh` runs every generator in dependency order.

## Install
- Manifest URL (Foundry > Install System): `https://github.com/LegionZe/coldhobbits/releases/latest/download/system.json`
  Every push to `main` runs `.github/workflows/release.yml`, which publishes release `v<version>` (with `ad2e.zip`
  and `system.json`) if it does not already exist. Bump `version` in `system.json` to publish an update.
- Manual: copy the repository contents into `Data/systems/ad2e/` and restart Foundry.
- `github.com/.../blob/...` URLs return HTML and cannot be used as a manifest URL.

## Status (v1.0.19)
First stable release (2026-10-06). Covered:
- Characters: races, classes and kits (PHB, Complete handbooks, Skills & Powers, Al-Qadim), ability score methods,
  proficiencies (PHB, optional Skills & Powers ratings and weapon rules), traits and disadvantages, class abilities,
  spells (learning, memorization, components, damage), encumbrance and containers; optional dual-class and multi-class
  characters; energy drain and restoration.
- Combat: initiative (individual, group, standard), attacks and damage with the PHB/DMG modifiers, two weapons, unarmed
  combat, mounted combat, Combat & Tactics weapons (firearms, lasso, net), death and healing rules.
- Monsters, hirelings, mounts, pack animals, familiars, Skills & Powers animal companions and mounts, sha'ir gens;
  monster and spell importers; treasure and magical items with identification.
- GM manual and player guide in the Settings sidebar.

Confirmed in Foundry 14.368 by the owner up to 0.0.88, and since then feature by feature as each was tried. Not yet
confirmed in Foundry (tested in Node only): the Skills & Powers Pugilist, Barbarian and Mystic features, social ranks
and the Weapon Master Display button (0.0.129), the race and alignment fit warnings for companions and mounts
(0.0.133), the energy drain details (forgetting excess spells, death below 0-level, age) and the lasso (0.0.134), and
the net (0.0.135), poison (1.0.10), magic resistance and spell save requests (1.0.11), item saving throws and falling damage
(1.0.13), ageing and PHB Table 52 (1.0.14), critical hits (1.0.15), and attack options (1.0.16). The features are listed under "Verify before use" below.

## Known limitations
- Subabilities and character points are not used (owner's decision); Skills & Powers costs are paid in slots.
- With the Skills & Powers weapon rules, a multi-class character specializes on its main class's row of Tables 53/54
  (the multi-class row is not applied).
- Dual-class: the PHB's per-adventure choice of class while restricted is not tracked (the tick boxes in the dialogs
  and the experience penalty are).
- Net: its hand-to-hand block and disarm are not modelled; a trapped victim is described in chat, not marked.
- Lasso and net dialogs are for characters; a monster attacking with either makes a normal attack.
- Overland terrain movement is not modelled; psionics are not included; monster pictures are never shipped.

## GM creators
- Create monster (GM manual > GM tools, or `game.ad2e.createMonster()`; 1.0.1): a guided window for a Monster / NPC
  actor. Size, intelligence and morale show their Monstrous Manual bands ("How to use this Book (MM)" rev 265382);
  THAC0 (DMG Table 39) and saving throws follow the Hit Dice; experience is DMG Table 31 for the Hit Dice plus the
  Table 32 special-ability modifiers ticked ("Add the additional Hit Dice for special powers from Table 32 ... a 1 + 1
  Hit Die creature with +2 Hit Dice of special abilities becomes a 3 + 1 Hit Dice creature", Experience Point Awards
  (DMG) rev 71130; the orc, rust monster and green slime examples are asserted by tools/build-creator-tables.py; the two
  spell rows are not cumulative), or a value typed in. Hit points are rolled; the actor is created in the world or an
  unlocked world compendium and its sheet opens. The window is 720 px high with a scrolling body (1.0.2).
- Create weapon (GM manual > GM tools, or `game.ad2e.createWeapon()`; 1.0.3): a weapon item, optionally with a matching
  weapon proficiency (refused if that identifier already exists) or linked to an existing one. Start from any weapon in
  the Item compendiums or the Items directory, or a blank weapon; set size, type (B/P/S), speed factor, two damage rows
  (small/medium and large; e.g. one- and two-handed), melee/missile, rate of fire and range (yards), family, the Table 35
  specialist missile column, Strength use, two hands regardless of size, magical hit/damage bonuses, cost, weight and
  notes (the weapon sheet shows the statistics read-only). Checks: a use ticked, damage as dice, a missile range, a
  B/P/S type.
- Create item (GM manual > GM tools, or `game.ad2e.createItem()`; 1.0.4): equipment (category), a container (capacity
  in pounds or a volume; only items with a capacity are offered as a start), armour (body armour AC -10 to 10, a shield's
  bonus vs. melee and missiles and attackers covered, a helmet; size made for; magical bonus) or ammunition (launchers
  chosen from the missile weapons that take ammunition; damage dice; magical bonuses). Starts from an item of that kind
  or blank; the cost must read as a number and a coin ("5 gp", "2 sp each"). The weightless container option is left to
  the magic item creator (only magical items store it).
- Create magic item (GM manual > GM tools, or `game.ad2e.createMagicItem()`; 1.0.5): a magical item (DMG Table 88
  category; charges when found for wands 1d20+80, rods 1d10+40, staves 1d6+19, the patterns checked again on Wands /
  Rods / Staves (DMG) by build-creator-tables.py, rolled at creation if ticked; usable-by groups; XP and gp values; a
  container's capacity and "weightless"), or magical arms: a copy of a weapon, armour or ammunition item with a bonus
  (-5 to +5) named "<base> +N", its XP value from DMG Tables 105/107 (TREASURE_ROLLS.arms: armour +1 500 to +5 3,000;
  swords +1 400 to +5 3,000, a sword being a weapon of the Skills & Powers "swords" group; other weapons +1 500, +2
  1,000, +3 2,000; none listed beyond) written in the notes, as weapon and armour items have no XP field. Unidentified
  unless ticked.
- Create patron (GM manual > GM tools, or `game.ad2e.createPatron()`; 1.0.6): a Monster / NPC actor with the new role
  "Patron". Race, class group and level (a classed NPC rolls its group's Hit Dice for the level, PHB Tables 14/20/23/25,
  with THAC0 from Table 53 and saves as that group; a 0-level NPC has 1d6 hit points, implementation choice), alignment,
  AC and morale (Monstrous Manual band). Occupation, wealth, what the patron wants and offers, and the reward are notes.
  Personality: DMG Table 70 (rev 241274; 20 general and 100 specific traits, asserted) chosen or rolled as "1d20 for a
  major trait, percentile dice for characteristics" (Personality (DMG) rev 71256, regex-checked), so the specific trait
  may come from another group as in the DMG's example; appearance words (age, height, build, hair, speech, face) from the
  same page, chosen or rolled.
- Create spell (GM manual > GM tools, or `game.ad2e.createSpell()`; 1.0.7): a wizard or priest spell with the fields the
  spell sheet cannot set: schools (the PHB's nine, "The Schools of Magic (PHB)" rev 70614) or spheres (its sixteen,
  "Priest (PHB)" rev 281481), plus typed ones; up to three damage or healing options. Level, components, range, area,
  casting time, duration, save and notes too. Advice from "Spell Research (DMG)" rev 71310 (regex-checked): the
  suggested level for the first damage option's dice ("a spell which inflicts 5d6 points of damage should be about 3rd
  to 5th level", read as dice - 2 to dice), the group's highest spell level (9 / 7), research time ("two weeks per spell
  level", plus "another week" per failed check) and cost ("100-1,000 gp per spell level"). The research check for a chosen
  character: a wizard's chance to learn the spell (with specialization and the other learning limits), a priest's
  Wisdom check; a researched spell can be added to that character when created. Material component links and
  elemental provinces are set on the spell sheet afterwards.
- Create trap (GM manual > GM tools, or `game.ad2e.createTrap()`; 1.0.8; owner's rulings): a trap actor (Monster / NPC
  actor, new role "Trap", placed as a token: pits, deadfalls) or a trap item (equipment, new category "Trap", put on the
  object it guards: a chest's needle). Each hits either by an attack at its THAC0 against the victim's AC or by the
  victim's saving throw (avoided or halved on a success), chosen per trap; damage dice, trigger, effect, reset, and a
  find/remove modifier up to +/-30% ("A device can be listed with a modifier of + or - up to 30%", Advanced Locks and
  Traps (CTH) rev 134844, regex-checked). Both sheets have an editable Trap section and a GM "Spring" button
  (module/traps.mjs): the targeted tokens are attacked or roll their saves, one damage roll goes to those hit (and half
  to those who saved for half), with the usual apply buttons. Find/Remove Traps offers the targeted trap's modifier
  (trap actors and trap items on targeted actors) and a silent attempt: "-10% ... quietly on any roll except 01-10%"
  (CTH; Open Locks too); a roll of 96-100 still springs the trap (Thief Skill Explanations (PHB)).
- Automatic encounter XP (1.0.9; owner's rulings): when the GM ends a combat with monsters in it, the Award Experience
  window opens (world setting "Experience window when a combat ends", default on) with the dead monsters ticked and the
  combat's characters as recipients (otherwise the player-owned characters). A monster with no XP value gets DMG Table 31
  for its Hit Dice (marked "calculated"; Table 32 abilities need the value set on the monster). DMG Table 34 individual
  class awards (Experience Tables (DMG) rev 249158: warriors "10 XP/level" per Hit Die of creature defeated, read as 10
  per Hit Die; bards 5; "Individual awards are optional", Experience Point Awards (DMG), both regex-checked): a tick box
  per warrior or bard (multi-class: the larger rate), for the Hit Dice of the ticked monsters, added to that character's
  share before the prime requisite bonus and the dual-class rules.

## Poison and save requests
- Poison (1.0.10; owner's rulings: every carrier, full tracking, Save buttons plus a GM roll-all): DMG Table 51
  ("Poison (DMG)" rev 179519) is generated into `module/rules/poison-tables.mjs` by `python3 tools/build-poison-data.py`,
  which regex-checks the rules used: the strength columns ("The number before the slash lists the hit points of damage
  suffered if the saving throw is failed. The number after the slash lists the damage taken (if any) if the saving throw
  is successful"), death, the methods ("Contact poisons have full effect even if swallowed or injected"; "Injected and
  ingested have no effect on contact"; given the other way, "the save damage being applied if the saving throw is failed
  and no damage occurring if the saving throw is successful"), paralytic poisons ("unable to move for 2d6 hours") and
  debilitating poisons (1d3 days, "All of the character's ability scores are reduced by half", "one-half his normal
  movement rate", no healing "until the poison is neutralized"). Ranges are read as dice (2-12 = 2d6, 10-30 = 10d3, 2-5 =
  1d4+1; implementation choice). It also writes the "Poisons (DMG)" compendium (one item per class, quantity = doses;
  Table 51 gives no prices).
- Carriers: monster natural attacks (Poison column; the poison's own method), weapons and ammunition ("Coat with poison"
  from an owned poison item, one dose per weapon or missile, used up by each damage roll: implementation choice;
  injected), traps (class and delivery) and the GM tool "Poison targets" (`game.ad2e.poisonTargets()`; any delivery).
- A damage roll with a poisoned carrier posts a save request vs. paralyzation, poison or death magic
  (`module/save-requests.mjs`): Save buttons for the targets' owners, "Roll every remaining save" for the GM. The PHB
  Table 9 Constitution bonus vs. poison is added. The active GM records each save, rolls the onset (whispered) and applies
  the effect when world time reaches it (damage, death, paralysis with the core "paralysis" status, debilitation with
  the "Debilitated (poison)" status; healing is refused while debilitated). The sheets show pending poison; the GM's
  "Neutralize poison" button ends it without restoring hit points ("the neutralize poison spell doesn't recover hit
  points already lost"). Slow poison and herbalism are left to the GM (e.g. advance or neutralize).
- Magic resistance (1.0.11; owner's ruling: monsters and a character field, rolled automatically on casting):
  "Magic Resistance (DMG)" rev 71210 / "Magic Resistance (PHB)" rev 70416: "If the roll is equal to or less than the
  creature's magic resistance, the spell has no effect on the creature"; "Creatures, however, can lower their magic
  resistance at will" (tick box "Lowered"); "If a magic resistance roll fails ... the target can make all saving throws
  normally allowed against the spell". Neither text adjusts for the caster's level, so nothing is adjusted. Monsters use
  the first percentage of their Magic Resistance text ("Nil" = 0); characters `system.magicResistance` { value, lowered }
  (Main tab, next to the saves). Rolled for every targeted creature when a spell is cast (`module/magic-resistance.mjs`).
- Spell save requests (1.0.11; owner's ruling: Save buttons plus a GM roll-all): when the spell's Save entry is not
  None, the cast card asks the unresisted targets to save vs. the spell's "Save vs." category (new spell field
  `saveType`, default spell; it is not read from the spell page). The Damage roll splits by the recorded saves:
  failed or unrolled saves take full damage, successful saves half ("1/2"), none ("Neg."), or a separate full-damage
  message marked for the GM ("Neg. or 1/2" and other entries); resisted targets take none.
- Item saving throws (1.0.13; owner's rulings: material guessed and editable, GM tool + button on failed saves + after a
  fall, fragile items ticked, failed items marked destroyed): DMG Table 29 ("Damaging Equipment (DMG)" rev 249885) is
  generated into `module/rules/item-save-tables.mjs` by `python3 tools/build-item-save-tables.py`, which regex-checks the
  rules used: carried items save "only when ... a character fails his saving throw against the same attack"; "Items with
  a plus ... gain that plus as a bonus"; "A potion would have a +1 while a miscellaneous magical item could have a +5 or
  +6" (+5 used; magical item field "Item save bonus"); "+2 is allowed" when designed to counter (tick box); falls "greater
  than five feet", soft +5, -1 per five feet beyond the first; gradual cold +2. A "—" in the table is read as unaffected
  (implementation choice). Item `system.material` ("" = guessed from type, category and name; `module/item-saves.mjs`).
  A failed item is renamed "(destroyed)", flagged `ad2e.destroyed`, unequipped and no longer carried.
- Falling damage (1.0.13): "1d6 points of damage for every 10 feet fallen, to a maximum of 20d6" (Special Damage (DMG)
  rev 238117; per full 10 feet). GM tool `game.ad2e.falling()`; the damage message carries `notAttack`, so applying it
  makes no massive-damage check (that rule is for "a single attack"; implementation choice).
- Ageing (1.0.14; owner's rulings: automatic, starting age roll, GM maximum age): PHB Tables 11 and 12 ("Character Race
  Tables (PHB)" rev 167919) are generated into `module/rules/aging-tables.mjs` by `python3 tools/build-aging-tables.py`;
  the Table 12 footnotes are parsed and asserted, Table 12 ages are checked against 1/2, 2/3 and all of the Table 11 base
  maximum, and "Other Characteristics (PHB)" rev 70537 is regex-checked for the 18/xx Strength rule ("half of his
  exceptional Strength rating"; "all his exceptional Strength and 1 point more") and "All ageing adjustments are
  cumulative". The changes apply to the effective scores from `system.age` and the race (after kit score bonuses);
  half of an exceptional rating is rounded down (implementation choice). GM-only `system.maxAge` with a whisper when reached.
- Weapon type vs. armour (1.0.14; owner's rulings: world setting, automatic, monster attack type): PHB Table 52 ("Weapon
  Types vs. Armor Modifiers (PHB)" rev 70322) in `module/rules/armor-type-tables.mjs` (`python3 tools/build-armor-type-tables.py`;
  values "applied to the attacker's THAC0", i.e. subtracted from the attack roll; chain mail includes bronze plate,
  leather includes padded and hide; armour identifiers asserted). The first target's worn body armour; the weapon's (or
  missile's) best type; none against a natural Armor Class or armour outside the table (e.g. lamellar).
- Critical hits (1.0.15; owner's rulings: world setting Off / System I / System II, System II charts linked, not
  copied): `module/rules/critical-tables.mjs` by `python3 tools/build-critical-tables.py` from "Critical Hits: System I
  (POCT)" rev 74684 ("natural 18 or higher and hits the target by a margin of 5 or more"; "double damage dice, calculated
  before adjustments"; "do not double the multiplied damage; add it instead", the lance's 3d6 asserted), "Critical Hits:
  System II (POCT)" rev 74686 (save vs. death; chart by weapon type and humanoid / animal / monster, "If in doubt ... call
  it a monster"; location d10, d6 low, 1d6+4 high; called shots keep their location; severity 1d6 / 2d4 / 2d6 / 2d8 by
  weapon size vs. target size; 13+ triple dice even on a save; arrows and bolts M, heavy crossbow bolts L) and the nine
  Hit Location Charts of "Critical Hit Tables (POCT)" rev 178184 (ranges and location names only). Implementation
  choices: monster natural attacks count as weapons of the monster's size; a weapon of several types uses the first type
  (or the Table 52 type); monster `bodyType` ("" = monster).
- Called shots and attack options (1.0.16; owner's rulings: world setting, all options, defender rolled automatically):
  `module/rules/attack-option-tables.mjs` by `python3 tools/build-attack-option-tables.py` from "Hitting a Specific Target
  (DMG)" rev 71148 ("+1 penalty to his initiative", "-4 penalty") and "Attack Options (POCT)" rev 250488 (called shot -6/-8;
  block vs. AC 4; disarm / grab / trap "against AC 0 ... against an AC 4", two-handed +4, no disarming a weapon two sizes
  larger, "falls 1-10 feet away"; grab -3 Strength one-handed; sap -4 / -8 helmet, Small or Medium, 5% per point (max 40%),
  10% (max 80%) against a helpless victim, 3d10 rounds, 25% real; shield-punch and shield-rush tables and modifiers;
  the pull/trip weapon list mapped to identifiers, polearms from the Skills & Powers group). Implementation choices: the
  defender's THAC0 without adjustments; the body shield is "Large"; the disarmed weapon's direction a d8 compass point.
  Monsters: called shot, disarm, grab, trap, block.
- Spell importer check (1.0.12, owner's request): after an import the "Imported Spells" compendium is read back from the
  server; a missing compendium or imported pages without a spell show an error (and the console lists them) instead of
  the success message. Import errors are reported the same way. Reason: an import on 14.368 reported "created" while
  the compendium did not exist afterwards; the cause was not found (a later import worked).

## Verify before use
- Ability tables (PHB Tables 1-6, scores 1-25, STR 18/01-18/00) are generated into `module/rules/ability-tables.mjs` by
  `python3 tools/build-ability-tables.py` from the AD&D 2e fandom wiki (revision ids recorded in the file). They are a
  starter set for testing; check them against an owned Player's Handbook. THAC0 comes from PHB Table 53 (the level-20+ progression is checked against it).
- Saving throws (PHB Table 60), hit dice and XP (PHB Tables 14/20/23/25) are generated into
  `module/rules/level-tables.mjs` by `python3 tools/build-level-tables.py`. Saves follow class group and level (with
  per-save override); "Roll 1st-Level HP" and "Level Up" roll hit points (CON adjustment, minimum 1 per die, fixed
  bonus without CON after level 9/10).
- Races are Items (type `race`) in the "Races (PHB)" compendium, generated by `python3 tools/build-race-data.py`
  (PHB Tables 7, 8, 9 and the race pages). Stored ability scores are the rolled scores (checked against Table 7);
  effective scores add the Table 8 adjustment and drive all tables and rolls. Table 9 CON bonus is added to rod/staff/wand
  and spell save rolls, and to saves answering a poison save request (1.0.10). The race limits which classes can be dropped. Racial level limits come from a table supplied by the
  repository owner; Complete Bard's Handbook kits add kit-specific racial limits and open the bard class to demihumans
  (kit-only classes need a kit that lists the race).
- Multi-class characters: optional world setting (see the multi-class entry below); otherwise each character has one
  class at a time and at most one kit (dual-class characters keep their earlier classes, see below).
- Proficiencies are Items (type `proficiency`) in the "Proficiencies" compendium (370 nonweapon from the wiki's
  proficiency pages, PHB values from Table 37; 63 weapon from the PHB weapon list), generated by
  `python3 tools/build-proficiency-data.py`. Slots follow PHB Table 34 (+ Intelligence languages for nonweapon,
  + kit bonus slots); cross-group nonweapon proficiencies (Table 38) cost one extra slot. Extra slots spent on a
  nonweapon proficiency (field on the proficiency sheet) add +1 each to its checks ("For every additional proficiency
  slot a character spends on a nonweapon proficiency, he gains a +1 bonus", Nonweapon Proficiencies II (PHB)). Adding a
  kit adds its bonus proficiencies (free) and required proficiencies (use slots). THAC0 now comes from PHB Table 53.
- Weapon proficiencies carry PHB weapon data (Weapon List: size, type, speed factor, damage S-M/L incl. ammunition and
  bastard-sword grips; Table 45: rate of fire and ranges). The Proficiencies tab rolls attack and damage per weapon:
  melee uses Strength; missile uses Dexterity plus Strength for hurled weapons (bows: Strength penalties only; crossbows:
  none; slings: damage only), range modifiers medium -2 / long -5; damage never below 1. Attacks per round: Table 15
  (warriors) or Table 45 rate of fire.
- Weapon specialization (optional PHB rule; single-class fighters, one weapon): +1 slot (+2 for bows); melee +1 to hit
  and +2 damage, also when a melee weapon is thrown (PHB "all his attack rolls with that weapon"; darts, slings and
  the blowgun get only the Table 35 attacks); bow/crossbow point-blank range (+2 to hit); Table 35 attacks per round
  (bow specialists gain none).
  Toggle it on the weapon row or the proficiency sheet. Weapon proficiencies added before 0.0.14 have no weapon data;
  remove and re-add them from the compendium.
- Weapons and ammunition are Items (types `weapon`, `ammunition`) in the "Weapons (PHB)" compendium (63 weapons with
  cost and weight, 9 ammunition types), generated with the proficiencies. A weapon links to the weapon proficiency with
  the same identifier: without it, attacks take the Table 34 non-proficiency penalty; with a specialized proficiency
  (fighters), the specialization bonuses apply. Weapons and ammunition can carry a magical attack/damage bonus.
- Ammunition tracking: ammunition lists the launchers it fits. Firing a bow, crossbow, sling or blowgun asks which owned
  ammunition to use and subtracts one; with none left the attack is refused. Throwing a weapon item (daggers, darts,
  spears, axes...) subtracts one from its quantity. Quantities have -/+ buttons on the Weapons tab; recovered
  missiles are added back by hand.
- Armour is an Item (type `armor`) in the "Armour (PHB)" compendium: 14 body armours with their PHB Table 46 AC,
  4 shields and 2 helmets, with cost and weight from the PHB armour list (`python3 tools/build-armor-data.py`).
  Equipped body armour replaces the base AC (minus its magical bonus); an equipped shield improves AC against front
  and flank attacks (body shield: 2 against missiles). The Weapons & Armour tab shows front, rear (no shield, no
  beneficial Dexterity adjustment) and missile AC. Helmets have no AC effect in the PHB.
- Encumbrance and movement (world setting "Encumbrance rule": basic Table 47 categories (default), specific Table 48
  movement, or off). Load = weapons, ammunition and armour weights + other gear + 5 lb clothing; magical armour counts
  toward the maximum only. Movement starts from the race's Table 64 rate; encumbrance lowers it and applies the PHB
  attack/AC penalties. A footer shows sneak (cautious, ft), walk (yd), combat, jog, run (x3/x4), sprint (x5),
  march and, with the Jumping proficiency, jump rolls. Tables generated by `python3 tools/build-movement-tables.py`.
- Coins are Items (type `coin`) in the "Equipment (PHB)" compendium: platinum, gold, electrum, silver and copper, each
  worth its PHB Table 42 value in copper pieces (foreign coins can set their own). A dropped stack joins an owned stack
  of the same coin. The Equipment tab lists coin stacks with editable quantities, the total value in gp and the weight
  (50 coins of any metal to the pound, DMG), which counts toward encumbrance. Coin counts entered in 0.0.20 are moved
  into coin items when a GM loads the world.
- The rest of the PHB Table 44 equipment lists are Items (type `equipment`) in the same compendium, one folder per list:
  clothing, daily food and lodging, household provisioning, transport, animals, services, tack and harness, and
  miscellaneous equipment (219 items, cost and weight as listed; "*" items weigh 1/10 lb, "**" none). Containers carry
  their Table 50 capacity and animals their Table 49 carrying capacity. Carried items count toward encumbrance (weight x
  quantity); animals, transport, services, lodging and tack start as not carried.
- Items inside containers: any weapon, ammunition, armour, equipment, magical item, gem/jewellery or coin item can be put
  into a container on the same actor (drag its row onto the container in the Containers list, or choose "In container"
  on the item's sheet; "Take out" removes it). Containers are the Table 50 items (backpack, baskets, belt pouches, chests,
  sacks, saddle bags; "Aside from knowing the weight limits, your character needs to have ways to hold all his gear",
  Encumbrance Tables (PHB)) and magical items with a capacity. Contents count toward the load while the container is
  carried and not at all when it is left behind (for example a sack not carried, or saddle bags on a mount count toward
  the mount's load); each container shows its contents' weight against its Table 50 capacity and is marked when over.
  Magical containers (generated, checked by regex against each page): Bag of Holding and Portable Hole contents add no
  weight ("the bag always weighs a fixed amount", Bag of Holding (Magic Bag); "does not accumulate weight", Portable
  Hole (Magic Container)); a bag of holding's weight and limits are rolled on its page's table, so the GM enters them on
  the item. Heward's Handy Haversack holds 20 + 20 + 80 lb; its page compares only the side pouches to a bag of holding,
  so its contents count. A bag of holding and a portable hole placed inside one another are flagged (Portable Hole
  (Magic Container)). Putting a weapon, armour or worn magical item into a container stops using it; equipping takes it
  out. A container dragged to another actor does not take its contents along.
- Monster / NPC actors (type `monster`) for monsters, hirelings, mounts and pets (tabs: Combat, Specials, Ecology,
  Inventory, Notes; a summary line with AC, THAC0, HD, movement, attacks, damage, morale, no. appearing, treasure, XP): Monstrous Manual stat block, Hit Dice
  as written (3, 3+3, 1-1, 1/2, 2-8 hp) with HP rolls, THAC0 from DMG Table 39, saving throws by Hit Dice (DMG; half for
  non-intelligent creatures except vs. paralyzation, poison and death), 2d10 morale checks, natural attacks plus owned
  weapons, AC from equipped armour, and a mount's load against PHB Table 49. The "Monsters & NPCs (prototypes)"
  compendium has an orc (monster), a riding horse with saddle and bags (mount) and a mercenary with spear, short sword
  and studded leather (hireling), generated by `python3 tools/build-monster-data.py`.
- Spells are Items (type `spell`: class, level, school/sphere, components, range, area, casting time, duration, save,
  sources, link). The character sheet's Spells tab lists them by spell level with slots from PHB Tables 21 (wizard), 24
  (priest), 17 (paladin, ranger) and 32 (bard): Intelligence maximum spell level and spell book size for wizards and
  bards, the specialist's extra school spell, cumulative Wisdom bonus spells for clerics and druids, 6th/7th level
  needing Wisdom 17/18. Memorize with -/+, Cast posts the statistics and link, Rest restores memorized spells.
  Dropping a spell warns about another class's spells, opposition schools and the paladin/ranger spheres.
  "Spells (examples)" has 12 PHB spells; GMs import more with Configure Settings > "Import spells" (or
  `game.ad2e.importSpells()`): choose a source book from the AD&D 2e wiki, filter by class and level, import (statistics
  and links only) into the world compendium "Imported Spells" (created on the first import), filed into folders by
  class and spell level, e.g. Wizard Spells / Level 3; re-import updates spells from the same page. "Update existing
  spells" (importer button, or `game.ad2e.updateSpells()`, GM) re-reads the wiki page of every spell in the world (Items
  directory, characters' spells, Imported Spells compendium; page from the import flag or the spell's wiki link) and
  refreshes its statistics and component links, keeping name, memorization, learned status and notes; spells without a
  wiki page are left alone.
- Elemental mage (Al-Qadim kit; Elemental Mage (Character Kit), https://adnd2e.fandom.com/wiki/Elemental_Mage_(Character_Kit)):
  choose the province (flame, sand, sea, wind) on the Class tab (shown whenever the kit is on the character, found by
  identifier or name). "+1 to each damage die inflicted with an attack using
  that element (magical or otherwise)": spell damage of a spell in that province, and weapon damage with the "Attack
  uses <province>" tick box. "if the mage suffers an attack using the specialty element, a -2 penalty is applied to
  each damage die (with a minimum of no damage inflicted)": damage messages from such attacks carry their dice, and
  applying them to an elemental mage of that province counts each die at -2 (at least 0). Spell provinces are set at
  import from "Appendix A: Wizard Spells by Province (AA)" (117 spells; module/rules/province-tables.mjs, generated by
  tools/build-province-tables.py) and from element tags in the school ("(Fire)" = flame, water = sea, air = wind, earth =
  sand); editable on the spell sheet. Spell damage (since 0.0.87): a spell's damage and healing options (label, formula with @level = casting level, damage or
  healing, per round) are read from its page at import by a general parser (module/importers/spell-damage.mjs; no
  per-spell data and no page text are kept) and edited on the spell sheet. The Spells tab's damage button asks which
  option to roll; damage messages are applied like weapon damage, healing messages get heal buttons only. Import,
  re-import and "Update existing spells" fill only spells without options.
- Spell components: the "Spell Components (POSM)" compendium holds POSM Table 16 (381 components in its 7 groups, with
  acquisition FS/TM/SO/Auto, scarcity, cost, perishable and "in a wizard's laboratory"; generated from "Spell Components
  (POSM)"). Spells with an M component link them, matched automatically at import from the page's component sentences
  (only the links are stored, never the text): Table 16 names in several word orders ("Bell, tiny" also as "tiny bell",
  "Mica, chip" as "chip of mica", "Bar, iron, magnetized" as "magnetized iron bar", plurals), sentences read without
  articles and with "A or B C" alternatives, the match ending last winning an overlap; holy symbols and holy/unholy
  water link the PHB holy item. Matching is imperfect (in the PHB 231 of 311 spells with M get links since 0.0.100;
  items Table 16 leaves out, such as Identify's 100 gp pearl, are not found; a few extra links, e.g. a plain feather for
  Fear): check and fix the links
  on the spell sheet (Consumed tick box, remove, add from the component list). Consumed by default: "Whatever the
  component, it is automatically destroyed or lost when the spell is cast, unless the spell description specifically
  notes otherwise" (Casting Spells (PHB)); a component named in a sentence calling it reusable or not consumed is
  kept, and holy symbols are never consumed. World setting "Track material components" (off by default; optional per
  Material Spell Components (POSM)): Cast checks the caster's equipment for each linked component, removes one of each
  consumed one, and for missing ones warns and asks to cast anyway; the chat card lists what was used or missing.
- Class abilities (Class Abilities tab): thief skills from PHB Tables 26-29 (base, race, Dexterity, armour) plus a kit
  adjustment (entered on the kit item) and discretionary points (60 at 1st level, +30 per level; at most 30 on one skill
  at 1st level and 15 per level after; 95% maximum); bard abilities (Table 33, 20 points + 15 per level); ranger hide in
  shadows / move silently (Table 18, studded leather or lighter). Skill rolls are d100 at or under the total (96-100 sets
  a trap off). A skill below 1% after adjustments is marked "!" and cannot be rolled until points raise it to at least
  1% ("the character must spend points raising his skill percentage to at least 1% before he can use the skill",
  Thief (PHB)). Thieves: backstab option in melee attack (+4) and damage (weapon dice x Table 30, then bonuses). Clerics
  (and paladins from 3rd level, two levels lower) turn undead with Table 61 (d20, 2d6 affected, D* 2d4 more). Paladins:
  +2 to all saves, lay on hands (2 hp per level, once a day; Rest restores it), cure disease per week. Rangers: species
  enemy and tracking bonus. Class features are listed with the level gained and a link to the class page. Tables from
  `python3 tools/build-class-ability-tables.py`.
- Kit recommended proficiencies: the proficiencies a kit page recommends (or suggests) are listed on the kit, the Class
  tab and the Proficiencies tab (1,272 entries in 118 kits; only names that match a proficiency exactly, weapon ones
  included; vague entries such as "Any" or "sword (any)" are left to the kit page). They are shown, not granted.
- Kit weapon specialization exceptions (otherwise fighters only, one weapon): Holy Slayer may specialize in one weapon
  ("Like a fighter, the holy slayer is allowed to specialize in the use of one weapon"); Justifier must take one
  specialization (warning on the Proficiencies tab until one is ticked); Errant gets the jousting lance specialized
  free (no extra slots, automatic; "The Errant receives a free specialization in the jousting lance"); Mystic
  (Al-Qadim) may not specialize. Curated in `tools/build-kit-mechanics.py` `KIT_SPECIALIZATION`, each checked against
  the kit page.
- Kit mechanics: numeric modifiers stated on 61 kit pages (attack, damage, saves, Armour Class, thief skills, proficiency
  and ability checks, initiative, surprise, reaction, hit points per level, Charisma) and thief skill point budgets
  (Assassin, Thug) are curated by `python3 tools/build-kit-mechanics.py`, which checks each against the current kit page.
  Unconditional ones apply automatically (some only in no/light/any body armour); situational ones are tick boxes in
  the attack, damage, save, ability check, proficiency, thief skill and surprise dialogs; reaction ones are tick boxes
  in the encounter reaction roll (below). A modifier limited to one proficiency (e.g. Cutpurse, -5 on Observation) is offered only on that check. Level-scaled ones (e.g. Cavalier, Wyrmslayer) follow the character's level. Abilities without a number
  (special powers, spells, followers) stay on the kit page.
  Kit items copied into a world or onto characters before 0.0.31 get the mechanics from the compendium when a GM
  loads the world (only kits without modifiers; skill adjustments a GM entered are kept).
- "Hirelings & Mounts" compendium (`python3 tools/build-hireling-data.py`): 18 soldier types from DMG Table 64 with
  monthly wage and the equipment their DMG descriptions name (weapons left to the GM where the DMG says they vary;
  the optional handgunner is left out), 8 hirelings from DMG Table 65 with weekly/monthly wage, statistics from the
  Monstrous Manual human types (Human (MM)), 9 mounts (draft, heavy, medium, light war and riding horses, pony,
  desert and war camel, elephant) and 4 pack/draft animals (role "Pack / draft animal": mule, ox from the Herd Mammal
  Cattle column, war dog, and the yak from the Yak page's "Bull (wild ox)" row, owner's choice) from the Monstrous Manual
  with PHB Table 49 load and price (the yak has no PHB price). The yak carries the DMG note "Their sure footing allows
  them to reduce all mountain movement rates by one" (Movement (DMG); overland terrain is not modelled). Wage or price
  shows in the sheet header.
- Familiars (Find Familiar (Wizard Spell), https://adnd2e.fandom.com/wiki/Find_Familiar_(Wizard_Spell); the d20 table and
  the spell's figures are generated into module/rules/familiar-tables.mjs and checked by regex): a Familiar section on
  a wizard's Bio tab. The GM's "Find Familiar" button rolls the casting time (2d12 hours) and the d20 table, whispered
  to the GMs ("The DM secretly determines all results"), notes the 1,000 gp of incense and herbs and warns when the last
  attempt was less than a year of world time ago ("it can be attempted but once per year"). A familiar that comes is
  created from the Hirelings & Mounts compendium (folder Familiars: black cat, crow, hawk, owl, toad, weasel; other
  statistics from their Monstrous Manual / Compendium pages; the toad from Amphibian (Poisonous), Neotropical Toad,
  Dragon Magazine #237, owner's choice, as no core stat block exists) with "2-4 hit points plus 1
  hit point per caster level, and an Armor Class of 7", owned like the wizard, and linked (one at a time; a familiar
  actor can also be dropped on the sheet). While it lives and is within the 1 mile link the wizard gets "+1 bonus to
  all surprise die rolls"; ticked Separated, it loses 1 hit point per day of world time (applied by the GM's client).
  When it dies, a button rolls the wizard's system shock ("or die") and removes 1 point of Constitution. Its sensory
  powers are shown. "When the familiar is in physical contact with its wizard, it gains the wizard's saving throws
  against special attacks": the familiar's save dialog offers the wizard's saving throw (ticked when their tokens touch);
  applying damage to a familiar touching its wizard asks whether it was a special attack (saved: no damage; failed:
  half).
- Mounts and pack animals on a character: drop a mount, pack animal or pet actor on the character sheet (other actors
  become henchmen; one dropped from a compendium is first imported into the world, since a compendium entry cannot
  carry a load; a compendium link saved by 0.0.75 shows an Import button that replaces it with a world copy); the Equipment tab lists each with its load, PHB Table 49 band and movement. Tick "Riding" for the
  animal the character rides (one at a time): its load then includes the rider, "When calculating a mount's load, be
  sure to include the weight of the rider!" (Encumbrance (PHB)), i.e. the character's body weight plus everything the
  character carries (encumbrance load, clothing included). Body weight is entered on the Equipment tab or rolled on PHB
  Table 10 (base for the race and sex plus the modifier dice; generated into race-tables.mjs). Animals are loaded with
  items as before (saddle bags and other containers count while carried); "up to a maximum of twice their normal load",
  beyond which the animal cannot move. The animal's own sheet shows its rider. While riding, the sheet footer and the
  movement figure show the mount's movement with the rider in its load, per round (tens of yards outdoors) and per day:
  "all mounts are able to move a number of miles per day equal to their movement rate", pushed to double (Movement (DMG),
  Mounted Overland Movement).
- Pushing a mount (Movement (DMG)): the Push button on a mount's or pack animal's sheet rolls the saving throw vs.
  death for double movement (-1 per previous consecutive day; ponies, donkeys and mules +2; failure: lame, normal speed
  until rested a day) or triple movement (-3; success: spent, rest 1d3 days; failure: the animal dies). The state shows
  on the animal's sheet and the rider's animal list.
- Fighting from horseback (Unusual Combat Situations (DMG)): "a character gets a +1 bonus to his chance to hit creatures
  smaller than his mount ... would not gain this bonus against another rider"; "Those on foot who fight against a
  mounted rider, have a -1 penalty". Melee dialogs (characters and monsters) have the tick box, ticked from the first
  target. Riders of a mount not trained for combat have -2 to hit ("Those fighting from the back of untrained creatures
  suffer a -2"; war mounts trained by default, a select on the monster sheet). Missile fire from a moving mount uses DMG
  Table 53 (0/-1/-3/-5 by the mount's movement), steps the rate of fire down one (owner's ruling) and warns about the
  riding proficiency and weapons that cannot be fired from horseback.
- Riders and mounts on the canvas (world setting "Riders move with their mounts", on by default): a character riding an
  animal (Ride on the sheet) and that animal's token move together; moving either token moves the other along the same
  path, keeping their positions, when they touch at the start of the move (Foundry v14 moveToken hook).
- Ability score generation: the dice button on the Abilities panel opens a roller for PHB Methods II-VI ("Rolling
  Ability Scores (PHB)"): II 3d6 twice per ability, keep one; III 3d6 six times, assign; IV 3d6 twelve times, assign
  six; V 4d6 drop lowest six times, assign; VI every ability 8 plus seven d6 added whole, none above 18. Rolls use
  Foundry dice and are posted to chat; the racial adjustment and effective score are previewed; Apply sets the rolled
  scores, and a warrior whose Strength comes to 18 can roll percentile dice for exceptional Strength (Strength (PHB)).
- Hit points, death and healing (world setting "Death rule"): dead at 0 hit points (Character Death, PHB), or the DMG
  optional "Hovering on Death's Door": characters fall unconscious at 0, lose 1 hit point each combat round until their
  wounds are bound, and die at -10; a cure restores such a character to 1 hit point only, weak and feeble until a day of
  rest. Monsters die at 0. Damage of 50 or more from a single attack calls for a saving throw vs. death. Damage, Heal,
  Rest (natural healing: 1 a day, 3 a day of bed rest plus the Constitution bonus per week), Bind wounds and Raise
  (resurrection survival roll, Constitution -1) on the character sheet; Damage and Heal on monster sheets. Token status
  icons show unconscious and dead.
- Combat tab (character sheet): hit points, THAC0 and movement with Damage, Heal and Surprise buttons; the weapons in
  hand with their attack and damage rolls, a Stow button (sheathed or stowed, still carried) and a Drop button (no
  longer counted toward encumbrance; "Pick up" on the Equipment tab), and the unarmed attacks; the worn armour and Armor
  Class; and the class abilities (thief, bard and ranger skills, backstab, turning undead, paladin powers). Weapons and
  armour are equipped with the Equipped tick box on the Equipment tab only. The Equipment and Class Abilities tabs use
  the same lists (shared partials).
- Initiative ("Initiative (PHB)"): 1d10, lowest first. Rolling one combatant from the combat tracker asks for its
  action: attack with a weapon in hand (speed factor, less its magical bonus, never below 0; the bastard sword one- or
  two-handed), cast a memorized spell (numeric casting time; a round or more acts at the end of the round), use a
  magical item (potion +4, ring +3, rod +1, staff +2, wand +3, other +3), breath weapon +1, innate ability +3, or a
  monster's natural weapons by size (Table 56); plus the Table 55 situations (hasted, slowed, higher ground, ...) and a
  modifier with reason. Roll All / Roll NPCs add each combatant's automatic action: the weapon of its last attack if
  still in hand, else its fastest weapon in hand; a monster without weapons, its natural weapons (size). Reading a
  scroll asks for the casting time of its spell (Table 56: "Casting time of spell"). A combatant that casts gets no
  benefit from "Hasted" that round ("Since she is casting a spell, she gains no benefit from the haste spell").
  World setting "Initiative method": Individual (each combatant rolls; optional rule, the default), Group ("one
  initiative die roll is still made for each side", each combatant adds its own action modifiers; optional rule) or
  Standard ("roll 1d10 for each side in the battle"; the side acts on its roll, situations and a modifier still apply).
  Sides are token dispositions (friendly, neutral, hostile); the GM's first roll for a side in a round rolls its 1d10
  and posts it to chat, and a player rolling before that is asked to wait. Tables from
  `python3 tools/build-combat-tables.py`.
- Targets: attack and damage rolls record the tokens the rolling user has targeted (shown as "→ name" in chat); a damage
  roll made with no target uses the targets of the same actor's last attack with that weapon. The attack dialog's
  target AC is filled in from the first target (vs. missiles for missile attacks) when the user may see that actor.
  Damage messages show buttons for the GM under the roll: "Apply to: <targets of the roll>", "My targets" (the GM's
  current targets), "Selected" and "Heal selected"; the same actions are in the message's right-click menu (for players
  too). Only owners (the GM) can change a token's hit points; other users get a warning.
- Surprise: "Surprise" on the character sheet and the eye button on monster sheets roll 1d10, surprised on 1-3
  ("The Surprise Roll (PHB)"), with the Dexterity reaction adjustment ("Dexterity (PHB)"), kit surprise modifiers, the
  DMG Table 57 situations ("Surprise (DMG)"; tick boxes, camouflage -1 to -3, +1 per 10 members of the other group) and
  a manual modifier. Table from `python3 tools/build-encounter-tables.py`.
- Automatic damage (client setting "Roll damage automatically on a hit", on by default): when a weapon or monster
  attack hits, its damage is rolled at once with the attack's choices (the ammunition fired, backstab multiplier,
  non-lethal, the +4 against an unarmed attacker) and the first target's size (Large or bigger: the large damage
  column). Unconditional kit modifiers apply; for situational kit modifiers, another damage option (e.g. the bastard
  sword two-handed) or a modifier, turn the setting off or use the Damage button.
- Combat modifiers (PHB Table 51, "PHB Table 51"): every attack dialog (weapons, monster attacks, unarmed, the generic
  attack) has tick boxes for attacker on higher ground +1, defender invisible -4, defender off-balance +2, defender
  sleeping or held (automatic hit: "the attack automatically hits and causes normal damage"), defender stunned or
  prone +4, defender surprised +1 and rear attack +2 (missile range stays a separate field). The first target's token
  status icons tick them: Prone or Stunned +4; Asleep, Paralyzed, Restrained or Unconscious automatic hit; Invisible
  -4 (core status ids, checked on core 14.368). Table from `python3 tools/build-combat-tables.py`.
- Learning spells (Intelligence (PHB) Table 4, Specialist Wizard (PHB), Wizard (PHB)): dropping a wizard spell on a
  wizard or bard asks "Roll to learn", "Add as known (no roll)" or "Do not add". The roll is d100 at or under the
  Intelligence "Chance to Learn Spell", specialists +15% for their school and -15% for other schools; it is not possible
  for an opposition school, above the Intelligence maximum spell level, when the level already holds Table 4's "Max # of
  Spells per Level" (optional rule, world setting "Maximum spells per level", on by default), or again before the next
  level after a failure ("they cannot check that spell again until they advance to the next level"). A spell not
  understood stays in the list with its chance and a Learn button; it is not counted as known and cannot be memorized.
- Henchmen ("Henchmen (PHB)", "Henchmen (DMG)", Charisma (PHB) Table 6): drag an actor onto a character sheet to make it
  a henchman (Bio tab). The section shows the Charisma maximum as a lifetime count (current henchmen plus a "Lost"
  number: "This is a lifetime limit, not just a maximum possible at any given time"), the Loyalty Base and the henchman
  morale (DMG Table 49: 15, plus the Loyalty Base). A character henchman of equal or higher level is flagged ("Should he
  ever equal or surpass the PC's level, the henchman leaves forever"). Morale button: 2d10 at or under the rating, with
  the DMG Table 50 situations as tick boxes; monster sheets' Morale uses the same tick boxes. Tables from
  `python3 tools/build-encounter-tables.py`.
- Followers and strongholds ("Fighter (PHB)", "Ranger (PHB)", "Cleric (PHB)", "Thief (PHB)", "Bard (PHB)", "Paladin (PHB)",
  "Warrior Tables (PHB)" Tables 16/19, "Rogue Tables (PHB)" Table 31, "Followers (PHB)"; `python3 tools/build-follower-tables.py`,
  every rule regex-checked): the Bio tab records the stronghold (name, kind, built) and shows each class's follower level.
  Fighter 9th ("the fighter must have a castle or stronghold"), bard 9th with a stronghold ("The bard attracts 10d6
  0th-level soldiers"), cleric 8th with "a place of worship" ("The cleric attracts 20 to 200 of these followers"; rolled
  2d10 x 10 with the troop types set by the GM: owner's ruling), ranger 10th ("a ranger attracts 2d6 followers", Table 19,
  "*" results rerolled when already present), thief 10th ("The thief attracts 4d6 of these fellows", Table 31, levels
  rolled); "A paladin does not attract a body of followers". The GM's "Attract followers" button rolls once per class
  ("Followers appear only once.") and creates one Monster / NPC actor per unit (owner's ruling: role "Follower unit",
  `unitSize` = figures, hit points of one figure; levelled followers use the class group's hit dice, THAC0 and saves,
  0-level soldiers the Mercenary stat block), with the Table 16 equipment from the compendiums (magical bonuses applied;
  equipment without an item, such as lances, polearm choices or mounts, as notes). Table 19 creatures use the Hirelings &
  Mounts actors where one exists, else a placeholder with the wiki link. The stronghold is a record only (owner's ruling:
  no construction costs or time). Multi-class characters get each class's followers.
- Weather and travel (GM tool "Weather and travel": Configure Settings, the GM manual, or `game.ad2e.travel()`;
  `python3 tools/build-travel-tables.py`, every table parsed and every rule regex-checked against "Movement (PHB)",
  "Movement (DMG)", "Terrain Obstacles and Hindrances (DMG)", "Movement on Water (DMG)", "Aerial Movement (DMG)" and
  "Getting Lost (DMG)"). The DMG has no general weather generator; the day's weather uses the two procedures it gives
  (owner's ruling): Table 79 ("roll 2d6", by season; "Hurricanes occur only if the previous day's weather was gale"),
  adverse winds ("rolling 1d6. On a 5 or 6, the winds are unfavorable") and precipitation ("During summer and winter, a
  6 on the die indicates rain or snow. In spring and fall, a 5 or 6 is rain"; storms and hurricanes always). It is kept
  as the world's weather (editable). The planner takes the selected tokens (the slowest member sets the pace; a rider
  uses the mount's rate) and works out the day:
  - on foot "twice his movement rate in miles", force march "2 1/2 times"; mounts "a number of miles per day equal to
    their movement rate"; hitched animals at half rate; vehicles stop on terrain costing more than 1 without a road or trail;
  - Table 74 points per mile per terrain leg, trails half ("Trails through settled farmland offer no improvement"),
    roads 1/2 point on level or rolling ground and as trails in mountains, Table 75 obstacles (added points, then
    multipliers; the weather ticks rain/snow/gale entries: implementation choice);
  - boats (Table 76, current added or subtracted, sail triples the "*" boats) and ships (Tables 77/78, adverse winds,
    seaworthiness checks, off course at storm strength) for the hours set (10 by default: implementation choice);
  - flying (clear sky as clear terrain, Table 80 multipliers, cumulative; no flight in a hurricane);
  - getting lost (Tables 81/82, one blind d100 for the GM; "If the die roll is less than the percentage, the characters
    are lost"; the worked example's 15% is asserted).
  Force march: at the end of the day a Constitution check (creatures: save vs. death) with -1 per earlier consecutive day
  (counted as the mount push: implementation choice); a failure stops force marching until rested; each day gives -1 to
  all attack rolls, cumulative (character and monster attacks), and "Rest" removes one day per half day. Table 73
  (optional, one round in difficult terrain) is listed in the character sheet's movement line. The day's card has an
  "End day" button (GM) that advances world time by the travel hours (owner's ruling).
- Random encounters (GM tool "Random encounters": Configure Settings, the GM manual, or `game.ad2e.encounters()`;
  `python3 tools/build-encounter-check-tables.py`, tables parsed and rules regex-checked against "DMing Encounters (DMG)",
  "DMG Table 56", "Random Encounters (DMG)", "Creating Encounter Tables (DMG)", "DMG Table 54", "DMG Table 55" and
  "Encounter Distance (DMG)"). Checks: Table 56 chance ("the number or less that must be rolled on 1d10"), +1 "patrolled
  or sparsely settled", +2 "heavily populated", dungeons "every hour, with an encounter occurring on a roll of 1 on 1d10"
  or "once per turn" in dangerous parts, plus the DM's own modifier. Owner's rulings: checks from the GM's button, the
  travel card's "End day" (the day's terrain), and automatically when world time passes (optional; at the marked times
  of day, or each hour/turn underground; not during a combat; stopping at the first encounter); encounter tables are
  RollTables, built by the tool from creatures dragged in and text entries in the DMG's 2-20 layout ("adding the roll of
  1d8 to that of 1d12", Table 54 positions, repeated or doubled entries) or percentile layout (70% / 20% / 7% / 3%
  divided among each frequency's entries); a table level lowers frequencies by Table 55 levels ("each level of
  difference between creature and table decreases the frequency of appearance by one"); unique creatures are refused
  ("should never be used on random encounter tables"). An encounter rolls the table and the number appearing (the
  stat block's range read as dice) and whispers the GM a card with buttons for Table 58 distance, surprise (the
  creature, or each selected token: the existing Table 57 dialog) and reaction (Table 59). Implementation choices:
  travel terrain to Table 56 rows (`TRAVEL_TERRAIN`), terrain to Table 58 cover, percentile rounding (largest remainder,
  at least 1%), 2-20 filling (nearest frequency for an empty one; more than twice the positions are left out and listed).
- Encounter reactions (DMG Table 59, "Encounter Reactions (DMG)"): the speech-bubble button on monster sheets (or
  `game.ad2e.rollReaction()` in a macro) rolls 2d10, lower is friendlier, and reads the column for how the player
  characters behave (friendly, indifferent, threatening, hostile): flight, friendly, indifferent, cautious,
  threatening or hostile. The speaking character's Charisma reaction adjustment (PHB Table 6) and kit reaction
  modifiers (unconditional ones automatically, conditional ones as tick boxes) are subtracted, so a bonus makes the
  reaction friendlier; a manual modifier covers the creature's description and morale modifiers. The result is shown
  to the GM only. Table from `python3 tools/build-encounter-tables.py`.
- Armour size and class limits ("Armor (PHB)"; class pages): armour items have "Made for size" (blank = made for its
  wearer). Armour made for another size does not fit and gives no Armor Class (marked in the armour list); weight
  follows the size it was made for ("Small armor weighs half the amount listed, while large armor weighs 50% more"),
  so a halfling's or gnome's own armour weighs half. Class limits are marked in the armour list (the armour still
  counts): wizards wear no armour, helmet or shield ("Wizards cannot wear any armor"); thieves leather, padded,
  studded leather or elven chain; bards up to and including chain mail and no shield; druids padded, hide or leather,
  wooden shields only (material is not recorded: shown as a note). Table in `module/rules/class-tables.mjs`
  (`classArmor`, from `python3 tools/build-class-ability-tables.py`, each rule checked against its class page).
- Class weapon limits (owner's ruling: a warning on the weapon row and in the attack dialog, the roll is not blocked):
  standard clerics "only blunt, bludgeoning weapons" (Table 45 type B alone, owner's ruling: P/B and B/S weapons such as
  the lucern hammer are excluded); druids "club, sickle, dart, spear, dagger, scimitar, sling, and staff"; thieves "club,
  dagger, dart, hand crossbow, knife, lasso, short bow, sling, broad sword, long sword, short sword, and staff"; wizards
  dagger, staff, darts, knives and slings (Cleric, Druid, Thief, Wizard (PHB); `classWeapons` in class-tables.mjs, each
  rule regex-checked, every weapon a proficiency identifier; the lasso is the Combat & Tactics item). Weapons without a
  proficiency (improvised) are not checked. Specialty priests and other special cases: a class or kit item's "Allowed
  weapons" field (weapon proficiency names or identifiers, comma separated) replaces the class's list for the warning
  (a kit's list applies to its own class; owner's ruling).
- Bows made for Strength: a bow item has "Bow made for Strength" (standard, 3-25 and the 18/xx bands). A standard bow
  applies Strength penalties only; a bow made for a Strength gives the user's Strength attack and damage bonuses up to
  that Strength, penalties always ("bows must be specially made to gain the bonus", Strength (PHB); "the attack roll and
  damage Strength modifiers apply only if the character has a properly prepared bow", Missile Weapons in Combat (PHB)).
  A bow for exceptional Strength (18/01 or more) used by a character without it adds a chat note to roll bend
  bars/lift gates to string or use it (Weapons (PHB)). Thrown weapons no longer count encumbrance, heat and kit attack
  modifiers twice.
- Two weapons ("Attacking with Two Weapons (PHB)"): warriors and rogues get a "Two weapons" choice in the melee
  attack dialog ("Both weapons" rolls the weapon clicked as the main weapon and the chosen weapon in the other hand as
  the second, one chat message each; a backstab applies to the main weapon only): main weapon -2, second weapon -4, improved by the Dexterity reaction adjustment to at most 0; rangers
  have no penalty in studded leather or lighter ("Ranger (PHB)"). The chat message notes an equipped shield and a
  second weapon that is not smaller and lighter than the main one (a dagger is always allowed). The penalties show on
  the Unarmed row of the Equipment tab. With two one-handed melee weapons equipped, each shows its attack rate with
  the extra attack in brackets ("3/2 (5/2)": "a warrior able to attack 3/2 ... can attack 5/2"). A weapon one size
  larger than the character needs two hands ("A character can also use a weapon one size greater than himself
  although it must be gripped with two hands", Weapons (PHB)): it is marked "two hands", gives no extra attack, and a
  two-weapon attack with it is noted in chat. Sizes: Monstrous Manual (gnomes and halflings S; dwarves M, the hill
  dwarf entry reads "S to M"; others M), in `module/rules/race-tables.mjs` from `python3 tools/build-race-data.py`.
- Unarmed combat ("Attacking Without Killing (PHB)"): Punch, Wrestle and Overbear on the Equipment tab. Punch and
  wrestle results by the modified attack roll (PHB Table 58); punches do the listed damage (1d3 with a metal gauntlet)
  plus Strength damage and roll the knockout chance (stunned 1d10 rounds); wrestling in armour takes the PHB Table 57
  penalty; a maintained hold does 1 more point each round; overbearing adds 4 per size category, -2 per defender leg
  beyond two and +1 per extra attacker. Blades (slashing weapons) have a non-lethal option: -4 to hit, half damage.
  Punching and non-lethal damage apply as temporary damage (below). Tables from `python3 tools/build-combat-tables.py`.
- Monsters punch, wrestle and overbear from the Unarmed row of their Attacks table (same rules, no Strength or kit
  modifiers; overbearing sizes default to the monster's and the target's size). The dialog notes that "unintelligent
  creatures ... never try to grapple, punch, or pull down an opponent" and that natural weapons stay usable (Nonlethal
  Combat and Creatures (PHB)).
- Armed defender ("an armed defender is automatically allowed to strike with his weapon before the unarmed attack is
  made ... the defender gains a +4 bonus to his attack and damage rolls", Attacking Without Killing (PHB)): an unarmed
  attack against a target the user can see holding a melee weapon (characters: equipped; monsters: not dropped) notes
  in chat that the defender strikes first with +4; character and monster melee attack and damage dialogs have a
  tick box "Against an unarmed attacker closing in" that adds +4.
- Temporary damage ("Attacking Without Killing", PHB/DMG): punching damage applied from chat is recorded separately and
  75% of it returns when the combat encounter ends (25% lasting, rounded down); the temporary half of non-lethal weapon
  damage returns one turn (10 minutes of game time) after the encounter ends. A character or monster at 0 or fewer hit
  points only because of temporary damage is unconscious, not dead or dying. The sheet shows the pending temporary
  damage, with a "Recover temporary damage" button for fights outside the combat tracker.
- Experience awards: the "+" next to XP on the character sheet adds an individual award; Configure Settings >
  "Award experience" (GM, or `game.ad2e.awardExperience()`) divides a group award equally among the chosen characters
  ("Experience Point Awards (DMG)"): XP of monsters picked from the current combat (defeated ones preselected) plus
  other XP. Each share gets the class prime-requisite bonus (10%); characters who can advance a level are named in chat.
- Colour-coded sidebar tabs (client setting "Colour-coded sidebar tabs", on by default): the Combat, Scenes, Actors,
  Items, Journal and Compendium tab icons use the Okabe-Ito colour-blind-friendly palette (Okabe & Ito 2008, "Color
  Universal Design", https://jfly.uni-koeln.de/color/; Wong 2011, Nature Methods 8:441): combat vermillion, actors
  orange, scenes bluish green, items sky blue, journal yellow, compendium reddish purple; the open one is underlined in
  its colour. Other tabs (including those added by modules) are unchanged.
- Opaque windows: Foundry's dark theme gives windows a 90% opaque background and hides what is behind with a blur,
  which is off in low-performance mode, so text behind a sheet showed through. AD&D 2e sheets and windows now use the
  same colour fully opaque (client setting "Opaque sheet backgrounds", on by default).
- Magical items and treasure: item types `magic` (category per DMG Table 88: potions, scrolls, rings, rods, staves,
  wands and the miscellaneous magic tables; charges, quantity, usable-by, identified, DMG XP and gp value) and
  `jewellery` (gems by DMG Table 85 class with base value, 10% if uncut; jewellery and objects of art with an entered
  value). Both show on the Equipment tab (and monster inventory), count toward encumbrance while carried, and gems and
  jewellery add to the party's wealth total. "Use" spends a charge, or one potion, scroll or dust, and posts the item
  to chat. Magical armour and weapons remain armour and weapon items with a magical bonus. Tables from
  `python3 tools/build-treasure-tables.py`.
- Treasure generator (GM; the Treasure button on monster sheets, prefilled from the stat block, or
  `game.ad2e.rollTreasure()`): DMG Table 84 treasure types ("Q x5, X"; each column present on its chance, the amount in its
  range; platinum or electrum chosen in the dialog), gems (Table 85 class, a named stone of that class, 10% chance of a
  Table 86 variation), objects of art (Table 87) and magical items (Table 88, then Tables 89-104 by subtable die and d20,
  armour by Tables 105-107, weapons by Tables 108-110; generic names such as "Sword" or "Pole Arm" pick a PHB item of
  that kind at random, owner's ruling; spell scrolls, maps, special armours and weapons and "DM's Choice" are listed as
  text). The result is a chat card for the GMs; its button adds the coins (onto existing piles), gems, art, magical
  items and magical armour and weapons (with their bonus) to the selected token's actor.
- Unidentified magical items (magic, weapon, armour and ammunition items): treasure arrives unidentified. Players see
  an unidentified name (the GM's, else "Unidentified item (Rings)" or the base weapon or armour name) and no source
  link, notes, values, usable-by, charges or magical bonus fields; only the GM ticks Identified. Bonuses still apply,
  so attack totals and Armor Class can reveal them.
- Al-Qadim rules: kit modifiers for the Al-Qadim kits (reactions, proficiency and ability checks, saves, initiative,
  attack; checked against each kit page by `tools/build-kit-mechanics.py`); the Kahin advances on the druid experience
  table (kit field `xpTable`); corsairs, like rangers, have no two-weapon penalty in studded leather or lighter; the
  barber thief has 40 discretionary skill points at 1st level and a barber bard 10 ("only 10 points to bards who are
  barbers"). Learning wizard spells: elemental mages +40% for spells of their province, sorcerers +20% for their two
  provinces (chosen on the Class tab), other elemental provinces not learnable; barbering bards universal spells only;
  mageweavers nothing above 6th level, mystics of Nog nothing above 5th (module/rules/province-tables.mjs `KIT_LEARN`,
  each checked against the kit page). World setting "Al-Qadim: heat penalty for heavy armour"
  (off by default; Armor in Fiery Zakhara (AA) Table 6): worn armour better than AC 7 gives -1 per class to attack rolls
  and proficiency and ability checks (magical bonuses, daraqs and bucklers do not count). The "Al-Qadim Equipment (AA)"
  compendium has a "PHB Weapons (Zakharan prices)" folder: weapons on the AA list at their AA price, the others
  ("exotic") at 10 times the PHB price.
- "Al-Qadim Equipment (AA)" compendium (`python3 tools/build-aq-equipment-data.py`): the Arabian Adventures price lists
  (clothing, food and lodgings, household provisions, animals, tack and harness, transport, miscellaneous equipment;
  302 items) at the normal price, with the asking and bargain prices in each item's notes; the nine new Zakharan weapons
  (elephant goad, jambiya, katar, razor, scythe, cutlass, great scimitar, tiger claws, tufenk) with a weapon
  proficiency each; lamellar armour (AC 6) and the daraq shield (as the buckler). Familiar weapons and armour are the
  PHB items. The tufenk's Greek fire attack is described in its notes and rolled by hand. Services and slaves are not
  items. The heat penalty for armour better than AC 7 ("Armor in Fiery Zakhara") is the world setting described above.
- "Magical Items (DMG)" compendium: 347 items from DMG Tables 89-104 (potions, rings, rods, staves, wands and the
  miscellaneous magic tables), one folder per table, each with its XP value, the groups that may use it, and a link
  to its description page (descriptions are not copied). Wands, rods and staves carry their DMG charges when found
  (1d20+80, 1d10+40, 1d6+19; "Roll charges" on the item sheet). Spell scrolls are not listed (create one per scroll).
  "Gems (DMG)" compendium: 53 named gems from the DMG gem lists, one folder per Table 85 class, valued by class. Both
  from `python3 tools/build-magic-item-data.py`.
- Situational modifiers: every roll dialog (attacks, damage, saves, ability checks and tests, proficiency checks, thief
  skills, turning undead, morale, jumps, initiative from the combat tracker) has a modifier and a reason, shown in the
  chat message, for magical items and conditions the system does not track. Armour Class has an "Other AC adjustment"
  on the Equipment tab. Morale modifiers adjust the morale rating, as in "Morale (DMG)". The initiative question
  (one combatant at a time) can be turned off in the world settings.
- Monster importer (GM): Configure Settings > "Import monsters", or the macro `game.ad2e.importMonsters()`. Choose a
  setting and source book from https://www.completecompendium.com/, load its monsters, filter and select, and import them
  as Monster / NPC actors (optionally into a folder named after the book). Only stat blocks and a link to each page are
  imported; descriptions stay on the site. Re-importing updates actors imported from the same page and keeps their
  current hit points. Hit Dice as written ("14 (base)", "6+6 or 9+9", "16 + 2-7 hit points", "45-75 hp", "1/4") are
  parsed; the listed THAC0 is kept when it differs from DMG Table 39.
  The monster's picture from its page becomes the actor portrait and token image (the picture whose caption names the
  stat block, else the page's first; pictures the site links to but does not have are skipped). No pictures ship with
  the system (copyright; owner's decision). With the world setting "Store imported monster pictures in the world" (on by
  default) the importer downloads each picture once into `worlds/<world>/ad2e-monsters/` and the portrait and token use
  that copy, so players' browsers load it from the Foundry server instead of completecompendium.com; a picture already
  in the folder is not downloaded again. If the folder cannot be written (no upload permission, another file storage)
  the site's address is used and a warning is shown; with the setting off, pictures are linked as before. Re-importing
  replaces only the default icon, an earlier picture from the site or a local copy, not one a GM chose (re-importing
  monsters imported before 0.0.112 replaces their site links with local copies).
  "Update existing monsters" (importer button, or `game.ad2e.updateMonsters()`, GM only) re-reads the page of every
  imported monster in the world and in unlocked world Actor compendiums and updates its stat block like a re-import;
  names, current hit points, pictures a GM chose and attack elements a GM set stay. Unlinked tokens follow their actor,
  and tokens already placed on scenes that show a site picture, an earlier local copy or the default icon get the new
  picture.
  The site's pictures are GIFs, which Foundry 14.368 does not load as token images ("Invalid Asset"; confirmed with a
  diagnostic macro: the same picture as PNG loads), so tokens showed the default icon in 0.0.112-0.0.113. Since 0.0.114
  each GIF is stored as WebP (PNG where the browser cannot encode WebP); run "Update existing monsters" once to convert
  the pictures of monsters imported before and fix their placed tokens (the old .gif files can be deleted).
  Token footprint (squares of 5 feet) follows the stat block's size letter (owner's ruling): T 0.5, S 1, M 1, L 2, H 3,
  G 4; a range such as "L-H" uses the first letter, and the stated feet are not used. Size letters as defined in How to
  use this Book (MM): "T = tiny (2' tall or less); S = smaller than a typical human (2+' to 4'); M = man-sized (4+' to
  7'); L = larger than man-sized (7+' to 12'); H = huge (12+' to 25'); and G = gargantuan (25+')". New imports get it;
  re-import and "Update existing monsters" set it on prototype tokens and placed tokens still at the default 1x1 (a size
  a GM set stays); stat blocks without a size letter keep 1x1.
- Classes and kits are Items (types `class`, `kit`) shipped in the "Classes (PHB)" and "Class Kits" compendiums.
  Drag a class, then a kit, onto a character. Compendium folders: classes by group; kits by group and class
  (Warrior: Fighter/Paladin/Ranger; Wizard; Priest; Rogue: Thief/Bard). Source documents are generated into `packs/_source/` by
  `python3 tools/build-class-data.py` and compiled at release by `npm run build:packs`: PHB classes
  (Table 13 minimums, Table 22 specialist wizards) and the kits of the Complete Fighter's, Paladin's, Ranger's, Wizard's,
  Priest's, Thief's and Bard's Handbooks. Kit ability minimums are curated by hand from each kit page; other kit rules are
  linked, not copied.
  Al-Qadim kits (33): Arabian Adventures (eligible classes from its Table 3: Character Kit Summary) and The Complete
  Sha'ir's Handbook (wizard kits, for mages), in an "Al-Qadim" folder under each group. Ability minimums (Hakima, Kahin,
  Clockwork Mage) are set; race, sex and alignment restrictions are flagged with a link to the kit page; bonus
  proficiencies are added as for the other kits. Kahin uses the druid experience table (kit field `xpTable`, see
  Al-Qadim rules). The sha'ir, elemental mage and sorcerer rules are listed separately.
  Complete Wizard's Handbook kit minimums add to the class's (owner's ruling; the higher applies): "Generally, any kit
  can be assigned to a specialist from any school" (Wizard Kits (CWH)), so a Witch diviner still needs the diviner's
  Wisdom 16. The bard race kits (Gnome Professor, Halfling Whistler, Dwarven Chanter) keep replacing the bard's minimums.
- Sha'ir (Al-Qadim; Requesting a Spell (AA), Summoning a Familiar (AA); rules in module/rules/shair-tables.mjs, each
  checked against its page and the three worked examples recomputed):
  the gen fetches each spell. The Spells tab gives the chance (50% + 5% per sha'ir level - 10% per spell level, +10%
  "general knowledge", -30% priest or foreign, -10% per repeat within 24 hours; 90+ always fails) and the search time
  (rounds, turns or hours by the spell, +1 increment per replacement gen); the success roll is blind for players, the gen
  returns as world time passes, the spell must be cast within three turns, and a noticed priest spell tells the GM the
  divine retribution band. The gen is a monster actor (Summon gen: 1d20 hours): AC 5, MV 9 (air flies 12, water swims
  12), half the master's hit points and level in Hit Dice, saves at twice the master's level, 1d6 (earth 2d6),
  loyalty 18, -1 per replacement (at least 5), +1 for a master of its tendency. Protection against its element:
  attacks -2, saves +2, damage -2 per die (at least 1), for the gen always and the sha'ir within 10 feet. Its death
  halves the sha'ir's hit points (at 0 or fewer, a save vs. death magic). A gen brought back to life has -1 loyalty for
  good; dispel magic or the master's death breaks the link, and summoning the same gen restores it with no replacement;
  "Gen away" sends it off (forced beyond 100 yards or threatened: 1d6 turns; to another plane: 1d6 days, elemental plane
  1d6 rounds; an errand: until recalled), with no protection meanwhile and the note that the sha'ir senses it is alive.
- Elements on attacks: monster natural attacks and weapon items have an elemental province (select on the monster sheet,
  weapon sheet); their damage reaches elemental mages and gens of that province (-2 per die), an elemental mage of that
  province adds +1 per die, and a gen's -2 to hit is pre-ticked. The monster importer sets an attack's element only
  when its own text names one ("2d8 (fire)"); a guess from the name or special attacks ("Elemental, Fire", "Breath
  weapon (cold)": cold and ice count as sea, as Cone of Cold in Appendix A) is shown on the monster sheet with an Apply
  button.
- Skills & Powers weapon rules (world setting, off by default; Player's Option: Skills & Powers, chapter 7; tables in
  module/rules/sp-weapon-tables.mjs, each regex-checked): character point costs paid with weapon slots (owner's
  ruling), weapon of choice, expertise, specialization and mastery by class (Tables 53/54), tight and broad group
  proficiencies and familiarity (Tables 49/50), armour and shield proficiencies (Table 51), fighting styles (one-handed,
  two-handed, weapon and shield, two-weapon, missile, thrown, horse archery) with their bonuses in the attack and damage
  dialogs; the missile and thrown styles give -1 to hit for attackers' missiles the round the specialist shoots, and the
  horse archer fires from a moving mount without penalty up to half speed (-2 faster).
- Lasso (0.0.134; module/lasso.mjs, figures in combat-tables.mjs `lasso` from build-combat-tables.py, regex-checked against
  Weapon Descriptions (POCT) rev 74770 and Attack Options (POCT) rev 250488): attacking with a lasso opens its own dialog
  (it "cannot be used for normal attacks"): called shot -4 (+1 initiative), legs = pull/trip (opposed Strength, +4 for the
  lasso, 4 per size step, -2 four legs, +3 unaware, -6 stationary; the mount's size when tied to the saddle; knocked down,
  fails, or a tie and both fall), arms = opposed attack roll against AC 10 for the lasso user and AC 4 for the defender
  (as Disarm; the text's "instead of AC 2" names no defender AC, implementation choice): one random arm, both when won by
  4 or more or when the defender fails his roll (implementation choice), unhorse (automatic for a moving rider with the
  lasso tied to something solid, else opposed Strength), and the pull/trip by spurring with no attack roll. Defender
  numbers come from the first target (monsters: Dexterity = movement, Strength = 3.5 per size + Hit Dice with sizes
  T = 1 to G = 6, implementation choice) and can be edited.
- Net (0.0.135; owner's request: the net is not a Table 49 weapon, added to build-poct-weapon-data.py `TARGETS` from its
  Master Weapon List (POCT) row: no damage, range 2/3/4 squares = 10/15/20 yards, two hands; rules `COMBAT_TABLES.net`,
  regex-checked against Weapon Descriptions (POCT)): attacking with a net opens its own dialog. Throw at AC 10 with the
  target's Dexterity and magic only ("Only the target's Dexterity and magical adjustments to Armor Class count"; a
  character target's Dexterity is filled in, magic is entered); a hit may trap weapon and shield. Loop the rope round
  (same AC): the victim's Strength counts 4 less to break free. Pull/trip (normal AC, opposed Strength without the
  lasso's +4). Once thrown the net is unfolded (item flag `ad2e.unfolded`): -4 to hit until "Fold the net" (2 rounds).
  "Break free (net)" (character Combat tab, monster header): a Strength check, -4 if the rope was looped (monsters:
  3.5 per size + Hit Dice). The net's hand-to-hand block and disarm are not modelled.
- Combat & Tactics weapons (Master Weapon List (POCT), Equipment Groups (POCT); folders "Weapon Proficiencies (POCT)" and
  "Weapons (POCT)"): 53 weapon proficiencies and their items for the Skills & Powers weapon groups without a PHB item
  (every culture's price kept; firearms one item per lock type). Footnotes are rules: two hands regardless of size;
  double damage set to receive a charge or in a mounted charge (tick boxes); knockdown 7+ adds a damage die, repeated;
  misfires (flintlock 1, snaplock 2 or less, matchlock 3 or less, 6 wet, hand match 5 or less, 10 wet; a "wet conditions"
  tick box) and doubled range penalties for hand match guns. Ammunition: Pellet (pellet bow), Bullet (firearms but the
  handgunne, which "propels a heavy iron arrow"), and the cho-ku-no fires light quarrels; each firearm shot uses one
  bullet and one gunpowder or smokepowder (owner's ruling), and matchlocks and hand match guns need a slow match carried.
- Traits and disadvantages (Player's Option: Skills & Powers Tables 46 and 47; compendium "Traits & Disadvantages (POSP)",
  `python3 tools/build-trait-data.py`; descriptions are linked, not copied): without character points (owner's ruling)
  a character may take traits whose cost is at most the points of its disadvantages (moderate or severe); the
  Proficiencies tab shows the balance and warns when the traits cost more. Racial adjustments from the descriptions
  apply ("Elves can purchase this trait for 1 less character point"; "Dwarves receive 1 extra character point").
  Effects with numbers apply in rolls like kit modifiers (tick boxes when conditional): Alertness +1 surprise, Keen
  Eyesight +1 to hit with missiles at long range, Keen Hearing/Smell surprise and Detect Noise/Hunting, Keen Touch +5%
  pick pockets and open locks, the inherent immunities' saving throw bonuses, Impersonation, Internal Compass and
  Music/Singing proficiency bonuses, Allure and Tongue-tied reactions. Ambidexterity sets the two-weapon penalties to
  0 / -2 ("suffering no penalty for the first hand, and only a –2 penalty for off-hand use"); Fast Healer heals 2 hit
  points a day of normal rest. The wiki has no description for Irritating Personality and Phobia: Spiders (they link
  to the tables page).
- Skills & Powers nonweapon proficiency ratings (world setting, off by default; Player's Option: Skills & Powers,
  chapter 6; `python3 tools/build-sp-proficiency-data.py`, module/rules/sp-proficiency-tables.mjs): a proficiency on
  Table 45 is checked against its initial rating plus the Table 44 modifier of the better of its abilities ("the player
  can choose which ability modifies the proficiency", Using Proficiencies in Play (POSP)); other proficiencies keep the
  PHB check. Owner's rulings: no character points and no subabilities (Wisdom/Intuition counts as Wisdom); each extra
  slot adds +1 (the PHB rule) up to an unmodified 16 ("Characters cannot improve their unmodified ratings in nonweapon
  proficiencies above 16", Improving Proficiencies (POSP)); kits give no discount on recommended proficiencies and
  abilities below 9 cost nothing extra. Set Snares has rating 6 on the rogue list and 8 on the warrior list.
- Skills & Powers kits (30, folder "Skills & Powers (POSP)" in the Kits compendium; Character Kits (POSP)): classes,
  ability minimums (subability minimums apply to the ability; they add to the class's minimums, the higher applies) and
  barred standard races are curated from each kit page and regex-checked; alignment, sex and prime requisite
  requirements are flagged as other requirements. Recommended nonweapon proficiencies come from each page; Explorer
  gains Survival, Beggar and Soldier one free proficiency from the recommended list. Benefits and hindrances with
  numbers are kit modifiers (applied, or tick boxes in roll dialogs when conditional; reactions are for the DM), e.g.
  Acrobat +2 tumbling, tightrope walking and jumping unarmoured, Diplomat and Spy +2 reactions, Gladiator +1 to hit
  with the chosen weapon and -1 initiative, Swashbuckler +2 AC in armour no heavier than studded leather, Thug +1
  damage. Animal companions and mounts: see below. Kit features with figures (`module/kit-features.mjs`; kit field
  `special` from build-kit-mechanics.py `KIT_SPECIAL`, each regex-checked against its page):
  - Pugilist (rev 271692): "treated as if they were armed when making unarmed attacks" (the unarmed card no longer
    gives an armed target the first strike); Charisma "lowered by 1 when dealing with those from the middle class and
    by 2 when speaking to people from the upper class" (the encounter reaction dialog asks the NPC's social class and
    recomputes the Table 6 adjustment).
  - Barbarian (rev 271662): on a first meeting (a pre-ticked box in the reaction dialog) a result of 8 or less gets -2
    and 14 or more +2.
  - Weapon Master (rev 271714): a "Display" button on the Combat tab during combat; the opposing side's initiative in
    rounds 1 and 2 gets +2 (worse), pre-ticked in their initiative dialog for those who did not see it (owner's ruling);
    weapon proficiencies whose type (B/P/S) shares nothing with the chosen weapon are marked (owner's ruling: a
    warning). Owner's ruling: the chosen weapon is the melee weapon with specialization (else expertise) the kit
    requires, at no extra cost; with the Skills & Powers weapon rules it is the weapon of choice (+1 to hit) without
    the character-point cost, and the weapon-of-choice box is hidden for the kit (0.0.131).
  - Mystic (rev 271680): "Meditate" on the Race & Class tab: +2 to one ability (owner's ruling: the ability, as
    subabilities are not used), or +20% to an 18/xx Strength (capped at 18/00, implementation choice), from the end of
    the meditation for one-third of its time (world time), one boost at a time.
  - Social ranks: each Skills & Powers kit's 2d6 table (all 30 parsed, coverage 2-12 asserted; the Soldier's military
    titles kept); a Roll button and the result on the Race & Class tab (owner's ruling).
- GM manual: the "AD&D 2e GM manual" button in the Settings sidebar tab (GM only), Configure Settings > "AD&D 2e GM
  manual", or `game.ad2e.manual()`. Sections: getting started (first steps and this system's compendiums), GM tools
  (buttons for the monster and spell importers and updates, experience awards, treasure, encounter reactions and
  Configure Settings), every system setting with its current value and what it does (read from the registered
  settings, so new settings appear on their own) and the setting menus, characters, combat, monsters and hirelings,
  items and treasure, optional rules, and the `game.ad2e` macros. Procedures only; no rulebook text.
- Player guide: the "AD&D 2e player guide" button in the Settings sidebar tab (every user), Configure Settings, or
  `game.ad2e.playerGuide()`. How to use the character sheet: its tabs, creating a character (abilities, race, class,
  kit, hit points, body weight), proficiencies and extra slots, buying and equipping gear, carried items, containers,
  ammunition and magical items, adding, learning, memorizing and casting spells, attacking with targets, saves and
  checks, mounts and riding (Riding, rider weight, tokens moving together, mounted options, pushing), advancing, and
  henchmen and familiars. Named "player guide" (not "Player's Handbook", the rulebook's title); no rulebook text.
- Dual-class characters (world setting "Dual-class characters", off by default; Multi-Class and Dual-Class Characters
  (PHB), "Dual-Class Benefits and Restrictions"): dropping a new class on a character with a class asks whether to
  dual-class (keeping the old class) or replace it. Dual-classing needs a human ("Only humans can be dual-classed
  characters"), 15 or more in the current class's prime requisites and 17 or more in the new class's, at least 2nd level,
  an allowed alignment and a class not taken before. The new class starts at 1st level with 0 experience points and keeps
  the hit points; Level Up gives no hit points until the new level is higher than every earlier class's (the PHB's
  Tarus example: cleric 3 then fighter, 1d10 at fighter 4). Earlier classes keep their abilities at their last level:
  thief, bard and ranger skills, backstab, turning undead, paladin powers and spells (a second spell list with that
  class's slots and casting level), shown as "from earlier classes". While the restrictions apply ("until the character
  reaches a higher level in his new class than his maximum level in any of his previous classes"), using any of them, or
  the earlier class's better THAC0 or saving throw (a tick box in the attack and save dialogs), sets the penalty flags
  and posts a note; afterwards the better THAC0 and saves apply automatically (owner's ruling). Experience awards
  (individual and group) ask whether they are for an encounter or the adventure: with the flags, an encounter award
  gives nothing and an adventure award half ("he earns no experience for that encounter and only half experience for
  the adventure"); awards clear the flags they apply, and the GM can clear them on the Race & Class tab (owner's
  rulings). Proficiency slots are the larger of the earlier class's at its last level and the new class's
  (implementation choice; the PHB only keeps the old proficiencies). Level draining: see Energy drain below. "Undo dual-class" (GM, Race & Class tab) corrects a mistaken switch, although the PHB allows no return to an
  earlier class: the current class item is removed and the earlier class comes back from the Classes compendium at its
  last level with the experience recorded at the switch (recorded from 0.0.122; older switches get the minimum for that
  level); hit points and the kit are left as they are.
- Multi-class characters (world setting "Multi-class characters", off by default; Multi-Class and Dual-Class Characters
  (PHB), rev 271818): "Only demihumans can be multi-class characters", in the combinations listed under "Multi-Class
  Combinations" (race item field `multiClass`, generated by build-race-data.py, which checks the per-race counts, the
  cleric-or-druid footnote and the specialist-wizard sentence). Dropping a second (or third) class on a demihuman asks
  whether to add it or replace the class; adding is offered only for one of the race's combinations, at creation (every
  class at 1st level with no experience), with an allowed alignment and the class's ability minimums. The class with
  the warrior group (then priest, rogue, wizard) is the main one: its level and experience are the sheet header's, so
  a fighter's Constitution bonus applies ("If one of the character's classes is fighter ... he gains the +3 or +4
  Constitution bonus"). The Race & Class tab lists every class with its level, experience, next level, Hit Dice, racial
  level limit and prime requisite bonus, and a Level Up button per class (the Main tab's Level Up asks which).
  Rules: experience "is divided equally between each class", each share with that class's prime requisite bonus (owner's
  ruling); each class stops at its race's level limit but still takes its share (owner's ruling); 1st-level hit points are
  the classes' dice totalled and divided by the number of dice, rounded down, plus Constitution (the PHB's Morrison
  example, 6 + 5 + 2 = 13, gives 4); later a class's Hit Die is divided by the number of classes (at least 1 per die)
  with that share of the Constitution bonus; "the most favorable combat value and the best saving throw"; proficiency
  slots at "the largest number" and "the fastest of the given rates" (each class at its own level), the smallest
  non-proficiency penalty and the nonweapon groups of all the classes (implementation choice, from "the most
  beneficial line on Table 34", Weapon Proficiencies (PHB)); no weapon specialization ("multi-class characters cannot
  use weapon specialization", Weapon Specialization (PHB)). Every class's abilities apply at its own level (thief
  skills and backstab, turning, spells with each class's slots and casting level); a multi-class thief in armour not
  allowed to thieves can use only open locks and detect noise (no Table 29 adjustment for such armour). Weapons: "a
  multi-classed priest must abide by the weapon restrictions of his mythos", otherwise the most permissive class's list
  applies (warriors and bards any weapon). Armour: a limit is shown only when every class has it (implementation
  choice), except a druid's limits, which always apply (owner's ruling); casting a wizard spell in armour asks to confirm ("the wearing of armor is restricted"; an elf in elven chain
  casts freely; owner's ruling: warn and confirm), which also covers bards ("the prohibition of armor", Bard (PHB)). Kits: one kit, open to any of
  the classes (owner's ruling); kits from the Complete Fighter's and Complete Thief's Handbooks show a warning, since
  those handbooks allow them only for single-class characters ("Warrior Kits and Multi-Class Characters (CFH)", "Thief
  Types and Multi-Class Characters (CTH)"); the GM decides. A kit's experience table and racial level limit apply to its
  own class. Complete Bard's Handbook multi-class bards ("Multi-Classed Bards Dual-Classed Bards (CBH)", rev 144948;
  race field `multiClassKits` from build-race-data.py, regex-checked, per-race counts asserted): another class plus the
  bard with one of the listed kits (dwarf fighter/bard as Chanter or Skald, half-elf fighter/bard as True Bard, Blade,
  Gallant or Skald, ...); "True" also allows no kit ("If the kits are not used in your campaign, only those combinations
  that include the True Bard can be used"). The Race & Class tab says which kits the combination needs. The levels and
  experience of the classes other than the main one can be edited in the class table.
- Energy drain (GM buttons "Energy drain" and "Restoration" on the Main tab; module/level-drain.mjs; Special Damage
  (DMG) rev 238117, Multi-Class and Dual-Class Characters (PHB) rev 271818, Restoration (Priest Spell) rev 235764):
  each level lost comes off the highest class ("Multi-class and dual-class characters lose their highest level first. If
  both levels are equal, the one requiring the greater number of experience points is lost first"), costs that level's
  Hit Dice roll plus Constitution (or its fixed hit points) from the maximum (multi-class: divided by the number of
  classes, as when gained; a dual-class level that gave no hit points takes none, implementation choice), and sets that
  class's experience "halfway between the minimum needed for his new (post-drain) level and the minimum needed for the
  next level". Below 1st level the character is 0-level (no Level Up until a restoration or wish); drained again, the
  character is slain (marked dead) and the GM is whispered a 2d4 roll: the days until the character "returns as an undead of
  the same type as his slayer". Wizard spells above the highest
  level the character can now cast are marked not understood (roll to learn again). Drained levels are listed until
  regained by Level Up; while any are pending a dual-class character's restrictions apply (the PHB's "Using abilities of
  the other class then subjects him to the experience penalties"; the per-adventure class choice is not tracked).
  Restoration brings back the most recent drained level with "exactly the number of experience points necessary" and
  the hit points it cost, if within one day per level of the priest (the dialog asks the priest's level). "Casting this
  spell ages both the caster and the recipient by two years": character `system.age` (Biography tab, blank = not
  recorded) goes up by 2 for the recipient and the casting priest chosen in the dialog (0.0.134). "The character must
  instantly forget any spells that are in excess of those allowed for his new level": after the drain a dialog lists each
  spell level over its slots (owner's ruling: the GM picks; uncast memorizations are proposed first, `excessPlan`).
- Animal companions and mounts (Skills & Powers kits Animal Master and Rider; Animal Master - POSP rev 271658, Rider -
  POSP rev 271694): 48 creatures in the Hirelings & Mounts compendium, folder "Animal Companions & Mounts (POSP)",
  generated from their Monstrous Manual pages (owner's choices for ambiguous names: dog = Wild Dog, snake = Poison
  (Normal), brush rat = Rat Common with the page's note, giant beetle = Rhinoceros, giant boar = Giant (Elothere),
  giant otter = Giant Mammal, giant ray = Manta, stag = Wild Stag, hawk = Large, falcon = Small (Falcon); horse/pony,
  camel, mule and elephant are the existing Mounts actors; variable-size creatures carry the first variant's
  experience value). Tables 42 (d20) and 43 (d6 group, d8 mount) and the rules are in
  `module/rules/companion-tables.mjs`, regex-checked by `tools/build-hireling-data.py`. On the Biography tab of an
  Animal Master or Rider: the bonded animal (dropping a pet or mount on the sheet offers the bond), its hit points and,
  for a Rider, the distance and direction of its token on the viewed scene ("Each will know the general state of
  health of the other, the direction the other is in, and the distance"); GM buttons roll the table (chat card with
  links to the creatures; for a mount the GM picks the rider's homeland: settled lands, desert, jungle, forest, hills and
  mountains, underground, coast and sea pick one of their Table 43 entries with equal chance, "Any" rolls Table 43 as
  printed; owner's choice, `MOUNT_HOMELANDS` in build-hireling-data.py), "Companion died" (no penalty), "Companion lost carelessly" (-10% of the current experience,
  every class of a multi-class character, and "he loses his affinity to that species": that species is refused), "Mount
  died" (2d6 damage to the rider; by negligence a save vs. spells; on a failure the rider is
  feebleminded for the 2d6 hours (0.0.132, owner's rulings: `system.bond.feebleUntil`, token status `ad2e-feeblemind`
  with the system's own icon `styles/icons/feeblemind.svg`, casting asks to confirm, the active GM ends it when world
  time passes, GM "End feeblemind" button on the Biography tab for an early end such as a heal spell)) and "Mount fled" (no bonded mount again). The GM is told in chat when a bonded
  animal dies. "All animal companions should be size S (small)": a companion of size M or larger is bonded with a
  warning (owner's ruling; T, S or no size pass; every Table 42 creature passes). Race and alignment fit (0.0.133, owner's lists and
  rulings, warnings on the roll card, the bonding prompt and the Biography tab; `raceFit` in companion-tables.mjs from
  build-hireling-data.py `MOUNT_RACE_FIT` / `COMPANION_RACES`, the kit sentences regex-checked): mounts too big for gnome
  and halfling riders (elephant, cave bear, giant lizard, huge bat, hippocampus, killer whale, giant ray) or too small for
  human, half-elf, elf and dwarf riders (huge raven, giant badger, giant frog, giant skunk); Animal Master race affinity
  (dwarf and gnome: badger, woodchuck, brush rat, ferret, snake, skunk; elf: owl, fox, squirrel, raccoon, hawk, falcon,
  wolf, badger, raven, skunk, opossum; other races any); "attracted only to animal masters of like demeanor": a warning
  when the creature's good/evil alignment opposes the master's (neutral creatures fit everyone). Cavalier and Noble "must purchase a mount": the Race & Class tab warns while the character owns no mount
  (owner's rulings: generated stat blocks, bond and GM buttons, warning).
- Spells tab: shown only for characters with spells (slots at their level, a sha'ir, or owned spell items), so
  fighters, thieves and paladins or rangers below their spell levels do not see it; dropping a spell on the sheet still
  adds it and brings the tab back.
- API calls were checked against the v14 API docs (https://foundryvtt.com/api/) and dnd5e 6.0.5 (v14, https://github.com/foundryvtt/dnd5e). Confirmed working in Foundry 14.368 on 2026-10-02: sheet values, ability checks, saves, attacks, combat tracker and initiative.

## Planned
- Stronghold construction costs and building time (owner's request, later; 1.0.17 records the stronghold only).
- Not planned: subabilities and character points; monster pictures shipped with the system (copyright); psionics not
  for the time being (owner's decisions).
