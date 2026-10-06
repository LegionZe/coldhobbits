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
    position: { width: 640, height: 720 },
    actions: { create: MonsterCreator.#onCreate }
  };

  // The body scrolls (styles/ad2e.css .ad2e-creator-body) and keeps its position when a change re-renders the window.
  static PARTS = { main: { template: "systems/ad2e/templates/apps/monster-creator.hbs", scrollable: [".ad2e-creator-body"] } };

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

/**
 * Weapon creator: a weapon item (and, if asked, its weapon proficiency) with the PHB weapon statistics the weapon sheet
 * shows read-only: size, type, speed factor, damage vs. small/medium and large (two rows, e.g. one- and two-handed),
 * melee/missile, rate of fire and range in yards, family (bow, crossbow, other), the Table 35 column for a specialist's
 * missile attacks, how Strength applies, two hands regardless of size, magical bonuses. It can start from any weapon in
 * the system's or the world's compendiums or the Items directory.
 */
export const WEAPON_SIZES = ["T", "S", "M", "L", "H", "G"];
export const MISSILE_COLUMNS = ["", ...Object.keys(AD2E.specialistAttacks ?? {}).filter(k => k !== "melee")];

/** Identifier from a name, as the generators make them ("Short sword" -> "short-sword"). */
export function slugify(name) {
  return String(name ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

/** Problems with a weapon's statistics (keys of AD2E.Creator.Weapon.Issue). */
export function weaponIssues(w, valid = f => /^\d*d\d+([+-]\d+)?$/i.test(String(f).replace(/\s/g, "")) || /^\d+$/.test(String(f))) {
  const issues = [];
  if (!w.melee && !w.missile) issues.push("noUse");
  if (!w.damage.some(d => d.sm || d.l)) issues.push("noDamage");
  for (const d of w.damage) for (const f of [d.sm, d.l]) if (f && !valid(f)) issues.push("badDamage");
  if (w.missile && !(w.range.short && w.range.medium && w.range.long)) issues.push("noRange");
  if (!/^[BPS](\/[BPS])*$/.test(w.type ?? "")) issues.push("badType");
  return [...new Set(issues)];
}

export class WeaponCreator extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "ad2e-weapon-creator",
    classes: ["ad2e", "creator"],
    window: { title: "AD2E.Creator.Weapon.Title", icon: "fa-solid fa-khanda", resizable: true },
    position: { width: 640, height: 720 },
    actions: { create: WeaponCreator.#onCreate }
  };

  static PARTS = { main: { template: "systems/ad2e/templates/apps/weapon-creator.hbs", scrollable: [".ad2e-creator-body"] } };

  static blank() {
    return { name: "", identifier: "", source: "", proficiency: "", newProficiency: true, cost: "", weight: null, hit: 0, dmg: 0,
      notes: "", destination: "", twoHands: false,
      weapon: { size: "M", type: "S", speed: 5, melee: true, missile: false, family: "other", missileColumn: "", strength: "full",
        damage: [{ label: "", sm: "1d6", l: "1d8" }, { label: "", sm: "", l: "" }], range: { rof: "", short: "", medium: "", long: "" } } };
  }

  state = WeaponCreator.blank();
  sources = null; // [{ uuid, name, pack }]
  proficiencies = null; // [{ identifier, name }]

  async #loadLists() {
    const sources = [], profs = new Map();
    for (const pack of game.packs ?? []) {
      if (pack.documentName !== "Item") continue;
      const index = await pack.getIndex({ fields: ["type", "system.identifier", "system.kind"] });
      for (const e of index) {
        if (e.type === "weapon") sources.push({ uuid: e.uuid ?? `Compendium.${pack.collection}.Item.${e._id}`, name: e.name, pack: pack.metadata.label });
        if (e.type === "proficiency" && e.system?.kind === "weapon" && e.system.identifier) profs.set(e.system.identifier, e.name);
      }
    }
    for (const i of game.items?.filter(x => x.type === "weapon") ?? []) sources.push({ uuid: i.uuid, name: i.name, pack: game.i18n.localize("AD2E.Creator.World") });
    for (const i of game.items?.filter(x => x.type === "proficiency" && x.system.kind === "weapon") ?? []) profs.set(i.system.identifier, i.name);
    this.sources = sources.sort((a, b) => a.name.localeCompare(b.name));
    this.proficiencies = [...profs].map(([identifier, name]) => ({ identifier, name })).sort((a, b) => a.name.localeCompare(b.name));
  }

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    if (!this.sources) await this.#loadLists();
    const s = this.state;
    const w = s.weapon;
    const ident = s.identifier || slugify(s.name);
    const packs = [...(game.packs ?? [])].filter(pk => pk.documentName === "Item" && pk.metadata?.packageType === "world" && !pk.locked);
    const opt = (list, value, label = x => x) => list.map(x => ({ value: x, label: label(x), selected: x === value }));
    return {
      ...context, s, w, ident,
      sourceOptions: this.sources.map(x => ({ ...x, selected: x.uuid === s.source })),
      profOptions: this.proficiencies.map(p => ({ ...p, selected: p.identifier === s.proficiency })),
      profExists: this.proficiencies.some(p => p.identifier === ident),
      sizes: opt(WEAPON_SIZES, w.size), families: opt(["other", "bow", "crossbow"], w.family, x => game.i18n.localize(`AD2E.Creator.Weapon.Family.${x}`)),
      columns: opt(MISSILE_COLUMNS, w.missileColumn, x => x || game.i18n.localize("AD2E.Creator.Weapon.NoColumn")),
      strengths: opt(["full", "damage", "penalty", "none"], w.strength, x => game.i18n.localize(`AD2E.Creator.Weapon.Strength.${x}`)),
      damageRows: w.damage.map((d, i) => ({ ...d, i, n: i + 1 })),
      issues: weaponIssues(w).map(k => game.i18n.localize(`AD2E.Creator.Weapon.Issue.${k}`)),
      destinations: [{ key: "", label: game.i18n.localize("AD2E.Creator.World"), selected: !s.destination },
        ...packs.map(pk => ({ key: pk.collection, label: pk.metadata.label, selected: s.destination === pk.collection }))]
    };
  }

  /** Copy a weapon item's statistics into the state. */
  static fromItem(item) {
    const s = WeaponCreator.blank();
    const sys = item.system;
    const w = foundry.utils.deepClone?.(sys.weapon) ?? JSON.parse(JSON.stringify(sys.weapon));
    const damage = (w.damage ?? []).slice(0, 2).map(d => ({ label: d.label ?? "", sm: d.sm ?? "", l: d.l ?? "" }));
    while (damage.length < 2) damage.push({ label: "", sm: "", l: "" });
    Object.assign(s, { name: `${item.name} (copy)`, proficiency: sys.proficiency ?? "", newProficiency: false, cost: sys.cost ?? "",
      weight: sys.weight ?? null, notes: sys.notes ?? "", twoHands: (w.rules ?? []).includes("twoHands") });
    s.weapon = { size: w.size ?? "M", type: w.type ?? "", speed: w.speed ?? 0, melee: !!w.melee, missile: !!w.missile,
      family: w.family ?? "other", missileColumn: w.missileColumn ?? "", strength: w.strength ?? "full", damage,
      range: { rof: w.range?.rof ?? "", short: w.range?.short ?? "", medium: w.range?.medium ?? "", long: w.range?.long ?? "" } };
    return s;
  }

  _onRender(context, options) {
    super._onRender?.(context, options);
    for (const input of this.element.querySelectorAll("[data-field]")) input.addEventListener("change", async ev => {
      const t = ev.currentTarget;
      const f = t.dataset.field;
      const value = t.type === "checkbox" ? t.checked : (t.type === "number" ? (t.value === "" ? null : Number(t.value)) : t.value);
      if (f === "source") {
        const item = value ? await fromUuid(value) : null;
        const destination = this.state.destination;
        this.state = item ? WeaponCreator.fromItem(item) : WeaponCreator.blank();
        Object.assign(this.state, { source: value, destination });
      } else if (f === "damage") this.state.weapon.damage[Number(t.dataset.index)][t.dataset.part] = value ?? "";
      else if (f.startsWith("weapon.")) foundry.utils.setProperty(this.state, f, value);
      else this.state[f] = value;
      this.render();
    });
  }

  /** Item data for the weapon and, when asked, its new proficiency (pure). */
  static itemData(state) {
    const ident = state.identifier || slugify(state.name);
    const w = state.weapon;
    const weapon = { ...w, type: w.type, speed: w.speed ?? null, rules: state.twoHands ? ["twoHands"] : [],
      damage: w.damage.filter(d => d.sm || d.l).map(d => ({ label: d.label ?? "", sm: d.sm || null, l: d.l || null, speed: null })),
      range: w.missile ? { ...w.range } : { rof: "", short: "", medium: "", long: "" },
      misfire: { dry: null, wet: null }, knockdownDie: "", ammo: false, powder: false, match: false };
    const prof = state.newProficiency ? ident : state.proficiency;
    const out = [{ name: state.name, type: "weapon", img: "icons/svg/sword.svg", system: { identifier: ident, proficiency: prof, weapon,
      cost: state.cost, weight: state.weight, quantity: 1, bonus: { hit: state.hit || 0, dmg: state.dmg || 0 }, notes: state.notes,
      source: game.i18n.localize("AD2E.Creator.Custom") } }];
    if (state.newProficiency) out.push({ name: state.name, type: "proficiency", img: "icons/svg/sword.svg",
      system: { identifier: ident, kind: "weapon", slots: 1, weapon, source: game.i18n.localize("AD2E.Creator.Custom") } });
    return out;
  }

  static async #onCreate() {
    const s = this.state;
    if (!s.name) return ui.notifications.warn(game.i18n.localize("AD2E.Creator.NeedName"));
    const issues = weaponIssues(s.weapon);
    if (issues.length) return ui.notifications.warn(issues.map(k => game.i18n.localize(`AD2E.Creator.Weapon.Issue.${k}`)).join(" "));
    const ident = s.identifier || slugify(s.name);
    if (s.newProficiency && (this.proficiencies ?? []).some(p => p.identifier === ident)) {
      return ui.notifications.warn(game.i18n.format("AD2E.Creator.Weapon.ProfExists", { id: ident }));
    }
    const docs = await Item.implementation.createDocuments(WeaponCreator.itemData(s), s.destination ? { pack: s.destination } : {});
    if (!docs?.length) return null;
    ui.notifications.info(game.i18n.format("AD2E.Creator.Created", { name: docs.map(d => d.name).join(", ") }));
    this.proficiencies = null; this.sources = null;
    docs[0].sheet?.render(true);
    return docs;
  }
}
