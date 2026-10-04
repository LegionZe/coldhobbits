/**
 * Initiative modifiers ("Initiative (PHB)"; tables generated in module/rules/combat-tables.mjs):
 *  - Table 55 standard modifiers (hasted, slowed, higher ground, ...), ticked in the initiative dialog.
 *  - Table 56 optional modifiers, from the combatant's action (a scroll: the casting time of its spell): a weapon's speed factor ("each bonus point conferred by
 *    a magical weapon reduces the speed factor ... the lesser one is used ... no weapon can have a speed factor of less
 *    than 0"), a spell's casting time (a number without units; with units, "a spell requiring one round to cast takes
 *    effect at the end of the current round"), a breath weapon, an innate spell ability, a magical item by type, or a
 *    monster's size when it attacks with natural weapons ("creatures with natural weapons are not affected by weapon
 *    speed").
 * Without a dialog (Roll All / Roll NPCs) the action is chosen automatically: the weapon of the combatant's last
 * attack if still in hand, else the fastest weapon in hand; a monster without weapons uses its natural attacks (size).
 */
import { COMBAT_TABLES } from "./rules/combat-tables.mjs";
import { needsTwoHands } from "./combat-options.mjs";
import { SP } from "./sp-weapons.mjs";

const T = COMBAT_TABLES.initiative;
/** Added for a casting time of a round or more, so the spell comes after every other action of the round. */
export const END_OF_ROUND = 20;
const MAGIC_TYPE = { potion: "potion", ring: "ring", rod: "rod", staff: "staff", wand: "wand" };

/**
 * Speed factor of a weapon item (or of one of its uses with its own speed, e.g. the bastard sword two-handed), less its
 * magical bonus (the lesser of hit and damage when both are set), never below 0.
 */
export function weaponSpeed(item, use = null) {
  const base = Number(use?.speed ?? item?.system?.weapon?.speed);
  if (!Number.isFinite(base)) return null;
  const b = item.system.bonus ?? {};
  const bonuses = [b.hit, b.dmg].map(Number).filter(n => Number.isFinite(n) && n > 0);
  const magic = bonuses.length === 2 ? Math.min(...bonuses) : (bonuses[0] ?? 0);
  return Math.max(base - magic, 0);
}

/**
 * Speed factor for a combatant: Skills & Powers two-handed weapon style "improves (lowers) the speed factor of a weapon
 * by 3 - if that weapon is wielded with two hands" (a weapon too large for one hand, or a use labelled two-handed).
 */
export function actorWeaponSpeed(actor, item, use = null) {
  const speed = weaponSpeed(item, use);
  if (speed === null || actor?.type !== "character" || !actor.system?.proficiencies?.sp?.styles?.twoHanded) return speed;
  return needsTwoHands(item.system.weapon, actor.system.sizeCategory ?? "M", use) ? Math.max(speed + SP.twoHanded.speed, 0) : speed;
}

/** Initiative modifier for a casting time: "3" -> 3; "1 rd.", "2 rounds", "1 turn" -> END_OF_ROUND. */
export function castingTimeModifier(text) {
  const t = String(text ?? "").trim();
  if (/^\d+$/.test(t)) return { value: Number(t), endOfRound: false };
  if (/\d/.test(t)) return { value: END_OF_ROUND, endOfRound: true };
  return null;
}

/** Table 56 size modifier for natural weapons from a size text ("M (6' tall)", "L", "Huge"). */
export function sizeModifier(sizeText) {
  const m = String(sizeText ?? "").trim().match(/^[TSMLHG]/i);
  return m ? T.size[m[0].toUpperCase()] ?? null : null;
}

/** Weapons a combatant can attack with: characters - in hand (equipped, not dropped); monsters - any not dropped. */
function readyWeapons(actor) {
  return (actor?.items?.filter?.(i => i.type === "weapon" && !i.system.dropped
    && (actor.type !== "character" || i.system.equipped)) ?? []).filter(i => weaponSpeed(i) !== null);
}

/**
 * Actions for the initiative dialog: [{ key, label, value, note }]. `note` = text for chat (e.g. "end of round").
 */
export function initiativeActions(actor) {
  const i18n = k => game.i18n.localize(k);
  const fmt = (k, d) => game.i18n.format(k, d);
  const out = [{ key: "none", label: i18n("AD2E.Init.Action.none"), value: 0 }];
  for (const w of readyWeapons(actor)) {
    out.push({ key: `weapon.${w.id}`, label: fmt("AD2E.Init.Action.weapon", { name: w.name, n: actorWeaponSpeed(actor, w) }),
      value: actorWeaponSpeed(actor, w), short: w.name });
    // Uses with a speed of their own (bastard sword one- or two-handed).
    (w.system.weapon.damage ?? []).forEach((d, i) => {
      if (d.speed === null || d.speed === undefined || Number(d.speed) === Number(w.system.weapon.speed)) return;
      const name = `${w.name} (${d.label})`;
      out.push({ key: `weapon.${w.id}.${i}`, label: fmt("AD2E.Init.Action.weapon", { name, n: actorWeaponSpeed(actor, w, d) }),
        value: actorWeaponSpeed(actor, w, d), short: name });
    });
  }
  const size = actor?.type === "monster" ? sizeModifier(actor.system.size) : null;
  if (size !== null && (actor.system.attacks?.length ?? 0) > 0) {
    out.push({ key: "natural", label: fmt("AD2E.Init.Action.natural", { n: size }), value: size, short: i18n("AD2E.Init.Natural") });
  }
  for (const s of actor?.items?.filter?.(i => i.type === "spell") ?? []) {
    if (actor.type === "character" && !(s.system.prepared > 0)) continue;
    const ct = castingTimeModifier(s.system.castingTime);
    if (!ct) continue;
    out.push({ key: `spell.${s.id}`, label: fmt(ct.endOfRound ? "AD2E.Init.Action.spellRound" : "AD2E.Init.Action.spell",
      { name: s.name, n: ct.value, time: s.system.castingTime }), value: ct.value, short: s.name,
      note: ct.endOfRound ? i18n("AD2E.Init.EndOfRound") : "" });
  }
  // A scroll takes the casting time of the spell read from it (Table 56); the dialog asks for it.
  for (const m of actor?.items?.filter?.(i => i.type === "magic" && i.system.category === "scroll") ?? []) {
    out.push({ key: `scroll.${m.id}`, label: fmt("AD2E.Init.Action.scroll", { name: m.name }), value: 0, short: m.name, scroll: true });
  }
  for (const m of actor?.items?.filter?.(i => i.type === "magic" && i.system.category !== "scroll") ?? []) {
    const kind = MAGIC_TYPE[m.system.category] ?? "misc";
    out.push({ key: `magic.${m.id}`, label: fmt("AD2E.Init.Action.magic", { name: m.name, n: T.items[kind] }), value: T.items[kind], short: m.name });
  }
  out.push({ key: "breath", label: fmt("AD2E.Init.Action.breath", { n: T.breath }), value: T.breath, short: i18n("AD2E.Init.Breath") });
  out.push({ key: "innate", label: fmt("AD2E.Init.Action.innate", { n: T.innate }), value: T.innate, short: i18n("AD2E.Init.Innate") });
  return out;
}

/**
 * The automatic action: the weapon of the last attack (if still ready), else the fastest ready weapon; a monster
 * without weapons and with natural attacks: its size modifier; otherwise none.
 */
export function defaultAction(actor, actions = initiativeActions(actor)) {
  const last = actor?._ad2eLastWeapon;
  const weapons = actions.filter(a => /^weapon\.[^.]+$/.test(a.key)); // each weapon's base use
  return (last && weapons.find(a => a.key === `weapon.${last}`))
    ?? [...weapons].sort((a, b) => a.value - b.value)[0]
    ?? actions.find(a => a.key === "natural")
    ?? actions[0];
}

/** Table 55 standard modifiers: [{ key, label, value }]. */
export const STANDARD_MODIFIERS = T.standard;
