import { LIGHT_TABLES } from "./rules/light-tables.mjs";

/**
 * Light sources that burn down with world time (owner's request, 1.0.30; module/rules/light-tables.mjs from
 * tools/build-light-tables.py): torches, candles and oil lanterns of PHB Table 63 (radius, burning time; owner's
 * ruling: the PHB figures, a torch 30 minutes = 3 turns). Equipment `light` { lit, until (world time the fuel ends while
 * lit), left (seconds of fuel left while out; null = a fresh torch or candle, an empty lantern), inches (candle length) }.
 * A torch or candle burnt out is used up (quantity -1); a lantern uses one flask of lamp oil each time it is lit empty
 * (implementation choices: one flask = one pint; a candle of unknown length is 6 inches). Lit sources light the bearer's
 * tokens (owner's request): the largest radius, a cone for bullseye and beacon lanterns; the token's own light is kept
 * in flag `ad2e.priorLight` and restored when nothing is lit.
 */
export const LIGHT = LIGHT_TABLES;
const TURN = LIGHT_TABLES.turnSeconds;

/** The Table 63 entry for an item (by identifier), or null. */
export function lightSpec(item) {
  return item?.type === "equipment" ? LIGHT.sources[item.system?.identifier] ?? null : null;
}

/** Seconds of light from one torch or candle, or one fill of a lantern (pure). */
export function fullSeconds(spec, item) {
  if (!spec) return 0;
  if (spec.per === "inch") return spec.turns * TURN * (item?.system?.light?.inches || LIGHT.candleInches);
  if (spec.per === "pint") return spec.turns * TURN * LIGHT.pintsPerFlask;
  return spec.turns * TURN;
}

/** Seconds of fuel left now (pure): lit = until the fuel ends; out = what is left (a fresh torch or candle: all of it). */
export function secondsLeft(item, now) {
  const spec = lightSpec(item);
  const l = item?.system?.light ?? {};
  if (!spec) return 0;
  if (l.lit && l.until !== null && l.until !== undefined) return Math.max(l.until - now, 0);
  if (l.left !== null && l.left !== undefined) return Math.max(l.left, 0);
  return spec.per === "pint" ? 0 : fullSeconds(spec, item);
}

export const turnsLeft = (item, now) => Math.ceil(secondsLeft(item, now) / TURN);

/** The flask of lamp oil an actor carries, or null. */
export function oilFlask(items) {
  return [...(items ?? [])].find(i => i.type === "equipment" && i.system?.identifier === LIGHT.oil && (i.system.quantity ?? 0) > 0) ?? null;
}

/**
 * What lighting an item does (pure): { ok, reason, update, oil } — `update` for the item, `oil` an update for the oil flask
 * used (lanterns lit empty). Reasons: "notLight", "lit", "none" (no torch or candle left), "noOil".
 */
export function lightPlan(item, items, now) {
  const spec = lightSpec(item);
  if (!spec) return { ok: false, reason: "notLight" };
  const l = item.system.light ?? {};
  if (l.lit) return { ok: false, reason: "lit" };
  if ((item.system.quantity ?? 1) < 1) return { ok: false, reason: "none" };
  let left = secondsLeft(item, now);
  let oil = null;
  if (spec.per === "pint" && left <= 0) {
    const flask = oilFlask(items);
    if (!flask) return { ok: false, reason: "noOil" };
    oil = { _id: flask.id, "system.quantity": flask.system.quantity - 1 };
    left = fullSeconds(spec, item);
  }
  return { ok: true, update: { "system.light.lit": true, "system.light.until": now + left, "system.light.left": left }, oil };
}

/** Putting a lit item out (pure): the fuel left is kept. */
export function outUpdate(item, now) {
  return { "system.light.lit": false, "system.light.until": null, "system.light.left": secondsLeft(item, now) };
}

/** A lit item whose fuel has ended (pure): torch or candle used up (quantity -1), lantern empty. */
export function expireUpdate(item) {
  const spec = lightSpec(item);
  const update = { "system.light.lit": false, "system.light.until": null, "system.light.left": null };
  if (spec && spec.per !== "pint") update["system.quantity"] = Math.max((item.system.quantity ?? 1) - 1, 0);
  return update;
}

/** The lit source with the largest radius among an actor's items (pure), or null. */
export function bestLight(items) {
  return [...(items ?? [])].filter(i => i.system?.light?.lit && lightSpec(i))
    .map(i => lightSpec(i)).sort((a, b) => b.radius - a.radius)[0] ?? null;
}

/** Token light data for a source (pure): PHB radius as bright light; cone angle for the beam lanterns. */
export function tokenLight(spec) {
  return { bright: spec.radius, dim: spec.radius, angle: spec.angle ?? 360 };
}

/** Light the bearer's tokens on the current scene from its lit sources, or restore their own light. */
export async function syncTokenLight(actor) {
  const spec = bestLight(actor?.items);
  const tokens = actor?.getActiveTokens?.(false, true) ?? [];
  for (const token of tokens) {
    if (!token?.isOwner && !game.user?.isGM) continue;
    const prior = token.getFlag?.("ad2e", "priorLight") ?? null;
    if (spec) {
      const update = Object.fromEntries(Object.entries(tokenLight(spec)).map(([k, v]) => [`light.${k}`, v]));
      if (!prior) update["flags.ad2e.priorLight"] = { bright: token.light?.bright ?? 0, dim: token.light?.dim ?? 0, angle: token.light?.angle ?? 360 };
      await token.update(update);
    } else if (prior) {
      await token.update({ "light.bright": prior.bright, "light.dim": prior.dim, "light.angle": prior.angle, "flags.ad2e.priorLight": null });
    }
  }
}

/** Light an item (sheet button): uses oil for an empty lantern; warns when it cannot. */
export async function lightItem(actor, item) {
  const now = game.time?.worldTime ?? 0;
  const plan = lightPlan(item, actor.items, now);
  if (!plan.ok) {
    if (plan.reason !== "lit") ui.notifications?.warn(game.i18n.format(`AD2E.Light.Cannot.${plan.reason}`, { name: item.name }));
    return null;
  }
  if (plan.oil) await actor.updateEmbeddedDocuments("Item", [plan.oil]);
  await item.update(plan.update);
  await syncTokenLight(actor);
  return item;
}

/** Put a lit item out (sheet button). */
export async function putOut(actor, item) {
  await item.update(outUpdate(item, game.time?.worldTime ?? 0));
  await syncTokenLight(actor);
  return item;
}

/** Actors that may carry lights: world actors and unlinked tokens of every scene. */
function lightBearers() {
  const out = [...(game.actors ?? [])];
  for (const scene of game.scenes ?? []) for (const t of scene.tokens ?? []) if (!t.actorLink && t.actor) out.push(t.actor);
  return out;
}

/** Burn out lit sources whose fuel has ended (active GM, on world time). */
export async function processLights(now = game.time?.worldTime ?? 0) {
  for (const actor of lightBearers()) {
    const ended = actor.items.filter(i => i.system?.light?.lit && lightSpec(i) && secondsLeft(i, now) <= 0);
    if (!ended.length) continue;
    await actor.updateEmbeddedDocuments("Item", ended.map(i => ({ _id: i.id, ...expireUpdate(i) })));
    await ChatMessage.implementation.create({ speaker: ChatMessage.getSpeaker({ actor }),
      content: `<p>${ended.map(i => game.i18n.format(lightSpec(i).per === "pint" ? "AD2E.Light.OutOfOil" : "AD2E.Light.BurntOut",
        { actor: actor.name, name: i.name })).join("<br>")}</p>` });
    await syncTokenLight(actor);
  }
}

/** Lit sources of the world's actors with their turns left (for the dungeon turn tracker). */
export function litSources(now = game.time?.worldTime ?? 0) {
  const rows = [];
  for (const actor of lightBearers()) {
    for (const i of actor.items) if (i.system?.light?.lit && lightSpec(i)) {
      rows.push({ actor, item: i, uuid: i.uuid, name: i.name, bearer: actor.name, turns: turnsLeft(i, now), radius: lightSpec(i).radius });
    }
  }
  return rows.sort((a, b) => a.turns - b.turns);
}

export function registerLights() {
  Hooks.on("updateWorldTime", () => {
    if (game.users?.activeGM?.isSelf) processLights();
  });
}

