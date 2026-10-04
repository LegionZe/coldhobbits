import { AD2E } from "../config.mjs";
import { containerPreUpdate } from "../containers.mjs";

const { BooleanField, NumberField, SchemaField, StringField } = foundry.data.fields;

const optional = (integer = false) => new NumberField({ min: 0, integer, nullable: true, initial: null });

/**
 * Item type "magic": a magical item other than armour and weapons (those are armour and weapon items with a magical
 * bonus). `category` = DMG Table 88 category (Tables 89-104). `charges` (wands, staves, rods and the like; max null =
 * none): each use spends one; `charges.formula` = charges when found (wands 1d20+80, rods 1d10+40, staves 1d6+19:
 * "Wands (DMG)", "Rods (DMG)", "Staves (DMG)"), rolled from the item sheet. Potions, scrolls and
 * dusts are used up one at a time from `quantity`. `xpValue` / `gpValue`: the DMG item tables' XP value (for making the
 * item) and gp value. `identified` false: the item is unidentified. Weight counts toward encumbrance while `carried`.
 */
export default class MagicItemData extends foundry.abstract.TypeDataModel {
  static defineSchema() {
    return {
      identifier: new StringField({ required: true, blank: true, initial: "" }),
      category: new StringField({ required: true, initial: "potion", choices: AD2E.magicCategories }),
      quantity: new NumberField({ required: true, integer: true, min: 0, initial: 1, nullable: false }),
      weight: optional(),
      carried: new BooleanField({ initial: true }),
      equipped: new BooleanField({ initial: false }),
      // container (module/containers.mjs): stowage capacity; `weightless` = its contents add no weight (Bag of Holding,
      // Portable Hole)
      capacity: new SchemaField({ weight: optional(), volume: new StringField({ initial: "" }), weightless: new BooleanField({ initial: false }) }),
      charges: new SchemaField({
        value: new NumberField({ required: true, integer: true, min: 0, initial: 0, nullable: false }),
        max: optional(true),
        formula: new StringField({ initial: "" }) // charges when found, e.g. "1d20+80" (wands)
      }),
      usableBy: new StringField({ initial: "" }),
      identified: new BooleanField({ initial: true }),
      xpValue: optional(true),
      gpValue: optional(true),
      container: new StringField({ required: true, blank: true, initial: "" }), // id of the container item it is in (module/containers.mjs)
      url: new StringField({ initial: "" }),
      notes: new StringField({ initial: "" })
    };
  }

  /** Equipping takes the item out of its container; putting it into one stops using it (module/containers.mjs). */
  async _preUpdate(changes, options, user) {
    if ((await super._preUpdate(changes, options, user)) === false) return false;
    containerPreUpdate(changes, "magic", this);
  }

  /** Spent on use: a charge if the item has charges, otherwise one from the quantity for consumable categories. */
  get usesCharges() {
    return this.charges.max !== null;
  }

  get consumable() {
    return !this.usesCharges && AD2E.magicConsumable.includes(this.category);
  }
}
