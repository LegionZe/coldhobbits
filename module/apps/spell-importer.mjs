import * as wiki from "../importers/adnd2e-wiki.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

async function getJson(params) {
  const response = await fetch(wiki.apiUrl(params));
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  return response.json();
}

/** All results of a list query, following "continue". */
async function listAll(params, key) {
  const out = [];
  let cont = {};
  do {
    const r = await getJson({ ...params, ...cont });
    out.push(...(r.query?.[key] ?? []));
    cont = r.continue ?? null;
  } while (cont);
  return out;
}

/**
 * GM tool: import spells from the AD&D 2e wiki (https://adnd2e.fandom.com/) by source book, then filter by class
 * and level, as world spell Items (game statistics and a link to the page; no description). Re-importing updates
 * items imported from the same page.
 */
export default class SpellImporter extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "ad2e-spell-importer",
    classes: ["ad2e", "spell-importer"],
    window: { title: "AD2E.SpellImporter.Title", icon: "fa-solid fa-wand-sparkles", resizable: true },
    position: { width: 640, height: 720 },
    actions: {
      loadBook: SpellImporter.#onLoadBook,
      selectAll: SpellImporter.#onSelectAll,
      selectNone: SpellImporter.#onSelectNone,
      importSelected: SpellImporter.#onImport
    }
  };

  static PARTS = { main: { template: "systems/ad2e/templates/apps/spell-importer.hbs", scrollable: [".ad2e-importer-list"] } };

  /** Source books ({ name, count }), loaded once per session. */
  static books = null;

  state = { book: "Players Handbook", kind: "", level: "", filter: "", entries: [], selected: new Set(), folder: true,
    busy: "", error: "", loadedBook: "" };

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    if (!SpellImporter.books && !this.state.error) {
      try {
        const cats = await listAll({ action: "query", list: "allcategories", acprefix: wiki.BOOK_PREFIX, acprop: "size", aclimit: 500 },
          "allcategories");
        SpellImporter.books = cats.map(c => ({ name: c["*"].slice(wiki.BOOK_PREFIX.length), count: c.size }))
          .filter(b => b.count > 0).sort((a, b) => a.name.localeCompare(b.name));
      } catch (err) {
        this.state.error = game.i18n.format("AD2E.Importer.FetchFailed", { error: err.message });
      }
    }
    const s = this.state;
    const books = SpellImporter.books ?? [];
    const filter = s.filter.toLowerCase();
    const shown = s.entries.filter(e => (!s.kind || e.data.system.kind === s.kind)
      && (s.level === "" || e.data.system.level === Number(s.level)) && (!filter || e.label.toLowerCase().includes(filter)));
    const levels = [...new Set(s.entries.map(e => e.data.system.level))].sort((a, b) => a - b);
    return {
      ...context, state: s, site: wiki.WIKI,
      books: Object.fromEntries(books.map(b => [b.name, `${b.name} (${b.count})`])),
      kinds: { "": game.i18n.localize("AD2E.SpellImporter.AllClasses"), wizard: game.i18n.localize("AD2E.Spell.wizard"),
        priest: game.i18n.localize("AD2E.Spell.priest") },
      levels: { "": game.i18n.localize("AD2E.SpellImporter.AllLevels"),
        ...Object.fromEntries(levels.map(l => [String(l), l === 0 ? game.i18n.localize("AD2E.Spell.Cantrips") : game.i18n.format("AD2E.Spell.LevelN", { n: l })])) },
      entries: shown.map(e => ({ ...e, checked: s.selected.has(e.id) })),
      shownCount: shown.length,
      selectedCount: [...s.selected].filter(id => shown.some(e => e.id === id)).length
    };
  }

  _onRender(context, options) {
    super._onRender?.(context, options);
    const el = this.element;
    const bind = (selector, fn) => el.querySelector(selector)?.addEventListener("change", ev => { fn(ev.currentTarget); this.render(); });
    bind("select[name=book]", t => { this.state.book = t.value; });
    bind("select[name=kind]", t => { this.state.kind = t.value; });
    bind("select[name=level]", t => { this.state.level = t.value; });
    bind("input[name=filter]", t => { this.state.filter = t.value; });
    el.querySelector("input[name=folder]")?.addEventListener("change", ev => { this.state.folder = ev.currentTarget.checked; });
    for (const box of el.querySelectorAll("input[data-entry]")) {
      box.addEventListener("change", ev => {
        if (ev.currentTarget.checked) this.state.selected.add(ev.currentTarget.dataset.entry);
        else this.state.selected.delete(ev.currentTarget.dataset.entry);
      });
    }
  }

  /** Fetch the book's spell pages (50 per request) and parse their infoboxes. */
  static async #onLoadBook() {
    const s = this.state;
    s.entries = [];
    s.selected.clear();
    s.error = "";
    s.loadedBook = s.book;
    try {
      const titles = (await listAll({ action: "query", list: "categorymembers", cmtitle: `Category:${wiki.BOOK_PREFIX}${s.book}`,
        cmnamespace: 0, cmlimit: 500 }, "categorymembers")).map(m => m.title);
      const skipped = [];
      for (let i = 0; i < titles.length; i += 50) {
        const batch = titles.slice(i, i + 50);
        let cont = {};
        const pages = {};
        do {
          const r = await getJson({ action: "query", prop: "revisions|categories", rvprop: "content|ids", rvslots: "main",
            cllimit: 500, titles: batch.join("|"), ...cont });
          for (const p of Object.values(r.query?.pages ?? {})) {
            const prev = pages[p.title] ?? { categories: [] };
            pages[p.title] = { wiki: p.revisions?.[0]?.slots?.main?.["*"] ?? prev.wiki, revid: p.revisions?.[0]?.revid ?? prev.revid,
              categories: [...prev.categories, ...(p.categories ?? []).map(c => c.title.replace(/^Category:/, ""))] };
          }
          cont = r.continue ?? null;
        } while (cont);
        for (const [title, p] of Object.entries(pages)) {
          const data = wiki.spellItemData(title, p.wiki, p.categories);
          if (!data) { skipped.push(title); continue; }
          data.flags.ad2e.wiki.revid = p.revid;
          const id = title;
          s.entries.push({ id, label: data.name, data, level: data.system.level,
            meta: `${game.i18n.localize(`AD2E.Spell.${data.system.kind}`)} ${data.system.level}` });
          s.selected.add(id);
        }
        s.busy = game.i18n.format("AD2E.SpellImporter.Loading", { done: Math.min(i + 50, titles.length), total: titles.length });
        this.render();
      }
      s.entries.sort((a, b) => a.data.system.level - b.data.system.level || a.label.localeCompare(b.label));
      if (skipped.length) s.error = game.i18n.format("AD2E.SpellImporter.Skipped", { n: skipped.length });
    } catch (err) {
      s.error = game.i18n.format("AD2E.Importer.FetchFailed", { error: err.message });
    }
    s.busy = "";
    this.render();
  }

  #shown() {
    const s = this.state;
    const filter = s.filter.toLowerCase();
    return s.entries.filter(e => (!s.kind || e.data.system.kind === s.kind)
      && (s.level === "" || e.data.system.level === Number(s.level)) && (!filter || e.label.toLowerCase().includes(filter)));
  }

  static #onSelectAll() {
    for (const e of this.#shown()) this.state.selected.add(e.id);
    this.render();
  }

  static #onSelectNone() {
    for (const e of this.#shown()) this.state.selected.delete(e.id);
    this.render();
  }

  /**
   * Item folder "<Class> Spells" / "Level <n>" (cantrips and orisons: "Cantrips / orisons") for a spell, created if
   * missing; `cache` avoids creating the same folder twice in one import.
   */
  static async #folderFor(kind, level, cache) {
    const i18n = k => game.i18n.localize(k);
    const find = async (name, parent) => {
      const key = `${parent?.id ?? ""}/${name}`;
      if (cache.has(key)) return cache.get(key);
      const folder = game.folders.find(f => f.type === "Item" && f.name === name && (f.folder?.id ?? null) === (parent?.id ?? null))
        ?? await Folder.create({ name, type: "Item", folder: parent?.id ?? null, sorting: "a" });
      cache.set(key, folder);
      return folder;
    };
    const top = await find(game.i18n.format("AD2E.SpellImporter.ClassFolder", { kind: i18n(`AD2E.Spell.${kind}`) }), null);
    return find(level === 0 ? i18n("AD2E.Spell.Cantrips") : game.i18n.format("AD2E.Spell.LevelN", { n: level }), top);
  }

  /**
   * Import the selected spells that match the current filters, filed by class and spell level (e.g. "Wizard Spells" /
   * "Level 3"); spells imported before from the same page are updated (memorization kept) and moved to that folder.
   */
  static async #onImport() {
    const s = this.state;
    const chosen = this.#shown().filter(e => s.selected.has(e.id));
    if (!chosen.length) return;
    const cache = new Map();
    const create = [];
    const update = [];
    for (const e of chosen) {
      const data = foundry.utils.deepClone(e.data);
      const folder = s.folder ? await SpellImporter.#folderFor(data.system.kind, data.system.level, cache) : null;
      const existing = game.items.find(i => i.type === "spell" && i.flags?.ad2e?.wiki?.title === e.id);
      if (existing) {
        const { prepared, cast, ...system } = data.system;
        update.push({ _id: existing.id, name: data.name, system, flags: data.flags, ...(folder ? { folder: folder.id } : {}) });
      } else {
        if (folder) data.folder = folder.id;
        create.push(data);
      }
    }
    if (create.length) await Item.createDocuments(create);
    if (update.length) await Item.updateDocuments(update);
    ui.notifications.info(game.i18n.format("AD2E.SpellImporter.Done", { created: create.length, updated: update.length }));
  }
}
