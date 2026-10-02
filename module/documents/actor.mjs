import { AD2E } from "../config.mjs";

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
  /** Roll-under ability check: d20 <= score + modifier. */
  async rollAbilityCheck(key) {
    const mod = await promptNumber(
      game.i18n.localize(`AD2E.Ability.${key}`),
      game.i18n.localize("AD2E.Roll.Modifier")
    );
    if (mod === null) return;
    const target = this.system.abilities[key].value + mod;
    const roll = await new Roll("1d20").evaluate();
    const success = roll.total <= target;
    return roll.toMessage({
      speaker: ChatMessage.getSpeaker({ actor: this }),
      flavor: `${game.i18n.localize(`AD2E.Ability.${key}`)} ${game.i18n.localize("AD2E.Roll.Check")} `
        + `(${game.i18n.localize("AD2E.Roll.RollUnder")} ${target}): `
        + game.i18n.localize(success ? "AD2E.Roll.Success" : "AD2E.Roll.Failure")
    });
  }

  /** Saving throw: d20 + modifier >= save target. */
  async rollSave(key) {
    const mod = await promptNumber(
      game.i18n.localize(`AD2E.Save.${key}`),
      game.i18n.localize("AD2E.Roll.Modifier")
    );
    if (mod === null) return;
    const target = this.system.saves[key].value;
    const roll = await new Roll("1d20 + @mod", { mod }).evaluate();
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
