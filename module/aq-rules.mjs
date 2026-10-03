/**
 * Al-Qadim optional rules (tables generated in module/rules/aq-tables.mjs by tools/build-aq-equipment-data.py).
 * Heat ("Armor in Fiery Zakhara (AA)", world setting "aqArmorHeat", off by default): worn armour better than AC 7 gives
 * -1 per class to attack rolls and to proficiency and ability checks. Only the armour's own rating counts (magical
 * bonuses do not); daraqs and bucklers do not count.
 */
import { AQ_TABLES } from "./rules/aq-tables.mjs";

const H = AQ_TABLES.heat;

export function registerAqRules() {
  game.settings.register("ad2e", "aqArmorHeat", {
    name: "AD2E.AQ.HeatSetting", hint: "AD2E.AQ.HeatSettingHint", scope: "world", config: true, type: Boolean, default: false
  });
}

export function heatRuleOn() {
  try { return game.settings.get("ad2e", "aqArmorHeat") === true; } catch { return false; }
}

/**
 * Heat penalty for worn armour: `body` and `shield` are the equipped armour items (or null). The armour class from the
 * items alone (no magical bonus): body armour's rating (10 without), less the shield's non-magical melee bonus.
 */
export function heatPenalty(body, shield) {
  let ac = body?.system?.ac ?? 10;
  if (shield && !H.exempt.includes(shield.system?.identifier)) ac -= shield.system?.shield?.melee ?? 0;
  return Math.max(0, H.maxAc - ac) * H.perClass || 0; // per class better than AC 7 (perClass = -1)
}
