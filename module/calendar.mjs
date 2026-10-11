import { CALENDAR_TABLES as CT } from "./rules/calendar-tables.mjs";

/**
 * Zakharan (Al-Qadim) calendar (owner's request, 1.0.43; world setting `zakharanCalendar`, off by default, requires a
 * reload): twelve 30-day months and the five High Holy Days (Ahad, Atnen, Salas, Arba, Yasad) between Qawafil and Safa,
 * 365 days (module/rules/calendar-tables.mjs, tools/build-calendar-tables.py). When on, it becomes Foundry's world
 * calendar (`CONFIG.time.worldCalendarConfig`, as dnd5e's calendar setting), the High Holy Days a 5-day month.
 * Implementation choices (not in the sources): no leap day; years counted from 0 (the GM sets the year in the calendar
 * window); a ten-day cycle of numbered weekdays (Foundry needs weekdays; the sources name none); 24-hour days.
 */
export const DAY = 86400;
export const YEAR_DAYS = CT.daysPerYear;
export const MONTHS = CT.months;
export const HOLY_DAYS = CT.holy.days;
const HOLY_AT = MONTHS.findIndex(m => m.name === CT.holy.after) + 1;

/** Periods of the year in order: the months with the High Holy Days after Qawafil. */
export const PERIODS = [...MONTHS.slice(0, HOLY_AT).map(m => ({ key: m.key, days: m.days })), { key: "holy", days: HOLY_DAYS.length },
  ...MONTHS.slice(HOLY_AT).map(m => ({ key: m.key, days: m.days }))];

/** A day of the year (0-based) as { period, day (1-based), holy (High Holy Day index or null), holidays } (pure). */
export function dayParts(dayOfYear) {
  let d = ((Math.floor(dayOfYear) % YEAR_DAYS) + YEAR_DAYS) % YEAR_DAYS;
  for (const p of PERIODS) {
    if (d < p.days) {
      const day = d + 1;
      const holidays = CT.holidays.filter(h => (h.month === "holy" ? p.key === "holy" : h.month.toLowerCase() === p.key) && h.day === day).map(h => h.key);
      return { period: p.key, day, holy: p.key === "holy" ? d : null, holidays };
    }
    d -= p.days;
  }
  return null;
}

/** The day of the year (0-based) of a period key and 1-based day (pure; null when out of range). */
export function dayOfYear(period, day) {
  let n = 0;
  for (const p of PERIODS) {
    if (p.key === period) return day >= 1 && day <= p.days ? n + day - 1 : null;
    n += p.days;
  }
  return null;
}

/** A world time as { year, dayOfYear, seconds (into the day) } (pure). */
export function fromTime(t) {
  const s = Math.floor(Number(t) || 0);
  const yearLength = YEAR_DAYS * DAY;
  const year = Math.floor(s / yearLength);
  const rest = s - year * yearLength;
  return { year, dayOfYear: Math.floor(rest / DAY), seconds: rest % DAY };
}

/** A world time from a year, day of the year and seconds into the day (pure). */
export const toTime = (year, day, seconds = 0) => (year * YEAR_DAYS + day) * DAY + seconds;

/** The constellations fully visible in a period (Astrologer kit table; none listed for the High Holy Days). */
export const constellations = period => MONTHS.find(m => m.key === period)?.constellations ?? [];

/** A world time as a Zakharan date: "10 Taraq, year 1367 (Founder's Day)" (pure with `i18n`). */
export function formatDate(t, i18n) {
  const { year, dayOfYear: d } = fromTime(t);
  const p = dayParts(d);
  const name = p.holy !== null ? i18n("AD2E.Calendar.HolyDay", { day: HOLY_DAYS[p.holy] })
    : i18n("AD2E.Calendar.MonthDay", { day: p.day, month: MONTHS.find(m => m.key === p.period).name });
  const holidays = p.holidays.map(k => i18n(`AD2E.Calendar.Holiday.${k}`));
  return i18n("AD2E.Calendar.Date", { date: name, year }) + (holidays.length ? ` (${holidays.join(", ")})` : "");
}

/** Foundry calendar configuration (CalendarConfig; names are lang keys, as dnd5e's calendars, because translations are not
 * loaded at init). The High Holy Days are a 5-day month with Safa's ordinal, as dnd5e's Greyhawk festivals (no intercalary
 * flag). Seasons: core 14.368 needs them ("this.seasons is null" in CalendarData#timeToComponents, owner's console log
 * 1.0.43, although the API docs type the field nullable); the sources name none, so one season spans the year. */
export function calendarConfig() {
  let ordinal = 0;
  return {
    name: "AD2E.Calendar.Name", description: "AD2E.Calendar.Description",
    years: { yearZero: 0, firstWeekday: 0 },
    months: { values: PERIODS.map(p => (p.key === "holy"
      ? { name: "AD2E.Calendar.HolyDays", abbreviation: "AD2E.Calendar.HolyDays", ordinal: ordinal + 1, days: p.days }
      : { name: MONTHS.find(m => m.key === p.key).name, abbreviation: MONTHS.find(m => m.key === p.key).name.slice(0, 3), ordinal: ++ordinal, days: p.days })) },
    days: { values: Array.from({ length: 10 }, (_, i) => ({ name: `AD2E.Calendar.Weekday.${i + 1}`, ordinal: i + 1 })),
      daysPerYear: YEAR_DAYS, hoursPerDay: 24, minutesPerHour: 60, secondsPerMinute: 60 },
    seasons: { values: [{ name: "AD2E.Calendar.Season", dayStart: 0, dayEnd: YEAR_DAYS - 1 }] }
  };
}

export function zakharanOn() {
  try { return !!game.settings.get("ad2e", "zakharanCalendar"); } catch { return false; }
}

const i18nNow = (k, d) => (d ? game.i18n.format(k, d) : game.i18n.localize(k));

/** The current (or given) world time as a Zakharan date, or null when the calendar is off. */
export const zakharanDate = (t = game.time?.worldTime ?? 0) => (zakharanOn() ? formatDate(t, i18nNow) : null);

/** GM: set the date (year, period, day), keeping the time of day. */
export async function setDate(year, period, day) {
  const d = dayOfYear(period, day);
  if (d === null || !Number.isInteger(year) || year < 0) return false;
  const now = game.time.worldTime;
  const target = toTime(year, d, fromTime(now).seconds);
  await game.time.advance(target - now);
  return true;
}

/** The error core raises for a calendar configuration, or null (builds it with `Cls` and decomposes a few times, among them
 * a High Holy Day and the year's last second). */
export function calendarProblem(config, Cls) {
  if (!Cls) return null;
  try {
    const calendar = new Cls(foundry.utils?.deepClone ? foundry.utils.deepClone(config) : structuredClone(config));
    for (const t of [0, toTime(0, 182, 3600), toTime(1367, YEAR_DAYS - 1, DAY - 1)]) calendar.timeToComponents(t);
    return null;
  } catch (err) {
    return err;
  }
}

/** World setting and, when on, the world calendar (called in init, before the world calendar is built). */
export function registerCalendar() {
  game.settings.register("ad2e", "zakharanCalendar", {
    name: "AD2E.Calendar.Setting", hint: "AD2E.Calendar.SettingHint", scope: "world", config: true, type: Boolean,
    default: false, requiresReload: true
  });
  if (!zakharanOn()) return false;
  const config = calendarConfig();
  // Build and use the calendar once here: if core rejects it, keep the core calendar so the world still loads.
  const problem = calendarProblem(config, CONFIG.time.worldCalendarClass ?? foundry.data?.CalendarData);
  if (problem) {
    console.error("AD2E | Zakharan calendar not applied:", problem);
    Hooks.once("ready", () => { if (game.user?.isGM) ui.notifications.error(game.i18n.format("AD2E.Calendar.Failed", { error: String(problem.message ?? problem) })); });
    return false;
  }
  CONFIG.time.worldCalendarConfig = config;
  CONFIG.time.formatters ??= {};
  CONFIG.time.formatters.ad2eZakharan = (calendar, components) =>
    formatDate(toTime(components.year - (calendar.years?.yearZero ?? 0), components.day, components.hour * 3600 + components.minute * 60 + components.second), i18nNow);
  return true;
}
