import { AD2E } from "../config.mjs";
import { minimumsField } from "./item-class.mjs";

const { BooleanField, NumberField, ObjectField, SchemaField, StringField, SetField } = foundry.data.fields;

/**
 * Item type "race": a PHB player-character race.
 * `min`/`max` (PHB Table 7) are checked against the rolled scores; `adjust` (Table 8) is added
 * to give the effective scores. `classes` holds the class identifiers the race may take.
 * `conSaves`/`conPoison`: Table 9 Constitution bonus vs. rod/staff/wand and spells / vs. poison.
 * `levelLimits`: { classIdentifier: maxLevel | null } (null = unlimited).
 * `move`: base movement rate (PHB Table 64).
 * `multiClass`: allowed multi-class combinations, class identifiers joined by "/" (Multi-Class Combinations (PHB);
 *   tools/build-race-data.py), used with the world setting "multiClass" (module/multi-class.mjs).
 */
export default class RaceData extends foundry.abstract.TypeDataModel {
  static defineSchema() {
    return {
      identifier: new StringField({ required: true, blank: true, initial: "" }),
      min: minimumsField(),
      max: minimumsField(),
      adjust: new SchemaField(Object.fromEntries(AD2E.abilities.map(key =>
        [key, new NumberField({ required: true, integer: true, min: -5, max: 5, initial: 0, nullable: false })]))),
      classes: new SetField(new StringField()),
      kitClasses: new SetField(new StringField()), // classes available only through a kit listing this race
      conSaves: new BooleanField({ initial: false }),
      conPoison: new BooleanField({ initial: false }),
      move: new NumberField({ required: true, integer: true, min: 0, initial: 12, nullable: false }),
      infravision: new NumberField({ required: true, integer: true, min: 0, initial: 0, nullable: false }),
      infravisionByLineage: new BooleanField({ initial: false }),
      levelLimits: new ObjectField(),
      multiClass: new SetField(new StringField()),
      // Complete Bard's Handbook multi-class bards: combination ("bard/fighter") -> allowed bard kit identifiers.
      multiClassKits: new ObjectField(),
      url: new StringField({ initial: "" }),
      notes: new StringField({ initial: "" })
    };
  }
}
