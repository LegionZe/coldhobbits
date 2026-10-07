import { POISON_DELIVERY, poisonClassField } from "./poison-fields.mjs";

const { NumberField, SchemaField, StringField } = foundry.data.fields;

/**
 * Trap data shared by trap actors (monster role "trap", e.g. a pit) and trap items (equipment category "trap", e.g. a
 * poisoned needle in a chest's lock; module/traps.mjs). `mode`: "thac0" (an attack roll at `thac0` against the victim's
 * AC; owner's ruling: THAC0 or a saving throw, chosen per trap) or "save" (the victim saves vs. `save`; `onSave` "none" or
 * "half"); `damage` dice on a hit or failed save; `effect`, `trigger`, `reset` as text; `modifier` = the find/remove
 * difficulty, up to +/-30% ("Advanced Locks and Traps (CTH)").
 */
export function trapField() {
  return new SchemaField({
    mode: new StringField({ required: true, initial: "save", choices: ["thac0", "save"] }),
    thac0: new NumberField({ required: true, integer: true, initial: 15, min: 1, max: 25, nullable: false }),
    save: new StringField({ required: true, initial: "par", choices: ["par", "rsw", "pet", "br", "sp"] }),
    onSave: new StringField({ required: true, initial: "none", choices: ["none", "half"] }),
    damage: new StringField({ initial: "" }),
    effect: new StringField({ initial: "" }),
    trigger: new StringField({ initial: "" }),
    reset: new StringField({ initial: "" }),
    // Poison (module/poison.mjs): DMG Table 51 class and how the trap delivers it.
    poison: poisonClassField(),
    poisonDelivery: new StringField({ required: true, initial: "injected", choices: POISON_DELIVERY }),
    modifier: new NumberField({ required: true, integer: true, initial: 0, min: -30, max: 30, nullable: false })
  });
}
