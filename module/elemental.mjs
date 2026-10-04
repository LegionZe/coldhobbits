/**
 * Elemental mage kit (Al-Qadim; Elemental Mage (Character Kit)): one of "the four elemental provinces: sand, sea,
 * flame, or wind" (character `system.element`).
 *  - "+1 to each damage die inflicted with an attack using that element (magical or otherwise)": spell damage of a
 *    spell in that province (spell `system.provinces`) and weapon damage ticked as using it.
 *  - "if the mage suffers an attack using the specialty element, a -2 penalty is applied to each damage die (with a
 *    minimum of no damage inflicted)": damage messages carry `flags.ad2e.element` { provinces, dice: [value of each
 *    die, the attacker's own per-die bonus included], flat: the rest of the total }, and applying the damage to such a
 *    mage counts each die at value - 2, at least 0.
 */
export const ELEMENTAL_KIT = "elemental-mage";
export const PROVINCES = ["flame", "sand", "sea", "wind"];
export const DIE_BONUS = 1;
export const DIE_WARD = 2;

/** Whether a kit item is the elemental mage kit (by identifier, or by name: world copies may carry another identifier). */
export function isElementalKit(kit) {
  if (!kit) return false;
  const id = kit.system?.identifier ?? "";
  return id === ELEMENTAL_KIT || /^elemental mage\b/i.test(kit.name ?? "");
}

/** The character's kit item if it is the elemental mage kit (whether or not it fits the class), otherwise null. */
function elementalKit(actor) {
  if (actor?.type !== "character") return null;
  const kit = actor.system?.classInfo?.kitItem ?? [...(actor.items ?? [])].find(i => i.type === "kit");
  return isElementalKit(kit) ? kit : null;
}

/** The province of an elemental mage (kit taken, province chosen), otherwise null. */
export function elementOf(actor) {
  if (!elementalKit(actor)) return null;
  return PROVINCES.includes(actor.system.element) ? actor.system.element : null;
}

/** Whether a character has the elemental mage kit (the province may not be chosen yet). */
export function isElementalMage(actor) {
  return !!elementalKit(actor);
}

/** The attacker's bonus per damage die for an attack in these provinces (0 if not its province). */
export function dieBonus(actor, provinces = []) {
  const el = elementOf(actor);
  return el && provinces.includes(el) ? DIE_BONUS : 0;
}

/**
 * Element data for a damage message from an evaluated roll: each die's value plus the attacker's per-die bonus, and the
 * rest of the total (constants and modifiers) as `flat`.
 */
export function elementFlag(roll, provinces, perDie = 0, extra = 0) {
  const dice = (roll?.dice ?? []).flatMap(d => d.results.filter(r => r.active !== false && !r.discarded).map(r => r.result + perDie));
  const total = (roll?.total ?? 0) + extra;
  return { provinces: [...provinces], dice, flat: total - dice.reduce((n, v) => n + v, 0) };
}

/** Number of dice rolled. */
export function diceCount(roll) {
  return (roll?.dice ?? []).reduce((n, d) => n + d.results.filter(r => r.active !== false && !r.discarded).length, 0);
}

/**
 * Damage an actor takes from a message: an elemental mage of one of the message's provinces takes each die at -2
 * (at least 0) plus the rest; null when the rule does not apply.
 */
export function wardedDamage(actor, flag) {
  const el = elementOf(actor);
  if (!el || !flag?.provinces?.includes(el) || !Array.isArray(flag.dice)) return null;
  return Math.max(flag.dice.reduce((n, v) => n + Math.max(v - DIE_WARD, 0), 0) + (flag.flat ?? 0), 0);
}
