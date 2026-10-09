import { ad2eDialog } from "../dialogs.mjs";
import { ABILITY_KEYS, METHODS, defaultAssignment, results, scores } from "../ability-methods.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/**
 * Generate a character's ability scores by PHB Method II-VI ("Rolling Ability Scores (PHB)"; rules in
 * module/ability-methods.mjs). Rolls use Foundry dice and are posted to chat; the player assigns them, and Apply writes
 * the rolled scores (system.abilities.<key>.value; racial adjustments apply on top). A warrior whose Strength comes to
 * 18 may roll percentile dice for exceptional Strength ("any warrior with a strength score of 18 is entitled to roll
 * percentile dice", Strength (PHB)).
 */
export default class AbilityRoller extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    classes: ["ad2e", "ability-roller"],
    window: { title: "AD2E.AbilityRoll.Title", icon: "fa-solid fa-dice", resizable: true },
    position: { width: 560, height: "auto" },
    actions: { roll: AbilityRoller.#onRoll, apply: AbilityRoller.#onApply }
  };

  static PARTS = { main: { template: "systems/ad2e/templates/apps/ability-roller.hbs" } };

  constructor(actor, options = {}) {
    super({ id: `ad2e-ability-roller-${actor.id}`, ...options });
    this.actor = actor;
  }

  get title() {
    return `${game.i18n.localize("AD2E.AbilityRoll.Title")}: ${this.actor.name}`;
  }

  state = { method: "5", res: [], assignment: {}, exceptional: true };

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const s = this.state;
    const m = METHODS[s.method];
    const i18n = k => game.i18n.localize(k);
    const label = k => i18n(`AD2E.Ability.${k}`);
    const adjust = Object.fromEntries((this.actor.system.raceInfo?.requirements ?? []).map(r => [r.key, r.adjust ?? 0]));
    const rolled = s.res.length > 0;
    const { scores: sc, errors } = rolled ? scores(s.method, s.res, s.assignment) : { scores: {}, errors: [] };
    const resText = r => `${r.total} (${r.dice.join(", ")}${r.dropped !== null ? `; ${game.i18n.format("AD2E.AbilityRoll.Dropped", { n: r.dropped })}` : ""})`;
    const rows = ABILITY_KEYS.map((k, i) => {
      const row = { key: k, label: label(k), score: sc[k] ?? null, adjust: adjust[k] || 0 };
      row.total = row.score !== null ? row.score + row.adjust : null;
      if (m.kind === "pairs" && rolled) {
        row.pair = [0, 1].map(p => ({ value: p, text: resText(s.res[i * 2 + p]), checked: Number(s.assignment[k] ?? 0) === p }));
      } else if (m.kind === "pool" && rolled) {
        row.options = [{ value: "", text: "—", selected: s.assignment[k] === "" || s.assignment[k] === undefined },
          ...s.res.map(r => ({ value: String(r.index), text: `#${r.index + 1}: ${resText(r)}`, selected: String(s.assignment[k]) === String(r.index) }))];
      }
      return row;
    });
    const dice = m.kind === "dice" && rolled ? s.res.map((r, i) => ({ index: i, value: r.total,
      options: [{ value: "", text: "—", selected: !s.assignment[i] },
        ...ABILITY_KEYS.map(k => ({ value: k, text: label(k), selected: s.assignment[i] === k }))] })) : [];
    const strTotal = rows[0].total;
    const warrior = this.actor.system.classGroup === "warrior";
    return {
      ...context,
      methods: Object.keys(METHODS).map(k => ({ value: k, text: i18n(`AD2E.AbilityRoll.Method${k}`), selected: k === s.method })),
      hint: i18n(`AD2E.AbilityRoll.Hint${s.method}`),
      rolled, rows, dice, isPairs: m.kind === "pairs", isPool: m.kind === "pool", isDice: m.kind === "dice",
      errors: errors.map(e => game.i18n.format(e.key, { ...e.data, ability: e.data.ability ? label(e.data.ability) : "" })),
      canApply: rolled && !errors.length,
      offerExceptional: warrior && strTotal === 18,
      exceptional: s.exceptional,
      hasRace: Object.values(adjust).some(v => v)
    };
  }

  _onRender(context, options) {
    super._onRender?.(context, options);
    const el = this.element;
    el.querySelector("select[name=method]")?.addEventListener("change", ev => {
      this.state.method = ev.currentTarget.value;
      this.state.res = [];
      this.state.assignment = {};
      this.render();
    });
    for (const input of el.querySelectorAll("[data-assign]")) {
      input.addEventListener("change", ev => {
        const t = ev.currentTarget;
        if (t.type === "radio" && !t.checked) return;
        this.state.assignment[t.dataset.assign] = t.value;
        this.render();
      });
    }
    el.querySelector("input[name=exceptional]")?.addEventListener("change", ev => { this.state.exceptional = ev.currentTarget.checked; });
  }

  /** Roll the method's dice (Foundry dice, posted to chat) and set the default assignment. */
  static async #onRoll() {
    const s = this.state;
    const m = METHODS[s.method];
    const rolls = [];
    for (let i = 0; i < m.count; i++) rolls.push(await new Roll(m.dice).evaluate());
    s.res = results(s.method, rolls.map(r => r.dice.flatMap(d => d.results.map(x => x.result))));
    s.assignment = defaultAssignment(s.method, s.res);
    const list = s.res.map(r => `${r.total}${r.dropped !== null ? ` (${r.dice.join("+")} − ${r.dropped})` : ""}`).join(", ");
    await ChatMessage.create({ speaker: ChatMessage.getSpeaker({ actor: this.actor }), rolls,
      content: `<p><strong>${game.i18n.format("AD2E.AbilityRoll.ChatTitle", { method: game.i18n.localize(`AD2E.AbilityRoll.Method${s.method}`) })}</strong></p><p>${list}</p>` });
    this.render();
  }

  /** Write the scores (after confirmation); roll exceptional Strength for an 18-Strength warrior if chosen. */
  static async #onApply() {
    const s = this.state;
    const { scores: sc, errors } = scores(s.method, s.res, s.assignment);
    if (!s.res.length || errors.length) return;
    const ok = await ad2eDialog.confirm({
      window: { title: game.i18n.localize("AD2E.AbilityRoll.Apply") },
      content: `<p>${game.i18n.localize("AD2E.AbilityRoll.ConfirmApply")}</p>`, rejectClose: false
    });
    if (!ok) return;
    const update = Object.fromEntries(ABILITY_KEYS.map(k => [`system.abilities.${k}.value`, sc[k]]));
    const adjust = (this.actor.system.raceInfo?.requirements ?? []).find(r => r.key === "str")?.adjust ?? 0;
    let exceptional = 0;
    if (this.actor.system.classGroup === "warrior" && sc.str + adjust === 18 && s.exceptional) {
      const roll = await new Roll("1d100").evaluate();
      exceptional = roll.total;
      await roll.toMessage({ speaker: ChatMessage.getSpeaker({ actor: this.actor }),
        flavor: game.i18n.format("AD2E.AbilityRoll.ExceptionalChat", { value: exceptional === 100 ? "00" : String(exceptional).padStart(2, "0") }) });
    }
    update["system.abilities.str.exceptional"] = exceptional;
    await this.actor.update(update);
    ui.notifications.info(game.i18n.format("AD2E.AbilityRoll.Applied", { name: this.actor.name }));
    this.close();
  }
}
