import MonsterImporter, { updateExistingMonsters } from "./monster-importer.mjs";
import SpellImporter, { updateExistingSpells } from "./spell-importer.mjs";
import AwardXp from "./award-xp.mjs";
import { rollEncounterReaction } from "../reaction.mjs";
import { rollTreasureDialog } from "../treasure.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/** Manual sections, in order (template partial blocks are chosen by id). */
export const MANUAL_SECTIONS = ["start", "tools", "settings", "characters", "combat", "monsters", "items", "optional", "macros"];

/** GM tools the manual can open: id -> function. */
export const MANUAL_TOOLS = {
  importMonsters: () => new MonsterImporter().render({ force: true }),
  updateMonsters: () => updateExistingMonsters(),
  importSpells: () => new SpellImporter().render({ force: true }),
  updateSpells: () => updateExistingSpells(),
  awardXp: () => new AwardXp().render({ force: true }),
  rollTreasure: () => rollTreasureDialog(null),
  rollReaction: () => rollEncounterReaction(null),
  settings: () => new foundry.applications.settings.SettingsConfig().render({ force: true })
};

/** Display value of a setting: its choice label, On/Off, or the value. */
export function settingValue(setting, value, i18n) {
  if (setting.choices && value in setting.choices) return i18n(setting.choices[value]);
  if (typeof value === "boolean") return i18n(value ? "AD2E.Manual.On" : "AD2E.Manual.Off");
  if (value === undefined || value === null) return "—";
  return String(value);
}

/** This system's registered settings shown in Configure Settings, with their current values. */
export function systemSettings(registry = game.settings.settings, get = (ns, key) => game.settings.get(ns, key),
  i18n = k => game.i18n.localize(k)) {
  return [...registry.values()].filter(s => s.namespace === "ad2e" && s.config !== false).map(s => {
    let value;
    try { value = get("ad2e", s.key); } catch { value = undefined; }
    return { key: s.key, name: i18n(s.name ?? s.key), hint: s.hint ? i18n(s.hint) : "", value: settingValue(s, value, i18n),
      scope: i18n(s.scope === "world" ? "AD2E.Manual.ScopeWorld" : "AD2E.Manual.ScopeClient"), reload: !!s.requiresReload };
  }).sort((a, b) => a.name.localeCompare(b.name));
}

/** This system's settings menus (Configure Settings buttons) other than the manual itself. */
export function systemMenus(menus = game.settings.menus, i18n = k => game.i18n.localize(k)) {
  return [...menus.entries()].filter(([k]) => k.startsWith("ad2e.") && k !== "ad2e.manual")
    .map(([key, m]) => ({ key, name: i18n(m.name), hint: m.hint ? i18n(m.hint) : "", icon: m.icon ?? "fa-solid fa-gear" }));
}

/**
 * The system's GM manual (Configure Settings > "AD&D 2e GM manual", the button in the Settings sidebar tab, or
 * game.ad2e.manual()): what the system does, buttons for the GM tools (monster and spell importers and updates,
 * experience, treasure, reactions), every system setting with its current value and what it does, and how the main
 * features are used. Mechanics only; no rulebook text.
 */
export default class Manual extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "ad2e-manual",
    classes: ["ad2e", "ad2e-manual"],
    window: { title: "AD2E.Manual.Title", icon: "fa-solid fa-book", resizable: true },
    position: { width: 760, height: 720 },
    actions: {
      section: Manual.#onSection,
      tool: Manual.#onTool,
      menu: Manual.#onMenu
    }
  };

  static PARTS = { main: { template: "systems/ad2e/templates/apps/manual.hbs", scrollable: [".ad2e-manual-body"] } };

  section = "start";

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const i18n = k => game.i18n.localize(k);
    return {
      ...context,
      isGM: !!game.user?.isGM,
      version: game.system?.version ?? "",
      sections: MANUAL_SECTIONS.map(id => ({ id, label: i18n(`AD2E.Manual.Section.${id}`), active: id === this.section })),
      section: this.section,
      is: Object.fromEntries(MANUAL_SECTIONS.map(id => [id, id === this.section])),
      settings: this.section === "settings" ? systemSettings() : [],
      menus: this.section === "settings" ? systemMenus() : [],
      packs: this.section === "start" ? [...(game.packs ?? [])].filter(p => p.metadata?.packageName === "ad2e")
        .map(p => ({ label: p.metadata.label, type: p.documentName })) : []
    };
  }

  static #onSection(event, target) {
    this.section = target.dataset.section;
    this.render();
  }

  static #onTool(event, target) {
    const tool = MANUAL_TOOLS[target.dataset.tool];
    if (tool) tool();
  }

  static #onMenu(event, target) {
    const menu = game.settings.menus.get(target.dataset.menu);
    if (menu?.type) new menu.type().render({ force: true });
  }
}

/**
 * Configure Settings entry and a button in the Settings sidebar tab (GM only). The button goes after the sidebar's
 * `.info` section, as dnd5e 6.0.5 (v14) inserts its own section (module/applications/settings/sidebar.mjs, hook
 * `renderSettings` with the tab's HTMLElement); without that element it is added at the end of the tab.
 */
export function registerManual() {
  game.settings.registerMenu("ad2e", "manual", {
    name: "AD2E.Manual.Title", label: "AD2E.Manual.Open", hint: "AD2E.Manual.MenuHint", icon: "fa-solid fa-book",
    type: Manual, restricted: true
  });
  Hooks.on("renderSettings", (app, html) => {
    const root = html instanceof HTMLElement ? html : html?.[0];
    if (!root || !game.user?.isGM || root.querySelector(".ad2e-manual-button")) return;
    const button = document.createElement("button");
    button.type = "button";
    button.classList.add("ad2e-manual-button");
    button.innerHTML = `<i class="fa-solid fa-book"></i> ${game.i18n.localize("AD2E.Manual.Open")}`;
    button.addEventListener("click", () => new Manual().render({ force: true }));
    const info = root.querySelector(".info");
    if (info) info.after(button);
    else root.append(button);
  });
}
