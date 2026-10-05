/**
 * Riders and mounts on the canvas (world setting "tokenRiders", default on). A character riding an animal
 * (`system.animals.riding`, module/animals.mjs) and that animal's token move together: moving either token moves the
 * other along the same path, keeping their relative position (owner's ruling: either token carries the other; mounting
 * and dismounting stay on the character sheet).
 * Only tokens on the same scene that touch at the start of the move are carried (a horse left in the stable stays there).
 * Movement API (Foundry v14): hook `moveToken(document, movement, operation, user)` with `movement.origin` and
 * `movement.passed.waypoints`; `TokenDocument#move(waypoints, options)` (custom option keys reach the update operation,
 * as dnd5e's `dnd5e.fall` in TokenDocument5e#plummet).
 */

const resolve = uuid => (foundry.utils.fromUuidSync ?? globalThis.fromUuidSync)?.(uuid, { strict: false }) ?? null;

export function registerTokenRiders() {
  game.settings.register("ad2e", "tokenRiders", {
    name: "AD2E.Riders.Setting", hint: "AD2E.Riders.SettingHint", scope: "world", config: true, type: Boolean, default: true
  });
  Hooks.on("moveToken", (token, movement, operation, user) => { void followMove(token, movement, operation, user); });
}

function ridersOn() {
  try { return game.settings.get("ad2e", "tokenRiders") !== false; } catch { return true; }
}

/** Uuids that name a token's actor: its own (a linked or synthetic actor) and its world actor's. */
function actorUuids(token) {
  const out = new Set();
  if (token?.actor?.uuid) out.add(token.actor.uuid);
  if (token?.actorId) out.add(`Actor.${token.actorId}`);
  return out;
}

/**
 * Tokens moved along with this one: the token of the animal its character rides, or the tokens of the characters
 * riding its actor. Same scene only.
 * @param {TokenDocument} token
 * @param {Iterable<Actor>} [actors]  world actors (game.actors)
 */
export function partnerTokens(token, actors = game.actors) {
  const scene = token?.parent;
  const actor = token?.actor;
  if (!scene || !actor) return [];
  const others = [...(scene.tokens ?? [])].filter(t => t.id !== token.id);
  if (actor.type === "character" && actor.system?.animals?.riding) {
    const riding = actor.system.animals.riding;
    return others.filter(t => actorUuids(t).has(riding));
  }
  if (actor.type === "monster") {
    const mine = actorUuids(token);
    const riders = [...(actors ?? [])].filter(a => a?.type === "character" && mine.has(a.system?.animals?.riding));
    if (!riders.length) return [];
    const ids = new Set(riders.map(a => a.id));
    return others.filter(t => ids.has(t.actor?.id ?? t.actorId) && t.actor?.type === "character");
  }
  return [];
}

/**
 * Whether two tokens touch: their rectangles (top-left x/y in pixels, width/height in grid spaces) overlap or are
 * adjacent, at the given positions.
 */
export function tokensTouch(a, b, gridSize) {
  const r = p => ({ x0: p.x, y0: p.y, x1: p.x + (p.width ?? 1) * gridSize, y1: p.y + (p.height ?? 1) * gridSize });
  const A = r(a);
  const B = r(b);
  return A.x0 <= B.x1 && B.x0 <= A.x1 && A.y0 <= B.y1 && B.y0 <= A.y1;
}

/** The leader's passed waypoints shifted by the follower's offset at the start: [{ x, y, elevation }]. */
export function followerWaypoints(movement, follower) {
  const o = movement.origin;
  const dx = follower.x - o.x;
  const dy = follower.y - o.y;
  const dz = (follower.elevation ?? 0) - (o.elevation ?? 0);
  return (movement.passed?.waypoints ?? []).map(w => ({ x: Math.round(w.x + dx), y: Math.round(w.y + dy),
    elevation: (w.elevation ?? o.elevation ?? 0) + dz }));
}

/**
 * Followers recently moved by this client: their own moveToken hooks are not followed back (a second guard besides the
 * `ad2e.ride` operation option).
 */
const carrying = new Set();
const CARRY_MS = 5000;

async function followMove(token, movement, operation, user) {
  // A follower's own movement: not followed back (its first hook ends the guard; a timeout ends it otherwise).
  if (carrying.delete(token.id) || operation?.ad2e?.ride || !ridersOn()) return;
  const waypointsPassed = movement?.passed?.waypoints ?? [];
  if (!waypointsPassed.length || !movement.origin) return;
  const gridSize = token.parent?.grid?.size ?? globalThis.canvas?.grid?.size ?? 100;
  for (const follower of partnerTokens(token)) {
    // The user who moved the token moves its partner when allowed to; otherwise the active GM does.
    const allowed = follower.canUserModify?.(user, "update");
    const designated = allowed ? user : game.users?.activeGM;
    if (!designated?.isSelf) continue;
    if (!tokensTouch(movement.origin, follower, gridSize)) continue;
    const waypoints = followerWaypoints(movement, follower);
    carrying.add(follower.id);
    setTimeout(() => carrying.delete(follower.id), CARRY_MS);
    try {
      await follower.move(waypoints, { ad2e: { ride: true }, pan: false, showRuler: false, method: "api" });
    } catch (err) {
      console.warn("ad2e | could not move the rider or mount", err);
    }
  }
}
