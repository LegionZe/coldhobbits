import { prayRule, priestCatalog, priestLevels, praySpell, sphereAccess, classIds, kitId, splitSpheres } from "../prayer.mjs";
import { SPHERE_TABLES } from "../rules/sphere-tables.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;
const i18n = (k, d) => (d ? game.i18n.format(k, d) : game.i18n.localize(k));
const title = s => s.replace(/\b\w/g, c => c.toUpperCase());

/**
 * Pray for spells (character Spells tab, priests): the priest spells of the world's items and every Item compendium,
 * filtered by the priest's spell levels and spheres (module/prayer.mjs); "+" adds one memorized copy. The search box
 * filters the list as typed (no re-render); the level select, the sphere tick box and the sphere fields re-render.
 */
export default class PrayForSpells extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    classes: ["ad2e", "ad2e-prayer"],
    window: { icon: "fa-solid fa-hands-praying", resizable: true },
    position: { width: 560, height: 640 },
    actions: { pray: PrayForSpells.#onPray, refresh: PrayForSpells.#onRefresh, open: PrayForSpells.#onOpen }
  };

  static PARTS = { main: { template: "systems/ad2e/templates/apps/prayer.hbs", scrollable: [".ad2e-prayer-list"] } };

  constructor(actor, options = {}) {
    super({ id: `ad2e-prayer-${actor.id}`, ...options });
    this.actor = actor;
    this.filters = { level: "", mine: true, text: "" };
  }

  get title() {
    return i18n("AD2E.Prayer.Title", { name: this.actor.name });
  }

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const sys = this.actor.system;
    const levels = priestLevels(sys.spells);
    const max = Math.max(0, ...levels.map(l => l.level));
    const access = sphereAccess(classIds(sys), sys.spheres ?? {}, { kit: kitId(sys) });
    const all = await priestCatalog();
    const lvl = this.filters.level === "" ? null : Number(this.filters.level);
    const rule = e => (access.source === "none" ? { reversed: false } : prayRule(e.spheres, e.level, access, e));
    const rows = all.filter(e => e.level >= 1 && e.level <= max && (lvl === null || e.level === lvl) && (!this.filters.mine || rule(e)))
      .map(e => ({ ...e, sphereText: e.spheres.join(", "), key: e.name.toLowerCase(), reversedOnly: this.filters.mine && !!rule(e)?.reversed,
        owned: this.actor.items.filter(i => i.type === "spell" && i.system.level === e.level
          && (i.name === e.name || i.name === i18n("AD2E.Prayer.ReversedName", { name: e.name }))).reduce((n, i) => n + i.system.prepared, 0) }));
    const list = set => [...set].map(title).join(", ") || "—";
    return Object.assign(context, {
      levels: levels.map(l => ({ ...l, selected: String(l.level) === this.filters.level, label: i18n("AD2E.Prayer.LevelLine", l) })),
      state: this.filters, rows, count: rows.length, total: all.length, noLevels: !levels.length,
      accessText: access.source === "none" ? i18n("AD2E.Prayer.NoAccess")
        : i18n("AD2E.Prayer.Access", { major: list(access.major), minor: list(access.minor), max: SPHERE_TABLES.minorMaxLevel }),
      own: { major: sys.spheres?.major ?? "", minor: sys.spheres?.minor ?? "" }, editable: this.actor.isOwner,
      sourceText: access.source === "none" ? "" : i18n(`AD2E.Prayer.Source.${access.source}`, { name: access.priesthood?.label ?? sys.classInfo?.kitItem?.name ?? "" }),
      priesthoods: [{ value: "", label: i18n("AD2E.Prayer.NoPriesthood"), selected: !sys.spheres?.priesthood },
        ...SPHERE_TABLES.priesthoods.map(p => ({ value: p.key, label: p.label, selected: p.key === sys.spheres?.priesthood }))],
      priesthoodUrl: access.priesthood?.url ?? "",
      restrictedText: access.restricted.length ? i18n(Object.keys(access.limits).length ? "AD2E.Prayer.Limited" : "AD2E.Prayer.Restricted",
        { list: access.restricted.map(title).join(", ") }) : "",
      choiceText: access.choice.length ? i18n("AD2E.Prayer.Choice", { list: access.choice.map(title).join(", ") }) : "",
      sphereList: SPHERE_TABLES.spheres.map(title).join(", "), empty: !all.length
    });
  }

  _onRender(context, options) {
    super._onRender?.(context, options);
    const el = this.element;
    const search = el.querySelector("[data-prayer-search]");
    const filter = () => {
      const q = (search?.value ?? "").trim().toLowerCase();
      this.filters.text = search?.value ?? "";
      for (const row of el.querySelectorAll("[data-prayer-row]")) row.hidden = !!q && !row.dataset.key.includes(q);
    };
    search?.addEventListener("input", filter);
    filter();
    el.querySelector("[data-prayer-level]")?.addEventListener("change", ev => { this.filters.level = ev.currentTarget.value; this.render(); });
    el.querySelector("[data-prayer-mine]")?.addEventListener("change", ev => { this.filters.mine = ev.currentTarget.checked; this.render(); });
    el.querySelector("[data-prayer-priesthood]")?.addEventListener("change", async ev => {
      await this.actor.update({ "system.spheres.priesthood": ev.currentTarget.value });
      this.render();
    });
    for (const input of el.querySelectorAll("[data-prayer-sphere]")) {
      input.addEventListener("change", async ev => {
        const k = ev.currentTarget.dataset.prayerSphere;
        await this.actor.update({ [`system.spheres.${k}`]: splitSpheres(ev.currentTarget.value).map(title).join(", ") });
        this.render();
      });
    }
  }

  static async #onPray(event, target) {
    if (!this.actor.isOwner) return;
    await praySpell(this.actor, target.dataset.uuid, 1, { reversed: target.dataset.reversed === "true" });
    this.render();
  }

  static async #onRefresh() {
    await priestCatalog({ fresh: true });
    this.render();
  }

  static async #onOpen(event, target) {
    (await fromUuid(target.dataset.uuid))?.sheet?.render(true);
  }
}
