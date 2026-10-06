/**
 * Energy drain and restoration (pure rules; the actor applies them). Sources: "Energy Drain" in Special Damage (DMG),
 * rev 238117 (the same text in Special Damage (PHB)); Multi-Class and Dual-Class Characters (PHB), rev 271818;
 * Restoration (Priest Spell), rev 235764.
 *  - Each level lost costs that level's Hit Dice roll (plus Constitution) or its fixed hit points, from the maximum.
 *  - Experience "drop[s] to halfway between the minimum needed for his new (post-drain) level and the minimum needed
 *    for the next level".
 *  - Multi-class and dual-class characters "lose their highest level first. If both levels are equal, the one requiring
 *    the greater number of experience points is lost first."
 *  - Drained below 1st level: 0-level, the adventuring career is over until a restoration or wish; drained again, slain.
 *  - A wizard "loses all understanding of spells in his spell books that are of higher level than he can now cast"
 *    and must roll again to relearn them.
 *  - Restoration raises the level by one, to "exactly the number of experience points necessary", "restoring
 *    additional Hit Dice (or hit points)", if cast "within one day of the recipient's loss of life energy, per
 *    experience level of the priest casting it".
 *  - Dual-class: until all lost levels are regained, using another class's abilities costs experience (PHB); the
 *    system applies the dual-class restrictions while drained levels are pending (implementation choice).
 */

import { minimumXp } from "./dual-class.mjs";

export { minimumXp };

/** Experience after losing a level: halfway between the new level's minimum and the next level's. */
export function drainedXp(table, newLevel) {
  const low = minimumXp(table, newLevel);
  const high = table?.[newLevel] ?? low;
  return Math.floor((low + high) / 2);
}

/**
 * The class that loses the next level: the highest level; on a tie the one whose current level needs the most
 * experience. Null when every class is at 1st level (the character would drop to 0-level).
 * @param {Array<{key: string, level: number, table: number[]}>} classes
 */
export function drainTarget(classes) {
  const candidates = classes.filter(c => (c.level ?? 1) > 1);
  if (!candidates.length) return null;
  return [...candidates].sort((a, b) => (b.level - a.level)
    || (minimumXp(b.table, b.level) - minimumXp(a.table, a.level)))[0];
}

/** Lost levels not yet regained: an entry stays while its class is below the lost level. */
export function pendingDrain(lost, levels) {
  return (lost ?? []).filter(e => (levels[e.key] ?? 0) < e.level);
}

/** Days since a drain (world time in seconds) and whether a restoration by a priest of `casterLevel` is in time. */
export function restorationInTime(at, now, casterLevel) {
  const days = Math.max(now - (at ?? now), 0) / 86400;
  return { days: Math.floor(days * 10) / 10, limit: casterLevel, ok: days <= casterLevel };
}
