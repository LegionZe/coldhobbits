/**
 * Priests praying for spells (owner's request 1.0.87): instead of owning every priest spell, a priest searches the spell
 * compendiums (and the world's spell items) for the spells its spheres and spell levels allow and adds them memorized;
 * a prayed spell leaves the sheet once its last memorized copy is cast. Rules (sphere-tables.mjs, Priest (PHB)): major
 * access = every spell of the sphere, minor access = 1st- to 3rd-level spells; the class's spheres (cleric, druid,
 * paladin, ranger), replaced by an Al-Qadim cleric kit's (kahin, ethoist, moralist, pragmatist, hakima, mystic; 1.0.88), by
 * the character's Complete Priest's Handbook priesthood when chosen (specialty priests, 1.0.88), and by the character's
 * own sphere fields when filled. Spheres a priesthood limits to some spells (`restricted`) are shown, not enforced.
 * Implementation choices: a spell with any accessible sphere is allowed (a spell in two spheres needs only one); a spell
 * with damage or healing options stays, used up, until the next rest so its roll can still be made; spells added by hand
 * (dropped on the sheet) are never removed; duplicates across compendiums are listed once (world items, then world
 * compendiums, then the system's).
 */
import { SPHERE_TABLES } from "./rules/sphere-tables.mjs";

const T = SPHERE_TABLES;

/** A sphere name as a key (pure): lower case, without "(...)" qualifiers; "protective" = protection. */
export function sphereKey(s) {
  const k = String(s ?? "").toLowerCase().replace(/\(.*?\)/g, "").trim();
  return k === "protective" ? "protection" : k;
}

/** A comma list of spheres (pure). */
export const splitSpheres = text => String(text ?? "").split(/[,;]/).map(sphereKey).filter(Boolean);

/** The character's kit identifier when the kit fits its class. */
export const kitId = system => (system?.classInfo?.kitFits ? system.classInfo.kitItem?.system?.identifier ?? "" : "");

/** Class identifiers of a character (main, multi-class others, dual-class previous). */
export function classIds(system) {
  return [system?.classInfo?.classItem?.system?.identifier, ...(system?.multi?.others ?? []).map(c => c.identifier),
    ...(system?.dualClass?.previous ?? []).map(p => p.identifier)].filter(Boolean);
}

/** A specialty priesthood by key (pure). */
export const priesthoodOf = key => T.priesthoods.find(p => p.key === key) ?? null;

/**
 * Sphere access (pure): the union of the classes' access (a cleric kit with spheres replaces the cleric's), replaced by
 * the chosen priesthood's, each list then replaced by the character's own when filled.
 * Returns { major: Set, minor: Set, source: "own" | "priesthood" | "kit" | "class" | "none", priesthood, restricted, choice }.
 */
export function sphereAccess(ids, own = {}, { kit = "" } = {}) {
  const major = new Set();
  const minor = new Set();
  const kitAccess = T.kits[kit] ?? null;
  for (const id of ids) {
    const a = id === "cleric" && kitAccess ? kitAccess : T.classes[id];
    for (const [set, list] of [[major, a?.major], [minor, a?.minor]]) for (const s of list ?? []) set.add(s);
  }
  let source = kitAccess && ids.includes("cleric") ? "kit" : null;
  const ph = priesthoodOf(own.priesthood);
  if (ph) {
    major.clear(); minor.clear();
    ph.major.forEach(s => major.add(s)); ph.minor.forEach(s => minor.add(s));
    source = "priesthood";
  }
  const ownMajor = splitSpheres(own.major);
  const ownMinor = splitSpheres(own.minor);
  if (ownMajor.length) { major.clear(); ownMajor.forEach(s => major.add(s)); }
  if (ownMinor.length) { minor.clear(); ownMinor.forEach(s => minor.add(s)); }
  for (const s of major) minor.delete(s);
  return { major, minor, source: ownMajor.length || ownMinor.length ? "own" : source ?? (major.size || minor.size ? "class" : "none"),
    priesthood: ph, restricted: ph?.restricted ?? [], choice: ph?.choice ?? [] };
}

/** Whether a spell's spheres and level fit the access (pure); no sphere data or no access: false. */
export function canPray(spheres, level, access) {
  const keys = (spheres ?? []).map(sphereKey);
  if (keys.some(k => access.major.has(k))) return true;
  return level <= T.minorMaxLevel && keys.some(k => access.minor.has(k));
}

/** The priest spell levels a character has slots for (pure over prepared data): [{ level, slots, prepared }]. */
export function priestLevels(spells) {
  return (spells?.levels ?? []).filter(l => (l.kind ?? spells.kind) === "priest" && l.slots > 0 && l.level >= 1)
    .map(l => ({ level: l.level, slots: l.slots, prepared: l.prepared }));
}

/** Whether a prayed spell is used up and leaves the sheet now (pure): nothing left, and no damage roll (unless resting). */
export function usedUp(system, { resting = false } = {}) {
  if ((system?.prepared ?? 0) <= 0) return true;
  if ((system.cast ?? 0) < system.prepared) return false;
  return resting || !(system.damage ?? []).some(d => d.formula);
}

/** Merge catalogue entries, the first of each name and level kept (pure). */
export function mergeEntries(groups) {
  const seen = new Set();
  const out = [];
  for (const e of groups.flat()) {
    const key = `${e.name.toLowerCase()}|${e.level}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(e);
  }
  return out.sort((a, b) => a.level - b.level || a.name.localeCompare(b.name));
}

let catalog = null;

/** Every priest spell the GM's world can see: world items, world compendiums, then the system's (cached; `fresh` reloads). */
export async function priestCatalog({ fresh = false } = {}) {
  if (catalog && !fresh) return catalog;
  const entry = (uuid, d, source) => ({ uuid, name: d.name, level: Number(d.system?.level) || 0, spheres: [...(d.system?.spheres ?? [])], source });
  const world = (game.items ?? []).filter(i => i.type === "spell" && i.system.kind === "priest")
    .map(i => entry(i.uuid, i, game.i18n.localize("AD2E.Prayer.WorldItems")));
  const packs = [...(game.packs ?? [])].filter(p => p.documentName === "Item");
  const groups = [[], []];
  for (const p of packs) {
    let index;
    try { index = await p.getIndex({ fields: ["type", "system.kind", "system.level", "system.spheres"] }); } catch { continue; }
    const list = [...index].filter(e => e.type === "spell" && e.system?.kind === "priest").map(e => entry(e.uuid ?? `Compendium.${p.collection}.Item.${e._id}`, e, p.title));
    groups[p.metadata?.packageType === "world" ? 0 : 1].push(...list);
  }
  catalog = mergeEntries([world, groups[0], groups[1]]);
  return catalog;
}

/** Add a spell from the catalogue to the priest, memorized `count` times (an owned copy of the same spell gains them). */
export async function praySpell(actor, uuid, count = 1) {
  const doc = await fromUuid(uuid);
  if (!doc || doc.type !== "spell") return null;
  const n = Math.max(Math.floor(Number(count) || 1), 1);
  const owned = actor.items.find(i => i.type === "spell" && i.system.kind === "priest" && i.name === doc.name && i.system.level === doc.system.level);
  if (owned) return owned.update({ "system.prepared": owned.system.prepared + n });
  const data = doc.toObject();
  delete data._id;
  delete data.folder;
  foundry.utils.mergeObject(data, { system: { prepared: n, cast: 0, learned: true }, flags: { ad2e: { prayed: true, prayedFrom: uuid } } });
  const [made] = await actor.createEmbeddedDocuments("Item", [data]);
  return made;
}

/** Remove the prayed spells that are used up (rest: also those kept for their damage roll). */
export async function clearUsedPrayers(actor, { resting = false } = {}) {
  const ids = actor.items.filter(i => i.type === "spell" && i.getFlag("ad2e", "prayed") && usedUp(i.system, { resting })).map(i => i.id);
  if (ids.length) await actor.deleteEmbeddedDocuments("Item", ids);
  return ids.length;
}

/**
 * A prayed spell whose memorized count is lowered to 0 on the Spells tab leaves the sheet (updateItem, the updater's
 * client). Casting clears used-up prayers at the end of the cast (AD2EActor#castNow), a disrupted casting in
 * spell-casting.mjs castingStruck, and a rest those kept for a damage roll.
 */
export function registerPrayer() {
  Hooks.on("updateItem", (item, changes, options, userId) => {
    if (userId !== game.user?.id || item.type !== "spell" || !item.getFlag?.("ad2e", "prayed") || !item.parent) return;
    if (!("prepared" in (changes.system ?? {})) || (item.system.prepared ?? 0) > 0) return;
    item.delete().catch(err => console.error("AD2E | prayed spell", err));
  });
}
