import { AD2E, gemBaseValue } from "../config.mjs";

const { BooleanField, NumberField, StringField } = foundry.data.fields;

/**
 * Item type "jewellery": gems, jewellery and other objects of art (DMG "Treasure Tables": Table 85 Gem Table, Table 87
 * Objects of Art). `value` = gp per piece; for a gem with no value entered, the Table 85 base value of its class is
 * used, and an uncut stone is worth 10% ("Uncut stones ... have their base value reduced to 10%"). Weight counts toward
 * encumbrance while `carried`.
 */
export default class JewelleryData extends foundry.abstract.TypeDataModel {
  static defineSchema() {
    return {
      identifier: new StringField({ required: true, blank: true, initial: "" }),
      kind: new StringField({ required: true, initial: "gem", choices: AD2E.treasureKinds }),
      // blank (no class: jewellery, objects of art) must be explicit when choices are given.
      gemClass: new StringField({ initial: "", blank: true, choices: AD2E.gemClasses }),
      uncut: new BooleanField({ initial: false }),
      value: new NumberField({ min: 0, nullable: true, initial: null }),
      quantity: new NumberField({ required: true, integer: true, min: 0, initial: 1, nullable: false }),
      weight: new NumberField({ min: 0, nullable: true, initial: null }),
      carried: new BooleanField({ initial: true }),
      container: new StringField({ required: true, blank: true, initial: "" }), // id of the container item it is in (module/containers.mjs)
      url: new StringField({ initial: "" }),
      notes: new StringField({ initial: "" })
    };
  }

  /** gp value of one piece: the entered value, else a gem's Table 85 class value (10% uncut); null if unknown. */
  get unitValue() {
    let v = this.value;
    if (v === null && this.kind === "gem") v = gemBaseValue(this.gemClass);
    if (v === null) return null;
    return this.uncut && this.value === null ? Math.round(v * AD2E.treasureTables.uncutFactor * 100) / 100 : v;
  }

  get totalValue() {
    const v = this.unitValue;
    return v === null ? null : Math.round(v * this.quantity * 100) / 100;
  }
}
