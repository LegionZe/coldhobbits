import { ad2eDialog } from "./dialogs.mjs";
import { ITEM_SAVES } from "./rules/item-save-tables.mjs";

/**
 * Item saving throws (DMG Table 29, "Damaging Equipment (DMG)"; module/rules/item-save-tables.mjs from
 * tools/build-item-save-tables.py) and falling damage ("Special Damage (DMG)": 1d6 per 10 feet, at most 20d6).
 * Owner's rulings: material guessed from the item and editable (`system.material`; blank = the guess); saves from a GM
 * tool, from a failed save on a save request (GM button), and from the falling tool; every item with a material is listed
 * with the fragile ones ticked (potions, oils, paper, glass, pottery); a failed item is marked destroyed (renamed,
 * unequipped, no longer carried; flag `ad2e.destroyed`), the GM deletes it. A "—" in Table 29 is read as unaffected
 * (implementation choice). Magical bonus: the item's plus (weapons, ammunition, armour), a magical item's `saveBonus` or
 * +1 for potions and +5 for other magical items (the DMG's "+5 or +6"); +2 when designed to counter the attack (tick box).
 */
export const SAVES = ITEM_SAVES;
export const ITEM_TYPES = ["weapon", "armor", "ammunition", "equipment", "magic", "jewellery"];

const esc = v => foundry.utils.escapeHTML?.(String(v ?? "")) ?? String(v ?? "");
const i18n = (k, d) => (d ? game.i18n.format(k, d) : game.i18n.localize(k));

const NAME_RULES = [
  [/\b(potion|philter|elixir)/i, "potions"], [/\boil\b|\boils\b/i, "oils"],
  [/\b(scroll|book|tome|paper|parchment|map|manual|libram|ink)/i, "paper"],
  [/\b(rope|net|lasso|bolas|string|twine)/i, "rope"],
  [/\b(vial|bottle|flask|glass|mirror|lens|lantern)/i, "glass"],
  [/\b(jug|jar|pot|urn|amphora|crock)\b/i, "pottery"],
  [/\b(sling|whip|leather|hide|backpack|belt pouch|pouch|saddle|boots?|gloves?|gauntlets? of|girdle|harness|bridle|waterskin|wineskin)/i, "leather"],
  [/\b(cloak|robe|cloth|blanket|tent|sack|bag|clothing|tunic|hat|cap|sash|tabard|padded|scarf|vestment|habit)/i, "cloth"],
  [/\b(club|quarterstaff|staff|cudgel|chest|barrel|box|cask|coffer|pole|ladder|wagon|cart|shield)/i, "woodThick"],
  [/\b(bow|arrow|flight|sheaf|javelin|spear|dart|torch|wand|rod|stake|holy symbol, wooden|pipe|flute|instrument|lute|harp)/i, "woodThin"],
  [/\b(stone|gem|crystal|jewel|pearl|marble|statuette)/i, "rock"], [/\b(bone|ivory|horn|tusk|skull)/i, "bone"]
];

/** Table 29 material for an item when none is set (pure; "" = no guess). */
export function guessMaterial(item) {
  const name = String(item?.name ?? "");
  const sys = item?.system ?? {};
  if (item?.type === "magic") {
    const byCategory = { potion: /\boil\b/i.test(name) ? "oils" : "potions", scroll: "paper", ring: "metal", rod: "metal",
      staff: "woodThick", wand: "woodThin", book: "paper", jewel: "metal", cloak: "cloth", boots: "leather" };
    if (byCategory[sys.category]) return byCategory[sys.category];
  }
  if (item?.type === "jewellery") return sys.kind === "gem" ? "rock" : "metal";
  if (item?.type === "armor" && /\b(leather|hide|padded|studded)/i.test(name)) return /padded/i.test(name) ? "cloth" : "leather";
  if (item?.type === "ammunition" && /\b(stone)/i.test(name)) return "rock";
  if (item?.type === "ammunition" && /\b(bullet|needle|pellet)/i.test(name)) return "metal";
  for (const [re, m] of NAME_RULES) if (re.test(name)) return m;
  if (["weapon", "armor"].includes(item?.type)) return "metal";
  if (item?.type === "ammunition") return "woodThin";
  if (item?.type === "equipment" && sys.category === "clothing") return "cloth";
  return "";
}

/** The material used: the item's own, else the guess (pure). */
export function materialOf(item) {
  const own = item?.system?.material;
  return own && SAVES.materials.includes(own) ? own : guessMaterial(item);
}

/** The item's magical save bonus (pure): its plus, a magical item's `saveBonus` or the DMG's +1 potion / +5 otherwise. */
export function itemSaveBonus(item) {
  const sys = item?.system ?? {};
  if (["weapon", "ammunition"].includes(item?.type)) return Math.max(sys.bonus?.hit ?? 0, sys.bonus?.dmg ?? 0, 0);
  if (item?.type === "armor") return Math.max(sys.bonus ?? 0, 0);
  if (item?.type === "magic") return sys.saveBonus ?? (sys.category === "potion" ? SAVES.bonus.potion : SAVES.bonus.miscellaneous);
  return 0;
}

/** Table 29 number for a material and attack form; null = unaffected ("—") or unknown (pure). */
export function itemSaveTarget(material, form) {
  const v = SAVES.table[material]?.[form];
  return Number.isFinite(v) ? v : null;
}

/** Fall modifier for the item save (pure): null when the fall is 5 feet or less (no save); soft +5; -1 per 5 feet beyond the first. */
export function fallModifier(distance, soft = false) {
  const d = Math.max(Number(distance) || 0, 0);
  if (d <= SAVES.fall.minimum) return null;
  return (soft ? SAVES.fall.soft : 0) + SAVES.fall.perFive * Math.floor((d - 5) / 5);
}

/** Falling damage dice (pure): 1 per full 10 feet, at most 20. */
export function fallingDice(distance) {
  const f = SAVES.falling;
  return Math.min(Math.floor(Math.max(Number(distance) || 0, 0) / f.per) * f.dice, f.maxDice);
}

/** Whether the item is fragile (ticked by default; owner's ruling). */
export function fragile(material) {
  return SAVES.fragile.includes(material);
}

/** Items of an actor that can save: physical, not destroyed, with a material (pure over the item list). */
export function saveableItems(items) {
  return [...(items ?? [])].filter(i => ITEM_TYPES.includes(i.type) && !i.flags?.ad2e?.destroyed && materialOf(i));
}

/** Mark an item destroyed: renamed, unequipped, no longer carried (weapons: dropped). */
export async function markDestroyed(item) {
  const update = { name: `${item.name} (${i18n("AD2E.ItemSave.Destroyed")})`, "flags.ad2e.destroyed": true };
  if ("equipped" in item.system) update["system.equipped"] = false;
  if ("carried" in item.system) update["system.carried"] = false;
  if ("dropped" in item.system) update["system.dropped"] = true;
  return item.update(update);
}

const formOptions = selected => SAVES.forms.map(f => `<option value="${f}"${f === selected ? " selected" : ""}>${esc(i18n(`AD2E.ItemSave.Form.${f}`))}</option>`).join("");
const materialOptions = selected => SAVES.materials.map(m => `<option value="${m}"${m === selected ? " selected" : ""}>${esc(i18n(`AD2E.ItemSave.Material.${m}`))}</option>`).join("");

/**
 * Roll item saves for one actor's items: choose the attack form (falls: distance and surface; cold: gradual change), tick
 * the items and adjust material and bonus; one d20 per item vs. Table 29. Results to chat; failures marked destroyed.
 */
export async function itemSaveDialog(actor, { form = "magicalFire", distance = 10, soft = false } = {}) {
  if (!actor) return null;
  const items = saveableItems(actor.items);
  if (!items.length) {
    ui.notifications.info(i18n("AD2E.ItemSave.NoItems", { name: actor.name }));
    return null;
  }
  const rows = items.map(i => {
    const m = materialOf(i);
    return `<tr><td><input type="checkbox" name="use.${i.id}"${fragile(m) ? " checked" : ""}></td><td>${esc(i.name)}</td>`
      + `<td><select name="mat.${i.id}">${materialOptions(m)}</select></td>`
      + `<td><input type="number" name="bonus.${i.id}" value="${itemSaveBonus(i)}" step="1" style="width:4em"></td>`
      + `<td><input type="checkbox" name="counter.${i.id}"></td></tr>`;
  }).join("");
  const input = await ad2eDialog.prompt({
    window: { title: i18n("AD2E.ItemSave.Title", { name: actor.name }) }, position: { width: 620 },
    content: `<div class="form-group"><label>${esc(i18n("AD2E.ItemSave.FormLabel"))}</label><select name="form">${formOptions(form)}</select></div>`
      + `<div class="form-group"><label>${esc(i18n("AD2E.ItemSave.Distance"))}</label><input type="number" name="distance" value="${distance}" min="0" step="5"></div>`
      + `<div class="form-group"><label>${esc(i18n("AD2E.ItemSave.Soft"))}</label><input type="checkbox" name="soft"${soft ? " checked" : ""}></div>`
      + `<div class="form-group"><label>${esc(i18n("AD2E.ItemSave.Gradual"))}</label><input type="checkbox" name="gradual"></div>`
      + `<p class="ad2e-note">${esc(i18n("AD2E.ItemSave.Hint"))}</p>`
      + `<div style="max-height:340px;overflow-y:auto"><table><thead><tr><th></th><th>${esc(i18n("AD2E.ItemSave.Item"))}</th><th>${esc(i18n("AD2E.ItemSave.MaterialLabel"))}</th>`
      + `<th>${esc(i18n("AD2E.ItemSave.Bonus"))}</th><th data-tooltip="${esc(i18n("AD2E.ItemSave.CounterHint"))}">+${SAVES.bonus.designedToCounter}</th></tr></thead><tbody>${rows}</tbody></table></div>`,
    ok: { label: i18n("AD2E.ItemSave.Roll"), callback: (event, button) => {
      const f = button.form.elements;
      return { form: f.form.value, distance: Number(f.distance.value) || 0, soft: !!f.soft.checked, gradual: !!f.gradual.checked,
        picks: items.filter(i => f[`use.${i.id}`]?.checked).map(i => ({ item: i, material: f[`mat.${i.id}`].value,
          bonus: Number(f[`bonus.${i.id}`].value) || 0, counter: !!f[`counter.${i.id}`]?.checked })) };
    } },
    rejectClose: false
  });
  if (!input?.picks?.length) return null;
  return rollItemSaves(actor, input);
}

/** One d20 per picked item; chat card; failures marked destroyed. */
export async function rollItemSaves(actor, { form, distance = 0, soft = false, gradual = false, picks }) {
  let situational = 0;
  if (form === "fall") {
    const mod = fallModifier(distance, soft);
    if (mod === null) {
      ui.notifications.info(i18n("AD2E.ItemSave.ShortFall"));
      return null;
    }
    situational = mod;
  } else if (form === "cold" && gradual) situational = SAVES.coldGradual;
  const lines = [], rolls = [];
  for (const p of picks) {
    const need = itemSaveTarget(p.material, form);
    const mat = i18n(`AD2E.ItemSave.Material.${p.material}`);
    if (need === null) {
      lines.push(i18n("AD2E.ItemSave.Unaffected", { name: p.item.name, material: mat }));
      continue;
    }
    const roll = await new Roll("1d20").evaluate();
    rolls.push(roll);
    const total = roll.total + p.bonus + (p.counter ? SAVES.bonus.designedToCounter : 0) + situational;
    const ok = total >= need;
    lines.push(i18n("AD2E.ItemSave.Line", { name: p.item.name, material: mat, roll: roll.total, total, need,
      result: i18n(ok ? "AD2E.ItemSave.Survives" : "AD2E.ItemSave.DestroyedResult") }));
    if (!ok) await markDestroyed(p.item);
  }
  const head = i18n("AD2E.ItemSave.Card", { name: actor.name, form: i18n(`AD2E.ItemSave.Form.${form}`) })
    + (situational ? ` (${situational > 0 ? "+" : ""}${situational})` : "");
  return ChatMessage.create({ speaker: ChatMessage.getSpeaker({ actor }), rolls,
    content: `<p><strong>${esc(head)}</strong></p><ul>${lines.map(l => `<li>${esc(l)}</li>`).join("")}</ul>` });
}

/** Actors of the controlled tokens, else of the targeted tokens. */
function tokenActors() {
  const controlled = canvas?.tokens?.controlled ?? [];
  const tokens = controlled.length ? controlled : [...(game.user?.targets ?? [])];
  return [...new Set(tokens.map(t => t.actor).filter(Boolean))];
}

/** GM tool: item saves for the selected (or targeted) tokens' actors, one dialog each. */
export async function itemSavesTool() {
  if (!game.user?.isGM) return;
  const actors = tokenActors();
  if (!actors.length) return ui.notifications.warn(i18n("AD2E.ItemSave.SelectTokens"));
  for (const actor of actors) await itemSaveDialog(actor);
}

/**
 * GM tool: falling damage for the targeted (or selected) tokens: 1d6 per full 10 feet, at most 20d6, as a damage message
 * with the apply buttons (`notAttack`: no massive-damage check, a fall is not an attack: implementation choice); then
 * item saves vs. Fall when ticked.
 */
export async function fallingDialog() {
  if (!game.user?.isGM) return;
  const targets = [...(game.user.targets ?? [])];
  const tokens = targets.length ? targets : (canvas?.tokens?.controlled ?? []);
  const refs = tokens.map(t => ({ uuid: t.document?.uuid, name: t.document?.name ?? t.name, actor: t.actor })).filter(t => t.uuid);
  const input = await ad2eDialog.prompt({
    window: { title: i18n("AD2E.Falling.Title") },
    content: `<div class="form-group"><label>${esc(i18n("AD2E.Falling.Distance"))}</label><input type="number" name="distance" value="20" min="0" step="5" autofocus></div>`
      + `<div class="form-group"><label>${esc(i18n("AD2E.ItemSave.Soft"))}</label><input type="checkbox" name="soft"></div>`
      + `<div class="form-group"><label>${esc(i18n("AD2E.Falling.ItemSaves"))}</label><input type="checkbox" name="items" checked></div>`
      + `<p class="ad2e-note">${esc(refs.length ? `${i18n("AD2E.Poison.Targets")}: ${refs.map(r => r.name).join(", ")}` : i18n("AD2E.Falling.NoTargets"))}</p>`,
    ok: { label: i18n("AD2E.Falling.Roll"), callback: (event, button) => ({ distance: Number(button.form.elements.distance.value) || 0,
      soft: !!button.form.elements.soft.checked, items: !!button.form.elements.items.checked }) },
    rejectClose: false
  });
  if (!input) return;
  const n = fallingDice(input.distance);
  const targetsFlag = refs.map(({ uuid, name }) => ({ uuid, name }));
  if (n > 0) {
    const roll = await new Roll(`${n}d${SAVES.falling.die}`).evaluate();
    await roll.toMessage({ speaker: ChatMessage.getSpeaker(), flags: { ad2e: { damage: roll.total, targets: targetsFlag, notAttack: true } },
      flavor: i18n("AD2E.Falling.Flavor", { distance: input.distance, n, names: targetsFlag.map(t => t.name).join(", ") || "—" }) });
  } else {
    await ChatMessage.create({ speaker: ChatMessage.getSpeaker(), content: `<p>${esc(i18n("AD2E.Falling.NoDamage", { distance: input.distance }))}</p>` });
  }
  if (input.items && fallModifier(input.distance, input.soft) !== null) {
    for (const r of refs) if (r.actor) await itemSaveDialog(r.actor, { form: "fall", distance: input.distance, soft: input.soft });
  }
}
