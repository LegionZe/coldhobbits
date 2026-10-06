import { dualClassOn, penalizedAward } from "../dual-class.mjs";
import { multiAward } from "../multi-class.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/**
 * GM tool: group experience award ("Experience Point Awards (DMG)": group awards "are divided equally among all
 * members of the adventuring party"; divide the total "by the number of surviving ... player characters"). The total
 * is the XP of the monsters picked from the current combat plus any other amount (story, treasure, ...); each
 * recipient's share gets the class prime-requisite bonus (10%, PHB class descriptions).
 * Dual-class characters (world setting, module/dual-class.mjs): the award is for an encounter or the adventure; a
 * character who used an earlier class's abilities gets nothing for the encounter or half for the adventure.
 * Multi-class characters (world setting, module/multi-class.mjs): the share is divided equally between the classes,
 * each part with that class's prime-requisite bonus (owner's ruling).
 */
export default class AwardXp extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "ad2e-award-xp",
    classes: ["ad2e", "award-xp"],
    window: { title: "AD2E.Xp.Title", icon: "fa-solid fa-star", resizable: true },
    position: { width: 560, height: "auto" },
    actions: { award: AwardXp.#onAward }
  };

  static PARTS = { main: { template: "systems/ad2e/templates/apps/award-xp.hbs" } };

  state = null;

  #initState() {
    const chars = game.actors.filter(a => a.type === "character");
    const party = chars.filter(a => a.hasPlayerOwner);
    const recipients = new Set((party.length ? party : chars).filter(a => a.system.hpState?.state !== "dead").map(a => a.id));
    const monsters = (game.combat?.combatants ?? []).filter(c => c.actor?.type === "monster")
      .map(c => ({ id: c.id, name: c.name, xp: c.actor.system.xp ?? 0, picked: c.actor.system.hpState?.state === "dead" }));
    this.state = { recipients, monsters, other: 0, reason: "", kind: game.combat ? "encounter" : "adventure" };
  }

  /** Shares: total split equally among the recipients; each share gets the recipient's prime-requisite bonus. */
  static shares(total, actors, kind = "adventure") {
    const n = actors.length;
    const share = n ? Math.floor(total / n) : 0;
    return actors.map(a => {
      if (a.system.multi) {
        const award = multiAward(a.system.multi.classes, share);
        return { actor: a, share, bonus: 0, gain: award.gain, xp: award.rows.map(r => `${r.name} ${r.xp}`).join(", "), next: null,
          canLevel: award.canLevel, rule: "", clear: {}, update: award.update,
          parts: award.rows.map(r => `${r.name} +${r.gain}${r.bonus ? ` (+${r.bonus}%)` : ""}`).join(", ") };
      }
      const bonus = a.system.classInfo?.xpBonus ?? 0;
      const full = Math.floor(share * (100 + bonus) / 100);
      // Dual-class penalty (module/dual-class.mjs): only characters with earlier classes carry the flags.
      const pen = a.system.dual ? penalizedAward(full, kind, a.system.dualClass?.penalty) : { gain: full, rule: "", clear: {} };
      const gain = pen.gain;
      const xp = (a.system.xp ?? 0) + gain;
      const next = a.system.xpNext ?? null;
      const clear = a.system.dual ? pen.clear : {};
      return { actor: a, share, bonus, gain, xp, next, canLevel: next !== null && xp >= next, rule: pen.rule, clear,
        update: { "system.xp": xp, ...Object.fromEntries(Object.entries(clear).map(([k, v]) => [`system.dualClass.penalty.${k}`, v])) } };
    });
  }

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    if (!this.state) this.#initState();
    const s = this.state;
    const total = s.monsters.filter(m => m.picked).reduce((n, m) => n + m.xp, 0) + (Number(s.other) || 0);
    const actors = game.actors.filter(a => a.type === "character");
    const chosen = actors.filter(a => s.recipients.has(a.id));
    const rows = AwardXp.shares(total, chosen, s.kind);
    return {
      ...context, total, count: chosen.length, other: s.other, reason: s.reason, monsters: s.monsters, inCombat: !!game.combat,
      dual: dualClassOn(), kind: s.kind, kindEncounter: s.kind === "encounter",
      characters: actors.map(a => {
        const r = rows.find(x => x.actor === a);
        return { id: a.id, name: a.name, checked: s.recipients.has(a.id), dead: a.system.hpState?.state === "dead",
          share: r?.share ?? "", bonus: r?.bonus ? `+${r.bonus}%` : "", gain: r ? (r.parts ? `${r.gain} (${r.parts})` : r.gain) : "", xp: r?.xp ?? "", canLevel: r?.canLevel,
          penalty: r?.rule ? game.i18n.localize(`AD2E.Dual.Award.${r.rule}`) : "" };
      }),
      canAward: total > 0 && chosen.length > 0
    };
  }

  _onRender(context, options) {
    super._onRender?.(context, options);
    const el = this.element;
    for (const box of el.querySelectorAll("input[data-recipient]")) box.addEventListener("change", ev => {
      const id = ev.currentTarget.dataset.recipient;
      if (ev.currentTarget.checked) this.state.recipients.add(id); else this.state.recipients.delete(id);
      this.render();
    });
    for (const box of el.querySelectorAll("input[data-monster]")) box.addEventListener("change", ev => {
      const m = this.state.monsters.find(x => x.id === ev.currentTarget.dataset.monster);
      if (m) m.picked = ev.currentTarget.checked;
      this.render();
    });
    el.querySelector("input[name=other]")?.addEventListener("change", ev => { this.state.other = Math.max(Number(ev.currentTarget.value) || 0, 0); this.render(); });
    el.querySelector("input[name=reason]")?.addEventListener("change", ev => { this.state.reason = ev.currentTarget.value; });
    el.querySelector("select[name=kind]")?.addEventListener("change", ev => { this.state.kind = ev.currentTarget.value; this.render(); });
  }

  static async #onAward() {
    const s = this.state;
    const total = s.monsters.filter(m => m.picked).reduce((n, m) => n + m.xp, 0) + (Number(s.other) || 0);
    const chosen = game.actors.filter(a => a.type === "character" && s.recipients.has(a.id));
    if (!total || !chosen.length) return;
    const rows = AwardXp.shares(total, chosen, s.kind);
    for (const r of rows) {
      await r.actor.update(r.update);
    }
    const esc = v => foundry.utils.escapeHTML(String(v ?? ""));
    const lines = rows.map(r => `<li>${esc(r.actor.name)}: +${r.gain}${r.parts ? ` (${esc(r.parts)})` : ""}${r.bonus ? ` (${game.i18n.format("AD2E.Xp.WithBonus", { bonus: r.bonus })})` : ""}`
      + `${r.rule ? ` [${esc(game.i18n.localize(`AD2E.Dual.Award.${r.rule}`))}]` : ""} → ${r.xp}`
      + `${r.canLevel ? ` — <strong>${game.i18n.localize("AD2E.Xp.CanLevel")}</strong>` : ""}</li>`).join("");
    await ChatMessage.create({ content: `<p><strong>${game.i18n.format("AD2E.Xp.ChatTitle", { total, n: rows.length, share: rows[0].share })}</strong>`
      + `${s.reason ? ` ${esc(s.reason)}` : ""}</p><ul>${lines}</ul>` });
    this.state = null;
    this.close();
  }
}
