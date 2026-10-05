/**
 * Unidentified magical items (magic, weapon and armour items; treasure is found unidentified, module/treasure.mjs).
 * As dnd5e's IdentifiableTemplate (prepareIdentifiable: "this.parent.name = this.unidentified.name"): while
 * `identified` is false the item's displayed name is `unidentifiedName` (or a generic name), its source name is kept.
 * For players (not the GM) the derived display fields that would give it away are blanked: source link, notes, XP and gp
 * value, usable-by; sheets hide magical bonuses and charges (`system.hidden`). Mechanics are unchanged: a magical
 * bonus still applies. Only the GM can tick Identified.
 */
const { BooleanField, StringField } = foundry.data.fields;

/** Schema fields: { identified, unidentifiedName }. */
export function identifyFields() {
  return {
    identified: new BooleanField({ initial: true }),
    unidentifiedName: new StringField({ required: true, blank: true, initial: "" })
  };
}

/** Whether the current user is the GM (true before a user exists, e.g. while loading). */
export function viewerIsGM() {
  const user = globalThis.game?.user;
  return !user || !!user.isGM;
}

/**
 * Apply the unidentified state in prepareDerivedData: displayed name, and for players the blanked display fields.
 * @param {TypeDataModel} data
 * @param {string} fallback   generic name when no unidentified name is set
 * @param {Object<string, *>} blanks  field -> value shown to players
 */
export function applyIdentification(data, fallback, blanks = {}) {
  data.hidden = false;
  if (data.identified !== false) return;
  if (data.parent) data.parent.name = data.unidentifiedName || fallback;
  if (viewerIsGM()) return;
  data.hidden = true;
  for (const [k, v] of Object.entries(blanks)) data[k] = v;
}

/** A weapon or armour item's base name: its source name without a magical bonus ("Long sword +2" -> "Long sword"). */
export function baseName(name) {
  return String(name ?? "").replace(/\s*[+-]\d+.*$/, "").trim() || String(name ?? "");
}

/** Sheet context: { sourceName, hidden, isGM } (the name input shows the source name to the GM). */
export function identifyContext(item) {
  return { sourceName: item._source?.name ?? item.name, hidden: !!item.system?.hidden, isGM: viewerIsGM() };
}
