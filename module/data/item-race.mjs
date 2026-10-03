import { AD2E } from "../config.mjs";
import { minimumsField } from "./item-class.mjs";

const { BooleanField, NumberField, SchemaField, StringField, SetField } = foundry.data.fields;

/**
 * Item type "race": a PHB player-character race.
 * `min`/`max` (PHB Table 7) are checked against the rolled scores; `adjust` (Table 8) is added
 * to give the effective scores. `classes` holds the class identifiers the race may take.
 * `conSaves`/`conPoison`: Table 9 Constitution bonus vs. rod/staff/wand and spells / vs. poison.
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
      conSaves: new BooleanField({ initial: false }),
      conPoison: new BooleanField({ initial: false }),
      infravision: new NumberField({ required: true, integer: true, min: 0, initial: 0, nullable: false }),
      infravisionByLineage: new BooleanField({ initial: false }),
      url: new StringField({ initial: "" }),
      notes: new StringField({ initial: "" })
    };
  }
}
