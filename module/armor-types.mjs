import { ARMOR_TYPES } from "./rules/armor-type-tables.mjs";

/**
 * PHB Table 52 Weapon Type vs. Armor Modifiers (optional rule, world setting `weaponVsArmor`; owner's ruling: off by
 * default, applied automatically). module/rules/armor-type-tables.mjs (tools/build-armor-type-tables.py): the values are
 * "applied to the attacker's THAC0" (here: subtracted from the attack roll); only against body armour of the table (a
 * natural Armor Class uses none; magical bonuses do not change the type); a weapon of several types (S/P) uses "the mode
 * most favorable to the attacker". Monster natural attacks have a `type` (S, P, B; blank = none).
 */
export const TABLE52 = ARMOR_TYPES.table;

export function table52On() {
  try { return !!game.settings.get("ad2e", "weaponVsArmor"); } catch { return false; }
}

/** Damage type letters of a weapon type text ("S/P" -> ["S", "P"]). Pure. */
export function typeLetters(text) {
  return [...new Set(String(text ?? "").toUpperCase().split(/[^BPS]+/).flatMap(s => s.split("")).filter(Boolean))];
}

/** Identifier of the body armour a target wears (characters: the AC armour; monsters: equipped body armour), or null. */
export function wornBodyArmor(actor) {
  if (!actor) return null;
  if (actor.type === "character") return actor.system?.armor?.body?.system?.identifier ?? null;
  const body = actor.items?.find?.(i => i.type === "armor" && i.system?.equipped && i.system?.kind === "body");
  return body?.system?.identifier ?? null;
}

/**
 * The Table 52 modifier to the attack roll (pure): { mod, type, row } for the best of the weapon's types against the
 * armour, or null (no type, or armour not in the table).
 */
export function table52Modifier(typeText, armorId) {
  const row = TABLE52[armorId];
  const types = typeLetters(typeText);
  if (!row || !types.length) return null;
  const best = types.reduce((a, t) => (row[t] < row[a] ? t : a), types[0]);
  return { mod: -row[best] || 0, type: best, row: row.row };
}

/** For an attack: the modifier against the first target's armour when the setting is on; else null. */
export function table52ForTarget(typeText, targetActor) {
  if (!table52On()) return null;
  return table52Modifier(typeText, wornBodyArmor(targetActor));
}

/** Chat/dialog text: "Table 52 (Chain mail, B): +2". */
export function table52Text(t) {
  return t ? game.i18n.format("AD2E.Table52.Note", { armor: t.row, type: t.type, mod: `${t.mod >= 0 ? "+" : ""}${t.mod}` }) : "";
}

export function registerTable52() {
  game.settings.register("ad2e", "weaponVsArmor", {
    name: "AD2E.Table52.Setting", hint: "AD2E.Table52.SettingHint", scope: "world", config: true, type: Boolean, default: false
  });
}
