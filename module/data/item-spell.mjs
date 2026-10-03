const { ArrayField, BooleanField, NumberField, SchemaField, StringField } = foundry.data.fields;

const text = () => new StringField({ initial: "" });

/**
 * Item type "spell": a wizard or priest spell (infobox of the AD&D 2e wiki page; mechanics and a link, no text).
 * On a character: `prepared` = times memorized for the day, `cast` = times cast since the last rest.
 */
export default class SpellData extends foundry.abstract.TypeDataModel {
  static defineSchema() {
    return {
      identifier: text(),
      kind: new StringField({ required: true, initial: "wizard", choices: ["wizard", "priest"] }),
      level: new NumberField({ required: true, integer: true, min: 0, initial: 1, nullable: false }),
      schools: new ArrayField(new StringField()),
      spheres: new ArrayField(new StringField()),
      reversible: new BooleanField({ initial: false }),
      components: new SchemaField({
        verbal: new BooleanField({ initial: true }),
        somatic: new BooleanField({ initial: true }),
        material: new BooleanField({ initial: false })
      }),
      range: text(), area: text(), castingTime: text(), duration: text(), save: text(),
      sources: new ArrayField(new StringField()),
      prepared: new NumberField({ required: true, integer: true, min: 0, initial: 0, nullable: false }),
      cast: new NumberField({ required: true, integer: true, min: 0, initial: 0, nullable: false }),
      url: text(),
      notes: text()
    };
  }
}
