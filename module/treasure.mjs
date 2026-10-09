import { ad2eDialog } from "./dialogs.mjs";
/**
 * Rolling treasure (DMG Appendix 1; tables generated in module/rules/treasure-tables.mjs TREASURE_ROLLS).
 *  - Table 84: each column of a treasure type is present on a d100 roll at or below its chance (no chance listed:
 *    always), the amount uniform in its range ("Either choose ... or roll randomly"); "Platinum or Electrum" is the
 *    GM's choice in the dialog (platinum, electrum, or 50/50 for each type rolled).
 *  - Gems: Table 85 class (d100), a stone of that class from the Gems compendium, and a 10% chance of a Table 86
 *    variation (d6: next higher value and roll again on 1; double; +10-60%; -10-40%; half; next lower value and roll
 *    again on 6; above 5,000 gp values double, at most 100,000 gp; below 10 gp: 5 gp, 1 gp, 5 sp, 1 sp, at most five
 *    places down).
 *  - Objects of art: Table 87 (d100), value uniform in the range.
 *  - Magical items: Table 88 (d100) -> Tables 89-104 (subtable die, then d20), Tables 105-107 (armour type, AC
 *    adjustment, special armours), 108-110 (weapon type, attack adjustment, special weapons). "Any n except weapons"
 *    rerolls Table 88 results of Table 108; type B's "Armor Weapon" rerolls until armour or weapons. Generic names
 *    ("Sword", "Shield", "Pole Arm") pick one PHB item of that kind at random (owner's ruling). Spell scrolls, maps,
 *    special armours and weapons and "DM's Choice" are listed as text.
 *  - Output (owner's ruling): a chat card whispered to the GMs; its button adds coins, gems, art and magical items to
 *    the selected token's actor. Magical items arrive unidentified (module/identify.mjs).
 * The rolling functions are pure: `die(n)` returns 1..n (Foundry rolls in play, a fixed sequence in tests).
 */
import { TREASURE_ROLLS } from "./rules/treasure-tables.mjs";

export const TR = TREASURE_ROLLS;
const DENOMS = ["cp", "sp", "gp", "pp", "ep"];

/** Uniform integer in [lo, hi]. */
export function inRange([lo, hi], die) {
  return lo + die(hi - lo + 1) - 1;
}

/** "1d8" -> sum; a number stays. */
export function diceCount(spec, die) {
  if (typeof spec === "number") return spec;
  const m = String(spec).match(/^(\d*)d(\d+)$/);
  if (!m) return Number(spec) || 0;
  let n = 0;
  for (let i = 0; i < Number(m[1] || 1); i++) n += die(Number(m[2]));
  return n;
}

const pick = (rows, roll) => rows.find(r => roll >= r.min && roll <= r.max);

/** Treasure letters in a stat block's text: "Q (x5), X" -> [{ letter: "Q", times: 5 }, { letter: "X", times: 1 }]. */
export function parseTreasureLetters(text) {
  const out = [];
  for (const m of String(text ?? "").matchAll(/(?<![A-Za-z])([A-Z])(?![A-Za-z])(?:\s*\(?\s*[x×]\s*(\d+)\s*\)?)?/g)) {
    if (TR.types[m[1]]) out.push({ letter: m[1], times: Number(m[2] || 1) });
  }
  return out;
}

/* ---------------------------------------- Gems */

/** The value ladder: Table 86 steps below 10 gp, the Table 85 values, doubling above 5,000 gp up to 100,000 gp. */
function ladder() {
  const steps = [...TR.gemLadder];
  while (steps.at(-1) * 2 <= TR.gemMax) steps.push(steps.at(-1) * 2);
  return steps;
}

/** One stone's value from its class value with a possible Table 86 variation: { value, variation } (text key). */
export function gemValue(base, die) {
  if (die(100) > TR.gemVariationChance) return { value: base, variation: "" };
  const steps = ladder();
  const start = steps.indexOf(base);
  const r = die(6);
  let i = start;
  if (r === 1) {
    do i = Math.min(i + 1, steps.length - 1); while (die(6) === 1 && i < steps.length - 1);
    return { value: steps[i], variation: "up" };
  }
  if (r === 6) {
    do i = Math.max(i - 1, 0, start - TR.maxSteps); while (die(6) === 6 && i > Math.max(0, start - TR.maxSteps));
    return { value: steps[i], variation: "down" };
  }
  const round = v => Math.round(v * 100) / 100;
  if (r === 2) return { value: Math.min(base * 2, TR.gemMax), variation: "double" };
  if (r === 3) return { value: round(base * (1 + die(6) / 10)), variation: "above" };
  if (r === 4) return { value: round(base * (1 - die(4) / 10)), variation: "below" };
  return { value: round(base / 2), variation: "half" };
}

/**
 * `n` gems: [{ identifier, name, gemClass, value, variation, quantity }] grouped by stone and value.
 * @param {Array<{identifier, name, gemClass}>} catalog  the Gems compendium
 */
export function rollGems(n, die, catalog = []) {
  const groups = new Map();
  for (let k = 0; k < n; k++) {
    const cls = pick(TR.gemRolls, die(100)).key;
    const base = TREASURE_CLASS_VALUE[cls];
    const stones = catalog.filter(g => g.gemClass === cls);
    const stone = stones.length ? stones[die(stones.length) - 1] : { identifier: "", name: cls };
    const { value, variation } = gemValue(base, die);
    const key = `${stone.identifier || stone.name}|${value}`;
    const g = groups.get(key) ?? { identifier: stone.identifier, name: stone.name, gemClass: cls, value, variation, quantity: 0 };
    g.quantity += 1;
    groups.set(key, g);
  }
  return [...groups.values()];
}
const TREASURE_CLASS_VALUE = { ornamental: 10, semiprecious: 50, fancy: 100, precious: 500, gem: 1000, jewel: 5000 };

/** `n` objects of art: [{ value, quantity }] grouped by value. */
export function rollArt(n, die) {
  const groups = new Map();
  for (let k = 0; k < n; k++) {
    const value = inRange(pick(TR.artRolls, die(100)).range, die);
    groups.set(value, (groups.get(value) ?? 0) + 1);
  }
  return [...groups].map(([value, quantity]) => ({ value, quantity })).sort((a, b) => b.value - a.value);
}

/* ---------------------------------------- Magical items */

function subtableRow(table, die) {
  const sub = table.die ? pick(table.subtables, diceCount(table.die, die)) : table.subtables[0];
  return pick(sub.rows, die(20));
}

/** A row of Tables 89-104: { kind: "magic", id, name, table } or { kind: "text", text, table }. */
export function rollMagicTable(number, die) {
  const row = subtableRow(TR.magic[number], die);
  return row.id ? { kind: "magic", id: row.id, name: row.name, table: number } : { kind: "text", text: row.text, table: number };
}

/** Tables 105-107: { kind: "armor", base, item, bonus, xp } or { kind: "text", ... } for a special armour. */
export function rollArmor(die) {
  const A = TR.arms;
  const type = pick(A.armor, die(20)).name;
  if (type === "Special") {
    const s = pick(A.specialArmor, die(20));
    return { kind: "text", text: s.name, table: 107 };
  }
  const candidates = TR.baseItems.armor[type];
  const adj = pick(A.acAdjust, die(20));
  return { kind: "armor", base: type, item: candidates[die(candidates.length) - 1], bonus: adj.adj, xp: adj.xp, table: 105 };
}

/** Tables 108-110: { kind: "weapon", base, item, bonus, quantity, xp } or { kind: "text", text, url } for a special weapon. */
export function rollWeapon(die) {
  const A = TR.arms;
  const row = subtableRow(A.weapon, die);
  if (row.name.startsWith("Special")) {
    const s = subtableRow(A.specialWeapons, die);
    return { kind: "text", text: s.text, url: s.url ?? "", table: 110 };
  }
  const candidates = TR.baseItems.weapons[row.base];
  const adj = pick(A.attackAdjust, die(20));
  const sword = row.base === "Sword";
  return { kind: "weapon", base: row.base, item: candidates[die(candidates.length) - 1], bonus: sword ? adj.sword : adj.other,
    xp: sword ? adj.swordXp : adj.otherXp, quantity: row.quantity ? diceCount(row.quantity, die) : 1, table: 108 };
}

/** One Table 88 item; `filter` (key => bool) rerolls categories it rejects. */
export function rollAnyMagic(die, filter = () => true) {
  let cat;
  for (let guard = 0; guard < 100; guard++) {
    cat = pick(TR.magicTable, die(100));
    if (filter(cat.key)) break;
  }
  if (cat.key === "armor") return rollArmor(die);
  if (cat.key === "weapon") return rollWeapon(die);
  return rollMagicTable(cat.table, die);
}

function rollMagicSpec(spec, die) {
  const n = diceCount(spec.count, die);
  const out = [];
  for (let k = 0; k < n; k++) {
    if (spec.kind === "potion") out.push(rollMagicTable(89, die));
    else if (spec.kind === "scroll") out.push(rollMagicTable(90, die));
    else if (spec.kind === "armorWeapon") out.push(rollAnyMagic(die, key => key === "armor" || key === "weapon"));
    else if (spec.kind === "anyNoWeapon") out.push(rollAnyMagic(die, key => key !== "weapon"));
    else out.push(rollAnyMagic(die));
  }
  return out;
}

/* ---------------------------------------- A whole treasure */

/**
 * Roll treasure types: { letters, coins: { cp, sp, gp, pp, ep }, gems, art, magic, rolls: [text per column] }.
 * @param {Array<{letter, times}>} letters
 * @param {{pe?: "pp"|"ep"|"random", die: (n: number) => number, gemCatalog?: Array}} options
 */
export function rollTreasure(letters, { pe = "pp", die, gemCatalog = [] }) {
  const result = { letters, coins: Object.fromEntries(DENOMS.map(d => [d, 0])), gems: [], art: [], magic: [], present: [] };
  let gemCount = 0;
  let artCount = 0;
  for (const { letter, times } of letters) {
    const type = TR.types[letter];
    if (!type) continue;
    for (let t = 0; t < times; t++) {
      for (const [col, entry] of Object.entries(type)) {
        if (entry.chance < 100 && die(100) > entry.chance) continue;
        if (col === "magic") {
          for (const spec of entry.items) result.magic.push(...rollMagicSpec(spec, die));
          result.present.push(`${letter}: magic`);
          continue;
        }
        const n = inRange(entry.range, die);
        result.present.push(`${letter}: ${col} ${n}`);
        if (col === "gems") gemCount += n;
        else if (col === "art") artCount += n;
        else if (col === "pe") result.coins[pe === "random" ? (die(2) === 1 ? "pp" : "ep") : pe] += n;
        else result.coins[col] += n;
      }
    }
  }
  result.gems = rollGems(gemCount, die, gemCatalog);
  result.art = rollArt(artCount, die);
  return result;
}

/** Total gp value of coins, gems and art (Table 42 coin values in gp). */
export function treasureValue(result) {
  const gp = { cp: 0.01, sp: 0.1, ep: 0.5, gp: 1, pp: 5 };
  const coins = DENOMS.reduce((s, d) => s + result.coins[d] * gp[d], 0);
  const gems = result.gems.reduce((s, g) => s + g.value * g.quantity, 0);
  const art = result.art.reduce((s, a) => s + a.value * a.quantity, 0);
  return Math.round((coins + gems + art) * 100) / 100;
}

/* ---------------------------------------- Foundry side */

const esc = v => foundry.utils.escapeHTML?.(String(v ?? "")) ?? String(v ?? "");
/** 1..n from Foundry's uniform generator (CONFIG.Dice.randomUniform, the Mersenne Twister used by dice rolls). */
const foundryDie = n => Math.floor((CONFIG.Dice?.randomUniform?.() ?? Math.random()) * n) + 1;

/** The magical item's display name for the GM's card. */
function magicLabel(m) {
  if (m.kind === "magic") return m.name;
  if (m.kind === "armor" || m.kind === "weapon") {
    const sign = m.bonus >= 0 ? "+" : "";
    return `${m.quantity > 1 ? `${m.quantity} × ` : ""}${m.item} ${sign}${m.bonus}`;
  }
  return m.text;
}

/** Chat card HTML (GM only). */
export function treasureCard(result) {
  const i18n = k => game.i18n.localize(k);
  const fmt = (k, d) => game.i18n.format(k, d);
  const num = n => Number(n).toLocaleString?.() ?? String(n);
  const coins = DENOMS.filter(d => result.coins[d]).map(d => `${num(result.coins[d])} ${d}`).join(", ");
  const gems = result.gems.map(g => `${g.quantity > 1 ? `${g.quantity} × ` : ""}${esc(g.name)} (${num(g.value)} gp${g.variation
    ? `, ${i18n(`AD2E.Treasure.Variation.${g.variation}`)}` : ""})`).join(", ");
  const art = result.art.map(a => `${a.quantity > 1 ? `${a.quantity} × ` : ""}${num(a.value)} gp`).join(", ");
  const magic = result.magic.map(m => `<li>${m.url ? `<a href="${esc(m.url)}" target="_blank" rel="noopener">${esc(magicLabel(m))}</a>`
    : esc(magicLabel(m))}${m.kind === "text" ? ` <em>(${i18n("AD2E.Treasure.NotAdded")})</em>` : ""} <span class="ad2e-note">DMG ${m.table}</span></li>`).join("");
  const letters = result.letters.map(l => (l.times > 1 ? `${l.letter} ×${l.times}` : l.letter)).join(", ");
  return `<div class="ad2e-treasure-card"><h3>${esc(fmt("AD2E.Treasure.CardTitle", { letters }))}</h3><dl>`
    + `<dt>${i18n("AD2E.Treasure.Coins")}</dt><dd>${coins || "—"}</dd>`
    + `<dt>${i18n("AD2E.Treasure.Gems")}</dt><dd>${gems || "—"}</dd>`
    + `<dt>${i18n("AD2E.Treasure.Art")}</dt><dd>${art || "—"}</dd>`
    + `<dt>${i18n("AD2E.Treasure.Magic")}</dt><dd>${magic ? `<ul>${magic}</ul>` : "—"}</dd></dl>`
    + `<p class="ad2e-note">${esc(fmt("AD2E.Treasure.Total", { gp: num(treasureValue(result)) }))}</p></div>`;
}

/** Dialog (GM): treasure letters (from a monster's Treasure field), platinum or electrum; posts the card. */
export async function rollTreasureDialog(actor = null) {
  const i18n = k => game.i18n.localize(k);
  if (!game.user.isGM) return ui.notifications.warn(i18n("AD2E.Treasure.GmOnly"));
  const letters = actor?.system?.treasure ? parseTreasureLetters(actor.system.treasure).map(l => (l.times > 1 ? `${l.letter} x${l.times}` : l.letter)).join(", ") : "";
  const input = await ad2eDialog.prompt({
    window: { title: i18n("AD2E.Treasure.Title") },
    content: `<div class="form-group"><label>${i18n("AD2E.Treasure.Letters")}</label><input type="text" name="letters" value="${esc(letters)}" placeholder="A, Q x5" autofocus></div>`
      + `<p class="ad2e-note">${esc(i18n("AD2E.Treasure.LettersHint"))}${actor?.system?.treasure ? ` ${esc(game.i18n.format("AD2E.Treasure.FromBlock", { text: actor.system.treasure }))}` : ""}</p>`
      + `<div class="form-group"><label>${i18n("AD2E.Treasure.PlatinumOrElectrum")}</label><select name="pe">`
      + ["pp", "ep", "random"].map(k => `<option value="${k}">${i18n(`AD2E.Treasure.PE.${k}`)}</option>`).join("") + "</select></div>",
    ok: { label: i18n("AD2E.Roll.Roll"), callback: (event, button) => ({ letters: button.form.elements.letters.value, pe: button.form.elements.pe.value }) },
    rejectClose: false
  });
  if (!input) return null;
  const parsed = parseTreasureLetters(String(input.letters).toUpperCase().replace(/\bX(?=\s*\d)/g, "x"));
  if (!parsed.length) return ui.notifications.warn(i18n("AD2E.Treasure.NoLetters"));
  const index = await game.packs.get("ad2e.gems")?.getIndex({ fields: ["system.identifier", "system.gemClass"] });
  const gemCatalog = [...(index ?? [])].map(e => ({ identifier: e.system?.identifier, name: e.name, gemClass: e.system?.gemClass }));
  const result = rollTreasure(parsed, { pe: input.pe, die: foundryDie, gemCatalog });
  return ChatMessage.create({ speaker: actor ? ChatMessage.getSpeaker({ actor }) : ChatMessage.getSpeaker(),
    whisper: game.users.filter(u => u.isGM).map(u => u.id), content: treasureCard(result), flags: { ad2e: { treasure: result } } });
}

/** A compendium document's data by identifier (or name), or null. */
async function packData(pack, { identifier, name }) {
  const p = game.packs.get(pack);
  if (!p) return null;
  const index = await p.getIndex({ fields: ["system.identifier"] });
  const entry = index.find(e => (identifier && e.system?.identifier === identifier) || (!identifier && e.name === name));
  return entry ? (await p.getDocument(entry._id))?.toObject() ?? null : null;
}

/**
 * Add a rolled treasure to an actor: coins (onto its coin items), gems, objects of art, magical items, armour and
 * weapons (unidentified, with their magical bonus). Text entries are not added. Returns the number of items created.
 */
export async function addTreasureToActor(result, actor) {
  const create = [];
  const updates = [];
  for (const d of DENOMS) {
    const n = result.coins[d];
    if (!n) continue;
    const have = actor.items.find(i => i.type === "coin" && i.system.denomination === d && !i.system.container);
    if (have) updates.push({ _id: have.id, "system.quantity": have.system.quantity + n });
    else {
      const data = await packData("ad2e.equipment", { identifier: d });
      if (data) create.push(foundry.utils.mergeObject(data, { system: { quantity: n } }));
    }
  }
  for (const g of result.gems) {
    const data = g.identifier ? await packData("ad2e.gems", { identifier: g.identifier }) : null;
    create.push(data ? foundry.utils.mergeObject(data, { system: { quantity: g.quantity, value: g.value } })
      : { name: g.name, type: "jewellery", system: { kind: "gem", gemClass: g.gemClass, value: g.value, quantity: g.quantity } });
  }
  for (const a of result.art) {
    create.push({ name: game.i18n.localize("AD2E.Treasure.ArtObject"), type: "jewellery", img: "icons/svg/item-bag.svg",
      system: { kind: "art", value: a.value, quantity: a.quantity } });
  }
  for (const m of result.magic) {
    if (m.kind === "magic") {
      const data = await packData("ad2e.magic-items", { identifier: m.id });
      if (data) create.push(foundry.utils.mergeObject(data, { system: { identified: false, unidentifiedName: "" } }));
    } else if (m.kind === "armor" || m.kind === "weapon") {
      const data = await packData(m.kind === "armor" ? "ad2e.armor" : "ad2e.weapons", { name: m.item });
      if (!data) continue;
      const sign = m.bonus >= 0 ? "+" : "";
      create.push(foundry.utils.mergeObject(data, { name: `${m.item} ${sign}${m.bonus}`, system: {
        identified: false, unidentifiedName: m.item, quantity: m.quantity ?? 1,
        bonus: m.kind === "armor" ? m.bonus : { hit: m.bonus, dmg: m.bonus } } }));
    }
  }
  if (updates.length) await actor.updateEmbeddedDocuments("Item", updates);
  if (create.length) await actor.createEmbeddedDocuments("Item", create);
  return create.length + updates.length;
}

/** Button under a treasure card (GM): add it to the selected token's actor (once). */
export function treasureButtons(message, html) {
  const result = message?.getFlag?.("ad2e", "treasure");
  if (!result || !game.user?.isGM || !html?.querySelector) return;
  const added = message.getFlag("ad2e", "treasureAdded");
  const box = document.createElement("div");
  box.className = "ad2e-damage-buttons";
  if (added) box.innerHTML = `<span class="ad2e-note">${esc(game.i18n.format("AD2E.Treasure.Added", { name: added }))}</span>`;
  else {
    box.innerHTML = `<button type="button"><i class="fa-solid fa-sack-dollar"></i> ${esc(game.i18n.localize("AD2E.Treasure.AddSelected"))}</button>`;
    box.querySelector("button").addEventListener("click", async ev => {
      ev.preventDefault();
      ev.stopPropagation();
      const actor = canvas?.tokens?.controlled?.[0]?.actor ?? null;
      if (!actor) return ui.notifications.warn(game.i18n.localize("AD2E.Treasure.SelectToken"));
      await addTreasureToActor(result, actor);
      await message.setFlag("ad2e", "treasureAdded", actor.name);
    });
  }
  (html.querySelector(".message-content") ?? html).append(box);
}
