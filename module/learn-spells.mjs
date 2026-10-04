/**
 * Learning wizard spells (Intelligence (PHB) Table 4, Specialist Wizard (PHB), Wizard (PHB)):
 *  - chance: Table 4 "Chance to Learn Spell"; specialists +15% for spells of their school, -15% for other schools;
 *    spells of an opposition school cannot be learned;
 *  - no spell above the Intelligence maximum spell level;
 *  - optional rule (world setting "maxSpellsPerLevel", on by default): at most Table 4 "Max # of Spells per Level" known
 *    spells of each level;
 *  - "If the wizard fails the roll, they cannot check that spell again until they advance to the next level"
 *    (`learnFailedLevel` on the spell item); a learned spell is kept (`learned`).
 */
import { schoolStems } from "./config.mjs";

export const SPECIALIST_LEARN = 15;

function maxPerLevelOn() {
  try { return game.settings.get("ad2e", "maxSpellsPerLevel") !== false; } catch { return true; }
}

/** { chance, parts: [text], blocked: reason key | null } for a wizard spell item and a character. */
export function learnChance(actor, spell) {
  const sys = actor.system;
  const s = spell.system;
  const int = sys.abilityData?.int ?? {};
  const parts = [`${game.i18n.localize("AD2E.Learn.Base")} ${int.learnSpell ?? 0}%`];
  let chance = int.learnSpell ?? 0;
  let blocked = null;
  if (sys.spells?.kind !== "wizard" || s.kind !== "wizard") blocked = "notWizard";
  const cls = sys.classInfo?.classItem?.system ?? null;
  const stems = (s.schools ?? []).flatMap(schoolStems);
  if (cls?.school) {
    const own = schoolStems(cls.school);
    if (cls.opposition && stems.some(st => schoolStems(cls.opposition).includes(st))) blocked ??= "opposition";
    const mod = stems.some(st => own.includes(st)) ? SPECIALIST_LEARN : -SPECIALIST_LEARN;
    chance += mod;
    parts.push(`${game.i18n.localize(mod > 0 ? "AD2E.Learn.OwnSchool" : "AD2E.Learn.OtherSchool")} ${mod > 0 ? "+" : ""}${mod}%`);
  }
  if ((int.maxSpellLevel ?? 0) < s.level) blocked ??= "level";
  if (maxPerLevelOn()) {
    const known = actor.items.filter(i => i.type === "spell" && i.id !== spell.id && i.system.kind === "wizard"
      && i.system.level === s.level && i.system.learned !== false).length;
    if (int.maxSpells !== null && int.maxSpells !== undefined && known >= int.maxSpells) blocked ??= "full";
  }
  if (s.learned === false && s.learnFailedLevel !== null && s.learnFailedLevel !== undefined && sys.level <= s.learnFailedLevel) {
    blocked ??= "failed";
  }
  return { chance: Math.max(chance, 0), parts, blocked };
}

/** Roll to learn a spell the character owns but has not learned: d100 <= chance. */
export async function rollLearnSpell(actor, spell) {
  const i18n = k => game.i18n.localize(k);
  const { chance, parts, blocked } = learnChance(actor, spell);
  if (blocked) {
    ui.notifications.warn(game.i18n.format(`AD2E.Learn.Blocked.${blocked}`, { name: spell.name, level: spell.system.learnFailedLevel ?? "" }));
    return null;
  }
  const roll = await new Roll("1d100").evaluate();
  const ok = roll.total <= chance;
  await spell.update(ok ? { "system.learned": true, "system.learnFailedLevel": null }
    : { "system.learned": false, "system.learnFailedLevel": actor.system.level });
  const esc = v => foundry.utils.escapeHTML?.(String(v ?? "")) ?? String(v ?? "");
  return roll.toMessage({
    speaker: ChatMessage.getSpeaker({ actor }),
    flavor: game.i18n.format("AD2E.Learn.Chat", { name: esc(spell.name), chance }) + ` [${esc(parts.join("; "))}]: `
      + i18n(ok ? "AD2E.Learn.Success" : "AD2E.Learn.Failure")
  });
}
