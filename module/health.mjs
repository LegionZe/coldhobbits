/**
 * Hit points, death and healing.
 *  - Character Death (PHB, DMG): "When a character reaches 0 hit points, that character is slain."
 *  - Hovering on Death's Door (DMG, optional rule; world setting "deathRule"): characters fall unconscious at 0 hit
 *    points, lose 1 hit point each round, and die at -10; a round spent binding wounds stops the loss; a cure spell
 *    restores the character to 1 hit point only, and further cures do no good until a day of rest (weak and feeble,
 *    spells wiped). Monsters always die at 0.
 *  - Death From Massive Damage (PHB, DMG): 50 or more points from a single attack: save vs. death or die.
 *  - Healing (PHB): 1 hit point per day of rest, 3 per day of complete bed rest, plus the Constitution hit point bonus
 *    per complete week of bed rest; never above the maximum. Curative spells have no effect on the dead.
 *  - Temporary damage (Attacking Without Killing (PHB, DMG)): punching damage is recorded separately (`hp.punch`) and
 *    split at the end of combat, 25% lasting and 75% returned; half of a non-lethal weapon attack's damage is temporary
 *    (`hp.temp`), "lasting one turn after the fight is over". A creature whose hit points are 0 or less only because of
 *    temporary damage is unconscious, not dead or dying.
 */
import { COMBAT_TABLES } from "./rules/combat-tables.mjs";
import { wardedDamage } from "./elemental.mjs";
import { genWardedDamage } from "./gens.mjs";
import { familiarContactDamage } from "./familiars.mjs";

export const DEATH_LIMIT = -10;
/** One turn = 10 rounds of one minute (PHB, "Time"), in seconds of world time. */
export const TURN_SECONDS = 600;

/** Hit points of punching damage that return after the fight (25% of it is lasting, rounded down). */
export function punchRestore(punch = 0) {
  const n = Math.max(Number(punch) || 0, 0);
  return n - Math.floor(n * COMBAT_TABLES.punch.lasting);
}
export const MASSIVE_DAMAGE = 50;

export function deathRule() {
  try { return game.settings.get("ad2e", "deathRule") ?? "standard"; } catch { return "standard"; }
}

/**
 * State from hit points: "ok", "unconscious" (Death's Door, 0 to -9) or "dead". `dead` = an explicit death (massive
 * damage, bled out). `bleeding`: unconscious and not stabilised.
 */
export function hpState({ value = 1, dead = false, stable = false, punch = 0, temp = 0 } = {}, { character = true, rule = deathRule() } = {}) {
  const doorRule = character && rule === "deathsDoor";
  const restorable = punchRestore(punch) + Math.max(Number(temp) || 0, 0);
  // Knocked out: 0 or fewer hit points, but above 0 once the temporary damage returns.
  const knockedOut = !dead && value <= 0 && value + restorable > 0;
  let state = "ok";
  if (dead) state = "dead";
  else if (knockedOut) state = "unconscious";
  else if (doorRule) state = value <= DEATH_LIMIT ? "dead" : (value <= 0 ? "unconscious" : "ok");
  else if (value <= 0) state = "dead";
  return { state, bleeding: state === "unconscious" && !stable && !knockedOut, doorRule, knockedOut, restorable };
}

/** Sheet text for pending temporary damage: "" when none (localized). */
export function temporaryHp(hp = {}) {
  const punch = hp.punch ?? 0;
  const temp = hp.temp ?? 0;
  if (!(punch > 0) && !(temp > 0)) return "";
  return game.i18n.format("AD2E.Health.TemporaryText", { punch, restore: punchRestore(punch), temp });
}

/** Natural healing for `days` of rest (Healing (PHB)): rest 1 per day; bed rest 3 per day + conBonus per full week. */
export function naturalHealing(days, bedRest, conBonus = 0, perDay = 1) {
  if (!(days > 0)) return 0;
  return bedRest ? 3 * days + Math.floor(days / 7) * Math.max(conBonus, 0) : days * perDay;
}

/** Token status icons (core "unconscious" and "dead") follow the actor's hit point state. */
async function syncStatus(actor) {
  const st = actor.system?.hpState?.state;
  if (!st || typeof actor.toggleStatusEffect !== "function") return;
  const has = id => actor.statuses?.has?.(id);
  const known = id => (Array.isArray(CONFIG.statusEffects) ? CONFIG.statusEffects : Object.values(CONFIG.statusEffects ?? {}))
    .some(e => e.id === id);
  if (known("dead") && has("dead") !== (st === "dead")) await actor.toggleStatusEffect("dead", { active: st === "dead", overlay: true });
  if (known("unconscious") && has("unconscious") !== (st === "unconscious")) {
    await actor.toggleStatusEffect("unconscious", { active: st === "unconscious" });
  }
}

/** Combat rounds already processed for bleeding (combat id -> round). */
const bledRounds = new Map();

export function registerHealth() {
  game.settings.register("ad2e", "deathRule", {
    name: "AD2E.Health.Setting", hint: "AD2E.Health.SettingHint", scope: "world", config: true, type: String,
    choices: { standard: "AD2E.Health.RuleStandard", deathsDoor: "AD2E.Health.RuleDeathsDoor" }, default: "standard"
  });

  // Status icons: the user who changed the hit points updates the token status (once).
  Hooks.on("updateActor", (actor, changes, options, userId) => {
    if (userId !== game.user.id || !foundry.utils.hasProperty(changes, "system.hp")) return;
    syncStatus(actor);
  });

  // Death's Door: unconscious, unbound characters lose 1 hit point at the start of each new round (active GM only).
  Hooks.on("updateCombat", async (combat, changed) => {
    if (!game.user.isActiveGM || !("round" in changed)) return;
    const last = bledRounds.get(combat.id) ?? combat.previous?.round ?? 0;
    if (!(changed.round > last)) return;
    bledRounds.set(combat.id, changed.round);
    for (const c of combat.combatants) {
      const actor = c.actor;
      if (actor?.type !== "character" || !actor.system.hpState?.bleeding) continue;
      await actor.applyDamage(1, { single: false, bleeding: true });
    }
  });

  // End of combat: punching damage is split (75% returns now); temporary non-lethal damage returns one turn later.
  Hooks.on("deleteCombat", async combat => {
    if (!game.user.isActiveGM) return;
    for (const actor of new Set(combat.combatants.map(c => c.actor).filter(Boolean))) {
      const hp = actor.system?.hp;
      if (!hp) continue;
      if (hp.punch > 0) await actor.recoverTemporary({ punch: true, temp: false });
      if (hp.temp > 0 && hp.tempUntil === null) await actor.update({ "system.hp.tempUntil": game.time.worldTime + TURN_SECONDS });
    }
  });

  // Temporary non-lethal damage returns once the world time passes the recorded time (active GM).
  Hooks.on("updateWorldTime", async worldTime => {
    if (!game.user.isActiveGM) return;
    const tokenActors = game.scenes.contents.flatMap(s => s.tokens.contents).filter(t => !t.actorLink).map(t => t.actor);
    for (const actor of new Set([...game.actors.contents, ...tokenActors].filter(Boolean))) {
      const hp = actor.system?.hp;
      if (hp?.temp > 0 && hp.tempUntil !== null && hp.tempUntil !== undefined && worldTime >= hp.tempUntil) {
        await actor.recoverTemporary({ punch: false, temp: true });
      }
    }
  });

  // Chat context menu on damage rolls (the same actions as the buttons under the message: damageButtons).
  Hooks.on("getChatMessageContextOptions", (html, options) => {
    const message = li => game.messages.get(li.dataset.messageId);
    const entry = (label, icon, scope, heal) => ({ label, icon, group: "ad2e",
      visible: li => damageTargets(message(li), scope, heal).length > 0,
      onClick: (event, li) => applyFromMessage(message(li), scope, heal) });
    // Same entry shape as dnd5e 6.x on v14 (icon class, group, visible(li), onClick(event, li)).
    options.push(
      entry("AD2E.Health.ApplyDamageRollTargets", "fa-solid fa-crosshairs", "roll", false),
      entry("AD2E.Health.ApplyDamageMyTargets", "fa-solid fa-bullseye", "mine", false),
      entry("AD2E.Health.ApplyDamage", "fa-solid fa-user-minus", "selected", false),
      entry("AD2E.Health.ApplyHealingRollTargets", "fa-solid fa-hand-holding-heart", "roll", true),
      entry("AD2E.Health.ApplyHealingMyTargets", "fa-solid fa-hand-holding-medical", "mine", true),
      entry("AD2E.Health.ApplyHealing", "fa-solid fa-user-plus", "selected", true)
    );
  });
}

/* ---------------------------------------- Applying damage from chat */

/**
 * Actors a damage message can be applied to: `scope` "roll" (the tokens targeted when it was rolled,
 * `flags.ad2e.targets`), "mine" (this user's targets now) or "selected" (controlled tokens). Healing only for normal
 * damage. Empty when the message carries no damage.
 */
export function damageTargets(message, scope, heal = false) {
  const amount = message?.getFlag?.("ad2e", "damage");
  if (!Number.isFinite(amount)) return [];
  if (heal && (message.getFlag("ad2e", "damageKind") ?? "normal") !== "normal") return [];
  // A healing roll (a spell's healing option) is never applied as damage.
  if (!heal && message.getFlag("ad2e", "healing")) return [];
  let actors = [];
  if (scope === "roll") {
    const resolve = foundry.utils.fromUuidSync ?? globalThis.fromUuidSync;
    actors = (message.getFlag("ad2e", "targets") ?? []).map(t => resolve?.(t.uuid, { strict: false })?.actor);
  } else if (scope === "mine") actors = [...(game.user?.targets ?? [])].map(t => t.actor);
  else actors = (canvas?.tokens?.controlled ?? []).map(t => t.actor);
  return [...new Set(actors.filter(a => a?.applyDamage))];
}

/** Apply a damage message's damage (or healing) to the actors of `scope` (see damageTargets); owners only. */
export async function applyFromMessage(message, scope, heal = false) {
  const actors = damageTargets(message, scope, heal);
  if (!actors.length) {
    ui.notifications.warn(game.i18n.localize(`AD2E.Health.NoTargets.${scope}`));
    return;
  }
  const amount = message.getFlag("ad2e", "damage");
  const element = message.getFlag("ad2e", "element");
  for (const actor of actors) {
    if (!actor.isOwner) {
      ui.notifications.warn(game.i18n.format("AD2E.Health.NotOwner", { name: actor.name }));
      continue;
    }
    // An elemental mage hit by its own province: -2 per damage die, at least 0 (module/elemental.mjs).
    // A gen, or a sha'ir with its gen within 10 feet, hit by the gen's element: -2 per die, at least 1 (module/gens.mjs).
    const mage = heal ? null : wardedDamage(actor, element);
    const gen = heal || mage !== null ? null : genWardedDamage(actor, element);
    const warded = mage ?? gen;
    if (warded !== null && warded !== amount) {
      ui.notifications.info(game.i18n.format(gen !== null ? "AD2E.Gen.Warded" : "AD2E.Elemental.Warded", { name: actor.name, from: amount, to: warded }));
    }
    if (heal) {
      await actor.applyHealing(amount);
      continue;
    }
    // A familiar touching its wizard: no damage from a special attack it saved against, half if it failed (Find Familiar).
    const dealt = await familiarContactDamage(actor, warded ?? amount);
    if (dealt === null) continue;
    await actor.applyDamage(dealt, { single: true, kind: message.getFlag("ad2e", "damageKind") ?? "normal",
      temp: message.getFlag("ad2e", "temp") ?? 0 });
  }
}

/**
 * Buttons under a damage message (GM only; players use the context menu for tokens they own): apply to the targets of
 * the roll (named), to my targeted tokens, to the selected tokens, or heal the selected tokens. Called from
 * AD2EChatMessage#renderHTML (as dnd5e adds its chat controls on v14).
 */
export function damageButtons(message, html) {
  const amount = message?.getFlag?.("ad2e", "damage");
  if (!Number.isFinite(amount) || !game.user?.isGM || !html?.querySelector) return;
  const i18n = k => game.i18n.localize(k);
  const esc = v => foundry.utils.escapeHTML?.(String(v ?? "")) ?? String(v ?? "");
  const rollTargets = message.getFlag("ad2e", "targets") ?? [];
  const normal = (message.getFlag("ad2e", "damageKind") ?? "normal") === "normal";
  // Healing (a spell's healing option): heal the targets of the roll, my targets or the selected tokens.
  const buttons = message.getFlag("ad2e", "healing") ? [
    rollTargets.length ? ["roll", true, "fa-hand-holding-heart", `${i18n("AD2E.Health.Button.healRoll")}: ${rollTargets.map(t => esc(t.name)).join(", ")}`] : null,
    ["mine", true, "fa-hand-holding-medical", i18n("AD2E.Health.Button.healMine")],
    ["selected", true, "fa-user-plus", i18n("AD2E.Health.Button.heal")]
  ].filter(Boolean) : [
    rollTargets.length ? ["roll", false, "fa-crosshairs", `${i18n("AD2E.Health.Button.roll")}: ${rollTargets.map(t => esc(t.name)).join(", ")}`] : null,
    ["mine", false, "fa-bullseye", i18n("AD2E.Health.Button.mine")],
    ["selected", false, "fa-user-minus", i18n("AD2E.Health.Button.selected")],
    normal ? ["selected", true, "fa-user-plus", i18n("AD2E.Health.Button.heal")] : null
  ].filter(Boolean);
  const box = document.createElement("div");
  box.className = "ad2e-damage-buttons";
  box.innerHTML = `<span class="ad2e-damage-amount">${esc(game.i18n.format("AD2E.Health.Button.amount", { n: amount }))}</span>`
    + buttons.map(([scope, heal, icon, label]) => `<button type="button" data-ad2e-apply="${scope}" data-ad2e-heal="${heal}">`
      + `<i class="fa-solid ${icon}"></i> ${label}</button>`).join("");
  for (const b of box.querySelectorAll("button")) {
    b.addEventListener("click", ev => {
      ev.preventDefault();
      ev.stopPropagation();
      applyFromMessage(message, b.dataset.ad2eApply, b.dataset.ad2eHeal === "true");
    });
  }
  (html.querySelector(".message-content") ?? html).append(box);
}

/** Ask for an amount of damage or healing and apply it to `actor` (sheet buttons). */
export async function promptHitPoints(actor, heal) {
  const i18n = k => game.i18n.localize(k);
  const input = await foundry.applications.api.DialogV2.prompt({
    window: { title: `${actor.name}: ${i18n(heal ? "AD2E.Health.Heal" : "AD2E.Health.Damage")}` },
    content: `<div class="form-group"><label>${i18n("AD2E.Health.Amount")}</label><input type="number" name="amount" value="1" min="0" step="1" autofocus></div>`
      + (heal ? "" : `<div class="form-group"><label>${i18n("AD2E.Health.SingleAttack")}</label><input type="checkbox" name="single" checked></div>`
        + `<p class="ad2e-note">${i18n("AD2E.Health.MassiveHint")}</p>`),
    ok: { label: i18n(heal ? "AD2E.Health.Heal" : "AD2E.Health.Damage"), callback: (event, button) => ({
      amount: Number(button.form.elements.amount.value) || 0, single: !!button.form.elements.single?.checked }) },
    rejectClose: false
  });
  if (!input?.amount) return;
  return heal ? actor.applyHealing(input.amount) : actor.applyDamage(input.amount, { single: input.single });
}
