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
  // Combat & Tactics footnote h: "require two hands to wield regardless of the wielder's size".
  if ([...(weapon?.rules ?? [])].includes("twoHands")) return true;
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
 * With the two weapon style specialization the reduced penalties replace these.
 * The Reaction Adjustment can at best raise the penalty to 0.
 */
export function twoWeaponPenalty(hand, { reaction = 0, ranger = false, armorAc = null, style = null } = {}) {
  // `style`: two weapon style specialization penalties { main, off } (Skills & Powers, module/sp-weapons.mjs).
  const base = style ? style[hand] : T.twoWeapon[hand];
  if (typeof base !== "number") return 0;
  if (ranger && (armorAc === null || armorAc >= T.twoWeapon.rangerMaxArmorAc)) return 0;
  return Math.min(base + reaction, 0);
}

/**
 * Two-weapon penalties { main, off } for a character: the Skills & Powers two-weapon style's, the Ambidexterity
 * trait's ("suffering no penalty for the first hand, and only a –2 penalty for off-hand use", Traits & Disadvantages
 * Descriptions (POSP); text checked by tools/build-trait-data.py), the better of the two per hand; null: the PHB's.
 */
export const AMBIDEXTERITY = { main: 0, off: -2 };
export function twoWeaponStyle(sys, spStyle = null) {
  const ambi = !!sys?.traits?.ids?.includes?.("ambidexterity");
  if (!ambi) return spStyle;
  if (!spStyle) return { ...AMBIDEXTERITY };
  return { main: Math.max(spStyle.main, AMBIDEXTERITY.main), off: Math.max(spStyle.off, AMBIDEXTERITY.off) };
}

/**
 * Whether `off` may be the second weapon beside `main` ({ proficiency, size, weight }): smaller in size and weight;
 * a dagger is always allowed. Unknown weight is not compared. `equalSize`: also a weapon of the same size.
 */
export function secondWeaponAllowed(main, off, { equalSize = false } = {}) {
  if (off.proficiency === T.twoWeapon.smallAlways) return true;
  const order = T.overbear.sizes;
  const o = order.indexOf(off.size);
  const m = order.indexOf(main.size);
  // Skills & Powers two weapon style, improved: "two weapons of equal size, so long as each ... can be wielded in one hand".
  if (equalSize && o >= 0 && o === m) return true;
  const smaller = o >= 0 && o < m;
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

/* ---------------------------------------- Mounted combat (Unusual Combat Situations (DMG)) */

/** Rates of fire from fastest to slowest, as [attacks, rounds]: the ladder the mounted reduction steps down. */
export const RATE_LADDER = [[5, 1], [9, 2], [4, 1], [7, 2], [3, 1], [5, 2], [2, 1], [3, 2], [1, 1], [1, 2]];

/** "2", "3/2", "1/2" -> [attacks, rounds]; null when not a rate. */
export function parseRate(text) {
  const m = String(text ?? "").trim().match(/^(\d+)\s*(?:\/\s*(\d+))?$/);
  return m ? [Number(m[1]), Number(m[2] ?? 1)] : null;
}

/**
 * Rate of fire from a moving mount: "reduced by one" (owner's ruling: one step down RATE_LADDER, at least 1/2).
 * A rate between two steps drops to the next slower one.
 */
export function stepDownRate(rate) {
  const v = rate[0] / rate[1];
  const i = RATE_LADDER.findIndex(r => r[0] / r[1] < v - 1e-9);
  return i < 0 ? RATE_LADDER.at(-1) : (RATE_LADDER[i][0] / RATE_LADDER[i][1] === v ? RATE_LADDER[Math.min(i + 1, RATE_LADDER.length - 1)] : RATE_LADDER[i]);
}

/** Half as many attacks (missile style after a full move): [a, b] -> [a, 2b], reduced. */
export function halveRate([a, b]) {
  return a % 2 === 0 ? [a / 2, b] : [a, b * 2];
}

/**
 * Whether a mount is trained for combat: its `combatTrained` choice ("yes" / "no"), or by default a war mount
 * (identifier with "war", e.g. horse-heavy war ... camel-war; owner's ruling) - "Mounts trained for combat (a heavy
 * warhorse, for example) present few problems" (Unusual Combat Situations (DMG)).
 */
export function mountTrained(mount) {
  const choice = mount?.system?.combatTrained ?? "";
  if (choice === "yes") return true;
  if (choice === "no") return false;
  const id = String(mount?.system?.identifier ?? "");
  return /(^|-)war(-|$)/.test(id) || /^horse-(heavy|medium|light)$/.test(id);
}

/**
 * Problems with firing from a moving mount (DMG): no riding proficiency ("possible only if the rider is proficient in
 * horsemanship"); a weapon other than short bow, composite short bow, light crossbow (long bows only for specialists;
 * a heavy crossbow can be fired once, not reloaded). Returns keys: "noRiding", "weapon", "specialistOnly", "once".
 */
export function mountedFireIssues({ weapon, specialized = false, proficiencies = [] }) {
  const M = T.mounted;
  const out = [];
  if (!proficiencies.some(p => M.proficiencies.includes(p))) out.push("noRiding");
  if (M.weapons.includes(weapon)) return out;
  if (M.specialist.includes(weapon)) { if (!specialized) out.push("specialistOnly"); return out; }
  out.push(M.once.includes(weapon) ? "once" : "weapon");
  return out;
}

/**
 * Melee from horseback (Fighting from Horseback, Unusual Combat Situations (DMG)): a rider has +1 to hit a creature
 * smaller than the mount, but not another rider; a combatant on foot has -1 against a rider (not against the mount).
 * @param {{mountSize: string|null, targetSize: string, targetRiding: boolean}} p  mountSize null = attacker on foot
 * @returns {{key: "smaller"|"vsRider"|null, value: number}}
 */
export function mountedMeleeModifier({ mountSize = null, targetSize = "M", targetRiding = false } = {}) {
  const sizes = T.overbear.sizes;
  if (mountSize) {
    return !targetRiding && sizes.indexOf(targetSize) < sizes.indexOf(mountSize) ? { key: "smaller", value: T.mounted.smaller }
      : { key: null, value: 0 };
  }
  return targetRiding ? { key: "vsRider", value: T.mounted.vsRider } : { key: null, value: 0 };
}
