/**
 * Skills & Powers nonweapon proficiency ratings (Player's Option: Skills & Powers, chapter 6; world setting
 * "spProficiencies", off by default). With the setting on, a nonweapon proficiency listed on Table 45 is checked against
 * its initial rating (Table 45) plus the Table 44 modifier of the better of its relevant abilities ("the player can choose
 * which ability modifies the proficiency", Using Proficiencies in Play (POSP)) instead of the PHB ability + modifier.
 * Owner's rulings: no character points and no subabilities, so a subability ("Wisdom/Intuition") counts as its ability;
 * each extra nonweapon slot spent on the proficiency adds +1 (the PHB rule, Nonweapon Proficiencies II (PHB)), and the
 * unmodified rating cannot exceed Improving Proficiencies (POSP)'s maximum (16). Tables: module/rules/sp-proficiency-tables.mjs
 * (tools/build-sp-proficiency-data.py).
 */
import { SP_PROFICIENCY } from "./rules/sp-proficiency-tables.mjs";

export { SP_PROFICIENCY };

const ABILITY_WORDS = { Strength: "str", Dexterity: "dex", Constitution: "con", Intelligence: "int", Wisdom: "wis", Charisma: "cha" };

export function registerSpProficiencies() {
  game.settings.register("ad2e", "spProficiencies", {
    name: "AD2E.SPProf.Setting", hint: "AD2E.SPProf.SettingHint", scope: "world", config: true, type: Boolean, default: false,
    requiresReload: true
  });
}

export function spProficienciesOn() {
  try { return game.settings.get("ad2e", "spProficiencies") === true; } catch { return false; }
}

/** Table 44: proficiency modifier for an ability score (below 3 as 3, 18 or more as 18). */
export function abilityModifier(score) {
  const s = Math.max(3, Math.min(18, Math.floor(Number(score) || 0)));
  return SP_PROFICIENCY.abilityModifier[String(s)] ?? 0;
}

/**
 * Relevant ability keys: the Table 45 abilities for a known identifier, otherwise the item's own S&P ability text
 * ("Wisdom/Willpower, Charisma/Leadership" -> ["wis", "cha"]).
 */
export function spAbilityKeys(identifier, text = "") {
  const known = SP_PROFICIENCY.abilities[identifier];
  if (known) return [...known];
  return [...String(text).matchAll(/(Strength|Dexterity|Constitution|Intelligence|Wisdom|Charisma)/g)].map(m => ABILITY_WORDS[m[1]]);
}

/**
 * Skills & Powers check number, or null when the proficiency has no S&P rating (it then keeps the PHB check).
 * @param {object} o
 * @param {string} o.identifier   proficiency identifier
 * @param {number|null} o.rating  the item's S&P initial rating (system.sp.rating)
 * @param {string} [o.abilityText] the item's S&P ability text (system.sp.ability)
 * @param {string} [o.group]      the character's class group (Table 45 ratings that differ between lists)
 * @param {number} [o.extra]      extra nonweapon slots spent on it (+1 each)
 * @param {Record<string, number>} o.scores  ability scores by key (effective totals)
 * @returns {{ base: number, unmodified: number, capped: boolean, ability: string|null, abilityMod: number, target: number }|null}
 */
export function spRating({ identifier, rating, abilityText = "", group = "", extra = 0, scores }) {
  const base = SP_PROFICIENCY.byGroup[identifier]?.[group] ?? rating;
  if (base === null || base === undefined) return null;
  const max = SP_PROFICIENCY.maxRating;
  const raw = base + Math.max(0, extra || 0);
  const unmodified = Math.min(max, raw);
  let ability = null;
  let abilityMod = 0;
  for (const key of spAbilityKeys(identifier, abilityText)) {
    if (scores?.[key] === undefined) continue;
    const mod = abilityModifier(scores[key]);
    if (ability === null || mod > abilityMod) {
      ability = key;
      abilityMod = mod;
    }
  }
  return { base, unmodified, capped: raw > max, ability, abilityMod, target: unmodified + abilityMod };
}
