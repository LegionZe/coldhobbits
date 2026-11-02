import { artilleryIssues, artilleryLoad, deckSpace, diceText, EXPERIENCE, NAVAL, pursuitDice, shipyardRepair } from "../naval.mjs";
import { patchShip, repairAtSea, rollCrewExperience, rollSeaworthiness, shipyardRepairShip, skeletonEffort, speedBoost } from "../ships.mjs";

const { HandlebarsApplicationMixin } = foundry.applications.api;
const { ActorSheetV2 } = foundry.applications.sheets;
const i18n = (k, d) => (d ? game.i18n.format(k, d) : game.i18n.localize(k));

/**
 * Sheet for ships (actor type "ship"; module/data/ship.mjs, rules in module/naval.mjs and module/ships.mjs): the
 * Of Ships and the Sea ship record. One part; the GM edits the record, owners use the buttons.
 */
export default class ShipSheet extends HandlebarsApplicationMixin(ActorSheetV2) {
  static DEFAULT_OPTIONS = {
    classes: ["ad2e", "ship"],
    position: { width: 720, height: 760 },
    window: { resizable: true },
    form: { submitOnChange: true },
    actions: {
      addArtillery: ShipSheet.#onAddArtillery, removeArtillery: ShipSheet.#onRemoveArtillery,
      addFire: ShipSheet.#onAddFire, removeFire: ShipSheet.#onRemoveFire,
      seaworthiness: function () { return rollSeaworthiness(this.actor); },
      repairAtSea: function () { return repairAtSea(this.actor); },
      patch: function () { return patchShip(this.actor); },
      shipyard: function () { return shipyardRepairShip(this.actor); },
      boost: function () { return speedBoost(this.actor); },
      skeleton: function () { return skeletonEffort(this.actor); },
      rollExperience: function () { return rollCrewExperience(this.actor); },
      fullCrew: ShipSheet.#onFullCrew
    }
  };

  static PARTS = { main: { template: "systems/ad2e/templates/actor/ship-sheet.hbs", scrollable: [""] } };

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const actor = this.document;
    const s = actor.system;
    const spec = s.spec;
    const label = k => i18n(`AD2E.Naval.Size.${k}`);
    const now = game.time?.worldTime ?? 0;
    const load = artilleryLoad(s.artillery);
    const issues = artilleryIssues(spec, s.artillery.filter(a => !a.destroyed));
    const move = spec.move;
    const moveText = spec.propulsion === "both" ? `${move.both}/${move.sail}/${move.oar}` : String(move.sail ?? move.oar ?? 0);
    const cm = spec.combat.move;
    const combatMove = spec.propulsion === "both" ? `${cm.both}/${cm.sail}/${cm.oar}` : String(cm.sail ?? cm.oar ?? 0);
    const cargo = spec.cargo.tons !== undefined ? i18n("AD2E.Naval.Tons", { n: spec.cargo.tons }) : i18n("AD2E.Naval.Pounds", { n: spec.cargo.lb });
    const hullLost = s.hullMax - s.hullNow;
    const repair = shipyardRepair(s.sizeKey, hullLost + (s.cripplingMax - s.cripplingNow));
    const hours = s.founderAt !== null && s.founderAt !== undefined ? Math.max(Math.ceil((s.founderAt - now) / 3600), 0) : null;
    return Object.assign(context, {
      actor, system: s, spec, editable: this.isEditable, isGM: !!game.user?.isGM,
      types: NAVAL.ships.map(t => ({ value: t.key, label: t.label, selected: t.key === s.shipType })),
      variable: !!spec.variable, both: spec.propulsion === "both",
      propulsions: ["", "sail", "oar"].map(p => ({ value: p, label: i18n(`AD2E.Naval.Propulsion.${p || "both"}`), selected: p === s.propulsion })),
      experiences: EXPERIENCE.map(k => ({ value: k, label: i18n(`AD2E.Naval.Experience.${k}`), selected: k === s.experience })),
      summary: [
        { label: i18n("AD2E.Naval.Size.label"), value: label(s.sizeKey) },
        { label: i18n("AD2E.Naval.Move"), value: moveText, tooltip: i18n("AD2E.Naval.MoveHint", { combat: combatMove }) },
        { label: i18n("AD2E.Naval.Seaworthiness"), value: `${s.seaworthinessNow}${s.seaworthinessNow !== s.seaworthinessBase ? ` / ${s.seaworthinessBase}` : ""}${s.jury ? ` (${i18n("AD2E.Naval.Jury")})` : ""}` },
        { label: i18n("AD2E.Naval.Maneuver"), value: diceText(s.maneuver, s.diceMod) },
        { label: i18n("AD2E.Naval.Pursuit"), value: diceText(pursuitDice(Math.max(s.rate.rate, 0), s.crewState), s.diceMod) },
        { label: i18n("AD2E.Naval.Defense"), value: spec.combat.defense },
        { label: i18n("AD2E.Naval.Ram"), value: s.ram === null || s.ram === undefined ? "—" : String(s.ram) },
        { label: i18n("AD2E.Naval.Cargo"), value: cargo },
        { label: i18n("AD2E.Naval.CrewCapacity"), value: `${spec.crew.max}/${spec.crew.average}/${spec.crew.minimum}`, tooltip: i18n("AD2E.Naval.CrewCapacityHint") },
        { label: i18n("AD2E.Naval.MarinesMax"), value: spec.combat.warMarines ? `${spec.combat.marines}/${spec.combat.warMarines}` : String(spec.combat.marines) },
        { label: i18n("AD2E.Naval.Draft"), value: i18n("AD2E.Naval.Feet", { n: spec.draft }) },
        { label: i18n("AD2E.Naval.Cost"), value: `${spec.cost} gp` }
      ],
      crewState: s.crewState, crewStateText: i18n(`AD2E.Naval.CrewState.${s.crewState}`),
      rateNotes: s.rate.notes.map(n => i18n(`AD2E.Naval.RateNote.${n}`)).join(", "),
      rowers: spec.rowers, warriors: spec.warriors, allRow: spec.allRow,
      artilleryKinds: NAVAL.combat.artillery.filter(a => a.key !== "trebuchet").map(a => ({ value: a.key, label: i18n(`AD2E.Naval.Artillery.${a.key}`) })),
      artillery: s.artillery.map((a, i) => {
        const t = NAVAL.combat.artillery.find(x => x.key === a.key);
        return { ...a, index: i, label: i18n(`AD2E.Naval.Artillery.${a.key}`), need: t?.crew ?? 1,
          short: (a.crew ?? 0) < (t?.crew ?? 1) };
      }),
      deck: { space: deckSpace(spec), used: load.space, tons: load.tons },
      artilleryIssues: issues.map(k => i18n(`AD2E.Naval.ArtilleryIssue.${k}`)),
      fires: s.fires.map((f, i) => ({ ...f, index: i, hull: f.location === "hull", label: i18n(`AD2E.Naval.FireAt.${f.location}`) })),
      isSkeleton: s.crewState === "skeleton", aground: s.aground ? i18n(`AD2E.Naval.Aground.${s.aground}`) : "",
      sinking: hours !== null && !s.sunk ? i18n("AD2E.Naval.SinksIn", { n: hours }) : "",
      repair: hullLost > 0 || s.cripplingNow < s.cripplingMax ? i18n("AD2E.Naval.ShipyardCost", { cost: repair.cost, days: repair.days }) : "",
      morale: s.moraleRating
    });
  }

  /** Indexed artillery and fire inputs ("system.artillery.0.crew") come back as objects: merge them into the arrays. */
  _processFormData(event, form, formData) {
    const data = super._processFormData(event, form, formData);
    for (const key of ["artillery", "fires"]) {
      const v = data.system?.[key];
      if (v && !Array.isArray(v)) {
        const src = this.document._source.system[key] ?? [];
        data.system[key] = src.map((e, i) => ({ ...e, ...(v[i] ?? {}) }));
      }
    }
    return data;
  }

  static async #onAddArtillery(event, target) {
    const key = this.element.querySelector("[data-artillery-kind]")?.value || "ballistaLight";
    const list = foundry.utils.deepClone(this.document._source.system.artillery);
    list.push({ key, crew: NAVAL.combat.artillery.find(a => a.key === key)?.crew ?? 1, loaded: 0, destroyed: false, incendiary: false });
    return this.document.update({ "system.artillery": list });
  }

  static async #onRemoveArtillery(event, target) {
    const list = foundry.utils.deepClone(this.document._source.system.artillery);
    list.splice(Number(target.dataset.index), 1);
    return this.document.update({ "system.artillery": list });
  }

  static async #onAddFire() {
    const list = foundry.utils.deepClone(this.document._source.system.fires);
    list.push({ location: "hull", die: 6 });
    return this.document.update({ "system.fires": list });
  }

  static async #onRemoveFire(event, target) {
    const list = foundry.utils.deepClone(this.document._source.system.fires);
    list.splice(Number(target.dataset.index), 1);
    return this.document.update({ "system.fires": list });
  }

  /**
   * Fill the record from the type: the maximum crew complement (rowers from the galley footnotes; all rowers on a curragh,
   * drakkar or longship and on oar-only craft), one officer per 10 sailors or 20 rowers and a captain (Table 2 notes;
   * implementation choice: officers are kept apart from the crew count), the Table 38 marines, hull and crippling points.
   */
  static async #onFullCrew() {
    const spec = this.document.system.spec;
    const allRow = spec.allRow || spec.propulsion === "oar";
    const rowers = spec.rowers?.rowers ?? (allRow ? spec.crew.max : 0);
    const sailors = Math.max(spec.crew.max - rowers, 0);
    return this.document.update({
      "system.sailors.count": sailors, "system.rowers.count": rowers, "system.marines.count": spec.combat.marines,
      "system.officers": Math.floor(sailors / 10) + Math.floor(rowers / 20), "system.captain": true,
      "system.hull.value": spec.combat.hull, "system.hull.max": spec.combat.hull,
      "system.crippling.value": spec.combat.crippling ?? spec.combat.hull, "system.crippling.max": spec.combat.crippling ?? spec.combat.hull
    });
  }
}
