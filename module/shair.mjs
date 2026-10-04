/**
 * Sha'ir (Al-Qadim; Sha'ir (Character Kit)): "Sha'irs may not use any spells in the standard fashion of wizards"; a gen
 * (elemental familiar) fetches each spell (Requesting a Spell (AA); rules generated in module/rules/shair-tables.mjs by
 * tools/build-shair-tables.py, native spells = Appendix A in module/rules/province-tables.mjs SPELL_NATIVE).
 *  - Owned spell items are the spells the sha'ir knows exist ("Sha'irs can only request spells which they know exist",
 *    Summoning a Familiar (AA)); a request rolls the search time and the gen's chance (blind roll for players).
 *  - Search time: 1d6 + spell level rounds (native spell a mage of the same level could cast: Table 21), turns (native,
 *    higher level), hours (not in Appendix A, or a priest spell), + 1 per replacement gen; a 00 adds 1d10.
 *  - Chance: 50 + 5/level - 10/spell level, +10 common knowledge (1st/2nd-level Appendix A wizard spells), -30 priest
 *    or foreign, -10 per repeat of the same spell within 24 hours after a failed search; 90+ always fails. Dwarves: abilities fail 20%.
 *  - Priest spells: 10% per spell level that a god notices; on casting, the GM is told the retribution band.
 *  - The gen returns at the world time of the end of its search (character `system.gen.fetch`); the active GM processes
 *    the return (updateWorldTime) and the expiry three turns later. One request at a time.
 */
import { SHAIR } from "./rules/shair-tables.mjs";
import { SPELL_NATIVE } from "./rules/province-tables.mjs";
import { AD2E } from "./config.mjs";

export const SHAIR_KIT = "sha-ir";
export const GEN_KINDS = ["air", "fire", "water", "earth"];

/** Whether a kit item is the sha'ir kit (by identifier, or by name for world copies). */
export function isShairKit(kit) {
  if (!kit) return false;
  return (kit.system?.identifier ?? "") === SHAIR_KIT || /^sha'ira?\b/i.test(kit.name ?? "");
}

/** Whether a character is a sha'ir (its kit, whether or not it fits the class). */
export function isShair(actor) {
  if (actor?.type !== "character") return false;
  const kit = actor.system?.classInfo?.kitItem ?? [...(actor.items ?? [])].find(i => i.type === "kit");
  return isShairKit(kit);
}

/** Wiki page title of a spell item (flag from the importer, or its URL), or null. */
export function spellTitle(item) {
  const flagged = item?.flags?.ad2e?.wiki?.title;
  if (flagged) return flagged;
  const m = String(item?.system?.url ?? "").match(/\/wiki\/([^?#]+)/);
  if (!m) return null;
  try { return decodeURIComponent(m[1]).replace(/_/g, " "); } catch { return null; }
}

/** Highest wizard spell level a mage of this level can cast (PHB Table 21), 0 if none. */
export function maxWizardLevel(level) {
  const rows = AD2E.spellProgression?.wizard ?? {};
  const levels = Object.keys(rows).map(Number);
  if (!levels.length) return 0;
  const row = rows[Math.min(Math.max(level, 1), Math.max(...levels))];
  const slots = row?.slots ?? [];
  let max = 0;
  slots.forEach((n, i) => { if (n > 0) max = i + 1; });
  return max;
}

/** How a spell counts for its gen: { native, priest, general, level }. */
export function spellStanding(item) {
  const s = item.system;
  const priest = s.kind === "priest";
  const native = !priest && Object.hasOwn(SPELL_NATIVE, spellTitle(item) ?? "");
  return { native, priest, general: native && s.kind === "wizard" && s.level <= SHAIR.commonLevels, level: s.level };
}

/**
 * Chance of success (percent, 0..89) and search unit for a request.
 * @param {object} p { shairLevel, spellLevel, native, priest, general, repeats }
 */
export function requestChance({ shairLevel, spellLevel, native, priest, general, repeats = 0 }) {
  const parts = [["base", SHAIR.base.chance], ["shairLevel", SHAIR.perShairLevel * shairLevel], ["spellLevel", SHAIR.perSpellLevel * spellLevel]];
  if (general) parts.push(["general", SHAIR.generalKnowledge]);
  if (priest || !native) parts.push(["foreign", SHAIR.foreignOrPriest]);
  if (repeats) parts.push(["repeat", SHAIR.repeat * repeats]);
  const raw = parts.reduce((n, [, v]) => n + v, 0);
  return { raw, chance: Math.max(0, Math.min(raw, SHAIR.base.failAt - 1)), parts };
}

/** Search unit: round (native, castable by a mage of this level), turn (native, higher), hour (foreign or priest). */
export function searchUnit({ shairLevel, spellLevel, native, priest }) {
  if (priest || !native) return "hour";
  return spellLevel <= maxWizardLevel(shairLevel) ? "round" : "turn";
}

/** Repeats of the same spell within the 24-hour window before `now` (attempts: failed searches [{ key, at }]). */
export function repeatsOf(attempts, key, now) {
  return (attempts ?? []).filter(a => a.key === key && now - a.at < SHAIR.repeatWindow).length;
}

/** Percent chance that sha'ir abilities fail for a race (Sha'ir (Character Kit): dwarves 20%). */
export function raceFailure(raceId) {
  return SHAIR.raceFailure[raceId] ?? 0;
}

/** Retribution band for a noticed priest spell by level: "1-2" | "3-4" | "5-6" | "7". */
export function retributionBand(level) {
  return level <= 2 ? "1-2" : level <= 4 ? "3-4" : level <= 6 ? "5-6" : "7";
}

/* ---------------------------------------- Foundry side */

const esc = v => foundry.utils.escapeHTML?.(String(v ?? "")) ?? String(v ?? "");
const gmIds = () => game.users.filter(u => u.isGM).map(u => u.id);

/**
 * Ask the gen for a spell: dialog (chance, time, failure chance), then roll the search time (shown) and the success
 * roll (blind for players), and store the search on the character.
 */
export async function requestSpell(actor, itemId) {
  const item = actor.items.get(itemId);
  if (!item || item.type !== "spell" || !isShair(actor)) return;
  const i18n = k => game.i18n.localize(k);
  const fmt = (k, d) => game.i18n.format(k, d);
  const gen = actor.system.gen;
  if (!GEN_KINDS.includes(gen.kind)) return ui.notifications.warn(i18n("AD2E.Shair.NoGen"));
  if (gen.fetch?.spellId) return ui.notifications.warn(fmt("AD2E.Shair.Busy", { name: gen.fetch.name }));
  const now = game.time.worldTime;
  const st = spellStanding(item);
  const key = spellTitle(item) ?? item.name;
  const repeats = repeatsOf(gen.attempts, key, now);
  const shairLevel = actor.system.level;
  const c = requestChance({ shairLevel, spellLevel: st.level, ...st, repeats });
  const unit = searchUnit({ shairLevel, spellLevel: st.level, ...st });
  const fail0 = raceFailure(actor.system.raceInfo?.raceItem?.system.identifier);
  const partText = c.parts.map(([k, v]) => `${i18n(`AD2E.Shair.Part.${k}`)} ${v >= 0 ? "+" : ""}${v}`).join(", ");
  const input = await foundry.applications.api.DialogV2.prompt({
    window: { title: fmt("AD2E.Shair.RequestTitle", { name: item.name }) },
    content: `<p>${esc(fmt("AD2E.Shair.RequestText", { chance: c.chance, parts: partText }))}</p>`
      + `<p>${esc(fmt("AD2E.Shair.SearchText", { die: SHAIR.searchNative.die, level: st.level, extra: gen.replacements,
        unit: i18n(`AD2E.Shair.Unit.${unit}`) }))}</p>`
      + (st.priest ? `<p class="ad2e-unmet">${esc(fmt("AD2E.Shair.PriestWarning", { chance: SHAIR.priestNotice * st.level }))}</p>` : "")
      + `<div class="form-group"><label>${i18n("AD2E.Shair.Modifier")}</label><input type="number" name="mod" value="0"></div>`
      + `<div class="form-group"><label>${i18n("AD2E.Shair.Failure")}</label><input type="number" name="failure" value="${fail0}" min="0" max="100"></div>`,
    ok: { label: i18n("AD2E.Shair.Send"), callback: (event, button) => ({
      mod: Number(button.form.elements.mod.value) || 0, failure: Math.max(0, Number(button.form.elements.failure.value) || 0) }) },
    rejectClose: false
  });
  if (!input) return;
  const chance = Math.max(0, Math.min(c.raw + input.mod, SHAIR.base.failAt - 1));
  const timeRoll = await new Roll(`${SHAIR.searchNative.die} + @level + @extra`, { level: st.level, extra: gen.replacements }).evaluate();
  const check = await new Roll("1d100").evaluate();
  const failRoll = input.failure > 0 ? await new Roll("1d100").evaluate() : null;
  const abilityFailed = !!failRoll && failRoll.total <= input.failure;
  const doubleZero = check.total === 100;
  const delayRoll = doubleZero ? await new Roll(SHAIR.delay00).evaluate() : null;
  const success = !abilityFailed && chance > 0 && check.total < SHAIR.base.failAt && check.total <= chance;
  const noticeRoll = st.priest && success ? await new Roll("1d100").evaluate() : null;
  const noticed = !!noticeRoll && noticeRoll.total <= SHAIR.priestNotice * st.level;
  const count = timeRoll.total + (delayRoll?.total ?? 0);
  const returnsAt = now + count * SHAIR.unitSeconds[unit];
  await actor.update({ "system.gen.fetch": { spellId: item.id, name: item.name, unit, count, returnsAt, success, noticed, ready: false,
    expiresAt: null, level: st.level },
  // Failed searches count toward the repeat penalty ("Gen repeats search for spell on same day after initial failure").
  "system.gen.attempts": [...(gen.attempts ?? []).filter(a => now - a.at < SHAIR.repeatWindow), ...(success ? [] : [{ key, at: now }])] });
  // The search time is known to the sha'ir (the gen is gone); success is the DM's roll.
  await ChatMessage.create({ speaker: ChatMessage.getSpeaker({ actor }), content: `<p>${esc(fmt("AD2E.Shair.Departs",
    { name: actor.name, spell: item.name, n: timeRoll.total, unit: i18n(`AD2E.Shair.Unit.${unit}`) }))}</p>` });
  await check.toMessage({ speaker: ChatMessage.getSpeaker({ actor }), flavor: esc(fmt("AD2E.Shair.CheckFlavor", { spell: item.name, chance }))
    + (abilityFailed ? ` [${esc(fmt("AD2E.Shair.AbilityFailed", { roll: failRoll.total, chance: input.failure }))}]` : "")
    + (doubleZero ? ` [${esc(fmt("AD2E.Shair.Delayed", { n: delayRoll.total, unit: i18n(`AD2E.Shair.Unit.${unit}`) }))}]` : "")
    + (noticeRoll ? ` [${esc(fmt(noticed ? "AD2E.Shair.Noticed" : "AD2E.Shair.NotNoticed", { roll: noticeRoll.total, chance: SHAIR.priestNotice * st.level }))}]` : "")
    + `: ${esc(i18n(success ? "AD2E.Shair.Found" : "AD2E.Shair.NotFound"))}` }, { rollMode: game.user.isGM ? "gmroll" : "blindroll" });
}

/** Gen back (GM): a found spell becomes castable (one use) until three turns later; otherwise the gen is free again. */
export async function genReturns(actor) {
  const f = actor.system.gen?.fetch;
  if (!f?.spellId || f.ready) return;
  const spell = actor.items.get(f.spellId);
  const fmt = (k, d) => game.i18n.format(k, d);
  if (f.success && spell) {
    const expiresAt = game.time.worldTime + SHAIR.castWithin * SHAIR.unitSeconds.turn;
    await spell.update({ "system.prepared": 1, "system.cast": 0 });
    await actor.update({ "system.gen.fetch.ready": true, "system.gen.fetch.expiresAt": expiresAt });
    await ChatMessage.create({ speaker: ChatMessage.getSpeaker({ actor }), content: `<p>${esc(fmt("AD2E.Shair.ReturnsWith", { spell: f.name, n: SHAIR.castWithin }))}</p>` });
  } else {
    await actor.update({ "system.gen.fetch": emptyFetch() });
    await ChatMessage.create({ speaker: ChatMessage.getSpeaker({ actor }), content: `<p>${esc(fmt("AD2E.Shair.ReturnsEmpty", { spell: f.name }))}</p>` });
  }
}

/** The fetched spell was cast (castSpell) or expired: the spell is gone and the gen is free. */
export async function clearFetched(actor, { expired = false } = {}) {
  const f = actor.system.gen?.fetch;
  if (!f?.spellId) return;
  const spell = actor.items.get(f.spellId);
  if (spell) await spell.update({ "system.prepared": 0, "system.cast": 0 });
  await actor.update({ "system.gen.fetch": emptyFetch() });
  if (expired) await ChatMessage.create({ speaker: ChatMessage.getSpeaker({ actor }), content: `<p>${esc(game.i18n.format("AD2E.Shair.Expired", { spell: f.name }))}</p>` });
}

/** Casting a fetched priest spell a god noticed: the GM is told the retribution band (Requesting a Spell (AA)). */
export async function retributionNotice(actor, spell) {
  const f = actor.system.gen?.fetch;
  if (!f?.noticed || f.spellId !== spell.id) return;
  await ChatMessage.create({ speaker: ChatMessage.getSpeaker({ actor }), whisper: gmIds(),
    content: `<p>${esc(game.i18n.format("AD2E.Shair.Retribution", { name: actor.name, spell: spell.name,
      band: game.i18n.localize(`AD2E.Shair.Band.${retributionBand(f.level)}`) }))}</p>` });
}

export function emptyFetch() {
  return { spellId: "", name: "", unit: "", count: 0, returnsAt: null, success: false, noticed: false, ready: false, expiresAt: null, level: 0 };
}

/** Active GM: gens return and fetched spells expire as world time passes. */
export function registerShairHooks() {
  Hooks.on("updateWorldTime", async worldTime => {
    if (!game.user.isActiveGM) return;
    for (const actor of game.actors.contents) {
      const f = actor.type === "character" ? actor.system.gen?.fetch : null;
      if (!f?.spellId) continue;
      if (!f.ready && f.returnsAt !== null && worldTime >= f.returnsAt) await genReturns(actor);
      else if (f.ready && f.expiresAt !== null && worldTime >= f.expiresAt) await clearFetched(actor, { expired: true });
    }
  });
}
