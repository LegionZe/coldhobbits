import { modifierText, promptModifier } from "../roll-modifiers.mjs";

/** AD&D 2e initiative: d10, lowest result acts first. */
export default class AD2ECombat extends Combat {
  _sortCombatants(a, b) {
    const ia = Number.isNumeric(a.initiative) ? a.initiative : Infinity;
    const ib = Number.isNumeric(b.initiative) ? b.initiative : Infinity;
    return (ia - ib) || a.name.localeCompare(b.name) || (a.id > b.id ? 1 : -1);
  }

  /**
   * Rolling one combatant (the tracker's die icon) asks for a situational modifier and reason, e.g. a weapon speed
   * factor or a magical item; it is added to the 1d10 (lower acts first) and shown in chat. Rolling several at once
   * (roll all, roll NPCs) does not ask. World setting "initiativePrompt" turns the question off.
   */
  async rollInitiative(ids, options = {}) {
    const list = typeof ids === "string" ? [ids] : Array.from(ids);
    let ask = list.length === 1 && !options.formula;
    try { ask &&= game.settings.get("ad2e", "initiativePrompt"); } catch { /* setting not registered */ }
    if (ask) {
      const combatant = this.combatants.get(list[0]);
      const input = await promptModifier(game.i18n.format("AD2E.Init.Title", { name: combatant?.name ?? "" }));
      if (!input) return this;
      if (input.mod || input.note) {
        const base = CONFIG.Combat.initiative.formula;
        options = {
          ...options,
          formula: input.mod ? `${base} + ${input.mod}` : base,
          messageOptions: { ...(options.messageOptions ?? {}),
            flavor: game.i18n.format("COMBAT.RollsInitiative", { name: foundry.utils.escapeHTML?.(combatant?.name ?? "") ?? "" })
              + modifierText(input.mod, input.note) }
        };
      }
    }
    return super.rollInitiative(list, options);
  }
}
