import { CREATOR_TABLES } from "./rules/creator-tables.mjs";

/**
 * Traps (owner's rulings: a trap actor (monster role "trap", e.g. a pit, placed as a token) and a trap item (equipment
 * category "trap", e.g. a chest's needle); each hits by an attack at its THAC0 or by a saving throw, chosen per trap).
 * Data: `system.trap` (module/data/trap-fields.mjs). Figures in CREATOR_TABLES.trap (tools/build-creator-tables.py,
 * regex-checked): find/remove modifier up to +/-30% ("Advanced Locks and Traps (CTH)": "the same principle of
 * modification applies" to traps), a silent attempt at -10% that clicks on 01-10, and the PHB's 96-100 springing the trap
 * on a removal attempt (Thief Skill Explanations (PHB); AD2E.trapSpringRoll).
 */
export const TRAP = CREATOR_TABLES.trap;

const esc = v => foundry.utils.escapeHTML?.(String(v ?? "")) ?? String(v ?? "");
const i18n = (k, d) => (d ? game.i18n.format(k, d) : game.i18n.localize(k));

/** The trap data of an actor (role trap) or an item (category trap), or null. */
export function trapOf(doc) {
  if (doc?.type === "monster" && doc.system?.role === "trap") return doc.system.trap ?? null;
  if (doc?.type === "equipment" && doc.system?.category === "trap") return doc.system.trap ?? null;
  return null;
}

/** Traps the current user's targets hold: trap actors and trap items on targeted actors (e.g. a chest). */
export function targetedTraps(tokens = [...(game.user?.targets ?? [])]) {
  const out = [];
  for (const t of tokens) {
    const actor = t.actor ?? t.document?.actor;
    if (!actor) continue;
    if (trapOf(actor)) out.push({ name: actor.name, uuid: actor.uuid, modifier: actor.system.trap.modifier ?? 0 });
    for (const item of actor.items?.filter(i => trapOf(i)) ?? []) {
      out.push({ name: `${item.name} (${actor.name})`, uuid: item.uuid, modifier: item.system.trap.modifier ?? 0 });
    }
  }
  return out;
}

/**
 * The result of a trap against one victim (pure): mode "thac0" -> hit when d20 >= thac0 - AC; mode "save" -> saved when
 * d20 >= the save number; `full` / `half` / `none` damage.
 */
export function trapOutcome(trap, roll, { ac = 10, saveTarget = 20 } = {}) {
  if (trap.mode === "thac0") {
    const need = trap.thac0 - ac;
    return { need, success: roll >= need, damage: roll >= need ? "full" : "none" };
  }
  const saved = roll >= saveTarget;
  return { need: saveTarget, success: !saved, damage: saved ? (trap.onSave === "half" ? "half" : "none") : "full" };
}

/**
 * Spring a trap (actor or item) at the targeted tokens (or none: the effect is described only). One damage roll; the
 * victims hit (or who failed their save) get a damage message with full damage, those who saved for half get a second
 * one at half; both carry the usual apply buttons (flags.ad2e.damage / targets).
 */
export async function springTrap(doc, tokens = [...(game.user?.targets ?? [])]) {
  const trap = trapOf(doc);
  if (!trap) return null;
  const speaker = ChatMessage.getSpeaker({ actor: doc.documentName === "Actor" ? doc : doc.parent ?? null });
  const lines = [];
  const full = [], half = [];
  const rolls = [];
  for (const t of tokens) {
    const victim = t.actor ?? t.document?.actor;
    if (!victim) continue;
    const ref = { uuid: t.document?.uuid ?? victim.uuid, name: t.name ?? victim.name };
    const r = await new Roll("1d20").evaluate();
    rolls.push(r);
    const ac = victim.system?.ac?.total ?? victim.system?.ac?.value ?? 10;
    const saveTarget = victim.system?.saves?.[trap.save]?.value ?? 20;
    const out = trapOutcome(trap, r.total, { ac, saveTarget });
    if (out.damage === "full") full.push(ref); else if (out.damage === "half") half.push(ref);
    lines.push(trap.mode === "thac0"
      ? i18n("AD2E.Trap.AttackLine", { name: ref.name, roll: r.total, need: out.need, ac, result: i18n(out.success ? "AD2E.Roll.Hit" : "AD2E.Roll.Miss") })
      : i18n("AD2E.Trap.SaveLine", { name: ref.name, roll: r.total, need: out.need, save: i18n(`AD2E.Save.${trap.save}`),
        result: i18n(out.damage === "full" ? "AD2E.Roll.Failure" : "AD2E.Roll.Success") }));
  }
  const head = `<p><strong>${esc(i18n("AD2E.Trap.Sprung", { name: doc.name }))}</strong>${trap.trigger ? ` <span class="ad2e-note">(${esc(trap.trigger)})</span>` : ""}</p>`
    + (trap.effect ? `<p>${esc(trap.effect)}</p>` : "") + (lines.length ? `<ul>${lines.map(l => `<li>${esc(l)}</li>`).join("")}</ul>` : "")
    + (trap.reset ? `<p class="ad2e-note">${esc(i18n("AD2E.Trap.Reset"))}: ${esc(trap.reset)}</p>` : "");
  const messages = [await ChatMessage.create({ speaker, rolls, content: head })];
  if (trap.damage && (full.length || half.length || !tokens.length)) {
    const dmg = await new Roll(trap.damage).evaluate();
    const total = Math.max(dmg.total, 0);
    if (full.length || !tokens.length) {
      messages.push(await ChatMessage.create({ speaker, rolls: [dmg], flags: { ad2e: { damage: total, targets: full } },
        content: `<p>${esc(i18n("AD2E.Trap.Damage", { name: doc.name, damage: total, who: full.map(f => f.name).join(", ") || "—" }))}</p>` }));
    }
    if (half.length) {
      const h = Math.floor(total / 2);
      messages.push(await ChatMessage.create({ speaker, flags: { ad2e: { damage: h, targets: half } },
        content: `<p>${esc(i18n("AD2E.Trap.HalfDamage", { name: doc.name, damage: h, who: half.map(f => f.name).join(", ") }))}</p>` }));
    }
  }
  return messages;
}

/** Sheet context for the trap fields partial (`ad2e.trap-fields`). */
export function trapContext(doc) {
  const t = trapOf(doc);
  if (!t) return null;
  const opt = (keys, value, label) => keys.map(k => ({ key: k, label: label(k), selected: k === value }));
  return { data: t, thac0Mode: t.mode === "thac0", canSpring: !!game.user?.isGM,
    modes: opt(["thac0", "save"], t.mode, k => i18n(`AD2E.Trap.Modes.${k}`)),
    saves: opt(["par", "rsw", "pet", "br", "sp"], t.save, k => i18n(`AD2E.Save.${k}`)),
    onSaves: opt(["none", "half"], t.onSave, k => i18n(`AD2E.Trap.OnSaves.${k}`)) };
}
