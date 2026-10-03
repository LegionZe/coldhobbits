import { AD2E } from "../config.mjs";
import { minimumsField } from "./item-class.mjs";

const { ArrayField, BooleanField, NumberField, ObjectField, SchemaField, StringField, SetField } = foundry.data.fields;

/** A proficiency entry: one of the listed proficiency identifiers (a single id = no choice). */
const proficiencyChoices = () => new ArrayField(new SchemaField({ choice: new ArrayField(new StringField()) }));

/**
 * Item type "kit": a class kit. `classes` holds class identifiers the kit is open to.
 * `min` overrides the class minimum per ability (0 removes it; null keeps the class value).
 * `raceLimits`: { raceIdentifier: maxLevel | null } for races this kit opens the class to (overrides the race's
 * own level limit); `raceOnly`: only the listed races may take the kit.
 * `bonusProficiencies`: granted free when the kit is added; `requiredProficiencies`: added too, but use slots.
 * `bonusSlots`: extra proficiency slots from the kit.
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
      xpTable: new StringField({ required: true, blank: true, initial: "" }),
      bonusProficiencies: proficiencyChoices(),
      requiredProficiencies: proficiencyChoices(),
      bonusSlots: new SchemaField({
        weapon: new NumberField({ required: true, integer: true, min: 0, initial: 0, nullable: false }),
        nonweapon: new NumberField({ required: true, integer: true, min: 0, initial: 0, nullable: false })
      }),
      skillAdjust: new SchemaField(Object.fromEntries(AD2E.thiefSkills.map(k =>
        [k, new NumberField({ required: true, integer: true, initial: 0, nullable: false })]))),
      skillPoints: new SchemaField({
        first: new NumberField({ integer: true, min: 0, nullable: true, initial: null }),
        perLevel: new NumberField({ integer: true, min: 0, nullable: true, initial: null })
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
        armor: new StringField({ initial: "", blank: true, choices: ["none", "light", "any"] }),
        max: new NumberField({ integer: true, nullable: true, initial: null })
      })),
      url: new StringField({ initial: "" }),
      notes: new StringField({ initial: "" })
    };
  }
}
