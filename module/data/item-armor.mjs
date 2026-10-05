import { AD2E } from "../config.mjs";
import { containerPreUpdate } from "../containers.mjs";
import { applyIdentification, baseName, identifyFields } from "../identify.mjs";

const { BooleanField, NumberField, SchemaField, StringField } = foundry.data.fields;

/**
 * Item type "armor": body armour, shield or helmet (Armor List (PHB)).
 * Body armour: `ac` = PHB Table 46 AC rating. Shield: improves AC by `shield.melee` (and `shield.missile`
 * against missiles) against front and flank attacks, up to `shield.attacks` attacks per round (null = any).
 * Helmets have no AC effect in the PHB (the price of a suit of armour includes a helmet).
 * `bonus` = magical bonus (lowers AC). Only `equipped` items count.
 */
export default class ArmorData extends foundry.abstract.TypeDataModel {
  static defineSchema() {
    return {
      identifier: new StringField({ required: true, blank: true, initial: "" }),
      kind: new StringField({ required: true, initial: "body", choices: AD2E.armorKinds }),
      ac: new NumberField({ integer: true, min: -10, max: 10, nullable: true, initial: null }),
      shield: new SchemaField({
        melee: new NumberField({ required: true, integer: true, min: 0, initial: 0, nullable: false }),
        missile: new NumberField({ required: true, integer: true, min: 0, initial: 0, nullable: false }),
        attacks: new NumberField({ integer: true, min: 1, nullable: true, initial: null })
      }),
      bonus: new NumberField({ required: true, integer: true, initial: 0, nullable: false }),
      // Size the armour was made for ("" = made for its wearer). "the armor of a giant is of little use to anyone";
      // small armour weighs half, large 50% more (Armor (PHB)). blank must be explicit with choices.
      size: new StringField({ initial: "", blank: true, choices: ["S", "M", "L"] }),
      equipped: new BooleanField({ initial: false }),
      cost: new StringField({ initial: "" }),
      weight: new NumberField({ min: 0, nullable: true, initial: null }),
      container: new StringField({ required: true, blank: true, initial: "" }),
      // Unidentified magical weapon/armour (module/identify.mjs): shown by its unidentified (or base) name.
      ...identifyFields(), // id of the container item it is in (module/containers.mjs)
      source: new StringField({ initial: "" }),
      url: new StringField({ initial: "" }),
      notes: new StringField({ initial: "" })
    };
  }

  prepareDerivedData() {
    applyIdentification(this, baseName(this.parent?._source?.name ?? this.parent?.name), { url: "", notes: "" });
  }

  /** Equipping takes the item out of its container; putting it into one stops using it (module/containers.mjs). */
  async _preUpdate(changes, options, user) {
    if ((await super._preUpdate(changes, options, user)) === false) return false;
    containerPreUpdate(changes, "armor", this);
  }
}
