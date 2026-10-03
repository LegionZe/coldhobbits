import { AD2E } from "../config.mjs";

const { HandlebarsApplicationMixin } = foundry.applications.api;

/** "dwarf 15, gnome 6" from a { race: maxLevel | null } map ("unlimited" for null). */
export function formatRaceLimits(limits) {
  return Object.entries(limits ?? {}).map(([race, max]) =>
    `${race} ${max ?? game.i18n.localize("AD2E.Race.Unlimited")}`).join(", ");
}

const signed = v => (v > 0 ? `+${v}` : `${v}`);
const pct = v => (v === null || v === undefined ? "—" : `${v}%`);
const plain = v => (v === null || v === undefined || v === "" ? "—" : `${v}`);
const ordinals = list => (list?.length ? list.map(n => `${n}`).join(", ") : "—");

/** Columns shown per ability: [lang key suffix, row -> display string]. */
const DETAIL_COLUMNS = {
  str: [
    ["hit", r => signed(r.hit)], ["dmg", r => signed(r.dmg)],
    ["weight", r => `${r.weight}`], ["press", r => `${r.press}`],
    ["openDoors", r => (r.openLocked ? `${r.openDoors} (${r.openLocked})` : `${r.openDoors}`)],
    ["bendBars", r => pct(r.bendBars)]
  ],
  dex: [["reaction", r => signed(r.reaction)], ["missile", r => signed(r.missile)], ["defense", r => signed(r.ac)]],
  con: [
    ["hp", r => (r.warrior !== r.hp ? `${signed(r.hp)} (${signed(r.warrior)})` : signed(r.hp))],
    ["systemShock", r => pct(r.systemShock)], ["resurrection", r => pct(r.resurrection)],
    ["poison", r => signed(r.poison)], ["regen", r => (r.regen ? `${r.regen.hp}/${r.regen.turns}` : "—")]
  ],
  int: [
    ["languages", r => `${r.languages}`], ["maxSpellLevel", r => plain(r.maxSpellLevel)],
    ["learnSpell", r => pct(r.learnSpell)], ["maxSpells", r => plain(r.maxSpells)],
    ["illusionImmunity", r => plain(r.illusionImmunity)]
  ],
  wis: [
    ["magicDef", r => signed(r.magicDef)], ["bonusSpells", r => ordinals(r.bonusSpells)],
    ["spellFailure", r => pct(r.spellFailure)], ["immunity", r => (r.immunity.length ? r.immunity.join(", ") : "—")]
  ],
  cha: [["henchmen", r => `${r.henchmen}`], ["loyalty", r => signed(r.loyalty)], ["reaction", r => signed(r.reaction)]]
};
const { ActorSheetV2 } = foundry.applications.sheets;

export default class CharacterSheet extends HandlebarsApplicationMixin(ActorSheetV2) {
  static DEFAULT_OPTIONS = {
    classes: ["ad2e", "character"],
    position: { width: 760, height: 760 },
    window: { resizable: true },
    form: { submitOnChange: true },
    actions: {
      rollAbility: CharacterSheet.onRollAbility,
      rollSave: CharacterSheet.onRollSave,
      rollTest: CharacterSheet.onRollTest,
      openItem: CharacterSheet.onOpenItem,
      rollFirstLevelHp: CharacterSheet.onRollFirstLevelHp,
      levelUp: CharacterSheet.onLevelUp,
      deleteItem: CharacterSheet.onDeleteItem,
      rollAttack: CharacterSheet.onRollAttack
    }
  };

  static PARTS = {
    header: { template: "systems/ad2e/templates/actor/character-header.hbs" },
    tabs: { template: "templates/generic/tab-navigation.hbs" },
    main: { template: "systems/ad2e/templates/actor/character-main.hbs", scrollable: [""] },
    class: { template: "systems/ad2e/templates/actor/character-class.hbs", scrollable: [""] },
    abilities: { template: "systems/ad2e/templates/actor/character-abilities.hbs", scrollable: [""] },
    bio: { template: "systems/ad2e/templates/actor/character-bio.hbs" }
  };

  static TABS = {
    primary: {
      tabs: [{ id: "main" }, { id: "class" }, { id: "abilities" }, { id: "bio" }],
      initial: "main",
      labelPrefix: "AD2E.Tab"
    }
  };

  /** Give each tab part its own ApplicationTab entry (same pattern as dnd5e WelcomeScreen). */
  async _preparePartContext(partId, context, options) {
    context = await super._preparePartContext(partId, context, options);
    if (context.tabs?.[partId]) context.tab = context.tabs[partId];
    return context;
  }

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    context.actor = this.document;
    context.system = this.document.system;
    const sys = this.document.system;
    context.abilities = AD2E.abilities.map(key => ({
      key,
      label: game.i18n.localize(`AD2E.Ability.${key}`),
      value: sys.abilities[key].value,
      total: sys.abilities[key].total,
      adjusted: sys.abilities[key].total !== sys.abilities[key].value,
      isStr: key === "str",
      exceptional: sys.abilities[key].exceptional
    }));
    context.saves = AD2E.saves.map(key => ({
      key,
      label: game.i18n.localize(`AD2E.Save.${key}`),
      value: sys.saves[key].value,
      table: sys.saves[key].table,
      override: sys.saves[key].override ?? "",
      overridden: sys.saves[key].override !== null,
      bonus: sys.saves[key].bonus,
      poison: key === "par" ? sys.raceInfo.poisonBonus : 0
    }));
    context.abilityDetails = AD2E.abilities.map(key => {
      const row = sys.abilityData[key];
      const score = sys.abilities[key].total;
      const exc = sys.abilities[key].exceptional;
      return {
        key,
        label: game.i18n.localize(`AD2E.Ability.${key}`),
        score: (key === "str" && score === 18 && exc > 0) ? `18/${exc === 100 ? "00" : String(exc).padStart(2, "0")}` : `${score}`,
        stats: DETAIL_COLUMNS[key].map(([col, fmt]) => ({
          label: game.i18n.localize(`AD2E.Table.${key}.${col}`),
          value: fmt(row)
        })),
        tests: Object.entries(AD2E.abilityTests)
          .filter(([, t]) => t.ability === key)
          .map(([testKey, t]) => ({
            key: testKey,
            label: game.i18n.localize(`AD2E.Test.${testKey}`),
            disabled: row[t.field] === null || row[t.field] === undefined
          }))
      };
    });
    context.alignments = AD2E.alignments;
    context.classTab = this._classTabContext(sys);
    context.classGroups = AD2E.classGroups;
    return context;
  }

  /** Display data for the class/kit items (header and Class tab). */
  _classTabContext(sys) {
    const info = sys.classInfo;
    const abilityLabel = key => game.i18n.localize(`AD2E.Ability.${key}`);
    const fmt = v => (v === null || v === undefined ? "—" : `${v}`);
    const cls = info.classItem?.system ?? null;
    const race = sys.raceInfo;
    return {
      raceItem: race.raceItem,
      race: race.race,
      raceRequirementsMet: race.requirementsMet,
      raceRows: race.requirements.map(r => ({
        label: abilityLabel(r.key), min: fmt(r.min), max: fmt(r.max),
        adjust: r.adjust ? (r.adjust > 0 ? `+${r.adjust}` : `${r.adjust}`) : "—",
        rolled: r.rolled, total: r.total, met: r.met
      })),
      infravision: race.race ? (race.race.infravisionByLineage ? game.i18n.localize("AD2E.Race.ByLineage")
        : (race.race.infravision ? `${race.race.infravision} ft` : "—")) : "",
      conSaveBonus: race.conSaveBonus,
      poisonBonus: race.poisonBonus,
      classAllowedByRace: info.classAllowedByRace,
      levelLimit: info.levelLimit,
      needsRaceKit: info.needsRaceKit,
      kitRaceLimits: formatRaceLimits(info.kitItem?.system.raceLimits),
      overLevelLimit: !!info.levelLimit && sys.level > info.levelLimit,
      classItem: info.classItem,
      kitItem: info.kitItem,
      kitFits: info.kitFits,
      cls,
      kit: info.kitItem?.system ?? null,
      groupLabel: game.i18n.localize(AD2E.classGroups[sys.classGroup]),
      hitDie: AD2E.hitDie[sys.classGroup],
      prime: cls ? [...cls.prime].map(abilityLabel).join(", ") : "",
      xpBonus: info.xpBonus,
      alignmentAllowed: info.alignmentAllowed,
      alignments: cls ? (cls.alignments.size === 9 ? game.i18n.localize("AD2E.Class.AnyAlignment")
        : [...cls.alignments].map(a => game.i18n.localize(AD2E.alignments[a])).join(", ")) : "",
      races: cls ? [...cls.races].join(", ") : "",
      requirements: info.requirements.map(r => ({
        label: abilityLabel(r.key), classMin: fmt(r.classMin),
        kitMin: r.kitMin === 0 ? game.i18n.localize("AD2E.Class.NoMinimum") : fmt(r.kitMin),
        score: r.score, met: r.met
      }))
    };
  }

  /**
   * Race, class and kit items: one of each per character. A race or class is refused if the
   * race does not allow the class. A dropped class replaces the current class (and drops a kit
   * that does not fit it); a kit must be open to the current class.
   */
  async _onDropItem(event, item) {
    if (!this.actor.isOwner || !["race", "class", "kit"].includes(item.type)) return super._onDropItem(event, item);
    if (item.parent === this.actor) return super._onDropItem(event, item); // sorting an owned item
    const current = this.actor.items;
    const raceItem = current.find(i => i.type === "race");
    const classItem = current.find(i => i.type === "class");
    const kitItem = current.find(i => i.type === "kit");
    const remove = [];
    const raceAllows = (race, classId) => race.system.classes.has(classId) || race.system.kitClasses?.has(classId);
    // Can this kit be used by this race for this class? (race-only kits; classes reached only through a kit)
    const kitOkForRace = (kit, race, classId) => {
      if (!race) return true;
      const listed = race.system.identifier in (kit.system.raceLimits ?? {});
      if (kit.system.raceOnly && !listed) return false;
      return race.system.classes.has(classId) || listed;
    };
    if (item.type === "race") {
      if (classItem && !raceAllows(item, classItem.system.identifier)) {
        ui.notifications.warn(game.i18n.format("AD2E.Race.ClassNotForRace", { class: classItem.name, race: item.name }));
        return null;
      }
      if (raceItem) remove.push(raceItem.id);
      if (kitItem && classItem && !kitOkForRace(kitItem, item, classItem.system.identifier)) remove.push(kitItem.id);
    } else if (item.type === "class") {
      if (raceItem && !raceAllows(raceItem, item.system.identifier)) {
        ui.notifications.warn(game.i18n.format("AD2E.Race.ClassNotForRace", { class: item.name, race: raceItem.name }));
        return null;
      }
      if (classItem) remove.push(classItem.id);
      if (kitItem && (!kitItem.system.classes.has(item.system.identifier)
        || !kitOkForRace(kitItem, raceItem, item.system.identifier))) remove.push(kitItem.id);
      if (raceItem && !raceItem.system.classes.has(item.system.identifier)) {
        ui.notifications.info(game.i18n.format("AD2E.Race.NeedsRaceKit", { class: item.name, race: raceItem.name }));
      }
    } else {
      if (!classItem) {
        ui.notifications.warn(game.i18n.localize("AD2E.Class.NeedClassFirst"));
        return null;
      }
      if (!item.system.classes.has(classItem.system.identifier)) {
        ui.notifications.warn(game.i18n.format("AD2E.Class.KitNotForClass",
          { kit: item.name, class: classItem.name }));
        return null;
      }
      if (!kitOkForRace(item, raceItem, classItem.system.identifier)) {
        ui.notifications.warn(game.i18n.format("AD2E.Race.KitNotForRace", { kit: item.name, race: raceItem.name }));
        return null;
      }
      if (kitItem) remove.push(kitItem.id);
    }
    if (remove.length) await this.actor.deleteEmbeddedDocuments("Item", remove);
    return super._onDropItem(event, item);
  }

  static async onRollFirstLevelHp() {
    if (this.actor.system.level > 1) {
      const ok = await foundry.applications.api.DialogV2.confirm({
        window: { title: game.i18n.localize("AD2E.HP.RollFirst") },
        content: `<p>${game.i18n.localize("AD2E.HP.ConfirmReset")}</p>`, rejectClose: false
      });
      if (!ok) return;
    }
    return this.actor.rollFirstLevelHitPoints();
  }

  static onLevelUp() {
    return this.actor.levelUp();
  }

  static onOpenItem(event, target) {
    return this.actor.items.get(target.dataset.itemId)?.sheet.render({ force: true });
  }

  static onDeleteItem(event, target) {
    return this.actor.items.get(target.dataset.itemId)?.delete();
  }

  static onRollAbility(event, target) {
    return this.document.rollAbilityCheck(target.dataset.ability);
  }

  static onRollTest(event, target) {
    return this.document.rollAbilityTest(target.dataset.test);
  }

  static onRollSave(event, target) {
    return this.document.rollSave(target.dataset.save);
  }

  static onRollAttack(event, target) {
    return this.document.rollAttack({ missile: target.dataset.missile === "true" });
  }
}
