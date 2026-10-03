#!/usr/bin/env bash
# Regenerate all wiki-derived data in dependency order (run from the repo root).
set -euo pipefail
python3 tools/build-ability-tables.py
python3 tools/build-level-tables.py
python3 tools/build-class-data.py        # classes, kits (+ folders)
python3 tools/build-proficiency-data.py  # proficiencies; adds proficiency fields to the kit sources
python3 tools/build-movement-tables.py   # encumbrance (Tables 47/48), base movement (Table 64)
python3 tools/build-race-data.py         # races (reads class and kit sources, Table 64)
python3 tools/build-armor-data.py        # armour, shields, helmets
python3 tools/build-equipment-data.py    # coins (Table 42; reads build-movement-tables.py)
rm -rf tools/__pycache__
