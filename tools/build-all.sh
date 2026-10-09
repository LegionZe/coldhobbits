#!/usr/bin/env bash
# Regenerate all wiki-derived data in dependency order (run from the repo root).
set -euo pipefail
python3 tools/build-ability-tables.py
python3 tools/build-level-tables.py
python3 tools/build-class-data.py        # classes, kits (+ folders)
python3 tools/build-class-ability-tables.py  # thief/bard/ranger skills, backstab, turning undead (Tables 18, 26-30, 33, 61)
python3 tools/build-proficiency-data.py  # proficiencies; adds proficiency fields to the kit sources
python3 tools/build-sp-proficiency-data.py  # Skills & Powers Tables 44/45 ratings (POSP); sets proficiency system.sp
python3 tools/build-poct-weapon-data.py # Combat & Tactics weapons and proficiencies for the Table 49 names (POCT)
python3 tools/build-kit-mechanics.py      # kit modifiers, skill adjustments, skill points (curated, checked against kit pages)
python3 tools/build-encounter-tables.py  # DMG Table 57 surprise modifiers
python3 tools/build-combat-tables.py    # two weapons, PHB Tables 57/58 (unarmed combat)
python3 tools/build-movement-tables.py   # encumbrance (Tables 47/48), base movement (Table 64)
python3 tools/build-race-data.py         # races (reads class and kit sources, Table 64)
python3 tools/build-armor-data.py        # armour, shields, helmets
python3 tools/build-equipment-data.py    # coins (Table 42; reads build-movement-tables.py)
python3 tools/build-component-data.py    # Spell Components (POSM Table 16); spells link them
python3 tools/build-poison-data.py       # Poisons (DMG Table 51): poison-tables.mjs and the Poisons (DMG) compendium
python3 tools/build-aq-equipment-data.py  # Al-Qadim Equipment (AA): price lists, new weapons, lamellar, daraq
python3 tools/build-kit-weapons.py        # class and kit weapon limits (curated, checked against the kit pages)
python3 tools/build-sp-weapon-data.py     # Skills & Powers weapon rules (POSP Tables 48-54); group/style/armour/shield proficiencies
python3 tools/build-treasure-tables.py     # DMG Tables 85, 87, 88 (gem classes, art values, magical item categories)
python3 tools/build-magic-item-data.py     # Magical Items (DMG Tables 89-104) and Gems (DMG) compendiums
python3 tools/build-province-tables.py   # Al-Qadim wizard spell provinces and native spells (Appendix A (AA))
python3 tools/build-shair-tables.py      # sha'ir gen spell fetching (Requesting a Spell (AA))
python3 tools/build-spell-data.py        # spell progressions (Tables 21, 24, 17, 32); example spells (node parser)
python3 tools/build-monster-data.py      # Table 39 creature THAC0; prototype monster, mount, hireling actors
python3 tools/build-hireling-data.py      # Hirelings & Mounts: DMG Tables 64/65 hirelings, MM horses/camels/elephant
python3 tools/build-follower-tables.py   # name-level followers (PHB Tables 16, 19, 31; class texts; after build-hireling-data.py)
python3 tools/build-travel-tables.py     # weather and travel (DMG Tables 73-82, PHB cross-country movement)
python3 tools/build-encounter-check-tables.py # random encounter checks (DMG Tables 54-56, 58; after build-travel-tables.py)
python3 tools/build-construction-tables.py   # stronghold construction (The Castle Guide ch. 5; after build-travel-tables.py)
python3 tools/build-npc-tables.py          # random NPC builder data (DMG Tables 60, 61, 64, 66-69; PHB Table 10 heights)
python3 tools/build-language-tables.py     # character languages (PHB race initial languages, Intelligence / proficiency rules, Midani)
python3 tools/build-trait-data.py         # Traits & Disadvantages (POSP Tables 46, 47)
python3 tools/build-aging-tables.py       # PHB Tables 11/12 ageing
python3 tools/build-armor-type-tables.py  # PHB Table 52 weapon type vs. armour (after build-armor-data.py)
python3 tools/build-attack-option-tables.py # called shots and Combat & Tactics attack options (after build-sp-weapon-data.py)
python3 tools/build-critical-tables.py    # Combat & Tactics critical hits (Systems I and II; location charts)
python3 tools/build-item-save-tables.py  # DMG Table 29 item saving throws, falling damage
python3 tools/build-creator-tables.py   # GM creators: DMG Tables 31/32 XP, MM size/intelligence/morale bands
rm -rf tools/__pycache__
