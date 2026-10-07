/**
 * Magic resistance ("Magic Resistance (DMG)" / "Magic Resistance (PHB)"): "The target (the one with the magic resistance)
 * rolls percentile dice. If the roll is higher than the creature's magic resistance, the spell has a normal effect. If the
 * roll is equal to or less than the creature's magic resistance, the spell has no effect on the creature"; "Creatures,
 * however, can lower their magic resistance at will"; "If a magic resistance roll fails ... the target can make all saving
 * throws normally allowed". No caster-level adjustment appears in either text, so none is applied.
 * Owner's ruling: monsters use their Magic Resistance text ("50%"; "Nil" = 0), characters a number field (rings and the
 * like, `system.magicResistance` { value, lowered }); a "lowered" tick box skips the roll; targeted creatures roll when a
 * spell is cast (AD2EActor#castSpell).
 */

/** "50%" -> 50, "Nil" / "" / "Special" -> 0, "25% (+2% per level)" -> 25 (the first percentage). Pure. */
export function parseMagicResistance(text) {
  const m = String(text ?? "").match(/(\d+)\s*%/);
  return m ? Math.min(Number(m[1]), 100) : 0;
}

/** { value, lowered } of a character or monster actor. */
export function magicResistanceOf(actor) {
  const sys = actor?.system;
  if (!sys) return { value: 0, lowered: false };
  if (actor.type === "character") return { value: sys.magicResistance?.value ?? 0, lowered: !!sys.magicResistance?.lowered };
  return { value: parseMagicResistance(sys.magicResistance), lowered: !!sys.mrLowered };
}

/** Whether a d100 roll beats the resistance: resisted when the roll is at most the value. Pure. */
export function resists(value, roll) {
  return value > 0 && roll <= value;
}

/**
 * How a successful save changes a spell's effect, from the spell's Saving Throw entry (pure): "none" (no save),
 * "negates" ("Neg."), "half" ("1/2", "half"), "special" (anything else, or "Neg. or 1/2": the GM decides).
 */
export function saveEffect(text) {
  const t = String(text ?? "").trim();
  if (!t || /^(none|nil|n\/a|-|—)\.?$/i.test(t)) return "none";
  const neg = /\bneg/i.test(t);
  const half = /1\/2|½|half/i.test(t);
  if (neg && !half) return "negates";
  if (half && !neg) return "half";
  return "special";
}
