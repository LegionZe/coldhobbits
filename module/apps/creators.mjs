import { AD2E, creatureHitDice, hitDiceAt, thac0At } from "../config.mjs";
import { CREATOR_TABLES } from "../rules/creator-tables.mjs";
import { TREASURE_ROLLS } from "../rules/treasure-tables.mjs";
import { SP_WEAPONS } from "../rules/sp-weapon-tables.mjs";
import { learnChance } from "../learn-spells.mjs";

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

/**
 * Item creator: equipment (gear by category, or a container with its capacity), armour (body armour AC, shield bonus vs.
 * melee and missiles and the attackers it covers, helmet; the size it was made for; magical bonus) or ammunition
 * (launchers, damage vs. small/medium and large). Starts from any item of that kind in the compendiums or the Items
 * directory, or from blank; checks the cost ("5 gp", "2 sp each"), damage dice and armour values.
 */
export const ITEM_KINDS = { gear: "equipment", container: "equipment", armor: "armor", ammunition: "ammunition" };

/** A cost as the item lists write it: a number and a coin (cp, sp, ep, gp, pp), optionally followed by text. Blank is allowed. */
export function costValid(cost) {
  return !String(cost ?? "").trim() || /^\d+(?:[.,]\d+)?\s*(cp|sp|ep|gp|pp)\b/i.test(String(cost).trim());
}

const DICE = f => /^\d*d\d+([+-]\d+)?$/i.test(String(f).replace(/\s/g, "")) || /^\d+$/.test(String(f).trim());

/** Problems with an item creator state (keys of AD2E.Creator.Item.Issue). */
export function itemIssues(s) {
  const issues = [];
  if (!costValid(s.cost)) issues.push("badCost");
  if (s.kind === "container" && !s.capacityWeight && !s.capacityVolume) issues.push("noCapacity");
  if (s.kind === "armor") {
    if (s.armorKind === "body" && (s.ac === null || s.ac === "" || s.ac < -10 || s.ac > 10)) issues.push("badAc");
    if (s.armorKind === "shield" && !(s.shieldMelee > 0)) issues.push("badShield");
  }
  if (s.kind === "ammunition") {
    if (!s.launchers.length) issues.push("noLaunchers");
    if (!(s.damageSm && s.damageL) || !DICE(s.damageSm) || !DICE(s.damageL)) issues.push("badDamage");
  }
  return issues;
}

export class ItemCreator extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "ad2e-item-creator",
    classes: ["ad2e", "creator"],
    window: { title: "AD2E.Creator.Item.Title", icon: "fa-solid fa-sack-dollar", resizable: true },
    position: { width: 640, height: 720 },
    actions: { create: ItemCreator.#onCreate }
  };

  static PARTS = { main: { template: "systems/ad2e/templates/apps/item-creator.hbs", scrollable: [".ad2e-creator-body"] } };

  static blank(kind = "gear") {
    return { kind, source: "", name: "", identifier: "", cost: "", weight: null, notes: "", destination: "",
      category: "gear", capacityWeight: null, capacityVolume: "",
      armorKind: "body", ac: 8, shieldMelee: 1, shieldMissile: 1, shieldAttacks: 2, size: "", bonus: 0,
      launchers: [], ammoType: "P", ammoSize: "S", damageSm: "1d6", damageL: "1d6", hit: 0, dmg: 0 };
  }

  state = ItemCreator.blank();
  index = null; // { equipment: [], armor: [], ammunition: [], launchers: [] }

  async #loadIndex() {
    const out = { equipment: [], armor: [], ammunition: [], launchers: new Map() };
    const add = (e, uuid, origin) => {
      if (out[e.type]) out[e.type].push({ uuid, name: e.name, origin, capacity: !!(e.system?.capacity?.weight || e.system?.capacity?.volume) });
      const w = e.system?.weapon;
      if (e.type === "weapon" && w?.missile && (w.family !== "other" || w.ammo || (w.damage ?? []).some(d => d.label))) {
        out.launchers.set(e.system.identifier, e.name);
      }
    };
    for (const pack of game.packs ?? []) {
      if (pack.documentName !== "Item") continue;
      const index = await pack.getIndex({ fields: ["type", "system.identifier", "system.weapon", "system.capacity"] });
      for (const e of index) add(e, e.uuid ?? `Compendium.${pack.collection}.Item.${e._id}`, pack.metadata.label);
    }
    for (const i of game.items ?? []) add(i, i.uuid, game.i18n.localize("AD2E.Creator.World"));
    for (const k of ["equipment", "armor", "ammunition"]) out[k].sort((a, b) => a.name.localeCompare(b.name));
    out.launchers = [...out.launchers].map(([identifier, name]) => ({ identifier, name })).sort((a, b) => a.name.localeCompare(b.name));
    this.index = out;
  }

  /** Copy an item into the state. */
  static fromItem(item, kind) {
    const s = ItemCreator.blank(kind);
    const sys = item.system;
    Object.assign(s, { name: `${item.name} (copy)`, cost: sys.cost ?? "", weight: sys.weight ?? null, notes: sys.notes ?? "" });
    if (item.type === "equipment") Object.assign(s, { category: sys.category ?? "gear", capacityWeight: sys.capacity?.weight ?? null,
      capacityVolume: sys.capacity?.volume ?? "" });
    if (item.type === "armor") Object.assign(s, { armorKind: sys.kind, ac: sys.ac, shieldMelee: sys.shield?.melee ?? 0,
      shieldMissile: sys.shield?.missile ?? 0, shieldAttacks: sys.shield?.attacks ?? null, size: sys.size ?? "", bonus: sys.bonus ?? 0 });
    if (item.type === "ammunition") Object.assign(s, { launchers: [...(sys.launchers ?? [])], ammoType: sys.type ?? "", ammoSize: sys.size ?? "",
      damageSm: sys.damage?.sm ?? "", damageL: sys.damage?.l ?? "", hit: sys.bonus?.hit ?? 0, dmg: sys.bonus?.dmg ?? 0 });
    return s;
  }

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    if (!this.index) await this.#loadIndex();
    const s = this.state;
    const type = ITEM_KINDS[s.kind];
    const list = (this.index[type] ?? []).filter(x => s.kind !== "container" || x.capacity);
    const packs = [...(game.packs ?? [])].filter(pk => pk.documentName === "Item" && pk.metadata?.packageType === "world" && !pk.locked);
    const i18n = k => game.i18n.localize(k);
    return {
      ...context, s, ident: s.identifier || slugify(s.name),
      kinds: Object.keys(ITEM_KINDS).map(k => ({ key: k, label: i18n(`AD2E.Creator.Item.Kind.${k}`), selected: k === s.kind })),
      is: { gear: s.kind === "gear", container: s.kind === "container", armor: s.kind === "armor", ammunition: s.kind === "ammunition",
        body: s.armorKind === "body", shield: s.armorKind === "shield" },
      sourceOptions: list.map(x => ({ ...x, selected: x.uuid === s.source })),
      categories: Object.entries(AD2E.equipmentCategories).map(([k, v]) => ({ key: k, label: i18n(v), selected: k === s.category })),
      armorKinds: Object.entries(AD2E.armorKinds).map(([k, v]) => ({ key: k, label: i18n(v), selected: k === s.armorKind })),
      armorSizes: ["", "S", "M", "L"].map(k => ({ key: k, label: k || i18n("AD2E.Creator.Item.AnySize"), selected: k === (s.size ?? "") })),
      launcherOptions: this.index.launchers.map(l => ({ ...l, checked: s.launchers.includes(l.identifier) })),
      issues: itemIssues(s).map(k => i18n(`AD2E.Creator.Item.Issue.${k}`)),
      destinations: [{ key: "", label: i18n("AD2E.Creator.World"), selected: !s.destination },
        ...packs.map(pk => ({ key: pk.collection, label: pk.metadata.label, selected: s.destination === pk.collection }))]
    };
  }

  _onRender(context, options) {
    super._onRender?.(context, options);
    for (const input of this.element.querySelectorAll("[data-field]")) input.addEventListener("change", async ev => {
      const t = ev.currentTarget;
      const f = t.dataset.field;
      const value = t.type === "checkbox" ? t.checked : (t.type === "number" ? (t.value === "" ? null : Number(t.value)) : t.value);
      const destination = this.state.destination;
      if (f === "kind") this.state = Object.assign(ItemCreator.blank(value), { destination });
      else if (f === "source") {
        const item = value ? await fromUuid(value) : null;
        this.state = Object.assign(item ? ItemCreator.fromItem(item, this.state.kind) : ItemCreator.blank(this.state.kind), { source: value, destination });
      } else if (f === "launcher") {
        const set = new Set(this.state.launchers);
        if (t.checked) set.add(t.dataset.key); else set.delete(t.dataset.key);
        this.state.launchers = [...set];
      } else this.state[f] = value;
      this.render();
    });
  }

  /** Item data from the state (pure). */
  static itemData(s) {
    const base = { identifier: s.identifier || slugify(s.name), cost: s.cost, weight: s.weight, notes: s.notes, source: game.i18n.localize("AD2E.Creator.Custom") };
    if (s.kind === "gear" || s.kind === "container") {
      return { name: s.name, type: "equipment", img: "icons/svg/item-bag.svg", system: { ...base, category: s.kind === "container" ? "gear" : s.category,
        quantity: 1, carried: true, capacity: s.kind === "container" ? { weight: s.capacityWeight, volume: s.capacityVolume ?? "" }
          : { weight: null, volume: "" } } };
    }
    if (s.kind === "armor") {
      const shield = s.armorKind === "shield" ? { melee: s.shieldMelee ?? 0, missile: s.shieldMissile ?? 0, attacks: s.shieldAttacks || null } : { melee: 0, missile: 0, attacks: null };
      return { name: s.name, type: "armor", img: "icons/svg/shield.svg", system: { ...base, kind: s.armorKind, ac: s.armorKind === "body" ? s.ac : null,
        shield, size: s.size ?? "", bonus: s.bonus || 0 } };
    }
    return { name: s.name, type: "ammunition", img: "icons/svg/target.svg", system: { ...base, launchers: s.launchers, type: s.ammoType || null,
      size: s.ammoSize || null, damage: { sm: s.damageSm, l: s.damageL }, quantity: 1, bonus: { hit: s.hit || 0, dmg: s.dmg || 0 } } };
  }

  static async #onCreate() {
    const s = this.state;
    if (!s.name) return ui.notifications.warn(game.i18n.localize("AD2E.Creator.NeedName"));
    const issues = itemIssues(s);
    if (issues.length) return ui.notifications.warn(issues.map(k => game.i18n.localize(`AD2E.Creator.Item.Issue.${k}`)).join(" "));
    const doc = await Item.implementation.create(ItemCreator.itemData(s), s.destination ? { pack: s.destination } : {});
    if (!doc) return null;
    ui.notifications.info(game.i18n.format("AD2E.Creator.Created", { name: doc.name }));
    this.index = null;
    doc.sheet?.render(true);
    return doc;
  }
}

/**
 * Magic item creator. Two modes:
 *  - a magical item (item type "magic"): DMG Table 88 category, charges (wands 1d20+80, rods 1d10+40, staves 1d6+19 when
 *    found, rolled at creation if asked; CREATOR_TABLES.magic.charges, checked against the DMG pages), usable-by groups,
 *    XP and gp values, a container's capacity (weightless: contents add no weight), quantity for consumables;
 *  - magical arms: a weapon, armour or ammunition item copied from a base item with a bonus (-1 cursed to +5); the XP value
 *    comes from DMG Tables 105/107 (TREASURE_ROLLS.arms: armour +1 500 ... +5 3,000; swords +1 400 ... +5 3,000, other
 *    weapons +1 500, +2 1,000, +3 2,000; a sword = a weapon of the Skills & Powers "swords" group) and is written in the
 *    notes (weapon and armour items have no XP field).
 * Both arrive unidentified unless ticked (module/identify.mjs).
 */
export const MAGIC_GROUPS = ["Warrior", "Priest", "Rogue", "Wizard"];
const SWORDS = new Set(SP_WEAPONS.groups?.swords?.ids ?? []);

/** Charges an item of the category has when found: { formula, max } or null. */
export function chargesFor(category) {
  return CREATOR_TABLES.magic.charges[category] ?? null;
}

/** Is the weapon item a sword (DMG Table 107's sword column)? */
export function isSword(system) {
  return SWORDS.has(system?.proficiency) || SWORDS.has(system?.identifier);
}

/** DMG Tables 105/107 experience value of magical arms: type "armor" | "weapon" | "ammunition", bonus, sword. Null if none listed. */
export function armsXp(type, bonus, sword = false) {
  if (!(bonus > 0)) return null;
  const arms = TREASURE_ROLLS.arms;
  if (type === "armor") return arms.acAdjust.find(r => r.adj === bonus)?.xp ?? null;
  const row = arms.attackAdjust.find(r => (sword ? r.sword : r.other) === bonus);
  return row ? (sword ? row.swordXp : row.otherXp) : null;
}

export class MagicItemCreator extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "ad2e-magic-item-creator",
    classes: ["ad2e", "creator"],
    window: { title: "AD2E.Creator.Magic.Title", icon: "fa-solid fa-hat-wizard", resizable: true },
    position: { width: 640, height: 720 },
    actions: { create: MagicItemCreator.#onCreate }
  };

  static PARTS = { main: { template: "systems/ad2e/templates/apps/magic-item-creator.hbs", scrollable: [".ad2e-creator-body"] } };

  static blank(mode = "item") {
    return { mode, source: "", name: "", identifier: "", category: "potion", quantity: 1, weight: null,
      chargesFormula: "", chargesMax: null, rollCharges: true, usableBy: [], xpValue: null, gpValue: null,
      capacityWeight: null, capacityVolume: "", weightless: false, identified: false, unidentifiedName: "", notes: "", destination: "",
      url: "", base: "", baseName: "", baseType: "", baseImg: "", baseSystem: null, bonus: 1 };
  }

  state = MagicItemCreator.blank();
  index = null;

  async #loadIndex() {
    const out = { magic: [], arms: [] };
    const add = (e, uuid, origin) => {
      if (e.type === "magic") out.magic.push({ uuid, name: e.name, origin });
      if (["weapon", "armor", "ammunition"].includes(e.type)) out.arms.push({ uuid, name: e.name, origin, type: e.type });
    };
    for (const pack of game.packs ?? []) {
      if (pack.documentName !== "Item") continue;
      for (const e of await pack.getIndex({ fields: ["type"] })) add(e, e.uuid ?? `Compendium.${pack.collection}.Item.${e._id}`, pack.metadata.label);
    }
    for (const i of game.items ?? []) add(i, i.uuid, game.i18n.localize("AD2E.Creator.World"));
    out.magic.sort((a, b) => a.name.localeCompare(b.name));
    out.arms.sort((a, b) => a.name.localeCompare(b.name));
    this.index = out;
  }

  /** Copy a magical item into the state. */
  static fromItem(item) {
    const s = MagicItemCreator.blank("item");
    const sys = item.system;
    Object.assign(s, { name: `${item.name} (copy)`, category: sys.category, quantity: sys.quantity ?? 1, weight: sys.weight ?? null,
      chargesFormula: sys.charges?.formula ?? "", chargesMax: sys.charges?.max ?? null,
      usableBy: String(sys.usableBy ?? "").split(/\s*,\s*/).filter(g => MAGIC_GROUPS.includes(g)),
      xpValue: sys.xpValue ?? null, gpValue: sys.gpValue ?? null, capacityWeight: sys.capacity?.weight ?? null,
      capacityVolume: sys.capacity?.volume ?? "", weightless: !!sys.capacity?.weightless, notes: sys.notes ?? "", url: sys.url ?? "" });
    return s;
  }

  /** Magical arms: name, XP and the item data (pure). */
  static armsData(s) {
    const sys = foundry.utils.deepClone?.(s.baseSystem) ?? JSON.parse(JSON.stringify(s.baseSystem));
    const sword = s.baseType === "weapon" && isSword(sys);
    const xp = armsXp(s.baseType, s.bonus, sword);
    const sign = s.bonus >= 0 ? "+" : "";
    const name = s.name || `${s.baseName} ${sign}${s.bonus}`;
    if (s.baseType === "armor") sys.bonus = s.bonus; else sys.bonus = { hit: s.bonus, dmg: s.bonus };
    Object.assign(sys, { identifier: s.identifier || slugify(name), identified: !!s.identified, unidentifiedName: s.unidentifiedName ?? "",
      equipped: false, container: "", source: game.i18n.localize("AD2E.Creator.Custom"),
      notes: [s.notes, xp ? game.i18n.format("AD2E.Creator.Magic.XpNote", { xp }) : ""].filter(Boolean).join(" ") });
    return { xp, sword, item: { name, type: s.baseType, img: s.baseImg || "icons/svg/sword.svg", system: sys } };
  }

  /** A magical item's data (pure). */
  static itemData(s) {
    return { name: s.name, type: "magic", img: "icons/svg/item-bag.svg", system: {
      identifier: s.identifier || slugify(s.name), category: s.category, quantity: s.quantity ?? 1, weight: s.weight, carried: true,
      capacity: { weight: s.capacityWeight, volume: s.capacityVolume ?? "", weightless: !!s.weightless },
      charges: { value: s.chargesMax ?? 0, max: s.chargesMax ?? null, formula: s.chargesFormula ?? "" },
      usableBy: s.usableBy.join(", "), identified: !!s.identified, unidentifiedName: s.unidentifiedName ?? "",
      xpValue: s.xpValue, gpValue: s.gpValue, url: s.url ?? "", notes: s.notes } };
  }

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    if (!this.index) await this.#loadIndex();
    const s = this.state;
    const i18n = k => game.i18n.localize(k);
    const packs = [...(game.packs ?? [])].filter(pk => pk.documentName === "Item" && pk.metadata?.packageType === "world" && !pk.locked);
    const arms = s.mode === "arms" && s.baseSystem ? MagicItemCreator.armsData(s) : null;
    const issues = [];
    if (s.mode === "item" && !s.name) issues.push(i18n("AD2E.Creator.NeedName"));
    if (s.mode === "arms" && !s.baseSystem) issues.push(i18n("AD2E.Creator.Magic.NeedBase"));
    if (s.mode === "item" && s.chargesFormula && !DICE(s.chargesFormula)) issues.push(i18n("AD2E.Creator.Magic.BadCharges"));
    return {
      ...context, s, ident: s.identifier || slugify(s.name || arms?.item.name || ""), isItem: s.mode === "item", isArms: s.mode === "arms",
      modes: ["item", "arms"].map(k => ({ key: k, label: i18n(`AD2E.Creator.Magic.Mode.${k}`), selected: k === s.mode })),
      categories: Object.entries(AD2E.magicCategories).map(([k, v]) => ({ key: k, label: i18n(v), selected: k === s.category })),
      sourceOptions: (s.mode === "item" ? this.index.magic : this.index.arms).map(x => ({ ...x, selected: x.uuid === (s.mode === "item" ? s.source : s.base) })),
      groups: MAGIC_GROUPS.map(g => ({ key: g, checked: s.usableBy.includes(g) })),
      isContainer: ["bag", "household"].includes(s.category) || s.capacityWeight || s.capacityVolume || s.weightless,
      arms, issues,
      destinations: [{ key: "", label: i18n("AD2E.Creator.World"), selected: !s.destination },
        ...packs.map(pk => ({ key: pk.collection, label: pk.metadata.label, selected: s.destination === pk.collection }))]
    };
  }

  _onRender(context, options) {
    super._onRender?.(context, options);
    for (const input of this.element.querySelectorAll("[data-field]")) input.addEventListener("change", async ev => {
      const t = ev.currentTarget;
      const f = t.dataset.field;
      const value = t.type === "checkbox" ? t.checked : (t.type === "number" ? (t.value === "" ? null : Number(t.value)) : t.value);
      const destination = this.state.destination;
      if (f === "mode") this.state = Object.assign(MagicItemCreator.blank(value), { destination });
      else if (f === "source") {
        const item = value ? await fromUuid(value) : null;
        this.state = Object.assign(item ? MagicItemCreator.fromItem(item) : MagicItemCreator.blank("item"), { source: value, destination });
      } else if (f === "base") {
        const item = value ? await fromUuid(value) : null;
        Object.assign(this.state, { base: value, baseName: item?.name ?? "", baseType: item?.type ?? "", baseImg: item?.img ?? "",
          baseSystem: item ? (item.toObject?.().system ?? item.system) : null, name: "" });
      } else if (f === "category") {
        const ch = chargesFor(value);
        Object.assign(this.state, { category: value, chargesFormula: ch?.formula ?? "", chargesMax: ch?.max ?? null });
      } else if (f === "group") {
        const set = new Set(this.state.usableBy);
        if (t.checked) set.add(t.dataset.key); else set.delete(t.dataset.key);
        this.state.usableBy = MAGIC_GROUPS.filter(g => set.has(g));
      } else this.state[f] = value;
      this.render();
    });
  }

  static async #onCreate() {
    const s = this.state;
    let data;
    if (s.mode === "arms") {
      if (!s.baseSystem) return ui.notifications.warn(game.i18n.localize("AD2E.Creator.Magic.NeedBase"));
      data = MagicItemCreator.armsData(s).item;
    } else {
      if (!s.name) return ui.notifications.warn(game.i18n.localize("AD2E.Creator.NeedName"));
      if (s.chargesFormula && !DICE(s.chargesFormula)) return ui.notifications.warn(game.i18n.localize("AD2E.Creator.Magic.BadCharges"));
      data = MagicItemCreator.itemData(s);
      // Charges when found: rolled now if asked (the item sheet can roll them again).
      if (s.chargesFormula && s.rollCharges) {
        const roll = await new Roll(s.chargesFormula).evaluate();
        data.system.charges.value = s.chargesMax ? Math.min(roll.total, s.chargesMax) : roll.total;
      }
    }
    const doc = await Item.implementation.create(data, s.destination ? { pack: s.destination } : {});
    if (!doc) return null;
    ui.notifications.info(game.i18n.format("AD2E.Creator.Created", { name: doc.name }));
    this.index = null;
    doc.sheet?.render(true);
    return doc;
  }
}

/**
 * Patron creator: an NPC who hires or sponsors the party, as a Monster / NPC actor with role "patron". Game information
 * (race, class group and level, alignment) gives the numbers: a classed NPC rolls its class group's Hit Dice for the level
 * (PHB Tables 14/20/23/25), uses its THAC0 (Table 53) and saves as that group at that level; a 0-level NPC has 1d6 hit
 * points (implementation choice). Personality: DMG Table 70 chosen, or rolled as "1d20 for a major trait, percentile dice
 * for characteristics" (Personality (DMG)), so the specific trait may come from another group,
 * and appearance words from the same page. Wealth, what the patron wants and offers, and the reward are free text kept
 * in the notes.
 */
export const PATRON = CREATOR_TABLES.patron;

/** Table 70: the general trait for a d20 and the specific trait for a d100 (or the first of the general trait's five). */
export function rollTraits(d20, d100 = null) {
  const general = PATRON.traits.find(t => t.roll === d20) ?? PATRON.traits[0];
  const specific = d100 === null ? null : PATRON.traits.flatMap(t => t.specific).find(x => x.roll === d100);
  return { general: general.trait, specific: specific?.trait ?? "" };
}

/** Hit points formula, THAC0 and save level for an NPC of a class group and level (0 = no class). */
export function npcNumbers(group, level) {
  if (!group || !(level > 0)) return { formula: "1d6", thac0: 20, saveLevel: 0, hitDice: "1d6 hp", saveGroup: "warrior" };
  const hd = hitDiceAt(group, level);
  const formula = `${hd.dice}d${hd.die}${hd.bonus ? `+${hd.bonus}` : ""}`;
  return { formula, thac0: thac0At(group, level), saveLevel: level, hitDice: String(level), saveGroup: group };
}

export class PatronCreator extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "ad2e-patron-creator",
    classes: ["ad2e", "creator"],
    window: { title: "AD2E.Creator.Patron.Title", icon: "fa-solid fa-crown", resizable: true },
    position: { width: 640, height: 720 },
    actions: { create: PatronCreator.#onCreate, rollTraits: PatronCreator.#onRollTraits, rollLooks: PatronCreator.#onRollLooks }
  };

  static PARTS = { main: { template: "systems/ad2e/templates/apps/patron-creator.hbs", scrollable: [".ad2e-creator-body"] } };

  state = { name: "", race: "Human", group: "", className: "", level: 0, alignment: "Neutral", ac: 10, move: 12, morale: 10,
    occupation: "", wealth: "", wants: "", offers: "", reward: "", general: "", specific: "", notes: "", destination: "",
    looks: Object.fromEntries(Object.keys(PATRON.looks).map(k => [k, ""])) };

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const s = this.state;
    const i18n = k => game.i18n.localize(k);
    const n = npcNumbers(s.group, s.level);
    const general = PATRON.traits.find(t => t.trait === s.general);
    const packs = [...(game.packs ?? [])].filter(pk => pk.documentName === "Actor" && pk.metadata?.packageType === "world" && !pk.locked);
    const moraleBand = bandFor(MONSTER.morale, s.morale);
    return {
      ...context, s, n, moraleBand: moraleBand?.label ?? "",
      groups: ["", ...Object.keys(AD2E.classGroups)].map(g => ({ key: g, label: g ? i18n(AD2E.classGroups[g]) : i18n("AD2E.Creator.Patron.NoClass"), selected: g === s.group })),
      generals: [{ key: "", label: "—" }, ...PATRON.traits.map(t => ({ key: t.trait, label: `${t.roll}. ${t.trait}` }))].map(o => ({ ...o, selected: o.key === s.general })),
      // Any specific trait may go with any general one (the DMG's example: careless and cheerful); the general trait's own
      // five are listed first.
      specifics: [{ key: "", label: "—" }, ...[...(general?.specific ?? []), ...PATRON.traits.filter(t => t !== general).flatMap(t => t.specific)]
        .map(x => ({ key: x.trait, label: `${String(x.roll % 100).padStart(2, "0")}. ${x.trait}` }))].map(o => ({ ...o, selected: o.key === s.specific })),
      looks: Object.entries(PATRON.looks).map(([k, words]) => ({ key: k, label: i18n(`AD2E.Creator.Patron.Look.${k}`),
        options: [{ key: "", label: "—" }, ...words.map(w => ({ key: w, label: w }))].map(o => ({ ...o, selected: o.key === s.looks[k] })) })),
      destinations: [{ key: "", label: i18n("AD2E.Creator.World"), selected: !s.destination },
        ...packs.map(pk => ({ key: pk.collection, label: pk.metadata.label, selected: s.destination === pk.collection }))]
    };
  }

  _onRender(context, options) {
    super._onRender?.(context, options);
    for (const input of this.element.querySelectorAll("[data-field]")) input.addEventListener("change", ev => {
      const t = ev.currentTarget;
      const f = t.dataset.field;
      const value = t.type === "number" ? (t.value === "" ? 0 : Number(t.value)) : t.value;
      if (f === "look") this.state.looks[t.dataset.key] = value;
      else this.state[f] = value;
      this.render();
    });
  }

  /** Table 70 rolled: "1d20 for a major trait, percentile dice for characteristics" (Personality (DMG)). */
  static async #onRollTraits() {
    const d20 = (await new Roll("1d20").evaluate()).total;
    const d100 = (await new Roll("1d100").evaluate()).total;
    Object.assign(this.state, rollTraits(d20, d100));
    this.render();
  }

  static async #onRollLooks() {
    for (const [k, words] of Object.entries(PATRON.looks)) {
      const r = (await new Roll(`1d${words.length}`).evaluate()).total;
      this.state.looks[k] = words[r - 1];
    }
    this.render();
  }

  /** Actor data (pure; hit points given). */
  static actorData(s, hp) {
    const n = npcNumbers(s.group, s.level);
    const esc = v => foundry.utils.escapeHTML?.(String(v ?? "")) ?? String(v ?? "");
    const i18n = k => game.i18n.localize(k);
    const line = (key, value) => (value ? `<p><strong>${esc(i18n(`AD2E.Creator.Patron.${key}`))}:</strong> ${esc(value)}</p>` : "");
    const looks = Object.entries(s.looks).filter(([, v]) => v).map(([k, v]) => `${i18n(`AD2E.Creator.Patron.Look.${k}`).toLowerCase()} ${v}`).join(", ");
    const game_ = [s.race, s.group ? `${s.className || i18n(AD2E.classGroups[s.group])} ${s.level}` : i18n("AD2E.Creator.Patron.NoClass"), s.alignment].filter(Boolean).join(", ");
    const notes = line("GameInfo", game_) + line("Occupation", s.occupation) + line("Wealth", s.wealth)
      + line("Personality", [s.general, s.specific].filter(Boolean).join(": ")) + line("Appearance", looks)
      + line("Wants", s.wants) + line("Offers", s.offers) + line("Reward", s.reward) + (s.notes ? `<p>${esc(s.notes)}</p>` : "");
    const moraleBand = bandFor(MONSTER.morale, s.morale);
    return { name: s.name || i18n("AD2E.Creator.Patron.Unnamed"), type: "monster", system: {
      role: "patron", size: "M", hitDice: n.hitDice, hp: { value: hp, max: hp }, ac: { base: s.ac, text: String(s.ac) },
      movement: { base: s.move, text: String(s.move) }, alignment: s.alignment, intelligence: "", numberAppearing: "1",
      thac0: { override: n.thac0 }, saveGroup: n.saveGroup, saveLevel: n.saveLevel,
      morale: { value: s.morale, text: moraleBand ? `${moraleBand.label} (${s.morale})` : String(s.morale) },
      attacks: [{ name: i18n("AD2E.Creator.Patron.Weapon"), damage: "1d6", bonus: 0, element: "" }], xp: 0, notes } };
  }

  static async #onCreate() {
    const s = this.state;
    if (!s.name) return ui.notifications.warn(game.i18n.localize("AD2E.Creator.NeedName"));
    const roll = await new Roll(npcNumbers(s.group, s.level).formula).evaluate();
    const actor = await Actor.implementation.create(PatronCreator.actorData(s, Math.max(roll.total, 1)), s.destination ? { pack: s.destination } : {});
    if (!actor) return null;
    ui.notifications.info(game.i18n.format("AD2E.Creator.Created", { name: actor.name }));
    actor.sheet?.render(true);
    return actor;
  }
}

/**
 * Spell creator: a wizard or priest spell item with the fields the spell sheet cannot set (schools from the PHB's nine,
 * spheres from its sixteen, plus any others typed; damage or healing options), checked against the DMG's spell research
 * guidelines (CREATOR_TABLES.spell from "Spell Research (DMG)", regex-checked): "a spell which inflicts 5d6 points of
 * damage should be about 3rd to 5th level" (the first damage option's dice count gives the advice), the highest spell
 * level of the group (Tables 21/24), research "two weeks per spell level", "100-1,000 gp per spell level". The research
 * check: wizards use their chance to learn the spell (module/learn-spells.mjs, specialization included), priests a
 * Wisdom check; a failure costs "another week in study before making another check".
 */
export const SPELLS = CREATOR_TABLES.spell;

/** Highest spell level a group can cast (from the spell progression tables). */
export function maxSpellLevel(kind) {
  const rows = Object.values(AD2E.spellProgression?.[kind === "priest" ? "priest" : "wizard"] ?? {});
  return rows.reduce((n, r) => Math.max(n, r.slots.length), 0) || (kind === "priest" ? 7 : 9);
}

/** Suggested levels for a damage formula's dice count ("5d6 ... about 3rd to 5th level"), or null. */
export function levelAdvice(formula, kind = "wizard") {
  const m = String(formula ?? "").replace(/\s/g, "").match(/^(\d+)d\d+/i);
  if (!m) return null;
  const n = Number(m[1]);
  const max = maxSpellLevel(kind);
  return { dice: n, min: Math.min(Math.max(n - SPELLS.research.damageLevelsBelowDice, 1), max), max: Math.min(n, max) };
}

/** Research time (weeks: two per level plus one per failed check) and cost range (gp). */
export function researchCost(level, failures = 0) {
  const r = SPELLS.research;
  return { weeks: r.weeksPerLevel * level + r.retryWeeks * failures, min: r.costPerLevel[0] * level, max: r.costPerLevel[1] * level };
}

export class SpellCreator extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "ad2e-spell-creator",
    classes: ["ad2e", "creator"],
    window: { title: "AD2E.Creator.Spell.Title", icon: "fa-solid fa-wand-sparkles", resizable: true },
    position: { width: 640, height: 720 },
    actions: { create: SpellCreator.#onCreate, research: SpellCreator.#onResearch }
  };

  static PARTS = { main: { template: "systems/ad2e/templates/apps/spell-creator.hbs", scrollable: [".ad2e-creator-body"] } };

  static blank() {
    return { source: "", name: "", identifier: "", kind: "wizard", level: 1, schools: [], spheres: [], otherSchools: "", reversible: false,
      verbal: true, somatic: true, material: false, range: "", area: "", castingTime: "", duration: "", save: "None", notes: "",
      damage: [0, 1, 2].map(() => ({ label: "", formula: "", kind: "damage", perRound: false })),
      destination: "", researcher: "", failures: 0, researched: false, addToResearcher: true };
  }

  state = SpellCreator.blank();
  sources = null;

  async #loadSources() {
    const out = [];
    for (const pack of game.packs ?? []) {
      if (pack.documentName !== "Item") continue;
      for (const e of await pack.getIndex({ fields: ["type"] })) if (e.type === "spell") out.push({ uuid: e.uuid ?? `Compendium.${pack.collection}.Item.${e._id}`, name: e.name, origin: pack.metadata.label });
    }
    for (const i of game.items?.filter(x => x.type === "spell") ?? []) out.push({ uuid: i.uuid, name: i.name, origin: game.i18n.localize("AD2E.Creator.World") });
    this.sources = out.sort((a, b) => a.name.localeCompare(b.name));
  }

  /** Copy a spell into the state. */
  static fromItem(item) {
    const s = SpellCreator.blank();
    const sys = item.system;
    const known = sys.kind === "priest" ? SPELLS.spheres : SPELLS.schools;
    const list = sys.kind === "priest" ? (sys.spheres ?? []) : (sys.schools ?? []);
    const damage = (sys.damage ?? []).slice(0, 3).map(d => ({ label: d.label ?? "", formula: d.formula ?? "", kind: d.kind ?? "damage", perRound: !!d.perRound }));
    while (damage.length < 3) damage.push({ label: "", formula: "", kind: "damage", perRound: false });
    Object.assign(s, { name: `${item.name} (copy)`, kind: sys.kind, level: sys.level, reversible: !!sys.reversible,
      verbal: !!sys.components?.verbal, somatic: !!sys.components?.somatic, material: !!sys.components?.material,
      range: sys.range ?? "", area: sys.area ?? "", castingTime: sys.castingTime ?? "", duration: sys.duration ?? "", save: sys.save ?? "",
      notes: sys.notes ?? "", damage,
      [sys.kind === "priest" ? "spheres" : "schools"]: list.filter(x => known.includes(x)),
      otherSchools: list.filter(x => !known.includes(x)).join(", ") });
    return s;
  }

  /** The schools or spheres chosen, with the typed extra ones. */
  static groups(s) {
    const chosen = s.kind === "priest" ? s.spheres : s.schools;
    return [...chosen, ...String(s.otherSchools ?? "").split(",").map(x => x.trim()).filter(Boolean)];
  }

  /** Item data (pure). */
  static itemData(s) {
    const groups = SpellCreator.groups(s);
    return { name: s.name, type: "spell", img: s.kind === "priest" ? "icons/svg/sun.svg" : "icons/svg/book.svg", system: {
      identifier: s.identifier || slugify(s.name), kind: s.kind, level: s.level, schools: s.kind === "wizard" ? groups : [],
      spheres: s.kind === "priest" ? groups : [], reversible: !!s.reversible,
      components: { verbal: !!s.verbal, somatic: !!s.somatic, material: !!s.material },
      damage: s.damage.filter(d => d.formula).map(d => ({ label: d.label, formula: d.formula, kind: d.kind, perRound: !!d.perRound })),
      range: s.range, area: s.area, castingTime: s.castingTime, duration: s.duration, save: s.save,
      sources: [game.i18n.localize("AD2E.Creator.Custom")], learned: true, prepared: 0, cast: 0, notes: s.notes } };
  }

  /** Problems (localization keys of AD2E.Creator.Spell.Issue). */
  static issues(s) {
    const out = [];
    if (s.level < 1 || s.level > maxSpellLevel(s.kind)) out.push("badLevel");
    if (!SpellCreator.groups(s).length) out.push(s.kind === "priest" ? "noSphere" : "noSchool");
    for (const d of s.damage) if (d.formula && !/^[\d()d+\-*/@a-z,\s.]+$/i.test(d.formula)) out.push("badFormula");
    return [...new Set(out)];
  }

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    if (!this.sources) await this.#loadSources();
    const s = this.state;
    const i18n = k => game.i18n.localize(k);
    const advice = levelAdvice(s.damage.find(d => d.formula && d.kind === "damage")?.formula, s.kind);
    const research = researchCost(s.level, s.failures);
    const packs = [...(game.packs ?? [])].filter(pk => pk.documentName === "Item" && pk.metadata?.packageType === "world" && !pk.locked);
    const researchers = game.actors?.filter(a => a.type === "character" && a.system.spells?.kind === s.kind) ?? [];
    return {
      ...context, s, ident: s.identifier || slugify(s.name), isPriest: s.kind === "priest", maxLevel: maxSpellLevel(s.kind),
      sourceOptions: this.sources.map(x => ({ ...x, selected: x.uuid === s.source })),
      kinds: ["wizard", "priest"].map(k => ({ key: k, label: i18n(AD2E.spellKinds[k]), selected: k === s.kind })),
      groupOptions: (s.kind === "priest" ? SPELLS.spheres : SPELLS.schools).map(g => ({ key: g, checked: (s.kind === "priest" ? s.spheres : s.schools).includes(g) })),
      damageRows: s.damage.map((d, i) => ({ ...d, i, n: i + 1, healing: d.kind === "healing" })),
      advice, adviceOff: advice && (s.level < advice.min || s.level > advice.max),
      research, researchers: [{ id: "", name: "—" }, ...researchers.map(a => ({ id: a.id, name: a.name }))].map(r => ({ ...r, selected: r.id === s.researcher })),
      issues: SpellCreator.issues(s).map(k => i18n(`AD2E.Creator.Spell.Issue.${k}`)),
      destinations: [{ key: "", label: i18n("AD2E.Creator.World"), selected: !s.destination },
        ...packs.map(pk => ({ key: pk.collection, label: pk.metadata.label, selected: s.destination === pk.collection }))]
    };
  }

  _onRender(context, options) {
    super._onRender?.(context, options);
    for (const input of this.element.querySelectorAll("[data-field]")) input.addEventListener("change", async ev => {
      const t = ev.currentTarget;
      const f = t.dataset.field;
      const value = t.type === "checkbox" ? t.checked : (t.type === "number" ? (t.value === "" ? 0 : Number(t.value)) : t.value);
      const destination = this.state.destination;
      if (f === "source") {
        const item = value ? await fromUuid(value) : null;
        this.state = Object.assign(item ? SpellCreator.fromItem(item) : SpellCreator.blank(), { source: value, destination });
      } else if (f === "group") {
        const key = this.state.kind === "priest" ? "spheres" : "schools";
        const set = new Set(this.state[key]);
        if (t.checked) set.add(t.dataset.key); else set.delete(t.dataset.key);
        this.state[key] = [...set];
      } else if (f === "damage") this.state.damage[Number(t.dataset.index)][t.dataset.part] = value;
      else if (f === "kind") Object.assign(this.state, { kind: value, schools: [], spheres: [], researcher: "", failures: 0, researched: false,
        level: Math.min(this.state.level, maxSpellLevel(value)) });
      else if (f === "researcher" || f === "level") Object.assign(this.state, { [f]: value, failures: 0, researched: false });
      else this.state[f] = value;
      this.render();
    });
  }

  /** One research check for the chosen character: wizard = chance to learn the spell (d100), priest = Wisdom check (d20). */
  static async #onResearch() {
    const s = this.state;
    const actor = game.actors?.get(s.researcher);
    if (!actor) return ui.notifications.warn(game.i18n.localize("AD2E.Creator.Spell.NeedResearcher"));
    const data = SpellCreator.itemData(s);
    let roll, target, ok;
    if (s.kind === "wizard") {
      const { chance, blocked } = learnChance(actor, { name: data.name, system: data.system });
      if (blocked) return ui.notifications.warn(game.i18n.format(`AD2E.Learn.Blocked.${blocked}`, { name: data.name, level: "" }));
      roll = await new Roll("1d100").evaluate(); target = chance; ok = roll.total <= chance;
    } else {
      roll = await new Roll("1d20").evaluate(); target = actor.system.abilities.wis.total; ok = roll.total <= target;
    }
    if (ok) s.researched = true; else s.failures += 1;
    const time = researchCost(s.level, s.failures);
    const esc = v => foundry.utils.escapeHTML?.(String(v ?? "")) ?? String(v ?? "");
    await roll.toMessage?.({ speaker: ChatMessage.getSpeaker({ actor }), flavor: esc(game.i18n.format(ok ? "AD2E.Creator.Spell.ResearchOk" : "AD2E.Creator.Spell.ResearchFail",
      { name: actor.name, spell: data.name || "?", target, weeks: time.weeks, min: time.min, max: time.max })) });
    this.render();
  }

  static async #onCreate() {
    const s = this.state;
    if (!s.name) return ui.notifications.warn(game.i18n.localize("AD2E.Creator.NeedName"));
    const issues = SpellCreator.issues(s);
    if (issues.length) return ui.notifications.warn(issues.map(k => game.i18n.localize(`AD2E.Creator.Spell.Issue.${k}`)).join(" "));
    const data = SpellCreator.itemData(s);
    const doc = await Item.implementation.create(data, s.destination ? { pack: s.destination } : {});
    if (!doc) return null;
    const actor = s.researched && s.addToResearcher ? game.actors?.get(s.researcher) : null;
    if (actor) await actor.createEmbeddedDocuments?.("Item", [data]);
    ui.notifications.info(game.i18n.format("AD2E.Creator.Created", { name: doc.name }) + (actor ? ` ${game.i18n.format("AD2E.Creator.Spell.Added", { name: actor.name })}` : ""));
    doc.sheet?.render(true);
    return doc;
  }
}
