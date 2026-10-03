import { AD2E, hitDiceAt } from "../config.mjs";
import { modifierFields, modifierText, promptModifier, readModifier } from "../roll-modifiers.mjs";
import { MASSIVE_DAMAGE, naturalHealing, punchRestore } from "../health.mjs";
import { canFightTwoWeapons, COMBAT_TABLES, nonlethalAllowed, overbearModifier, punchWrestleResult, secondWeaponAllowed,
  twoWeaponPenalty, wrestlingArmor } from "../combat-options.mjs";

const { DialogV2 } = foundry.applications.api;

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

  /** Dialog with a situational modifier (and reason) and the conditional kit modifiers; null when cancelled. */
  async #promptRoll(title, options, unit = "") {
    return DialogV2.prompt({
      window: { title },
      content: modifierFields({ unit, autofocus: true }) + this.#kitFields(options, unit),
      ok: { label: game.i18n.localize("AD2E.Roll.Roll"), callback: (event, button) => {
        const kit = AD2EActor.#kitPicked(button.form, options);
        const { mod, note } = readModifier(button.form);
        return { mod, note, kit: kit.sum, kitText: kit.text };
      } },
      rejectClose: false
    });
  }

  /**
   * Hit points gained on reaching `level`: one hit die + CON adjustment (minimum 1 per die)
   * while the group still gains dice, otherwise the fixed per-level bonus with no CON.
   * Posts the result to chat and returns the number gained.
   */
  async rollHitPointsForLevel(level) {
    const group = this.system.classGroup;
    const cur = hitDiceAt(group, level);
    const prev = level > 1 ? hitDiceAt(group, level - 1) : { dice: 0, bonus: 0 };
    const dice = cur.dice - prev.dice;
    const bonus = cur.bonus - prev.bonus;
    const speaker = ChatMessage.getSpeaker({ actor: this });
    const flavor = game.i18n.format("AD2E.HP.RollFlavor", { level });
    // Kit hit points per level (e.g. Gallant +1 per level, in addition to Constitution).
    const kitHp = this.type === "character" ? (this.system.kitMods?.total("hp") ?? 0) : 0;
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
    const hp = await this.rollHitPointsForLevel(1);
    return this.update({ "system.hp.max": hp, "system.hp.value": hp });
  }

  /** Advance one level and add the hit points gained to current and maximum HP. */
  async levelUp() {
    const level = this.system.level + 1;
    const limit = this.system.classInfo.levelLimit;
    if (limit && level > limit) {
      ui.notifications.warn(game.i18n.format("AD2E.Race.LevelLimitReached", { limit }));
      return null;
    }
    const hp = await this.rollHitPointsForLevel(level);
    return this.update({
      "system.level": level,
      "system.hp.max": this.system.hp.max + hp,
      "system.hp.value": this.system.hp.value + hp
    });
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
    const target = entry.target + input.mod + input.kit;
    const roll = await new Roll("1d20").evaluate();
    const success = roll.total < 20 && roll.total <= target;
    return roll.toMessage({
      speaker: ChatMessage.getSpeaker({ actor: this }),
      flavor: `${item.name} (${game.i18n.localize("AD2E.Roll.RollUnder")} ${target}${input.kitText ? `; ${input.kitText}` : ""})${modifierText(input.mod, input.note)}: `
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
      return foundry.applications.api.DialogV2.wait({
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
    const target = this.system.abilities[key].total + kitAuto + input.mod + input.kit;
    const roll = await new Roll("1d20").evaluate();
    const success = roll.total <= target;
    return roll.toMessage({
      speaker: ChatMessage.getSpeaker({ actor: this }),
      flavor: `${game.i18n.localize(`AD2E.Ability.${key}`)} ${game.i18n.localize("AD2E.Roll.Check")} `
        + `(${game.i18n.localize("AD2E.Roll.RollUnder")} ${target}${input.kitText ? `; ${input.kitText}` : ""})${modifierText(input.mod, input.note)}: `
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

  /** Saving throw: d20 + racial bonus (PHB Table 9, where it applies) + modifier >= save target. */
  async rollSave(key) {
    const input = await this.#promptRoll(game.i18n.localize(`AD2E.Save.${key}`), this.#kitOptions("save", key));
    if (!input) return;
    const mod = input.mod + input.kit;
    const target = this.system.saves[key].value;
    const bonus = this.system.saves[key].bonus;
    const roll = await new Roll(bonus ? "1d20 + @bonus + @mod" : "1d20 + @mod", { bonus, mod }).evaluate();
    const success = roll.total >= target;
    return roll.toMessage({
      speaker: ChatMessage.getSpeaker({ actor: this }),
      flavor: `${game.i18n.localize(`AD2E.Save.${key}`)} (${game.i18n.localize("AD2E.Roll.Needs")} ${target}+${input.kitText ? `; ${input.kitText}` : ""})${modifierText(input.mod, input.note)}: `
        + game.i18n.localize(success ? "AD2E.Roll.Success" : "AD2E.Roll.Failure")
    });
  }

  /**
   * Launchers (bows, crossbows, slings, blowgun) fire ammunition: a missile-only weapon whose damage options
   * come from ammunition rows. Returns the owned ammunition items that fit it (by weapon identifier).
   */
  ammunitionFor(item) {
    const w = item.system.weapon;
    if (!w?.missile || w.melee || !w.damage.some(d => d.label)) return null;
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
    const entry = this.#weaponEntry(itemId);
    const attack = entry?.attack?.[use];
    if (!item || !attack) return;
    const i18n = key => game.i18n.localize(key);
    const status = entry.penalty ? ` [${game.i18n.format("AD2E.Weapon.NotProficient", { penalty: entry.penalty })}]`
      : (entry.specialized && !entry.specInvalid ? ` [${i18n("AD2E.Weapon.Specialized")}]` : "");
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
    const backstab = use === "melee" ? this.#backstabMultiplier() : null;
    const kitOptions = this.#kitOptions("attack");
    const targets = AD2EActor.#targetsNow();
    this.#rememberTargets(itemId, targets);
    const backstabField = backstab ? `<div class="form-group"><label>${i18n("AD2E.Ability2.BackstabAttack")}</label>`
      + `<input type="checkbox" name="backstab"></div>` : "";
    // Two weapons (warriors and rogues, melee) and non-lethal attacks with a blade ("Attacking with Two Weapons (PHB)",
    // "Attacking Without Killing (PHB)").
    const twoWeapons = use === "melee" && this.type === "character" && canFightTwoWeapons(this.system.classGroup);
    const others = twoWeapons ? this.items.filter(i => i.type === "weapon" && i.id !== itemId && i.system.weapon?.melee) : [];
    const twoField = twoWeapons ? `<div class="form-group"><label>${i18n("AD2E.TwoWeapons.Label")}</label><select name="twoWeapon">`
      + `<option value="">—</option><option value="main">${i18n("AD2E.TwoWeapons.main")}</option><option value="off">${i18n("AD2E.TwoWeapons.off")}</option></select></div>`
      + (others.length ? `<div class="form-group"><label>${i18n("AD2E.TwoWeapons.MainWeapon")}</label><select name="mainWeapon">${
        others.map(o => `<option value="${o.id}">${foundry.utils.escapeHTML?.(o.name) ?? o.name}</option>`).join("")}</select></div>` : "") : "";
    const nonlethalOk = use === "melee" && nonlethalAllowed(item.system.weapon);
    const nonlethalField = nonlethalOk ? `<div class="form-group"><label>${i18n("AD2E.Nonlethal.Weapon")} (${COMBAT_TABLES.nonlethal.hit})</label>`
      + `<input type="checkbox" name="nonlethal"></div>` : "";
    const input = await DialogV2.prompt({
      window: { title: `${item.name}: ${i18n(`AD2E.Weapon.${use}`)}` },
      content: `<div class="form-group"><label>${i18n("AD2E.Roll.TargetAC")}</label><input type="number" name="ac" value="${AD2EActor.#targetAc(targets, use === "missile")}" autofocus></div>`
        + ammoField + rangeField + backstabField + twoField + nonlethalField
        + modifierFields()
        + this.#kitFields(kitOptions),
      ok: {
        label: i18n("AD2E.Roll.Roll"),
        callback: (event, button) => {
          const f = button.form.elements;
          const kit = AD2EActor.#kitPicked(button.form, kitOptions);
          const m = readModifier(button.form);
          return { ac: Number(f.ac.value) || 0, mod: m.mod + kit.sum, range: f.range?.value ?? null,
            ammo: f.ammo?.value ?? null, backstab: !!f.backstab?.checked, kitText: kit.text, manual: m,
            twoWeapon: f.twoWeapon?.value || "", mainWeapon: f.mainWeapon?.value ?? null, nonlethal: !!f.nonlethal?.checked };
        }
      },
      rejectClose: false
    });
    if (!input) return;
    const notes = [];
    let twoAdj = 0;
    if (input.twoWeapon) {
      const sys = this.system;
      twoAdj = twoWeaponPenalty(input.twoWeapon, { reaction: sys.abilityData?.dex?.reaction ?? 0,
        ranger: sys.classInfo?.classItem?.system.identifier === "ranger", armorAc: sys.armor?.body?.system.ac ?? null });
      notes.push(`${i18n(`AD2E.TwoWeapons.${input.twoWeapon}`)} ${twoAdj > 0 ? "+" : ""}${twoAdj}`);
      if (sys.armor?.shield) notes.push(i18n("AD2E.TwoWeapons.Shield"));
      const main = input.twoWeapon === "off" ? this.items.get(input.mainWeapon) : null;
      if (main && !secondWeaponAllowed(
        { proficiency: main.system.proficiency, size: main.system.weapon.size, weight: main.system.weight },
        { proficiency: item.system.proficiency, size: item.system.weapon?.size, weight: item.system.weight ?? null })) {
        notes.push(game.i18n.format("AD2E.TwoWeapons.TooLarge", { main: main.name }));
      }
    }
    if (input.nonlethal) notes.push(`${i18n("AD2E.Nonlethal.Weapon")} ${COMBAT_TABLES.nonlethal.hit}`);
    const ammo = input.ammo ? this.items.get(input.ammo) : null;
    if (ammoList && !ammo) return;
    const rangeMod = input.range ? AD2E.rangeModifiers[input.range] : 0;
    const needed = this.system.thac0.value - input.ac;
    // Backstab: +4 for the rear attack (Thief Skill Explanations (PHB)); shield and Dexterity bonuses of the
    // target are ignored, which the target AC entered should reflect.
    const adj = attack.hit + (ammo?.system.bonus.hit ?? 0) + (input.backstab ? AD2E.backstabHit : 0)
      + twoAdj + (input.nonlethal ? COMBAT_TABLES.nonlethal.hit : 0);
    const roll = await new Roll("1d20 + @adj + @range + @mod", { adj, range: rangeMod, mod: input.mod }).evaluate();
    const hit = roll.total >= needed;
    // Use up the piece fired or thrown.
    let spent = "";
    if (ammo) {
      const left = Math.max(ammo.system.quantity - 1, 0);
      await ammo.update({ "system.quantity": left });
      AD2EActor.#lastAmmo.set(`${this.id}.${itemId}`, ammo.id);
      spent = ` — ${game.i18n.format("AD2E.Ammo.Left", { name: ammo.name, n: left })}`;
    } else if (this.#isThrownItem(item, use)) {
      const left = Math.max(item.system.quantity - 1, 0);
      await item.update({ "system.quantity": left });
      spent = ` — ${game.i18n.format("AD2E.Ammo.Left", { name: item.name, n: left })}`;
    }
    return roll.toMessage({
      speaker: ChatMessage.getSpeaker({ actor: this }),
      flavor: `${item.name}${ammo ? ` (${ammo.name})` : ""} (${i18n(`AD2E.Weapon.${use}`)}${input.range ? `, ${i18n(`AD2E.Weapon.${input.range === "pointBlank" ? "PointBlank" : input.range[0].toUpperCase() + input.range.slice(1)}`)}` : ""}) `
        + `vs AC ${input.ac}${AD2EActor.#targetText(targets)} (THAC0 ${this.system.thac0.value}, ${i18n("AD2E.Roll.Needs")} ${needed}+): `
        + i18n(hit ? "AD2E.Roll.Hit" : "AD2E.Roll.Miss") + status + spent
        + (input.backstab ? ` [${i18n("AD2E.Ability2.BackstabAttack")}]` : "")
        + (notes.length ? ` [${notes.join("; ")}]` : "")
        + (input.kitText ? ` [${input.kitText}]` : "") + modifierText(input.manual?.mod, input.manual?.note)
    });
  }

  /** Thieves: the Table 30 backstab multiplier at their level; null for other classes. */
  #backstabMultiplier() {
    return this.type === "character" ? (this.system.classAbilities?.info?.backstab ?? null) : null;
  }

  /** Last ammunition fired per actor and launcher (default choice for the next shot and its damage roll). */
  static #lastAmmo = new Map();

  /* ---------------------------------------- Targets (applying damage from chat: module/health.mjs) */

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
  async rollWeaponDamage(itemId, use = "melee") {
    const item = this.items.get(itemId);
    const attack = this.#weaponEntry(itemId)?.attack?.[use];
    if (!item || !attack) return;
    // A launcher with owned ammunition: the ammunition's damage and magical bonus (last fired first).
    const owned = use === "missile" ? (this.ammunitionFor(item) ?? []) : [];
    const last = AD2EActor.#lastAmmo.get(`${this.id}.${itemId}`);
    owned.sort((a, b) => (b.id === last) - (a.id === last));
    const options = owned.length
      ? owned.map(a => ({ label: a.name, sm: a.system.damage.sm, l: a.system.damage.l, dmg: a.system.bonus.dmg }))
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
    const kitOptions = this.#kitOptions("damage");
    const targets = this.#damageTargets(itemId);
    const backstabField = mult ? `<div class="form-group"><label>${game.i18n.format("AD2E.Ability2.BackstabDamage", { mult })}</label>`
      + `<input type="checkbox" name="backstab"></div>` : "";
    const nonlethalField = use === "melee" && nonlethalAllowed(item.system.weapon)
      ? `<div class="form-group"><label>${i18n("AD2E.Nonlethal.Weapon")} (${i18n("AD2E.Nonlethal.Half")})</label><input type="checkbox" name="nonlethal"></div>` : "";
    const input = await DialogV2.prompt({
      window: { title: `${item.name}: ${i18n("AD2E.Weapon.Damage")}` },
      content: choice + `<div class="form-group"><label>${i18n("AD2E.Weapon.TargetSize")}</label><select name="size">`
        + `<option value="sm">${i18n("AD2E.Weapon.SM")}</option><option value="l">${i18n("AD2E.Weapon.L")}</option></select></div>`
        + backstabField + nonlethalField
        + modifierFields()
        + this.#kitFields(kitOptions),
      ok: {
        label: i18n("AD2E.Roll.Roll"),
        callback: (event, button) => {
          const f = button.form.elements;
          const kit = AD2EActor.#kitPicked(button.form, kitOptions);
          const m = readModifier(button.form);
          return { option: Number(f.option?.value ?? 0), size: f.size.value, mod: m.mod + kit.sum,
            backstab: !!f.backstab?.checked, nonlethal: !!f.nonlethal?.checked, kitText: kit.text, manual: m };
        }
      },
      rejectClose: false
    });
    if (!input) return;
    const option = options[input.option] ?? options[0];
    const dice = option[input.size] ?? option.sm ?? option.l;
    // Backstab: "The weapon's standard damage is multiplied by the value given in Table 30. Then Strength and magical
    // weapon bonuses are added" (Thief Skill Explanations (PHB)).
    const formula = input.backstab && mult ? `(${dice}) * ${mult} + @adj + @mod` : `${dice} + @adj + @mod`;
    const roll = await new Roll(formula, { adj: attack.dmg + (option.dmg ?? 0), mod: input.mod }).evaluate();
    const full = Math.max(roll.total, 1);
    // Non-lethal ("Attacking Without Killing (PHB)"): 50% of normal damage (rounded down, at least 1), half of it
    // temporary (rounded down).
    const total = input.nonlethal ? Math.max(Math.floor(full * COMBAT_TABLES.nonlethal.damage), 1) : full;
    return roll.toMessage({
      speaker: ChatMessage.getSpeaker({ actor: this }),
      // Chat context menu: apply to selected tokens (module/health.mjs); non-lethal: half of it is temporary.
      flags: { ad2e: { ...(input.nonlethal ? { damage: total, damageKind: "nonlethal", temp: Math.floor(total / 2) } : { damage: total }), targets } },
      flavor: `${item.name}${option.label ? ` (${option.label})` : ""} ${i18n("AD2E.Weapon.Damage")} `
        + `vs ${i18n(input.size === "sm" ? "AD2E.Weapon.SM" : "AD2E.Weapon.L")}${AD2EActor.#targetText(targets)}`
        + (input.backstab && mult ? ` [${game.i18n.format("AD2E.Ability2.BackstabDamage", { mult })}]` : "")
        + (input.kitText ? ` [${input.kitText}]` : "") + modifierText(input.manual?.mod, input.manual?.note)
        + (input.nonlethal ? `: ${game.i18n.format("AD2E.Nonlethal.DamageResult", { total, temp: Math.floor(total / 2) })}`
          : (total > roll.total ? `: ${total} (${i18n("AD2E.Weapon.Minimum")})` : ""))
    });
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
    if (this.type !== "character") return;
    const i18n = k => game.i18n.localize(k);
    const esc = v => foundry.utils.escapeHTML?.(String(v ?? "")) ?? String(v ?? "");
    const sys = this.system;
    const C = COMBAT_TABLES;
    const kitOptions = this.#kitOptions("attack");
    const targets = AD2EActor.#targetsNow();
    const field = (label, html) => `<div class="form-group"><label>${label}</label>${html}</div>`;
    const sizeSelect = (name, value) => `<select name="${name}">${C.overbear.sizes.map(z =>
      `<option value="${z}"${z === value ? " selected" : ""}>${i18n(`AD2E.Unarmed.Size.${z}`)}</option>`).join("")}</select>`;
    const armorRow = form === "wrestle" ? wrestlingArmor(sys.armor?.body?.system.identifier) : null;
    let extra = "";
    if (form === "punch") {
      extra = field(i18n("AD2E.Unarmed.Gauntlet"), `<input type="checkbox" name="gauntlet">`)
        + field(i18n("AD2E.Unarmed.Pull"), `<input type="checkbox" name="pull">`);
    } else if (form === "wrestle") {
      extra = field(i18n("AD2E.Unarmed.HoldRound"), `<input type="number" name="holdRound" value="0" min="0" step="1">`)
        + field(i18n("AD2E.Unarmed.AddStrength"), `<input type="checkbox" name="addStr" checked>`)
        + (armorRow ? `<p class="ad2e-note">${esc(game.i18n.format("AD2E.Unarmed.ArmorPenalty", { armor: armorRow.label, value: armorRow.value }))}</p>` : "");
    } else {
      extra = field(i18n("AD2E.Unarmed.AttackerSize"), sizeSelect("attacker", "M"))
        + field(i18n("AD2E.Unarmed.DefenderSize"), sizeSelect("defender", "M"))
        + field(i18n("AD2E.Unarmed.Legs"), `<input type="number" name="legs" value="2" min="0" step="1">`)
        + field(i18n("AD2E.Unarmed.Attackers"), `<input type="number" name="attackers" value="1" min="1" step="1">`)
        + field(i18n("AD2E.Unarmed.Down"), `<input type="checkbox" name="down">`);
    }
    const input = await DialogV2.prompt({
      window: { title: `${this.name}: ${i18n(`AD2E.Unarmed.${form}`)}` },
      content: `<p class="ad2e-note">${i18n(`AD2E.Unarmed.Hint.${form}`)} ${game.i18n.format("AD2E.Unarmed.ArmedDefender", { bonus: C.armedDefender })}</p>`
        + field(i18n("AD2E.Roll.TargetAC"), `<input type="number" name="ac" value="${AD2EActor.#targetAc(targets)}" autofocus>`)
        + extra + modifierFields() + this.#kitFields(kitOptions),
      ok: { label: i18n("AD2E.Roll.Roll"), callback: (event, button) => {
        const f = button.form.elements;
        const kit = AD2EActor.#kitPicked(button.form, kitOptions);
        return { ...readModifier(button.form), kit: kit.sum, kitText: kit.text, ac: Number(f.ac.value) || 0,
          gauntlet: !!f.gauntlet?.checked, pull: !!f.pull?.checked, holdRound: Math.max(Math.floor(Number(f.holdRound?.value) || 0), 0),
          addStr: !!f.addStr?.checked, attacker: f.attacker?.value ?? "M", defender: f.defender?.value ?? "M",
          legs: Math.max(Number(f.legs?.value) || 0, 0), attackers: Math.max(Math.floor(Number(f.attackers?.value) || 1), 1), down: !!f.down?.checked };
      } },
      rejectClose: false
    });
    if (!input) return;
    const speaker = ChatMessage.getSpeaker({ actor: this });
    const str = sys.mods?.dmg ?? 0;
    const parts = [input.kitText].filter(Boolean);
    // A maintained hold needs no attack roll: 1 more point each round (round 2 = 2 points, ...).
    if (form === "wrestle" && input.holdRound >= 2) {
      const dmg = Math.max(input.holdRound + (input.addStr ? str : 0), 0);
      return ChatMessage.create({ speaker, flags: dmg > 0 ? { ad2e: { damage: dmg, targets } } : {}, content: `<p>${esc(game.i18n.format("AD2E.Unarmed.HoldResult",
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
    const hitAdj = sys.mods?.meleeAttack ?? 0;
    const roll = await new Roll("1d20 + @hit + @situation + @kit + @mod", { hit: hitAdj, situation, kit: input.kit, mod: input.mod }).evaluate();
    const needed = sys.thac0.value - input.ac;
    const hit = roll.total >= needed;
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
    return ChatMessage.create({ speaker, flavor, rolls, flags: damageFlags });
  }

  /**
   * Monster attacks: the stat block's natural attacks (`system.attacks`, index "a<n>") and owned weapon items
   * (index "w<itemId>", damage options from the weapon list plus its magical bonus). Hit if d20 + bonus + modifier
   * >= THAC0 - target AC.
   */
  monsterAttacks() {
    if (this.type !== "monster") return [];
    const natural = this.system.attacks.map((a, i) => ({ key: `a${i}`, name: a.name, hit: a.bonus,
      damage: [{ label: "", formula: a.damage }], dmgBonus: 0 }));
    const weapons = this.items.filter(i => i.type === "weapon").map(i => ({ key: `w${i.id}`, name: i.name, hit: i.system.bonus.hit,
      damage: i.system.weapon.damage.filter(d => d.sm || d.l).map(d => ({ label: d.label, sm: d.sm, l: d.l })),
      dmgBonus: i.system.bonus.dmg }));
    return [...natural, ...weapons];
  }

  async rollMonsterAttack(key) {
    const attack = this.monsterAttacks().find(a => a.key === key);
    if (!attack) return;
    const i18n = k => game.i18n.localize(k);
    const targets = AD2EActor.#targetsNow();
    this.#rememberTargets(key, targets);
    const input = await DialogV2.prompt({
      window: { title: `${this.name}: ${attack.name}` },
      content: `<div class="form-group"><label>${i18n("AD2E.Roll.TargetAC")}</label><input type="number" name="ac" value="${AD2EActor.#targetAc(targets)}" autofocus></div>`
        + modifierFields(),
      ok: { label: i18n("AD2E.Roll.Roll"), callback: (event, button) => ({
        ac: Number(button.form.elements.ac.value) || 0, ...readModifier(button.form) }) },
      rejectClose: false
    });
    if (!input) return;
    const thac0 = this.system.thac0.value;
    const needed = thac0 - input.ac;
    const roll = await new Roll("1d20 + @adj + @mod", { adj: attack.hit, mod: input.mod }).evaluate();
    return roll.toMessage({
      speaker: ChatMessage.getSpeaker({ actor: this }),
      flavor: `${attack.name} vs AC ${input.ac}${AD2EActor.#targetText(targets)} (THAC0 ${thac0}, ${i18n("AD2E.Roll.Needs")} ${needed}+): `
        + i18n(roll.total >= needed ? "AD2E.Roll.Hit" : "AD2E.Roll.Miss") + modifierText(input.mod, input.note)
    });
  }

  async rollMonsterDamage(key) {
    const attack = this.monsterAttacks().find(a => a.key === key);
    if (!attack || !attack.damage.length) return;
    const i18n = k => game.i18n.localize(k);
    const targets = this.#damageTargets(key);
    let formula = attack.damage[0].formula;
    let label = "";
    // A weapon: choose the damage option and the target size; any attack: a situational modifier.
    const options = attack.damage;
    const weapon = !formula;
    const input = await DialogV2.prompt({
      window: { title: `${attack.name}: ${i18n("AD2E.Weapon.Damage")}` },
      content: (weapon && options.length > 1 ? `<div class="form-group"><label>${i18n("AD2E.Weapon.Ammo")}</label><select name="option">${
        options.map((d, i) => `<option value="${i}">${d.label} (${d.sm ?? "—"} / ${d.l ?? "—"})</option>`).join("")}</select></div>` : "")
        + (weapon ? `<div class="form-group"><label>${i18n("AD2E.Weapon.TargetSize")}</label><select name="size">`
          + `<option value="sm">${i18n("AD2E.Weapon.SM")}</option><option value="l">${i18n("AD2E.Weapon.L")}</option></select></div>` : "")
        + modifierFields({ autofocus: !weapon }),
      ok: { label: i18n("AD2E.Roll.Roll"), callback: (event, button) => ({
        option: Number(button.form.elements.option?.value ?? 0), size: button.form.elements.size?.value ?? "sm",
        ...readModifier(button.form) }) },
      rejectClose: false
    });
    if (!input) return;
    if (weapon) {
      const opt = options[input.option] ?? options[0];
      formula = opt[input.size] ?? opt.sm ?? opt.l;
      label = `${opt.label ? ` (${opt.label})` : ""} vs ${i18n(input.size === "sm" ? "AD2E.Weapon.SM" : "AD2E.Weapon.L")}`;
    }
    const roll = await new Roll(`${formula} + @bonus + @mod`, { bonus: attack.dmgBonus, mod: input.mod }).evaluate();
    const total = Math.max(roll.total, 1);
    return roll.toMessage({
      speaker: ChatMessage.getSpeaker({ actor: this }),
      flags: { ad2e: { damage: total, targets } },
      flavor: `${attack.name}${label} ${i18n("AD2E.Weapon.Damage")}${AD2EActor.#targetText(targets)}` + (total > roll.total ? `: ${total} (${i18n("AD2E.Weapon.Minimum")})` : "")
        + modifierText(input.mod, input.note)
    });
  }

  /** Morale check (Morale (DMG)): 2d10 + modifier; the creature stands if the total is at most its morale. */
  async rollMorale() {
    const input = await promptModifier(game.i18n.localize("AD2E.Monster.Morale"));
    if (!input) return;
    // Situational modifiers (DMG Table 50) adjust the morale rating: "Add or subtract the modifiers that apply" (Morale (DMG)).
    const target = this.system.morale.value + input.mod;
    const roll = await new Roll("2d10").evaluate();
    return roll.toMessage({
      speaker: ChatMessage.getSpeaker({ actor: this }),
      flavor: `${game.i18n.localize("AD2E.Monster.Morale")} (${game.i18n.localize("AD2E.Roll.RollUnder")} ${target})${modifierText(input.mod, input.note)}: `
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
    const left = sys.prepared - sys.cast - 1;
    await spell.update({ "system.cast": sys.cast + 1 });
    const i18n = k => game.i18n.localize(k);
    const esc = v => foundry.utils.escapeHTML?.(String(v ?? "")) ?? String(v ?? "");
    const comps = ["verbal", "somatic", "material"].filter(c => sys.components[c]).map(c => c[0].toUpperCase()).join(", ");
    const rows = [
      [i18n("AD2E.Spell.Level"), `${sys.level} (${i18n(`AD2E.Spell.${sys.kind}`)})`],
      [i18n(sys.kind === "priest" ? "AD2E.Spell.Spheres" : "AD2E.Spell.Schools"), (sys.kind === "priest" ? sys.spheres : sys.schools).join(", ")],
      [i18n("AD2E.Spell.CastingTime"), sys.castingTime], [i18n("AD2E.Spell.Range"), sys.range],
      [i18n("AD2E.Spell.Area"), sys.area], [i18n("AD2E.Spell.Duration"), sys.duration], [i18n("AD2E.Spell.Save"), sys.save],
      [i18n("AD2E.Spell.Components"), comps], [i18n("AD2E.Spell.CastingLevel"), this.system.spells?.castingLevel ?? this.system.level]
    ].filter(([, v]) => v !== "" && v !== null && v !== undefined);
    const content = `<div class="ad2e-spell-card"><h3>${esc(spell.name)}${sys.reversible ? ` <em>(${i18n("AD2E.Spell.Reversible")})</em>` : ""}</h3>`
      + `<dl>${rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join("")}</dl>`
      + (sys.url ? `<p><a href="${esc(sys.url)}" target="_blank" rel="noopener">${i18n("AD2E.Spell.FullText")}</a></p>` : "")
      + `<p class="ad2e-note">${game.i18n.format("AD2E.Spell.Remaining", { n: left })}</p></div>`;
    return ChatMessage.create({ speaker: ChatMessage.getSpeaker({ actor: this }), content });
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
      ui.notifications.warn(`${name}: ${i18n("AD2E.Skill.HeavyArmor")}`);
      return;
    }
    const ranger = info.classId === "ranger";
    const kitOptions = this.#kitOptions("skill", key);
    const input = await DialogV2.prompt({
      window: { title: name },
      content: (ranger ? `<div class="form-group"><label>${i18n("AD2E.Skill.Halved")}</label><input type="checkbox" name="halved"></div>` : "")
        + modifierFields({ unit: "%", autofocus: true })
        + this.#kitFields(kitOptions, "%"),
      ok: { label: i18n("AD2E.Roll.Roll"), callback: (event, button) => {
        const kit = AD2EActor.#kitPicked(button.form, kitOptions);
        const m = readModifier(button.form);
        return { mod: m.mod + kit.sum, halved: !!button.form.elements.halved?.checked, kitText: kit.text, manual: m };
      } },
      rejectClose: false
    });
    if (!input) return;
    let target = (input.halved ? Math.floor(skill.total / 2) : skill.total) + input.mod;
    if (info.classId === "thief") target = Math.min(target, AD2E.skillClasses.thief.cap);
    const roll = await new Roll("1d100").evaluate();
    const success = roll.total <= target;
    const trap = key === "rt" && roll.total >= AD2E.trapSpringRoll;
    return roll.toMessage({
      speaker: ChatMessage.getSpeaker({ actor: this }),
      flavor: `${name} (${i18n("AD2E.Roll.RollUnder")} ${target}%${input.halved ? `, ${i18n("AD2E.Skill.Halved")}` : ""}${input.kitText ? `; ${input.kitText}` : ""})${modifierText(input.manual?.mod, input.manual?.note, "%")}: `
        + i18n(success ? "AD2E.Skill.Success" : "AD2E.Skill.Failure")
        + (trap ? ` — ${i18n("AD2E.Skill.TrapSprung")}` : "")
    });
  }

  /**
   * Turn undead (Turning Undead (PHB), Table 61): choose the undead type; 1d20 equal to or above the number turns; T
   * turns and D destroys automatically; D* destroys and 2d4 more are destroyed; a success affects 2d6 undead.
   */
  async rollTurnUndead() {
    const level = this.system.classAbilities?.info?.turnLevel;
    if (!level) return;
    const t = AD2E.classTables.turnUndead;
    const col = t.columns.findIndex(([lo, hi]) => level >= lo && level <= hi);
    const i18n = k => game.i18n.localize(k);
    const esc = v => foundry.utils.escapeHTML?.(String(v ?? "")) ?? String(v ?? "");
    const input = await DialogV2.prompt({
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
    const fixed = [dex ? `${i18n("AD2E.Surprise.Dex")} ${dex > 0 ? "+" : ""}${dex}` : "", kitAuto ? `${i18n("AD2E.Surprise.Kit")} ${kitAuto > 0 ? "+" : ""}${kitAuto}` : ""].filter(Boolean).join(" · ");
    const input = await DialogV2.prompt({
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
    const roll = await new Roll("1d10 + @dex + @kit + @table + @mod", { dex, kit: kitAuto + input.kit, table: input.table, mod: input.mod }).evaluate();
    const surprised = roll.total <= T.surprisedOn;
    const parts = [...input.picked, input.kitText].filter(Boolean).join("; ");
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
    const bonus = this.system.classInfo?.xpBonus ?? 0;
    const input = await DialogV2.prompt({
      window: { title: `${this.name}: ${i18n("AD2E.Xp.AddTitle")}` },
      content: `<div class="form-group"><label>${i18n("AD2E.Xp.Amount")}</label><input type="number" name="amount" value="0" min="0" step="1" autofocus></div>`
        + `<div class="form-group"><label>${i18n("AD2E.Roll.ModifierNote")}</label><input type="text" name="reason" placeholder="${i18n("AD2E.Xp.ReasonHint")}"></div>`
        + (bonus ? `<p class="ad2e-note">${game.i18n.format("AD2E.Xp.BonusNote", { bonus })}</p>` : ""),
      ok: { label: i18n("AD2E.Xp.Award"), callback: (event, button) => ({
        amount: Math.max(Math.floor(Number(button.form.elements.amount.value) || 0), 0), reason: button.form.elements.reason.value.trim() }) },
      rejectClose: false
    });
    if (!input?.amount) return;
    const gain = Math.floor(input.amount * (100 + bonus) / 100);
    const xp = (this.system.xp ?? 0) + gain;
    await this.update({ "system.xp": xp });
    const next = this.system.xpNext;
    const esc = v => foundry.utils.escapeHTML?.(String(v ?? "")) ?? String(v ?? "");
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
    const input = await DialogV2.prompt({
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
    const n = naturalHealing(input.days, input.bed, this.system.mods?.conHp ?? 0);
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
      extra: `<div class="form-group"><label>${game.i18n.localize("AD2E.Roll.TargetAC")}</label><input type="number" name="ac" value="${AD2EActor.#targetAc(targets, missile)}" autofocus></div>`,
      read: form => ({ ac: Number(form.elements.ac.value) || 0 })
    });
    if (!input) return;
    const targetAc = Number(input.ac ?? 10);
    const sys = this.system;
    const adj = missile ? sys.mods.missileAttack : sys.mods.meleeAttack; // includes the encumbrance penalty
    const needed = sys.thac0.value - targetAc;
    const roll = await new Roll("1d20 + @adj + @mod", { adj, mod: input.mod }).evaluate();
    const hit = roll.total >= needed;
    return roll.toMessage({
      speaker: ChatMessage.getSpeaker({ actor: this }),
      flavor: `${game.i18n.localize("AD2E.Roll.Attack")} vs AC ${targetAc}${AD2EActor.#targetText(targets)} `
        + `(THAC0 ${sys.thac0.value}, ${game.i18n.localize("AD2E.Roll.Needs")} ${needed}+)${modifierText(input.mod, input.note)}: `
        + game.i18n.localize(hit ? "AD2E.Roll.Hit" : "AD2E.Roll.Miss")
    });
  }
}
