import { SURVIVAL_TABLES } from "./rules/survival-tables.mjs";

/**
 * Travel days (owner's request, 1.0.37): the Travel planner's party uses food and water, rolls a travel event and keeps
 * a day log when the GM ends a travel day (the travel card's "End day", module/travel.mjs).
 *  - Supplies (owner's ruling): each player character in the party eats 1 day of rations and drinks the world setting
 *    `waterPerDay` gallons (owner's ruling: 1/2 gallon by default, changeable for other settings; Provisioning the Crew
 *    (CSH) says "Humans require a minimum of a gallon of water each day") from their own inventory. Rations: items whose
 *    identifier names rations; a "-per-week" item holds 7 days, "-per-day" 1 (equipment `supply.left` = days left in the
 *    opened unit). Water: filled liquid containers (equipment `liquid`, owner's ruling 1.0.29), `liquid.left` = gallons
 *    left (null = full); the emptiest is drunk first.
 *  - Starvation and thirst (owner's ruling: Provisioning the Crew (CSH), module/rules/survival-tables.mjs): days without
 *    food up to half the Constitution score are free, then a daily Constitution check or -1 Strength and -1 Constitution;
 *    water: 3 days free, then a check every 6 hours; Constitution 0 = a save vs. death magic (paralyzation, poison or death
 *    magic) or death; more than a week without water = death; Strength 0 = incapacitated (noted); losses come back once
 *    fed (2 Strength and 1 Constitution a day) and watered (all of a day's thirst losses: 1 point an hour); a score that
 *    reached 0 by starvation loses 1 point for good unless a System Shock roll succeeds when it is restored.
 *  - Events: a 1-in-N daily chance (world setting `travelEvents`, default 1 in 6: implementation choice) of a result from
 *    the built-in list (`EVENTS`, written for this system, not rulebook text) or from a world RollTable the GM picks.
 *  - Day log (world setting `travelLog`): date, miles, mode, weather, lost check, encounter, event and supply lines.
 * Implementation choices: a day's need not fully met counts as a day without it (what there is is still used); thirst
 * losses all come back on a watered day; the party = the planner's members that are characters (mounts and monsters
 * are not fed: the GM handles feed).
 */
export const SURVIVAL = SURVIVAL_TABLES;
export const LOG_LIMIT = 60;
export const DAY = 86400;

/**
 * The built-in event list (d12; written for this system, not taken from a rulebook). `effect`: spoil (one member loses
 * 1d4 days of rations), leak (one member's fullest water container is emptied), refill (every member's liquid containers
 * are filled), or none (a note for the GM).
 */
export const EVENTS = [
  { key: "spoiled", effect: "spoil" }, { key: "leak", effect: "leak" }, { key: "spring", effect: "refill" },
  { key: "lame", effect: "" }, { key: "broken", effect: "" }, { key: "tracks", effect: "" }, { key: "travellers", effect: "" },
  { key: "camp", effect: "" }, { key: "detour", effect: "" }, { key: "game", effect: "" }, { key: "forage", effect: "" },
  { key: "quiet", effect: "" }
];

const i18n = (k, d) => (d ? game.i18n.format(k, d) : game.i18n.localize(k));
const esc = v => foundry.utils?.escapeHTML?.(String(v ?? "")) ?? String(v ?? "");

/* ---------------------------------------- pure rules */

/** Gallons in a volume text ("1 gallon", "2 quarts", "1 pint"); 0 when unknown (pure). */
export function gallonsOf(text) {
  const m = String(text ?? "").toLowerCase().match(/([\d.]+)\s*(gallon|gal|quart|qt|pint|pt)/);
  if (!m) return 0;
  const n = Number(m[1]);
  return m[2].startsWith("g") ? n : m[2].startsWith("q") ? n / 4 : n / 8;
}

/** Strength and Constitution lost to starvation and thirst (pure). */
export function survivalLoss(s) {
  return { str: (s?.starve?.str ?? 0) + (s?.thirst?.str ?? 0), con: (s?.starve?.con ?? 0) + (s?.thirst?.con ?? 0) };
}

/** Days of food one unit of an item holds: rations "-per-week" 7, "-per-day" 1; 0 = not food (pure). */
export function rationDays(item) {
  const id = String(item?.system?.identifier ?? "");
  if (item?.type !== "equipment" || !/ration/.test(id)) return 0;
  return /per-week/.test(id) ? 7 : 1;
}

/** Days of food an actor's items hold (pure). */
export function foodDays(items) {
  return [...(items ?? [])].reduce((n, i) => {
    const per = rationDays(i);
    const q = i.system?.quantity ?? 0;
    if (!per || q < 1) return n;
    const left = i.system?.supply?.left;
    return n + (left === null || left === undefined ? q * per : (q - 1) * per + left);
  }, 0);
}

/** Item updates eating `days` days of food, or null when there is not enough (pure; opened units first). */
export function eatPlan(items, days = 1) {
  const foods = [...(items ?? [])].filter(i => rationDays(i) && (i.system?.quantity ?? 0) > 0)
    .sort((a, b) => (a.system?.supply?.left == null) - (b.system?.supply?.left == null));
  if (foodDays(foods) < days) return null;
  const updates = [];
  let need = days;
  for (const item of foods) {
    if (need <= 0) break;
    const per = rationDays(item);
    let q = item.system.quantity;
    let left = item.system?.supply?.left ?? per;
    while (need > 0 && q > 0) {
      const take = Math.min(left, need);
      left -= take;
      need -= take;
      if (left <= 0) { q -= 1; left = per; }
    }
    updates.push({ _id: item.id, "system.quantity": q, "system.supply.left": left === per ? null : left });
  }
  return updates;
}

/** Gallons in an actor's filled liquid containers (pure). */
export function waterGallons(items) {
  return [...(items ?? [])].reduce((n, i) => n + containerGallons(i), 0);
}

/**
 * Gallons in a filled container item (pure): `liquid.left` is what is left in the whole stack (a stack of several
 * waterskins shares one amount: implementation choice); null = all full.
 */
export function containerGallons(item) {
  const l = item?.system?.liquid;
  if (!l?.full) return 0;
  const volume = gallonsOf(l.volume) * Math.max(item.system?.quantity ?? 1, 0);
  return l.left === null || l.left === undefined ? volume : Math.min(Math.max(l.left, 0), volume);
}

/** Item updates drinking `gallons` (pure): emptiest containers first; { updates, drunk } (drunk < gallons when short). */
export function drinkPlan(items, gallons) {
  const list = [...(items ?? [])].filter(i => containerGallons(i) > 0).sort((a, b) => containerGallons(a) - containerGallons(b));
  const updates = [];
  let need = gallons;
  let drunk = 0;
  for (const item of list) {
    if (need <= 1e-9) break;
    const have = containerGallons(item);
    const take = Math.min(have, need);
    need -= take;
    drunk += take;
    const left = Math.round((have - take) * 1000) / 1000;
    updates.push(left <= 1e-9 ? { _id: item.id, "system.liquid.full": false, "system.liquid.left": null }
      : { _id: item.id, "system.liquid.left": left });
  }
  return { updates, drunk: Math.round(drunk * 1000) / 1000 };
}

/**
 * One day of food and water for a character (pure; `d20()` and `d100()` injectable). `s` = system.survival, `base` =
 * { str, con } scores before starvation and thirst losses, `save` = the save vs. death magic target, `shock` = System
 * Shock %. Returns { survival (next state), dead, incapacitated, permanent: [keys losing a point for good], lines }.
 */
export function survivalDay(s, { fed, watered, base, save = 20, shock = 0, d20, d100 }) {
  const next = structuredClone({ food: 0, water: 0, starve: { str: 0, con: 0 }, thirst: { str: 0, con: 0 }, zero: { str: false, con: false }, ...(s ?? {}) });
  const lines = [];
  const permanent = [];
  let dead = false;
  const current = key => base[key] - next.starve[key] - next.thirst[key];
  const check = (pool, label) => {
    const target = current("con");
    const roll = d20();
    if (roll <= target) { lines.push({ key: "checkOk", label, roll, target }); return; }
    next[pool].str += 1;
    next[pool].con += 1;
    lines.push({ key: "checkFail", label, roll, target });
    if (pool === "starve") for (const k of ["str", "con"]) if (current(k) <= 0) next.zero[k] = true;
  };
  const deathSave = label => {
    const roll = d20();
    const ok = roll >= save;
    lines.push({ key: ok ? "saveOk" : "saveFail", label, roll, target: save });
    if (!ok) dead = true;
  };
  // Water first (checks every 6 hours), then food (one check a day).
  if (watered) {
    if (next.thirst.str || next.thirst.con) lines.push({ key: "thirstBack", str: next.thirst.str, con: next.thirst.con });
    next.water = 0;
    next.thirst = { str: 0, con: 0 };
  } else {
    next.water += 1;
    if (next.water > SURVIVAL.waterMaxDays) { dead = true; lines.push({ key: "thirstDeath", days: next.water }); }
    else if (next.water > SURVIVAL.waterFreeDays) {
      for (let h = 0; h < 24 / SURVIVAL.waterCheckHours && !dead; h++) {
        check("thirst", "thirst");
        if (current("con") <= 0) deathSave("thirst");
      }
    } else lines.push({ key: "noWater", days: next.water, free: SURVIVAL.waterFreeDays });
  }
  if (!dead) {
    const freeDays = Math.floor(base.con / SURVIVAL.foodDivisor);
    if (fed) {
      if (next.starve.str || next.starve.con) {
        const str = Math.min(next.starve.str, SURVIVAL.starveRecover.str);
        const con = Math.min(next.starve.con, SURVIVAL.starveRecover.con);
        next.starve.str -= str;
        next.starve.con -= con;
        lines.push({ key: "starveBack", str, con });
        for (const k of ["str", "con"]) if (next.zero[k] && next.starve[k] === 0) {
          next.zero[k] = false;
          const roll = d100();
          const ok = roll <= shock;
          lines.push({ key: ok ? "shockOk" : "shockFail", ability: k, roll, target: shock });
          if (!ok) permanent.push(k);
        }
      }
      next.food = 0;
    } else {
      next.food += 1;
      if (next.food > freeDays) {
        check("starve", "starve");
        if (current("con") <= 0) deathSave("starve");
      } else lines.push({ key: "noFood", days: next.food, free: freeDays });
    }
  }
  return { survival: next, dead, incapacitated: current("str") <= 0, permanent, lines };
}

/** A travel event check (pure): the 1dN roll is 1. */
export const eventHappens = (roll) => roll === 1;

/** A day log entry trimmed to the newest `LOG_LIMIT` (pure). */
export function addLogEntry(log, entry) {
  return [entry, ...(log ?? [])].slice(0, LOG_LIMIT);
}

/* ---------------------------------------- settings */

export function waterPerDay() {
  try { return Math.max(Number(game.settings.get("ad2e", "waterPerDay")) || 0, 0); } catch { return SURVIVAL.defaultWaterGallons; }
}

export function eventSettings() {
  const d = { source: "builtin", table: "", chance: 6 };
  try { return { ...d, ...(game.settings.get("ad2e", "travelEvents") ?? {}) }; } catch { return d; }
}

export function travelLog() {
  try { return game.settings.get("ad2e", "travelLog")?.entries ?? []; } catch { return []; }
}

export function registerTravelDays() {
  game.settings.register("ad2e", "waterPerDay", { name: "AD2E.TravelDay.WaterSetting", hint: "AD2E.TravelDay.WaterSettingHint",
    scope: "world", config: true, type: Number, default: SURVIVAL.defaultWaterGallons, range: { min: 0, max: 4, step: 0.25 } });
  game.settings.register("ad2e", "travelEvents", { scope: "world", config: false, type: Object, default: { source: "builtin", table: "", chance: 6 } });
  game.settings.register("ad2e", "travelLog", { scope: "world", config: false, type: Object, default: { entries: [] },
    onChange: () => { Hooks.callAll("ad2eTravelLog"); foundry.applications?.instances?.get?.("ad2e-travel-planner")?.render(); } });
}

/* ---------------------------------------- the day */

const roll = async f => (await new Roll(f).evaluate()).total;

/** Food and water for one character at the end of a travel day; returns the card lines. */
export async function supplyCharacter(actor, gallons) {
  const out = [];
  const eat = eatPlan(actor.items, 1);
  if (eat?.length) await actor.updateEmbeddedDocuments("Item", eat);
  const drink = drinkPlan(actor.items, gallons);
  if (drink.updates.length) await actor.updateEmbeddedDocuments("Item", drink.updates);
  const fed = !!eat;
  const watered = gallons <= 0 || drink.drunk + 1e-9 >= gallons;
  const sys = actor.system;
  const lost = survivalLoss(sys.survival);
  const base = { str: (sys.abilities?.str?.total ?? 10) + lost.str, con: (sys.abilities?.con?.total ?? 10) + lost.con };
  // Dice rolled with Foundry's Roll beforehand and read in order (at most 4 thirst checks, a starvation check, two saves).
  const pool = async (f, n) => { const out = []; for (let i = 0; i < n; i++) out.push(await roll(f)); return out; };
  const d20s = await pool("1d20", 8);
  const d100s = await pool("1d100", 2);
  const d20 = () => d20s.shift() ?? 10;
  const d100 = () => d100s.shift() ?? 100;
  const r = survivalDay(sys.survival, { fed, watered, base, save: sys.saves?.[SURVIVAL.deathSave]?.value ?? 20,
    shock: sys.abilityData?.con?.systemShock ?? 0, d20, d100 });
  const update = { "system.survival": r.survival };
  for (const k of r.permanent) update[`system.abilities.${k}.value`] = Math.max((sys.abilities[k].value ?? 1) - 1, 1);
  if (r.dead) update["system.hp.dead"] = true;
  await actor.update(update);
  out.push(i18n("AD2E.TravelDay.Used", { name: actor.name, food: fed ? 1 : 0, water: drink.drunk, need: gallons,
    foodLeft: foodDays(actor.items), waterLeft: Math.round(waterGallons(actor.items) * 100) / 100 }));
  for (const l of r.lines) out.push(i18n(`AD2E.TravelDay.Line.${l.key}`, { name: actor.name, ...l,
    label: l.label ? i18n(`AD2E.TravelDay.${l.label}`) : "", ability: l.ability ? i18n(`AD2E.Ability.${l.ability}`) : "" }));
  if (r.incapacitated && !r.dead) out.push(i18n("AD2E.TravelDay.Incapacitated", { name: actor.name }));
  if (r.dead) out.push(i18n("AD2E.TravelDay.Dead", { name: actor.name }));
  return out;
}

/** Roll the day's travel event (built-in list or the GM's table); applies the built-in effects to the party. */
export async function rollTravelEvent(characters) {
  const cfg = eventSettings();
  if (cfg.source === "none") return null;
  const n = Math.max(Number(cfg.chance) || 0, 1);
  const check = await roll(`1d${n}`);
  if (!eventHappens(check)) return { text: i18n("AD2E.TravelDay.NoEvent", { roll: check, n }), happened: false };
  if (cfg.source === "table") {
    const table = cfg.table ? await fromUuid(cfg.table) : null;
    if (!table) return { text: i18n("AD2E.TravelDay.NoTable"), happened: true };
    const drawn = await table.draw({ displayChat: false });
    const result = drawn?.results?.[0];
    return { text: i18n("AD2E.TravelDay.TableEvent", { table: table.name, roll: drawn?.roll?.total ?? "—",
      result: result?.name || result?.description || result?.text || "—" }), happened: true };
  }
  const r = await roll(`1d${EVENTS.length}`);
  const ev = EVENTS[r - 1];
  let effect = "";
  const pick = () => characters[Math.floor(Math.random() * characters.length)];
  if (ev.effect === "spoil" && characters.length) {
    const who = pick();
    const days = Math.min(await roll("1d4"), foodDays(who.items));
    const plan = days ? eatPlan(who.items, days) : null;
    if (plan?.length) await who.updateEmbeddedDocuments("Item", plan);
    effect = i18n("AD2E.TravelDay.Effect.spoil", { name: who.name, days });
  } else if (ev.effect === "leak" && characters.length) {
    const who = pick();
    const full = [...who.items].filter(i => containerGallons(i) > 0).sort((a, b) => containerGallons(b) - containerGallons(a))[0];
    if (full) await full.update({ "system.liquid.full": false, "system.liquid.left": null });
    effect = full ? i18n("AD2E.TravelDay.Effect.leak", { name: who.name, item: full.name }) : i18n("AD2E.TravelDay.Effect.leakNone", { name: who.name });
  } else if (ev.effect === "refill") {
    for (const who of characters) {
      const ups = [...who.items].filter(i => i.type === "equipment" && i.system?.liquid?.fullWeight != null)
        .map(i => ({ _id: i.id, "system.liquid.full": true, "system.liquid.left": null }));
      if (ups.length) await who.updateEmbeddedDocuments("Item", ups);
    }
    effect = i18n("AD2E.TravelDay.Effect.refill");
  }
  return { text: `${i18n(`AD2E.TravelDay.Event.${ev.key}`)}${effect ? ` ${effect}` : ""} (1d${EVENTS.length} = ${r})`, happened: true };
}

/** Create a world RollTable from the built-in list, for the GM to edit. */
export async function createEventTable() {
  const results = EVENTS.map((e, i) => ({ type: "text", name: i18n(`AD2E.TravelDay.Event.${e.key}`),
    description: i18n(`AD2E.TravelDay.Event.${e.key}`), range: [i + 1, i + 1], weight: 1 }));
  return RollTable.implementation.create({ name: i18n("AD2E.TravelDay.TableName"), formula: `1d${EVENTS.length}`, replacement: true,
    displayRoll: true, results });
}

/**
 * End of a travel day (GM, the travel card's "End day" after world time advanced): supplies for each character of the
 * party, the travel event, a log entry and a GM card.
 */
export async function endTravelDay(t, { encounter = null } = {}) {
  if (!game.user?.isGM) return null;
  const resolve = foundry.utils.fromUuidSync ?? globalThis.fromUuidSync;
  const members = (t.members ?? []).map(u => resolve?.(u, { strict: false })).filter(Boolean);
  const characters = members.filter(a => a.type === "character" && !a.system?.hp?.dead);
  const gallons = waterPerDay();
  const supplies = [];
  if (t.supplies !== false) for (const a of characters) supplies.push(...await supplyCharacter(a, gallons));
  const event = await rollTravelEvent(characters);
  const entry = { at: game.time.worldTime, date: dateText(game.time.worldTime), miles: t.miles ?? 0, mode: t.mode ?? "",
    weather: t.weather ?? "", lost: t.lost ?? null, encounter, event: event?.text ?? "", supplies };
  try { await game.settings.set("ad2e", "travelLog", { entries: addLogEntry(travelLog(), entry) }); } catch { /* setting missing */ }
  const lines = [
    t.weather ? `${i18n("AD2E.Travel.Weather")}: ${t.weather}` : "",
    t.lost === null || t.lost === undefined ? "" : i18n(t.lost ? "AD2E.TravelDay.LogLost" : "AD2E.TravelDay.LogNotLost"),
    encounter === null ? "" : i18n(encounter ? "AD2E.TravelDay.LogEncounter" : "AD2E.TravelDay.LogNoEncounter"),
    event?.text ? `${i18n("AD2E.TravelDay.EventLabel")}: ${event.text}` : "",
    ...supplies
  ].filter(Boolean);
  await ChatMessage.create({ whisper: ChatMessage.getWhisperRecipients?.("GM")?.map(u => u.id) ?? [],
    speaker: { alias: i18n("AD2E.Travel.Title") },
    content: `<p><strong>${esc(i18n("AD2E.TravelDay.Card", { date: entry.date, miles: entry.miles }))}</strong></p><ul>${lines.map(l => `<li>${esc(l)}</li>`).join("")}</ul>` });
  return entry;
}

/** A world time as the calendar's date, or "Day N". */
export function dateText(t) {
  try {
    const c = game.time?.calendar;
    const comps = c?.timeToComponents?.(t);
    if (comps && c?.format) return c.format(comps);
  } catch { /* no calendar */ }
  return i18n("AD2E.TravelDay.DayN", { n: Math.floor((Number(t) || 0) / DAY) + 1 });
}
