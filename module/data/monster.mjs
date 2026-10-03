import { AD2E, creatureHitDice, lookup } from "../config.mjs";

const { ArrayField, HTMLField, NumberField, SchemaField, StringField } = foundry.data.fields;

const int = (initial, min = null) => new NumberField({ required: true, integer: true, initial, min, nullable: false });
const text = () => new StringField({ initial: "" });
const optional = () => new NumberField({ min: 0, nullable: true, initial: null });

/**
 * Actor type "monster": a Monstrous Manual stat block, also used for hirelings, mounts and pets.
 * THAC0 from Hit Dice (DMG Table 39); saving throws on the group table (Warrior by default) at a level equal to the
 * Hit Dice, half for non-intelligent creatures except vs. paralyzation, poison and death magic (The Saving Throw (DMG));
 * morale checks 2d10 <= morale (Morale (DMG)). Owned armour sets AC; weapons add attacks; a mount's load (PHB
 * Table 49) reduces its movement.
 */
export default class MonsterData extends foundry.abstract.TypeDataModel {
  static defineSchema() {
    return {
      identifier: text(),
      role: new StringField({ required: true, initial: "monster", choices: AD2E.monsterRoles }),
      climate: text(), frequency: text(), organization: text(), activity: text(), diet: text(),
      intelligence: text(), treasure: text(), alignment: text(), numberAppearing: text(),
      ac: new SchemaField({ base: int(10, -10), text: text() }),
      movement: new SchemaField({ base: int(12, 0), text: text() }),
      hitDice: new StringField({ initial: "1" }),
      hp: new SchemaField({ value: int(1), max: int(1) }),
      thac0: new SchemaField({ override: new NumberField({ integer: true, nullable: true, initial: null }) }),
      saveGroup: new StringField({ initial: "warrior", choices: Object.keys(AD2E.classGroups) }),
      attacks: new ArrayField(new SchemaField({
        name: new StringField({ initial: "Attack" }),
        damage: new StringField({ initial: "1d6" }),
        bonus: int(0)
      })),
      attacksText: text(), damageText: text(), specialAttacks: text(), specialDefenses: text(),
      magicResistance: text(), size: text(),
      morale: new SchemaField({ value: int(10, 0), text: text() }),
      xp: int(0, 0),
      initiative: new SchemaField({ mod: int(0) }),
      load: new SchemaField({ full: optional(), half: optional(), quarter: optional(), other: optional() }),
      url: text(),
      cost: text(), // hirelings: wage (DMG Tables 64/65); mounts: price (PHB Table 44)
      notes: new HTMLField()
    };
  }

  prepareBaseData() {
    this.#computeDerived();
  }

  prepareDerivedData() {
    this.#computeDerived();
  }

  #computeDerived() {
    const hd = creatureHitDice(this.hitDice);
    this.hd = hd;
    const table = AD2E.creatureThac0;
    this.thac0.computed = table[Math.min(hd.thac0Index, table.length - 1)];
    this.thac0.value = this.thac0.override ?? this.thac0.computed;

    // Saving throws: Hit Dice as level; non-intelligent creatures save at half (rounded up) except vs. paralyzation,
    // poison and death magic.
    const nonIntelligent = /non|\(0\)/i.test(this.intelligence);
    this.saves = {};
    for (const key of AD2E.saves) {
      const level = (nonIntelligent && key !== "par") ? Math.ceil(hd.saveLevel / 2) : hd.saveLevel;
      this.saves[key] = { level, value: lookup(AD2E.saveTable[this.saveGroup], level)[key], bonus: 0 };
    }

    // Armour (equipped body armour replaces the base AC; a shield improves it), as for characters but with no
    // Dexterity adjustment.
    const items = this.parent?.items ?? [];
    const equipped = items.filter(i => i.type === "armor" && i.system.equipped);
    const body = equipped.filter(i => i.system.kind === "body" && i.system.ac !== null)
      .sort((a, b) => (a.system.ac - a.system.bonus) - (b.system.ac - b.system.bonus))[0];
    const shield = equipped.filter(i => i.system.kind === "shield")
      .sort((a, b) => (b.system.shield.melee + b.system.bonus) - (a.system.shield.melee + a.system.bonus))[0];
    const base = body ? body.system.ac - body.system.bonus : this.ac.base;
    this.ac.value = base - (shield ? shield.system.shield.melee + shield.system.bonus : 0);
    this.ac.armor = [body?.name, shield?.name].filter(Boolean).join(" + ");

    // Load carried (items + coins + other cargo, e.g. a rider) against PHB Table 49: full movement, 1/2, 1/4;
    // "up to a maximum of twice their normal load" (Encumbrance (PHB)) - beyond the 1/4 column it cannot move.
    const weightOf = i => (i.system.weight ?? 0) * (["weapon", "ammunition", "equipment"].includes(i.type) ? (i.system.quantity ?? 1) : 1);
    const carried = items.filter(i => ["weapon", "ammunition", "armor"].includes(i.type)
      || (i.type === "equipment" && i.system.carried));
    const coins = items.filter(i => i.type === "coin").reduce((n, i) => n + i.system.quantity, 0);
    const weight = Math.round((carried.reduce((n, i) => n + weightOf(i), 0) + coins / AD2E.coinsPerPound
      + (this.load.other ?? 0)) * 10) / 10;
    const l = this.load;
    let rate = this.movement.base;
    let band = null;
    if (l.full !== null) {
      if (weight <= l.full) band = "full";
      else if (l.half !== null && weight <= l.half) { band = "half"; rate = Math.floor(rate / 2); }
      else if (l.quarter !== null && weight <= l.quarter) { band = "quarter"; rate = Math.floor(rate / 4); }
      else { band = "over"; rate = 0; }
    }
    this.encumbrance = { weight, band, rate };
  }

  getRollData() {
    if (!this.hd) this.#computeDerived();
    return { thac0: this.thac0.value, init: this.initiative.mod, hd: this.hd.dice, level: this.hd.saveLevel,
      move: this.encumbrance.rate };
  }
}
