/**
 * Blinded combatants (owner's request 1.0.93). Figures in COMBAT_TABLES.blind (tools/build-combat-tables.py, regex-checked):
 *  - Darkness (DMG): the rules apply to anyone who cannot see (darkness spell, fog, moonless night, blindfolded); a blinded
 *    character has -4 to attack rolls and saving throws, an Armor Class four worse (to a limit of 10), and loses
 *    sight-related damage bonuses such as backstabbing.
 *  - Blind-fighting (Proficiency) (PHB): -2 instead of -4 to attack, no AC penalty, within melee distance only (AC penalties
 *    remain against missiles); special abilities kept at half effectiveness.
 *  - Blindness (Wizard Spell): -4 to its attacks, opponents +4 (the same figures).
 * An actor is blinded while it has the core "blind" status (token status icons; registered by `registerBlindness` when a
 * world's status list lacks it). Attack dialogs (AD2EActor#combatModFields) get pre-ticked boxes for a blinded attacker
 * and a blinded first target; saving throw dialogs one for a blinded saver; the backstab boxes are disabled for a blinded
 * attacker without blind-fighting.
 * Implementation choices: the target's AC penalty is given as an attack bonus (min(4, 10 - AC), so AC 10 or worse gains
 * nothing); a blind-fighter keeps backstab (the GM halves it, "reduced by one-half"); the movement rule (safe rate slowed by
 * 1/3) and Table 72's degrees of darkness are not applied.
 */
import { COMBAT_TABLES } from "./rules/combat-tables.mjs";

const B = COMBAT_TABLES.blind;
export const BLIND_STATUS = { id: "blind", name: "AD2E.Blind.Status", img: "icons/svg/blind.svg" };

const i18n = (k, d) => (d ? game.i18n.format(k, d) : game.i18n.localize(k));
const esc = v => foundry.utils.escapeHTML?.(String(v ?? "")) ?? String(v ?? "");
const signed = n => `${n > 0 ? "+" : ""}${n}`;

/** Whether an actor has the blind status. */
export const isBlind = actor => !!actor?.statuses?.has?.(BLIND_STATUS.id);

/** Whether an actor has the blind-fighting proficiency. */
export const blindFighter = actor => !!actor?.items?.some?.(i => i.type === "proficiency" && i.system?.identifier === B.blindFighting.proficiency);

/** A blinded attacker's attack modifier (pure): -4, or -2 with blind-fighting in melee. */
export function blindAttack({ blindFighting = false, missile = false } = {}) {
  return blindFighting && !(missile && B.blindFighting.meleeOnly) ? B.blindFighting.attack : B.attack;
}

/** The attack bonus against a blinded target (pure): its AC four worse, to a limit of 10; none for a blind-fighter in melee. */
export function blindTargetBonus({ ac = 10, blindFighting = false, missile = false } = {}) {
  if (blindFighting && !(missile && B.blindFighting.meleeOnly)) return B.blindFighting.ac;
  return Math.max(0, Math.min(B.ac, B.acLimit - (Number(ac) || 0)));
}

/** Whether a blinded attacker loses backstab (pure over the two flags). */
export const backstabLost = (blind, fighting) => !!(blind && B.noBackstab && !fighting);

/** Tick boxes for an attack dialog: a blinded attacker (pre-ticked) and a blinded first target (pre-ticked), or "". */
export function blindAttackFields(attacker, target, { missile = false, ac = 10, targetName = "" } = {}) {
  const rows = [];
  if (isBlind(attacker)) {
    const fighting = blindFighter(attacker);
    const v = blindAttack({ blindFighting: fighting, missile });
    rows.push(`<label><input type="checkbox" name="blindSelf" value="${v}" checked> ${esc(i18n(fighting && v === B.blindFighting.attack
      ? "AD2E.Blind.AttackerFighting" : "AD2E.Blind.Attacker"))} (${signed(v)})</label>`);
  }
  if (isBlind(target)) {
    const fighting = blindFighter(target);
    const v = blindTargetBonus({ ac, blindFighting: fighting, missile });
    const key = fighting && !missile ? "AD2E.Blind.TargetFighting" : (v ? "AD2E.Blind.Target" : "AD2E.Blind.TargetLimit");
    rows.push(`<label><input type="checkbox" name="blindTarget" value="${v}"${v ? " checked" : ""}> ${esc(i18n(key,
      { name: targetName || target.name, limit: B.acLimit }))} (${signed(v)})</label>`);
  }
  return rows.join("");
}

/** Sum and text of the ticked blindness boxes in an attack dialog. */
export function blindAttackPicked(form) {
  let sum = 0;
  const text = [];
  for (const [name, key] of [["blindSelf", "AD2E.Blind.ShortSelf"], ["blindTarget", "AD2E.Blind.ShortTarget"]]) {
    const box = form?.elements?.[name];
    if (!box?.checked) continue;
    const v = Number(box.value) || 0;
    sum += v;
    text.push(`${i18n(key)} ${signed(v)}`);
  }
  return { sum, text: text.join("; ") };
}

/** Saving throw dialog field for a blinded actor (pre-ticked), or "". */
export function blindSaveField(actor) {
  if (!isBlind(actor)) return "";
  return `<div class="form-group"><label>${esc(i18n("AD2E.Blind.Save", { n: signed(B.save) }))}</label><input type="checkbox" name="blindSave" checked></div>`;
}

/** The ticked blindness save modifier (0 or -4). */
export const blindSavePicked = form => (form?.elements?.blindSave?.checked ? B.save : 0);

/** A backstab field for a blinded attacker without blind-fighting: the box disabled with the reason; else null (keep it). */
export function blindBackstabField(actor, label) {
  if (!backstabLost(isBlind(actor), blindFighter(actor))) return null;
  return `<div class="form-group"><label>${esc(label)}</label><input type="checkbox" name="backstab" disabled>`
    + `<p class="hint">${esc(i18n("AD2E.Blind.NoBackstab"))}</p></div>`;
}

/** Register the blind status when the world's status list lacks it (core lists "blind"). */
export function registerBlindness() {
  const list = CONFIG.statusEffects;
  if (Array.isArray(list)) { if (!list.some(e => e.id === BLIND_STATUS.id)) list.push({ ...BLIND_STATUS }); }
  else if (list && !list[BLIND_STATUS.id]) list[BLIND_STATUS.id] = { ...BLIND_STATUS };
}
