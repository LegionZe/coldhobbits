import { dualClassOn, penalizedAward } from "../dual-class.mjs";
import { multiAward } from "../multi-class.mjs";
import { creatureHitDice } from "../config.mjs";
import { monsterXp } from "./creators.mjs";
import { CREATOR_TABLES } from "../rules/creator-tables.mjs";

/**
 * DMG Table 34 individual class awards per Hit Die of creatures defeated (CREATOR_TABLES.classAwards, regex-checked;
 * "Individual awards are optional", owner's choice: a tick box per character): warriors 10 XP ("10 XP/level", read as
 * per Hit Die or level of each creature), bards 5 XP. Multi-class characters get the larger rate of their classes.
 */
export const CLASS_AWARDS = CREATOR_TABLES.classAwards;

/** XP per Hit Die of creatures defeated for a character (0 if neither a warrior nor a bard). */
export function classAwardRate(actor) {
  const sys = actor?.system ?? {};
  const classes = sys.multi?.classes?.length ? sys.multi.classes.map(c => ({ group: c.group, id: c.identifier }))
    : [{ group: sys.classInfo?.classItem?.system?.group ?? sys.classGroup, id: sys.classInfo?.classItem?.system?.identifier }];
  return Math.max(0, ...classes.map(c => (c.group === "warrior" ? CLASS_AWARDS.warrior : (c.id === "bard" ? CLASS_AWARDS.bard : 0))));
}

/** A monster combatant's award row: its XP value, or Table 31/32 from its Hit Dice when none is set (calculated). */
export function monsterRow(c) {
  const sys = c.actor?.system ?? {};
  const set = Number(sys.xp) || 0;
  const hd = creatureHitDice(sys.hitDice);
  return { id: c.id, name: c.name, xp: set || monsterXp(sys.hitDice), calculated: !set, hd: hd.hpOnly ? 0 : hd.dice,
    picked: sys.hpState?.state === "dead" };
}

/**
 * Combat end (owner's ruling): the GM gets this window with the combat's monsters (the dead ones ticked) and its
 * characters as recipients. World setting "xpOnCombatEnd" (default on).
 */
export function registerAwardXp() {
  game.settings.register("ad2e", "xpOnCombatEnd", {
    name: "AD2E.Xp.AutoSetting", hint: "AD2E.Xp.AutoSettingHint", scope: "world", config: true, type: Boolean, default: true
  });
  Hooks.on("deleteCombat", combat => {
    if (!game.user?.isActiveGM) return;
    let on = true;
    try { on = game.settings.get("ad2e", "xpOnCombatEnd"); } catch { on = true; }
    if (!on || ![...(combat.combatants ?? [])].some(c => c.actor?.type === "monster")) return;
    new AwardXp({ combat }).render({ force: true });
  });
}

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

  /** The combat whose monsters are offered (a combat that just ended), kept outside the application options. */
  #combat = null;

  constructor({ combat = null, ...options } = {}) {
    super(options);
    this.#combat = combat;
  }

  get combat() {
    return this.#combat;
  }

  #initState() {
    // A combat passed in (combat end) or the current one.
    const combat = this.#combat ?? game.combat ?? null;
    const combatants = [...(combat?.combatants ?? [])];
    const chars = game.actors.filter(a => a.type === "character");
    const inCombat = chars.filter(a => combatants.some(c => c.actor?.id === a.id));
    const party = chars.filter(a => a.hasPlayerOwner);
    const recipients = new Set((inCombat.length ? inCombat : (party.length ? party : chars)).filter(a => a.system.hpState?.state !== "dead").map(a => a.id));
    const monsters = combatants.filter(c => c.actor?.type === "monster").map(monsterRow);
    const classAwards = new Set(chars.filter(a => recipients.has(a.id) && classAwardRate(a) > 0).map(a => a.id));
    this.state = { recipients, monsters, other: 0, reason: "", kind: combat ? "encounter" : "adventure", inCombat: !!combat, classAwards };
  }

  /** Table 34 class awards: actor id -> XP for the Hit Dice of the ticked monsters. */
  static classAwardMap(state, actors) {
    const hd = state.monsters.filter(m => m.picked).reduce((n, m) => n + (m.hd || 0), 0);
    return new Map(actors.filter(a => state.classAwards?.has(a.id)).map(a => [a.id, Math.floor(classAwardRate(a) * hd)]));
  }

  /** Shares: total split equally among the recipients; each share gets the recipient's prime-requisite bonus. */
  static shares(total, actors, kind = "adventure", extra = new Map()) {
    const n = actors.length;
    const even = n ? Math.floor(total / n) : 0;
    return actors.map(a => {
      // A Table 34 class award joins the character's share (prime requisite bonus and dual-class rules apply to it).
      const share = even + (extra.get(a.id) ?? 0);
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
    const extra = AwardXp.classAwardMap(s, chosen);
    const rows = AwardXp.shares(total, chosen, s.kind, extra);
    return {
      ...context, total, count: chosen.length, other: s.other, reason: s.reason, monsters: s.monsters, inCombat: s.inCombat,
      dual: dualClassOn(), kind: s.kind, kindEncounter: s.kind === "encounter",
      characters: actors.map(a => {
        const r = rows.find(x => x.actor === a);
        const rate = classAwardRate(a);
        return { id: a.id, name: a.name, checked: s.recipients.has(a.id), dead: a.system.hpState?.state === "dead",
          classRate: rate, classAward: !!s.classAwards?.has(a.id), classXp: extra.get(a.id) ?? 0,
          share: r?.share ?? "", bonus: r?.bonus ? `+${r.bonus}%` : "", gain: r ? (r.parts ? `${r.gain} (${r.parts})` : r.gain) : "", xp: r?.xp ?? "", canLevel: r?.canLevel,
          penalty: r?.rule ? game.i18n.localize(`AD2E.Dual.Award.${r.rule}`) : "" };
      }),
      canAward: (total > 0 || [...extra.values()].some(v => v > 0)) && chosen.length > 0
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
    for (const box of el.querySelectorAll("input[data-class-award]")) box.addEventListener("change", ev => {
      const id = ev.currentTarget.dataset.classAward;
      this.state.classAwards ??= new Set();
      if (ev.currentTarget.checked) this.state.classAwards.add(id); else this.state.classAwards.delete(id);
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
    const extra = AwardXp.classAwardMap(s, chosen);
    if ((!total && ![...extra.values()].some(v => v > 0)) || !chosen.length) return;
    const rows = AwardXp.shares(total, chosen, s.kind, extra);
    for (const r of rows) {
      await r.actor.update(r.update);
    }
    const esc = v => foundry.utils.escapeHTML(String(v ?? ""));
    const lines = rows.map(r => `<li>${esc(r.actor.name)}: +${r.gain}${extra.get(r.actor.id) ? ` (${esc(game.i18n.format("AD2E.Xp.ClassAwardShort", { n: extra.get(r.actor.id) }))})` : ""}${r.parts ? ` (${esc(r.parts)})` : ""}${r.bonus ? ` (${game.i18n.format("AD2E.Xp.WithBonus", { bonus: r.bonus })})` : ""}`
      + `${r.rule ? ` [${esc(game.i18n.localize(`AD2E.Dual.Award.${r.rule}`))}]` : ""} → ${r.xp}`
      + `${r.canLevel ? ` — <strong>${game.i18n.localize("AD2E.Xp.CanLevel")}</strong>` : ""}</li>`).join("");
    await ChatMessage.create({ content: `<p><strong>${game.i18n.format("AD2E.Xp.ChatTitle", { total, n: rows.length, share: Math.floor(total / rows.length) })}</strong>`
      + `${s.reason ? ` ${esc(s.reason)}` : ""}</p><ul>${lines}</ul>` });
    this.state = null;
    this.close();
  }
}
