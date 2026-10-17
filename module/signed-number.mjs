/**
 * Signed modifiers typed by hand (1.0.67, owner's report: a monster's natural attack to-hit "reset" when another attack was
 * added or a Type changed). The owner's diagnostic on core 14.369 showed the to-hit box (`<input type="number">`) with the
 * value "" and 0 stored: the box held text the browser did not take as a number, so the sheet sent no number and the next
 * redraw showed the stored 0. A number box's value is "" whenever its text is not a valid floating-point number (HTML
 * Standard, input type=number, value sanitization; a valid floating-point number has no leading "+"); Chromium 141 drops "+"
 * and "−" (U+2212) while typing, so "−1" became 1 (tested here). Modifier boxes are now text boxes read by this module:
 * "+2", "2", "-1", "−1", " + 2 " are read; unreadable text keeps the stored value (sheets) or counts 0 (dialogs), with a warning.
 */

/** An integer from typed text (pure): null when empty or not a whole number. */
export function parseSigned(text) {
  if (typeof text === "number") return Number.isInteger(text) ? text : null;
  const t = String(text ?? "").replace(/[\u2212\u2012\u2013]/g, "-").replace(/\s+/g, "");
  if (!/^[+-]?\d+$/.test(t)) return null;
  const n = Number(t);
  return Object.is(n, -0) ? 0 : n;
}

/** A modifier as shown in a box (pure): "+2", "0", "-1". */
export function signedText(n) {
  const v = Number(n) || 0;
  return v > 0 ? `+${v}` : String(v);
}

/**
 * Read a typed modifier for a document update (pure): { value, bad }. Empty = `empty` (0 by default); unreadable text keeps
 * `stored` and is reported as `bad` (the text).
 */
export function readSigned(text, stored, empty = 0) {
  if (text === undefined) return { value: stored, bad: null };
  if (String(text).trim() === "") return { value: empty, bad: null };
  const n = parseSigned(text);
  return n === null ? { value: stored, bad: String(text) } : { value: n, bad: null };
}

/** Warn once about unreadable modifiers (sheets). */
export function warnUnreadable(bad) {
  if (!bad.length) return;
  globalThis.ui?.notifications?.warn(game.i18n.format("AD2E.Signed.Unreadable", { text: bad.map(b => `"${b}"`).join(", ") }));
}
