import { AD2E } from "../config.mjs";

const { ArrayField, SchemaField, NumberField, StringField, SetField } = foundry.data.fields;

/** Per-ability minimum scores; null = no minimum. Shared by class and kit items. */
export function minimumsField() {
  return new SchemaField(Object.fromEntries(AD2E.abilities.map(key =>
    [key, new NumberField({ integer: true, min: 0, max: 25, nullable: true, initial: null })])));
}

/** Item type "class": a PHB class or specialist wizard. */
export default class ClassData extends foundry.abstract.TypeDataModel {
  static defineSchema() {
    return {
      identifier: new StringField({ required: true, blank: true, initial: "" }),
      group: new StringField({ required: true, initial: "warrior", choices: AD2E.classGroups }),
      min: minimumsField(),
      prime: new SetField(new StringField({ choices: AD2E.abilityLabels })),
      alignments: new SetField(new StringField({ choices: AD2E.alignments })),
      school: new StringField({ initial: "" }),
      opposition: new StringField({ initial: "" }),
      races: new SetField(new StringField()),
      // Weapons allowed (weapon proficiency names or identifiers), e.g. a specialty priest's; when set they replace the
      // class's generated list for the weapon warning (owner's ruling; CharacterData weaponRestriction).
      allowedWeapons: new ArrayField(new StringField()),
      url: new StringField({ initial: "" }),
      notes: new StringField({ initial: "" })
    };
  }
}
