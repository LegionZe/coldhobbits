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
 */
export const DEATH_LIMIT = -10;
export const MASSIVE_DAMAGE = 50;

export function deathRule() {
  try { return game.settings.get("ad2e", "deathRule") ?? "standard"; } catch { return "standard"; }
}

/**
 * State from hit points: "ok", "unconscious" (Death's Door, 0 to -9) or "dead". `dead` = an explicit death (massive
 * damage, bled out). `bleeding`: unconscious and not stabilised.
 */
export function hpState({ value = 1, dead = false, stable = false } = {}, { character = true, rule = deathRule() } = {}) {
  const doorRule = character && rule === "deathsDoor";
  let state = "ok";
  if (dead) state = "dead";
  else if (doorRule) state = value <= DEATH_LIMIT ? "dead" : (value <= 0 ? "unconscious" : "ok");
  else if (value <= 0) state = "dead";
  return { state, bleeding: state === "unconscious" && !stable, doorRule };
}

/** Natural healing for `days` of rest (Healing (PHB)): rest 1 per day; bed rest 3 per day + conBonus per full week. */
export function naturalHealing(days, bedRest, conBonus = 0) {
  if (!(days > 0)) return 0;
  return bedRest ? 3 * days + Math.floor(days / 7) * Math.max(conBonus, 0) : days;
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

  // Chat context menu on damage rolls: apply the damage (or healing) to the selected tokens.
  Hooks.on("getChatMessageContextOptions", (html, options) => {
    const message = li => game.messages.get(li.dataset.messageId);
    const amount = li => message(li)?.getFlag("ad2e", "damage");
    const visible = li => Number.isFinite(amount(li)) && canvas?.tokens?.controlled?.length > 0;
    const apply = heal => async (event, li) => {
      for (const token of canvas.tokens.controlled) {
        const actor = token.actor;
        if (!actor?.applyDamage) continue;
        if (heal) await actor.applyHealing(amount(li));
        else await actor.applyDamage(amount(li), { single: true });
      }
    };
    options.push(
      // Same entry shape as dnd5e 6.x on v14 (icon class, group, visible(li), onClick(event, li)).
      { label: "AD2E.Health.ApplyDamage", icon: "fa-solid fa-user-minus", group: "ad2e", visible, onClick: apply(false) },
      { label: "AD2E.Health.ApplyHealing", icon: "fa-solid fa-user-plus", group: "ad2e", visible, onClick: apply(true) }
    );
  });
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
