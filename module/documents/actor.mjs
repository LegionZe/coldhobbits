import { AD2E, hitDiceAt } from "../config.mjs";
import { modifierFields, modifierText, promptModifier, readModifier } from "../roll-modifiers.mjs";

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
    const backstabField = backstab ? `<div class="form-group"><label>${i18n("AD2E.Ability2.BackstabAttack")}</label>`
      + `<input type="checkbox" name="backstab"></div>` : "";
    const input = await DialogV2.prompt({
      window: { title: `${item.name}: ${i18n(`AD2E.Weapon.${use}`)}` },
      content: `<div class="form-group"><label>${i18n("AD2E.Roll.TargetAC")}</label><input type="number" name="ac" value="10" autofocus></div>`
        + ammoField + rangeField + backstabField
        + modifierFields()
        + this.#kitFields(kitOptions),
      ok: {
        label: i18n("AD2E.Roll.Roll"),
        callback: (event, button) => {
          const f = button.form.elements;
          const kit = AD2EActor.#kitPicked(button.form, kitOptions);
          const m = readModifier(button.form);
          return { ac: Number(f.ac.value) || 0, mod: m.mod + kit.sum, range: f.range?.value ?? null,
            ammo: f.ammo?.value ?? null, backstab: !!f.backstab?.checked, kitText: kit.text, manual: m };
        }
      },
      rejectClose: false
    });
    if (!input) return;
    const ammo = input.ammo ? this.items.get(input.ammo) : null;
    if (ammoList && !ammo) return;
    const rangeMod = input.range ? AD2E.rangeModifiers[input.range] : 0;
    const needed = this.system.thac0.value - input.ac;
    // Backstab: +4 for the rear attack (Thief Skill Explanations (PHB)); shield and Dexterity bonuses of the
    // target are ignored, which the target AC entered should reflect.
    const adj = attack.hit + (ammo?.system.bonus.hit ?? 0) + (input.backstab ? AD2E.backstabHit : 0);
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
        + `vs AC ${input.ac} (THAC0 ${this.system.thac0.value}, ${i18n("AD2E.Roll.Needs")} ${needed}+): `
        + i18n(hit ? "AD2E.Roll.Hit" : "AD2E.Roll.Miss") + status + spent
        + (input.backstab ? ` [${i18n("AD2E.Ability2.BackstabAttack")}]` : "")
        + (input.kitText ? ` [${input.kitText}]` : "") + modifierText(input.manual?.mod, input.manual?.note)
    });
  }

  /** Thieves: the Table 30 backstab multiplier at their level; null for other classes. */
  #backstabMultiplier() {
    return this.type === "character" ? (this.system.classAbilities?.info?.backstab ?? null) : null;
  }

  /** Last ammunition fired per actor and launcher (default choice for the next shot and its damage roll). */
  static #lastAmmo = new Map();

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
    const backstabField = mult ? `<div class="form-group"><label>${game.i18n.format("AD2E.Ability2.BackstabDamage", { mult })}</label>`
      + `<input type="checkbox" name="backstab"></div>` : "";
    const input = await DialogV2.prompt({
      window: { title: `${item.name}: ${i18n("AD2E.Weapon.Damage")}` },
      content: choice + `<div class="form-group"><label>${i18n("AD2E.Weapon.TargetSize")}</label><select name="size">`
        + `<option value="sm">${i18n("AD2E.Weapon.SM")}</option><option value="l">${i18n("AD2E.Weapon.L")}</option></select></div>`
        + backstabField
        + modifierFields()
        + this.#kitFields(kitOptions),
      ok: {
        label: i18n("AD2E.Roll.Roll"),
        callback: (event, button) => {
          const f = button.form.elements;
          const kit = AD2EActor.#kitPicked(button.form, kitOptions);
          const m = readModifier(button.form);
          return { option: Number(f.option?.value ?? 0), size: f.size.value, mod: m.mod + kit.sum,
            backstab: !!f.backstab?.checked, kitText: kit.text, manual: m };
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
    const total = Math.max(roll.total, 1);
    return roll.toMessage({
      speaker: ChatMessage.getSpeaker({ actor: this }),
      flavor: `${item.name}${option.label ? ` (${option.label})` : ""} ${i18n("AD2E.Weapon.Damage")} `
        + `vs ${i18n(input.size === "sm" ? "AD2E.Weapon.SM" : "AD2E.Weapon.L")}`
        + (input.backstab && mult ? ` [${game.i18n.format("AD2E.Ability2.BackstabDamage", { mult })}]` : "")
        + (input.kitText ? ` [${input.kitText}]` : "") + modifierText(input.manual?.mod, input.manual?.note)
        + (total > roll.total ? `: ${total} (${i18n("AD2E.Weapon.Minimum")})` : "")
    });
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
    const input = await DialogV2.prompt({
      window: { title: `${this.name}: ${attack.name}` },
      content: `<div class="form-group"><label>${i18n("AD2E.Roll.TargetAC")}</label><input type="number" name="ac" value="10" autofocus></div>`
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
      flavor: `${attack.name} vs AC ${input.ac} (THAC0 ${thac0}, ${i18n("AD2E.Roll.Needs")} ${needed}+): `
        + i18n(roll.total >= needed ? "AD2E.Roll.Hit" : "AD2E.Roll.Miss") + modifierText(input.mod, input.note)
    });
  }

  async rollMonsterDamage(key) {
    const attack = this.monsterAttacks().find(a => a.key === key);
    if (!attack || !attack.damage.length) return;
    const i18n = k => game.i18n.localize(k);
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
      flavor: `${attack.name}${label} ${i18n("AD2E.Weapon.Damage")}` + (total > roll.total ? `: ${total} (${i18n("AD2E.Weapon.Minimum")})` : "")
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

  /** Melee attack: hit if d20 + modifiers >= THAC0 - target AC (descending AC). */
  async rollAttack({ missile = false } = {}) {
    const input = await promptModifier(game.i18n.localize("AD2E.Roll.Attack"), {
      extra: `<div class="form-group"><label>${game.i18n.localize("AD2E.Roll.TargetAC")}</label><input type="number" name="ac" value="10" autofocus></div>`,
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
      flavor: `${game.i18n.localize("AD2E.Roll.Attack")} vs AC ${targetAc} `
        + `(THAC0 ${sys.thac0.value}, ${game.i18n.localize("AD2E.Roll.Needs")} ${needed}+)${modifierText(input.mod, input.note)}: `
        + game.i18n.localize(hit ? "AD2E.Roll.Hit" : "AD2E.Roll.Miss")
    });
  }
}
