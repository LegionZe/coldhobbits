import { AD2E, creatureHitDice, lookup } from "../config.mjs";
import { hpState } from "../health.mjs";
import { trapField } from "./trap-fields.mjs";
import { inventory, PHYSICAL_TYPES } from "../containers.mjs";
import { loadBand, riderOf, riderWeight } from "../animals.mjs";

const { ArrayField, BooleanField, HTMLField, NumberField, SchemaField, StringField } = foundry.data.fields;

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
      // Mounts: trained for combat ("" = by default war mounts, "yes", "no"; module/combat-options.mjs mountTrained).
      combatTrained: new StringField({ initial: "" }),
      // Pushing (module/animals.mjs pushMount): last day pushed (world day), consecutive days at double speed, and a
      // lame / spent / dead status until a world time.
      push: new SchemaField({ lastDay: new NumberField({ integer: true, nullable: true, initial: null }),
        streak: new NumberField({ integer: true, min: 0, initial: 0 }), status: new StringField({ initial: "" }),
        until: new NumberField({ nullable: true, initial: null }) }),
      climate: text(), frequency: text(), organization: text(), activity: text(), diet: text(),
      intelligence: text(), treasure: text(), alignment: text(), numberAppearing: text(),
      ac: new SchemaField({ base: int(10, -10), text: text() }),
      movement: new SchemaField({ base: int(12, 0), text: text() }),
      hitDice: new StringField({ initial: "1" }),
      // punch / temp / tempUntil: temporary damage, as for characters (module/health.mjs).
      hp: new SchemaField({ value: int(1), max: int(1), dead: new BooleanField({ initial: false }),
        punch: int(0, 0), temp: int(0, 0), tempUntil: new NumberField({ nullable: true, initial: null }) }),
      thac0: new SchemaField({ override: new NumberField({ integer: true, nullable: true, initial: null }) }),
      saveGroup: new StringField({ initial: "warrior", choices: Object.keys(AD2E.classGroups) }),
      // Saving throw level when not the Hit Dice (a sha'ir's gen: twice its master's level, module/gens.mjs).
      saveLevel: new NumberField({ integer: true, min: 0, nullable: true, initial: null }),
      attacks: new ArrayField(new SchemaField({
        name: new StringField({ initial: "Attack" }),
        damage: new StringField({ initial: "1d6" }),
        bonus: int(0),
        // Elemental province of the attack ("" | flame | sand | sea | wind): its damage dice reach elemental mages and gens
        // (module/elemental.mjs, module/gens.mjs), e.g. a fire breath or a salamander's touch.
        element: new StringField({ initial: "" })
      })),
      attacksText: text(), damageText: text(), specialAttacks: text(), specialDefenses: text(),
      magicResistance: text(), size: text(),
      morale: new SchemaField({ value: int(10, 0), text: text() }),
      xp: int(0, 0),
      initiative: new SchemaField({ mod: int(0) }),
      load: new SchemaField({ full: optional(), half: optional(), quarter: optional(), other: optional() }),
      url: text(),
      cost: text(), // hirelings: wage (DMG Tables 64/65); mounts: price (PHB Table 44)
      // Role "trap" (module/traps.mjs): a trap placed as a token, e.g. a pit or a deadfall.
      trap: trapField(),
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
    // Monsters (and hirelings, mounts) die at 0 hit points; Death's Door is for characters (Character Death (DMG)).
    this.hpState = hpState(this.hp, { character: false });
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
      const base = this.saveLevel ?? hd.saveLevel;
      const level = (nonIntelligent && key !== "par") ? Math.ceil(base / 2) : base;
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

    // Load carried (items + coins + other cargo) against PHB Table 49: full movement, 1/2, 1/4; "up to a maximum of
    // twice their normal load" (Encumbrance (PHB)) - beyond the 1/4 column it cannot move. Items in a container (e.g.
    // saddle bags) follow the container (module/containers.mjs). A character riding this actor adds its body weight
    // and everything it carries ("be sure to include the weight of the rider!", module/animals.mjs).
    const weightOf = i => i.type === "coin" ? i.system.quantity / AD2E.coinsPerPound
      : (i.system.weight ?? 0) * (["weapon", "ammunition", "equipment", "magic", "jewellery"].includes(i.type) ? (i.system.quantity ?? 1) : 1);
    const carriedLoose = i => ["equipment", "magic", "jewellery"].includes(i.type) ? i.system.carried : true;
    const inv = inventory(items, { weightOf, carriedLoose });
    const own = Math.round((items.filter(i => PHYSICAL_TYPES.includes(i.type) && inv.counts(i)).reduce((n, i) => n + weightOf(i), 0)
      + (this.load.other ?? 0)) * 10) / 10;
    const riderActor = riderOf(this.parent);
    const rider = riderActor ? { uuid: riderActor.uuid, name: riderActor.name, ...riderWeight(riderActor) } : null;
    const weight = Math.round((own + (rider?.total ?? 0)) * 10) / 10;
    const { band, rate } = loadBand(this.load, weight, this.movement.base);
    this.encumbrance = { weight, own, rider, band, rate, inventory: inv };
  }

  getRollData() {
    if (!this.hd) this.#computeDerived();
    return { thac0: this.thac0.value, init: this.initiative.mod, hd: this.hd.dice, level: this.hd.saveLevel,
      move: this.encumbrance.rate };
  }
}
