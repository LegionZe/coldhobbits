import { weaponField } from "./weapon-fields.mjs";

const { BooleanField, NumberField, SchemaField, StringField } = foundry.data.fields;

/**
 * Item type "weapon": a weapon from the PHB weapon list. `proficiency` is the identifier of the matching
 * weapon proficiency ("Each weapon listed in Table 44 (Weapons) requires its own proficiency", Weapon
 * Proficiencies (PHB)); an owner without it attacks at the Table 34 non-proficiency penalty, and an owner
 * specialized in it gets the specialization bonuses. `bonus` = magical attack/damage bonus. `equipped`: in hand (the
 * Combat tab lists equipped weapons); `dropped`: on the ground, not counted toward encumbrance until picked up.
 */
export default class WeaponData extends foundry.abstract.TypeDataModel {
  static defineSchema() {
    return {
      identifier: new StringField({ required: true, blank: true, initial: "" }),
      proficiency: new StringField({ required: true, blank: true, initial: "" }),
      weapon: weaponField(),
      cost: new StringField({ initial: "" }),
      weight: new NumberField({ min: 0, nullable: true, initial: null }),
      quantity: new NumberField({ required: true, integer: true, min: 0, initial: 1, nullable: false }),
      equipped: new BooleanField({ initial: false }),
      dropped: new BooleanField({ initial: false }),
      bonus: new SchemaField({
        hit: new NumberField({ required: true, integer: true, initial: 0, nullable: false }),
        dmg: new NumberField({ required: true, integer: true, initial: 0, nullable: false })
      }),
      source: new StringField({ initial: "" }),
      url: new StringField({ initial: "" }),
      notes: new StringField({ initial: "" })
    };
  }
}
