import { AGING } from "./rules/aging-tables.mjs";

/**
 * Ageing (PHB Tables 11 and 12; module/rules/aging-tables.mjs from tools/build-aging-tables.py). Owner's rulings: the
 * changes apply automatically from the character's Age and race (cumulative, "All ageing adjustments are cumulative",
 * Other Characteristics (PHB)) to the effective scores; a starting age roll (base + variable) and a GM-only maximum age
 * roll (base maximum + dice, `system.maxAge`) with a GM notice when it is reached (elves migrate rather than die).
 * 18/xx Strength: middle age halves the percentage instead of the point (rounded down: implementation choice), old age
 * removes it and 1 point more.
 */
export const CATEGORIES = ["middle", "old", "venerable"];

/** Age category index (pure): -1 = young; 0 middle age, 1 old, 2 venerable; null when the race or age is unknown. */
export function ageCategory(raceId, age) {
  const limits = AGING.categories[raceId];
  if (!limits || age === null || age === undefined || !Number.isFinite(Number(age))) return null;
  let cat = -1;
  limits.forEach((y, i) => { if (Number(age) >= y) cat = i; });
  return cat;
}

/** Apply the cumulative changes up to category `cat` to effective ability totals (pure on the object); returns the sum per ability. */
export function applyAging(abilities, cat) {
  const sum = {};
  // 18/xx Strength at the start: the percentage rules apply even when halving left nothing (18/01 -> 18/00 -> 17).
  const exc = abilities?.str?.total === 18 && abilities.str.exceptional > 0;
  for (let i = 0; i <= cat; i++) {
    const key = CATEGORIES[i];
    for (const [ab, n] of Object.entries(AGING.changes[key])) {
      const a = abilities?.[ab];
      if (!a) continue;
      if (ab === "str" && exc && key === "middle") {
        a.exceptional = Math.floor(a.exceptional / 2);
        sum.strExceptional = "half";
        continue;
      }
      if (ab === "str" && exc && key === "old") {
        a.exceptional = 0;
        a.total -= 1;
        sum.str = (sum.str ?? 0) - 1;
        continue;
      }
      a.total = Math.max(a.total + n, 1);
      sum[ab] = (sum[ab] ?? 0) + n;
    }
  }
  return sum;
}

/** Character data: { category (key or "young"), label, changes text, limits } or null. Pure apart from i18n in `text`. */
export function agingInfo(raceId, age) {
  const cat = ageCategory(raceId, age);
  if (cat === null) return null;
  return { index: cat, key: cat < 0 ? "young" : CATEGORIES[cat], limits: AGING.categories[raceId] };
}

export const startingAgeFormula = raceId => (AGING.age[raceId] ? `${AGING.age[raceId].base} + ${AGING.age[raceId].variable}` : null);
export const maxAgeFormula = raceId => (AGING.age[raceId] ? `${AGING.age[raceId].maxBase} + ${AGING.age[raceId].maxDice}` : null);

const esc = v => foundry.utils.escapeHTML?.(String(v ?? "")) ?? String(v ?? "");
const raceOf = actor => actor?.system?.raceInfo?.raceItem?.system?.identifier ?? "";
const gmWhisper = () => ChatMessage.getWhisperRecipients?.("GM")?.map(u => u.id) ?? [];

/** Roll the starting age (Table 11) into the Age field. */
export async function rollStartingAge(actor) {
  const f = startingAgeFormula(raceOf(actor));
  if (!f) return ui.notifications.warn(game.i18n.localize("AD2E.Aging.NoRace"));
  const roll = await new Roll(f).evaluate();
  await roll.toMessage({ speaker: ChatMessage.getSpeaker({ actor }), flavor: game.i18n.format("AD2E.Aging.StartFlavor", { name: actor.name, formula: f }) });
  return actor.update({ "system.age": roll.total });
}

/** GM: roll the maximum age (Table 11), whispered and kept on the actor. */
export async function rollMaxAge(actor) {
  if (!game.user?.isGM) return;
  const f = maxAgeFormula(raceOf(actor));
  if (!f) return ui.notifications.warn(game.i18n.localize("AD2E.Aging.NoRace"));
  const roll = await new Roll(f).evaluate();
  await roll.toMessage({ speaker: ChatMessage.getSpeaker({ actor }), flavor: game.i18n.format("AD2E.Aging.MaxFlavor", { name: actor.name, formula: f }) },
    { rollMode: "gmroll" });
  return actor.update({ "system.maxAge": roll.total });
}

/** GM notice when a character's age reaches its maximum age (active GM, on updateActor). */
export function registerAging() {
  Hooks.on("updateActor", (actor, changes) => {
    if (!game.user?.isActiveGM || actor.type !== "character") return;
    if (!foundry.utils.hasProperty(changes, "system.age") && !foundry.utils.hasProperty(changes, "system.maxAge")) return;
    const { age, maxAge } = actor.system;
    if (age === null || maxAge === null || maxAge === undefined || age < maxAge) return;
    const key = raceOf(actor) === AGING.elfMigrates ? "AD2E.Aging.ElfMigrates" : "AD2E.Aging.MaxReached";
    ChatMessage.create({ whisper: gmWhisper(), content: `<p>${esc(game.i18n.format(key, { name: actor.name, age, max: maxAge }))}</p>` });
  });
}
