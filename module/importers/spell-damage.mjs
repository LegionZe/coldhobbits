/**
 * Damage formulas for spells whose wiki page gives a fixed rule (@level = casting level), applied by the spell parser
 * (import, "Update existing spells" for spells without a formula, and the example spells). Each formula is used only
 * when its pattern still matches the page; other spells' formulas are entered by the GM on the spell sheet.
 * Spells with several missiles or bolts roll all of them together (one target).
 */
import { plain } from "./spell-components.mjs";

export const SPELL_DAMAGE = {
  "Burning Hands (Wizard Spell)": ["1d3 + min(2 * @level, 20)",
    /1d3 points of damage, plus 2 points for each level of experience of the spellcaster, to a maximum of 1d3\+20/],
  "Shocking Grasp (Wizard Spell)": ["1d8 + @level", /delivers 1d8 points of damage, plus 1 point per level of the wizard/],
  "Magic Missile (Wizard Spell)": ["(min(floor((@level + 1) / 2), 5))d4 + min(floor((@level + 1) / 2), 5)",
    /each missile inflicts 1d4\+1 points of damage/],
  "Melf's Acid Arrow (Wizard Spell)": ["2d4", /inflicts 2d4 points of acid damage/],
  "Fireball (Wizard Spell)": ["(min(@level, 10))d6",
    /1d6 points of damage for each level of experience of the spellcaster \(up to a maximum of 10d6\)/],
  "Lightning Bolt (Wizard Spell)": ["(min(@level, 10))d6",
    /1d6 points of damage per level of the spellcaster \(maximum damage per level of 10d6\)/],
  "Cone of Cold (Wizard Spell)": ["(@level)d4 + @level", /causes 1d4\+1 points of damage per level of experience of the wizard/],
  "Chain Lightning (Wizard Spell)": ["(min(@level, 12))d6",
    /initially inflicts 1d6 points of damage per level of the caster, to a maximum of 12d6/],
  "Flame Strike (Priest Spell)": ["6d8", /sustains 6d8 points of damage/],
  "Call Lightning (Priest Spell)": ["(@level + 2)d8",
    /2d8 points of electrical damage, plus an additional 1d8 points for each of the caster's experience levels/],
  "Produce Flame (Priest Spell)": ["1d4 + 1", /suffers 1d4\+1 points of damage/]
};

/** The damage formula for a spell page, or "" (unknown spell, or the page no longer matches). */
export function damageFormula(title, wiki) {
  const entry = SPELL_DAMAGE[title];
  if (!entry) return "";
  return entry[1].test(plain(wiki)) ? entry[0] : "";
}
