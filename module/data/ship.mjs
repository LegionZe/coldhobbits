import { baseMorale, crewState, currentRate, damageDiceMod, EXPERIENCE, experienceMod, maneuverDice, NAVAL, propulsionOf,
  pursuitDice, seaworthinessFor, seaworthinessNow, shipSpec } from "../naval.mjs";

const { ArrayField, BooleanField, HTMLField, NumberField, SchemaField, StringField } = foundry.data.fields;

const count = (initial = 0) => new NumberField({ required: true, integer: true, min: 0, initial, nullable: false });
const optional = (opts = {}) => new NumberField({ nullable: true, initial: null, ...opts });
const group = (hd = 1) => new SchemaField({ count: count(0), hd: new NumberField({ required: true, integer: true, min: 1, initial: hd, nullable: false }),
  wounds: count(0) });

/**
 * Actor type "ship" (Of Ships and the Sea, owner's request 1.0.80; rules in module/naval.mjs, tables in
 * module/rules/naval-tables.mjs): the ship record of "Detailed Naval Combat (OSS)" (rev 173010: "Every ship involved in
 * detailed combat should have a ship record sheet"). The type gives the Table 1/2/38 figures (`shipType`, `length` for the
 * barge, canoe, outrigger and raft); the record holds the crew and marines (count, hit dice per member, wounds on the
 * wounded one: "If the defenders are creatures with multiple hit dice, one must die before any others suffer damage"),
 * hull and crippling points, artillery, fires, morale and the sinking clock. Derived: `spec`, `sizeKey`, crew state,
 * seaworthiness now (Table 28), movement now and the maneuverability/pursuit dice.
 */
export default class ShipData extends foundry.abstract.TypeDataModel {
  static defineSchema() {
    return {
      shipType: new StringField({ required: true, initial: "cog", choices: Object.fromEntries(NAVAL.ships.map(s => [s.key, s.label])) }),
      length: optional({ integer: true, min: 1 }),
      // Means of propulsion in use for ships with sails and oars ("" = both).
      propulsion: new StringField({ required: true, blank: true, initial: "", choices: { "": "", sail: "sail", oar: "oar", both: "both" } }),
      experience: new StringField({ required: true, initial: "mates", choices: Object.fromEntries(EXPERIENCE.map(k => [k, k])) }),
      // Morale: the Table 31 base unless set; `penalty` = failed morale checks in this battle (Table 33); `tired` = skeleton
      // crew efforts (-1 each, back one per full day of rest).
      morale: new SchemaField({ base: optional({ integer: true, min: 1, max: 20 }), penalty: new NumberField({ integer: true, initial: 0 }),
        tired: count(0), surrendered: new BooleanField({ initial: false }) }),
      sailors: group(), rowers: group(),
      marines: new SchemaField({ count: count(0), hd: new NumberField({ required: true, integer: true, min: 1, initial: 1, nullable: false }),
        wounds: count(0), archers: count(0), boarders: count(0), artillerists: count(0), firefighters: count(0) }),
      officers: count(0), captain: new BooleanField({ initial: true }), inactive: count(0), passengers: count(0),
      // Most prevalent THAC0 of the archers and boarders, Armor Class of the crew (Action Phase (OSS)).
      thac0: new NumberField({ required: true, integer: true, initial: 20 }),
      ac: new NumberField({ required: true, integer: true, initial: 10 }),
      hull: new SchemaField({ value: optional({ integer: true }), max: optional({ integer: true, min: 0 }) }),
      crippling: new SchemaField({ value: optional({ integer: true }), max: optional({ integer: true, min: 0 }) }),
      // Seaworthiness (null = the type's, adjusted for length); jury-rigged after a grounding: -3 until a shipyard repair.
      seaworthiness: optional({ integer: true, min: 1, max: 20 }), jury: new BooleanField({ initial: false }),
      // Out of sight of land: Arabian Adventures ships with a lower open-water seaworthiness use it (spec.seaworthinessOpen).
      openWater: new BooleanField({ initial: false }),
      ramFactor: optional({ integer: true, min: 0, max: 4 }),
      artillery: new ArrayField(new SchemaField({ key: new StringField({ required: true, initial: "ballistaLight" }),
        crew: count(0), loaded: count(0), destroyed: new BooleanField({ initial: false }), incendiary: new BooleanField({ initial: false }) })),
      fires: new ArrayField(new SchemaField({ location: new StringField({ required: true, initial: "hull", choices: { hull: "hull", crippling: "crippling" } }),
        die: new NumberField({ required: true, integer: true, initial: 6, min: 4 }) })),
      incendiary: count(0),
      // Rowers tired (Rower Endurance: -1 maneuverability and pursuit); resting after a sprint (1/3 rate); skeleton crew
      // keeping full speed today after a morale check.
      rowersTired: new BooleanField({ initial: false }), restingRowers: new BooleanField({ initial: false }),
      skeletonPushed: new BooleanField({ initial: false }),
      // Sinking clock: world time when the ship sinks (foundering), aground (soft: refloat), sunk.
      founderAt: optional(), aground: new StringField({ required: true, blank: true, initial: "", choices: { "": "", soft: "soft", rocky: "rocky", reef: "reef" } }),
      // Golden Voyages sailing rules (module/gv-sailing.mjs): storm damage (a second failure sinks), reef holes, bailers,
      // high tide and the next hourly reef check (world time).
      gv: new SchemaField({ stormDamaged: new BooleanField({ initial: false }), holes: count(0), bailers: count(0),
        refloatAt: optional(), nextCheck: optional() }),
      sunk: new BooleanField({ initial: false }),
      cargo: new StringField({ initial: "" }),
      notes: new HTMLField({ initial: "" })
    };
  }

  prepareDerivedData() {
    const spec = shipSpec(this.shipType, this.length) ?? shipSpec("cog");
    this.spec = spec;
    this.sizeKey = spec.sizeKey;
    this.prop = propulsionOf(spec, this.propulsion);
    const hullMax = this.hull.max ?? spec.combat.hull;
    const cripMax = this.crippling.max ?? spec.combat.crippling ?? spec.combat.hull;
    this.hullMax = hullMax;
    this.cripplingMax = cripMax;
    this.hullNow = this.hull.value ?? hullMax;
    this.cripplingNow = this.crippling.value ?? cripMax;
    this.crewCount = this.sailors.count + this.rowers.count;
    this.crewState = crewState(spec, this.crewCount);
    this.seaworthinessBase = this.seaworthiness ?? seaworthinessFor(spec, { open: this.openWater });
    this.seaworthinessNow = seaworthinessNow(this.seaworthinessBase, this.sizeKey, hullMax - this.hullNow);
    this.ram = this.ramFactor ?? spec.combat.rf;
    this.marinesFree = Math.max(this.marines.count - this.marines.archers - this.marines.boarders - this.marines.artillerists - this.marines.firefighters, 0);
    this.moraleRating = (this.morale.base ?? baseMorale(this.experience)) - this.morale.tired;
    const state = { spec, propulsion: this.propulsion, crewState: this.crewState, skeletonPushed: this.skeletonPushed,
      restingRowers: this.restingRowers, hull: this.hullNow, hullMax, crippling: this.cripplingNow, cripplingMax: cripMax };
    // Before the wind: a light wind across leaves a sailing rate unchanged (Table 3).
    this.rate = currentRate(state, { wind: "light", course: "across", combat: true });
    this.diceMod = experienceMod(this.experience) + damageDiceMod(state) + (this.crewState === "skeleton" ? NAVAL.travel.skeleton.dice : 0)
      - (this.rowersTired && this.prop !== "sail" ? 1 : 0) + (this.morale.penalty ?? 0);
    this.maneuver = maneuverDice(spec, this.propulsion, this.crewState);
  }

  /** The current rating for a check situation (ships.mjs SITUATIONS key): the ship's own rating, else the type's for it. */
  seaworthinessIn(situation = "") {
    const base = this.seaworthiness ?? seaworthinessFor(this.spec, { open: this.openWater, situation });
    return seaworthinessNow(base, this.sizeKey, this.hullMax - this.hullNow);
  }
}
