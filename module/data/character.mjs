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
      className: new StringField({ initial: "" }),
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

  prepareDerivedData() {
    const a = this.abilities;
    const str = lookup(AD2E.strTable, a.str.value);
    const strRow = (a.str.value === 18 && a.str.exceptional > 0)
      ? lookup(AD2E.strExceptional, a.str.exceptional) : str;
    const dex = lookup(AD2E.dexTable, a.dex.value);
    const con = lookup(AD2E.conTable, a.con.value);
    const wis = lookup(AD2E.wisTable, a.wis.value);
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

  getRollData() {
    return {
      abilities: Object.fromEntries(AD2E.abilities.map(k => [k, this.abilities[k].value])),
      level: this.level,
      thac0: this.thac0.value,
      init: this.initiative.mod + this.mods.reaction,
      hit: this.mods.hit,
      dmg: this.mods.dmg,
      missile: this.mods.missile
    };
  }
}
