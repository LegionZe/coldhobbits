# coldhobbits — AD&D 2e system for Foundry VTT (unofficial)

Mechanics-only system; no copyrighted rule text. System id: `ad2e`.

> **AI-generated code.** This repository is generated with [Claude Code](https://claude.com/claude-code) (Anthropic), under the direction and review of the repository owner. Rules tables and mechanics must be verified against an owned copy of the AD&D 2e rulebooks.

## Install
- Manifest URL (Foundry > Install System): `https://github.com/LegionZe/coldhobbits/releases/latest/download/system.json`
  Every push to `main` runs `.github/workflows/release.yml`, which publishes release `v<version>` (with `ad2e.zip`
  and `system.json`) if it does not already exist. Bump `version` in `system.json` to publish an update.
- Manual: copy the repository contents into `Data/systems/ad2e/` and restart Foundry.
- `github.com/.../blob/...` URLs return HTML and cannot be used as a manifest URL.

## Status (v0.0.4)
Character sheet; ability modifiers (STR/DEX/CON/WIS); THAC0 by class group and level; descending AC;
roll-under ability checks; saves (d20 >= target, targets entered manually); melee/missile attack vs target AC;
initiative 1d10, lowest acts first.

## Verify before use
- `module/config.mjs` tables were written from memory and must be checked against an owned Player's Handbook.
- API calls were checked against the v14 API docs (https://foundryvtt.com/api/) and dnd5e 6.0.5 (v14, https://github.com/foundryvtt/dnd5e). Confirmed working in Foundry 14.368 on 2026-10-02: sheet values, ability checks, saves, attacks, combat tracker and initiative.

## Planned
Class kits, skills (Skills & Powers), items (weapons/armor/spells), NPC/monster sheet, saving throw tables.
