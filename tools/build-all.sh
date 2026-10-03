#!/usr/bin/env bash
# Regenerate all wiki-derived data in dependency order (run from the repo root).
set -euo pipefail
python3 tools/build-ability-tables.py
python3 tools/build-level-tables.py
python3 tools/build-class-data.py        # classes, kits (+ folders)
python3 tools/build-proficiency-data.py  # proficiencies; adds proficiency fields to the kit sources
python3 tools/build-race-data.py         # races (reads class and kit sources)
rm -rf tools/__pycache__
