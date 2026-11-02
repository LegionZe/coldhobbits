/**
 * Detailed naval combat at the table (Of Ships and the Sea, chapter 4; owner's request 1.0.81): the battle state, the
 * three phases and the actions, with dice, actor updates and chat cards. Rules in module/naval-combat.mjs (pure).
 * The battle is a world setting ("navalCombat", written by the GM): units (ship actors or sea creatures, by UUID) with
 * a side, a declared action and a target, the range of each pair, the round and the modifiers the Maneuvering phase gave.
 * Implementation choices (beyond those in naval-combat.mjs): a unit that does not target its opponent takes no action
 * toward it in their maneuvering roll; a round advances world time by its length; fires burn once a minute through
 * 10- and 30-minute rounds with the firefighters split evenly; the second fire a growing fire starts takes a Table 20
 * size; failed morale checks keep the worst penalty for the battle.
 */
import { ad2eDialog } from "./dialogs.mjs";
import { baseRate, currentRate, diceText, NAVAL, pursuitDice, seaworthinessCheck } from "./naval.mjs";
import {
  actionsAt, archerFactors, artilleryAc, artilleryBand, artilleryCrit, artilleryEffect, artilleryRate, boardersFor, boardingFactorMod,
  boardResult, creatureDice, creatureRamAc, creatureSize, fireGrows, fireSize, hitNumber, hullChecks, incendiaryTarget, maneuver,
  marineLosses, missileTarget, moraleCheck, ramCrit, ramMiss, ramModifier, ramResult, roundFor, rowersTire, swimRate, volleyHits, woundGroup
} from "./naval-combat.mjs";
import { seaWind } from "./apps/sea-voyage.mjs";

const C = NAVAL.combat;
const i18n = (k, d) => (d ? game.i18n.format(k, d) : game.i18n.localize(k));
const esc = v => foundry.utils.escapeHTML?.(String(v ?? "")) ?? String(v ?? "");
const KEY = "navalCombat";

export const EMPTY = { active: false, round: 0, units: [], ranges: {} };

export function battle() {
  try { return foundry.utils.deepClone(game.settings.get("ad2e", KEY)) ?? structuredClone(EMPTY); } catch { return structuredClone(EMPTY); }
}

export async function saveBattle(b) {
  await game.settings.set("ad2e", KEY, b);
  Hooks.callAll("ad2eNavalCombat", b);
  return b;
}

export const pairKey = (a, b) => [a, b].sort().join("|");
export const rangeOf = (b, x, y) => b.ranges?.[pairKey(x, y)] ?? 1500;
export const unitOf = (b, uuid) => b.units.find(u => u.uuid === uuid) ?? null;
export const actorOf = uuid => foundry.utils.fromUuidSync?.(uuid, { strict: false }) ?? null;
const isShip = a => a?.type === "ship";

async function roll(formula) {
  return new Roll(formula).evaluate();
}

async function total(formula) {
  return (await roll(formula)).total;
}

async function post(html, { actor = null, rolls = [], flags = {} } = {}) {
  return ChatMessage.implementation.create({ speaker: actor ? ChatMessage.getSpeaker({ actor }) : { alias: i18n("AD2E.NavalCombat.Title") },
    content: html, rolls, flags });
}

const lines = list => list.filter(Boolean).map(l => `<p>${esc(l)}</p>`).join("");

/** A new unit for an actor. */
export function newUnit(uuid, side = "a") {
  return { uuid, side, action: "close", target: "", course: "across", mods: { missile: 0, ram: 0, board: 0, ramBoard: 0, next: 0 }, nextMod: 0,
    grappledBy: "", grapple: "", across: 0, stuck: "", stuckTries: 0, ramWait: 0, minutes: 0, rowerChecks: 0, crit: false, hullStart: null, partial: false };
}

/** Current movement rate in the battle's wind (ships: Table 38 figures; creatures: swimming rate). */
export function unitRate(actor, unit) {
  if (isShip(actor)) {
    const s = actor.system;
    if (unit?.grapple === "held" || unit?.stuck) return 0;
    return Math.max(currentRate({ spec: s.spec, propulsion: s.propulsion, crewState: s.crewState, skeletonPushed: false, restingRowers: s.restingRowers,
      hull: s.hullNow, hullMax: s.hullMax, crippling: s.cripplingNow, cripplingMax: s.cripplingMax },
    { wind: seaWind().wind || "moderate", course: unit?.course || "across", combat: true }).rate, 0);
  }
  return swimRate(actor?.system?.movement?.text);
}

/** The maneuverability or pursuit dice of a unit this round, with modifiers (text formula). */
export function unitDice(actor, unit, minutes) {
  if (isShip(actor)) {
    const s = actor.system;
    const rate = unitRate(actor, unit);
    const dice = minutes === 1 ? s.maneuver : pursuitDice(rate, s.crewState);
    return diceText(dice, s.diceMod + (unit?.nextMod ?? 0) + (unit?.partial ? -2 : 0));
  }
  const cd = creatureDice(creatureSize(actor?.system?.size), swimRate(actor?.system?.movement?.text));
  return diceText(minutes === 1 ? cd.maneuver : cd.pursuit, unit?.nextMod ?? 0);
}

/** Size category of a unit for ramming (ships: their size; creatures: Table 36 "rams as"). */
function sizeOf(actor) {
  if (isShip(actor)) return actor.system.sizeKey;
  return C.creatureRam[creatureSize(actor?.system?.size)]?.ramsAs ?? null;
}

/**
 * The Maneuvering phase: every pair where one unit targets the other rolls (pursuit dice in 10- and 30-minute rounds,
 * maneuverability dice in 1-minute rounds); grappled, stuck or dead-in-the-water units lose automatically.
 */
export async function maneuverPhase() {
  const b = battle();
  const done = new Set();
  const out = [];
  const rolls = [];
  for (const u of b.units) u.mods = { missile: 0, ram: 0, board: 0, ramBoard: 0, next: 0 };
  for (const u of b.units) {
    if (!u.target) continue;
    const key = pairKey(u.uuid, u.target);
    if (done.has(key)) continue;
    done.add(key);
    const v = unitOf(b, u.target);
    if (!v) continue;
    const ua = actorOf(u.uuid);
    const va = actorOf(v.uuid);
    if (!ua || !va) continue;
    const range = rangeOf(b, u.uuid, v.uuid);
    const minutes = roundFor(range).minutes;
    const act = (x, y) => (x.target === y.uuid ? x.action : "none");
    const side = async (x, xa) => {
      const rate = unitRate(xa, x);
      if (x.grapple === "held" || x.stuck || rate <= 0 && isShip(xa)) return { roll: 0, rate, formula: "—" };
      const f = unitDice(xa, x, minutes);
      const r = await roll(f);
      rolls.push(r);
      return { roll: Math.max(r.total, 1), rate, formula: f };
    };
    const ra = await side(u, ua);
    const rb = await side(v, va);
    const d10 = await total("1d10");
    const res = maneuver({ a: { action: act(u, v), roll: ra.roll, rate: ra.rate }, b: { action: act(v, u), roll: rb.roll, rate: rb.rate }, minutes, range, d10 });
    b.ranges[key] = res.range;
    for (const [x, m] of [[u, res.mods.a], [v, res.mods.b]]) {
      for (const k of ["missile", "ram", "board", "ramBoard"]) x.mods[k] += m[k];
      x.nextMod = m.next;
    }
    if (res.grapple) {
      const by = res.grapple.by === "a" ? u : v;
      const held = res.grapple.by === "a" ? v : u;
      held.grappledBy = by.uuid;
      held.grapple = "held";
      const party = isShip(actorOf(by.uuid)) ? actorOf(by.uuid).system.marines.boarders : 0;
      by.across = boardersFor(party, res.grapple.boarders);
    }
    out.push(i18n("AD2E.NavalCombat.ManeuverLine", { a: ua.name, ra: ra.roll, fa: ra.formula, b: va.name, rb: rb.roll, fb: rb.formula,
      range: res.range, minutes: roundFor(res.range).minutes, winner: res.winner ? (res.winner === "a" ? ua.name : va.name) : i18n("AD2E.NavalCombat.Nobody") }));
    if (res.grapple) out.push(i18n("AD2E.NavalCombat.GrappledAtOnce", { a: res.grapple.by === "a" ? ua.name : va.name }));
  }
  b.phase = "action";
  await saveBattle(b);
  return post(`<p><strong>${esc(i18n("AD2E.NavalCombat.ManeuverTitle", { round: b.round }))}</strong></p>${lines(out)}`, { rolls });
}

/** Casualties from hits on a ship: Table 18 entries -> crew groups, with the fallbacks the table gives. Returns notes. */
export async function applyHits(actor, entries, { boardersFirst = false } = {}) {
  const s = actor.system;
  const groups = { sailors: { ...s.sailors }, rowers: { ...s.rowers } };
  let marines = { ...s.marines };
  const tally = { sailor: 0, rower: 0, marine: 0, special: 0, none: 0 };
  for (const [entry, hits] of entries) {
    let kind = entry.replace("*", "");
    if (kind === "sailor" && groups.sailors.count <= 0) kind = "rower";
    if (kind === "rower" && groups.rowers.count <= 0) kind = "marine";
    if (kind === "marine" && marines.count <= 0) kind = "";
    if (!kind || kind === "na") { tally.none += hits; continue; }
    tally[kind] += hits;
    if (kind === "special") continue;
    if (kind === "marine") {
      const w = woundGroup({ count: marines.count, hd: marines.hd, wounds: marines.wounds }, hits);
      const order = boardersFirst ? ["boarders", "free", "archers", "artillerists", "firefighters"] : undefined;
      marines = { ...marineLosses(marines, w.dead, order), hd: marines.hd, wounds: w.group.wounds };
    } else {
      const g = kind === "sailor" ? "sailors" : "rowers";
      groups[g] = woundGroup(groups[g], hits).group;
    }
  }
  await actor.update({ "system.sailors": groups.sailors, "system.rowers": groups.rowers, "system.marines": marines });
  return i18n("AD2E.NavalCombat.HitsTally", { name: actor.name, sailor: tally.sailor, rower: tally.rower, marine: tally.marine,
    special: tally.special, none: tally.none });
}

/** Rolls on Table 18 for a number of hits; a "marine*" result also rolls Table 19 when the target has incendiaries ready. */
async function allocate(target, hits) {
  const entries = [];
  let fires = 0;
  const defense = target.system.spec.combat.defense;
  const ready = target.system.incendiary > 0 || target.system.artillery.some(a => a.key === "greekFireProjector" && !a.destroyed);
  for (let i = 0; i < hits; i++) {
    const e = missileTarget(defense, await total("1d10"));
    entries.push([e || "", 1]);
    if (e === "marine*" && ready) fires++;
  }
  return { entries, fires };
}

/** Start fires from Table 19 rolls (count) on a ship; each fire burns at once. Returns notes. */
export async function incendiaryRolls(target, count) {
  const notes = [];
  const defense = target.system.spec.combat.defense;
  let extra = 0;
  for (let i = 0; i < count; i++) {
    const e = incendiaryTarget(defense, await total("1d10"));
    if (!e) continue;
    if (e === "destroyed") {
      await target.update({ "system.sunk": true });
      notes.push(i18n("AD2E.NavalCombat.DestroyedByFire", { name: target.name }));
      return notes;
    }
    const loc = e.startsWith("hull") ? "hull" : "crippling";
    extra += (e.match(/\+/g) ?? []).length;
    notes.push(...(await startFire(target, loc)));
  }
  if (extra) {
    const al = await allocate(target, extra);
    notes.push(await applyHits(target, al.entries));
  }
  return notes;
}

/** A fire starts: Table 20 size, immediate damage; maximum damage grows it and starts a second fire elsewhere. */
export async function startFire(target, location, die = null) {
  const size = die ?? fireSize(await total("1d10"));
  const fires = foundry.utils.deepClone(target._source.system.fires);
  fires.push({ location, die: size });
  await target.update({ "system.fires": fires });
  const notes = [i18n("AD2E.NavalCombat.FireStarts", { name: target.name, at: i18n(`AD2E.Naval.FireAt.${location}`), die: size })];
  notes.push(...(await burn(target, fires.length - 1)));
  return notes;
}

/** One fire burns (damage now; at maximum it grows and spreads). */
async function burn(target, index) {
  const fires = foundry.utils.deepClone(target._source.system.fires);
  const f = fires[index];
  if (!f) return [];
  const dmg = await total(`1d${f.die}`);
  const notes = [i18n("AD2E.NavalCombat.FireBurns", { at: i18n(`AD2E.Naval.FireAt.${f.location}`), die: f.die, dmg })];
  await damageShip(target, f.location === "hull" ? { hull: dmg } : { crippling: dmg }, { quiet: true });
  if (dmg === f.die && f.die < 20) {
    fires[index] = { ...f, die: fireGrows(f.die) };
    const other = f.location === "hull" ? "crippling" : "hull";
    fires.push({ location: other, die: fireSize(await total("1d10")) });
    await target.update({ "system.fires": fires });
    notes.push(i18n("AD2E.NavalCombat.FireSpreads", { die: fires[index].die, at: i18n(`AD2E.Naval.FireAt.${other}`) }));
  }
  return notes;
}

/**
 * Hull or crippling damage on a ship: Table 28 seaworthiness follows from the hull points; checks at half and each further
 * quarter are rolled in the Resolution phase (`hullStart`); at 0 hull points the ship starts sinking (Table 29 rounds).
 */
export async function damageShip(target, { hull = 0, crippling = 0 } = {}, { quiet = false } = {}) {
  const s = target.system;
  const update = {};
  if (hull) update["system.hull.value"] = s.hullNow - hull;
  if (crippling) update["system.crippling.value"] = Math.max(s.cripplingNow - crippling, 0);
  if (!Object.keys(update).length) return null;
  if (hull && s.hullNow - hull <= 0 && (s.founderAt === null || s.founderAt === undefined) && !s.sunk) {
    const rounds = await total(C.sinking[s.sizeKey] ?? "1");
    update["system.founderAt"] = (game.time?.worldTime ?? 0) + rounds * (CONFIG.time?.roundTime || 60);
    await target.update(update);
    return post(lines([i18n("AD2E.NavalCombat.Sinking", { name: target.name, n: rounds })]), { actor: target });
  }
  await target.update(update);
  if (!quiet) return post(lines([i18n("AD2E.NavalCombat.Damaged", { name: target.name, hull, crippling })]), { actor: target });
  return null;
}

/** Missile volley (archers, artillery anti-personnel factors, PCs) or incendiary volley at the unit's target. */
export async function missileVolley(uuid, { incendiary = false } = {}) {
  const b = battle();
  const u = unitOf(b, uuid);
  const att = actorOf(uuid);
  const tgt = actorOf(u?.target);
  if (!u || !att || !tgt || !isShip(att)) return ui.notifications.warn(i18n("AD2E.NavalCombat.NeedTarget"));
  const range = rangeOf(b, uuid, u.target);
  if (range > 250) return ui.notifications.warn(i18n("AD2E.NavalCombat.OutOfRange"));
  if (incendiary && !(att.system.incendiary > 0)) return ui.notifications.warn(i18n("AD2E.NavalCombat.NoIncendiary"));
  const s = att.system;
  const ramming = u.action === "ram" && range === 0;
  const archers = archerFactors(s.marines.archers, s.sizeKey, { ramming });
  const guns = s.artillery.map((a, i) => ({ ...a, i, t: C.artillery.find(x => x.key === a.key) })).filter(a => !a.destroyed && a.t?.crewFactors && !a.loaded && a.crew > 0);
  const creature = !isShip(tgt);
  const f = await ad2eDialog.prompt({
    window: { title: i18n(incendiary ? "AD2E.NavalCombat.Incendiary" : "AD2E.NavalCombat.Missiles") }, rejectClose: false,
    content: `<p class="ad2e-note">${esc(i18n("AD2E.NavalCombat.MissileHint", { archers, size: i18n(`AD2E.Naval.Size.${s.sizeKey}`), max: C.archers[s.sizeKey] }))}</p>`
      + (incendiary ? "" : guns.map(g => `<div class="form-group"><label>${esc(i18n("AD2E.NavalCombat.GunAtCrew", { gun: i18n(`AD2E.Naval.Artillery.${g.key}`), n: g.t.crewFactors }))}</label><input type="checkbox" name="gun" value="${g.i}"></div>`).join(""))
      + `<div class="form-group"><label>${esc(i18n("AD2E.NavalCombat.ExtraFactors"))}</label><input type="number" name="extra" value="0" min="0"></div>`
      + `<div class="form-group"><label>${esc(i18n("AD2E.NavalCombat.RangeMod"))}</label><input type="text" name="mod" value="0"></div>`
      + (creature ? `<div class="form-group"><label>${esc(i18n("AD2E.NavalCombat.Submerged"))}</label><select name="sub"><option value="">${esc(i18n("AD2E.NavalCombat.Surface"))}</option><option value="partial">${esc(i18n("AD2E.NavalCombat.Partial"))}</option><option value="full">${esc(i18n("AD2E.NavalCombat.Full"))}</option></select></div>` : "")
      + (!creature && !incendiary ? `<div class="form-group"><label>${esc(i18n("AD2E.NavalCombat.AtBoarders"))}</label><input type="checkbox" name="boarders"></div>` : ""),
    ok: { label: i18n("AD2E.Roll.Roll"), callback: (e, bt) => {
      const el = bt.form.elements;
      return { guns: [...bt.form.querySelectorAll("input[name=gun]:checked")].map(x => Number(x.value)), extra: Number(el.extra.value) || 0,
        mod: Number(el.mod.value) || 0, sub: el.sub?.value ?? "", boarders: !!el.boarders?.checked };
    } }
  });
  if (!f) return null;
  if (f.sub === "full") return post(lines([i18n("AD2E.NavalCombat.Immune", { name: tgt.name })]), { actor: att });
  const gunFactors = f.guns.reduce((n, i) => n + (guns.find(g => g.i === i)?.t.crewFactors ?? 0), 0);
  const factors = archers + f.extra + gunFactors;
  if (!factors) return ui.notifications.warn(i18n("AD2E.NavalCombat.NoFactors"));
  const ac = incendiary ? 10 : creature ? (Number(tgt.system?.ac?.value ?? tgt.system?.ac?.base ?? 10) + (f.sub === "partial" ? 8 : 0)) : tgt.system.ac;
  const number = hitNumber(s.thac0, ac, u.mods.missile + (s.morale.penalty ?? 0) + f.mod);
  const d20 = [];
  const rolls = [];
  for (let i = 0; i < Math.ceil(factors / 10); i++) { const r = await roll("1d20"); rolls.push(r); d20.push(r.total); }
  const v = volleyHits(factors, number, d20);
  const notes = [i18n("AD2E.NavalCombat.VolleyLine", { name: att.name, target: tgt.name, factors, number, hits: v.hits })];
  if (incendiary) await att.update({ "system.incendiary": s.incendiary - 1 });
  if (f.guns.length) {
    const list = foundry.utils.deepClone(att._source.system.artillery);
    for (const i of f.guns) list[i].loaded = Math.max(artilleryRate(list[i].key, list[i].crew).every - 1, 0);
    await att.update({ "system.artillery": list });
  }
  if (creature) notes.push(i18n("AD2E.NavalCombat.CreatureHits", { n: v.hits }));
  else if (incendiary) notes.push(...(await incendiaryRolls(tgt, v.hits)));
  else if (v.hits) {
    const al = await allocate(tgt, v.hits);
    notes.push(await applyHits(tgt, al.entries, { boardersFirst: f.boarders }));
    if (al.fires) notes.push(...(await incendiaryRolls(tgt, al.fires)));
  }
  return post(lines(notes), { actor: att, rolls });
}

/** Artillery fire at the ship (or a Huge/Gargantuan creature) the unit targets: one weapon, its rate of fire per round length. */
export async function artilleryFire(uuid) {
  const b = battle();
  const u = unitOf(b, uuid);
  const att = actorOf(uuid);
  const tgt = actorOf(u?.target);
  if (!u || !att || !tgt || !isShip(att)) return ui.notifications.warn(i18n("AD2E.NavalCombat.NeedTarget"));
  const range = rangeOf(b, uuid, u.target);
  const minutes = roundFor(range).minutes;
  const guns = att.system.artillery.map((a, i) => ({ ...a, i })).filter(a => !a.destroyed && a.crew > 0 && (minutes > 1 || !a.loaded));
  if (!guns.length) return ui.notifications.warn(i18n("AD2E.NavalCombat.NoGun"));
  const gi = await ad2eDialog.prompt({
    window: { title: i18n("AD2E.NavalCombat.Artillery") }, rejectClose: false,
    content: `<div class="form-group"><label>${esc(i18n("AD2E.NavalCombat.Gun"))}</label><select name="gun">${guns.map(g =>
      `<option value="${g.i}">${esc(i18n(`AD2E.Naval.Artillery.${g.key}`))}${g.incendiary ? ` (${esc(i18n("AD2E.Naval.Incendiary"))})` : ""}</option>`).join("")}</select></div>`
      + `<div class="form-group"><label>${esc(i18n("AD2E.Roll.Modifier"))}</label><input type="text" name="mod" value="0"></div>`,
    ok: { label: i18n("AD2E.Roll.Roll"), callback: (e, bt) => ({ i: Number(bt.form.elements.gun.value), mod: Number(bt.form.elements.mod.value) || 0 }) }
  });
  if (!gi) return null;
  const gun = att.system.artillery[gi.i];
  const t = C.artillery.find(x => x.key === gun.key);
  const band = artilleryBand(gun.key, range, { incendiary: gun.incendiary });
  if (band.band === "out") return ui.notifications.warn(i18n("AD2E.NavalCombat.OutOfRange"));
  const rate = artilleryRate(gun.key, gun.crew);
  const shots = minutes === 1 ? 1 : minutes === 10 ? rate.perTen : rate.perTen * 3;
  const creature = !isShip(tgt);
  if (creature && !["huge", "gargantuan"].includes(creatureSize(tgt.system?.size))) return ui.notifications.warn(i18n("AD2E.NavalCombat.TooSmall"));
  const ac = creature ? Number(tgt.system?.ac?.value ?? tgt.system?.ac?.base ?? 10) : artilleryAc(gun.key);
  const need = t.thac0 - ac;
  const notes = [i18n("AD2E.NavalCombat.GunLine", { name: att.name, gun: i18n(`AD2E.Naval.Artillery.${gun.key}`), band: i18n(`AD2E.NavalCombat.Band.${band.band}`), shots, need })];
  const rolls = [];
  const mod = band.mod + u.mods.missile + (att.system.morale.penalty ?? 0) + gi.mod;
  for (let k = 0; k < shots; k++) {
    const r = await roll("1d20");
    rolls.push(r);
    const hit = r.total === 20 || (r.total !== 1 && r.total + mod >= need);
    if (!hit) { notes.push(i18n("AD2E.NavalCombat.Miss", { roll: r.total + mod })); continue; }
    if (creature) {
      const d = await roll(C.creatureArtillery[gun.key]);
      rolls.push(d);
      notes.push(i18n("AD2E.NavalCombat.CreatureDamage", { name: tgt.name, dmg: d.total, greek: gun.key === "greekFireProjector" ? i18n("AD2E.NavalCombat.GreekCreature") : "" }));
      continue;
    }
    if (gun.key === "greekFireProjector" || gun.incendiary) {
      if (tgt.system.spec.combat.defense === "X") { await tgt.update({ "system.sunk": true }); notes.push(i18n("AD2E.NavalCombat.DestroyedByFire", { name: tgt.name })); break; }
      notes.push(...(await startFire(tgt, "hull")));
      if (gun.key === "greekFireProjector") {
        const al = await allocate(tgt, 5);
        notes.push(await applyHits(tgt, al.entries));
        notes.push(...(await incendiaryRolls(tgt, 5)));
      }
      continue;
    }
    notes.push(...(await artilleryHit(att, tgt, t)));
  }
  const list = foundry.utils.deepClone(att._source.system.artillery);
  list[gi.i].loaded = minutes === 1 ? Math.max(rate.every - 1, 0) : 0;
  await att.update({ "system.artillery": list });
  return post(lines(notes), { actor: att, rolls });
}

/** Table 22 (and 23) for a hit on a ship. */
async function artilleryHit(att, tgt, t) {
  const notes = [];
  const x = tgt.system.spec.combat.defense === "X";
  const eff = artilleryEffect((await total("2d10")) + (t.critBonus ?? 0));
  const dmg = async () => total(t.damage ?? "1");
  const crip = async (less = 0) => Math.max((await dmg()) - less, 1);
  const casualty = async () => { const e = missileTarget(tgt.system.spec.combat.defense, await total("1d10")); return applyHits(tgt, [[e, 3]]); };
  notes.push(i18n(`AD2E.NavalCombat.Effect.${eff.replace(/[+-]/g, "_")}`));
  if (x) {
    await damageShip(tgt, { hull: await dmg(), crippling: await dmg() }, { quiet: true });
    if (eff.startsWith("critical")) await damageShip(tgt, { hull: await dmg(), crippling: await dmg() }, { quiet: true });
    return notes;
  }
  if (eff === "crippling-2") await damageShip(tgt, { crippling: await crip(2) }, { quiet: true });
  if (eff === "crippling-1") await damageShip(tgt, { crippling: await crip(1) }, { quiet: true });
  if (eff === "crippling" || eff === "crippling+casualty") await damageShip(tgt, { crippling: await dmg() }, { quiet: true });
  if (eff === "hull-1") await damageShip(tgt, { hull: Math.max((await dmg()) - 1, 0) }, { quiet: true });
  if (eff === "hull" || eff === "hull+casualty") await damageShip(tgt, { hull: await dmg() }, { quiet: true });
  if (eff === "critical+both") await damageShip(tgt, { hull: await dmg(), crippling: await dmg() }, { quiet: true });
  if (eff.endsWith("casualty") || eff === "critical+both") notes.push(await casualty());
  if (eff.startsWith("critical")) {
    const crit = artilleryCrit(await total("2d4"));
    notes.push(i18n(`AD2E.NavalCombat.Crit.${crit}`));
    const u = unitOf(battle(), tgt.uuid);
    if (u) { const b = battle(); unitOf(b, tgt.uuid).crit = true; await saveBattle(b); }
    if (crit === "hullSmashed") {
      await damageShip(tgt, { hull: await total("2d6") }, { quiet: true });
      notes.push(await checkSeaworthiness(tgt, { extra: 0, founder: true }));
    } else if (crit === "cripplingStrike") {
      await damageShip(tgt, { crippling: await total("2d6") }, { quiet: true });
      notes.push(await applyHits(tgt, [[tgt.system.prop === "oar" ? "rower" : "sailor", 3]]));
    } else if (crit === "tacticalStrike") {
      await damageShip(tgt, { hull: 2 * (await dmg()) }, { quiet: true });
      if (tgt.system.incendiary > 0 || tgt.system.artillery.some(a => a.key === "greekFireProjector" && !a.destroyed)) notes.push(...(await incendiaryRolls(tgt, 2)));
    } else if (crit === "artilleryHitCrewCasualty") {
      const live = tgt.system.artillery.map((a, i) => ({ ...a, i })).filter(a => !a.destroyed);
      if (live.length) {
        const pick = live[(await total(`1d${live.length}`)) - 1];
        const list = foundry.utils.deepClone(tgt._source.system.artillery);
        list[pick.i].destroyed = true;
        await tgt.update({ "system.artillery": list });
        const m = marineLosses(tgt.system.marines, 0);
        const w = woundGroup({ count: tgt.system.marines.count, hd: tgt.system.marines.hd, wounds: tgt.system.marines.wounds }, 3);
        await tgt.update({ "system.marines": { ...marineLosses(m, w.dead, ["artillerists", "free", "archers", "firefighters", "boarders"]), hd: m.hd, wounds: w.group.wounds } });
        notes.push(i18n("AD2E.NavalCombat.GunDestroyed", { gun: i18n(`AD2E.Naval.Artillery.${pick.key}`) }));
        if (pick.key === "greekFireProjector") { notes.push(...(await startFire(tgt, "hull"))); notes.push(...(await incendiaryRolls(tgt, 5))); }
      }
    } else if (crit === "ramSmashed") {
      await tgt.update({ "system.ramFactor": 0 });
      await damageShip(tgt, { hull: await total("1d6") }, { quiet: true });
    }
  }
  return notes;
}

/** A seaworthiness check in battle (morale penalty applies); a failure founders in 1d10 hours, a 20 sinks. */
export async function checkSeaworthiness(ship, { extra = 0, founder = true } = {}) {
  const s = ship.system;
  const r = await total("1d20");
  const res = seaworthinessCheck(r, s.seaworthinessNow, { penalty: extra + (s.morale.penalty ?? 0) + (s.jury ? NAVAL.wreck.juryPenalty : 0) });
  if (!res.fail) return i18n("AD2E.NavalCombat.CheckOk", { name: ship.name, roll: r, target: res.target });
  if (r === 20 || !founder) {
    const rounds = await total(C.sinking[s.sizeKey] ?? "1");
    await ship.update({ "system.founderAt": (game.time?.worldTime ?? 0) + rounds * (CONFIG.time?.roundTime || 60) });
    return i18n("AD2E.NavalCombat.CheckSinks", { name: ship.name, roll: r, target: res.target, n: rounds });
  }
  const h = await total(NAVAL.wreck.founderHours);
  await ship.update({ "system.founderAt": (game.time?.worldTime ?? 0) + h * 3600 });
  return i18n("AD2E.NavalCombat.CheckFounders", { name: ship.name, roll: r, target: res.target, hours: h });
}

/** Ramming (Tables 24-26; creatures Tables 36/37): only at range 0, oared ships (or creatures that can ram), once every other round. */
export async function ram(uuid) {
  const b = battle();
  const u = unitOf(b, uuid);
  const att = actorOf(uuid);
  const tgt = actorOf(u?.target);
  if (!u || !att || !tgt) return ui.notifications.warn(i18n("AD2E.NavalCombat.NeedTarget"));
  if (rangeOf(b, uuid, u.target) > 0) return ui.notifications.warn(i18n("AD2E.NavalCombat.NotZero"));
  if (u.ramWait > b.round) return ui.notifications.warn(i18n("AD2E.NavalCombat.RamWait"));
  if (isShip(att) && (att.system.ram === null || att.system.ram === undefined || att.system.prop === "sail")) return ui.notifications.warn(i18n("AD2E.NavalCombat.CannotRam"));
  if (!isShip(att) && !sizeOf(att)) return ui.notifications.warn(i18n("AD2E.NavalCombat.CannotRam"));
  const aim = isShip(tgt) && baseRate(tgt.system.spec, "oar", { combat: true }) ? await ad2eDialog.wait({ window: { title: i18n("AD2E.NavalCombat.Ram") }, rejectClose: false,
    content: `<p>${esc(i18n("AD2E.NavalCombat.RamAim"))}</p>`,
    buttons: [{ action: "hull", label: i18n("AD2E.Naval.FireAt.hull"), default: true }, { action: "crippling", label: i18n("AD2E.Naval.FireAt.crippling") }] }) : "hull";
  if (!aim) return null;
  const notes = [];
  const rolls = [];
  // A ship ramming a creature: no Table 24; the creature takes Table 36 damage (save vs. breath halves, the ramming factor a penalty).
  if (isShip(att) && !isShip(tgt)) {
    const row = C.creatureRam[creatureSize(tgt.system?.size)];
    if (!row?.damage) return ui.notifications.warn(i18n("AD2E.NavalCombat.TooSmall"));
    const d = await roll(row.damage);
    rolls.push(d);
    notes.push(i18n("AD2E.NavalCombat.RamCreature", { name: tgt.name, dmg: d.total, rf: att.system.ram ?? 0 }));
  } else {
    const mod = ramModifier({ rf: isShip(att) ? att.system.ram : 0, size: sizeOf(att), targetSize: isShip(tgt) ? tgt.system.sizeKey : sizeOf(tgt),
      maneuver: u.mods.ram, evasion: u.mods.ramBoard, morale: isShip(att) ? (att.system.morale.penalty ?? 0) : 0 })
      + (isShip(att) ? 0 : creatureRamAc(Number(att.system?.ac?.value ?? att.system?.ac?.base ?? 10)));
    const r = await roll("2d6");
    rolls.push(r);
    const res = ramResult(r.total + mod);
    notes.push(i18n("AD2E.NavalCombat.RamLine", { name: att.name, target: tgt.name, roll: r.total, mod, total: r.total + mod, result: i18n(`AD2E.NavalCombat.Ram24.${res.effect}`) }));
    const loc = aim === "crippling" ? "crippling" : "hull";
    const hurt = async (ship, n) => {
      if (!isShip(ship)) { notes.push(i18n("AD2E.NavalCombat.CreatureHurt", { name: ship.name, dmg: n })); return; }
      await damageShip(ship, { [loc]: n }, { quiet: true });
      if (ship.system.rowers.count > 0) notes.push(await applyHits(ship, [["rower", n]]));
    };
    if (res.effect === "selfDamage") await hurt(att, await total(`${res.dice}d6`));
    if (res.effect === "damage" || (res.effect === "critical" && res.dice)) await hurt(tgt, await total(`${res.dice}d6`));
    if (res.effect === "deadly") notes.push(...(await deadlyStrike(att, tgt, u)));
    if (res.effect === "criticalMiss" && isShip(att)) notes.push(...(await ramCriticalMiss(att, tgt)));
    if (res.effect === "critical" && isShip(tgt)) notes.push(...(await ramCriticalHit(att, tgt, u, aim)));
    if (["criticalMiss", "critical", "deadly"].includes(res.effect)) {
      const bb = battle();
      for (const id of [uuid, u.target]) { const x = unitOf(bb, id); if (x) x.crit = true; }
      await saveBattle(bb);
    }
  }
  const bb = battle();
  const me = unitOf(bb, uuid);
  if (me) me.ramWait = bb.round + 2;
  await saveBattle(bb);
  return post(lines(notes), { actor: att, rolls });
}

async function deadlyStrike(att, tgt, u) {
  const notes = [];
  if (!isShip(tgt)) return [i18n("AD2E.NavalCombat.CreatureHurt", { name: tgt.name, dmg: "?" })];
  await damageShip(tgt, { hull: Math.floor(tgt.system.hullMax / 2) }, { quiet: true });
  notes.push(i18n("AD2E.NavalCombat.Deadly", { name: tgt.name }));
  notes.push(await checkSeaworthiness(tgt, { extra: -2, founder: true }));
  // The rammer may be stuck: a maneuverability roll of 6 or less.
  const m = isShip(att) ? await total(diceText(att.system.maneuver, att.system.diceMod)) : 99;
  if (m <= 6) {
    const b = battle();
    const me = unitOf(b, att.uuid);
    if (me) { me.stuck = tgt.uuid; me.stuckTries = 0; }
    await saveBattle(b);
    notes.push(i18n("AD2E.NavalCombat.Stuck", { name: att.name, roll: m }));
  }
  return notes;
}

async function ramCriticalMiss(att, tgt) {
  const notes = [];
  const eff = ramMiss(await total("2d4"));
  notes.push(i18n(`AD2E.NavalCombat.Miss25.${eff}`));
  const s = att.system;
  if (eff === "ramShatters") {
    if (isShip(tgt)) await damageShip(tgt, { hull: await total("1d6") }, { quiet: true });
    if (s.ram) await att.update({ "system.ramFactor": 0 });
    const r = await total("1d20");
    if (seaworthinessCheck(r, s.seaworthinessNow, { penalty: -3 + (s.morale.penalty ?? 0) }).fail) {
      const h = await total(NAVAL.wreck.founderHours);
      await att.update({ "system.founderAt": (game.time?.worldTime ?? 0) + h * 3600 });
      notes.push(i18n("AD2E.NavalCombat.Holed", { name: att.name, hours: h }));
    }
  } else if (eff === "ramDamaged") {
    if (isShip(tgt)) await damageShip(tgt, { hull: await total("1d6") }, { quiet: true });
    if (s.ram) await att.update({ "system.ramFactor": s.ram - 1 });
    else if (seaworthinessCheck(await total("1d20"), s.seaworthinessNow, { penalty: -2 }).fail) await damageShip(att, { hull: await total("2d6") }, { quiet: true });
  } else if (eff === "oarsShearedSailsTear") {
    const oars = s.prop === "oar" || (s.prop === "both" && (await total("1d6")) <= 3);
    const g = oars ? "rowers" : "sailors";
    await att.update({ [`system.${g}.count`]: Math.ceil(s[g].count / 2), "system.propulsion": oars ? "sail" : "oar" });
  } else if (eff === "poorTacticalPosition" || eff === "fouledOarsRigging") {
    const b = battle();
    const me = unitOf(b, att.uuid);
    if (me && eff === "poorTacticalPosition") me.nextMod -= 3;
    await saveBattle(b);
  } else if (eff === "collision") {
    await damageShip(att, { hull: await total("2d6") }, { quiet: true });
  }
  return notes;
}

async function ramCriticalHit(att, tgt, u, aim) {
  const notes = [];
  const eff = ramCrit(await total("2d4"));
  notes.push(i18n(`AD2E.NavalCombat.Crit26.${eff}`));
  const s = tgt.system;
  const ready = s.incendiary > 0 || s.artillery.some(a => a.key === "greekFireProjector" && !a.destroyed);
  const b = battle();
  const me = unitOf(b, att.uuid);
  const them = unitOf(b, tgt.uuid);
  if (eff === "deadlyStrike") notes.push(...(await deadlyStrike(att, tgt, u)));
  else if (eff === "oarsShearedMastCracked") {
    const oars = s.prop === "oar" || (s.prop === "both" && (await total("1d6")) <= 3);
    const g = oars ? "rowers" : "sailors";
    await tgt.update({ [`system.${g}.count`]: Math.ceil(s[g].count / 2), "system.propulsion": oars ? "sail" : "oar" });
  } else if (eff === "crewStunned") {
    if (them) them.nextMod -= 4;
    if (ready) { notes.push(...(await startFire(tgt, "hull"))); notes.push(...(await incendiaryRolls(tgt, 5))); }
  } else if (eff === "tacticalAdvantage") {
    if (me) { me.nextMod += 3; me.mods.board += 2; }
  } else if (eff === "cripplingStrike") {
    if (them) them.nextMod -= 3;
    const pts = aim === "crippling" ? Math.ceil(s.cripplingMax / 4) : Math.ceil(s.hullMax / 4);
    await damageShip(tgt, aim === "crippling" ? { crippling: pts } : { hull: pts }, { quiet: true });
    if (aim !== "crippling" && ready) notes.push(...(await incendiaryRolls(tgt, 2)));
  }
  await saveBattle(b);
  return notes;
}

/** Boarding attempt (Table 27): at range 0 (or grappled), boarding factors compared, maneuvering bonuses, +6 after a grapple. */
export async function board(uuid) {
  const b = battle();
  const u = unitOf(b, uuid);
  const att = actorOf(uuid);
  const tgt = actorOf(u?.target);
  if (!u || !att || !tgt || !isShip(tgt)) return ui.notifications.warn(i18n("AD2E.NavalCombat.NeedTarget"));
  const them = unitOf(b, u.target);
  const grappled = them?.grappledBy === uuid && them.grapple === "held";
  if (rangeOf(b, uuid, u.target) > 0 && !grappled) return ui.notifications.warn(i18n("AD2E.NavalCombat.NotZero"));
  const party = isShip(att) ? att.system.marines.boarders : Number(att.system?.unitSize ?? 1);
  const defend = tgt.system.marines.boarders;
  const mod = boardingFactorMod(party, defend) + u.mods.board + u.mods.ramBoard + (grappled && them.grapple === "held" && u.boardBonus ? 6 : 0)
    + (isShip(att) ? (att.system.morale.penalty ?? 0) : 0);
  const r = await roll("2d10");
  const res = boardResult(r.total + mod);
  const notes = [i18n("AD2E.NavalCombat.BoardLine", { name: att.name, target: tgt.name, roll: r.total, mod, total: r.total + mod, result: i18n(`AD2E.NavalCombat.Board27.${res.effect}`) })];
  if (res.effect === "partial") { them.grappledBy = uuid; them.grapple = "partial"; them.partial = true; }
  if (res.effect === "grappled") { them.grappledBy = uuid; them.grapple = "held"; u.boardBonus = true; }
  if (res.effect === "board") {
    them.grappledBy = uuid; them.grapple = "held"; u.boardBonus = false;
    u.across = Math.min(party, (u.across ?? 0) + boardersFor(party, res.part));
    notes.push(i18n("AD2E.NavalCombat.Across", { n: u.across }));
  }
  await saveBattle(b);
  return post(lines(notes), { actor: att, rolls: [r] });
}

/** Boarding melee: Table 15 for every 10 boarders on each side, casualties to the opposing boarding party. */
export async function melee(uuid) {
  const b = battle();
  const u = unitOf(b, uuid);
  const att = actorOf(uuid);
  const tgt = actorOf(u?.target);
  if (!u || !att || !tgt || !isShip(att) || !isShip(tgt) || !(u.across > 0)) return ui.notifications.warn(i18n("AD2E.NavalCombat.NoBoarders"));
  const defenders = tgt.system.marines.boarders;
  const notes = [];
  const rolls = [];
  if (!defenders) {
    notes.push(i18n("AD2E.NavalCombat.Captured", { name: tgt.name }));
    return post(lines(notes), { actor: att });
  }
  const side = async (thac0, ac, factors, mods) => {
    const d = [];
    for (let i = 0; i < Math.ceil(factors / 10); i++) { const r = await roll("1d20"); rolls.push(r); d.push(r.total); }
    return volleyHits(factors, hitNumber(thac0, ac, mods), d).hits;
  };
  const fm = boardingFactorMod(u.across, defenders);
  const hitsOnDef = await side(att.system.thac0, tgt.system.ac, u.across, (att.system.morale.penalty ?? 0) + Math.max(fm, 0));
  const hitsOnAtt = await side(tgt.system.thac0, att.system.ac, defenders, (tgt.system.morale.penalty ?? 0) + Math.max(-fm, 0));
  const dw = woundGroup({ count: defenders, hd: tgt.system.marines.hd, wounds: 0 }, hitsOnDef);
  const aw = woundGroup({ count: u.across, hd: att.system.marines.hd, wounds: 0 }, hitsOnAtt);
  await tgt.update({ "system.marines": { ...marineLosses(tgt.system.marines, dw.dead, ["boarders"]), hd: tgt.system.marines.hd, wounds: tgt.system.marines.wounds } });
  await att.update({ "system.marines": { ...marineLosses(att.system.marines, aw.dead, ["boarders"]), hd: att.system.marines.hd, wounds: att.system.marines.wounds } });
  u.across = Math.max(u.across - aw.dead, 0);
  if (!u.across) { const them = unitOf(b, u.target); if (them) { them.grapple = ""; them.grappledBy = ""; them.partial = false; } }
  await saveBattle(b);
  notes.push(i18n("AD2E.NavalCombat.MeleeLine", { a: att.name, b: tgt.name, ka: dw.dead, kb: aw.dead, left: u.across }));
  return post(lines(notes), { actor: att, rolls });
}

/** Free a grappled (partial 5-6, full 6, +1 per 10 helpers; 1 fails) or stuck ship (4+; +2 with the whole crew, -1 per failed try). */
export async function breakFree(uuid) {
  const b = battle();
  const u = unitOf(b, uuid);
  const actor = actorOf(uuid);
  if (!u || !actor) return null;
  const f = await ad2eDialog.prompt({ window: { title: i18n("AD2E.NavalCombat.BreakFree") }, rejectClose: false,
    content: `<div class="form-group"><label>${esc(i18n("AD2E.NavalCombat.Helpers"))}</label><input type="number" name="helpers" value="0" min="0"></div>`
      + (u.stuck ? `<div class="form-group"><label>${esc(i18n("AD2E.NavalCombat.AllHands"))}</label><input type="checkbox" name="all"></div>` : ""),
    ok: { label: i18n("AD2E.Roll.Roll"), callback: (e, bt) => ({ helpers: Number(bt.form.elements.helpers.value) || 0, all: !!bt.form.elements.all?.checked }) } });
  if (!f) return null;
  const r = await roll("1d6");
  let ok = false;
  if (u.stuck) {
    ok = r.total + (f.all ? 2 : 0) - u.stuckTries >= 4;
    if (ok) { u.stuck = ""; u.stuckTries = 0; } else u.stuckTries++;
  } else if (u.grapple) {
    ok = r.total !== 1 && r.total + Math.floor(f.helpers / 10) >= (u.grapple === "partial" ? 5 : 6);
    const holder = unitOf(b, u.grappledBy);
    if (ok && !(holder?.across > 0)) { u.grapple = ""; u.grappledBy = ""; u.partial = false; } else ok = false;
  }
  await saveBattle(b);
  return post(lines([i18n(ok ? "AD2E.NavalCombat.Freed" : "AD2E.NavalCombat.NotFreed", { name: actor.name, roll: r.total })]), { actor, rolls: [r] });
}

/** Table 18/19 rolls for spells (Player Characters in Detailed Naval Combat (OSS)): N rolls, hits per section struck. */
export async function sectionRolls(uuid) {
  const tgt = actorOf(uuid);
  if (!isShip(tgt)) return null;
  const f = await ad2eDialog.prompt({ window: { title: i18n("AD2E.NavalCombat.SpellRolls") }, rejectClose: false,
    content: `<p class="ad2e-note">${esc(i18n("AD2E.NavalCombat.SpellHint"))} <a href="${esc(NAVAL.urls.pcs)}" target="_blank" rel="noopener">${esc(i18n("AD2E.NavalCombat.SpellLink"))}</a></p>`
      + `<div class="form-group"><label>${esc(i18n("AD2E.NavalCombat.Table18Rolls"))}</label><input type="number" name="n" value="1" min="0"></div>`
      + `<div class="form-group"><label>${esc(i18n("AD2E.NavalCombat.HitsEach"))}</label><input type="number" name="h" value="1" min="0"></div>`
      + `<div class="form-group"><label>${esc(i18n("AD2E.NavalCombat.Table19Rolls"))}</label><input type="number" name="fire" value="0" min="0"></div>`,
    ok: { label: i18n("AD2E.Roll.Roll"), callback: (e, bt) => ({ n: Number(bt.form.elements.n.value) || 0, h: Number(bt.form.elements.h.value) || 0,
      fire: Number(bt.form.elements.fire.value) || 0 }) } });
  if (!f) return null;
  const entries = [];
  for (let i = 0; i < f.n; i++) entries.push([missileTarget(tgt.system.spec.combat.defense, await total("1d10")), f.h]);
  const notes = [];
  if (entries.length) notes.push(await applyHits(tgt, entries));
  if (f.fire) notes.push(...(await incendiaryRolls(tgt, f.fire)));
  return post(lines(notes), { actor: tgt });
}

/** Morale check (Tables 31-33): base rating, situational modifiers (some ticked from the battle), 2d10. */
export async function moraleCheckDialog(uuid) {
  const ship = actorOf(uuid);
  if (!isShip(ship)) return null;
  const s = ship.system;
  const b = battle();
  const u = unitOf(b, uuid);
  const foe = actorOf(u?.target);
  const lost = 1 - s.hullNow / Math.max(s.hullMax, 1);
  const auto = new Set();
  if (lost >= 0.75) auto.add("shipHasLost75OfItsHullPoints"); else if (lost >= 0.5) auto.add("shipHasLost50OfItsHullPoints"); else if (lost >= 0.25) auto.add("shipHasLost25OfItsHullPoints");
  if (s.captain) auto.add("captainOnDeck"); else auto.add("captainSlain");
  if (s.fires.length) auto.add("shipOnFire");
  if (isShip(foe) && foe.system.fires.length) auto.add("opponentSShipOnFire");
  if (isShip(foe) && foe.system.hullNow <= foe.system.hullMax / 2) auto.add("opponentHasLost50OfItsHullPoints");
  const mods = C.moraleMods;
  const f = await ad2eDialog.prompt({ window: { title: i18n("AD2E.NavalCombat.MoraleTitle", { name: ship.name }) }, rejectClose: false,
    content: `<p class="ad2e-note">${esc(i18n("AD2E.NavalCombat.MoraleHint", { base: s.moraleRating, penalty: s.morale.penalty ?? 0 }))}</p><div class="ad2e-check-grid">`
      + mods.map((m, i) => `<label>${m.each ? `<input type="number" name="m${i}" value="${m.key === "officerOnDeck" ? s.officers : 0}" min="0" style="width:3rem">` : `<input type="checkbox" name="m${i}"${auto.has(m.key) ? " checked" : ""}>`} ${esc(m.label)} (${m.mod > 0 ? "+" : ""}${m.mod})</label>`).join("")
      + `</div><div class="form-group"><label>${esc(i18n("AD2E.Roll.Modifier"))}</label><input type="text" name="extra" value="0"></div>`,
    ok: { label: i18n("AD2E.Roll.Roll"), callback: (e, bt) => {
      const el = bt.form.elements;
      return mods.reduce((n, m, i) => n + (m.each ? (Number(el[`m${i}`].value) || 0) * m.mod : el[`m${i}`].checked ? m.mod : 0), 0) + (Number(el.extra.value) || 0);
    } } });
  if (f === null || f === undefined) return null;
  const rating = s.moraleRating + f + (s.morale.penalty ?? 0);
  const r = await roll("2d10");
  const res = moraleCheck(rating, r.total);
  const update = {};
  if (!res.pass && res.penalty !== null) update["system.morale.penalty"] = Math.min(s.morale.penalty ?? 0, res.penalty);
  if (res.surrender) update["system.morale.surrendered"] = true;
  if (Object.keys(update).length) await ship.update(update);
  const text = res.pass ? i18n("AD2E.NavalCombat.MoraleHolds", { name: ship.name, roll: r.total, rating })
    : res.surrender ? i18n("AD2E.NavalCombat.Surrenders", { name: ship.name, roll: r.total, rating })
      : i18n("AD2E.NavalCombat.MoraleFails", { name: ship.name, roll: r.total, rating, penalty: res.penalty });
  return post(lines([text]), { actor: ship, rolls: [r] });
}

/**
 * The Resolution phase: fires burn (once a minute, firefighters first), seaworthiness checks for hull damage this round,
 * rower endurance every ten minutes of combat, reloading, then the next round (world time advances by the round).
 */
export async function resolutionPhase() {
  const b = battle();
  const notes = [];
  let minutes = 1;
  for (const u of b.units) {
    if (u.target) minutes = Math.max(minutes, roundFor(rangeOf(b, u.uuid, u.target)).minutes);
  }
  for (const u of b.units) {
    const ship = actorOf(u.uuid);
    if (!isShip(ship) || ship.system.sunk) continue;
    // Fires.
    for (let m = 0; m < minutes && ship.system.fires.length; m++) {
      const fires = foundry.utils.deepClone(ship._source.system.fires);
      const ff = ship.system.marines.firefighters;
      const per = fires.length ? Math.floor(ff / fires.length) : 0;
      const extra = fires.length ? ff % fires.length : 0;
      const keep = [];
      for (let i = 0; i < fires.length; i++) {
        const n = per + (i < extra ? 1 : 0);
        let out = false;
        for (let k = 0; k < n && !out; k++) out = (await total(`1d${fires[i].die}`)) === 1;
        if (!out) keep.push(fires[i]);
      }
      if (keep.length !== fires.length) notes.push(i18n("AD2E.NavalCombat.FiresOut", { name: ship.name, n: fires.length - keep.length }));
      await ship.update({ "system.fires": keep });
      for (let i = 0; i < keep.length; i++) notes.push(...(await burn(ship, i)));
    }
    // Hull checks for this round's damage.
    const before = u.hullStart ?? ship.system.hullNow;
    const lostBefore = ship.system.hullMax - before;
    const lostAfter = ship.system.hullMax - ship.system.hullNow;
    const due = hullChecks(ship.system.hullMax, lostBefore, lostAfter);
    for (let i = 0; i < due; i++) notes.push(await checkSeaworthiness(ship, { founder: true }));
    // Rower endurance after every ten minutes of combat.
    u.minutes = (u.minutes ?? 0) + minutes;
    while (ship.system.rowers.count > 0 && ship.system.prop !== "sail" && Math.floor(u.minutes / 10) > (u.rowerChecks ?? 0)) {
      u.rowerChecks = (u.rowerChecks ?? 0) + 1;
      if (!ship.system.rowersTired && rowersTire(await total("1d10"), { both: ship.system.prop === "both", experience: ship.system.experience, check: u.rowerChecks })) {
        await ship.update({ "system.rowersTired": true });
        notes.push(i18n("AD2E.NavalCombat.RowersTire", { name: ship.name }));
      }
    }
    // Reloading (1-minute rounds count down).
    const list = foundry.utils.deepClone(ship._source.system.artillery);
    if (list.some(a => a.loaded > 0)) await ship.update({ "system.artillery": list.map(a => ({ ...a, loaded: Math.max((a.loaded ?? 0) - minutes, 0) })) });
    // Morale reminders.
    const reasons = [];
    if (u.crit) reasons.push(i18n("AD2E.NavalCombat.Reason.crit"));
    const quarter = h => Math.floor(4 * (1 - h / Math.max(ship.system.hullMax, 1)));
    if (quarter(ship.system.hullNow) > quarter(before) && quarter(ship.system.hullNow) <= 3) reasons.push(i18n("AD2E.NavalCombat.Reason.hull"));
    if (reasons.length) notes.push(i18n("AD2E.NavalCombat.MoraleDue", { name: ship.name, reasons: reasons.join(", ") }));
    u.crit = false;
    u.hullStart = ship.system.hullNow;
  }
  b.round += 1;
  b.phase = "declare";
  await saveBattle(b);
  if (game.user?.isGM && game.time?.advance) await game.time.advance(minutes * 60);
  return post(`<p><strong>${esc(i18n("AD2E.NavalCombat.ResolutionTitle", { round: b.round - 1, minutes }))}</strong></p>${lines(notes.length ? notes : [i18n("AD2E.NavalCombat.Quiet")])}`);
}

/** Begin a battle: hull points noted for the round's checks; morale penalties from an earlier battle cleared. */
export async function startBattle(b) {
  b.active = true;
  b.round = 1;
  b.phase = "declare";
  for (const u of b.units) {
    const a = actorOf(u.uuid);
    if (isShip(a)) { u.hullStart = a.system.hullNow; await a.update({ "system.morale.penalty": 0 }); }
  }
  return saveBattle(b);
}

/** End the battle (morale penalties last "for the duration of the battle"). */
export async function endBattle() {
  const b = battle();
  for (const u of b.units) {
    const a = actorOf(u.uuid);
    if (isShip(a)) await a.update({ "system.morale.penalty": 0 });
  }
  await saveBattle(structuredClone(EMPTY));
  return post(lines([i18n("AD2E.NavalCombat.Ended")]));
}

/** Allowed actions for a unit now (Table 11 by the range to its target). */
export function unitActions(b, u) {
  if (!u.target) return [];
  return actionsAt(rangeOf(b, u.uuid, u.target));
}

/** World setting and the change hook. Called in init. */
export function registerNavalBattle() {
  game.settings.register("ad2e", KEY, { scope: "world", config: false, type: Object, default: structuredClone(EMPTY),
    onChange: v => Hooks.callAll("ad2eNavalCombat", v) });
}

export { C as COMBAT };
