/**
 * Multi-class characters (world setting "multiClass", off by default; Multi-Class and Dual-Class Characters (PHB),
 * "Multi-Class Combinations" and "Multi-Class Benefits and Restrictions"). Pure rules; the character data model, actor
 * and sheet use them.
 *  - "Only demihumans can be multi-class characters", in the combinations listed per race (race item `multiClass`,
 *    tools/build-race-data.py); the classes are taken at character creation (all at 1st level, no experience yet).
 *  - "His experience is divided equally between each class"; each share gets that class's prime requisite bonus
 *    (owner's ruling). A class at its racial level limit stops advancing but still takes its share (owner's ruling).
 *  - The character "always uses the most favorable combat value and the best saving throw".
 *  - Hit points: at creation each class's Hit Die is rolled, "totals them up, then divides by the number of dice rolled
 *    (round fractions down)", plus the Constitution bonus; later a class's new Hit Die is divided by the number of
 *    classes ("round fractions down, but a Hit Die never yields less than 1 hit point") and the Constitution bonus is
 *    split between the classes (rounded down here).
 *  - Proficiency slots: "the largest number of proficiency slots of the different classes", new ones "at the fastest of
 *    the given rates".
 * Owner's rulings also: at most one kit, fitting any of the classes.
 */

/** Class group order for the class that drives the single-class code paths (warrior first: warrior Constitution). */
export const PRIMARY_ORDER = ["warrior", "priest", "rogue", "wizard"];

export function registerMultiClass() {
  game.settings.register("ad2e", "multiClass", {
    name: "AD2E.Multi.Setting", hint: "AD2E.Multi.SettingHint", scope: "world", config: true, type: Boolean, default: false,
    requiresReload: true
  });
}

export function multiClassOn() {
  try { return game.settings.get("ad2e", "multiClass") === true; } catch { return false; }
}

/** Sorted key of a set of class identifiers ("bard/fighter"). */
export function comboKey(ids) {
  return [...ids].sort().join("/");
}

/**
 * Complete Bard's Handbook multi-class bards (race `multiClassKits`, tools/build-race-data.py): the bard kits a
 * combination needs, or null when the classes are not such a combination. "true-bard" is also met by no kit ("If the
 * kits are not used in your campaign, only those combinations that include the True Bard can be used").
 */
export function bardKitRule(kitCombos, ids) {
  const kits = kitCombos?.[comboKey(ids)];
  return kits ? { kits: [...kits] } : null;
}

export function bardKitFits(rule, kitId) {
  if (!rule) return true;
  return rule.kits.includes(kitId ?? "") || (!kitId && rule.kits.includes("true-bard"));
}

/** Whether a set of class identifiers is one of the race's combinations (order does not matter). */
export function combinationAllowed(combinations, ids) {
  const key = [...ids].sort().join("/");
  return [...(combinations ?? [])].some(c => c.split("/").sort().join("/") === key);
}

/** Whether some combination of the race contains all of `ids` (so more classes could still be added). */
export function combinationStarted(combinations, ids) {
  return [...(combinations ?? [])].some(c => { const set = new Set(c.split("/")); return [...ids].every(i => set.has(i)); });
}

/**
 * Whether a class can be added to a character's classes as multi-class.
 * @param {object} o
 * @param {Iterable<string>} o.combinations  the race's combinations
 * @param {Array<{identifier: string, level: number, xp: number}>} o.classes  the current classes
 * @param {object} o.next   the new class's system data ({ identifier, alignments, min })
 * @param {string} o.alignment
 * @param {Record<string, number>} o.scores  effective ability scores
 * @returns {{ ok: boolean, reasons: string[] }}  reasons: keys under AD2E.Multi.Reason
 */
export function multiEligibility({ combinations, kitCombos = {}, classes, next, alignment, scores }) {
  const reasons = [];
  const ids = classes.map(c => c.identifier);
  combinations = [...(combinations ?? []), ...Object.keys(kitCombos ?? {})];
  if (!combinations.length) reasons.push("race");
  else if (ids.includes(next.identifier)) reasons.push("same");
  else if (!combinationStarted(combinations, [...ids, next.identifier])) reasons.push("combination");
  if (classes.some(c => (c.level ?? 1) > 1 || (c.xp ?? 0) > 0)) reasons.push("creation");
  const allowed = next.alignments ? [...next.alignments] : [];
  if (allowed.length && alignment && !allowed.includes(alignment)) reasons.push("alignment");
  if (Object.entries(next.min ?? {}).some(([k, v]) => v && (scores?.[k] ?? 0) < v)) reasons.push("minimum");
  return { ok: reasons.length === 0, reasons };
}

/** The class that drives the single-class code paths: by group (warrior, priest, rogue, wizard), then identifier. */
export function primaryClass(classes) {
  return [...classes].sort((a, b) => (PRIMARY_ORDER.indexOf(a.group) - PRIMARY_ORDER.indexOf(b.group))
    || String(a.identifier).localeCompare(String(b.identifier)))[0] ?? null;
}

/**
 * Experience divided equally between the classes, each share with that class's prime requisite bonus (percent).
 * @param {number} amount
 * @param {Array<{identifier: string, bonus: number}>} classes
 * @returns {Array<{identifier: string, share: number, gain: number, bonus: number}>}
 */
export function splitExperience(amount, classes) {
  const n = classes.length || 1;
  const share = Math.floor(amount / n);
  return classes.map(c => ({ identifier: c.identifier, share, bonus: c.bonus ?? 0, gain: Math.floor(share * (100 + (c.bonus ?? 0)) / 100) }));
}

/** 1st-level hit points: the classes' first Hit Dice totalled, divided by the number of dice (down), plus Constitution. */
export function firstLevelHitPoints(rolls, con = 0) {
  const total = rolls.reduce((n, r) => n + r, 0);
  return Math.max(Math.floor(total / (rolls.length || 1)), 1) + con;
}

/**
 * Hit points for one class's new level: the roll divided by the number of classes (down, at least 1 per die) and the
 * class's share of the Constitution bonus (`con` per die, divided, down) and of a fixed per-level bonus.
 */
export function levelHitPoints({ roll = 0, dice = 0, fixed = 0, con = 0, classes = 1 }) {
  const n = Math.max(classes, 1);
  const fromDice = dice > 0 ? Math.max(Math.floor(roll / n), dice) : 0;
  return fromDice + Math.floor((con * dice) / n) + Math.floor(fixed / n);
}

/** Proficiency slots: the largest initial number and the fastest rate (slots at each class's own level, best). */
export function multiSlots(rules) {
  const initial = Math.max(...rules.map(r => r.initial));
  const gained = Math.max(...rules.map(r => Math.floor(r.level / r.rate)));
  return initial + gained;
}

/**
 * An experience award for a multi-class character: the split (splitExperience), the actor update (the primary class's
 * experience in `system.xp`, the others in `system.multiClass.classes`) and whether any class can now advance (not at
 * its racial level limit).
 * @param {Array<{identifier: string, primary: boolean, level: number, xp: number, xpNext: number|null, bonus: number,
 *   levelLimit: number|null}>} classes  derived `system.multi.classes`
 * @param {number} amount
 */
export function multiAward(classes, amount) {
  const split = splitExperience(amount, classes);
  const update = {};
  const entries = [];
  const rows = classes.map((c, i) => {
    const xp = (c.xp ?? 0) + split[i].gain;
    if (c.primary) update["system.xp"] = xp;
    else entries.push({ identifier: c.identifier, level: c.level ?? 1, xp });
    const canLevel = c.xpNext !== null && c.xpNext !== undefined && xp >= c.xpNext && !(c.levelLimit && c.level >= c.levelLimit);
    return { identifier: c.identifier, name: c.name, share: split[i].share, bonus: split[i].bonus, gain: split[i].gain, xp, canLevel };
  });
  update["system.multiClass.classes"] = entries;
  return { update, rows, gain: rows.reduce((n, r) => n + r.gain, 0), canLevel: rows.some(r => r.canLevel) };
}

/** The stored entries for the non-primary classes after one of them changes (`changes` merged into its entry). */
export function multiEntries(classes, identifier, changes) {
  return classes.filter(c => !c.primary).map(c => ({ identifier: c.identifier, level: c.level ?? 1, xp: c.xp ?? 0,
    ...(c.identifier === identifier ? changes : {}) }));
}

/**
 * Kit sources whose handbook allows their kits only for single-class characters (shown as a warning; the GM decides,
 * owner's ruling): "only single-class warriors can take one of the Warrior Kits" (Warrior Kits and Multi-Class
 * Characters (CFH), rev 75760) and "only single-class thieves can take one of the Thief Kits" (Thief Types and
 * Multi-Class Characters (CTH), rev 78678). The Complete Priest's Handbook allows "only one kit, total" for a
 * multi-class priest (Multi-Class and Dual-Class Characters (CPrH), rev 140770), which the one-kit rule covers.
 */
export const SINGLE_CLASS_KITS = {
  "Complete Fighter's Handbook": "Warrior Kits and Multi-Class Characters (CFH)",
  "Complete Thief's Handbook": "Thief Types and Multi-Class Characters (CTH)"
};
