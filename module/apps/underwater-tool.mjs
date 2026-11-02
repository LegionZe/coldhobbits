import { breathRound, breathRounds, combatMods, defaultMaxDepth, depthCheck, depthUnits, freezingCheck, infravisionRange, sinkRate, SURFACES, swimRate,
  UNDERWATER, UNDERWATER_STATUS, underwaterOf, underwaterProficient, visionAt, walkRate, WATERS } from "../underwater.mjs";
import { materialOf } from "../item-saves.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;
const i18n = (k, d) => (d ? game.i18n.format(k, d) : game.i18n.localize(k));
const esc = v => foundry.utils.escapeHTML?.(String(v ?? "")) ?? String(v ?? "");
const fromUuid = uuid => foundry.utils.fromUuidSync(uuid, { strict: false });
const AREAS = ["shelf", "slope", "abyssal", "trench", "seamount", "ridge", "reef", "river"];
const yd = v => (v === null || v === undefined ? "—" : v < 3 ? i18n("AD2E.Underwater.Feet", { n: Math.round(v * 3) }) : String(v));

/** Swimming details of an actor (land rate, encumbrance, Swimming proficiency, metal armour, gear weight). */
function swimmer(actor) {
  if (actor.type !== "character") {
    const land = Number(actor.system?.movement?.base) || 12;
    return { land, proficient: true, encumbrance: "none", metal: false, gear: 0 };
  }
  const info = actor.system.encumbrance?.info ?? {};
  const cat = info.category && info.category !== "unencumbered" ? info.category : "none";
  const metal = actor.items.some(i => i.type === "armor" && i.system.equipped && !i.system.bonus && materialOf(i) === "metal");
  const proficient = actor.items.some(i => i.type === "proficiency" && i.system.identifier === "swimming");
  return { land: info.base ?? 12, proficient, encumbrance: cat, metal, gear: info.total ?? 0 };
}

/**
 * Underwater (GM tool; Configure Settings, the GM manual, or game.ad2e.underwater()): the selected tokens' actors and those
 * already underwater in the scene, with the Underwater status, depth, air, free action, cold protection and maximum depth,
 * their combat penalties, swimming and sinking rates, breath (a round at a time) and depth and freezing checks; Tables 39-41
 * vision, Table 42 hearing and the encounter checks of Tables 49-59.
 */
export default class UnderwaterTool extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "ad2e-underwater",
    classes: ["ad2e", "underwater-tool"],
    window: { title: "AD2E.Underwater.Title", icon: "fa-solid fa-water", resizable: true },
    position: { width: 680, height: "auto" },
    actions: { toggle: UnderwaterTool.#onToggle, breath: (e, t) => breathRound(fromUuid(t.dataset.uuid)),
      resetBreath: UnderwaterTool.#onResetBreath, depth: (e, t) => depthCheck(fromUuid(t.dataset.uuid)),
      freeze: (e, t) => freezingCheck(fromUuid(t.dataset.uuid)), encounters: UnderwaterTool.#onEncounters, hazard: UnderwaterTool.#onHazard,
      refresh: function () { return this.render(); } }
  };

  static PARTS = { main: { template: "systems/ad2e/templates/apps/underwater-tool.hbs" } };

  state = { water: "clear", surface: "clearday", depth: 0, light: "none", infra: 60, area: "shelf" };
  #hooks = [];

  get actors() {
    const out = new Map();
    for (const t of globalThis.canvas?.tokens?.controlled ?? []) if (t.actor && t.actor.type !== "ship") out.set(t.actor.uuid, t.actor);
    for (const t of globalThis.canvas?.scene?.tokens ?? []) if (t.actor?.statuses?.has?.(UNDERWATER_STATUS.id)) out.set(t.actor.uuid, t.actor);
    return [...out.values()];
  }

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const s = this.state;
    const v = visionAt(s.water, s.surface, s.depth, { light: s.light });
    const rows = this.actors.map(a => {
      const uw = underwaterOf(a);
      const f = a.getFlag?.("ad2e", "underwater") ?? {};
      const sw = swimmer(a);
      const m = uw ? combatMods({ ...uw, proficient: underwaterProficient(a) }) : null;
      const con = a.system?.abilities?.con?.total ?? null;
      const units = uw ? depthUnits(uw.depth, uw.maxDepth) : 0;
      return {
        uuid: a.uuid, name: a.name, on: !!uw, depth: f.depth ?? 0, maxDepth: f.maxDepth ?? "", maxPlaceholder: defaultMaxDepth(a) ?? "?",
        air: !!f.air, freeAction: !!f.freeAction, coldProtected: !!f.coldProtected,
        combat: m ? i18n("AD2E.Underwater.CombatLine", { attack: m.attack, initiative: m.initiative, damage: m.damage }) : "",
        move: i18n("AD2E.Underwater.MoveLine", { swim: swimRate(sw.land, { proficient: sw.proficient, encumbrance: sw.encumbrance, metalArmor: sw.metal }),
          walk: walkRate(sw.land), sink: sinkRate({ metalArmor: sw.metal, gearLb: sw.gear }) }),
        breath: con !== null ? i18n("AD2E.Underwater.BreathLine", { held: f.breath?.held ?? 0, limit: f.breath?.limit ?? breathRounds(con) }) : "",
        depthText: units ? i18n("AD2E.Underwater.BeyondDepth", { n: units }) : ""
      };
    });
    const opt = (list, sel, prefix) => list.map(x => ({ value: x, label: i18n(`${prefix}.${x}`), selected: x === sel }));
    const hearing = [];
    for (const [g, rowsH] of Object.entries(UNDERWATER.hearing)) for (const [k, r] of Object.entries(rowsH)) {
      hearing.push({ label: i18n(`AD2E.Underwater.Hear.${g}.${k}`), a: yd(r.unassisted), b: yd(r.assisted), c: yd(r.marine) });
    }
    return Object.assign(context, {
      isGM: !!game.user?.isGM, state: s, rows,
      waters: opt(WATERS, s.water, "AD2E.Underwater.Water"), surfaces: opt(SURFACES, s.surface, "AD2E.Underwater.Surface"),
      lights: opt(["none", "torch", "sun"], s.light, "AD2E.Underwater.Light"), areas: opt(AREAS, s.area, "AD2E.Underwater.Area"),
      vision: v ? i18n("AD2E.Underwater.VisionLine", { movement: yd(v.movement), spotted: yd(v.spotted), type: yd(v.type), id: yd(v.id), detail: yd(v.detail) }) : i18n("AD2E.Underwater.Blind"),
      infra: i18n("AD2E.Underwater.InfraLine", { feet: infravisionRange(s.infra) }), hearing,
      sourceUrl: UNDERWATER.urls["Combat Effects (OSS)"]
    });
  }

  _onFirstRender(context, options) {
    super._onFirstRender?.(context, options);
    const rerender = () => { if (this.rendered) this.render(); };
    for (const h of ["controlToken", "updateActor", "createActiveEffect", "deleteActiveEffect"]) this.#hooks.push([h, Hooks.on(h, rerender)]);
  }

  _onClose(options) {
    super._onClose?.(options);
    for (const [h, id] of this.#hooks) Hooks.off(h, id);
    this.#hooks = [];
  }

  _onRender(context, options) {
    super._onRender?.(context, options);
    for (const el of this.element.querySelectorAll("[data-uw]")) {
      el.addEventListener("change", ev => {
        const t = ev.currentTarget;
        this.state[t.dataset.uw] = t.type === "number" ? Number(t.value) || 0 : t.value;
        this.render();
      });
    }
    for (const el of this.element.querySelectorAll("[data-uw-actor]")) {
      el.addEventListener("change", async ev => {
        const t = ev.currentTarget;
        const actor = fromUuid(t.dataset.uuid);
        if (!actor?.isOwner) return;
        const f = foundry.utils.deepClone(actor.getFlag("ad2e", "underwater") ?? {});
        const key = t.dataset.uwActor;
        f[key] = t.type === "checkbox" ? t.checked : t.value === "" ? null : Number(t.value) || 0;
        await actor.setFlag("ad2e", "underwater", f);
      });
    }
  }

  static async #onToggle(event, target) {
    const actor = fromUuid(target.dataset.uuid);
    if (!actor?.isOwner) return;
    const on = !actor.statuses?.has?.(UNDERWATER_STATUS.id);
    await actor.toggleStatusEffect(UNDERWATER_STATUS.id, { active: on });
    if (!on) await actor.unsetFlag("ad2e", "underwater");
    this.render();
  }

  static async #onResetBreath(event, target) {
    const actor = fromUuid(target.dataset.uuid);
    if (!actor?.isOwner) return;
    const f = foundry.utils.deepClone(actor.getFlag("ad2e", "underwater") ?? {});
    f.breath = null;
    await actor.setFlag("ad2e", "underwater", f);
  }

  /** Encounter checks for the day in an area (Tables 49-56; the trench: 15% a day, Table 52), whispered to the GM. */
  static async #onEncounters() {
    if (!game.user?.isGM) return;
    const area = UNDERWATER.areas[this.state.area];
    const lines = [];
    const rolls = [];
    const roll = async f => { const r = await new Roll(f).evaluate(); rolls.push(r); return r.total; };
    const resolve = async label => {
      if (/Table 57|Aquatic race/i.test(label)) return `${label} → ${UNDERWATER.races[(await roll("1d8")) - 1].label}`;
      if (/^Hazard/i.test(label)) return `${label} → ${UNDERWATER.hazards[(await roll(`1d${UNDERWATER.hazards.length}`)) - 1].label}`;
      return label;
    };
    if (area.percent) {
      const d = await roll("1d100");
      lines.push(d <= area.percent ? i18n("AD2E.Underwater.TrenchHit", { roll: d, result: area.rows[(await roll(area.die)) - 1].label }) : i18n("AD2E.Underwater.TrenchNone", { roll: d }));
    } else {
      for (let i = 1; i <= area.checks; i++) {
        const d6 = await roll("1d6");
        if (d6 > area.chance) { lines.push(i18n("AD2E.Naval.CheckNone", { n: i, roll: d6 })); continue; }
        const total = (await roll("1d8")) + (await roll("1d12"));
        lines.push(i18n("AD2E.Naval.CheckHit", { n: i, roll: d6, result: await resolve(area.rows.find(r => r.roll === total)?.label ?? "?") }));
      }
    }
    return ChatMessage.implementation.create({ speaker: { alias: i18n("AD2E.Underwater.Title") }, whisper: game.users.filter(u => u.isGM).map(u => u.id), rolls,
      content: `<p><strong>${esc(i18n(`AD2E.Underwater.Area.${this.state.area}`))}</strong></p>${lines.map(l => `<p>${esc(l)}</p>`).join("")}`
        + `<p class="ad2e-note"><a href="${esc(UNDERWATER.urls["Underwater Encounters (OSS)"])}" target="_blank" rel="noopener">${esc(i18n("AD2E.Underwater.EncounterLink"))}</a></p>` });
  }

  /** Table 58 hazard (and Table 59 for an elemental vortex: 5% an hour). */
  static async #onHazard() {
    if (!game.user?.isGM) return;
    const r = await new Roll(`1d${UNDERWATER.hazards.length}`).evaluate();
    const h = UNDERWATER.hazards[r.total - 1].label;
    return ChatMessage.implementation.create({ speaker: { alias: i18n("AD2E.Underwater.Title") }, whisper: game.users.filter(u => u.isGM).map(u => u.id), rolls: [r],
      content: `<p>${esc(i18n("AD2E.Underwater.HazardLine", { roll: r.total, hazard: h }))}</p>${/Vortex/.test(h) ? `<p class="ad2e-note">${esc(i18n("AD2E.Underwater.VortexNote", { list: UNDERWATER.vortex.map(v => v.label).join(", ") }))}</p>` : ""}` });
  }
}
