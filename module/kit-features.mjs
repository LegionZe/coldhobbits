/**
 * Skills & Powers kit features with figures (kit field `special` and `socialRanks`, written by
 * tools/build-kit-mechanics.py from the kit pages, each regex-checked). Owner's rulings in brackets.
 *  - Pugilist: unarmed attacks count as armed (no +4 attack of opportunity for the defender: a chat note); Charisma
 *    effectively -1 with the middle class and -2 with the upper class (the reaction dialog asks the NPC's class).
 *  - Barbarian: on a first meeting, an NPC reaction result of 8 or less gets -2 more, 14 or more +2 more.
 *  - Weapon Master: a display of skill gives the opponents who see it -2 initiative (+2 on the d10) for the first two
 *    rounds of combat [a Combat tab button; the opposing side's rolls in rounds 1-2 get it, pre-ticked in their dialog];
 *    no proficiency with weapons of another type than the weapon of choice [a warning].
 *  - Mystic: meditation boosts a score by +2 (Strength 18/xx: +20%) for one-third of the meditation time, one boost at
 *    a time [the ability instead of a subability; 18/xx capped at 18/00, implementation choice].
 *  - Social ranks: each kit's 2d6 table [rolled and recorded on the character].
 */
export const RANK_KEYS = ["lower", "lowerMiddle", "upperMiddle", "upper"];

/** The special features of the character's fitting kit ({} if none). */
export function kitSpecial(actor) {
  const info = actor?.system?.classInfo;
  return (info?.kitFits ? info.kitItem?.system?.special : null) ?? {};
}

/** The social rank row for a 2d6 total. */
export function socialRankFor(ranks, total) {
  return (ranks ?? []).find(r => total >= r.min && total <= r.max) ?? null;
}

/** Barbarian first meeting: the reaction result after the kit's swing ({ low, high, adjust }). */
export function barbarianReaction(total, rule) {
  if (!rule) return total;
  if (total <= rule.low) return total - rule.adjust;
  if (total >= rule.high) return total + rule.adjust;
  return total;
}

/** Pugilist: how much Charisma counts lower with an NPC of this social class ("lower" | "middle" | "upper"). */
export function pugilistCharisma(rule, npcClass) {
  return rule?.[npcClass] ?? 0;
}

/** Whether a meditation boost is active at world time `now` (after the meditation, for one-third of its time). */
export function meditationActive(meditation, now) {
  return !!meditation?.ability && meditation.until !== null && meditation.until !== undefined
    && now >= (meditation.from ?? 0) && now < meditation.until;
}

/** Whether a meditation is under way or its boost still to come or active (one at a time). */
export function meditationPending(meditation, now) {
  return !!meditation?.ability && meditation.until !== null && meditation.until !== undefined && now < meditation.until;
}

/** Seconds a meditation of `hours` lasts: one-third of the time spent. */
export function meditationSeconds(hours, fraction = 3) {
  return Math.floor(Math.max(hours, 0) * 3600 / fraction);
}

/**
 * Apply an active meditation to the ability scores (derived totals): +2, or +20% to an 18/xx Strength (at most 18/00).
 * Returns a note { key, text } or null.
 */
export function applyMeditation(abilities, meditation, rule) {
  const ab = abilities?.[meditation?.ability];
  if (!ab || !rule) return null;
  if (meditation.ability === "str" && ab.total === 18 && ab.exceptional > 0) {
    ab.exceptional = Math.min(ab.exceptional + rule.exceptional, 100);
    return { key: "str", exceptional: true };
  }
  ab.total += rule.bonus;
  return { key: meditation.ability, exceptional: false };
}

/** Weapon damage type letters ("P/S" -> ["P", "S"]). */
const typeLetters = t => String(t ?? "").toUpperCase().split(/[^BPS]+/).filter(Boolean);

/** Weapon Master: weapon proficiency identifiers whose type shares nothing with the weapon of choice's. */
export function weaponTypeConflicts(profs) {
  const choice = profs.find(p => p.choice);
  if (!choice) return { choice: null, conflicts: [] };
  const allowed = new Set(typeLetters(choice.type));
  return { choice: choice.identifier, conflicts: profs.filter(p => p !== choice && typeLetters(p.type).length
    && !typeLetters(p.type).some(l => allowed.has(l))).map(p => p.identifier) };
}

/** Weapon Master display in a combat: the +2 for a combatant on the other side in rounds 1-2, or null. */
export function displayPenalty(combat, combatant, sideOf) {
  if (!combat || !combatant || (combat.round ?? 0) > 2) return null;
  const side = sideOf(combatant);
  const list = combat.combatants?.[Symbol.iterator] ? combat.combatants : [];
  for (const c of list) {
    const flag = c.actor?.getFlag?.("ad2e", "display");
    if (!flag || flag.combat !== combat.id || flag.side === side) continue;
    const rule = kitSpecial(c.actor).display;
    if (rule && (combat.round ?? 0) <= rule.rounds) return { value: rule.initiative, name: c.actor.name };
  }
  return null;
}

const esc = v => foundry.utils.escapeHTML?.(String(v ?? "")) ?? String(v ?? "");

/** Roll and record the character's social rank on the kit's 2d6 table. */
export async function rollSocialRank(actor) {
  const ranks = actor.system.classInfo?.kitFits ? actor.system.classInfo.kitItem?.system.socialRanks : null;
  if (!ranks?.length) return null;
  const roll = await new Roll("2d6").evaluate();
  const row = socialRankFor(ranks, roll.total);
  await actor.update({ "system.socialRank": row.rank, "system.socialTitle": row.title ?? "" });
  return roll.toMessage({ speaker: ChatMessage.getSpeaker({ actor }), flavor: `${esc(game.i18n.localize("AD2E.KitFeature.SocialRank"))}: `
    + `${esc(game.i18n.localize(`AD2E.KitFeature.Rank.${row.rank}`))}${row.title ? ` (${esc(row.title)})` : ""}` });
}

/** Weapon Master: display before combat (the opposing side's initiative in rounds 1-2 gets the penalty). */
export async function weaponMasterDisplay(actor, sideOf) {
  const combat = game.combat;
  const combatant = combat?.combatants?.find(c => c.actor?.id === actor.id);
  const rule = kitSpecial(actor).display;
  if (!rule || !combatant) {
    ui.notifications.warn(game.i18n.localize("AD2E.KitFeature.DisplayNoCombat"));
    return null;
  }
  await actor.setFlag("ad2e", "display", { combat: combat.id, side: sideOf(combatant) });
  return ChatMessage.create({ speaker: ChatMessage.getSpeaker({ actor }),
    content: `<p>${esc(game.i18n.format("AD2E.KitFeature.Displayed", { name: actor.name, n: rule.initiative, rounds: rule.rounds }))}</p>` });
}

/** Mystic: meditate for some hours and choose the ability to boost. */
export async function meditate(actor) {
  const rule = kitSpecial(actor).meditation;
  if (!rule) return null;
  const now = game.time?.worldTime ?? 0;
  if (meditationPending(actor.system.meditation, now)) {
    ui.notifications.warn(game.i18n.localize("AD2E.KitFeature.OneBoost"));
    return null;
  }
  const i18n = k => game.i18n.localize(k);
  const abilities = ["str", "dex", "con", "int", "wis", "cha"];
  const input = await foundry.applications.api.DialogV2.prompt({
    window: { title: `${actor.name}: ${i18n("AD2E.KitFeature.Meditate")}` },
    content: `<p class="ad2e-note">${esc(i18n("AD2E.KitFeature.MeditateHint"))}</p>`
      + `<div class="form-group"><label>${i18n("AD2E.KitFeature.Hours")}</label><input type="number" name="hours" value="3" min="1" step="1"></div>`
      + `<div class="form-group"><label>${i18n("AD2E.KitFeature.Ability")}</label><select name="ability">`
      + abilities.map(k => `<option value="${k}">${esc(i18n(`AD2E.Ability.${k}`))}</option>`).join("") + "</select></div>",
    ok: { label: i18n("AD2E.KitFeature.Meditate"), callback: (event, button) => ({
      hours: Math.max(Math.floor(Number(button.form.elements.hours.value) || 0), 0), ability: button.form.elements.ability.value }) },
    rejectClose: false
  });
  if (!input?.hours) return null;
  // Meditation takes the hours first; the boost lasts one-third of them from then on.
  const start = now + input.hours * 3600;
  await actor.update({ "system.meditation": { ability: input.ability, from: start, until: start + meditationSeconds(input.hours, rule.fraction) } });
  return ChatMessage.create({ speaker: ChatMessage.getSpeaker({ actor }), content: `<p>${esc(game.i18n.format("AD2E.KitFeature.Meditated",
    { name: actor.name, hours: input.hours, ability: i18n(`AD2E.Ability.${input.ability}`), minutes: Math.round(meditationSeconds(input.hours, rule.fraction) / 60) }))}</p>` });
}

/**
 * When world time passes, every client re-prepares characters whose meditation boost starts or ends (the boost is
 * derived from world time); the active GM clears expired meditations.
 */
export function registerKitFeatures() {
  Hooks.on("updateWorldTime", (now, delta) => {
    for (const a of game.actors?.filter(x => x.type === "character" && x.system.meditation?.ability) ?? []) {
      const m = a.system.meditation;
      if (game.user?.isActiveGM && now >= (m.until ?? 0)) {
        a.update({ "system.meditation": { ability: "", from: null, until: null } });
        continue;
      }
      if (meditationActive(m, now) !== meditationActive(m, now - (delta ?? 0))) {
        a.reset();
        a.sheet?.rendered && a.sheet.render(false);
      }
    }
  });
}
