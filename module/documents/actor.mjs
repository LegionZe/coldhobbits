import { ad2eDialog } from "../dialogs.mjs";
import { AD2E, hitDiceAt } from "../config.mjs";
import { modifierFields, modifierText, promptModifier, readModifier } from "../roll-modifiers.mjs";
import { MASSIVE_DAMAGE, naturalHealing, punchRestore } from "../health.mjs";
import { promptMorale } from "../henchmen.mjs";
import { familiarContact, familiarMaster, familiarSurpriseBonus } from "../familiars.mjs";
import { useComponents } from "../components.mjs";
import { dieBonus, diceCount, elementFlag, elementOf, PROVINCES } from "../elemental.mjs";
import { missileStyleOf, mountedMissileModifier, shieldType, SP } from "../sp-weapons.mjs";
import { clearFetched, isShair, retributionNotice } from "../shair.mjs";
import { genWardProvince } from "../gens.mjs";
import { gainsHitPoints, penalizedAward, undoDual } from "../dual-class.mjs";
import { firstLevelHitPoints, levelHitPoints, multiAward, multiEntries } from "../multi-class.mjs";
import { drainedXp, drainTarget, excessPlan, forgetMemorized, minimumXp, pendingDrain, RESTORATION_AGE, restorationInTime, UNDEAD_RISE } from "../level-drain.mjs";
import { SHAIR } from "../rules/shair-tables.mjs";

/** Label of a spell damage option: its own label, or "Damage 2 (per round): 2d4". */
export function spellDamageLabel(d, i = 0) {
  const kind = game.i18n.localize(d.kind === "healing" ? "AD2E.Spell.Healing" : "AD2E.Weapon.Damage");
  const round = d.perRound ? ` (${game.i18n.localize("AD2E.Spell.PerRound")})` : "";
  return `${d.label || `${kind} ${i + 1}`}${round}: ${d.formula}`;
}
import { canFightTwoWeapons, twoWeaponStyle, COMBAT_TABLES, halveRate, mountedFireIssues, mountedMeleeModifier, mountTrained, needsTwoHands, parseRate, stepDownRate, twoWeaponExempt, nonlethalAllowed, overbearModifier, punchWrestleResult, secondWeaponAllowed,
  twoWeaponPenalty, wrestlingArmor } from "../combat-options.mjs";

import { armorBlocksWizardCasting } from "../data/character.mjs";
import { feeblemindActive } from "../companions.mjs";
import { kitSpecial } from "../kit-features.mjs";
import { targetedTraps, TRAP } from "../traps.mjs";
import { armsTrapped, breakFreeScore, LASSO, monsterScores, NET, netAc, opposedAttack, opposedCheck, pullTripScore } from "../lasso.mjs";
import { requestPoisonSaves, usePoisonDose } from "../poison.mjs";
import { createSaveRequest, groupResults, targetActor } from "../save-requests.mjs";
import { magicResistanceOf, resists, saveEffect } from "../magic-resistance.mjs";
import { table52ForTarget, table52Text } from "../armor-types.mjs";
import { attackOptionsOn, AO, disarmPossible, maneuversFor, OPPOSED, opposedAcs, rushScore, sapChance, shieldOf } from "../attack-options.mjs";
import { chartKey, CRIT, targetKind } from "../criticals.mjs";
import { TRAVEL } from "../rules/travel-tables.mjs";
import { criticalMode, criticalText, isCritical, multiplyDice, postCriticalCard, rollCritical, sizeOfActor, weaponCritSize } from "../criticals.mjs";

export default class AD2EActor extends Actor {
  /**
   * Core Actor#getRollData returns the system data directly and does not call
   * TypeDataModel#getRollData, so delegate explicitly (same pattern as dnd5e Actor5e).
   */
  getRollData() {
    if (this.system.getRollData) return this.system.getRollData();
    return { ...super.getRollData() };
  }

  /** Conditional kit modifiers for a roll (`target`, optional key): the character's kit options, else none. */
  #kitOptions(target, key = null) {
    return this.type === "character" ? (this.system.kitMods?.options(target, key) ?? []) : [];
  }

  /** Checkbox fields for conditional kit modifiers ("Kit: +2 (while Berserk)"). */
  #kitFields(options, unit = "") {
    if (!options.length) return "";
    const esc = v => foundry.utils.escapeHTML?.(String(v ?? "")) ?? String(v ?? "");
    const kit = this.system.classInfo?.kitItem?.name ?? "";
    return `<fieldset><legend>${esc(game.i18n.format("AD2E.Kit.Situational", { kit }))}</legend>${options.map(m =>
      `<div class="form-group"><label>${esc(`${m.current > 0 ? "+" : ""}${m.current}${unit} ${m.condition}`)}</label>`
      + `<input type="checkbox" name="kitmod" value="${m.index}"></div>`).join("")}</fieldset>`;
  }

  /** Sum and labels of the kit modifiers ticked in a dialog form. */
  static #kitPicked(form, options) {
    const picked = [...(form?.querySelectorAll?.("input[name=kitmod]:checked") ?? [])].map(i => Number(i.value));
    const chosen = options.filter(m => picked.includes(m.index));
    return { sum: chosen.reduce((n, m) => n + m.current, 0), text: chosen.map(m => m.condition).join("; ") };
  }

  /** Dual-class (module/dual-class.mjs): tick box offering the better old THAC0 or save while restricted ("" otherwise). */
  #dualField(value) {
    if (value === null || value === undefined) return "";
    const label = game.i18n.format("AD2E.Dual.UseOld", { n: value });
    return `<div class="form-group"><label>${foundry.utils.escapeHTML?.(label) ?? label}</label><input type="checkbox" name="dualOld"></div>`;
  }

  /**
   * Dual-class: using an earlier class's ability (or its better attack or saving throw number) while the restrictions
   * apply costs the experience of this encounter and half that of the adventure ("If he uses any of his previous
   * class's abilities during an encounter, he earns no experience for that encounter and only half experience for the
   * adventure", Multi-Class and Dual-Class Characters (PHB)). Sets both penalty flags and posts a note.
   * @param {string} what  the ability used (for the chat note)
   */
  async markOldClassUse(what) {
    if (this.type !== "character" || !this.system.dual?.restricted) return false;
    const pen = this.system.dualClass?.penalty ?? {};
    if (!pen.encounter || !pen.adventure) {
      await this.update({ "system.dualClass.penalty.encounter": true, "system.dualClass.penalty.adventure": true });
    }
    const text = game.i18n.format("AD2E.Dual.PenaltyNote", { name: this.name, what });
    await ChatMessage.create({ speaker: ChatMessage.getSpeaker({ actor: this }),
      content: `<p class="ad2e-note">${foundry.utils.escapeHTML?.(text) ?? text}</p>` });
    return true;
  }

  /** Dialog with a situational modifier (and reason) and the conditional kit modifiers; null when cancelled. */
  async #promptRoll(title, options, unit = "", extra = "") {
    return ad2eDialog.prompt({
      window: { title },
      content: extra + modifierFields({ unit, autofocus: !extra }) + this.#kitFields(options, unit),
      ok: { label: game.i18n.localize("AD2E.Roll.Roll"), callback: (event, button) => {
        const kit = AD2EActor.#kitPicked(button.form, options);
        const { mod, note } = readModifier(button.form);
        return { mod, note, kit: kit.sum, kitText: kit.text, genWard: !!button.form.elements.genWard?.checked,
          masterSave: !!button.form.elements.masterSave?.checked, dualOld: !!button.form.elements.dualOld?.checked };
      } },
      rejectClose: false
    });
  }

  /**
   * Hit points gained on reaching `level`: one hit die + CON adjustment (minimum 1 per die)
   * while the group still gains dice, otherwise the fixed per-level bonus with no CON.
   * Posts the result to chat and returns the number gained.
   */
  async rollHitPointsForLevel(level, { group = this.system.classGroup, classes = 1, className = "" } = {}) {
    const cur = hitDiceAt(group, level);
    const prev = level > 1 ? hitDiceAt(group, level - 1) : { dice: 0, bonus: 0 };
    const dice = cur.dice - prev.dice;
    const bonus = cur.bonus - prev.bonus;
    const speaker = ChatMessage.getSpeaker({ actor: this });
    const flavor = game.i18n.format("AD2E.HP.RollFlavor", { level }) + (className ? ` (${className})` : "");
    // Kit hit points per level (e.g. Gallant +1 per level, in addition to Constitution).
    const kitHp = this.type === "character" ? (this.system.kitMods?.total("hp") ?? 0) : 0;
    // Multi-class (module/multi-class.mjs): the new Hit Die divided by the number of classes (at least 1 per die), and the
    // class's share of the Constitution bonus and of the fixed and kit bonuses.
    if (classes > 1) {
      const con = this.system.mods.conHp;
      const roll = dice > 0 ? await new Roll(`${dice}d${cur.die}`).evaluate() : null;
      const gained = levelHitPoints({ roll: roll?.total ?? 0, dice: Math.max(dice, 0), fixed: bonus + kitHp, con, classes });
      const text = `${flavor}: ${game.i18n.format("AD2E.Multi.HpGained", { hp: gained, n: classes })}`;
      if (roll) await roll.toMessage({ speaker, flavor: text });
      else await ChatMessage.create({ speaker, content: `<p>${text}</p>` });
      return gained;
    }
    if (dice <= 0) {
      await ChatMessage.create({ speaker, content: `<p>${flavor}: ${game.i18n.format("AD2E.HP.Fixed", { hp: bonus + kitHp })}</p>` });
      return bonus + kitHp;
    }
    const con = this.system.mods.conHp;
    const roll = await new Roll(`${dice}d${cur.die} + @con`, { con: con * dice }).evaluate();
    const gained = Math.max(roll.total, dice) + bonus + kitHp; // no hit die yields less than 1 hit point
    await roll.toMessage({
      speaker,
      flavor: `${flavor}: ${game.i18n.format("AD2E.HP.Gained", { hp: gained })}`
        + (gained > roll.total + bonus + kitHp ? ` (${game.i18n.localize("AD2E.HP.Minimum")})` : "")
    });
    return gained;
  }

  /** Roll 1st-level hit points and set current and maximum HP to the result. */
  async rollFirstLevelHitPoints() {
    // Multi-class: each class's Hit Dice rolled, the total divided by the number of dice (down), then Constitution.
    const multi = this.type === "character" ? this.system.multi : null;
    if (multi) {
      const parts = multi.classes.map(c => { const hd = hitDiceAt(c.group, 1); return { c, formula: `${hd.dice}d${hd.die}` }; });
      const roll = await new Roll(parts.map(p => p.formula).join(" + ")).evaluate();
      const rolls = roll.dice.flatMap(d => d.results.map(r => r.result));
      const hp = Math.max(firstLevelHitPoints(rolls, this.system.mods.conHp) + (this.system.kitMods?.total("hp") ?? 0), 1);
      await roll.toMessage({ speaker: ChatMessage.getSpeaker({ actor: this }),
        flavor: `${game.i18n.format("AD2E.HP.RollFlavor", { level: 1 })} (${parts.map(p => `${p.c.name} ${p.formula}`).join(", ")}): `
          + game.i18n.format("AD2E.Multi.FirstHp", { hp, n: rolls.length }) });
      return this.update({ "system.hp.max": hp, "system.hp.value": hp });
    }
    const hp = await this.rollHitPointsForLevel(1);
    return this.update({ "system.hp.max": hp, "system.hp.value": hp });
  }

  /** Advance one level and add the hit points gained to current and maximum HP. */
  async levelUp(classId = null) {
    // A 0-level character (energy drain) "cannot regain levels" without a restoration or wish (module/level-drain.mjs).
    if (this.type === "character" && this.system.drain?.zero) {
      ui.notifications.warn(game.i18n.localize("AD2E.Drain.ZeroNoLevel"));
      return null;
    }
    if (this.type === "character" && this.system.multi) return this.#multiLevelUp(classId);
    const level = this.system.level + 1;
    const limit = this.system.classInfo.levelLimit;
    if (limit && level > limit) {
      ui.notifications.warn(game.i18n.format("AD2E.Race.LevelLimitReached", { limit }));
      return null;
    }
    // Dual-class: "the character earns no additional Hit Dice or hit points while advancing in his new class" until his
    // new level is higher than every earlier class's (Multi-Class and Dual-Class Characters (PHB)).
    const prev = this.type === "character" && this.system.dual ? this.system.dualClass.previous : [];
    if (!gainsHitPoints(prev, level)) {
      await ChatMessage.create({ speaker: ChatMessage.getSpeaker({ actor: this }),
        content: `<p>${game.i18n.format("AD2E.Dual.NoHitPoints", { level, max: this.system.dual.maxOld })}</p>` });
      return this.update({ "system.level": level, ...this.#drainRegained("main", level) });
    }
    const hp = await this.rollHitPointsForLevel(level);
    return this.update({
      "system.level": level, ...this.#drainRegained("main", level),
      "system.hp.max": this.system.hp.max + hp,
      "system.hp.value": this.system.hp.value + hp
    });
  }

  /** Update that drops the drained levels a class has regained (module/level-drain.mjs). */
  #drainRegained(key, level) {
    if (this.type !== "character") return {};
    const lost = this.system.drain?.lost ?? [];
    if (!lost.length) return {};
    const levels = { ...this.system.drainLevels(), [key]: level };
    const pending = pendingDrain(lost, levels);
    return pending.length === lost.length ? {} : { "system.drain.lost": pending };
  }

  /** The character's classes for energy drain: key, identifier, name, group, level, experience table and current XP. */
  #drainClasses() {
    const sys = this.system;
    if (sys.multi) return sys.multi.classes.map(c => ({ key: c.primary ? "main" : `multi:${c.identifier}`, identifier: c.identifier,
      name: c.name, group: c.group, level: c.level, table: AD2E.xpTable[c.xpKey] ?? [], xp: c.xp }));
    const cls = sys.classInfo.classItem;
    const list = [{ key: "main", identifier: cls?.system.identifier ?? "", name: cls?.name ?? "", group: sys.classGroup, level: sys.level,
      table: AD2E.xpTable[sys.classInfo.xpTable] ?? [], xp: sys.xp }];
    for (const p of sys.dual ? sys.dualClass.previous : []) list.push({ key: `prev:${p.identifier}`, identifier: p.identifier, name: p.name,
      group: p.group, level: p.level, table: AD2E.xpTable[p.identifier] ?? [], xp: p.xp });
    return list;
  }

  /** Hit points of one level of a class: its Hit Dice roll (at least 1 per die) plus Constitution, or its fixed bonus. */
  async #levelHp(c, level, classes) {
    const cur = hitDiceAt(c.group, level);
    const prev = level > 1 ? hitDiceAt(c.group, level - 1) : { dice: 0, bonus: 0 };
    const dice = Math.max(cur.dice - prev.dice, 0);
    const fixed = cur.bonus - prev.bonus + (this.system.kitMods?.total("hp") ?? 0);
    const roll = dice > 0 ? await new Roll(`${dice}d${cur.die}`).evaluate() : null;
    return { roll, hp: levelHitPoints({ roll: roll?.total ?? 0, dice, fixed, con: this.system.mods.conHp, classes }) };
  }

  /**
   * Energy drain (GM; module/level-drain.mjs): asks how many levels; each comes off the highest class (multi- and
   * dual-class), costs that level's hit points from the maximum, and sets the class's experience halfway between the
   * new level and the next. Below 1st level the character becomes 0-level; drained again, slain. Wizard spells above
   * the new highest castable level are no longer understood.
   */
  async drainLevels(count = null) {
    if (this.type !== "character" || !game.user?.isGM) return null;
    const i18n = k => game.i18n.localize(k);
    const esc = v => foundry.utils.escapeHTML?.(String(v ?? "")) ?? String(v ?? "");
    let n = count;
    if (!n) {
      const input = await ad2eDialog.prompt({
        window: { title: `${this.name}: ${i18n("AD2E.Drain.Title")}` },
        content: `<div class="form-group"><label>${i18n("AD2E.Drain.Levels")}</label><input type="number" name="levels" value="1" min="1" step="1" autofocus></div>`
          + `<p class="ad2e-note">${i18n("AD2E.Drain.Explain")}</p>`,
        ok: { label: i18n("AD2E.Drain.Apply"), callback: (event, button) => Math.max(Math.floor(Number(button.form.elements.levels.value) || 0), 0) },
        rejectClose: false
      });
      n = input;
    }
    if (!n) return null;
    const speaker = ChatMessage.getSpeaker({ actor: this });
    const lines = [];
    const rolls = [];
    const lost = [...(this.system.drain?.lost ?? [])].map(e => ({ ...e }));
    let classes = this.#drainClasses();
    const dual = this.system.dual;
    let hpLost = 0;
    let zero = !!this.system.drain?.zero;
    let slain = false;
    for (let i = 0; i < n; i++) {
      if (zero) { slain = true; break; }
      const target = drainTarget(classes);
      if (!target) { zero = true; lines.push(game.i18n.format("AD2E.Drain.Zero", { name: this.name })); continue; }
      const level = target.level;
      // A dual-class level that gave no hit points (not above the earlier classes) takes none away (implementation choice).
      const noHp = target.key === "main" && dual && level <= dual.maxOld;
      const { roll, hp } = noHp ? { roll: null, hp: 0 } : await this.#levelHp(target, level, this.system.multi ? classes.length : 1);
      if (roll) rolls.push(roll);
      hpLost += hp;
      target.level = level - 1;
      target.xp = drainedXp(target.table, level - 1);
      lost.push({ key: target.key, identifier: target.identifier, name: target.name, level, hp, at: game.time?.worldTime ?? 0 });
      lines.push(game.i18n.format("AD2E.Drain.Lost", { class: target.name, from: level, to: level - 1, hp, xp: target.xp }));
    }
    const update = { "system.drain.lost": lost, "system.drain.zero": zero };
    for (const c of classes) {
      if (c.key === "main") Object.assign(update, { "system.level": c.level, "system.xp": c.xp });
    }
    if (this.system.multi) update["system.multiClass.classes"] = classes.filter(c => c.key !== "main")
      .map(c => ({ identifier: c.identifier, level: c.level, xp: c.xp }));
    if (dual) update["system.dualClass.previous"] = this.system.dualClass.previous.map(p => {
      const c = classes.find(x => x.key === `prev:${p.identifier}`);
      return { ...p, prime: [...(p.prime ?? [])], level: c?.level ?? p.level, xp: c?.xp ?? p.xp ?? null };
    });
    const max = Math.max(this.system.hp.max - hpLost, 1);
    Object.assign(update, { "system.hp.max": max, "system.hp.value": Math.min(this.system.hp.value, max) });
    // Drained again at 0-level: slain (an explicit death).
    if (slain) update["system.hp.dead"] = true;
    await this.update(update);
    // Wizard spells above the highest level the character can now cast are no longer understood (roll again to relearn).
    const sp = this.system.spells;
    const wizardLevels = (sp?.levels ?? []).filter(l => (l.kind ?? sp.kind) === "wizard" && l.base > 0).map(l => l.level);
    const hasWizard = sp?.kind === "wizard" || (sp?.extra ?? []).some(e => e.kind === "wizard");
    if (hasWizard && !sp.shair) {
      const maxLevel = wizardLevels.length ? Math.max(...wizardLevels) : 0;
      const forget = this.items.filter(it => it.type === "spell" && it.system.kind === "wizard" && it.system.level > maxLevel && it.system.learned !== false);
      if (forget.length) {
        await this.updateEmbeddedDocuments("Item", forget.map(it => ({ _id: it.id, "system.learned": false, "system.learnFailedLevel": null,
          "system.prepared": 0, "system.cast": 0 })));
        lines.push(game.i18n.format("AD2E.Drain.Forgotten", { n: forget.length, level: maxLevel }));
      }
    }
    if (slain) {
      lines.push(game.i18n.format("AD2E.Drain.Slain", { name: this.name }));
      // "he returns as an undead of the same type as his slayer in 2d4 days" (GM only).
      const rise = await new Roll(UNDEAD_RISE).evaluate();
      await ChatMessage.create({ speaker, rolls: [rise], whisper: ChatMessage.getWhisperRecipients?.("GM") ?? [],
        content: `<p>${esc(game.i18n.format("AD2E.Drain.Undead", { name: this.name, days: rise.total }))}</p>` });
    } else {
      lines.push(...await this.#forgetExcessSpells());
    }
    lines.push(game.i18n.format("AD2E.Drain.HpMax", { lost: hpLost, max }));
    return ChatMessage.create({ speaker, rolls, content: `<p><strong>${esc(game.i18n.format("AD2E.Drain.ChatTitle", { name: this.name, n }))}</strong></p>`
      + `<ul>${lines.map(l => `<li>${esc(l)}</li>`).join("")}</ul>` });
  }

  /**
   * Energy drain: "The character must instantly forget any spells that are in excess of those allowed for his new level"
   * (Special Damage (DMG)). Owner's ruling: the GM picks; uncast memorizations are proposed first (level-drain.mjs
   * excessPlan). Returns chat lines.
   */
  async #forgetExcessSpells() {
    const sp = this.system.spells;
    if (!sp || sp.shair) return [];
    const esc = v => foundry.utils.escapeHTML?.(String(v ?? "")) ?? String(v ?? "");
    const plan = excessPlan((sp.levels ?? []).filter(l => l.level >= 1).map(l => {
      const kind = l.kind ?? sp.kind;
      return { level: l.level, kind, slots: l.slots, spells: l.spells.filter(i => i.system.kind === kind && i.system.learned !== false)
        .map(i => ({ id: i.id, name: i.name, prepared: i.system.prepared ?? 0, cast: i.system.cast ?? 0 })) };
    }));
    if (!plan.length) return [];
    const kindName = k => game.i18n.localize(AD2E.spellKinds[k] ?? k);
    const content = `<p class="ad2e-note">${esc(game.i18n.localize("AD2E.Drain.ForgetHint"))}</p>` + plan.map(l => `<fieldset><legend>${esc(game.i18n.format("AD2E.Drain.ForgetLevel",
      { kind: kindName(l.kind), level: l.level, memorized: l.memorized, slots: l.slots, excess: l.excess }))}</legend>`
      + l.spells.map(s => `<div class="form-group"><label>${esc(s.name)} (${esc(game.i18n.format("AD2E.Drain.ForgetCount", { prepared: s.prepared, cast: s.cast }))})</label>`
        + `<input type="number" name="f-${l.kind}-${s.id}" value="${s.forget}" min="0" max="${s.prepared}" step="1"></div>`).join("") + "</fieldset>").join("");
    const chosen = await ad2eDialog.prompt({
      window: { title: `${this.name}: ${game.i18n.localize("AD2E.Drain.ForgetTitle")}` }, content,
      ok: { label: game.i18n.localize("AD2E.Drain.Forget"), callback: (event, button) => Object.fromEntries(plan.flatMap(l => l.spells.map(s =>
        [s.id, Math.min(Math.max(Math.floor(Number(button.form.elements[`f-${l.kind}-${s.id}`].value) || 0), 0), s.prepared)]))) },
      rejectClose: false
    });
    if (!chosen) return [game.i18n.localize("AD2E.Drain.ForgetSkipped")];
    const lines = [];
    const updates = [];
    for (const l of plan) {
      let total = 0;
      for (const s of l.spells) {
        const f = chosen[s.id] ?? 0;
        if (!f) continue;
        total += f;
        const after = forgetMemorized(s.prepared, s.cast, f);
        updates.push({ _id: s.id, "system.prepared": after.prepared, "system.cast": after.cast });
        lines.push(game.i18n.format("AD2E.Drain.ForgotSpell", { name: s.name, n: f }));
      }
      if (total < l.excess) lines.push(game.i18n.format("AD2E.Drain.StillOver", { kind: kindName(l.kind), level: l.level, n: l.excess - total }));
    }
    if (updates.length) await this.updateEmbeddedDocuments("Item", updates);
    return lines;
  }

  /**
   * Restoration (GM; module/level-drain.mjs): the most recent drained level comes back with "exactly the number of
   * experience points necessary" and the hit points it cost; a 0-level character resumes its career. The dialog shows
   * the days since the drain against the caster's level (one day per level).
   */
  async restoreLevel() {
    if (this.type !== "character" || !game.user?.isGM) return null;
    const i18n = k => game.i18n.localize(k);
    const esc = v => foundry.utils.escapeHTML?.(String(v ?? "")) ?? String(v ?? "");
    const sys = this.system;
    const pending = sys.drainInfo?.pending ?? [];
    const entry = sys.drain?.zero ? null : pending.at(-1);
    if (!entry && !sys.drain?.zero) {
      ui.notifications.info(i18n("AD2E.Drain.NothingToRestore"));
      return null;
    }
    const now = game.time?.worldTime ?? 0;
    const input = await ad2eDialog.prompt({
      window: { title: `${this.name}: ${i18n("AD2E.Drain.Restore")}` },
      content: `<p>${esc(entry ? game.i18n.format("AD2E.Drain.RestoreQuestion", { class: entry.name, level: entry.level, hp: entry.hp,
        days: restorationInTime(entry.at, now, 0).days }) : i18n("AD2E.Drain.RestoreZero"))}</p>`
        + `<div class="form-group"><label>${esc(game.i18n.format("AD2E.Drain.Caster", { n: RESTORATION_AGE }))}</label><select name="casterActor">`
        + `<option value="">${esc(i18n("AD2E.Drain.CasterNone"))}</option>`
        + (game.actors?.filter(a => a.type === "character" && a.id !== this.id) ?? []).map(a => `<option value="${a.id}">${esc(a.name)}</option>`).join("")
        + `</select></div>`
        + `<div class="form-group"><label>${i18n("AD2E.Drain.CasterLevel")}</label><input type="number" name="caster" value="13" min="1" step="1"></div>`,
      ok: { label: i18n("AD2E.Drain.Restore"), callback: (event, button) => ({ caster: Math.max(Math.floor(Number(button.form.elements.caster.value) || 1), 1),
        casterActor: button.form.elements.casterActor?.value ?? "" }) },
      rejectClose: false
    });
    if (!input) return null;
    if (!entry) {
      await this.update({ "system.drain.zero": false });
      const aged = await this.#restorationAges(input.casterActor);
      return ChatMessage.create({ speaker: ChatMessage.getSpeaker({ actor: this }), content: `<p>${esc(game.i18n.format("AD2E.Drain.ZeroRestored", { name: this.name }))}</p>`
        + `<p>${esc(aged)}</p>` });
    }
    const timing = restorationInTime(entry.at, now, input.caster);
    if (!timing.ok) {
      ui.notifications.warn(game.i18n.format("AD2E.Drain.TooLate", { days: timing.days, limit: timing.limit }));
      return null;
    }
    const classes = this.#drainClasses();
    const c = classes.find(x => x.key === entry.key);
    if (!c) return null;
    const level = c.level + 1;
    const xp = Math.max(minimumXp(c.table, level), 0);
    const update = { "system.drain.lost": (sys.drain.lost ?? []).filter(e => e !== entry && !(e.key === entry.key && e.level === entry.level && e.at === entry.at)),
      "system.hp.max": sys.hp.max + entry.hp, "system.hp.value": sys.hp.value + entry.hp };
    if (entry.key === "main") Object.assign(update, { "system.level": level, "system.xp": xp });
    else if (entry.key.startsWith("multi:")) update["system.multiClass.classes"] = multiEntries(sys.multi.classes, c.identifier, { level, xp });
    else update["system.dualClass.previous"] = sys.dualClass.previous.map(p => ({ ...p, prime: [...(p.prime ?? [])],
      ...(p.identifier === c.identifier ? { level, xp } : {}) }));
    await this.update(update);
    const aged = await this.#restorationAges(input.casterActor);
    return ChatMessage.create({ speaker: ChatMessage.getSpeaker({ actor: this }), content: `<p>${esc(game.i18n.format("AD2E.Drain.Restored",
      { name: this.name, class: c.name, level, xp, hp: entry.hp }))}</p><p>${esc(aged)}</p>` });
  }

  /** Restoration "ages both the caster and the recipient by two years": recorded ages go up; returns the chat line. */
  async #restorationAges(casterId) {
    const people = [this, casterId ? game.actors?.get(casterId) : null].filter(Boolean);
    const parts = [];
    for (const a of people) {
      const age = a.system.age;
      if (age === null || age === undefined) { parts.push(game.i18n.format("AD2E.Drain.AgeUnknown", { name: a.name })); continue; }
      await a.update({ "system.age": age + RESTORATION_AGE });
      parts.push(game.i18n.format("AD2E.Drain.AgeNew", { name: a.name, from: age, to: age + RESTORATION_AGE }));
    }
    return game.i18n.format("AD2E.Drain.Ages", { n: RESTORATION_AGE, list: parts.join(", ") });
  }

  /**
   * Undo the last dual-class switch (GM correction): the current class item is replaced by the earlier class from the
   * system's Classes compendium at its last level and experience (module/dual-class.mjs undoDual); the current class's
   * levels and experience are lost. Hit points and the kit are left as they are.
   */
  async undoDualClass() {
    if (this.type !== "character" || !game.user?.isGM) return null;
    const i18n = k => game.i18n.localize(k);
    const esc = v => foundry.utils.escapeHTML?.(String(v ?? "")) ?? String(v ?? "");
    const undo = undoDual(this.system.dualClass?.previous ?? [], AD2E.xpTable);
    if (!undo) return null;
    const current = this.items.find(i => i.type === "class");
    const fmt = { name: this.name, from: current?.name ?? "—", level: this.system.level, xp: this.system.xp ?? 0,
      to: undo.restore.name, toLevel: undo.level, toXp: undo.xp };
    const ok = await ad2eDialog.confirm({
      window: { title: i18n("AD2E.Dual.Undo") },
      content: `<p>${esc(game.i18n.format("AD2E.Dual.UndoQuestion", fmt))}</p>`
        + (undo.estimated ? `<p class="ad2e-note">${esc(game.i18n.format("AD2E.Dual.UndoEstimated", fmt))}</p>` : "")
        + `<p class="ad2e-note">${esc(i18n("AD2E.Dual.UndoKeeps"))}</p>`,
      rejectClose: false
    });
    if (!ok) return null;
    const pack = game.packs?.get("ad2e.classes");
    const index = pack ? await pack.getIndex({ fields: ["system.identifier"] }) : [];
    const entry = [...index].find(e => e.system?.identifier === undo.restore.identifier);
    if (!entry) {
      ui.notifications.warn(game.i18n.format("AD2E.Dual.UndoMissing", { name: undo.restore.name }));
      return null;
    }
    const data = (await pack.getDocument(entry._id)).toObject();
    delete data._id;
    if (current) await this.deleteEmbeddedDocuments("Item", [current.id]);
    await this.createEmbeddedDocuments("Item", [data]);
    await this.update({
      "system.dualClass.previous": undo.remaining.map(p => ({ ...p, prime: [...(p.prime ?? [])] })),
      "system.dualClass.penalty": { encounter: false, adventure: false },
      "system.level": undo.level, "system.xp": undo.xp
    });
    return ChatMessage.create({ speaker: ChatMessage.getSpeaker({ actor: this }),
      content: `<p>${esc(game.i18n.format("AD2E.Dual.Undone", fmt))}</p>` });
  }

  /**
   * Multi-class level up: one class advances (asked when not given); it stops at its racial level limit (owner's
   * ruling) and gains its Hit Die divided by the number of classes.
   */
  async #multiLevelUp(classId) {
    const classes = this.system.multi.classes;
    let id = classId;
    if (!id) {
      id = await ad2eDialog.wait({
        window: { title: `${this.name}: ${game.i18n.localize("AD2E.LevelUp")}` },
        content: `<p>${game.i18n.localize("AD2E.Multi.WhichClass")}</p>`,
        buttons: classes.map((c, i) => ({ action: c.identifier, label: `${c.name} ${c.level} → ${c.level + 1}`, default: i === 0 })),
        rejectClose: false
      });
      if (!id) return null;
    }
    const c = classes.find(x => x.identifier === id);
    if (!c) return null;
    const level = c.level + 1;
    if (c.levelLimit && level > c.levelLimit) {
      ui.notifications.warn(`${c.name}: ${game.i18n.format("AD2E.Race.LevelLimitReached", { limit: c.levelLimit })}`);
      return null;
    }
    const hp = await this.rollHitPointsForLevel(level, { group: c.group, classes: classes.length, className: c.name });
    const update = c.primary ? { "system.level": level } : { "system.multiClass.classes": multiEntries(classes, id, { level }) };
    Object.assign(update, this.#drainRegained(c.primary ? "main" : `multi:${id}`, level));
    return this.update({ ...update, "system.hp.max": this.system.hp.max + hp, "system.hp.value": this.system.hp.value + hp });
  }

  /**
   * Nonweapon proficiency check: 1d20 <= ability (effective) + modifier; a roll of 20 always fails
   * ("Nonweapon Proficiencies II (PHB)").
   */
  async rollProficiency(itemId) {
    const item = this.items.get(itemId);
    const entry = this.system.proficiencies.entries.find(e => e.item.id === itemId);
    if (!item || entry?.target === null || entry?.target === undefined) return;
    // Situational modifier, and the conditional kit modifiers for this proficiency.
    const input = await this.#promptRoll(item.name, this.#kitOptions("proficiency", item.system.identifier));
    if (!input) return;
    const heat = this.system.mods?.heat ?? 0; // Al-Qadim heat penalty (module/aq-rules.mjs)
    const fatigue = this.system.mods?.fatigue ?? 0; // missed rests (module/dungeon-turns.mjs)
    const target = entry.target + input.mod + input.kit + heat + fatigue;
    const roll = await new Roll("1d20").evaluate();
    const success = roll.total < 20 && roll.total <= target;
    return roll.toMessage({
      speaker: ChatMessage.getSpeaker({ actor: this }),
      flavor: `${item.name} (${game.i18n.localize("AD2E.Roll.RollUnder")} ${target}${input.kitText ? `; ${input.kitText}` : ""}${heat ? `; ${game.i18n.format("AD2E.AQ.HeatNote", { n: heat })}` : ""}${fatigue ? `; ${game.i18n.format("AD2E.Dungeon.FatigueNote", { n: fatigue })}` : ""})${modifierText(input.mod, input.note)}: `
        + game.i18n.localize(success ? "AD2E.Roll.Success" : "AD2E.Roll.Failure")
        + (roll.total === 20 ? ` (${game.i18n.localize("AD2E.Prof.TwentyFails")})` : "")
    });
  }

  /**
   * Add a kit's proficiencies from the system compendium: bonus ones are free (marked `grantedBy`),
   * required ones use slots. "Choose one" entries prompt the user. Already-owned ones are skipped.
   */
  async grantKitProficiencies(kit) {
    const pack = game.packs?.get("ad2e.proficiencies");
    if (!pack) return;
    const index = await pack.getIndex({ fields: ["system.identifier", "system.kind"] });
    const byId = new Map(index.filter(e => e.system?.kind === "nonweapon").map(e => [e.system.identifier, e]));
    const owned = new Set(this.items.filter(i => i.type === "proficiency").map(i => i.system.identifier));
    const toCreate = [];
    const pick = async (entry, label) => {
      const options = entry.choice.filter(id => byId.has(id));
      if (options.length <= 1) return options[0];
      const buttons = options.map((id, i) => ({ action: id, label: byId.get(id).name, default: i === 0 }));
      return ad2eDialog.wait({
        window: { title: `${kit.name}: ${game.i18n.localize(label)}` },
        content: `<p>${game.i18n.localize("AD2E.Prof.ChooseOne")}</p>`, buttons, rejectClose: false
      });
    };
    for (const [list, label, free] of [[kit.system.bonusProficiencies, "AD2E.Prof.Bonus", true],
      [kit.system.requiredProficiencies, "AD2E.Prof.Required", false]]) {
      for (const entry of list) {
        const id = await pick(entry, label);
        if (!id || owned.has(id)) continue;
        const doc = await pack.getDocument(byId.get(id)._id);
        const data = doc.toObject();
        delete data._id;
        data.system.grantedBy = free ? kit.system.identifier : "";
        toCreate.push(data);
        owned.add(id);
      }
    }
    if (toCreate.length) await this.createEmbeddedDocuments("Item", toCreate);
  }

  /** Delete the bonus proficiencies a kit granted. */
  async removeKitProficiencies(kitIdentifier) {
    const ids = this.items.filter(i => i.type === "proficiency" && i.system.grantedBy === kitIdentifier).map(i => i.id);
    if (ids.length) await this.deleteEmbeddedDocuments("Item", ids);
  }

  /** Roll-under ability check: d20 <= score + modifier. */
  async rollAbilityCheck(key) {
    const input = await this.#promptRoll(game.i18n.localize(`AD2E.Ability.${key}`), this.#kitOptions("ability", key));
    if (!input) return;
    // effective score (racial adjustment included) + kit bonus to ability checks
    const kitAuto = this.type === "character" ? (this.system.kitMods?.total("ability", key) ?? 0) : 0;
    const heat = this.type === "character" ? (this.system.mods?.heat ?? 0) : 0; // Al-Qadim heat (module/aq-rules.mjs)
    const fatigue = this.type === "character" ? (this.system.mods?.fatigue ?? 0) : 0; // missed rests (module/dungeon-turns.mjs)
    const target = this.system.abilities[key].total + kitAuto + input.mod + input.kit + heat + fatigue;
    const roll = await new Roll("1d20").evaluate();
    const success = roll.total <= target;
    return roll.toMessage({
      speaker: ChatMessage.getSpeaker({ actor: this }),
      flavor: `${game.i18n.localize(`AD2E.Ability.${key}`)} ${game.i18n.localize("AD2E.Roll.Check")} `
        + `(${game.i18n.localize("AD2E.Roll.RollUnder")} ${target}${input.kitText ? `; ${input.kitText}` : ""}${heat ? `; ${game.i18n.format("AD2E.AQ.HeatNote", { n: heat })}` : ""}${fatigue ? `; ${game.i18n.format("AD2E.Dungeon.FatigueNote", { n: fatigue })}` : ""})${modifierText(input.mod, input.note)}: `
        + game.i18n.localize(success ? "AD2E.Roll.Success" : "AD2E.Roll.Failure")
    });
  }

  /** Table-driven ability test (AD2E.abilityTests): roll the die, succeed on roll <= table value. */
  async rollAbilityTest(testKey) {
    const test = CONFIG.AD2E.abilityTests[testKey];
    const target = this.system.abilityData[test.ability][test.field];
    const label = game.i18n.localize(`AD2E.Test.${testKey}`);
    if (target === null || target === undefined) {
      ui.notifications.warn(game.i18n.format("AD2E.Test.NotAvailable", { test: label }));
      return;
    }
    // Situational modifier: positive is in the character's favour (for spell failure it lowers the failure chance).
    const unit = test.die === "1d100" ? "%" : "";
    const input = await promptModifier(label, { unit });
    if (!input) return;
    const chance = test.failsOnSuccess ? target - input.mod : target + input.mod;
    const roll = await new Roll(test.die).evaluate();
    const under = roll.total <= chance;
    const success = test.failsOnSuccess ? !under : under;
    const outcomes = test.outcomes ?? { success: "AD2E.Roll.Success", failure: "AD2E.Roll.Failure" };
    return roll.toMessage({
      speaker: ChatMessage.getSpeaker({ actor: this }),
      flavor: `${label} (${test.die} ${game.i18n.localize("AD2E.Roll.RollUnder")} ${chance})${modifierText(input.mod, input.note, unit)}: `
        + game.i18n.localize(success ? outcomes.success : outcomes.failure)
    });
  }

  /**
   * Saving throw: d20 + racial bonus (PHB Table 9, where it applies) + modifier >= save target. `poison`: a save against
   * poison also adds the race's Constitution bonus vs. poison; `request` / `target`: the chat save request it answers
   * (module/save-requests.mjs); `quick`: no dialog (the GM's roll-all).
   */
  async rollSave(key, { request = null, target: requestTarget = null, poison = false, quick = false } = {}) {
    // Gen protection (module/gens.mjs): +2 to saving throws against the gen's element.
    const province = genWardProvince(this);
    const genField = province ? `<div class="form-group"><label>${foundry.utils.escapeHTML?.(game.i18n.format("AD2E.Gen.SaveWard",
      { province: game.i18n.localize(`AD2E.Elemental.Province.${province}`), n: SHAIR.genWard.save })) ?? ""}</label>`
      + `<input type="checkbox" name="genWard"></div>` : "";
    // A familiar touching its wizard: the wizard's saving throw against special attacks (Find Familiar (Wizard Spell)).
    const master = familiarMaster(this);
    const masterSave = master?.system?.saves?.[key] ?? null;
    const masterField = masterSave ? `<div class="form-group"><label>${foundry.utils.escapeHTML?.(game.i18n.format("AD2E.Familiar.MasterSave",
      { name: master.name, n: masterSave.value })) ?? ""}</label><input type="checkbox" name="masterSave"${familiarContact(this, master) ? " checked" : ""}></div>` : "";
    const oldSave = this.type === "character" ? (this.system.dual?.saveOptions?.[key] ?? null) : null;
    const input = quick ? { mod: 0, note: "", kit: 0, kitText: "" }
      : await this.#promptRoll(game.i18n.localize(`AD2E.Save.${key}`), this.#kitOptions("save", key), "",
        genField + masterField + this.#dualField(oldSave));
    if (!input) return;
    const genBonus = input.genWard && province ? SHAIR.genWard.save : 0;
    if (genBonus) input.kitText = [input.kitText, game.i18n.format("AD2E.Gen.SaveWardShort", { n: genBonus })].filter(Boolean).join("; ");
    const useMaster = !!(input.masterSave && masterSave);
    if (useMaster) input.kitText = [input.kitText, game.i18n.format("AD2E.Familiar.MasterSaveShort", { name: master.name })].filter(Boolean).join("; ");
    const mod = input.mod + input.kit + genBonus;
    const useOld = !useMaster && !!(input.dualOld && oldSave !== null);
    if (useOld) await this.markOldClassUse(game.i18n.format("AD2E.Dual.WhatSave", { save: game.i18n.localize(`AD2E.Save.${key}`) }));
    const target = useMaster ? masterSave.value : (useOld ? oldSave : this.system.saves[key].value);
    // PHB Table 9: the Constitution bonus "vs. poison" (dwarves, halflings) counts on saves against poison only.
    const poisonBonus = poison && key === "par" && !useMaster && this.type === "character" ? (this.system.raceInfo?.poisonBonus ?? 0) : 0;
    if (poisonBonus) input.kitText = [input.kitText, game.i18n.format("AD2E.Poison.RaceBonus", { n: poisonBonus })].filter(Boolean).join("; ");
    const bonus = (useMaster ? (masterSave.bonus ?? 0) : this.system.saves[key].bonus) + poisonBonus;
    const roll = await new Roll(bonus ? "1d20 + @bonus + @mod" : "1d20 + @mod", { bonus, mod }).evaluate();
    const success = roll.total >= target;
    return roll.toMessage({
      speaker: ChatMessage.getSpeaker({ actor: this }), flags: { ad2e: { save: { key, success, roll: roll.total, ...(request ? { request, target: requestTarget } : {}) } } },
      flavor: `${game.i18n.localize(`AD2E.Save.${key}`)} (${game.i18n.localize("AD2E.Roll.Needs")} ${target}+${input.kitText ? `; ${input.kitText}` : ""})${modifierText(input.mod, input.note)}: `
        + game.i18n.localize(success ? "AD2E.Roll.Success" : "AD2E.Roll.Failure")
        + (useMaster ? ` (${game.i18n.localize(success ? "AD2E.Familiar.SpecialNone" : "AD2E.Familiar.SpecialHalf")})` : "")
    });
  }

  /**
   * Launchers (bows, crossbows, slings, blowgun) fire ammunition: a missile-only weapon whose damage options
   * come from ammunition rows. Returns the owned ammunition items that fit it (by weapon identifier).
   */
  ammunitionFor(item) {
    const w = item.system.weapon;
    // Firearms (`weapon.ammo`) need ammunition although their damage is their own (Combat & Tactics).
    if (!w?.missile || w.melee || (!w.damage.some(d => d.label) && !w.ammo)) return null;
    return this.items.filter(i => i.type === "ammunition" && i.system.launchers.has(item.system.identifier));
  }

  /** Hurled weapon items (thrown melee weapons, darts) are used up when thrown: one from the item's quantity. */
  #isThrownItem(item, use) {
    return use === "missile" && item.type === "weapon" && item.system.weapon.strength === "full";
  }

  /** Derived attack entry for a weapon item or weapon proficiency. */
  #weaponEntry(itemId) {
    const sys = this.system;
    return sys.weapons?.find(e => e.item.id === itemId) ?? sys.proficiencies.entries.find(e => e.item.id === itemId);
  }

  /**
   * Attack with a weapon item or weapon proficiency (`use` "melee" or "missile"): d20 + adjustments (see
   * CharacterData#weaponAttack) + range modifier + situational modifier >= THAC0 - target AC.
   */
  async rollWeaponAttack(itemId, use = "melee") {
    const item = this.items.get(itemId);
    // The lasso is only used with called shots (Weapon Descriptions (POCT)): its own dialog.
    if (item?.system.identifier === "lasso" && this.type === "character") return this.rollLasso(itemId);
    // The net traps rather than wounds (Weapon Descriptions (POCT)): its own dialog.
    if (item?.system.identifier === "net" && this.type === "character") return this.rollNet(itemId);
    const entry = this.#weaponEntry(itemId);
    const attack = entry?.attack?.[use];
    if (!item || !attack) return;
    const i18n = key => game.i18n.localize(key);
    // Ammunition tracking: a launcher needs owned ammunition with quantity left; a thrown item needs quantity.
    const ammoList = use === "missile" ? this.ammunitionFor(item) : null;
    let ammoField = "";
    if (ammoList) {
      const loaded = ammoList.filter(a => a.system.quantity > 0);
      if (!loaded.length) {
        ui.notifications.warn(game.i18n.format("AD2E.Ammo.None", { name: item.name }));
        return;
      }
      const last = AD2EActor.#lastAmmo.get(`${this.id}.${itemId}`);
      ammoField = `<div class="form-group"><label>${i18n("AD2E.Ammo.Ammunition")}</label><select name="ammo">${
        loaded.map(a => `<option value="${a.id}"${a.id === last ? " selected" : ""}>${a.name} (${a.system.quantity})</option>`).join("")}</select></div>`;
    }
    // Firearms (Combat & Tactics): one gunpowder or smokepowder per shot (owner's ruling), a slow match carried for
    // matchlocks and hand match weapons; footnote misfires can be worse in wet conditions.
    const wpn = item.system.weapon ?? {};
    let powder = null;
    if (use === "missile" && wpn.powder) {
      const have = id => this.items.find(i => i.system?.identifier === id && (i.system.quantity ?? 0) > 0);
      powder = have("gunpowder") ?? have("smokepowder") ?? null;
      if (!powder) return ui.notifications.warn(game.i18n.format("AD2E.Firearm.NoPowder", { name: item.name }));
      if (wpn.match && !this.items.some(i => i.system?.identifier === "slow-match" && (i.system.quantity ?? 0) > 0)) {
        return ui.notifications.warn(game.i18n.format("AD2E.Firearm.NoMatch", { name: item.name }));
      }
    }
    const wetField = use === "missile" && wpn.misfire?.wet ? `<div class="form-group"><label>${game.i18n.format("AD2E.Firearm.Wet",
      { dry: wpn.misfire.dry, wet: wpn.misfire.wet })}</label><input type="checkbox" name="wet"></div>` : "";
    if (this.#isThrownItem(item, use) && item.system.quantity < 1) {
      ui.notifications.warn(game.i18n.format("AD2E.Ammo.NoneLeft", { name: item.name }));
      return;
    }
    let rangeField = "";
    if (use === "missile") {
      const r = attack.range;
      const opts = [["short", `${i18n("AD2E.Weapon.Short")} (${r.short})`], ["medium", `${i18n("AD2E.Weapon.Medium")} (${r.medium})`],
        ["long", `${i18n("AD2E.Weapon.Long")} (${r.long})`]];
      if (attack.pointBlank) opts.unshift(["pointBlank", `${i18n("AD2E.Weapon.PointBlank")} (${
        AD2E.specialization.pointBlankFeet[item.system.weapon.family]} ft)`]);
      rangeField = `<div class="form-group"><label>${i18n("AD2E.Weapon.Range")}</label><select name="range">${
        opts.map(([k, l]) => `<option value="${k}"${k === "short" ? " selected" : ""}>${l}</option>`).join("")}</select></div>`;
    }
    // Missile fire on the move (characters): the mount's movement (DMG Table 53; horse archery style, POSP) and, for a
    // missile or thrown style specialist, the shooter's own movement (all attacks after half a move, half after a full move).
    let moveField = "";
    const styles = this.type === "character" ? this.system.proficiencies?.sp?.styles ?? null : null;
    const missileStyle = use === "missile" && styles && styles[missileStyleOf(item)] ? missileStyleOf(item) : null;
    const riding = use === "missile" && this.type === "character" && !!this.system.animals?.riding;
    // Any attack from the back of an untrained mount: -2 (DMG), ticked by default for such a mount.
    const mount = this.#ridingMount();
    if (mount) {
      moveField += `<div class="form-group"><label>${game.i18n.format("AD2E.Mounted.Untrained", { name: mount.name, n: COMBAT_TABLES.mounted.untrained })}</label>`
        + `<input type="checkbox" name="untrainedMount"${mountTrained(mount) ? "" : " checked"}></div>`;
    }
    if (riding) {
      moveField += `<div class="form-group"><label>${i18n("AD2E.Mounted.MountMove")}${styles?.horseArchery ? ` (${i18n("AD2E.Mounted.HorseArcher")})` : ""}</label><select name="mountMove">${
        COMBAT_TABLES.mountedMissile.map(r => `<option value="${r.key}">${i18n(`AD2E.Mounted.Move.${r.key}`)} (${
          mountedMissileModifier(r.key, COMBAT_TABLES.mountedMissile, !!styles?.horseArchery)})</option>`).join("")}</select></div>`;
    }
    if (missileStyle) {
      moveField += `<div class="form-group"><label>${game.i18n.format("AD2E.SP.OwnMove", { style: i18n(`AD2E.SP.StyleName.${missileStyle}`) })}</label><select name="ownMove">`
        + ["none", "half", "full"].map(k => `<option value="${k}">${i18n(`AD2E.SP.OwnMoveOption.${k}`)}</option>`).join("") + "</select></div>";
    }
    const backstab = use === "melee" ? this.#backstabMultiplier() : null;
    const kitOptions = this.#kitOptions("attack");
    const targets = AD2EActor.#targetsNow();
    this.#rememberTargets(itemId, targets);
    this._ad2eLastWeapon = itemId; // initiative: the weapon of the last attack (module/initiative.mjs)
    const backstabField = backstab ? `<div class="form-group"><label>${i18n("AD2E.Ability2.BackstabAttack")}</label>`
      + `<input type="checkbox" name="backstab"></div>` : "";
    // Two weapons (warriors and rogues, melee) and non-lethal attacks with a blade ("Attacking with Two Weapons (PHB)",
    // "Attacking Without Killing (PHB)").
    const spStyles = this.type === "character" ? this.system.proficiencies?.sp?.styles ?? null : null;
    const twoWeapons = use === "melee" && this.type === "character" && (canFightTwoWeapons(this.system.classGroup) || !!spStyles?.twoWeapon);
    // Skills & Powers weapon and shield style: +1 attack instead of +1 AC this round (with a shield and a melee weapon).
    const styleField = use === "melee" && spStyles?.weaponShield && this.system.armor?.shield
      ? `<div class="form-group"><label>${game.i18n.format("AD2E.SP.WeaponShieldAttack", { n: SP.weaponShield.hit })}</label>`
        + `<input type="checkbox" name="styleAttack"></div>` : "";
    // The other weapon: weapons in hand first. "Both" rolls this weapon (main) and the other one (second) together.
    const others = twoWeapons ? this.items.filter(i => i.type === "weapon" && i.id !== itemId && i.system.weapon?.melee && !i.system.dropped
      && this.#weaponEntry(i.id)?.attack?.melee).sort((a, b) => !!b.system.equipped - !!a.system.equipped) : [];
    const twoField = twoWeapons ? `<div class="form-group"><label>${i18n("AD2E.TwoWeapons.Label")}</label><select name="twoWeapon">`
      + `<option value="">—</option>${others.length ? `<option value="both">${i18n("AD2E.TwoWeapons.both")}</option>` : ""}`
      + `<option value="main">${i18n("AD2E.TwoWeapons.main")}</option><option value="off">${i18n("AD2E.TwoWeapons.off")}</option></select></div>`
      + (others.length ? `<div class="form-group"><label>${i18n("AD2E.TwoWeapons.MainWeapon")}</label><select name="mainWeapon">${
        others.map(o => `<option value="${o.id}">${foundry.utils.escapeHTML?.(o.name) ?? o.name}</option>`).join("")}</select></div>` : "") : "";
    const nonlethalOk = use === "melee" && nonlethalAllowed(item.system.weapon);
    const nonlethalField = nonlethalOk ? `<div class="form-group"><label>${i18n("AD2E.Nonlethal.Weapon")} (${COMBAT_TABLES.nonlethal.hit})</label>`
      + `<input type="checkbox" name="nonlethal"></div>` : "";
    // Class weapon limits (owner's ruling: a warning only; CharacterData weaponRestriction).
    const restriction = this.type === "character" ? this.system.weapons?.find(e => e.item.id === item.id)?.restriction : "";
    const restrictionNote = restriction ? `<p class="ad2e-unmet">${i18n(`AD2E.Weapon.Restrict.${restriction}`)}</p>` : "";
    // Called shots and attack options (world setting "attackOptions", module/attack-options.mjs).
    const maneuverField = this.type === "character" && attackOptionsOn()
      ? this.#maneuverField(maneuversFor({ item, use, items: this.items }), targets, item.system.weapon?.type) : "";
    const input = await ad2eDialog.prompt({
      window: { title: `${item.name}: ${i18n(`AD2E.Weapon.${use}`)}` },
      content: restrictionNote + `<div class="form-group"><label>${i18n("AD2E.Roll.TargetAC")}</label><input type="number" name="ac" value="${AD2EActor.#targetAc(targets, use === "missile")}" autofocus></div>`
        + maneuverField + ammoField + rangeField + wetField + moveField + backstabField + twoField + nonlethalField
        + (use === "melee" ? AD2EActor.#armedDefenderField() + this.#mountedMeleeField(targets) : "")
        + styleField + this.#dualField(this.system.dual?.thac0Option)
        + AD2EActor.#combatModFields(targets, use === "missile", PROVINCES.includes(item.system.element) ? item.system.element : "")
        + modifierFields()
        + this.#kitFields(kitOptions),
      ok: {
        label: i18n("AD2E.Roll.Roll"),
        callback: (event, button) => {
          const f = button.form.elements;
          const kit = AD2EActor.#kitPicked(button.form, kitOptions);
          const m = readModifier(button.form);
          return { ac: Number(f.ac.value) || 0, t51: AD2EActor.#combatModPicked(button.form), mod: m.mod + kit.sum, range: f.range?.value ?? null,
            ammo: f.ammo?.value ?? null, backstab: !!f.backstab?.checked, kitText: kit.text, manual: m, wet: !!f.wet?.checked,
            twoWeapon: f.twoWeapon?.value || "", mainWeapon: f.mainWeapon?.value ?? null, nonlethal: !!f.nonlethal?.checked,
            vsUnarmed: !!f.vsUnarmed?.checked, styleAttack: !!f.styleAttack?.checked,
            mountMove: f.mountMove?.value ?? null, ownMove: f.ownMove?.value ?? null, missileStyle,
            untrainedMount: !!f.untrainedMount?.checked, mountedMelee: use === "melee" ? AD2EActor.#mountedMeleePicked(f) : null,
            dualOld: !!f.dualOld?.checked, ...AD2EActor.#maneuverPicked(f) };
        }
      },
      rejectClose: false
    });
    if (!input) return;
    // Opposed maneuvers, pull/trip and shield attacks have their own resolution (module/attack-options.mjs).
    if (["disarm", "grab", "trap", "block", "pullTrip", "shieldPunch", "shieldRush"].includes(input.maneuver)) {
      return this.rollManeuver(input.maneuver, { item, attack, use, targets, ac: input.ac, mod: input.mod,
        thac0: this.system.thac0.value });
    }
    const ammo = input.ammo ? this.items.get(input.ammo) : null;
    if (ammoList && !ammo) return;
    // Dual-class: the earlier class's THAC0, or its backstab, while restricted (module/dual-class.mjs).
    const dualThac0 = input.dualOld ? (this.system.dual?.thac0Option ?? null) : null;
    input.thac0 = dualThac0 ?? this.system.thac0.value;
    if (dualThac0 !== null) await this.markOldClassUse(game.i18n.format("AD2E.Dual.WhatThac0", { n: dualThac0 }));
    if (input.backstab && this.system.classAbilities?.info?.old?.backstab) {
      await this.markOldClassUse(game.i18n.localize("AD2E.Ability2.BackstabAttack"));
    }
    // "Both": this weapon as the main weapon, then the other weapon as the second (one extra attack per round).
    const other = input.twoWeapon && input.mainWeapon ? this.items.get(input.mainWeapon) : null;
    const attacks = [{ item, entry, attack, hand: input.twoWeapon === "both" ? "main" : input.twoWeapon, main: other,
      nonlethal: input.nonlethal, backstab: input.backstab }];
    if (input.twoWeapon === "both" && other) {
      const otherEntry = this.#weaponEntry(other.id);
      if (otherEntry?.attack?.melee) attacks.push({ item: other, entry: otherEntry, attack: otherEntry.attack.melee, hand: "off",
        main: item, mainRolled: true, nonlethal: input.nonlethal && nonlethalAllowed(other.system.weapon), backstab: false,
        noBackstab: input.backstab });
    }
    const messages = [];
    for (const a of attacks) messages.push(await this.#weaponAttackMessage(a, { use, input, targets, ammo, ammoList, powder }));
    return attacks.length > 1 ? messages : messages[0];
  }

  /**
   * One weapon attack roll and its chat message (rollWeaponAttack): `a` = { item, entry, attack, hand ("main" | "off" |
   * ""), main (the other weapon: checked as the main weapon when `hand` is "off"), nonlethal, backstab }.
   */
  async #weaponAttackMessage(a, { use, input, targets, ammo, ammoList, powder = null }) {
    const { item, entry, attack } = a;
    const itemId = item.id;
    const i18n = key => game.i18n.localize(key);
    const status = entry.penalty ? ` [${game.i18n.format(entry.familiar ? "AD2E.SP.Familiar" : "AD2E.Weapon.NotProficient", { penalty: entry.penalty })}]`
      : (entry.mastery ? ` [${i18n("AD2E.SP.Mastery")}]` : (entry.specialized && !entry.specInvalid ? ` [${i18n("AD2E.Weapon.Specialized")}]`
        : (entry.expertise ? ` [${i18n("AD2E.SP.Expertise")}]` : "")))
      + (entry.choice ? ` [${i18n("AD2E.SP.Choice")}]` : "");
    const notes = [];
    let twoAdj = 0;
    const spStyles = this.type === "character" ? this.system.proficiencies?.sp?.styles ?? null : null;
    if (a.hand) {
      const sys = this.system;
      twoAdj = twoWeaponPenalty(a.hand, { reaction: sys.abilityData?.dex?.reaction ?? 0,
        ranger: twoWeaponExempt(sys), armorAc: sys.armor?.body?.system.ac ?? null,
        style: twoWeaponStyle(sys, spStyles?.twoWeapon ? { main: SP.twoWeapon.main, off: SP.twoWeapon.off } : null) });
      if (sys.traits?.ids?.includes("ambidexterity")) notes.push(i18n("AD2E.Trait.AmbidexterityNote"));
      if (spStyles?.twoWeapon) notes.push(i18n("AD2E.SP.TwoWeaponStyle"));
      notes.push(`${i18n(`AD2E.TwoWeapons.${a.hand}`)} ${twoAdj > 0 ? "+" : ""}${twoAdj}`);
      if (sys.armor?.shield) notes.push(i18n("AD2E.TwoWeapons.Shield"));
      // Each weapon must be usable in one hand (Weapons (PHB): a weapon one size larger needs two hands).
      const size = sys.sizeCategory ?? "M";
      for (const w of a.hand === "off" && a.main && !a.mainRolled ? [a.main, item] : [item]) {
        if (needsTwoHands(w.system.weapon, size)) notes.push(game.i18n.format("AD2E.TwoWeapons.NeedsTwoHands",
          { name: w.name, weapon: w.system.weapon.size, size }));
      }
      const main = a.hand === "off" ? a.main : null;
      if (main && !secondWeaponAllowed(
        { proficiency: main.system.proficiency, size: main.system.weapon.size, weight: main.system.weight },
        { proficiency: item.system.proficiency, size: item.system.weapon?.size, weight: item.system.weight ?? null },
        { equalSize: !!spStyles?.twoWeaponImproved })) {
        notes.push(game.i18n.format("AD2E.TwoWeapons.TooLarge", { main: main.name }));
      }
    }
    if (a.nonlethal) notes.push(`${i18n("AD2E.Nonlethal.Weapon")} ${COMBAT_TABLES.nonlethal.hit}`);
    if (a.noBackstab) notes.push(i18n("AD2E.TwoWeapons.NoBackstab"));
    const vsUnarmed = input.vsUnarmed ? COMBAT_TABLES.armedDefender : 0;
    if (vsUnarmed) notes.push(game.i18n.format("AD2E.Unarmed.VsUnarmedShort", { bonus: vsUnarmed }));
    const t51 = input.t51 ?? { sum: 0, auto: false, text: "" };
    if (t51.text) notes.push(t51.text);
    // PHB Table 52 (optional, module/armor-types.mjs): the weapon's (or missile's) best type against the target's armour.
    const t52 = table52ForTarget(ammo?.system.type || item.system.weapon?.type, AD2EActor.#targetActor(targets));
    if (t52) notes.push(table52Text(t52));
    const maneuverHit = this.#maneuverModifier(input, targets, notes);
    // A bow made for exceptional Strength, used without it: bend bars/lift gates roll to string or use it (Weapons (PHB)).
    if (use === "missile" && attack.bowBendBars !== null && attack.bowBendBars !== undefined) {
      notes.push(game.i18n.format("AD2E.Weapon.BowBendBars", { rating: attack.bowStrength, chance: attack.bowBendBars }));
    }
    // Mounted missile fire (DMG Table 53 / horse archery) and the missile style's movement note.
    const mountMod = use === "missile" && input.mountMove ? mountedMissileModifier(input.mountMove, COMBAT_TABLES.mountedMissile,
      !!this.system.proficiencies?.sp?.styles?.horseArchery) : 0;
    // Rate of fire: one step down from a moving mount (owner's ruling), half after a full move with the missile style.
    let rate = use === "missile" ? parseRate(attack.rate) : null;
    const rateFrom = rate;
    if (use === "missile" && input.mountMove) {
      notes.push(`${i18n(`AD2E.Mounted.Move.${input.mountMove}`)} ${mountMod >= 0 ? "+" : ""}${mountMod}`);
      if (input.mountMove !== "still") {
        if (rate) rate = stepDownRate(rate);
        // DMG: horsemanship needed; only short bows, composite short bows and light crossbows (long bows: specialists;
        // a heavy crossbow once, not reloaded).
        const issues = mountedFireIssues({ weapon: item.system.proficiency ?? item.system.identifier, specialized: !!entry.specialized,
          proficiencies: this.items.filter(i => i.type === "proficiency").map(i => i.system.identifier) });
        for (const k of issues) notes.push(`⚠ ${i18n(`AD2E.Mounted.Issue.${k}`)}`);
      }
    }
    if (use === "missile" && input.missileStyle && input.ownMove && input.ownMove !== "none") {
      notes.push(i18n(`AD2E.SP.OwnMoveNote.${input.ownMove}`));
      if (input.ownMove === "full" && rate) rate = halveRate(rate);
    }
    if (rate && rateFrom && (rate[0] !== rateFrom[0] || rate[1] !== rateFrom[1])) {
      notes.push(game.i18n.format("AD2E.Mounted.Rate", { from: attack.rate, to: rate[1] === 1 ? `${rate[0]}` : `${rate[0]}/${rate[1]}` }));
    }
    const untrained = input.untrainedMount ? COMBAT_TABLES.mounted.untrained : 0;
    if (untrained) notes.push(`${i18n("AD2E.Mounted.UntrainedShort")} ${untrained}`);
    const mountedMelee = input.mountedMelee?.value ?? 0;
    if (input.mountedMelee?.text) notes.push(input.mountedMelee.text);
    const styleHit = input.styleAttack && !a.hand ? SP.weaponShield.hit : 0;
    if (styleHit) notes.push(game.i18n.format("AD2E.SP.WeaponShieldNote", { n: styleHit }));
    // Skills & Powers mastery at point blank: +3 in place of the +2 at other ranges.
    const pbHit = input.range === "pointBlank" ? (attack.pointBlankHit ?? 0) : 0;
    // Hand match firearms: "All range penalties ... are doubled" (Combat & Tactics footnote 5).
    const rangeBase = input.range ? AD2E.rangeModifiers[input.range] : 0;
    const rangeDouble = rangeBase < 0 && (item.system.weapon?.rules ?? []).includes("rangeDouble");
    if (rangeDouble) notes.push(game.i18n.localize("AD2E.Firearm.RangeDoubled"));
    const rangeMod = (rangeDouble ? rangeBase * 2 : rangeBase) + pbHit;
    const needed = (input.thac0 ?? this.system.thac0.value) - input.ac;
    // Backstab: +4 for the rear attack (Thief Skill Explanations (PHB)); shield and Dexterity bonuses of the
    // target are ignored, which the target AC entered should reflect.
    const adj = attack.hit + (ammo?.system.bonus.hit ?? 0) + (a.backstab ? AD2E.backstabHit : 0)
      + twoAdj + (a.nonlethal ? COMBAT_TABLES.nonlethal.hit : 0) + vsUnarmed + t51.sum + styleHit + mountMod + untrained + mountedMelee
      + (t52?.mod ?? 0) + maneuverHit;
    const roll = await new Roll("1d20 + @adj + @range + @mod", { adj, range: rangeMod, mod: input.mod }).evaluate();
    // Defender sleeping or held: "the attack automatically hits" (Table 51).
    // A misfire (Combat & Tactics footnotes 3, 5, 7, 9): a natural roll at or below the weapon's number (wet if ticked).
    const mf = use === "missile" ? item.system.weapon?.misfire ?? {} : {};
    const misfireAt = input.wet && mf.wet ? mf.wet : mf.dry;
    const natural = roll.dice?.[0]?.total ?? null;
    const misfire = !!misfireAt && natural !== null && natural <= misfireAt;
    if (misfire) notes.push(game.i18n.format("AD2E.Firearm.Misfire", { n: natural, at: misfireAt }));
    const hit = !misfire && (t51.auto || roll.total >= needed);
    // Critical hit (Combat & Tactics, world setting "criticalHits"; module/criticals.mjs): a natural 18+ hitting by 5 or more.
    let crit = null;
    if (hit && criticalMode() !== "off" && isCritical(natural, roll.total, needed)) {
      crit = await rollCritical({ typeText: t52?.type || ammo?.system.type || item.system.weapon?.type, attackerSize: sizeOfActor(this),
        weaponSize: weaponCritSize(item, sizeOfActor(this)), target: AD2EActor.#targetActor(targets), calledLocation: input.calledLocation ?? "" });
      notes.push(criticalText(crit));
    }
    AD2EActor.#rememberCrit(this, itemId, crit);
    AD2EActor.#lastSap.set(`${this.uuid ?? this.id}.${itemId}`, input.maneuver === "sap" ? { helpless: !!input.sapHelpless } : null);
    // Use up the piece fired or thrown.
    let spent = "";
    if (powder) {
      await powder.update({ "system.quantity": Math.max(powder.system.quantity - 1, 0) });
      spent += ` — ${game.i18n.format("AD2E.Ammo.Left", { name: powder.name, n: Math.max(powder.system.quantity, 0) })}`;
    }
    if (ammo) {
      const left = Math.max(ammo.system.quantity - 1, 0);
      await ammo.update({ "system.quantity": left });
      AD2EActor.#lastAmmo.set(`${this.id}.${itemId}`, ammo.id);
      spent += ` — ${game.i18n.format("AD2E.Ammo.Left", { name: ammo.name, n: left })}`;
    } else if (this.#isThrownItem(item, use)) {
      const left = Math.max(item.system.quantity - 1, 0);
      await item.update({ "system.quantity": left });
      spent += ` — ${game.i18n.format("AD2E.Ammo.Left", { name: item.name, n: left })}`;
    }
    const message = await roll.toMessage({
      speaker: ChatMessage.getSpeaker({ actor: this }),
      flavor: `${item.name}${ammo ? ` (${ammo.name})` : ""} (${i18n(`AD2E.Weapon.${use}`)}${input.range ? `, ${i18n(`AD2E.Weapon.${input.range === "pointBlank" ? "PointBlank" : input.range[0].toUpperCase() + input.range.slice(1)}`)}` : ""}) `
        + `vs AC ${input.ac}${AD2EActor.#targetText(targets)} (THAC0 ${input.thac0 ?? this.system.thac0.value}, ${i18n("AD2E.Roll.Needs")} ${needed}+): `
        + i18n(hit ? "AD2E.Roll.Hit" : "AD2E.Roll.Miss") + status + spent
        + (a.backstab ? ` [${i18n("AD2E.Ability2.BackstabAttack")}]` : "")
        + (notes.length ? ` [${notes.join("; ")}]` : "")
        + (input.kitText ? ` [${input.kitText}]` : "") + modifierText(input.manual?.mod, input.manual?.note)
    });
    if (crit) await postCriticalCard(this, crit, targets);
    // A missile or thrown style specialist shooting this round: +1 AC against missiles (attackers' dialogs, below).
    if (use === "missile" && input.missileStyle) await this.#markShotThisRound();
    // A hit rolls its damage at once (client setting "autoDamage"), with the attack's choices: the ammunition fired,
    // backstab, non-lethal, the armed-defender bonus, and the first target's size.
    if (hit && AD2EActor.#autoDamageOn()) {
      await this.rollWeaponDamage(itemId, use, { size: AD2EActor.#targetSizeKey(targets), backstab: !!a.backstab,
        nonlethal: !!a.nonlethal, vsUnarmed: !!input.vsUnarmed, pointBlank: input.range === "pointBlank", critical: crit,
        sap: input.maneuver === "sap" ? { helpless: !!input.sapHelpless } : null });
    }
    return message;
  }

  /* ---------------------------------------- Attack options (module/attack-options.mjs) */

  /** The sap of the last attack per actor and weapon (the damage roll uses it once). */
  static #lastSap = new Map();

  /** Maneuver fields for attack dialogs: the maneuver, a called shot's penalty and location, sap helmet / helpless ticks. */
  #maneuverField(maneuvers, targets, typeText) {
    const i18n = k => game.i18n.localize(k);
    const esc = v => foundry.utils.escapeHTML?.(String(v ?? "")) ?? String(v ?? "");
    const target = AD2EActor.#targetActor(targets);
    const helmet = !!target?.items?.some?.(i => i.type === "armor" && i.system?.equipped && i.system?.kind === "helmet");
    const crit = criticalMode() === "system2" ? chartKey(typeText, targetKind(target)) : null;
    const locs = crit ? [...new Set(CRIT.charts[crit].locations.map(l => l.label))] : [];
    const statuses = new Set(target?.statuses ?? []);
    const helpless = ["sleep", "paralysis", "restrain", "unconscious"].some(s => statuses.has(s));
    const opt = (v, label, sel = false) => `<option value="${esc(v)}"${sel ? " selected" : ""}>${esc(label)}</option>`;
    return `<fieldset><legend>${esc(i18n("AD2E.Maneuver.Legend"))}</legend>`
      + `<div class="form-group"><label>${esc(i18n("AD2E.Maneuver.Label"))}</label><select name="maneuver">${maneuvers.map(m => opt(m, i18n(`AD2E.Maneuver.Kind.${m}`))).join("")}</select></div>`
      + `<div class="form-group"><label>${esc(game.i18n.format("AD2E.Maneuver.CalledPenalty", { init: AO.calledShot.init }))}</label><select name="calledPenalty">`
      + [AO.calledShot.hit, ...AO.calledShot.harder].map(n => opt(n, String(n))).join("") + "</select></div>"
      + (locs.length ? `<div class="form-group"><label>${esc(i18n("AD2E.Maneuver.Location"))}</label><select name="calledLocation">${opt("", "—")}${locs.map(l => opt(l, l)).join("")}</select></div>` : "")
      + (maneuvers.includes("sap") ? `<div class="form-group"><label>${esc(game.i18n.format("AD2E.Maneuver.SapHelmet", { n: AO.sap.helmet }))}</label><input type="checkbox" name="sapHelmet"${helmet ? " checked" : ""}></div>`
        + `<div class="form-group"><label>${esc(i18n("AD2E.Maneuver.SapHelpless"))}</label><input type="checkbox" name="sapHelpless"${helpless ? " checked" : ""}></div>` : "")
      + `<p class="ad2e-note">${esc(i18n("AD2E.Maneuver.Hint"))}</p></fieldset>`;
  }

  static #maneuverPicked(f) {
    return { maneuver: f.maneuver?.value ?? "normal", calledPenalty: Number(f.calledPenalty?.value ?? AO.calledShot.hit) || AO.calledShot.hit,
      calledLocation: f.maneuver?.value === "calledShot" ? (f.calledLocation?.value ?? "") : "",
      sapHelmet: !!f.sapHelmet?.checked, sapHelpless: !!f.sapHelpless?.checked };
  }

  /** Attack roll modifier of a called shot or sap (notes added for chat). */
  #maneuverModifier(input, targets, notes) {
    const i18n = (k, d) => (d ? game.i18n.format(k, d) : game.i18n.localize(k));
    if (input.maneuver === "calledShot") {
      notes.push(i18n("AD2E.Maneuver.CalledNote", { n: input.calledPenalty, init: AO.calledShot.init })
        + (input.calledLocation ? ` (${input.calledLocation})` : ""));
      return input.calledPenalty;
    }
    if (input.maneuver === "sap") {
      const n = input.sapHelmet ? AO.sap.helmet : AO.sap.hit;
      notes.push(i18n("AD2E.Maneuver.SapNote", { n }));
      const target = AD2EActor.#targetActor(targets);
      if (target && !AO.sap.sizes.includes(AD2EActor.#sizeOf(target))) notes.push(`⚠ ${i18n("AD2E.Maneuver.SapTooBig")}`);
      return n;
    }
    return 0;
  }

  /** Sap knockout: 5% per point of damage (10% against a helpless victim), unconscious 3d10 rounds. */
  async #sapKnockout(damage, sap, targets) {
    const chance = sapChance(damage, sap.helpless);
    const roll = await new Roll("1d100").evaluate();
    const out = roll.total <= chance;
    const rounds = out ? await new Roll(AO.sap.rounds).evaluate() : null;
    return ChatMessage.create({ speaker: ChatMessage.getSpeaker({ actor: this }), rolls: [roll, rounds].filter(Boolean),
      content: `<p>${foundry.utils.escapeHTML?.(game.i18n.format(out ? "AD2E.Maneuver.SapOut" : "AD2E.Maneuver.SapAwake",
        { chance, roll: roll.total, rounds: rounds?.total ?? 0, name: targets?.[0]?.name ?? "—" })) ?? ""}</p>` });
  }

  /**
   * Opposed maneuvers (disarm, grab, trap, block), pull/trip and shield attacks: a dialog with the defender's numbers
   * (from the first target, editable), then the rolls (the defender's rolled automatically: owner's ruling) and a chat card.
   * `attack` = { hit } adjustment; `thac0`; `item` the weapon used.
   */
  async rollManeuver(kind, { item = null, attack = { hit: 0 }, use = "melee", targets = [], ac = 10, mod = 0, thac0 = 20 } = {}) {
    const i18n = (k, d) => (d ? game.i18n.format(k, d) : game.i18n.localize(k));
    const esc = v => foundry.utils.escapeHTML?.(String(v ?? "")) ?? String(v ?? "");
    const def = AD2EActor.#targetActor(targets);
    const ds = def?.system ?? {};
    const mon = def?.type === "monster" ? monsterScores(ds.size, ds.hitDice, ds.movement?.base) : null;
    const dSize = def ? AD2EActor.#sizeOf(def) : "M";
    const size = AD2EActor.#sizeOf(this);
    const defWeapon = def?.items?.find?.(i => i.type === "weapon" && (def.type !== "character" || i.system?.equipped) && i.system?.weapon?.melee);
    const twoH = (w, s) => !!w && needsTwoHands(w.system.weapon, s);
    const field = (label, html) => `<div class="form-group"><label>${esc(label)}</label>${html}</div>`;
    const num = (name, v) => `<input type="number" name="${name}" value="${v}">`;
    const box = (name, label, on = false) => field(label, `<input type="checkbox" name="${name}"${on ? " checked" : ""}>`);
    const sizes = ["T", "S", "M", "L", "H", "G"];
    const sizeSel = (name, v) => `<select name="${name}">${sizes.map(s => `<option value="${s}"${s === v ? " selected" : ""}>${s}</option>`).join("")}</select>`;
    const dStr = mon ? mon.str : (ds.abilities?.str?.total ?? 10);
    const dDex = mon ? mon.dex : (ds.abilities?.dex?.total ?? 10);
    let content = `<p class="ad2e-note">${esc(i18n(`AD2E.Maneuver.Help.${kind}`))}</p>`
      + `<fieldset><legend>${esc(i18n("AD2E.Lasso.Defender", { name: def?.name ?? i18n("AD2E.Lasso.NoTarget") }))}</legend>`;
    if (OPPOSED.includes(kind)) {
      content += field(i18n("AD2E.Lasso.DefThac0"), num("dThac0", ds.thac0?.value ?? 20));
      if (kind === "block") content += field(i18n("AD2E.Maneuver.YourAc"), num("myAc", this.system.ac?.total ?? this.system.ac?.value ?? 10));
      else {
        content += box("aTwo", i18n("AD2E.Maneuver.YouTwoHanded"), twoH(item, size)) + box("dTwo", i18n("AD2E.Maneuver.DefTwoHanded"), twoH(defWeapon, dSize));
        if (kind === "disarm") content += field(i18n("AD2E.Maneuver.DefWeaponSize"), sizeSel("dWeaponSize", defWeapon?.system?.weapon?.size || dSize));
        if (kind === "grab") content += field(i18n("AD2E.Lasso.DefStr"), num("dStr", dStr)) + box("aOne", i18n("AD2E.Maneuver.YouOneHand"), true)
          + box("dOne", i18n("AD2E.Maneuver.DefOneHand"), true);
      }
    } else if (kind === "pullTrip" || kind === "shieldRush") {
      content += field(i18n("AD2E.Lasso.DefStr"), num("dStr", dStr)) + (kind === "pullTrip" ? field(i18n("AD2E.Lasso.DefDex"), num("dDex", dDex)) : "")
        + field(i18n("AD2E.Lasso.DefSize"), sizeSel("dSize", sizes.includes(dSize) ? dSize : "M"))
        + box("fourLegs", i18n("AD2E.Lasso.FourLegs", { n: kind === "pullTrip" ? LASSO.pullTrip.fourLegs : AO.shieldRush.fourLegs }))
        + box("unaware", i18n("AD2E.Lasso.Unaware", { n: kind === "pullTrip" ? LASSO.pullTrip.unaware : AO.shieldRush.unaware }))
        + (kind === "pullTrip" ? box("stationary", i18n("AD2E.Lasso.Stationary", { n: LASSO.pullTrip.stationary })) : "");
    }
    content += "</fieldset>";
    if (kind === "shieldPunch") content += field(i18n("AD2E.Maneuver.PunchMode"), `<select name="punchMode"><option value="substitute">${esc(i18n("AD2E.Maneuver.PunchSubstitute"))}</option>`
      + `<option value="extra">${esc(i18n("AD2E.Maneuver.PunchExtra", { punch: AO.shieldPunch.punch, primary: AO.shieldPunch.primary }))}</option></select>`);
    const input = await ad2eDialog.prompt({
      window: { title: `${this.name}: ${i18n(`AD2E.Maneuver.Kind.${kind}`)}` }, content,
      ok: { label: i18n("AD2E.Roll.Roll"), callback: (event, button) => {
        const el = button.form.elements;
        const n = k => Number(el[k]?.value) || 0;
        return { dThac0: n("dThac0") || 20, myAc: n("myAc"), aTwo: !!el.aTwo?.checked, dTwo: !!el.dTwo?.checked, dWeaponSize: el.dWeaponSize?.value ?? "M",
          dStr: n("dStr"), dDex: n("dDex"), aOne: !!el.aOne?.checked, dOne: !!el.dOne?.checked, dSize: el.dSize?.value ?? "M",
          fourLegs: !!el.fourLegs?.checked, unaware: !!el.unaware?.checked, stationary: !!el.stationary?.checked, punchMode: el.punchMode?.value ?? "substitute" };
      } },
      rejectClose: false
    });
    if (!input) return null;
    const rolls = [], lines = [];
    const d20 = async () => { const r = await new Roll("1d20").evaluate(); rolls.push(r); return r.total; };
    const signed = v => `${v >= 0 ? "+" : ""}${v}`;
    const myStr = this.type === "character" ? this.system.abilities.str.total : (monsterScores(this.system.size, this.system.hitDice, this.system.movement?.base).str);
    const myDex = this.type === "character" ? this.system.abilities.dex.total : (monsterScores(this.system.size, this.system.hitDice, this.system.movement?.base).dex);
    const oppStr = async (aScore, dScore) => {
      const ar = await d20(), dr = await d20();
      lines.push(i18n("AD2E.Lasso.StrLine", { a: aScore, ar, d: dScore, dr }));
      return { res: opposedCheck(aScore, ar, dScore, dr), ar, dr };
    };
    let damage = null;
    if (OPPOSED.includes(kind)) {
      if (kind === "disarm" && !disarmPossible(item?.system?.weapon?.size || size, input.dWeaponSize)) {
        return ChatMessage.create({ speaker: ChatMessage.getSpeaker({ actor: this }), content: `<p>${esc(i18n("AD2E.Maneuver.DisarmTooBig"))}</p>` });
      }
      const acs = opposedAcs(kind, { attackerTwoHanded: input.aTwo, defenderTwoHanded: input.dTwo, blockerAc: input.myAc });
      const adj = (attack.hit ?? 0) + mod;
      const aNeed = thac0 - acs.attackerAc - adj;
      const dNeed = input.dThac0 - acs.defenderAc;
      const ar = await d20(), dr = await d20();
      const res = opposedAttack(aNeed, ar, dNeed, dr);
      lines.push(i18n("AD2E.Maneuver.OpposedLine", { you: ar, youNeed: aNeed, youAc: acs.attackerAc, adj: signed(adj), them: dr, themNeed: dNeed, themAc: acs.defenderAc }));
      lines.push(i18n(`AD2E.Maneuver.Result.${kind}.${res.result}`));
      if (kind === "disarm" && res.result === "attacker") {
        const feet = await new Roll(AO.disarm.falls).evaluate(), dir = await new Roll("1d8").evaluate();
        rolls.push(feet, dir);
        lines.push(i18n("AD2E.Maneuver.DisarmFalls", { feet: feet.total, dir: i18n(`AD2E.Maneuver.Dir.${dir.total}`) }));
      }
      if (kind === "grab" && res.result === "attacker") {
        const r = await oppStr(myStr + (input.aOne ? AO.grab.oneHand : 0), input.dStr + (input.dOne ? AO.grab.oneHand : 0));
        lines.push(i18n(`AD2E.Maneuver.GrabStr.${r.res}`));
      }
    } else if (kind === "pullTrip" || kind === "shieldPunch" || kind === "shieldRush") {
      const shield = shieldOf(this.items);
      const extra = kind === "shieldPunch" && input.punchMode === "extra";
      const adj = kind === "pullTrip" ? (attack.hit ?? 0) + mod : (this.system.mods?.meleeAttack ?? 0) + mod + (extra ? AO.shieldPunch.punch : 0);
      const need = thac0 - ac;
      const r = await d20();
      const hit = r + adj >= need;
      lines.push(i18n("AD2E.Lasso.AttackLine", { roll: r, adj: signed(adj), total: r + adj, ac, need, result: i18n(hit ? "AD2E.Roll.Hit" : "AD2E.Roll.Miss") }));
      if (extra) lines.push(i18n("AD2E.Maneuver.PunchPrimaryNote", { n: AO.shieldPunch.primary }));
      if (kind === "pullTrip" && hit) {
        const pt = pullTripScore(myStr, { attackerSize: size, defenderSize: input.dSize, lasso: false, fourLegs: input.fourLegs,
          unaware: input.unaware, stationary: input.stationary });
        const o = await oppStr(pt.score, Math.max(input.dStr, input.dDex));
        lines.push(i18n(`AD2E.Lasso.Trip.${o.res}`));
      }
      if ((kind === "shieldPunch" || kind === "shieldRush") && shield) {
        const table = kind === "shieldPunch" ? AO.shieldPunch.shields[shield.id] : AO.shieldRush.shields[shield.id];
        if (hit) {
          damage = await new Roll(`${table.damage} + @str`, { str: this.system.mods?.dmg ?? 0 }).evaluate();
          if (kind === "shieldPunch") {
            const kd = await new Roll(`1${table.knockdown}`).evaluate();
            rolls.push(kd);
            lines.push(i18n("AD2E.Maneuver.KnockdownDie", { die: table.knockdown, n: kd.total }));
          } else {
            const aScore = rushScore(myStr, { attackerSize: size, defenderSize: input.dSize, unaware: input.unaware, fourLegs: input.fourLegs });
            const ar = await d20(), dr = await d20();
            const aOk = ar <= aScore, dOk = dr <= input.dStr;
            const aTotal = aOk ? ar + table.knockdown : ar;
            const res = !aOk && !dOk ? "bothFail" : aOk && !dOk ? "attacker" : !aOk ? "defender" : aTotal > dr ? "attacker" : aTotal < dr ? "defender" : "tie";
            lines.push(i18n("AD2E.Maneuver.RushStr", { a: aScore, ar, bonus: signed(table.knockdown), d: input.dStr, dr }));
            lines.push(i18n(`AD2E.Maneuver.Rush.${res}`));
          }
        } else if (kind === "shieldRush") {
          const dx = await d20();
          lines.push(i18n(dx <= myDex ? "AD2E.Maneuver.RushStay" : "AD2E.Maneuver.RushFall", { roll: dx, dex: myDex }));
        }
      }
    }
    const message = await ChatMessage.create({ speaker: ChatMessage.getSpeaker({ actor: this }), rolls,
      content: `<p><strong>${esc(i18n(`AD2E.Maneuver.Kind.${kind}`))}</strong>${item ? ` (${esc(item.name)})` : ""}${AD2EActor.#targetText(targets)}</p>`
        + `<ul>${lines.map(l => `<li>${esc(l)}</li>`).join("")}</ul>` });
    if (damage) {
      const total = Math.max(damage.total, 1);
      await damage.toMessage({ speaker: ChatMessage.getSpeaker({ actor: this }), flags: { ad2e: { damage: total, targets } },
        flavor: `${i18n(`AD2E.Maneuver.Kind.${kind}`)} ${i18n("AD2E.Weapon.Damage")}${AD2EActor.#targetText(targets)}` });
    }
    return message;
  }

  /** The last attack's critical hit per actor and weapon/attack key (the damage roll uses it once). */
  static #lastCrit = new Map();

  static #rememberCrit(actor, key, crit) {
    const k = `${actor.uuid ?? actor.id}.${key}`;
    if (crit) AD2EActor.#lastCrit.set(k, crit); else AD2EActor.#lastCrit.delete(k);
  }

  /** The critical to apply to a damage roll (preset, else the last attack's), forgotten once used. */
  static #takeCrit(actor, key, preset) {
    const k = `${actor.uuid ?? actor.id}.${key}`;
    const crit = preset?.critical ?? AD2EActor.#lastCrit.get(k) ?? null;
    AD2EActor.#lastCrit.delete(k);
    return crit;
  }

  /** Critical hit select for damage dialogs (shown when critical hits are on). */
  static #critField(crit) {
    if (criticalMode() === "off") return "";
    const v = crit ? crit.extra : 0;
    const opt = (n, k) => `<option value="${n}"${n === v ? " selected" : ""}>${game.i18n.localize(`AD2E.Critical.Damage.${k}`)}</option>`;
    return `<div class="form-group"><label>${game.i18n.localize("AD2E.Critical.DamageLabel")}</label><select name="critical">${opt(0, "none")}${opt(1, "double")}${opt(2, "triple")}</select></div>`;
  }

  /** Client setting "autoDamage" (default on): roll damage automatically when an attack hits. */
  static #autoDamageOn() {
    try { return game.settings.get("ad2e", "autoDamage") === true; } catch { return false; }
  }

  /** Damage column for the first target: "l" for a Large or bigger creature, otherwise "sm" (also with no target). */
  static #targetSizeKey(targets) {
    const resolve = foundry.utils.fromUuidSync ?? globalThis.fromUuidSync;
    const actor = targets?.length ? resolve?.(targets[0].uuid, { strict: false })?.actor : null;
    return actor && ["L", "H", "G"].includes(AD2EActor.#sizeOf(actor)) ? "l" : "sm";
  }

  /** Thieves: the Table 30 backstab multiplier at their level; null for other classes. */
  #backstabMultiplier() {
    return this.type === "character" ? (this.system.classAbilities?.info?.backstab ?? null) : null;
  }

  /** Last ammunition fired per actor and launcher (default choice for the next shot and its damage roll). */
  static #lastAmmo = new Map();

  /**
   * Put a weapon away (`drop` false: sheathed or stowed, still carried) or drop it (`drop` true: no longer counted
   * toward encumbrance until picked up), with a line in chat.
   */
  async stowWeapon(itemId, { drop = false } = {}) {
    const item = this.items.get(itemId);
    if (item?.type !== "weapon") return;
    await item.update({ "system.equipped": false, "system.dropped": !!drop });
    return ChatMessage.create({ speaker: ChatMessage.getSpeaker({ actor: this }), content: `<p>${foundry.utils.escapeHTML?.(
      game.i18n.format(drop ? "AD2E.Weapon.DropChat" : "AD2E.Weapon.StowChat", { name: this.name, weapon: item.name })) ?? ""}</p>` });
  }

  /* ---------------------------------------- Targets (applying damage from chat: module/health.mjs) */

  /**
   * Lasso (module/lasso.mjs, Weapon Descriptions and Attack Options (POCT)): a called shot at the legs (pull/trip), the
   * arms (trap) or a rider (unhorse), or a pull/trip by spurring the mount; the opposed rolls are made here with the
   * first target's numbers (editable).
   */
  async rollLasso(itemId) {
    const item = this.items.get(itemId);
    const entry = this.#weaponEntry(itemId);
    const attack = entry?.attack?.missile ?? entry?.attack?.melee;
    if (!item || !attack) return null;
    const i18n = k => game.i18n.localize(k);
    const esc = v => foundry.utils.escapeHTML?.(String(v ?? "")) ?? String(v ?? "");
    const targets = AD2EActor.#targetsNow();
    const resolve = uuid => (foundry.utils.fromUuidSync ?? globalThis.fromUuidSync)?.(uuid, { strict: false }) ?? null;
    const tdoc = targets[0] ? resolve(targets[0].uuid) : null;
    const def = tdoc?.actor ?? (tdoc?.documentName === "Actor" ? tdoc : null);
    const ds = def?.system ?? {};
    const mon = def?.type === "monster" ? monsterScores(ds.size, ds.hitDice, ds.movement?.base) : null;
    const dSize = def?.type === "monster" ? (String(ds.size ?? "").trim().charAt(0).toUpperCase() || "M") : (ds.sizeCategory ?? "M");
    const defaults = { str: mon ? mon.str : (ds.abilities?.str?.total ?? 10), dex: mon ? mon.dex : (ds.abilities?.dex?.total ?? 10),
      thac0: ds.thac0?.value ?? 20, size: LASSO.sizes.includes(dSize) ? dSize : "M" };
    const mount = this.system.animals?.riding ? resolve(this.system.animals.riding) : null;
    const mountSize = String(mount?.system?.size ?? "").trim().charAt(0).toUpperCase();
    const field = (label, html) => `<div class="form-group"><label>${esc(label)}</label>${html}</div>`;
    const box = (name, label, checked = false) => `<div class="form-group"><label>${esc(label)}</label><input type="checkbox" name="${name}"${checked ? " checked" : ""}></div>`;
    const sizeSelect = (name, value) => `<select name="${name}">${LASSO.sizes.map(s => `<option value="${s}"${s === value ? " selected" : ""}>${s}</option>`).join("")}</select>`;
    const content = `<p class="ad2e-note">${esc(i18n("AD2E.Lasso.Hint"))}</p>`
      + field(i18n("AD2E.Lasso.Mode"), `<select name="mode">${["legs", "arms", "unhorse", "spur"].map(m => `<option value="${m}">${esc(i18n(`AD2E.Lasso.Modes.${m}`))}</option>`).join("")}</select>`)
      + field(game.i18n.format("AD2E.Lasso.CalledShot", { n: LASSO.calledShot, init: LASSO.calledShotInit }), `<input type="number" name="called" value="${LASSO.calledShot}">`)
      + field(i18n("AD2E.Roll.TargetAC"), `<input type="number" name="ac" value="${AD2EActor.#targetAc(targets, true)}">`)
      + field(i18n("AD2E.Lasso.Range"), `<select name="range">${["short", "medium", "long"].map(r => `<option value="${r}">${esc(i18n(`AD2E.Weapon.${r[0].toUpperCase()}${r.slice(1)}`))}</option>`).join("")}</select>`)
      + `<fieldset><legend>${esc(game.i18n.format("AD2E.Lasso.Defender", { name: def?.name ?? i18n("AD2E.Lasso.NoTarget") }))}</legend>`
      + field(i18n("AD2E.Lasso.DefStr"), `<input type="number" name="dStr" value="${defaults.str}">`)
      + field(i18n("AD2E.Lasso.DefDex"), `<input type="number" name="dDex" value="${defaults.dex}">`)
      + field(i18n("AD2E.Lasso.DefThac0"), `<input type="number" name="dThac0" value="${defaults.thac0}">`)
      + field(i18n("AD2E.Lasso.DefSize"), sizeSelect("dSize", defaults.size))
      + box("fourLegs", game.i18n.format("AD2E.Lasso.FourLegs", { n: LASSO.pullTrip.fourLegs }))
      + box("unaware", game.i18n.format("AD2E.Lasso.Unaware", { n: LASSO.pullTrip.unaware }))
      + box("stationary", game.i18n.format("AD2E.Lasso.Stationary", { n: LASSO.pullTrip.stationary }))
      + box("riderMoving", i18n("AD2E.Lasso.RiderMoving")) + box("tiedSolid", i18n("AD2E.Lasso.TiedSolid")) + `</fieldset>`
      + (mount ? box("tiedSaddle", game.i18n.format("AD2E.Lasso.TiedSaddle", { mount: mount.name, size: mountSize || "?" }), true) : "")
      + modifierFields();
    const input = await ad2eDialog.prompt({
      window: { title: `${this.name}: ${item.name}` }, content,
      ok: { label: i18n("AD2E.Roll.Roll"), callback: (event, button) => {
        const el = button.form.elements;
        const num = n => Number(el[n]?.value) || 0;
        return { mode: el.mode.value, called: num("called"), ac: num("ac"), range: el.range.value, dStr: num("dStr"), dDex: num("dDex"),
          dThac0: num("dThac0"), dSize: el.dSize.value, fourLegs: !!el.fourLegs?.checked, unaware: !!el.unaware?.checked,
          stationary: !!el.stationary?.checked, riderMoving: !!el.riderMoving?.checked, tiedSolid: !!el.tiedSolid?.checked,
          tiedSaddle: !!el.tiedSaddle?.checked, ...readModifier(button.form) };
      } },
      rejectClose: false
    });
    if (!input) return null;
    const rolls = [];
    const lines = [];
    const d20 = async () => { const r = await new Roll("1d20").evaluate(); rolls.push(r); return r.total; };
    const thac0 = this.system.thac0.value;
    const adj = attack.hit + (AD2E.rangeModifiers[input.range] ?? 0) + input.called + input.mod;
    const fmtAdj = n => `${n >= 0 ? "+" : ""}${n}`;
    // The called shot attack roll (not for a pull/trip by spurring, nor for the arms' opposed roll).
    let hit = input.mode === "spur";
    if (input.mode === "legs" || input.mode === "unhorse") {
      const r = await d20();
      const need = thac0 - input.ac;
      hit = r + adj >= need;
      lines.push(game.i18n.format("AD2E.Lasso.AttackLine", { roll: r, adj: fmtAdj(adj), total: r + adj, ac: input.ac, need,
        result: i18n(hit ? "AD2E.Roll.Hit" : "AD2E.Roll.Miss") }));
    }
    const aStr = this.system.abilities.str.total;
    const oppStr = async (aScore, dScore) => {
      const ar = await d20(), dr = await d20();
      const res = opposedCheck(aScore, ar, dScore, dr);
      lines.push(game.i18n.format("AD2E.Lasso.StrLine", { a: aScore, ar, d: dScore, dr }));
      return res;
    };
    if ((input.mode === "legs" || input.mode === "spur") && hit) {
      const own = this.system.sizeCategory ?? "M";
      const size = input.tiedSaddle && mountSize ? mountSize : own;
      const pt = pullTripScore(aStr, { attackerSize: size, defenderSize: input.dSize, lasso: true, fourLegs: input.fourLegs,
        unaware: input.unaware, stationary: input.stationary });
      lines.push(game.i18n.format("AD2E.Lasso.StrParts", { str: aStr, parts: pt.parts.map(([k, v]) => `${i18n(`AD2E.Lasso.Part.${k}`)} ${fmtAdj(v)}`).join(", ") || "—",
        score: pt.score, def: Math.max(input.dStr, input.dDex) }));
      const res = await oppStr(pt.score, Math.max(input.dStr, input.dDex));
      lines.push(i18n(`AD2E.Lasso.Trip.${res}`));
    } else if (input.mode === "arms") {
      const aNeed = thac0 - LASSO.armsAc - adj;
      const dNeed = input.dThac0 - LASSO.defenderAc;
      const ar = await d20(), dr = await d20();
      const res = opposedAttack(aNeed, ar, dNeed, dr);
      lines.push(game.i18n.format("AD2E.Lasso.ArmsLine", { ar, aNeed, aAc: LASSO.armsAc, dr, dNeed, dAc: LASSO.defenderAc }));
      if (res.result === "attacker") {
        const both = armsTrapped(res.margin) === 2;
        const arm = both ? "" : ((await d20()) % 2 ? i18n("AD2E.Lasso.Left") : i18n("AD2E.Lasso.Right"));
        lines.push(both ? i18n("AD2E.Lasso.BothArms") : game.i18n.format("AD2E.Lasso.OneArm", { arm }));
      } else lines.push(i18n(res.result === "tie" ? "AD2E.Lasso.Tie" : "AD2E.Lasso.ArmsFail"));
    } else if (input.mode === "unhorse" && hit) {
      if (input.riderMoving && input.tiedSolid) lines.push(i18n("AD2E.Lasso.UnhorsedAuto"));
      else {
        const res = await oppStr(aStr, input.dStr);
        lines.push(i18n(res === "attacker" ? "AD2E.Lasso.Unhorsed" : (res === "tie" ? "AD2E.Lasso.Tie" : "AD2E.Lasso.NotUnhorsed")));
      }
    }
    return ChatMessage.create({ speaker: ChatMessage.getSpeaker({ actor: this }), rolls,
      content: `<p><strong>${esc(item.name)}: ${esc(i18n(`AD2E.Lasso.Modes.${input.mode}`))}</strong>${esc(AD2EActor.#targetText(targets))}`
        + `${modifierText(input.mod, input.note)}</p><ul>${lines.map(l => `<li>${esc(l)}</li>`).join("")}</ul>` });
  }

  /**
   * Net (module/lasso.mjs NET): throw (trap weapon and shield), loop the rope round (the victim's Strength -4 to break
   * free), pull/trip, or fold it again (2 rounds). Thrown at 10 with the target's Dexterity and magic only; -4 once
   * unfolded (item flag `ad2e.unfolded`).
   */
  async rollNet(itemId) {
    const item = this.items.get(itemId);
    const entry = this.#weaponEntry(itemId);
    const attack = entry?.attack?.missile ?? entry?.attack?.melee;
    if (!item || !attack) return null;
    const i18n = k => game.i18n.localize(k);
    const esc = v => foundry.utils.escapeHTML?.(String(v ?? "")) ?? String(v ?? "");
    const targets = AD2EActor.#targetsNow();
    const resolve = uuid => (foundry.utils.fromUuidSync ?? globalThis.fromUuidSync)?.(uuid, { strict: false }) ?? null;
    const tdoc = targets[0] ? resolve(targets[0].uuid) : null;
    const def = tdoc?.actor ?? (tdoc?.documentName === "Actor" ? tdoc : null);
    const ds = def?.system ?? {};
    const mon = def?.type === "monster" ? monsterScores(ds.size, ds.hitDice, ds.movement?.base) : null;
    const dSize = def?.type === "monster" ? (String(ds.size ?? "").trim().charAt(0).toUpperCase() || "M") : (ds.sizeCategory ?? "M");
    const unfolded = !!item.getFlag?.("ad2e", "unfolded");
    const field = (label, html) => `<div class="form-group"><label>${esc(label)}</label>${html}</div>`;
    const box = (name, label, checked = false) => `<div class="form-group"><label>${esc(label)}</label><input type="checkbox" name="${name}"${checked ? " checked" : ""}></div>`;
    const content = `<p class="ad2e-note">${esc(i18n("AD2E.Net.Hint"))}</p>`
      + field(i18n("AD2E.Net.Mode"), `<select name="mode">${["throw", "wrap", "trip", "fold"].map(m => `<option value="${m}">${esc(i18n(`AD2E.Net.Modes.${m}`))}</option>`).join("")}</select>`)
      + field(i18n("AD2E.Net.Ac"), `<input type="number" name="netAc" value="${netAc(def?.type === "character" ? ds.abilityData?.dex?.ac : 0, 0)}">`)
      + field(i18n("AD2E.Net.TripAc"), `<input type="number" name="ac" value="${AD2EActor.#targetAc(targets, true)}">`)
      + field(i18n("AD2E.Lasso.Range"), `<select name="range">${["short", "medium", "long"].map(r => `<option value="${r}">${esc(i18n(`AD2E.Weapon.${r[0].toUpperCase()}${r.slice(1)}`))}</option>`).join("")}</select>`)
      + box("unfolded", game.i18n.format("AD2E.Net.Unfolded", { n: NET.unfolded }), unfolded)
      + `<fieldset><legend>${esc(game.i18n.format("AD2E.Lasso.Defender", { name: def?.name ?? i18n("AD2E.Lasso.NoTarget") }))}</legend>`
      + field(i18n("AD2E.Lasso.DefStr"), `<input type="number" name="dStr" value="${mon ? mon.str : (ds.abilities?.str?.total ?? 10)}">`)
      + field(i18n("AD2E.Lasso.DefDex"), `<input type="number" name="dDex" value="${mon ? mon.dex : (ds.abilities?.dex?.total ?? 10)}">`)
      + field(i18n("AD2E.Lasso.DefSize"), `<select name="dSize">${LASSO.sizes.map(s => `<option value="${s}"${s === dSize ? " selected" : ""}>${s}</option>`).join("")}</select>`)
      + box("fourLegs", game.i18n.format("AD2E.Lasso.FourLegs", { n: LASSO.pullTrip.fourLegs }))
      + box("unaware", game.i18n.format("AD2E.Lasso.Unaware", { n: LASSO.pullTrip.unaware }))
      + box("stationary", game.i18n.format("AD2E.Lasso.Stationary", { n: LASSO.pullTrip.stationary })) + `</fieldset>`
      + modifierFields();
    const input = await ad2eDialog.prompt({
      window: { title: `${this.name}: ${item.name}` }, content,
      ok: { label: i18n("AD2E.Roll.Roll"), callback: (event, button) => {
        const el = button.form.elements;
        const num = n => Number(el[n]?.value) || 0;
        return { mode: el.mode.value, netAc: num("netAc"), ac: num("ac"), range: el.range.value, unfolded: !!el.unfolded?.checked,
          dStr: num("dStr"), dDex: num("dDex"), dSize: el.dSize.value, fourLegs: !!el.fourLegs?.checked, unaware: !!el.unaware?.checked,
          stationary: !!el.stationary?.checked, ...readModifier(button.form) };
      } },
      rejectClose: false
    });
    if (!input) return null;
    const speaker = ChatMessage.getSpeaker({ actor: this });
    const title = `<p><strong>${esc(item.name)}: ${esc(i18n(`AD2E.Net.Modes.${input.mode}`))}</strong>${esc(AD2EActor.#targetText(targets))}${modifierText(input.mod, input.note)}</p>`;
    if (input.mode === "fold") {
      await item.setFlag?.("ad2e", "unfolded", false);
      return ChatMessage.create({ speaker, content: title + `<p>${esc(game.i18n.format("AD2E.Net.Folded", { name: this.name, n: NET.foldRounds }))}</p>` });
    }
    const rolls = [];
    const lines = [];
    const d20 = async () => { const r = await new Roll("1d20").evaluate(); rolls.push(r); return r.total; };
    const fmtAdj = n => `${n >= 0 ? "+" : ""}${n}`;
    // Throws and loops are made at the Dexterity-and-magic AC and suffer the unfolded -4; a pull/trip uses the normal AC.
    const thrown = input.mode !== "trip";
    const ac = thrown ? input.netAc : input.ac;
    const adj = attack.hit + (AD2E.rangeModifiers[input.range] ?? 0) + (input.unfolded && thrown ? NET.unfolded : 0) + input.mod;
    const need = this.system.thac0.value - ac;
    const r = await d20();
    const hit = r + adj >= need;
    lines.push(game.i18n.format("AD2E.Net.AttackLine", { roll: r, adj: fmtAdj(adj), total: r + adj, ac, need, result: i18n(hit ? "AD2E.Roll.Hit" : "AD2E.Roll.Miss") }));
    if (input.unfolded && thrown) lines.push(game.i18n.format("AD2E.Net.UnfoldedNote", { n: NET.unfolded }));
    if (hit && input.mode === "throw") lines.push(i18n("AD2E.Net.Trapped"));
    if (hit && input.mode === "wrap") lines.push(game.i18n.format("AD2E.Net.Wrapped", { n: NET.improveStr }));
    if (hit && input.mode === "trip") {
      const pt = pullTripScore(this.system.abilities.str.total, { attackerSize: this.system.sizeCategory ?? "M", defenderSize: input.dSize, lasso: false,
        fourLegs: input.fourLegs, unaware: input.unaware, stationary: input.stationary });
      const dScore = Math.max(input.dStr, input.dDex);
      lines.push(game.i18n.format("AD2E.Lasso.StrParts", { str: this.system.abilities.str.total, parts: pt.parts.map(([k, v]) => `${i18n(`AD2E.Lasso.Part.${k}`)} ${fmtAdj(v)}`).join(", ") || "—",
        score: pt.score, def: dScore }));
      const ar = await d20(), dr = await d20();
      lines.push(game.i18n.format("AD2E.Lasso.StrLine", { a: pt.score, ar, d: dScore, dr }));
      lines.push(i18n(`AD2E.Lasso.Trip.${opposedCheck(pt.score, ar, dScore, dr)}`));
    }
    // A throw unfolds the net (a pull/trip keeps hold of it).
    if (input.mode !== "trip") await item.setFlag?.("ad2e", "unfolded", true);
    return ChatMessage.create({ speaker, rolls, content: title + `<ul>${lines.map(l => `<li>${esc(l)}</li>`).join("")}</ul>` });
  }

  /** Netted: "he can only break free by making a Strength check" (-4 if the rope was looped round). Characters and monsters. */
  async breakFreeNet() {
    const i18n = k => game.i18n.localize(k);
    const esc = v => foundry.utils.escapeHTML?.(String(v ?? "")) ?? String(v ?? "");
    const str = this.type === "character" ? this.system.abilities.str.total
      : monsterScores(this.system.size, this.system.hitDice, this.system.movement?.base).str;
    const input = await ad2eDialog.prompt({
      window: { title: `${this.name}: ${i18n("AD2E.Net.BreakFree")}` },
      content: `<p class="ad2e-note">${esc(i18n("AD2E.Net.BreakFreeHint"))}</p>`
        + `<div class="form-group"><label>${esc(i18n("AD2E.Net.Strength"))}</label><input type="number" name="str" value="${str}"></div>`
        + `<div class="form-group"><label>${esc(game.i18n.format("AD2E.Net.WrappedBox", { n: NET.improveStr }))}</label><input type="checkbox" name="wrapped"></div>`
        + modifierFields(),
      ok: { label: i18n("AD2E.Roll.Roll"), callback: (event, button) => ({ str: Number(button.form.elements.str.value) || 0,
        wrapped: !!button.form.elements.wrapped?.checked, ...readModifier(button.form) }) },
      rejectClose: false
    });
    if (!input) return null;
    const target = breakFreeScore(input.str, input.wrapped) + input.mod;
    const roll = await new Roll("1d20").evaluate();
    const ok = roll.total <= target;
    return ChatMessage.create({ speaker: ChatMessage.getSpeaker({ actor: this }), rolls: [roll],
      content: `<p>${esc(game.i18n.format("AD2E.Net.BreakFreeLine", { name: this.name, roll: roll.total, target,
        result: i18n(ok ? "AD2E.Net.Free" : "AD2E.Net.StillTrapped") }))}${modifierText(input.mod, input.note)}</p>` });
  }

  /** Tokens the current user targets: [{ uuid, name }] (`game.user.targets`). */
  static #targetsNow() {
    return [...(game.user?.targets ?? [])].map(t => ({ uuid: t.document?.uuid, name: t.document?.name ?? t.name }))
      .filter(t => t.uuid);
  }

  /** Targets of this actor's last attack per weapon or attack key (a damage roll with no target uses them). */
  static #lastTargets = new Map();

  #rememberTargets(key, targets) {
    AD2EActor.#lastTargets.set(`${this.uuid ?? this.id}.${key}`, targets);
  }

  #damageTargets(key) {
    const now = AD2EActor.#targetsNow();
    return now.length ? now : (AD2EActor.#lastTargets.get(`${this.uuid ?? this.id}.${key}`) ?? []);
  }

  /**
   * Armor Class field default: the first target's Armor Class (characters: front, or vs. missiles), if the user may see
   * that actor (observer or owner); else 10.
   */
  static #targetAc(targets, missile = false) {
    const actor = targets.length ? (foundry.utils.fromUuidSync ?? globalThis.fromUuidSync)?.(targets[0].uuid, { strict: false })?.actor : null;
    if (!actor || !(actor.isOwner || actor.testUserPermission?.(game.user, "OBSERVER"))) return 10;
    const sys = actor.system;
    const ac = actor.type === "character" ? (missile ? sys.armor?.missile : sys.ac?.total) : sys.ac?.value;
    return Number.isFinite(ac) ? ac : 10;
  }

  /** " → Orc, Goblin" for chat. */
  static #targetText(targets) {
    const esc = v => foundry.utils.escapeHTML?.(String(v ?? "")) ?? String(v ?? "");
    return targets.length ? ` → ${targets.map(t => esc(t.name)).join(", ")}` : "";
  }

  /**
   * Weapon damage: the chosen damage option's dice (or owned ammunition's) vs. small/medium or large targets
   * + the use's damage adjustment (+ the ammunition's magical bonus); "a successful attack roll can never cause less than 1 point of damage" (Strength (PHB)).
   */
  async rollWeaponDamage(itemId, use = "melee", preset = null) {
    const item = this.items.get(itemId);
    const attack = this.#weaponEntry(itemId)?.attack?.[use];
    if (!item || !attack) return;
    // A launcher with owned ammunition: the ammunition's damage and magical bonus (last fired first).
    const owned = use === "missile" ? (this.ammunitionFor(item) ?? []) : [];
    const last = AD2EActor.#lastAmmo.get(`${this.id}.${itemId}`);
    owned.sort((a, b) => (b.id === last) - (a.id === last));
    // Ammunition without damage of its own (firearm bullets) uses the weapon's damage.
    const own = (item.system.weapon.damage ?? []).find(d => d.sm || d.l) ?? {};
    const options = owned.length
      ? owned.map(a => ({ label: a.name, sm: a.system.damage.sm ?? own.sm, l: a.system.damage.l ?? own.l, dmg: a.system.bonus.dmg }))
      : (item.system.weapon.damage ?? []).filter(d => d.sm || d.l);
    if (!options.length) {
      ui.notifications.warn(game.i18n.format("AD2E.Weapon.NoDamage", { name: item.name }));
      return;
    }
    const i18n = key => game.i18n.localize(key);
    const choice = options.length > 1
      ? `<div class="form-group"><label>${i18n("AD2E.Weapon.Ammo")}</label><select name="option">${
        options.map((d, i) => `<option value="${i}">${d.label} (${d.sm ?? "—"} / ${d.l ?? "—"})</option>`).join("")}</select></div>`
      : "";
    const mult = use === "melee" ? this.#backstabMultiplier() : null;
    // Combat & Tactics footnotes c and m: double damage set vs. a charge / in a mounted charge.
    const rules = item.system.weapon?.rules ?? [];
    const chargeFields = use === "melee" ? ["setCharge", "mountedCharge"].filter(k => rules.includes(k)).map(k => `<div class="form-group">`
      + `<label>${i18n(`AD2E.Firearm.${k}`)}</label><input type="checkbox" name="${k}"></div>`).join("") : "";
    const kitOptions = this.#kitOptions("damage");
    const targets = this.#damageTargets(itemId);
    const lastCrit = AD2EActor.#takeCrit(this, itemId, preset);
    // A sap (attack options): punching damage (25% lasting) and a knockout chance (module/attack-options.mjs).
    const sapKey = `${this.uuid ?? this.id}.${itemId}`;
    const sap = preset?.sap ?? AD2EActor.#lastSap.get(sapKey) ?? null;
    AD2EActor.#lastSap.delete(sapKey);
    const backstabField = mult ? `<div class="form-group"><label>${game.i18n.format("AD2E.Ability2.BackstabDamage", { mult })}</label>`
      + `<input type="checkbox" name="backstab"></div>` : "";
    // Elemental mage: "+1 to each damage die inflicted with an attack using that element (magical or otherwise)".
    const element = elementOf(this);
    const elementField = element ? `<div class="form-group"><label>${game.i18n.format("AD2E.Elemental.WeaponUses",
      { province: i18n(`AD2E.Elemental.Province.${element}`) })}</label><input type="checkbox" name="elementAttack"${item.system.element === element ? " checked" : ""}></div>` : "";
    const nonlethalField = use === "melee" && nonlethalAllowed(item.system.weapon)
      ? `<div class="form-group"><label>${i18n("AD2E.Nonlethal.Weapon")} (${i18n("AD2E.Nonlethal.Half")})</label><input type="checkbox" name="nonlethal"></div>` : "";
    // Skills & Powers point blank damage (specialists +2, masters +3).
    const pbDmg = use === "missile" ? (attack.pointBlankDmg ?? 0) : 0;
    const pbField = pbDmg ? `<div class="form-group"><label>${game.i18n.format("AD2E.SP.PointBlankDamage", { n: pbDmg })}</label>`
      + `<input type="checkbox" name="pointBlank"></div>` : "";
    // `preset` (automatic damage after a hit): no dialog; the first damage option (the ammunition just fired), the
    // given target size and options, the unconditional kit modifiers only.
    const input = preset ? { option: 0, size: preset.size ?? "sm", mod: 0, backstab: !!(preset.backstab && mult),
      nonlethal: !!(preset.nonlethal && use === "melee" && nonlethalAllowed(item.system.weapon)), kitText: "",
      manual: { mod: 0, note: "" }, vsUnarmed: !!(preset.vsUnarmed && use === "melee"), pointBlank: !!(preset.pointBlank && pbDmg),
      critical: lastCrit?.extra ?? 0,
      auto: true } : await ad2eDialog.prompt({
      window: { title: `${item.name}: ${i18n("AD2E.Weapon.Damage")}` },
      content: choice + `<div class="form-group"><label>${i18n("AD2E.Weapon.TargetSize")}</label><select name="size">`
        + `<option value="sm">${i18n("AD2E.Weapon.SM")}</option><option value="l">${i18n("AD2E.Weapon.L")}</option></select></div>`
        + backstabField + nonlethalField + pbField + chargeFields
        + (use === "melee" ? AD2EActor.#armedDefenderField() : "")
        + elementField
        + AD2EActor.#critField(lastCrit)
        + modifierFields()
        + this.#kitFields(kitOptions),
      ok: {
        label: i18n("AD2E.Roll.Roll"),
        callback: (event, button) => {
          const f = button.form.elements;
          const kit = AD2EActor.#kitPicked(button.form, kitOptions);
          const m = readModifier(button.form);
          return { option: Number(f.option?.value ?? 0), size: f.size.value, mod: m.mod + kit.sum,
            backstab: !!f.backstab?.checked, nonlethal: !!f.nonlethal?.checked, kitText: kit.text, manual: m,
            vsUnarmed: !!f.vsUnarmed?.checked, elementAttack: !!f.elementAttack?.checked, pointBlank: !!f.pointBlank?.checked,
            charge: !!f.setCharge?.checked || !!f.mountedCharge?.checked, critical: Number(f.critical?.value ?? 0) || 0 };
        }
      },
      rejectClose: false
    });
    if (!input) return;
    const option = options[input.option] ?? options[0];
    const dice = option[input.size] ?? option.sm ?? option.l;
    // Backstab: "The weapon's standard damage is multiplied by the value given in Table 30. Then Strength and magical
    // weapon bonuses are added" (Thief Skill Explanations (PHB)).
    // A critical adds one set of damage dice (two when tripled) to any multiplier: "do not double the multiplied damage; add
    // it instead" (Critical Hits: System I (POCT)).
    const times = (input.backstab && mult ? mult : 1) * (input.charge ? 2 : 1) + (input.critical ?? 0);
    const formula = times > 1 ? `(${dice}) * ${times} + @adj + @mod` : `${dice} + @adj + @mod`;
    const vsUnarmed = input.vsUnarmed ? COMBAT_TABLES.armedDefender : 0;
    // Elemental mage, attack using its province: +1 per damage die (the dice in the weapon's damage).
    const elementDice = input.elementAttack && element ? [...String(dice).matchAll(/(\d*)d\d+/g)].reduce((n, m) => n + Number(m[1] || 1), 0) : 0;
    // A weapon of an elemental province (its `element`): its dice reach elemental mages and gens of that province.
    const weaponElement = PROVINCES.includes(item.system.element) ? item.system.element : "";
    const pointBlank = input.pointBlank ? pbDmg : 0;
    // Skills & Powers two-handed weapon style: "+1 bonus to all damage rolls" with a one-handed weapon used in two hands
    // (a use labelled two-handed, e.g. the bastard sword, of a weapon the character can hold in one hand).
    const twoHandStyle = use === "melee" && this.type === "character" && this.system.proficiencies?.sp?.styles?.twoHanded
      && needsTwoHands(item.system.weapon, this.system.sizeCategory ?? "M", option) && !needsTwoHands(item.system.weapon, this.system.sizeCategory ?? "M")
      ? SP.twoHanded.damage : 0;
    const roll = await new Roll(formula, { adj: attack.dmg + (option.dmg ?? 0) + vsUnarmed + elementDice + pointBlank + twoHandStyle,
      mod: input.mod }).evaluate();
    // Combat & Tactics footnote k: "If the knockdown roll ... is a 7 or higher, roll an additional damage die and add it
    // ... Roll another knockdown die, and if the result is another 7 or higher, repeat the damage."
    let knock = 0;
    const knockRolls = [];
    const kDie = item.system.weapon?.knockdownDie;
    const dmgDie = String(dice).match(/d(\d+)/)?.[1];
    if (rules.includes("knockdown") && kDie && dmgDie) {
      for (let i = 0; i < 20; i++) {
        const kd = await new Roll(`1${kDie}`).evaluate();
        knockRolls.push(kd.total);
        if (kd.total < 7) break;
        knock += (await new Roll(`1d${dmgDie}`).evaluate()).total;
      }
    }
    const full = Math.max(roll.total + knock, 1);
    // Non-lethal ("Attacking Without Killing (PHB)"): 50% of normal damage (rounded down, at least 1), half of it
    // temporary (rounded down).
    const total = input.nonlethal ? Math.max(Math.floor(full * COMBAT_TABLES.nonlethal.damage), 1) : full;
    const message = await roll.toMessage({
      speaker: ChatMessage.getSpeaker({ actor: this }),
      // Chat context menu: apply to selected tokens (module/health.mjs); non-lethal: half of it is temporary.
      flags: { ad2e: { ...(sap ? { damage: total, damageKind: "punch" } : input.nonlethal ? { damage: total, damageKind: "nonlethal", temp: Math.floor(total / 2) } : { damage: total }), targets,
        // the dice of an elemental attack, for an elemental mage target of the same province (not with backstab)
        ...(elementDice && !(input.backstab && mult) ? { element: elementFlag(roll, [element], 1, total - roll.total) }
          : (weaponElement && !(input.backstab && mult) ? { element: elementFlag(roll, [weaponElement], 0, total - roll.total) } : {})) } },
      flavor: `${item.name}${option.label ? ` (${option.label})` : ""} ${i18n("AD2E.Weapon.Damage")}${weaponElement ? ` (${i18n(`AD2E.Elemental.Province.${weaponElement}`)})` : ""} `
        + `vs ${i18n(input.size === "sm" ? "AD2E.Weapon.SM" : "AD2E.Weapon.L")}${AD2EActor.#targetText(targets)}`
        + (input.backstab && mult ? ` [${game.i18n.format("AD2E.Ability2.BackstabDamage", { mult })}]` : "")
        + (vsUnarmed ? ` [${game.i18n.format("AD2E.Unarmed.VsUnarmedShort", { bonus: vsUnarmed })}]` : "")
        + (pointBlank ? ` [${game.i18n.format("AD2E.SP.PointBlankDamage", { n: pointBlank })}]` : "")
        + (twoHandStyle ? ` [${game.i18n.format("AD2E.SP.TwoHandedDamage", { n: twoHandStyle })}]` : "")
        + (input.charge ? ` [${i18n("AD2E.Firearm.ChargeDouble")}]` : "")
        + (input.critical ? ` [${i18n(input.critical > 1 ? "AD2E.Critical.Triple" : "AD2E.Critical.Double")}]` : "")
        + (knockRolls.length ? ` [${game.i18n.format("AD2E.Firearm.Knockdown", { rolls: knockRolls.join(", "), n: knock })}]` : "")
        + (elementDice ? ` [${game.i18n.format("AD2E.Elemental.DieBonusNote", { province: i18n(`AD2E.Elemental.Province.${element}`), n: elementDice })}]` : "")
        + (input.auto ? ` [${i18n("AD2E.Weapon.AutoDamage")}]` : "")
        + (input.kitText ? ` [${input.kitText}]` : "") + modifierText(input.manual?.mod, input.manual?.note)
        + (input.nonlethal ? `: ${game.i18n.format("AD2E.Nonlethal.DamageResult", { total, temp: Math.floor(total / 2) })}`
          : (total > roll.total ? `: ${total}${roll.total + knock < 1 ? ` (${i18n("AD2E.Weapon.Minimum")})` : ""}` : ""))
    });
    if (sap) await this.#sapKnockout(total, sap, targets);
    // Poison on the missile or weapon (module/poison.mjs): one dose, a save request vs. poison for the targets (injected).
    const carrier = owned.length ? (owned[input.option] ?? owned[0]) : item;
    const poisonClass = await usePoisonDose(carrier);
    if (poisonClass) await requestPoisonSaves({ speaker: ChatMessage.getSpeaker({ actor: this }), cls: poisonClass, delivery: "injected", source: carrier.name, targets });
    return message;
  }

  /**
   * Unarmed attack ("Attacking Without Killing (PHB)"), `form` "punch" | "wrestle" | "overbear": a normal attack roll
   * (d20 + Strength, encumbrance and kit attack modifiers + situational modifier >= THAC0 - target AC; no
   * non-proficiency penalty: all characters are "somewhat proficient"). Punch and wrestle results come from Table 58 by
   * the modified roll; punches do the listed damage (1d3 with a metal gauntlet) + Strength damage, 25% of it lasting,
   * and may knock out (percentile roll, stunned 1d10 rounds); wrestling in armour takes the Table 57 penalty, moves do
   * 1 + Strength damage (optional) and a maintained hold 1 more each round; overbearing adds the size, legs and
   * attackers modifiers. Punching damage is applied as temporary damage (module/health.mjs).
   */
  async rollUnarmed(form = "punch") {
    if (!["character", "monster"].includes(this.type)) return;
    const monster = this.type === "monster";
    const i18n = k => game.i18n.localize(k);
    const esc = v => foundry.utils.escapeHTML?.(String(v ?? "")) ?? String(v ?? "");
    const sys = this.system;
    const C = COMBAT_TABLES;
    const kitOptions = monster ? [] : this.#kitOptions("attack");
    const targets = AD2EActor.#targetsNow();
    const targetActors = AD2EActor.#visibleTargetActors(targets);
    const field = (label, html) => `<div class="form-group"><label>${label}</label>${html}</div>`;
    const sizeSelect = (name, value) => `<select name="${name}">${C.overbear.sizes.map(z =>
      `<option value="${z}"${z === value ? " selected" : ""}>${i18n(`AD2E.Unarmed.Size.${z}`)}</option>`).join("")}</select>`;
    const body = monster ? this.items.find(i => i.type === "armor" && i.system.equipped && i.system.kind === "body") : sys.armor?.body;
    const armorRow = form === "wrestle" ? wrestlingArmor(body?.system.identifier) : null;
    let extra = "";
    if (form === "punch") {
      extra = field(i18n("AD2E.Unarmed.Gauntlet"), `<input type="checkbox" name="gauntlet">`)
        + field(i18n("AD2E.Unarmed.Pull"), `<input type="checkbox" name="pull">`);
    } else if (form === "wrestle") {
      extra = field(i18n("AD2E.Unarmed.HoldRound"), `<input type="number" name="holdRound" value="0" min="0" step="1">`)
        + field(i18n("AD2E.Unarmed.AddStrength"), `<input type="checkbox" name="addStr" checked>`)
        + (armorRow ? `<p class="ad2e-note">${esc(game.i18n.format("AD2E.Unarmed.ArmorPenalty", { armor: armorRow.label, value: armorRow.value }))}</p>` : "");
    } else {
      extra = field(i18n("AD2E.Unarmed.AttackerSize"), sizeSelect("attacker", AD2EActor.#sizeOf(this)))
        + field(i18n("AD2E.Unarmed.DefenderSize"), sizeSelect("defender", targetActors[0] ? AD2EActor.#sizeOf(targetActors[0]) : "M"))
        + field(i18n("AD2E.Unarmed.Legs"), `<input type="number" name="legs" value="2" min="0" step="1">`)
        + field(i18n("AD2E.Unarmed.Attackers"), `<input type="number" name="attackers" value="1" min="1" step="1">`)
        + field(i18n("AD2E.Unarmed.Down"), `<input type="checkbox" name="down">`);
    }
    const input = await ad2eDialog.prompt({
      window: { title: `${this.name}: ${i18n(`AD2E.Unarmed.${form}`)}` },
      content: `<p class="ad2e-note">${i18n(`AD2E.Unarmed.Hint.${form}`)} ${game.i18n.format("AD2E.Unarmed.ArmedDefender", { bonus: C.armedDefender })}`
        + `${monster ? ` ${i18n("AD2E.Unarmed.CreatureHint")}` : ""}</p>`
        + field(i18n("AD2E.Roll.TargetAC"), `<input type="number" name="ac" value="${AD2EActor.#targetAc(targets)}" autofocus>`)
        + extra + (monster ? "" : this.#dualField(this.system.dual?.thac0Option)) + AD2EActor.#combatModFields(targets) + modifierFields() + this.#kitFields(kitOptions),
      ok: { label: i18n("AD2E.Roll.Roll"), callback: (event, button) => {
        const f = button.form.elements;
        const kit = AD2EActor.#kitPicked(button.form, kitOptions);
        return { ...readModifier(button.form), kit: kit.sum, kitText: kit.text, ac: Number(f.ac.value) || 0, dualOld: !!f.dualOld?.checked,
          t51: AD2EActor.#combatModPicked(button.form),
          gauntlet: !!f.gauntlet?.checked, pull: !!f.pull?.checked, holdRound: Math.max(Math.floor(Number(f.holdRound?.value) || 0), 0),
          addStr: !!f.addStr?.checked, attacker: f.attacker?.value ?? "M", defender: f.defender?.value ?? "M",
          legs: Math.max(Number(f.legs?.value) || 0, 0), attackers: Math.max(Math.floor(Number(f.attackers?.value) || 1), 1), down: !!f.down?.checked };
      } },
      rejectClose: false
    });
    if (!input) return;
    const speaker = ChatMessage.getSpeaker({ actor: this });
    const str = monster ? 0 : (sys.mods?.dmg ?? 0);
    const parts = [input.kitText].filter(Boolean);
    // "an armed defender is automatically allowed to strike with his weapon before the unarmed attack is made ... the
    // defender gains a +4 bonus to his attack and damage rolls" (Attacking Without Killing (PHB)); targets the user can see.
    const armed = targetActors.filter(a => AD2EActor.#isArmed(a));
    // Pugilist (Skills & Powers): "treated as if they were armed when making unarmed attacks" (module/kit-features.mjs).
    const pugilist = this.type === "character" && !!kitSpecial(this).unarmedArmed;
    const armedText = armed.length ? (pugilist ? game.i18n.format("AD2E.KitFeature.PugilistArmed", { names: armed.map(a => a.name).join(", ") })
      : game.i18n.format("AD2E.Unarmed.ArmedTarget", { names: armed.map(a => a.name).join(", "), bonus: C.armedDefender })) : "";
    const armedNote = armedText ? `<p class="ad2e-note">${esc(armedText)}</p>` : "";
    // A maintained hold needs no attack roll: 1 more point each round (round 2 = 2 points, ...).
    if (form === "wrestle" && input.holdRound >= 2) {
      const dmg = Math.max(input.holdRound + (input.addStr ? str : 0), 0);
      return ChatMessage.create({ speaker, flags: dmg > 0 ? { ad2e: { damage: dmg, targets } } : {}, content: `${armedNote}<p>${esc(game.i18n.format("AD2E.Unarmed.HoldResult",
        { round: input.holdRound, damage: dmg }))}${AD2EActor.#targetText(targets)}${input.addStr && str ? ` (${i18n("AD2E.Unarmed.StrengthShort")} ${str > 0 ? "+" : ""}${str})` : ""}</p>` });
    }
    let situation = 0;
    if (form === "wrestle" && armorRow) { situation += armorRow.value; parts.push(`${armorRow.label} ${armorRow.value}`); }
    if (form === "overbear") {
      const o = overbearModifier(input);
      situation += o.size + o.legs + o.attackers;
      if (o.size) parts.push(`${i18n("AD2E.Unarmed.SizeDiff")} ${o.size > 0 ? "+" : ""}${o.size}`);
      if (o.legs) parts.push(`${i18n("AD2E.Unarmed.Legs")} ${o.legs}`);
      if (o.attackers) parts.push(`${i18n("AD2E.Unarmed.Attackers")} +${o.attackers}`);
    }
    const hitAdj = monster ? 0 : (sys.mods?.meleeAttack ?? 0);
    input.t51 ??= { sum: 0, auto: false, text: "" };
    if (input.t51.text) { situation += input.t51.sum; parts.push(input.t51.text); }
    const roll = await new Roll("1d20 + @hit + @situation + @kit + @mod", { hit: hitAdj, situation, kit: input.kit, mod: input.mod }).evaluate();
    const dualThac0 = !monster && input.dualOld ? (sys.dual?.thac0Option ?? null) : null;
    if (dualThac0 !== null) await this.markOldClassUse(game.i18n.format("AD2E.Dual.WhatThac0", { n: dualThac0 }));
    const needed = (dualThac0 ?? sys.thac0.value) - input.ac;
    const hit = input.t51.auto || roll.total >= needed;
    const rolls = [roll];
    let result = i18n("AD2E.Roll.Miss");
    let damageFlags = {}; // chat context menu: apply to selected tokens (module/health.mjs)
    if (hit && form === "overbear") {
      result = i18n(input.down ? "AD2E.Unarmed.Pinned" : "AD2E.Unarmed.PulledDown");
    } else if (hit) {
      const row = punchWrestleResult(roll.total);
      if (form === "punch") {
        // A blow that lands (not a wild swing) does the listed damage, 1d3 with a metal gauntlet, + Strength damage.
        const dmgRoll = await new Roll(row.damage ? `${input.gauntlet ? C.punch.gauntlet : row.damage} + @str` : "0",
          { str: row.damage ? str : 0 }).evaluate();
        const ko = await new Roll("1d100").evaluate();
        rolls.push(dmgRoll, ko);
        const damage = input.pull ? 0 : Math.max(dmgRoll.total, 0);
        const knocked = ko.total <= row.ko;
        let stun = null;
        if (knocked) { stun = await new Roll(C.punch.stun).evaluate(); rolls.push(stun); }
        if (damage > 0) damageFlags = { ad2e: { damage, damageKind: "punch", targets } };
        result = `${i18n("AD2E.Roll.Hit")}: ${row.punch} — ${input.pull ? i18n("AD2E.Unarmed.Pulled")
          : game.i18n.format("AD2E.Unarmed.PunchDamage", { damage, lasting: C.punch.lasting * 100 })}; `
          + game.i18n.format(knocked ? "AD2E.Unarmed.KO" : "AD2E.Unarmed.NoKO", { roll: ko.total, chance: row.ko, rounds: stun?.total ?? 0 });
      } else {
        const damage = Math.max(C.wrestle.damage + (input.addStr ? str : 0), 0);
        if (damage > 0) damageFlags = { ad2e: { damage, targets } };
        result = `${i18n("AD2E.Roll.Hit")}: ${row.wrestle}${row.hold ? ` (${i18n("AD2E.Unarmed.Hold")})` : ""} — `
          + game.i18n.format("AD2E.Unarmed.WrestleDamage", { damage });
      }
    }
    const flavor = `${i18n(`AD2E.Unarmed.${form}`)} vs AC ${input.ac}${AD2EActor.#targetText(targets)} (THAC0 ${sys.thac0.value}, ${i18n("AD2E.Roll.Needs")} ${needed}+)`
      + `${parts.length ? ` [${parts.map(esc).join("; ")}]` : ""}${modifierText(input.mod, input.note)}: ${result}`;
    return ChatMessage.create({ speaker, flavor: flavor + (armedText ? ` [${esc(armedText)}]` : ""), rolls, flags: damageFlags });
  }

  /** Actors of the targets the current user may see (observer or owner). */
  /** The first target's actor (any permission; Table 52 reads its armour), or null. */
  static #targetActor(targets) {
    const resolve = foundry.utils.fromUuidSync ?? globalThis.fromUuidSync;
    return targets?.length ? resolve?.(targets[0].uuid, { strict: false })?.actor ?? null : null;
  }

  static #visibleTargetActors(targets) {
    const resolve = foundry.utils.fromUuidSync ?? globalThis.fromUuidSync;
    return targets.map(t => resolve?.(t.uuid, { strict: false })?.actor)
      .filter(a => a && (a.isOwner || a.testUserPermission?.(game.user, "OBSERVER")));
  }

  /** Whether an actor holds a melee weapon: characters - equipped and not dropped; monsters - any not dropped. */
  static #isArmed(actor) {
    return !!actor?.items?.some?.(i => i.type === "weapon" && i.system.weapon?.melee && !i.system.dropped
      && (actor.type !== "character" || i.system.equipped));
  }

  /** Size category of an actor: characters from the race, monsters from the size text ("L (9' tall)"). */
  static #sizeOf(actor) {
    if (actor?.type === "character") return actor.system.sizeCategory ?? "M";
    const m = String(actor?.system?.size ?? "").trim().match(/^[TSMLHG]/i);
    return m ? m[0].toUpperCase() : "M";
  }

  /** Status ids of the first target's actor (token status icons, Actor#statuses); empty without a target. */
  static #targetStatuses(targets) {
    const resolve = foundry.utils.fromUuidSync ?? globalThis.fromUuidSync;
    const doc = targets.length ? resolve?.(targets[0].uuid, { strict: false }) : null;
    return { statuses: new Set(doc?.actor?.statuses ?? []), name: targets[0]?.name ?? "" };
  }

  /**
   * PHB Table 51 Combat Modifiers as tick boxes (missile range is a separate field). Rows whose status ids the first
   * target has (e.g. Prone, Stunned: +4; Asleep, Paralyzed, Restrained, Unconscious: automatic hit; Invisible: -4) are
   * ticked, with the condition named.
   */
  static #combatModFields(targets, missile = false, element = "") {
    const esc = v => foundry.utils.escapeHTML?.(String(v ?? "")) ?? String(v ?? "");
    // Skills & Powers shield proficiency of the first target (Table 51): a tick box, not ticked (the defender guards
    // against a limited number of attacks per round and names them; the GM decides).
    const shield = AD2EActor.#targetShieldProficiency(targets, missile);
    const shieldField = shield ? `<label><input type="checkbox" name="spShield" value="${-shield.ac}"> ${esc(game.i18n.format(
      "AD2E.SP.ShieldTarget", { name: shield.name, type: game.i18n.localize(`AD2E.SP.Shield.${shield.type}`), n: shield.attackers }))} (${-shield.ac})</label>` : "";
    const { statuses } = AD2EActor.#targetStatuses(targets);
    const statusName = id => {
      const list = Array.isArray(CONFIG.statusEffects) ? CONFIG.statusEffects : Object.values(CONFIG.statusEffects ?? {});
      const e = list.find(x => x.id === id);
      return e ? game.i18n.localize(e.name ?? e.label ?? id) : id;
    };
    return `<fieldset><legend>${game.i18n.localize("AD2E.Combat51.Legend")}</legend><div class="ad2e-check-grid">`
      + COMBAT_TABLES.combatModifiers.map(m => {
        const hit = m.statuses.filter(id => statuses.has(id));
        const value = m.value === "auto" ? game.i18n.localize("AD2E.Combat51.Auto") : `${m.value > 0 ? "+" : ""}${m.value}`;
        return `<label><input type="checkbox" name="t51-${m.key}"${hit.length ? " checked" : ""}> ${esc(game.i18n.localize(`AD2E.Combat51.Row.${m.key}`))} (${value})`
          + `${hit.length ? ` <em>${esc(game.i18n.format("AD2E.Combat51.FromStatus", { status: hit.map(statusName).join(", ") }))}</em>` : ""}</label>`;
      }).join("") + shieldField + AD2EActor.#genWardField(targets, element) + (missile ? AD2EActor.#missileStyleField(targets) : "") + "</div></fieldset>";
  }

  /**
   * Skills & Powers shield proficiency of the first target (a character with a valid shield proficiency for the shield
   * it carries; module/sp-weapons.mjs): { name, type, ac (Table 51 bonus; the body shield's missile value against
   * missiles), attackers }, or null. Only for a target the user may observe (as #targetAc).
   */
  /** Record on this actor's combatant that it shot with its missile style this round (combatant flag ad2e.shot = round). */
  async #markShotThisRound() {
    const combat = game.combat;
    const c = combat?.combatants?.find?.(x => x.actor?.id === this.id);
    if (!c?.isOwner) return;
    try { await c.setFlag("ad2e", "shot", combat.round); } catch { /* no permission */ }
  }

  /**
   * Tick box against missiles when the first target is a missile or thrown style specialist who shot this round
   * (Fighting Style Specialization (POSP): +1 AC); ticked when its combatant shot in the current round.
   */
  static #missileStyleField(targets) {
    const actor = targets.length ? (foundry.utils.fromUuidSync ?? globalThis.fromUuidSync)?.(targets[0].uuid, { strict: false })?.actor : null;
    const styles = actor?.type === "character" ? actor.system.proficiencies?.sp?.styles : null;
    if (!styles?.missile && !styles?.thrown) return "";
    const combat = game.combat;
    const shot = !!combat && combat.combatants?.find?.(x => x.actor?.id === actor.id)?.getFlag?.("ad2e", "shot") === combat.round;
    const esc = v => foundry.utils.escapeHTML?.(String(v ?? "")) ?? String(v ?? "");
    const v = -SP.missileStyle.acVsMissiles;
    return `<label><input type="checkbox" name="missileStyleAc" value="${v}"${shot ? " checked" : ""}> ${esc(game.i18n.format("AD2E.SP.TargetShooting",
      { name: targets[0].name ?? actor.name }))} (${v})</label>`;
  }

  /** Tick box when the first target is protected by a gen against an element (module/gens.mjs): -2 to hit. */
  static #genWardField(targets, element = "") {
    const actor = targets.length ? (foundry.utils.fromUuidSync ?? globalThis.fromUuidSync)?.(targets[0].uuid, { strict: false })?.actor : null;
    const province = actor ? genWardProvince(actor) : null;
    if (!province) return "";
    const esc = v => foundry.utils.escapeHTML?.(String(v ?? "")) ?? String(v ?? "");
    // Ticked when the attack is of the gen's element (a monster attack with that province).
    return `<label><input type="checkbox" name="genWard" value="${SHAIR.genWard.hit}"${element && element === province ? " checked" : ""}> ${esc(game.i18n.format("AD2E.Gen.AttackWard",
      { name: targets[0].name ?? actor.name, province: game.i18n.localize(`AD2E.Elemental.Province.${province}`) }))} (${SHAIR.genWard.hit})</label>`;
  }

  static #targetShieldProficiency(targets, missile = false) {
    const actor = targets.length ? (foundry.utils.fromUuidSync ?? globalThis.fromUuidSync)?.(targets[0].uuid, { strict: false })?.actor : null;
    if (!actor || actor.type !== "character" || !(actor.isOwner || actor.testUserPermission?.(game.user, "OBSERVER"))) return null;
    const sys = actor.system;
    const type = shieldType(sys.armor?.shield?.system?.identifier);
    if (!type || !sys.proficiencies?.sp?.shields?.includes(type)) return null;
    const row = SP.shields[type];
    return { name: targets[0].name ?? actor.name, type, ac: missile ? row.missile : row.ac, attackers: row.attackers };
  }

  /** Ticked Table 51 rows: { sum, auto, text }. */
  static #combatModPicked(form) {
    const rows = COMBAT_TABLES.combatModifiers.filter(m => form?.elements?.[`t51-${m.key}`]?.checked);
    const label = m => game.i18n.localize(`AD2E.Combat51.Row.${m.key}`);
    const shieldBox = form?.elements?.spShield;
    const shield = shieldBox?.checked ? Number(shieldBox.value) || 0 : 0;
    const text = rows.map(m => m.value === "auto" ? `${label(m)}: ${game.i18n.localize("AD2E.Combat51.Auto")}`
      : `${label(m)} ${m.value > 0 ? "+" : ""}${m.value}`);
    if (shieldBox?.checked) text.push(`${game.i18n.localize("AD2E.SP.ShieldShort")} ${shield}`);
    const msBox = form?.elements?.missileStyleAc;
    const ms = msBox?.checked ? Number(msBox.value) || 0 : 0;
    if (msBox?.checked) text.push(`${game.i18n.localize("AD2E.SP.TargetShootingShort")} ${ms}`);
    const genBox = form?.elements?.genWard;
    const gen = genBox?.checked ? Number(genBox.value) || 0 : 0;
    if (genBox?.checked) text.push(`${game.i18n.localize("AD2E.Gen.WardShort")} ${gen}`);
    return { sum: rows.reduce((n, m) => n + (m.value === "auto" ? 0 : m.value), 0) + shield + gen + ms, auto: rows.some(m => m.value === "auto"),
      text: text.join("; ") };
  }

  /** Dialog field: the attacker is an unarmed opponent closing in (+4 attack and damage, Attacking Without Killing (PHB)). */
  static #armedDefenderField() {
    return `<div class="form-group"><label>${game.i18n.format("AD2E.Unarmed.VsUnarmed", { bonus: COMBAT_TABLES.armedDefender })}</label>`
      + `<input type="checkbox" name="vsUnarmed"></div>`;
  }

  /** The mount a character is riding (`system.animals.riding`), or null; monsters do not ride. */
  #ridingMount() {
    if (this.type !== "character" || !this.system.animals?.riding) return null;
    const resolve = foundry.utils.fromUuidSync ?? globalThis.fromUuidSync;
    const mount = resolve?.(this.system.animals.riding, { strict: false }) ?? null;
    return mount?.system ? mount : null;
  }

  /**
   * Melee dialog field from horseback (Fighting from Horseback, Unusual Combat Situations (DMG)): a rider's +1 against
   * a creature smaller than the mount (not a rider), or the -1 of a combatant on foot against a rider. Ticked by default
   * from the first target (its size; a character riding a mount).
   */
  #mountedMeleeField(targets) {
    const resolve = foundry.utils.fromUuidSync ?? globalThis.fromUuidSync;
    const target = targets?.length ? resolve?.(targets[0].uuid, { strict: false })?.actor ?? null : null;
    const mount = this.#ridingMount();
    const targetRiding = !!(target && #ridingMount in target && target.#ridingMount());
    const m = target ? mountedMeleeModifier({ mountSize: mount ? AD2EActor.#sizeOf(mount) : null, targetSize: AD2EActor.#sizeOf(target), targetRiding })
      : { key: null };
    const M = COMBAT_TABLES.mounted;
    const esc = v => foundry.utils.escapeHTML?.(String(v ?? "")) ?? String(v ?? "");
    if (mount) {
      return `<div class="form-group"><label>${esc(game.i18n.format("AD2E.Mounted.Smaller", { name: mount.name, n: `+${M.smaller}` }))}</label>`
        + `<input type="checkbox" name="mountedSmaller"${m.key === "smaller" ? " checked" : ""}></div>`;
    }
    return `<div class="form-group"><label>${esc(game.i18n.format("AD2E.Mounted.VsRider", { n: M.vsRider }))}</label>`
      + `<input type="checkbox" name="vsRider"${m.key === "vsRider" ? " checked" : ""}></div>`;
  }

  /** The ticked mounted melee modifier: { value, text }. */
  static #mountedMeleePicked(f) {
    const M = COMBAT_TABLES.mounted;
    if (f.mountedSmaller?.checked) return { value: M.smaller, text: `${game.i18n.localize("AD2E.Mounted.SmallerShort")} +${M.smaller}` };
    if (f.vsRider?.checked) return { value: M.vsRider, text: `${game.i18n.localize("AD2E.Mounted.VsRiderShort")} ${M.vsRider}` };
    return { value: 0, text: "" };
  }

  /**
   * Monster attacks: the stat block's natural attacks (`system.attacks`, index "a<n>") and owned weapon items
   * (index "w<itemId>", damage options from the weapon list plus its magical bonus). Hit if d20 + bonus + modifier
   * >= THAC0 - target AC.
   */
  monsterAttacks() {
    if (this.type !== "monster") return [];
    const natural = this.system.attacks.map((a, i) => ({ key: `a${i}`, name: a.name, hit: a.bonus, melee: true,
      damage: [{ label: "", formula: a.damage }], dmgBonus: 0, element: PROVINCES.includes(a.element) ? a.element : "", poison: a.poison ?? "",
      type: a.type ?? "" }));
    const weapons = this.items.filter(i => i.type === "weapon").map(i => ({ key: `w${i.id}`, name: i.name, hit: i.system.bonus.hit,
      melee: !!i.system.weapon?.melee, element: PROVINCES.includes(i.system.element) ? i.system.element : "",
      damage: i.system.weapon.damage.filter(d => d.sm || d.l).map(d => ({ label: d.label, sm: d.sm, l: d.l })),
      dmgBonus: i.system.bonus.dmg, poisonItem: i, type: i.system.weapon?.type ?? "" }));
    return [...natural, ...weapons];
  }

  async rollMonsterAttack(key) {
    const attack = this.monsterAttacks().find(a => a.key === key);
    if (!attack) return;
    const i18n = k => game.i18n.localize(k);
    const targets = AD2EActor.#targetsNow();
    this.#rememberTargets(key, targets);
    const input = await ad2eDialog.prompt({
      window: { title: `${this.name}: ${attack.name}` },
      content: `<div class="form-group"><label>${i18n("AD2E.Roll.TargetAC")}</label><input type="number" name="ac" value="${AD2EActor.#targetAc(targets)}" autofocus></div>`
        // Called shots and opposed maneuvers (world setting "attackOptions", module/attack-options.mjs).
        + (attackOptionsOn() ? this.#maneuverField(["normal", "calledShot", "disarm", "grab", "trap", ...(attack.melee ? ["block"] : [])], targets, attack.type) : "")
        + (attack.melee ? AD2EActor.#armedDefenderField() + this.#mountedMeleeField(targets) : "")
        + AD2EActor.#combatModFields(targets, !attack.melee, attack.element)
        + modifierFields(),
      ok: { label: i18n("AD2E.Roll.Roll"), callback: (event, button) => ({
        ac: Number(button.form.elements.ac.value) || 0, vsUnarmed: !!button.form.elements.vsUnarmed?.checked,
        t51: AD2EActor.#combatModPicked(button.form), mountedMelee: attack.melee ? AD2EActor.#mountedMeleePicked(button.form.elements) : null,
        ...AD2EActor.#maneuverPicked(button.form.elements), ...readModifier(button.form) }) },
      rejectClose: false
    });
    if (!input) return;
    if (OPPOSED.includes(input.maneuver)) {
      return this.rollManeuver(input.maneuver, { item: attack.poisonItem ?? null, attack: { hit: attack.hit }, targets, ac: input.ac,
        mod: input.mod, thac0: this.system.thac0.value });
    }
    const thac0 = this.system.thac0.value;
    const needed = thac0 - input.ac;
    const vsUnarmed = input.vsUnarmed ? COMBAT_TABLES.armedDefender : 0;
    input.t51 ??= { sum: 0, auto: false, text: "" };
    const mountedMelee = input.mountedMelee?.value ?? 0;
    // PHB Table 52 (optional): the attack's type (a natural attack's select, a weapon's type) against the target's armour.
    const t52 = table52ForTarget(attack.type, AD2EActor.#targetActor(targets));
    const maneuverNotes = [];
    const maneuverHit = this.#maneuverModifier(input, targets, maneuverNotes);
    // Force marching: -1 per day to all attack rolls (module/travel.mjs).
    const march = TRAVEL.march.attackPerDay * (this.system.march?.days ?? 0) || 0;
    const roll = await new Roll("1d20 + @adj + @mod", { adj: attack.hit + vsUnarmed + input.t51.sum + mountedMelee + (t52?.mod ?? 0) + maneuverHit + march, mod: input.mod }).evaluate();
    const hit = input.t51.auto || roll.total >= needed;
    // Critical hit (module/criticals.mjs): natural attacks count as weapons of the monster's size (implementation choice).
    let crit = null;
    if (hit && criticalMode() !== "off" && isCritical(roll.dice?.[0]?.total ?? null, roll.total, needed)) {
      const weaponItem = attack.poisonItem ?? null;
      crit = await rollCritical({ typeText: t52?.type || attack.type, attackerSize: sizeOfActor(this),
        weaponSize: weaponItem ? weaponCritSize(weaponItem, sizeOfActor(this)) : sizeOfActor(this), target: AD2EActor.#targetActor(targets),
        calledLocation: input.calledLocation ?? "" });
    }
    AD2EActor.#rememberCrit(this, key, crit);
    const message = await roll.toMessage({
      speaker: ChatMessage.getSpeaker({ actor: this }),
      flavor: `${attack.name} vs AC ${input.ac}${AD2EActor.#targetText(targets)} (THAC0 ${thac0}, ${i18n("AD2E.Roll.Needs")} ${needed}+): `
        + i18n(hit ? "AD2E.Roll.Hit" : "AD2E.Roll.Miss")
        + (vsUnarmed ? ` [${game.i18n.format("AD2E.Unarmed.VsUnarmedShort", { bonus: vsUnarmed })}]` : "")
        + (input.t51.text ? ` [${foundry.utils.escapeHTML?.(input.t51.text) ?? input.t51.text}]` : "")
        + (t52 ? ` [${foundry.utils.escapeHTML?.(table52Text(t52)) ?? table52Text(t52)}]` : "")
        + (input.mountedMelee?.text ? ` [${input.mountedMelee.text}]` : "") + modifierText(input.mod, input.note)
        + (crit ? ` [${criticalText(crit)}]` : "")
        + (maneuverNotes.length ? ` [${maneuverNotes.join("; ")}]` : "")
        + (march ? ` [${game.i18n.format("AD2E.Travel.MarchNote", { n: march })}]` : "")
    });
    if (crit) await postCriticalCard(this, crit, targets);
    if (hit && AD2EActor.#autoDamageOn()) {
      await this.rollMonsterDamage(key, { size: AD2EActor.#targetSizeKey(targets), vsUnarmed: !!input.vsUnarmed, critical: crit });
    }
    return message;
  }

  async rollMonsterDamage(key, preset = null) {
    const attack = this.monsterAttacks().find(a => a.key === key);
    if (!attack || !attack.damage.length) return;
    const i18n = k => game.i18n.localize(k);
    const targets = this.#damageTargets(key);
    const lastCrit = AD2EActor.#takeCrit(this, key, preset);
    let formula = attack.damage[0].formula;
    let label = "";
    // A weapon: choose the damage option and the target size; any attack: a situational modifier.
    const options = attack.damage;
    const weapon = !formula;
    const input = preset ? { option: 0, size: preset.size ?? "sm", vsUnarmed: !!(preset.vsUnarmed && attack.melee), mod: 0, note: "",
      critical: lastCrit?.extra ?? 0,
      auto: true } : await ad2eDialog.prompt({
      window: { title: `${attack.name}: ${i18n("AD2E.Weapon.Damage")}` },
      content: (weapon && options.length > 1 ? `<div class="form-group"><label>${i18n("AD2E.Weapon.Ammo")}</label><select name="option">${
        options.map((d, i) => `<option value="${i}">${d.label} (${d.sm ?? "—"} / ${d.l ?? "—"})</option>`).join("")}</select></div>` : "")
        + (weapon ? `<div class="form-group"><label>${i18n("AD2E.Weapon.TargetSize")}</label><select name="size">`
          + `<option value="sm">${i18n("AD2E.Weapon.SM")}</option><option value="l">${i18n("AD2E.Weapon.L")}</option></select></div>` : "")
        + (attack.melee ? AD2EActor.#armedDefenderField() : "")
        + AD2EActor.#critField(lastCrit)
        + modifierFields({ autofocus: !weapon }),
      ok: { label: i18n("AD2E.Roll.Roll"), callback: (event, button) => ({
        option: Number(button.form.elements.option?.value ?? 0), size: button.form.elements.size?.value ?? "sm",
        vsUnarmed: !!button.form.elements.vsUnarmed?.checked, critical: Number(button.form.elements.critical?.value ?? 0) || 0,
        ...readModifier(button.form) }) },
      rejectClose: false
    });
    if (!input) return;
    if (weapon) {
      const opt = options[input.option] ?? options[0];
      formula = opt[input.size] ?? opt.sm ?? opt.l;
      label = `${opt.label ? ` (${opt.label})` : ""} vs ${i18n(input.size === "sm" ? "AD2E.Weapon.SM" : "AD2E.Weapon.L")}`;
    }
    const vsUnarmed = input.vsUnarmed ? COMBAT_TABLES.armedDefender : 0;
    // Critical: one more set of damage dice (two when tripled), before the bonuses (module/criticals.mjs).
    if (input.critical) formula = multiplyDice(formula, 1 + input.critical);
    const roll = await new Roll(`${formula} + @bonus + @mod`, { bonus: attack.dmgBonus + vsUnarmed, mod: input.mod }).evaluate();
    const total = Math.max(roll.total, 1);
    // An elemental attack: its dice for elemental mages and gens of that province (module/elemental.mjs, module/gens.mjs).
    const element = attack.element ? { element: elementFlag(roll, [attack.element], 0, total - roll.total) } : {};
    const message = await roll.toMessage({
      speaker: ChatMessage.getSpeaker({ actor: this }),
      flags: { ad2e: { damage: total, targets, ...element } },
      flavor: `${attack.name}${label} ${i18n("AD2E.Weapon.Damage")}${attack.element ? ` (${i18n(`AD2E.Elemental.Province.${attack.element}`)})` : ""}`
        + `${AD2EActor.#targetText(targets)}` + (total > roll.total ? `: ${total} (${i18n("AD2E.Weapon.Minimum")})` : "")
        + (vsUnarmed ? ` [${game.i18n.format("AD2E.Unarmed.VsUnarmedShort", { bonus: vsUnarmed })}]` : "")
        + (input.auto ? ` [${i18n("AD2E.Weapon.AutoDamage")}]` : "")
        + (input.critical ? ` [${i18n(input.critical > 1 ? "AD2E.Critical.Triple" : "AD2E.Critical.Double")}]` : "")
        + modifierText(input.mod, input.note)
    });
    // Poison (module/poison.mjs): a venomous natural attack (its own method), or a coated weapon (one dose, injected).
    const poisonClass = attack.poisonItem ? await usePoisonDose(attack.poisonItem) : attack.poison;
    if (poisonClass) {
      await requestPoisonSaves({ speaker: ChatMessage.getSpeaker({ actor: this }), cls: poisonClass,
        delivery: attack.poisonItem ? "injected" : "", source: attack.name, targets });
    }
    return message;
  }

  /** Morale check (Morale (DMG)): 2d10 + modifier; the creature stands if the total is at most its morale. */
  async rollMorale() {
    const input = await promptMorale(game.i18n.localize("AD2E.Monster.Morale"));
    if (!input) return;
    // Situational modifiers (DMG Table 50, tick boxes) adjust the morale rating: "Add or subtract the modifiers that
    // apply" (Morale (DMG)).
    const target = this.system.morale.value + (input.sum ?? 0) + input.mod;
    const roll = await new Roll("2d10").evaluate();
    return roll.toMessage({
      speaker: ChatMessage.getSpeaker({ actor: this }),
      flavor: `${game.i18n.localize("AD2E.Monster.Morale")} (${game.i18n.localize("AD2E.Roll.RollUnder")} ${target})`
        + `${input.text ? ` [${foundry.utils.escapeHTML?.(input.text) ?? input.text}]` : ""}${modifierText(input.mod, input.note)}: `
        + game.i18n.localize(roll.total <= target ? "AD2E.Monster.Stands" : "AD2E.Monster.Breaks")
    });
  }

  /** Roll a monster's hit points from its Hit Dice (d8 per die, minimum 1) and set current and maximum HP. */
  async rollMonsterHitPoints() {
    const formula = this.system.hd.formula;
    const roll = await new Roll(formula).evaluate();
    const hp = Math.max(roll.total, 1);
    await roll.toMessage({ speaker: ChatMessage.getSpeaker({ actor: this }),
      flavor: `${game.i18n.localize("AD2E.Monster.HitDice")} ${this.system.hitDice}: ${hp} hp` });
    return this.update({ "system.hp.max": hp, "system.hp.value": hp });
  }

  /**
   * Cast a memorized spell: one fewer remaining until the next rest; posts the spell's game statistics and a link to
   * its full description.
   */
  async castSpell(itemId) {
    const spell = this.items.get(itemId);
    if (!spell || spell.type !== "spell") return;
    const sys = spell.system;
    if (sys.prepared - sys.cast < 1) {
      ui.notifications.warn(game.i18n.format("AD2E.Spell.NotMemorized", { name: spell.name }));
      return;
    }
    // Rider feebleminded after a negligent mount death (module/companions.mjs; owner's ruling: confirm to cast).
    if (this.type === "character" && feeblemindActive(this)) {
      const ok = await ad2eDialog.confirm({ window: { title: spell.name }, rejectClose: false,
        content: `<p class="ad2e-unmet">${foundry.utils.escapeHTML?.(game.i18n.localize("AD2E.Bond.FeebleCast")) ?? ""}</p>` });
      if (!ok) return;
    }
    // Wizard spells in armour (owner's ruling: warn and confirm): "the wearing of armor is restricted" for multi-class
    // wizards, with elves in elven chain as the exception (Multi-Class and Dual-Class Characters (PHB)); bards abide by
    // "the prohibition of armor" (Bard (PHB)); single-class wizards cannot wear armour at all (Wizard (PHB)).
    if (this.type === "character" && sys.kind === "wizard") {
      const worn = this.items.filter(i => i.type === "armor" && i.system.equipped);
      if (worn.length && armorBlocksWizardCasting(worn, this.system.raceInfo?.raceItem?.system.identifier ?? "")) {
        const ok = await ad2eDialog.confirm({ window: { title: spell.name },
          content: `<p class="ad2e-unmet">${foundry.utils.escapeHTML?.(game.i18n.format("AD2E.Spell.ArmorWarning", { armor: worn.map(i => i.name).join(", ") })) ?? ""}</p>`,
          rejectClose: false });
        if (!ok) return;
      }
    }
    // Material components (module/components.mjs; world setting "trackComponents"): missing ones ask to cast anyway.
    const comp = await useComponents(this, spell);
    if (!comp.cast) return;
    // Dual-class: a spell of the earlier class (module/dual-class.mjs) is cast at that class's level and, while the
    // restrictions apply, costs experience.
    const oldCaster = this.type === "character" && this.system.spells?.old?.kind === sys.kind ? this.system.spells.old : null;
    if (oldCaster) await this.markOldClassUse(spell.name);
    const left = sys.prepared - sys.cast - 1;
    // Sha'ir: the spell the gen brought is used up and the gen is free again (module/shair.mjs).
    const fetched = isShair(this) && this.system.gen?.fetch?.spellId === spell.id;
    if (fetched) {
      await retributionNotice(this, spell);
      await clearFetched(this);
    } else await spell.update({ "system.cast": sys.cast + 1 });
    const i18n = k => game.i18n.localize(k);
    const esc = v => foundry.utils.escapeHTML?.(String(v ?? "")) ?? String(v ?? "");
    const comps = ["verbal", "somatic", "material"].filter(c => sys.components[c]).map(c => c[0].toUpperCase()).join(", ");
    const rows = [
      [i18n("AD2E.Spell.Level"), `${sys.level} (${i18n(`AD2E.Spell.${sys.kind}`)})`],
      [i18n(sys.kind === "priest" ? "AD2E.Spell.Spheres" : "AD2E.Spell.Schools"), (sys.kind === "priest" ? sys.spheres : sys.schools).join(", ")],
      [i18n("AD2E.Spell.CastingTime"), sys.castingTime], [i18n("AD2E.Spell.Range"), sys.range],
      [i18n("AD2E.Spell.Area"), sys.area], [i18n("AD2E.Spell.Duration"), sys.duration], [i18n("AD2E.Spell.Save"), sys.save],
      [i18n("AD2E.Spell.Components"), comps], [i18n("AD2E.Spell.CastingLevel"), oldCaster?.castingLevel ?? this.system.spells?.castingLevels?.[sys.kind] ?? this.system.spells?.castingLevel ?? this.system.level]
    ].filter(([, v]) => v !== "" && v !== null && v !== undefined);
    const content = `<div class="ad2e-spell-card"><h3>${esc(spell.name)}${sys.reversible ? ` <em>(${i18n("AD2E.Spell.Reversible")})</em>` : ""}</h3>`
      + `<dl>${rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join("")}</dl>`
      + (sys.url ? `<p><a href="${esc(sys.url)}" target="_blank" rel="noopener">${i18n("AD2E.Spell.FullText")}</a></p>` : "")
      + (comp.used.length ? `<p class="ad2e-note">${esc(game.i18n.format("AD2E.Components.Used", { list: comp.used.join(", ") }))}</p>` : "")
      + (comp.missing.length ? `<p class="ad2e-note ad2e-unmet">${esc(game.i18n.format("AD2E.Components.CastWithout", { list: comp.missing.join(", ") }))}</p>` : "")
      + `<p class="ad2e-note">${game.i18n.format("AD2E.Spell.Remaining", { n: left })}</p></div>`;
    return this.#castAtTargets(spell, content);
  }

  /**
   * The spell card for the targeted tokens: magic resistance rolled for each target that has it (module/magic-resistance.mjs;
   * "lowered" skips it), then, when the spell allows a save, a save request for the others (module/save-requests.mjs;
   * owner's ruling: Save buttons and a GM roll-all). The card carries `flags.ad2e.spellCast` { spell, actor, effect,
   * targets, resisted } for the spell's damage roll (rollSpellDamage).
   */
  async #castAtTargets(spell, card) {
    const speaker = ChatMessage.getSpeaker({ actor: this });
    const esc = v => foundry.utils.escapeHTML?.(String(v ?? "")) ?? String(v ?? "");
    const targets = AD2EActor.#targetsNow();
    const effect = saveEffect(spell.system.save);
    const rolls = [], lines = [], resisted = [], affected = [];
    for (const t of targets) {
      const mr = magicResistanceOf(targetActor(t));
      if (mr.value > 0 && !mr.lowered) {
        const r = await new Roll("1d100").evaluate();
        rolls.push(r);
        const res = resists(mr.value, r.total);
        lines.push(game.i18n.format("AD2E.MR.Line", { name: t.name, roll: r.total, value: mr.value,
          result: game.i18n.localize(res ? "AD2E.MR.Resisted" : "AD2E.MR.Affected") }));
        (res ? resisted : affected).push(t);
      } else {
        if (mr.value > 0) lines.push(game.i18n.format("AD2E.MR.Lowered", { name: t.name }));
        affected.push(t);
      }
    }
    const spellCast = { spell: spell.id, actor: this.uuid, effect, targets, resisted };
    const html = card + (targets.length ? `<p class="ad2e-note">${esc(game.i18n.localize("AD2E.Spell.Targets"))}: ${esc(targets.map(t => t.name).join(", "))}</p>` : "")
      + (lines.length ? `<ul class="ad2e-mr">${lines.map(l => `<li>${esc(l)}</li>`).join("")}</ul>` : "");
    if (affected.length && effect !== "none") {
      return createSaveRequest({ speaker, key: spell.system.saveType ?? "sp", kind: "spell", rolls, targets: affected, data: { effect },
        content: html + `<p class="ad2e-note">${esc(game.i18n.format("AD2E.Spell.SaveAsk", { save: game.i18n.localize(`AD2E.Save.${spell.system.saveType ?? "sp"}`),
          effect: game.i18n.localize(`AD2E.Spell.SaveEffect.${effect}`) }))}</p>`, flags: { spellCast } });
    }
    return ChatMessage.create({ speaker, rolls, content: html, flags: { ad2e: { spellCast } } });
  }

  /** The latest chat card of this actor casting `spell` (flags.ad2e.spellCast), or null. */
  #lastCast(spell) {
    const list = game.messages?.contents ?? [];
    for (let i = list.length - 1; i >= 0; i--) {
      const sc = list[i].getFlag?.("ad2e", "spellCast");
      if (sc?.spell === spell.id && sc.actor === this.uuid) return list[i];
    }
    return null;
  }

  /**
   * Spell damage or healing: one of the spell's options (read from its page at import, module/importers/spell-damage.mjs;
   * @level = casting level), chosen in the dialog when there are several, with a situational modifier. An elemental mage
   * casting a spell of its province adds +1 per damage die (module/elemental.mjs); the message carries the dice for
   * elemental mages hit by it, and the targeted tokens. Healing messages are applied as healing (module/health.mjs).
   */
  async rollSpellDamage(itemId) {
    const spell = this.items.get(itemId);
    const sys = spell?.system;
    const options = (sys?.damage ?? []).filter(d => d.formula);
    if (!spell || spell.type !== "spell" || !options.length) return;
    const i18n = k => game.i18n.localize(k);
    const esc = v => foundry.utils.escapeHTML?.(String(v ?? "")) ?? String(v ?? "");
    const pick = options.length > 1 ? `<div class="form-group"><label>${i18n("AD2E.Spell.DamageOption")}</label><select name="option">${
      options.map((d, i) => `<option value="${i}">${esc(spellDamageLabel(d, i))}</option>`).join("")}</select></div>` : "";
    const input = await promptModifier(`${spell.name}: ${i18n(options.length === 1 && options[0].kind === "healing" ? "AD2E.Spell.Healing" : "AD2E.Weapon.Damage")}`,
      { extra: pick, read: form => ({ option: Number(form.elements.option?.value ?? 0) }) });
    if (!input) return;
    const option = options[input.option] ?? options[0];
    const healing = option.kind === "healing";
    const level = this.system.spells?.castingLevels?.[spell.system.kind] ?? this.system.spells?.castingLevel ?? this.system.level ?? 1;
    let roll;
    try {
      roll = await new Roll(`${option.formula} + @mod`, { level, mod: input.mod }).evaluate();
    } catch (err) {
      ui.notifications.error(game.i18n.format("AD2E.Spell.BadDamage", { name: spell.name, formula: option.formula }));
      return;
    }
    const provinces = healing ? [] : (sys.provinces ?? []);
    const per = healing ? 0 : dieBonus(this, provinces);
    const bonus = per * diceCount(roll);
    const total = Math.max(roll.total + bonus, 0);
    // The last casting's targets (#castAtTargets): those who resisted take nothing; with a save request, failed and
    // unrolled saves take the full damage and successful saves half ("1/2"), none ("Neg.") or the full damage marked
    // for the GM ("special").
    const cast = healing ? null : this.#lastCast(spell);
    const sc = cast?.getFlag("ad2e", "spellCast");
    let targets = AD2EActor.#targetsNow();
    let split = null;
    if (sc?.targets?.length) {
      const request = cast.getFlag("ad2e", "saveRequest");
      const resistedIds = new Set((sc.resisted ?? []).map(t => t.uuid));
      const groups = request ? groupResults(request) : { saved: [], failed: [], open: sc.targets.filter(t => !resistedIds.has(t.uuid)) };
      const ref = t => ({ uuid: t.uuid, name: t.name });
      targets = [...groups.failed, ...groups.open].map(ref);
      split = { effect: sc.effect, saved: groups.saved.map(ref), open: groups.open.map(ref), resisted: sc.resisted ?? [] };
    }
    const notes = split ? [
      split.resisted.length ? game.i18n.format("AD2E.Spell.ResistedNote", { names: split.resisted.map(t => t.name).join(", ") }) : "",
      split.open.length && cast.getFlag("ad2e", "saveRequest") ? game.i18n.format("AD2E.Spell.UnrolledNote", { names: split.open.map(t => t.name).join(", ") }) : "",
      split.saved.length && split.effect === "negates" ? game.i18n.format("AD2E.Spell.NegatedNote", { names: split.saved.map(t => t.name).join(", ") }) : ""
    ].filter(Boolean) : [];
    const message = await roll.toMessage({
      speaker: ChatMessage.getSpeaker({ actor: this }),
      flags: { ad2e: { damage: total, targets, ...(healing ? { healing: true } : {}),
        ...(provinces.length ? { element: elementFlag(roll, provinces, per, bonus) } : {}) } },
      flavor: `${esc(spell.name)} ${i18n(healing ? "AD2E.Spell.Healing" : "AD2E.Weapon.Damage")}`
        + `${options.length > 1 ? ` — ${esc(spellDamageLabel(option, options.indexOf(option)))}` : (option.perRound ? ` (${i18n("AD2E.Spell.PerRound")})` : "")}`
        + ` (${i18n("AD2E.Spell.CastingLevel")} ${level}`
        + `${provinces.length ? `; ${provinces.map(p => i18n(`AD2E.Elemental.Province.${p}`)).join(", ")}` : ""})`
        + (targets.length ? ` vs ${esc(targets.map(t => t.name).join(", "))}` : "")
        + modifierText(input.mod, input.note)
        + (bonus ? ` [${game.i18n.format("AD2E.Elemental.DieBonusNote", { province: i18n(`AD2E.Elemental.Province.${elementOf(this)}`), n: bonus })}]: ${total}` : "")
        + (notes.length ? ` [${esc(notes.join("; "))}]` : "")
    });
    // Saved targets: half damage, or the full damage marked "special" for the GM's ruling.
    if (split?.saved.length && (split.effect === "half" || split.effect === "special")) {
      const amount = split.effect === "half" ? Math.floor(total / 2) : total;
      await ChatMessage.create({ speaker: ChatMessage.getSpeaker({ actor: this }),
        flags: { ad2e: { damage: amount, targets: split.saved, ...(provinces.length ? { element: elementFlag(roll, provinces, per, bonus) } : {}) } },
        content: `<p>${esc(game.i18n.format(split.effect === "half" ? "AD2E.Spell.SavedHalf" : "AD2E.Spell.SavedSpecial",
          { name: spell.name, damage: amount, names: split.saved.map(t => t.name).join(", ") }))}</p>` });
    }
    return message;
  }


  /**
   * Rest: every memorized spell can be cast again (memorization itself is kept; change it on the Spells tab) and
   * daily class abilities (paladin lay on hands) are restored.
   */
  async restSpells() {
    const updates = this.items.filter(i => i.type === "spell" && i.system.cast > 0).map(i => ({ _id: i.id, "system.cast": 0 }));
    if (updates.length) await this.updateEmbeddedDocuments("Item", updates);
    if (this.type === "character" && this.system.classAbilities.layOnHandsUsed) {
      await this.update({ "system.classAbilities.layOnHandsUsed": false });
    }
    ui.notifications.info(game.i18n.format("AD2E.Ability2.Rested", { name: this.name }));
  }

  /**
   * Thief skill, bard ability or ranger stealth: d100 (percentile) + modifier, success at or below the skill's total
   * (Thief Skill Explanations (PHB)). Rangers may halve the chance outside natural surroundings (Ranger (PHB)).
   * Find/remove traps: a roll of 96-100 sets the trap off.
   */
  async rollClassSkill(key) {
    const info = this.system.classAbilities?.info;
    const skill = info?.skills.find(s => s.key === key);
    if (!skill) return;
    const i18n = k => game.i18n.localize(k);
    const name = i18n(`AD2E.Skill.${key}`);
    if (!skill.available) {
      ui.notifications.warn(`${name}: ${i18n(skill.belowOne && !info.armorBlocked ? "AD2E.Skill.BelowOne" : "AD2E.Skill.HeavyArmor")}`);
      return;
    }
    const ranger = (info.skillClassId ?? info.classId) === "ranger";
    if (info.old?.skills) await this.markOldClassUse(name);
    const kitOptions = this.#kitOptions("skill", key);
    // Find/Remove Traps (module/traps.mjs): the targeted trap's difficulty (up to +/-30%, CTH) and a silent attempt (-10%,
    // a click on 01-10). Open Locks may also be silent.
    const traps = key === "rt" ? targetedTraps() : [];
    const esc = v => foundry.utils.escapeHTML?.(String(v ?? "")) ?? String(v ?? "");
    const trapField = traps.length ? `<div class="form-group"><label>${i18n("AD2E.Trap.Which")}</label><select name="trap">`
      + traps.map((t, i) => `<option value="${i}">${esc(t.name)} (${t.modifier >= 0 ? "+" : ""}${t.modifier}%)</option>`).join("") + "</select></div>" : "";
    const silentField = ["rt", "ol"].includes(key) ? `<div class="form-group"><label>${esc(game.i18n.format("AD2E.Trap.Silent", { n: TRAP.silent, noise: TRAP.silentNoise }))}</label><input type="checkbox" name="silent"></div>` : "";
    const input = await ad2eDialog.prompt({
      window: { title: name },
      content: trapField + silentField + (ranger ? `<div class="form-group"><label>${i18n("AD2E.Skill.Halved")}</label><input type="checkbox" name="halved"></div>` : "")
        + modifierFields({ unit: "%", autofocus: true })
        + this.#kitFields(kitOptions, "%"),
      ok: { label: i18n("AD2E.Roll.Roll"), callback: (event, button) => {
        const kit = AD2EActor.#kitPicked(button.form, kitOptions);
        const m = readModifier(button.form);
        const trap = traps[Number(button.form.elements.trap?.value ?? -1)] ?? null;
        const silent = !!button.form.elements.silent?.checked;
        return { mod: m.mod + kit.sum + (trap?.modifier ?? 0) + (silent ? TRAP.silent : 0), halved: !!button.form.elements.halved?.checked,
          kitText: [kit.text, trap ? `${trap.name} ${trap.modifier >= 0 ? "+" : ""}${trap.modifier}%` : "", silent ? i18n("AD2E.Trap.SilentShort") : ""].filter(Boolean).join("; "),
          manual: m, silent };
      } },
      rejectClose: false
    });
    if (!input) return;
    let target = (input.halved ? Math.floor(skill.total / 2) : skill.total) + input.mod;
    if (info.classId === "thief") target = Math.min(target, AD2E.skillClasses.thief.cap);
    const roll = await new Roll("1d100").evaluate();
    const success = roll.total <= target;
    const trap = key === "rt" && roll.total >= AD2E.trapSpringRoll;
    const noise = input.silent && roll.total <= TRAP.silentNoise;
    return roll.toMessage({
      speaker: ChatMessage.getSpeaker({ actor: this }),
      flavor: `${name} (${i18n("AD2E.Roll.RollUnder")} ${target}%${input.halved ? `, ${i18n("AD2E.Skill.Halved")}` : ""}${input.kitText ? `; ${input.kitText}` : ""})${modifierText(input.manual?.mod, input.manual?.note, "%")}: `
        + i18n(success ? "AD2E.Skill.Success" : "AD2E.Skill.Failure")
        + (trap ? ` — ${i18n("AD2E.Skill.TrapSprung")}` : "")
        + (noise ? ` — ${i18n("AD2E.Trap.Noise")}` : "")
    });
  }

  /**
   * Turn undead (Turning Undead (PHB), Table 61): choose the undead type; 1d20 equal to or above the number turns; T
   * turns and D destroys automatically; D* destroys and 2d4 more are destroyed; a success affects 2d6 undead.
   */
  async rollTurnUndead() {
    const level = this.system.classAbilities?.info?.turnLevel;
    if (!level) return;
    if (this.system.classAbilities.info.old?.turnLevel) await this.markOldClassUse(game.i18n.localize("AD2E.Ability2.TurnUndead"));
    const t = AD2E.classTables.turnUndead;
    const col = t.columns.findIndex(([lo, hi]) => level >= lo && level <= hi);
    const i18n = k => game.i18n.localize(k);
    const esc = v => foundry.utils.escapeHTML?.(String(v ?? "")) ?? String(v ?? "");
    const input = await ad2eDialog.prompt({
      window: { title: game.i18n.format("AD2E.Ability2.TurnRoll", { level }) },
      content: `<p class="ad2e-note">${i18n("AD2E.Ability2.TurnHint")}</p>`
        + `<div class="form-group"><label>${i18n("AD2E.Ability2.Undead")}</label><select name="row">${
          t.rows.map((r, i) => `<option value="${i}">${esc(r.undead)} (${esc(r.results[col])})</option>`).join("")}</select></div>`
        + modifierFields(),
      ok: { label: i18n("AD2E.Roll.Roll"), callback: (event, button) => ({
        row: Number(button.form.elements.row.value) || 0, ...readModifier(button.form) }) },
      rejectClose: false
    });
    if (!input) return;
    const row = t.rows[input.row];
    const result = row.results[col] ?? "—";
    const flavor = `${i18n("AD2E.Ability2.TurnUndead")}: ${esc(row.undead)} (${game.i18n.format("AD2E.Ability2.TurnLevel", { level })}, ${esc(result)})`
      + modifierText(input.mod, input.note);
    const speaker = ChatMessage.getSpeaker({ actor: this });
    if (!/^\d+$/.test(result) && !["T", "D", "D*"].includes(result)) {
      return ChatMessage.create({ speaker, content: `<p>${flavor}: ${i18n("AD2E.Ability2.Cannot")}</p>` });
    }
    const rolls = [];
    let success = true;
    let outcome = result.startsWith("D") ? "Dispelled" : "Turned";
    if (/^\d+$/.test(result)) {
      const d20 = await new Roll("1d20 + @mod", { mod: input.mod }).evaluate();
      rolls.push(d20);
      success = d20.total >= Number(result);
      outcome = success ? "Turned" : "Failed";
    }
    const lines = [`${flavor}: <strong>${i18n(`AD2E.Ability2.${outcome}`)}</strong>`];
    if (success) {
      const count = await new Roll("2d6").evaluate();
      rolls.push(count);
      lines.push(game.i18n.format("AD2E.Ability2.Affected", { n: count.total }));
      if (result === "D*") {
        const extra = await new Roll("2d4").evaluate();
        rolls.push(extra);
        lines.push(game.i18n.format("AD2E.Ability2.Extra", { n: extra.total }));
      }
    }
    const rollText = rolls.map(r => `${r.formula} = ${r.total}`).join("; ");
    return ChatMessage.create({ speaker, rolls, content: `<p>${lines.join("<br>")}</p><p class="ad2e-note">${rollText}</p>` });
  }

  /** Paladin lay on hands: heals 2 hit points per level, once a day (Paladin (PHB)); restored by resting. */
  async layOnHands() {
    const info = this.system.classAbilities?.info?.layOnHands;
    if (!info) return;
    if (info.used) {
      ui.notifications.warn(game.i18n.localize("AD2E.Ability2.LayOnHandsUsed"));
      return;
    }
    if (this.system.classAbilities.info.old?.layOnHands) await this.markOldClassUse(game.i18n.localize("AD2E.Ability2.LayOnHands"));
    await this.update({ "system.classAbilities.layOnHandsUsed": true });
    return ChatMessage.create({ speaker: ChatMessage.getSpeaker({ actor: this }),
      content: `<p>${game.i18n.format("AD2E.Ability2.LayOnHandsChat", { hp: info.hp })}</p>` });
  }

  /**
   * Use a magical item: spends a charge (items with charges) or one from the quantity (potions, scrolls, dusts),
   * and posts the item to chat with what is left and a link to its description. Other items are just announced.
   */
  async useMagicItem(itemId) {
    const item = this.items.get(itemId);
    if (!item || item.type !== "magic") return;
    const sys = item.system;
    const i18n = k => game.i18n.localize(k);
    const esc = v => foundry.utils.escapeHTML?.(String(v ?? "")) ?? String(v ?? "");
    let left = "";
    if (sys.usesCharges) {
      if (sys.charges.value < 1) {
        ui.notifications.warn(game.i18n.format("AD2E.Magic.NoCharges", { name: item.name }));
        return;
      }
      const n = sys.charges.value - 1;
      await item.update({ "system.charges.value": n });
      left = game.i18n.format("AD2E.Magic.ChargesLeft", { n, max: sys.charges.max });
    } else if (sys.consumable) {
      if (sys.quantity < 1) {
        ui.notifications.warn(game.i18n.format("AD2E.Magic.NoneLeft", { name: item.name }));
        return;
      }
      const n = sys.quantity - 1;
      await item.update({ "system.quantity": n });
      left = game.i18n.format("AD2E.Ammo.Left", { name: item.name, n });
    }
    const content = `<div class="ad2e-spell-card"><h3>${esc(item.name)}</h3>`
      + `<p>${esc(game.i18n.format("AD2E.Magic.Used", { name: this.name, item: item.name }))}</p>`
      + (left ? `<p class="ad2e-note">${esc(left)}</p>` : "")
      + (sys.url ? `<p><a href="${esc(sys.url)}" target="_blank" rel="noopener">${i18n("AD2E.Spell.FullText")}</a></p>` : "")
      + `</div>`;
    return ChatMessage.create({ speaker: ChatMessage.getSpeaker({ actor: this }), content });
  }

  /**
   * Surprise ("The Surprise Roll (PHB)"): 1d10, surprised on 1-3; a plus makes surprise less likely. Modifiers:
   * Dexterity reaction adjustment ("Dexterity (PHB)": it "modifies the die roll to see if a character is surprised"),
   * kit surprise modifiers (applied or ticked), DMG Table 57 situations, and a manual modifier with reason.
   */
  async rollSurprise() {
    const i18n = k => game.i18n.localize(k);
    const esc = v => foundry.utils.escapeHTML?.(String(v ?? "")) ?? String(v ?? "");
    const T = AD2E.encounterTables;
    const dex = this.type === "character" ? (this.system.abilityData?.dex?.reaction ?? 0) : 0;
    const kitAuto = this.type === "character" ? (this.system.kitMods?.total("surprise") ?? 0) : 0;
    // A living familiar within reach: "+1 bonus to all surprise die rolls" (Find Familiar (Wizard Spell)).
    const familiar = familiarSurpriseBonus(this);
    const kitOptions = this.#kitOptions("surprise");
    const sign = v => `${v > 0 ? "+" : ""}${v}`;
    const groups = ["other", "party", "conditions"].map(g => {
      const mods = T.modifiers.filter(m => m.group === g);
      const boxes = mods.filter(m => m.values.length === 1 && m.key !== "every-10-members")
        .map(m => `<label><input type="checkbox" name="t57-${m.key}" value="${m.values[0]}"> ${esc(m.label)} (${sign(m.values[0])})</label>`).join("");
      const other = mods.filter(m => m.values.length > 1 || m.key === "every-10-members").map(m => m.key === "every-10-members"
        ? `<div class="form-group"><label>${esc(m.label)} (${sign(m.values[0])})</label><input type="number" name="members" value="0" min="0" step="1" placeholder="${i18n("AD2E.Surprise.Members")}"></div>`
        : `<div class="form-group"><label>${esc(m.label)}</label><select name="t57-${m.key}"><option value="0">—</option>${m.values.map(v => `<option value="${v}">${sign(v)}</option>`).join("")}</select></div>`).join("");
      return `<fieldset><legend>${i18n(`AD2E.Surprise.Group.${g}`)}</legend><div class="ad2e-check-grid">${boxes}</div>${other}</fieldset>`;
    }).join("");
    const fixed = [dex ? `${i18n("AD2E.Surprise.Dex")} ${dex > 0 ? "+" : ""}${dex}` : "", kitAuto ? `${i18n("AD2E.Surprise.Kit")} ${kitAuto > 0 ? "+" : ""}${kitAuto}` : "",
      familiar ? `${i18n("AD2E.Familiar.Surprise")} +${familiar}` : ""].filter(Boolean).join(" · ");
    const input = await ad2eDialog.prompt({
      // Class "ad2e": opaque background (module/opaque-windows.mjs). The situations scroll inside their own box so the
      // dialog stays within the screen and the Roll button visible.
      classes: ["ad2e"], position: { width: 520 },
      window: { title: `${this.name}: ${i18n("AD2E.Surprise.Title")}` },
      content: `<p class="ad2e-note">${i18n("AD2E.Surprise.Hint")}${fixed ? ` ${esc(fixed)}` : ""}</p>`
        + `<div class="ad2e-dialog-scroll">${groups}</div>` + modifierFields() + this.#kitFields(kitOptions),
      ok: { label: i18n("AD2E.Roll.Roll"), callback: (event, button) => {
        const f = button.form;
        const picked = [];
        let table = 0;
        for (const m of T.modifiers) {
          if (m.key === "every-10-members") {
            const n = Math.floor((Number(f.elements.members?.value) || 0) / 10) * m.values[0];
            if (n) { table += n; picked.push(`${m.label} ${n > 0 ? "+" : ""}${n}`); }
            continue;
          }
          const el = f.elements[`t57-${m.key}`];
          const v = el?.type === "checkbox" ? (el.checked ? Number(el.value) : 0) : Number(el?.value) || 0;
          if (v) { table += v; picked.push(`${m.label} ${v > 0 ? "+" : ""}${v}`); }
        }
        const kit = AD2EActor.#kitPicked(f, kitOptions);
        return { ...readModifier(f), table, picked, kit: kit.sum, kitText: kit.text };
      } },
      rejectClose: false
    });
    if (!input) return;
    const roll = await new Roll("1d10 + @dex + @kit + @familiar + @table + @mod", { dex, kit: kitAuto + input.kit, familiar, table: input.table, mod: input.mod }).evaluate();
    const surprised = roll.total <= T.surprisedOn;
    const parts = [...input.picked, input.kitText, familiar ? `${i18n("AD2E.Familiar.Surprise")} +${familiar}` : ""].filter(Boolean).join("; ");
    return roll.toMessage({ speaker: ChatMessage.getSpeaker({ actor: this }),
      flavor: `${i18n("AD2E.Surprise.Title")} (${game.i18n.format("AD2E.Surprise.On", { n: T.surprisedOn })}${parts ? `; ${parts}` : ""})`
        + `${modifierText(input.mod, input.note)}: ${i18n(surprised ? "AD2E.Surprise.Surprised" : "AD2E.Surprise.NotSurprised")}` });
  }

  /**
   * Individual experience award ("Experience Point Awards (DMG)": individual awards are given for what a character
   * does), with the class prime-requisite bonus (10%). Group awards: module/apps/award-xp.mjs.
   */
  async awardExperience() {
    if (this.type !== "character") return;
    const i18n = k => game.i18n.localize(k);
    const multi = this.system.multi;
    const bonus = multi ? 0 : (this.system.classInfo?.xpBonus ?? 0);
    // Dual-class (module/dual-class.mjs): the award is for an encounter or the adventure; the penalty flags apply.
    const dual = this.system.dual;
    const pen = this.system.dualClass?.penalty ?? {};
    const kindField = dual ? `<div class="form-group"><label>${i18n("AD2E.Dual.AwardKind")}</label><select name="kind">`
      + `<option value="encounter"${game.combat ? " selected" : ""}>${i18n("AD2E.Dual.Kind.encounter")}</option>`
      + `<option value="adventure"${game.combat ? "" : " selected"}>${i18n("AD2E.Dual.Kind.adventure")}</option></select></div>`
      + (pen.encounter || pen.adventure ? `<p class="ad2e-note ad2e-unmet">${i18n("AD2E.Dual.PenaltyPending")}</p>` : "") : "";
    const input = await ad2eDialog.prompt({
      window: { title: `${this.name}: ${i18n("AD2E.Xp.AddTitle")}` },
      content: `<div class="form-group"><label>${i18n("AD2E.Xp.Amount")}</label><input type="number" name="amount" value="0" min="0" step="1" autofocus></div>`
        + `<div class="form-group"><label>${i18n("AD2E.Roll.ModifierNote")}</label><input type="text" name="reason" placeholder="${i18n("AD2E.Xp.ReasonHint")}"></div>`
        + kindField
        + (bonus ? `<p class="ad2e-note">${game.i18n.format("AD2E.Xp.BonusNote", { bonus })}</p>` : "")
        + (multi ? `<p class="ad2e-note">${game.i18n.format("AD2E.Multi.AwardNote", { n: multi.classes.length })}</p>` : ""),
      ok: { label: i18n("AD2E.Xp.Award"), callback: (event, button) => ({
        amount: Math.max(Math.floor(Number(button.form.elements.amount.value) || 0), 0), reason: button.form.elements.reason.value.trim(),
        kind: button.form.elements.kind?.value ?? "adventure" }) },
      rejectClose: false
    });
    if (!input?.amount) return;
    const esc = v => foundry.utils.escapeHTML?.(String(v ?? "")) ?? String(v ?? "");
    // Multi-class: divided equally between the classes, each share with its own prime requisite bonus (owner's ruling).
    if (multi) {
      const award = multiAward(multi.classes, input.amount);
      await this.update(award.update);
      const parts = award.rows.map(r => `${r.name} +${r.gain}${r.bonus ? ` (${game.i18n.format("AD2E.Xp.WithBonus", { bonus: r.bonus })})` : ""} → ${r.xp}`
        + (r.canLevel ? ` <strong>${esc(game.i18n.localize("AD2E.Xp.CanLevel"))}</strong>` : ""));
      return ChatMessage.create({ speaker: ChatMessage.getSpeaker({ actor: this }), content: `<p>${esc(game.i18n.format("AD2E.Multi.Gained",
        { name: this.name, gain: award.gain }))}${input.reason ? ` — ${esc(input.reason)}` : ""}</p><ul><li>${parts.join("</li><li>")}</li></ul>` });
    }
    const full = Math.floor(input.amount * (100 + bonus) / 100);
    const penalized = dual ? penalizedAward(full, input.kind, pen) : { gain: full, rule: "", clear: {} };
    const gain = penalized.gain;
    const xp = (this.system.xp ?? 0) + gain;
    await this.update({ "system.xp": xp,
      ...Object.fromEntries(Object.entries(penalized.clear).map(([k, v]) => [`system.dualClass.penalty.${k}`, v])) });
    if (penalized.rule) input.reason = [input.reason, i18n(`AD2E.Dual.Award.${penalized.rule}`)].filter(Boolean).join("; ");
    const next = this.system.xpNext;
    return ChatMessage.create({ speaker: ChatMessage.getSpeaker({ actor: this }), content: `<p>${esc(game.i18n.format("AD2E.Xp.Gained",
      { name: this.name, gain, xp }))}${bonus ? ` (${esc(game.i18n.format("AD2E.Xp.WithBonus", { bonus }))})` : ""}${input.reason ? ` — ${esc(input.reason)}` : ""}`
      + `${next !== null && next !== undefined && xp >= next ? ` <strong>${esc(i18n("AD2E.Xp.CanLevel"))}</strong>` : ""}</p>` });
  }

  /* ---------------------------------------- Hit points, death and healing (module/health.mjs) */

  /** Chat line about this actor's hit points. */
  async #hpMessage(text, rolls = []) {
    const esc = v => foundry.utils.escapeHTML?.(String(v ?? "")) ?? String(v ?? "");
    return ChatMessage.create({ speaker: ChatMessage.getSpeaker({ actor: this }), rolls, content: `<p>${esc(text)}</p>` });
  }

  /** "unconscious" / "dead" / "" for chat. */
  #stateText(state) {
    return state && state !== "ok" ? ` — ${game.i18n.localize(`AD2E.Health.State.${state}`)}` : "";
  }

  /**
   * Take damage. A single attack of 50 or more points calls for a saving throw vs. death (paralyzation, poison, death
   * magic); failure kills ("Death From Massive Damage", Character Death (PHB)). `bleeding`: the Death's Door loss of
   * 1 hit point per round.
   */
  async applyDamage(amount, { single = true, bleeding = false, kind = "normal", temp = 0 } = {}) {
    const n = Math.max(Math.floor(Number(amount) || 0), 0);
    const hp = this.system.hp;
    if (!n || !hp) return;
    if (this.system.hpState?.state === "dead") {
      ui.notifications.info(game.i18n.format("AD2E.Health.AlreadyDead", { name: this.name }));
      return;
    }
    const fmt = (k, d) => game.i18n.format(k, d);
    const before = hp.value;
    const after = before - n;
    const update = { "system.hp.value": after };
    if (after <= 0 && hp.value > 0 && "stable" in hp) update["system.hp.stable"] = false;
    const rolls = [];
    let note = "";
    // Temporary damage (Attacking Without Killing (PHB)): punching damage is recorded separately; the temporary half
    // of a non-lethal weapon attack returns one turn after the fight.
    if (kind === "punch") {
      update["system.hp.punch"] = (hp.punch ?? 0) + n;
      note = ` ${fmt("AD2E.Health.PunchNote", { n })}`;
    } else if (kind === "nonlethal") {
      const t = Math.min(Math.max(Math.floor(Number(temp) || 0), 0), n);
      update["system.hp.temp"] = (hp.temp ?? 0) + t;
      update["system.hp.tempUntil"] = null;
      note = ` ${fmt("AD2E.Health.TempNote", { n: t })}`;
    }
    if (single && !bleeding && kind === "normal" && n >= MASSIVE_DAMAGE) {
      const save = this.system.saves?.par;
      const target = save?.value ?? 20;
      const roll = await new Roll("1d20 + @bonus", { bonus: save?.bonus ?? 0 }).evaluate();
      rolls.push(roll);
      const survived = roll.total >= target;
      note = ` ${fmt(survived ? "AD2E.Health.MassiveSaved" : "AD2E.Health.MassiveFailed", { roll: roll.total, target })}`;
      if (!survived) {
        update["system.hp.dead"] = true;
        update["system.hp.value"] = Math.min(after, 0);
      }
    }
    await this.update(update);
    const state = this.system.hpState?.state;
    const key = bleeding ? "AD2E.Health.Bleeds" : "AD2E.Health.Damaged";
    return this.#hpMessage(fmt(key, { name: this.name, n, before, after: this.system.hp.value }) + note
      + this.#stateText(state), rolls);
  }

  /**
   * Heal (magical, or `natural` from rest). Never above maximum hit points; no effect on the dead ("Curative and healing
   * spells have no effect on a dead character"). Death's Door: a cure on an unconscious character restores 1 hit point
   * only and leaves him feeble; further cures do no good until a day of rest.
   */
  async applyHealing(amount, { natural = false } = {}) {
    const n = Math.max(Math.floor(Number(amount) || 0), 0);
    const hp = this.system.hp;
    const st = this.system.hpState ?? {};
    if (!n || !hp) return;
    const fmt = (k, d) => game.i18n.format(k, d);
    if (st.state === "dead") {
      ui.notifications.warn(fmt("AD2E.Health.NoHealingDead", { name: this.name }));
      return;
    }
    // Debilitating poison: "cannot heal by normal or magical means until the poison is neutralized or the duration of
    // the debilitation is elapsed" (Poison (DMG)).
    if (this.system.debilitated) {
      ui.notifications.warn(fmt("AD2E.Poison.NoHealing", { name: this.name }));
      return;
    }
    if (!natural && hp.feeble) {
      ui.notifications.warn(fmt("AD2E.Health.FeebleNoCure", { name: this.name }));
      return;
    }
    const update = {};
    let after;
    if (st.doorRule && hp.value <= 0 && !natural) {
      after = 1;
      update["system.hp.feeble"] = true;
    } else after = Math.min(hp.value + n, hp.max);
    update["system.hp.value"] = after;
    if (after > 0 && "stable" in hp) update["system.hp.stable"] = false;
    const before = hp.value;
    await this.update(update);
    return this.#hpMessage(fmt("AD2E.Health.Healed", { name: this.name, n: after - before, before, after })
      + (update["system.hp.feeble"] ? ` ${game.i18n.localize("AD2E.Health.NowFeeble")}` : "") + this.#stateText(this.system.hpState?.state));
  }

  /**
   * Temporary damage returns (Attacking Without Killing (PHB)): `punch` - 75% of the punching damage taken (the end
   * of the fight); `temp` - the temporary part of non-lethal weapon damage (one turn after the fight). Never above
   * maximum hit points.
   */
  async recoverTemporary({ punch = true, temp = true } = {}) {
    const hp = this.system.hp;
    if (!hp) return;
    const doPunch = punch && hp.punch > 0;
    const doTemp = temp && hp.temp > 0;
    if (!doPunch && !doTemp) return;
    const back = (doPunch ? punchRestore(hp.punch) : 0) + (doTemp ? hp.temp : 0);
    const update = {};
    if (doPunch) update["system.hp.punch"] = 0;
    if (doTemp) { update["system.hp.temp"] = 0; update["system.hp.tempUntil"] = null; }
    const before = hp.value;
    const lasting = doPunch ? hp.punch - punchRestore(hp.punch) : 0;
    const dead = this.system.hpState?.state === "dead";
    update["system.hp.value"] = dead ? before : Math.min(before + back, Math.max(hp.max, before));
    await this.update(update);
    return this.#hpMessage(game.i18n.format("AD2E.Health.TempRecovered", { name: this.name, n: dead ? 0 : this.system.hp.value - before,
      before, after: this.system.hp.value }) + (lasting ? ` ${game.i18n.format("AD2E.Health.PunchLasting", { n: lasting })}` : "")
      + this.#stateText(this.system.hpState?.state));
  }

  /** Death's Door: a round spent binding an unconscious character's wounds stops the loss of 1 hit point per round. */
  async bindWounds() {
    if (this.system.hpState?.state !== "unconscious" || this.system.hp.stable) return;
    await this.update({ "system.hp.stable": true });
    return this.#hpMessage(game.i18n.format("AD2E.Health.Bound", { name: this.name }));
  }

  /**
   * Natural healing over days of rest (Healing (PHB)): 1 hit point a day, or 3 a day of complete bed rest plus the
   * Constitution hit point bonus for each complete week of bed rest. A day of rest ends the feeble state.
   */
  async restHeal() {
    const i18n = k => game.i18n.localize(k);
    const input = await ad2eDialog.prompt({
      window: { title: game.i18n.format("AD2E.Health.RestTitle", { name: this.name }) },
      content: `<div class="form-group"><label>${i18n("AD2E.Health.Days")}</label><input type="number" name="days" value="1" min="1" step="1" autofocus></div>`
        + `<div class="form-group"><label>${i18n("AD2E.Health.BedRest")}</label><input type="checkbox" name="bed"></div>`
        + `<p class="ad2e-note">${i18n("AD2E.Health.RestHint")}</p>`,
      ok: { label: i18n("AD2E.Health.Rest"), callback: (event, button) => ({
        days: Math.max(Math.floor(Number(button.form.elements.days.value) || 0), 0), bed: !!button.form.elements.bed.checked }) },
      rejectClose: false
    });
    if (!input?.days) return;
    if (this.system.hpState?.state === "dead") {
      ui.notifications.warn(game.i18n.format("AD2E.Health.NoHealingDead", { name: this.name }));
      return;
    }
    if (this.system.hp.feeble) await this.update({ "system.hp.feeble": false });
    // Fast Healer trait: "naturally heals at a rate of 2 hit points, not 1, per day" (normal rest; bed rest unchanged).
    const n = naturalHealing(input.days, input.bed, this.system.mods?.conHp ?? 0, this.system.traits?.ids?.includes("fast-healer") ? 2 : 1);
    const room = this.system.hp.max - this.system.hp.value;
    if (n > 0 && room > 0) return this.applyHealing(n, { natural: true });
    return this.#hpMessage(game.i18n.format("AD2E.Health.Rested", { name: this.name, days: input.days }));
  }

  /**
   * Raise dead (Character Death (PHB), "Raising the Dead"): resurrection survival roll on the current Constitution
   * (Table 3); success restores life (at 1 hit point; the spell may give more) and lowers Constitution by 1 for good.
   */
  async raiseFromDead() {
    if (this.type !== "character" || this.system.hpState?.state !== "dead") return;
    const chance = this.system.abilityData?.con?.resurrection;
    const con = this.system.abilities.con.value;
    if (con <= 1) {
      ui.notifications.warn(game.i18n.format("AD2E.Health.CannotRaise", { name: this.name }));
      return;
    }
    const roll = await new Roll("1d100").evaluate();
    const ok = roll.total <= chance;
    if (ok) await this.update({ "system.hp.dead": false, "system.hp.stable": false, "system.hp.value": Math.max(1, Math.min(this.system.hp.value, 1)),
      "system.abilities.con.value": con - 1 });
    return roll.toMessage({ speaker: ChatMessage.getSpeaker({ actor: this }),
      flavor: game.i18n.format(ok ? "AD2E.Health.RaiseSuccess" : "AD2E.Health.RaiseFailure", { name: this.name, roll: roll.total, chance, con: con - 1 }) });
  }

  /** Melee attack: hit if d20 + modifiers >= THAC0 - target AC (descending AC). */
  async rollAttack({ missile = false } = {}) {
    const targets = AD2EActor.#targetsNow();
    const input = await promptModifier(game.i18n.localize("AD2E.Roll.Attack"), {
      extra: `<div class="form-group"><label>${game.i18n.localize("AD2E.Roll.TargetAC")}</label><input type="number" name="ac" value="${AD2EActor.#targetAc(targets, missile)}" autofocus></div>`
        + this.#dualField(this.system.dual?.thac0Option) + AD2EActor.#combatModFields(targets),
      read: form => ({ ac: Number(form.elements.ac.value) || 0, t51: AD2EActor.#combatModPicked(form), dualOld: !!form.elements.dualOld?.checked })
    });
    if (!input) return;
    const targetAc = Number(input.ac ?? 10);
    const sys = this.system;
    const adj = missile ? sys.mods.missileAttack : sys.mods.meleeAttack; // includes the encumbrance penalty
    const dualThac0 = input.dualOld ? (sys.dual?.thac0Option ?? null) : null;
    if (dualThac0 !== null) await this.markOldClassUse(game.i18n.format("AD2E.Dual.WhatThac0", { n: dualThac0 }));
    const thac0 = dualThac0 ?? sys.thac0.value;
    const needed = thac0 - targetAc;
    const t51 = input.t51 ?? { sum: 0, auto: false, text: "" };
    const roll = await new Roll("1d20 + @adj + @mod", { adj: adj + t51.sum, mod: input.mod }).evaluate();
    const hit = t51.auto || roll.total >= needed;
    return roll.toMessage({
      speaker: ChatMessage.getSpeaker({ actor: this }),
      flavor: `${game.i18n.localize("AD2E.Roll.Attack")} vs AC ${targetAc}${AD2EActor.#targetText(targets)} `
        + `(THAC0 ${thac0}, ${game.i18n.localize("AD2E.Roll.Needs")} ${needed}+)`
        + `${t51.text ? ` [${foundry.utils.escapeHTML?.(t51.text) ?? t51.text}]` : ""}${modifierText(input.mod, input.note)}: `
        + game.i18n.localize(hit ? "AD2E.Roll.Hit" : "AD2E.Roll.Miss")
    });
  }
}
