import { scanElement } from "./self-check-scan.mjs";
import { ad2eDialog } from "./dialogs.mjs";

/**
 * GM self-check (owner's request 1.0.61; GM manual tool "Check sheets", game.ad2e.selfCheck()): opens sample sheets and the
 * system's windows, shows every tab (characters also in edit mode), scans what is drawn (module/self-check-scan.mjs) and
 * collects errors logged meanwhile, then shows one report to copy. It changes no data: sheets it opened are closed again,
 * sheets already open get their tab and edit mode back.
 * Samples (implementation choice): up to 6 world characters, up to 3 world monsters (else one from each system Actor
 * compendium), one item of each item type (world, then an actor's, then a system compendium's). The monster and spell
 * importers are not opened (they fetch from their websites when shown). Dialogs are not covered.
 */
const MAX = { characters: 6, monsters: 3 };
const SKIP_MENUS = ["ad2e.monsterImporter", "ad2e.spellImporter"];

const frame = () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
const i18n = (k, d) => (d ? game.i18n.format(k, d) : game.i18n.localize(k));
const esc = v => foundry.utils.escapeHTML?.(String(v ?? "")) ?? String(v ?? "");

/** Tabs drawn in a window: [{ tab, group }] from its tab buttons. */
export function tabsOf(element) {
  const seen = new Set();
  return [...(element?.querySelectorAll?.("[data-action='tab'][data-tab]") ?? [])]
    .map(b => ({ tab: b.dataset.tab, group: b.dataset.group || "primary" }))
    .filter(t => { const k = `${t.group}.${t.tab}`; if (seen.has(k)) return false; seen.add(k); return true; });
}

/** The report as plain text (pure): header lines, then each window's issues and errors. */
export function reportText({ header = [], results = [] }) {
  const lines = [...header, ""];
  const bad = results.filter(r => r.issues.length || r.errors.length);
  lines.push(`Checked ${results.length} windows; ${bad.length} with findings.`);
  for (const r of bad) {
    lines.push("", `== ${r.label}`);
    for (const i of r.issues) lines.push(`- [${i.tab || "-"}] ${i.kind}: ${i.text}  @ ${i.path}`);
    for (const e of r.errors) lines.push(`- error: ${e}`);
  }
  if (!bad.length) lines.push("No findings.");
  return lines.join("\n");
}

/** Sample documents to open. */
async function samples() {
  const out = [];
  const actors = game.actors?.contents ?? [];
  const byName = (a, b) => a.name.localeCompare(b.name);
  out.push(...actors.filter(a => a.type === "character").sort(byName).slice(0, MAX.characters));
  const monsters = actors.filter(a => a.type === "monster").sort(byName).slice(0, MAX.monsters);
  out.push(...monsters);
  const systemPacks = game.packs?.filter(p => p.metadata?.packageType === "system" && p.metadata?.packageName === "ad2e") ?? [];
  if (!monsters.length) {
    for (const pack of systemPacks.filter(p => p.documentName === "Actor")) {
      const index = await pack.getIndex();
      const first = index.contents?.[0] ?? [...index.values()][0];
      if (first) out.push(await pack.getDocument(first._id));
    }
  }
  const types = Object.keys(CONFIG.Item?.dataModels ?? {}).filter(t => t !== "base");
  const itemPacks = systemPacks.filter(p => p.documentName === "Item");
  for (const type of types) {
    let item = game.items?.find(i => i.type === type) ?? null;
    if (!item) for (const a of actors) { item = a.items.find(i => i.type === type); if (item) break; }
    if (!item) for (const pack of itemPacks) {
      const index = await pack.getIndex({ fields: ["type"] });
      const hit = (index.contents ?? [...index.values()]).find(e => e.type === type);
      if (hit) { item = await pack.getDocument(hit._id); break; }
    }
    if (item) out.push(item);
  }
  return out;
}

/** Scan an application's current state on every tab: issues tagged with the tab. */
async function scanTabs(app, scan) {
  const issues = [];
  await frame();
  const tabs = tabsOf(app.element);
  const before = { ...(app.tabGroups ?? {}) };
  const pass = tab => { for (const i of scan(app.element)) issues.push({ ...i, tab }); };
  if (!tabs.length) pass("");
  for (const t of tabs) {
    try { app.changeTab(t.tab, t.group, { force: true, updatePosition: false }); } catch { continue; }
    await frame();
    pass(t.tab);
  }
  for (const [group, tab] of Object.entries(before)) { try { app.changeTab(tab, group, { force: true, updatePosition: false }); } catch { /* gone */ } }
  return issues;
}

/** Run the check and show the report. `scan` is injectable for tests. */
export async function runSelfCheck({ scan = null, show = true } = {}) {
  if (!game.user?.isGM) { ui.notifications?.warn(i18n("AD2E.SelfCheck.GmOnly")); return null; }
  const hasKey = k => { try { return game.i18n.has(k, false); } catch { return false; } };
  const doScan = scan ?? (el => scanElement(el, { hasKey }));
  // Errors logged while windows are drawn.
  const errors = [];
  const origError = console.error;
  console.error = (...args) => { errors.push(args.map(a => (a instanceof Error ? a.message : String(a))).join(" ")); origError.apply(console, args); };
  const onError = ev => errors.push(String(ev?.message ?? ev?.reason?.message ?? ev?.reason ?? ev));
  globalThis.addEventListener?.("error", onError);
  globalThis.addEventListener?.("unhandledrejection", onError);
  ui.notifications?.info(i18n("AD2E.SelfCheck.Running"));
  const results = [];
  const check = async (label, app, { wasOpen = false, modes = [null] } = {}) => {
    const start = errors.length;
    const issues = [];
    const editBefore = app._editMode;
    try {
      for (const mode of modes) {
        if (mode !== null) app._editMode = mode;
        await app.render({ force: true });
        for (const i of await scanTabs(app, doScan)) issues.push(mode === null ? i : { ...i, tab: `${i.tab}${mode ? " (edit)" : ""}` });
      }
    } catch (err) {
      errors.push(`${label}: ${err?.message ?? err}`);
    }
    if (modes.some(m => m !== null)) { app._editMode = editBefore; if (wasOpen) await app.render().catch?.(() => null); }
    if (!wasOpen) await app.close?.({ animate: false })?.catch?.(() => null);
    const seen = new Set();
    results.push({ label, issues: issues.filter(i => { const k = `${i.kind}|${i.path}|${i.text}`; if (seen.has(k)) return false; seen.add(k); return true; }),
      errors: errors.slice(start) });
  };
  try {
    for (const doc of await samples()) {
      const sheet = doc.sheet;
      if (!sheet) continue;
      const where = doc.pack ? ` [${doc.pack}]` : (doc.parent ? ` [${doc.parent.name}]` : "");
      await check(`${doc.documentName} ${doc.type}: ${doc.name}${where}`, sheet,
        { wasOpen: !!sheet.rendered, modes: doc.documentName === "Actor" && doc.type === "character" ? [false, true] : [null] });
    }
    for (const [key, menu] of game.settings?.menus?.entries?.() ?? []) {
      if (!key.startsWith("ad2e.") || SKIP_MENUS.includes(key) || typeof menu?.type !== "function") continue;
      let app;
      try { app = new menu.type(); } catch (err) { results.push({ label: `Window ${key}`, issues: [], errors: [String(err?.message ?? err)] }); continue; }
      await check(`Window ${key}`, app);
    }
  } finally {
    console.error = origError;
    globalThis.removeEventListener?.("error", onError);
    globalThis.removeEventListener?.("unhandledrejection", onError);
  }
  const modules = game.modules?.filter?.(m => m.active).map(m => `${m.id} ${m.version ?? ""}`.trim()) ?? [];
  const header = [`AD&D 2e self-check, ${new Date().toISOString()}`,
    `Foundry ${game.release?.version ?? game.version ?? "?"}, system ${game.system?.id} ${game.system?.version}, world ${game.world?.id ?? "?"}`,
    `Active modules: ${modules.join(", ") || "none"}`];
  const text = reportText({ header, results });
  const findings = results.reduce((n, r) => n + r.issues.length + r.errors.length, 0);
  if (show) await showReport(text, results.length, findings);
  return { results, text, findings };
}

async function showReport(text, windows, findings) {
  const copy = async () => {
    try { if (game.clipboard?.copyPlainText) await game.clipboard.copyPlainText(text); else await navigator.clipboard.writeText(text); }
    catch { /* the text can still be selected by hand */ }
    ui.notifications?.info(i18n("AD2E.SelfCheck.Copied"));
  };
  await ad2eDialog.wait({
    window: { title: i18n("AD2E.SelfCheck.Title") },
    position: { width: 720 },
    content: `<p>${esc(i18n(findings ? "AD2E.SelfCheck.Found" : "AD2E.SelfCheck.Clean", { windows, findings }))}</p>`
      + `<p class="ad2e-note">${esc(i18n("AD2E.SelfCheck.SendHint"))}</p>`
      + `<textarea readonly rows="18" style="width:100%;font-family:monospace;font-size:12px">${esc(text)}</textarea>`,
    buttons: [{ action: "copy", label: i18n("AD2E.SelfCheck.Copy"), icon: "fa-solid fa-copy", callback: copy },
      { action: "close", label: i18n("AD2E.SelfCheck.Close"), default: true }],
    rejectClose: false
  });
}
