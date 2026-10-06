import { AD2E } from "../config.mjs";
import { weaponField } from "./weapon-fields.mjs";

const { BooleanField, NumberField, SchemaField, StringField, SetField } = foundry.data.fields;

/**
 * Item type "proficiency": a weapon or nonweapon proficiency.
 * Check (nonweapon): 1d20 <= ability (effective score) + modifier; a 20 always fails
 * ("Nonweapon Proficiencies II (PHB)"). `ability` null = no check.
 * `grantedBy`: on an owned copy, the identifier of the kit that granted it as a bonus (costs no slots).
 * `weapon` (weapon proficiencies): PHB weapon data, see weapon-fields.mjs.
 * `specialized`: on an owned copy, weapon specialization (Weapon Specialization (PHB); fighters only).
 * `extraSlots` (nonweapon): additional slots spent on the proficiency, +1 each to its checks ("For every additional
 * proficiency slot a character spends on a nonweapon proficiency, he gains a +1 bonus", Nonweapon Proficiencies II (PHB)).
 * `sp` (nonweapon): Skills & Powers Table 45 ability text, initial rating and CP cost (module/sp-proficiencies.mjs,
 * world setting "spProficiencies"; the cost is informational, character points are not used).
 * Skills & Powers (world setting "spWeapons", module/sp-weapons.mjs): weapon proficiencies also take `choice` (weapon of
 * choice), `expertise` and `mastery`; kinds "group" (`spGroup`: Table 49 group key), "style" (`style`: Table 52 key,
 * `improved`: the one-handed +2 AC / two weapons of equal size option), "armor" (`armorType`: body armour identifier)
 * and "shield" (`shieldType`: Table 51 shield type) use weapon proficiency slots.
 */
export default class ProficiencyData extends foundry.abstract.TypeDataModel {
  static defineSchema() {
    return {
      identifier: new StringField({ required: true, blank: true, initial: "" }),
      kind: new StringField({ required: true, initial: "nonweapon", choices: AD2E.proficiencyKinds }),
      slots: new NumberField({ required: true, integer: true, min: 0, initial: 1, nullable: false }),
      extraSlots: new NumberField({ required: true, integer: true, min: 0, initial: 0, nullable: false }),
      ability: new StringField({ required: false, blank: true, nullable: true, initial: null, choices: AD2E.abilityLabels }),
      modifier: new NumberField({ integer: true, nullable: true, initial: 0 }),
      groups: new SetField(new StringField({ choices: AD2E.nonweaponGroups })),
      sp: new SchemaField({
        ability: new StringField({ initial: "" }),
        rating: new NumberField({ integer: true, nullable: true, initial: null }),
        cost: new NumberField({ integer: true, nullable: true, initial: null })
      }),
      weapon: weaponField(),
      specialized: new BooleanField({ initial: false }),
      choice: new BooleanField({ initial: false }),
      expertise: new BooleanField({ initial: false }),
      mastery: new BooleanField({ initial: false }),
      spGroup: new StringField({ initial: "" }),
      style: new StringField({ initial: "" }),
      improved: new BooleanField({ initial: false }),
      armorType: new StringField({ initial: "" }),
      shieldType: new StringField({ initial: "" }),
      source: new StringField({ initial: "" }),
      grantedBy: new StringField({ initial: "" }),
      url: new StringField({ initial: "" }),
      notes: new StringField({ initial: "" })
    };
  }
}
