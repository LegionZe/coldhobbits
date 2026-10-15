/**
 * One level per experience award (owner's request 1.0.63: an optional rule behind a world setting, off by default).
 * Source: Rate of Advancement (DMG), https://adnd2e.fandom.com/wiki/Rate_of_Advancement_(DMG) (revision 71282): "Player
 * characters should never advance more than one level per time experience is awarded. If a gaming session ends and a
 * character has earned enough experience points to advance two levels, the excess points are lost. The DM should give the
 * character enough experience to place him somewhere between halfway and one point below the next highest level."
 * Implementation choices: each award (a single character's "+", the group award, the combat-end award) is capped at one
 * point below the experience for two levels above the current one (the top of the DMG's range; the GM can lower it by
 * hand); multi-class characters are capped per class; the points lost are shown in the chat message.
 */
export function oneLevelOn() {
  try { return !!game.settings.get("ad2e", "oneLevelPerAward"); } catch { return false; }
}

export function registerAdvancement() {
  game.settings.register("ad2e", "oneLevelPerAward", {
    name: "AD2E.Xp.OneLevelSetting", hint: "AD2E.Xp.OneLevelHint",
    scope: "world", config: true, type: Boolean, default: false
  });
}

/**
 * Highest experience an award may bring a character to (pure): one point below the experience for level + 2. `table` is an
 * experience table whose entry at index `level` is the experience for level + 1 (config.mjs AD2E.xpTable); null = no cap.
 */
export function xpCap(table, level) {
  const twoUp = table?.[(Number(level) || 0) + 1];
  return Number.isFinite(twoUp) ? twoUp - 1 : null;
}

/** An award under the cap (pure): { xp, gain, lost }. Experience already above the cap is kept, the award is then lost. */
export function cappedAward(before, gain, cap) {
  const from = Number(before) || 0;
  const want = from + (Number(gain) || 0);
  if (cap === null || cap === undefined || want <= cap) return { xp: want, gain: want - from, lost: 0 };
  const xp = Math.max(from, cap);
  return { xp, gain: xp - from, lost: want - xp };
}
