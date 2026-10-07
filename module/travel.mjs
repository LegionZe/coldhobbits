import { TRAVEL } from "./rules/travel-tables.mjs";
import { animalsInfo } from "./animals.mjs";
import { travelDayChecks, travelDayRoll } from "./encounters.mjs";

/**
 * Weather and overland travel (module/rules/travel-tables.mjs from tools/build-travel-tables.py; Cross-Country Movement
 * (PHB), Movement, Terrain Obstacles and Hindrances, Movement on Water, Aerial Movement and Getting Lost (DMG)).
 * Owner's rulings: the day's weather is rolled on Table 79 (2d6 by season, hurricane only after a gale; adverse winds
 * 1d6) plus the 1d6 precipitation check of Aerial Movement, kept as the world's weather (world setting `weather`); a GM
 * travel planner (module/apps/travel-planner.mjs) works out the day; getting lost, force marching, boats and ships and
 * Table 73 are included; the chat card's "End day" button advances world time by the travel hours.
 * Implementation choices: precipitation is snow in winter, rain otherwise; its Table 75 entry follows the wind (light
 * rain / normal snow, heavy rain / blizzard in a storm or gale, torrential rain / blizzard in a hurricane), editable; a
 * gale or hurricane ticks "Gale-force winds"; route costs before obstacles, added points before multipliers; the force
 * march check penalty counts the earlier consecutive days (as the mount push, module/animals.mjs); the slowest member
 * sets the pace; boats and ships travel the hours set in the planner (10 by default, the marching day).
 */
export const TR = TRAVEL;
export const SEASONS = ["spring", "summer", "fall", "winter"];
export const MODES = ["foot", "mounted", "vehicle", "boat", "ship", "air"];
export const ROUTES = ["none", "trail", "road"];
const DAY = 86400;

const i18n = (k, d) => (d ? game.i18n.format(k, d) : game.i18n.localize(k));
const esc = v => foundry.utils.escapeHTML?.(String(v ?? "")) ?? String(v ?? "");
const r2 = n => Math.round(n * 100) / 100;

/** Table 79 column of a season (spring and fall share one). */
const column = season => (season === "fall" ? "spring" : season);

/**
 * Roll the day's weather (pure with `die(formula)` returning a number): { season, roll, wind, adverse, adverseRoll,
 * precipitation, precipRoll, kind, offCourse }.
 */
export function rollWeather({ season = "spring", previous = "", die }) {
  const W = TR.weather;
  const roll = die(W.die);
  let wind = W.seasons[column(season)][roll - 2];
  if (wind === "hurricane" && previous !== W.hurricaneAfter) wind = W.hurricaneAfter;
  const adverseRoll = die(W.adverse.die);
  const adverse = adverseRoll >= W.adverse.min;
  const always = W.precipitation.always.includes(wind);
  const precipRoll = always ? null : die(W.precipitation.die);
  const precipitation = always || precipRoll >= W.precipitation[season];
  return { season, roll, wind, adverse, adverseRoll, precipitation, precipRoll, kind: precipitation ? (season === "winter" ? "snow" : "rain") : "",
    offCourse: adverse && W.offCourse.includes(wind) };
}

/** Table 75 entries the weather suggests (pure). */
export function weatherObstacles(w) {
  if (!w?.wind) return [];
  const out = [];
  if (["gale", "hurricane"].includes(w.wind)) out.push("galeWinds");
  if (w.precipitation) {
    const hard = ["storm", "gale"].includes(w.wind), worst = w.wind === "hurricane";
    if (w.kind === "snow") out.push(hard || worst ? "blizzard" : "snow");
    else out.push(worst ? "rainTorrential" : hard ? "rainHeavy" : "rainLight");
  }
  return out;
}

/** Table 82 modifiers the weather suggests (pure). */
export function weatherLostMods(w) {
  return w?.precipitation && w.kind === "rain" ? ["raining"] : [];
}

/** Movement points per mile of a terrain with its route and Table 75 obstacles (pure). */
export function terrainCost(key, { route = "none", obstacles = [] } = {}) {
  const t = TR.terrain.find(x => x.key === key);
  if (!t) return null;
  let cost = t.cost;
  // "Trails through settled farmland offer no improvement"; roads in mountains "are no better than trails".
  if (route === "trail" && key !== "clear") cost = t.cost * TR.trail;
  if (route === "road") cost = t.mountain ? t.cost * TR.trail : Math.min(t.cost, TR.road);
  const obs = obstacles.map(k => TR.obstacles.find(o => o.key === k)).filter(Boolean);
  cost += obs.reduce((n, o) => n + (o.add ?? 0), 0);
  cost *= obs.reduce((n, o) => n * (o.mult ?? 1), 1);
  return r2(cost);
}

/** Movement points for the day: on foot twice the rate (force march 2 1/2), mounts their rate, hitched animals half. */
export function dayPoints(rate, mode = "foot", pace = "normal") {
  const r = Number(rate) || 0;
  if (mode === "foot") return r * (pace === "force" ? TR.march.force : TR.march.normal);
  if (mode === "vehicle") return r * TR.mounted.hitched * TR.mounted.milesPerRate;
  return r * TR.mounted.milesPerRate;
}

/**
 * Spend the day's points on the legs in order (pure): legs [{ terrain, route, obstacles, miles (null = the rest) }]
 * -> { points, used, miles, legs [{ cost, miles, planned, short }], vehicleBlocked }.
 */
export function planDay(points, legs, { vehicle = false, aerial = 1 } = {}) {
  let left = points;
  let total = 0;
  let vehicleBlocked = false;
  const out = legs.map(leg => {
    const cost = terrainCost(leg.terrain, leg);
    if (vehicle && leg.route === "none" && (TR.terrain.find(t => t.key === leg.terrain)?.cost ?? 0) > TR.vehicleMaxCost) vehicleBlocked = true;
    if (!cost || cost <= 0 || left <= 0) return { cost, miles: 0, planned: leg.miles ?? null, short: (leg.miles ?? 0) > 0 };
    const possible = (left / cost) * aerial;
    const miles = leg.miles === null || leg.miles === undefined || leg.miles === "" ? possible : Math.min(Number(leg.miles), possible);
    left -= (miles / aerial) * cost;
    total += miles;
    return { cost, miles: r2(miles), planned: leg.miles ?? null, short: leg.miles !== null && leg.miles !== undefined && leg.miles !== "" && miles < Number(leg.miles) };
  });
  return { points: r2(points), used: r2(points - Math.max(left, 0)), miles: r2(total), legs: out, vehicleBlocked };
}

/** Table 80 multiplier (null = not possible) for the weather (pure; the modifiers are cumulative). */
export function aerialFactor(w) {
  const A = TR.aerial;
  if (!w?.wind) return 1;
  if (w.wind === "hurricane") return null;
  let f = 1;
  if (A[w.wind] !== undefined) f *= A[w.wind];
  if (w.precipitation) f *= A.precipitation;
  return f;
}

/** Boat miles per hour (Table 76): ± current, sail triples the "*" boats with a fair wind (pure). */
export function boatSpeed(key, { current = 0, downstream = true, sail = false } = {}) {
  const b = TR.boats.find(x => x.key === key);
  if (!b) return null;
  const base = b.mph * (sail && b.sail ? TR.sailFactor : 1);
  return Math.max(r2(base + (downstream ? 1 : -1) * (Number(current) || 0)), 0);
}

/**
 * Ship miles per hour (Tables 77/78): sail or row speed times the weather modifier (adverse winds: the adverse row);
 * { mph, check (0 none, 1 seaworthiness, 2 with -45%), becalmed, offCourse } (pure).
 */
export function shipSpeed(key, w, { rowing = false, emergency = false } = {}) {
  const s = TR.ships.find(x => x.key === key);
  if (!s) return null;
  const row = rowing && s.row !== null;
  const wind = w?.wind || "light";
  const cond = w?.adverse && ["favorable", "strong"].includes(wind) ? "adverse" : wind;
  const m = TR.sailing[cond] ?? TR.sailing.light;
  const factor = row ? m.row : m.sail;
  const base = emergency ? s.emergency : (row ? s.row : s.sail);
  return { mph: factor === null ? 0 : r2(base * factor), check: m.check, becalmed: factor === null,
    offCourse: !!w?.adverse && TR.weather.offCourse.includes(wind), seaworthiness: s.seaworthiness };
}

/** Getting lost (Tables 81/82): the percentage (pure); `variable` = the GM's guide/directions values. */
export function lostChance(surroundings, mods = [], variable = 0) {
  const base = TR.lost.find(l => l.key === surroundings)?.pct ?? 0;
  const sum = mods.reduce((n, k) => n + (TR.lostMods.find(m => m.key === k)?.mod ?? 0), 0);
  return Math.max(base + sum + (Number(variable) || 0), 0);
}

/** "If the die roll is less than the percentage, the characters are lost" (pure). */
export function isLost(roll, chance) {
  return roll < chance;
}

/** Table 73: a rate reduced for one round (pure); several conditions: the worst. */
export function roundRate(rate, keys = []) {
  const worst = keys.map(k => TR.round.find(r => r.key === k)?.reduced ?? 0).reduce((a, b) => Math.max(a, b), 0);
  return Math.floor(rate * (1 - worst));
}

/** World day number of a world time. */
export const dayOf = t => Math.floor((Number(t) || 0) / DAY);

/** Force march state of an actor: { days (attack penalty), previous (earlier consecutive days), blocked } (pure). */
export function marchState(sys, today) {
  const m = sys?.march ?? {};
  const previous = m.lastDay === today - 1 ? (m.streak ?? 0) : (m.lastDay === today ? Math.max((m.streak ?? 1) - 1, 0) : 0);
  return { days: m.days ?? 0, previous, blocked: !!m.blocked };
}

/** Rest: half a day removes one day of force marching (pure): the update for `halfDays` half days of rest. */
export function marchRestUpdate(sys, halfDays) {
  const days = Math.max((sys?.march?.days ?? 0) - Math.max(Math.floor(halfDays), 0), 0);
  return { "system.march.days": days, "system.march.streak": 0, ...(days === 0 ? { "system.march.blocked": false } : {}) };
}

/** Members' daily movement: [{ actor, name, mode, rate, fly, mount }] for the travel mode. */
export function memberRates(actors, mode) {
  const flyOf = text => Number(String(text ?? "").match(/\bFl\w*\s*(\d+)/i)?.[1]) || 0;
  return actors.map(actor => {
    const sys = actor.system;
    let rate = actor.type === "character" ? (sys.encumbrance?.info?.rate ?? 12) : (sys.encumbrance?.rate ?? sys.movement?.base ?? 12);
    let fly = actor.type === "monster" ? flyOf(sys.movement?.text) : 0;
    let mount = null;
    if (actor.type === "character" && ["mounted", "vehicle", "air"].includes(mode)) {
      try {
        const row = animalsInfo(actor).rows.find(r => r.riding && !r.missing);
        if (row) { mount = row.name; rate = row.rate; fly = flyOf(row.actor?.system?.movement?.text); }
      } catch { /* no animals */ }
    }
    return { actor, name: actor.name, rate: mode === "air" ? fly : rate, fly, mount };
  });
}

/** The world's current weather (world setting `weather`), or null. */
export function currentWeather() {
  try { const w = game.settings.get("ad2e", "weather"); return w?.wind ? w : null; } catch { return null; }
}

/** GM: roll and store today's weather; posts a GM-only card. */
export async function rollDailyWeather(season) {
  if (!game.user?.isGM) return null;
  const prev = currentWeather();
  // The three dice (2d6 wind, 1d6 adverse, 1d6 precipitation) rolled first, then read in that order.
  const rolls = [];
  for (const f of [TR.weather.die, TR.weather.adverse.die, TR.weather.precipitation.die]) rolls.push(await new Roll(f).evaluate());
  const queue = rolls.map(r => r.total);
  const used = [];
  const die = () => { const v = queue.shift(); used.push(v); return v; };
  const w = { ...rollWeather({ season, previous: prev?.wind ?? "", die }), day: dayOf(game.time?.worldTime) };
  rolls.length = used.length;
  await game.settings.set("ad2e", "weather", w);
  await ChatMessage.create({ rolls, whisper: ChatMessage.getWhisperRecipients?.("GM")?.map(u => u.id) ?? [], content: `<p><strong>${esc(i18n("AD2E.Travel.WeatherCard"))}</strong> ${esc(weatherText(w))}</p>` });
  return w;
}

/** Short text of a weather record. */
export function weatherText(w) {
  if (!w?.wind) return i18n("AD2E.Travel.NoWeather");
  return [i18n(`AD2E.Travel.Season.${w.season}`), i18n(`AD2E.Travel.Wind.${w.wind}`) + (w.roll ? ` (2d6 ${w.roll})` : ""),
    w.adverse ? i18n("AD2E.Travel.Adverse") : "", w.precipitation ? i18n(`AD2E.Travel.Precip.${w.kind || "rain"}`) : i18n("AD2E.Travel.Dry"),
    w.offCourse ? i18n("AD2E.Travel.OffCourse") : ""].filter(Boolean).join(", ");
}

/**
 * Force march checks at the end of the day: a Constitution check (characters; monsters: save vs. death) with -1 per
 * earlier consecutive day; failure ends force marching until recovered. Returns lines for the card.
 */
export async function forceMarchChecks(actors) {
  const today = dayOf(game.time?.worldTime);
  const lines = [];
  const rolls = [];
  for (const actor of actors) {
    const st = marchState(actor.system, today);
    if (st.blocked) { lines.push(i18n("AD2E.Travel.MarchBlocked", { name: actor.name })); continue; }
    const pen = TR.march.checkPerDay * st.previous;
    let ok;
    const roll = await new Roll("1d20").evaluate();
    rolls.push(roll);
    if (actor.type === "character") {
      const target = (actor.system.abilities?.con?.total ?? 10) + pen;
      ok = roll.total <= target;
      lines.push(i18n("AD2E.Travel.MarchCon", { name: actor.name, roll: roll.total, target, result: i18n(ok ? "AD2E.Travel.Passed" : "AD2E.Travel.Failed") }));
    } else {
      const target = actor.system.saves?.[TR.march.creatureSave]?.value ?? 20;
      ok = roll.total + pen >= target;
      lines.push(i18n("AD2E.Travel.MarchSave", { name: actor.name, roll: roll.total + pen, target, result: i18n(ok ? "AD2E.Travel.Passed" : "AD2E.Travel.Failed") }));
    }
    await actor.update({ "system.march.days": st.days + 1, "system.march.streak": st.previous + 1, "system.march.lastDay": today,
      "system.march.blocked": !ok });
  }
  return { lines, rolls };
}

/** GM: rest the actors for a number of days (half a day removes one day of force marching). */
export async function restFromMarch(actors, days) {
  for (const a of actors) await a.update(marchRestUpdate(a.system, Number(days) * 2));
  return actors.length;
}

/** Card buttons (GM): "End day" advances world time by the travel hours once. */
export function travelButtons(message, html) {
  const t = message?.getFlag?.("ad2e", "travel");
  if (!t || !game.user?.isGM || !html?.querySelector) return;
  const box = document.createElement("div");
  box.className = "ad2e-damage-buttons";
  if (t.ended) box.innerHTML = `<span class="ad2e-note">${esc(i18n("AD2E.Travel.Ended"))}</span>`;
  else {
    box.innerHTML = `<button type="button"><i class="fa-solid fa-clock"></i> ${esc(i18n("AD2E.Travel.EndDay", { hours: t.hours }))}</button>`;
    box.querySelector("button").addEventListener("click", async ev => {
      ev.preventDefault();
      ev.stopPropagation();
      // Random encounters (module/encounters.mjs): the day's Table 56 terrain becomes the area; the checks due in the
      // travel hours are rolled by the time hook (automatic checks) or here.
      const from = game.time.worldTime;
      const area = t.terrain56 ? await travelDayChecks(t.terrain56) : null;
      await game.time.advance(Number(t.hours) * 3600);
      await message.setFlag("ad2e", "travel", { ...t, ended: true });
      if (area) await travelDayRoll(area, from, from + Number(t.hours) * 3600);
    });
  }
  (html.querySelector(".message-content") ?? html).append(box);
}

export function registerTravel() {
  game.settings.register("ad2e", "weather", { scope: "world", config: false, type: Object, default: {} });
  game.settings.register("ad2e", "season", { scope: "world", config: false, type: String, default: "spring" });
}
