import { minimumsField } from "./item-class.mjs";

const { BooleanField, ObjectField, StringField, SetField } = foundry.data.fields;

/**
 * Item type "kit": a class kit. `classes` holds class identifiers the kit is open to.
 * `min` overrides the class minimum per ability (0 removes it; null keeps the class value).
 * `raceLimits`: { raceIdentifier: maxLevel | null } for races this kit opens the class to (overrides the race's
 * own level limit); `raceOnly`: only the listed races may take the kit.
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
      url: new StringField({ initial: "" }),
      notes: new StringField({ initial: "" })
    };
  }
}
