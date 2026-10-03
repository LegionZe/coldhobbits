import { modifierFields, modifierText, readModifier } from "../roll-modifiers.mjs";
import { defaultAction, initiativeActions, STANDARD_MODIFIERS } from "../initiative.mjs";

/** Roll term flavor text (no brackets). */
const flavor = s => String(s ?? "").replace(/[[\]]/g, "").trim();

/**
 * Combatants: an initiative roll made without the dialog (Roll All, Roll NPCs) adds the automatic action's modifier
 * (module/initiative.mjs: weapon speed factor, or a monster's size with natural weapons). Same override point as
 * dnd5e's Combatant5e#getInitiativeRoll on v14.
 */
export class AD2ECombatant extends Combatant {
  /** @override */
  getInitiativeRoll(formula) {
    if (formula || !this.actor) return super.getInitiativeRoll(formula);
    const action = defaultAction(this.actor);
    const base = CONFIG.Combat.initiative.formula;
    return super.getInitiativeRoll(action.value ? `${base} + ${action.value}[${flavor(action.short)}]` : base);
  }
}

/** AD&D 2e initiative: d10, lowest result acts first. */
export default class AD2ECombat extends Combat {
  _sortCombatants(a, b) {
    const ia = Number.isNumeric(a.initiative) ? a.initiative : Infinity;
    const ib = Number.isNumeric(b.initiative) ? b.initiative : Infinity;
    return (ia - ib) || a.name.localeCompare(b.name) || (a.id > b.id ? 1 : -1);
  }

  /**
   * Rolling one combatant (the tracker's die icon) asks for its action (weapon speed factor, casting time, magical
   * item, breath weapon, innate ability or natural weapons; Initiative (PHB) Table 56), the Table 55 situations and a
   * modifier with reason; all are added to the 1d10 (lower acts first) and shown in chat. Rolling several at once
   * (Roll All, Roll NPCs) uses each combatant's automatic action (AD2ECombatant). World setting "initiativePrompt"
   * turns the question off.
   */
  async rollInitiative(ids, options = {}) {
    const list = typeof ids === "string" ? [ids] : Array.from(ids);
    let ask = list.length === 1 && !options.formula;
    try { ask &&= game.settings.get("ad2e", "initiativePrompt"); } catch { /* setting not registered */ }
    if (ask) {
      const combatant = this.combatants.get(list[0]);
      const input = await AD2ECombat.#prompt(combatant);
      if (!input) return this;
      const base = CONFIG.Combat.initiative.formula;
      const terms = [input.action.value ? `${input.action.value}[${flavor(input.action.short)}]` : null,
        // A kit initiative bonus lowers the roll (lowest acts first).
        ...input.kit.map(k => `${-k.current}[${flavor(k.condition)}]`),
        ...input.situations.map(s => `${s.value}[${flavor(s.label)}]`), input.mod ? `${input.mod}[${flavor(input.note || "modifier")}]` : null]
        .filter(Boolean);
      const parts = [input.action.key !== "none" ? input.action.label : null, input.action.note || null,
        ...input.situations.map(s => `${s.label} ${s.value > 0 ? "+" : ""}${s.value}`),
        ...input.kit.map(k => `${k.condition} ${-k.current > 0 ? "+" : ""}${-k.current}`)].filter(Boolean);
      options = {
        ...options,
        formula: [base, ...terms].join(" + ").replace(/\+ -/g, "- "),
        messageOptions: { ...(options.messageOptions ?? {}),
          flavor: game.i18n.format("COMBAT.RollsInitiative", { name: foundry.utils.escapeHTML?.(combatant?.name ?? "") ?? "" })
            + (parts.length ? ` [${foundry.utils.escapeHTML?.(parts.join("; ")) ?? parts.join("; ")}]` : "")
            + modifierText(input.mod, input.note) }
      };
    }
    return super.rollInitiative(list, options);
  }

  /** Initiative dialog: action (default: the automatic one), Table 55 situations, modifier and reason. */
  static async #prompt(combatant) {
    const i18n = k => game.i18n.localize(k);
    const esc = v => foundry.utils.escapeHTML?.(String(v ?? "")) ?? String(v ?? "");
    const actor = combatant?.actor;
    const actions = initiativeActions(actor);
    const chosen = defaultAction(actor, [...actions]);
    // Conditional kit initiative modifiers (e.g. the astrologer's hung spells); unconditional ones are in @init.
    const kitOptions = actor?.type === "character" ? (actor.system.kitMods?.options("initiative") ?? []) : [];
    const content = `<p class="ad2e-note">${i18n("AD2E.Init.Hint")}</p>`
      + `<div class="form-group"><label>${i18n("AD2E.Init.ActionLabel")}</label><select name="action">${actions.map(a =>
        `<option value="${esc(a.key)}"${a.key === chosen.key ? " selected" : ""}>${esc(a.label)}</option>`).join("")}</select></div>`
      + `<fieldset><legend>${i18n("AD2E.Init.Standard")}</legend><div class="ad2e-check-grid">${STANDARD_MODIFIERS.map(m =>
        `<label><input type="checkbox" name="t55-${m.key}" value="${m.value}"> ${esc(m.label)} (${m.value > 0 ? "+" : ""}${m.value})</label>`).join("")}</div></fieldset>`
      + (kitOptions.length ? `<fieldset><legend>${esc(game.i18n.format("AD2E.Kit.Situational", { kit: actor.system.classInfo?.kitItem?.name ?? "" }))}</legend>`
        + kitOptions.map(m => `<div class="form-group"><label>${esc(`${m.current > 0 ? "-" : "+"}${Math.abs(m.current)} ${m.condition}`)}</label>`
          + `<input type="checkbox" name="kitinit" value="${m.index}"></div>`).join("") + "</fieldset>" : "")
      + modifierFields();
    return foundry.applications.api.DialogV2.prompt({
      classes: ["ad2e"],
      window: { title: game.i18n.format("AD2E.Init.Title", { name: combatant?.name ?? "" }) },
      content,
      ok: { label: i18n("AD2E.Roll.Roll"), callback: (event, button) => {
        const f = button.form.elements;
        const action = actions.find(a => a.key === f.action?.value) ?? chosen;
        const situations = STANDARD_MODIFIERS.filter(m => f[`t55-${m.key}`]?.checked);
        const ticked = [...(button.form.querySelectorAll?.("input[name=kitinit]:checked") ?? [])].map(i => Number(i.value));
        const kit = kitOptions.filter(m => ticked.includes(m.index));
        return { action, situations, kit, ...readModifier(button.form) };
      } },
      rejectClose: false
    });
  }
}
