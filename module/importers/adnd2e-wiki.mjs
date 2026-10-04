/**
 * Reader for spells on the AD&D 2e fandom wiki (https://adnd2e.fandom.com/), through its MediaWiki API. The API
 * answers browser requests from any origin when called with `origin=*` (access-control-allow-origin: *), so the GM's
 * browser can query it from a Foundry world. Shared with tools/build-spell-data.py (example spells).
 * - source books: categories "Spells from <book>";
 * - spells: pages in those categories with an {{Infobox Spells}} (class, school, sphere, level, verbal/somatic/
 *   material, range, aoe, castingTime, duration, save).
 * Only the infobox (game mechanics) and a link to the page are imported; spell descriptions are not.
 */
import { matchComponents } from "./spell-components.mjs";
import { damageFormula } from "./spell-damage.mjs";
import { SPELL_PROVINCES } from "../rules/province-tables.mjs";

/** School element tags ("Invocation/Evocation (Fire)") as Al-Qadim provinces. */
const ELEMENT_PROVINCE = { fire: "flame", water: "sea", air: "wind", earth: "sand" };

/** Elemental provinces of a spell: Wizard Spells by Province (AA), and element tags in its school or sphere box. */
export function provincesOf(title, box = {}) {
  const out = new Set(SPELL_PROVINCES[title] ?? []);
  for (const v of [box.school, box.sphere]) {
    for (const m of String(v ?? "").matchAll(/\(([A-Za-z]+)\)/g)) {
      const p = ELEMENT_PROVINCE[m[1].toLowerCase()];
      if (p) out.add(p);
    }
  }
  return [...out];
}
export const WIKI = "https://adnd2e.fandom.com";
export const API = `${WIKI}/api.php`;
export const BOOK_PREFIX = "Spells from ";

/** API URL for query parameters (format=json, origin=* for cross-origin browser requests). */
export function apiUrl(params) {
  return `${API}?${new URLSearchParams({ ...params, format: "json", origin: "*" })}`;
}

export const pageUrl = title => `${WIKI}/wiki/${encodeURIComponent(title.replace(/ /g, "_")).replace(/%2F/g, "/")}`;

const slug = s => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

/** Wiki markup to plain text: links, templates, refs, tags, bold/italic quotes. */
export function unwiki(v) {
  return String(v ?? "")
    .replace(/\[\[(?:[^\]|]*\|)?([^\]]*)\]\]/g, "$1")
    .replace(/\{\{frac\|(\d+)\|(\d+)\}\}/g, "$1/$2")
    .replace(/<ref[\s\S]*?(<\/ref>|\/>)/g, "")
    .replace(/<[^>]+>|'''?|\{\{[^}]*\}\}/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Source tag at the end of a value ("1 - 5 targets - PHB", "Law - PSC"): the tag, or null. */
const sourceTag = v => v.match(/\s+-\s+([A-Z][A-Za-z&]{1,5})\s*$/)?.[1] ?? null;
const stripTag = v => v.replace(/\s+-\s+[A-Z][A-Za-z&]{1,5}\s*$/, "").trim();

/** First of several values ("PHB value{{br}}''(WSC value)''"), without a trailing source tag. */
export function first(v) {
  return stripTag(unwiki(String(v ?? "").split(/\{\{br\}\}|<br\s*\/?>/i)[0]).replace(/^[\s;,]+|[\s;,]+$/g, ""));
}

/**
 * All values of a multi-value field (schools, spheres): split on line breaks and commas, keeping school names such
 * as "Enchantment/Charm" whole; italic entries (alternates from later books) and entries tagged with another book
 * ("Law - PSC") are left out.
 */
export function values(v) {
  return String(v ?? "").split(/\{\{br\}\}|<br\s*\/?>|,/i)
    .filter(p => !p.trim().startsWith("''"))
    .map(p => unwiki(p).replace(/^[\s()]+|[\s()]+$/g, ""))
    .filter(p => p && (!sourceTag(p) || sourceTag(p) === "PHB"))
    .map(stripTag);
}

/** The {{Infobox Spells}} fields of a page, or null (an empty field must not run onto the next line). */
export function infobox(wiki) {
  const m = String(wiki ?? "").match(/\{\{Infobox Spells([\s\S]*?)\n\}\}/);
  if (!m) return null;
  return Object.fromEntries([...m[1].matchAll(/^\|[ \t]*(\w+)[ \t]*=[ \t]*(.*)$/gm)].map(x => [x[1].trim(), x[2].trim()]));
}

/** Spell level: a number; cantrips/orisons 0; quest spells and other non-numeric levels null. */
export function levelOf(v, categories = []) {
  const t = first(v).toLowerCase();
  const m = t.match(/^(\d+)/);
  if (m) return Number(m[1]);
  if (/cantrip|orison/.test(t) || categories.some(c => /Wizard Cantrips|Priest Orisons/.test(c))) return 0;
  return null;
}

/** Source books from the page categories ("Spells from Players Handbook" -> "Players Handbook"). */
export function booksOf(categories) {
  return categories.filter(c => c.startsWith(BOOK_PREFIX)).map(c => c.slice(BOOK_PREFIX.length));
}

/**
 * Spell item data from a wiki page, or null when the page has no usable infobox.
 * @param {string} title       page title, e.g. "Magic Missile (Wizard Spell)"
 * @param {string} wiki        page wikitext
 * @param {string[]} categories category titles without the "Category:" prefix
 * @param {Array<{identifier: string, name: string}>|null} components spell component items to link (POSM Table 16)
 */
export function spellItemData(title, wiki, categories = [], components = null) {
  const box = infobox(wiki);
  if (!box) return null;
  const level = levelOf(box.level, categories);
  if (level === null) return null;
  const cls = first(box.class).toLowerCase();
  const kind = /priest/.test(cls) || /\(Priest Spell\)|\(Orison\)/.test(title) || categories.includes("Priest Spells") && !/wizard/.test(cls)
    ? "priest" : "wizard";
  const rawName = first(box.name) || title.replace(/\s*\([^)]*\)\s*$/, "");
  const reversible = /reversible/i.test(box.name ?? "") || categories.includes("Reversible Spells");
  const name = rawName.replace(/\s*\(Reversible\)\s*/i, "").trim();
  const flag = v => String(v ?? "").trim() === "1";
  return {
    name,
    type: "spell",
    img: kind === "priest" ? "icons/svg/sun.svg" : "icons/svg/book.svg",
    system: {
      identifier: slug(title), kind, level,
      schools: values(box.school), spheres: values(box.sphere), reversible,
      components: { verbal: flag(box.verbal), somatic: flag(box.somatic), material: flag(box.material) },
      // Links to component items (module/importers/spell-components.mjs) when a component catalog is given.
      materials: components && flag(box.material) ? matchComponents(wiki, components) : [],
      provinces: provincesOf(title, box), damage: damageFormula(title, wiki),
      range: first(box.range), area: first(box.aoe), castingTime: first(box.castingTime),
      duration: first(box.duration), save: first(box.save),
      sources: booksOf(categories), url: pageUrl(title), prepared: 0, cast: 0, notes: ""
    },
    flags: { ad2e: { wiki: { title } } }
  };
}
