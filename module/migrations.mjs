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
