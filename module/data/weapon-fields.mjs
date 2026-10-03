const { ArrayField, BooleanField, NumberField, SchemaField, StringField } = foundry.data.fields;

const text = () => new StringField({ required: true, blank: true, nullable: true, initial: null });

/**
 * PHB weapon data shared by weapon proficiencies and weapon items (generated from Weapon List (PHB) and
 * Table 45): size, type, speed factor, damage options vs. small/medium and large (ammunition, or the bastard
 * sword's grips with their own speed factor), melee/missile use, range in yards, family (bow, crossbow, other),
 * the Table 35 column for missile use, and how Strength applies to missile use.
 */
export function weaponField() {
  return new SchemaField({
    size: text(),
    type: text(),
    speed: new NumberField({ integer: true, nullable: true, initial: null }),
    damage: new ArrayField(new SchemaField({
      label: new StringField({ initial: "" }),
      sm: text(),
      l: text(),
      speed: new NumberField({ integer: true, nullable: true, initial: null })
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
  });
}
