/**
 * Sheet side of containers (rules in module/containers.mjs), shared by the character and monster sheets:
 * the Containers list, "in <container>" notes, dragging item rows and dropping them on a container.
 * Item rows are draggable with the class "draggable" and `data-item-id` (ActorSheetV2's drag selector, as dnd5e's
 * inventory rows); a container block carries `data-container-id`.
 */
import { containerChoices, extradimensionalClash, PHYSICAL_TYPES } from "../containers.mjs";

/** "In Backpack" for an item in a container, otherwise "". */
export function insideText(inv, item) {
  const c = inv?.parent?.get(item.id);
  return c ? game.i18n.format("AD2E.Container.In", { name: c.name }) : "";
}

/** Whether an item is in a container (its own Carried box is then not used). */
export function inContainer(inv, item) {
  return !!inv?.parent?.get(item.id);
}

/** Display data for the Containers list: each container with its load, capacity and contents. */
export function containerContext(inv) {
  if (!inv) return [];
  const round = n => Math.round(n * 10) / 10;
  return [...inv.containers.values()].map(c => ({
    id: c.item.id, name: c.item.name, img: c.item.img, url: c.item.system.url ?? "",
    carried: inv.carried(c.item), inside: insideText(inv, c.item),
    load: c.capacity !== null ? `${c.weight} / ${c.capacity} lb` : `${c.weight} lb`,
    volume: c.volume, weightless: c.weightless, over: c.over,
    clash: extradimensionalClash(c.item, inv.parent),
    contents: c.contents.map(i => ({ id: i.id, name: i.name, img: i.img, quantity: i.system.quantity ?? null,
      weight: round(inv.weightOf(i) ?? 0), clash: extradimensionalClash(i, inv.parent) }))
      .sort((a, b) => a.name.localeCompare(b.name))
  })).sort((a, b) => a.name.localeCompare(b.name));
}

/** Put an item of `actor` into one of its containers (refused for the item itself or anything inside it). */
export async function putIntoContainer(actor, item, containerId) {
  if (!item || item.id === containerId || item.system?.container === containerId) return null;
  if (!containerChoices(item, actor.items).some(c => c.id === containerId)) {
    ui.notifications.warn(game.i18n.format("AD2E.Container.CannotHold", { name: item.name }));
    return null;
  }
  return item.update({ "system.container": containerId });
}

/**
 * Drop handling for both sheets: an item dropped on a container block goes into that container (an item from
 * elsewhere is first added by `drop`, the sheet's usual handling). Returns undefined when the drop is not on a container.
 */
export async function dropOnContainer(sheet, event, item, drop) {
  const containerId = event.target?.closest?.("[data-container-id]")?.dataset.containerId;
  if (!containerId || !sheet.actor.isOwner || !PHYSICAL_TYPES.includes(item?.type)) return undefined;
  if (item.parent === sheet.actor) return putIntoContainer(sheet.actor, item, containerId);
  const before = new Set(sheet.actor.items.keys());
  const result = await drop();
  const created = [result].flat().find(r => r?.parent === sheet.actor && !before.has(r.id));
  if (created) await putIntoContainer(sheet.actor, created, containerId);
  return result;
}

/** Drag start for an owned item row (`data-item-id`); returns false when the row is not an item of the actor. */
export function dragItemRow(sheet, event) {
  if ("link" in (event.target?.dataset ?? {})) return false;
  const item = sheet.actor.items.get(event.currentTarget?.dataset?.itemId ?? "");
  if (!item) return false;
  event.dataTransfer.setData("text/plain", JSON.stringify(item.toDragData()));
  return true;
}

/** Inputs inside draggable rows must not start a drag (as dnd5e's PrimarySheet5e). */
export function guardDraggableInputs(element) {
  for (const el of element?.querySelectorAll?.(".draggable input") ?? []) {
    el.draggable = true;
    el.ondragstart = event => { event.preventDefault(); event.stopPropagation(); };
  }
}
