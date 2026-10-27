/**
 * Casting time in combat and disruption (owner's request 1.0.74; world setting `spellCasting`: off | phb | house).
 * Sources (adnd2e.fandom.com): Initiative (PHB) rev 157824, "Spellcasting and Initiative": "When a spell's "Casting Time"
 * parameter is given as a number without any units ... that number is added to the caster's initiative roll"; "a spell
 * requiring one round to cast takes effect at the end of the current round, after all other actions are completed";
 * "Spells that require more than one round to cast involve some bookkeeping. If the spellcasting character is disturbed
 * during this time, the spell is lost. If all goes well, the spell takes effect at the very end of the last round of the
 * required casting time." Notes on Spells (PHB) rev 175672: "If the spell requires three rounds to cast, it goes into
 * effect at the end of the third round." Casting Spells (PHB) rev 70370: "if the spellcaster is struck by a weapon or
 * fails to make a saving throw before the spell is cast, the caster's concentration is disrupted. The spell is lost in a
 * fizzle of useless energy and is wiped clean from the memory of the caster until it can be rememorized."
 * - phb (default): in a started combat, "Cast" begins the casting (combatant flag `ad2e.casting`, status CASTING_STATUS on
 *   the caster); a numeric casting time takes effect on the caster's turn (at once when it is already the caster's turn),
 *   rounds (turns = 10 rounds, hours = 60) at the end of the last round; choosing a spell as the initiative action declares
 *   it. Damage applied to the caster (AD2EActor#applyDamage) or a failed saving throw (AD2EActor#rollSave) before then
 *   disrupts it and the spell is used up.
 * - house (owner's house rule): disruption interrupts the casting but the spell stays memorized.
 * - off: spells take effect when "Cast" is pressed, as before 1.0.74.
 * Implementation choices: any damage counts as being struck (the GM can stop a casting from its card instead); components
 * are used and the spell leaves memory when it takes effect (or when disrupted under phb); "per level" casting times use
 * the casting level; a casting time without a number ("special") takes effect at once; outside combat nothing is tracked;
 * stopping a casting by choice (card button, or casting another spell) keeps the spell; a combat ending stops castings.
 */
import { ad2eDialog } from "./dialogs.mjs";

export const CASTING_STATUS = { id: "ad2e-casting", name: "AD2E.Casting.Status", img: "systems/ad2e/styles/icons/casting.svg" };
export const MODES = ["off", "phb", "house"];
const UNIT_ROUNDS = { round: 1, turn: 10, hour: 60, day: 1440 };
const i18n = (k, d) => (d ? game.i18n.format(k, d) : game.i18n.localize(k));
const esc = v => String(v ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

export function castingMode() {
  try { const m = game.settings.get("ad2e", "spellCasting"); return MODES.includes(m) ? m : "phb"; } catch { return "off"; }
}

/**
 * A casting time as a plan (pure): { kind: "segments", n } for a number without units, { kind: "rounds", n } for rounds,
 * turns, hours or days ("per level" times `level`), null when it has no number ("special").
 */
export function castingPlan(text, level = 1) {
  const t = String(text ?? "").trim().toLowerCase();
  if (/^\d+$/.test(t)) return { kind: "segments", n: Number(t) };
  const m = t.match(/(\d+)\s*(rds?|rounds?|turns?|hrs?|hours?|days?)\b\.?(\s*(?:\/|per)\s*(?:lvl|level))?/);
  if (!m) return null;
  const unit = /^r/.test(m[2]) ? "round" : /^t/.test(m[2]) ? "turn" : /^h/.test(m[2]) ? "hour" : "day";
  const per = m[3] ? Math.max(Number(level) || 1, 1) : 1;
  return { kind: "rounds", n: Math.max(Number(m[1]), 1) * UNIT_ROUNDS[unit] * per };
}

/** The state stored on the combatant when a casting begins (pure). */
export function castingState(spell, plan, combat, { declared = false, actorUuid = "" } = {}) {
  const round = Math.max(Number(combat?.round) || 1, 1);
  return { spellId: spell.id, name: spell.name, time: String(spell.system?.castingTime ?? ""), kind: plan.kind, n: plan.n,
    startRound: round, endRound: plan.kind === "rounds" ? round + plan.n - 1 : null, declared, actorUuid };
}

/** Whether a casting completes at this point of the combat (pure): `turnOf` = the caster's turn has come; `round` now. */
export function completesNow(state, { round, turnOf = false } = {}) {
  if (!state) return false;
  if (state.kind === "segments") return turnOf;
  return Number.isFinite(state.endRound) && round > state.endRound;
}

/** The user who acts for an actor (pure over a list): its first active non-GM owner by id, else the active GM. */
export function responsibleUser(actor, users) {
  const list = [...(users ?? [])].filter(u => u.active);
  const owners = list.filter(u => !u.isGM && actor?.testUserPermission?.(u, "OWNER")).sort((a, b) => String(a.id).localeCompare(String(b.id)));
  return owners[0] ?? list.find(u => u.isActiveGM) ?? list.find(u => u.isGM) ?? null;
}

/** An actor's combatant in the combat (or null); `started` = only once the combat has begun. */
export function casterCombatant(actor, combat = game.combat, { started = false } = {}) {
  if (!actor || !combat || (started && !combat.started)) return null;
  const found = combat.getCombatantsByActor?.(actor) ?? combat.combatants?.filter?.(c => c.actor === actor || c.actor?.uuid === actor.uuid) ?? [];
  return found[0] ?? null;
}

export const castingOf = combatant => combatant?.getFlag?.("ad2e", "casting") ?? null;

async function setStatus(actor, active) {
  if (typeof actor?.toggleStatusEffect !== "function") return;
  const has = !!actor.statuses?.has?.(CASTING_STATUS.id);
  if (has !== active) await actor.toggleStatusEffect(CASTING_STATUS.id, { active });
}

async function clearCasting(combatant) {
  await combatant.unsetFlag("ad2e", "casting");
  await setStatus(combatant.actor, false);
}

const whenText = (state, name) => (state.kind === "segments"
  ? i18n("AD2E.Casting.OnTurn", { name }) : i18n("AD2E.Casting.AtEnd", { round: state.endRound }));

/**
 * Called by AD2EActor#castSpell before the spell takes effect: true when the casting was begun (tracked), false when it
 * takes effect now. `declare` = chosen as the initiative action (never at once).
 */
export async function beginCasting(actor, spell, { declare = false, level = 1 } = {}) {
  if (castingMode() === "off") return false;
  const combat = game.combat;
  // Declared with initiative: the combat may not have begun yet; "Cast" pressed: only in a combat under way.
  const combatant = casterCombatant(actor, combat, { started: !declare });
  if (!combatant) return false;
  const plan = castingPlan(spell.system?.castingTime, level);
  if (!plan) return false;
  // A numeric casting time on the caster's own turn: the initiative roll already held it, so the spell takes effect now.
  if (!declare && plan.kind === "segments" && combat.combatant?.id === combatant.id) return false;
  const current = castingOf(combatant);
  if (current) {
    if (current.spellId === spell.id) { ui.notifications.info(i18n("AD2E.Casting.Already", { name: actor.name, spell: spell.name })); return true; }
    const ok = await ad2eDialog.confirm({ window: { title: spell.name }, rejectClose: false,
      content: `<p>${esc(i18n("AD2E.Casting.Replace", { old: current.name, spell: spell.name }))}</p>` });
    if (!ok) return true;
    await stopCasting(combatant, { reason: "changed" });
  }
  const state = castingState(spell, plan, combat, { declared: declare, actorUuid: actor.uuid });
  await combatant.setFlag("ad2e", "casting", state);
  await setStatus(actor, true);
  await ChatMessage.implementation.create({ speaker: ChatMessage.getSpeaker({ actor }),
    content: `<p>${esc(i18n("AD2E.Casting.Begins", { name: actor.name, spell: spell.name, time: state.time }))} ${esc(whenText(state, actor.name))}</p>`
      + `<p class="ad2e-note">${esc(i18n(castingMode() === "house" ? "AD2E.Casting.HouseNote" : "AD2E.Casting.PhbNote"))}</p>`,
    flags: { ad2e: { casting: { combat: combat.id, combatant: combatant.id, spellId: spell.id } } } });
  return true;
}

/** Complete a casting (on the responsible user's client): the spell takes effect through castSpell. */
export async function completeCasting(combatant) {
  const state = castingOf(combatant);
  const actor = combatant?.actor;
  if (!state || !actor) return null;
  await clearCasting(combatant);
  return actor.castSpell?.(state.spellId, { complete: true });
}

/** Stop a casting by choice: the spell stays memorized. */
export async function stopCasting(combatant, { reason = "stopped" } = {}) {
  const state = castingOf(combatant);
  if (!state) return null;
  await clearCasting(combatant);
  if (reason === "changed") return null;
  return ChatMessage.implementation.create({ speaker: ChatMessage.getSpeaker({ actor: combatant.actor }),
    content: `<p>${esc(i18n("AD2E.Casting.Stopped", { name: combatant.actor?.name ?? combatant.name, spell: state.name }))}</p>` });
}

/**
 * The caster was struck (damage applied) or failed a saving throw: the casting is disrupted. phb: the spell is used up;
 * house: it stays memorized.
 */
export async function castingStruck(actor, reason = "damage") {
  const mode = castingMode();
  if (mode === "off") return null;
  const combatant = casterCombatant(actor);
  const state = castingOf(combatant);
  if (!state) return null;
  await clearCasting(combatant);
  const spell = actor.items?.get?.(state.spellId);
  const lost = mode === "phb" && spell && spell.system.prepared - spell.system.cast > 0;
  if (lost) await spell.update({ "system.cast": spell.system.cast + 1 });
  return ChatMessage.implementation.create({ speaker: ChatMessage.getSpeaker({ actor }),
    content: `<p><strong>${esc(i18n(`AD2E.Casting.Disrupted.${reason}`, { name: actor.name, spell: state.name }))}</strong> `
      + `${esc(i18n(lost ? "AD2E.Casting.Lost" : "AD2E.Casting.Kept", { spell: state.name }))}</p>` });
}

/**
 * Buttons on a "begins casting" card (the caster's owners and the GM): "Takes effect now" (when the tracker missed the
 * moment, e.g. the caster's turn was already current when the spell was declared) and "Stop casting" (spell kept).
 * From AD2EChatMessage#renderHTML.
 */
export function castingButtons(message, html) {
  const flag = message?.getFlag?.("ad2e", "casting");
  if (!flag || !html?.querySelector) return;
  const combat = game.combats?.get?.(flag.combat);
  const combatant = combat?.combatants?.get?.(flag.combatant);
  const state = castingOf(combatant);
  if (!state || state.spellId !== flag.spellId || !(combatant.actor?.isOwner || game.user?.isGM)) return;
  const box = document.createElement("div");
  box.className = "ad2e-damage-buttons";
  box.innerHTML = `<button type="button" data-casting="now"><i class="fa-solid fa-wand-sparkles"></i> ${esc(i18n("AD2E.Casting.Now"))}</button>`
    + `<button type="button" data-casting="stop"><i class="fa-solid fa-hand"></i> ${esc(i18n("AD2E.Casting.Stop"))}</button>`;
  const on = (sel, fn) => box.querySelector(sel).addEventListener("click", ev => { ev.preventDefault(); ev.stopPropagation(); return fn(); });
  on("[data-casting=now]", () => completeCasting(combatant));
  on("[data-casting=stop]", () => stopCasting(combatant));
  (html.querySelector(".message-content") ?? html).append(box);
}

/** World setting "initiativeEachRound" (registered in module/ad2e.mjs). */
export function initiativeEachRound() {
  try { return game.settings.get("ad2e", "initiativeEachRound") !== false; } catch { return false; }
}

/** A combat's combatants as an array (a Collection iterates its values; plain Maps in tests give values()). */
const combatantsOf = combat => Array.from(combat?.combatants?.values?.() ?? combat?.combatants ?? []);

const rolled = c => c?.initiative !== null && c?.initiative !== undefined && Number.isFinite(Number(c.initiative));

/**
 * On a combat update: the castings that complete now, run by each caster's responsible user. A casting waiting for its
 * caster's turn completes only once that combatant has rolled initiative this round (with initiative re-rolled each
 * round, the turn at the start of a round is not the caster's count yet).
 */
export async function onCombatUpdate(combat, changed) {
  if (castingMode() === "off" || !combat?.started || !("turn" in (changed ?? {}) || "round" in (changed ?? {}))) return;
  const newRound = "round" in (changed ?? {}) && initiativeEachRound();
  for (const c of combatantsOf(combat)) {
    const state = castingOf(c);
    if (!state || !c.actor) continue;
    const turnOf = !newRound && combat.combatant?.id === c.id && rolled(c);
    if (!completesNow(state, { round: combat.round, turnOf })) continue;
    if (responsibleUser(c.actor, game.users)?.id !== game.user?.id) continue;
    await completeCasting(c);
  }
}

/** Spells an actor could cast now (pure): memorized and not yet cast. [{ id, name, time }] */
export function memorizedSpells(actor) {
  const items = actor?.items?.contents ?? actor?.items ?? [];
  return [...(typeof items[Symbol.iterator] === "function" ? items : [])].filter(i => i.type === "spell" && (i.system?.prepared ?? 0) - (i.system?.cast ?? 0) > 0)
    .map(i => ({ id: i.id, name: i.name, time: String(i.system?.castingTime ?? "") }));
}

/**
 * Start of a round (active GM): a card asking spellcasters to declare their spells before initiative is rolled, so the
 * casting time joins the roll (Initiative (PHB): "Characters casting spells ... must add the spellcasting time to the die
 * roll"; owner's request 1.0.75). Lists the combatants with spells memorized; nothing is posted when there are none.
 */
export async function postDeclarationCard(combat) {
  const casters = combatantsOf(combat).filter(c => c.actor && memorizedSpells(c.actor).length);
  if (!casters.length) return null;
  return ChatMessage.implementation.create({ speaker: { alias: i18n("AD2E.Casting.DeclareTitle", { round: combat.round }) },
    content: `<p><strong>${esc(i18n("AD2E.Casting.DeclareTitle", { round: combat.round }))}</strong></p><p>${esc(i18n("AD2E.Casting.DeclareHint"))}</p>`
      + `<p class="ad2e-note">${esc(casters.map(c => c.name).join(", "))}</p>`,
    flags: { ad2e: { declare: { combat: combat.id, round: combat.round } } } });
}

/** Rows on the declaration card: for each caster the user owns (the GM: all), a spell select and "Declare". */
export function declareButtons(message, html) {
  const flag = message?.getFlag?.("ad2e", "declare");
  if (!flag || !html?.querySelector) return;
  const combat = game.combats?.get?.(flag.combat);
  if (!combat || combat.round !== flag.round) return;
  const box = document.createElement("div");
  box.className = "ad2e-declare-rows";
  for (const c of combatantsOf(combat)) {
    const actor = c.actor;
    if (!actor || !(actor.isOwner || game.user?.isGM)) continue;
    const spells = memorizedSpells(actor);
    const current = castingOf(c);
    if (!spells.length && !current) continue;
    const row = document.createElement("div");
    row.className = "ad2e-damage-buttons ad2e-declare-row";
    if (current) {
      row.innerHTML = `<span>${esc(i18n("AD2E.Casting.Declared", { name: c.name, spell: current.name }))}</span>`;
    } else {
      row.innerHTML = `<label>${esc(c.name)} <select data-declare="spell">${spells.map(s => `<option value="${esc(s.id)}">${esc(s.name)}${s.time ? ` (${esc(s.time)})` : ""}</option>`).join("")}</select></label>`
        + `<button type="button" data-declare="go"><i class="fa-solid fa-wand-sparkles"></i> ${esc(i18n("AD2E.Casting.Declare"))}</button>`;
      row.querySelector("[data-declare=go]").addEventListener("click", async ev => {
        ev.preventDefault(); ev.stopPropagation();
        const id = row.querySelector("[data-declare=spell]").value;
        await actor.castSpell?.(id, { declare: true });
        const now = castingOf(c);
        if (now) row.innerHTML = `<span>${esc(i18n("AD2E.Casting.Declared", { name: c.name, spell: now.name }))}</span>`;
      });
    }
    box.append(row);
  }
  if (box.childElementCount) (html.querySelector(".message-content") ?? html).append(box);
}

/** World setting, status, hooks. Called in init. */
export function registerSpellCasting() {
  game.settings.register("ad2e", "spellCasting", {
    name: "AD2E.Casting.Setting", hint: "AD2E.Casting.SettingHint", scope: "world", config: true, type: String,
    choices: { off: "AD2E.Casting.Mode.off", phb: "AD2E.Casting.Mode.phb", house: "AD2E.Casting.Mode.house" }, default: "phb"
  });
  const list = CONFIG.statusEffects;
  if (Array.isArray(list)) { if (!list.some(e => e.id === CASTING_STATUS.id)) list.push({ ...CASTING_STATUS }); }
  else if (list && !list[CASTING_STATUS.id]) list[CASTING_STATUS.id] = { ...CASTING_STATUS };
  Hooks.on("updateCombat", (combat, changed) => onCombatUpdate(combat, changed));
  // Each new round (the combat's start included): the active GM clears initiative (setting "initiativeEachRound"; from
  // round 2, so rolls made before the combat began stand) and asks spellcasters to declare before it is rolled.
  Hooks.on("updateCombat", async (combat, changed) => {
    if (!game.user?.isActiveGM || !("round" in (changed ?? {})) || !(combat?.round >= 1)) return null;
    if (initiativeEachRound() && combat.round >= 2 && combatantsOf(combat).some(rolled)) await combat.resetAll?.({ updateTurn: false });
    if (castingMode() === "off") return null;
    return postDeclarationCard(combat);
  });
  // The last initiative of the round is rolled: a casting waiting for the current combatant's turn completes now.
  Hooks.on("updateCombatant", (combatant, changed) => {
    const combat = combatant?.parent;
    if (castingMode() === "off" || !("initiative" in (changed ?? {})) || !combat?.started) return null;
    if (!combatantsOf(combat).every(rolled)) return null;
    const current = combat.combatant;
    const state = castingOf(current);
    if (!state || state.kind !== "segments" || !current.actor) return null;
    if (responsibleUser(current.actor, game.users)?.id !== game.user?.id) return null;
    return completeCasting(current);
  });
  // A combat that ends stops its castings (the spells stay memorized); the active GM clears the casting marks.
  Hooks.on("deleteCombat", async combat => {
    if (!game.user?.isActiveGM) return;
    for (const c of combatantsOf(combat)) if (castingOf(c)) await setStatus(c.actor, false);
  });
}
