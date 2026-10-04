import { AD2E } from "../config.mjs";

const { BooleanField, NumberField, SchemaField, StringField } = foundry.data.fields;

const optional = () => new NumberField({ min: 0, nullable: true, initial: null });

/**
 * Item type "equipment": an entry of the PHB Table 44 equipment lists (clothing, food and lodging, provisions,
 * transport, animals, services, tack and harness, miscellaneous equipment). `weight` (lb, per unit; null = none
 * listed) counts toward encumbrance x quantity while `carried`. `capacity` = PHB Table 50 stowage capacity;
 * `load` = PHB Table 49 carrying capacity of an animal (most weight at full, 1/2 and 1/4 movement).
 */
export default class EquipmentData extends foundry.abstract.TypeDataModel {
  static defineSchema() {
    return {
      identifier: new StringField({ required: true, blank: true, initial: "" }),
      category: new StringField({ required: true, initial: "gear", choices: AD2E.equipmentCategories }),
      cost: new StringField({ initial: "" }),
      weight: optional(),
      quantity: new NumberField({ required: true, integer: true, min: 0, initial: 1, nullable: false }),
      carried: new BooleanField({ initial: true }),
      capacity: new SchemaField({ weight: optional(), volume: new StringField({ initial: "" }) }),
      load: new SchemaField({ full: optional(), half: optional(), quarter: optional() }),
      // Spell components (category "component", POSM Table 16): group, acquisition (FS / TM / SO / Auto), scarcity,
      // found in a wizard's laboratory, perishable.
      component: new SchemaField({ group: new StringField({ initial: "" }), acquisition: new StringField({ initial: "" }),
        scarcity: new StringField({ initial: "" }), laboratory: new BooleanField({ initial: false }),
        perishable: new BooleanField({ initial: false }) }),
      container: new StringField({ required: true, blank: true, initial: "" }), // id of the container item it is in (module/containers.mjs)
      source: new StringField({ initial: "" }),
      url: new StringField({ initial: "" }),
      notes: new StringField({ initial: "" })
    };
  }
}
