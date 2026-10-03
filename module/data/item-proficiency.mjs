import { AD2E } from "../config.mjs";

const { ArrayField, BooleanField, NumberField, SchemaField, StringField, SetField } = foundry.data.fields;

const text = () => new StringField({ required: true, blank: true, nullable: true, initial: null });

/**
 * Item type "proficiency": a weapon or nonweapon proficiency.
 * Check (nonweapon): 1d20 <= ability (effective score) + modifier; a 20 always fails
 * ("Nonweapon Proficiencies II (PHB)"). `ability` null = no check.
 * `grantedBy`: on an owned copy, the identifier of the kit that granted it as a bonus (costs no slots).
 * `weapon` (weapon proficiencies; generated from Weapon List (PHB) and Table 45): size, type, speed factor,
 * damage options (vs. small/medium and large), melee/missile use, range in yards, family (bow, crossbow,
 * other), the Table 35 column for missile use, and how Strength applies to missile use.
 * `specialized`: on an owned copy, weapon specialization (Weapon Specialization (PHB); fighters only).
 */
export default class ProficiencyData extends foundry.abstract.TypeDataModel {
  static defineSchema() {
    return {
      identifier: new StringField({ required: true, blank: true, initial: "" }),
      kind: new StringField({ required: true, initial: "nonweapon", choices: AD2E.proficiencyKinds }),
      slots: new NumberField({ required: true, integer: true, min: 0, initial: 1, nullable: false }),
      ability: new StringField({ required: false, blank: true, nullable: true, initial: null, choices: AD2E.abilityLabels }),
      modifier: new NumberField({ integer: true, nullable: true, initial: 0 }),
      groups: new SetField(new StringField({ choices: AD2E.nonweaponGroups })),
      sp: new SchemaField({
        ability: new StringField({ initial: "" }),
        rating: new NumberField({ integer: true, nullable: true, initial: null }),
        cost: new NumberField({ integer: true, nullable: true, initial: null })
      }),
      weapon: new SchemaField({
        size: text(),
        type: text(),
        speed: new NumberField({ integer: true, nullable: true, initial: null }),
        damage: new ArrayField(new SchemaField({
          label: new StringField({ initial: "" }),
          sm: text(),
          l: text()
        })),
        melee: new BooleanField({ initial: false }),
        missile: new BooleanField({ initial: false }),
        range: new SchemaField({
          rof: new StringField({ initial: "" }),
          short: new StringField({ initial: "" }),
          medium: new StringField({ initial: "" }),
          long: new StringField({ initial: "" })
        }),
        family: new StringField({ initial: "other", choices: ["bow", "crossbow", "other"] }),
        missileColumn: new StringField({ initial: "" }),
        strength: new StringField({ initial: "full", choices: ["full", "damage", "penalty", "none"] })
      }),
      specialized: new BooleanField({ initial: false }),
      source: new StringField({ initial: "" }),
      grantedBy: new StringField({ initial: "" }),
      url: new StringField({ initial: "" }),
      notes: new StringField({ initial: "" })
    };
  }
}
