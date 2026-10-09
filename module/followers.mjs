import { ad2eDialog } from "./dialogs.mjs";
import { FOLLOWERS } from "./rules/follower-tables.mjs";
import { npcNumbers } from "./apps/creators.mjs";
import { creatureHitDice } from "./config.mjs";

/**
 * Name-level followers (PHB class descriptions, Tables 16, 19 and 31; module/rules/follower-tables.mjs from
 * tools/build-follower-tables.py). Owner's rulings: one Monster / NPC actor per unit (role "follower", `unitSize` =
 * count), linked on the character's Bio tab; the stronghold is a record (`system.followers.stronghold` { name, kind,
 * built }) that fighters and bards need built (clerics: a place of worship); a GM button rolls once per class
 * (`system.followers.rolled`; "Followers appear only once", Followers (PHB)); cleric followers 2d10 x 10.
 * Implementation choices: Table 19 class followers and Table 16 0-level troops use the PHB numbers for level 1 / the
 * Mercenary stat block; "shield" = medium shield; equipment the tables name without a compendium item is noted.
 */
export const FOL = FOLLOWERS;

const esc = v => foundry.utils.escapeHTML?.(String(v ?? "")) ?? String(v ?? "");
const i18n = (k, d) => (d ? game.i18n.format(k, d) : game.i18n.localize(k));
const className = id => Object.keys(FOL.urls).find(n => n.toLowerCase() === id) ?? id;

/** Rows of a d100 table that a roll lands on (pure). */
export function tableRow(rows, roll) {
  return rows.find(r => roll >= r.min && roll <= r.max) ?? null;
}

/** The class levels a character has for follower purposes: [{ id, level }] (main class and multi-class others). Pure. */
export function classLevels(sys) {
  const out = [];
  const main = sys?.classInfo?.classItem?.system?.identifier;
  if (main) out.push({ id: main, level: sys.level ?? 0 });
  for (const c of sys?.multi?.classes ?? []) if (!c.primary) out.push({ id: c.identifier, level: c.level ?? 0 });
  return out;
}

/**
 * Follower status per class the character has (pure): [{ id, rule, level, rolled, ready, reason }]; reason is
 * "level" | "stronghold" | "worship" | "" (ready) | "rolled".
 */
export function followerStatus(sys) {
  const st = sys?.followers?.stronghold ?? {};
  const rolled = new Set(sys?.followers?.rolled ?? []);
  return classLevels(sys).filter(c => FOL.classes[c.id]).map(c => {
    const rule = FOL.classes[c.id];
    let reason = "";
    if (rolled.has(c.id)) reason = "rolled";
    else if (c.level < rule.level) reason = "level";
    else if (rule.stronghold === "worship" && !(st.built && st.kind === "worship")) reason = "worship";
    else if (rule.stronghold === "castle" && !st.built) reason = "stronghold";
    return { id: c.id, rule, level: c.level, rolled: rolled.has(c.id), ready: reason === "", reason };
  });
}

/** Actor data for a unit spec { count, level, group, name, items [{pack, identifier, qty, bonus}], notes }. */
export async function unitActorData(unit, master, { tableName = "" } = {}) {
  const num = unit.level > 0 ? npcNumbers(unit.group ?? "warrior", unit.level) : null;
  const items = [];
  for (const it of unit.items ?? []) {
    const pack = game.packs.get(`ad2e.${it.pack}`);
    const index = await pack?.getIndex({ fields: ["system.identifier"] });
    const entry = index?.find(e => e.system?.identifier === it.identifier);
    const doc = entry ? await pack.getDocument(entry._id) : null;
    if (!doc) continue;
    const data = doc.toObject();
    delete data._id;
    if ("quantity" in data.system) data.system.quantity = it.qty ?? 1;
    if (it.bonus) {
      if (data.type === "armor") data.system.bonus = it.bonus;
      else if (data.system.bonus) { data.system.bonus.hit = it.bonus; data.system.bonus.dmg = it.bonus; }
    }
    if ("equipped" in data.system) data.system.equipped = true;
    items.push(data);
  }
  const count = unit.count ?? 1;
  // Hit points of one figure of the unit (level: the class's Hit Dice; 0-level: the Mercenary entry).
  // A creature without a compendium actor (placeholder): statistics from its linked page, entered by the GM.
  const hp = unit.placeholder ? 1 : (await new Roll(num ? num.formula : creatureHitDice(FOL.soldier.hitDice).formula).evaluate()).total;
  const label = count > 1 ? `${count} ${unit.name}` : unit.name;
  return {
    name: `${label} (${master.name})`, type: "monster", items,
    system: { role: "follower", unitSize: count, hitDice: num ? num.hitDice : unit.placeholder ? "1" : FOL.soldier.hitDice,
      hp: { value: hp, max: hp },
      thac0: { override: num ? num.thac0 : null }, saveGroup: num?.saveGroup ?? "warrior", saveLevel: num ? num.saveLevel : null,
      morale: { value: FOL.soldier.morale, text: "" }, size: "M", url: unit.url ?? (num ? "" : FOL.soldier.url),
      notes: [tableName, ...(unit.notes ?? [])].filter(Boolean).map(n => `<p>${esc(n)}</p>`).join("") }
  };
}

/** Roll the follower specs for a class (no actors yet): { units, lines, rolls }. */
export async function rollFollowerUnits(classId) {
  const rule = FOL.classes[classId];
  const units = [], lines = [], rolls = [];
  const roll = async f => { const r = await new Roll(f).evaluate(); rolls.push(r); return r.total; };
  if (rule.table === "table16") {
    for (const part of ["leader", "troops", "elite"]) {
      const n = await roll("1d100");
      const row = tableRow(FOL.table16[part], n);
      lines.push(i18n("AD2E.Followers.Line16", { part: i18n(`AD2E.Followers.Part.${part}`), roll: n, text: row?.text ?? "" }));
      for (const u of row?.units ?? []) units.push({ ...u, table: i18n(`AD2E.Followers.Part.${part}`) });
    }
  } else if (rule.table === "table19") {
    const count = await roll(rule.number);
    lines.push(i18n("AD2E.Followers.Count", { n: count, formula: rule.number }));
    const have = new Set();
    for (let i = 0; i < count; i++) {
      let row = null;
      for (let tries = 0; tries < 20; tries++) {
        row = tableRow(FOL.table19, await roll("1d100"));
        if (!(row?.reroll && have.has(row.label))) break;
      }
      have.add(row.label);
      lines.push(row.label);
      if (row.dm) continue;
      units.push(row.kind === "npc" ? { count: 1, level: 1, group: row.group, name: row.label, items: [], notes: [] }
        : { count: 1, level: 0, name: row.label, creature: row.actor ?? null, placeholder: true, url: row.url ?? "", items: [],
          notes: [i18n("AD2E.Followers.Placeholder")] });
    }
  } else if (rule.table === "table31") {
    const count = await roll(rule.number);
    lines.push(i18n("AD2E.Followers.Count", { n: count, formula: rule.number }));
    for (let i = 0; i < count; i++) {
      const row = tableRow(FOL.table31, await roll("1d100"));
      if (row.dm) { lines.push(row.label); continue; }
      const level = await roll(row.levels);
      lines.push(`${row.label}, ${i18n("AD2E.Followers.LevelN", { n: level })}`);
      units.push({ count: 1, level, group: "rogue", name: `${row.label} (${level})`, items: [], notes: [] });
    }
  } else {
    const n = rule.number === "2d10*10" ? (await roll("2d10")) * 10 : await roll(rule.number);
    lines.push(i18n("AD2E.Followers.Count", { n, formula: rule.number }));
    units.push({ count: n, level: 0, name: i18n("AD2E.Followers.Soldiers"), items: [], notes: [i18n("AD2E.Followers.SoldiersNote")] });
  }
  return { units, lines, rolls };
}

/** GM: roll and create a class's followers, link them on the character and mark the class rolled. */
export async function attractFollowers(actor, classId) {
  if (!game.user?.isGM) return null;
  const status = followerStatus(actor.system).find(s => s.id === classId);
  // "Followers appear only once" (Followers (PHB)): confirm before rolling.
  if (status?.ready && !(await ad2eDialog.confirm({ window: { title: i18n("AD2E.Followers.Title") },
    content: `<p>${esc(i18n("AD2E.Followers.Confirm", { cls: className(classId) }))}</p>`, rejectClose: false }))) return null;
  if (!status?.ready) return ui.notifications.warn(i18n(`AD2E.Followers.NotReady.${status?.reason || "level"}`));
  const { units, lines, rolls } = await rollFollowerUnits(classId);
  const created = [];
  for (const u of units) {
    let data;
    if (u.creature) {
      const pack = game.packs.get("ad2e.hirelings");
      const index = await pack?.getIndex({ fields: ["system.identifier"] });
      const entry = index?.find(e => e.system?.identifier === u.creature);
      const doc = entry ? await pack.getDocument(entry._id) : null;
      data = doc ? { ...doc.toObject(), name: `${doc.name} (${actor.name})` } : null;
      if (data) { delete data._id; data.system.role = "follower"; }
    }
    data ??= await unitActorData(u, actor, { tableName: u.table ?? "" });
    const doc = await Actor.implementation.create(data);
    if (doc) created.push(doc);
  }
  await actor.update({ "system.followers.actors": [...(actor.system.followers?.actors ?? []), ...created.map(a => a.uuid)],
    "system.followers.rolled": [...(actor.system.followers?.rolled ?? []), classId] });
  return ChatMessage.create({ speaker: ChatMessage.getSpeaker({ actor }), rolls, whisper: ChatMessage.getWhisperRecipients?.("GM")?.map(u => u.id) ?? [],
    content: `<p><strong>${esc(i18n("AD2E.Followers.Card", { name: actor.name, cls: className(classId) }))}</strong></p><ul>${lines.map(l => `<li>${esc(l)}</li>`).join("")}</ul>`
      + `<p class="ad2e-note">${esc(i18n("AD2E.Followers.Created", { n: created.length }))}</p>` });
}

/** Bio tab context: stronghold, status per class and the linked follower actors. */
export function followersContext(actor) {
  const sys = actor.system;
  const resolve = u => (foundry.utils.fromUuidSync ?? globalThis.fromUuidSync)?.(u, { strict: false }) ?? null;
  const rows = (sys.followers?.actors ?? []).map(u => resolve(u)).filter(Boolean)
    .map(a => ({ uuid: a.uuid, name: a.name, img: a.img, detail: `${a.system?.unitSize ?? 1} × HD ${a.system?.hitDice ?? "—"}, AC ${a.system?.ac?.value ?? "—"}` }));
  const st = sys.followers?.stronghold ?? {};
  return { rows, stronghold: st, isGM: !!game.user?.isGM,
    kinds: ["castle", "worship", "hideout", "tower"].map(k => ({ key: k, label: i18n(`AD2E.Followers.Kind.${k}`), selected: k === st.kind })),
    status: followerStatus(sys).map(s => ({ ...s, label: i18n("AD2E.Followers.StatusLine", { cls: className(s.id), level: s.rule.level }),
      reasonText: s.reason ? i18n(`AD2E.Followers.NotReady.${s.reason}`) : "" })) };
}
