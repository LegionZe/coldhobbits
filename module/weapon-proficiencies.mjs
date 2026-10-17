/**
 * Weapon proficiency choices for a weapon item (owner's request 1.0.68: a drop-down instead of typing the identifier on the
 * weapon sheet). A weapon links its proficiency by identifier (`system.proficiency`, e.g. "long-sword"); the list is every
 * weapon proficiency (proficiency items of kind "weapon") in the Item compendiums (indexes read once per session), in the
 * world's Items directory and on the weapon's own actor. An identifier not found there stays selected, marked, so opening the
 * sheet never changes a weapon's link (implementation choice).
 */
let packCache = null;

/** Weapon proficiencies in the Item compendiums: Map identifier -> name (read once). */
async function packProficiencies() {
  if (packCache) return packCache;
  const found = new Map();
  for (const pack of game.packs ?? []) {
    if (pack.documentName !== "Item") continue;
    try {
      const index = await pack.getIndex({ fields: ["type", "system.identifier", "system.kind"] });
      for (const e of index) if (e.type === "proficiency" && e.system?.kind === "weapon" && e.system.identifier) found.set(e.system.identifier, e.name);
    } catch { /* an unreadable pack is skipped */ }
  }
  packCache = found;
  return found;
}

/** [{ identifier, name }] sorted by name: compendiums, then world items and the actor's items (these win on the name). */
export async function weaponProficiencyList(actor = null) {
  const found = new Map(await packProficiencies());
  const add = items => { for (const i of items ?? []) if (i.type === "proficiency" && i.system?.kind === "weapon" && i.system.identifier) found.set(i.system.identifier, i.name); };
  add(game.items?.contents ?? game.items);
  add(actor?.items?.contents ?? actor?.items);
  return [...found].map(([identifier, name]) => ({ identifier, name })).sort((a, b) => a.name.localeCompare(b.name));
}

/** Select options (pure): none, the list, and the current identifier if not in it. `t(key, data)` for labels. */
export function proficiencyOptions(list, current, t) {
  const cur = String(current ?? "");
  const options = [{ value: "", label: t("AD2E.Weapon.ProficiencyNone"), selected: !cur }];
  if (cur && !list.some(p => p.identifier === cur)) options.push({ value: cur, label: t("AD2E.Weapon.ProficiencyMissing", { id: cur }), selected: true });
  for (const p of list) options.push({ value: p.identifier, label: p.name, selected: p.identifier === cur });
  return options;
}
