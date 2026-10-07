import {
  aerialFactor, boatSpeed, currentWeather, dayOf, dayPoints, forceMarchChecks, isLost, lostChance, marchState, memberRates,
  MODES, planDay, restFromMarch, rollDailyWeather, ROUTES, SEASONS, shipSpeed, TR, weatherLostMods, weatherObstacles, weatherText
} from "../travel.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;
const i18n = (k, d) => (d ? game.i18n.format(k, d) : game.i18n.localize(k));
const WEATHER_OBSTACLES = ["galeWinds", "snow", "blizzard", "rainLight", "rainHeavy", "rainTorrential"];
const esc = v => foundry.utils.escapeHTML?.(String(v ?? "")) ?? String(v ?? "");

/**
 * GM travel planner (module/travel.mjs; Configure Settings, the GM manual, or game.ad2e.travel()): the day's weather,
 * the party (selected tokens; the slowest sets the pace), the travel mode, terrain legs (Table 74 with trails, roads and
 * Table 75 obstacles), boats and ships (Tables 76-78), flying (Table 80), getting lost (Tables 81/82, a blind roll for
 * the GM) and force marching; "Post the day" writes the card whose "End day" button advances world time.
 */
export default class TravelPlanner extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "ad2e-travel-planner",
    classes: ["ad2e", "travel-planner"],
    window: { title: "AD2E.Travel.Title", icon: "fa-solid fa-route", resizable: true },
    position: { width: 640, height: "auto" },
    actions: { rollWeather: TravelPlanner.#onRollWeather, useTokens: TravelPlanner.#onUseTokens, addLeg: TravelPlanner.#onAddLeg,
      removeLeg: TravelPlanner.#onRemoveLeg, post: TravelPlanner.#onPost, rest: TravelPlanner.#onRest }
  };

  static PARTS = { main: { template: "systems/ad2e/templates/apps/travel-planner.hbs" } };

  state = null;

  #initState() {
    const w = currentWeather();
    let season = "spring";
    try { season = game.settings.get("ad2e", "season") || "spring"; } catch { /* default */ }
    const tokens = (globalThis.canvas?.tokens?.controlled ?? []).map(t => t.actor).filter(Boolean);
    const party = tokens.length ? tokens : game.actors.filter(a => a.type === "character" && a.hasPlayerOwner);
    this.state = {
      season, weather: w, mode: "foot", pace: "normal", members: party.map(a => a.uuid), hours: TR.march.hours,
      legs: [TravelPlanner.newLeg(w)],
      boat: { key: TR.boats[0].key, current: 0, downstream: true, sail: false },
      ship: { key: TR.ships[0].key, rowing: false, emergency: false },
      lost: { check: true, surroundings: "level", mods: weatherLostMods(w), variable: 0 }, restDays: 1
    };
  }

  /** A new terrain leg with the weather's Table 75 entries ticked. */
  static newLeg(w) {
    return { terrain: "plains", route: "none", obstacles: weatherObstacles(w), miles: "" };
  }

  /** The day's plan from the state (pure apart from resolving actors). */
  static plan(state, actors) {
    const w = state.weather;
    const mode = state.mode;
    const rates = memberRates(actors, mode);
    const slowest = rates.length ? rates.reduce((a, b) => (b.rate < a.rate ? b : a)) : null;
    const out = { rates, slowest, miles: 0, legs: [], notes: [] };
    if (mode === "boat") {
      const mph = boatSpeed(state.boat.key, state.boat);
      out.miles = Math.round(mph * state.hours * 100) / 100;
      out.speed = mph;
      return out;
    }
    if (mode === "ship") {
      const s = shipSpeed(state.ship.key, w, state.ship);
      out.miles = Math.round(s.mph * state.hours * 100) / 100;
      out.speed = s.mph;
      out.ship = s;
      if (s.becalmed) out.notes.push(i18n("AD2E.Travel.Becalmed"));
      if (s.check) out.notes.push(i18n(s.check === 2 ? "AD2E.Travel.SeaCheckHard" : "AD2E.Travel.SeaCheck", { pct: s.seaworthiness, penalty: TR.seaPenalty }));
      if (s.offCourse) out.notes.push(i18n("AD2E.Travel.OffCourseNote"));
      return out;
    }
    if (!slowest) return out;
    if (mode === "air") {
      const f = aerialFactor(w);
      if (f === null) { out.notes.push(i18n("AD2E.Travel.NoFlight")); return out; }
      const p = planDay(dayPoints(slowest.rate, "mounted"), [{ terrain: "clear", route: "none", obstacles: [] }], { aerial: f });
      Object.assign(out, { miles: p.miles, points: p.points, factor: f });
      return out;
    }
    const pace = mode === "foot" ? state.pace : "normal";
    const p = planDay(dayPoints(slowest.rate, mode, pace), state.legs.map(l => ({ ...l, miles: l.miles === "" ? null : Number(l.miles) })),
      { vehicle: mode === "vehicle" });
    Object.assign(out, { miles: p.miles, points: p.points, used: p.used, legs: p.legs });
    if (p.vehicleBlocked) out.notes.push(i18n("AD2E.Travel.VehicleBlocked"));
    return out;
  }

  #actors() {
    return this.state.members.map(u => (foundry.utils.fromUuidSync ?? globalThis.fromUuidSync)?.(u, { strict: false })).filter(Boolean);
  }

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    if (!this.state) this.#initState();
    const s = this.state;
    const actors = this.#actors();
    const plan = TravelPlanner.plan(s, actors);
    const today = dayOf(game.time?.worldTime);
    const opt = (list, sel, label) => list.map(k => ({ key: k.key ?? k, label: label(k), selected: (k.key ?? k) === sel }));
    const lostPct = lostChance(s.lost.surroundings, s.lost.mods, s.lost.variable);
    return {
      ...context, s, weatherText: weatherText(s.weather),
      seasons: opt(SEASONS, s.season, k => i18n(`AD2E.Travel.Season.${k}`)),
      winds: opt(Object.keys(TR.sailing).filter(k => k !== "adverse"), s.weather?.wind ?? "", k => i18n(`AD2E.Travel.Wind.${k}`)),
      modes: opt(MODES, s.mode, k => i18n(`AD2E.Travel.Mode.${k}`)),
      isFoot: s.mode === "foot", forceSelected: s.pace === "force", isLand: ["foot", "mounted", "vehicle"].includes(s.mode), isBoat: s.mode === "boat", isShip: s.mode === "ship",
      boats: opt(TR.boats, s.boat.key, b => `${b.label} (${b.mph} mph${b.sail ? "*" : ""})`),
      ships: opt(TR.ships, s.ship.key, x => `${x.label} (${x.row !== null ? `${x.sail}/${x.row}` : x.sail} mph, ${x.seaworthiness}%)`),
      members: plan.rates.map(r => {
        const st = marchState(r.actor.system, today);
        return { uuid: r.actor.uuid, name: r.name, rate: r.rate, mount: r.mount, slowest: r === plan.slowest, march: st.days, blocked: st.blocked };
      }),
      legs: s.legs.map((l, i) => ({ index: i, ...l, cost: plan.legs[i]?.cost ?? "—", got: plan.legs[i]?.miles ?? 0, short: plan.legs[i]?.short,
        terrains: opt(TR.terrain, l.terrain, t => `${t.label} (${t.cost})`), routes: opt(ROUTES, l.route, k => i18n(`AD2E.Travel.Route.${k}`)),
        obstacles: TR.obstacles.map(o => ({ key: o.key, label: `${o.label} (${o.mult ? `x${o.mult}` : `+${o.add}`})`, checked: l.obstacles.includes(o.key) })),
        obstacleText: l.obstacles.map(k => TR.obstacles.find(o => o.key === k)?.label).filter(Boolean).join(", ") })),
      plan, lost: { ...s.lost, pct: lostPct, surroundings: opt(TR.lost, s.lost.surroundings, l => `${l.label} (${l.pct}%)`),
        mods: TR.lostMods.filter(m => m.mod !== null).map(m => ({ key: m.key, label: `${m.label} (${m.mod > 0 ? "+" : ""}${m.mod})`, checked: s.lost.mods.includes(m.key) })) },
      urls: TR.urls
    };
  }

  _onRender(context, options) {
    super._onRender?.(context, options);
    for (const input of this.element.querySelectorAll("[data-field]")) input.addEventListener("change", ev => {
      const t = ev.currentTarget;
      const f = t.dataset.field;
      const s = this.state;
      const value = t.type === "checkbox" ? t.checked : (t.type === "number" ? Number(t.value) || 0 : t.value);
      if (f === "leg") {
        const leg = s.legs[Number(t.dataset.index)];
        if (t.dataset.part === "obstacle") {
          const set = new Set(leg.obstacles);
          if (t.checked) set.add(t.dataset.key); else set.delete(t.dataset.key);
          leg.obstacles = [...set];
        } else leg[t.dataset.part] = t.dataset.part === "miles" ? t.value : value;
      } else if (f === "lostMod") {
        const set = new Set(s.lost.mods);
        if (t.checked) set.add(t.dataset.key); else set.delete(t.dataset.key);
        s.lost.mods = [...set];
      } else if (f === "wind" || f === "adverse" || f === "precipitation") {
        s.weather = { ...(s.weather ?? { season: s.season }), [f]: value, season: s.season };
        if (f === "precipitation") s.weather.kind = value ? (s.season === "winter" ? "snow" : "rain") : "";
        if (game.user?.isGM) game.settings.set("ad2e", "weather", s.weather);
      } else if (f === "season") {
        s.season = value;
        if (game.user?.isGM) game.settings.set("ad2e", "season", value);
      } else foundry.utils.setProperty(s, f, value);
      this.render();
    });
  }

  static async #onRollWeather() {
    const w = await rollDailyWeather(this.state.season);
    if (!w) return;
    this.state.weather = w;
    // Replace the weather's Table 75 entries on every leg; other obstacles stay.
    for (const leg of this.state.legs) leg.obstacles = [...new Set([...leg.obstacles.filter(k => !WEATHER_OBSTACLES.includes(k)), ...weatherObstacles(w)])];
    this.state.lost.mods = [...new Set([...this.state.lost.mods.filter(k => k !== "raining"), ...weatherLostMods(w)])];
    this.render();
  }

  static #onUseTokens() {
    const actors = (globalThis.canvas?.tokens?.controlled ?? []).map(t => t.actor).filter(Boolean);
    if (!actors.length) return ui.notifications.warn(i18n("AD2E.Travel.SelectTokens"));
    this.state.members = [...new Set(actors.map(a => a.uuid))];
    this.render();
  }

  static #onAddLeg() {
    this.state.legs.push(TravelPlanner.newLeg(this.state.weather));
    this.render();
  }

  static #onRemoveLeg(event, target) {
    if (this.state.legs.length > 1) this.state.legs.splice(Number(target.dataset.index), 1);
    this.render();
  }

  static async #onRest() {
    const n = await restFromMarch(this.#actors(), this.state.restDays);
    ui.notifications.info(i18n("AD2E.Travel.Rested", { n, days: this.state.restDays }));
    this.render();
  }

  static async #onPost() {
    const s = this.state;
    const actors = this.#actors();
    const plan = TravelPlanner.plan(s, actors);
    const lines = [];
    lines.push(`${i18n("AD2E.Travel.Weather")}: ${weatherText(s.weather)}`);
    if (plan.slowest && !["boat", "ship"].includes(s.mode)) lines.push(i18n("AD2E.Travel.PaceLine", { name: plan.slowest.name, rate: plan.slowest.rate, points: plan.points ?? 0 }));
    if (s.mode === "boat" || s.mode === "ship") lines.push(i18n("AD2E.Travel.SpeedLine", { mph: plan.speed, hours: s.hours }));
    plan.legs.forEach((l, i) => {
      const leg = s.legs[i];
      const t = TR.terrain.find(x => x.key === leg.terrain);
      lines.push(i18n("AD2E.Travel.LegLine", { terrain: t?.label ?? leg.terrain, route: i18n(`AD2E.Travel.Route.${leg.route}`), cost: l.cost, miles: l.miles })
        + (leg.obstacles.length ? ` (${leg.obstacles.map(k => TR.obstacles.find(o => o.key === k)?.label).join(", ")})` : ""));
    });
    lines.push(...plan.notes);
    const rolls = [];
    let marchLines = [];
    if (s.mode === "foot" && s.pace === "force") {
      const r = await forceMarchChecks(actors);
      marchLines = r.lines;
      rolls.push(...r.rolls);
    }
    const content = `<p><strong>${esc(i18n("AD2E.Travel.Card", { mode: i18n(`AD2E.Travel.Mode.${s.mode}`), miles: plan.miles }))}</strong></p>`
      + `<ul>${lines.map(l => `<li>${esc(l)}</li>`).join("")}${marchLines.map(l => `<li>${esc(l)}</li>`).join("")}</ul>`;
    await ChatMessage.create({ content, rolls, speaker: { alias: i18n("AD2E.Travel.Title") }, flags: { ad2e: { travel: { hours: s.hours, miles: plan.miles } } } });
    // Getting lost: one blind check per day off roads, rivers and trails, for the GM only.
    if (s.lost.check && ["foot", "mounted", "vehicle", "ship", "air"].includes(s.mode)) {
      const pct = lostChance(s.lost.surroundings, s.lost.mods, s.lost.variable);
      const roll = await new Roll("1d100").evaluate();
      const lost = isLost(roll.total, pct);
      await ChatMessage.create({ rolls: [roll], whisper: ChatMessage.getWhisperRecipients?.("GM")?.map(u => u.id) ?? [], blind: true,
        content: `<p>${esc(i18n("AD2E.Travel.LostCheck", { roll: roll.total, pct }))}: <strong>${esc(i18n(lost ? "AD2E.Travel.Lost" : "AD2E.Travel.NotLost"))}</strong></p>` });
    }
    this.render();
  }
}
