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

/**
 * Local copies of the pictures (world setting "monsterImagesLocal", on by default): each picture is downloaded once
 * into the world folder `worlds/<world>/ad2e-monsters/` (FilePicker.upload to the "data" source, Foundry v14 API) and
 * actors and tokens use that path, so players' clients load it from the Foundry server, not from the site. A picture
 * already in the folder is not downloaded again. The site allows these downloads (`access-control-allow-origin: *`).
 * If the folder cannot be written (no upload permission, another file storage), the site's address is used as before.
 */
const FP = () => foundry.applications.apps.FilePicker.implementation;
export const imageDir = () => `worlds/${game.world.id}/ad2e-monsters`;
let localFiles = null;
let uploadWarned = false;

/** Names of the pictures already in the world folder (the folder is created when missing); listed once per session. */
function listLocal() {
  localFiles ??= (async () => {
    try {
      const result = await FP().browse("data", imageDir());
      return new Set((result.files ?? []).map(f => decodeURIComponent(String(f).split("/").pop())));
    } catch {
      try { await FP().createDirectory("data", imageDir()); } catch (err) { console.warn("ad2e | could not create", imageDir(), err); }
      return new Set();
    }
  })();
  return localFiles;
}

/**
 * The site's pictures are GIFs, which Foundry 14.368 rejects as canvas textures ("Invalid Asset" from loadTexture, owner's
 * diagnostic: the same picture as PNG loads), so tokens showed the default icon. A GIF is redrawn (first frame) and
 * stored as WebP, or PNG where the browser cannot encode WebP (OffscreenCanvas#convertToBlob falls back to PNG).
 * Other formats are stored as they are; if the browser cannot convert, the GIF is stored (the portrait still shows).
 */
export async function toCanvasImage(blob) {
  if (blob.type !== "image/gif") return blob;
  try {
    const bitmap = await createImageBitmap(blob);
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    canvas.getContext("2d").drawImage(bitmap, 0, 0);
    bitmap.close?.();
    return await canvas.convertToBlob({ type: "image/webp", quality: 0.9 });
  } catch (err) {
    console.warn("ad2e | could not convert a GIF monster picture", err);
    return blob;
  }
}

const EXTENSION = { "image/webp": "webp", "image/png": "png", "image/gif": "gif", "image/jpeg": "jpg" };

const localChecks = new Map();
/** Local path for a site picture: from the folder, or downloaded and uploaded; null if the site has no such picture. */
function localImage(url) {
  if (!localChecks.has(url)) localChecks.set(url, (async () => {
    const original = cc.localImageName(url);
    if (!original) return (await imageExists(url)) ? url : null;
    const have = await listLocal();
    const base = original.replace(/\.[^.]+$/, "");
    // A converted copy from an earlier import (GIFs are stored as WebP or PNG).
    const known = /\.gif$/i.test(original) ? [`${base}.webp`, `${base}.png`] : [original];
    const found = known.find(n => have.has(n));
    if (found) return `${imageDir()}/${found}`;
    let blob;
    try {
      const response = await fetch(url);
      if (!response.ok) return null;
      blob = await response.blob();
      if (!/^image\//.test(blob.type)) return null;
    } catch {
      return null;
    }
    blob = await toCanvasImage(blob);
    const name = EXTENSION[blob.type] ? `${base}.${EXTENSION[blob.type]}` : original;
    const path = `${imageDir()}/${name}`;
    try {
      const result = await FP().upload("data", imageDir(), new File([blob], name, { type: blob.type }), {}, { notify: false });
      if (result === false || result?.status === "error") throw new Error(result?.message ?? "upload refused");
      have.add(name);
      return result?.path ?? path;
    } catch (err) {
      console.warn("ad2e | could not store a monster picture locally; using the site's address", err);
      if (!uploadWarned) ui.notifications.warn(game.i18n.localize("AD2E.Importer.LocalFailed"));
      uploadWarned = true;
      return url;
    }
  })());
  return localChecks.get(url);
}

export function registerMonsterImageSetting() {
  game.settings.register("ad2e", "monsterImagesLocal", {
    name: "AD2E.Importer.LocalSetting", hint: "AD2E.Importer.LocalSettingHint", scope: "world", config: true, type: Boolean,
    default: true
  });
}

function storeLocally() {
  try { return game.settings.get("ad2e", "monsterImagesLocal") !== false; } catch { return true; }
}

/**
 * The pictures of a page that exist (the variant's own, else the page's first one, else none); with the world setting,
 * as local copies in the world folder.
 */
async function pageImages(page) {
  const local = storeLocally();
  const ok = [];
  for (const img of page.images ?? []) {
    const src = local ? await localImage(img.url) : ((await imageExists(img.url)) ? img.url : null);
    if (src) ok.push({ ...img, url: src });
  }
  return ok;
}

/**
 * Update for an actor imported before from the same page and variant: the stat block and flags; current hit points
 * stay, and an attack keeps the element a GM set (same position and name, the page names none). Pictures: only the
 * default icon, an earlier picture from the site or a local copy is replaced (a GM's choice stays).
 */
export function monsterUpdate(existing, data, { name = true } = {}) {
  const { hp, ...system } = data.system;
  const old = existing.system?.attacks ?? [];
  system.attacks = (system.attacks ?? []).map((a, i) => (!a.element && old[i]?.element && old[i].name === a.name ? { ...a, element: old[i].element } : a));
  const change = { _id: existing.id, system, flags: data.flags };
  if (name) change.name = data.name;
  if (data.img !== cc.DEFAULT_IMAGE && data.img !== existing.img && replaceablePicture(existing.img)) change.img = data.img;
  const token = existing.prototypeToken?.texture?.src;
  if (data.img !== cc.DEFAULT_IMAGE && data.img !== token && replaceablePicture(token)) change["prototypeToken.texture.src"] = data.img;
  // Footprint from the size letter: only over the default 1x1 (a size a GM set stays).
  const squares = data.prototypeToken?.width;
  const proto = existing.prototypeToken;
  if (squares && squares !== 1 && (proto?.width ?? 1) === 1 && (proto?.height ?? 1) === 1) {
    change["prototypeToken.width"] = squares;
    change["prototypeToken.height"] = squares;
  }
  return change;
}

/**
 * Tokens already placed on scenes keep their own picture and size: those of updated world actors that show a site
 * picture, an earlier local copy (such as the GIFs stored by 0.0.112-0.0.113) or the default icon take the actor's new
 * token picture, and those still at the default 1x1 take the footprint of the monster's size (`sizes`: actor id ->
 * squares). A picture or size a GM chose for one token stays. Returns the number of tokens changed.
 */
export async function updatePlacedTokens(changes, sizes = new Map()) {
  const src = new Map(changes.filter(c => c["prototypeToken.texture.src"]).map(c => [c._id, c["prototypeToken.texture.src"]]));
  if (!src.size && !sizes.size) return 0;
  let count = 0;
  for (const scene of game.scenes ?? []) {
    const updates = [];
    for (const token of scene.tokens ?? []) {
      const change = {};
      const next = src.get(token.actorId);
      if (next && next !== token.texture?.src && replaceablePicture(token.texture?.src)) change["texture.src"] = next;
      const squares = sizes.get(token.actorId);
      if (squares && squares !== 1 && (token.width ?? 1) === 1 && (token.height ?? 1) === 1) {
        change.width = squares;
        change.height = squares;
      }
      if (Object.keys(change).length) updates.push({ _id: token.id, ...change });
    }
    if (updates.length) {
      await scene.updateEmbeddedDocuments("Token", updates);
      count += updates.length;
    }
  }
  return count;
}

/** A picture the importer may replace: none, the default icon, one from the site, or a local copy it stored. */
function replaceablePicture(src) {
  return !src || src === cc.DEFAULT_IMAGE || String(src).startsWith(cc.SITE) || String(src).startsWith(`${imageDir()}/`);
}

/**
 * GM tool (game.ad2e.updateMonsters(), and the importer's "Update existing monsters" button): re-read the page of every
 * imported monster (actors flagged `flags.ad2e.completeCompendium`) in the world and in unlocked world Actor
 * compendiums, and update its stat block as a re-import does (names, hit points, GM pictures and elements stay).
 * Unlinked tokens follow their world actor. Returns { updated, failed }.
 */
export async function updateExistingMonsters() {
  if (!game.user.isGM) {
    ui.notifications.warn(game.i18n.localize("AD2E.Importer.GmOnly"));
    return null;
  }
  const imported = a => a?.type === "monster" && a.flags?.ad2e?.completeCompendium?.key;
  const targets = [];
  for (const actor of game.actors ?? []) if (imported(actor)) targets.push({ doc: actor, pack: null });
  for (const pack of game.packs ?? []) {
    if (pack.documentName !== "Actor" || pack.metadata?.packageType !== "world" || pack.locked) continue;
    for (const actor of await pack.getDocuments()) if (imported(actor)) targets.push({ doc: actor, pack });
  }
  const byKey = new Map();
  for (const t of targets) {
    const key = t.doc.flags.ad2e.completeCompendium.key;
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(t);
  }
  const note = ui.notifications.info(game.i18n.format("AD2E.Importer.Updating", { n: targets.length, pages: byKey.size }));
  const world = [];
  const packs = new Map();
  const sizes = new Map();
  let failed = 0;
  await pool([...byKey.keys()], 4, async key => {
    let page;
    try {
      page = cc.parseMonsterPage(await get(cc.monsterDataUrl(key)));
    } catch (err) {
      console.warn(`ad2e | monster page ${key} could not be loaded`, err);
      failed += byKey.get(key).length;
      return;
    }
    const images = await pageImages(page);
    for (const t of byKey.get(key)) {
      const variant = page.variants.find(v => v.name === (t.doc.flags.ad2e.completeCompendium.variant ?? ""));
      if (!variant) { failed++; continue; }
      const data = cc.monsterActorData({ ...page, images }, variant);
      const change = monsterUpdate(t.doc, data, { name: false });
      if (!t.pack && data.prototypeToken.width) sizes.set(t.doc.id, data.prototypeToken.width);
      if (!t.pack) world.push(change);
      else {
        if (!packs.has(t.pack)) packs.set(t.pack, []);
        packs.get(t.pack).push(change);
      }
    }
  });
  if (world.length) await Actor.updateDocuments(world);
  for (const [pack, changes] of packs) await Actor.updateDocuments(changes, { pack: pack.collection });
  const tokens = await updatePlacedTokens(world, sizes);
  const updated = world.length + [...packs.values()].reduce((n, c) => n + c.length, 0);
  ui.notifications.remove?.(note);
  ui.notifications.info(game.i18n.format("AD2E.Importer.Updated", { updated, failed, tokens }));
  return { updated, failed, tokens };
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
      importSelected: MonsterImporter.#onImport,
      updateExisting: () => updateExistingMonsters()
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
    // Keep only the pictures that exist (the page's own picture for a variant, else the page's first one, else none);
    // with the world setting, as local copies in the world folder.
    const pages = [...new Set(chosen.map(e => e.page))];
    const images = new Map();
    await pool(pages, 4, async page => images.set(page, await pageImages(page)));
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
        const change = monsterUpdate(existing, data);
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
