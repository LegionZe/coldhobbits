/**
 * Golden Voyages sailing rules (ALQ1, Home Port pp. 18-22 "The Lore of the Sea"; figures supplied by the owner, 1.0.85;
 * data in NAVAL.gv from tools/build-naval-tables.py `GV_SAILING`). World setting "gvSailing" (off by default): the rules
 * are added to the Of Ships and the Sea ones rather than replacing them.
 *  - Fixing location: a Navigation proficiency roll from the character sheet asks for the waters (well-known, unfamiliar
 *    or uncharted coast, open sea), the time of day and the tools; daftar / rahmani +2 (not combined), cross staff +1 at
 *    noon or midnight, compass +1 or a gen compass +2, kamal +1 in the evening; no check in fog. Only the best navigator's
 *    roll counts (the GM's call: each navigator may roll).
 *  - Weather: DMG Table 79 (2d6 by season, travel-tables.mjs) with the modifier for yesterday's weather and the results it
 *    changes; fog on a 6 (1d6) with a light breeze or becalmed, never in summer. Implementation choice: the condition sets
 *    the Of Ships and the Sea wind strength (NAVAL.gv.windFor) for rates, drift and checks.
 *  - Storms: a failed seaworthiness check in a gale or storm damages the ship (repairs needed; the GM picks what broke)
 *    the first time and sinks her the second.
 *  - Reefs and shoals: a failed grounding check puts her on the reef; a check at once and every hour after opens a hole on a
 *    failure; 3 bailers per hole keep her afloat, otherwise the next check fails and she breaks up; high tide in 2d12 hours.
 *  - Anchorages: % chance by shoreline, +10% at a river mouth, once every 5 miles.
 */
import { NAVAL } from "./rules/naval-tables.mjs";
import { TRAVEL } from "./rules/travel-tables.mjs";

const GV = NAVAL.gv;
const i18n = (k, d) => (d ? game.i18n.format(k, d) : game.i18n.localize(k));
const esc = v => foundry.utils.escapeHTML?.(String(v ?? "")) ?? String(v ?? "");
export const CONDITIONS = ["becalmed", "light", "favorable", "strong", "storm", "gale", "hurricane"];
export const WATERS = Object.keys(GV.navigation);
export const TIMES = ["day", "noon", "evening", "midnight", "night"];
export const TOOLS = Object.keys(GV.tools);
export const SHORES = Object.keys(GV.anchorage.shores);
/** Equipment identifiers of the navigation tools (the Al-Qadim Equipment pack, folder "Navigation (Golden Voyages)"). */
export const TOOL_ITEMS = { daftar: "daftar", rahmani: "rahmani", crossStaff: "cross-staff", compass: "compass", magicCompass: "gen-compass", kamal: "kamal" };

/** World setting "gvSailing". */
export function gvSailingOn() {
  try { return !!game.settings.get("ad2e", "gvSailing"); } catch { return false; }
}

/**
 * The day's weather (pure): DMG Table 79 at roll + yesterday's modifier (2-12), the table's hurricane rule (only after a
 * gale), then the result yesterday's weather changes. Returns { roll, modifier, total, table, condition }.
 */
export function gvWeather({ season = "spring", previous = "", roll }) {
  const W = TRAVEL.weather;
  const modifier = GV.weather.modifier[previous] ?? 0;
  const total = Math.min(Math.max(roll + modifier, 2), 12);
  let table = W.seasons[season === "fall" ? "spring" : season]?.[total - 2] ?? "favorable";
  if (table === "hurricane" && previous !== W.hurricaneAfter) table = W.hurricaneAfter;
  const condition = GV.weather.change[previous]?.[table] ?? table;
  return { roll, modifier, total, table, condition };
}

/** Fog (pure): a 6 on 1d6 with a light breeze or becalmed, never in summer. */
export const fogToday = (condition, season, d6) => GV.fog.when.includes(condition) && !GV.fog.never.includes(season) && d6 >= GV.fog.on;

/** The Of Ships and the Sea wind strength for a Table 79 condition (implementation choice). */
export const windFor = condition => GV.windFor[condition] ?? "moderate";

/**
 * Navigation bonus (pure) for the tools at hand at a time of day: the better of each exclusive pair (daftar / rahmani,
 * compass / gen compass), the cross staff only at noon or midnight, the kamal only in the evening.
 */
export function navigationBonus(tools = [], time = "day") {
  const have = new Set(tools.filter(t => !GV.toolTimes[t] || GV.toolTimes[t].includes(time)));
  let bonus = 0;
  const used = [];
  for (const group of GV.exclusive) {
    const best = group.filter(t => have.has(t)).sort((a, b) => GV.tools[b] - GV.tools[a])[0];
    if (best) { bonus += GV.tools[best]; used.push(best); }
    group.forEach(t => have.delete(t));
  }
  for (const t of have) { bonus += GV.tools[t] ?? 0; used.push(t); }
  return { bonus, used };
}

/** What a navigation roll fixes (pure): { waters, success, twenty, ...miles } from NAVAL.gv.navigation. */
export function navigationResult(waters, success, roll) {
  const w = GV.navigation[waters] ?? GV.navigation.wellKnown;
  const r = success ? w.success : w.failure;
  return { waters: GV.navigation[waters] ? waters : "wellKnown", success, offCourse: !success && roll === 20 && r.twenty ? r.twenty : 0, ...r };
}

/** Anchorage chance (pure): the shoreline's % (+10 at a river mouth or delta). */
export const anchorageChance = (shore, river = false) => (GV.anchorage.shores[shore] ?? 0) + (river ? GV.anchorage.riverMouth : 0);

/** Holes the bailers cannot keep up with (pure): 3 bailers per hole. */
export const flooding = (holes, bailers) => holes > 0 && (Number(bailers) || 0) < holes * GV.reef.bailersPerHole;

/**
 * One reef check (pure): a flooding ship breaks up; otherwise a failure opens another hole. Returns { holes, brokeUp }.
 */
export function reefCheck({ holes = 0, bailers = 0, fail }) {
  if (flooding(holes, bailers)) return { holes, brokeUp: true };
  return { holes: holes + (fail ? 1 : 0), brokeUp: false };
}

/** The navigation tools an actor carries (equipment identifiers in TOOL_ITEMS). */
export function toolsOf(actor) {
  const ids = new Set((actor?.items ?? []).filter(i => i.type === "equipment" || i.type === "magic").map(i => i.system?.identifier));
  return TOOLS.filter(t => ids.has(TOOL_ITEMS[t]));
}

/** Extra fields of the Navigation proficiency dialog (AD2EActor#rollProficiency). */
export function navigationFields(actor, { fog = false } = {}) {
  const have = new Set(toolsOf(actor));
  const sel = (name, list, prefix, value) => `<select name="${name}">${list.map(v => `<option value="${v}"${v === value ? " selected" : ""}>${esc(i18n(`${prefix}.${v}`))}</option>`).join("")}</select>`;
  return `<fieldset><legend>${esc(i18n("AD2E.GvSailing.NavLegend"))}</legend>`
    + `<div class="form-group"><label>${esc(i18n("AD2E.GvSailing.WatersLabel"))}</label>${sel("gvWaters", WATERS, "AD2E.GvSailing.Waters", "wellKnown")}</div>`
    + `<div class="form-group"><label>${esc(i18n("AD2E.GvSailing.TimeLabel"))}</label>${sel("gvTime", TIMES, "AD2E.GvSailing.Time", "day")}</div>`
    + `<div class="ad2e-check-grid">${TOOLS.map(t => `<label><input type="checkbox" name="gvTool-${t}"${have.has(t) ? " checked" : ""}> ${esc(i18n(`AD2E.GvSailing.Tool.${t}`))} (+${GV.tools[t]})</label>`).join("")}`
    + `<label><input type="checkbox" name="gvFog"${fog ? " checked" : ""}> ${esc(i18n("AD2E.GvSailing.Fog"))}</label></div>`
    + `<p class="hint">${esc(i18n("AD2E.GvSailing.NavHint"))}</p></fieldset>`;
}

/** Read the navigation fields. */
export function readNavigation(form) {
  const el = n => form?.elements?.[n];
  return { waters: el("gvWaters")?.value || "wellKnown", time: el("gvTime")?.value || "day", fog: !!el("gvFog")?.checked,
    tools: TOOLS.filter(t => el(`gvTool-${t}`)?.checked) };
}

/** Text of a navigation result (pure but for i18n). */
export function navigationText(res) {
  const k = `AD2E.GvSailing.Nav.${res.waters}.${res.success ? "success" : "failure"}`;
  return i18n(k, res) + (res.offCourse ? ` ${i18n("AD2E.GvSailing.Nav.offCourse", { miles: res.offCourse })}` : "");
}

/** The Navigation roll under the Golden Voyages rules (called by AD2EActor#rollProficiency). */
export async function rollNavigation(actor, { item, target, input, notes = "" }) {
  const nav = readNavigation(input.form);
  const speaker = ChatMessage.getSpeaker({ actor });
  if (nav.fog) return ChatMessage.implementation.create({ speaker, content: `<p>${esc(i18n("AD2E.GvSailing.FogNoCheck", { name: actor.name }))}</p>` });
  const b = navigationBonus(nav.tools, nav.time);
  const t = target + b.bonus;
  const roll = await new Roll("1d20").evaluate();
  const success = roll.total < 20 && roll.total <= t;
  const res = navigationResult(nav.waters, success, roll.total);
  const tools = b.used.map(x => `${i18n(`AD2E.GvSailing.Tool.${x}`)} +${GV.tools[x]}`).join(", ");
  return roll.toMessage({ speaker,
    flavor: `${item.name} (${i18n("AD2E.Roll.RollUnder")} ${t}${tools ? `; ${tools}` : ""}${notes}) · ${i18n(`AD2E.GvSailing.Waters.${res.waters}`)}: `
      + `${i18n(success ? "AD2E.Roll.Success" : "AD2E.Roll.Failure")}. ${navigationText(res)}`,
    flags: { ad2e: { navigation: { ...res, roll: roll.total, target: t } } } });
}

const gmWhisper = () => (game.users ?? []).filter(u => u.isGM).map(u => u.id);

/** Roll the day's weather (GM, the Sea voyage tool): Table 79 with yesterday's modifier, fog; returns { weather, fog, d6 }. */
export async function rollGvWeather(previous, season) {
  const r = await new Roll("2d6").evaluate();
  const weather = gvWeather({ season, previous: previous || GV.weather.start, roll: r.total });
  const f = await new Roll(GV.fog.die).evaluate();
  const fog = fogToday(weather.condition, season, f.total);
  await ChatMessage.implementation.create({ speaker: { alias: i18n("AD2E.Naval.VoyageTitle") }, whisper: gmWhisper(), rolls: [r, f],
    content: `<p>${esc(i18n("AD2E.GvSailing.WeatherLine", { roll: weather.roll, mod: weather.modifier >= 0 ? `+${weather.modifier}` : weather.modifier,
      total: weather.total, table: i18n(`AD2E.GvSailing.Condition.${weather.table}`), condition: i18n(`AD2E.GvSailing.Condition.${weather.condition}`) }))}</p>`
      + (fog ? `<p>${esc(i18n("AD2E.GvSailing.FogToday"))}</p>` : "") });
  return { weather, fog, d6: f.total };
}

/** Search a stretch of coast for an anchorage (GM). */
export async function findAnchorage(shore, river) {
  const chance = anchorageChance(shore, river);
  const r = await new Roll("1d100").evaluate();
  return ChatMessage.implementation.create({ speaker: { alias: i18n("AD2E.Naval.VoyageTitle") }, whisper: gmWhisper(), rolls: [r],
    content: `<p>${esc(i18n(r.total <= chance ? "AD2E.GvSailing.AnchorageFound" : "AD2E.GvSailing.AnchorageNone",
      { shore: i18n(`AD2E.GvSailing.Shore.${shore}`), roll: r.total, chance }))}</p>` });
}

/**
 * A failed seaworthiness check under these rules (ships.mjs rollSeaworthiness): the update and lines it adds, or null when
 * the Of Ships and the Sea outcome applies. Gale/storm: damage, then sinking. Groundings: on the reef, the first hole
 * check at once, high tide in 2d12 hours.
 */
export async function gvFailure(actor, situation, { rating, penalty = 0 }) {
  const s = actor.system;
  const now = game.time?.worldTime ?? 0;
  if (["gale", "storm"].includes(situation)) {
    if (!s.gv?.stormDamaged) return { update: { "system.gv.stormDamaged": true }, lines: [i18n("AD2E.GvSailing.StormDamage")], rolls: [] };
    return { update: { "system.sunk": true, "system.founderAt": null }, lines: [i18n("AD2E.GvSailing.StormSinks")], rolls: [] };
  }
  if (["groundSoft", "groundRocky", "shoals"].includes(situation)) {
    const tide = await new Roll(GV.reef.highTide).evaluate();
    const hole = await new Roll("1d20").evaluate();
    const fail = hole.total > rating + penalty;
    const step = reefCheck({ holes: s.gv?.holes ?? 0, bailers: s.gv?.bailers ?? 0, fail });
    const lines = [i18n("AD2E.GvSailing.OnReef", { hours: tide.total }),
      i18n(fail ? "AD2E.GvSailing.Holed" : "AD2E.GvSailing.NotHoled", { roll: hole.total, target: rating + penalty, holes: step.holes })];
    if (flooding(step.holes, s.gv?.bailers)) lines.push(i18n("AD2E.GvSailing.Flooding", { need: step.holes * GV.reef.bailersPerHole }));
    return { update: { "system.aground": "reef", "system.gv.holes": step.holes, "system.gv.refloatAt": now + tide.total * 3600,
      "system.gv.nextCheck": now + GV.reef.checkHours * 3600 }, lines, rolls: [tide, hole] };
  }
  return null;
}

/** Hourly reef checks and high tide (updateWorldTime, active GM). */
export async function processReefs() {
  if (!gvSailingOn() || !game.user?.isActiveGM) return;
  const now = game.time?.worldTime ?? 0;
  for (const ship of (game.actors ?? []).filter(a => a.type === "ship" && a.system.aground === "reef" && !a.system.sunk)) {
    const g = ship.system.gv ?? {};
    let holes = g.holes ?? 0;
    let next = g.nextCheck ?? now;
    const lines = [];
    let sunk = false;
    let guard = 0;
    while (next <= now && (g.refloatAt === null || next < g.refloatAt) && !sunk && guard++ < 48) {
      const r = await new Roll("1d20").evaluate();
      const rating = ship.system.seaworthinessIn?.("shoals") ?? ship.system.seaworthinessNow;
      const step = reefCheck({ holes, bailers: g.bailers ?? 0, fail: r.total > rating });
      if (step.brokeUp) { sunk = true; lines.push(i18n("AD2E.GvSailing.BreaksUp")); break; }
      if (step.holes > holes) lines.push(i18n("AD2E.GvSailing.Holed", { roll: r.total, target: rating, holes: step.holes }));
      holes = step.holes;
      next += GV.reef.checkHours * 3600;
    }
    const update = { "system.gv.holes": holes, "system.gv.nextCheck": next };
    if (sunk) Object.assign(update, { "system.sunk": true });
    else if (g.refloatAt !== null && g.refloatAt !== undefined && now >= g.refloatAt) {
      Object.assign(update, { "system.aground": "", "system.gv.refloatAt": null, "system.gv.nextCheck": null });
      lines.push(i18n("AD2E.GvSailing.HighTide"));
    }
    if (!lines.length && update["system.gv.nextCheck"] === g.nextCheck) continue;
    await ship.update(update);
    if (lines.length) await ChatMessage.implementation.create({ speaker: ChatMessage.getSpeaker({ actor: ship }), whisper: gmWhisper(),
      content: `<p><strong>${esc(ship.name)}</strong></p>${lines.map(l => `<p>${esc(l)}</p>`).join("")}` });
  }
}

/** World setting and the hourly reef hook. Called in init. */
export function registerGvSailing() {
  game.settings.register("ad2e", "gvSailing", { name: "AD2E.GvSailing.Setting", hint: "AD2E.GvSailing.SettingHint", scope: "world", config: true,
    type: Boolean, default: false });
  Hooks.on("updateWorldTime", () => { processReefs().catch(err => console.error("AD2E | reef checks", err)); });
}
