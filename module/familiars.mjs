/**
 * Wizard familiars (Find Familiar (Wizard Spell); table and figures generated in module/rules/familiar-tables.mjs).
 *  - "A wizard can have only one familiar at a time": `system.familiar.uuid` (a monster actor with role "familiar").
 *  - Finding one: "The DM secretly determines all results" (GM only): 2d12 hours of casting, 1,000 gp of incense and
 *    herbs, a d20 on the spell's table; "it can be attempted but once per year" (`lastAttempt`, world time).
 *    A familiar that comes is imported from the Hirelings & Mounts compendium with 2-4 hit points plus 1 per caster
 *    level and AC 7, owned like the wizard.
 *  - "+1 bonus to all surprise die rolls" while the familiar lives and is within reach (`near`, the 1 mile link).
 *  - "If separated from the caster, the familiar loses 1 hit point each day" (`separated`; the active GM applies it
 *    as world time passes) "and dies if reduced to 0 hit points".
 *  - "If the familiar dies, the wizard must successfully roll an immediate system shock check or die. Even if he
 *    survives this check, the wizard loses 1 point from his Constitution": a button on the wizard's sheet.
 *  - "When the familiar is in physical contact with its wizard, it gains the wizard's saving throws against special
 *    attacks": a tick box in the familiar's save dialog (ticked when their tokens touch on the scene); damage from a
 *    special attack is none on a successful save, half on a failed one (asked when damage is applied to a familiar in
 *    contact). Not for gens (Al-Qadim elemental familiars save at twice their master's level, module/gens.mjs).
 */
import { FAMILIAR_TABLES } from "./rules/familiar-tables.mjs";
import { tokensTouch } from "./token-riders.mjs";

export const FAMILIAR = FAMILIAR_TABLES;
const PACK = "ad2e.hirelings";
const DAY = 86400;

const resolve = uuid => (uuid ? (foundry.utils.fromUuidSync ?? globalThis.fromUuidSync)?.(uuid, { strict: false }) ?? null : null);
const esc = v => foundry.utils.escapeHTML?.(String(v ?? "")) ?? String(v ?? "");

/** The d20 row for a roll. */
export function familiarRow(n) {
  return FAMILIAR.rows.find(r => n >= r.min && n <= r.max) ?? null;
}

/** A monster actor that is a familiar. */
export function isFamiliar(actor) {
  return actor?.type === "monster" && actor.system?.role === "familiar";
}

/** Whether a familiar actor is dead (0 hit points or marked dead). */
export function familiarDead(actor) {
  return !!actor?.system && ((actor.system.hp?.value ?? 1) <= 0 || !!actor.system.hp?.dead || actor.system.hpState?.state === "dead");
}

/** State of a character's familiar: { actor, uuid, missing, dead, surprise (bonus now), senses, ... }. */
export function familiarInfo(character) {
  const f = character.system.familiar ?? {};
  const actor = resolve(f.uuid);
  const usable = !!actor?.system;
  const dead = usable && familiarDead(actor);
  const row = usable ? FAMILIAR.rows.find(r => r.key && `familiar-${r.key}` === actor.system.identifier) : null;
  return {
    uuid: f.uuid ?? "", actor: usable ? actor : null, missing: !!f.uuid && !usable, dead,
    near: f.near !== false, separated: !!f.separated, deathResolved: !!f.deathResolved,
    surprise: usable && !dead && f.near !== false ? FAMILIAR.rules.surprise : 0,
    senses: row?.senses ?? "", lastAttempt: f.lastAttempt ?? null
  };
}

/** Surprise bonus from a living familiar within reach (0 otherwise). */
export function familiarSurpriseBonus(actor) {
  if (actor?.type !== "character" || !actor.system.familiar?.uuid) return 0;
  return familiarInfo(actor).surprise;
}

/** Days of world time since the last attempt (null if none). */
export function daysSinceAttempt(character, now = game.time?.worldTime ?? 0) {
  const last = character.system.familiar?.lastAttempt;
  return last === null || last === undefined ? null : Math.floor((now - last) / DAY);
}

/**
 * Find Familiar (GM): rolls the casting time and the d20 table (whispered to the GMs), and on a result imports the
 * creature, sets its hit points and AC, and links it to the wizard.
 */
export async function findFamiliar(character) {
  const i18n = k => game.i18n.localize(k);
  if (!game.user.isGM) return ui.notifications.warn(i18n("AD2E.Familiar.GmOnly"));
  const current = familiarInfo(character);
  if (current.actor && !current.dead) return ui.notifications.warn(game.i18n.format("AD2E.Familiar.HasOne", { name: current.actor.name }));
  const days = daysSinceAttempt(character);
  const tooSoon = days !== null && days < 365;
  const ok = await foundry.applications.api.DialogV2.confirm({
    window: { title: i18n("AD2E.Familiar.FindTitle") },
    content: `<p>${esc(game.i18n.format("AD2E.Familiar.FindText", { name: character.name, cost: FAMILIAR.rules.cost,
      time: FAMILIAR.rules.castingTime }))}</p>`
      + (tooSoon ? `<p class="ad2e-unmet">${esc(game.i18n.format("AD2E.Familiar.TooSoon", { days }))}</p>` : ""),
    rejectClose: false
  });
  if (!ok) return null;
  const level = character.system.level ?? 1;
  const time = await new Roll(`${FAMILIAR.rules.castingTime}`).evaluate();
  const roll = await new Roll("1d20").evaluate();
  const row = familiarRow(roll.total);
  await character.update({ "system.familiar.lastAttempt": game.time.worldTime });
  let actor = null;
  if (row?.key) {
    const pack = game.packs.get(PACK);
    const index = await pack?.getIndex({ fields: ["system.identifier"] });
    const entry = index?.find(e => e.system?.identifier === `familiar-${row.key}`);
    const source = entry ? await pack.getDocument(entry._id) : null;
    if (source) {
      const hp = await new Roll(`${FAMILIAR.rules.hp.dice} + ${FAMILIAR.rules.hp.perLevel * level}`).evaluate();
      const data = game.actors.fromCompendium(source);
      foundry.utils.mergeObject(data, {
        name: game.i18n.format("AD2E.Familiar.ActorName", { creature: source.name, name: character.name }),
        ownership: foundry.utils.deepClone(character.ownership ?? {}),
        system: { hp: { value: hp.total, max: hp.total }, ac: { base: FAMILIAR.rules.ac } }
      });
      actor = await Actor.implementation.create(data);
      if (actor) {
        await character.update({ "system.familiar": { uuid: actor.uuid, near: true, separated: false, deathResolved: false,
          lastAttempt: game.time.worldTime } });
      }
    }
  }
  const outcome = row?.key
    ? game.i18n.format("AD2E.Familiar.Came", { creature: row.name, senses: row.senses })
    : i18n("AD2E.Familiar.NoneCame");
  await roll.toMessage({ speaker: ChatMessage.getSpeaker({ actor: character }),
    flavor: `${esc(game.i18n.format("AD2E.Familiar.ChatTitle", { name: character.name }))} `
      + `(${esc(game.i18n.format("AD2E.Familiar.ChatTime", { hours: time.total }))}): ${esc(outcome)}` },
  { rollMode: "gmroll" });
  return actor;
}

/**
 * The familiar died: system shock (Constitution, PHB Table 3) or the wizard dies; either way -1 Constitution
 * (the rolled score). Marks the death as resolved.
 */
export async function familiarDeath(character) {
  const i18n = k => game.i18n.localize(k);
  const shock = character.system.abilityData?.con?.systemShock ?? null;
  const roll = await new Roll("1d100").evaluate();
  const survived = shock !== null && roll.total <= shock;
  const con = character.system.abilities.con.value;
  const lost = FAMILIAR.rules.conLoss;
  await character.update({ "system.abilities.con.value": Math.max(con - lost, 1), "system.familiar.deathResolved": true });
  return roll.toMessage({ speaker: ChatMessage.getSpeaker({ actor: character }),
    flavor: `${esc(game.i18n.format("AD2E.Familiar.DeathTitle", { name: character.name }))} `
      + `(${i18n("AD2E.Test.systemShock")} ${i18n("AD2E.Roll.RollUnder")} ${shock ?? "—"}): `
      + `${i18n(survived ? "AD2E.Familiar.Survives" : "AD2E.Familiar.Dies")} `
      + esc(game.i18n.format("AD2E.Familiar.ConLoss", { from: con, to: Math.max(con - lost, 1) })) });
}

/**
 * Daily hit point loss while separated: when world time crosses day boundaries, the active GM takes 1 hit point per
 * day from each separated familiar that is still alive.
 */
export function registerFamiliarHooks() {
  Hooks.on("updateWorldTime", async (worldTime, delta) => {
    if (!game.users?.activeGM?.isSelf || !delta) return;
    const days = Math.floor(worldTime / DAY) - Math.floor((worldTime - delta) / DAY);
    if (days <= 0) return;
    for (const pc of game.actors ?? []) {
      if (pc.type !== "character" || !pc.system.familiar?.separated) continue;
      const fam = resolve(pc.system.familiar.uuid);
      if (!fam?.system || familiarDead(fam)) continue;
      const hp = Math.max((fam.system.hp.value ?? 0) - FAMILIAR.rules.separatedLoss * days, 0);
      await fam.update({ "system.hp.value": hp });
      await ChatMessage.create({ speaker: ChatMessage.getSpeaker({ actor: fam }), whisper: game.users.filter(u => u.isGM).map(u => u.id),
        content: `<p>${esc(game.i18n.format(hp > 0 ? "AD2E.Familiar.Pines" : "AD2E.Familiar.PinedAway", { name: fam.name, days, hp }))}</p>` });
    }
  });
}

/** Uuids that name an actor: its own and, for a token's synthetic actor, its world actor's. */
function actorUuids(actor) {
  const out = new Set();
  if (actor?.uuid) out.add(actor.uuid);
  const base = actor?.token?.actorId ?? (actor?.isToken ? null : actor?.id);
  if (base) out.add(`Actor.${base}`);
  return out;
}

/** The wizard whose Find Familiar familiar this actor is (world characters), or null; never for a gen. */
export function familiarMaster(actor, actors = game.actors) {
  if (!isFamiliar(actor) || String(actor.system?.identifier ?? "").startsWith("gen-")) return null;
  const mine = actorUuids(actor);
  return [...(actors ?? [])].find(a => a?.type === "character" && mine.has(a.system?.familiar?.uuid)) ?? null;
}

/** Whether a familiar's token and its master's token touch on a scene (default: the viewed scene). */
export function familiarContact(familiar, master, scene = globalThis.canvas?.scene) {
  if (!familiar || !master || !scene?.tokens) return false;
  const tokens = [...scene.tokens];
  const fam = actorUuids(familiar);
  const mas = actorUuids(master);
  const of = set => tokens.filter(t => set.has(t.actor?.uuid) || set.has(`Actor.${t.actorId}`));
  const size = scene.grid?.size ?? 100;
  return of(fam).some(f => of(mas).some(m => tokensTouch(f, m, size)));
}

/** Damage from a special attack to a familiar in contact with its master: { saved: factor, failed: factor }. */
export const CONTACT_DAMAGE = FAMILIAR.rules.contact;

/**
 * A familiar in contact with its master hit by damage: ask whether it came from a special attack (saved: no damage,
 * failed: half). Returns the damage to apply, or null when the dialog is closed.
 */
export async function familiarContactDamage(familiar, amount) {
  const master = familiarMaster(familiar);
  if (!master || !familiarContact(familiar, master)) return amount;
  const i18n = k => game.i18n.localize(k);
  const half = Math.floor(amount * CONTACT_DAMAGE.failed);
  const none = Math.floor(amount * CONTACT_DAMAGE.saved);
  const choice = await foundry.applications.api.DialogV2.wait({
    window: { title: game.i18n.format("AD2E.Familiar.ContactTitle", { name: familiar.name }) },
    content: `<p>${esc(game.i18n.format("AD2E.Familiar.ContactText", { name: familiar.name, master: master.name }))}</p>`,
    buttons: [
      { action: "normal", label: game.i18n.format("AD2E.Familiar.ContactNormal", { n: amount }), default: true },
      { action: "saved", label: game.i18n.format("AD2E.Familiar.ContactSaved", { n: none }) },
      { action: "failed", label: game.i18n.format("AD2E.Familiar.ContactFailed", { n: half }) }
    ],
    rejectClose: false
  });
  if (!choice) return null;
  return choice === "saved" ? none : choice === "failed" ? half : amount;
}
