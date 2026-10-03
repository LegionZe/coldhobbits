import { hitDiceAt } from "../config.mjs";

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

  /** Melee attack: hit if d20 + modifiers >= THAC0 - target AC (descending AC). */
  async rollAttack({ missile = false } = {}) {
    const targetAc = await promptNumber(
      game.i18n.localize("AD2E.Roll.Attack"),
      game.i18n.localize("AD2E.Roll.TargetAC"),
      10
    );
    if (targetAc === null) return;
    const sys = this.system;
    const adj = missile ? sys.mods.missile : sys.mods.hit;
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
