/**
 * Mounts and pack animals (Encumbrance (PHB), "Encumbrance and Mounts"; PHB Table 49, Carrying Capacities of Animals):
 *  - "The 'Base Move' column in Table 49 lists the maximum amount an animal can carry and maintain its normal movement
 *    rate. Animals can be loaded greater than this, up to a maximum of twice their normal load" (1/2 and 1/4 movement
 *    columns); beyond the last column the animal cannot move.
 *  - "When calculating a mount's load, be sure to include the weight of the rider!": a character riding an animal adds
 *    its body weight (PHB Table 10 roll, `system.bodyWeight`) and everything it carries (its encumbrance total).
 *  - A character's animals are monster actors in `system.animals.actors` (UUIDs, dropped on the sheet); `riding` is the
 *    one it rides.
 */
import { RACE_WEIGHT } from "./rules/race-tables.mjs";
import { MOUNT_PUSH } from "./rules/movement-tables.mjs";
import { NPC_TABLES } from "./rules/npc-tables.mjs";

const resolve = uuid => (foundry.utils.fromUuidSync ?? globalThis.fromUuidSync)?.(uuid, { strict: false }) ?? null;
const round = n => Math.round(n * 10) / 10;

/** Movement on a Table 49 load: { band: full | half | quarter | over | null (no load listed), rate }. */
export function loadBand(load, weight, base) {
  let rate = base;
  let band = null;
  if (load?.full !== null && load?.full !== undefined) {
    if (weight <= load.full) band = "full";
    else if (load.half !== null && weight <= load.half) { band = "half"; rate = Math.floor(rate / 2); }
    else if (load.quarter !== null && weight <= load.quarter) { band = "quarter"; rate = Math.floor(rate / 4); }
    else { band = "over"; rate = 0; }
  }
  return { band, rate };
}

/** A monster actor that goes into a character's animal list: a mount, pack animal or pet, or one with a Table 49 load. */
export function isAnimal(actor) {
  return actor?.type === "monster" && (["mount", "pack", "pet"].includes(actor.system?.role)
    || (actor.system?.load?.full ?? null) !== null);
}

/** What a rider adds to its mount's load: body weight + everything carried (encumbrance total, clothing included). */
export function riderWeight(character) {
  const body = character?.system?.bodyWeight ?? null;
  const gear = character?.system?.encumbrance?.info?.total ?? 0;
  return { body, gear, total: round((body ?? 0) + gear), missingBody: body === null };
}

/** The character riding a monster actor (world actors), or null. */
export function riderOf(monster, actors) {
  let list = actors;
  try { list ??= game.actors; } catch { list = null; }
  const uuid = monster?.uuid;
  if (!uuid || !list) return null;
  return [...list].find(a => a?.type === "character" && a.system?.animals?.riding === uuid) ?? null;
}

/** Display data for a character's animals: load (own + this character when it rides the animal), band and movement. */
export function animalsInfo(character) {
  const sys = character.system;
  const rider = riderWeight(character);
  const rows = (sys.animals?.actors ?? []).map(uuid => {
    const actor = resolve(uuid);
    // A compendium link resolves to its index entry (name and image, no data): it cannot carry a load.
    if (!actor?.system) return { uuid, missing: true, compendium: String(uuid).startsWith("Compendium."),
      name: actor?.name ?? uuid, img: actor?.img ?? "icons/svg/mystery-man.svg" };
    const enc = actor.system.encumbrance ?? {};
    const riding = sys.animals.riding === uuid;
    const own = enc.own ?? enc.weight ?? 0;
    const otherRider = !riding && enc.rider && enc.rider.uuid !== character.uuid ? enc.rider.name : "";
    const weight = round(own + (riding ? rider.total : (enc.rider?.total ?? 0)));
    const base = actor.system.movement?.base ?? 0;
    const { band, rate } = loadBand(actor.system.load, weight, base);
    return { uuid, actor, name: actor.name, img: actor.img, role: actor.system.role, riding, otherRider, own: round(own),
      weight, full: actor.system.load?.full ?? null, max: actor.system.load?.quarter ?? null, band, rate, base,
      push: pushStatus(actor) };
  });
  return { rows, rider, riding: sys.animals?.riding ?? "" };
}

/**
 * Re-prepare a character's animals so their loads include the rider's current weight (the animal's own data does not
 * change when its rider's does), and redraw their open sheets.
 */
export function refreshAnimals(character, extra = []) {
  for (const uuid of new Set([...(character?.system?.animals?.actors ?? []), ...extra])) {
    const animal = resolve(uuid);
    if (!animal?.system || typeof animal.prepareData !== "function") continue;
    animal.prepareData();
    if (animal.sheet?.rendered) animal.sheet.render();
  }
}

/** Hooks: a rider's changes (actor or its items) update its animals; after loading, ridden animals include their rider. */
export function registerAnimalHooks() {
  Hooks.on("updateActor", actor => { if (actor.type === "character") refreshAnimals(actor); });
  for (const hook of ["createItem", "updateItem", "deleteItem"]) {
    Hooks.on(hook, item => { if (item.parent?.type === "character") refreshAnimals(item.parent); });
  }
  Hooks.once("ready", () => {
    for (const a of game.actors ?? []) if (a.type === "character" && a.system.animals?.riding) refreshAnimals(a);
  });
}

/* ---------------------------------------- Pushing a mount (Movement (DMG); rules in movement-tables.mjs MOUNT_PUSH) */

const DAY = 86400;
const dayOf = t => Math.floor((t ?? 0) / DAY);

/**
 * A mount's push state now: { status: "" | "lame" | "spent" | "dead", until (world time), streak (consecutive days
 * pushed at double speed, today included) }. "lame": no more travel today, then normal speed only until rested a day;
 * "spent" (after triple speed): rested, not ridden, until `until`.
 */
export function pushStatus(actor, now = game.time?.worldTime ?? 0) {
  const p = actor?.system?.push ?? {};
  if ((actor?.system?.hp?.value ?? 1) <= 0 && p.status === "dead") return { status: "dead", until: null, streak: 0 };
  const active = p.status && p.until !== null && p.until !== undefined && now < p.until;
  return { status: active ? p.status : "", until: active ? p.until : null, streak: p.lastDay === dayOf(now) ? (p.streak ?? 0) : 0 };
}

/**
 * Saving throw modifier for pushing: double speed -1 per previous consecutive day at double speed, ponies, donkeys and
 * mules +2 (double only); triple speed -3.
 */
export function pushModifier(actor, pace, now = game.time?.worldTime ?? 0) {
  const P = MOUNT_PUSH;
  if (pace === "triple") return { previous: 0, hardy: 0, total: P.triple.mod };
  const p = actor?.system?.push ?? {};
  const today = dayOf(now);
  const previous = p.lastDay === today - 1 ? (p.streak ?? 0) : (p.lastDay === today ? Math.max((p.streak ?? 1) - 1, 0) : 0);
  const hardy = P.hardy.identifiers.some(id => String(actor?.system?.identifier ?? "").startsWith(id)) ? P.hardy.double : 0;
  return { previous, hardy, total: P.double.perDay * previous + hardy + P.double.mod };
}

/**
 * Push a mount to double or triple its daily movement: saving throw vs. death (par). Double: failure = lame (no more
 * travel today, normal speed until rested a day). Triple: failure = it dies; success = spent, rested 1d3 days.
 */
export async function pushMount(actor) {
  const i18n = k => game.i18n.localize(k);
  const fmt = (k, d) => game.i18n.format(k, d);
  const esc = v => foundry.utils.escapeHTML?.(String(v ?? "")) ?? String(v ?? "");
  const now = game.time.worldTime;
  const state = pushStatus(actor, now);
  if (state.status) return ui.notifications.warn(fmt(`AD2E.Push.Blocked.${state.status}`, { name: actor.name }));
  const target = actor.system.saves?.[MOUNT_PUSH.save]?.value ?? 20;
  const dbl = pushModifier(actor, "double", now);
  const input = await foundry.applications.api.DialogV2.prompt({
    window: { title: fmt("AD2E.Push.Title", { name: actor.name }) },
    content: `<div class="form-group"><label>${i18n("AD2E.Push.Pace")}</label><select name="pace">`
      + `<option value="double">${esc(fmt("AD2E.Push.Double", { mod: dbl.total }))}</option>`
      + `<option value="triple">${esc(fmt("AD2E.Push.Triple", { mod: MOUNT_PUSH.triple.mod }))}</option></select></div>`
      + `<p class="ad2e-note">${esc(fmt("AD2E.Push.Note", { target, previous: dbl.previous, hardy: dbl.hardy }))}</p>`
      + `<div class="form-group"><label>${i18n("AD2E.Roll.Modifier")}</label><input type="number" name="mod" value="0"></div>`,
    ok: { label: i18n("AD2E.Roll.Roll"), callback: (event, button) => ({ pace: button.form.elements.pace.value,
      mod: Number(button.form.elements.mod.value) || 0 }) },
    rejectClose: false
  });
  if (!input) return;
  const m = pushModifier(actor, input.pace, now);
  const roll = await new Roll("1d20 + @mod", { mod: m.total + input.mod }).evaluate();
  const saved = roll.total >= target;
  const today = dayOf(now);
  const update = {};
  let result;
  if (input.pace === "double") {
    update["system.push.lastDay"] = today;
    update["system.push.streak"] = m.previous + 1;
    if (saved) result = i18n("AD2E.Push.DoubleSaved");
    else {
      Object.assign(update, { "system.push.status": "lame", "system.push.until": now + MOUNT_PUSH.double.lameRestDays * DAY });
      result = i18n("AD2E.Push.Lame");
    }
  } else if (saved) {
    const rest = await new Roll(MOUNT_PUSH.triple.rest).evaluate();
    Object.assign(update, { "system.push.status": "spent", "system.push.until": now + rest.total * DAY, "system.push.streak": 0 });
    result = fmt("AD2E.Push.Spent", { days: rest.total });
  } else {
    Object.assign(update, { "system.push.status": "dead", "system.push.until": null, "system.hp.value": 0 });
    result = i18n("AD2E.Push.Dies");
  }
  await actor.update(update);
  return roll.toMessage({ speaker: ChatMessage.getSpeaker({ actor }),
    flavor: `${esc(fmt(input.pace === "double" ? "AD2E.Push.FlavorDouble" : "AD2E.Push.FlavorTriple", { name: actor.name, target }))}`
      + `${m.previous ? ` [${esc(fmt("AD2E.Push.Successive", { n: -m.previous }))}]` : ""}${m.hardy && input.pace === "double" ? ` [+${m.hardy}]` : ""}: `
      + esc(result) });
}

/** Short text of a mount's push state ("" when fresh), e.g. "Lame until 3 Mar, 08:00" in world-time days. */
export function pushText(actor, now = game.time?.worldTime ?? 0) {
  const s = pushStatus(actor, now);
  if (!s.status) return s.streak ? game.i18n.format("AD2E.Push.Streak", { n: s.streak }) : "";
  if (s.status === "dead") return game.i18n.localize("AD2E.Push.State.dead");
  const hours = Math.max(Math.ceil((s.until - now) / 3600), 0);
  return game.i18n.format(`AD2E.Push.State.${s.status}`, { hours });
}

/** PHB Table 10 weight for a race: { male, female, dice } or null. */
export function raceWeight(raceId) {
  return RACE_WEIGHT[raceId] ?? null;
}

/** PHB Table 10 heights for a race (inches): { male, female, dice } or null. */
export function raceHeight(raceId) {
  return NPC_TABLES.heights[raceId] ?? null;
}

/** The PHB Table 10 column of a character (pure): the chosen one, else a male or female gender's, else null. */
export function tableColumn(sys) {
  if (sys?.build === "male" || sys?.build === "female") return sys.build;
  return sys?.gender === "male" || sys?.gender === "female" ? sys.gender : null;
}

/** Height in inches as feet and inches (pure). */
export function feetInches(inches) {
  if (!(inches > 0)) return "";
  const n = Math.round(inches);
  return `${Math.floor(n / 12)}' ${n % 12}"`;
}

/**
 * Roll body weight (and with `height`, height) on PHB Table 10: the base for the character's Table 10 column
 * (`tableColumn`; asked when not set) plus the race's modifier dice, and store them.
 */
export async function rollBodyWeight(actor, { height = false } = {}) {
  const race = actor.system.raceInfo?.raceItem;
  const raceId = race?.system.identifier;
  const row = raceWeight(raceId), hrow = height ? raceHeight(raceId) : null;
  if (!row && !hrow) {
    ui.notifications.warn(game.i18n.localize("AD2E.Animal.NoRaceWeight"));
    return null;
  }
  const i18n = k => game.i18n.localize(k);
  let column = tableColumn(actor.system);
  if (!column) {
    const text = [row ? game.i18n.format("AD2E.Animal.BodyWeightText", { race: race.name, male: row.male, female: row.female, dice: row.dice }) : "",
      hrow ? game.i18n.format("AD2E.Animal.HeightText", { race: race.name, male: hrow.male, female: hrow.female, dice: hrow.dice }) : ""]
      .filter(Boolean).map(x => `<p>${x}</p>`).join("");
    column = await foundry.applications.api.DialogV2.wait({
      window: { title: i18n(height ? "AD2E.Animal.HeightWeightTitle" : "AD2E.Animal.BodyWeightTitle") },
      content: `${text}<p>${i18n("AD2E.Animal.ColumnAsk")}</p>`,
      buttons: [{ action: "male", label: i18n("AD2E.Gender.Build.male"), default: true }, { action: "female", label: i18n("AD2E.Gender.Build.female") }],
      rejectClose: false
    });
  }
  if (!column) return null;
  const update = {};
  const speaker = ChatMessage.getSpeaker({ actor }), col = i18n(`AD2E.Gender.Build.${column}`);
  if (hrow) {
    const r = await new Roll(`${hrow[column]} + ${hrow.dice}`).evaluate();
    update["system.height"] = r.total;
    await r.toMessage({ speaker, flavor: game.i18n.format("AD2E.Animal.HeightChat", { name: actor.name, sex: col, result: feetInches(r.total) }) });
  }
  if (row) {
    const r = await new Roll(`${row[column]} + ${row.dice}`).evaluate();
    update["system.bodyWeight"] = r.total;
    await r.toMessage({ speaker, flavor: game.i18n.format("AD2E.Animal.BodyWeightChat", { name: actor.name, sex: col }) });
  }
  await actor.update(update);
  return update["system.bodyWeight"] ?? null;
}
