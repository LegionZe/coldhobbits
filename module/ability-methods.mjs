/**
 * Ability score generation, "Rolling Ability Scores (PHB)" (Alternative Dice-Rolling Methods):
 *  II  3d6 twice per ability, in order; keep the preferred result of each pair.
 *  III 3d6 six times; assign the totals to the abilities as desired.
 *  IV  3d6 twelve times; choose six and assign them as desired.
 *  V   4d6 six times, discarding the lowest die of each; assign as desired.
 *  VI  every ability starts at 8; roll seven dice (d6) and add each whole die to an ability as desired; no score may
 *      exceed 18 ("If you cannot make an 18 by exact count on the dice, you cannot have an 18 score").
 * Pure functions (no Foundry calls) so the rules can be tested; the dialog is module/apps/ability-roller.mjs.
 */
export const ABILITY_KEYS = ["str", "dex", "con", "int", "wis", "cha"];

export const METHODS = {
  2: { dice: "3d6", count: 12, kind: "pairs" },
  3: { dice: "3d6", count: 6, kind: "pool" },
  4: { dice: "3d6", count: 12, kind: "pool" },
  5: { dice: "4d6", count: 6, kind: "pool", dropLowest: true },
  6: { dice: "1d6", count: 7, kind: "dice", base: 8, max: 18 }
};

/**
 * Build the method's results from rolled dice: `rolls` = one array of die faces per roll (e.g. [[4, 2, 6], ...]).
 * Returns [{ index, dice, dropped, total }] (dropped: the discarded lowest die for method V).
 */
export function results(method, rolls) {
  const m = METHODS[method];
  return rolls.map((faces, index) => {
    let dropped = null;
    let kept = [...faces];
    if (m.dropLowest) {
      const low = Math.min(...faces);
      kept.splice(kept.indexOf(low), 1);
      dropped = low;
    }
    return { index, dice: faces, dropped, total: kept.reduce((n, d) => n + d, 0) };
  });
}

/**
 * Scores from an assignment, with validation. `assignment`:
 *  pairs: { ability: 0 | 1 } (which roll of the ability's pair; pair n = results 2n and 2n+1, abilities in order)
 *  pool:  { ability: result index } (each result used at most once; method IV uses six of twelve)
 *  dice:  { dieIndex: ability } (each die to one ability)
 * Returns { scores: { ability: n | null }, errors: [message keys with data] }.
 */
export function scores(method, res, assignment) {
  const m = METHODS[method];
  const out = Object.fromEntries(ABILITY_KEYS.map(k => [k, null]));
  const errors = [];
  if (m.kind === "pairs") {
    ABILITY_KEYS.forEach((k, i) => {
      const pick = Number(assignment[k] ?? 0) === 1 ? 1 : 0;
      out[k] = res[i * 2 + pick]?.total ?? null;
    });
  } else if (m.kind === "pool") {
    const used = new Map();
    for (const k of ABILITY_KEYS) {
      const idx = assignment[k];
      if (idx === undefined || idx === null || idx === "") continue;
      const r = res[Number(idx)];
      if (!r) continue;
      if (used.has(r.index)) errors.push({ key: "AD2E.AbilityRoll.UsedTwice", data: { roll: r.index + 1 } });
      used.set(r.index, k);
      out[k] = r.total;
    }
    if (ABILITY_KEYS.some(k => out[k] === null)) errors.push({ key: "AD2E.AbilityRoll.Unassigned", data: {} });
  } else {
    for (const k of ABILITY_KEYS) out[k] = m.base;
    res.forEach((r, i) => {
      const k = assignment[i];
      if (ABILITY_KEYS.includes(k)) out[k] += r.total;
    });
    if (res.some((r, i) => !ABILITY_KEYS.includes(assignment[i]))) errors.push({ key: "AD2E.AbilityRoll.DiceLeft", data: {} });
    for (const k of ABILITY_KEYS) {
      if (out[k] > m.max) errors.push({ key: "AD2E.AbilityRoll.OverMax", data: { ability: k, max: m.max, score: out[k] } });
    }
  }
  return { scores: out, errors };
}

/** Default assignment: pairs keep the higher roll; pools take the rolls in order (method IV: the six highest, in roll
 * order); method VI leaves the dice unassigned. */
export function defaultAssignment(method, res) {
  const m = METHODS[method];
  if (m.kind === "pairs") {
    return Object.fromEntries(ABILITY_KEYS.map((k, i) => [k, (res[i * 2 + 1]?.total ?? 0) > (res[i * 2]?.total ?? 0) ? 1 : 0]));
  }
  if (m.kind === "pool") {
    const chosen = res.length > 6
      ? [...res].sort((a, b) => b.total - a.total || a.index - b.index).slice(0, 6).sort((a, b) => a.index - b.index)
      : res;
    return Object.fromEntries(ABILITY_KEYS.map((k, i) => [k, chosen[i]?.index ?? ""]));
  }
  return {};
}
