import { AD2E } from "../config.mjs";

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
    context.minimums = AD2E.abilities.map(key => ({
      key, label: game.i18n.localize(`AD2E.Ability.${key}`), value: system.min[key] ?? ""
    }));
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

export class KitSheet extends AD2EItemSheet {
  static DEFAULT_OPTIONS = { classes: ["kit"] };
  static PARTS = { body: { template: "systems/ad2e/templates/item/kit-sheet.hbs", scrollable: [""] } };

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    context.classesText = [...this.document.system.classes].join(", ");
    return context;
  }

  /** The class list is edited as comma-separated identifiers. */
  _processFormData(event, form, formData) {
    const data = super._processFormData(event, form, formData);
    if ("classesText" in data) {
      foundry.utils.setProperty(data, "system.classes",
        String(data.classesText).split(",").map(s => s.trim()).filter(Boolean));
      delete data.classesText;
    }
    return data;
  }
}
