import { AD2E, hitDiceAt } from "../config.mjs";

const { DialogV2 } = foundry.applications.api;

/** Prompt for a single numeric input; resolves to a number, or null if dismissed. */
async function promptNumber(title, label, initial = 0) {
  const result = await DialogV2.prompt({
    window: { title },
    content: `<div class="form-group"><label>${label}</label><input type="number" name="value" value="${initial}" autofocus></div>`,
    ok: {
      label: game.i18n.localize("AD2E.Roll.Roll"),
      callback: (event, button) => Number(button.form.elements.value.value) || 0
    },
    rejectClose: false
  });
  return result ?? null;
}

export default class AD2EActor extends Actor {
  /**
   * Core Actor#getRollData returns the system data directly and does not call
   * TypeDataModel#getRollData, so delegate explicitly (same pattern as dnd5e Actor5e).
   */
  getRollData() {
    if (this.system.getRollData) return this.system.getRollData();
    return { ...super.getRollData() };
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
    if (dice <= 0) {
      await ChatMessage.create({ speaker, content: `<p>${flavor}: ${game.i18n.format("AD2E.HP.Fixed", { hp: bonus })}</p>` });
      return bonus;
    }
    const con = this.system.mods.conHp;
    const roll = await new Roll(`${dice}d${cur.die} + @con`, { con: con * dice }).evaluate();
    const gained = Math.max(roll.total, dice) + bonus; // no hit die yields less than 1 hit point
    await roll.toMessage({
      speaker,
      flavor: `${flavor}: ${game.i18n.format("AD2E.HP.Gained", { hp: gained })}`
        + (gained > roll.total + bonus ? ` (${game.i18n.localize("AD2E.HP.Minimum")})` : "")
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
    const roll = await new Roll("1d20").evaluate();
    const success = roll.total < 20 && roll.total <= entry.target;
    return roll.toMessage({
      speaker: ChatMessage.getSpeaker({ actor: this }),
      flavor: `${item.name} (${game.i18n.localize("AD2E.Roll.RollUnder")} ${entry.target}): `
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
    const mod = await promptNumber(
      game.i18n.localize(`AD2E.Ability.${key}`),
      game.i18n.localize("AD2E.Roll.Modifier")
    );
    if (mod === null) return;
    const target = this.system.abilities[key].total + mod; // effective score (racial adjustment included)
    const roll = await new Roll("1d20").evaluate();
    const success = roll.total <= target;
    return roll.toMessage({
      speaker: ChatMessage.getSpeaker({ actor: this }),
      flavor: `${game.i18n.localize(`AD2E.Ability.${key}`)} ${game.i18n.localize("AD2E.Roll.Check")} `
        + `(${game.i18n.localize("AD2E.Roll.RollUnder")} ${target}): `
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
    const roll = await new Roll(test.die).evaluate();
    const under = roll.total <= target;
    const success = test.failsOnSuccess ? !under : under;
    const outcomes = test.outcomes ?? { success: "AD2E.Roll.Success", failure: "AD2E.Roll.Failure" };
    return roll.toMessage({
      speaker: ChatMessage.getSpeaker({ actor: this }),
      flavor: `${label} (${test.die} ${game.i18n.localize("AD2E.Roll.RollUnder")} ${target}): `
        + game.i18n.localize(success ? outcomes.success : outcomes.failure)
    });
  }

  /** Saving throw: d20 + racial bonus (PHB Table 9, where it applies) + modifier >= save target. */
  async rollSave(key) {
    const mod = await promptNumber(
      game.i18n.localize(`AD2E.Save.${key}`),
      game.i18n.localize("AD2E.Roll.Modifier")
    );
    if (mod === null) return;
    const target = this.system.saves[key].value;
    const bonus = this.system.saves[key].bonus;
    const roll = await new Roll(bonus ? "1d20 + @bonus + @mod" : "1d20 + @mod", { bonus, mod }).evaluate();
    const success = roll.total >= target;
    return roll.toMessage({
      speaker: ChatMessage.getSpeaker({ actor: this }),
      flavor: `${game.i18n.localize(`AD2E.Save.${key}`)} (${game.i18n.localize("AD2E.Roll.Needs")} ${target}+): `
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
    const input = await DialogV2.prompt({
      window: { title: `${item.name}: ${i18n(`AD2E.Weapon.${use}`)}` },
      content: `<div class="form-group"><label>${i18n("AD2E.Roll.TargetAC")}</label><input type="number" name="ac" value="10" autofocus></div>`
        + ammoField + rangeField
        + `<div class="form-group"><label>${i18n("AD2E.Roll.Modifier")}</label><input type="number" name="mod" value="0"></div>`,
      ok: {
        label: i18n("AD2E.Roll.Roll"),
        callback: (event, button) => {
          const f = button.form.elements;
          return { ac: Number(f.ac.value) || 0, mod: Number(f.mod.value) || 0, range: f.range?.value ?? null,
            ammo: f.ammo?.value ?? null };
        }
      },
      rejectClose: false
    });
    if (!input) return;
    const ammo = input.ammo ? this.items.get(input.ammo) : null;
    if (ammoList && !ammo) return;
    const rangeMod = input.range ? AD2E.rangeModifiers[input.range] : 0;
    const needed = this.system.thac0.value - input.ac;
    const adj = attack.hit + (ammo?.system.bonus.hit ?? 0);
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
    });
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
    const input = await DialogV2.prompt({
      window: { title: `${item.name}: ${i18n("AD2E.Weapon.Damage")}` },
      content: choice + `<div class="form-group"><label>${i18n("AD2E.Weapon.TargetSize")}</label><select name="size">`
        + `<option value="sm">${i18n("AD2E.Weapon.SM")}</option><option value="l">${i18n("AD2E.Weapon.L")}</option></select></div>`
        + `<div class="form-group"><label>${i18n("AD2E.Roll.Modifier")}</label><input type="number" name="mod" value="0"></div>`,
      ok: {
        label: i18n("AD2E.Roll.Roll"),
        callback: (event, button) => {
          const f = button.form.elements;
          return { option: Number(f.option?.value ?? 0), size: f.size.value, mod: Number(f.mod.value) || 0 };
        }
      },
      rejectClose: false
    });
    if (!input) return;
    const option = options[input.option] ?? options[0];
    const dice = option[input.size] ?? option.sm ?? option.l;
    const roll = await new Roll(`${dice} + @adj + @mod`, { adj: attack.dmg + (option.dmg ?? 0), mod: input.mod }).evaluate();
    const total = Math.max(roll.total, 1);
    return roll.toMessage({
      speaker: ChatMessage.getSpeaker({ actor: this }),
      flavor: `${item.name}${option.label ? ` (${option.label})` : ""} ${i18n("AD2E.Weapon.Damage")} `
        + `vs ${i18n(input.size === "sm" ? "AD2E.Weapon.SM" : "AD2E.Weapon.L")}`
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
        + `<div class="form-group"><label>${i18n("AD2E.Roll.Modifier")}</label><input type="number" name="mod" value="0"></div>`,
      ok: { label: i18n("AD2E.Roll.Roll"), callback: (event, button) => ({
        ac: Number(button.form.elements.ac.value) || 0, mod: Number(button.form.elements.mod.value) || 0 }) },
      rejectClose: false
    });
    if (!input) return;
    const thac0 = this.system.thac0.value;
    const needed = thac0 - input.ac;
    const roll = await new Roll("1d20 + @adj + @mod", { adj: attack.hit, mod: input.mod }).evaluate();
    return roll.toMessage({
      speaker: ChatMessage.getSpeaker({ actor: this }),
      flavor: `${attack.name} vs AC ${input.ac} (THAC0 ${thac0}, ${i18n("AD2E.Roll.Needs")} ${needed}+): `
        + i18n(roll.total >= needed ? "AD2E.Roll.Hit" : "AD2E.Roll.Miss")
    });
  }

  async rollMonsterDamage(key) {
    const attack = this.monsterAttacks().find(a => a.key === key);
    if (!attack || !attack.damage.length) return;
    const i18n = k => game.i18n.localize(k);
    let formula = attack.damage[0].formula;
    let label = "";
    if (!formula) {
      // a weapon: choose the damage option and the target size
      const options = attack.damage;
      const input = await DialogV2.prompt({
        window: { title: `${attack.name}: ${i18n("AD2E.Weapon.Damage")}` },
        content: (options.length > 1 ? `<div class="form-group"><label>${i18n("AD2E.Weapon.Ammo")}</label><select name="option">${
          options.map((d, i) => `<option value="${i}">${d.label} (${d.sm ?? "—"} / ${d.l ?? "—"})</option>`).join("")}</select></div>` : "")
          + `<div class="form-group"><label>${i18n("AD2E.Weapon.TargetSize")}</label><select name="size">`
          + `<option value="sm">${i18n("AD2E.Weapon.SM")}</option><option value="l">${i18n("AD2E.Weapon.L")}</option></select></div>`,
        ok: { label: i18n("AD2E.Roll.Roll"), callback: (event, button) => ({
          option: Number(button.form.elements.option?.value ?? 0), size: button.form.elements.size.value }) },
        rejectClose: false
      });
      if (!input) return;
      const opt = options[input.option] ?? options[0];
      formula = opt[input.size] ?? opt.sm ?? opt.l;
      label = `${opt.label ? ` (${opt.label})` : ""} vs ${i18n(input.size === "sm" ? "AD2E.Weapon.SM" : "AD2E.Weapon.L")}`;
    }
    const roll = await new Roll(`${formula} + @bonus`, { bonus: attack.dmgBonus }).evaluate();
    const total = Math.max(roll.total, 1);
    return roll.toMessage({
      speaker: ChatMessage.getSpeaker({ actor: this }),
      flavor: `${attack.name}${label} ${i18n("AD2E.Weapon.Damage")}` + (total > roll.total ? `: ${total} (${i18n("AD2E.Weapon.Minimum")})` : "")
    });
  }

  /** Morale check (Morale (DMG)): 2d10 + modifier; the creature stands if the total is at most its morale. */
  async rollMorale() {
    const mod = await promptNumber(game.i18n.localize("AD2E.Monster.Morale"), game.i18n.localize("AD2E.Roll.Modifier"));
    if (mod === null) return;
    const target = this.system.morale.value;
    const roll = await new Roll("2d10 + @mod", { mod }).evaluate();
    return roll.toMessage({
      speaker: ChatMessage.getSpeaker({ actor: this }),
      flavor: `${game.i18n.localize("AD2E.Monster.Morale")} (${game.i18n.localize("AD2E.Roll.RollUnder")} ${target}): `
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

  /** Rest: every memorized spell can be cast again (memorization itself is kept; change it on the Spells tab). */
  async restSpells() {
    const updates = this.items.filter(i => i.type === "spell" && i.system.cast > 0).map(i => ({ _id: i.id, "system.cast": 0 }));
    if (updates.length) await this.updateEmbeddedDocuments("Item", updates);
    ui.notifications.info(game.i18n.format("AD2E.Spell.Rested", { name: this.name }));
  }

  /** Melee attack: hit if d20 + modifiers >= THAC0 - target AC (descending AC). */
  async rollAttack({ missile = false } = {}) {
    const targetAc = await promptNumber(
      game.i18n.localize("AD2E.Roll.Attack"),
      game.i18n.localize("AD2E.Roll.TargetAC"),
      10
    );
    if (targetAc === null) return;
    const sys = this.system;
    const adj = missile ? sys.mods.missileAttack : sys.mods.meleeAttack; // includes the encumbrance penalty
    const needed = sys.thac0.value - targetAc;
    const roll = await new Roll("1d20 + @adj", { adj }).evaluate();
    const hit = roll.total >= needed;
    return roll.toMessage({
      speaker: ChatMessage.getSpeaker({ actor: this }),
      flavor: `${game.i18n.localize("AD2E.Roll.Attack")} vs AC ${targetAc} `
        + `(THAC0 ${sys.thac0.value}, ${game.i18n.localize("AD2E.Roll.Needs")} ${needed}+): `
        + game.i18n.localize(hit ? "AD2E.Roll.Hit" : "AD2E.Roll.Miss")
    });
  }
}
