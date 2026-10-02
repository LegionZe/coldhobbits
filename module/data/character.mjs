import { AD2E, lookup } from "../config.mjs";

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
    for (const key of AD2E.saves) saves[key] = new SchemaField({ value: int(20, 1, 25) });

    return {
      race: new StringField({ initial: "" }),
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
    // Class first: the class item sets the group used below (warrior CON bonus, THAC0).
    this.classInfo = this.#computeClassInfo();
    if (this.classInfo.classItem) this.classGroup = this.classInfo.classItem.system.group;

    const a = this.abilities;
    const T = AD2E.abilityTables;
    const strRow = (a.str.value === 18 && a.str.exceptional > 0)
      ? lookup(T.strExceptional, a.str.exceptional) : lookup(T.str, a.str.value);

    /** Current table row per ability (PHB Tables 1-6). */
    this.abilityData = {
      str: strRow,
      dex: lookup(T.dex, a.dex.value),
      con: lookup(T.con, a.con.value),
      int: lookup(T.int, a.int.value),
      wis: lookup(T.wis, a.wis.value),
      cha: lookup(T.cha, a.cha.value)
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
    const kitFits = !!(cls && kitItem && kitItem.system.classes.has(cls.identifier));
    const kit = kitFits ? kitItem.system : null;
    const requirements = AD2E.abilities.map(key => {
      const classMin = cls?.min[key] ?? null;
      const kitMin = kit ? (kit.min[key] ?? null) : null;
      const required = kitMin ?? classMin ?? 0;
      const score = this.abilities[key].value;
      return { key, classMin, kitMin, required, score, met: score >= required };
    });
    const prime = cls ? [...cls.prime] : [];
    return {
      classItem,
      kitItem,
      kitFits,
      requirements,
      requirementsMet: requirements.every(r => r.met),
      alignmentAllowed: cls ? cls.alignments.has(this.alignment) : true,
      xpBonus: prime.length > 0 && prime.every(key => this.abilities[key].value >= 16) ? 10 : 0
    };
  }

  getRollData() {
    // Token-level applyActiveEffects() can also request roll data early; never assume preparation order.
    if (!this.mods) this.#computeDerived();
    return {
      abilities: Object.fromEntries(AD2E.abilities.map(k => [k, this.abilities[k].value])),
      level: this.level,
      thac0: this.thac0.value,
      init: this.initiative.mod,
      hit: this.mods.hit,
      dmg: this.mods.dmg,
      missile: this.mods.missile
    };
  }
}
