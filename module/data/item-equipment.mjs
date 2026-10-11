import { materialField } from "./material-field.mjs";
import { AD2E } from "../config.mjs";
import { trapField } from "./trap-fields.mjs";
import { poisonClassField } from "./poison-fields.mjs";
import { gallonsOf } from "../travel-days.mjs";

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
      // DMG Table 29 material for item saving throws ("" = guessed; module/item-saves.mjs).
      material: materialField(),
      category: new StringField({ required: true, initial: "gear", choices: AD2E.equipmentCategories }),
      cost: new StringField({ initial: "" }),
      weight: optional(),
      quantity: new NumberField({ required: true, integer: true, min: 0, initial: 1, nullable: false }),
      carried: new BooleanField({ initial: true }),
      capacity: new SchemaField({ weight: optional(), volume: new StringField({ initial: "" }) }),
      load: new SchemaField({ full: optional(), half: optional(), quarter: optional() }),
      // A liquid container (owner's ruling 1.0.29: a waterskin holds up to 1 gallon and weighs 9 lb full): what it holds,
      // its weight when full (lb, per unit; null = not a liquid container) and whether it is full (`unitWeight`).
      // A light source of PHB Table 63 burning down with world time (module/lights.mjs): lit, until (world time its fuel
      // ends while lit), left (seconds of fuel while out; null = fresh torch or candle, empty lantern), inches (a candle).
      light: new SchemaField({ lit: new BooleanField({ initial: false }), until: optional(), left: optional(), inches: optional() }),
      // `left` (1.0.37): gallons left in a filled container drunk from on the road (module/travel-days.mjs; null = full).
      liquid: new SchemaField({ volume: new StringField({ initial: "" }), fullWeight: optional(), full: new BooleanField({ initial: false }),
        left: optional() }),
      // Food carried on the road (module/travel-days.mjs, 1.0.37): days left in the opened unit (e.g. a week of dry
      // rations; null = unopened).
      supply: new SchemaField({ left: optional() }),
      // Spell components (category "component", POSM Table 16): group, acquisition (FS / TM / SO / Auto), scarcity,
      // found in a wizard's laboratory, perishable.
      component: new SchemaField({ group: new StringField({ initial: "" }), acquisition: new StringField({ initial: "" }),
        scarcity: new StringField({ initial: "" }), laboratory: new BooleanField({ initial: false }),
        perishable: new BooleanField({ initial: false }) }),
      container: new StringField({ required: true, blank: true, initial: "" }), // id of the container item it is in (module/containers.mjs)
      // Category "trap" (module/traps.mjs): a trap set on an object, e.g. a chest's poisoned needle.
      trap: trapField(),
      // Category "poison" (module/poison.mjs): DMG Table 51 class; quantity = doses.
      poison: new SchemaField({ class: poisonClassField() }),
      source: new StringField({ initial: "" }),
      url: new StringField({ initial: "" }),
      notes: new StringField({ initial: "" })
    };
  }

  /**
   * Weight of one unit for encumbrance: the full weight of a filled liquid container (in proportion to what is left when
   * partly drunk), otherwise `weight`.
   */
  get unitWeight() {
    const l = this.liquid;
    if (!(l?.full && l.fullWeight !== null && l.fullWeight !== undefined)) return this.weight;
    // `left` is what is left in the whole stack (module/travel-days.mjs): the weight per unit is the stack's average.
    const volume = gallonsOf(l.volume) * Math.max(this.quantity ?? 1, 1);
    if (l.left === null || l.left === undefined || !volume) return l.fullWeight;
    const empty = this.weight ?? 0;
    return Math.round((empty + (l.fullWeight - empty) * Math.min(Math.max(l.left / volume, 0), 1)) * 100) / 100;
  }
}
