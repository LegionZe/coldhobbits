import { ITEM_SAVES } from "../rules/item-save-tables.mjs";

const { StringField } = foundry.data.fields;

/** DMG Table 29 material of a physical item ("" = guessed from the item, module/item-saves.mjs). */
export function materialField() {
  return new StringField({ required: true, blank: true, initial: "", choices: ITEM_SAVES.materials });
}
