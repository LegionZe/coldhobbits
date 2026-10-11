import { CALENDAR_TABLES as CT } from "../rules/calendar-tables.mjs";
import { constellations, dayParts, fromTime, HOLY_DAYS, MONTHS, PERIODS, seasonOf, seasonStartsIn, setDate, zakharanDate, zakharanOn } from "../calendar.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;
const i18n = (k, d) => (d ? game.i18n.format(k, d) : game.i18n.localize(k));

/**
 * Zakharan calendar window (module/calendar.mjs; Configure Settings, the GM manual, or game.ad2e.calendar()): today's date,
 * holiday and the constellations fully visible this month (Astrologer kit), the year's months and holidays; the GM sets
 * the date (year, month or High Holy Day, day; the time of day is kept).
 */
export default class ZakharanCalendar extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "ad2e-calendar",
    classes: ["ad2e", "zakharan-calendar"],
    window: { title: "AD2E.Calendar.Name", icon: "fa-solid fa-moon", resizable: true },
    position: { width: 480, height: "auto" },
    actions: { setDate: ZakharanCalendar.#onSetDate }
  };

  static PARTS = { main: { template: "systems/ad2e/templates/apps/calendar.hbs" } };

  #hook = null;

  /** Rows of the year: each month (or the High Holy Days) with its holidays (pure apart from `i18n`). */
  static yearRows(current, translate = i18n) {
    return PERIODS.map(p => {
      const holy = p.key === "holy";
      const holidays = CT.holidays.filter(h => (h.month === "holy" ? holy : h.month.toLowerCase() === p.key))
        .map(h => `${holy ? HOLY_DAYS[h.day - 1] : h.day}: ${translate(`AD2E.Calendar.Holiday.${h.key}`)}`);
      return { key: p.key, name: holy ? HOLY_DAYS.join(", ") : MONTHS.find(m => m.key === p.key).name,
        label: holy ? translate("AD2E.Calendar.HolyDays") : "", days: p.days, holidays: holidays.join("; "),
        stars: constellations(p.key).join(", "), current: p.key === current,
        seasons: seasonStartsIn(p.key).map(x => translate("AD2E.Calendar.SeasonStarts", { season: translate(`AD2E.Travel.Season.${x.key}`), day: x.day })).join("; ") };
    });
  }

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const on = zakharanOn();
    const now = fromTime(game.time?.worldTime ?? 0);
    const parts = dayParts(now.dayOfYear);
    return {
      ...context, on, isGM: !!game.user?.isGM, date: zakharanDate(), year: now.year, day: parts.day,
      stars: constellations(parts.period).join(", "), season: i18n(`AD2E.Travel.Season.${seasonOf(now.dayOfYear)}`), rows: ZakharanCalendar.yearRows(parts.period),
      periods: PERIODS.map(p => ({ key: p.key, label: p.key === "holy" ? i18n("AD2E.Calendar.HolyDays") : MONTHS.find(m => m.key === p.key).name,
        selected: p.key === parts.period })),
      urls: CT.urls
    };
  }

  _onFirstRender(context, options) {
    super._onFirstRender?.(context, options);
    this.#hook = Hooks.on("updateWorldTime", () => this.render());
  }

  _onClose(options) {
    super._onClose?.(options);
    if (this.#hook !== null) Hooks.off("updateWorldTime", this.#hook);
    this.#hook = null;
  }

  static async #onSetDate() {
    if (!game.user?.isGM) return;
    const el = this.element;
    const year = Number(el.querySelector("[name=year]")?.value);
    const period = el.querySelector("[name=period]")?.value;
    const day = Number(el.querySelector("[name=day]")?.value);
    if (!(await setDate(year, period, day))) ui.notifications.warn(i18n("AD2E.Calendar.BadDate"));
  }
}
