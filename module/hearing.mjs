/**
 * Deafened and silenced (muted) actors (owner's request 1.0.94). Figures in COMBAT_TABLES.deaf / .silence
 * (tools/build-combat-tables.py, regex-checked):
 *  - Deafness (Wizard Spell) (PHB): -1 to surprise rolls unless the creature's other senses are unusually keen; a deafened
 *    caster has a 20% chance to miscast any spell with a verbal component.
 *  - Casting Spells (PHB): verbal components need a caster who can speak clearly, not silenced in any way; a spell of gestures
 *    alone can be cast within a silence; without the optional component rule every spell needs speech.
 *  - Silence, 15' Radius (Priest Spell): no spells (or none with verbal components under the component rule).
 * Statuses: core "deaf" and "silence" (token status icons; registered by `registerHearing` when a world lacks them). The
 * silenced status stands for any loss of voice (silence spell, gag, mute).
 * Effects: the surprise dialog gets a pre-ticked -1 box for a deafened actor (untick it for keen senses); a silenced caster
 * cannot begin a spell that needs the voice, and one silenced while casting loses it; a deafened caster of such a spell
 * rolls d100 when it takes effect, and 01-20 is a miscast (the spell is used up without effect).
 * Implementation choices: a spell with no recorded components needs the voice (the standard rule); a miscast uses the
 * spell and its components; the +1 initiative of Cause Blindness or Deafness (Wizard Spell) is not applied; scrolls and
 * command words are not checked.
 */
import { COMBAT_TABLES } from "./rules/combat-tables.mjs";

const T = COMBAT_TABLES;
export const DEAF_STATUS = { id: "deaf", name: "AD2E.Hearing.Deaf", img: "icons/svg/deaf.svg" };
export const SILENCE_STATUS = { id: "silence", name: "AD2E.Hearing.Silenced", img: "icons/svg/silenced.svg" };

const i18n = (k, d) => (d ? game.i18n.format(k, d) : game.i18n.localize(k));
const esc = v => foundry.utils.escapeHTML?.(String(v ?? "")) ?? String(v ?? "");

export const isDeaf = actor => !!actor?.statuses?.has?.(DEAF_STATUS.id);
export const isSilenced = actor => !!actor?.statuses?.has?.(SILENCE_STATUS.id);

/** Whether a spell needs the caster's voice (pure over spell system data): verbal, or no components recorded. */
export function needsVoice(sys) {
  const c = sys?.components ?? {};
  if (c.verbal) return true;
  return T.silence.noComponentsNeedVoice && !c.somatic && !c.material;
}

/** Whether a d100 roll is a deafened miscast (pure). */
export const isMiscast = total => Number(total) <= T.deaf.miscast;

/** The surprise dialog's deafness box (pre-ticked), or "". */
export function deafSurpriseField(actor) {
  if (!isDeaf(actor)) return "";
  return `<fieldset><legend>${esc(i18n("AD2E.Hearing.Deaf"))}</legend><div class="ad2e-check-grid"><label><input type="checkbox" name="deafSurprise" value="${T.deaf.surprise}" checked> `
    + `${esc(i18n("AD2E.Hearing.SurpriseBox", { n: T.deaf.surprise }))}</label></div></fieldset>`;
}

/** The ticked deafness surprise modifier: { value, text }. */
export function deafSurprisePicked(form) {
  const box = form?.elements?.deafSurprise;
  if (!box?.checked) return { value: 0, text: "" };
  const v = Number(box.value) || 0;
  return { value: v, text: `${i18n("AD2E.Hearing.Deaf")} ${v}` };
}

/** Whether a silenced caster may begin a spell (warns and returns false when the spell needs the voice). */
export function voiceAllows(actor, spell) {
  if (!isSilenced(actor) || !needsVoice(spell?.system)) return true;
  ui.notifications.warn(i18n("AD2E.Hearing.CannotCast", { name: actor.name, spell: spell.name }));
  return false;
}

/**
 * When the spell takes effect: null (it works), or { reason: "silenced" | "miscast", roll } when it is lost (silenced while
 * casting) or miscast (deafened, d100 01-20). The roll is posted by the caller's message.
 */
export async function voiceFailure(actor, spell) {
  if (!needsVoice(spell?.system)) return null;
  if (isSilenced(actor)) return { reason: "silenced", roll: null };
  if (!isDeaf(actor)) return null;
  const roll = await new Roll("1d100").evaluate();
  return isMiscast(roll.total) ? { reason: "miscast", roll } : { reason: "", roll };
}

/** Chat content for a lost or miscast spell. */
export function failureContent(actor, spell, failure) {
  const key = failure.reason === "silenced" ? "AD2E.Hearing.LostSilenced" : "AD2E.Hearing.Miscast";
  return `<div class="ad2e-spell-card"><h3>${esc(spell.name)}</h3><p class="ad2e-unmet">${esc(i18n(key,
    { name: actor.name, roll: failure.roll?.total ?? "", n: T.deaf.miscast }))}</p></div>`;
}

/** Register the deaf and silenced statuses when the world's status list lacks them (core lists both). */
export function registerHearing() {
  const list = CONFIG.statusEffects;
  for (const status of [DEAF_STATUS, SILENCE_STATUS]) {
    if (Array.isArray(list)) { if (!list.some(e => e.id === status.id)) list.push({ ...status }); }
    else if (list && !list[status.id]) list[status.id] = { ...status };
  }
}
