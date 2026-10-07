import {
  adjustedFrequency, AREA_KINDS, creatureLevel, currentArea, EC, encounterChance, encounterCheck, FREQUENCIES, frequencyOf,
  percentileLayout, POPULATIONS, tableResults, twoTwentyLayout
} from "../encounters.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;
const i18n = (k, d) => (d ? game.i18n.format(k, d) : game.i18n.localize(k));

/**
 * GM encounter tool (module/encounters.mjs; Configure Settings, the GM manual, or game.ad2e.encounters()): the area
 * (Table 56 terrain or dungeon, population, extra modifier, the RollTable used, automatic checks), "Check now" and
 * "Encounter now", and the table builder: creatures dropped in (or the selected tokens' actors) and text entries with a
 * frequency, laid out as a 2-20 table (Table 54) or a percentile table, created as a world RollTable.
 */
export default class EncounterTool extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "ad2e-encounter-tool",
    classes: ["ad2e", "encounter-tool"],
    window: { title: "AD2E.Encounter.Title", icon: "fa-solid fa-dragon", resizable: true },
    position: { width: 620, height: "auto" },
    actions: { check: EncounterTool.#onCheck, force: EncounterTool.#onForce, addTokens: EncounterTool.#onAddTokens,
      addText: EncounterTool.#onAddText, removeEntry: EncounterTool.#onRemoveEntry, create: EncounterTool.#onCreate }
  };

  static PARTS = { main: { template: "systems/ad2e/templates/apps/encounter-tool.hbs" } };

  builder = { entries: [], layout: "twoTwenty", level: 0, name: "" };

  /** A builder entry for an actor (frequency from its stat block; unique creatures are refused). */
  static entryFor(actor) {
    const f = frequencyOf(actor.system?.frequency);
    if (f === "unique") return null;
    return { uuid: actor.uuid, name: actor.name, img: actor.img, frequency: f ?? "common",
      level: actor.type === "monster" ? creatureLevel(actor.system?.xp) : null };
  }

  /** The entries with the table level applied, and those left out by it (pure). */
  static leveled(entries, level) {
    const kept = [], out = [];
    for (const e of entries) {
      const f = e.uuid ? adjustedFrequency(e.frequency, e.level, Number(level) || 0) : e.frequency;
      if (f) kept.push({ ...e, frequency: f }); else out.push(e);
    }
    return { kept, out };
  }

  static layoutOf(builder) {
    const { kept, out } = EncounterTool.leveled(builder.entries, builder.level);
    const layout = builder.layout === "percentile" ? percentileLayout(kept) : twoTwentyLayout(kept);
    return { ...layout, dropped: [...layout.dropped, ...out] };
  }

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const area = currentArea();
    const opt = (list, sel, label) => list.map(k => ({ key: k.key ?? k, label: label(k), selected: (k.key ?? k) === sel }));
    const b = this.builder;
    const layout = EncounterTool.layoutOf(b);
    return {
      ...context, area, chance: encounterChance(area), isDungeon: area.kind === "dungeon",
      kinds: opt(AREA_KINDS, area.kind, k => i18n(`AD2E.Encounter.Kind.${k}`)),
      terrains: opt(EC.terrain, area.terrain, t => `${t.label} (${t.chance}; ${t.slots.map(h => `${h}:00`).join(", ")})`),
      populations: opt(POPULATIONS, area.population, k => `${i18n(`AD2E.Encounter.Population.${k}`)} (+${EC.population[k]})`),
      tables: [{ key: "", label: "—", selected: !area.table }, ...(game.tables?.contents ?? []).map(t => ({ key: t.uuid, label: t.name, selected: t.uuid === area.table }))],
      builder: b, layouts: opt(["twoTwenty", "percentile"], b.layout, k => i18n(`AD2E.Encounter.Layout.${k}`)),
      entries: b.entries.map((e, i) => ({ ...e, index: i, freqs: opt(FREQUENCIES, e.frequency, f => i18n(`AD2E.Encounter.Freq.${f}`)) })),
      textFreqs: opt(FREQUENCIES, "common", f => i18n(`AD2E.Encounter.Freq.${f}`)),
      preview: layout.rows.map(r => ({ range: r.range[0] === r.range[1] ? `${r.range[0]}` : `${r.range[0]}-${r.range[1]}`, names: r.entries.map(e => e.name).join(" / ") })),
      dropped: layout.dropped.map(e => e.name).join(", "), formula: layout.formula, canCreate: layout.rows.length > 0, urls: EC.urls
    };
  }

  _onRender(context, options) {
    super._onRender?.(context, options);
    const el = this.element;
    for (const input of el.querySelectorAll("[data-area]")) input.addEventListener("change", async ev => {
      const t = ev.currentTarget;
      const value = t.type === "checkbox" ? t.checked : (t.type === "number" ? Number(t.value) || 0 : t.value);
      await game.settings.set("ad2e", "encounterArea", { ...currentArea(), [t.dataset.area]: value });
      this.render();
    });
    for (const input of el.querySelectorAll("[data-builder]")) input.addEventListener("change", ev => {
      const t = ev.currentTarget;
      const f = t.dataset.builder;
      if (f === "frequency") this.builder.entries[Number(t.dataset.index)].frequency = t.value;
      else this.builder[f] = t.type === "number" ? Number(t.value) || 0 : t.value;
      this.render();
    });
    // Actors dragged from the sidebar or a compendium join the builder.
    const zone = el.querySelector(".ad2e-encounter-drop") ?? el;
    zone.addEventListener("dragover", ev => ev.preventDefault());
    zone.addEventListener("drop", async ev => {
      ev.preventDefault();
      const TE = foundry.applications?.ux?.TextEditor?.implementation;
      let data = null;
      try { data = TE?.getDragEventData ? TE.getDragEventData(ev) : JSON.parse(ev.dataTransfer.getData("text/plain")); } catch { data = null; }
      if (data?.type !== "Actor" || !data.uuid) return;
      const actor = await fromUuid(data.uuid);
      this.#add(actor);
    });
  }

  #add(actor) {
    if (!actor) return;
    const e = EncounterTool.entryFor(actor);
    if (!e) return ui.notifications.warn(i18n("AD2E.Encounter.Unique", { name: actor.name }));
    if (!this.builder.entries.some(x => x.uuid === e.uuid)) this.builder.entries.push(e);
    this.render();
  }

  static async #onCheck() {
    await encounterCheck(currentArea(), { reason: i18n("AD2E.Encounter.ManualReason") });
  }

  static async #onForce() {
    await encounterCheck(currentArea(), { force: true, reason: i18n("AD2E.Encounter.ForceReason") });
  }

  static #onAddTokens() {
    const actors = (globalThis.canvas?.tokens?.controlled ?? []).map(t => t.actor).filter(Boolean);
    if (!actors.length) return ui.notifications.warn(i18n("AD2E.Encounter.SelectTokens"));
    for (const a of actors) this.#add(a);
  }

  static #onAddText() {
    // Read from the form (a change listener would re-render before the click lands).
    const name = String(this.element.querySelector("[name=encText]")?.value ?? "").trim();
    const freq = this.element.querySelector("[name=encTextFreq]")?.value || "common";
    if (!name) return;
    this.builder.entries.push({ uuid: null, name, img: null, frequency: freq, level: null });
    this.render();
  }

  static #onRemoveEntry(event, target) {
    this.builder.entries.splice(Number(target.dataset.index), 1);
    this.render();
  }

  static async #onCreate() {
    const layout = EncounterTool.layoutOf(this.builder);
    if (!layout.rows.length) return;
    const name = this.builder.name || i18n("AD2E.Encounter.DefaultName");
    const table = await RollTable.implementation.create({ name, formula: layout.formula, replacement: true, displayRoll: true,
      description: i18n(`AD2E.Encounter.Layout.${this.builder.layout}`), results: tableResults(layout) });
    if (!table) return;
    await game.settings.set("ad2e", "encounterArea", { ...currentArea(), table: table.uuid });
    ui.notifications.info(i18n("AD2E.Encounter.Created", { name: table.name }));
    this.render();
  }
}
