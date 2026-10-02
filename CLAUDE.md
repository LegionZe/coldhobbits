# CLAUDE.md

Foundry VTT system `ad2e` (AD&D 2nd Edition, mechanics only), targeting Foundry v14 (minimum build 14.368).
Code in this repository is generated with Claude Code; keep the notice in README.md and system.json.

## Release workflow (standing instruction from the repo owner)
Every change ships as a release. For each change, without asking again:
1. Bump `version` in `system.json` (patch increment unless told otherwise).
2. Commit on the working branch and push it.
3. Open a pull request to `main` (if the branch's previous PR was merged, open a new one).
4. Merge the pull request.
5. Confirm `.github/workflows/release.yml` succeeded and that
   https://github.com/LegionZe/coldhobbits/releases/latest/download/system.json serves the new version.
The owner installs and updates from that manifest URL only (no shell access to the Foundry server).

## Development notes
- Reference implementation for v14 APIs: https://github.com/foundryvtt/dnd5e. API docs: https://foundryvtt.com/api/.
- Core calls `Actor#getRollData()` during `applyActiveEffects()` (actor and token level), before `prepareDerivedData()`.
  Roll data must not depend on derived-only values.
- Before writing CSS or selectors, get the real rendered HTML from the owner or a diagnostic macro; do not guess.
- Rules tables in `module/config.mjs` are from memory; mark unverified values and do not include rulebook text.
