import { AD2E } from "../config.mjs";

const { NumberField, StringField } = foundry.data.fields;

/**
 * Item type "coin": a stack of coins. `value` = worth of one coin in copper pieces (PHB Table 42 for the standard
 * coins; foreign coins can set their own). Coins of any metal weigh 50 to the pound (Treasure Tables (DMG)).
 */
export default class CoinData extends foundry.abstract.TypeDataModel {
  static defineSchema() {
    return {
      identifier: new StringField({ required: true, blank: true, initial: "" }),
      denomination: new StringField({ required: true, initial: "gp", choices: AD2E.coinDenominations }),
      value: new NumberField({ required: true, min: 0, initial: 100, nullable: false }),
      quantity: new NumberField({ required: true, integer: true, min: 0, initial: 1, nullable: false }),
      source: new StringField({ initial: "" }),
      url: new StringField({ initial: "" }),
      notes: new StringField({ initial: "" })
    };
  }
}
