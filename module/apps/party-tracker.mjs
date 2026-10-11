import { addMembers, moveMember, partyActors, partyList, removeMember, setParty } from "../party.mjs";
import { partyEaters } from "../travel-days.mjs";
import { ad2eDialog } from "../dialogs.mjs";
import { dungeonState, restState } from "../dungeon-turns.mjs";
import DungeonTurnTracker from "./dungeon-turns.mjs";
import TravelPlanner from "./travel-planner.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;
const i18n = (k, d) => (d ? game.i18n.format(k, d) : game.i18n.localize(k));
const resolveSync = u => (foundry.utils.fromUuidSync ?? globalThis.fromUuidSync)?.(u, { strict: false }) ?? null;

/**
 * GM party tracker (module/party.mjs; Configure Settings, the GM manual, or game.ad2e.party()): the actors in the party,
 * added by dragging them from the Actors sidebar or a scene's selected tokens, removed or reordered here; each row shows
 * hit points and the henchmen, animals and mount that come along (travel-days.mjs partyEaters). The travel planner and
 * the dungeon turn tracker read this list.
 */
export default class PartyTracker extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "ad2e-party-tracker",
    classes: ["ad2e", "party-tracker"],
    window: { title: "AD2E.Party.Title", icon: "fa-solid fa-people-group", resizable: true },
    position: { width: 520, height: "auto" },
    actions: { open: PartyTracker.#onOpen, remove: PartyTracker.#onRemove, up: PartyTracker.#onUp, down: PartyTracker.#onDown,
      addTokens: PartyTracker.#onAddTokens, addPlayers: PartyTracker.#onAddPlayers, clear: PartyTracker.#onClear,
      travel: () => new TravelPlanner().render({ force: true }), dungeon: () => new DungeonTurnTracker().render({ force: true }) }
  };

  static PARTS = { main: { template: "systems/ad2e/templates/apps/party-tracker.hbs" } };

  #hooks = [];

  /** A member row (pure apart from `resolve`): name, kind, hit points and who comes along. */
  static row(actor, uuid, resolve, typeLabel) {
    const hp = actor?.system?.hp;
    const along = actor ? partyEaters([actor], resolve).filter(e => e.employer).map(e => e.actor.name) : [];
    return { uuid, missing: !actor, name: actor?.name ?? uuid, img: actor?.img ?? "icons/svg/mystery-man.svg",
      type: actor ? typeLabel(actor.type) : "", hp: hp ? `${hp.value}/${hp.max}` : "", along: along.join(", "), dead: actor?.system?.hpState?.state === "dead" };
  }

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const list = partyList();
    const typeLabel = t => i18n(CONFIG.Actor?.typeLabels?.[t] ?? t);
    const rows = list.map((u, i) => ({ ...PartyTracker.row(resolveSync(u), u, resolveSync, typeLabel), isFirst: i === 0, isLast: i === list.length - 1 }));
    const fallback = list.length ? [] : partyActors().map(a => PartyTracker.row(a, a.uuid, resolveSync, typeLabel));
    const st = restState(dungeonState(), game.time?.worldTime ?? 0);
    return { ...context, rows, fallback, defined: list.length > 0,
      fatigue: st.active && st.penalty ? i18n("AD2E.Dungeon.Penalty", { n: st.penalty }) : "" };
  }

  _onFirstRender(context, options) {
    super._onFirstRender?.(context, options);
    const rerender = () => this.render();
    for (const hook of ["ad2eParty", "updateActor", "deleteActor", "ad2eDungeonTurns"]) this.#hooks.push([hook, Hooks.on(hook, rerender)]);
    // Actors dragged from the Actors sidebar join the party (compendium actors do not). The window element outlives
    // re-renders, so the listeners are added once.
    const el = this.element;
    el.addEventListener("dragover", ev => ev.preventDefault());
    el.addEventListener("drop", ev => this.#onDrop(ev));
  }

  _onClose(options) {
    super._onClose?.(options);
    for (const [hook, id] of this.#hooks) Hooks.off(hook, id);
    this.#hooks = [];
  }

  async #onDrop(ev) {
    ev.preventDefault();
    const TE = foundry.applications?.ux?.TextEditor?.implementation;
    let data = null;
    try { data = TE?.getDragEventData ? TE.getDragEventData(ev) : JSON.parse(ev.dataTransfer.getData("text/plain")); } catch { data = null; }
    if (data?.type !== "Actor" || !data.uuid) return;
    if (data.uuid.startsWith("Compendium.")) return ui.notifications.warn(i18n("AD2E.Party.NoCompendium"));
    await setParty(addMembers(partyList(), [data.uuid]));
  }

  static async #onOpen(event, target) {
    const actor = await fromUuid(target.dataset.uuid);
    actor?.sheet?.render({ force: true });
  }

  static #onRemove(event, target) { return setParty(removeMember(partyList(), target.dataset.uuid)); }
  static #onUp(event, target) { return setParty(moveMember(partyList(), target.dataset.uuid, -1)); }
  static #onDown(event, target) { return setParty(moveMember(partyList(), target.dataset.uuid, 1)); }

  static #onAddTokens() {
    const actors = (globalThis.canvas?.tokens?.controlled ?? []).map(t => t.actor).filter(Boolean);
    if (!actors.length) return ui.notifications.warn(i18n("AD2E.Travel.SelectTokens"));
    return setParty(addMembers(partyList(), actors.map(a => a.uuid)));
  }

  static #onAddPlayers() {
    const pcs = game.actors.filter(a => a.type === "character" && a.hasPlayerOwner);
    return setParty(addMembers(partyList(), pcs.map(a => a.uuid)));
  }

  static async #onClear() {
    const ok = await ad2eDialog.confirm({ window: { title: i18n("AD2E.Party.Title") }, content: `<p>${i18n("AD2E.Party.ClearConfirm")}</p>` });
    if (ok) await setParty([]);
  }
}
