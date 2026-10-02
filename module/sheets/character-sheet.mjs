import { AD2E } from "../config.mjs";

const { HandlebarsApplicationMixin } = foundry.applications.api;
const { ActorSheetV2 } = foundry.applications.sheets;

export default class CharacterSheet extends HandlebarsApplicationMixin(ActorSheetV2) {
  static DEFAULT_OPTIONS = {
    classes: ["ad2e", "character"],
    position: { width: 640, height: 720 },
    form: { submitOnChange: true },
    actions: {
      rollAbility: CharacterSheet.onRollAbility,
      rollSave: CharacterSheet.onRollSave,
      rollAttack: CharacterSheet.onRollAttack
    }
  };

  static PARTS = {
    body: { template: "systems/ad2e/templates/actor/character.hbs" }
  };

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
    context.alignments = AD2E.alignments;
    context.classGroups = AD2E.classGroups;
    context.editable = this.isEditable;
    return context;
  }

  static onRollAbility(event, target) {
    return this.document.rollAbilityCheck(target.dataset.ability);
  }

  static onRollSave(event, target) {
    return this.document.rollSave(target.dataset.save);
  }

  static onRollAttack(event, target) {
    return this.document.rollAttack({ missile: target.dataset.missile === "true" });
  }
}
