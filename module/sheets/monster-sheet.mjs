import { jewellerySummary, magicSummary } from "./character-sheet.mjs";
import { AD2E, armorSummary, equipmentSummary } from "../config.mjs";

const { HandlebarsApplicationMixin } = foundry.applications.api;
const { ActorSheetV2 } = foundry.applications.sheets;

/** Habitat and background rows (Ecology tab), Monstrous Manual order; XP last. */
const ECOLOGY_FIELDS = ["climate", "frequency", "organization", "activity", "diet", "intelligence", "alignment",
  "treasure", "numberAppearing", "size", "xp"];

/** Sheet for monsters, hirelings, mounts and pets (actor type "monster"). */
export default class MonsterSheet extends HandlebarsApplicationMixin(ActorSheetV2) {
  static DEFAULT_OPTIONS = {
    classes: ["ad2e", "monster"],
    position: { width: 680, height: 720 },
    window: { resizable: true },
    form: { submitOnChange: true },
    actions: {
      rollSave: MonsterSheet.onRollSave,
      rollAttack: MonsterSheet.onRollAttack,
      rollDamage: MonsterSheet.onRollDamage,
      rollMorale: MonsterSheet.onRollMorale,
      rollHp: MonsterSheet.onRollHp,
      addAttack: MonsterSheet.onAddAttack,
      removeAttack: MonsterSheet.onRemoveAttack,
      openItem: MonsterSheet.onOpenItem,
      deleteItem: MonsterSheet.onDeleteItem,
      toggleEquipped: MonsterSheet.onToggleEquipped,
      toggleCarried: MonsterSheet.onToggleCarried,
      adjustQuantity: MonsterSheet.onAdjustQuantity,
      useMagicItem: MonsterSheet.onUseMagicItem
    }
  };

  static PARTS = {
    header: { template: "systems/ad2e/templates/actor/monster-header.hbs" },
    tabs: { template: "templates/generic/tab-navigation.hbs" },
    stats: { template: "systems/ad2e/templates/actor/monster-stats.hbs", scrollable: [""] },
    specials: { template: "systems/ad2e/templates/actor/monster-specials.hbs", scrollable: [""] },
    ecology: { template: "systems/ad2e/templates/actor/monster-ecology.hbs", scrollable: [""] },
    inventory: { template: "systems/ad2e/templates/actor/monster-inventory.hbs", scrollable: [""] },
    notes: { template: "systems/ad2e/templates/actor/monster-notes.hbs" }
  };

  static TABS = {
    primary: { tabs: [{ id: "stats" }, { id: "specials" }, { id: "ecology" }, { id: "inventory" }, { id: "notes" }], initial: "stats", labelPrefix: "AD2E.Monster.Tab" }
  };

  async _preparePartContext(partId, context, options) {
    context = await super._preparePartContext(partId, context, options);
    if (context.tabs?.[partId]) context.tab = context.tabs[partId];
    return context;
  }

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const actor = this.document;
    const sys = actor.system;
    const i18n = k => game.i18n.localize(k);
    context.actor = actor;
    context.system = sys;
    context.roles = AD2E.monsterRoles;
    context.saveGroups = AD2E.classGroups;
    context.ecology = ECOLOGY_FIELDS.map(key => ({ key, label: i18n(`AD2E.Monster.Field.${key}`), value: sys[key],
      type: key === "xp" ? "number" : "text" }));
    // Summary line: the figures needed at the table, read-only (edited on the tabs).
    const dash = v => (v === "" || v === null || v === undefined ? "—" : v);
    context.summary = [
      { label: "AC", value: sys.ac.value, tooltip: [sys.ac.text, sys.ac.armor].filter(Boolean).join(" · ") },
      { label: "THAC0", value: sys.thac0.value },
      { label: i18n("AD2E.Monster.HitDice"), value: dash(sys.hitDice), tooltip: sys.hd.formula },
      { label: i18n("AD2E.Move.Movement"), value: dash(sys.movement.text || sys.encumbrance.rate) },
      { label: i18n("AD2E.Monster.Field.attacksText"), value: dash(sys.attacksText) },
      { label: i18n("AD2E.Monster.Field.damageText"), value: dash(sys.damageText) },
      { label: i18n("AD2E.Monster.Morale"), value: sys.morale.value, tooltip: sys.morale.text },
      { label: i18n("AD2E.Monster.Field.numberAppearing"), value: dash(sys.numberAppearing) },
      { label: i18n("AD2E.Monster.Field.treasure"), value: dash(sys.treasure) },
      { label: "XP", value: sys.xp }
    ];
    context.saves = AD2E.saves.map(key => ({ key, label: i18n(`AD2E.Save.${key}`), value: sys.saves[key].value, level: sys.saves[key].level }));
    context.naturalAttacks = sys.attacks.map((a, index) => ({ ...a, index, key: `a${index}` }));
    const items = actor.items ?? [];
    context.weapons = items.filter(i => i.type === "weapon").map(i => ({ id: i.id, name: i.name, img: i.img, key: `w${i.id}`,
      hit: i.system.bonus.hit, summary: i.system.weapon.damage.filter(d => d.sm || d.l)
        .map(d => `${d.label ? `${d.label}: ` : ""}${d.sm ?? "—"} / ${d.l ?? "—"}`).join("; ") }));
    context.armor = items.filter(i => i.type === "armor").map(i => ({ id: i.id, name: i.name, img: i.img,
      equipped: i.system.equipped, summary: armorSummary(i.system) }));
    context.gear = items.filter(i => ["equipment", "ammunition", "coin", "magic", "jewellery"].includes(i.type)).map(i => ({ id: i.id, name: i.name, img: i.img,
      quantity: i.system.quantity, isEquipment: ["equipment", "magic", "jewellery"].includes(i.type), isMagic: i.type === "magic", carried: i.system.carried,
      summary: i.type === "equipment" ? equipmentSummary(i.system) : i.type === "magic" ? magicSummary(i)
        : i.type === "jewellery" ? jewellerySummary(i) : "" })).sort((a, b) => a.name.localeCompare(b.name));
    const enc = sys.encumbrance;
    context.load = { ...sys.load, weight: enc.weight, rate: enc.rate, hasLoad: sys.load.full !== null,
      bandLabel: enc.band ? i18n(`AD2E.Monster.Load.${enc.band}`) : "", over: enc.band === "over" };
    context.hd = sys.hd;
    // Header link to the stat block's source page (completecompendium.com for imported monsters).
    // Wage (hirelings) or price (mounts); shown for those roles or whenever one is set.
    context.showCost = ["hireling", "mount"].includes(sys.role) || !!sys.cost;
    context.sourceLabel = game.i18n.localize(/completecompendium\.com/.test(sys.url) ? "AD2E.Monster.CompleteCompendium" : "AD2E.Monster.SourcePage");
    context.hasAttacks = context.naturalAttacks.length + context.weapons.length > 0;
    return context;
  }

  /** Natural attacks are edited as system.attacks.<n>.<field>; the form sends an object, the schema wants an array. */
  _processFormData(event, form, formData) {
    const data = super._processFormData(event, form, formData);
    const attacks = foundry.utils.getProperty(data, "system.attacks");
    if (attacks && !Array.isArray(attacks)) {
      foundry.utils.setProperty(data, "system.attacks", Object.keys(attacks).sort((a, b) => a - b).map(k => attacks[k]));
    }
    return data;
  }

  static onRollSave(event, target) { return this.document.rollSave(target.dataset.save); }
  static onRollAttack(event, target) { return this.document.rollMonsterAttack(target.dataset.key); }
  static onRollDamage(event, target) { return this.document.rollMonsterDamage(target.dataset.key); }
  static onRollMorale() { return this.document.rollMorale(); }
  static onRollHp() { return this.document.rollMonsterHitPoints(); }
  static onAddAttack() {
    return this.document.update({ "system.attacks": [...this.document.system.attacks, { name: "Attack", damage: "1d6", bonus: 0 }] });
  }
  static onRemoveAttack(event, target) {
    const attacks = [...this.document.system.attacks];
    attacks.splice(Number(target.dataset.index), 1);
    return this.document.update({ "system.attacks": attacks });
  }
  static onOpenItem(event, target) { return this.document.items.get(target.dataset.itemId)?.sheet.render({ force: true }); }
  static onDeleteItem(event, target) { return this.document.items.get(target.dataset.itemId)?.delete(); }
  static onToggleEquipped(event, target) {
    return this.document.items.get(target.dataset.itemId)?.update({ "system.equipped": target.checked });
  }
  static onToggleCarried(event, target) {
    return this.document.items.get(target.dataset.itemId)?.update({ "system.carried": target.checked });
  }
  static onUseMagicItem(event, target) {
    return this.actor.useMagicItem(target.dataset.itemId);
  }

  static onAdjustQuantity(event, target) {
    const item = this.document.items.get(target.dataset.itemId);
    return item?.update({ "system.quantity": Math.max(item.system.quantity + Number(target.dataset.delta), 0) });
  }
}
