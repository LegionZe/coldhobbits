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

/** World compendium the importer writes to (created on the first import). */
export const SPELL_PACK = { name: "ad2e-imported-spells", label: "AD2E.SpellImporter.PackLabel" };
/** System compendium of spell components (POSM Table 16) and the PHB equipment holding the holy item. */
const COMPONENT_PACK = "ad2e.components";

/**
 * Component catalog for linking ([{ identifier, name }], module/importers/spell-components.mjs): the Spell Components
 * compendium's items, loaded once per session.
 */
let componentCatalog = null;
async function components() {
  if (componentCatalog) return componentCatalog;
  const index = await game.packs.get(COMPONENT_PACK)?.getIndex({ fields: ["system.identifier"] });
  componentCatalog = [...(index ?? [])].map(e => ({ identifier: e.system?.identifier ?? "", name: e.name })).filter(c => c.identifier);
  return componentCatalog;
}

/**
 * GM tool: import spells from the AD&D 2e wiki (https://adnd2e.fandom.com/) by source book, then filter by class
 * and level, into a world compendium ("Imported Spells") as spell Items (game statistics, a link to the page and links
 * to their material components; no description). Re-importing updates spells imported from the same page.
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
      importSelected: SpellImporter.#onImport,
      updateExisting: () => updateExistingSpells()
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
          const data = wiki.spellItemData(title, p.wiki, p.categories, await components());
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

  /** The world compendium for imported spells, created if missing. */
  static async #pack() {
    const id = `world.${SPELL_PACK.name}`;
    const existing = game.packs.get(id);
    if (existing) return existing;
    const { CompendiumCollection } = foundry.documents.collections;
    return CompendiumCollection.createCompendium({ name: SPELL_PACK.name, label: game.i18n.localize(SPELL_PACK.label), type: "Item" });
  }

  /**
   * Folder "<Class> Spells" / "Level <n>" (cantrips and orisons: "Cantrips / orisons") in the compendium, created if
   * missing; `cache` avoids creating the same folder twice in one import.
   */
  static async #folderFor(pack, kind, level, cache) {
    const i18n = k => game.i18n.localize(k);
    const find = async (name, parent) => {
      const key = `${parent?.id ?? ""}/${name}`;
      if (cache.has(key)) return cache.get(key);
      const folder = pack.folders.find(f => f.name === name && (f.folder?.id ?? null) === (parent?.id ?? null))
        ?? await Folder.create({ name, type: "Item", folder: parent?.id ?? null, sorting: "a" }, { pack: pack.collection });
      cache.set(key, folder);
      return folder;
    };
    const top = await find(game.i18n.format("AD2E.SpellImporter.ClassFolder", { kind: i18n(`AD2E.Spell.${kind}`) }), null);
    return find(level === 0 ? i18n("AD2E.Spell.Cantrips") : game.i18n.format("AD2E.Spell.LevelN", { n: level }), top);
  }

  /**
   * Import the selected spells that match the current filters into the Imported Spells compendium, filed by class and
   * spell level (e.g. "Wizard Spells" / "Level 3"); spells imported before from the same page are updated (their
   * component links included) and moved to that folder.
   */
  static async #onImport() {
    const s = this.state;
    const chosen = this.#shown().filter(e => s.selected.has(e.id));
    if (!chosen.length) return;
    const pack = await SpellImporter.#pack();
    if (pack.locked) return ui.notifications.warn(game.i18n.format("AD2E.SpellImporter.Locked", { pack: pack.title }));
    const index = await pack.getIndex({ fields: ["flags.ad2e.wiki.title", "type", "system.damage"] });
    const cache = new Map();
    const create = [];
    const update = [];
    for (const e of chosen) {
      const data = foundry.utils.deepClone(e.data);
      const folder = s.folder ? await SpellImporter.#folderFor(pack, data.system.kind, data.system.level, cache) : null;
      const existing = index.find(i => i.type === "spell" && i.flags?.ad2e?.wiki?.title === e.id);
      if (existing) {
        const { prepared, cast, damage, ...system } = data.system;
        // Damage options the GM has stay; a spell without any takes those read from the page (module/importers/spell-damage.mjs).
        if (damage?.length && !hasDamage(existing.system?.damage)) system.damage = damage;
        update.push({ _id: existing._id, name: data.name, system, flags: data.flags, ...(folder ? { folder: folder.id } : {}) });
      } else {
        if (folder) data.folder = folder.id;
        create.push(data);
      }
    }
    try {
      if (create.length) await Item.createDocuments(create, { pack: pack.collection });
      if (update.length) await Item.updateDocuments(update, { pack: pack.collection });
    } catch (err) {
      console.error("AD2E | Spell import failed", err);
      return ui.notifications.error(game.i18n.format("AD2E.SpellImporter.Failed", { error: err?.message ?? err }));
    }
    // Check the result (owner's request, 1.0.12): the compendium must still exist and hold every imported page.
    const missing = await SpellImporter.#missingAfterImport(pack.collection, chosen.map(e => e.id));
    if (missing) {
      console.error("AD2E | Spell import check failed", missing);
      return ui.notifications.error(missing.pack
        ? game.i18n.format("AD2E.SpellImporter.CheckNoPack", { pack: pack.collection })
        : game.i18n.format("AD2E.SpellImporter.CheckMissing", { n: missing.titles.length, total: chosen.length, pack: pack.title,
          list: missing.titles.slice(0, 5).join(", ") }), { permanent: true });
    }
    ui.notifications.info(game.i18n.format("AD2E.SpellImporter.Done", { created: create.length, updated: update.length, pack: pack.title }));
  }

  /**
   * After an import: null when the compendium exists and its index (read again from the server) holds a spell for every
   * imported wiki page; else { pack: true } (compendium gone) or { titles } (pages without a spell).
   */
  static async #missingAfterImport(collection, titles) {
    const pack = game.packs.get(collection);
    if (!pack) return { pack: true };
    const index = await pack.getIndex({ fields: ["flags.ad2e.wiki.title", "type"] });
    return missingTitles(index, titles);
  }
}

/** Wiki page titles of `titles` without a spell in a compendium index (pure); null when none is missing. */
export function missingTitles(index, titles) {
  const entries = typeof index?.values === "function" ? [...index.values()] : [...(index ?? [])];
  const have = new Set(entries.filter(i => i.type === "spell").map(i => i.flags?.ad2e?.wiki?.title));
  const gone = titles.filter(t => !have.has(t));
  return gone.length ? { titles: gone } : null;
}

/** Wiki page title of a spell: its import flag, or the last part of its wiki link. */
/** Whether a spell has damage options (a list; before 0.0.87 a formula string, still raw in compendium indexes). */
export function hasDamage(damage) {
  return Array.isArray(damage) ? damage.some(d => d?.formula) : !!String(damage ?? "").trim();
}

export function spellPageTitle(item) {
  const flagged = item?.flags?.ad2e?.wiki?.title;
  if (flagged) return flagged;
  const url = item?.system?.url ?? "";
  if (!url.startsWith(`${wiki.WIKI}/wiki/`)) return null;
  try { return decodeURIComponent(url.slice(`${wiki.WIKI}/wiki/`.length)).replace(/_/g, " "); } catch { return null; }
}

/**
 * GM tool (game.ad2e.updateSpells(), and the importer's "Update existing spells" button): re-read the wiki page of every
 * spell in the world - world Items, spells on actors, and the Imported Spells compendium - and refresh its statistics and
 * material component links. What belongs to the character stays: memorized and cast counts, learned / failed level,
 * notes, a damage formula already set and the name (a renamed spell keeps its name). Spells without a wiki page are left alone.
 * Resolves { updated, skipped, failed }.
 */
export async function updateExistingSpells() {
  const i18n = k => game.i18n.localize(k);
  if (!game.user.isGM) {
    ui.notifications.warn(i18n("AD2E.SpellImporter.GmOnly"));
    return null;
  }
  // Every spell document: [{ doc, title, parent: "world" | actor | pack }].
  const targets = [];
  for (const item of game.items ?? []) if (item.type === "spell") targets.push({ doc: item, where: null });
  for (const actor of game.actors ?? []) for (const item of actor.items ?? []) if (item.type === "spell") targets.push({ doc: item, where: actor });
  const pack = game.packs.get(`world.${SPELL_PACK.name}`);
  if (pack && !pack.locked) for (const item of await pack.getDocuments()) if (item.type === "spell") targets.push({ doc: item, where: pack });
  const byTitle = new Map();
  let skipped = 0;
  for (const t of targets) {
    const title = spellPageTitle(t.doc);
    if (!title) { skipped++; continue; }
    if (!byTitle.has(title)) byTitle.set(title, []);
    byTitle.get(title).push(t);
  }
  const titles = [...byTitle.keys()];
  const catalog = await components();
  const note = ui.notifications.info(game.i18n.format("AD2E.SpellImporter.Updating", { n: targets.length - skipped, pages: titles.length }));
  let updated = 0;
  let failed = 0;
  const actorUpdates = new Map();
  const worldUpdates = [];
  const packUpdates = [];
  for (let i = 0; i < titles.length; i += 50) {
    const batch = titles.slice(i, i + 50);
    const pages = {};
    let cont = {};
    try {
      do {
        const r = await getJson({ action: "query", prop: "revisions|categories", rvprop: "content|ids", rvslots: "main",
          cllimit: 500, redirects: 1, titles: batch.join("|"), ...cont });
        const alias = Object.fromEntries([...(r.query?.normalized ?? []), ...(r.query?.redirects ?? [])].map(x => [x.from, x.to]));
        for (const p of Object.values(r.query?.pages ?? {})) {
          const prev = pages[p.title] ?? { categories: [] };
          pages[p.title] = { wiki: p.revisions?.[0]?.slots?.main?.["*"] ?? prev.wiki, revid: p.revisions?.[0]?.revid ?? prev.revid,
            categories: [...prev.categories, ...(p.categories ?? []).map(c => c.title.replace(/^Category:/, ""))] };
        }
        for (const t of batch) {
          let target = t;
          for (let n = 0; n < 3 && alias[target]; n++) target = alias[target];
          if (target !== t && pages[target]) pages[t] = pages[target];
        }
        cont = r.continue ?? null;
      } while (cont);
    } catch (err) {
      ui.notifications.error(game.i18n.format("AD2E.Importer.FetchFailed", { error: err.message }));
      return { updated, skipped, failed: failed + titles.length - i };
    }
    for (const title of batch) {
      const p = pages[title];
      const data = p?.wiki ? wiki.spellItemData(title, p.wiki, p.categories, catalog) : null;
      if (!data) { failed += byTitle.get(title).length; continue; }
      const { prepared, cast, learned, learnFailedLevel, notes, damage, ...system } = data.system;
      const flags = { ad2e: { wiki: { title, revid: p.revid } } };
      for (const t of byTitle.get(title)) {
        // A spell without damage options takes those read from the page; options the GM has stay.
        const change = { _id: t.doc.id, system: damage?.length && !hasDamage(t.doc.system?.damage) ? { ...system, damage } : system, flags };
        if (t.where === null) worldUpdates.push(change);
        else if (t.where === pack) packUpdates.push(change);
        else {
          if (!actorUpdates.has(t.where)) actorUpdates.set(t.where, []);
          actorUpdates.get(t.where).push(change);
        }
        updated++;
      }
    }
  }
  if (worldUpdates.length) await Item.updateDocuments(worldUpdates);
  if (packUpdates.length) await Item.updateDocuments(packUpdates, { pack: pack.collection });
  for (const [actor, changes] of actorUpdates) await actor.updateEmbeddedDocuments("Item", changes);
  ui.notifications.remove?.(note);
  ui.notifications.info(game.i18n.format("AD2E.SpellImporter.Updated", { updated, skipped, failed }));
  return { updated, skipped, failed };
}
