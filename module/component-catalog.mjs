/**
 * Items a spell's material components can link to (owner's report 1.0.70: "Pearl (of at least 100 gp value)" missing from
 * the spell sheet's component list). The Spell Components compendium (POSM Table 16, tools/build-component-data.py) has no
 * pearl; the Gems compendium (DMG gem lists, tools/build-magic-item-data.py) has one ("Pearl", identifier "pearl", jewellery
 * item, class fancy). The catalog is both: components first, then gems whose name no component already has (implementation
 * choice; "Amber" is in both and stays the component). Used by the spell sheet (SpellSheet.catalog), the in-world spell
 * importer and tools/spell-items.mjs (module/importers/spell-components.mjs `matchComponents`); casting takes the caster's
 * equipment or jewellery item with the same identifier (module/components.mjs).
 */
export const CATALOG_PACKS = ["ad2e.components", "ad2e.gems"];

/** Merge component and gem entries ([{ identifier, name }]) (pure): components first, gems not already named. */
export function mergeCatalog(components, gems = []) {
  const out = components.filter(c => c.identifier && c.name);
  const names = new Set(out.map(c => c.name.toLowerCase()));
  const ids = new Set(out.map(c => c.identifier));
  for (const g of gems) {
    if (!g.identifier || !g.name || names.has(g.name.toLowerCase()) || ids.has(g.identifier)) continue;
    out.push({ identifier: g.identifier, name: g.name });
    names.add(g.name.toLowerCase()); ids.add(g.identifier);
  }
  return out;
}

let cache = null;

/** The catalog from the system compendiums (indexes read once per session). */
export async function componentCatalog() {
  if (cache) return cache;
  const read = async name => {
    const index = await game.packs?.get(name)?.getIndex({ fields: ["system.identifier"] });
    return [...(index ?? [])].map(e => ({ identifier: e.system?.identifier ?? "", name: e.name }));
  };
  const [components, gems] = await Promise.all(CATALOG_PACKS.map(read));
  cache = mergeCatalog(components, gems);
  return cache;
}
