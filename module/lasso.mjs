/**
 * Lasso (Weapon Descriptions (POCT)) with the called shot, opposed rolls and pull/trip of Attack Options (POCT); figures in
 * COMBAT_TABLES.lasso (tools/build-combat-tables.py, regex-checked). Pure rules; AD2EActor#rollLasso runs the dialog.
 *  - Only with a called shot (-4 to hit, +1 initiative); never a normal attack.
 *  - Legs: on a hit, pull/trip: opposed Strength against the defender's better of Dexterity and Strength, +4 for the lasso;
 *    4 per size step, -2 against four or more legs, +3 if unaware, -6 if stationary. Attacker wins: knocked down; defender
 *    wins or both fail: nothing; tie: both fall. Mounted with the lasso tied to the saddle: the mount's size.
 *  - Arms: opposed attack roll, the lasso user against AC 10, the defender against AC 4 (the defender's AC of Disarm/Grab;
 *    the lasso text's "instead of AC 2" names no defender AC, implementation choice). Lowest successful roll wins; the
 *    attacker winning by 4 or more traps both arms, else one (random). A defender who fails his roll loses by more than any
 *    success: both arms (implementation choice). Tie: the contest goes on next round.
 *  - Spur: tied to the saddle, the next round's pull/trip needs no attack roll.
 *  - Unhorse: a called shot hit; a moving rider with the lasso tied to something solid falls at once, otherwise opposed
 *    Strength (no other modifiers named).
 *  - Monsters: Dexterity = movement rate, Strength = 3.5 per size + Hit Dice (sizes counted T = 1 to G = 6,
 *    implementation choice).
 */
import { COMBAT_TABLES } from "./rules/combat-tables.mjs";

export const LASSO = COMBAT_TABLES.lasso;

/** Size step (T = 1 ... G = 6), or null. */
export function sizeStep(letter) {
  const i = LASSO.sizes.indexOf(String(letter ?? "").trim().charAt(0).toUpperCase());
  return i < 0 ? null : i + 1;
}

/** A monster's pull/trip scores: Dexterity = movement rate, Strength = 3.5 per size + Hit Dice. */
export function monsterScores(size, hitDice, movement) {
  const step = sizeStep(size) ?? sizeStep("M");
  const hd = Math.max(parseFloat(String(hitDice ?? "").match(/\d+(\.\d+)?/)?.[0] ?? "0") || 0, 0);
  const move = parseInt(String(movement ?? "").match(/\d+/)?.[0] ?? "0", 10) || 0;
  return { str: Math.floor(LASSO.monsterStrPerSize * step + hd), dex: move };
}

/** The attacker's Strength for a pull/trip with the modifiers that apply. */
export function pullTripScore(str, { attackerSize = "M", defenderSize = "M", lasso = true, fourLegs = false, unaware = false, stationary = false } = {}) {
  const pt = LASSO.pullTrip;
  const parts = [];
  const steps = (sizeStep(attackerSize) ?? 3) - (sizeStep(defenderSize) ?? 3);
  if (lasso) parts.push(["lasso", LASSO.legs]);
  if (steps) parts.push(["size", steps * pt.perSize]);
  if (fourLegs) parts.push(["fourLegs", pt.fourLegs]);
  if (unaware) parts.push(["unaware", pt.unaware]);
  if (stationary) parts.push(["stationary", pt.stationary]);
  return { score: str + parts.reduce((n, [, v]) => n + v, 0), parts };
}

/** Opposed ability check: the highest roll not above its score wins. "attacker" | "defender" | "tie" | "bothFail". */
export function opposedCheck(aScore, aRoll, dScore, dRoll) {
  const a = aRoll <= aScore, d = dRoll <= dScore;
  if (!a && !d) return "bothFail";
  if (a && !d) return "attacker";
  if (!a && d) return "defender";
  return aRoll > dRoll ? "attacker" : (dRoll > aRoll ? "defender" : "tie");
}

/** Opposed attack roll: the lowest roll that still reaches its number wins. Result and the margin (defender - attacker). */
export function opposedAttack(aNeed, aRoll, dNeed, dRoll) {
  const a = aRoll >= aNeed, d = dRoll >= dNeed;
  if (!a) return { result: "defender", margin: 0 };
  if (!d) return { result: "attacker", margin: Infinity };
  if (aRoll === dRoll) return { result: "tie", margin: 0 };
  return aRoll < dRoll ? { result: "attacker", margin: dRoll - aRoll } : { result: "defender", margin: 0 };
}

/** Arms trapped by a won opposed attack roll: 2 when won by 4 or more, else 1. */
export function armsTrapped(margin) {
  return margin >= LASSO.bothArms ? 2 : 1;
}

/**
 * Net (Weapon Descriptions (POCT); COMBAT_TABLES.net): thrown at an AC where "Only the target's Dexterity and magical
 * adjustments to Armor Class count"; a hit may trap weapon and shield; "break free by making a Strength check"; looping
 * the rope round (another attack roll at the same AC) lowers that Strength by 4; once unfolded it is thrown at -4 until
 * folded again (2 rounds). It can also pull/trip (Attack Options (POCT)), without the lasso's +4.
 * Unfolded state: item flag `ad2e.unfolded` (set by a throw, cleared by folding).
 */
export const NET = COMBAT_TABLES.net;

/** The AC a net is thrown against: 10 with the Dexterity adjustment (negative = better) and magical protection (pluses). */
export function netAc(dexAc = 0, magic = 0) {
  return NET.baseAc + (Number(dexAc) || 0) - (Number(magic) || 0);
}

/** The Strength a netted creature rolls under to break free: -4 once the rope is looped round. */
export function breakFreeScore(str, wrapped = false) {
  return str + (wrapped ? NET.improveStr : 0);
}
