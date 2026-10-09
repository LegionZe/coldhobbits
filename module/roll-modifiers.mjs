import { ad2eDialog } from "./dialogs.mjs";
/**
 * Situational modifiers for roll dialogs: a number and an optional reason (e.g. "ring of protection +1", "cover"),
 * entered by hand for magical items and other conditions the system does not track. The reason is shown in chat.
 */
const esc = v => foundry.utils?.escapeHTML?.(String(v ?? "")) ?? String(v ?? "");

/** Modifier and reason inputs (form names `mod` and `modNote`); `unit` "%" for percentile rolls. */
export function modifierFields({ unit = "", autofocus = false } = {}) {
  const i18n = k => game.i18n.localize(k);
  return `<div class="form-group"><label>${i18n("AD2E.Roll.Modifier")}${unit ? ` (${unit})` : ""}</label>`
    + `<input type="number" name="mod" value="0"${unit === "%" ? ' step="5"' : ""}${autofocus ? " autofocus" : ""}></div>`
    + `<div class="form-group"><label>${i18n("AD2E.Roll.ModifierNote")}</label>`
    + `<input type="text" name="modNote" placeholder="${esc(i18n("AD2E.Roll.ModifierNoteHint"))}"></div>`;
}

/** { mod, note } from a dialog form with modifierFields(). */
export function readModifier(form) {
  const el = form?.elements ?? {};
  return { mod: Number(el.mod?.value) || 0, note: String(el.modNote?.value ?? "").trim() };
}

/** Chat text for a situational modifier: " [+1 ring of protection]"; "" when none. */
export function modifierText(mod, note, unit = "") {
  if (!mod && !note) return "";
  const value = mod ? `${mod > 0 ? "+" : ""}${mod}${unit}` : "";
  return ` [${[value, esc(note)].filter(Boolean).join(" ")}]`;
}

/**
 * A dialog with the modifier fields (after optional `extra` HTML, whose values `read(form)` returns); resolves
 * { mod, note, ...read(form) } or null if cancelled.
 */
export async function promptModifier(title, { unit = "", extra = "", read = null } = {}) {
  const result = await ad2eDialog.prompt({
    window: { title },
    content: extra + modifierFields({ unit, autofocus: !extra }),
    ok: { label: game.i18n.localize("AD2E.Roll.Roll"), callback: (event, button) => ({ ...readModifier(button.form), ...(read?.(button.form) ?? {}) }) },
    rejectClose: false
  });
  return result ?? null;
}
