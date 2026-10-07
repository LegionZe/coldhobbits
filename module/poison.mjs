import { POISON_TABLES } from "./rules/poison-tables.mjs";
import { createSaveRequest, registerSaveHandler } from "./save-requests.mjs";

/**
 * Poison (DMG Table 51, "Poison (DMG)"; figures in module/rules/poison-tables.mjs, tools/build-poison-data.py).
 * Carriers (owner's ruling): monster natural attacks (`system.attacks[].poison`), weapons and ammunition
 * (`system.poison` { class, doses }: one dose per damage roll, implementation choice), traps (`system.trap.poison`,
 * `poisonDelivery`) and poison items (equipment category "poison", one dose per quantity, used to coat a weapon or missiles).
 * A damage roll with a poisoned carrier posts a save request vs. paralyzation, poison or death magic (module/save-requests.mjs;
 * the race's Constitution bonus vs. poison is added). Owner's ruling, full tracking: the active GM records the save, rolls
 * the onset and applies the effect when world time passes it: damage, death ("all hit points are immediately lost"),
 * paralysis ("unable to move for 2d6 hours": status "paralysis") or debilitation (1d3 days: ability scores and movement
 * halved, no healing; status DEBILITATED_STATUS). Method: contact poisons work by any route; injected or ingested poisons
 * "have no effect on contact" and half effect given the other way (the save effect on a failed save, nothing on a success).
 */
export const POISON = POISON_TABLES;
export const DEBILITATED_STATUS = { id: "ad2e-debilitated", name: "AD2E.Poison.Debilitated", img: "systems/ad2e/styles/icons/debilitated.svg" };

const esc = v => foundry.utils.escapeHTML?.(String(v ?? "")) ?? String(v ?? "");
const i18n = (k, d) => (d ? game.i18n.format(k, d) : game.i18n.localize(k));

/** "full", "half" or "none": a poison of class `cls` delivered by `delivery` ("" = its own method). Pure. */
export function poisonStrength(cls, delivery = "") {
  const method = POISON.classes[cls]?.method;
  if (!method) return "none";
  if (!delivery || delivery === method || method === "contact") return "full";
  if (delivery === "contact") return "none";
  return "half";
}

/**
 * What a poison does (pure): { effect: "none" | "damage" | "death" | "paralysis" | "debilitation", formula }.
 * Full strength: the failed or saved column of Table 51; half: the saved column on a failed save, nothing on a success.
 */
export function poisonOutcome(cls, delivery, saved) {
  const c = POISON.classes[cls];
  const strength = poisonStrength(cls, delivery);
  const none = { effect: "none", formula: "" };
  if (!c || strength === "none" || (strength === "half" && saved)) return none;
  const column = strength === "half" || saved ? "saved" : "failed";
  if (c.kind === "paralytic") return column === "failed" ? { effect: "paralysis", formula: POISON.paralysis.formula } : none;
  if (c.kind === "debilitating") return column === "failed" ? { effect: "debilitation", formula: POISON.debilitation.formula } : none;
  const v = c[column];
  if (v === "death") return { effect: "death", formula: "" };
  if (!v || v === "0") return none;
  return { effect: "damage", formula: v };
}

/** Whether debilitating poison holds the actor's data at world time `now`. Pure. */
export function debilitated(poison, now = 0) {
  const until = poison?.debilitatedUntil;
  return until !== null && until !== undefined && now < until;
}

/** Halve every ability score (rounded down, at least 1; 18/xx Strength loses its percentage). */
export function halveAbilities(abilities) {
  for (const ab of Object.values(abilities ?? {})) {
    if (!ab || !Number.isFinite(ab.total)) continue;
    ab.total = Math.max(Math.floor(ab.total / 2), 1);
    if ("exceptional" in ab) ab.exceptional = 0;
  }
}

/** Pending effects due at world time `now` (pure). */
export function duePoisons(poison, now) {
  return (poison?.pending ?? []).filter(p => p.at <= now);
}

/** Short description of a class for chat: "B (injected, 2–12 minutes, 20/1d3)". */
export function poisonLabel(cls) {
  const c = POISON.classes[cls];
  if (!c) return cls;
  const strength = c.kind === "damage" ? `${c.failed === "death" ? i18n("AD2E.Poison.Death") : c.failed}/${c.saved}`
    : i18n(`AD2E.Poison.Kind.${c.kind}`);
  return `${cls} (${i18n(`AD2E.Poison.Method.${c.method}`)}, ${c.onset.text}, ${strength})`;
}

const gmWhisper = () => ChatMessage.getWhisperRecipients?.("GM")?.map(u => u.id) ?? [];

/**
 * Post a save request vs. poison for `targets` ([{ uuid, name }]). `delivery` "" = the poison's own method (monster
 * venom); weapons and missiles inject it.
 */
export async function requestPoisonSaves({ speaker, cls, delivery = "", source = "", targets = [] }) {
  if (!POISON.classes[cls]) return null;
  const strength = poisonStrength(cls, delivery);
  return createSaveRequest({ speaker, key: "par", kind: "poison", targets,
    title: i18n("AD2E.Poison.Request", { source: source || i18n("AD2E.Poison.Poison"), cls: poisonLabel(cls) }),
    content: strength === "full" ? "" : `<p class="ad2e-note">${esc(i18n(`AD2E.Poison.Strength.${strength}`, { delivery: i18n(`AD2E.Poison.Method.${delivery}`) }))}</p>`,
    data: { cls, delivery, source } });
}

/** The poison of a damage roll's carrier: uses one dose of a coated weapon or missile. Returns the class or "". */
export async function usePoisonDose(item) {
  const p = item?.system?.poison;
  if (!p?.class || !(p.doses > 0)) return "";
  await item.update({ "system.poison.doses": p.doses - 1 });
  return p.class;
}

/** A save was recorded: roll the onset and schedule (or apply) the effect (active GM). */
export async function afflict(actor, { cls, delivery = "", source = "" }, saved) {
  const out = poisonOutcome(cls, delivery, saved);
  const speaker = ChatMessage.getSpeaker({ actor });
  if (out.effect === "none") {
    return ChatMessage.create({ speaker, content: `<p>${esc(i18n("AD2E.Poison.NoEffect", { name: actor.name }))}</p>` });
  }
  const onset = POISON.classes[cls].onset;
  const roll = onset.unit ? await new Roll(onset.formula).evaluate() : null;
  const seconds = roll ? roll.total * onset.unit : 0;
  const entry = { id: foundry.utils.randomID(), cls, source, at: (game.time?.worldTime ?? 0) + seconds, effect: out.effect, formula: out.formula };
  if (!seconds) return applyPoisonEffect(actor, entry);
  await actor.update({ "system.poison.pending": [...(actor.system.poison?.pending ?? []), entry] });
  // The onset is the GM's to know.
  return ChatMessage.create({ speaker, whisper: gmWhisper(), rolls: roll ? [roll] : [],
    content: `<p>${esc(i18n("AD2E.Poison.Onset", { name: actor.name, cls, n: roll.total, unit: i18n(`AD2E.Poison.Unit.${onset.unit}`) }))}</p>` });
}

async function setStatus(actor, id, active) {
  if (typeof actor.toggleStatusEffect !== "function" || !!actor.statuses?.has?.(id) === active) return;
  await actor.toggleStatusEffect(id, { active });
}

/** Apply a poison's effect now (onset reached) and drop it from the pending list. */
export async function applyPoisonEffect(actor, entry) {
  const pending = (actor.system.poison?.pending ?? []).filter(p => p.id !== entry.id);
  const update = { "system.poison.pending": pending };
  const speaker = ChatMessage.getSpeaker({ actor });
  const now = game.time?.worldTime ?? 0;
  const label = entry.source ? `${entry.source}, ${entry.cls}` : entry.cls;
  if (entry.effect === "damage") {
    await actor.update(update);
    const roll = await new Roll(entry.formula || "0").evaluate();
    await roll.toMessage({ speaker, flavor: i18n("AD2E.Poison.Takes", { name: actor.name, label, n: roll.total }) });
    return actor.applyDamage?.(roll.total, { single: false });
  }
  if (entry.effect === "death") {
    update["system.hp.dead"] = true;
    update["system.hp.value"] = Math.min(actor.system.hp?.value ?? 0, 0);
    await actor.update(update);
    return ChatMessage.create({ speaker, content: `<p>${esc(i18n("AD2E.Poison.Killed", { name: actor.name, label }))}</p>` });
  }
  const rule = entry.effect === "paralysis" ? POISON.paralysis : POISON.debilitation;
  const roll = await new Roll(entry.formula || rule.formula).evaluate();
  const until = now + roll.total * rule.unit;
  if (entry.effect === "paralysis") update["system.poison.paralyzedUntil"] = Math.max(until, actor.system.poison?.paralyzedUntil ?? 0);
  else update["system.poison.debilitatedUntil"] = Math.max(until, actor.system.poison?.debilitatedUntil ?? 0);
  await actor.update(update);
  await setStatus(actor, entry.effect === "paralysis" ? "paralysis" : DEBILITATED_STATUS.id, true);
  return roll.toMessage({ speaker, flavor: i18n(entry.effect === "paralysis" ? "AD2E.Poison.Paralyzed" : "AD2E.Poison.DebilitatedFor",
    { name: actor.name, label, n: roll.total }) });
}

/** End paralysis and debilitation whose time has passed; apply effects whose onset has come (active GM). */
export async function processPoisons(actor, now = game.time?.worldTime ?? 0) {
  const p = actor.system?.poison;
  if (!p) return;
  for (const entry of duePoisons(p, now).sort((a, b) => a.at - b.at)) {
    if (actor.system.hpState?.state === "dead") break;
    await applyPoisonEffect(actor, entry);
  }
  const speaker = ChatMessage.getSpeaker({ actor });
  if (p.paralyzedUntil !== null && p.paralyzedUntil !== undefined && now >= p.paralyzedUntil) {
    await actor.update({ "system.poison.paralyzedUntil": null });
    await setStatus(actor, "paralysis", false);
    await ChatMessage.create({ speaker, content: `<p>${esc(i18n("AD2E.Poison.ParalysisEnds", { name: actor.name }))}</p>` });
  }
  if (p.debilitatedUntil !== null && p.debilitatedUntil !== undefined && now >= p.debilitatedUntil) {
    await actor.update({ "system.poison.debilitatedUntil": null });
    await setStatus(actor, DEBILITATED_STATUS.id, false);
    await ChatMessage.create({ speaker, content: `<p>${esc(i18n("AD2E.Poison.DebilitationEnds", { name: actor.name }))}</p>` });
  }
}

/** Neutralize poison (spell, herbalism, the GM): no pending effect, paralysis and debilitation end. Lost hit points stay lost. */
export async function neutralizePoison(actor) {
  const p = actor.system?.poison;
  if (!p) return;
  await actor.update({ "system.poison.pending": [], "system.poison.paralyzedUntil": null, "system.poison.debilitatedUntil": null });
  if (p.paralyzedUntil !== null && p.paralyzedUntil !== undefined) await setStatus(actor, "paralysis", false);
  await setStatus(actor, DEBILITATED_STATUS.id, false);
  return ChatMessage.create({ speaker: ChatMessage.getSpeaker({ actor }), content: `<p>${esc(i18n("AD2E.Poison.Neutralized", { name: actor.name }))}</p>` });
}

/** Sheet context: the actor's poison state ({ pending, paralyzed, debilitated, any }); pending details for the GM only. */
export function poisonContext(actor, now = game.time?.worldTime ?? 0) {
  const p = actor?.system?.poison;
  if (!p) return null;
  const gm = !!game.user?.isGM;
  const left = s => Math.max(Math.ceil((s - now) / 60), 0);
  const pending = (p.pending ?? []).map(e => ({ cls: e.cls, source: e.source, minutes: gm ? left(e.at) : null,
    effect: i18n(`AD2E.Poison.Effect.${e.effect}`) }));
  const paralyzed = p.paralyzedUntil !== null && p.paralyzedUntil !== undefined && now < p.paralyzedUntil ? left(p.paralyzedUntil) : null;
  const deb = debilitated(p, now) ? left(p.debilitatedUntil) : null;
  return { pending, gm, paralyzed, debilitated: deb, any: pending.length > 0 || paralyzed !== null || deb !== null };
}

/** Coat a weapon (one dose) or missiles (one dose each) with an owned poison item. */
export async function coatWithPoison(item) {
  const actor = item?.actor;
  if (!actor || !["weapon", "ammunition"].includes(item.type)) return;
  const poisons = actor.items.filter(i => i.type === "equipment" && i.system.category === "poison" && i.system.poison?.class && i.system.quantity > 0);
  if (!poisons.length) {
    ui.notifications.warn(i18n("AD2E.Poison.NoneOwned", { name: actor.name }));
    return;
  }
  const missiles = item.type === "ammunition";
  const input = await foundry.applications.api.DialogV2.prompt({
    window: { title: i18n("AD2E.Poison.CoatTitle", { name: item.name }) },
    content: `<div class="form-group"><label>${esc(i18n("AD2E.Poison.Poison"))}</label><select name="poison">${poisons.map(p =>
      `<option value="${p.id}">${esc(p.name)} (${esc(poisonLabel(p.system.poison.class))}; ${p.system.quantity})</option>`).join("")}</select></div>`
      + (missiles ? `<div class="form-group"><label>${esc(i18n("AD2E.Poison.Missiles"))}</label><input type="number" name="n" value="1" min="1" max="${item.system.quantity}" step="1"></div>` : "")
      + `<p class="ad2e-note">${esc(i18n("AD2E.Poison.CoatHint"))}</p>`,
    ok: { label: i18n("AD2E.Poison.Coat"), callback: (event, button) => ({ id: button.form.elements.poison.value,
      n: Math.max(Math.floor(Number(button.form.elements.n?.value ?? 1)) || 1, 1) }) },
    rejectClose: false
  });
  if (!input) return;
  const source = actor.items.get(input.id);
  if (!source) return;
  const cls = source.system.poison.class;
  const cur = item.system.poison ?? {};
  const room = missiles ? Math.max(item.system.quantity - (cur.class === cls ? cur.doses : 0), 0) : (cur.class === cls && cur.doses > 0 ? 0 : 1);
  const n = Math.min(missiles ? input.n : 1, source.system.quantity, room);
  if (n <= 0) {
    ui.notifications.info(i18n("AD2E.Poison.AlreadyCoated", { name: item.name }));
    return;
  }
  await item.update({ "system.poison.class": cls, "system.poison.doses": (cur.class === cls ? cur.doses : 0) + n });
  await source.update({ "system.quantity": source.system.quantity - n });
  return ChatMessage.create({ speaker: ChatMessage.getSpeaker({ actor }), whisper: gmWhisper().concat(game.user.id),
    content: `<p>${esc(i18n("AD2E.Poison.Coated", { name: item.name, cls, n }))}</p>` });
}

/** GM tool: a poison given to the targeted tokens (a drugged drink, a contact poison on a door handle). */
export async function poisonTargetsDialog() {
  if (!game.user?.isGM) return;
  const targets = [...(game.user.targets ?? [])].map(t => ({ uuid: t.document?.uuid, name: t.document?.name ?? t.name })).filter(t => t.uuid);
  const input = await foundry.applications.api.DialogV2.prompt({
    window: { title: i18n("AD2E.Poison.ToolTitle") },
    content: `<div class="form-group"><label>${esc(i18n("AD2E.Poison.Class"))}</label><select name="cls">${Object.keys(POISON.classes).map(c =>
      `<option value="${c}">${esc(poisonLabel(c))}</option>`).join("")}</select></div>`
      + `<div class="form-group"><label>${esc(i18n("AD2E.Poison.Delivery"))}</label><select name="delivery"><option value="">${esc(i18n("AD2E.Poison.OwnMethod"))}</option>`
      + ["injected", "ingested", "contact"].map(d => `<option value="${d}">${esc(i18n(`AD2E.Poison.Method.${d}`))}</option>`).join("") + "</select></div>"
      + `<div class="form-group"><label>${esc(i18n("AD2E.Poison.Source"))}</label><input type="text" name="source"></div>`
      + `<p class="ad2e-note">${esc(targets.length ? `${i18n("AD2E.Poison.Targets")}: ${targets.map(t => t.name).join(", ")}` : i18n("AD2E.SaveRequest.NoTargets"))}</p>`,
    ok: { label: i18n("AD2E.Poison.Post"), callback: (event, button) => ({ cls: button.form.elements.cls.value,
      delivery: button.form.elements.delivery.value, source: button.form.elements.source.value.trim() }) },
    rejectClose: false
  });
  if (!input) return;
  return requestPoisonSaves({ speaker: ChatMessage.getSpeaker(), ...input, targets });
}

export function registerPoison() {
  const list = CONFIG.statusEffects;
  if (Array.isArray(list)) { if (!list.some(e => e.id === DEBILITATED_STATUS.id)) list.push({ ...DEBILITATED_STATUS }); }
  else if (list && !list[DEBILITATED_STATUS.id]) list[DEBILITATED_STATUS.id] = { ...DEBILITATED_STATUS };
  registerSaveHandler("poison", (actor, request, index, success) => afflict(actor, request.data, success));
  // The active GM applies effects whose onset has come and ends paralysis and debilitation (world time).
  Hooks.on("updateWorldTime", async now => {
    if (!game.user?.isActiveGM) return;
    const tokenActors = game.scenes?.contents.flatMap(s => s.tokens.contents).filter(t => !t.actorLink).map(t => t.actor) ?? [];
    for (const actor of new Set([...(game.actors?.contents ?? []), ...tokenActors].filter(Boolean))) {
      const p = actor.system?.poison;
      if (!p || (!p.pending?.length && p.paralyzedUntil == null && p.debilitatedUntil == null)) continue;
      await processPoisons(actor, now);
    }
  });
}
