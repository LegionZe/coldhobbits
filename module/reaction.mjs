/**
 * Encounter reactions (DMG Table 59, "Encounter Reactions (DMG)"; table generated in module/rules/encounter-tables.mjs):
 * "roll 2d10 and add the numbers on the two dice. Increase or decrease this number by any modifiers in the creature
 * description or the morale modifiers", then read the column that matches how the player characters behave.
 * Low results are friendly. The speaking character's Charisma reaction adjustment ("the penalty or bonus due to the
 * character because of charisma when dealing with nonplayer characters and intelligent creatures", Charisma (PHB)) and
 * kit reaction modifiers are bonuses for the character, so they are subtracted from the roll (a bonus makes the
 * reaction friendlier, a penalty less friendly).
 */
import { ENCOUNTER_TABLES } from "./rules/encounter-tables.mjs";
import { modifierFields, modifierText, readModifier } from "./roll-modifiers.mjs";

export const REACTION_COLUMNS = ["friendly", "indifferent", "threatening", "hostile"];

/** Table 59 result for a modified total and the player characters' behaviour (column). */
export function reactionResult(total, column) {
  const row = ENCOUNTER_TABLES.reactions.find(r => (r.min === null || total >= r.min) && (r.max === null || total <= r.max));
  return row?.[column] ?? null;
}

/** The speaker's reaction adjustment: Charisma (PHB Table 6) + unconditional kit reaction modifiers. */
export function speakerAdjustment(actor) {
  if (actor?.type !== "character") return { cha: 0, kit: 0, options: [] };
  const sys = actor.system;
  return { cha: sys.abilityData?.cha?.reaction ?? 0, kit: sys.kitMods?.total?.("reaction") ?? 0,
    options: sys.kitMods?.options?.("reaction") ?? [] };
}

/**
 * Roll an encounter reaction (GM only; the result is whispered to the GMs). `creature` (optional) is the monster
 * or NPC whose reaction is rolled; the speaking character defaults to the user's assigned character or a controlled
 * character token.
 */
export async function rollEncounterReaction(creature = null) {
  const i18n = k => game.i18n.localize(k);
  const esc = v => foundry.utils.escapeHTML?.(String(v ?? "")) ?? String(v ?? "");
  const pcs = game.actors?.filter?.(a => a.type === "character" && a.hasPlayerOwner) ?? [];
  const controlled = globalThis.canvas?.tokens?.controlled?.map(t => t.actor).find(a => a?.type === "character");
  const preferred = controlled ?? game.user?.character ?? null;
  const signed = n => `${n > 0 ? "+" : ""}${n}`;
  const speakerOptions = [`<option value="">${i18n("AD2E.Reaction.NoSpeaker")}</option>`, ...pcs.map(a => {
    const adj = speakerAdjustment(a);
    return `<option value="${a.id}"${a.id === preferred?.id ? " selected" : ""}>${esc(a.name)} (${i18n("AD2E.Reaction.Cha")} ${signed(adj.cha)}${adj.kit ? `, ${i18n("AD2E.Reaction.Kit")} ${signed(adj.kit)}` : ""})</option>`;
  })];
  // Conditional kit reaction modifiers of every listed character (shown with its name; only the speaker's count).
  const kitRows = pcs.flatMap(a => speakerAdjustment(a).options.map(m => ({ actor: a, m })));
  const content = `<p class="ad2e-note">${i18n("AD2E.Reaction.Hint")}</p>`
    + `<div class="form-group"><label>${i18n("AD2E.Reaction.Behaviour")}</label><select name="column">${REACTION_COLUMNS.map(c =>
      `<option value="${c}"${c === "indifferent" ? " selected" : ""}>${i18n(`AD2E.Reaction.Column.${c}`)}</option>`).join("")}</select></div>`
    + `<div class="form-group"><label>${i18n("AD2E.Reaction.Speaker")}</label><select name="speaker">${speakerOptions.join("")}</select></div>`
    + (kitRows.length ? `<fieldset><legend>${i18n("AD2E.Reaction.KitSituational")}</legend>${kitRows.map(({ actor, m }) =>
      `<div class="form-group"><label>${esc(`${actor.name}: ${signed(m.current)} ${m.condition}`)}</label>`
      + `<input type="checkbox" name="kitreact" value="${actor.id}.${m.index}"></div>`).join("")}</fieldset>` : "")
    + modifierFields();
  const input = await foundry.applications.api.DialogV2.prompt({
    classes: ["ad2e"],
    window: { title: creature ? game.i18n.format("AD2E.Reaction.TitleFor", { name: creature.name }) : i18n("AD2E.Reaction.Title") },
    content,
    ok: { label: i18n("AD2E.Roll.Roll"), callback: (event, button) => {
      const f = button.form.elements;
      const ticked = [...(button.form.querySelectorAll?.("input[name=kitreact]:checked") ?? [])].map(i => i.value);
      return { column: f.column?.value ?? "indifferent", speaker: f.speaker?.value || null, ticked, ...readModifier(button.form) };
    } },
    rejectClose: false
  });
  if (!input) return null;
  const speaker = input.speaker ? (game.actors.get(input.speaker) ?? null) : null;
  const adj = speakerAdjustment(speaker);
  const kitPicked = adj.options.filter(m => input.ticked.includes(`${speaker?.id}.${m.index}`));
  const bonus = adj.cha + adj.kit + kitPicked.reduce((n, m) => n + m.current, 0);
  // A bonus for the speaker lowers the roll (friendlier); the manual modifier is added as entered.
  const roll = await new Roll("2d10 - @bonus + @mod", { bonus, mod: input.mod }).evaluate();
  const result = reactionResult(roll.total, input.column);
  const parts = [speaker ? `${speaker.name}: ${i18n("AD2E.Reaction.Cha")} ${signed(adj.cha)}` : null,
    adj.kit ? `${i18n("AD2E.Reaction.Kit")} ${signed(adj.kit)}` : null,
    ...kitPicked.map(m => `${m.condition} ${signed(m.current)}`)].filter(Boolean);
  const flavor = `${creature ? game.i18n.format("AD2E.Reaction.TitleFor", { name: esc(creature.name) }) : i18n("AD2E.Reaction.Title")}`
    + ` (${i18n(`AD2E.Reaction.Column.${input.column}`)})${parts.length ? ` [${esc(parts.join("; "))}]` : ""}`
    + `${modifierText(input.mod, input.note)}: <strong>${i18n(`AD2E.Reaction.Result.${result}`)}</strong>`;
  return roll.toMessage({ speaker: creature ? ChatMessage.getSpeaker({ actor: creature }) : ChatMessage.getSpeaker(), flavor },
    { rollMode: "gmroll" });
}
