/**
 * Rules data for AD&D 2e. Values are numeric tables only, transcribed from memory
 * of the Player's Handbook ability tables and MUST be verified against a owned copy
 * before play. Edit here; nothing else hard-codes these numbers.
 */

export const AD2E = {};

AD2E.abilities = ["str", "dex", "con", "int", "wis", "cha"];

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

/** Return first row whose [min, max] contains value. */
export function lookup(table, value) {
  return table.find(r => value >= r.min && value <= r.max) ?? table.at(-1);
}

/** Strength. `exc` is the 18/xx percentile (1-100, 100 = 18/00); only used when score is 18. */
AD2E.strTable = [
  { min: 1,  max: 3,  hit: -3, dmg: -1 },
  { min: 4,  max: 5,  hit: -2, dmg: -1 },
  { min: 6,  max: 7,  hit: -1, dmg: 0 },
  { min: 8,  max: 15, hit: 0,  dmg: 0 },
  { min: 16, max: 16, hit: 0,  dmg: 1 },
  { min: 17, max: 17, hit: 1,  dmg: 1 },
  { min: 18, max: 18, hit: 1,  dmg: 2 }
];
AD2E.strExceptional = [
  { min: 1,  max: 50,  hit: 1, dmg: 3 },
  { min: 51, max: 75,  hit: 2, dmg: 3 },
  { min: 76, max: 90,  hit: 2, dmg: 4 },
  { min: 91, max: 99,  hit: 2, dmg: 5 },
  { min: 100, max: 100, hit: 3, dmg: 6 }
];

/** Dexterity. `ac` is the adjustment to descending AC (negative = better). */
AD2E.dexTable = [
  { min: 1,  max: 3,  reaction: -3, missile: -3, ac: 4 },
  { min: 4,  max: 4,  reaction: -2, missile: -2, ac: 3 },
  { min: 5,  max: 5,  reaction: -1, missile: -1, ac: 2 },
  { min: 6,  max: 6,  reaction: 0,  missile: 0,  ac: 1 },
  { min: 7,  max: 14, reaction: 0,  missile: 0,  ac: 0 },
  { min: 15, max: 15, reaction: 0,  missile: 0,  ac: -1 },
  { min: 16, max: 16, reaction: 1,  missile: 1,  ac: -2 },
  { min: 17, max: 17, reaction: 2,  missile: 2,  ac: -3 },
  { min: 18, max: 25, reaction: 2,  missile: 2,  ac: -4 }
];

/** Constitution hit-point adjustment per die; `warrior` applies only to warrior group. */
AD2E.conTable = [
  { min: 1,  max: 3,  hp: -2, warrior: -2 },
  { min: 4,  max: 6,  hp: -1, warrior: -1 },
  { min: 7,  max: 14, hp: 0,  warrior: 0 },
  { min: 15, max: 15, hp: 1,  warrior: 1 },
  { min: 16, max: 16, hp: 2,  warrior: 2 },
  { min: 17, max: 17, hp: 2,  warrior: 3 },
  { min: 18, max: 25, hp: 2,  warrior: 4 }
];

/** Wisdom magical attack adjustment to saves vs. mind-affecting spells. */
AD2E.wisTable = [
  { min: 1,  max: 3,  magicDef: -3 },
  { min: 4,  max: 4,  magicDef: -2 },
  { min: 5,  max: 7,  magicDef: -1 },
  { min: 8,  max: 14, magicDef: 0 },
  { min: 15, max: 15, magicDef: 1 },
  { min: 16, max: 16, magicDef: 2 },
  { min: 17, max: 17, magicDef: 3 },
  { min: 18, max: 25, magicDef: 4 }
];

/** THAC0 = 20 - floor((level - 1) / divisor) * step, by class group. */
AD2E.thac0Progression = {
  warrior: { divisor: 1, step: 1 },
  priest:  { divisor: 3, step: 2 },
  rogue:   { divisor: 2, step: 1 },
  wizard:  { divisor: 3, step: 1 }
};

/** Hit die size per group (used for CON bonus bookkeeping; HP itself is entered manually). */
AD2E.hitDie = { warrior: 10, priest: 8, rogue: 6, wizard: 4 };
