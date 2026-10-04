/**
 * Two-weapon fighting and unarmed (non-lethal) combat rules (tables generated: module/rules/combat-tables.mjs).
 * Pure functions (no Foundry calls) so the rules can be tested; the dialogs are in AD2EActor.
 *  - "Attacking with Two Weapons (PHB)": -2 main weapon, -4 second weapon, + Dexterity Reaction Adjustment, never
 *    above 0; warriors and rogues only; rangers have no penalty in studded leather or lighter ("Ranger (PHB)").
 *  - "Attacking Without Killing (PHB)": Table 57 wrestling armour modifiers, Table 58 punching/wrestling results,
 *    overbearing modifiers, non-lethal weapon attacks.
 */
import { COMBAT_TABLES as T } from "./rules/combat-tables.mjs";
import { RACE_SIZE } from "./rules/race-tables.mjs";

export { T as COMBAT_TABLES };

/**
 * Whether a character fights with two weapons without the attack penalty (in studded leather or lighter): rangers
 * ("Ranger (PHB)") and corsairs ("the corsair suffers no penalty to attack rolls", Corsair - Al-Qadim).
 */
export function twoWeaponExempt(sys) {
  const kit = sys?.classInfo?.kitFits ? sys.classInfo.kitItem?.system.identifier : null;
  return sys?.classInfo?.classItem?.system.identifier === "ranger" || T.twoWeapon.exemptKits.includes(kit);
}

/** A character's size category from the race (RACE_SIZE; no race: M). */
export function characterSize(raceId) {
  return RACE_SIZE[raceId] ?? "M";
}

/**
 * Whether a weapon needs two hands: one size larger than the wielder ("A character can also use a weapon one size
 * greater than himself although it must be gripped with two hands", Weapons (PHB)), or a two-handed grip (`use.label`,
 * bastard sword). Unknown sizes: false.
 */
export function needsTwoHands(weapon, size = "M", use = null) {
  if (/^two-handed$/i.test(String(use?.label ?? ""))) return true;
  const order = T.overbear.sizes;
  const w = order.indexOf(weapon?.size);
  const c = order.indexOf(size);
  return w >= 0 && c >= 0 && w > c;
}

/**
 * Attacks per round with a second weapon: one more attack each round ("The character gains only one additional attack
 * each round ... a warrior able to attack 3/2 ... can attack 5/2", Attacking with Two Weapons (PHB)).
 */
export function twoWeaponRate([attacks, rounds]) {
  return [attacks + rounds, rounds];
}

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
