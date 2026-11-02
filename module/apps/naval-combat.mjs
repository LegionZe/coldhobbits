import {
  actorOf, artilleryFire, battle, board, breakFree, COMBAT, endBattle, maneuverPhase, melee, missileVolley, moraleCheckDialog, newUnit, pairKey,
  ram, rangeOf, resolutionPhase, saveBattle, sectionRolls, startBattle, unitActions, unitDice, unitOf, unitRate
} from "../naval-battle.mjs";
import { fleetBonus, roundFor } from "../naval-combat.mjs";
import { diceText, NAVAL } from "../naval.mjs";
import { seaWind } from "./sea-voyage.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;
const i18n = (k, d) => (d ? game.i18n.format(k, d) : game.i18n.localize(k));
const esc = v => foundry.utils.escapeHTML?.(String(v ?? "")) ?? String(v ?? "");

/**
 * Naval combat (GM tool; Configure Settings, the GM manual, or game.ad2e.navalCombat()): the Detailed Naval Combat
 * system of Of Ships and the Sea (module/naval-battle.mjs). Ships (actor type "ship") and sea creatures (monster
 * actors) join from the Actors list or selected tokens; each picks a side, a target, an action and its course to the
 * wind; "Maneuvering" rolls each pair, the action buttons resolve missile fire, incendiaries, artillery, ramming, boarding
 * and boarding melee, "Resolution" burns fires, rolls the hull checks and rower endurance and starts the next round.
 */
export default class NavalCombat extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "ad2e-naval-combat",
    classes: ["ad2e", "naval-combat"],
    window: { title: "AD2E.NavalCombat.Title", icon: "fa-solid fa-anchor", resizable: true },
    position: { width: 760, height: "auto" },
    actions: {
      addShip: NavalCombat.#onAddShip, addTokens: NavalCombat.#onAddTokens, removeUnit: NavalCombat.#onRemove, begin: NavalCombat.#onBegin,
      maneuver: () => maneuverPhase(), resolution: () => resolutionPhase(), end: () => endBattle(), fleet: NavalCombat.#onFleet,
      missiles: (e, t) => missileVolley(t.dataset.uuid), incendiary: (e, t) => missileVolley(t.dataset.uuid, { incendiary: true }),
      artillery: (e, t) => artilleryFire(t.dataset.uuid), ram: (e, t) => ram(t.dataset.uuid), board: (e, t) => board(t.dataset.uuid),
      melee: (e, t) => melee(t.dataset.uuid), free: (e, t) => breakFree(t.dataset.uuid), spells: (e, t) => sectionRolls(t.dataset.uuid),
      morale: (e, t) => moraleCheckDialog(t.dataset.uuid), openActor: (e, t) => actorOf(t.dataset.uuid)?.sheet?.render(true)
    }
  };

  static PARTS = { main: { template: "systems/ad2e/templates/apps/naval-combat.hbs" } };

  #hook = null;

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const b = battle();
    const names = Object.fromEntries(b.units.map(u => [u.uuid, actorOf(u.uuid)?.name ?? "?"]));
    const units = b.units.map(u => {
      const a = actorOf(u.uuid);
      const ship = a?.type === "ship";
      const range = u.target ? rangeOf(b, u.uuid, u.target) : null;
      const minutes = range === null ? 1 : roundFor(range).minutes;
      const acts = unitActions(b, u);
      const status = [];
      if (u.grapple) status.push(i18n(u.grapple === "partial" ? "AD2E.NavalCombat.PartlyGrappled" : "AD2E.NavalCombat.Grappled", { by: names[u.grappledBy] ?? "?" }));
      if (u.stuck) status.push(i18n("AD2E.NavalCombat.StuckIn", { name: names[u.stuck] ?? "?" }));
      if (u.across) status.push(i18n("AD2E.NavalCombat.AcrossNow", { n: u.across }));
      if (ship && a.system.sunk) status.push(i18n("AD2E.Naval.Sunk"));
      if (ship && a.system.morale.surrendered) status.push(i18n("AD2E.NavalCombat.Surrendered"));
      if (ship && a.system.fires.length) status.push(i18n("AD2E.NavalCombat.OnFire", { n: a.system.fires.length }));
      const mods = Object.entries(u.mods ?? {}).filter(([, v]) => v).map(([k, v]) => `${i18n(`AD2E.NavalCombat.Mod.${k}`)} ${v > 0 ? "+" : ""}${v}`);
      return {
        uuid: u.uuid, name: a?.name ?? "?", img: a?.img, ship, sideA: u.side === "a",
        sides: ["a", "b"].map(s => ({ value: s, label: i18n(`AD2E.NavalCombat.Side.${s}`), selected: s === u.side })),
        targets: [{ value: "", label: "—", selected: !u.target }, ...b.units.filter(x => x.uuid !== u.uuid).map(x => ({ value: x.uuid, label: names[x.uuid], selected: x.uuid === u.target }))],
        actions: acts.map(k => ({ value: k, label: i18n(`AD2E.NavalCombat.Action.${k}`), selected: k === u.action })),
        courses: ["with", "across", "into"].map(k => ({ value: k, label: i18n(`AD2E.Naval.Course.${k}`), selected: k === (u.course || "across") })),
        range, rangeText: range === null ? "" : i18n("AD2E.NavalCombat.RangeText", { range, minutes }),
        dice: a ? unitDice(a, u, minutes) : "", rate: a ? unitRate(a, u) : 0,
        hull: ship ? `${a.system.hullNow}/${a.system.hullMax}` : "", crippling: ship ? `${a.system.cripplingNow}/${a.system.cripplingMax}` : "",
        crew: ship ? `${a.system.sailors.count + a.system.rowers.count}` : "", marines: ship ? `${a.system.marines.count}` : "",
        seaworthiness: ship ? a.system.seaworthinessNow : "", status: status.join(" · "), mods: mods.join(", "),
        canRam: ship ? a.system.ram !== null && a.system.ram !== undefined : true, canMelee: (u.across ?? 0) > 0, canFree: !!(u.grapple || u.stuck)
      };
    });
    const ships = (game.actors ?? []).filter(a => a.type === "ship" && !b.units.some(u => u.uuid === a.uuid));
    const wind = seaWind();
    const pairs = [];
    for (let i = 0; i < b.units.length; i++) for (let j = i + 1; j < b.units.length; j++) {
      const x = b.units[i];
      const y = b.units[j];
      if (x.target === y.uuid || y.target === x.uuid) pairs.push({ key: pairKey(x.uuid, y.uuid), label: `${names[x.uuid]} – ${names[y.uuid]}`, range: rangeOf(b, x.uuid, y.uuid) });
    }
    return Object.assign(context, {
      isGM: !!game.user?.isGM, b, units, pairs, active: b.active, round: b.round, phase: i18n(`AD2E.NavalCombat.Phase.${b.phase ?? "declare"}`),
      addable: ships.map(a => ({ value: a.uuid, label: a.name })),
      windText: wind.wind ? i18n("AD2E.NavalCombat.Wind", { wind: i18n(`AD2E.Naval.Wind.${wind.wind}`), from: i18n(`AD2E.Naval.Direction.${wind.direction ?? "north"}`) }) : i18n("AD2E.Naval.NoWind"),
      stormy: ["gale", "storm"].includes(wind.wind), rulesUrl: NAVAL.urls.action
    });
  }

  _onFirstRender(context, options) {
    super._onFirstRender?.(context, options);
    this.#hook = Hooks.on("ad2eNavalCombat", () => { if (this.rendered) this.render(); });
  }

  _onClose(options) {
    super._onClose?.(options);
    if (this.#hook !== null) Hooks.off("ad2eNavalCombat", this.#hook);
    this.#hook = null;
  }

  _onRender(context, options) {
    super._onRender?.(context, options);
    for (const el of this.element.querySelectorAll("[data-unit-field]")) {
      el.addEventListener("change", async ev => {
        if (!game.user?.isGM) return;
        const b = battle();
        const u = unitOf(b, ev.currentTarget.dataset.uuid);
        if (!u) return;
        u[ev.currentTarget.dataset.unitField] = ev.currentTarget.value;
        if (ev.currentTarget.dataset.unitField === "target" && u.target && b.ranges[pairKey(u.uuid, u.target)] === undefined) {
          b.ranges[pairKey(u.uuid, u.target)] = this.#spotted(u.uuid, u.target);
        }
        if (!unitActions(b, u).includes(u.action)) u.action = unitActions(b, u)[0] ?? "close";
        await saveBattle(b);
      });
    }
    for (const el of this.element.querySelectorAll("[data-range-pair]")) {
      el.addEventListener("change", async ev => {
        if (!game.user?.isGM) return;
        const b = battle();
        b.ranges[ev.currentTarget.dataset.rangePair] = Math.max(Number(ev.currentTarget.value) || 0, 0);
        await saveBattle(b);
      });
    }
  }

  /** The first round's range: the Spotted range for clear skies and the larger ship ("Detailed Naval Combat (OSS)"). */
  #spotted(a, b) {
    const row = NAVAL.vision[0];
    const size = x => (actorOf(x)?.type === "ship" ? actorOf(x).system.sizeKey : "small");
    const m = Math.max(NAVAL.visionSize[size(a)] ?? 1, NAVAL.visionSize[size(b)] ?? 1);
    return row.spotted * m;
  }

  static async #onAddShip() {
    const uuid = this.element.querySelector("[data-add-ship]")?.value;
    if (!uuid) return;
    const b = battle();
    if (!unitOf(b, uuid)) b.units.push(newUnit(uuid, b.units.length % 2 ? "b" : "a"));
    await saveBattle(b);
  }

  static async #onAddTokens() {
    const b = battle();
    for (const t of globalThis.canvas?.tokens?.controlled ?? []) {
      const a = t.actor;
      if (!a || !["ship", "monster"].includes(a.type) || unitOf(b, a.uuid)) continue;
      b.units.push(newUnit(a.uuid, t.document?.disposition === -1 ? "b" : "a"));
    }
    await saveBattle(b);
  }

  static async #onRemove(event, target) {
    const b = battle();
    const uuid = target.dataset.uuid;
    b.units = b.units.filter(u => u.uuid !== uuid);
    for (const u of b.units) {
      if (u.target === uuid) u.target = "";
      if (u.grappledBy === uuid) { u.grappledBy = ""; u.grapple = ""; }
      if (u.stuck === uuid) u.stuck = "";
    }
    for (const k of Object.keys(b.ranges)) if (k.split("|").includes(uuid)) delete b.ranges[k];
    await saveBattle(b);
  }

  static async #onBegin() {
    const b = battle();
    for (const u of b.units) if (u.target && b.ranges[pairKey(u.uuid, u.target)] === undefined) b.ranges[pairKey(u.uuid, u.target)] = this.#spotted(u.uuid, u.target);
    await startBattle(b);
  }

  /** Fleet battle (Table 38): side A's and B's ships paired in order; maneuverability dice plus the fleet bonuses. */
  static async #onFleet() {
    const b = battle();
    const side = s => b.units.filter(u => u.side === s).map(u => actorOf(u.uuid)).filter(a => a?.type === "ship" && !a.system.sunk);
    const A = side("a");
    const B = side("b");
    if (!A.length || !B.length) return ui.notifications.warn(i18n("AD2E.NavalCombat.FleetNeedSides"));
    const stats = a => ({ factors: a.system.marines.count + a.system.artillery.filter(g => !g.destroyed).reduce((n, g) => n + (COMBAT.artillery.find(x => x.key === g.key)?.crewFactors ?? 0), 0),
      rf: a.system.ram ?? 0, seaworthiness: a.system.seaworthinessNow });
    const out = [];
    const rolls = [];
    let wa = 0;
    let wb = 0;
    for (let i = 0; i < Math.max(A.length, B.length); i++) {
      const x = A[i % A.length];
      const y = B[i % B.length];
      const bx = fleetBonus(stats(x), stats(y));
      const rx = await new Roll(diceText(x.system.maneuver, x.system.diceMod + Math.max(bx, 0))).evaluate();
      const ry = await new Roll(diceText(y.system.maneuver, y.system.diceMod + Math.max(-bx, 0))).evaluate();
      rolls.push(rx, ry);
      const win = rx.total === ry.total ? null : rx.total > ry.total ? x : y;
      if (win === x) wa++; else if (win === y) wb++;
      out.push(i18n("AD2E.NavalCombat.FleetLine", { a: x.name, ra: rx.total, b: y.name, rb: ry.total, winner: win?.name ?? i18n("AD2E.NavalCombat.Nobody") }));
    }
    out.push(i18n("AD2E.NavalCombat.FleetResult", { a: wa, b: wb }));
    return ChatMessage.implementation.create({ speaker: { alias: i18n("AD2E.NavalCombat.Title") }, rolls,
      content: `<p><strong>${esc(i18n("AD2E.NavalCombat.Fleet"))}</strong></p>${out.map(l => `<p>${esc(l)}</p>`).join("")}` });
  }
}
