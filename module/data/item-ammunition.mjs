import { poisonCoatField } from "./poison-fields.mjs";
import { applyIdentification, baseName, identifyFields } from "../identify.mjs";

const { NumberField, SchemaField, StringField, SetField } = foundry.data.fields;

const text = () => new StringField({ required: true, blank: true, nullable: true, initial: null });

/**
 * Item type "ammunition": arrows, quarrels, sling bullets/stones, blowgun darts/needles (Weapon List (PHB)).
 * `launchers`: identifiers of the weapons it is fired from. Firing a launcher uses one piece from the
 * chosen owned ammunition (quantity - 1); its damage replaces the launcher's damage options and its magical
 * `bonus` adds to attack and damage.
 */
export default class AmmunitionData extends foundry.abstract.TypeDataModel {
  static defineSchema() {
    return {
      identifier: new StringField({ required: true, blank: true, initial: "" }),
      launchers: new SetField(new StringField()),
      size: text(),
      type: text(),
      damage: new SchemaField({ sm: text(), l: text() }),
      cost: new StringField({ initial: "" }),
      weight: new NumberField({ min: 0, nullable: true, initial: null }),
      quantity: new NumberField({ required: true, integer: true, min: 0, initial: 1, nullable: false }),
      bonus: new SchemaField({
        hit: new NumberField({ required: true, integer: true, initial: 0, nullable: false }),
        dmg: new NumberField({ required: true, integer: true, initial: 0, nullable: false })
      }),
      // Poison on the missiles (module/poison.mjs): DMG Table 51 class and poisoned missiles left.
      poison: poisonCoatField(),
      container: new StringField({ required: true, blank: true, initial: "" }), // id of the container item it is in (module/containers.mjs)
      // Unidentified magical ammunition (module/identify.mjs).
      ...identifyFields(),
      source: new StringField({ initial: "" }),
      url: new StringField({ initial: "" }),
      notes: new StringField({ initial: "" })
    };
  }

  prepareDerivedData() {
    applyIdentification(this, baseName(this.parent?._source?.name ?? this.parent?.name), { url: "", notes: "" });
  }
}
