import { minimumsField } from "./item-class.mjs";

const { ArrayField, BooleanField, NumberField, ObjectField, SchemaField, StringField, SetField } = foundry.data.fields;

/** A proficiency entry: one of the listed proficiency identifiers (a single id = no choice). */
const proficiencyChoices = () => new ArrayField(new SchemaField({ choice: new ArrayField(new StringField()) }));

/**
 * Item type "kit": a class kit. `classes` holds class identifiers the kit is open to.
 * `min` overrides the class minimum per ability (0 removes it; null keeps the class value).
 * `raceLimits`: { raceIdentifier: maxLevel | null } for races this kit opens the class to (overrides the race's
 * own level limit); `raceOnly`: only the listed races may take the kit.
 * `bonusProficiencies`: granted free when the kit is added; `requiredProficiencies`: added too, but use slots.
 * `bonusSlots`: extra proficiency slots from the kit.
 */
export default class KitData extends foundry.abstract.TypeDataModel {
  static defineSchema() {
    return {
      identifier: new StringField({ required: true, blank: true, initial: "" }),
      classes: new SetField(new StringField()),
      source: new StringField({ initial: "" }),
      min: minimumsField(),
      otherRequirements: new BooleanField({ initial: false }),
      raceLimits: new ObjectField(),
      raceOnly: new BooleanField({ initial: false }),
      bonusProficiencies: proficiencyChoices(),
      requiredProficiencies: proficiencyChoices(),
      bonusSlots: new SchemaField({
        weapon: new NumberField({ required: true, integer: true, min: 0, initial: 0, nullable: false }),
        nonweapon: new NumberField({ required: true, integer: true, min: 0, initial: 0, nullable: false })
      }),
      url: new StringField({ initial: "" }),
      notes: new StringField({ initial: "" })
    };
  }
}
