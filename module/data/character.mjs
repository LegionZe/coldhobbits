import { TRAVEL } from "../rules/travel-tables.mjs";
import { hpState } from "../health.mjs";
import { heatPenalty, heatRuleOn } from "../aq-rules.mjs";
import { canFightTwoWeapons, characterSize, needsTwoHands, twoWeaponRate } from "../combat-options.mjs";
import { inventory, PHYSICAL_TYPES } from "../containers.mjs";
import { nonproficiency, SP, spCost, spWeaponsOn, styleAc, weaponFamiliarity } from "../sp-weapons.mjs";
import { spProficienciesOn, spRating } from "../sp-proficiencies.mjs";
import { isShairKit } from "../shair.mjs";
import { better, dualClassOn, dualRestriction } from "../dual-class.mjs";
import { bardKitFits, bardKitRule, combinationAllowed, comboKey, multiClassOn, multiSlots, primaryClass } from "../multi-class.mjs";
import { pendingDrain } from "../level-drain.mjs";
import { poisonStateField } from "./poison-fields.mjs";
import { agingInfo, applyAging } from "../aging.mjs";
import { debilitated, halveAbilities } from "../poison.mjs";
import { applyMeditation, kitSpecial, meditationActive, weaponTypeConflicts } from "../kit-features.mjs";
import { AD2E, attackRate, conSaveBonus, formatRate, hitDiceAt, kitArmorMatches, kitKeyMatches, kitModifierValue, lookup, strengthKey,
  thac0At, thiefArmorColumn } from "../config.mjs";

const { ArrayField, BooleanField, SchemaField, NumberField, StringField, HTMLField } = foundry.data.fields;

const int = (initial, min = null, max = null) =>
  new NumberField({ required: true, integer: true, initial, min, max, nullable: false });

/** Size an armour item is made for: its own size, or the wearer's ("" = made for the wearer). */
export function armorSize(sys, wearer = "M") {
  return sys?.size || (["S", "M", "L"].includes(wearer) ? wearer : (wearer === "T" ? "S" : "L"));
}

/** Whether armour fits the wearer (made for the wearer's size, or for no particular size). */
export function armorFits(sys, wearer = "M") {
  return !sys?.size || sys.size === armorSize({}, wearer);
}

/** Weight factor by armour size: "Small armor weighs half the amount listed, while large armor weighs 50% more" (Armor (PHB)). */
export function armorWeightFactor(sys, wearer = "M") {
  return { S: 0.5, M: 1, L: 1.5 }[armorSize(sys, wearer)] ?? 1;
}

/**
 * Why a class may not use an armour item (AD2E.classTables.classArmor), or "" if allowed: "none" (wizards: body,
 * shield and helmet), a list of body armours (thieves: also elven chain; druids), a maximum AC ("up to, and including,
 * chain mail": base AC 5 or worse), shields "none" (wizards, bards); druids' "wooden" shields are a note only.
 */
export function armorRestriction(classId, item) {
  const rule = AD2E.classTables?.classArmor?.[classId];
  if (!rule) return "";
  const sys = item.system;
  const id = sys.identifier ?? "";
  if (sys.kind === "shield") {
    if (rule.shield === "none") return "noShield";
    return rule.shield === "wooden" ? "woodenShield" : "";
  }
  const body = rule.body;
  if (body === "none") return "noArmor";
  if (sys.kind !== "body") return "";
  if (Array.isArray(body)) {
    const elven = rule.elvenChain && /elven[- ]chain/i.test(`${id} ${item.name ?? ""}`);
    return body.includes(id) || elven ? "" : "notAllowed";
  }
  if (body?.maxAc !== undefined) return (sys.ac ?? 10) >= body.maxAc ? "" : "tooHeavy";
  return "";
}

/**
 * Why a character's classes may not use a weapon item (AD2E.classTables.classWeapons; owner's ruling: a warning, the
 * roll is not blocked), or "" if allowed: "notBludgeoning" (standard clerics, Table 45 type B only) or "notAllowed".
 * Several classes (multi-class): "a multi-classed priest must abide by the weapon restrictions of his mythos"; otherwise
 * the most permissive class decides (warriors and bards: any weapon). Weapons without a proficiency are not checked.
 * @param {Array<{identifier: string, group: string}>} classes
 */
export function weaponRestriction(classes, item) {
  const rules = AD2E.classTables?.classWeapons ?? {};
  const sys = item?.system ?? {};
  if (!sys.proficiency || !classes?.length) return "";
  // A class or kit item's own list (e.g. a specialty priest's; names or identifiers) replaces the generated one.
  const slug = v => String(v ?? "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const own = id => classes.find(c => c.identifier === id)?.allowed ?? [];
  const allows = id => {
    if (own(id).length) return own(id).map(slug).includes(slug(sys.proficiency));
    const rule = rules[id];
    if (!rule) return true;
    if (rule.type) return (sys.weapon?.type ?? "") === rule.type;
    return (rule.ids ?? []).includes(sys.proficiency);
  };
  const reason = id => (!own(id).length && rules[id]?.type ? "notBludgeoning" : "notAllowed");
  const priests = classes.filter(c => c.group === "priest");
  for (const p of priests) if (!allows(p.identifier)) return reason(p.identifier);
  if (priests.length) return "";
  return classes.some(c => allows(c.identifier)) ? "" : reason(classes[0].identifier);
}

/** Whether worn armour hinders casting wizard spells: any armour item, except elven chain worn by an elf. */
export function armorBlocksWizardCasting(worn, raceId) {
  return worn.some(i => !(raceId === "elf" && i.system.kind === "body" && /elven[- ]chain/i.test(`${i.system.identifier ?? ""} ${i.name ?? ""}`)));
}

/** Strength table row for a bow's rating ("17", "18/50", "18/00", "19"); null for a standard bow or an unknown rating. */
export function bowStrengthRow(rating) {
  const m = String(rating ?? "").trim().match(/^(\d+)(?:\/(\d+))?$/);
  if (!m) return null;
  const T = AD2E.abilityTables;
  const score = Number(m[1]);
  if (score === 18 && m[2] !== undefined) return lookup(T.strExceptional, Number(m[2]) === 0 ? 100 : Number(m[2])) ?? null;
  return lookup(T.str, score) ?? null;
}

export default class CharacterData extends foundry.abstract.TypeDataModel {
  static LOCALIZATION_PREFIXES = ["AD2E.Character"];

  static defineSchema() {
    const abilities = {};
    for (const key of AD2E.abilities) {
      const fields = { value: int(10, 1, 25) };
      if (key === "str") fields.exceptional = int(0, 0, 100);
      abilities[key] = new SchemaField(fields);
    }

    const saves = {};
    // Save targets come from PHB Table 60 by class group and level; override replaces the table value.
    for (const key of AD2E.saves) {
      saves[key] = new SchemaField({ override: new NumberField({ integer: true, min: 1, max: 25, nullable: true, initial: null }) });
    }

    return {
      race: new StringField({ initial: "" }), // legacy free-text race (pre-0.0.10); not shown
      className: new StringField({ initial: "" }), // legacy free-text class (pre-0.0.7); not shown
      classNotes: new StringField({ initial: "" }),
      classGroup: new StringField({ initial: "warrior", choices: Object.keys(AD2E.classGroups) }),
      alignment: new StringField({ initial: "n", choices: Object.keys(AD2E.alignments) }),
      level: int(1, 1, 30),
      xp: int(0, 0),
      abilities: new SchemaField(abilities),
      // stable: wounds bound (Death's Door); feeble: restored to 1 hp by a cure, until a day of rest; dead: explicit death
      // (massive damage, or bled out). See module/health.mjs.
      // punch: punching damage taken this fight (75% returns at its end); temp: temporary non-lethal weapon damage,
      // returning at world time tempUntil (one turn after the fight) - module/health.mjs.
      hp: new SchemaField({ value: int(1), max: int(1), stable: new BooleanField({ initial: false }),
        feeble: new BooleanField({ initial: false }), dead: new BooleanField({ initial: false }),
        punch: int(0, 0), temp: int(0, 0), tempUntil: new NumberField({ nullable: true, initial: null }) }),
      // misc: other AC adjustment (magical items such as rings or cloaks of protection, spells, cover); positive = better.
      ac: new SchemaField({ base: int(10, -10, 10), misc: int(0, -20, 20) }),
      thac0: new SchemaField({ override: new NumberField({ integer: true, nullable: true, initial: null }) }),
      initiative: new SchemaField({ mod: int(0) }),
      // Weight of gear not held as items (lb); clothing (5 lb) is added automatically.
      encumbrance: new SchemaField({ other: new NumberField({ required: true, min: 0, initial: 0, nullable: false }) }),
      // Legacy (0.0.20) coin counts; migrated to coin items at "ready" (module/migrations.mjs). Still counted.
      currency: new SchemaField(Object.fromEntries(AD2E.coins.map(c => [c, int(0, 0)]))),
      // Base movement rate override (default: the race item's Table 64 rate, 12 without a race).
      movement: new SchemaField({ override: new NumberField({ integer: true, min: 0, nullable: true, initial: null }) }),
      saves: new SchemaField(saves),
      // Class abilities: discretionary thief/bard skill points per skill, the ranger's species enemy, paladin lay on
      // hands used since the last rest.
      classAbilities: new SchemaField({
        points: new SchemaField(Object.fromEntries(AD2E.thiefSkills.map(k => [k, int(0, 0, 95)]))),
        speciesEnemy: new StringField({ initial: "" }),
        layOnHandsUsed: new BooleanField({ initial: false })
      }),
      // Henchmen (module/henchmen.mjs): actor UUIDs, and former henchmen counted toward the Charisma lifetime limit.
      henchmen: new SchemaField({ actors: new ArrayField(new StringField()), lost: int(0, 0) }),
      // Force marching (module/travel.mjs): days of penalty (-1 to attack rolls each), the consecutive streak, the last
      // world day marched and whether a failed check stops further force marching until rested.
      march: new SchemaField({ days: new NumberField({ integer: true, min: 0, initial: 0 }), streak: new NumberField({ integer: true, min: 0, initial: 0 }),
        lastDay: new NumberField({ integer: true, nullable: true, initial: null }), blocked: new BooleanField({ initial: false }) }),
      // Name-level followers (module/followers.mjs): unit actors (UUIDs), classes already rolled, and the stronghold record.
      followers: new SchemaField({ actors: new ArrayField(new StringField()), rolled: new ArrayField(new StringField()),
        stronghold: new SchemaField({ name: new StringField({ initial: "" }),
          kind: new StringField({ required: true, blank: true, initial: "", choices: ["castle", "worship", "hideout", "tower"] }),
          built: new BooleanField({ initial: false }) }) }),
      // Mounts and pack animals (module/animals.mjs): monster actor UUIDs and the one ridden; body weight (lb, PHB
      // Table 10) counts toward a ridden animal's load.
      animals: new SchemaField({ actors: new ArrayField(new StringField()), riding: new StringField({ required: true, blank: true, initial: "" }) }),
      bodyWeight: new NumberField({ min: 0, nullable: true, initial: null }),
      // Elemental mage kit (Al-Qadim): the chosen province (module/elemental.mjs).
      element: new StringField({ required: true, blank: true, initial: "", choices: ["", "flame", "sand", "sea", "wind"] }),
      // Sorcerer kit (Al-Qadim): the second chosen province (the first is `element`).
      element2: new StringField({ required: true, blank: true, initial: "", choices: ["", "flame", "sand", "sea", "wind"] }),
      // Skills & Powers kits (module/kit-features.mjs): social rank (rolled on the kit's table) and military title, and a
      // Mystic's meditation (ability boosted from `from` to `until`, world time in seconds).
      socialRank: new StringField({ required: true, blank: true, initial: "" }),
      socialTitle: new StringField({ required: true, blank: true, initial: "" }),
      meditation: new SchemaField({ ability: new StringField({ required: true, blank: true, initial: "" }),
        from: new NumberField({ nullable: true, initial: null }), until: new NumberField({ nullable: true, initial: null }) }),
      // Familiar (module/familiars.mjs): its actor UUID, within the 1 mile link (surprise bonus), separated (loses 1 hp a
      // day), its death resolved (system shock rolled), world time of the last Find Familiar attempt.
      familiar: new SchemaField({ uuid: new StringField({ required: true, blank: true, initial: "" }),
        near: new BooleanField({ initial: true }), separated: new BooleanField({ initial: false }),
        deathResolved: new BooleanField({ initial: false }), lastAttempt: new NumberField({ nullable: true, initial: null }) }),
      // Sha'ir gen (module/shair.mjs): kind (air, fire, water, earth), replacement gens so far, the current search, and the
      // requests of the last 24 hours (repeat penalty).
      gen: new SchemaField({
        kind: new StringField({ initial: "" }),
        // The gen actor (module/gens.mjs), whether it is within 10 feet (protection), and whether its death was resolved.
        uuid: new StringField({ initial: "" }), near: new BooleanField({ initial: true }),
        deathResolved: new BooleanField({ initial: false }),
        // Link broken (dispel magic, the master's death): summoning the same gen restores it (module/gens.mjs).
        broken: new BooleanField({ initial: false }),
        // Away from its master (forced away, threatened, following to another plane, an errand) until world time `awayUntil`
        // (null with a reason: until recalled).
        awayReason: new StringField({ initial: "" }), awayUntil: new NumberField({ nullable: true, initial: null }),
        raised: new NumberField({ required: true, integer: true, min: 0, initial: 0, nullable: false }),
        replacements: new NumberField({ required: true, integer: true, min: 0, initial: 0, nullable: false }),
        fetch: new SchemaField({
          spellId: new StringField({ initial: "" }), name: new StringField({ initial: "" }), unit: new StringField({ initial: "" }),
          count: new NumberField({ integer: true, initial: 0 }), returnsAt: new NumberField({ nullable: true, initial: null }),
          success: new BooleanField({ initial: false }), noticed: new BooleanField({ initial: false }),
          ready: new BooleanField({ initial: false }), expiresAt: new NumberField({ nullable: true, initial: null }),
          level: new NumberField({ integer: true, initial: 0 })
        }),
        attempts: new ArrayField(new SchemaField({ key: new StringField({ initial: "" }), at: new NumberField({ initial: 0 }) }))
      }),
      // Dual-class characters (module/dual-class.mjs, world setting "dualClass"): the earlier classes (identifier, name,
      // group, last level, specialist school, prime requisites, experience at the switch: null before 0.0.122) and the
      // experience penalty flags for using their abilities.
      dualClass: new SchemaField({
        previous: new ArrayField(new SchemaField({
          identifier: new StringField({ initial: "" }), name: new StringField({ initial: "" }),
          group: new StringField({ initial: "warrior" }), level: int(1, 1, 30), school: new StringField({ initial: "" }),
          prime: new ArrayField(new StringField()),
          xp: new NumberField({ integer: true, min: 0, nullable: true, initial: null })
        })),
        penalty: new SchemaField({ encounter: new BooleanField({ initial: false }), adventure: new BooleanField({ initial: false }) })
      }),
      // Multi-class characters (module/multi-class.mjs, world setting "multiClass"): level and experience of each class
      // other than the primary one (whose level and experience are `level` and `xp`).
      multiClass: new SchemaField({
        classes: new ArrayField(new SchemaField({
          identifier: new StringField({ initial: "" }), level: int(1, 1, 30), xp: int(0, 0)
        }))
      }),
      // Skills & Powers animal companion / bonded mount (module/companions.mjs): actor UUIDs, species no longer allowed as
      // companion (lost carelessly), and the rider's lost rapport (a mount fled).
      bond: new SchemaField({
        companion: new StringField({ required: true, blank: true, initial: "" }), mount: new StringField({ required: true, blank: true, initial: "" }),
        barred: new ArrayField(new StringField()), rapportLost: new BooleanField({ initial: false }),
        // Rider: feebleminded after a failed save for a mount lost by negligence, until this world time (null = not).
        feebleUntil: new NumberField({ required: false, nullable: true, initial: null })
      }),
      // Energy drain (module/level-drain.mjs): levels lost and not yet regained (key "main", "multi:<id>" or
      // "prev:<id>", the lost level, hit points lost, world time) and the 0-level state.
      drain: new SchemaField({
        lost: new ArrayField(new SchemaField({
          key: new StringField({ initial: "main" }), identifier: new StringField({ initial: "" }), name: new StringField({ initial: "" }),
          level: int(2, 1, 30), hp: int(0, 0), at: new NumberField({ initial: 0 })
        })),
        zero: new BooleanField({ initial: false })
      }),
      // Poison taking effect (module/poison.mjs).
      poison: poisonStateField(),
      // Magic resistance from items or special abilities (module/magic-resistance.mjs): percentage, lowered at will.
      magicResistance: new SchemaField({ value: int(0, 0, 100), lowered: new BooleanField({ initial: false }) }),
      // Age in years (blank = not recorded); Restoration ages caster and recipient (module/level-drain.mjs).
      age: new NumberField({ required: false, nullable: true, integer: true, min: 0, initial: null }),
      // Maximum age (PHB Table 11), rolled by the GM and shown to the GM only (module/aging.mjs).
      maxAge: new NumberField({ required: false, nullable: true, integer: true, min: 0, initial: null }),
      biography: new HTMLField()
    };
  }

  /**
   * Core calls getRollData() from applyActiveEffects(), which runs between
   * prepareBaseData() and prepareDerivedData(). Compute once in base data so roll
   * data exists then, and again in derived data so active-effect changes apply.
   */
  prepareBaseData() {
    this.#computeDerived();
  }

  prepareDerivedData() {
    this.#computeDerived();
  }

  #computeDerived() {
    // Race first: its adjustments (PHB Table 8) give the effective scores (`total`) that every
    // table and check below uses. The stored `value` is the rolled score, which is what the
    // race's Table 7 minimums/maximums are checked against.
    this.raceInfo = this.#computeRaceInfo();
    // Size from the race (weapon and armour size, Weapons / Armor (PHB)).
    this.sizeCategory = characterSize(this.raceInfo.raceItem?.system.identifier);
    // Class next: the class item sets the group used below (warrior CON bonus, THAC0).
    this.classInfo = this.#computeClassInfo();
    if (this.classInfo.classItem) this.classGroup = this.classInfo.classItem.system.group;
    this.multi = this.#computeMulti();
    this.drainInfo = this.#computeDrain();
    this.dual = this.#computeDual();
    // Kit ability score bonuses (e.g. Pacifist priest Charisma +2, at most 18) count after the kit's requirements.
    for (const mod of this.#kitModifierList()) {
      if (mod.target !== "score" || !this.abilities[mod.key]) continue;
      const v = kitModifierValue(mod, this.level) ?? 0;
      const ab = this.abilities[mod.key];
      ab.total = mod.max !== null && mod.max !== undefined ? Math.max(ab.total, Math.min(ab.total + v, mod.max)) : ab.total + v;
    }
    // Ageing (PHB Table 12, module/aging.mjs): cumulative changes from the Age and race (owner's ruling: automatic).
    this.ageInfo = agingInfo(this.raceInfo.raceItem?.system.identifier, this.age);
    if (this.ageInfo) this.ageInfo.changes = this.ageInfo.index >= 0 ? applyAging(this.abilities, this.ageInfo.index) : {};
    // Mystic meditation (module/kit-features.mjs): +2 to one score (18/xx Strength: +20%) while the boost lasts.
    const medRule = kitSpecial(this.parent).meditation;
    this.meditationInfo = medRule && meditationActive(this.meditation, game.time?.worldTime ?? 0)
      ? applyMeditation(this.abilities, this.meditation, medRule) : null;
    // Debilitating poison (module/poison.mjs, Poison (DMG)): every ability score halved while it lasts.
    this.debilitated = debilitated(this.poison, globalThis.game?.time?.worldTime ?? 0);
    if (this.debilitated) halveAbilities(this.abilities);

    const a = this.abilities;
    const T = AD2E.abilityTables;
    const strRow = (a.str.total === 18 && a.str.exceptional > 0)
      ? lookup(T.strExceptional, a.str.exceptional) : lookup(T.str, a.str.total);

    /** Current table row per ability (PHB Tables 1-6), from the effective scores. */
    this.abilityData = {
      str: strRow,
      dex: lookup(T.dex, a.dex.total),
      con: lookup(T.con, a.con.total),
      int: lookup(T.int, a.int.total),
      wis: lookup(T.wis, a.wis.total),
      cha: lookup(T.cha, a.cha.total)
    };
    const { dex, con, wis } = this.abilityData;
    const warrior = this.classGroup === "warrior";

    this.mods = {
      hit: strRow.hit,
      dmg: strRow.dmg,
      reaction: dex.reaction,
      missile: dex.missile,
      conHp: warrior ? con.warrior : con.hp,
      magicDef: wis.magicDef
    };

    this.hpState = hpState(this.hp, { character: true });
    this.armor = this.#computeArmor(dex.ac);
    this.traits = this.#computeTraits();
    this.kitMods = this.#computeKitModifiers();
    const kitAc = this.kitMods.total("ac") + (this.ac.misc ?? 0);
    for (const k of ["front", "missile", "rear"]) this.armor[k] -= kitAc;
    this.encumbrance.info = this.#computeEncumbrance();
    // Debilitating poison: "one-half his normal movement rate" (Poison (DMG)).
    if (this.debilitated) this.encumbrance.info.rate = Math.floor(this.encumbrance.info.rate / 2);
    const { hit: encHit, ac: encAc } = this.encumbrance.info.penalty;
    for (const k of ["front", "missile", "rear"]) this.armor[k] += encAc;
    this.ac.total = this.armor.front;
    this.mods.encumbranceHit = encHit;
    // Al-Qadim heat (optional world setting): worn armour better than AC 7 hinders attacks and checks.
    this.mods.heat = heatRuleOn() ? heatPenalty(this.armor.body, this.armor.shield) : 0;
    // Force marching: -1 to all attack rolls per day, cumulative (Cross-Country Movement (PHB), module/travel.mjs).
    this.mods.march = TRAVEL.march.attackPerDay * (this.march?.days ?? 0) || 0;
    this.mods.meleeAttack = this.mods.hit + encHit + this.mods.heat + this.mods.march + this.kitMods.total("attack");
    this.mods.missileAttack = this.mods.missile + encHit + this.mods.heat + this.mods.march + this.kitMods.total("attack");

    const saveRow = lookup(AD2E.saveTable[this.classGroup], this.level);
    // Racial CON bonus (PHB Table 9) is a roll bonus vs. rod/staff/wand and spells; the poison
    // bonus only applies to poison, so it is shown on the par save but not added to it.
    const raceCon = this.raceInfo.race?.conSaves ? conSaveBonus(a.con.total) : 0;
    this.raceInfo.conSaveBonus = raceCon;
    this.raceInfo.poisonBonus = this.raceInfo.race?.conPoison ? raceCon : 0;
    // Paladins: "+2 bonus to all saving throws" (Paladin (PHB)); a roll bonus like the racial one.
    const classSave = this.classInfo.classItem?.system.identifier === "paladin" ? AD2E.paladinSaveBonus : 0;
    this.classInfo.saveBonus = classSave;
    const dual = this.dual;
    for (const key of AD2E.saves) {
      this.saves[key].table = saveRow[key];
      // Dual-class: the better of the old and new tables once the restrictions are lifted (owner's ruling); while they
      // apply, a better old number is offered in the save dialog (using it costs experience).
      const old = dual ? dual.oldSaves[key] : null;
      let best = dual && !dual.restricted ? better(saveRow[key], old) : saveRow[key];
      // Multi-class: "the best saving throw from his different classes".
      for (const c of this.multi?.others ?? []) best = better(best, lookup(AD2E.saveTable[c.group], c.level)?.[key] ?? null);
      if (dual) dual.saveOptions[key] = dual.restricted && old !== null && old < saveRow[key] ? old : null;
      this.saves[key].value = this.saves[key].override ?? best;
      this.saves[key].bonus = (["rsw", "sp"].includes(key) ? raceCon : 0) + classSave + this.kitMods.total("save", key);
    }

    const hd = hitDiceAt(this.classGroup, this.level);
    this.hitDice = { ...hd, label: hd.bonus ? `${hd.dice}d${hd.die}+${hd.bonus}` : `${hd.dice}d${hd.die}` };
    // Experience table: the class's, or the one a fitting kit names (Kahin: druid, Kits (AA) Table 3).
    const xpKey = (this.classInfo.kitFits && this.classInfo.kitItem?.system.xpTable) || this.classInfo.classItem?.system.identifier;
    this.classInfo.xpTable = xpKey ?? null;
    const xp = AD2E.xpTable[xpKey];
    this.xpNext = xp?.[this.level] ?? null; // index = level -> XP for level + 1
    // Hierophant druids: XP for the starred levels counts from the restart at 16th level (Table 23 footnote).
    const restart = AD2E.xpRestart[xpKey];
    this.xpRestart = !!(restart && this.xpNext !== null && this.level + 1 >= restart);

    this.proficiencies = this.#computeProficiencies();
    this.weapons = this.#computeWeapons();
    this.#applyStyleAc();
    this.spells = this.#computeSpells();
    this.classAbilities.info = this.#computeClassAbilities();

    const computed = thac0At(this.classGroup, this.level);
    this.thac0.computed = computed;
    const oldThac0 = dual?.oldThac0 ?? null;
    if (dual) dual.thac0Option = dual.restricted && oldThac0 !== null && oldThac0 < computed ? oldThac0 : null;
    // Multi-class: "the most favorable combat value".
    const multiThac0 = (this.multi?.others ?? []).reduce((b, c) => better(b, thac0At(c.group, c.level)), null);
    this.thac0.value = this.thac0.override ?? better(dual && !dual.restricted ? better(computed, oldThac0) : computed, multiThac0);
  }

  /**
   * Dual-class state (null unless the world setting is on and the character has earlier classes): the earlier classes,
   * the highest of their levels, whether the restrictions still apply, their best THAC0 and saving throws, and the
   * experience penalty flags. `thac0Option` / `saveOptions` (set below) are the better old numbers offered while restricted.
   */
  #computeDual() {
    const previous = this.dualClass?.previous ?? [];
    if (!previous.length || !dualClassOn()) return null;
    const rule = dualRestriction(previous, this.level);
    const { maxOld } = rule;
    // Drained levels not yet regained: "Using abilities of the other class then subjects him to the experience
    // penalties" (Multi-Class and Dual-Class Characters (PHB)); module/level-drain.mjs.
    const drained = (this.drainInfo?.pending ?? []).length > 0;
    const restricted = rule.restricted || drained;
    const oldSaves = Object.fromEntries(AD2E.saves.map(k => [k, previous.reduce((best, p) =>
      better(best, lookup(AD2E.saveTable[p.group], p.level)?.[k] ?? null), null)]));
    const oldThac0 = previous.reduce((best, p) => better(best, thac0At(p.group, p.level)), null);
    return { previous, maxOld, restricted, drained, oldSaves, oldThac0, saveOptions: {}, thac0Option: null,
      penalty: { encounter: !!this.dualClass.penalty?.encounter, adventure: !!this.dualClass.penalty?.adventure } };
  }

  /** Class levels by drain key (module/level-drain.mjs). */
  drainLevels() {
    const levels = { main: this.level };
    for (const c of this.multi?.others ?? []) levels[`multi:${c.identifier}`] = c.level;
    for (const p of this.dualClass?.previous ?? []) levels[`prev:${p.identifier}`] = p.level;
    return levels;
  }

  /** Energy drain state: levels lost and not regained, and the 0-level state. */
  #computeDrain() {
    const pending = pendingDrain(this.drain?.lost ?? [], this.drainLevels());
    return { pending, zero: !!this.drain?.zero, any: pending.length > 0 || !!this.drain?.zero };
  }

  /**
   * Multi-class state (null unless the world setting is on and the character has several class items): each class with
   * its level, experience, next level, racial level limit and prime requisite bonus; `others` = the classes besides the
   * primary one; `allowed` = the combination is one of the race's.
   */
  #computeMulti() {
    if (!this.classInfo.multi) return null;
    const stored = this.multiClass?.classes ?? [];
    const race = this.raceInfo.race;
    const raceId = this.raceInfo.raceItem?.system.identifier;
    const kit = this.classInfo.kitFits ? this.classInfo.kitItem.system : null;
    const classes = this.classInfo.classItems.map(i => {
      const id = i.system.identifier;
      const primary = i === this.classInfo.classItem;
      const entry = primary ? { level: this.level, xp: this.xp } : (stored.find(c => c.identifier === id) ?? { level: 1, xp: 0 });
      const prime = [...(i.system.prime ?? [])];
      // The kit's experience table and racial level limit apply to the kit's own class.
      const kitHere = !!kit?.classes?.has(id);
      const xpKey = (kitHere && kit.xpTable) || id;
      const kitLimit = kitHere && raceId && kit.raceLimits && raceId in kit.raceLimits ? kit.raceLimits[raceId] : undefined;
      return { item: i, identifier: id, name: i.name, group: i.system.group, school: i.system.school ?? "", primary,
        level: entry.level, xp: entry.xp, xpKey, xpNext: AD2E.xpTable[xpKey]?.[entry.level] ?? null,
        levelLimit: kitLimit !== undefined ? kitLimit : (race?.levelLimits?.[id] ?? null),
        hitDice: hitDiceAt(i.system.group, entry.level),
        bonus: prime.length > 0 && prime.every(k => this.abilities[k].total >= 16) ? 10 : 0 };
    });
    for (const c of classes) c.atLimit = !!c.levelLimit && c.level >= c.levelLimit;
    const ids = classes.map(c => c.identifier);
    // Complete Bard's Handbook combinations need one of their bard kits (module/multi-class.mjs bardKitRule).
    const bard = race ? bardKitRule(race.multiClassKits, ids) : null;
    const kitId = this.classInfo.kitItem?.system.identifier ?? "";
    const bardOk = bardKitFits(bard, kitId);
    return { classes, others: classes.filter(c => !c.primary), bard: bard ? { kits: bard.kits, ok: bardOk } : null,
      allowed: race ? (combinationAllowed(race.multiClass, ids) || (!!bard && bardOk)) : true };
  }

  /**
   * Class and kit come from owned Items (types "class" and "kit"); the class item, when
   * present, also sets the class group. A kit only counts if it is open to the class.
   */
  #computeClassInfo() {
    const items = this.parent?.items;
    // Multi-class (world setting): every class item counts; the primary one (warrior first, module/multi-class.mjs) drives
    // the single-class code paths, the others are added in #computeMulti.
    const classItems = items?.filter(i => i.type === "class") ?? [];
    const multi = multiClassOn() && classItems.length > 1;
    const classItem = multi
      ? primaryClass(classItems.map(i => ({ item: i, identifier: i.system.identifier, group: i.system.group }))).item
      : (classItems[0] ?? null);
    const kitItem = items?.find(i => i.type === "kit") ?? null;
    const cls = classItem?.system ?? null;
    const race = this.raceInfo.race;
    const raceId = this.raceInfo.raceItem?.system.identifier;
    // Multi-class: every class open to the race, or the Complete Bard's Handbook combination (race multiClassKits).
    const bardCombo = multi && !!race?.multiClassKits?.[comboKey(classItems.map(i => i.system.identifier))];
    const classViaRace = !race || !cls || (multi ? (bardCombo || classItems.every(i => race.classes.has(i.system.identifier)))
      : race.classes.has(cls.identifier));
    const classViaKit = !!(race && cls && race.kitClasses?.has(cls.identifier));
    const kitListsRace = !!(kitItem && raceId && kitItem.system.raceLimits && raceId in kitItem.system.raceLimits);
    // A kit fits if it is open to the class and, with a race: a race-only kit must list the race, and a
    // class the race only reaches through kits needs a kit that lists the race.
    // Multi-class: one kit, fitting any of the classes (owner's ruling).
    const kitFits = !!(cls && kitItem && (multi ? classItems.some(i => kitItem.system.classes.has(i.system.identifier)) : kitItem.system.classes.has(cls.identifier))
      && !(raceId && (kitItem.system.racesBarred ?? []).includes(raceId))
      && (!race || ((!kitItem.system.raceOnly || kitListsRace) && (classViaRace || kitListsRace))));
    const kit = kitFits ? kitItem.system : null;
    const requirements = AD2E.abilities.map(key => {
      const mins = (multi ? classItems.map(i => i.system.min[key]) : [cls?.min[key]]).filter(v => v !== null && v !== undefined);
      const classMin = mins.length ? Math.max(...mins) : null;
      const kitMin = kit ? (kit.min[key] ?? null) : null;
      // Skills & Powers kits (`minStacks`): the higher of the kit's and the class's minimum.
      const required = kit?.minStacks ? Math.max(kitMin ?? 0, classMin ?? 0) : (kitMin ?? classMin ?? 0);
      const score = this.abilities[key].total;
      return { key, classMin, kitMin, required, score, met: score >= required };
    });
    const prime = cls ? [...cls.prime] : [];
    // A kit's racial level limit is for the kit's class (multi-class: only when that is the primary class).
    const levelLimit = (kitFits && kitListsRace && (!multi || kitItem.system.classes.has(cls.identifier)))
      ? (kitItem.system.raceLimits[raceId] ?? null)
      : ((cls && race?.levelLimits?.[cls.identifier]) ?? null);
    return {
      classItem,
      kitItem,
      kitFits,
      requirements,
      requirementsMet: requirements.every(r => r.met),
      alignmentAllowed: multi ? classItems.every(i => i.system.alignments.has(this.alignment)) : (cls ? cls.alignments.has(this.alignment) : true),
      classItems,
      multi,
      classAllowedByRace: classViaRace || (classViaKit && kitFits && kitListsRace),
      needsRaceKit: !classViaRace && classViaKit && !(kitFits && kitListsRace),
      levelLimit,
      xpBonus: prime.length > 0 && prime.every(key => this.abilities[key].total >= 16) ? 10 : 0
    };
  }

  /**
   * Race comes from an owned Item of type "race". Sets `abilities.<key>.total` (rolled score +
   * racial adjustment) and checks the rolled scores against the race's minimums/maximums.
   */
  #computeRaceInfo() {
    const raceItem = this.parent?.items?.find(i => i.type === "race") ?? null;
    const race = raceItem?.system ?? null;
    const requirements = AD2E.abilities.map(key => {
      const ability = this.abilities[key];
      const adjust = race?.adjust[key] ?? 0;
      ability.total = ability.value + adjust;
      const min = race?.min[key] ?? null;
      const max = race?.max[key] ?? null;
      const rolled = ability.value;
      return { key, min, max, adjust, rolled, total: ability.total,
        met: (min === null || rolled >= min) && (max === null || rolled <= max) };
    });
    return { raceItem, race, requirements, requirementsMet: requirements.every(r => r.met) };
  }

  /** Modifiers of the kit, when the kit fits the class (an empty list otherwise). */
  #kitModifierList() {
    const kit = this.classInfo?.kitFits ? (this.classInfo.kitItem.system.modifiers ?? []) : [];
    // Skills & Powers traits and disadvantages (module/data/item-trait.mjs): their effects in the same format.
    const traits = (this.parent?.items?.filter?.(i => i.type === "trait") ?? [])
      .flatMap(i => (i.system.modifiers ?? []).map(m => ({ ...m, origin: i.name })));
    return [...kit, ...traits];
  }

  /**
   * Traits and disadvantages (Player's Option: Skills & Powers Tables 46, 47; owner's ruling: no character points,
   * traits balanced by disadvantages): { ids, rows, cost (traits), points (disadvantages), over }.
   */
  #computeTraits() {
    const raceId = this.raceInfo?.raceItem?.system.identifier ?? "";
    const items = this.parent?.items?.filter?.(i => i.type === "trait") ?? [];
    const rows = items.map(i => ({ item: i, kind: i.system.kind, value: i.system.valueFor ? i.system.valueFor(raceId) : 0 }));
    const cost = rows.filter(r => r.kind === "trait").reduce((n, r) => n + r.value, 0);
    const points = rows.filter(r => r.kind === "disadvantage").reduce((n, r) => n + r.value, 0);
    return { ids: items.map(i => i.system.identifier), rows, cost, points, over: cost > points };
  }

  /**
   * Kit modifiers at the character's level (kit pages via tools/build-kit-mechanics.py). A modifier without a condition
   * whose armour requirement the equipped body armour meets applies automatically (`auto`); `current` is the value at
   * the character's level and `status` one of applied / situational (roll dialogs) / dm (reaction, surprise, conditional
   * AC) / armor (armour requirement not met) / inactive (below its level); `total(target, key)` sums the applied ones. Conditional ones are listed for the roll dialogs; reaction and surprise ones are shown on the sheet only.
   */
  #computeKitModifiers() {
    const body = this.armor?.body ?? null;
    const list = this.#kitModifierList().map((mod, index) => {
      const current = kitModifierValue(mod, this.level);
      const armorOk = kitArmorMatches(mod.armor, body);
      const active = current !== null;
      const auto = active && !mod.condition && armorOk;
      // Reaction rolls are the DM's; conditional AC changes are not rolled either. (Surprise is rolled: rollSurprise.)
      const dm = mod.target === "reaction" || (mod.target === "ac" && !!mod.condition);
      const status = !active ? "inactive" : dm ? "dm" : auto ? "applied" : mod.condition ? "situational" : "armor";
      return { ...mod, index, current, armorOk, active, auto, status };
    });
    const total = (target, key = null) => list.filter(m => m.auto && m.target === target
      && (key === null ? !m.key : kitKeyMatches(m.key, key))).reduce((n, m) => n + m.current, 0);
    const options = (target, key = null) => list.filter(m => m.active && m.condition && m.target === target
      && (key === null ? !m.key : kitKeyMatches(m.key, key)));
    return { list, total, options };
  }

  /**
   * Armour Class from equipped armour items (Armor (PHB)): the best equipped body armour's Table 46 rating minus
   * its magical bonus (no body armour: `ac.base`); an equipped shield improves it against front and flank attacks
   * ("A shield is useful only to protect the front and flanks of the user"), the body shield by 2 against missiles.
   * Dexterity defensive adjustment applies, except that a beneficial one does not apply "when a character is
   * attacked from behind" (Dexterity (PHB)). Returns front (= ac.total), vs. missiles, and rear AC.
   */
  #computeArmor(dexAc) {
    const worn = this.parent?.items?.filter(i => i.type === "armor" && i.system.equipped) ?? [];
    // Armour made for another size does not fit ("it will do little good for a halfling", Armor (PHB)): no AC.
    const misfit = worn.filter(i => !armorFits(i.system, this.sizeCategory));
    const equipped = worn.filter(i => !misfit.includes(i));
    // Class armour limits (Wizard, Thief, Bard, Druid (PHB); class-tables.mjs classArmor): shown, still counted.
    const classId = this.classInfo?.classItem?.system.identifier ?? null;
    // Multi-class (implementation choice): an armour is restricted only if every class restricts it, except a druid's
    // (priest) limits, which always apply (owner's ruling); wizards' casting in armour (actor castSpell) and thieves'
    // skills in armour (#multiThiefLimit) are handled separately.
    const multiItems = this.classInfo?.multi ? this.classInfo.classItems : null;
    const ids = multiItems ? multiItems.map(c => c.system.identifier) : [classId];
    const priestIds = multiItems ? multiItems.filter(c => c.system.group === "priest").map(c => c.system.identifier) : [];
    const restricted = worn.map(i => {
      const priest = priestIds.map(id => armorRestriction(id, i)).find(Boolean);
      return { item: i, reason: priest || (ids.map(id => armorRestriction(id, i)).every(Boolean) ? armorRestriction(ids[0], i) : "") };
    }).filter(r => r.reason);
    const bodies = equipped.filter(i => i.system.kind === "body" && i.system.ac !== null)
      .sort((a, b) => (a.system.ac - a.system.bonus) - (b.system.ac - b.system.bonus));
    const shields = equipped.filter(i => i.system.kind === "shield")
      .sort((a, b) => (b.system.shield.melee + b.system.bonus) - (a.system.shield.melee + a.system.bonus));
    const body = bodies[0] ?? null;
    const shield = shields[0] ?? null;
    const base = body ? body.system.ac - body.system.bonus : this.ac.base;
    const vsMelee = shield ? shield.system.shield.melee + shield.system.bonus : 0;
    const vsMissile = shield ? shield.system.shield.missile + shield.system.bonus : 0;
    return {
      body, shield, base,
      front: base - vsMelee + dexAc,
      missile: base - vsMissile + dexAc,
      rear: base + Math.max(dexAc, 0),
      shieldAttacks: shield?.system.shield.attacks ?? null,
      extraBody: bodies.length > 1,
      extraShield: shields.length > 1,
      misfit, restricted
    };
  }

  /**
   * Encumbrance and movement (Encumbrance (PHB), Tables 47/48; Movement (PHB), Table 64). Load = item weights
   * (weapons, ammunition and carried equipment x quantity, armour) + coins (50 to the pound) + other gear + 5 lb
   * clothing. Magical armour counts toward the most
   * weight that can be carried but not toward movement or combat effects. Basic rule (Table 47 categories): Light
   * reduces movement by 1/3, Moderate by 1/2, Heavy by 2/3 (fractions down), Severe to 1. Specific rule (Table 48):
   * the first column whose weight is at least the load. Combat: movement at 1/2 of normal: -1 to hit; 1/3 or less:
   * -2 to hit and +1 AC; movement 1: -4 to hit and +3 AC. Over the most weight that can be carried: no movement.
   */
  #computeEncumbrance() {
    let rule = "basic";
    try { rule = game.settings.get("ad2e", "encumbrance") ?? "basic"; } catch { /* setting not registered */ }
    const items = this.parent?.items ?? [];
    const weightOf = i => i.type === "coin" ? i.system.quantity / AD2E.coinsPerPound
      : (i.system.weight ?? 0) * (["weapon", "ammunition", "equipment", "magic", "jewellery"].includes(i.type) ? (i.system.quantity ?? 1) : 1)
        * (i.type === "armor" ? armorWeightFactor(i.system, this.sizeCategory) : 1);
    // Equipment, magical items and treasure count while carried (animals, transport, services and lodging default to
    // not carried); a dropped weapon does not count. Items in a container follow the container, and add no weight
    // inside a container whose contents add no weight (module/containers.mjs).
    const carriedLoose = i => i.type === "weapon" ? !i.system.dropped
      : (["equipment", "magic", "jewellery"].includes(i.type) ? i.system.carried : true);
    const inv = inventory(items, { weightOf, carriedLoose });
    const gear = items.filter(i => PHYSICAL_TYPES.includes(i.type) && i.type !== "coin" && inv.counts(i));
    const itemWeight = gear.reduce((n, i) => n + weightOf(i), 0);
    const magicArmor = gear.filter(i => i.type === "armor" && i.system.equipped && i.system.bonus > 0)
      .reduce((n, i) => n + weightOf(i), 0);
    // Skills & Powers armour proficiency: worn armour of that type counts half toward the load ("the armor retains its
    // full weight for all other purposes", Armor Proficiency (POSP)): `total` keeps the full weight.
    const armorProfs = spWeaponsOn() ? new Set(items.filter(i => i.type === "proficiency" && i.system.kind === "armor" && i.system.armorType)
      .map(i => i.system.armorType)) : new Set();
    const armorRelief = gear.filter(i => i.type === "armor" && i.system.equipped && !(i.system.bonus > 0) && armorProfs.has(i.system.identifier))
      .reduce((n, i) => n + weightOf(i) * (1 - SP.armor.factor), 0);
    const coinItems = items.filter(i => i.type === "coin");
    const coinCount = coinItems.reduce((n, i) => n + i.system.quantity, 0)
      + AD2E.coins.reduce((n, c) => n + (this.currency?.[c] ?? 0), 0);
    const coinValue = coinItems.reduce((n, i) => n + i.system.quantity * i.system.value, 0)
      + AD2E.coins.reduce((n, c) => n + (this.currency?.[c] ?? 0) * AD2E.coinValues[c], 0);
    // Coins that count toward the load (not those in a container left behind or one whose contents add no weight).
    const coinsCarried = coinItems.filter(i => inv.counts(i)).reduce((n, i) => n + i.system.quantity, 0)
      + AD2E.coins.reduce((n, c) => n + (this.currency?.[c] ?? 0), 0);
    const coinWeight = Math.round(coinsCarried / AD2E.coinsPerPound * 10) / 10;
    const total = Math.round((itemWeight + coinWeight + this.encumbrance.other + AD2E.clothingWeight) * 10) / 10;
    const effective = Math.round((total - magicArmor - armorRelief) * 10) / 10;
    const key = strengthKey(this.abilities.str.total, this.abilities.str.exceptional);
    const row47 = lookup(AD2E.encumbranceTable, key);
    const row48 = lookup(AD2E.movementTable.rows, key);
    const base = this.movement.override ?? this.raceInfo.race?.move ?? 12;
    const overMax = total > row47.maxCarried;
    let category = AD2E.encumbranceCategories.findIndex((c, i) => effective <= row47.limits[i]);
    if (category < 0) category = 4;
    let rate = base;
    if (rule === "basic") {
      rate = [base, Math.floor(base * 2 / 3), Math.floor(base / 2), Math.floor(base / 3), 1][category];
    } else if (rule === "specific") {
      const col = row48.loads.findIndex(w => w !== null && effective <= w);
      const rates = base === 6 ? AD2E.movementTable.rates6 : AD2E.movementTable.rates12;
      // Table 48 has rows for base 12 and 6 only; other bases scale the base-12 row.
      rate = col < 0 ? 1 : (base === 12 || base === 6 ? rates[col] : Math.max(1, Math.floor(rates[col] * base / 12)));
    }
    if (overMax && rule !== "none") rate = 0;
    const penalty = { hit: 0, ac: 0 };
    if (rule !== "none" && base > 0 && rate < base) {
      if (rate <= 1) Object.assign(penalty, { hit: -4, ac: 3 });
      else if (rate * 3 <= base) Object.assign(penalty, { hit: -2, ac: 1 });
      else if (rate * 2 <= base) Object.assign(penalty, { hit: -1, ac: 0 });
    }
    return { rule, total, effective, magicArmor, armorRelief: Math.round(armorRelief * 10) / 10, itemWeight: Math.round(itemWeight * 10) / 10, coinCount, coinsCarried, coinWeight, inventory: inv, coinValue, maxCarried: row47.maxCarried, limits: row47.limits,
      category: rule === "none" ? null : AD2E.encumbranceCategories[category], overMax, base, rate, penalty };
  }

  /**
   * Proficiency slots (PHB Table 34): initial + one per level evenly divisible by the rate, plus kit
   * bonus slots; nonweapon slots also add the Intelligence "number of languages" (Table 4). Owned
   * proficiency items use slots unless granted by a kit (`grantedBy`); a nonweapon proficiency from a
   * group outside the class's Table 38 groups costs one additional slot.
   * Skills & Powers (world setting "spWeapons"): costs, validity and the group, style, armour and shield kinds come from
   * module/sp-weapons.mjs `spCost`; `sp` holds what the valid purchases give (known weapons and groups, Table 50
   * penalties, styles, armour types, shield types). Without the setting those kinds cost nothing and do nothing.
   */
  #computeProficiencies() {
    const rules = AD2E.proficiencySlots[this.classGroup];
    const kit = this.classInfo.kitFits ? this.classInfo.kitItem.system : null;
    const classId = this.classInfo.classItem?.system.identifier;
    const groupsOf = (id, group) => AD2E.proficiencyGroups[id] ?? AD2E.defaultProficiencyGroups[group] ?? [];
    // Multi-class (implementation choice): the nonweapon groups of all the classes, since the character may "use the most
    // beneficial line on Table 34" (Weapon Proficiencies (PHB)).
    const groups = this.multi ? [...new Set(this.multi.classes.flatMap(c => groupsOf(c.identifier, c.group)))]
      : groupsOf(classId, this.classGroup);
    const items = this.parent?.items?.filter(i => i.type === "proficiency") ?? [];
    // Kit exceptions (tools/build-kit-mechanics.py KIT_SPECIALIZATION): "allowed"/"required" open specialization to
    // the kit's class, "forbidden" closes it; `free` weapons are specialized at no slot cost even for other classes.
    const kitSpec = kit?.specialization ?? { mode: "", free: [] };
    // "multi-class characters cannot use weapon specialization; it is available only to single-class fighters" (Weapon
    // Specialization (PHB)): no free kit specializations either.
    const free = new Set(this.multi ? [] : (kitSpec.free ?? []));
    // Skills & Powers weapon rules (world setting, module/sp-weapons.mjs): every class may specialize (Table 53).
    const sp = spWeaponsOn();
    const canSpecialize = (kitSpec.mode === "forbidden" || (this.multi && !sp)) ? false
      : sp || AD2E.specialization.classes.includes(classId) || ["allowed", "required"].includes(kitSpec.mode);
    const specializedCount = items.filter(i => i.system.kind === "weapon" && i.system.specialized && !free.has(i.system.identifier)).length;
    // Skills & Powers: valid group proficiencies (warriors only) make their weapons proficient (no slot for the weapon).
    const groupKeys = sp && this.classGroup === "warrior"
      ? items.filter(i => i.system.kind === "group" && SP.groups[i.system.spGroup]).map(i => i.system.spGroup) : [];
    const covered = id => groupKeys.some(k => SP.groups[k].ids.includes(id));
    const spProf = spProficienciesOn();
    const scores = Object.fromEntries(AD2E.abilities.map(k => [k, this.abilities[k].total]));
    const styleItems = items.filter(i => i.system.kind === "style").sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0) || String(a.id).localeCompare(String(b.id)));
    const shieldAllowed = AD2E.classTables?.classArmor?.[classId]?.shield !== "none";
    // Weapon Master (owner's ruling): the chosen weapon (specialization, else expertise) is the weapon of choice at no cost.
    const weaponMaster = !!kitSpecial(this.parent).weaponType;
    const entries = items.map(item => {
      const p = item.system;
      const crossGroup = p.kind === "nonweapon" && p.groups.size > 0 && ![...p.groups].some(g => groups.includes(g));
      const isFree = p.kind === "weapon" && free.has(p.identifier);
      // Extra nonweapon slots: +1 each (Nonweapon Proficiencies II (PHB)).
      const extra = p.kind === "nonweapon" ? (p.extraSlots ?? 0) : 0;
      const kitProf = this.kitMods.total("proficiency", p.identifier);
      let target = p.ability ? this.abilities[p.ability].total + (p.modifier ?? 0) + extra + kitProf : null;
      // Skills & Powers ratings (world setting): Table 45 rating + extra slots (max 16) + Table 44 ability modifier.
      const spr = spProf && p.kind === "nonweapon" ? spRating({ identifier: p.identifier, rating: p.sp?.rating ?? null,
        abilityText: p.sp?.ability ?? "", group: this.classGroup, extra, scores }) : null;
      if (spr) target = spr.target + kitProf;
      const entry = { item, cost: 0, crossGroup, target, extra, spRating: spr, invalid: [], parts: [], spOff: false };
      if (sp && p.kind !== "nonweapon") {
        const res = spCost(p, { group: this.classGroup, classId, level: this.level, covered: p.kind === "weapon" && covered(p.identifier),
          free: isFree, forbidden: kitSpec.mode === "forbidden", extraSpec: p.specialized && !isFree && specializedCount > 1,
          styleIndex: styleItems.indexOf(item), shieldAllowed, choiceFree: weaponMaster });
        Object.assign(entry, { cost: res.slots, invalid: res.invalid, parts: res.parts });
        if (p.kind === "weapon") {
          entry.covered = covered(p.identifier);
          entry.specialized = p.specialized || isFree;
          entry.specFree = isFree;
          entry.specValid = res.specValid;
          entry.specInvalid = p.specialized && !isFree && !res.specValid;
          entry.mastery = res.masteryValid;
          entry.masteryValid = res.masteryValid;
          entry.masteryInvalid = !!p.mastery && !res.masteryValid;
          entry.choice = !weaponMaster && !!p.choice;
          entry.expertise = !!p.expertise;
          entry.attack = this.#weaponAttack(p.weapon, { specialized: res.specValid, expertise: entry.expertise,
            mastery: res.masteryValid, choice: entry.choice, sp: true });
        }
        return entry;
      }
      if (!["weapon", "nonweapon"].includes(p.kind)) {
        // Skills & Powers kinds without the world setting: no cost, no effect.
        entry.spOff = true;
        return entry;
      }
      // Specialization: one extra slot (melee weapons, crossbows), two for bows (Weapon Specialization (PHB)).
      const specCost = (p.kind === "weapon" && p.specialized && !isFree) ? AD2E.specialization.extraSlots[p.weapon?.family ?? "other"] : 0;
      entry.cost = p.grantedBy ? specCost + extra : (p.kind === "weapon" ? 1 + specCost : p.slots + (crossGroup ? 1 : 0) + extra);
      if (p.kind === "weapon") {
        // A kit's free specialization applies on its own (no tick box needed).
        entry.specialized = p.specialized || isFree;
        entry.specFree = isFree;
        // Fighters only (or a kit exception), and a single weapon ("choose a single weapon and specialize in its use");
        // a kit's free specialization is always valid and does not count.
        entry.specInvalid = p.specialized && !isFree && (!canSpecialize || specializedCount > 1);
        entry.specValid = isFree || (p.specialized && canSpecialize);
        entry.attack = this.#weaponAttack(p.weapon, entry.specValid);
      }
      return entry;
    });
    const weaponKinds = AD2E.weaponSlotKinds;
    const used = kinds => entries.filter(e => kinds.includes(e.item.system.kind)).reduce((n, e) => n + e.cost, 0);
    // Dual-class (module/dual-class.mjs; implementation choice): the larger of each earlier class's slots at its last
    // level and the current class's, since the old proficiencies are kept.
    const slotsAt = (r, level) => ({ weapon: r.weaponInitial + Math.floor(level / r.weaponRate),
      nonweapon: r.nonweaponInitial + Math.floor(level / r.nonweaponRate) });
    const base = slotsAt(rules, this.level);
    // Multi-class: "the largest number of proficiency slots of the different classes" at the start and new slots "at the
    // fastest of the given rates" (module/multi-class.mjs multiSlots, each class at its own level).
    if (this.multi) {
      const rs = this.multi.classes.map(c => ({ r: AD2E.proficiencySlots[c.group], level: c.level })).filter(x => x.r);
      base.weapon = multiSlots(rs.map(x => ({ initial: x.r.weaponInitial, rate: x.r.weaponRate, level: x.level })));
      base.nonweapon = multiSlots(rs.map(x => ({ initial: x.r.nonweaponInitial, rate: x.r.nonweaponRate, level: x.level })));
    }
    for (const p of this.dual?.previous ?? []) {
      const r = AD2E.proficiencySlots[p.group];
      if (!r) continue;
      const o = slotsAt(r, p.level);
      base.weapon = Math.max(base.weapon, o.weapon);
      base.nonweapon = Math.max(base.nonweapon, o.nonweapon);
    }
    const available = {
      weapon: base.weapon + (kit?.bonusSlots.weapon ?? 0),
      nonweapon: base.nonweapon + (this.abilityData.int.languages ?? 0) + (kit?.bonusSlots.nonweapon ?? 0)
    };
    // Skills & Powers effects of the valid purchases.
    const valid = kind => sp ? entries.filter(e => e.item.system.kind === kind && !e.invalid.length) : [];
    const styles = new Map(valid("style").map(e => [e.item.system.style, e.item.system]));
    const spInfo = sp ? {
      known: { weapons: entries.filter(e => e.item.system.kind === "weapon").map(e => e.item.system.identifier), groups: groupKeys },
      penalty: nonproficiency(this.classGroup),
      styles: {
        oneHanded: styles.has("one-handed"), oneHandedImproved: !!styles.get("one-handed")?.improved,
        weaponShield: styles.has("weapon-shield"), twoHanded: styles.has("two-handed"),
        twoWeapon: styles.has("two-weapon"), twoWeaponImproved: !!styles.get("two-weapon")?.improved,
        missile: styles.has("missile"), horseArchery: styles.has("horse-archery"), thrown: styles.has("thrown"),
        special: styles.has("special")
      },
      armor: valid("armor").map(e => e.item.system.armorType),
      shields: valid("shield").map(e => e.item.system.shieldType)
    } : null;
    return {
      groups,
      canSpecialize,
      sp: spInfo,
      spRatings: spProf,
      specRule: { mode: kitSpec.mode ?? "", free: [...free],
        missing: kitSpec.mode === "required" && specializedCount === 0 },
      // Multi-class: the smallest non-proficiency penalty of the classes (the most beneficial Table 34 line).
      penalty: sp ? spInfo.penalty.nonproficient
        : (this.multi ? Math.max(...this.multi.classes.map(c => AD2E.proficiencySlots[c.group]?.penalty ?? -Infinity)) : rules.penalty),
      entries,
      // Weapon Master (module/kit-features.mjs): the chosen weapon (specialization or expertise) and proficiencies of
      // another type (a warning).
      weaponType: (() => {
        if (!weaponMaster) return null;
        const res = weaponTypeConflicts(entries.filter(e => e.item.system.kind === "weapon").map(e => ({
          identifier: e.item.system.identifier, type: e.item.system.weapon?.type ?? "", melee: !!e.item.system.weapon?.melee,
          specialized: !!e.specValid, expertise: !!e.expertise && !(e.invalid ?? []).length })));
        const chosen = entries.find(e => e.item.system.kind === "weapon" && e.item.system.identifier === res.choice);
        res.name = chosen?.item.name ?? "";
        // Skills & Powers: the chosen weapon is the weapon of choice (+1 to hit), free for the kit.
        if (chosen && sp) {
          chosen.choice = true;
          chosen.attack = this.#weaponAttack(chosen.item.system.weapon, { specialized: !!chosen.specValid, expertise: !!chosen.expertise,
            mastery: !!chosen.masteryValid, choice: true, sp: true });
        }
        for (const e of entries) e.typeConflict = res.conflicts.includes(e.item.system.identifier);
        return res;
      })(),
      weapon: { available: available.weapon, used: used(weaponKinds) },
      nonweapon: { available: available.nonweapon, used: used(["nonweapon"]) }
    };
  }

  /**
   * Attack and damage adjustments and attacks per round for a weapon proficiency, per use (melee, missile).
   * Melee: Strength hit/damage, specialization +1 hit / +2 damage; Table 15 (warriors) or Table 35 (specialists).
   * Missile: Dexterity missile adjustment plus Strength as `weapon.strength` allows (bows: penalties only;
   * crossbows: none); rate of fire from Table 45, or Table 35 for non-bow specialists (bow specialists gain no
   * extra attacks); bow/crossbow specialists gain the point-blank range (+2 to hit); a thrown melee weapon keeps
   * the specialization +1 hit / +2 damage. Damage never below 1.
   * `skill`: true/false (specialized), or Skills & Powers { specialized, expertise, mastery, choice, sp }: weapon of
   * choice +1 hit; expertise: the specialist attacks per round; mastery: melee +3 hit / +3 damage, missile +2 hit (and
   * at point blank +3 hit / +3 damage); missile specialization +1 hit at all ranges and +2 damage at point blank
   * (Weapon Specialization and Mastery (POSP)).
   */
  #weaponAttack(w, skill, extra = { hit: 0, dmg: 0 }) {
    const s = typeof skill === "object" && skill ? skill : { specialized: !!skill };
    const specialized = !!s.specialized;
    const extraAttacks = specialized || !!s.expertise;
    const mastery = !!(s.sp && s.mastery && specialized);
    const choiceHit = s.sp && s.choice ? SP.choiceHit : 0;
    const { dmg, missile: dexMissile, encumbranceHit } = this.mods;
    // Encumbrance attack penalty (Encumbrance (PHB)) applies to every attack roll.
    const kitHit = this.kitMods?.total("attack") ?? 0;
    const kitDmg = this.kitMods?.total("damage") ?? 0;
    const heat = this.mods.heat ?? 0; // Al-Qadim heat penalty (aq-rules.mjs)
    const march = this.mods.march ?? 0; // force marching (module/travel.mjs)
    const hit = this.mods.hit + encumbranceHit + heat + march + kitHit;
    const missile = dexMissile + encumbranceHit + heat + march + kitHit;
    const spec = AD2E.specialization;
    const out = { melee: null, missile: null };
    if (w.melee) {
      const table = extraAttacks ? AD2E.specialistAttacks.melee
        : (this.classGroup === "warrior" ? AD2E.warriorAttacks : null);
      out.melee = {
        hit: hit + (mastery ? SP.masteryBonus.meleeHit : (specialized ? spec.meleeHit : 0)) + choiceHit + extra.hit,
        dmg: dmg + kitDmg + (mastery ? SP.masteryBonus.meleeDamage : (specialized ? spec.meleeDamage : 0)) + extra.dmg,
        rate: table ? formatRate(attackRate(table, this.level)) : "1",
        rateRaw: table ? attackRate(table, this.level) : [1, 1]
      };
    }
    if (w.missile) {
      // Strength alone (encumbrance, heat and kit modifiers are already in `missile`).
      const strOnly = this.mods.hit;
      let strHit = { full: strOnly, penalty: Math.min(strOnly, 0) }[w.strength] ?? 0;
      let strDmg = { full: dmg, damage: dmg, penalty: Math.min(dmg, 0) }[w.strength] ?? 0;
      // A bow made for a Strength gives the user's Strength bonuses up to that rating; penalties always apply
      // ("bows must be specially made to gain the bonus", Strength (PHB); "the attack roll and damage Strength
      // modifiers apply only if the character has a properly prepared bow", Missile Weapons in Combat (PHB)).
      let bowNote = null;
      const bowRow = w.strength === "penalty" ? bowStrengthRow(extra.bowStrength) : null;
      if (bowRow) {
        strHit = strOnly < 0 ? strOnly : Math.min(strOnly, bowRow.hit);
        strDmg = dmg < 0 ? dmg : Math.min(dmg, bowRow.dmg);
        // Exceptional-Strength bows: a bend bars/lift gates roll to string or use one without exceptional Strength.
        const exceptionalBow = /\//.test(extra.bowStrength) || Number(extra.bowStrength) > 18;
        const a = this.abilities.str;
        const exceptionalUser = a.total > 18 || (a.total === 18 && a.exceptional > 0);
        if (exceptionalBow && !exceptionalUser) bowNote = this.abilityData.str.bendBars ?? 0;
      }
      const column = extraAttacks && w.family !== "bow" ? AD2E.specialistAttacks[w.missileColumn] : null;
      // A thrown melee weapon keeps the melee specialization bonus: "+1 bonus to all his attack rolls with that
      // weapon and a +2 bonus to all damage rolls" (Weapon Specialization (PHB) rev 158222); "When using his
      // special weapon, the character gets a +1 to attack rolls and +2 to damage" (Weapon Proficiency Slots (CFH)).
      const thrownSpec = specialized && w.melee;
      // Skills & Powers: "+1 attack bonus at all range categories"; mastery "+2 at all ranges beyond point blank".
      const specHit = mastery ? SP.masteryBonus.missileHit : (thrownSpec ? spec.meleeHit : (s.sp && specialized ? SP.missileSpec.hit : 0));
      const pointBlank = specialized && w.family !== "other";
      out.missile = {
        hit: missile + strHit + specHit + choiceHit + extra.hit,
        dmg: strDmg + kitDmg + (thrownSpec ? spec.meleeDamage : 0) + extra.dmg,
        rate: column ? formatRate(attackRate(column, this.level)) : (w.range.rof || "1"),
        pointBlank,
        // Point blank extras (Skills & Powers): specialists +2 damage; masters +3 hit / +3 damage in place of the +2.
        pointBlankHit: pointBlank && mastery ? SP.masteryBonus.pointBlankHit - SP.masteryBonus.missileHit : 0,
        pointBlankDmg: pointBlank && s.sp ? (mastery ? SP.masteryBonus.pointBlankDamage : SP.missileSpec.pointBlankDamage) : 0,
        bowStrength: bowRow ? extra.bowStrength : "",
        bowBendBars: bowNote,
        range: w.range
      };
    }
    return out;
  }

  /**
   * Owned weapon items, linked to the weapon proficiency with the same identifier (`system.proficiency`).
   * Not proficient: Table 34 non-proficiency penalty to the attack roll. Specialized (on the proficiency,
   * fighters only): the specialization bonuses and attacks per round. Magical `bonus` adds to hit and damage.
   */
  #computeWeapons() {
    const p = this.proficiencies;
    const profEntries = p.entries.filter(e => e.item.system.kind === "weapon");
    const items = this.parent?.items?.filter(i => i.type === "weapon") ?? [];
    // Size from the race (weapon size, Weapons (PHB)); a weapon one size larger needs two hands.
    const size = this.sizeCategory ?? "M";
    const oneHanded = i => !!i.system.weapon?.melee && !needsTwoHands(i.system.weapon, size);
    // Two weapons in hand (warriors and rogues): one more attack per round with the second weapon.
    const inHand = items.filter(i => i.system.equipped && !i.system.dropped && oneHanded(i));
    // Skills & Powers: the two weapon style lets any class fight with two weapons.
    const twoReady = (canFightTwoWeapons(this.classGroup) || !!p.sp?.styles.twoWeapon) && inHand.length >= 2;
    // Class weapon limits (weaponRestriction): the current class, or every class of a multi-class character.
    // A fitting kit's or the class item's own weapon list replaces the class's (specialty priests, owner's ruling).
    const kit = this.classInfo.kitFits ? this.classInfo.kitItem?.system : null;
    const withAllowed = (identifier, group, item) => ({ identifier, group,
      allowed: (kit?.classes?.has(identifier) && kit.allowedWeapons?.length ? kit.allowedWeapons : item?.system.allowedWeapons) ?? [] });
    const weaponClasses = this.multi ? this.multi.classes.map(c => withAllowed(c.identifier, c.group, c.item))
      : (this.classInfo.classItem ? [withAllowed(this.classInfo.classItem.system.identifier, this.classInfo.classItem.system.group, this.classInfo.classItem)] : []);
    return items.map(item => {
      const w = item.system;
      const prof = profEntries.find(e => e.item.system.identifier === w.proficiency) ?? null;
      const specialized = !!prof?.specValid;
      // Skills & Powers: proficient through a group proficiency; familiar weapons take the Table 50 familiarity penalty.
      const status = p.sp ? weaponFamiliarity(w.proficiency, p.sp.known) : (prof ? "proficient" : null);
      const penalty = status === "proficient" ? 0 : (status === "familiar" ? p.sp.penalty.familiar : p.penalty);
      const skill = p.sp ? { specialized, expertise: !!prof?.expertise, mastery: !!prof?.masteryValid, choice: !!prof?.choice, sp: true }
        : specialized;
      const attack = this.#weaponAttack(w.weapon, skill, { hit: w.bonus.hit + penalty, dmg: w.bonus.dmg,
        bowStrength: w.bowStrength ?? "" });
      if (twoReady && attack.melee && inHand.includes(item)) attack.melee.rateTwo = formatRate(twoWeaponRate(attack.melee.rateRaw));
      return { item, proficient: status === "proficient", familiar: status === "familiar", proficiency: prof?.item ?? null,
        specialized, mastery: !!prof?.masteryValid, choice: !!prof?.choice, expertise: !!prof?.expertise, penalty,
        twoHanded: !!w.weapon?.melee && !oneHanded(item), attack, restriction: weaponRestriction(weaponClasses, item) };
    });
  }

  /**
   * Skills & Powers fighting style AC (module/sp-weapons.mjs styleAc): one-handed weapon style (one one-handed weapon in
   * hand, nothing in the other) and weapon and shield style (a shield and a melee weapon). Front AC only: both are
   * melee techniques of a character facing the attacker.
   */
  #applyStyleAc() {
    const styles = this.proficiencies.sp?.styles;
    this.armor.styleAc = 0;
    this.armor.styleNotes = [];
    if (!styles) return;
    const held = this.weapons.filter(w => w.item.system.equipped && !w.item.system.dropped);
    const res = styleAc({ oneHanded: styles.oneHanded, improved: styles.oneHandedImproved, weaponShield: styles.weaponShield },
      { weapons: held.length, oneHandedWeapons: held.filter(w => w.item.system.weapon?.melee && !w.twoHanded).length,
        shield: !!this.armor.shield });
    this.armor.styleAc = res.ac;
    this.armor.styleNotes = res.notes;
    this.armor.front -= res.ac;
    this.ac.total = this.armor.front;
  }

  /**
   * Spell slots by spell level from the class's progression table at the character's level (PHB Tables 21, 24, 17,
   * 32). Wizards and bards: no slots above the Intelligence maximum spell level (Table 4); specialists gain one
   * additional spell per spell level, "provided the additional spell is taken in the specialist's school" (Specialist
   * Wizard (PHB)). Clerics and druids: Wisdom bonus spells, "cumulative" and "available only when the priest is entitled
   * to spells of the appropriate level" (Wisdom (PHB)); 6th-level spells need Wisdom 17, 7th 18 (Table 24).
   * Paladins and rangers get no Wisdom bonus spells. Owned spell items are grouped by level with their memorized counts.
   */
  #computeSpells() {
    const kitItem = this.classInfo.kitItem;
    const kitFor = id => (this.classInfo.kitFits && kitItem?.system.classes?.has(id) ? kitItem : null);
    const kindOf = id => (AD2E.casterTables[id] ? AD2E.casterKinds[AD2E.casterTables[id]] : null);
    const mainId = this.classInfo.classItem?.system.identifier;
    const main = this.#spellsFor(this.classInfo.classItem?.system, this.level, { kitItem: this.multi ? kitFor(mainId) : kitItem });
    // Another class casting another kind of spells keeps its own slots and casting level:
    //  - dual-class: an earlier class at its last level, marked `old` (module/dual-class.mjs);
    //  - multi-class: the other classes at their own levels (module/multi-class.mjs); a fighter/mage casts as a mage.
    // Their spell levels follow the main class's. Of several classes casting the same kind, the higher level counts.
    const extras = [];
    const add = (x) => {
      if (!x.kind || x.kind === main.kind) return;
      const same = extras.findIndex(e => e.kind === x.kind);
      if (same < 0) extras.push(x);
      else if (x.level > extras[same].level) extras[same] = x;
    };
    for (const c of this.multi?.others ?? []) add({ identifier: c.identifier, school: c.school, level: c.level, name: c.name, kind: kindOf(c.identifier), old: false, kit: kitFor(c.identifier) });
    for (const p of this.dual?.previous ?? []) add({ identifier: p.identifier, school: p.school, level: p.level, name: p.name, kind: kindOf(p.identifier), old: true, kit: null });
    if (!extras.length) return main;
    const others = extras.map(x => ({ x, s: this.#spellsFor({ identifier: x.identifier, school: x.school }, x.level, { kitItem: x.kit, kindOnly: x.kind }) }));
    const otherKinds = others.map(o => o.s.kind);
    const mainLevels = main.kind ? main.levels.map(l => ({ ...l, kind: main.kind, spells: l.spells.filter(i => !otherKinds.includes(i.system.kind)) }))
      .filter(l => l.slots > 0 || l.spells.length) : [];
    const extraLevels = others.flatMap(({ x, s }) => s.levels.map(l => ({ ...l, kind: s.kind, old: x.old, oldClass: x.name,
      castingLevel: s.castingLevel })));
    const old = others.find(o => o.x.old);
    // `castingLevels`: casting level by spell kind; a class without spells of its own (a fighter/mage's fighter) leaves
    // the kind, table and casting level to the other class.
    const first = main.kind ? main : others[0].s;
    const castingLevels = Object.fromEntries([...others.map(o => [o.s.kind, o.s.castingLevel]), ...(main.kind ? [[main.kind, main.castingLevel]] : [])]);
    return { ...main, kind: first.kind, table: first.table, castingLevel: first.castingLevel, castingLevels,
      shair: main.shair || others.some(o => o.s.shair),
      levels: [...mainLevels, ...extraLevels], available: true,
      old: old ? { kind: old.s.kind, table: old.s.table, castingLevel: old.s.castingLevel, className: old.x.name } : null,
      extra: others.map(({ x, s }) => ({ kind: s.kind, table: s.table, castingLevel: s.castingLevel, className: x.name, old: x.old })) };
  }

  #spellsFor(cls, level, { kitItem = null, kindOnly = null } = {}) {
    const table = AD2E.casterTables[cls?.identifier] ?? null;
    const kind = table ? AD2E.casterKinds[table] : null;
    // Sha'ir: no memorized spells; the gen fetches each one (module/shair.mjs).
    const shair = kind === "wizard" && isShairKit(kitItem);
    const rows = table ? AD2E.spellProgression[table] : null;
    const levels = rows ? Object.keys(rows).map(Number) : [];
    const rowLevel = levels.length ? Math.min(level, Math.max(...levels)) : null;
    const row = rows?.[rowLevel] ?? null;
    const base = row ? [...row.slots] : [];
    const bonus = base.map(() => 0);
    const school = base.map(() => 0);
    if (kind === "wizard") {
      const max = this.abilityData.int.maxSpellLevel ?? 0;
      base.forEach((n, i) => { if (i + 1 > max) base[i] = 0; });
      if (table === "wizard" && cls?.school) base.forEach((n, i) => { if (n > 0) school[i] = 1; });
    }
    if (table === "priest") {
      const wis = this.abilities.wis.total;
      for (const r of AD2E.abilityTables.wis) {
        if (r.min > wis) break;
        for (const l of r.bonusSpells ?? []) if (base[l - 1] > 0) bonus[l - 1]++;
      }
      for (const [l, need] of Object.entries(AD2E.priestWisdomLevels)) {
        if (wis < need) { base[l - 1] = 0; bonus[l - 1] = 0; }
      }
    }
    if (shair) { base.fill(0); bonus.fill(0); school.fill(0); }
    const owned = (this.parent?.items?.filter(i => i.type === "spell" && (!kindOnly || i.system.kind === kindOnly)) ?? []);
    const maxKnown = this.abilityData.int.maxSpells;
    const byLevel = new Map();
    const count = Math.max(base.length, ...owned.map(i => i.system.level), 0);
    for (let l = kind === null ? 0 : 1; l <= count; l++) byLevel.set(l, []);
    for (const i of owned) {
      if (!byLevel.has(i.system.level)) byLevel.set(i.system.level, []);
      byLevel.get(i.system.level).push(i);
    }
    const out = [...byLevel.entries()].sort((a, b) => a[0] - b[0]).map(([level, spells]) => {
      // Spells found but not (yet) understood are not known and cannot be memorized (module/learn-spells.mjs).
      const usable = shair ? spells : spells.filter(i => i.system.kind === kind && i.system.learned !== false);
      const slots = level >= 1 ? (base[level - 1] ?? 0) + (bonus[level - 1] ?? 0) + (school[level - 1] ?? 0) : 0;
      const prepared = usable.reduce((n, i) => n + i.system.prepared, 0);
      const remaining = usable.reduce((n, i) => n + Math.max(i.system.prepared - i.system.cast, 0), 0);
      return { level, spells, slots, base: base[level - 1] ?? 0, bonus: bonus[level - 1] ?? 0, school: school[level - 1] ?? 0,
        prepared, remaining, known: usable.length, maxKnown: kind === "wizard" && !shair ? maxKnown : null, over: !shair && prepared > slots };
    }).filter(l => l.slots > 0 || l.spells.length);
    // Whether the character has spells: slots at its level, a sha'ir's gen, or owned spell items (the Spells tab).
    return { table, kind, shair, castingLevel: row?.casting ?? null, levels: out, available: shair || out.length > 0 };
  }

  /**
   * Class abilities (generated tables, see config.mjs AD2E.skillClasses):
   *  - Thief skills: Table 26 base + Table 27 race + Table 28 Dexterity (pick pockets, open locks, find/remove traps,
   *    move silently, hide in shadows) + Table 29 armour + kit adjustment + discretionary points, at most 95 for
   *    thieves ("no skill can be raised above 95 percent, including all adjustments", Thief (PHB)). Points: 60 at
   *    1st level (at most 30 on one skill), +30 per level (at most 15 on one skill per level). A skill below 1% after
   *    adjustments cannot be used until points raise it to at least 1% (`belowOne`).
   *  - Bard abilities: Table 33 base + race + Dexterity + armour + kit + points (20 at 1st level, +15 per level).
   *  - Ranger hide in shadows / move silently: Table 18 by level + race + Dexterity; only in studded leather or
   *    lighter armour (Ranger (PHB)); halved outside natural surroundings (shown, not applied).
   *  - Backstab multiplier (Table 30) for thieves; turning undead level (Table 61) for clerics, and paladins from
   *    3rd level as a cleric two levels lower; paladin lay on hands (2 hp per level, once a day) and cure disease
   *    (once a week per 5 levels); ranger tracking bonus (+1 per 3 levels).
   */
  #computeClassAbilities() {
    const kit = this.classInfo.kitFits ? this.classInfo.kitItem.system : null;
    const out = this.#classAbilitiesFor(this.classInfo.classItem?.system.identifier ?? null, this.level, kit);
    out.old = {};
    // Dual-class: abilities of an earlier class that the current one lacks stay available at that class's last level
    // (marked `old`: using them while restricted costs experience, module/dual-class.mjs).
    // Multi-class: the other classes' abilities at their own levels, with the kit if it is open to that class
    // (module/multi-class.mjs).
    const multi = !!this.multi;
    const extras = [
      ...(this.dual?.previous ?? []).map(p => ({ id: p.identifier, level: p.level, kit: null, old: p.name })),
      ...(this.multi?.others ?? []).map(c => ({ id: c.identifier, level: c.level, kit: kit?.classes?.has(c.identifier) ? kit : null, old: null }))
    ];
    if (multi) out.armorLimited = out.armorBlocked && this.#multiThiefLimit(out);
    for (const x of extras) {
      const prev = this.#classAbilitiesFor(x.id, x.level, x.kit);
      if (multi) prev.armorLimited = prev.armorBlocked && this.#multiThiefLimit(prev);
      if (!out.skills.length && prev.skills.length) {
        Object.assign(out, { skills: prev.skills, budget: prev.budget, perSkillMax: prev.perSkillMax, armorColumn: prev.armorColumn,
          armorBlocked: prev.armorBlocked, armorLimited: prev.armorLimited, skillClassId: prev.classId });
        if (x.old) out.old.skills = x.old;
      }
      for (const key of ["backstab", "turnLevel", "layOnHands", "cureDisease", "tracking"]) {
        if ((out[key] === null || out[key] === undefined) && prev[key] !== null && prev[key] !== undefined) {
          out[key] = prev[key];
          if (x.old) out.old[key] = x.old;
        }
      }
    }
    return out;
  }

  /**
   * Multi-class thieves (and bards) in armour not allowed to thieves: "cannot use any thieving abilities other than open
   * locks or detect noise" (Multi-Class and Dual-Class Characters (PHB)). Table 29 has no column for such armour, so
   * those two skills take no armour adjustment. Returns whether the limit applied.
   */
  #multiThiefLimit(info) {
    if (!info.skills.length || info.armorColumn !== "heavy") return false;
    for (const s of info.skills) s.available = ["ol", "dn"].includes(s.key) && !s.belowOne;
    return true;
  }

  #classAbilitiesFor(id, level, kit) {
    const T = AD2E.classTables;
    const def = AD2E.skillClasses[id] ?? null;
    const out = { classId: id, skills: [], budget: null, perSkillMax: null, armorColumn: null, armorBlocked: false,
      backstab: null, turnLevel: null, layOnHands: null, cureDisease: null, tracking: null };
    if (def) {
      const raceId = this.raceInfo.raceItem?.system.identifier ?? null;
      const dex = Math.min(Math.max(this.abilities.dex.total, 9), 19);
      const dexRow = T.thief.dex.find(r => dex >= r.min && dex <= r.max) ?? {};
      const body = this.armor.body;
      let armorAdj = () => 0;
      if (def.armor) {
        const column = thiefArmorColumn(body?.name);
        out.armorColumn = column;
        out.armorBlocked = column === "heavy";
        armorAdj = k => T.thief.armor[k]?.[column] ?? 0;
      } else {
        // Ranger: studded leather (AC 7) or lighter.
        out.armorBlocked = !!body && (body.system.ac ?? 10) < 7;
      }
      const rangerRow = id === "ranger" ? T.ranger.find(r => r.level === Math.min(level, T.ranger.at(-1).level)) : null;
      const points = this.classAbilities.points;
      for (const key of def.skills) {
        const base = def.base === "thief" ? T.thief.base[key] : (def.base === "bard" ? T.bard[key] : rangerRow?.[key] ?? 0);
        const race = T.thief.race[key]?.[raceId] ?? 0;
        const dexAdj = dexRow[key] ?? 0;
        const armor = armorAdj(key);
        const kitAdj = (kit?.skillAdjust?.[key] ?? 0) + this.kitMods.total("skill", key);
        const pts = def.points ? (points[key] ?? 0) : 0;
        let total = base + race + dexAdj + armor + kitAdj + pts;
        const capped = def.cap !== null && total > def.cap;
        if (capped) total = def.cap;
        // "after adjustments, they have negative scores ... the character must spend points raising his skill
        // percentage to at least 1% before he can use the skill" (Thief (PHB)).
        const belowOne = total < 1;
        out.skills.push({ key, base, race, dex: dexAdj, armor, kit: kitAdj, points: pts, total, capped, belowOne,
          available: !out.armorBlocked && !belowOne });
      }
      if (def.points) {
        const kitPoints = id === "thief" ? kit?.skillPoints : null;
        // Bards: a kit's 1st-level points only (Barber: 10; "additional percentage points are gained as usual").
        const first = (id === "bard" ? kit?.skillPoints?.bardFirst : kitPoints?.first) ?? def.points[0];
        const per = kitPoints?.perLevel ?? def.points[1];
        const used = def.skills.reduce((n, k) => n + (points[k] ?? 0), 0);
        out.budget = { total: first + per * (level - 1), used };
        out.budget.over = used > out.budget.total;
        if (id === "thief") {
          out.perSkillMax = AD2E.thiefPointLimits.first + AD2E.thiefPointLimits.perLevel * (level - 1);
          for (const s of out.skills) s.overLimit = s.points > out.perSkillMax;
        }
      }
    }
    if (id === "thief") out.backstab = T.backstab.find(r => level >= r.min && level <= r.max)?.multiplier ?? null;
    const turn = AD2E.turnUndead[id];
    if (turn && level >= turn.from) out.turnLevel = level + turn.offset;
    if (id === "paladin") {
      out.layOnHands = { hp: 2 * level, used: this.classAbilities.layOnHandsUsed };
      out.cureDisease = Math.ceil(level / 5);
    }
    if (id === "ranger") out.tracking = Math.floor(level / 3);
    return out;
  }

  getRollData() {
    // Token-level applyActiveEffects() can also request roll data early; never assume preparation order.
    if (!this.mods) this.#computeDerived();
    return {
      abilities: Object.fromEntries(AD2E.abilities.map(k => [k, this.abilities[k].total])),
      level: this.level,
      thac0: this.thac0.value,
      // Initiative is 1d10 + @init, lowest first: a kit's initiative bonus lowers the roll.
      init: this.initiative.mod - (this.kitMods?.total("initiative") ?? 0),
      hit: this.mods.hit + (this.mods.encumbranceHit ?? 0) + (this.mods.heat ?? 0) + (this.mods.march ?? 0),
      dmg: this.mods.dmg,
      missile: this.mods.missile + (this.mods.encumbranceHit ?? 0) + (this.mods.heat ?? 0) + (this.mods.march ?? 0),
      move: this.encumbrance.info?.rate ?? null
    };
  }
}
