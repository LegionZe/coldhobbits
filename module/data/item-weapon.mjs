import { materialField } from "./material-field.mjs";
import { weaponField } from "./weapon-fields.mjs";
import { containerPreUpdate } from "../containers.mjs";
import { poisonCoatField } from "./poison-fields.mjs";
import { applyIdentification, baseName, identifyFields } from "../identify.mjs";

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
      // DMG Table 29 material for item saving throws ("" = guessed; module/item-saves.mjs).
      material: materialField(),
      proficiency: new StringField({ required: true, blank: true, initial: "" }),
      weapon: weaponField(),
      cost: new StringField({ initial: "" }),
      weight: new NumberField({ min: 0, nullable: true, initial: null }),
      quantity: new NumberField({ required: true, integer: true, min: 0, initial: 1, nullable: false }),
      equipped: new BooleanField({ initial: false }),
      dropped: new BooleanField({ initial: false }),
      // Bows: the Strength the bow is made for ("17", "18/50", "19"; blank = a standard bow: Strength penalties only).
      // "bows must be specially made to gain the bonus" (Strength (PHB)).
      bowStrength: new StringField({ required: true, blank: true, initial: "" }),
      // Elemental province of attacks with it (Al-Qadim; module/elemental.mjs, module/gens.mjs): "" or flame, sand, sea, wind.
      element: new StringField({ required: true, blank: true, initial: "", choices: ["", "flame", "sand", "sea", "wind"] }),
      bonus: new SchemaField({
        hit: new NumberField({ required: true, integer: true, initial: 0, nullable: false }),
        dmg: new NumberField({ required: true, integer: true, initial: 0, nullable: false })
      }),
      // Poison coating (module/poison.mjs): DMG Table 51 class and doses left.
      poison: poisonCoatField(),
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
    containerPreUpdate(changes, "weapon", this);
  }
}
