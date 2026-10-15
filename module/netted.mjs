/**
 * Netted creatures (owner's request 1.0.63; README limitation until then: "a trapped victim is described in chat, not
 * marked"). A hit with a net throw marks the first target with the status NET_STATUS; a hit looping the rope round also
 * records that the victim breaks free at -4 (Weapon Descriptions (POCT), COMBAT_TABLES.net, lasso.mjs). "Break free (net)"
 * pre-ticks the looped box and clears the mark on a success. The mark is set by the active GM (createChatMessage hook on
 * the net card's flag `ad2e.netHit` { targets: [uuid], wrapped }), since players cannot change other actors. The status
 * changes no roll by itself (the net's effects are described on the card; the GM rules on actions while netted).
 */
export const NET_STATUS = { id: "ad2e-netted", name: "AD2E.Net.Status", img: "systems/ad2e/styles/icons/netted.svg" };

/** Whether an actor is marked netted / has the rope looped round (actor flag `ad2e.netWrapped`). */
export const isNetted = actor => !!actor?.statuses?.has?.(NET_STATUS.id);
export const netWrapped = actor => !!actor?.getFlag?.("ad2e", "netWrapped");

/** The chat flag for a net hit (pure): null when nothing was hit or there is no target. */
export function netHitFlag(mode, hit, targets) {
  if (!hit || !["throw", "wrap"].includes(mode)) return null;
  const uuid = targets?.[0]?.uuid;
  return uuid ? { targets: [uuid], wrapped: mode === "wrap" } : null;
}

const resolve = uuid => {
  const doc = (foundry.utils.fromUuidSync ?? globalThis.fromUuidSync)?.(uuid, { strict: false }) ?? null;
  return doc?.actor ?? (doc?.documentName === "Actor" ? doc : null);
};

/** Mark an actor netted (and looped), as the active GM. */
export async function markNetted(actor, { wrapped = false } = {}) {
  if (!actor) return;
  if (!isNetted(actor) && typeof actor.toggleStatusEffect === "function") await actor.toggleStatusEffect(NET_STATUS.id, { active: true });
  if (wrapped && !netWrapped(actor)) await actor.setFlag?.("ad2e", "netWrapped", true);
}

/** Free an actor: status and looped flag removed. */
export async function clearNetted(actor) {
  if (!actor) return;
  if (isNetted(actor) && typeof actor.toggleStatusEffect === "function") await actor.toggleStatusEffect(NET_STATUS.id, { active: false });
  if (netWrapped(actor)) await actor.unsetFlag?.("ad2e", "netWrapped");
}

export function registerNetted() {
  const list = CONFIG.statusEffects;
  if (Array.isArray(list)) { if (!list.some(e => e.id === NET_STATUS.id)) list.push({ ...NET_STATUS }); }
  else if (list && !list[NET_STATUS.id]) list[NET_STATUS.id] = { ...NET_STATUS };
  Hooks.on("createChatMessage", async message => {
    if (!game.user?.isActiveGM) return;
    const hit = message.getFlag?.("ad2e", "netHit");
    if (!hit?.targets?.length) return;
    for (const uuid of hit.targets) {
      try { await markNetted(resolve(uuid), { wrapped: !!hit.wrapped }); } catch (err) { console.warn("ad2e | net mark failed", err); }
    }
  });
}
