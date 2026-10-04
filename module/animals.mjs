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
    if (!actor) return { uuid, missing: true, name: uuid, img: "icons/svg/mystery-man.svg" };
    const enc = actor.system.encumbrance ?? {};
    const riding = sys.animals.riding === uuid;
    const own = enc.own ?? enc.weight ?? 0;
    const otherRider = !riding && enc.rider && enc.rider.uuid !== character.uuid ? enc.rider.name : "";
    const weight = round(own + (riding ? rider.total : (enc.rider?.total ?? 0)));
    const base = actor.system.movement?.base ?? 0;
    const { band, rate } = loadBand(actor.system.load, weight, base);
    return { uuid, actor, name: actor.name, img: actor.img, role: actor.system.role, riding, otherRider, own: round(own),
      weight, full: actor.system.load?.full ?? null, max: actor.system.load?.quarter ?? null, band, rate, base };
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
    if (!animal?.prepareData) continue;
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

/** PHB Table 10 weight for a race: { male, female, dice } or null. */
export function raceWeight(raceId) {
  return RACE_WEIGHT[raceId] ?? null;
}

/** Roll body weight on PHB Table 10 (base for the chosen sex + the race's modifier dice) and store it. */
export async function rollBodyWeight(actor) {
  const raceId = actor.system.raceInfo?.raceItem?.system.identifier;
  const row = raceWeight(raceId);
  if (!row) {
    ui.notifications.warn(game.i18n.localize("AD2E.Animal.NoRaceWeight"));
    return null;
  }
  const i18n = k => game.i18n.localize(k);
  const sex = await foundry.applications.api.DialogV2.wait({
    window: { title: i18n("AD2E.Animal.BodyWeightTitle") },
    content: `<p>${game.i18n.format("AD2E.Animal.BodyWeightText", { race: actor.system.raceInfo.raceItem.name, male: row.male,
      female: row.female, dice: row.dice })}</p>`,
    buttons: [{ action: "male", label: i18n("AD2E.Animal.Male"), default: true }, { action: "female", label: i18n("AD2E.Animal.Female") }],
    rejectClose: false
  });
  if (!sex) return null;
  const roll = await new Roll(`${row[sex]} + ${row.dice}`).evaluate();
  await roll.toMessage({ speaker: ChatMessage.getSpeaker({ actor }),
    flavor: game.i18n.format("AD2E.Animal.BodyWeightChat", { name: actor.name, sex: i18n(`AD2E.Animal.${sex === "male" ? "Male" : "Female"}`) }) });
  await actor.update({ "system.bodyWeight": roll.total });
  return roll.total;
}
