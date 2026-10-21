import { REST_EVERY } from "./dungeon-turns.mjs";

/**
 * Timekeeper (owner's request 1.0.71): one floating window for the date, dungeon turns and overland travel, opened from the
 * Settings sidebar tab, a key binding (Configure Controls; default Shift+T) or game.ad2e.timekeeper(). It stays open
 * across reloads (client setting `timekeeper` { open, compact, tab, left, top }: re-opened on `ready` where it was left).
 * Compact view (the window's minimise, a header double-click, or its own button): the date and time of day, the GM's
 * step buttons (round, turn, hour, day, back and forward) and the dungeon turn line. The full view has three tabs: Calendar
 * (step buttons, set the date), Dungeon (module/dungeon-turns.mjs actions, lit lights) and Travel (today's weather, roll
 * weather, the travel planner and party tracker). Players see the date and the dungeon line; the controls are the GM's.
 * Pure helpers here; the window is module/apps/timekeeper.mjs.
 */

/** Step buttons: a round is one minute (CONFIG.time.roundTime = 60, The Combat Round (PHB)), a turn 10 minutes (Time and
 * Movement (PHB)), an hour, a day. */
export const STEPS = [
  { key: "day", seconds: 86400 },
  { key: "hour", seconds: 3600 },
  { key: "turn", seconds: 600 },
  { key: "round", seconds: 60 }
];

export const TABS = ["calendar", "dungeon", "travel"];
const DEFAULT = { open: false, compact: false, tab: "calendar", left: null, top: null };

/** The stored window state with defaults and checked values (pure). */
export function normalizeState(raw) {
  const s = { ...DEFAULT, ...(raw && typeof raw === "object" ? raw : {}) };
  return {
    open: !!s.open, compact: !!s.compact, tab: TABS.includes(s.tab) ? s.tab : "calendar",
    left: Number.isFinite(s.left) ? Math.round(s.left) : null, top: Number.isFinite(s.top) ? Math.round(s.top) : null
  };
}

/** A stored position kept on screen (pure): { left, top } or {} when none is stored. */
export function onScreen(state, view = { width: 1920, height: 1080 }, size = { width: 300, height: 120 }) {
  if (state.left === null || state.top === null) return {};
  const clamp = (v, max) => Math.min(Math.max(v, 0), Math.max(max, 0));
  return { left: clamp(state.left, view.width - size.width), top: clamp(state.top, view.height - size.height) };
}

/** Step buttons, back (largest first) then forward (smallest first) (pure; `t(key)` for labels). */
export function stepButtons(t) {
  const back = STEPS.map(s => ({ seconds: -s.seconds, label: `−${t(`AD2E.Timekeeper.Step.${s.key}`)}`, title: t(`AD2E.Timekeeper.Back.${s.key}`) }));
  const forward = [...STEPS].reverse().map(s => ({ seconds: s.seconds, label: `+${t(`AD2E.Timekeeper.Step.${s.key}`)}`, title: t(`AD2E.Timekeeper.Forward.${s.key}`) }));
  return { back, forward };
}

/**
 * A date of the core (or any non-Zakharan) world calendar (pure): "3 Hammer, year 1492". `components` = game.time.components
 * (year, month, dayOfMonth 0-based), `calendar` = game.time.calendar (months.values[].name lang keys, years.yearZero), as
 * dnd5e's SetDateDialog reads them.
 */
export function coreDateText(components, calendar, t) {
  if (!components || !calendar) return "";
  const month = calendar.months?.values?.[components.month];
  const year = (components.year ?? 0) + (calendar.years?.yearZero ?? 0);
  return t("AD2E.Calendar.Date", { date: t("AD2E.Calendar.MonthDay", { day: (components.dayOfMonth ?? 0) + 1, month: month ? t(month.name) : String((components.month ?? 0) + 1) }), year });
}

/** "hh:mm" from components (pure). */
export const componentClock = c => `${String(c?.hour ?? 0).padStart(2, "0")}:${String(c?.minute ?? 0).padStart(2, "0")}`;

/** The dungeon turn line (pure): `st` from dungeon-turns.mjs restState. { text, warn } */
export function dungeonLine(st, t) {
  if (!st?.active) return { text: t("AD2E.Timekeeper.NoExpedition"), warn: false };
  const turn = t("AD2E.Timekeeper.Turn", { n: st.turns, since: st.sinceRest, every: REST_EVERY });
  if (st.penalty) return { text: `${turn} · ${t("AD2E.Timekeeper.Fatigue", { n: st.penalty })}`, warn: true };
  if (st.due) return { text: `${turn} · ${t("AD2E.Timekeeper.RestNext")}`, warn: true };
  return { text: `${turn} · ${t("AD2E.Dungeon.RestIn", { n: st.untilRest })}`, warn: false };
}

/** The light that goes out first (pure): rows from lights.mjs litSources, or null. */
export const firstOut = lights => (lights?.length ? lights.reduce((a, b) => (b.turns < a.turns ? b : a)) : null);
