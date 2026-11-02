import { COURSES, courseFor, currentRate, dailyMiles, DIRECTIONS, encounterChecks, galeDrift, NAVAL, nextWind, phenomenonLabel, visibility,
  WINDS } from "../naval.mjs";
import { rollSeaworthiness } from "../ships.mjs";
import { zakharanSeason } from "../calendar.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;
const i18n = (k, d) => (d ? game.i18n.format(k, d) : game.i18n.localize(k));
const esc = v => foundry.utils.escapeHTML?.(String(v ?? "")) ?? String(v ?? "");
const AREAS = ["inhabited", "uninhabited", "openSea"];
const HEIGHTS = ["deck", "crowsNest", "flying"];

/** World setting "seaWind": the day's wind (module/naval.mjs nextWind). */
export function seaWind() {
  try { return game.settings.get("ad2e", "seaWind") ?? {}; } catch { return {}; }
}

function season() {
  const z = zakharanSeason?.();
  if (z) return z;
  try { return game.settings.get("ad2e", "season") || "spring"; } catch { return "spring"; }
}

async function rollTotal(formula) {
  return (await new Roll(formula).evaluate()).total;
}

/**
 * The day at sea for a ship (pure over the ship's derived data): course relative to the wind, rate, miles, drift and
 * the checks the wind calls for. Movement (OSS): "Sailing ships ... multiply the ship's normal movement rate (including
 * modifiers for wind and weather conditions) by 3"; anchoring "by 2"; rowed ships twice; gales and storms drift and call
 * for seaworthiness checks (storms at -3). Implementation choice: anchoring doubles the wind-adjusted rate.
 */
export function voyageDay(system, wind, state) {
  const course = state.course || courseFor(state.heading, wind.direction);
  const w = wind.wind || "moderate";
  const rate = currentRate(system, { wind: w, course });
  const rowing = system.prop === "oar";
  const miles = dailyMiles(rate.rate, { rowing, anchor: !rowing && state.anchor, push: state.push });
  const drift = rowing ? { forward: miles, drift: 0 } : galeDrift(miles, w, course, { seamanship: state.seamanship });
  const checks = [];
  if (w === "gale") checks.push("gale");
  if (w === "storm") checks.push("storm");
  return { course, wind: w, rate: rate.rate, notes: rate.notes, rowing, miles: drift.forward, drift: drift.drift, checks };
}

/**
 * Sea voyage (GM tool; Configure Settings, the GM manual, or game.ad2e.voyage()): the day's wind (Tables 4/5, kept in
 * the world setting "seaWind"), a ship (actor type "ship"), heading, rowing or sailing, anchoring at night and a pushed day,
 * the miles made good and any gale drift, the seaworthiness checks the wind calls for, encounter checks (Tables 7-10) and
 * Table 6 visibility; "Post the day" writes a card whose "End day" button advances world time a day.
 */
export default class SeaVoyage extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "ad2e-sea-voyage",
    classes: ["ad2e", "sea-voyage"],
    window: { title: "AD2E.Naval.VoyageTitle", icon: "fa-solid fa-sailboat", resizable: true },
    position: { width: 600, height: "auto" },
    actions: { rollWind: SeaVoyage.#onRollWind, check: SeaVoyage.#onCheck, encounters: SeaVoyage.#onEncounters, post: SeaVoyage.#onPost,
      openShip: SeaVoyage.#onOpenShip }
  };

  static PARTS = { main: { template: "systems/ad2e/templates/apps/sea-voyage.hbs" } };

  state = { ship: "", heading: "north", course: "", anchor: false, push: false, seamanship: false, area: "openSea", condition: "clearSky", height: "deck" };

  get ship() {
    return game.actors?.get(this.state.ship) ?? game.actors?.find(a => a.type === "ship") ?? null;
  }

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const ships = (game.actors ?? []).filter(a => a.type === "ship");
    const ship = this.ship;
    const wind = seaWind();
    const day = ship ? voyageDay(ship.system, wind, this.state) : null;
    const vis = ship ? visibility(this.state.condition, { size: ship.system.sizeKey, height: this.state.height }) : null;
    const opt = (list, sel, prefix) => list.map(v => ({ value: v, label: i18n(`${prefix}.${v}`), selected: v === sel }));
    return Object.assign(context, {
      isGM: !!game.user?.isGM, ships: ships.map(a => ({ value: a.id, label: a.name, selected: a.id === ship?.id })), ship, state: this.state,
      wind, windText: wind.wind ? i18n("AD2E.Naval.WindToday", { wind: i18n(`AD2E.Naval.Wind.${wind.wind}`), from: i18n(`AD2E.Naval.Direction.${wind.direction}`),
        days: wind.daysLeft ?? 0, dirDays: wind.directionDays ?? 0 }) : i18n("AD2E.Naval.NoWind"),
      winds: opt(WINDS, wind.wind, "AD2E.Naval.Wind"), directions: opt(DIRECTIONS, wind.direction, "AD2E.Naval.Direction"),
      headings: opt(DIRECTIONS, this.state.heading, "AD2E.Naval.Direction"),
      courses: [{ value: "", label: i18n("AD2E.Naval.CourseAuto"), selected: !this.state.course }, ...opt(COURSES, this.state.course, "AD2E.Naval.Course")],
      areas: opt(AREAS, this.state.area, "AD2E.Naval.Area"),
      conditions: NAVAL.vision.map(v => ({ value: v.key, label: v.label, selected: v.key === this.state.condition })),
      heights: opt(HEIGHTS, this.state.height, "AD2E.Naval.Height"),
      day, dayText: day ? i18n("AD2E.Naval.DayText", { course: i18n(`AD2E.Naval.Course.${day.course}`), rate: day.rate, miles: day.miles }) : "",
      driftText: day?.drift ? i18n("AD2E.Naval.DriftText", { miles: day.drift }) : "",
      notesText: day?.notes?.length ? day.notes.map(n => i18n(`AD2E.Naval.RateNote.${n}`)).join(", ") : "",
      checks: (day?.checks ?? []).map(c => ({ key: c, label: i18n(`AD2E.Naval.Situation.${c}`) })),
      vis
    });
  }

  _onRender(context, options) {
    super._onRender?.(context, options);
    for (const el of this.element.querySelectorAll("[data-voyage]")) {
      el.addEventListener("change", ev => {
        const k = ev.currentTarget.dataset.voyage;
        const v = ev.currentTarget.type === "checkbox" ? ev.currentTarget.checked : ev.currentTarget.value;
        if (k.startsWith("wind.")) return this.#setWind(k.slice(5), v);
        this.state[k] = v;
        this.render();
      });
    }
  }

  async #setWind(key, value) {
    if (!game.user?.isGM) return;
    await game.settings.set("ad2e", "seaWind", { ...seaWind(), [key]: value });
    this.render();
  }

  static async #onRollWind() {
    if (!game.user?.isGM) return;
    const next = await nextWind(seaWind(), season(), rollTotal);
    await game.settings.set("ad2e", "seaWind", next);
    await ChatMessage.implementation.create({ speaker: { alias: i18n("AD2E.Naval.VoyageTitle") }, whisper: game.users.filter(u => u.isGM).map(u => u.id),
      content: `<p>${esc(i18n("AD2E.Naval.WindToday", { wind: i18n(`AD2E.Naval.Wind.${next.wind}`), from: i18n(`AD2E.Naval.Direction.${next.direction}`),
        days: next.daysLeft, dirDays: next.directionDays }))}</p>` });
    this.render();
  }

  static async #onCheck(event, target) {
    const ship = this.ship;
    if (ship) await rollSeaworthiness(ship, { situation: target.dataset.situation });
    this.render();
  }

  static #onOpenShip() {
    return this.ship?.sheet?.render(true);
  }

  static async #onEncounters() {
    if (!game.user?.isGM) return;
    const area = this.state.area;
    const coast = area !== "openSea";
    const rows = await encounterChecks(area, rollTotal);
    const lines = rows.map(r => {
      if (!r.hit) return i18n("AD2E.Naval.CheckNone", { n: r.check, roll: r.roll });
      const phen = r.result?.phenomenon ? ` → ${phenomenonLabel(r.result.phenomenon.label, coast)}` : "";
      return i18n("AD2E.Naval.CheckHit", { n: r.check, roll: r.roll, result: `${r.result?.label ?? "?"}${phen}` });
    });
    await ChatMessage.implementation.create({ speaker: { alias: i18n("AD2E.Naval.VoyageTitle") }, whisper: game.users.filter(u => u.isGM).map(u => u.id),
      content: `<p><strong>${esc(i18n(`AD2E.Naval.Area.${area}`))}</strong></p>${lines.map(l => `<p>${esc(l)}</p>`).join("")}`
        + `<p class="ad2e-note"><a href="${esc(NAVAL.urls.encounters)}" target="_blank" rel="noopener">${esc(i18n("AD2E.Naval.EncounterLink"))}</a></p>` });
  }

  static async #onPost() {
    if (!game.user?.isGM) return;
    const ship = this.ship;
    if (!ship) return;
    const wind = seaWind();
    const day = voyageDay(ship.system, wind, this.state);
    const lines = [i18n("AD2E.Naval.DayText", { course: i18n(`AD2E.Naval.Course.${day.course}`), rate: day.rate, miles: day.miles })];
    if (day.drift) lines.push(i18n("AD2E.Naval.DriftText", { miles: day.drift }));
    if (day.checks.length) lines.push(i18n("AD2E.Naval.ChecksDue"));
    await ChatMessage.implementation.create({ speaker: ChatMessage.getSpeaker({ actor: ship }),
      content: `<p><strong>${esc(ship.name)}</strong> · ${esc(i18n("AD2E.Naval.WindToday", { wind: i18n(`AD2E.Naval.Wind.${day.wind}`),
        from: i18n(`AD2E.Naval.Direction.${wind.direction ?? "north"}`), days: wind.daysLeft ?? 0, dirDays: wind.directionDays ?? 0 }))}</p>`
        + lines.map(l => `<p>${esc(l)}</p>`).join(""),
      flags: { ad2e: { voyage: { hours: 24, ended: false, ship: ship.id } } } });
  }
}

/** "End day" on a voyage card (GM): advances world time a day (24 hours: sailing ships keep going at night). */
export function voyageButtons(message, html) {
  const flag = message?.getFlag?.("ad2e", "voyage");
  if (!flag || !game.user?.isGM || flag.ended || !html?.querySelector) return;
  const box = document.createElement("div");
  box.className = "ad2e-damage-buttons";
  box.innerHTML = `<button type="button"><i class="fa-solid fa-moon"></i> ${esc(i18n("AD2E.Naval.EndDay"))}</button>`;
  box.querySelector("button").addEventListener("click", async ev => {
    ev.preventDefault();
    await message.setFlag("ad2e", "voyage", { ...flag, ended: true });
    await game.time.advance((flag.hours ?? 24) * 3600);
  });
  (html.querySelector(".message-content") ?? html).append(box);
}

/** World setting, settings menu. Called in init. */
export function registerSeaVoyage() {
  game.settings.register("ad2e", "seaWind", { scope: "world", config: false, type: Object, default: {} });
  game.settings.registerMenu("ad2e", "voyage", { name: "AD2E.Naval.VoyageTitle", label: "AD2E.Naval.VoyageOpen", hint: "AD2E.Naval.VoyageHint",
    icon: "fa-solid fa-sailboat", type: SeaVoyage, restricted: true });
}
