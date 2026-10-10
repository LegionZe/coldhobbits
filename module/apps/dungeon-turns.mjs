import { advanceTurn, dungeonState, endExpedition, REST_EVERY, restState, startExpedition } from "../dungeon-turns.mjs";
import { LIGHT, litSources, putOut } from "../lights.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;
const i18n = (k, d) => (d ? game.i18n.format(k, d) : game.i18n.localize(k));

/**
 * GM dungeon turn tracker (module/dungeon-turns.mjs; Configure Settings, the GM manual, or game.ad2e.dungeonTurns()):
 * start or end the expedition, "Next turn" and "Rest turn" (10 minutes of world time each), turns since the last rest,
 * the fatigue penalty, and every lit torch, candle and lantern with its turns left (module/lights.mjs).
 */
export default class DungeonTurnTracker extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "ad2e-dungeon-turns",
    classes: ["ad2e", "dungeon-turns"],
    window: { title: "AD2E.Dungeon.Title", icon: "fa-solid fa-hourglass-half", resizable: true },
    position: { width: 480, height: "auto" },
    actions: { start: DungeonTurnTracker.#onStart, end: DungeonTurnTracker.#onEnd, next: DungeonTurnTracker.#onNext,
      rest: DungeonTurnTracker.#onRest, out: DungeonTurnTracker.#onOut }
  };

  static PARTS = { main: { template: "systems/ad2e/templates/apps/dungeon-turns.hbs" } };

  #hooks = [];

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const now = game.time.worldTime;
    const st = restState(dungeonState(), now);
    return {
      ...context, st, restEvery: REST_EVERY,
      hours: Math.floor(st.turns / 6), extra: st.turns % 6,
      restText: st.penalty ? i18n("AD2E.Dungeon.Penalty", { n: st.penalty })
        : st.due ? i18n("AD2E.Dungeon.RestNow") : i18n("AD2E.Dungeon.RestIn", { n: st.untilRest }),
      urls: LIGHT.urls,
      lights: litSources(now).map(r => ({ uuid: r.uuid, name: r.name, bearer: r.bearer, turns: r.turns, radius: r.radius }))
    };
  }

  _onFirstRender(context, options) {
    super._onFirstRender?.(context, options);
    const rerender = () => this.render();
    for (const hook of ["updateWorldTime", "ad2eDungeonTurns", "updateItem"]) this.#hooks.push([hook, Hooks.on(hook, rerender)]);
  }

  _onClose(options) {
    super._onClose?.(options);
    for (const [hook, id] of this.#hooks) Hooks.off(hook, id);
    this.#hooks = [];
  }

  static #onStart() { return startExpedition(); }
  static #onEnd() { return endExpedition(); }
  static #onNext() { return advanceTurn(); }
  static #onRest() { return advanceTurn({ rest: true }); }

  static async #onOut(event, target) {
    const item = await fromUuid(target.dataset.uuid);
    if (item?.parent) await putOut(item.parent, item);
  }
}
