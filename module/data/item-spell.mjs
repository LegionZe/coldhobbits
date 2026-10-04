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
      // Material components linked to component items by identifier (module/importers/spell-components.mjs; fixed on the
      // spell sheet): consumed = used up by casting, label = what the link stands for (e.g. "holy symbol").
      materials: new ArrayField(new SchemaField({ identifier: text(), name: text(), consumed: new BooleanField({ initial: true }),
        label: text() })),
      range: text(), area: text(), castingTime: text(), duration: text(), save: text(),
      sources: new ArrayField(new StringField()),
      // Wizard spells: understood and in the spell book (module/learn-spells.mjs); a failed roll records the level
      // ("they cannot check that spell again until they advance to the next level", Intelligence (PHB)).
      learned: new BooleanField({ initial: true }),
      learnFailedLevel: new NumberField({ integer: true, min: 0, nullable: true, initial: null }),
      prepared: new NumberField({ required: true, integer: true, min: 0, initial: 0, nullable: false }),
      cast: new NumberField({ required: true, integer: true, min: 0, initial: 0, nullable: false }),
      url: text(),
      notes: text()
    };
  }
}
