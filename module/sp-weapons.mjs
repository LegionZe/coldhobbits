/**
 * Skills & Powers weapon rules (Player's Option: Skills & Powers, chapter 7; world setting "spWeapons", off by default).
 * Tables and the costs and bonuses of the text are generated in module/rules/sp-weapon-tables.mjs by
 * tools/build-sp-weapon-data.py. Pure functions; CharacterData#computeProficiencies applies them.
 *
 * Payment (owner's ruling): character point (CP) costs are paid with weapon proficiency slots, CP / Table 48 cost per
 * slot (warriors 2, others 3), rounded up, for each purchase separately (the proficiency, the weapon of choice,
 * expertise, specialization, mastery, a style's improvement). Costs the text gives in slots are used as given (group
 * proficiencies: tight 2, broad 3; shield proficiency: warriors 1, others 2).
 * Minimum levels and allowed classes (Tables 53, 54; groups for warriors only; one style for priests, rogues, wizards)
 * are enforced: an invalid purchase still uses its slots and gives no benefit (shown on the sheet).
 * Specialization row (Tables 53/54): fighter; ranger, paladin and other warrior classes = "Ranger/Paladin" (fighter
 * subclasses); priests, rogues, wizards by group. Multi-classed characters are not modelled (no multi-class support).
 */
import { SP_WEAPONS } from "./rules/sp-weapon-tables.mjs";

export const SP = SP_WEAPONS;

export function registerSpWeapons() {
  game.settings.register("ad2e", "spWeapons", {
    name: "AD2E.SP.Setting", hint: "AD2E.SP.SettingHint", scope: "world", config: true, type: Boolean, default: false,
    requiresReload: true
  });
}

export function spWeaponsOn() {
  try { return game.settings.get("ad2e", "spWeapons") === true; } catch { return false; }
}

/** Weapon proficiency slots for a CP cost (rounded up). */
export function cpSlots(cp, group) {
  return cp > 0 ? Math.ceil(cp / (SP.cpPerSlot[group] ?? SP.cpPerSlot.rogue)) : 0;
}

/** Table 53/54 row for a class. */
export function specRow(classId, group) {
  if (classId === "fighter") return "fighter";
  if (group === "warrior") return "ranger-paladin";
  return group;
}

/** Table 49 groups containing a weapon proficiency identifier: { tight: [keys], broad: [keys] }. */
export function groupsOf(identifier) {
  const out = { tight: [], broad: [] };
  for (const [key, g] of Object.entries(SP.groups)) if (g.ids.includes(identifier)) out[g.kind].push(key);
  return out;
}

/**
 * Proficiency with a weapon (proficiency identifier): "proficient" (a weapon proficiency, or a group proficiency
 * that includes it), "familiar" (in the same tight group as a weapon of proficiency, or in the broad group of a tight
 * group proficiency; Nonproficiency and Weapon Familiarity (POSP)), or null.
 * @param {string} identifier
 * @param {{weapons: Iterable<string>, groups: Iterable<string>}} known  weapon identifiers and group keys (valid ones)
 */
export function weaponFamiliarity(identifier, { weapons = [], groups = [] } = {}) {
  if (!identifier) return null;
  const ws = new Set(weapons);
  const gs = [...groups].map(k => [k, SP.groups[k]]).filter(([, g]) => g);
  if (ws.has(identifier) || gs.some(([, g]) => g.ids.includes(identifier))) return "proficient";
  const mine = groupsOf(identifier);
  if (mine.tight.some(k => [...ws].some(w => SP.groups[k].ids.includes(w)))) return "familiar";
  if (gs.some(([, g]) => g.kind === "tight" && g.broad && SP.groups[g.broad]?.ids.includes(identifier))) return "familiar";
  return null;
}

/** Table 50 penalty for a class group: { nonproficient, familiar }. */
export function nonproficiency(group) {
  return SP.nonproficiency[group] ?? SP.nonproficiency.rogue;
}

/**
 * Cost and validity of an owned proficiency under these rules.
 * @param {object} p      proficiency system data
 * @param {object} ctx    { group, classId, level, covered (weapon in a group proficiency), free (kit free
 *                          specialization), forbidden (kit forbids specialization), extraSpec (another weapon is
 *                          specialized), styleIndex (0-based order among owned styles), shieldAllowed }
 * @returns {{slots: number, parts: Array<{key: string, cp: number|null, slots: number}>, invalid: string[],
 *            specValid: boolean, masteryValid: boolean}}
 */
export function spCost(p, ctx) {
  const { group, classId, level } = ctx;
  const cps = SP.cpPerSlot[group] ?? SP.cpPerSlot.rogue;
  const parts = [];
  const invalid = [];
  const buy = (key, cp) => parts.push({ key, cp, slots: cpSlots(cp, group) });
  const slots = (key, n) => parts.push({ key, cp: null, slots: n });
  let specValid = false;
  let masteryValid = false;
  if (p.kind === "weapon") {
    if (!p.grantedBy && !ctx.covered) buy("proficiency", cps);
    if (p.choice) buy("choice", SP.choiceCp[group]);
    if (p.expertise) buy("expertise", SP.expertiseCp[group][p.choice ? 1 : 0]);
    if (p.specialized && !ctx.free) {
      const row = SP.specialization[specRow(classId, group)];
      buy("specialization", row.cp);
      if (ctx.forbidden) invalid.push("specForbidden");
      if (level < row.level) invalid.push("specLevel");
      if (ctx.extraSpec) invalid.push("specOne");
    }
    specValid = !!ctx.free || (p.specialized && !invalid.length);
    if (p.mastery) {
      const row = SP.mastery[specRow(classId, group)];
      if (row) buy("mastery", row.cp);
      const before = invalid.length;
      if (!row) invalid.push("masteryClass");
      else if (level < row.level) invalid.push("masteryLevel");
      if (!specValid) invalid.push("masteryNeedsSpec");
      masteryValid = invalid.length === before;
    }
  } else if (p.kind === "group") {
    const g = SP.groups[p.spGroup];
    if (!g) invalid.push("unknown");
    else if (!p.grantedBy) slots("group", SP.groupSlots[g.kind]);
    if (!SP.groupSlots.classes.includes(group)) invalid.push("groupClass");
  } else if (p.kind === "style") {
    const s = SP.styles[p.style];
    if (!s) invalid.push("unknown");
    else if (!p.grantedBy) {
      let cp = cps;
      if (!s.classes.includes(group)) cp += SP.styleExtraCp;
      if (group === "wizard") cp += SP.styleOnlyOne.wizardExtraCp;
      if (p.style === "two-weapon" && !SP.twoWeapon.exempt.includes(classId)) cp += SP.twoWeapon.extraCp;
      buy("style", cp);
      if (p.improved && p.style === "one-handed") buy("improved", SP.oneHanded.improvedCp);
      if (p.improved && p.style === "two-weapon") buy("improved", SP.twoWeapon.improvedCp);
    }
    if (SP.styleOnlyOne.single.includes(group) && ctx.styleIndex > 0) invalid.push("styleOne");
  } else if (p.kind === "armor") {
    if (!p.grantedBy) slots("armor", SP.armor.slots);
    if (!p.armorType) invalid.push("unknown");
  } else if (p.kind === "shield") {
    if (!SP.shields[p.shieldType]) invalid.push("unknown");
    if (!p.grantedBy) slots("shield", group === "warrior" ? SP.shieldSlots.warrior : SP.shieldSlots.other);
    if (ctx.shieldAllowed === false) invalid.push("shieldClass");
  }
  return { slots: parts.reduce((n, x) => n + x.slots, 0), parts, invalid, specValid, masteryValid };
}

/** Table 51 row for a shield item identifier, or null. */
export function shieldType(identifier) {
  return Object.entries(SP.shields).find(([, r]) => r.items.includes(identifier))?.[0] ?? null;
}

/**
 * Fighting style AC bonus (a positive number improves AC) from weapons and shield in hand:
 * one-handed style with one one-handed weapon and nothing in the other hand: +1 (+2 improved); weapon and shield style
 * with a shield and a melee weapon: +1 (unless the +1 goes to the attack roll that round).
 * @param {{oneHanded: boolean, improved: boolean, weaponShield: boolean}} styles  valid style specializations
 * @param {{weapons: number, oneHandedWeapons: number, shield: boolean}} hands
 */
export function styleAc(styles, hands) {
  let ac = 0;
  const notes = [];
  if (styles.oneHanded && hands.weapons === 1 && hands.oneHandedWeapons === 1 && !hands.shield) {
    ac += styles.improved ? SP.oneHanded.improvedAc : SP.oneHanded.ac;
    notes.push("one-handed");
  }
  if (styles.weaponShield && hands.shield && hands.weapons >= 1) {
    ac += SP.weaponShield.ac;
    notes.push("weapon-shield");
  }
  return { ac, notes };
}
