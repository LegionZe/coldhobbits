/**
 * Damage and healing formulas read from a spell page's text at import (spell importer, "Update existing spells",
 * the example spells). Only the formulas are kept, never the page's text, and nothing is stored per spell: every
 * formula comes from these patterns (@level = casting level).
 *  - Dice of damage or hit points: "2d4 points of (acid) damage", "1d6 hit points", "1d4+1 points on ..."; dice of
 *    durations, counts, ability points (Strength, Charisma ...) and structural damage are ignored, as are dice that are
 *    a maximum ("to a maximum of 10d6"), table rows without damage or hit points, and worked examples ("for example",
 *    "e.g.", "i.e.").
 *  - Per level: "1d6 ... per level" -> (@level)d6; "for every two levels" -> floor(@level / 2); "maximum of 10d6" ->
 *    min(@level, 10); "1d4+1 ... per level" -> (@level)d4 + @level.
 *  - Plus per level: "plus 1 point per level" / "(1d4 + 1/level)" / "plus additional damage equal to the caster's
 *    level" -> + @level; "plus 2 points for each level ... maximum of 1d3+20" -> + min(2 * @level, 20); "plus an
 *    additional 1d8 points for each ... level" -> + (@level)d8; "1 point per three levels" -> floor(@level / 3).
 *  - Healing: a sentence that heals, cures, restores or grants additional hit points (and inflicts nothing).
 *  - Per round: the sentence speaks of each round (shown with the option).
 * Every distinct formula of the page is one option [{ label, formula, kind: "damage" | "healing", perRound }];
 * labels are generic and edited on the spell sheet. The parse is imperfect by nature: the GM checks the options.
 */
import { plain } from "./spell-components.mjs";

const WORD = { two: 2, three: 3, four: 4 };
const count = s => WORD[String(s ?? "").toLowerCase()] ?? Number(s);
const IGNORE_SENTENCE = /structural|Charisma|stunned|hit points? of the real|Hit Dice monster|per cubic foot/i;
const ABILITY = /^(strength|dexterity|constitution|intelligence|wisdom|charisma|structural)$/i;

/** Formulas in one sentence of plain text: [{ formula, kind, perRound }]. */
export function sentenceFormulas(sentence) {
  if (/^\s*(?:for example|example)\b/i.test(sentence)) return [];
  // OCR "Id4" = 1d4; soft hyphens ("struc¬tural"); worked examples are not rules.
  const t = String(sentence).replace(/\bI(d\d)/g, "1$1").replace(/[–−]/g, "-").replace(/[­¬]/g, "").replace(/\s+/g, " ")
    .split(/\(?\b(?:for example|e\.g\.|i\.e\.)/i)[0];
  if (!/\d+d\d+/.test(t) || IGNORE_SENTENCE.test(t)) return [];
  const heal = (/\b(heals?|healed|cured?|restores?|regains?)\b/i.test(t) || /\badditional hit points\b/i.test(t))
    && !/\binflict|\bsuffers?\b|reverse/i.test(t);
  if (!heal && !/damage|hit points/i.test(t)) return [];
  const perRound = /\b(?:each|per|every) round\b|on the (?:second|third|fourth|fifth) round/i.test(t);
  const out = [];
  const re = /(\d+)d(\d+)(?:\s*\+\s*(\d+)(?!\s*\/))?/g;
  let m;
  while ((m = re.exec(t))) {
    const after = t.slice(m.index + m[0].length, m.index + m[0].length + 140);
    const before = t.slice(Math.max(0, m.index - 30), m.index);
    if (/maximum(?:\s+\w+)?(?:\s+per level)?(?:\s+of)?\s*$/i.test(before) || /up to\s*$/i.test(before) || /all but\s*$/i.test(before)) continue;
    const unit = after.match(/^\s*(?:additional\s+)?(points?|hit points|damage)\b(?:\s+of\s+(\w+))?/i);
    if (!unit || ABILITY.test(unit[2] ?? "")) continue;
    const [x, y, z] = [Number(m[1]), Number(m[2]), Number(m[3] ?? 0)];
    const dice = `${x}d${y}${z ? ` + ${z}` : ""}`;
    const per = after.match(/^[^.;]*?\b(?:per|for each|for every|each)\s+(?:(two|three|four|2|3|4)\s+)?(?:\w+\s+){0,3}?(?:levels?|level of experience)\b/i);
    const plusDice = after.match(/^[^.;]*?plus (?:an additional )?(\d+)d(\d+) points? (?:for each|per)[^.;]*?levels?/i);
    const slashLevel = after.match(/^\s*\+\s*(\d+)\s*\/\s*level/i) ?? after.match(/^[^.;]*?plus additional damage equal to the caster's level/i);
    const plusPoints = after.match(/^[^.;]*?(?:plus|\+)\s*(\d+)(?: points?)? (?:of damage )?(?:for each|per)\s+(?:(two|three|2|3)\s+)?(?:\w+\s+){0,3}?levels?/i);
    const max = after.match(/maximum(?:\s+\w+)?(?:\s+per level)?(?:\s+of)?\s+(\d+)d(\d+)(?:\s*\+\s*(\d+))?/i);
    const times = (k, lv) => (Number(k) === 1 ? lv : `${k} * ${lv}`);
    let formula;
    if (slashLevel) formula = `${dice} + ${times(slashLevel[1] ?? 1, "@level")}`;
    else if (plusDice) {
      formula = `${dice} + (${times(plusDice[1], "@level")})d${plusDice[2]}`;
      re.lastIndex = m.index + m[0].length + plusDice[0].length; // its per-level dice are part of this formula
    }
    else if (plusPoints) {
      const div = plusPoints[2] ? count(plusPoints[2]) : 1;
      let add = times(plusPoints[1], div > 1 ? `floor(@level / ${div})` : "@level");
      if (max?.[3]) add = `min(${add}, ${max[3]})`;
      formula = `${dice} + ${add}`;
    } else if (per && per.index < 60) {
      const div = per[1] ? count(per[1]) : 1;
      let n = times(x, div > 1 ? `floor(@level / ${div})` : "@level");
      if (max) n = `min(${n}, ${max[1]})`;
      formula = `(${n})d${y}${z ? ` + ${times(z, "@level")}` : ""}`;
    } else formula = dice;
    out.push({ formula, kind: heal ? "healing" : "damage", perRound });
  }
  return out;
}

/** Damage and healing options of a spell page (wikitext): [{ label, formula, kind, perRound }]. */
export function damageOptions(wiki) {
  // The spell's own text: no infobox, and not the later sections from other books (Combat & Tactics and the like).
  const body = plain(String(wiki ?? "").replace(/^\{\{Infobox[\s\S]*?\n\}\}/m, "")
    .split(/==\s*(?:Combat & Tactics|Escalades|Wizard's Spell Compendium|Priest's Spell Compendium|Notes)/)[0]);
  const all = [];
  for (const s of body.split(/(?<=[.!?])\s+/)) {
    for (const f of sentenceFormulas(s)) if (!all.some(a => a.formula === f.formula && a.kind === f.kind)) all.push(f);
  }
  return all.map(f => ({ label: "", ...f }));
}
