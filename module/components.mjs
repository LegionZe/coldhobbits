import { ad2eDialog } from "./dialogs.mjs";
/**
 * Material components when casting (world setting "trackComponents", off by default: "There are some very good reasons
 * why you shouldn't use material components in play", Material Spell Components (POSM)).
 *  - A spell's `system.materials` links components by identifier; the caster's owned equipment items with the same
 *    identifier and a quantity of at least 1 supply them.
 *  - Consumed components lose one from their quantity ("Whatever the component, it is automatically destroyed or lost
 *    when the spell is cast, unless the spell description specifically notes otherwise", Casting Spells (PHB));
 *    others (holy symbols) only need to be carried.
 *  - Missing components: a warning and a confirmation to cast anyway (owner's ruling).
 */

/** Whether component tracking is on. */
export function trackingOn() {
  try { return !!game.settings.get("ad2e", "trackComponents"); } catch { return false; }
}

/** Each material link of a spell with the caster's item that supplies it: [{ link, item | null }]. */
export function componentStatus(actor, spell) {
  const owned = [...(actor?.items ?? [])].filter(i => i.type === "equipment" && (i.system.quantity ?? 0) >= 1);
  return (spell?.system?.materials ?? []).map(link => ({ link, item: owned.find(i => i.system.identifier === link.identifier) ?? null }));
}

/**
 * Check and use a spell's components before it is cast. Resolves { cast: false } when the caster cancels, otherwise
 * { cast: true, used: [names], missing: [names] } after taking one of each consumed component that is present.
 */
export async function useComponents(actor, spell) {
  if (!trackingOn() || !spell?.system?.components?.material) return { cast: true, used: [], missing: [] };
  const status = componentStatus(actor, spell);
  const label = s => `${s.link.name}${s.link.label ? ` (${s.link.label})` : ""}`;
  const missing = status.filter(s => !s.item).map(label);
  if (missing.length) {
    const esc = v => foundry.utils.escapeHTML?.(String(v ?? "")) ?? String(v ?? "");
    ui.notifications.warn(game.i18n.format("AD2E.Components.MissingWarn", { name: spell.name, list: missing.join(", ") }));
    const ok = await ad2eDialog.confirm({
      window: { title: game.i18n.format("AD2E.Components.MissingTitle", { name: spell.name }) },
      content: `<p>${esc(game.i18n.format("AD2E.Components.MissingText", { actor: actor.name, list: missing.join(", ") }))}</p>`,
      rejectClose: false
    });
    if (!ok) return { cast: false };
  }
  const used = [];
  const updates = new Map();
  for (const s of status) {
    if (!s.item || !s.link.consumed) continue;
    const q = updates.get(s.item.id) ?? s.item.system.quantity;
    if (q < 1) continue;
    updates.set(s.item.id, q - 1);
    used.push(label(s));
  }
  if (updates.size) {
    await actor.updateEmbeddedDocuments("Item", [...updates].map(([_id, q]) => ({ _id, "system.quantity": q })));
  }
  return { cast: true, used, missing };
}
