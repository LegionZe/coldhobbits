import { NPC_TABLES } from "./rules/npc-tables.mjs";
import { ABILITY_TABLES } from "./rules/ability-tables.mjs";
import { XP_TABLE } from "./rules/level-tables.mjs";
import { RACE_WEIGHT } from "./rules/race-tables.mjs";
import { CREATOR_TABLES } from "./rules/creator-tables.mjs";
import { AGING } from "./rules/aging-tables.mjs";
import { hitDiceAt, lookup } from "./config.mjs";
import { simpleDice } from "./construction.mjs";

/**
 * Random NPC builder (module/apps/npc-builder.mjs; module/rules/npc-tables.mjs from tools/build-npc-tables.py).
 * Owner's rulings: the result is a character actor (race and class items, rolled abilities, level, hit points,
 * equipment); purposes: townsfolk (DMG Table 60 professions), soldiers (Table 64), adventurers, officials (Tables 66-68
 * titles), sages (Table 61), spellcasters for hire (Table 69 costs in the notes), spies and assassins; abilities 3d6 in
 * order raised to the race's and class's minimums (and lowered to the race's maximums); levels from a GM formula per
 * purpose (0 for townsfolk, soldiers, officials and sages).
 * Owner's rulings (1.0.22): gender male, female, non-binary or agender; the PHB Table 10 column (male or female base
 * height and weight) is a separate choice.
 * Implementation choices: a random race is one allowing the class; a random class one of the purpose's classes allowed
 * for the race; the alignment one the class allows; a random gender is one of the four with equal chance; the Table 10
 * column follows a male or female gender unless chosen, and is 50/50 for the others; age = the race's starting age
 * (PHB Table 11), height and weight from PHB Table 10; hit points rolled per Hit Die with the Constitution adjustment (at least 1 per die), 1d6 at level 0;
 * experience = the minimum for the level; 0-level NPCs have no class item (THAC0 20, the 0-level warrior saves);
 * equipment: a basic set per class (`gear`), a soldier's from their Table 64 hireling, a tradesman's proficiency for his
 * profession; Table 70 traits and appearance words (Personality (DMG)) as for patrons; the name is "<race> <role>"
 * unless given.
 */
export const NPC = NPC_TABLES;
const PATRON = CREATOR_TABLES.patron;
export const ABILITIES = ["str", "dex", "con", "int", "wis", "cha"];
const WIZARDS = ["mage", "abjurer", "conjurer", "diviner", "enchanter", "illusionist", "invoker", "necromancer", "transmuter"];
const ALL_CLASSES = ["fighter", "paladin", "ranger", ...WIZARDS, "cleric", "druid", "thief", "bard"];

/** Purposes: default level formula and the classes they draw from (null = no class at level 0). */
export const PURPOSES = {
  townsfolk: { level: "0", classes: ["fighter"] },
  soldier: { level: "0", classes: ["fighter"] },
  adventurer: { level: "1d4", classes: ALL_CLASSES },
  official: { level: "0", classes: ["fighter"] },
  sage: { level: "0", classes: ["mage"] },
  caster: { level: "1d6 + 2", classes: [...WIZARDS, "cleric", "druid"] },
  spy: { level: "1d6", classes: ["thief", "bard"] },
  assassin: { level: "1d6 + 1", classes: ["thief", "fighter"] }
};
export const PURPOSE_KEYS = Object.keys(PURPOSES);

/** Genders offered by the builder, and the PHB Table 10 columns (base height and weight). */
export const GENDERS = ["male", "female", "non-binary", "agender"];
export const BUILDS = ["male", "female"];

const pick = (list, random) => list[Math.floor(random() * list.length)];

/** A weighted pick by `freq` (pure). */
function weighted(list, random) {
  const total = list.reduce((n, x) => n + (x.freq || 1), 0);
  let r = random() * total;
  for (const x of list) { r -= x.freq || 1; if (r < 0) return x; }
  return list.at(-1);
}

/** Hit points for a class group and level (pure): each Hit Die rolled with the Constitution adjustment, at least 1. */
export function rollHitPoints(group, level, con, random = Math.random) {
  if (!(level > 0) || !group) return Math.max(simpleDice("1d6", random), 1);
  const hd = hitDiceAt(group, level);
  const row = lookup(ABILITY_TABLES.con, con);
  const adj = group === "warrior" ? (row.warrior ?? row.hp) : row.hp;
  let hp = 0;
  for (let i = 0; i < hd.dice; i++) hp += Math.max(Math.floor(random() * hd.die) + 1 + adj, 1);
  return hp + (hd.bonus ?? 0);
}

/** Abilities 3d6 in order, kept within the race's range and raised to the class's minimums after adjustment (pure). */
export function rollAbilities(race, cls, random = Math.random) {
  const r = race?.system ?? {}, c = cls?.system ?? {};
  const out = {};
  for (const k of ABILITIES) {
    let v = simpleDice("3d6", random);
    const adj = r.adjust?.[k] ?? 0;
    if (r.min?.[k]) v = Math.max(v, r.min[k]);
    if (c.min?.[k]) v = Math.max(v, c.min[k] - adj);
    if (r.max?.[k]) v = Math.min(v, r.max[k]);
    out[k] = v;
  }
  return out;
}

/**
 * Build an NPC (pure with `random`): options { purpose, race, cls, level (formula or number), gender, build (Table 10
 * column: male | female), profession, soldier,
 * culture, column, field, name }, item lists { races, classes } ({ name, system }).
 */
export function buildNpc(opts, { races, classes }, random = Math.random) {
  const purpose = PURPOSES[opts.purpose] ? opts.purpose : "townsfolk";
  const P = PURPOSES[purpose];
  const levelText = opts.level === undefined || opts.level === null || opts.level === "" ? P.level : String(opts.level);
  const level = Math.max(Math.min(simpleDice(levelText, random), 20), 0);
  const raceById = id => races.find(x => x.system.identifier === id);
  const classById = id => classes.find(x => x.system.identifier === id);
  const religious = purpose === "official" && opts.culture === "religious";
  let classIds = religious ? ["cleric"] : P.classes;
  let race = opts.race ? raceById(opts.race) : null;
  let cls = null;
  if (level > 0) {
    if (opts.cls && classById(opts.cls)) classIds = [opts.cls];
    // Race `classes` and class `alignments` are SetFields (arrays in the pack sources).
    const fits = (r, id) => [...(r.system.classes ?? [])].includes(id);
    if (race) classIds = classIds.filter(id => fits(race, id));
    if (!classIds.length) classIds = race ? [...(race.system.classes ?? [])].filter(id => classById(id)) : ["fighter"];
    cls = classById(pick(classIds, random)) ?? null;
    if (!race) race = pick(races.filter(r => cls && fits(r, cls.system.identifier)), random) ?? pick(races, random);
  } else if (!race) race = pick(races, random);
  const raceId = race?.system.identifier ?? "human";
  const gender = GENDERS.includes(opts.gender) ? opts.gender : pick(GENDERS, random);
  const build = BUILDS.includes(opts.build) ? opts.build : BUILDS.includes(gender) ? gender : pick(BUILDS, random);
  const abilities = rollAbilities(race, cls, random);
  const group = cls?.system.group ?? null;
  const exceptional = group === "warrior" && abilities.str + (race?.system.adjust?.str ?? 0) === 18 ? simpleDice("1d100", random) : 0;
  const con = abilities.con + (race?.system.adjust?.con ?? 0);
  const hp = rollHitPoints(group, level, con, random);
  const xpKey = cls?.system.identifier;
  const xp = level > 0 && XP_TABLE[xpKey] ? (XP_TABLE[xpKey][level - 1] ?? 0) : 0;
  const allowed = [...(cls?.system.alignments ?? [])];
  const alignments = allowed.length ? allowed : ["lg", "ng", "cg", "ln", "n", "cn", "le", "ne", "ce"];
  const alignment = pick([...alignments], random);
  const ageRow = AGING.age?.[raceId];
  const age = ageRow ? simpleDice(`${ageRow.base} + ${ageRow.variable}`, random) : null;
  const h = NPC.heights[raceId], w = RACE_WEIGHT[raceId];
  const height = h ? h[build] + simpleDice(h.dice, random) : null;
  const weight = w ? w[build] + simpleDice(w.dice, random) : null;
  const general = pick(PATRON.traits, random);
  const traits = { general: general.trait, specific: pick(general.specific, random).trait };
  const looks = Object.fromEntries(Object.entries(PATRON.looks).filter(([k]) => k !== "age").map(([k, words]) => [k, pick(words, random)]));
  const spec = { purpose, level, race, cls, gender, build, abilities, exceptional, hp, xp, alignment, age, height, weight, traits, looks, notes: [] };
  if (purpose === "townsfolk") spec.profession = NPC.professions.find(p => p.name === opts.profession) ?? pick(NPC.professions, random);
  if (purpose === "soldier") spec.soldier = NPC.soldiers.find(s => s.name === opts.soldier) ?? pick(NPC.soldiers, random);
  if (purpose === "official") {
    const culture = NPC.titles[opts.culture] ? opts.culture : pick(Object.keys(NPC.titles), random);
    const cols = NPC.titles[culture];
    const column = cols[opts.column] ? opts.column : pick(Object.keys(cols), random);
    spec.title = { culture, column, name: pick(cols[column], random) };
  }
  if (purpose === "sage") {
    spec.field = NPC.sageFields.find(f => f.name === opts.field) ?? weighted(NPC.sageFields, random);
    spec.sageAbility = simpleDice(NPC.sageAbility, random);
  }
  const role = spec.profession?.name ?? spec.soldier?.name ?? spec.title?.name ?? (spec.field ? `sage (${spec.field.name})` : null)
    ?? (cls ? cls.name : purpose);
  spec.role = role;
  spec.name = opts.name || `${race?.name ?? "Human"} ${String(role).toLowerCase()}`;
  return spec;
}

/** The notes of an NPC as plain text lines (pure; labels through `t`); the Bio tab's biography is a plain text box. */
export function npcNotes(spec, t = (k, d) => k) {
  const line = (k, v) => (v || v === 0 ? `${t(`AD2E.Npc.Note.${k}`)}: ${v}` : null);
  return [
    line("purpose", t(`AD2E.Npc.Purpose.${spec.purpose}`)), line("role", spec.role),
    line("traits", `${spec.traits.general}, ${spec.traits.specific}`),
    line("looks", Object.values(spec.looks).join(", ")),
    line("morale", t("AD2E.Npc.MoraleText", { hireling: NPC.morale.hireling, henchman: NPC.morale.henchman })),
    spec.profession?.prof ? line("profession", t("AD2E.Npc.ProfessionProf")) : null,
    spec.soldier ? line("wage", t("AD2E.Npc.WageText", { wage: spec.soldier.wage })) : null,
    spec.title ? line("title", `${spec.title.name} (${spec.title.column})`) : null,
    spec.field ? line("field", `${spec.field.name}${spec.field.limits ? ` (${spec.field.limits})` : ""}`) : null,
    spec.field ? line("sageAbility", spec.sageAbility) : null,
    spec.purpose === "caster" ? line("costs", NPC.spellCosts.map(c => `${c.spell} ${c.cost}`).join("; ")) : null
  ].filter(Boolean).join("\n");
}

/** Actor data for an NPC spec (`docs`: the race, class, gear, proficiency and soldier documents resolved). */
export function npcActorData(spec, docs, t) {
  const clean = d => { const o = d.toObject ? d.toObject() : structuredClone(d); delete o._id; return o; };
  const items = [];
  if (docs.race) items.push(clean(docs.race));
  if (docs.cls) items.push(clean(docs.cls));
  for (const g of docs.gear ?? []) { const o = clean(g); if ("equipped" in (o.system ?? {})) o.system.equipped = true; items.push(o); }
  if (docs.prof) items.push(clean(docs.prof));
  for (const i of docs.soldierItems ?? []) items.push(clean(i));
  const abilities = Object.fromEntries(ABILITIES.map(k => [k, k === "str" ? { value: spec.abilities[k], exceptional: spec.exceptional } : { value: spec.abilities[k] }]));
  return { name: spec.name, type: "character", items,
    system: { level: spec.level, xp: spec.xp, alignment: spec.alignment, abilities, age: spec.age, bodyWeight: spec.weight,
      gender: spec.gender ?? "", build: spec.build ?? "", height: spec.height,
      hp: { value: spec.hp, max: spec.hp }, biography: npcNotes(spec, t) } };
}
