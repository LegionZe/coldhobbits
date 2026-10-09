import { AD2E } from "../config.mjs";
import { minimumsField } from "./item-class.mjs";

const { ArrayField, BooleanField, NumberField, ObjectField, SchemaField, StringField, SetField } = foundry.data.fields;

/** A proficiency entry: one of the listed proficiency identifiers (a single id = no choice). */
const proficiencyChoices = () => new ArrayField(new SchemaField({ choice: new ArrayField(new StringField()) }));

/**
 * Item type "kit": a class kit. `classes` holds class identifiers the kit is open to.
 * `min` overrides the class minimum per ability (0 removes it; null keeps the class value).
 * `raceLimits`: { raceIdentifier: maxLevel | null } for races this kit opens the class to (overrides the race's
 * own level limit); `raceOnly`: only the listed races may take the kit; `racesBarred`: races that may not take it.
 * `minStacks`: the kit's minimums add to the class's (the higher applies) instead of replacing them (Skills & Powers kits).
 * `bonusProficiencies`: granted free when the kit is added; `requiredProficiencies`: added too, but use slots.
 * `bonusSlots`: extra proficiency slots from the kit.
 * `recommendedProficiencies`: proficiency identifiers the kit page recommends (tools/build-proficiency-data.py).
 * `specialization`: weapon specialization exception (tools/build-kit-mechanics.py `KIT_SPECIALIZATION`).
 * `skillAdjust`: per thief skill, a percentage the kit adds to (or takes from) thief/bard/ranger skills. Kit pages
 * describe these in their text; generated values come from tools/build-kit-mechanics.py, and the GM can change them.
 * `skillPoints`: thief skill discretionary points when the kit changes them ({ first, perLevel }; null = class default).
 * `xpTable`: class identifier whose experience table the kit uses (e.g. the Kahin advances as a druid); blank = the class's.
 * `modifiers`: kit modifiers stated on the kit page (see tools/build-kit-mechanics.py for the fields); those with no
 * condition apply automatically, conditional ones are offered in the matching roll dialog.
 */
export default class KitData extends foundry.abstract.TypeDataModel {
  static defineSchema() {
    return {
      identifier: new StringField({ required: true, blank: true, initial: "" }),
      classes: new SetField(new StringField()),
      source: new StringField({ initial: "" }),
      min: minimumsField(),
      otherRequirements: new BooleanField({ initial: false }),
      raceLimits: new ObjectField(),
      raceOnly: new BooleanField({ initial: false }),
      racesBarred: new ArrayField(new StringField()),
      minStacks: new BooleanField({ initial: false }),
      xpTable: new StringField({ required: true, blank: true, initial: "" }),
      bonusProficiencies: proficiencyChoices(),
      requiredProficiencies: proficiencyChoices(),
      // Recommended proficiencies from the kit page (identifiers; weapon or nonweapon): shown, not granted.
      recommendedProficiencies: new ArrayField(new StringField()),
      // Weapon specialization exception: mode "" (class rule), "allowed", "required" or "forbidden" (blank must be
      // explicit with choices, see Foundry StringField docs); `free`: weapon proficiencies specialized at no slot cost.
      specialization: new SchemaField({
        mode: new StringField({ initial: "", blank: true, choices: ["allowed", "required", "forbidden"] }),
        free: new ArrayField(new StringField())
      }),
      bonusSlots: new SchemaField({
        weapon: new NumberField({ required: true, integer: true, min: 0, initial: 0, nullable: false }),
        nonweapon: new NumberField({ required: true, integer: true, min: 0, initial: 0, nullable: false })
      }),
      skillAdjust: new SchemaField(Object.fromEntries(AD2E.thiefSkills.map(k =>
        [k, new NumberField({ required: true, integer: true, initial: 0, nullable: false })]))),
      skillPoints: new SchemaField({
        first: new NumberField({ integer: true, min: 0, nullable: true, initial: null }),
        perLevel: new NumberField({ integer: true, min: 0, nullable: true, initial: null }),
        // Bards' discretionary points at 1st level (Barber (Character Kit): 10); later levels: the class default.
        bardFirst: new NumberField({ integer: true, min: 0, nullable: true, initial: null })
      }),
      modifiers: new ArrayField(new SchemaField({
        target: new StringField({ required: true, initial: "attack", choices: AD2E.kitTargets }),
        key: new StringField({ initial: "" }),
        value: new NumberField({ required: true, integer: true, initial: 0, nullable: false }),
        every: new NumberField({ required: true, integer: true, min: 0, initial: 0, nullable: false }),
        step: new NumberField({ required: true, integer: true, initial: 0, nullable: false }),
        from: new NumberField({ required: true, integer: true, min: 1, initial: 1, nullable: false }),
        condition: new StringField({ initial: "" }),
        // blank must be explicit: a StringField with choices is not blank-able by default (Foundry StringField docs).
        armor: new StringField({ initial: "", blank: true, choices: ["none", "light", "studded", "any"] }),
        max: new NumberField({ integer: true, nullable: true, initial: null })
      })),
      url: new StringField({ initial: "" }),
      // Weapon limits (weapon proficiency names or identifiers; tools/build-kit-weapons.py, owner's rulings 1.0.27):
      // allowedWeapons replaces the class's list ("*" = any weapon; with weaponsWithinClass only within the class's),
      // extraWeapons are added to it, forbiddenWeapons never allowed ("*" = none), initialWeapons / initialForbiddenWeapons
      // apply at 1st level only; weaponNote = extra slot costs and similar (shown, not charged).
      allowedWeapons: new ArrayField(new StringField()),
      extraWeapons: new ArrayField(new StringField()),
      forbiddenWeapons: new ArrayField(new StringField()),
      initialWeapons: new ArrayField(new StringField()),
      initialForbiddenWeapons: new ArrayField(new StringField()),
      weaponsWithinClass: new BooleanField({ initial: false }),
      weaponNote: new StringField({ initial: "" }),
      // Skills & Powers kit features with figures (module/kit-features.mjs; tools/build-kit-mechanics.py KIT_SPECIAL) and
      // the kit's 2d6 social rank table (rank: lower | lowerMiddle | upperMiddle | upper; Soldier: military title).
      special: new ObjectField(),
      socialRanks: new ArrayField(new SchemaField({ min: new NumberField({ integer: true, initial: 2 }), max: new NumberField({ integer: true, initial: 12 }),
        rank: new StringField({ initial: "" }), title: new StringField({ initial: "" }) })),
      notes: new StringField({ initial: "" })
    };
  }
}
