import { ATTACK_OPTIONS } from "./rules/attack-option-tables.mjs";

/**
 * Called shots and the Combat & Tactics attack options (world setting `attackOptions`, owner's ruling: off by default;
 * module/rules/attack-option-tables.mjs from tools/build-attack-option-tables.py). The attack dialog offers a maneuver:
 *  - called shot: -4 (or -6 / -8), +1 initiative (noted), the location aimed at for System II criticals;
 *  - sap: -4 (-8 against a helmet), Small or Medium targets; damage as punching (25% lasting) and a knockout chance of 5%
 *    per point (max 40%; 10% / 80% against a surprised, asleep, restrained or held victim), 3d10 rounds;
 *  - disarm, grab, trap: opposed attack rolls, the attacker against AC 0, the victim against AC 4 (a two-handed weapon
 *    makes that side's AC 4 points worse); a weapon two sizes larger cannot be disarmed; grab then opposed Strength (-3
 *    with one hand); block: the blocker against AC 4, the opponent's attack against the blocker's AC;
 *  - pull/trip (the weapons named): an attack roll, then opposed Strength as the lasso's (module/lasso.mjs) without its +4;
 *  - shield-punch (shield damage, -4 as an extra attack or none as a substitute; the primary attack -2 that round, noted)
 *    and shield-rush (attack, then opposed Strength with the shield's knockdown bonus; a miss: Dexterity check).
 * Owner's ruling: the defender's side of opposed rolls is rolled automatically from the target's numbers (shown in the
 * dialog, editable). Implementation choices: the defender's THAC0 without situational adjustments; the body shield is
 * the "Large" shield; the disarmed weapon's direction is a d8 compass point.
 */
export const AO = ATTACK_OPTIONS;
export const OPPOSED = ["disarm", "grab", "trap", "block"];

export function attackOptionsOn() {
  try { return !!game.settings.get("ad2e", "attackOptions"); } catch { return false; }
}

/** Whether a weapon item can pull or trip (pure). */
export function canPullTrip(item) {
  const id = String(item?.system?.identifier ?? "").replace(/^poct-/, "");
  return AO.pullTrip.includes(id);
}

/** The equipped shield's identifier for shield-punch / rush, or null (pure on the item list). */
export function shieldOf(items) {
  const s = [...(items ?? [])].find(i => i.type === "armor" && i.system?.equipped && i.system?.kind === "shield");
  const id = s?.system?.identifier;
  return id && AO.shieldPunch.shields[id] ? { item: s, id } : null;
}

/** Maneuvers offered for an attack (pure). */
export function maneuversFor({ item, use = "melee", items = [] }) {
  const out = ["normal", "calledShot"];
  if (use === "melee") out.push("sap");
  const ropeLike = /\b(net|lasso|sling|whip)\b/i.test(item?.name ?? "") && use === "melee";
  out.push("disarm", "grab", "trap");
  if (use === "melee" && !ropeLike) out.push("block");
  if (canPullTrip(item)) out.push("pullTrip");
  if (use === "melee" && shieldOf(items)) out.push("shieldPunch", "shieldRush");
  return out;
}

/** Sap knockout chance (pure): 5% per point up to 40%, or 10% up to 80% against a helpless victim. */
export function sapChance(damage, helpless = false) {
  const s = AO.sap;
  return Math.min(Math.max(Number(damage) || 0, 0) * (helpless ? s.helplessPerPoint : s.perPoint), helpless ? s.helplessMax : s.max);
}

const SIZES = ["T", "S", "M", "L", "H", "G"];
const step = s => { const i = SIZES.indexOf(String(s ?? "M").charAt(0).toUpperCase()); return i < 0 ? 2 : i; };

/** A weapon two sizes larger than the disarming weapon cannot be disarmed (pure). */
export function disarmPossible(attackerWeaponSize, defenderWeaponSize) {
  return step(defenderWeaponSize) - step(attackerWeaponSize) <= AO.disarm.maxSteps;
}

/** Target Armor Classes of an opposed maneuver (pure): { attackerAc, defenderAc }, a two-handed weapon +4 to its side. */
export function opposedAcs(kind, { attackerTwoHanded = false, defenderTwoHanded = false, blockerAc = 10 } = {}) {
  if (kind === "block") return { attackerAc: AO.block.ac, defenderAc: blockerAc };
  const t = AO[kind];
  return { attackerAc: t.attackerAc + (attackerTwoHanded ? AO.disarm.twoHanded : 0), defenderAc: t.victimAc + (defenderTwoHanded ? AO.disarm.twoHanded : 0) };
}

/** Shield-rush Strength with its modifiers (pure): size ±4 per step, +3 unaware, -2 four or more legs. */
export function rushScore(str, { attackerSize = "M", defenderSize = "M", unaware = false, fourLegs = false } = {}) {
  const r = AO.shieldRush;
  return str + (step(attackerSize) - step(defenderSize)) * r.perSize + (unaware ? r.unaware : 0) + (fourLegs ? r.fourLegs : 0);
}

export function registerAttackOptions() {
  game.settings.register("ad2e", "attackOptions", {
    name: "AD2E.Maneuver.Setting", hint: "AD2E.Maneuver.SettingHint", scope: "world", config: true, type: Boolean, default: false
  });
}
