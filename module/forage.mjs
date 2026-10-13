import { FORAGE } from "./rules/forage-tables.mjs";
import { partyActors } from "./party.mjs";

/**
 * Living off the land (owner's request and rulings, 1.0.55): the Hunting, Fishing and Survival proficiency rolls get their
 * own fields and add what they find to the roller's supplies (module/travel-days.mjs eats it).
 * - Hunting (PHB): -1 per nonproficient hunter in the party; a success comes within 100+1d100 yards and surprises the game;
 *   the kill is played out. The card has buttons for the GM by the animal's size (owner's ruling): Table 33 (CBarbH) rations
 *   (more with the animal rending proficiency) are rolled and added.
 * - Fishing (PHB): a check per hour; fish = Wisdom score - die roll, a net three times as many; the CBarbH spot quality
 *   multiplies (poor 1/2 rounded down, good 2); two fish feed an adult for a day (CBarbH).
 * - Survival (PHB): food or water with a check; a failure ends the attempts that day; owner's ruling: a success gives one
 *   day's food or water for the character; implementation choice (Skills & Powers): one attempt per category a day.
 * Food is an equipment item "Foraged food (per day)" (identifier FORAGE.foodId, 1 lb a day: "A typical human requires only
 * a pound or so of food per day", Provisioning the Crew (CSH)), eaten before carried rations; water found covers the
 * finder's next day of travel (character `system.survival.waterFoundAt`).
 */
export { FORAGE };
export const DAY = 86400;
export const KINDS = ["hunting", "fishing", "survival"];

/** The forage kind of a proficiency identifier (pure): "hunting" | "fishing" | "survival" | null. */
export const forageKind = identifier => KINDS.includes(identifier) ? identifier : null;

/** Hunting penalty for the nonproficient hunters with the hunter (pure). */
export const huntPenalty = nonhunters => FORAGE.hunting.penaltyPerNonhunter * Math.max(Number(nonhunters) || 0, 0);

/** Fish caught in an hour (pure): Wisdom score - die roll on a success, times 3 with a net, times the spot (rounded down). */
export function fishCaught({ success, roll, wisdom, net = false, spot = "average" }) {
  if (!success) return 0;
  const base = Math.max((Number(wisdom) || 0) - (Number(roll) || 0), 0) * (net ? FORAGE.fishing.netMultiplier : 1);
  return Math.floor(base * (FORAGE.fishing.spots[spot] ?? 1));
}

/** Days of food in a catch (pure): two fish a day, rounded down. */
export const fishRations = fish => Math.floor((Number(fish) || 0) / FORAGE.fishing.fishPerRation);

/** The day number of a world time (pure). */
export const dayOf = t => Math.floor((Number(t) || 0) / DAY);

/** Survival categories already tried today (pure): from `system.survival.forage` { day, tried }. */
export function triedToday(state, now) {
  return state?.day === dayOf(now) ? [...(state.tried ?? [])] : [];
}

/** Rations formula for a killed animal (pure): Table 33 by size, the right-hand figures with animal rending. */
export const rationFormula = (size, rending = false) => FORAGE.hunting.rations[size]?.[rending ? "rending" : "average"] ?? null;

/** Party members besides the hunter who lack the Hunting proficiency (implementation choice: the party list, party.mjs). */
export function nonhuntersWith(actor) {
  try {
    return partyActors({ fallback: true }).filter(a => a && a !== actor && a.type === "character"
      && !a.items?.some(i => i.type === "proficiency" && i.system?.identifier === "hunting")).length;
  } catch { return 0; }
}

const esc = v => foundry.utils.escapeHTML?.(String(v ?? "")) ?? String(v ?? "");
const i18n = (k, d) => d ? game.i18n.format(k, d) : game.i18n.localize(k);

/** Extra dialog fields for a forage roll (HTML). */
export function forageFields(actor, kind) {
  if (kind === "hunting") {
    return `<div class="form-group"><label>${esc(i18n("AD2E.Forage.Nonhunters"))}</label><input type="number" name="nonhunters" min="0" step="1" value="${nonhuntersWith(actor)}"></div>`
      + `<p class="hint">${esc(i18n("AD2E.Forage.NonhuntersHint"))}</p>`;
  }
  if (kind === "fishing") {
    const spots = Object.keys(FORAGE.fishing.spots).map(s => `<option value="${s}"${s === "average" ? " selected" : ""}>${esc(i18n(`AD2E.Forage.Spot.${s}`))}</option>`).join("");
    return `<div class="form-group"><label>${esc(i18n("AD2E.Forage.Hours"))}</label><input type="number" name="hours" min="1" max="24" step="1" value="1"></div>`
      + `<div class="form-group"><label>${esc(i18n("AD2E.Forage.Method"))}</label><select name="method"><option value="line">${esc(i18n("AD2E.Forage.Line"))}</option><option value="net">${esc(i18n("AD2E.Forage.Net"))}</option></select></div>`
      + `<div class="form-group"><label>${esc(i18n("AD2E.Forage.SpotLabel"))}</label><select name="spot">${spots}</select></div>`;
  }
  const tried = triedToday(actor.system?.survival?.forage, game.time?.worldTime ?? 0);
  const opts = ["food", "water"].map(k => `<option value="${k}"${tried.includes(k) ? " disabled" : ""}>${esc(i18n(`AD2E.Forage.Seek.${k}`))}${tried.includes(k) ? ` (${esc(i18n("AD2E.Forage.TriedToday"))})` : ""}</option>`).join("");
  return `<div class="form-group"><label>${esc(i18n("AD2E.Forage.SeekLabel"))}</label><select name="seek">${opts}</select></div>`;
}

/** Read the extra fields (from #promptRoll's form). */
export function readForage(form, kind) {
  const el = n => form?.elements?.[n];
  if (kind === "hunting") return { nonhunters: Math.max(Number(el("nonhunters")?.value) || 0, 0) };
  if (kind === "fishing") return { hours: Math.min(Math.max(Math.floor(Number(el("hours")?.value) || 1), 1), 24), net: el("method")?.value === "net", spot: el("spot")?.value || "average" };
  return { seek: el("seek")?.value === "water" ? "water" : "food" };
}

/** Add days of foraged food to an actor (stacked on its "Foraged food (per day)" item). */
export async function addForagedFood(actor, days) {
  const n = Math.floor(Number(days) || 0);
  if (n < 1) return 0;
  const have = actor.items.find(i => i.type === "equipment" && i.system?.identifier === FORAGE.foodId);
  if (have) await have.update({ "system.quantity": (have.system.quantity ?? 0) + n });
  else await actor.createEmbeddedDocuments("Item", [{ name: i18n("AD2E.Forage.FoodName"), type: "equipment",
    system: { identifier: FORAGE.foodId, quantity: n, weight: 1 } }]);
  return n;
}

/**
 * The forage roll (from AD2EActor#rollProficiency once its dialog is answered): `target` = the proficiency target with the
 * situational, kit and other modifiers already in; `notes` = the flavour's modifier text.
 */
export async function rollForage(actor, kind, { item, target, input, notes = "" }) {
  const f = readForage(input.form, kind);
  const speaker = ChatMessage.getSpeaker({ actor });
  if (kind === "hunting") {
    const pen = huntPenalty(f.nonhunters);
    const t = target + pen;
    const roll = await new Roll("1d20").evaluate();
    const success = roll.total < 20 && roll.total <= t;
    let text = `${esc(item.name)} (${esc(i18n("AD2E.Roll.RollUnder"))} ${t}${pen ? `; ${esc(i18n("AD2E.Forage.NonhunterNote", { n: pen }))}` : ""}${notes}): `
      + esc(i18n(success ? "AD2E.Roll.Success" : "AD2E.Roll.Failure"));
    const rolls = [roll];
    let flags = {};
    if (success) {
      const dist = await new Roll(FORAGE.hunting.distance).evaluate();
      rolls.push(dist);
      text += ` — ${esc(i18n("AD2E.Forage.GameFound", { yards: dist.total, close: FORAGE.hunting.closeYards }))}`;
      const rending = !!actor.items?.some(i => i.type === "proficiency" && i.system?.identifier === FORAGE.hunting.rending);
      flags = { ad2e: { hunt: { actor: actor.uuid, name: actor.name, rending, done: null } } };
    }
    return ChatMessage.create({ speaker, rolls, content: `<p>${text}</p>`, flags });
  }
  if (kind === "fishing") {
    const wis = actor.system?.abilities?.wis?.total ?? 10;
    const rolls = [];
    const lines = [];
    let fish = 0;
    for (let h = 1; h <= f.hours; h++) {
      const r = await new Roll("1d20").evaluate();
      rolls.push(r);
      const success = r.total < 20 && r.total <= target;
      const n = fishCaught({ success, roll: r.total, wisdom: wis, net: f.net, spot: f.spot });
      fish += n;
      lines.push(i18n("AD2E.Forage.FishHour", { h, roll: r.total, n }));
    }
    const days = fishRations(fish);
    await addForagedFood(actor, days);
    const content = `<p>${esc(item.name)} (${esc(i18n("AD2E.Roll.RollUnder"))} ${target}${notes}; ${esc(i18n(`AD2E.Forage.Spot.${f.spot}`))}${f.net ? `; ${esc(i18n("AD2E.Forage.Net"))}` : ""})</p>`
      + `<ul>${lines.map(l => `<li>${esc(l)}</li>`).join("")}</ul>`
      + `<p>${esc(i18n("AD2E.Forage.FishTotal", { fish, days, name: actor.name }))}</p>`;
    return ChatMessage.create({ speaker, rolls, content });
  }
  // Survival: one attempt per category a day; a failure also ends the day's attempts (PHB).
  const now = game.time?.worldTime ?? 0;
  const tried = triedToday(actor.system?.survival?.forage, now);
  if (tried.includes(f.seek)) {
    ui.notifications?.warn(i18n("AD2E.Forage.AlreadyTried", { name: actor.name, what: i18n(`AD2E.Forage.Seek.${f.seek}`) }));
    return null;
  }
  const roll = await new Roll("1d20").evaluate();
  const success = roll.total < 20 && roll.total <= target;
  const newTried = success ? [...tried, f.seek] : ["food", "water"];
  const update = { "system.survival.forage": { day: dayOf(now), tried: newTried } };
  let result = "";
  if (success && f.seek === "water") { update["system.survival.waterFoundAt"] = now; result = i18n("AD2E.Forage.WaterFound", { name: actor.name }); }
  await actor.update(update);
  if (success && f.seek === "food") { await addForagedFood(actor, FORAGE.survival.perSuccess); result = i18n("AD2E.Forage.FoodFound", { name: actor.name }); }
  if (!success) result = i18n("AD2E.Forage.NoMoreToday");
  const time = f.seek === "water" ? FORAGE.survival.waterTime : FORAGE.survival.foodTurns;
  return ChatMessage.create({ speaker, rolls: [roll], content: `<p>${esc(item.name)}: ${esc(i18n(`AD2E.Forage.Seek.${f.seek}`))} (${esc(i18n("AD2E.Roll.RollUnder"))} ${target}${notes}): `
    + `${esc(i18n(success ? "AD2E.Roll.Success" : "AD2E.Roll.Failure"))} — ${esc(result)}</p>`
    + (success ? `<p class="ad2e-note">${esc(i18n(f.seek === "water" ? "AD2E.Forage.WaterTime" : "AD2E.Forage.FoodTime", { time }))}</p>` : "") });
}

/** Kill buttons on a successful hunt (GM): the animal's size rolls Table 33 rations into the hunter's supplies. */
export function huntButtons(message, html) {
  const h = message?.getFlag?.("ad2e", "hunt");
  if (!h || !game.user?.isGM || !html?.querySelector) return;
  const box = document.createElement("div");
  box.className = "ad2e-damage-buttons";
  if (h.done) {
    box.innerHTML = `<span class="ad2e-note">${esc(i18n("AD2E.Forage.KillDone", { size: h.done.size, n: h.done.rations }))}</span>`;
  } else {
    box.innerHTML = `<span class="ad2e-note">${esc(i18n("AD2E.Forage.KillHint"))}</span>`
      + Object.keys(FORAGE.hunting.rations).map(s => `<button type="button" data-size="${s}">${esc(i18n("AD2E.Forage.Kill", { size: s, text: FORAGE.hunting.rations[s].text.split("/")[h.rending ? 1 : 0] }))}</button>`).join("");
    for (const b of box.querySelectorAll("button[data-size]")) b.addEventListener("click", async ev => {
      ev.preventDefault();
      ev.stopPropagation();
      const size = b.dataset.size;
      const actor = foundry.utils.fromUuidSync?.(h.actor, { strict: false });
      const roll = await new Roll(rationFormula(size, h.rending)).evaluate();
      if (actor) await addForagedFood(actor, roll.total);
      await message.setFlag("ad2e", "hunt", { ...h, done: { size, rations: roll.total } });
      await roll.toMessage({ speaker: message.speaker, flavor: i18n("AD2E.Forage.KillRations", { name: h.name, size, n: roll.total }) });
    });
  }
  (html.querySelector(".message-content") ?? html).append(box);
}
