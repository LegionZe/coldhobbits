import { ABILITY_TABLES } from "./rules/ability-tables.mjs";

/**
 * Rules data for AD&D 2e. Numeric tables only; verify against an owned copy of the
 * rulebooks before play. Edit here; nothing else hard-codes these numbers.
 */

export const AD2E = {};

AD2E.abilities = ["str", "dex", "con", "int", "wis", "cha"];
AD2E.abilityLabels = Object.fromEntries(AD2E.abilities.map(k => [k, `AD2E.Ability.${k}`]));

AD2E.alignments = {
  lg: "AD2E.Alignment.lg", ng: "AD2E.Alignment.ng", cg: "AD2E.Alignment.cg",
  ln: "AD2E.Alignment.ln", n: "AD2E.Alignment.n", cn: "AD2E.Alignment.cn",
  le: "AD2E.Alignment.le", ne: "AD2E.Alignment.ne", ce: "AD2E.Alignment.ce"
};

AD2E.classGroups = {
  warrior: "AD2E.Group.warrior",
  wizard: "AD2E.Group.wizard",
  priest: "AD2E.Group.priest",
  rogue: "AD2E.Group.rogue"
};

AD2E.saves = ["par", "rsw", "pet", "br", "sp"];

/** Return the row whose [min, max] contains value (clamped to the table ends). */
export function lookup(table, value) {
  return table.find(r => value >= r.min && value <= r.max)
    ?? (value < table[0].min ? table[0] : table.at(-1));
}

/**
 * Ability tables (PHB Tables 1-6) generated from the AD&D 2e fandom wiki by
 * tools/build-ability-tables.py. Rows are { min, max, ...columns } keyed by score;
 * strExceptional is keyed by the 18/xx percentile (100 = 18/00).
 */
AD2E.abilityTables = ABILITY_TABLES;

/**
 * Table-driven ability tests. The target is the named column of the ability's current
 * row; the test succeeds when the roll is <= target. `failsOnSuccess` marks tests where
 * rolling under the target means the bad outcome (e.g. Wisdom spell failure); `outcomes`
 * overrides the Success/Failure chat labels.
 */
AD2E.abilityTests = {
  openDoors:    { ability: "str", die: "1d20",  field: "openDoors" },
  openLocked:   { ability: "str", die: "1d20",  field: "openLocked" },
  bendBars:     { ability: "str", die: "1d100", field: "bendBars" },
  systemShock:  { ability: "con", die: "1d100", field: "systemShock" },
  resurrection: { ability: "con", die: "1d100", field: "resurrection" },
  learnSpell:   { ability: "int", die: "1d100", field: "learnSpell" },
  spellFailure: { ability: "wis", die: "1d100", field: "spellFailure", failsOnSuccess: true,
                  outcomes: { success: "AD2E.Test.SpellWorks", failure: "AD2E.Test.SpellFails" } }
};

/** THAC0 = 20 - floor((level - 1) / divisor) * step, by class group. */
AD2E.thac0Progression = {
  warrior: { divisor: 1, step: 1 },
  priest:  { divisor: 3, step: 2 },
  rogue:   { divisor: 2, step: 1 },
  wizard:  { divisor: 3, step: 1 }
};

/** Hit die size per group (used for CON bonus bookkeeping; HP itself is entered manually). */
AD2E.hitDie = { warrior: 10, priest: 8, rogue: 6, wizard: 4 };
