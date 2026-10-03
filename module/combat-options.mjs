/**
 * Two-weapon fighting and unarmed (non-lethal) combat rules (tables generated: module/rules/combat-tables.mjs).
 * Pure functions (no Foundry calls) so the rules can be tested; the dialogs are in AD2EActor.
 *  - "Attacking with Two Weapons (PHB)": -2 main weapon, -4 second weapon, + Dexterity Reaction Adjustment, never
 *    above 0; warriors and rogues only; rangers have no penalty in studded leather or lighter ("Ranger (PHB)").
 *  - "Attacking Without Killing (PHB)": Table 57 wrestling armour modifiers, Table 58 punching/wrestling results,
 *    overbearing modifiers, non-lethal weapon attacks.
 */
import { COMBAT_TABLES as T } from "./rules/combat-tables.mjs";

export { T as COMBAT_TABLES };

/** Whether a class group may fight with two weapons. */
export function canFightTwoWeapons(group) {
  return T.twoWeapon.groups.includes(group);
}

/**
 * Two-weapon attack penalty for `hand` ("main" | "off"); `armorAc` = the equipped body armour's base AC (null: none).
 * The Reaction Adjustment can at best raise the penalty to 0.
 */
export function twoWeaponPenalty(hand, { reaction = 0, ranger = false, armorAc = null } = {}) {
  const base = T.twoWeapon[hand];
  if (typeof base !== "number") return 0;
  if (ranger && (armorAc === null || armorAc >= T.twoWeapon.rangerMaxArmorAc)) return 0;
  return Math.min(base + reaction, 0);
}

/**
 * Whether `off` may be the second weapon beside `main` ({ proficiency, size, weight }): smaller in size and weight;
 * a dagger is always allowed. Unknown weight is not compared.
 */
export function secondWeaponAllowed(main, off) {
  if (off.proficiency === T.twoWeapon.smallAlways) return true;
  const order = T.overbear.sizes;
  const smaller = order.indexOf(off.size) >= 0 && order.indexOf(off.size) < order.indexOf(main.size);
  const lighter = off.weight === null || off.weight === undefined || main.weight === null || main.weight === undefined
    || off.weight < main.weight;
  return smaller && lighter;
}

/** Table 57 row for wrestling in the armour with this identifier (null: no modifier). */
export function wrestlingArmor(identifier) {
  return identifier ? (T.wrestlingArmor.find(r => r.armor.includes(identifier)) ?? null) : null;
}

/** Table 58 row for a modified attack roll (20 or more: the 20+ row; below 1: the "less than 1" row). */
export function punchWrestleResult(total) {
  return T.punchWrestle.find(r => (r.min === null || total >= r.min) && (r.max === null || total <= r.max));
}

/** Overbearing attack modifier: size difference x4, -2 per defender leg beyond two, +1 per attacker beyond the first. */
export function overbearModifier({ attacker = "M", defender = "M", legs = 2, attackers = 1 } = {}) {
  const o = T.overbear;
  const diff = o.sizes.indexOf(attacker) - o.sizes.indexOf(defender);
  return { size: diff * o.perSize, legs: Math.max(legs - 2, 0) * o.perLeg, attackers: Math.max(attackers - 1, 0) * o.perAttacker };
}

/** Whether a weapon can be used non-lethally: a blade that can be turned (slashing damage type, melee). */
export function nonlethalAllowed(weapon) {
  return !!weapon?.melee && /S/.test(String(weapon.type ?? ""));
}
