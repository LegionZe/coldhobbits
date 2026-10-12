import { LIGHT_TABLES } from "./rules/light-tables.mjs";
import { ad2eDialog } from "./dialogs.mjs";
import { targetActor } from "./save-requests.mjs";

/**
 * Spell effects (owner's request and rulings, 1.0.50): a cast spell with a duration becomes a timed Active Effect on the
 * recipients the caster picks at cast (targeted tokens, the caster, or nobody), with the duration read from the spell's
 * Duration entry at the caster's level (editable in the dialog). The GM sets modifiers per spell on the spell sheet
 * (`system.effectMods`: attack, damage, AC, saving throws, checks); nothing is guessed from spell text. Effects are removed
 * when world time passes their end, with a chat note to the GM and the owners (active GM, updateWorldTime).
 *
 * Time units: a round is one minute ("a round is one minute", The Combat Round (PHB); CONFIG.time.roundTime = 60) and a
 * turn ten minutes (LIGHT_TABLES.turnSeconds, regex-checked against Time and Movement (PHB)). Implementation choices: a
 * month is 30 days, a year 365 days; "1 rd./2 levels" counts whole steps of 2 levels (at least 1 at level 1).
 * Effects store their length in seconds (core 14 `duration.units` "seconds": core's "rounds"/"turns" units are combat
 * rounds and combatant turns, not AD&D's 10-minute turn) and `flags.ad2e.spellEffect` { spell, caster, until, mods }.
 */
export const ROUND = 60;
export const TURN = LIGHT_TABLES.turnSeconds;
export const UNIT_SECONDS = { round: ROUND, turn: TURN, minute: 60, hour: 3600, day: 86400, week: 604800, month: 2592000, year: 31536000 };
export const MOD_KEYS = ["attack", "damage", "ac", "save", "check"];

const UNIT_WORDS = [
  [/^(?:rds?|rounds?)$/i, "round"], [/^turns?$/i, "turn"], [/^(?:mins?|minutes?)$/i, "minute"], [/^(?:hrs?|hours?)$/i, "hour"],
  [/^days?$/i, "day"], [/^(?:wks?|weeks?)$/i, "week"], [/^(?:mos?|months?)$/i, "month"], [/^(?:yrs?|years?)$/i, "year"]
];
const unitOf = w => UNIT_WORDS.find(([re]) => re.test(w))?.[1] ?? null;
// One term: amount (number, fraction or dice), unit, optional "/level", "/2 levels", "/experience level", "per level".
const TERM = /(\d+\s*d\s*\d+(?:\s*[+-]\s*\d+)?|\d+\s*[-–]\s*\d+|\d+\s*\/\s*\d+|\d+)\s*([a-z]+)\.?(?:\s*(?:\/|per)\s*(?:(\d+)\s*)?(?:experience\s+)?(?:levels?|lvls?)\.?(?:\s+of\s+(?:the\s+)?caster)?)?/gi;
const WORD_NUMBERS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, twelve: 12 };
// Text that carries no duration: book tags such as "(Dragon)" or "(PFtM)", "(round down)" (the step count already rounds down).
const IGNORED = /\((?:round(?:ed)? down|dragon|pftm|gkm|[a-z]{2,6})\)/gi;

/**
 * A spell's Duration entry (pure): { kind: "timed" | "instant" | "permanent" | "concentration" | "special", terms, text }.
 * terms = [{ amount (number) | dice (string), unit, per (0 flat, else levels per step) }]. Anything left over that is not a
 * joining "+" (e.g. "until triggered", "(1 turn maximum)") makes it "special": the GM sets the duration at cast.
 */
export function parseDuration(text) {
  const t = String(text ?? "").replace(/\s+/g, " ").trim();
  const out = { kind: "special", terms: [], text: t };
  if (!t) return out;
  if (/^instant(?:aneous)?\.?$/i.test(t)) return { ...out, kind: "instant" };
  if (/^permanent\.?$/i.test(t)) return { ...out, kind: "permanent" };
  if (/concentration/i.test(t)) return { ...out, kind: "concentration" };
  let rest = t.replace(/^up to\s+/i, "").replace(IGNORED, " ")
    .replace(/\b(one|two|three|four|five|six|seven|eight|nine|ten|twelve)\b/gi, w => String(WORD_NUMBERS[w.toLowerCase()]));
  const terms = [];
  rest = rest.replace(TERM, (m, amount, unitWord, per) => {
    const unit = unitOf(unitWord);
    if (!unit) return m;
    let a = amount.replace(/\s+/g, "");
    // A range "1-4" is rolled as 1d4, "2-5" as 1d4+1 (the PHB's range notation for dice).
    const range = /^(\d+)[-–](\d+)$/.exec(a);
    if (range) { const lo = Number(range[1]), hi = Number(range[2]); a = lo === 1 ? `1d${hi}` : `1d${hi - lo + 1}+${lo - 1}`; }
    const frac = /^(\d+)\/(\d+)$/.exec(a);
    terms.push({ ...(/d/.test(a) ? { dice: a } : { amount: frac ? Number(frac[1]) / Number(frac[2]) : Number(a) }), unit,
      per: /lev|lvl/i.test(m) ? Number(per || 1) : 0 });
    return " ";
  });
  if (!terms.length) return out;
  const residue = rest.replace(/[+.,]/g, " ").trim();
  return { ...out, kind: residue ? "special" : "timed", terms };
}

/** Seconds for parsed terms at a caster level (pure); dice are rolled by `rollDie(formula)` (default: average, rounded down). */
export function durationSeconds(parsed, level = 1, rollDie = null) {
  if (!parsed?.terms?.length) return null;
  const lvl = Math.max(Number(level) || 1, 1);
  let total = 0;
  for (const term of parsed.terms) {
    let n = term.dice ? (rollDie ? rollDie(term.dice) : averageDice(term.dice)) : term.amount;
    if (term.per) n *= Math.max(Math.floor(lvl / term.per), 1);
    total += n * UNIT_SECONDS[term.unit];
  }
  return Math.round(total);
}

/** Average of "XdY[+Z]" rounded down (pure). */
export function averageDice(f) {
  const m = /^(\d+)d(\d+)(?:([+-])(\d+))?$/.exec(String(f).replace(/\s+/g, ""));
  if (!m) return 0;
  return Math.floor(Number(m[1]) * (Number(m[2]) + 1) / 2) + (m[3] ? (m[3] === "-" ? -1 : 1) * Number(m[4]) : 0);
}

/** A number of seconds as "2 hours 3 turns 4 rounds" (pure; i18n(key, data)). */
export function durationText(seconds, i18n) {
  if (seconds === null || seconds === undefined) return "—";
  let s = Math.max(Math.round(seconds), 0);
  const parts = [];
  for (const [unit, size] of [["day", 86400], ["hour", 3600], ["turn", TURN], ["round", ROUND]]) {
    const n = Math.floor(s / size);
    if (n) { parts.push(i18n(`AD2E.SpellEffect.Unit.${unit}`, { n })); s -= n * size; }
  }
  if (s) parts.push(i18n("AD2E.SpellEffect.Unit.second", { n: s }));
  return parts.join(" ") || i18n("AD2E.SpellEffect.Unit.round", { n: 0 });
}

/** The spell's GM-set modifiers (pure): only non-zero numbers. */
export function spellMods(spell) {
  const m = spell?.system?.effectMods ?? {};
  return Object.fromEntries(MOD_KEYS.map(k => [k, Number(m[k]) || 0]).filter(([, v]) => v));
}

/** Active Effect data for a spell on one recipient (pure apart from the arguments). */
export function effectData(spell, { caster = null, seconds = null, now = 0, mods = spellMods(spell), note = "" } = {}) {
  const timed = Number.isFinite(seconds) && seconds > 0;
  return {
    name: spell.name, img: spell.img ?? "icons/svg/aura.svg", origin: spell.uuid ?? null, disabled: false, transfer: false,
    description: note,
    duration: timed ? { value: seconds, units: "seconds" } : { value: null, units: "seconds" },
    start: { time: now },
    flags: { ad2e: { spellEffect: { spell: spell.uuid ?? null, spellName: spell.name, caster: caster?.uuid ?? null,
      casterName: caster?.name ?? "", until: timed ? now + seconds : null, mods } } }
  };
}

/** Sum of the modifiers of an actor's spell effects that are not disabled (pure). */
export function effectModTotals(effects) {
  const total = Object.fromEntries(MOD_KEYS.map(k => [k, 0]));
  for (const e of effects ?? []) {
    const f = e?.flags?.ad2e?.spellEffect;
    if (!f || e.disabled) continue;
    for (const k of MOD_KEYS) total[k] += Number(f.mods?.[k]) || 0;
  }
  return total;
}

/** Spell effects whose end has passed (pure). */
export const expiredEffects = (effects, now) => [...(effects ?? [])].filter(e => {
  const until = e?.flags?.ad2e?.spellEffect?.until;
  return Number.isFinite(until) && until <= now;
});

/** Rows for a sheet: [{ id, name, img, remaining, mods, caster }] (pure; i18n for texts). */
export function effectRows(effects, now, i18n) {
  return [...(effects ?? [])].filter(e => e?.flags?.ad2e?.spellEffect).map(e => {
    const f = e.flags.ad2e.spellEffect;
    const mods = Object.entries(f.mods ?? {}).filter(([, v]) => v).map(([k, v]) => `${i18n(`AD2E.SpellEffect.Mod.${k}`)} ${v > 0 ? "+" : ""}${v}`).join(", ");
    return { id: e.id, name: e.name, img: e.img, disabled: !!e.disabled, caster: f.casterName ?? "",
      remaining: Number.isFinite(f.until) ? durationText(f.until - now, i18n) : i18n("AD2E.SpellEffect.Indefinite"), mods };
  });
}

/** Units offered in the cast dialog, largest first. */
export const DIALOG_UNITS = ["day", "hour", "turn", "round"];

/** The largest dialog unit that divides the seconds evenly (pure): { value, unit }; rounds otherwise (rounded up). */
export function bestUnit(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) return { value: "", unit: "round" };
  for (const unit of DIALOG_UNITS) if (seconds % UNIT_SECONDS[unit] === 0) return { value: seconds / UNIT_SECONDS[unit], unit };
  return { value: Math.ceil(seconds / ROUND), unit: "round" };
}

/**
 * Default recipients in the cast dialog (pure): "targets" when the spell reached targeted creatures, else "self" when the
 * effect has a length or modifiers, else "none". Implementation choice: the GM or player changes it in the dialog.
 */
export function defaultRecipients({ targets = 0, seconds = null, mods = {} } = {}) {
  if (targets > 0) return "targets";
  return (Number.isFinite(seconds) && seconds > 0) || Object.keys(mods).length ? "self" : "none";
}

/** Whether a cast asks about an effect (pure): not for instantaneous spells or an empty Duration without modifiers. */
export function wantsEffect(parsed, mods = {}) {
  if (Object.keys(mods).length) return true;
  if (parsed.kind === "instant") return false;
  return !!parsed.text;
}

/* -------------------------------------------- */
/*  Foundry side                                */
/* -------------------------------------------- */

export function spellEffectsOn() {
  try { return game.settings.get("ad2e", "spellEffects") !== false; } catch { return true; }
}

const esc = v => foundry.utils.escapeHTML?.(String(v ?? "")) ?? String(v ?? "");

/**
 * After a cast (AD2EActor#castSpell): ask the duration (computed at the casting level, dice rolled) and the recipients,
 * then create the effects. `targets` = [{ uuid, name }] reached by the spell (magic resistance already removed).
 */
export async function askSpellEffect(caster, spell, { level = 1, targets = [] } = {}) {
  if (!spellEffectsOn()) return null;
  const parsed = parseDuration(spell.system?.duration);
  const mods = spellMods(spell);
  if (!wantsEffect(parsed, mods)) return null;
  const rolled = {};
  for (const t of parsed.terms) if (t.dice && !(t.dice in rolled)) rolled[t.dice] = (await new Roll(t.dice).evaluate()).total;
  const seconds = parsed.kind === "concentration" || parsed.kind === "permanent" ? null
    : durationSeconds(parsed, level, f => rolled[f] ?? averageDice(f));
  const i18n = (k, d) => d ? game.i18n.format(k, d) : game.i18n.localize(k);
  const pre = bestUnit(seconds);
  const recipients = defaultRecipients({ targets: targets.length, seconds, mods });
  const modText = Object.entries(mods).map(([k, v]) => `${i18n(`AD2E.SpellEffect.Mod.${k}`)} ${v > 0 ? "+" : ""}${v}`).join(", ");
  const dice = Object.entries(rolled).map(([f, n]) => `${f} = ${n}`).join(", ");
  const option = (value, label, disabled = false) => `<option value="${value}"${value === recipients ? " selected" : ""}${disabled ? " disabled" : ""}>${esc(label)}</option>`;
  const input = await ad2eDialog.prompt({
    window: { title: i18n("AD2E.SpellEffect.Title", { name: spell.name }) },
    content: `<p class="ad2e-note">${esc(i18n("AD2E.Spell.Duration"))}: ${esc(parsed.text || "—")}`
      + ` (${esc(i18n("AD2E.Spell.CastingLevel"))} ${level}${dice ? `; ${esc(dice)}` : ""})</p>`
      + (parsed.kind === "special" || parsed.kind === "concentration" ? `<p class="ad2e-note">${esc(i18n(`AD2E.SpellEffect.Kind.${parsed.kind}`))}</p>` : "")
      + `<div class="form-group"><label>${esc(i18n("AD2E.SpellEffect.Length"))}</label><div class="form-fields">`
      + `<input type="number" name="value" value="${pre.value}" min="0" step="any" placeholder="${esc(i18n("AD2E.SpellEffect.Indefinite"))}" autofocus>`
      + `<select name="unit">${DIALOG_UNITS.map(u => `<option value="${u}"${u === pre.unit ? " selected" : ""}>${esc(i18n(`AD2E.SpellEffect.UnitName.${u}`))}</option>`).join("")}</select></div>`
      + `<p class="hint">${esc(i18n("AD2E.SpellEffect.LengthHint"))}</p></div>`
      + `<div class="form-group"><label>${esc(i18n("AD2E.SpellEffect.Recipients"))}</label><select name="recipients">`
      + option("targets", `${i18n("AD2E.SpellEffect.Targets")}${targets.length ? `: ${targets.map(t => t.name).join(", ")}` : ""}`, !targets.length)
      + option("self", i18n("AD2E.SpellEffect.Self", { name: caster.name })) + option("none", i18n("AD2E.SpellEffect.None")) + `</select></div>`
      + (modText ? `<p class="ad2e-note">${esc(i18n("AD2E.SpellEffect.Modifiers"))}: ${esc(modText)}</p>` : ""),
    ok: { label: i18n("AD2E.SpellEffect.Apply"), callback: (event, button) => ({
      value: button.form.elements.value.value, unit: button.form.elements.unit.value, recipients: button.form.elements.recipients.value }) },
    rejectClose: false
  });
  if (!input || input.recipients === "none") return null;
  const amount = Number(input.value);
  const length = input.value !== "" && Number.isFinite(amount) && amount > 0 ? Math.round(amount * (UNIT_SECONDS[input.unit] ?? ROUND)) : null;
  const list = input.recipients === "self" ? [{ uuid: caster.uuid, name: caster.name, actor: caster }] : targets;
  return applySpellEffect(caster, spell, list, { seconds: length, mods, note: parsed.text });
}

/**
 * Create the effect on each recipient: directly on actors this user owns, through the active GM for the others (a GM
 * whisper flagged `ad2e.spellEffectRequest` { data, targets, done }; registerSpellEffects handles it once).
 */
export async function applySpellEffect(caster, spell, recipients, { seconds = null, mods = spellMods(spell), note = "" } = {}) {
  const now = game.time?.worldTime ?? 0;
  const data = effectData(spell, { caster, seconds, now, mods, note });
  const relay = [];
  for (const r of recipients) {
    const actor = r.actor ?? targetActor(r);
    if (!actor) continue;
    if (actor.isOwner) await actor.createEmbeddedDocuments("ActiveEffect", [structuredClone(data)]);
    else relay.push({ uuid: r.uuid, name: r.name });
  }
  const lengthText = durationText(seconds, (k, d) => game.i18n.format(k, d));
  const names = recipients.map(r => r.name).join(", ");
  if (relay.length) {
    await ChatMessage.create({ speaker: ChatMessage.getSpeaker({ actor: caster }),
      whisper: game.users.filter(u => u.isGM).map(u => u.id),
      content: `<p>${esc(game.i18n.format("AD2E.SpellEffect.Relayed", { spell: spell.name, names: relay.map(r => r.name).join(", ") }))}</p>`,
      flags: { ad2e: { spellEffectRequest: { data, targets: relay, done: false } } } });
  }
  return ChatMessage.create({ speaker: ChatMessage.getSpeaker({ actor: caster }),
    content: `<p class="ad2e-note">${esc(game.i18n.format("AD2E.SpellEffect.Applied", { spell: spell.name, names,
      length: Number.isFinite(seconds) && seconds > 0 ? lengthText : game.i18n.localize("AD2E.SpellEffect.Indefinite") }))}</p>` });
}

/** Actors that can carry spell effects: world actors and unlinked scene tokens. */
function effectBearers() {
  const out = [...(game.actors ?? [])];
  for (const scene of game.scenes ?? []) for (const t of scene.tokens ?? []) if (!t.actorLink && t.actor) out.push(t.actor);
  return out;
}

/** Users told when an effect ends: GMs, the recipient's owners and the caster's owners. */
function noticeUsers(actor, casterUuid) {
  let caster = null;
  try { caster = casterUuid ? foundry.utils.fromUuidSync(casterUuid, { strict: false }) : null; } catch { caster = null; }
  const owners = doc => doc ? game.users.filter(u => !u.isGM && doc.testUserPermission?.(u, "OWNER")) : [];
  return [...new Set([...game.users.filter(u => u.isGM), ...owners(actor), ...owners(caster)].map(u => u.id))];
}

/** Remove the spell effects whose end has passed, with a whispered notice (active GM, on world time). */
export async function processSpellEffects(now = game.time?.worldTime ?? 0) {
  for (const actor of effectBearers()) {
    const ended = expiredEffects(actor.effects, now);
    if (!ended.length) continue;
    await actor.deleteEmbeddedDocuments("ActiveEffect", ended.map(e => e.id));
    for (const e of ended) {
      await ChatMessage.create({ speaker: ChatMessage.getSpeaker({ actor }),
        whisper: noticeUsers(actor, e.flags.ad2e.spellEffect.caster),
        content: `<p>${esc(game.i18n.format("AD2E.SpellEffect.Ended", { spell: e.name, name: actor.name }))}</p>` });
    }
  }
}

/** End one spell effect now (sheet action). */
export async function endSpellEffect(actor, effectId) {
  const e = actor.effects.get(effectId);
  if (e?.flags?.ad2e?.spellEffect) await e.delete();
}

export function registerSpellEffects() {
  game.settings.register("ad2e", "spellEffects", {
    name: "AD2E.SpellEffect.Setting", hint: "AD2E.SpellEffect.SettingHint",
    scope: "world", config: true, type: Boolean, default: true
  });
  Hooks.on("updateWorldTime", () => {
    if (game.users?.activeGM?.isSelf) processSpellEffects();
  });
  // Effects on actors the caster does not own: created once by the active GM.
  Hooks.on("createChatMessage", async message => {
    const req = message.getFlag?.("ad2e", "spellEffectRequest");
    if (!req || req.done || !game.users?.activeGM?.isSelf) return;
    for (const t of req.targets ?? []) {
      const actor = targetActor(t);
      if (actor) await actor.createEmbeddedDocuments("ActiveEffect", [structuredClone(req.data)]);
    }
    await message.setFlag("ad2e", "spellEffectRequest.done", true);
  });
}
