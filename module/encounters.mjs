import { ad2eDialog } from "./dialogs.mjs";
import { ENCOUNTER_CHECKS } from "./rules/encounter-check-tables.mjs";

/**
 * Random encounters (DMG Chapter 11; module/rules/encounter-check-tables.mjs from tools/build-encounter-check-tables.py).
 * Owner's rulings: encounter tables are Foundry RollTables, built by the GM's encounter table builder
 * (module/apps/encounter-tools.mjs) in the DMG's 2-20 (Table 54) or percentile layout, or made by hand; checks come
 * from the GM's button, the travel card's "End day" and, when switched on, from world time passing; a found encounter
 * rolls the table and the number appearing, and its card offers Table 58 distance, surprise and reaction; everything is
 * whispered to the GM.
 * Implementation choices: the area (world setting `encounterArea`) is one record { kind wilderness | dungeon, terrain
 * (Table 56), population, dangerous (dungeon checks each turn), extra, table (RollTable UUID), auto }; time checks run
 * at the start hour of each marked Table 56 slot (7, 11, 15, 19, 23, 3) or every hour / turn in a dungeon, stop at the
 * first encounter, skip a running combat and roll at most 48 checks per time change; the 2-20 layout repeats creatures
 * when a frequency has fewer than its positions, puts two creatures (50% each) on a position when it has more (up to
 * twice the positions; the rest are left out and listed), and fills a frequency without creatures from the nearest one
 * that has some; the percentile layout scales the frequencies present to 100 and rounds by largest remainder (at least
 * 1% each); a creature's frequency comes from its stat block ("Unique" is left out); with a table level, each level of
 * difference lowers the frequency one step and a creature below very rare is left out.
 */
export const EC = ENCOUNTER_CHECKS;
export const FREQUENCIES = ["common", "uncommon", "rare", "veryRare"];
export const AREA_KINDS = ["wilderness", "dungeon"];
export const POPULATIONS = Object.keys(EC.population);
export const MAX_CHECKS = 48;

const i18n = (k, d) => (d ? game.i18n.format(k, d) : game.i18n.localize(k));
const esc = v => foundry.utils.escapeHTML?.(String(v ?? "")) ?? String(v ?? "");

/** The default area record. */
export const DEFAULT_AREA = { kind: "wilderness", terrain: "plain", population: "wild", dangerous: false, extra: 0, table: "", auto: false };

/** Encounter chance on 1d10 (pure): Table 56 + population, or 1 in a dungeon; plus the GM's extra. */
export function encounterChance(area = DEFAULT_AREA) {
  const a = { ...DEFAULT_AREA, ...area };
  const base = a.kind === "dungeon" ? EC.dungeon.chance
    : (EC.terrain.find(t => t.key === a.terrain)?.chance ?? 0) + (EC.population[a.population] ?? 0);
  return Math.max(base + (Number(a.extra) || 0), 0);
}

/** "the number or less that must be rolled on 1d10" (pure). */
export function encounterOccurs(roll, chance) {
  return roll <= chance;
}

/**
 * World times of the checks due after `from` up to `to` (pure; `hourOf(t)` gives the hour of the day): Table 56 slot
 * start hours outdoors, every hour (or turn) in a dungeon.
 */
export function dueChecks(from, to, area = DEFAULT_AREA, hourOf = t => Math.floor(t / 3600) % 24) {
  const a = { ...DEFAULT_AREA, ...area };
  const out = [];
  if (!(to > from)) return out;
  if (a.kind === "dungeon") {
    const step = a.dangerous ? EC.dungeon.turn : EC.dungeon.hour;
    for (let t = Math.floor(from / step) * step + step; t <= to && out.length < MAX_CHECKS; t += step) out.push(t);
    return out;
  }
  const slots = EC.terrain.find(x => x.key === a.terrain)?.slots ?? [];
  for (let t = Math.floor(from / 3600) * 3600 + 3600; t <= to && out.length < MAX_CHECKS; t += 3600) {
    if (slots.includes(((hourOf(t) % 24) + 24) % 24)) out.push(t);
  }
  return out;
}

/** A stat block's frequency text -> key, "unique", or null (pure). */
export function frequencyOf(text) {
  const t = String(text ?? "").toLowerCase();
  if (/unique/.test(t)) return "unique";
  if (/very\s*rare/.test(t)) return "veryRare";
  if (/uncommon/.test(t)) return "uncommon";
  if (/rare/.test(t)) return "rare";
  if (/common/.test(t)) return "common";
  return null;
}

/** Table 55: dungeon level of a creature's XP value (pure). */
export function creatureLevel(xp) {
  let level = 1;
  for (const row of EC.levels) if ((Number(xp) || 0) >= row.min) level = row.level;
  return level;
}

/** Frequency lowered one step per level of difference from the table's level (pure); null = left out. */
export function adjustedFrequency(freq, creatureLvl, tableLvl) {
  if (!tableLvl || !creatureLvl) return freq;
  const i = FREQUENCIES.indexOf(freq) + Math.abs(creatureLvl - tableLvl);
  return FREQUENCIES[i] ?? null;
}

/** Group entries [{ frequency, ... }] by frequency (pure). */
function groups(entries) {
  return Object.fromEntries(FREQUENCIES.map(f => [f, entries.filter(e => e.frequency === f)]));
}

/** The nearest frequency with entries (pure): itself, then the more common ones, then the rarer. */
function nearest(g, f) {
  const i = FREQUENCIES.indexOf(f);
  const order = [f, ...FREQUENCIES.slice(0, i).reverse(), ...FREQUENCIES.slice(i + 1)];
  return order.find(k => g[k]?.length) ?? null;
}

/**
 * The 2-20 table (Table 54): [{ range: [n, n], entries: [one or two entries] }] and the entries left out (pure).
 */
export function twoTwentyLayout(entries) {
  const g = groups(entries);
  const pos = EC.twoTwenty.positions;
  const choice = g.veryRare.length ? "veryRare" : "rare";
  const byFreq = Object.fromEntries(FREQUENCIES.map(f => [f, Object.keys(pos).map(Number).filter(n => (pos[n] === "veryRareOrRare" ? choice : pos[n]) === f).sort((a, b) => a - b)]));
  const rows = [];
  const dropped = [];
  for (const f of FREQUENCIES) {
    const slots = byFreq[f];
    if (!slots.length) continue;
    const from = nearest(g, f);
    if (!from) continue;
    const list = from === f ? g[f] : g[from];
    const own = from === f;
    slots.forEach((n, i) => {
      const picks = [];
      if (!own || list.length <= slots.length) picks.push(list[i % list.length]);
      else {
        picks.push(list[i]);
        if (list[i + slots.length]) picks.push(list[i + slots.length]);
      }
      rows.push({ range: [n, n], entries: picks });
    });
    if (own && list.length > slots.length * 2) dropped.push(...list.slice(slots.length * 2));
  }
  rows.sort((a, b) => a.range[0] - b.range[0]);
  return { formula: EC.twoTwenty.formula, rows, dropped };
}

/** The percentile table: [{ range: [lo, hi], entries: [entry] }] summing to 100 (pure). */
export function percentileLayout(entries) {
  const g = groups(entries);
  const present = FREQUENCIES.filter(f => g[f].length);
  const total = present.reduce((n, f) => n + EC.frequencies[f], 0);
  if (!total) return { formula: EC.percentile.formula, rows: [], dropped: [] };
  const items = present.flatMap(f => g[f].map(e => ({ e, share: (EC.frequencies[f] / total) * 100 / g[f].length })));
  for (const it of items) it.pct = Math.max(Math.floor(it.share), 1);
  let left = 100 - items.reduce((n, it) => n + it.pct, 0);
  const order = [...items].sort((a, b) => (b.share - Math.floor(b.share)) - (a.share - Math.floor(a.share)));
  for (let i = 0; left > 0; i = (i + 1) % order.length, left--) order[i].pct++;
  for (let i = 0; left < 0; i = (i + 1) % order.length) if (order[order.length - 1 - i].pct > 1) { order[order.length - 1 - i].pct--; left++; }
  let lo = 1;
  const rows = items.map(it => { const r = { range: [lo, lo + it.pct - 1], entries: [it.e] }; lo += it.pct; return r; });
  return { formula: EC.percentile.formula, rows, dropped: [] };
}

/** RollTable results data for a layout (pure): one result per entry; two entries share a range (50% each). */
export function tableResults(layout) {
  return layout.rows.flatMap(r => r.entries.map(e => (e.uuid
    ? { type: "document", documentUuid: e.uuid, name: e.name, img: e.img ?? null, range: [...r.range], weight: 1 }
    : { type: "text", name: e.name, description: e.name, range: [...r.range], weight: 1 })));
}

/** A dice formula for a "No. appearing" text (pure): "2d4" kept, "2-12" -> "2d6", "1" -> "1"; null when none. */
export function appearingFormula(text) {
  const t = String(text ?? "").trim().split(/\s*(?:,|\bor\b|\()/)[0].trim();
  if (/^\d+d\d+([+-]\d+)?$/i.test(t)) return t.toLowerCase();
  const m = t.match(/^(\d+)\s*[-–]\s*(\d+)$/);
  if (m) {
    const lo = Number(m[1]), hi = Number(m[2]);
    if (lo === hi) return String(lo);
    if (lo === 1) return `1d${hi}`;
    if (hi % lo === 0) return `${lo}d${hi / lo}`;
    return `1d${hi - lo + 1}+${lo - 1}`;
  }
  return /^\d+$/.test(t) ? t : null;
}

/** Table 58 key (pure): surprise "both" | "one" | "none", then fog, night/dungeon, or the terrain's cover. */
export function distanceKey({ surprise = "none", terrain = "plain", fog = false, night = false, dungeon = false } = {}) {
  if (surprise === "both" || surprise === "one") return surprise;
  if (fog) return "fog";
  if (night || dungeon) return "night";
  return { forest: "lightForest", jungle: "jungle", swamp: "scrub", scrub: "scrub", hills: "scrub", mountains: "scrub" }[terrain] ?? "grassland";
}

/**
 * Table 74 terrain (module/travel.mjs) -> Table 56 terrain for a travel day's checks (implementation choice; the DMG:
 * "the DM can use a comparable entry from the table").
 */
export const TRAVEL_TERRAIN = { barren: "desert", clear: "plain", desertRocky: "desert", desertSand: "desert", forestHeavy: "forest",
  forestLight: "forest", forestMedium: "forest", glacier: "arctic", hillsRolling: "hills", hillsSteep: "hills", jungleHeavy: "jungle",
  jungleMedium: "jungle", marsh: "swamp", moor: "hills", mountainsHigh: "mountains", mountainsLow: "mountains",
  mountainsMedium: "mountains", plains: "plain", scrub: "scrub", tundra: "arctic" };

/**
 * GM: a travel day ends (module/travel.mjs "End day"): the area becomes the day's Table 56 terrain (returned); with
 * automatic checks off, `travelDayRoll` then rolls the checks due in the travel hours (with them on, the time hook does).
 */
export async function travelDayChecks(terrain56) {
  if (!game.user?.isGM || !terrain56) return false;
  const area = { ...currentArea(), kind: "wilderness", terrain: terrain56 };
  await game.settings.set("ad2e", "encounterArea", area);
  return area;
}

/** Roll the checks of a travel day when the automatic checks are off. */
export async function travelDayRoll(area, from, to) {
  if (area.auto) return false;
  const times = dueChecks(from, to, area, hourOf);
  return times.length ? encounterCheck(area, { times, reason: i18n("AD2E.Encounter.TravelReason") }) : false;
}

/** The world's encounter area. */
export function currentArea() {
  try { return { ...DEFAULT_AREA, ...(game.settings.get("ad2e", "encounterArea") ?? {}) }; } catch { return { ...DEFAULT_AREA }; }
}

/** Hour of the day of a world time (the calendar's when it has one). */
export function hourOf(t) {
  const c = game.time?.calendar?.timeToComponents?.(t);
  return Number.isFinite(c?.hour) ? c.hour : Math.floor(t / 3600) % 24;
}

const gmWhisper = () => ChatMessage.getWhisperRecipients?.("GM")?.map(u => u.id) ?? [];

/** Roll the area's table: { result (TableResult), actor, number, roll, numberRoll } or null when no table. */
export async function rollEncounterTable(area) {
  const table = area.table ? await fromUuid(area.table) : null;
  if (!table) return null;
  const roll = await new Roll(table.formula || "1d100").evaluate();
  const results = table.getResultsForRoll(roll.total);
  const result = results.length ? results[Math.floor(Math.random() * results.length)] : null;
  const actor = result?.documentUuid ? await fromUuid(result.documentUuid) : null;
  const formula = actor?.type === "monster" ? appearingFormula(actor.system.numberAppearing) : null;
  const numberRoll = formula ? await new Roll(formula).evaluate() : null;
  return { table, result, actor, roll, numberRoll, number: numberRoll?.total ?? null, two: results.length > 1 };
}

/**
 * GM: make one encounter check (or several at `times`) for the area; posts the GM card. `force` = an encounter without
 * a roll (the GM declares one). Returns true when an encounter occurred.
 */
export async function encounterCheck(area = currentArea(), { times = [null], force = false, reason = "" } = {}) {
  if (!game.user?.isGM) return false;
  const chance = encounterChance(area);
  const rolls = [];
  let found = null;
  for (const t of times) {
    const roll = force ? null : await new Roll(EC.die).evaluate();
    if (roll) rolls.push(roll);
    if (force || encounterOccurs(roll.total, chance)) { found = { t, roll }; break; }
  }
  const where = area.kind === "dungeon" ? i18n(area.dangerous ? "AD2E.Encounter.DungeonTurn" : "AD2E.Encounter.DungeonHour")
    : `${EC.terrain.find(x => x.key === area.terrain)?.label ?? area.terrain}, ${i18n(`AD2E.Encounter.Population.${area.population}`)}`;
  const head = `<p><strong>${esc(i18n("AD2E.Encounter.CheckTitle"))}</strong> ${esc(where)} (${esc(i18n("AD2E.Encounter.ChanceShort", { chance }))})`
    + `${reason ? ` · ${esc(reason)}` : ""}</p>`;
  const rollText = rolls.length ? `<p class="ad2e-note">${esc(i18n("AD2E.Encounter.Rolls", { rolls: rolls.map(r => r.total).join(", ") }))}</p>` : "";
  if (!found) {
    await ChatMessage.create({ whisper: gmWhisper(), rolls, content: head + rollText + `<p>${esc(i18n("AD2E.Encounter.None", { n: times.length }))}</p>` });
    return false;
  }
  const drawn = await rollEncounterTable(area);
  if (drawn?.roll) rolls.push(drawn.roll);
  if (drawn?.numberRoll) rolls.push(drawn.numberRoll);
  const what = drawn?.result
    ? (drawn.result.documentUuid ? `@UUID[${drawn.result.documentUuid}]{${drawn.result.name || drawn.actor?.name || "?"}}` : esc(drawn.result.name || drawn.result.description || ""))
    : esc(i18n(drawn ? "AD2E.Encounter.NoResult" : "AD2E.Encounter.NoTable"));
  const number = drawn?.number !== null && drawn?.number !== undefined ? ` × ${drawn.number}`
    : (drawn?.actor?.system?.numberAppearing ? ` (${esc(i18n("AD2E.Encounter.Appearing", { text: drawn.actor.system.numberAppearing }))})` : "");
  const when = found.t !== null ? ` <span class="ad2e-note">${esc(i18n("AD2E.Encounter.At", { hour: String(hourOf(found.t)).padStart(2, "0") }))}</span>` : "";
  const content = head + rollText + `<p><strong>${esc(i18n("AD2E.Encounter.Found"))}</strong>${when}: ${what}${number}`
    + `${drawn?.roll ? ` <span class="ad2e-note">(${esc(drawn.table.name)} ${drawn.roll.total}${drawn.two ? `, ${esc(i18n("AD2E.Encounter.TwoOnRoll"))}` : ""})</span>` : ""}</p>`;
  await ChatMessage.create({ whisper: gmWhisper(), rolls, content,
    flags: { ad2e: { encounter: { actor: drawn?.actor?.uuid ?? null, number: drawn?.number ?? null, terrain: area.terrain, dungeon: area.kind === "dungeon",
      at: found.t } } } });
  return true;
}

/** GM card buttons: distance (Table 58), surprise for the creature and the selected tokens, reaction. */
export function encounterButtons(message, html) {
  const e = message?.getFlag?.("ad2e", "encounter");
  if (!e || !game.user?.isGM || !html?.querySelector) return;
  const box = document.createElement("div");
  box.className = "ad2e-damage-buttons";
  const btn = (key, icon) => `<button type="button" data-enc="${key}"><i class="fa-solid ${icon}"></i> ${esc(i18n(`AD2E.Encounter.Button.${key}`))}</button>`;
  box.innerHTML = btn("distance", "fa-ruler") + (e.actor ? btn("surpriseCreature", "fa-eye") : "") + btn("surpriseParty", "fa-users") + btn("reaction", "fa-comments");
  for (const b of box.querySelectorAll("button")) b.addEventListener("click", async ev => {
    ev.preventDefault();
    ev.stopPropagation();
    const actor = e.actor ? await fromUuid(e.actor) : null;
    const kind = ev.currentTarget.dataset.enc;
    if (kind === "distance") return encounterDistanceDialog(e);
    if (kind === "surpriseCreature") return actor?.rollSurprise?.();
    if (kind === "surpriseParty") {
      const party = (globalThis.canvas?.tokens?.controlled ?? []).map(t => t.actor).filter(Boolean);
      if (!party.length) return ui.notifications.warn(i18n("AD2E.Encounter.SelectParty"));
      for (const a of party) await a.rollSurprise?.();
      return;
    }
    if (kind === "reaction") {
      const { rollEncounterReaction } = await import("./reaction.mjs");
      return rollEncounterReaction(actor);
    }
  });
  (html.querySelector(".message-content") ?? html).append(box);
}

/** Table 58: ask who was surprised (and fog / night), roll the distance in feet for the GM. */
export async function encounterDistanceDialog(e = {}) {
  const input = await ad2eDialog.prompt({
    window: { title: i18n("AD2E.Encounter.DistanceTitle") },
    content: `<div class="form-group"><label>${esc(i18n("AD2E.Encounter.Surprised"))}</label><select name="surprise">`
      + ["none", "one", "both"].map(k => `<option value="${k}">${esc(i18n(`AD2E.Encounter.SurpriseKind.${k}`))}</option>`).join("") + `</select></div>`
      + `<div class="form-group"><label>${esc(i18n("AD2E.Encounter.Terrain"))}</label><select name="terrain">`
      + EC.terrain.map(t => `<option value="${t.key}"${t.key === e.terrain ? " selected" : ""}>${esc(t.label)}</option>`).join("") + `</select></div>`
      + `<label class="ad2e-check"><input type="checkbox" name="fog"> ${esc(i18n("AD2E.Encounter.Fog"))}</label> `
      + `<label class="ad2e-check"><input type="checkbox" name="night"${e.dungeon ? " checked" : ""}> ${esc(i18n("AD2E.Encounter.Night"))}</label>`,
    ok: { label: i18n("AD2E.Roll.Roll"), callback: (event, button) => {
      const f = button.form.elements;
      return { surprise: f.surprise.value, terrain: f.terrain.value, fog: f.fog.checked, night: f.night.checked };
    } },
    rejectClose: false
  });
  if (!input) return null;
  const key = distanceKey(input);
  const formula = EC.distance[key];
  if (!formula) return ChatMessage.create({ whisper: gmWhisper(), content: `<p>${esc(i18n("AD2E.Encounter.LimitOfSight"))}</p>` });
  const roll = await new Roll(formula).evaluate();
  return roll.toMessage({ whisper: gmWhisper(), flavor: esc(i18n("AD2E.Encounter.DistanceFlavor", { key: i18n(`AD2E.Encounter.Distance.${key}`) })) });
}

export function registerEncounters() {
  game.settings.register("ad2e", "encounterArea", { scope: "world", config: false, type: Object, default: { ...DEFAULT_AREA } });
  // Checks due when world time passes (owner's ruling: optional, the area's "automatic" box), by the active GM.
  Hooks.on("updateWorldTime", async (worldTime, delta) => {
    if (!game.users?.activeGM?.isSelf || !(delta > 0)) return;
    const area = currentArea();
    if (!area.auto || game.combat?.started) return;
    const times = dueChecks(worldTime - delta, worldTime, area, hourOf);
    if (times.length) await encounterCheck(area, { times, reason: i18n("AD2E.Encounter.TimeReason") });
  });
}
