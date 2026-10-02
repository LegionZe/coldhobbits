import { AD2E } from "../config.mjs";

const { HandlebarsApplicationMixin } = foundry.applications.api;

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
      rollAttack: CharacterSheet.onRollAttack
    }
  };

  static PARTS = {
    header: { template: "systems/ad2e/templates/actor/character-header.hbs" },
    tabs: { template: "templates/generic/tab-navigation.hbs" },
    main: { template: "systems/ad2e/templates/actor/character-main.hbs", scrollable: [""] },
    abilities: { template: "systems/ad2e/templates/actor/character-abilities.hbs", scrollable: [""] },
    bio: { template: "systems/ad2e/templates/actor/character-bio.hbs" }
  };

  static TABS = {
    primary: {
      tabs: [{ id: "main" }, { id: "abilities" }, { id: "bio" }],
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
      isStr: key === "str",
      exceptional: sys.abilities[key].exceptional
    }));
    context.saves = AD2E.saves.map(key => ({
      key,
      label: game.i18n.localize(`AD2E.Save.${key}`),
      value: sys.saves[key].value
    }));
    context.abilityDetails = AD2E.abilities.map(key => {
      const row = sys.abilityData[key];
      const score = sys.abilities[key].value;
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
    context.classGroups = AD2E.classGroups;
    return context;
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
