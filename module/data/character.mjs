import { AD2E, attackRate, conSaveBonus, formatRate, hitDiceAt, kitArmorMatches, kitKeyMatches, kitModifierValue, lookup, strengthKey,
  thac0At, thiefArmorColumn } from "../config.mjs";

const { BooleanField, SchemaField, NumberField, StringField, HTMLField } = foundry.data.fields;

const int = (initial, min = null, max = null) =>
  new NumberField({ required: true, integer: true, initial, min, max, nullable: false });

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
      hp: new SchemaField({ value: int(1), max: int(1) }),
      ac: new SchemaField({ base: int(10, -10, 10) }),
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
    // Class next: the class item sets the group used below (warrior CON bonus, THAC0).
    this.classInfo = this.#computeClassInfo();
    if (this.classInfo.classItem) this.classGroup = this.classInfo.classItem.system.group;
    // Kit ability score bonuses (e.g. Pacifist priest Charisma +2, at most 18) count after the kit's requirements.
    for (const mod of this.#kitModifierList()) {
      if (mod.target !== "score" || !this.abilities[mod.key]) continue;
      const v = kitModifierValue(mod, this.level) ?? 0;
      const ab = this.abilities[mod.key];
      ab.total = mod.max !== null && mod.max !== undefined ? Math.max(ab.total, Math.min(ab.total + v, mod.max)) : ab.total + v;
    }

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

    this.armor = this.#computeArmor(dex.ac);
    this.kitMods = this.#computeKitModifiers();
    const kitAc = this.kitMods.total("ac");
    for (const k of ["front", "missile", "rear"]) this.armor[k] -= kitAc;
    this.encumbrance.info = this.#computeEncumbrance();
    const { hit: encHit, ac: encAc } = this.encumbrance.info.penalty;
    for (const k of ["front", "missile", "rear"]) this.armor[k] += encAc;
    this.ac.total = this.armor.front;
    this.mods.encumbranceHit = encHit;
    this.mods.meleeAttack = this.mods.hit + encHit + this.kitMods.total("attack");
    this.mods.missileAttack = this.mods.missile + encHit + this.kitMods.total("attack");

    const saveRow = lookup(AD2E.saveTable[this.classGroup], this.level);
    // Racial CON bonus (PHB Table 9) is a roll bonus vs. rod/staff/wand and spells; the poison
    // bonus only applies to poison, so it is shown on the par save but not added to it.
    const raceCon = this.raceInfo.race?.conSaves ? conSaveBonus(a.con.total) : 0;
    this.raceInfo.conSaveBonus = raceCon;
    this.raceInfo.poisonBonus = this.raceInfo.race?.conPoison ? raceCon : 0;
    // Paladins: "+2 bonus to all saving throws" (Paladin (PHB)); a roll bonus like the racial one.
    const classSave = this.classInfo.classItem?.system.identifier === "paladin" ? AD2E.paladinSaveBonus : 0;
    this.classInfo.saveBonus = classSave;
    for (const key of AD2E.saves) {
      this.saves[key].table = saveRow[key];
      this.saves[key].value = this.saves[key].override ?? saveRow[key];
      this.saves[key].bonus = (["rsw", "sp"].includes(key) ? raceCon : 0) + classSave + this.kitMods.total("save", key);
    }

    const hd = hitDiceAt(this.classGroup, this.level);
    this.hitDice = { ...hd, label: hd.bonus ? `${hd.dice}d${hd.die}+${hd.bonus}` : `${hd.dice}d${hd.die}` };
    const xp = AD2E.xpTable[this.classInfo.classItem?.system.identifier];
    this.xpNext = xp?.[this.level] ?? null; // index = level -> XP for level + 1
    // Hierophant druids: XP for the starred levels counts from the restart at 16th level (Table 23 footnote).
    const restart = AD2E.xpRestart[this.classInfo.classItem?.system.identifier];
    this.xpRestart = !!(restart && this.xpNext !== null && this.level + 1 >= restart);

    this.proficiencies = this.#computeProficiencies();
    this.weapons = this.#computeWeapons();
    this.spells = this.#computeSpells();
    this.classAbilities.info = this.#computeClassAbilities();

    const computed = thac0At(this.classGroup, this.level);
    this.thac0.computed = computed;
    this.thac0.value = this.thac0.override ?? computed;
  }

  /**
   * Class and kit come from owned Items (types "class" and "kit"); the class item, when
   * present, also sets the class group. A kit only counts if it is open to the class.
   */
  #computeClassInfo() {
    const items = this.parent?.items;
    const classItem = items?.find(i => i.type === "class") ?? null;
    const kitItem = items?.find(i => i.type === "kit") ?? null;
    const cls = classItem?.system ?? null;
    const race = this.raceInfo.race;
    const raceId = this.raceInfo.raceItem?.system.identifier;
    const classViaRace = !race || !cls || race.classes.has(cls.identifier);
    const classViaKit = !!(race && cls && race.kitClasses?.has(cls.identifier));
    const kitListsRace = !!(kitItem && raceId && kitItem.system.raceLimits && raceId in kitItem.system.raceLimits);
    // A kit fits if it is open to the class and, with a race: a race-only kit must list the race, and a
    // class the race only reaches through kits needs a kit that lists the race.
    const kitFits = !!(cls && kitItem && kitItem.system.classes.has(cls.identifier)
      && (!race || ((!kitItem.system.raceOnly || kitListsRace) && (classViaRace || kitListsRace))));
    const kit = kitFits ? kitItem.system : null;
    const requirements = AD2E.abilities.map(key => {
      const classMin = cls?.min[key] ?? null;
      const kitMin = kit ? (kit.min[key] ?? null) : null;
      const required = kitMin ?? classMin ?? 0;
      const score = this.abilities[key].total;
      return { key, classMin, kitMin, required, score, met: score >= required };
    });
    const prime = cls ? [...cls.prime] : [];
    const levelLimit = (kitFits && kitListsRace)
      ? (kitItem.system.raceLimits[raceId] ?? null)
      : ((cls && race?.levelLimits?.[cls.identifier]) ?? null);
    return {
      classItem,
      kitItem,
      kitFits,
      requirements,
      requirementsMet: requirements.every(r => r.met),
      alignmentAllowed: cls ? cls.alignments.has(this.alignment) : true,
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
    return this.classInfo?.kitFits ? (this.classInfo.kitItem.system.modifiers ?? []) : [];
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
      // Reaction and surprise rolls are the DM's; conditional AC changes are not rolled either.
      const dm = ["reaction", "surprise"].includes(mod.target) || (mod.target === "ac" && !!mod.condition);
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
    const equipped = this.parent?.items?.filter(i => i.type === "armor" && i.system.equipped) ?? [];
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
      extraShield: shields.length > 1
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
    const weightOf = i => (i.system.weight ?? 0) * (["weapon", "ammunition", "equipment"].includes(i.type) ? (i.system.quantity ?? 1) : 1);
    // Equipment counts while carried (animals, transport, services and lodging default to not carried).
    const gear = items.filter(i => ["weapon", "ammunition", "armor"].includes(i.type)
      || (i.type === "equipment" && i.system.carried));
    const itemWeight = gear.reduce((n, i) => n + weightOf(i), 0);
    const magicArmor = gear.filter(i => i.type === "armor" && i.system.equipped && i.system.bonus > 0)
      .reduce((n, i) => n + weightOf(i), 0);
    const coinItems = items.filter(i => i.type === "coin");
    const coinCount = coinItems.reduce((n, i) => n + i.system.quantity, 0)
      + AD2E.coins.reduce((n, c) => n + (this.currency?.[c] ?? 0), 0);
    const coinValue = coinItems.reduce((n, i) => n + i.system.quantity * i.system.value, 0)
      + AD2E.coins.reduce((n, c) => n + (this.currency?.[c] ?? 0) * AD2E.coinValues[c], 0);
    const coinWeight = Math.round(coinCount / AD2E.coinsPerPound * 10) / 10;
    const total = Math.round((itemWeight + coinWeight + this.encumbrance.other + AD2E.clothingWeight) * 10) / 10;
    const effective = Math.round((total - magicArmor) * 10) / 10;
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
    return { rule, total, effective, magicArmor, itemWeight: Math.round(itemWeight * 10) / 10, coinCount, coinWeight, coinValue, maxCarried: row47.maxCarried, limits: row47.limits,
      category: rule === "none" ? null : AD2E.encumbranceCategories[category], overMax, base, rate, penalty };
  }

  /**
   * Proficiency slots (PHB Table 34): initial + one per level evenly divisible by the rate, plus kit
   * bonus slots; nonweapon slots also add the Intelligence "number of languages" (Table 4). Owned
   * proficiency items use slots unless granted by a kit (`grantedBy`); a nonweapon proficiency from a
   * group outside the class's Table 38 groups costs one additional slot.
   */
  #computeProficiencies() {
    const rules = AD2E.proficiencySlots[this.classGroup];
    const kit = this.classInfo.kitFits ? this.classInfo.kitItem.system : null;
    const classId = this.classInfo.classItem?.system.identifier;
    const groups = AD2E.proficiencyGroups[classId] ?? AD2E.defaultProficiencyGroups[this.classGroup];
    const items = this.parent?.items?.filter(i => i.type === "proficiency") ?? [];
    const canSpecialize = AD2E.specialization.classes.includes(classId);
    const specializedCount = items.filter(i => i.system.kind === "weapon" && i.system.specialized).length;
    const entries = items.map(item => {
      const p = item.system;
      const crossGroup = p.kind === "nonweapon" && p.groups.size > 0 && ![...p.groups].some(g => groups.includes(g));
      // Specialization: one extra slot (melee weapons, crossbows), two for bows (Weapon Specialization (PHB)).
      const specCost = (p.kind === "weapon" && p.specialized) ? AD2E.specialization.extraSlots[p.weapon?.family ?? "other"] : 0;
      const cost = p.grantedBy ? specCost : (p.kind === "weapon" ? 1 + specCost : p.slots + (crossGroup ? 1 : 0));
      const target = p.ability ? this.abilities[p.ability].total + (p.modifier ?? 0) + this.kitMods.total("proficiency", p.identifier) : null;
      const entry = { item, cost, crossGroup, target };
      if (p.kind === "weapon") {
        entry.specialized = p.specialized;
        // Fighters only, and a single weapon ("choose a single weapon and specialize in its use").
        entry.specInvalid = p.specialized && (!canSpecialize || specializedCount > 1);
        entry.attack = this.#weaponAttack(p.weapon, p.specialized && canSpecialize);
      }
      return entry;
    });
    const used = kind => entries.filter(e => e.item.system.kind === kind).reduce((n, e) => n + e.cost, 0);
    const available = {
      weapon: rules.weaponInitial + Math.floor(this.level / rules.weaponRate) + (kit?.bonusSlots.weapon ?? 0),
      nonweapon: rules.nonweaponInitial + Math.floor(this.level / rules.nonweaponRate)
        + (this.abilityData.int.languages ?? 0) + (kit?.bonusSlots.nonweapon ?? 0)
    };
    return {
      groups,
      canSpecialize,
      penalty: rules.penalty,
      entries,
      weapon: { available: available.weapon, used: used("weapon") },
      nonweapon: { available: available.nonweapon, used: used("nonweapon") }
    };
  }

  /**
   * Attack and damage adjustments and attacks per round for a weapon proficiency, per use (melee, missile).
   * Melee: Strength hit/damage, specialization +1 hit / +2 damage; Table 15 (warriors) or Table 35 (specialists).
   * Missile: Dexterity missile adjustment plus Strength as `weapon.strength` allows (bows: penalties only;
   * crossbows: none); rate of fire from Table 45, or Table 35 for non-bow specialists (bow specialists gain no
   * extra attacks); bow/crossbow specialists gain the point-blank range (+2 to hit); a thrown melee weapon keeps
   * the specialization +1 hit / +2 damage. Damage never below 1.
   */
  #weaponAttack(w, specialized, extra = { hit: 0, dmg: 0 }) {
    const { dmg, missile: dexMissile, encumbranceHit } = this.mods;
    // Encumbrance attack penalty (Encumbrance (PHB)) applies to every attack roll.
    const kitHit = this.kitMods?.total("attack") ?? 0;
    const kitDmg = this.kitMods?.total("damage") ?? 0;
    const hit = this.mods.hit + encumbranceHit + kitHit;
    const missile = dexMissile + encumbranceHit + kitHit;
    const spec = AD2E.specialization;
    const out = { melee: null, missile: null };
    if (w.melee) {
      const table = specialized ? AD2E.specialistAttacks.melee
        : (this.classGroup === "warrior" ? AD2E.warriorAttacks : null);
      out.melee = {
        hit: hit + (specialized ? spec.meleeHit : 0) + extra.hit,
        dmg: dmg + kitDmg + (specialized ? spec.meleeDamage : 0) + extra.dmg,
        rate: table ? formatRate(attackRate(table, this.level)) : "1"
      };
    }
    if (w.missile) {
      const strHit = { full: hit, penalty: Math.min(hit, 0) }[w.strength] ?? 0;
      const strDmg = { full: dmg, damage: dmg, penalty: Math.min(dmg, 0) }[w.strength] ?? 0;
      const column = specialized && w.family !== "bow" ? AD2E.specialistAttacks[w.missileColumn] : null;
      // A thrown melee weapon keeps the melee specialization bonus: "+1 bonus to all his attack rolls with that
      // weapon and a +2 bonus to all damage rolls" (Weapon Specialization (PHB) rev 158222); "When using his
      // special weapon, the character gets a +1 to attack rolls and +2 to damage" (Weapon Proficiency Slots (CFH)).
      const thrownSpec = specialized && w.melee;
      out.missile = {
        hit: missile + strHit + (thrownSpec ? spec.meleeHit : 0) + extra.hit,
        dmg: strDmg + kitDmg + (thrownSpec ? spec.meleeDamage : 0) + extra.dmg,
        rate: column ? formatRate(attackRate(column, this.level)) : (w.range.rof || "1"),
        pointBlank: specialized && w.family !== "other",
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
    return items.map(item => {
      const w = item.system;
      const prof = profEntries.find(e => e.item.system.identifier === w.proficiency) ?? null;
      const specialized = !!(prof?.specialized && p.canSpecialize);
      const penalty = prof ? 0 : p.penalty;
      return { item, proficient: !!prof, proficiency: prof?.item ?? null, specialized, penalty,
        attack: this.#weaponAttack(w.weapon, specialized, { hit: w.bonus.hit + penalty, dmg: w.bonus.dmg }) };
    });
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
    const cls = this.classInfo.classItem?.system;
    const table = AD2E.casterTables[cls?.identifier] ?? null;
    const kind = table ? AD2E.casterKinds[table] : null;
    const rows = table ? AD2E.spellProgression[table] : null;
    const levels = rows ? Object.keys(rows).map(Number) : [];
    const rowLevel = levels.length ? Math.min(this.level, Math.max(...levels)) : null;
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
    const owned = (this.parent?.items?.filter(i => i.type === "spell") ?? []);
    const maxKnown = this.abilityData.int.maxSpells;
    const byLevel = new Map();
    const count = Math.max(base.length, ...owned.map(i => i.system.level), 0);
    for (let l = kind === null ? 0 : 1; l <= count; l++) byLevel.set(l, []);
    for (const i of owned) {
      if (!byLevel.has(i.system.level)) byLevel.set(i.system.level, []);
      byLevel.get(i.system.level).push(i);
    }
    const out = [...byLevel.entries()].sort((a, b) => a[0] - b[0]).map(([level, spells]) => {
      const usable = spells.filter(i => i.system.kind === kind);
      const slots = level >= 1 ? (base[level - 1] ?? 0) + (bonus[level - 1] ?? 0) + (school[level - 1] ?? 0) : 0;
      const prepared = usable.reduce((n, i) => n + i.system.prepared, 0);
      const remaining = usable.reduce((n, i) => n + Math.max(i.system.prepared - i.system.cast, 0), 0);
      return { level, spells, slots, base: base[level - 1] ?? 0, bonus: bonus[level - 1] ?? 0, school: school[level - 1] ?? 0,
        prepared, remaining, known: usable.length, maxKnown: kind === "wizard" ? maxKnown : null, over: prepared > slots };
    }).filter(l => l.slots > 0 || l.spells.length);
    return { table, kind, castingLevel: row?.casting ?? null, levels: out };
  }

  /**
   * Class abilities (generated tables, see config.mjs AD2E.skillClasses):
   *  - Thief skills: Table 26 base + Table 27 race + Table 28 Dexterity (pick pockets, open locks, find/remove traps,
   *    move silently, hide in shadows) + Table 29 armour + kit adjustment + discretionary points, at most 95 for
   *    thieves ("no skill can be raised above 95 percent, including all adjustments", Thief (PHB)). Points: 60 at
   *    1st level (at most 30 on one skill), +30 per level (at most 15 on one skill per level).
   *  - Bard abilities: Table 33 base + race + Dexterity + armour + kit + points (20 at 1st level, +15 per level).
   *  - Ranger hide in shadows / move silently: Table 18 by level + race + Dexterity; only in studded leather or
   *    lighter armour (Ranger (PHB)); halved outside natural surroundings (shown, not applied).
   *  - Backstab multiplier (Table 30) for thieves; turning undead level (Table 61) for clerics, and paladins from
   *    3rd level as a cleric two levels lower; paladin lay on hands (2 hp per level, once a day) and cure disease
   *    (once a week per 5 levels); ranger tracking bonus (+1 per 3 levels).
   */
  #computeClassAbilities() {
    const id = this.classInfo.classItem?.system.identifier ?? null;
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
      const kit = this.classInfo.kitFits ? this.classInfo.kitItem.system : null;
      const rangerRow = id === "ranger" ? T.ranger.find(r => r.level === Math.min(this.level, T.ranger.at(-1).level)) : null;
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
        out.skills.push({ key, base, race, dex: dexAdj, armor, kit: kitAdj, points: pts, total, capped,
          available: !out.armorBlocked });
      }
      if (def.points) {
        const kitPoints = id === "thief" ? kit?.skillPoints : null;
        const first = kitPoints?.first ?? def.points[0];
        const per = kitPoints?.perLevel ?? def.points[1];
        const used = def.skills.reduce((n, k) => n + (points[k] ?? 0), 0);
        out.budget = { total: first + per * (this.level - 1), used };
        out.budget.over = used > out.budget.total;
        if (id === "thief") {
          out.perSkillMax = AD2E.thiefPointLimits.first + AD2E.thiefPointLimits.perLevel * (this.level - 1);
          for (const s of out.skills) s.overLimit = s.points > out.perSkillMax;
        }
      }
    }
    if (id === "thief") out.backstab = T.backstab.find(r => this.level >= r.min && this.level <= r.max)?.multiplier ?? null;
    const turn = AD2E.turnUndead[id];
    if (turn && this.level >= turn.from) out.turnLevel = this.level + turn.offset;
    if (id === "paladin") {
      out.layOnHands = { hp: 2 * this.level, used: this.classAbilities.layOnHandsUsed };
      out.cureDisease = Math.ceil(this.level / 5);
    }
    if (id === "ranger") out.tracking = Math.floor(this.level / 3);
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
      hit: this.mods.hit + (this.mods.encumbranceHit ?? 0),
      dmg: this.mods.dmg,
      missile: this.mods.missile + (this.mods.encumbranceHit ?? 0),
      move: this.encumbrance.info?.rate ?? null
    };
  }
}
