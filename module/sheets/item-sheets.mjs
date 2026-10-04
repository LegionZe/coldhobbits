import { AD2E, armorSummary, equipmentSummary, gemBaseValue } from "../config.mjs";
import { containerChoices, PHYSICAL_TYPES } from "../containers.mjs";
import { HOLY_ITEM } from "../importers/spell-components.mjs";
import { formatKitModifier, formatKitProficiencies, formatKitRecommended, formatKitSpecialization } from "./character-sheet.mjs";

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
    // Container (module/containers.mjs): an owned physical item can be put into one of its actor's containers.
    const actor = this.document.parent;
    if (actor?.items && PHYSICAL_TYPES.includes(this.document.type)) {
      context.containerOptions = [{ id: "", name: game.i18n.localize("AD2E.Container.None"), selected: !system.container },
        ...containerChoices(this.document, actor.items).map(c => ({ ...c, selected: c.id === system.container }))];
      if (context.containerOptions.length < 2) context.containerOptions = null;
    }
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
    context.kitRecommended = formatKitRecommended(this.document.system.recommendedProficiencies);
    context.kitSpecialization = formatKitSpecialization(this.document.system.specialization);
    context.kitRequiredProfs = formatKitProficiencies(this.document.system.requiredProficiencies);
    context.raceLimitsText = Object.entries(this.document.system.raceLimits ?? {})
      .map(([race, max]) => (max === null ? race : `${race} ${max}`)).join(", ");
    context.skillAdjust = AD2E.thiefSkills.map(key => ({ key, label: game.i18n.localize(`AD2E.Skill.${key}`),
      value: this.document.system.skillAdjust?.[key] ?? 0 }));
    context.kitModifiers = (this.document.system.modifiers ?? []).map(m => formatKitModifier(m));
    const pts = this.document.system.skillPoints;
    context.kitPoints = pts?.first !== null && pts?.first !== undefined
      ? game.i18n.format("AD2E.Kit.SkillPoints", { first: pts.first, per: pts.perLevel ?? 30 }) : "";
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
    // Bows only: the Strength the bow is made for (Strength 3-25 and the 18/xx bands of PHB Table 1).
    context.isBow = sys.weapon?.family === "bow";
    if (context.isBow) {
      const scores = Array.from({ length: 23 }, (_, i) => String(i + 3));
      const bands = ["18/50", "18/75", "18/90", "18/99", "18/00"];
      const bandLabel = { "18/50": "18/01-50", "18/75": "18/51-75", "18/90": "18/76-90", "18/99": "18/91-99" };
      // An array keeps the order (an object would put the number-like keys first).
      context.bowStrengthOptions = [["", game.i18n.localize("AD2E.Weapon.BowStandard")],
        ...[...scores.slice(0, 16), ...bands, ...scores.slice(16)].map(k => [k, bandLabel[k] ?? k])]
        .map(([value, label]) => ({ value, label, selected: value === (sys.bowStrength ?? "") }));
    }
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
    // Armour size (Armor (PHB)): an ordered option list (blank = made for its wearer).
    context.sizeOptions = [["", "AD2E.Armor.SizeWearer"], ["S", "AD2E.Unarmed.Size.S"], ["M", "AD2E.Unarmed.Size.M"], ["L", "AD2E.Unarmed.Size.L"]]
      .map(([value, label]) => ({ value, label: game.i18n.localize(label), selected: value === (sys.size ?? "") }));
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
    context.isComponent = this.document.system.category === "component";
    return context;
  }
}

export class SpellSheet extends AD2EItemSheet {
  static DEFAULT_OPTIONS = { classes: ["spell"], actions: { toggleConsumed: SpellSheet.#onToggleConsumed,
    removeMaterial: SpellSheet.#onRemoveMaterial, addMaterial: SpellSheet.#onAddMaterial } };

  /** Component items to link: the Spell Components compendium (POSM Table 16) and the PHB holy item. */
  static #catalog = null;
  static async catalog() {
    if (SpellSheet.#catalog) return SpellSheet.#catalog;
    const index = await game.packs?.get("ad2e.components")?.getIndex({ fields: ["system.identifier"] });
    SpellSheet.#catalog = [HOLY_ITEM, ...[...(index ?? [])].map(e => ({ identifier: e.system?.identifier ?? "", name: e.name }))
      .filter(c => c.identifier).sort((a, b) => a.name.localeCompare(b.name))];
    return SpellSheet.#catalog;
  }

  /** Material links are edited by actions, not form fields (an array of objects). */
  async _setMaterials(fn) {
    const list = foundry.utils.deepClone(this.document.system.materials ?? []);
    return this.document.update({ "system.materials": fn(list) });
  }

  static #onToggleConsumed(event, target) {
    const i = Number(target.dataset.index);
    return this._setMaterials(list => { if (list[i]) list[i].consumed = !list[i].consumed; return list; });
  }

  static #onRemoveMaterial(event, target) {
    const i = Number(target.dataset.index);
    return this._setMaterials(list => list.filter((_, n) => n !== i));
  }

  static async #onAddMaterial(event, target) {
    const id = target.closest(".ad2e-materials")?.querySelector("select[data-material-pick]")?.value;
    const c = (await SpellSheet.catalog()).find(x => x.identifier === id);
    if (!c) return;
    return this._setMaterials(list => [...list, { identifier: c.identifier, name: c.name,
      consumed: c.identifier !== HOLY_ITEM.identifier, label: "" }]);
  }
  static PARTS = { body: { template: "systems/ad2e/templates/item/spell-sheet.hbs", scrollable: [""] } };

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const sys = this.document.system;
    context.kinds = AD2E.spellKinds;
    context.schoolsText = sys.schools.join(", ");
    context.spheresText = sys.spheres.join(", ");
    context.sourcesText = sys.sources.join(", ");
    context.provincesText = (sys.provinces ?? []).join(", ");
    // Material component links (module/importers/spell-components.mjs).
    context.materials = (sys.materials ?? []).map((m, index) => ({ ...m, index }));
    context.materialChoices = sys.components.material ? await SpellSheet.catalog() : [];
    return context;
  }

  /** Schools, spheres and sources are edited as comma-separated text. */
  _processFormData(event, form, formData) {
    const data = parseClassesText(super._processFormData(event, form, formData), ["schools", "spheres", "sources", "provinces"]);
    // Provinces: only flame, sand, sea, wind (module/elemental.mjs).
    const p = foundry.utils.getProperty(data, "system.provinces");
    if (p) foundry.utils.setProperty(data, "system.provinces", [...p].map(x => String(x).toLowerCase()).filter(x => ["flame", "sand", "sea", "wind"].includes(x)));
    return data;
  }
}

export class MagicItemSheet extends AD2EItemSheet {
  static DEFAULT_OPTIONS = { classes: ["magic"], actions: { rollCharges: MagicItemSheet.#onRollCharges } };

  /** Roll the charges an item has when found (charges.formula), at most its maximum. */
  static async #onRollCharges() {
    const sys = this.document.system;
    if (!sys.charges.formula) return;
    const roll = await new Roll(sys.charges.formula).evaluate();
    const value = sys.charges.max !== null ? Math.min(roll.total, sys.charges.max) : roll.total;
    await this.document.update({ "system.charges.value": value });
    ui.notifications.info(game.i18n.format("AD2E.Magic.ChargesRolled", { name: this.document.name, formula: sys.charges.formula, n: value }));
  }
  static PARTS = { body: { template: "systems/ad2e/templates/item/magic-sheet.hbs", scrollable: [""] } };

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    context.categories = AD2E.magicCategories;
    const table = AD2E.treasureTables.magicCategories.find(c => c.key === this.document.system.category);
    context.categoryTable = table ? game.i18n.format("AD2E.Magic.FromTable", { table: table.table }) : "";
    return context;
  }
}

export class JewellerySheet extends AD2EItemSheet {
  static DEFAULT_OPTIONS = { classes: ["jewellery"] };
  static PARTS = { body: { template: "systems/ad2e/templates/item/jewellery-sheet.hbs", scrollable: [""] } };

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const sys = this.document.system;
    context.kinds = AD2E.treasureKinds;
    context.gemClasses = { "": "—", ...AD2E.gemClasses };
    context.isGem = sys.kind === "gem";
    const base = gemBaseValue(sys.gemClass);
    context.baseValue = base;
    context.unitValue = sys.unitValue;
    context.totalValue = sys.totalValue;
    return context;
  }
}
