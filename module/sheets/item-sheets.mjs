import { AD2E, armorSummary, equipmentSummary } from "../config.mjs";
import { formatKitProficiencies } from "./character-sheet.mjs";

const { HandlebarsApplicationMixin } = foundry.applications.api;
const { ItemSheetV2 } = foundry.applications.sheets;

/** Shared base for the class and kit item sheets. */
class AD2EItemSheet extends HandlebarsApplicationMixin(ItemSheetV2) {
  static DEFAULT_OPTIONS = {
    classes: ["ad2e", "item"],
    position: { width: 520, height: 600 },
    window: { resizable: true },
    form: { submitOnChange: true }
  };

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const system = this.document.system;
    context.item = this.document;
    context.system = system;
    // Ability minimums (class, kit, race); proficiencies have none.
    context.minimums = system.min ? AD2E.abilities.map(key => ({
      key, label: game.i18n.localize(`AD2E.Ability.${key}`), value: system.min[key] ?? ""
    })) : [];
    return context;
  }
}

export class ClassSheet extends AD2EItemSheet {
  static DEFAULT_OPTIONS = { classes: ["class"] };
  static PARTS = { body: { template: "systems/ad2e/templates/item/class-sheet.hbs", scrollable: [""] } };

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    context.classGroups = AD2E.classGroups;
    context.abilityLabels = AD2E.abilityLabels;
    context.alignments = AD2E.alignments;
    context.prime = [...this.document.system.prime];
    context.alignmentList = [...this.document.system.alignments];
    return context;
  }
}

/** Parse comma-separated `<name>Text` form fields into `system.<name>` arrays. */
function parseClassesText(data, names = ["classes"]) {
  for (const name of names) {
    if (!(`${name}Text` in data)) continue;
    foundry.utils.setProperty(data, `system.${name}`,
      String(data[`${name}Text`]).split(",").map(s => s.trim()).filter(Boolean));
    delete data[`${name}Text`];
  }
  return data;
}

/** "dwarf 15, gnome 6, elf" -> { dwarf: 15, gnome: 6, elf: null } (no number = unlimited). */
function parseRaceLimits(data) {
  if (!("raceLimitsText" in data)) return data;
  const limits = {};
  for (const part of String(data.raceLimitsText).split(",")) {
    const m = part.trim().match(/^([a-z-]+)(?:\s*[: ]\s*(\d+))?$/i);
    if (m) limits[m[1].toLowerCase()] = m[2] ? Number(m[2]) : null;
  }
  foundry.utils.setProperty(data, "system.raceLimits", limits);
  delete data.raceLimitsText;
  return data;
}

export class KitSheet extends AD2EItemSheet {
  static DEFAULT_OPTIONS = { classes: ["kit"] };
  static PARTS = { body: { template: "systems/ad2e/templates/item/kit-sheet.hbs", scrollable: [""] } };

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    context.classesText = [...this.document.system.classes].join(", ");
    context.kitBonusProfs = formatKitProficiencies(this.document.system.bonusProficiencies);
    context.kitRequiredProfs = formatKitProficiencies(this.document.system.requiredProficiencies);
    context.raceLimitsText = Object.entries(this.document.system.raceLimits ?? {})
      .map(([race, max]) => (max === null ? race : `${race} ${max}`)).join(", ");
    return context;
  }

  /** Class list and race limits are edited as comma-separated text. */
  _processFormData(event, form, formData) {
    return parseRaceLimits(parseClassesText(super._processFormData(event, form, formData)));
  }
}

export class RaceSheet extends AD2EItemSheet {
  static DEFAULT_OPTIONS = { classes: ["race"] };
  static PARTS = { body: { template: "systems/ad2e/templates/item/race-sheet.hbs", scrollable: [""] } };

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const system = this.document.system;
    context.classesText = [...system.classes].join(", ");
    context.kitClassesText = [...(system.kitClasses ?? [])].join(", ");
    context.raceRows = AD2E.abilities.map(key => ({
      key, label: game.i18n.localize(`AD2E.Ability.${key}`),
      min: system.min[key] ?? "", max: system.max[key] ?? "", adjust: system.adjust[key]
    }));
    return context;
  }

  _processFormData(event, form, formData) {
    return parseClassesText(super._processFormData(event, form, formData), ["classes", "kitClasses"]);
  }
}

export class ProficiencySheet extends AD2EItemSheet {
  static DEFAULT_OPTIONS = { classes: ["proficiency"] };
  static PARTS = { body: { template: "systems/ad2e/templates/item/proficiency-sheet.hbs", scrollable: [""] } };

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    context.kinds = AD2E.proficiencyKinds;
    context.abilityLabels = AD2E.abilityLabels;
    context.nonweaponGroups = AD2E.nonweaponGroups;
    context.groupList = [...this.document.system.groups];
    context.isWeapon = this.document.system.kind === "weapon";
    if (context.isWeapon) context.weapon = weaponStats(this.document.system.weapon);
    return context;
  }
}

/** Read-only display of PHB weapon data (weapon items). */
function weaponStats(w) {
  const dash = v => v ?? "—";
  return {
    size: dash(w.size), type: dash(w.type), speed: dash(w.speed), missile: w.missile, range: w.range,
    uses: [w.melee && game.i18n.localize("AD2E.Weapon.melee"), w.missile && game.i18n.localize("AD2E.Weapon.missile")]
      .filter(Boolean).join(", ") || "—",
    damage: w.damage.map(d => ({ label: d.speed ? `${d.label}, ${game.i18n.localize("AD2E.Weapon.Speed")} ${d.speed}` : d.label,
      sm: dash(d.sm), l: dash(d.l) }))
  };
}

export class WeaponSheet extends AD2EItemSheet {
  static DEFAULT_OPTIONS = { classes: ["weapon"] };
  static PARTS = { body: { template: "systems/ad2e/templates/item/weapon-sheet.hbs", scrollable: [""] } };

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const sys = this.document.system;
    context.weapon = weaponStats(sys.weapon);
    // On an actor: the linked weapon proficiency, if owned.
    const actor = this.document.parent;
    const entry = actor?.system?.weapons?.find(e => e.item.id === this.document.id);
    if (entry) {
      context.linked = entry.proficient
        ? `${game.i18n.localize("AD2E.Weapon.Proficiency")}: ${entry.proficiency.name}`
          + (entry.specialized ? ` (${game.i18n.localize("AD2E.Weapon.Specialized")})` : "")
        : game.i18n.format("AD2E.Weapon.NotProficient", { penalty: entry.penalty });
    }
    return context;
  }
}

export class AmmunitionSheet extends AD2EItemSheet {
  static DEFAULT_OPTIONS = { classes: ["ammunition"] };
  static PARTS = { body: { template: "systems/ad2e/templates/item/ammunition-sheet.hbs", scrollable: [""] } };

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    context.launchersText = [...this.document.system.launchers].join(", ");
    return context;
  }

  /** Launchers are edited as comma-separated weapon identifiers. */
  _processFormData(event, form, formData) {
    return parseClassesText(super._processFormData(event, form, formData), ["launchers"]);
  }
}

export class ArmorSheet extends AD2EItemSheet {
  static DEFAULT_OPTIONS = { classes: ["armor"] };
  static PARTS = { body: { template: "systems/ad2e/templates/item/armor-sheet.hbs", scrollable: [""] } };

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const sys = this.document.system;
    context.kinds = AD2E.armorKinds;
    context.isBody = sys.kind === "body";
    context.isShield = sys.kind === "shield";
    context.summary = armorSummary(sys);
    return context;
  }
}

export class CoinSheet extends AD2EItemSheet {
  static DEFAULT_OPTIONS = { classes: ["coin"] };
  static PARTS = { body: { template: "systems/ad2e/templates/item/coin-sheet.hbs", scrollable: [""] } };

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const sys = this.document.system;
    context.denominations = AD2E.coinDenominations;
    const gp = Math.round(sys.quantity * sys.value / AD2E.coinValues.gp * 100) / 100;
    const lb = Math.round(sys.quantity / AD2E.coinsPerPound * 10) / 10;
    context.summary = game.i18n.format("AD2E.Coin.Summary", { n: sys.quantity, gp, lb });
    return context;
  }
}

export class EquipmentSheet extends AD2EItemSheet {
  static DEFAULT_OPTIONS = { classes: ["equipment"] };
  static PARTS = { body: { template: "systems/ad2e/templates/item/equipment-sheet.hbs", scrollable: [""] } };

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    context.categories = AD2E.equipmentCategories;
    context.summary = equipmentSummary(this.document.system);
    return context;
  }
}

export class SpellSheet extends AD2EItemSheet {
  static DEFAULT_OPTIONS = { classes: ["spell"] };
  static PARTS = { body: { template: "systems/ad2e/templates/item/spell-sheet.hbs", scrollable: [""] } };

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const sys = this.document.system;
    context.kinds = AD2E.spellKinds;
    context.schoolsText = sys.schools.join(", ");
    context.spheresText = sys.spheres.join(", ");
    context.sourcesText = sys.sources.join(", ");
    return context;
  }

  /** Schools, spheres and sources are edited as comma-separated text. */
  _processFormData(event, form, formData) {
    return parseClassesText(super._processFormData(event, form, formData), ["schools", "spheres", "sources"]);
  }
}
