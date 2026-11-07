/**
 * Generate a ship's crew (owner's request 1.0.86; GM button "Generate crew" on the ship sheet). Owner's rulings: a quality
 * of poor / average / quality / excellent; poor crews are all level 0 and miss roles (only the captain, no other officers;
 * the type's average complement, not the full one; no marines, so no archers, boarders, artillerists or firefighters);
 * average crews are mostly level 0 with every role filled; quality crews mostly levels 1-3; excellent mostly 3-6. The
 * quality sets the Of Ships and the Sea crew experience (Table 12): landlubbers, mates, mariners, old salts. The rank and
 * file stay numbers on the ship (count and hit dice per group); the captain and the officers become NPC actors (fighters,
 * level 0 = no class) in an Actor folder named after the ship, flagged `ad2e.crewOf` = the ship's UUID.
 * Implementation choices: the level mixes in QUALITY (weights per level), officers and the captain a step above the crew;
 * a group's hit dice = the average of its men's levels (level 0 counts as 1 Hit Die), rounded, at least 1; the THAC0 is
 * the warrior THAC0 of the marines' most common level (the sailors' without marines; "most prevalent THAC0", Action Phase
 * (OSS)); officers 1 per 10 sailors or 20 rowers as "Typical crew" does; the artillery is manned first from the marines, the
 * rest split between archers and boarders; regenerating replaces the officers made for the ship before (after a confirm).
 */
import { NAVAL } from "./rules/naval-tables.mjs";
import { thac0At } from "./config.mjs";
import { ad2eDialog } from "./dialogs.mjs";
import { buildNpc, npcActorData } from "./npc-builder.mjs";
import { npcDocs, npcItems } from "./apps/npc-builder.mjs";

export const QUALITY = {
  poor: { crew: [[0, 1]], officers: [], captain: [[0, 1]], experience: "landlubbers", shortHanded: true, marines: false, officerRanks: false },
  average: { crew: [[0, 0.85], [1, 0.15]], officers: [[0, 0.4], [1, 0.6]], captain: [[1, 0.7], [2, 0.3]], experience: "mates" },
  quality: { crew: [[0, 0.1], [1, 0.3], [2, 0.3], [3, 0.25], [4, 0.05]], officers: [[2, 0.35], [3, 0.4], [4, 0.25]],
    captain: [[3, 0.3], [4, 0.4], [5, 0.3]], experience: "mariners" },
  excellent: { crew: [[1, 0.05], [2, 0.1], [3, 0.2], [4, 0.25], [5, 0.2], [6, 0.2]], officers: [[4, 0.3], [5, 0.4], [6, 0.3]],
    captain: [[6, 0.4], [7, 0.4], [8, 0.2]], experience: "oldSalts" }
};
export const QUALITIES = Object.keys(QUALITY);

const i18n = (k, d) => (d ? game.i18n.format(k, d) : game.i18n.localize(k));

/** One level from weighted [level, weight] pairs (pure; random injectable). */
export function pickLevel(weights, random = Math.random) {
  const total = weights.reduce((n, [, w]) => n + w, 0);
  let r = random() * total;
  for (const [level, w] of weights) { if ((r -= w) < 0) return level; }
  return weights.at(-1)?.[0] ?? 0;
}

/** Levels of n men (pure). */
export const rollLevels = (n, weights, random = Math.random) => Array.from({ length: Math.max(n, 0) }, () => pickLevel(weights, random));

/** A group's hit dice per man (pure): the average of max(level, 1), rounded, at least 1. */
export function groupHitDice(levels) {
  if (!levels.length) return 1;
  return Math.max(Math.round(levels.reduce((n, l) => n + Math.max(l, 1), 0) / levels.length), 1);
}

/** The most common level (pure; ties to the higher). */
export function commonLevel(levels) {
  const counts = new Map();
  for (const l of levels) counts.set(l, (counts.get(l) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0]?.[0] ?? 0;
}

/**
 * The crew plan for a ship type and quality (pure): counts, hit dice, THAC0, officers and their levels, captain's level,
 * marine roles and experience. `artillery` = the ship's pieces ({ key, destroyed }), manned from the marines first.
 */
export function crewPlan(spec, quality, { artillery = [], random = Math.random } = {}) {
  const q = QUALITY[quality] ?? QUALITY.average;
  const allRow = spec.allRow || spec.propulsion === "oar";
  const fullRowers = spec.rowers?.rowers ?? (allRow ? spec.crew.max : 0);
  const complement = q.shortHanded ? spec.crew.average : spec.crew.max;
  const rowers = spec.crew.max ? Math.round(fullRowers * complement / spec.crew.max) : 0;
  const sailors = Math.max(complement - rowers, 0);
  const marines = q.marines === false ? 0 : spec.combat.marines ?? 0;
  const lv = { sailors: rollLevels(sailors, q.crew, random), rowers: rollLevels(rowers, q.crew, random), marines: rollLevels(marines, q.crew, random) };
  const officerCount = q.officerRanks === false ? 0 : Math.floor(sailors / 10) + Math.floor(rowers / 20);
  const officers = rollLevels(officerCount, q.officers.length ? q.officers : q.crew, random);
  const captain = pickLevel(q.captain, random);
  const pieces = artillery.filter(a => !a.destroyed).map(a => ({ ...a, need: NAVAL.combat.artillery.find(t => t.key === a.key)?.crew ?? 1 }));
  let left = marines;
  const manned = pieces.map(p => { const n = Math.min(p.need, left); left -= n; return n; });
  const artillerists = marines - left;
  const archers = Math.floor(left / 2);
  const fighting = lv.marines.length ? lv.marines : lv.sailors.length ? lv.sailors : lv.rowers;
  return {
    quality, experience: q.experience, sailors, rowers, marines, officers, captain,
    hd: { sailors: groupHitDice(lv.sailors), rowers: groupHitDice(lv.rowers), marines: groupHitDice(lv.marines) },
    thac0: thac0At("warrior", Math.max(commonLevel(fighting), 1)),
    roles: { artillerists, archers, boarders: left - archers, firefighters: 0 }, manned,
    levels: lv
  };
}

/** The ship update for a plan (pure). */
export function crewUpdate(plan, ship) {
  const artillery = (ship.artillery ?? []).map(a => ({ ...a }));
  let i = 0;
  for (const a of artillery) if (!a.destroyed) a.crew = plan.manned[i++] ?? 0;
  return {
    "system.sailors.count": plan.sailors, "system.sailors.hd": plan.hd.sailors, "system.sailors.wounds": 0,
    "system.rowers.count": plan.rowers, "system.rowers.hd": plan.hd.rowers, "system.rowers.wounds": 0,
    "system.marines.count": plan.marines, "system.marines.hd": plan.hd.marines, "system.marines.wounds": 0,
    "system.marines.archers": plan.roles.archers, "system.marines.boarders": plan.roles.boarders,
    "system.marines.artillerists": plan.roles.artillerists, "system.marines.firefighters": 0,
    "system.officers": plan.officers.length, "system.captain": true, "system.experience": plan.experience,
    "system.thac0": plan.thac0, "system.morale.base": null, "system.morale.tired": 0, "system.artillery": artillery
  };
}

/** The NPC actors generated for a ship. */
export const crewActors = ship => (game.actors ?? []).filter(a => a.getFlag?.("ad2e", "crewOf") === ship.uuid);

/** "Generate crew" (GM): choose a quality, fill the ship's numbers and make the captain and officers as NPC actors. */
export async function generateCrew(ship) {
  if (!game.user?.isGM || ship?.type !== "ship") return null;
  const old = crewActors(ship);
  const quality = await ad2eDialog.prompt({
    window: { title: i18n("AD2E.ShipCrew.Title", { name: ship.name }) }, rejectClose: false,
    content: `<div class="form-group"><label>${i18n("AD2E.ShipCrew.Quality")}</label><select name="quality">`
      + QUALITIES.map(k => `<option value="${k}"${k === "average" ? " selected" : ""}>${i18n(`AD2E.ShipCrew.Q.${k}`)}</option>`).join("") + `</select></div>`
      + `<p class="hint">${i18n("AD2E.ShipCrew.Hint")}</p>`
      + (old.length ? `<p class="hint">${i18n("AD2E.ShipCrew.Replace", { n: old.length })}</p>` : ""),
    ok: { label: i18n("AD2E.ShipCrew.Generate"), callback: (e, b) => b.form.elements.quality.value }
  });
  if (!quality) return null;
  const plan = crewPlan(ship.system.spec, quality, { artillery: ship.system.artillery });
  await ship.update(crewUpdate(plan, ship.system));
  if (old.length) {
    const folders = new Set(old.map(a => a.folder?.id).filter(Boolean));
    await Actor.implementation.deleteDocuments(old.map(a => a.id));
    for (const id of folders) { const f = game.folders?.get(id); if (f && !f.contents?.length && !f.children?.length) await f.delete(); }
  }
  const made = await createOfficers(ship, plan);
  return ChatMessage.implementation.create({ speaker: ChatMessage.getSpeaker({ actor: ship }), whisper: (game.users ?? []).filter(u => u.isGM).map(u => u.id),
    content: `<p>${i18n("AD2E.ShipCrew.Done", { name: ship.name, quality: i18n(`AD2E.ShipCrew.Q.${quality}`), sailors: plan.sailors, rowers: plan.rowers,
      marines: plan.marines, officers: plan.officers.length, captain: plan.captain, hd: plan.hd.sailors, thac0: plan.thac0,
      experience: i18n(`AD2E.Naval.Experience.${plan.experience}`), actors: made.length })}</p>` });
}

/** The captain and officers as NPC actors (the random NPC builder's soldier, human, fighter at the level). */
async function createOfficers(ship, plan) {
  const items = await npcItems();
  const folder = await Folder.implementation.create({ name: i18n("AD2E.ShipCrew.Folder", { name: ship.name }), type: "Actor" });
  const roles = [["captain", plan.captain], ...plan.officers.map(l => ["officer", l])];
  const data = [];
  let n = 0;
  for (const [role, level] of roles) {
    const spec = buildNpc({ purpose: "soldier", level: String(level), cls: "fighter", race: "human" }, items);
    const d = npcActorData(spec, await npcDocs(spec), i18n);
    d.name = role === "captain" ? i18n("AD2E.ShipCrew.Captain", { name: ship.name }) : i18n("AD2E.ShipCrew.Officer", { name: ship.name, n: ++n });
    d.folder = folder?.id ?? null;
    d.flags = foundry.utils.mergeObject(d.flags ?? {}, { ad2e: { crewOf: ship.uuid, crewRole: role } });
    data.push(d);
  }
  return data.length ? Actor.implementation.createDocuments(data) : [];
}
