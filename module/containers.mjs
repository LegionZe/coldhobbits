/**
 * Items carried inside containers ("Aside from knowing the weight limits, your character needs to have ways to hold all
 * his gear. The capacities of different containers are given in Table 50", Encumbrance Tables (PHB)).
 *  - A physical item's `system.container` is the id of a container item on the same actor ("" = not in a container).
 *  - A container is an equipment or magical item with a stowage capacity (weight or volume) or whose contents add no
 *    weight (`capacity.weightless`: "Regardless of what is put into this item, the bag always weighs a fixed amount",
 *    Bag of Holding (Magic Bag); "The cloth does not accumulate weight even if its hole is filled", Portable Hole
 *    (Magic Container)).
 *  - Contents follow their container: they count toward the load while the container is carried, and not at all
 *    inside a container whose contents add no weight. A container's contents weight is checked against its capacity.
 *  - A missing container, a container inside its own contents, or an item in use (equipped armour, a weapon in hand)
 *    counts as not in a container.
 * Pure rules (no Foundry calls) so they can be tested in Node.
 */

/** Item types that have weight and can go into a container. */
export const PHYSICAL_TYPES = ["weapon", "ammunition", "armor", "equipment", "magic", "jewellery", "coin"];

/** Whether an item is a container. */
export function isContainer(item) {
  if (!["equipment", "magic"].includes(item?.type)) return false;
  const c = item.system?.capacity;
  return !!c && ((c.weight ?? null) !== null || !!c.volume || !!c.weightless);
}

/** Whether a container's contents add no weight to whoever carries it. */
export function isWeightless(item) {
  return isContainer(item) && !!item.system.capacity.weightless;
}

/**
 * Container links of a list of items: Map itemId -> container item. Links to a missing item, a non-container, the item
 * itself, from an item in use (`system.equipped`), or that close a loop are dropped.
 */
export function containerLinks(items) {
  const list = [...(items ?? [])].filter(i => PHYSICAL_TYPES.includes(i?.type));
  const byId = new Map(list.map(i => [i.id, i]));
  const parent = new Map();
  for (const i of list) {
    const c = byId.get(i.system?.container || "");
    if (c && c !== i && isContainer(c) && !i.system.equipped) parent.set(i.id, c);
  }
  for (const i of list) {
    const seen = new Set([i.id]);
    for (let p = parent.get(i.id); p; p = parent.get(p.id)) {
      if (seen.has(p.id)) { parent.delete(i.id); break; }
      seen.add(p.id);
    }
  }
  return parent;
}

/** The containers an item is in, innermost first. */
export function containerChain(item, parent) {
  const chain = [];
  for (let p = parent.get(item.id); p; p = parent.get(p.id)) chain.push(p);
  return chain;
}

/**
 * Inventory of an actor's items.
 *  - `weightOf(item)`: the item's own weight (lb), quantity included.
 *  - `carriedLoose(item)`: whether an item that is not in a container is carried.
 * Returns { parent, carried(item), counts(item), weightOf, containers: Map containerId -> { item, contents: [items], weight,
 * capacity, volume, weightless, over } } where `counts` = carried and not inside a container whose contents add no
 * weight, and a container's `weight` = its contents (each content's own weight plus, for a container whose contents
 * add weight, its own contents).
 */
export function inventory(items, { weightOf, carriedLoose }) {
  const list = [...(items ?? [])].filter(i => PHYSICAL_TYPES.includes(i?.type));
  const parent = containerLinks(list);
  const carried = item => {
    const chain = containerChain(item, parent);
    return chain.length ? !!carriedLoose(chain[chain.length - 1]) : !!carriedLoose(item);
  };
  const counts = item => carried(item) && !containerChain(item, parent).some(isWeightless);
  const containers = new Map(list.filter(isContainer).map(c => [c.id, { item: c, contents: [] }]));
  for (const i of list) {
    const p = parent.get(i.id);
    if (p) containers.get(p.id).contents.push(i);
  }
  const held = (c, seen = new Set()) => {
    if (seen.has(c.id)) return 0;
    seen.add(c.id);
    return containers.get(c.id).contents.reduce((n, i) => n + (weightOf(i) ?? 0)
      + (isContainer(i) && !isWeightless(i) ? held(i, seen) : 0), 0);
  };
  for (const [, info] of containers) {
    const cap = info.item.system.capacity;
    info.weight = Math.round(held(info.item) * 10) / 10;
    info.capacity = cap.weight ?? null;
    info.volume = cap.volume ?? "";
    info.weightless = !!cap.weightless;
    info.over = info.capacity !== null && info.weight > info.capacity;
  }
  return { parent, carried, counts, containers, weightOf };
}

/**
 * Magical containers that must not hold each other: "If a bag of holding is placed within a portable hole, a rift to the
 * Astral Plane is torn in the space ... If a portable hole is placed within a bag of holding, it opens a gate to another
 * plane" (Portable Hole (Magic Container)). Returns true when an item and one of its containers form such a pair.
 */
export const EXTRADIMENSIONAL = ["bag-of-holding", "portable-hole"];
export function extradimensionalClash(item, parent) {
  const id = item?.system?.identifier;
  if (!EXTRADIMENSIONAL.includes(id)) return false;
  return containerChain(item, parent).some(c => EXTRADIMENSIONAL.includes(c.system?.identifier) && c.system.identifier !== id);
}

/** Ids of an item and everything inside it (an item cannot be put into any of these). */
export function selfAndContents(item, items) {
  const parent = containerLinks(items);
  const out = new Set([item.id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const [id, c] of parent) if (out.has(c.id) && !out.has(id)) { out.add(id); grew = true; }
  }
  return out;
}

/** Containers an item can be put into on its actor: [{ id, name }] (not itself or anything inside it). */
export function containerChoices(item, items) {
  if (!PHYSICAL_TYPES.includes(item?.type)) return [];
  const blocked = selfAndContents(item, items);
  return [...(items ?? [])].filter(i => isContainer(i) && !blocked.has(i.id))
    .map(i => ({ id: i.id, name: i.name })).sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Update rule for items that can be in use (weapons, armour, magical items), called from their data models' _preUpdate
 * with the current data: putting an item into a container stops using it (and picks up a dropped weapon); otherwise
 * equipping it takes it out of its container. Sheets submit every field, so only values that differ from `current`
 * count as changes. Mutates `changes` (document-level, e.g. { system: { equipped: true } }).
 */
export function containerPreUpdate(changes, type, current = {}) {
  const { getProperty, setProperty } = foundry.utils;
  const into = getProperty(changes, "system.container");
  const equip = getProperty(changes, "system.equipped");
  if (typeof into === "string" && into && into !== (current.container ?? "")) {
    setProperty(changes, "system.equipped", false);
    if (type === "weapon") setProperty(changes, "system.dropped", false);
  } else if (equip === true && !current.equipped) setProperty(changes, "system.container", "");
}
