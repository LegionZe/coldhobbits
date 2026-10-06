import { AD2E, creatureHitDice } from "../config.mjs";
import { CREATOR_TABLES } from "../rules/creator-tables.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/**
 * GM creators: guided windows that fill in the rule-based values and create the document in the world or an unlocked
 * world compendium. Tables in module/rules/creator-tables.mjs (tools/build-creator-tables.py, regex-checked).
 *
 * Monster creator: THAC0 from Hit Dice (DMG Table 39), saving throws by Hit Dice (monster data model), experience from
 * DMG Table 31 after adding the Table 32 Hit Dice modifiers ("a 1 + 1 Hit Die creature with +2 Hit Dice of special
 * abilities becomes a 3 + 1 Hit Dice creature", Experience Point Awards (DMG)); Monstrous Manual size, intelligence and
 * morale bands. Hit points are rolled from the Hit Dice.
 */
export const MONSTER = CREATOR_TABLES.monster;

/**
 * Hit Dice on the Table 31 scale: n = n, n+x = n + 0.5, n-1 = n - 0.5, n-2 or less = n - 0.75; less than one die (1/2,
 * 1/4) below 0.5 ("Less than 1-1").
 */
export function hdScale(dice, bonus = 0) {
  if (dice < 1) return dice * 0.8;
  if (bonus > 0) return dice + 0.5;
  if (bonus === -1) return dice - 0.5;
  if (bonus < -1) return dice - 0.75;
  return dice;
}

/** Table 31 experience for a value on the Hit Dice scale. */
export function xpForHitDice(value, rows = MONSTER.xp) {
  for (const r of rows) {
    if (r.max === null && value >= r.min) return r.xp + r.perDie * (Math.floor(value) - r.over);
    if (r.min === null && value < r.max) return r.xp;
    if (r.min !== null && r.max !== null && value >= r.min && value <= r.max) return r.xp;
  }
  return 0;
}

/** Table 32 modifiers chosen (keys), with the spell rows not cumulative: the larger one counts. */
export function hdModifierTotal(keys, mods = MONSTER.hdModifiers, exclusive = MONSTER.exclusive) {
  const chosen = new Set(keys);
  for (const group of exclusive) {
    const inGroup = group.filter(k => chosen.has(k));
    if (inGroup.length > 1) {
      const best = inGroup.sort((a, b) => mods.find(m => m.key === b).hd - mods.find(m => m.key === a).hd)[0];
      for (const k of inGroup) if (k !== best) chosen.delete(k);
    }
  }
  return mods.filter(m => chosen.has(m.key)).reduce((n, m) => n + m.hd, 0);
}

/** A monster's experience value: Table 31 for its Hit Dice plus the Table 32 modifiers. */
export function monsterXp(hitDice, keys = []) {
  const hd = creatureHitDice(hitDice);
  if (hd.hpOnly) return xpForHitDice(0.25 + hdModifierTotal(keys));
  return xpForHitDice(hdScale(hd.dice, hd.bonus) + hdModifierTotal(keys));
}

/** The Monstrous Manual band (label) holding a rating. */
export function bandFor(bands, value) {
  return bands.find(b => value >= b.min && (b.max === null || value <= b.max)) ?? null;
}

const ATTACK_ROWS = 3;

export class MonsterCreator extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "ad2e-monster-creator",
    classes: ["ad2e", "creator"],
    window: { title: "AD2E.Creator.Monster.Title", icon: "fa-solid fa-dragon", resizable: true },
    position: { width: 640, height: "auto" },
    actions: { create: MonsterCreator.#onCreate }
  };

  static PARTS = { main: { template: "systems/ad2e/templates/apps/monster-creator.hbs" } };

  state = {
    name: "", role: "monster", size: "M", hitDice: "1", ac: 10, move: 12, moveText: "", intelligence: 8, alignment: "Neutral",
    morale: 10, numberAppearing: "1", treasure: "", climate: "", organization: "", activity: "", diet: "", frequency: "",
    attacks: Array.from({ length: ATTACK_ROWS }, (_, i) => ({ name: i ? "" : "Attack", damage: i ? "" : "1d6" })),
    specialAttacks: "", specialDefenses: "", magicResistance: "", mods: [], xpOverride: "", destination: ""
  };

  /** Derived preview: THAC0, saving throw level, experience. */
  static preview(state) {
    const hd = creatureHitDice(state.hitDice);
    const table = AD2E.creatureThac0;
    const auto = monsterXp(state.hitDice, state.mods);
    return { invalid: !!hd.invalid, thac0: table[Math.min(hd.thac0Index, table.length - 1)], saveLevel: hd.saveLevel, formula: hd.formula,
      xpAuto: auto, xp: state.xpOverride === "" || state.xpOverride === null ? auto : Number(state.xpOverride) || 0,
      hdMods: hdModifierTotal(state.mods) };
  }

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const s = this.state;
    const p = MonsterCreator.preview(s);
    const intBand = bandFor(MONSTER.intelligence, s.intelligence);
    const moraleBand = bandFor(MONSTER.morale, s.morale);
    const packs = [...(game.packs ?? [])].filter(pk => pk.documentName === "Actor" && pk.metadata?.packageType === "world" && !pk.locked);
    return {
      ...context, s, p, attackRows: s.attacks.map((a, i) => ({ ...a, i, n: i + 1 })),
      roles: Object.entries(AD2E.monsterRoles).map(([k, v]) => ({ key: k, label: game.i18n.localize(v), selected: k === s.role })),
      sizes: MONSTER.sizes.map(z => ({ ...z, selected: z.key === s.size })),
      intBand: intBand ? `${intBand.label}` : "", moraleBand: moraleBand?.label ?? "",
      mods: MONSTER.hdModifiers.map(m => ({ ...m, checked: s.mods.includes(m.key) })),
      destinations: [{ key: "", label: game.i18n.localize("AD2E.Creator.World"), selected: !s.destination },
        ...packs.map(pk => ({ key: pk.collection, label: pk.metadata.label, selected: s.destination === pk.collection }))]
    };
  }

  _onRender(context, options) {
    super._onRender?.(context, options);
    const el = this.element;
    for (const input of el.querySelectorAll("[data-field]")) input.addEventListener("change", ev => {
      const t = ev.currentTarget;
      const f = t.dataset.field;
      if (f === "mod") {
        const set = new Set(this.state.mods);
        if (t.checked) set.add(t.dataset.key); else set.delete(t.dataset.key);
        this.state.mods = [...set];
      } else if (f === "attack") {
        this.state.attacks[Number(t.dataset.index)][t.dataset.part] = t.value;
      } else {
        this.state[f] = t.type === "number" && f !== "xpOverride" ? Number(t.value) || 0 : t.value;
      }
      this.render();
    });
  }

  /** Actor data from the state (pure; hit points from `hp`). */
  static actorData(state, hp) {
    const p = MonsterCreator.preview(state);
    const intBand = bandFor(MONSTER.intelligence, state.intelligence);
    const moraleBand = bandFor(MONSTER.morale, state.morale);
    const attacks = state.attacks.filter(a => a.name && a.damage).map(a => ({ name: a.name, damage: a.damage, bonus: 0, element: "" }));
    return {
      name: state.name || game.i18n.localize("AD2E.Creator.Monster.Unnamed"), type: "monster",
      system: {
        role: state.role, size: state.size, hitDice: state.hitDice, ac: { base: state.ac, text: String(state.ac) },
        movement: { base: state.move, text: state.moveText || String(state.move) },
        hp: { value: hp, max: hp }, xp: p.xp, alignment: state.alignment, numberAppearing: state.numberAppearing,
        treasure: state.treasure, climate: state.climate, organization: state.organization, activity: state.activity,
        diet: state.diet, frequency: state.frequency,
        intelligence: intBand ? `${intBand.label} (${state.intelligence})` : String(state.intelligence),
        morale: { value: state.morale, text: moraleBand ? `${moraleBand.label} (${state.morale})` : String(state.morale) },
        attacks, attacksText: String(attacks.length || ""), damageText: attacks.map(a => a.damage).join("/"),
        specialAttacks: state.specialAttacks, specialDefenses: state.specialDefenses, magicResistance: state.magicResistance,
        notes: state.mods.length ? `<p>${game.i18n.localize("AD2E.Creator.Monster.XpNote")}: ${MONSTER.hdModifiers
          .filter(m => state.mods.includes(m.key)).map(m => `${m.label} (+${m.hd})`).join(", ")}</p>` : ""
      }
    };
  }

  static async #onCreate() {
    const s = this.state;
    const p = MonsterCreator.preview(s);
    if (p.invalid) return ui.notifications.warn(game.i18n.localize("AD2E.Creator.Monster.BadHitDice"));
    const roll = await new Roll(p.formula).evaluate();
    const data = MonsterCreator.actorData(s, Math.max(roll.total, 1));
    const actor = await Actor.implementation.create(data, s.destination ? { pack: s.destination } : {});
    if (!actor) return null;
    ui.notifications.info(game.i18n.format("AD2E.Creator.Created", { name: actor.name }));
    actor.sheet?.render(true);
    return actor;
  }
}
