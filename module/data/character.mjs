import { AD2E, conSaveBonus, hitDiceAt, lookup } from "../config.mjs";

const { SchemaField, NumberField, StringField, HTMLField } = foundry.data.fields;

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
      saves: new SchemaField(saves),
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

    this.ac.total = this.ac.base + dex.ac;

    const saveRow = lookup(AD2E.saveTable[this.classGroup], this.level);
    // Racial CON bonus (PHB Table 9) is a roll bonus vs. rod/staff/wand and spells; the poison
    // bonus only applies to poison, so it is shown on the par save but not added to it.
    const raceCon = this.raceInfo.race?.conSaves ? conSaveBonus(a.con.total) : 0;
    this.raceInfo.conSaveBonus = raceCon;
    this.raceInfo.poisonBonus = this.raceInfo.race?.conPoison ? raceCon : 0;
    for (const key of AD2E.saves) {
      this.saves[key].table = saveRow[key];
      this.saves[key].value = this.saves[key].override ?? saveRow[key];
      this.saves[key].bonus = ["rsw", "sp"].includes(key) ? raceCon : 0;
    }

    const hd = hitDiceAt(this.classGroup, this.level);
    this.hitDice = { ...hd, label: hd.bonus ? `${hd.dice}d${hd.die}+${hd.bonus}` : `${hd.dice}d${hd.die}` };
    const xp = AD2E.xpTable[this.classInfo.classItem?.system.identifier];
    this.xpNext = xp?.[this.level] ?? null; // index = level -> XP for level + 1

    const prog = AD2E.thac0Progression[this.classGroup];
    const computed = 20 - Math.floor((this.level - 1) / prog.divisor) * prog.step;
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

  getRollData() {
    // Token-level applyActiveEffects() can also request roll data early; never assume preparation order.
    if (!this.mods) this.#computeDerived();
    return {
      abilities: Object.fromEntries(AD2E.abilities.map(k => [k, this.abilities[k].total])),
      level: this.level,
      thac0: this.thac0.value,
      init: this.initiative.mod,
      hit: this.mods.hit,
      dmg: this.mods.dmg,
      missile: this.mods.missile
    };
  }
}
