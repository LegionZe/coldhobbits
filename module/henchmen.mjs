import { ad2eDialog } from "./dialogs.mjs";
/**
 * Henchmen (Henchmen (PHB), Henchmen (DMG), Charisma (PHB) Table 6) and morale checks (Morale (DMG) Tables 49/50,
 * generated in module/rules/encounter-tables.mjs).
 *  - A character's henchmen are actor UUIDs in `system.henchmen.actors` (drop an actor on the sheet); `lost` counts
 *    former henchmen, since the Charisma maximum "is a lifetime limit, not just a maximum possible at any given time".
 *  - "A henchman is always of lower level than the PC. Should he ever equal or surpass the PC's level, the henchman
 *    leaves forever" (Henchmen (PHB)): a character henchman at or above the PC's level is flagged.
 *  - Morale: 2d10, holding at or under the rating (Table 49: henchmen 15) plus the master's Charisma Loyalty Base
 *    ("the subtraction from or addition to the henchmen's and other servitors' loyalty scores", Charisma (PHB)) and the
 *    Table 50 situations ticked.
 */
import { ENCOUNTER_TABLES } from "./rules/encounter-tables.mjs";
import { modifierFields, modifierText, readModifier } from "./roll-modifiers.mjs";

export const MORALE = ENCOUNTER_TABLES.morale;

/** Henchmen of a character: [{ uuid, actor (or null if missing), name, level, tooHigh }] and the Charisma limits. */
export function henchmenInfo(pc) {
  const resolve = foundry.utils.fromUuidSync ?? globalThis.fromUuidSync;
  const sys = pc.system;
  const cha = sys.abilityData?.cha ?? {};
  const list = (sys.henchmen?.actors ?? []).map(uuid => {
    const actor = resolve?.(uuid, { strict: false }) ?? null;
    const level = actor?.type === "character" ? actor.system.level : null;
    return { uuid, actor, name: actor?.name ?? uuid, img: actor?.img ?? "icons/svg/mystery-man.svg",
      level, hitDice: actor?.type === "monster" ? actor.system.hitDice : null,
      tooHigh: level !== null && level >= sys.level };
  });
  const max = cha.henchmen ?? 0;
  const lifetime = list.length + (sys.henchmen?.lost ?? 0);
  return { list, max, lost: sys.henchmen?.lost ?? 0, lifetime, over: lifetime > max, loyalty: cha.loyalty ?? 0,
    morale: MORALE.henchmen + (cha.loyalty ?? 0) };
}

/**
 * Morale dialog: Table 50 situations (tick boxes) and a modifier. Resolves { sum, text, mod, note } or null.
 */
export async function promptMorale(title) {
  const esc = v => foundry.utils.escapeHTML?.(String(v ?? "")) ?? String(v ?? "");
  const boxes = MORALE.situations.map(m => `<label><input type="checkbox" name="t50-${m.key}"> ${esc(m.label)} (${m.value > 0 ? "+" : ""}${m.value})</label>`).join("");
  return ad2eDialog.prompt({
    classes: ["ad2e"],
    window: { title },
    content: `<p class="ad2e-note">${game.i18n.localize("AD2E.Henchmen.MoraleHint")}</p>`
      + `<fieldset><legend>${game.i18n.localize("AD2E.Henchmen.Situations")}</legend><div class="ad2e-dialog-scroll"><div class="ad2e-check-grid">${boxes}</div></div></fieldset>`
      + modifierFields(),
    ok: { label: game.i18n.localize("AD2E.Roll.Roll"), callback: (event, button) => {
      const picked = MORALE.situations.filter(m => button.form.elements[`t50-${m.key}`]?.checked);
      return { sum: picked.reduce((n, m) => n + m.value, 0), text: picked.map(m => `${m.label} ${m.value > 0 ? "+" : ""}${m.value}`).join("; "),
        ...readModifier(button.form) };
    } },
    rejectClose: false
  });
}

/** Morale check for a henchman of `pc`: 2d10 <= 15 + Loyalty Base + situations + modifier. */
export async function rollHenchmanMorale(pc, henchman) {
  const info = henchmenInfo(pc);
  const name = henchman?.name ?? "";
  const input = await promptMorale(game.i18n.format("AD2E.Henchmen.MoraleTitle", { name }));
  if (!input) return null;
  const target = info.morale + input.sum + input.mod;
  const roll = await new Roll("2d10").evaluate();
  const esc = v => foundry.utils.escapeHTML?.(String(v ?? "")) ?? String(v ?? "");
  return roll.toMessage({
    speaker: henchman ? ChatMessage.getSpeaker({ actor: henchman }) : ChatMessage.getSpeaker({ actor: pc }),
    flavor: game.i18n.format("AD2E.Henchmen.MoraleChat", { name: esc(name), master: esc(pc.name), base: MORALE.henchmen,
      loyalty: `${info.loyalty >= 0 ? "+" : ""}${info.loyalty}`, target })
      + (input.text ? ` [${esc(input.text)}]` : "") + modifierText(input.mod, input.note) + ": "
      + game.i18n.localize(roll.total <= target ? "AD2E.Monster.Stands" : "AD2E.Monster.Breaks")
  });
}
