import { STATION_TABLES } from "./rules/station-tables.mjs";
import { COIN_VALUES } from "./rules/movement-tables.mjs";
import { ad2eDialog } from "./dialogs.mjs";
import { packData } from "./treasure.mjs";

/**
 * Al-Qadim station (Station in Life (AA); module/rules/station-tables.mjs from tools/build-station-tables.py).
 * Owner's rulings (1.0.31): a world setting `stationRule` (off by default) shows station on characters; the initial station
 * is rolled from the Al-Qadim kit's Table 1 entry; after a conviction the 1d2 replaces the initial station and the level
 * rule still applies; NPC and monster actors have an optional station used by encounter reaction rolls; "Spend for
 * station" takes 1,000 gp a point from the character's coins and the bonus lasts a month of world time.
 * Rules (regex-checked): station 0-20; level above the initial station raises it to the level, lost levels lower it no
 * further than the initial station; dual-class halves it; criminals 1d2; penniless 3; slaves the owner's station minus
 * 1d6 or their own, whichever is lower, and once freed 1 point a month back to their former station; reaction rolls 1 point
 * for every 2 full points of difference in favour of the higher station; station check d20 (10 or less: under the
 * station; 11 or more: over it).
 * Implementation choices: a month is 30 days; the single kit's entry stands for multi-class characters (one kit each).
 * Character `system.station` { base, criminal, penniless, slave, freed { from, at }, bonus { points, until } }.
 */
export const STATION = STATION_TABLES;
const MONTH = STATION.monthDays * 86400;
const clamp = n => Math.max(STATION.min, Math.min(STATION.max, n));

export function stationRuleOn() {
  try { return game.settings.get("ad2e", "stationRule") === true; } catch { return false; }
}

export function registerStation() {
  game.settings.register("ad2e", "stationRule", { name: "AD2E.Station.Setting", hint: "AD2E.Station.SettingHint", scope: "world",
    config: true, type: Boolean, default: false, requiresReload: false,
    onChange: () => { for (const a of game.actors ?? []) if (a.sheet?.rendered) a.sheet.render(); } });
}

/** The Table 1 formula of a kit identifier, or null. */
export const kitFormula = identifier => STATION.kits[identifier]?.formula ?? null;

/**
 * A character's station now (pure): `st` = system.station, `level`, `dual` (has taken a second class), `now`.
 * Returns null before the initial station is set, else { initial, normal, value, bonus, state }.
 */
export function stationValue(st, { level = 1, dual = false, now = 0 } = {}) {
  const raw = st?.criminal ?? st?.base;
  if (raw === null || raw === undefined) return null;
  const initial = dual ? Math.floor(raw / 2) : raw;
  const normal = Math.max(initial, level);
  let value = normal;
  let state = st.criminal !== null && st.criminal !== undefined ? "criminal" : "";
  if (st.slave !== null && st.slave !== undefined) { value = st.slave; state = "slave"; }
  else if (st.penniless) { value = STATION.penniless; state = "penniless"; }
  else if (st.freed?.from !== null && st.freed?.from !== undefined) {
    const months = Math.floor(Math.max(now - (st.freed.at ?? now), 0) / MONTH);
    if (st.freed.from + months < normal) { value = st.freed.from + months; state = "freed"; }
  }
  const bonus = st.bonus?.until !== null && st.bonus?.until !== undefined && st.bonus.until > now ? (st.bonus.points ?? 0) : 0;
  return { initial, normal, value: clamp(value + bonus), bonus, state };
}

/** An actor's current station (characters while the setting is on, monsters with one set), or null. */
export function stationOf(actor, now = globalThis.game?.time?.worldTime ?? 0) {
  if (!actor || !stationRuleOn()) return null;
  if (actor.type === "monster") return actor.system?.station ?? null;
  if (actor.type !== "character") return null;
  const sys = actor.system;
  return stationValue(sys.station, { level: sys.level ?? 1, dual: (sys.dualClass?.previous?.length ?? 0) > 0, now })?.value ?? null;
}

/** Reaction roll modifier for the speaker (pure): 1 per 2 full points of difference, for the higher station. */
export function stationReaction(speaker, other) {
  if (speaker === null || speaker === undefined || other === null || other === undefined) return 0;
  const d = speaker - other;
  return Math.sign(d) * Math.floor(Math.abs(d) / 2);
}

/** A station check (pure): 10 or less, under the station; 11 or more, over it. */
export function stationCheck(station, roll) {
  return station <= 10 ? roll < station : roll > station;
}

/**
 * Paying `cost` (in copper) from coin items (pure): [{ id, denomination, value (cp), quantity }]. Spends the largest
 * coins first; when a coin is broken, the change comes back in gold, silver and copper. Returns null when the coins do not
 * cover the cost, else { take: { id: quantity removed }, change: { gp, sp, cp } }.
 */
export function payPlan(coins, cost) {
  const list = [...coins].filter(c => c.quantity > 0).sort((a, b) => b.value - a.value);
  if (list.reduce((n, c) => n + c.value * c.quantity, 0) < cost) return null;
  const take = {};
  let rem = cost;
  for (const c of list) {
    const n = Math.min(c.quantity, Math.floor(rem / c.value));
    if (n) { take[c.id] = n; rem -= n * c.value; }
  }
  const change = { gp: 0, sp: 0, cp: 0 };
  if (rem > 0) {
    const coin = [...list].reverse().find(c => c.value > rem && c.quantity - (take[c.id] ?? 0) > 0);
    take[coin.id] = (take[coin.id] ?? 0) + 1;
    let back = coin.value - rem;
    for (const d of ["gp", "sp", "cp"]) { change[d] = Math.floor(back / COIN_VALUES[d]); back -= change[d] * COIN_VALUES[d]; }
  }
  return { take, change };
}

const i18n = (k, d) => (d ? game.i18n.format(k, d) : game.i18n.localize(k));

async function post(actor, text, roll = null) {
  if (roll) return roll.toMessage({ speaker: ChatMessage.getSpeaker({ actor }), flavor: text });
  return ChatMessage.implementation.create({ speaker: ChatMessage.getSpeaker({ actor }), content: `<p>${text}</p>` });
}

/** Roll the initial station from the kit's Table 1 entry. */
export async function rollInitialStation(actor) {
  const kit = actor.system.classInfo?.kitItem;
  const formula = kitFormula(kit?.system?.identifier);
  if (!formula) { ui.notifications?.warn(i18n("AD2E.Station.NoKit")); return null; }
  const roll = await new Roll(formula).evaluate();
  await actor.update({ "system.station.base": clamp(roll.total) });
  return post(actor, i18n("AD2E.Station.Rolled", { kit: kit.name, formula }), roll);
}

/** GM: convicted of a major crime (1d2 replaces the initial station), or cleared. */
export async function convict(actor, clear = false) {
  if (clear) return actor.update({ "system.station.criminal": null });
  const roll = await new Roll(STATION.criminal).evaluate();
  await actor.update({ "system.station.criminal": roll.total });
  return post(actor, i18n("AD2E.Station.Convicted", { name: actor.name }), roll);
}

/** GM: enslaved (asks the owner's station; owner's station minus 1d6 or the slave's own, whichever is lower), or freed. */
export async function enslave(actor) {
  const now = game.time?.worldTime ?? 0;
  const st = actor.system.station;
  const own = stationOf(actor, now) ?? 0;
  if (st.slave !== null && st.slave !== undefined) {
    return actor.update({ "system.station.slave": null, "system.station.freed": { from: st.slave, at: now } });
  }
  const owner = await ad2eDialog.prompt({ window: { title: i18n("AD2E.Station.Enslave") },
    content: `<div class="form-group"><label>${i18n("AD2E.Station.OwnerStation")}</label><input type="number" name="owner" min="0" max="20" value="10" autofocus></div>`,
    ok: { callback: (event, button) => Number(button.form.elements.owner.value) }, rejectClose: false });
  if (owner === null || owner === undefined || Number.isNaN(owner)) return null;
  const roll = await new Roll(STATION.slave).evaluate();
  const value = clamp(Math.min(owner - roll.total, own));
  await actor.update({ "system.station.slave": value, "system.station.freed": { from: null, at: null } });
  return post(actor, i18n("AD2E.Station.Enslaved", { name: actor.name, owner, station: value }), roll);
}

/** Spend 1,000 gp a point from the character's coins: the bonus lasts a month (30 days) of world time. */
export async function spendForStation(actor, points) {
  points = Math.floor(Number(points) || 0);
  if (points < 1) return null;
  const coins = actor.items.filter(i => i.type === "coin").map(i => ({ id: i.id, denomination: i.system.denomination,
    value: i.system.value ?? COIN_VALUES[i.system.denomination] ?? 0, quantity: i.system.quantity ?? 0 }));
  const plan = payPlan(coins, points * STATION.goldPerPoint * COIN_VALUES.gp);
  if (!plan) { ui.notifications?.warn(i18n("AD2E.Station.NotEnough", { gp: points * STATION.goldPerPoint })); return null; }
  const updates = Object.entries(plan.take).map(([id, n]) => ({ _id: id, "system.quantity": actor.items.get(id).system.quantity - n }));
  const create = [];
  for (const [d, n] of Object.entries(plan.change)) {
    if (!n) continue;
    const have = actor.items.find(i => i.type === "coin" && i.system.denomination === d && !i.system.container);
    if (have) {
      const u = updates.find(x => x._id === have.id);
      if (u) u["system.quantity"] += n; else updates.push({ _id: have.id, "system.quantity": have.system.quantity + n });
    } else {
      const data = await packData("ad2e.equipment", { identifier: d });
      if (data) create.push(foundry.utils.mergeObject(data, { system: { quantity: n } }));
    }
  }
  if (updates.length) await actor.updateEmbeddedDocuments("Item", updates);
  if (create.length) await actor.createEmbeddedDocuments("Item", create);
  const now = game.time?.worldTime ?? 0;
  const b = actor.system.station.bonus ?? {};
  const active = b.until !== null && b.until !== undefined && b.until > now;
  await actor.update({ "system.station.bonus": { points: (active ? b.points ?? 0 : 0) + points, until: active ? b.until : now + MONTH } });
  return post(actor, i18n("AD2E.Station.Spent", { name: actor.name, gp: points * STATION.goldPerPoint, n: points }));
}

/** Station check (masking one's station without the disguise proficiency). */
export async function rollStationCheck(actor) {
  const station = stationOf(actor);
  if (station === null) return null;
  const roll = await new Roll("1d20").evaluate();
  const ok = stationCheck(station, roll.total);
  return post(actor, i18n(ok ? "AD2E.Station.CheckOk" : "AD2E.Station.CheckFail", { station,
    rule: i18n(station <= 10 ? "AD2E.Station.Under" : "AD2E.Station.Over") }), roll);
}

/** Bio tab context (null while the setting is off). */
export function stationContext(actor, editable) {
  if (!stationRuleOn() || actor.type !== "character") return null;
  const sys = actor.system;
  const now = game.time?.worldTime ?? 0;
  const v = stationValue(sys.station, { level: sys.level ?? 1, dual: (sys.dualClass?.previous?.length ?? 0) > 0, now });
  const kit = sys.classInfo?.kitItem;
  const st = sys.station ?? {};
  return {
    set: !!v, value: v?.value ?? null, initial: v?.initial ?? null, bonus: v?.bonus ?? 0, state: v?.state ? i18n(`AD2E.Station.State.${v.state}`) : "",
    formula: kitFormula(kit?.system?.identifier), kitName: kit?.name ?? "", canRoll: editable && !!kitFormula(kit?.system?.identifier)
      && (st.base === null || st.base === undefined),
    isGM: !!game.user?.isGM, criminal: st.criminal !== null && st.criminal !== undefined, penniless: !!st.penniless,
    slave: st.slave !== null && st.slave !== undefined, editable,
    bonusUntil: v?.bonus ? Math.ceil((st.bonus.until - now) / 86400) : 0, url: STATION.url
  };
}
