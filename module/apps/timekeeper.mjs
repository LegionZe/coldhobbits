import { advanceTurn, dungeonState, endExpedition, restState, startExpedition } from "../dungeon-turns.mjs";
import { litSources } from "../lights.mjs";
import { clockText, dayParts, fromTime, MONTHS, PERIODS, setDate, zakharanDate, zakharanOn, zakharanSeason } from "../calendar.mjs";
import { currentWeather, rollDailyWeather, weatherText } from "../travel.mjs";
import { partyActors } from "../party.mjs";
import { componentClock, coreDateText, dungeonLine, firstOut, normalizeState, onScreen, stepButtons, TABS } from "../timekeeper.mjs";
import DungeonTurnTracker from "./dungeon-turns.mjs";
import ZakharanCalendar from "./calendar.mjs";
import TravelPlanner from "./travel-planner.mjs";
import PartyTracker from "./party-tracker.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;
const i18n = (k, d) => (d ? game.i18n.format(k, d) : game.i18n.localize(k));
const SETTING = "timekeeper";

const readState = () => { try { return normalizeState(game.settings.get("ad2e", SETTING)); } catch { return normalizeState(null); } };
const writeState = async patch => { try { await game.settings.set("ad2e", SETTING, { ...readState(), ...patch }); } catch { /* not registered */ } };

/**
 * Timekeeper window (module/timekeeper.mjs): date, step buttons and dungeon turn in a compact view; Calendar, Dungeon and
 * Travel tabs in the full view. Minimising (ApplicationV2#minimize: the header double-click) switches to the compact view
 * instead of collapsing the window to its header, so the date stays visible; maximize() returns to the full view.
 */
export default class Timekeeper extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "ad2e-timekeeper",
    classes: ["ad2e", "ad2e-timekeeper"],
    window: { title: "AD2E.Timekeeper.Title", icon: "fa-solid fa-clock", resizable: false },
    position: { width: 440, height: "auto" },
    actions: {
      step: Timekeeper.#onStep, compact: Timekeeper.#onCompact, tab: Timekeeper.#onTab, setDate: Timekeeper.#onSetDate,
      start: () => startExpedition(), end: () => endExpedition(), next: () => advanceTurn(), rest: () => advanceTurn({ rest: true }),
      rollWeather: Timekeeper.#onRollWeather,
      openDungeon: () => new DungeonTurnTracker().render({ force: true }),
      openCalendar: () => new ZakharanCalendar().render({ force: true }),
      openTravel: () => new TravelPlanner().render({ force: true }),
      openParty: () => new PartyTracker().render({ force: true })
    }
  };

  static PARTS = { main: { template: "systems/ad2e/templates/apps/timekeeper.hbs" } };

  static COMPACT_WIDTH = 300;
  static FULL_WIDTH = 440;

  /** The open window, if any. */
  static instance = null;

  #hooks = [];
  #compact = false;
  #tab = "calendar";
  #saveTimer = null;

  constructor(options = {}) {
    const st = readState();
    const size = { width: st.compact ? Timekeeper.COMPACT_WIDTH : Timekeeper.FULL_WIDTH, height: 160 };
    const pos = onScreen(st, { width: globalThis.innerWidth ?? 1920, height: globalThis.innerHeight ?? 1080 }, size);
    super(foundry.utils.mergeObject({ position: { width: size.width, ...pos } }, options));
    this.#compact = st.compact;
    this.#tab = st.tab;
  }

  /** Open the window (or bring it to the front). */
  static open() {
    const app = Timekeeper.instance?.rendered ? Timekeeper.instance : (Timekeeper.instance = new Timekeeper());
    app.render({ force: true });
    if (app.rendered) app.bringToFront?.();
    return app;
  }

  /** Open or close (the key binding). */
  static toggle() {
    if (Timekeeper.instance?.rendered) return Timekeeper.instance.close();
    return Timekeeper.open();
  }

  get compact() { return this.#compact; }

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const now = game.time?.worldTime ?? 0;
    const isGM = !!game.user?.isGM;
    const zak = zakharanOn();
    const comps = game.time?.components;
    const date = zak ? zakharanDate(now) : coreDateText(comps, game.time?.calendar, i18n);
    const clock = zak ? clockText(now) : componentClock(comps);
    const st = restState(dungeonState(), now);
    const line = dungeonLine(st, i18n);
    const lights = litSources(now);
    const first = firstOut(lights);
    const steps = stepButtons(i18n);
    let season = zakharanSeason(now);
    if (!season) { try { season = game.settings.get("ad2e", "season") || "spring"; } catch { season = "spring"; } }
    const ctx = {
      ...context, isGM, compact: this.#compact, date, clock, steps, dungeon: line, st,
      tabs: TABS.map(k => ({ key: k, label: i18n(`AD2E.Timekeeper.Tab.${k}`), active: k === this.#tab })),
      tab: this.#tab, isCalendar: this.#tab === "calendar", isDungeon: this.#tab === "dungeon", isTravel: this.#tab === "travel",
      lightCount: lights.length,
      firstLight: first ? i18n("AD2E.Timekeeper.FirstOut", { name: first.name, bearer: first.bearer, n: first.turns }) : "",
      zakharan: zak, season: i18n(`AD2E.Travel.Season.${season}`)
    };
    if (this.#compact) return ctx;
    // Set-date fields: the Zakharan periods (High Holy Days included), else the world calendar's months (dnd5e SetDateDialog).
    if (zak) {
      const t = fromTime(now);
      const p = dayParts(t.dayOfYear);
      Object.assign(ctx, { year: t.year, day: p.day, months: PERIODS.map(x => ({ value: x.key, selected: x.key === p.period,
        label: x.key === "holy" ? i18n("AD2E.Calendar.HolyDays") : MONTHS.find(m => m.key === x.key).name })) });
    } else if (comps && game.time?.calendar) {
      const cal = game.time.calendar;
      Object.assign(ctx, { year: comps.year + (cal.years?.yearZero ?? 0), day: comps.dayOfMonth + 1,
        months: (cal.months?.values ?? []).map((m, i) => ({ value: i, label: i18n(m.name), selected: i === comps.month })) });
    }
    ctx.weather = weatherText(currentWeather());
    ctx.partyCount = partyActors().length;
    return ctx;
  }

  _onRender(context, options) {
    super._onRender?.(context, options);
    this.element.classList.toggle("ad2e-timekeeper-compact", this.#compact);
  }

  _onFirstRender(context, options) {
    super._onFirstRender?.(context, options);
    Timekeeper.instance = this;
    writeState({ open: true });
    const rerender = () => { if (this.rendered) this.render(); };
    for (const hook of ["updateWorldTime", "ad2eDungeonTurns", "updateItem"]) this.#hooks.push([hook, Hooks.on(hook, rerender)]);
    // Today's weather and the party list are world settings (module/travel.mjs, module/party.mjs).
    this.#hooks.push(["updateSetting", Hooks.on("updateSetting", s => { if (["ad2e.weather", "ad2e.party", "ad2e.season"].includes(s?.key)) rerender(); })]);
  }

  _onPosition(position) {
    super._onPosition?.(position);
    clearTimeout(this.#saveTimer);
    this.#saveTimer = setTimeout(() => writeState({ left: position.left, top: position.top }), 500);
  }

  _onClose(options) {
    super._onClose?.(options);
    for (const [hook, id] of this.#hooks) Hooks.off(hook, id);
    this.#hooks = [];
    if (Timekeeper.instance === this) Timekeeper.instance = null;
    writeState({ open: false });
  }

  /** The compact view instead of a header-only window; minimising the compact view brings the full view back. */
  async minimize() {
    return this.#setCompact(!this.#compact);
  }

  async maximize() {
    return this.#setCompact(false);
  }

  async #setCompact(compact) {
    this.#compact = compact;
    await writeState({ compact });
    this.setPosition({ width: compact ? Timekeeper.COMPACT_WIDTH : Timekeeper.FULL_WIDTH, height: "auto" });
    return this.render();
  }

  static #onCompact() { return this.#setCompact(!this.#compact); }

  static #onTab(event, target) {
    this.#tab = TABS.includes(target.dataset.tab) ? target.dataset.tab : "calendar";
    writeState({ tab: this.#tab });
    return this.render();
  }

  static async #onStep(event, target) {
    const seconds = Number(target.dataset.seconds);
    if (!game.user?.isGM || !Number.isFinite(seconds) || !seconds) return;
    await game.time.advance(seconds);
  }

  static async #onSetDate() {
    if (!game.user?.isGM) return;
    const el = this.element;
    const year = Number(el.querySelector("[name=year]")?.value);
    const month = el.querySelector("[name=month]")?.value;
    const day = Number(el.querySelector("[name=day]")?.value);
    if (zakharanOn()) {
      if (!(await setDate(year, month, day))) ui.notifications.warn(i18n("AD2E.Calendar.BadDate"));
      return;
    }
    const m = Number(month);
    const days = game.time.calendar?.months?.values?.[m]?.days;
    if (!Number.isInteger(year) || !Number.isInteger(day) || day < 1 || (days && day > days)) {
      ui.notifications.warn(i18n("AD2E.Timekeeper.BadDate"));
      return;
    }
    // As dnd5e's SetDateDialog: year with the calendar's yearZero, month index, 1-based day.
    await game.time.calendar.jumpToDate({ year, month: m, day });
  }

  static #onRollWeather() {
    let season = zakharanSeason();
    if (!season) { try { season = game.settings.get("ad2e", "season") || "spring"; } catch { season = "spring"; } }
    return rollDailyWeather(season);
  }
}

/** Client setting, key binding, sidebar button (module/apps/manual.mjs) and re-opening on ready. Called in init. */
export function registerTimekeeper() {
  game.settings.register("ad2e", SETTING, { scope: "client", config: false, type: Object, default: normalizeState(null) });
  game.keybindings?.register("ad2e", "timekeeper", {
    name: "AD2E.Timekeeper.Key", hint: "AD2E.Timekeeper.KeyHint",
    editable: [{ key: "KeyT", modifiers: ["Shift"] }],
    onDown: () => { Timekeeper.toggle(); return true; }
  });
  Hooks.once("ready", () => { if (readState().open) Timekeeper.open(); });
}
