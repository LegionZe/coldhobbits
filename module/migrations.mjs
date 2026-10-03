/**
 * 0.0.20 stored coins as `system.currency.{pp,gp,ep,sp,cp}` on characters. Move them into coin items (from the
 * "Equipment (PHB)" compendium, merged into a stack of the same coin if one is owned) and zero the old fields.
 */
export async function migrateCurrency() {
  const actors = game.actors.filter(a => a.type === "character"
    && Object.values(a.system._source?.currency ?? a._source.system?.currency ?? {}).some(n => n > 0));
  if (!actors.length) return;
  const pack = game.packs.get("ad2e.equipment");
  const index = pack ? await pack.getIndex({ fields: ["system.identifier"] }) : [];
  for (const actor of actors) {
    const currency = actor._source.system.currency;
    const create = [];
    const update = [];
    for (const [key, n] of Object.entries(currency)) {
      if (!(n > 0)) continue;
      const owned = actor.items.find(i => i.type === "coin" && i.system.identifier === key);
      if (owned) {
        update.push({ _id: owned.id, "system.quantity": owned.system.quantity + n });
        continue;
      }
      const entry = index.find(e => e.system?.identifier === key);
      const data = entry ? (await pack.getDocument(entry._id)).toObject() : null;
      if (!data) continue;
      delete data._id;
      data.system.quantity = n;
      create.push(data);
    }
    if (create.length) await actor.createEmbeddedDocuments("Item", create);
    if (update.length) await actor.updateEmbeddedDocuments("Item", update);
    await actor.update(Object.fromEntries(Object.keys(currency).map(k => [`system.currency.${k}`, 0])));
    console.log(`AD2E | Moved coins on ${actor.name} into coin items`);
  }
}

/**
 * 0.0.31 added kit mechanics (system.modifiers, skillPoints, generated skillAdjust) to the "Class Kits" compendium.
 * Kit items copied into the world or onto characters before that have none: fill them from the compendium kit with
 * the same identifier. Only kits with no modifiers are touched; skill adjustments are filled only if all are 0, so
 * values a GM entered are kept.
 */
export async function migrateKitMechanics() {
  const pack = game.packs.get("ad2e.kits");
  if (!pack) return;
  const docs = await pack.getDocuments();
  const byId = new Map(docs.map(d => [d.system.identifier, d.system]));
  const patch = item => {
    const src = byId.get(item.system.identifier);
    if (!src || item.system.modifiers?.length) return null;
    const empty = !src.modifiers.length && src.skillPoints.first === null && !Object.values(src.skillAdjust).some(v => v);
    if (empty) return null;
    const update = { _id: item.id, "system.modifiers": foundry.utils.deepClone(src.modifiers),
      "system.skillPoints": { ...src.skillPoints } };
    if (!Object.values(item.system.skillAdjust ?? {}).some(v => v)) update["system.skillAdjust"] = { ...src.skillAdjust };
    return update;
  };
  const world = game.items.filter(i => i.type === "kit").map(patch).filter(Boolean);
  if (world.length) await Item.updateDocuments(world);
  for (const actor of game.actors) {
    const updates = actor.items.filter(i => i.type === "kit").map(patch).filter(Boolean);
    if (updates.length) {
      await actor.updateEmbeddedDocuments("Item", updates);
      console.log(`AD2E | Added kit mechanics to ${actor.name}`);
    }
  }
}
