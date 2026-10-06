/**
 * Dual-class characters (world setting "dualClass", off by default; Multi-Class and Dual-Class Characters (PHB),
 * "Dual-Class Benefits and Restrictions"). Pure rules; the character data model and actor use them.
 *  - "Only humans can be dual-classed characters"; prime requisites "15 or more" in the current class and "17 or more"
 *    in the new one; "at least 2nd level in his current class before changing"; no return to an earlier class.
 *  - The new class starts "at 1st level with 0 experience points, but he does retain his previous Hit Dice and hit
 *    points"; no hit points are gained until the new level is higher than every earlier class's level.
 *  - Until then (`restricted`), using an old class's abilities, or its better attack or saving throw numbers, costs the
 *    experience of that encounter and half that of the adventure. Afterwards the better of the old and new THAC0 and
 *    saving throws apply (owner's ruling) and old abilities are free.
 * Owner's rulings: the penalty is two flags on the character (encounter, adventure) set by any roll using an old
 * ability; experience awards ask whether they are for an encounter (0 with the encounter flag) or the adventure (half
 * with the adventure flag) and clear the flags they apply; old THAC0 / saves are a tick box in roll dialogs while
 * restricted. Implementation choice: proficiency slots are the larger of the old class's (at its last level) and the
 * new class's (the PHB states only that the old proficiencies are kept).
 */

export const DUAL_RULES = { primeOld: 15, primeNew: 17, minLevel: 2, race: "human" };

export function registerDualClass() {
  game.settings.register("ad2e", "dualClass", {
    name: "AD2E.Dual.Setting", hint: "AD2E.Dual.SettingHint", scope: "world", config: true, type: Boolean, default: false,
    requiresReload: true
  });
}

export function dualClassOn() {
  try { return game.settings.get("ad2e", "dualClass") === true; } catch { return false; }
}

/**
 * Whether a character may dual-class into `next`.
 * @param {object} o
 * @param {string} o.raceId          race identifier
 * @param {number} o.level           current class level
 * @param {object} o.current         current class system data ({ identifier, prime: Set|array })
 * @param {object} o.next            new class system data ({ identifier, prime, alignments })
 * @param {Record<string, number>} o.scores  effective ability scores
 * @param {string} o.alignment
 * @param {Array<{identifier: string}>} [o.previous]  earlier classes
 * @returns {{ ok: boolean, reasons: string[] }}  reasons are localization keys under AD2E.Dual.Reason
 */
export function dualEligibility({ raceId, level, current, next, scores, alignment, previous = [] }) {
  const reasons = [];
  const prime = c => [...(c?.prime ?? [])];
  if (raceId !== DUAL_RULES.race) reasons.push("race");
  if (!current || !next) reasons.push("noClass");
  else {
    if (current.identifier === next.identifier || previous.some(p => p.identifier === next.identifier)) reasons.push("same");
    if ((level ?? 1) < DUAL_RULES.minLevel) reasons.push("level");
    if (prime(current).some(k => (scores[k] ?? 0) < DUAL_RULES.primeOld)) reasons.push("primeOld");
    if (prime(next).some(k => (scores[k] ?? 0) < DUAL_RULES.primeNew)) reasons.push("primeNew");
    const allowed = next.alignments ? [...next.alignments] : [];
    if (allowed.length && alignment && !allowed.includes(alignment)) reasons.push("alignment");
  }
  return { ok: reasons.length === 0, reasons };
}

/** Highest level of the earlier classes, and whether the restrictions still apply at `level`. */
export function dualRestriction(previous, level) {
  const maxOld = previous?.length ? Math.max(...previous.map(p => p.level ?? 0)) : 0;
  return { maxOld, restricted: !!previous?.length && level <= maxOld };
}

/** Whether a new class level gains hit points: only once it exceeds every earlier class's level. */
export function gainsHitPoints(previous, newLevel) {
  return !previous?.length || newLevel > dualRestriction(previous, 0).maxOld;
}

/**
 * Experience award under the penalty flags.
 * @param {number} amount
 * @param {"encounter"|"adventure"} kind  what the award is for
 * @param {{encounter: boolean, adventure: boolean}} penalty
 * @returns {{ gain: number, rule: "" | "none" | "half", clear: {encounter?: boolean, adventure?: boolean} }}
 */
export function penalizedAward(amount, kind, penalty = {}) {
  if (kind === "encounter") {
    return penalty.encounter ? { gain: 0, rule: "none", clear: { encounter: false } } : { gain: amount, rule: "", clear: {} };
  }
  return penalty.adventure ? { gain: Math.floor(amount / 2), rule: "half", clear: { encounter: false, adventure: false } }
    : { gain: amount, rule: "", clear: { encounter: false } };
}

/** Better (lower) of two target numbers; null/undefined ignored. */
export function better(a, b) {
  if (a === null || a === undefined) return b ?? null;
  if (b === null || b === undefined) return a;
  return Math.min(a, b);
}
