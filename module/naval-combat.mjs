/**
 * Detailed naval combat (Of Ships and the Sea, chapter 4; owner's request 1.0.81). Pure rules over the generated tables
 * (module/rules/naval-tables.mjs; tools/build-naval-tables.py quotes and regex-checks each rule). Dice are passed in.
 * Sources (adnd2e.fandom.com): Time in Nautical Combat (OSS) rev 172547 (Table 11), The Maneuvering Phase (OSS) rev 249006
 * (Tables 12-14: "The ship with the highest score wins the phase"; "the range between two ships can never shift more than
 * one category on Table 11"; rower endurance), Action Phase (OSS) rev 237560 (Tables 15-27), Resolution Phase (OSS)
 * rev 249023 (Tables 28-33), Monsters in Naval Combat (OSS) rev 237980 (Tables 34-37), Scuttling and Crippling (OSS)
 * rev 172666, Fleet Battles (OSS) rev 172688.
 * Implementation choices (marked where used): the winner of the maneuvering roll changes the range by the most it may
 * (the GM can type a smaller range); "adjusted hit number" = THAC0 - AC - bonuses (the worked example: THAC0 20 vs AC 10
 * gives 10), clamped to Table 15's 1-25; casualties among marines fall on the unassigned first, then archers, artillerists,
 * firefighters and boarders (the book lets the defender choose); after the half-hull check, further checks every quarter of
 * the hull points left at that point.
 */
import { NAVAL } from "./rules/naval-tables.mjs";
import { SIZES } from "./naval.mjs";

const C = NAVAL.combat;
export const ACTIONS = ["flee", "close", "ram", "evade", "board"];
export const MARINE_ORDER = ["free", "archers", "artillerists", "firefighters", "boarders"];

const inRange = (r, n) => (r[0] === null || n >= r[0]) && (r[1] === null || n <= r[1]);

/** Table 11 row for a range in yards (pure). */
export function roundFor(range) {
  const y = Math.max(Number(range) || 0, 0);
  return C.rounds.find(r => y >= r.min && (r.max === null || y <= r.max)) ?? C.rounds[C.rounds.length - 1];
}

const bandIndex = range => C.rounds.indexOf(roundFor(range));

/** Actions possible at a range (Table 11), the maneuvering ones only (pure). */
export function actionsAt(range) {
  return ACTIONS.filter(a => roundFor(range).actions.includes(a));
}

/**
 * Table 14 (pure): yards for an adjusted roll or movement rate in a round of `minutes`; above 21 the 21 row plus the
 * remainder ("subtract 21 from the ship's speed ... then add that number to the value for a ship with a speed of 21").
 */
export function rangeYards(value, minutes) {
  const per = C.rangePer[String(minutes)] ?? 10;
  const v = Math.max(Math.floor(Number(value) || 0), 0);
  if (v <= C.rangeMaxRate) return v * per;
  return C.rangeMaxRate * per + rangeYards(v - C.rangeMaxRate, minutes);
}

/**
 * Limit a range change to one Table 11 category (pure): closing from a farther band ends at the next band's farthest
 * range, opening from a nearer band at the next band's nearest range.
 */
export function limitRange(from, to) {
  const a = bandIndex(from);
  const b = bandIndex(to);
  if (Math.abs(a - b) <= 1) return Math.max(Math.round(to), 0);
  if (b < a) return C.rounds[a - 1].max;
  return C.rounds[a + 1].min;
}

/** Outcome from A's side (Table 13 columns; pure): great (A >= 2B), win, tie, lose, badly (A <= B/2). */
export function outcome(a, b) {
  if (a === b) return "tie";
  if (a > b) return a >= 2 * b ? "great" : "win";
  return a * 2 <= b ? "badly" : "lose";
}

const flip = { great: "badly", win: "lose", tie: "tie", lose: "win", badly: "great" };
const wantsClose = act => act === "close" || act === "ram" || act === "board";

/**
 * The Maneuvering phase for a pair (pure). `a`, `b` = { action, roll, rate } (roll already adjusted; rate = current
 * movement for ties and "both close/flee"). `d10` = the 1d10 for a tie. Returns { winner: "a" | "b" | null, range,
 * change, mods: { a, b }, grapple: { by, boarders } | null }. Mods per side: missile, ram, board, next (next round's
 * maneuverability or pursuit), and foe penalties from an evader (`foeRamBoard`).
 */
export function maneuver({ a, b, minutes, range, d10 = 5 }) {
  const oa = outcome(a.roll, b.roll);
  const mods = { a: { missile: 0, ram: 0, board: 0, next: 0, ramBoard: 0 }, b: { missile: 0, ram: 0, board: 0, next: 0, ramBoard: 0 } };
  let grapple = null;
  const apply = (side, act, cat) => {
    const e = C.maneuver[act]?.[cat];
    if (!e) return;
    const m = mods[side];
    const other = mods[side === "a" ? "b" : "a"];
    m.missile += e.missile ?? 0;
    m.ram += e.ram ?? 0;
    m.board += e.board ?? 0;
    m.next += e.next ?? 0;
    if (e.foeRamBoard) other.ramBoard += e.foeRamBoard;
    if (e.grapple) grapple = { by: side, boarders: e.boarders };
  };
  apply("a", a.action, oa);
  apply("b", b.action, flip[oa]);
  const winner = oa === "tie" ? null : ["great", "win"].includes(oa) ? "a" : "b";
  let change = 0;
  const yards = v => rangeYards(v, minutes);
  if (wantsClose(a.action) && wantsClose(b.action)) change = -yards(a.rate + b.rate);
  else if (a.action === "flee" && b.action === "flee") change = yards(a.rate + b.rate);
  else if (winner) {
    const w = winner === "a" ? a : b;
    const l = winner === "a" ? b : a;
    const great = (winner === "a" ? oa : flip[oa]) === "great";
    const amount = yards(great ? w.roll : w.roll - l.roll);
    if (w.action === "flee") change = amount;
    else if (wantsClose(w.action)) change = -amount;
    // An evader that wins does not move the range; its foe "automatically becomes free to change the range by an amount
    // determined by its maneuverability roll" (notes to Table 13).
    else if (w.action === "evade" && wantsClose(l.action)) change = -yards(l.roll);
  } else {
    // Tie: "Range changes in favor of the faster vessel by 1d10x10 yards".
    const faster = a.rate === b.rate ? null : a.rate > b.rate ? a : b;
    if (faster) change = (faster.action === "flee" ? 1 : wantsClose(faster.action) ? -1 : 0) * d10 * 10;
  }
  let to = limitRange(range, range + change);
  if (grapple) to = 0;
  return { winner, outcome: oa, range: Math.max(to, 0), change, mods, grapple };
}

/** Table 15's adjusted hit number (pure): THAC0 - AC - bonuses, clamped to 1-25 (implementation choice, see header). */
export function hitNumber(thac0, ac, bonus = 0) {
  return Math.min(Math.max(Math.round(thac0 - ac - bonus), 1), 25);
}

/** Hits for one d20 at a hit number (Table 15; pure). */
export const tableHits = (d20, number) => C.hits[Math.min(Math.max(d20, 1), 20) - 1][number - 1];

/**
 * Hits from a number of attack factors (pure): one d20 per 10 factors on Table 15; a remnant rolls once on Table 15 and
 * reads Table 16. `d20s` = enough rolls (one per full ten, plus one for the remnant).
 */
export function volleyHits(factors, number, d20s) {
  const n = Math.max(Math.floor(factors), 0);
  const tens = Math.floor(n / 10);
  const extra = n % 10;
  let hits = 0;
  const rolls = [];
  for (let i = 0; i < tens; i++) { const r = d20s[i]; rolls.push(r); hits += tableHits(r, number); }
  if (extra) {
    const r = d20s[tens];
    rolls.push(r);
    hits += C.extraHits[extra - 1][Math.min(tableHits(r, number), 10)];
  }
  return { hits, rolls, dice: tens + (extra ? 1 : 0) };
}

/** Table 18 entry for a d10 and defense class (pure): "", sailor, rower, marine, "marine*", special, na. */
export const missileTarget = (defense, d10) => C.missileHits[defense]?.[d10 - 1] ?? "";

/** Table 19 entry (pure): "", hull, crippling, with "+" / "++" for extra Table 18 rolls, or destroyed. */
export const incendiaryTarget = (defense, d10) => C.incendiaryHits[defense]?.[d10 - 1] ?? "";

/** Table 20 fire size for a d10 (pure). */
export const fireSize = d10 => C.fires.find(f => inRange(f.range, d10))?.die ?? 6;

/** The next fire size (d4 .. d20; pure). */
export function fireGrows(die) {
  const i = C.fireSteps.indexOf(die);
  return C.fireSteps[Math.min(i + 1, C.fireSteps.length - 1)];
}

/**
 * Hit dice of damage on a crew group { count, hd, wounds } (pure): "If the defenders are creatures with multiple hit dice,
 * one must die before any others suffer damage". Returns the new group and the dead.
 */
export function woundGroup(group, hits) {
  const hd = Math.max(group.hd ?? 1, 1);
  const total = (group.wounds ?? 0) + Math.max(hits, 0);
  const dead = Math.min(Math.floor(total / hd), group.count ?? 0);
  const count = Math.max((group.count ?? 0) - dead, 0);
  return { group: { ...group, count, wounds: count ? total - dead * hd : 0 }, dead };
}

/**
 * Marines' losses split over their duties (pure): the unassigned first, then archers, artillerists, firefighters and
 * boarders (implementation choice). `marines` = { count, archers, boarders, artillerists, firefighters }; `dead` = number.
 */
export function marineLosses(marines, dead, order = MARINE_ORDER) {
  const m = { ...marines };
  const free = Math.max(m.count - m.archers - m.boarders - m.artillerists - m.firefighters, 0);
  let left = Math.min(dead, m.count);
  m.count -= left;
  for (const k of order) {
    if (!left) break;
    const have = k === "free" ? free : m[k];
    const take = Math.min(have, left);
    if (k !== "free") m[k] -= take;
    left -= take;
  }
  return m;
}

/** Artillery range band for a range in yards (pure): out (below the minimum or beyond long), short, medium, long, with the attack modifier. */
export function artilleryBand(key, yards, { incendiary = false } = {}) {
  const a = C.artillery.find(x => x.key === key);
  if (!a) return { band: "out", mod: 0 };
  const scale = incendiary && key !== "greekFireProjector" ? 2 / 3 : 1;
  const t = v => (v === null || v === undefined ? null : Math.floor(v * scale) * 10);
  const r = { min: t(a.range.min), short: t(a.range.short), medium: t(a.range.medium), long: t(a.range.long) };
  const y = Number(yards) || 0;
  if (r.min !== null && y <= r.min) return { band: "out", mod: 0 };
  const catapult = /^catapult|^trebuchet/.test(key);
  if (r.short !== null && y <= r.short) return { band: "short", mod: 0 };
  if (r.medium !== null && y <= r.medium) return { band: "medium", mod: C.rangePenalty.medium };
  if (r.long !== null && y <= r.long) return { band: "long", mod: catapult ? 0 : C.rangePenalty.long };
  return { band: "out", mod: 0 };
}

/** Effective AC of a ship against a weapon (pure): ballistae 10, catapults and trebuchets 0, greek fire 5. */
export function artilleryAc(key) {
  if (key.startsWith("ballista")) return C.artilleryAc.ballista;
  if (key === "greekFireProjector") return C.artilleryAc.greekFire;
  return C.artilleryAc.catapult;
}

/** Shots in a round (pure): one-minute rounds fire when loaded; ten-minute rounds fire the parenthesised number. A short crew slows the weapon by one per missing person. */
export function artilleryRate(key, crew) {
  const a = C.artillery.find(x => x.key === key);
  if (!a) return { every: 1, perTen: 0 };
  const missing = Math.max(a.crew - (crew ?? 0), 0);
  if (crew <= 0) return { every: Infinity, perTen: 0 };
  return { every: a.every + missing, perTen: a.perTen === null ? Math.floor(10 / (a.every + missing)) : Math.max(a.perTen - missing, 0) };
}

/** Table 22 effect for a 2d10 total (+ the weapon's bonus; pure). */
export const artilleryEffect = total => C.artilleryEffects.find(e => inRange(e.range, total))?.effect ?? "glancing";

/** Table 23 effect for a 2d4 total (pure). */
export const artilleryCrit = total => C.artilleryCrits.find(e => inRange(e.range, total))?.effect ?? "hullSmashed";

/** Ram modifiers (pure): ramming factor, size categories (+1 per larger, -1 per smaller), maneuvering and evasion mods, morale. */
export function ramModifier({ rf = 0, size, targetSize, maneuver = 0, evasion = 0, morale = 0 }) {
  const d = SIZES.indexOf(size) - SIZES.indexOf(targetSize);
  return (rf ?? 0) + d + maneuver + evasion + morale;
}

/** Table 24 row for a 2d6 total (pure). */
export const ramResult = total => C.ramming.find(e => inRange(e.range, total));
export const ramMiss = total => C.ramMisses.find(e => inRange(e.range, total))?.effect;
export const ramCrit = total => C.ramCrits.find(e => inRange(e.range, total))?.effect;

/** Boarding factors' modifier (pure): one per 5 points of difference, for the side with more. */
export function boardingFactorMod(attacker, defender) {
  const d = (attacker ?? 0) - (defender ?? 0);
  return Math.sign(d) * Math.floor(Math.abs(d) / 5);
}

/** Table 27 row for a 2d10 total (pure). */
export const boardResult = total => C.boarding.find(e => inRange(e.range, total));

/** Boarders who cross for a part (pure; rounding up). */
export const boardersFor = (party, part) => Math.ceil(Math.max(party, 0) * part);

/**
 * Seaworthiness checks owed for hull damage (pure): one when half the original hull points are lost (rounded down), then
 * one per further quarter of the points left at that point (implementation choice). Returns the number of thresholds
 * crossed between `lostBefore` and `lostAfter`.
 */
export function hullChecks(max, lostBefore, lostAfter) {
  const half = Math.floor(max / 2);
  const step = Math.max(Math.ceil((max - half) / 4), 1);
  const marks = [];
  for (let m = half; m < max; m += step) marks.push(m);
  return marks.filter(m => lostBefore < m && lostAfter >= m).length;
}

/** Table 33 for a failed morale check (pure): { penalty, surrender }. */
export function moraleFailure(degree) {
  const row = C.moraleFailure.find(e => inRange(e.range, degree));
  return { penalty: row?.penalty ?? null, surrender: !!row?.surrender };
}

/** A morale check (pure): 2d10 at or under the adjusted rating passes. */
export function moraleCheck(rating, total) {
  const pass = total <= rating;
  return { pass, degree: pass ? 0 : total - rating, ...(pass ? { penalty: null, surrender: false } : moraleFailure(total - rating)) };
}

/** Rower endurance (pure): after every ten minutes, d10 (+1 under sail and oars) of 4 or less tires; Mates pass the first check, Mariners and Old Salts two. */
export function rowersTire(d10, { both = false, experience = "mates", check = 1 } = {}) {
  const free = experience === "mates" ? 1 : ["mariners", "oldSalts"].includes(experience) ? 2 : 0;
  if (check <= free) return false;
  return d10 + (both ? 1 : 0) <= 4;
}

/** Monster size letter -> Table 34 key (pure). */
export function creatureSize(text) {
  const l = String(text ?? "").trim().charAt(0).toUpperCase();
  return { T: "tiny", S: "small", M: "man", L: "large", H: "huge", G: "gargantuan" }[l] ?? "man";
}

/** Swimming rate from a monster's movement text ("9, Sw 15"; pure). */
export function swimRate(text) {
  const m = String(text ?? "").match(/\bSw\s*(\d+)/i);
  return m ? Number(m[1]) : 0;
}

/** A creature's maneuverability (Table 34, +1 swimming 12 or more) and pursuit (1d6 + a third of its swimming rate; pure). */
export function creatureDice(sizeKey, swim) {
  const row = C.creatures[sizeKey] ?? C.creatures.man;
  return { maneuver: { ...row.maneuver, plus: row.maneuver.plus + (swim >= 12 ? 1 : 0) }, pursuit: { n: 1, die: 6, plus: Math.floor(swim / 3) },
    autoPass: row.autoPass };
}

/**
 * Table 37 creature ramming adjustment for an AC (pure). Its first row "8 or less" means AC 8 or worse and its last
 * "-5 or better" AC -5 or better; AC -2 (between "1 to -1" and "-3 to -4") takes +2 (implementation choice).
 */
export function creatureRamAc(ac) {
  const rows = C.creatureRamAc;
  const a = Number(ac) || 0;
  if (a >= rows[0].range[1]) return rows[0].mod;
  if (a <= rows[rows.length - 1].range[0]) return rows[rows.length - 1].mod;
  return rows.slice(1, -1).find(e => inRange(e.range, a))?.mod ?? 2;
}

/**
 * Scuttling (pure): six Man-sized creatures do 1d2 hull (or 1d4 crippling) per round; each missing one adds a round's
 * delay (surface dwellers need eight unless under free action). Equivalents: four Tiny or two Small = one Man, Large 2,
 * Huge 3. Returns { equivalent, need, rounds } (rounds per damage roll; Infinity with nobody).
 */
export function scuttling({ tiny = 0, small = 0, man = 0, large = 0, huge = 0, surface = false, freeAction = false } = {}) {
  const eq = Math.floor(tiny / 4 + small / 2 + man + large * 2 + huge * 3);
  const need = surface && !freeAction ? 8 : 6;
  return { equivalent: eq, need, rounds: eq <= 0 ? Infinity : 1 + Math.max(need - eq, 0) };
}

/** Creatures needed to hold a ship still (pure): Small 2, Medium 15, then +15 per size. */
export const holdShip = size => (size === "small" ? 2 : 15 + 15 * Math.max(SIZES.indexOf(size) - 1, 0));

/**
 * Fleet battle bonus for side A against side B (pure): +1 per 5 extra marines and artillery missile factors, the ramming
 * factor difference, +1 per 3 extra seaworthiness (each for the side with more).
 */
export function fleetBonus(a, b) {
  const f = (x, y, per) => Math.sign(x - y) * Math.floor(Math.abs(x - y) / per);
  return f(a.factors, b.factors, 5) + ((a.rf ?? 0) - (b.rf ?? 0)) + f(a.seaworthiness, b.seaworthiness, 3);
}

/** Missile factors of a ship (pure): archers up to the Table 17 limit, unless ramming this round. */
export function archerFactors(archers, size, { ramming = false } = {}) {
  if (ramming) return 0;
  return Math.min(Math.max(archers ?? 0, 0), C.archers[size] ?? 0);
}
