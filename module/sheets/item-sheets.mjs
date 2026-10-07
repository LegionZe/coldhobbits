import { guessMaterial, ITEM_TYPES, itemSaveBonus, SAVES } from "../item-saves.mjs";
import { coatWithPoison, POISON, poisonLabel } from "../poison.mjs";
import { springTrap, trapContext } from "../traps.mjs";
import { SP } from "../sp-weapons.mjs";
import { AD2E, armorSummary, equipmentSummary, gemBaseValue } from "../config.mjs";
import { identifyContext } from "../identify.mjs";
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
    // Unidentified magical items (module/identify.mjs): the GM edits the source name, players see the unidentified one.
    Object.assign(context, identifyContext(this.document));
    // Ability minimums (class, kit, race); proficiencies have none.
    context.minimums = system.min ? AD2E.abilities.map(key => ({
      key, label: game.i18n.localize(`AD2E.Ability.${key}`), value: system.min[key] ?? ""
    })) : [];
    // Item saving throw material (module/item-saves.mjs): blank = the guess, shown as the first choice.
    if (ITEM_TYPES.includes(this.document.type)) {
      const guess = guessMaterial(this.document);
      context.material = { isMagic: this.document.type === "magic", saveBonus: system.saveBonus,
        bonusPlaceholder: itemSaveBonus({ type: this.document.type, system: { ...system, saveBonus: null } }),
        options: [{ key: "", label: game.i18n.format("AD2E.ItemSave.Guess", { material: guess ? game.i18n.localize(`AD2E.ItemSave.Material.${guess}`) : "—" }), selected: !system.material },
          ...SAVES.materials.map(m => ({ key: m, label: game.i18n.localize(`AD2E.ItemSave.Material.${m}`), selected: m === system.material }))] };
    }
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
    context.allowedWeaponsText = (this.document.system.allowedWeapons ?? []).join(", ");
    return context;
  }

  /** Allowed weapons are edited as comma-separated text. */
  _processFormData(event, form, formData) {
    return parseClassesText(super._processFormData(event, form, formData), ["allowedWeapons"]);
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
    context.allowedWeaponsText = (this.document.system.allowedWeapons ?? []).join(", ");
    context.kitBonusProfs = formatKitProficiencies(this.document.system.bonusProficiencies);
    context.kitRecommended = formatKitRecommended(this.document.system.recommendedProficiencies);
    context.kitSpecialization = formatKitSpecialization(this.document.system.specialization);
    context.kitRequiredProfs = formatKitProficiencies(this.document.system.requiredProficiencies);
    context.raceLimitsText = Object.entries(this.document.system.raceLimits ?? {})
      .map(([race, max]) => (max === null ? race : `${race} ${max}`)).join(", ");
    context.racesBarredText = (this.document.system.racesBarred ?? []).join(", ");
    context.skillAdjust = AD2E.thiefSkills.map(key => ({ key, label: game.i18n.localize(`AD2E.Skill.${key}`),
      value: this.document.system.skillAdjust?.[key] ?? 0 }));
    context.kitModifiers = (this.document.system.modifiers ?? []).map(m => formatKitModifier(m));
    const pts = this.document.system.skillPoints;
    context.kitPoints = [pts?.first !== null && pts?.first !== undefined
      ? game.i18n.format("AD2E.Kit.SkillPoints", { first: pts.first, per: pts.perLevel ?? 30 }) : "",
    pts?.bardFirst !== null && pts?.bardFirst !== undefined ? game.i18n.format("AD2E.Kit.BardPoints", { first: pts.bardFirst }) : ""]
      .filter(Boolean).join(" ");
    return context;
  }

  /** Class list and race limits are edited as comma-separated text. */
  _processFormData(event, form, formData) {
    return parseRaceLimits(parseClassesText(super._processFormData(event, form, formData), ["classes", "racesBarred", "allowedWeapons"]));
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
    context.isNonweapon = this.document.system.kind === "nonweapon";
    if (context.isWeapon) context.weapon = weaponStats(this.document.system.weapon);
    // Skills & Powers kinds (module/sp-weapons.mjs).
    const kind = this.document.system.kind;
    context.spKind = { group: kind === "group", style: kind === "style", armor: kind === "armor", shield: kind === "shield" };
    context.spGroups = Object.fromEntries(Object.entries(SP.groups).map(([k, g]) =>
      [k, g.broad ? `${SP.groups[g.broad].label}: ${g.label} (${g.kind})` : `${g.label} (${g.kind})`]));
    context.spStyles = Object.fromEntries(Object.entries(SP.styles).map(([k, v]) => [k, v.label]));
    context.spShields = Object.fromEntries(Object.keys(SP.shields).map(k => [k, `AD2E.SP.Shield.${k}`]));
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

/** Poison fields of a weapon or ammunition item (module/poison.mjs): class, doses, and the coat button on an actor. */
function poisonCoatContext(item, editable) {
  const p = item.system.poison ?? {};
  const missiles = item.type === "ammunition";
  return { classes: [{ key: "", label: "—", selected: !p.class }, ...Object.keys(POISON.classes).map(k => ({ key: k, label: poisonLabel(k), selected: k === p.class }))],
    doses: p.doses ?? 0, canCoat: !!item.actor && editable,
    dosesLabel: missiles ? "AD2E.Poison.Missiles" : "AD2E.Poison.Doses", dosesHint: missiles ? "AD2E.Poison.MissilesHint" : "AD2E.Poison.DosesHint" };
}

export class WeaponSheet extends AD2EItemSheet {
  static DEFAULT_OPTIONS = { classes: ["weapon"], actions: { coatPoison: WeaponSheet.#onCoatPoison } };

  static #onCoatPoison() {
    return coatWithPoison(this.document);
  }
  static PARTS = { body: { template: "systems/ad2e/templates/item/weapon-sheet.hbs", scrollable: [""] } };

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const sys = this.document.system;
    context.weapon = weaponStats(sys.weapon);
    context.poisonCoat = poisonCoatContext(this.document, this.isEditable);
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
    context.elementOptions = ["", "flame", "sand", "sea", "wind"].map(value => ({ value, selected: value === (sys.element ?? ""),
      label: value ? game.i18n.localize(`AD2E.Elemental.Province.${value}`) : "—" }));
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
  static DEFAULT_OPTIONS = { classes: ["ammunition"], actions: { coatPoison: AmmunitionSheet.#onCoatPoison } };

  static #onCoatPoison() {
    return coatWithPoison(this.document);
  }
  static PARTS = { body: { template: "systems/ad2e/templates/item/ammunition-sheet.hbs", scrollable: [""] } };

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    context.launchersText = [...this.document.system.launchers].join(", ");
    context.poisonCoat = poisonCoatContext(this.document, this.isEditable);
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
  static DEFAULT_OPTIONS = { classes: ["equipment"], actions: { springTrap: EquipmentSheet.#onSpringTrap } };
  static PARTS = { body: { template: "systems/ad2e/templates/item/equipment-sheet.hbs", scrollable: [""] } };

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    context.categories = AD2E.equipmentCategories;
    context.summary = equipmentSummary(this.document.system);
    context.isComponent = this.document.system.category === "component";
    context.trap = trapContext(this.document);
    const cls = this.document.system.poison?.class ?? "";
    context.poisonItem = this.document.system.category === "poison"
      ? [{ key: "", label: "—", selected: !cls }, ...Object.keys(POISON.classes).map(k => ({ key: k, label: poisonLabel(k), selected: k === cls }))] : null;
    return context;
  }

  static #onSpringTrap() {
    return game.user?.isGM ? springTrap(this.document) : null;
  }
}

export class SpellSheet extends AD2EItemSheet {
  static DEFAULT_OPTIONS = { classes: ["spell"], actions: { toggleConsumed: SpellSheet.#onToggleConsumed,
    removeMaterial: SpellSheet.#onRemoveMaterial, addMaterial: SpellSheet.#onAddMaterial,
    addDamage: SpellSheet.#onAddDamage, removeDamage: SpellSheet.#onRemoveDamage } };

  /** Damage and healing options: rows of form fields `dmg.<n>.*` (see _processFormData); added and removed by actions. */
  static #onAddDamage() {
    const list = foundry.utils.deepClone(this.document.system.damage ?? []);
    return this.document.update({ "system.damage": [...list, { label: "", formula: "", kind: "damage", perRound: false }] });
  }

  static #onRemoveDamage(event, target) {
    const i = Number(target.dataset.index);
    return this.document.update({ "system.damage": (this.document.system.damage ?? []).filter((_, n) => n !== i) });
  }

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
    context.saveTypes = ["par", "rsw", "pet", "br", "sp"].map(key => ({ key, label: game.i18n.localize(`AD2E.Save.${key}`), selected: key === (sys.saveType ?? "sp") }));
    // Material component links (module/importers/spell-components.mjs).
    context.materials = (sys.materials ?? []).map((m, index) => ({ ...m, index }));
    context.materialChoices = sys.components.material ? await SpellSheet.catalog() : [];
    context.damageRows = (sys.damage ?? []).map((d, index) => ({ ...d, index }));
    context.damageKinds = { damage: "AD2E.Weapon.Damage", healing: "AD2E.Spell.Healing" };
    return context;
  }

  /** Schools, spheres and sources are edited as comma-separated text. */
  _processFormData(event, form, formData) {
    const data = parseClassesText(super._processFormData(event, form, formData), ["schools", "spheres", "sources", "provinces"]);
    // Damage rows (dmg.<n>.label/formula/kind/perRound) back into the list, in order.
    if (data.dmg) {
      const rows = Object.entries(data.dmg).sort((a, b) => Number(a[0]) - Number(b[0])).map(([, d]) => ({ label: String(d.label ?? "").trim(),
        formula: String(d.formula ?? "").trim(), kind: d.kind === "healing" ? "healing" : "damage", perRound: !!d.perRound }));
      delete data.dmg;
      foundry.utils.setProperty(data, "system.damage", rows);
    }
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

export class TraitSheet extends AD2EItemSheet {
  static DEFAULT_OPTIONS = { classes: ["trait"] };
  static PARTS = { body: { template: "systems/ad2e/templates/item/trait-sheet.hbs", scrollable: [""] } };

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const sys = this.document.system;
    const i18n = k => game.i18n.localize(k);
    context.isTrait = sys.kind === "trait";
    context.kindOptions = ["trait", "disadvantage"].map(value => ({ value, label: i18n(`AD2E.Trait.KindLabel.${value}`), selected: value === sys.kind }));
    context.severityOptions = ["moderate", "severe"].map(value => ({ value, label: i18n(`AD2E.Trait.${value === "moderate" ? "Moderate" : "Severe"}`),
      selected: value === sys.severity }));
    context.raceText = (sys.race ?? []).map(r => game.i18n.format(context.isTrait ? "AD2E.Trait.RaceCost" : "AD2E.Trait.RacePoints",
      { race: r.race, n: Math.abs(r.delta) })).join(" ");
    context.modifiers = (sys.modifiers ?? []).map(m => formatKitModifier(m));
    return context;
  }
}
