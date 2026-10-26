import { BUTCHER_PROFS, CATEGORIES, CREATURES, DEFAULT_ENTRY, EXTRA_RATIONS, KEEP, MEAT_ID, MODIFIERS, NORMAL, SOURCES, THEMES } from "./rules/menu-tables.mjs";
import { FORAGE } from "./rules/forage-tables.mjs";
import { ad2eDialog } from "./dialogs.mjs";
import { dialogModifier } from "./roll-modifiers.mjs";
import { createSaveRequest, registerSaveHandler } from "./save-requests.mjs";
import { partyActors } from "./party.mjs";
import { zakharanDate } from "./calendar.mjs";
import { coreDateText } from "./timekeeper.mjs";

/**
 * Monster menu (owner's request 1.0.73, world setting `monsterMenu`, off by default; data and sources in
 * module/rules/menu-tables.mjs). Owner's rulings: original AD&D effects and flavour (the posts it follows carry no licence),
 * meat is food only (a ration a day; hit points change only through the menu rolls), rations by size from Complete
 * Barbarian's Handbook Table 33 with a butchering check (the best of Hunting, Survival, Cooking; failed or none: half the
 * meat spoils), Monstrous Manual creatures only.
 * Butchering (monster sheet button, or game.ad2e.butcher() on the targeted token): the butcher is a character the user owns
 * (the GM: the party or a player character); the meat is an equipment item "Meat: <creature>" (identifier MEAT_ID, 1 lb and
 * one day of food a unit, flag `ad2e.meat` { source, uuid, key, category, theme, flavour, at, preservedAt, cooked }); the
 * card's flag `ad2e.butchered` lets the active GM mark the monster (flag `ad2e.butchered`) when the user cannot.
 * Meat keeps KEEP.freshDays, or KEEP.preservedDays after "Preserve" (salted or smoked); then it is rotten (-4).
 * "Cook": a Cooking check makes it well cooked (+1); without Cooking it is cooked without a bonus. "Eat" (or a travel day,
 * module/travel-days.mjs) uses one ration, counts as the day's food (character `system.survival.fedAt`) and rolls the
 * creature's table: d6 normal meat or the theme's d10, + the modifiers; a world roll table flagged `ad2e.menuTable` (GM tool
 * "Create editable menu tables") replaces the built-in texts and ranges. Results are whispered to the GM; saves are
 * requested on a card (kind "meal": damage on a failed save, half on a made one when `half`), healing applied at once.
 */
export const DAY = 86400;
const i18n = (k, d) => (d ? game.i18n.format(k, d) : game.i18n.localize(k));
const esc = v => String(v ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

export function menuOn() {
  try { return !!game.settings.get("ad2e", "monsterMenu"); } catch { return false; }
}

/** A name for matching (pure): lower case, straight apostrophes, no "(...)" notes. */
export function normalizeName(name) {
  return String(name ?? "").toLowerCase().replace(/[‘’ʼ]/g, "'").replace(/\s*\([^)]*\)/g, "").replace(/\s+/g, " ").trim();
}

/** "spider, phase" -> "phase spider" (pure; names without a comma unchanged). */
export function reversedName(name) {
  const parts = String(name).split(/\s*,\s*/);
  return parts.length === 2 ? `${parts[1]} ${parts[0]}` : name;
}

/** The menu entry for a creature name (pure): the first CREATURES entry matching the name or its reversed form. */
export function creatureFor(name) {
  const n = normalizeName(name);
  const forms = [n, reversedName(n)];
  return CREATURES.find(c => forms.some(f => new RegExp(c.match).test(f))) ?? DEFAULT_ENTRY;
}

/**
 * A monster's menu (pure): the entry from its name with the monster's own settings (`system.menu` { category, theme,
 * flavour }, "" = automatic) on top. { key, category, theme ("" = normal meat), flavour ("" = the entry's text), auto }
 */
export function menuOf(actor) {
  const entry = creatureFor(actor?.name);
  const own = actor?.system?.menu ?? {};
  const category = CATEGORIES.includes(own.category) ? own.category : entry.category;
  let theme = own.theme === "normal" ? "" : (THEMES[own.theme] ? own.theme : (entry.theme ?? ""));
  if (category !== "special" && !THEMES[own.theme]) theme = "";
  return { key: entry.key, category, theme, flavour: String(own.flavour ?? "").trim(), auto: entry };
}

/** The flavour text of a menu (pure with `t`). */
export const flavourText = (menu, t) => menu.flavour || t(`AD2E.Menu.Flavour.${menu.key}`);

/** A size letter from a monster's size text (pure): the first of T S M L H G, else M. */
export function sizeLetter(text) {
  const m = String(text ?? "").trim().toUpperCase().match(/^[TSMLHG]/);
  return m ? m[0] : "M";
}

/** Rations formula for a size (pure): Table 33 (S-H), EXTRA_RATIONS for T and G; `rending` = Animal Rending. */
export function rationFormula(size, rending = false) {
  const row = FORAGE.hunting.rations[size] ?? EXTRA_RATIONS[size] ?? FORAGE.hunting.rations.M;
  return rending ? row.rending : row.average;
}

/** The butcher's best check (pure): { identifier, name, target } from the proficiency entries, or null. */
export function butcherCheck(actor) {
  const entries = actor?.system?.proficiencies?.entries ?? [];
  let best = null;
  for (const e of entries) {
    const id = e.item?.system?.identifier;
    if (!BUTCHER_PROFS.includes(id) || !Number.isFinite(e.target)) continue;
    if (!best || e.target > best.target) best = { identifier: id, name: e.item.name, target: e.target };
  }
  return best;
}

/** Rations kept (pure): all on a success, half (rounded down) otherwise. */
export const keptRations = (total, success) => (success ? total : Math.floor(total / 2));

/** A proficiency check (pure): d20 under or equal to the target, a 20 always fails (Using Nonweapon Proficiencies (PHB)). */
export const checkPasses = (roll, target) => roll < 20 && roll <= target;

/** The time a meat flag stops being good (pure). */
export function goodUntil(meat) {
  if (Number.isFinite(meat?.preservedAt)) return meat.preservedAt + KEEP.preservedDays * DAY;
  return (Number(meat?.at) || 0) + KEEP.freshDays * DAY;
}

export const isRotten = (meat, now) => now > goodUntil(meat);

/** Roll modifiers (pure): [{ key, n }] for well cooked, rotten, starving. */
export function mealModifiers({ cooked = "", rotten = false, starving = false } = {}) {
  const out = [];
  if (cooked === "well") out.push({ key: "Cooked", n: MODIFIERS.well });
  if (rotten) out.push({ key: "Rotten", n: MODIFIERS.rotten });
  if (starving) out.push({ key: "Starving", n: MODIFIERS.starving });
  return out;
}

/** The built-in table of a theme ("" = normal meat) (pure). */
export const tableFor = theme => (theme && THEMES[theme]) || NORMAL;

/** The table key used in lang keys and table flags (pure). */
export const tableKey = theme => (theme && THEMES[theme] ? theme : "normal");

/** The result index for a modified total (pure): the band containing it (bands cover every total). */
export function resultIndex(table, total) {
  const i = table.results.findIndex(r => total >= r.range[0] && total <= r.range[1]);
  if (i >= 0) return i;
  return total < table.results[0].range[0] ? 0 : table.results.length - 1;
}

/** Whether a character is starving (pure): days without food on the road (module/travel-days.mjs). */
export const isStarving = actor => actor?.type === "character" && (actor.system?.survival?.food ?? 0) > 0;

/** World roll tables made by "Create editable menu tables" (pure over a list): Map table key -> table. */
export function worldMenuTables(tables) {
  const out = new Map();
  for (const t of tables ?? []) {
    const key = t.getFlag?.("ad2e", "menuTable") ?? t.flags?.ad2e?.menuTable;
    if (key && !out.has(key)) out.set(key, t);
  }
  return out;
}

/** Result data for a world roll table (pure with `t`): built-in ranges clamped to the die, flagged with their mechanics. */
export function tableResultData(key, t) {
  const table = key === "normal" ? NORMAL : THEMES[key];
  return table.results.map((r, index) => {
    const text = t(`AD2E.Menu.Effect.${key}.${index}`);
    return { type: "text", name: text, description: text, weight: 1,
      range: [Math.max(r.range[0], 1), Math.min(r.range[1], table.die)], flags: { ad2e: { menuEffect: { table: key, index } } } };
  });
}

/** A date for meat labels: Zakharan when on, else the world calendar's. */
function dateOf(t) {
  const z = zakharanDate(t);
  if (z) return z;
  try { return coreDateText(game.time.calendar.timeToComponents(t), game.time.calendar, i18n); } catch { return String(t); }
}

/** A meat item's state line: cooked / raw, fresh or preserved until, or rotten. */
export function meatStatus(item, now = game.time?.worldTime ?? 0) {
  const meat = item?.getFlag?.("ad2e", "meat") ?? item?.flags?.ad2e?.meat;
  if (!meat) return "";
  const cooked = i18n(meat.cooked === "well" ? "AD2E.Menu.WellCooked" : meat.cooked ? "AD2E.Menu.Cooked" : "AD2E.Menu.Raw");
  const keep = isRotten(meat, now) ? i18n("AD2E.Menu.Rotten")
    : i18n(Number.isFinite(meat.preservedAt) ? "AD2E.Menu.Preserved" : "AD2E.Menu.Fresh", { date: dateOf(goodUntil(meat)) });
  return `${cooked}, ${keep}`;
}

/** Characters who may butcher: the user's own characters; the GM's: the party's characters, else player characters. */
export function butcherCandidates() {
  const own = (game.actors?.contents ?? []).filter(a => a.type === "character" && a.isOwner && !game.user?.isGM);
  if (!game.user?.isGM) return own;
  const party = partyActors().filter(a => a.type === "character");
  return party.length ? party : (game.actors?.contents ?? []).filter(a => a.type === "character" && a.hasPlayerOwner);
}

const isDead = actor => !!actor?.system?.hp?.dead || (actor?.system?.hp?.value ?? 1) <= 0;

/** The first targeted, else selected, token's monster. */
function chosenMonster() {
  const t = [...(game.user?.targets ?? [])][0] ?? globalThis.canvas?.tokens?.controlled?.[0];
  return t?.actor?.type === "monster" ? t.actor : null;
}

/** Butcher a slain monster (dialog: butcher and a situational modifier). */
export async function butcher(monster = chosenMonster()) {
  if (!menuOn()) return ui.notifications.warn(i18n("AD2E.Menu.Off"));
  if (!monster) return ui.notifications.warn(i18n("AD2E.Menu.Select"));
  if (monster.getFlag?.("ad2e", "butchered")) return ui.notifications.warn(i18n("AD2E.Menu.AlreadyButchered", { name: monster.name }));
  if (!isDead(monster)) return ui.notifications.warn(i18n("AD2E.Menu.Alive", { name: monster.name }));
  const menu = menuOf(monster);
  if (menu.category === "inedible") {
    return ChatMessage.implementation.create({ speaker: ChatMessage.getSpeaker(),
      content: `<p>${esc(i18n("AD2E.Menu.NothingToEat", { name: monster.name }))} ${esc(flavourText(menu, i18n))}</p>` });
  }
  const candidates = butcherCandidates();
  if (!candidates.length) return ui.notifications.warn(i18n("AD2E.Menu.NoButcher"));
  const options = candidates.map(a => {
    const c = butcherCheck(a);
    return `<option value="${a.uuid}">${esc(a.name)}${c ? ` (${esc(c.name)} ${c.target})` : ""}</option>`;
  }).join("");
  const input = await ad2eDialog.prompt({
    window: { title: i18n("AD2E.Menu.ButcherTitle", { name: monster.name }) },
    content: `<div class="form-group"><label>${esc(i18n("AD2E.Menu.Butcherer"))}</label><select name="butcher">${options}</select></div>`
      + `<div class="form-group"><label>${esc(i18n("AD2E.Roll.Modifier"))}</label><input type="text" class="ad2e-signed" name="mod" value="0"></div>`,
    ok: { label: i18n("AD2E.Menu.Butcher"), callback: (event, button) => ({ uuid: button.form.elements.butcher.value,
      mod: dialogModifier(button.form.elements.mod.value) }) },
    rejectClose: false
  });
  if (!input) return null;
  const who = candidates.find(a => a.uuid === input.uuid) ?? candidates[0];
  const mod = input.mod;
  return butcherWith(monster, who, mod);
}

/** Butchering itself (after the dialog). */
export async function butcherWith(monster, who, mod = 0) {
  const menu = menuOf(monster);
  const size = sizeLetter(monster.system?.size);
  const rending = !!who.items?.some(i => i.type === "proficiency" && i.system?.identifier === FORAGE.hunting.rending);
  const formula = rationFormula(size, rending);
  const rations = await new Roll(formula).evaluate();
  const lines = [i18n("AD2E.Menu.SizeLine", { size, formula, rending: rending ? i18n("AD2E.Menu.Rending") : "" })];
  const check = butcherCheck(who);
  let success = false;
  const rolls = [rations];
  if (check) {
    const d = await new Roll("1d20").evaluate();
    rolls.push(d);
    const target = check.target + mod;
    success = checkPasses(d.total, target);
    lines.push(i18n("AD2E.Menu.Check", { name: who.name, prof: check.name, roll: d.total, target,
      result: i18n(success ? "AD2E.Roll.Success" : "AD2E.Roll.Failure") }));
  } else lines.push(i18n("AD2E.Menu.NoCheck", { name: who.name }));
  const total = Math.max(rations.total, 0);
  const kept = keptRations(total, success);
  lines.push(success ? i18n("AD2E.Menu.Kept", { total }) : i18n("AD2E.Menu.Spoilt", { kept, total }));
  if (menu.category === "people") lines.push(i18n("AD2E.Menu.PeopleNote"));
  if (kept > 0) {
    await who.createEmbeddedDocuments("Item", [{ name: i18n("AD2E.Menu.MeatName", { name: monster.name }), type: "equipment",
      system: { identifier: MEAT_ID, quantity: kept, weight: 1, category: "gear", notes: flavourText(menu, i18n) },
      flags: { ad2e: { meat: { source: monster.name, uuid: monster.uuid, key: menu.key, category: menu.category, theme: menu.theme,
        flavour: menu.flavour, at: game.time?.worldTime ?? 0, preservedAt: null, cooked: "" } } } }]);
  }
  if (monster.isOwner) await monster.setFlag("ad2e", "butchered", true);
  return ChatMessage.implementation.create({
    speaker: ChatMessage.getSpeaker({ actor: who }), rolls,
    content: `<p><strong>${esc(i18n("AD2E.Menu.Result", { butcher: who.name, name: monster.name, n: kept }))}</strong></p>`
      + lines.map(l => `<p>${esc(l)}</p>`).join("") + `<p class="ad2e-note">${esc(flavourText(menu, i18n))}</p>`,
    flags: { ad2e: { butchered: { uuid: monster.uuid } } }
  });
}

const meatOf = item => item?.getFlag?.("ad2e", "meat") ?? null;

/** Cook a meat stack: a Cooking check makes it well cooked. */
export async function cookMeat(actor, item) {
  const meat = meatOf(item);
  if (!meat) return null;
  const entry = (actor.system?.proficiencies?.entries ?? []).find(e => e.item?.system?.identifier === "cooking" && Number.isFinite(e.target));
  let cooked = "cooked";
  let text = i18n("AD2E.Menu.CookPlain", { name: actor.name, meat: item.name });
  const rolls = [];
  if (entry) {
    const d = await new Roll("1d20").evaluate();
    rolls.push(d);
    const ok = checkPasses(d.total, entry.target);
    if (ok) cooked = "well";
    text = i18n("AD2E.Menu.CookCheck", { name: actor.name, meat: item.name, roll: d.total, target: entry.target,
      result: i18n(ok ? "AD2E.Roll.Success" : "AD2E.Roll.Failure") });
  }
  await item.setFlag("ad2e", "meat", { ...meat, cooked });
  return ChatMessage.implementation.create({ speaker: ChatMessage.getSpeaker({ actor }), rolls, content: `<p>${esc(text)}</p>` });
}

/** Salt or smoke a meat stack: it keeps KEEP.preservedDays from now. */
export async function preserveMeat(actor, item) {
  const meat = meatOf(item);
  if (!meat) return null;
  const now = game.time?.worldTime ?? 0;
  if (isRotten(meat, now)) return ui.notifications.warn(i18n("AD2E.Menu.RottenCannot", { meat: item.name }));
  const next = { ...meat, preservedAt: now };
  await item.setFlag("ad2e", "meat", next);
  return ChatMessage.implementation.create({ speaker: ChatMessage.getSpeaker({ actor }),
    content: `<p>${esc(i18n("AD2E.Menu.PreservedDone", { name: actor.name, meat: item.name, date: dateOf(goodUntil(next)) }))}</p>` });
}

/** Eat one ration of a meat stack (the "Eat" button): a day's food and the menu roll. */
export async function eatMeat(actor, item) {
  const meat = meatOf(item);
  if (!meat || (item.system?.quantity ?? 0) < 1) return null;
  const snapshot = { name: item.name, meat };
  const q = item.system.quantity - 1;
  if (q > 0) await item.update({ "system.quantity": q });
  else await item.delete();
  if (actor.type === "character") await actor.update({ "system.survival.fedAt": game.time?.worldTime ?? 0 });
  return mealEffect(actor, snapshot);
}

/** The menu roll for one ration eaten by `eater` (from "Eat" or a travel day); `meal` = { name, meat }. */
export async function mealEffect(eater, { name, meat }, { travel = false } = {}) {
  if (!menuOn() || !meat) return null;
  const now = game.time?.worldTime ?? 0;
  const menu = { key: meat.key || "unknown", flavour: meat.flavour ?? "" };
  const key = tableKey(meat.theme);
  const table = tableFor(meat.theme);
  const mods = mealModifiers({ cooked: meat.cooked, rotten: isRotten(meat, now), starving: isStarving(eater) });
  const roll = await new Roll(`1d${table.die}`).evaluate();
  const modSum = mods.reduce((n, m) => n + m.n, 0);
  const total = roll.total + modSum;
  // The GM's edited table, when there is one: its result text (and the built-in mechanics its result is flagged with).
  const world = worldMenuTables(game.tables?.contents).get(key);
  let index = resultIndex(table, total);
  let text = i18n(`AD2E.Menu.Effect.${key}.${index}`);
  let mechanics = table.results[index];
  if (world) {
    const clamped = Math.min(Math.max(total, 1), table.die);
    const result = world.getResultsForRoll?.(clamped)?.[0];
    const flag = result?.getFlag?.("ad2e", "menuEffect") ?? result?.flags?.ad2e?.menuEffect;
    text = result?.description || result?.name || result?.text || text;
    if (flag?.table === key && table.results[flag.index]) { index = flag.index; mechanics = table.results[index]; }
    else mechanics = {};
  }
  const modText = mods.map(m => ` ${m.n > 0 ? "+" : "−"}${Math.abs(m.n)} (${i18n(`AD2E.Menu.Mod${m.key}`)})`).join("");
  const speaker = ChatMessage.getSpeaker({ actor: eater });
  const gm = ChatMessage.getWhisperRecipients?.("GM")?.map(u => u.id) ?? [];
  await ChatMessage.implementation.create({ speaker,
    content: `<p>${esc(i18n(travel ? "AD2E.Menu.TravelAte" : "AD2E.Menu.Ate", { name: eater.name, meat: name, flavour: flavourText(menu, i18n) }))}`
      + `${travel ? ` ${esc(flavourText(menu, i18n))}` : ""}</p>` });
  const extra = [];
  if (mechanics.heal) {
    const h = await new Roll(mechanics.heal).evaluate();
    if (eater.isOwner && typeof eater.applyHealing === "function") await eater.applyHealing(h.total);
    extra.push(i18n("AD2E.Menu.Healed", { name: eater.name, n: h.total }));
  }
  if (mechanics.lost && !mechanics.save) extra.push(i18n("AD2E.Menu.MealLost"));
  await ChatMessage.implementation.create({ speaker, whisper: gm, rolls: [roll],
    content: `<p>${esc(i18n("AD2E.Menu.GmRoll", { name: eater.name, meat: name, table: i18n(`AD2E.Menu.Theme.${key}`), roll: roll.total,
      mods: modText, total, effect: text }))}</p>${extra.map(l => `<p>${esc(l)}</p>`).join("")}`
      + `<p class="ad2e-note"><a href="${SOURCES.part1}" target="_blank" rel="noopener">Monster Menu (Coins and Scrolls)</a></p>` });
  if (mechanics.save) {
    const token = eater.getActiveTokens?.()[0]?.document;
    await createSaveRequest({ speaker, key: mechanics.save, kind: "meal",
      title: i18n("AD2E.Menu.SaveTitle", { name: eater.name, save: i18n(`AD2E.Save.${mechanics.save}`) }),
      targets: [{ uuid: token?.uuid ?? eater.uuid, name: eater.name }],
      data: { meat: name, table: key, index, text, damage: mechanics.damage ?? "", half: !!mechanics.half, lost: !!mechanics.lost } });
  }
  return { roll: roll.total, total, index, text };
}

/** Save results of a meal (save request kind "meal", active GM): damage on a failure (half on a success when `half`). */
export async function mealSave(actor, request, index, success) {
  const d = request.data ?? {};
  const gm = ChatMessage.getWhisperRecipients?.("GM")?.map(u => u.id) ?? [];
  const target = [{ uuid: request.targets?.[index]?.uuid ?? actor.uuid, name: actor.name }];
  if (d.damage && (!success || d.half)) {
    const r = await new Roll(d.damage).evaluate();
    const amount = success ? Math.floor(r.total / 2) : r.total;
    return r.toMessage({ whisper: gm, speaker: ChatMessage.getSpeaker({ actor }),
      flags: { ad2e: { damage: amount, targets: target, notAttack: true } },
      flavor: i18n(success ? "AD2E.Menu.SaveHalfDamage" : "AD2E.Menu.SaveFailedDamage", { name: actor.name, meat: d.meat, damage: amount })
        + (d.lost && !success ? ` ${i18n("AD2E.Menu.MealLost")}` : "") });
  }
  const text = success ? i18n("AD2E.Menu.SaveMade", { name: actor.name, meat: d.meat })
    : i18n("AD2E.Menu.SaveFailed", { name: actor.name, meat: d.meat, effect: d.text }) + (d.lost ? ` ${i18n("AD2E.Menu.MealLost")}` : "");
  return ChatMessage.implementation.create({ whisper: gm, speaker: ChatMessage.getSpeaker({ actor }), content: `<p>${esc(text)}</p>` });
}

/** GM tool: the normal-meat and themed tables as world roll tables in a "Monster menu" folder, for editing. */
export async function createMenuTables() {
  if (!game.user?.isGM) return null;
  const have = worldMenuTables(game.tables?.contents);
  if (have.size) { ui.notifications.warn(i18n("AD2E.Menu.TablesExist", { n: have.size })); return null; }
  const folderName = i18n("AD2E.Menu.FolderName");
  const folder = game.folders?.find(f => f.type === "RollTable" && f.name === folderName)
    ?? await Folder.implementation.create({ name: folderName, type: "RollTable" });
  const data = ["normal", ...Object.keys(THEMES)].map(key => ({
    name: i18n("AD2E.Menu.TableName", { theme: i18n(`AD2E.Menu.Theme.${key}`) }), folder: folder?.id ?? null,
    formula: `1d${(key === "normal" ? NORMAL : THEMES[key]).die}`, replacement: true, displayRoll: true,
    description: i18n("AD2E.Menu.MakeTablesHint"), flags: { ad2e: { menuTable: key } }, results: tableResultData(key, i18n)
  }));
  const made = await RollTable.implementation.createDocuments(data);
  ui.notifications.info(i18n("AD2E.Menu.TablesMade", { n: made.length, folder: folderName }));
  return made;
}

/** World setting, the "meal" save handler and the active GM's marking of butchered monsters. Called in init. */
export function registerMonsterMenu() {
  game.settings.register("ad2e", "monsterMenu", {
    name: "AD2E.Menu.Setting", hint: "AD2E.Menu.SettingHint", scope: "world", config: true, type: Boolean, default: false
  });
  registerSaveHandler("meal", mealSave);
  Hooks.on("createChatMessage", async message => {
    if (!game.user?.isActiveGM) return;
    const uuid = message.getFlag?.("ad2e", "butchered")?.uuid;
    if (!uuid) return;
    const doc = (foundry.utils.fromUuidSync ?? globalThis.fromUuidSync)?.(uuid, { strict: false });
    const actor = doc?.actor ?? doc;
    if (actor?.setFlag && !actor.getFlag?.("ad2e", "butchered")) await actor.setFlag("ad2e", "butchered", true);
  });
}
