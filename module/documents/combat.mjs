import { ad2eDialog } from "../dialogs.mjs";
import { modifierFields, modifierText, readModifier } from "../roll-modifiers.mjs";
import { castingTimeModifier, defaultAction, initiativeActions, sideOf, STANDARD_MODIFIERS } from "../initiative.mjs";
import { displayPenalty } from "../kit-features.mjs";

export { sideOf };

/** Roll term flavor text (no brackets). */
const flavor = s => String(s ?? "").replace(/[[\]]/g, "").trim();

/**
 * Initiative method (world setting "initiativeMode"; Initiative (PHB)):
 *  - "individual" (optional rule): each combatant rolls 1d10 and adds its own modifiers.
 *  - "group" (optional rule): "one initiative die roll is still made for each side", and each combatant adds the
 *    modifiers for its own action (Table 56).
 *  - "standard": "roll 1d10 for each side in the battle"; every member of a side acts on the side's roll (Table 55
 *    situations and a manual modifier still apply when asked).
 */
export function initiativeMode() {
  let m;
  try { m = game.settings.get("ad2e", "initiativeMode"); } catch { /* not registered */ }
  return ["group", "standard"].includes(m) ? m : "individual";
}

/** The side rolls stored for the combat's current round: { "<side>": n } (combat flag ad2e.sides.r<round>). */
function sideRolls(combat) {
  return combat?.getFlag?.("ad2e", `sides.r${combat.round ?? 0}`) ?? {};
}

/** Base initiative formula for a combatant: 1d10 + @init, or the side's roll (group: + @init; standard: alone). */
function baseFormula(combatant, mode = initiativeMode()) {
  const base = CONFIG.Combat.initiative.formula;
  if (mode === "individual") return base;
  const n = sideRolls(combatant?.parent ?? combatant?.combat)[sideOf(combatant)];
  if (n === undefined) return base;
  return mode === "standard" ? `${n}[${flavor(game.i18n.localize("AD2E.Init.SideRoll"))}]`
    : base.replace(/\b\d*d10\b/, `${n}[${flavor(game.i18n.localize("AD2E.Init.SideRoll"))}]`);
}

/**
 * Combatants: an initiative roll made without the dialog (Roll All, Roll NPCs) adds the automatic action's modifier
 * (module/initiative.mjs: weapon speed factor, or a monster's size with natural weapons) to the combatant's or its
 * side's roll; in the standard method the side's roll alone. Same override point as dnd5e's
 * Combatant5e#getInitiativeRoll on v14.
 */
export class AD2ECombatant extends Combatant {
  /** @override */
  getInitiativeRoll(formula) {
    if (formula || !this.actor) return super.getInitiativeRoll(formula);
    const mode = initiativeMode();
    // Weapon Master's display (module/kit-features.mjs): the other side's rolls in rounds 1-2 get the penalty.
    const shown = displayPenalty(this.parent, this, sideOf);
    const display = shown ? ` + ${shown.value}[${flavor(game.i18n.format("AD2E.KitFeature.DisplayTerm", { name: shown.name }))}]` : "";
    const base = baseFormula(this, mode);
    if (mode === "standard") return super.getInitiativeRoll(base + display);
    const action = defaultAction(this.actor);
    return super.getInitiativeRoll((action.value ? `${base} + ${action.value}[${flavor(action.short)}]` : base) + display);
  }
}

/** AD&D 2e initiative: d10, lowest acts first. */
export default class AD2ECombat extends Combat {
  _sortCombatants(a, b) {
    const ia = Number.isNumeric(a.initiative) ? a.initiative : Infinity;
    const ib = Number.isNumeric(b.initiative) ? b.initiative : Infinity;
    return (ia - ib) || a.name.localeCompare(b.name) || (a.id > b.id ? 1 : -1);
  }

  /**
   * Group and standard methods: one 1d10 per side and round, rolled (and posted to chat) the first time a member of
   * that side rolls in the round, by the GM; a player rolling before the GM has rolled for the side is told to wait.
   * Returns false when a side roll is missing and the user may not make it.
   */
  async #ensureSideRolls(list) {
    const sides = [...new Set(list.map(id => sideOf(this.combatants.get(id))))];
    const rolls = { ...sideRolls(this) };
    const missing = sides.filter(s => rolls[s] === undefined);
    if (!missing.length) return true;
    if (!game.user.isGM) {
      ui.notifications.warn(game.i18n.localize("AD2E.Init.SideGmFirst"));
      return false;
    }
    for (const s of missing) {
      const roll = await new Roll("1d10").evaluate();
      rolls[s] = roll.total;
      const side = game.i18n.localize(`AD2E.Init.Side.${s}`);
      await roll.toMessage({ speaker: { alias: side }, flavor: game.i18n.format("AD2E.Init.SideChat", { side, round: this.round }) });
    }
    await this.setFlag("ad2e", `sides.r${this.round ?? 0}`, rolls);
    return true;
  }

  /**
   * Rolling one combatant (the tracker's die icon) asks for its action (weapon speed factor, casting time, scroll,
   * magical item, breath weapon, innate ability or natural weapons; Initiative (PHB) Table 56), the Table 55 situations
   * and a modifier with reason; all are added to the 1d10 (or the side's roll; lower acts first) and shown in chat.
   * Rolling several at once (Roll All, Roll NPCs) uses each combatant's automatic action (AD2ECombatant). World
   * setting "initiativePrompt" turns the question off; "initiativeMode" chooses individual, group or standard.
   * A hasted caster gains no benefit from haste in a round it casts ("Since she is casting a spell, she gains no
   * benefit from the haste spell", Initiative (PHB)).
   */
  async rollInitiative(ids, options = {}) {
    const list = typeof ids === "string" ? [ids] : Array.from(ids);
    const mode = initiativeMode();
    if (mode !== "individual" && !options.formula && !(await this.#ensureSideRolls(list))) return this;
    let ask = list.length === 1 && !options.formula;
    try { ask &&= game.settings.get("ad2e", "initiativePrompt"); } catch { /* setting not registered */ }
    if (ask) {
      const combatant = this.combatants.get(list[0]);
      const input = await AD2ECombat.#prompt(combatant, mode);
      if (!input) return this;
      const base = baseFormula(combatant, mode);
      const casting = mode !== "standard" && /^(spell|scroll)\./.test(input.action.key);
      const hasteLost = casting && input.situations.some(s => s.key === "hasted");
      const situations = hasteLost ? input.situations.filter(s => s.key !== "hasted") : input.situations;
      const action = mode === "standard" ? null : input.action;
      const terms = [action?.value ? `${action.value}[${flavor(action.short)}]` : null,
        input.display ? `${input.display.value}[${flavor(game.i18n.format("AD2E.KitFeature.DisplayTerm", { name: input.display.name }))}]` : null,
        // A kit initiative bonus lowers the roll (lowest acts first).
        ...(mode === "standard" ? [] : input.kit.map(k => `${-k.current}[${flavor(k.condition)}]`)),
        ...situations.map(s => `${s.value}[${flavor(s.label)}]`), input.mod ? `${input.mod}[${flavor(input.note || "modifier")}]` : null]
        .filter(Boolean);
      const parts = [action && action.key !== "none" ? action.label : null, action?.note || null,
        input.display ? game.i18n.format("AD2E.KitFeature.DisplayTerm", { name: input.display.name }) + ` +${input.display.value}` : null,
        ...situations.map(s => `${s.label} ${s.value > 0 ? "+" : ""}${s.value}`),
        ...(mode === "standard" ? [] : input.kit.map(k => `${k.condition} ${-k.current > 0 ? "+" : ""}${-k.current}`)),
        hasteLost ? game.i18n.localize("AD2E.Init.HasteCasting") : null,
        mode !== "individual" ? game.i18n.format("AD2E.Init.SideNote", { side: game.i18n.localize(`AD2E.Init.Side.${sideOf(combatant)}`) }) : null]
        .filter(Boolean);
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

  /** Initiative dialog: action (default: the automatic one), scroll casting time, Table 55 situations, modifier. */
  static async #prompt(combatant, mode = "individual") {
    const i18n = k => game.i18n.localize(k);
    const esc = v => foundry.utils.escapeHTML?.(String(v ?? "")) ?? String(v ?? "");
    const actor = combatant?.actor;
    const actions = initiativeActions(actor);
    const chosen = defaultAction(actor, [...actions]);
    const hasScroll = actions.some(a => a.scroll);
    // Conditional kit initiative modifiers (e.g. the astrologer's hung spells); unconditional ones are in @init.
    const kitOptions = actor?.type === "character" && mode !== "standard" ? (actor.system.kitMods?.options("initiative") ?? []) : [];
    // Weapon Master's display seen by this combatant's side (pre-ticked; untick if it did not see it).
    const shown = displayPenalty(combatant?.parent, combatant, sideOf);
    const content = `<p class="ad2e-note">${i18n("AD2E.Init.Hint")}${mode !== "individual" ? ` ${i18n(`AD2E.Init.ModeNote.${mode}`)}` : ""}</p>`
      + (mode === "standard" ? "" : `<div class="form-group"><label>${i18n("AD2E.Init.ActionLabel")}</label><select name="action">${actions.map(a =>
        `<option value="${esc(a.key)}"${a.key === chosen.key ? " selected" : ""}>${esc(a.label)}</option>`).join("")}</select></div>`
        + (hasScroll ? `<div class="form-group"><label>${i18n("AD2E.Init.ScrollTime")}</label><input type="text" name="scrollTime" value="1"></div>` : ""))
      + `<fieldset><legend>${i18n("AD2E.Init.Standard")}</legend><div class="ad2e-check-grid">${STANDARD_MODIFIERS.map(m =>
        `<label><input type="checkbox" name="t55-${m.key}" value="${m.value}"> ${esc(m.label)} (${m.value > 0 ? "+" : ""}${m.value})</label>`).join("")}</div></fieldset>`
      + (kitOptions.length ? `<fieldset><legend>${esc(game.i18n.format("AD2E.Kit.Situational", { kit: actor.system.classInfo?.kitItem?.name ?? "" }))}</legend>`
        + kitOptions.map(m => `<div class="form-group"><label>${esc(`${m.current > 0 ? "-" : "+"}${Math.abs(m.current)} ${m.condition}`)}</label>`
          + `<input type="checkbox" name="kitinit" value="${m.index}"></div>`).join("") + "</fieldset>" : "")
      + (shown ? `<div class="form-group"><label>${esc(game.i18n.format("AD2E.KitFeature.SawDisplay", { name: shown.name, n: shown.value }))}</label>`
        + `<input type="checkbox" name="display" checked></div>` : "")
      + modifierFields();
    return ad2eDialog.prompt({
      classes: ["ad2e"],
      window: { title: game.i18n.format("AD2E.Init.Title", { name: combatant?.name ?? "" }) },
      content,
      ok: { label: i18n("AD2E.Roll.Roll"), callback: (event, button) => {
        const f = button.form.elements;
        let action = actions.find(a => a.key === f.action?.value) ?? chosen;
        if (action.scroll) {
          // The casting time of the spell on the scroll: a number, or a time in rounds/turns (end of the round).
          const ct = castingTimeModifier(f.scrollTime?.value) ?? { value: 0, endOfRound: false };
          action = { ...action, value: ct.value, note: ct.endOfRound ? i18n("AD2E.Init.EndOfRound") : "",
            label: `${action.label}: ${f.scrollTime?.value ?? ""}` };
        }
        const situations = STANDARD_MODIFIERS.filter(m => f[`t55-${m.key}`]?.checked);
        const ticked = [...(button.form.querySelectorAll?.("input[name=kitinit]:checked") ?? [])].map(i => Number(i.value));
        const kit = kitOptions.filter(m => ticked.includes(m.index));
        return { action, situations, kit, display: shown && f.display?.checked ? shown : null, ...readModifier(button.form) };
      } },
      rejectClose: false
    });
  }
}
