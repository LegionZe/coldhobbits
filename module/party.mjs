/**
 * The party (owner's request, 1.0.42): the GM lists which actors travel together (module/apps/party-tracker.mjs). World
 * setting `party` (config false): { members: [actor UUIDs] } — world actors, or token actors of unlinked tokens (a
 * linked token's actor has its world actor's UUID). Used by the travel planner (default members), the dungeon turn
 * fatigue penalty, the group experience award (default recipients) and the encounter reaction speaker list.
 * Implementation choice: while the list is empty the party is every player-owned character, as before 1.0.42.
 */
const DEFAULT = { members: [] };

/** The stored member UUIDs (no duplicates, strings only). */
export function partyUuids(value) {
  const list = Array.isArray(value?.members) ? value.members : [];
  return [...new Set(list.filter(u => typeof u === "string" && u))];
}

/** The member list with `uuids` added at the end (pure; compendium documents are not party members). */
export function addMembers(list, uuids) {
  const out = [...list];
  for (const u of uuids) if (typeof u === "string" && u && !u.startsWith("Compendium.") && !out.includes(u)) out.push(u);
  return out;
}

/** The member list without `uuid` (pure). */
export const removeMember = (list, uuid) => list.filter(u => u !== uuid);

/** The member list with `uuid` moved by `step` places (pure). */
export function moveMember(list, uuid, step) {
  const i = list.indexOf(uuid);
  const j = i + step;
  if (i < 0 || j < 0 || j >= list.length) return [...list];
  const out = [...list];
  [out[i], out[j]] = [out[j], out[i]];
  return out;
}

/** Members resolved to actors (pure with `resolve`); missing ones are left out. */
export const resolveMembers = (uuids, resolve) => uuids.map(u => resolve(u)).filter(Boolean);

/** Whether `actor` belongs to the party (pure): listed by UUID, or a player-owned character while the list is empty. */
export function isMember(actor, uuids) {
  if (!actor) return false;
  if (uuids.length) return uuids.includes(actor.uuid);
  return actor.type === "character" && !!actor.hasPlayerOwner;
}

const resolveSync = u => (foundry.utils.fromUuidSync ?? globalThis.fromUuidSync)?.(u, { strict: false }) ?? null;

/** The stored member UUIDs (empty before the setting is registered). */
export function partyList() {
  try { return partyUuids(game.settings.get("ad2e", "party")); } catch { return []; }
}

/** Whether the GM has listed a party. */
export const partyDefined = () => partyList().length > 0;

/** Whether `actor` belongs to the party (the listed members, else player-owned characters). */
export const inParty = actor => isMember(actor, partyList());

/** The party's actors: the listed members, else (with `fallback`) every player-owned character. */
export function partyActors({ fallback = true } = {}) {
  const list = partyList();
  if (list.length) return resolveMembers(list, resolveSync);
  return fallback ? (game.actors?.filter?.(a => a.type === "character" && a.hasPlayerOwner) ?? []) : [];
}

export async function setParty(members) {
  await game.settings.set("ad2e", "party", { members: partyUuids({ members }) });
}

export const addToParty = uuids => setParty(addMembers(partyList(), uuids));
export const removeFromParty = uuid => setParty(removeMember(partyList(), uuid));

export function registerParty() {
  game.settings.register("ad2e", "party", { scope: "world", config: false, type: Object, default: { ...DEFAULT },
    onChange: () => Hooks.callAll("ad2eParty") });
  // A deleted world actor leaves the party (active GM).
  Hooks.on("deleteActor", actor => {
    if (!game.users?.activeGM?.isSelf || !partyList().includes(actor.uuid)) return;
    removeFromParty(actor.uuid);
  });
}
