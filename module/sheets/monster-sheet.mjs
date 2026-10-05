import { rollEncounterReaction } from "../reaction.mjs";
import { mountTrained } from "../combat-options.mjs";
import { pushMount, pushText } from "../animals.mjs";
import { jewellerySummary, magicSummary } from "./character-sheet.mjs";
import { promptHitPoints, temporaryHp } from "../health.mjs";
import { AD2E, armorSummary, equipmentSummary } from "../config.mjs";
import { containerContext, dragItemRow, dropOnContainer, guardDraggableInputs, inContainer, insideText } from "./containers-ui.mjs";

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
      pushMount: MonsterSheet.onPushMount,
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
      useMagicItem: MonsterSheet.onUseMagicItem,
      hpDamage: MonsterSheet.onHpDamage,
      hpHeal: MonsterSheet.onHpHeal,
      recoverTemp: MonsterSheet.onRecoverTemp,
      rollSurprise: MonsterSheet.onRollSurprise,
      rollUnarmed: MonsterSheet.onRollUnarmed,
      rollReaction: MonsterSheet.onRollReaction,
      takeOut: MonsterSheet.onTakeOut
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
    // Mounts: trained for combat (riders of untrained mounts -2 to hit, Unusual Combat Situations (DMG)).
    context.isMount = this.document.system.role === "mount";
    // Pushing a mount or pack animal (module/animals.mjs): the button and its current state.
    context.canPush = ["mount", "pack"].includes(this.document.system.role);
    context.pushText = pushText(this.document);
    context.trainedChoices = { yes: "AD2E.Mounted.Trained.yes", no: "AD2E.Mounted.Trained.no" };
    context.trainedAuto = game.i18n.localize(mountTrained(this.document) ? "AD2E.Mounted.Trained.autoYes" : "AD2E.Mounted.Trained.autoNo");
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
    // Elemental province of a natural attack (module/elemental.mjs).
    context.attackElements = { flame: "AD2E.Elemental.Province.flame", sand: "AD2E.Elemental.Province.sand",
      sea: "AD2E.Elemental.Province.sea", wind: "AD2E.Elemental.Province.wind" };
    const items = actor.items ?? [];
    const inv = sys.encumbrance.inventory;
    context.weapons = items.filter(i => i.type === "weapon").map(i => ({ id: i.id, name: i.name, img: i.img, url: i.system.url, key: `w${i.id}`,
      hit: i.system.bonus.hit, inside: insideText(inv, i), summary: i.system.weapon.damage.filter(d => d.sm || d.l)
        .map(d => `${d.label ? `${d.label}: ` : ""}${d.sm ?? "—"} / ${d.l ?? "—"}`).join("; ") }));
    context.armor = items.filter(i => i.type === "armor").map(i => ({ id: i.id, name: i.name, img: i.img, url: i.system.url,
      equipped: i.system.equipped, summary: armorSummary(i.system), inside: insideText(inv, i) }));
    context.gear = items.filter(i => ["equipment", "ammunition", "coin", "magic", "jewellery"].includes(i.type)).map(i => ({ id: i.id, name: i.name, img: i.img, url: i.system.url,
      quantity: i.system.quantity, isEquipment: ["equipment", "magic", "jewellery"].includes(i.type), isMagic: i.type === "magic", carried: i.system.carried,
      inside: insideText(inv, i), contained: inContainer(inv, i),
      summary: i.type === "equipment" ? equipmentSummary(i.system) : i.type === "magic" ? magicSummary(i)
        : i.type === "jewellery" ? jewellerySummary(i) : "" })).sort((a, b) => a.name.localeCompare(b.name));
    context.containers = containerContext(inv);
    const enc = sys.encumbrance;
    context.load = { ...sys.load, weight: enc.weight, rate: enc.rate, hasLoad: sys.load.full !== null,
      bandLabel: enc.band ? i18n(`AD2E.Monster.Load.${enc.band}`) : "", over: enc.band === "over",
      // A character riding this animal (module/animals.mjs): its body weight and gear are part of the load.
      riderText: enc.rider ? game.i18n.format(enc.rider.missingBody ? "AD2E.Animal.RiderOnMountNoBody" : "AD2E.Animal.RiderOnMount",
        { name: enc.rider.name, body: enc.rider.body ?? 0, gear: enc.rider.gear, own: enc.own }) : "",
      riderMissingBody: !!enc.rider?.missingBody };
    context.hd = sys.hd;
    // Header link to the stat block's source page (completecompendium.com for imported monsters).
    // Wage (hirelings) or price (mounts); shown for those roles or whenever one is set.
    context.showCost = ["hireling", "mount", "pack"].includes(sys.role) || !!sys.cost;
    context.dead = sys.hpState?.state === "dead";
    context.knockedOut = !!sys.hpState?.knockedOut;
    context.temporary = temporaryHp(sys.hp);
    context.sourceLabel = game.i18n.localize(/completecompendium\.com/.test(sys.url) ? "AD2E.Monster.CompleteCompendium" : "AD2E.Monster.SourcePage");
    context.hasAttacks = context.naturalAttacks.length + context.weapons.length > 0;
    return context;
  }

  /** Inputs inside draggable item rows do not start a drag. */
  _onRender(context, options) {
    super._onRender?.(context, options);
    guardDraggableInputs(this.element);
  }

  /** An item dropped on a container goes into it (module/sheets/containers-ui.mjs). */
  async _onDropItem(event, item) {
    const onContainer = await dropOnContainer(this, event, item, () => super._onDropItem(event, item));
    return onContainer === undefined ? super._onDropItem(event, item) : onContainer;
  }

  /** Item rows (`draggable`, `data-item-id`) drag the owned item. */
  async _onDragStart(event) {
    if (dragItemRow(this, event)) return;
    return super._onDragStart(event);
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

  static onPushMount() { return pushMount(this.document); }
  static onRollAttack(event, target) { return this.document.rollMonsterAttack(target.dataset.key); }
  static onRollUnarmed(event, target) { return this.document.rollUnarmed(target.dataset.form); }
  static onRollDamage(event, target) { return this.document.rollMonsterDamage(target.dataset.key); }
  static onRollMorale() { return this.document.rollMorale(); }
  static onRollHp() { return this.document.rollMonsterHitPoints(); }
  static onAddAttack() {
    return this.document.update({ "system.attacks": [...this.document.system.attacks, { name: "Attack", damage: "1d6", bonus: 0, element: "" }] });
  }
  static onRemoveAttack(event, target) {
    const attacks = [...this.document.system.attacks];
    attacks.splice(Number(target.dataset.index), 1);
    return this.document.update({ "system.attacks": attacks });
  }
  static onOpenItem(event, target) { return this.document.items.get(target.dataset.itemId)?.sheet.render({ force: true }); }
  static onTakeOut(event, target) { return this.document.items.get(target.dataset.itemId)?.update({ "system.container": "" }); }
  static onDeleteItem(event, target) { return this.document.items.get(target.dataset.itemId)?.delete(); }
  static onToggleEquipped(event, target) {
    return this.document.items.get(target.dataset.itemId)?.update({ "system.equipped": target.checked });
  }
  static onToggleCarried(event, target) {
    return this.document.items.get(target.dataset.itemId)?.update({ "system.carried": target.checked });
  }
  static onHpDamage() { return promptHitPoints(this.actor, false); }

  static onHpHeal() { return promptHitPoints(this.actor, true); }

  static onRecoverTemp() { return this.actor.recoverTemporary(); }

  static onRollSurprise() { return this.actor.rollSurprise(); }
  static onRollReaction() { return rollEncounterReaction(this.actor); }

  static onUseMagicItem(event, target) {
    return this.actor.useMagicItem(target.dataset.itemId);
  }

  static onAdjustQuantity(event, target) {
    const item = this.document.items.get(target.dataset.itemId);
    return item?.update({ "system.quantity": Math.max(item.system.quantity + Number(target.dataset.delta), 0) });
  }
}
