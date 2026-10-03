import * as cc from "../importers/complete-compendium.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/** Fetch JSON or text; throws with the HTTP status on failure. */
async function get(url, json = true) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${response.status} ${url}`);
  return json ? response.json() : response.text();
}

/** Whether a picture URL exists (HEAD request; some pictures the site links to are missing). Cached per session. */
const imageChecks = new Map();
function imageExists(url) {
  if (!imageChecks.has(url)) {
    imageChecks.set(url, fetch(url, { method: "HEAD" }).then(r => r.ok && /^image\//.test(r.headers.get("content-type") ?? ""))
      .catch(() => false));
  }
  return imageChecks.get(url);
}

/** Run `fn` over `items` with at most `limit` requests at a time. */
async function pool(items, limit, fn) {
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      await fn(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}

/**
 * GM tool: import monsters from https://www.completecompendium.com/ by setting and source book, as Monster / NPC
 * actors in the world (stat block and a link to the page; no descriptive text). Re-importing updates actors that
 * were imported from the same page and variant.
 */
export default class MonsterImporter extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "ad2e-monster-importer",
    classes: ["ad2e", "monster-importer"],
    window: { title: "AD2E.Importer.Title", icon: "fa-solid fa-dragon", resizable: true },
    position: { width: 640, height: 720 },
    actions: {
      loadBook: MonsterImporter.#onLoadBook,
      selectAll: MonsterImporter.#onSelectAll,
      selectNone: MonsterImporter.#onSelectNone,
      importSelected: MonsterImporter.#onImport
    }
  };

  static PARTS = { main: { template: "systems/ad2e/templates/apps/monster-importer.hbs", scrollable: [".ad2e-importer-list"] } };

  /** Catalog ({ settings, books }), loaded once per session. */
  static catalog = null;

  state = { setting: "add2_01", book: "", entries: [], selected: new Set(), filter: "", folder: true, busy: "", error: "" };

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    if (!MonsterImporter.catalog && !this.state.error) {
      try {
        MonsterImporter.catalog = cc.parseCatalog(await get(cc.catalogUrl(), false));
      } catch (err) {
        this.state.error = game.i18n.format("AD2E.Importer.FetchFailed", { error: err.message });
      }
    }
    const catalog = MonsterImporter.catalog ?? { settings: [], books: [] };
    const s = this.state;
    const books = catalog.books.filter(b => b.setting === s.setting).sort((a, b) => a.title.localeCompare(b.title));
    // default: the setting's largest book (the Monstrous Manual for AD&D 2nd Edition)
    if (!books.some(b => b.id === s.book)) s.book = [...books].sort((a, b) => b.count - a.count)[0]?.id ?? "";
    const filter = s.filter.toLowerCase();
    return {
      ...context,
      settings: Object.fromEntries(catalog.settings.map(x => [x.key, x.name])),
      books: Object.fromEntries(books.map(b => [b.id, `${b.title} (${b.count})`])),
      state: s,
      entries: s.entries.filter(e => !filter || e.label.toLowerCase().includes(filter))
        .map(e => ({ ...e, checked: s.selected.has(e.id) })),
      selectedCount: s.selected.size,
      site: cc.SITE
    };
  }

  _onRender(context, options) {
    super._onRender?.(context, options);
    const el = this.element;
    el.querySelector("select[name=setting]")?.addEventListener("change", ev => {
      this.state.setting = ev.currentTarget.value;
      this.state.book = "";
      this.state.entries = [];
      this.state.selected.clear();
      this.render();
    });
    el.querySelector("select[name=book]")?.addEventListener("change", ev => {
      this.state.book = ev.currentTarget.value;
      this.state.entries = [];
      this.state.selected.clear();
      this.render();
    });
    el.querySelector("input[name=filter]")?.addEventListener("change", ev => {
      this.state.filter = ev.currentTarget.value;
      this.render();
    });
    el.querySelector("input[name=folder]")?.addEventListener("change", ev => { this.state.folder = ev.currentTarget.checked; });
    for (const box of el.querySelectorAll("input[data-entry]")) {
      box.addEventListener("change", ev => {
        const id = ev.currentTarget.dataset.entry;
        if (ev.currentTarget.checked) this.state.selected.add(id);
        else this.state.selected.delete(id);
        const count = el.querySelector(".ad2e-importer-count");
        if (count) count.textContent = this.state.selected.size;
      });
    }
  }

  get #book() {
    return MonsterImporter.catalog?.books.find(b => b.id === this.state.book && b.setting === this.state.setting) ?? null;
  }

  /** Fetch the book's monster list and every monster page (4 requests at a time). */
  static async #onLoadBook() {
    const book = this.#book;
    if (!book) return;
    const s = this.state;
    s.entries = [];
    s.selected.clear();
    s.error = "";
    try {
      const keys = cc.bookMonsterKeys(await get(cc.bookDataUrl(book)));
      const failed = [];
      let done = 0;
      const pages = [];
      await pool(keys, 4, async key => {
        try {
          pages.push(cc.parseMonsterPage(await get(cc.monsterDataUrl(key))));
        } catch (err) {
          failed.push(key);
        }
        done++;
        if (done % 10 === 0 || done === keys.length) {
          s.busy = game.i18n.format("AD2E.Importer.Loading", { done, total: keys.length });
          this.render();
        }
      });
      for (const page of pages) {
        for (const variant of page.variants) {
          const id = `${page.key}|${variant.name}`;
          const label = page.variants.length > 1 && variant.name !== page.title ? `${page.title}: ${variant.name}` : variant.name || page.title;
          s.entries.push({ id, label, key: page.key, hd: cc.cleanText(variant.block["Hit Dice"]), page, variant });
          s.selected.add(id);
        }
      }
      s.entries.sort((a, b) => a.label.localeCompare(b.label));
      if (failed.length) s.error = game.i18n.format("AD2E.Importer.SomeFailed", { n: failed.length, keys: failed.join(", ") });
    } catch (err) {
      s.error = game.i18n.format("AD2E.Importer.FetchFailed", { error: err.message });
    }
    s.busy = "";
    this.render();
  }

  static #onSelectAll() {
    const filter = this.state.filter.toLowerCase();
    for (const e of this.state.entries) if (!filter || e.label.toLowerCase().includes(filter)) this.state.selected.add(e.id);
    this.render();
  }

  static #onSelectNone() {
    this.state.selected.clear();
    this.render();
  }

  /** Create (or update, if imported before) one actor per selected stat block variant. */
  static async #onImport() {
    const s = this.state;
    const book = this.#book;
    const chosen = s.entries.filter(e => s.selected.has(e.id));
    if (!chosen.length) return;
    let folder = null;
    if (s.folder && book) {
      folder = game.folders.find(f => f.type === "Actor" && f.name === book.title)
        ?? await Folder.create({ name: book.title, type: "Actor" });
    }
    // Keep only the pictures that exist (the page's own picture for a variant, else the page's first one, else none).
    const pages = [...new Set(chosen.map(e => e.page))];
    const images = new Map();
    await pool(pages, 4, async page => {
      const ok = [];
      for (const img of page.images ?? []) if (await imageExists(img.url)) ok.push(img);
      images.set(page, ok);
    });
    const create = [];
    const update = [];
    for (const e of chosen) {
      const data = cc.monsterActorData({ ...e.page, images: images.get(e.page) ?? [] }, e.variant);
      data.name = e.label; // "Horse: Heavy" for a page with several stat blocks
      data.prototypeToken.name = e.label;
      const existing = game.actors.find(a => {
        const f = a.flags?.ad2e?.completeCompendium;
        return f && f.key === e.page.key && f.variant === e.variant.name;
      });
      if (existing) {
        const { hp, ...system } = data.system; // keep current hit points
        const change = { _id: existing.id, name: data.name, system, flags: data.flags };
        // Pictures: replace only the default icon or an earlier picture from the site (keep ones a GM chose).
        const fromSite = src => !src || src === cc.DEFAULT_IMAGE || String(src).startsWith(cc.SITE);
        if (data.img !== cc.DEFAULT_IMAGE && fromSite(existing.img)) change.img = data.img;
        if (data.img !== cc.DEFAULT_IMAGE && fromSite(existing.prototypeToken?.texture?.src)) change["prototypeToken.texture.src"] = data.img;
        update.push(change);
      } else {
        if (folder) data.folder = folder.id;
        create.push(data);
      }
    }
    if (create.length) await Actor.createDocuments(create);
    if (update.length) await Actor.updateDocuments(update);
    ui.notifications.info(game.i18n.format("AD2E.Importer.Done", { created: create.length, updated: update.length }));
  }
}
