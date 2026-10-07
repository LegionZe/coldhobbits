const { ArrayField, NumberField, SchemaField, StringField } = foundry.data.fields;

/** DMG Table 51 poison classes ("Poison (DMG)", module/poison.mjs). */
export const POISON_CLASSES = "ABCDEFGHIJKLMNOP".split("");
export const POISON_DELIVERY = ["injected", "ingested", "contact"];

/** A poison class, "" = none (a choice field that may be empty needs `blank: true`). */
export function poisonClassField() {
  return new StringField({ required: true, blank: true, initial: "", choices: POISON_CLASSES });
}

/** Poison on a weapon or ammunition item: its class and the doses left (one dose per damage roll, implementation choice). */
export function poisonCoatField() {
  return new SchemaField({
    class: poisonClassField(),
    doses: new NumberField({ required: true, integer: true, min: 0, initial: 0, nullable: false })
  });
}

/**
 * Poison taking effect on an actor (module/poison.mjs): `pending` effects waiting for their onset (world time `at`;
 * `effect` damage | death | paralysis | debilitation, `formula` the damage), and the world times when paralysis and
 * debilitation end (null = not affected).
 */
export function poisonStateField() {
  return new SchemaField({
    pending: new ArrayField(new SchemaField({
      id: new StringField({ initial: "" }), cls: new StringField({ initial: "" }), source: new StringField({ initial: "" }),
      at: new NumberField({ initial: 0 }), effect: new StringField({ initial: "damage" }), formula: new StringField({ initial: "" })
    })),
    paralyzedUntil: new NumberField({ required: false, nullable: true, initial: null }),
    debilitatedUntil: new NumberField({ required: false, nullable: true, initial: null })
  });
}
