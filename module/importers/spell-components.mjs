/**
 * Material components of a spell page, linked to component items at import (pure; used by the in-world spell importer
 * and tools/spell-items.mjs). Only the links are stored, never the page's text.
 *  - Text: the sentences of the page that name its material components ("The material component(s) ...", or "requires"
 *    with components, holy water or a holy symbol: "the bless spell requires holy water").
 *  - Holy symbols ("holy symbol", "religious symbol", "unholy symbol") link the PHB holy item and are never consumed
 *    (owner's ruling); holy or unholy water links the same item and is consumed.
 *  - Other items: POSM Table 16 component names ("Bell, tiny" also matches "tiny bell"; plurals), longest match first,
 *    a shorter name inside a longer match is dropped ("acid" within "citric acid").
 *  - Consumed: "Whatever the component, it is automatically destroyed or lost when the spell is cast, unless the spell
 *    description specifically notes otherwise" (Casting Spells (PHB)); an item named in a sentence saying it is not
 *    consumed, reusable and the like is not consumed.
 * Matching is automatic and imperfect: links are fixed on the spell sheet afterwards.
 */

export const HOLY_ITEM = { identifier: "holy-item-symbol-water-etc", name: "Holy item (symbol, water, etc.)" };

const NOT_CONSUMED = /\bnot (?:consumed|lost|destroyed|expended|used up)\b|\breusable\b|\bcan be (?:re)?used (?:again|repeatedly)\b|\bis retained\b|\bare retained\b|\bnot used up\b/i;
const HOLY_SYMBOL = /\b(?:holy|unholy|religious)(?:\s*\((?:holy|unholy)\))?\s+symbols?\b/gi;
const HOLY_WATER = /\b(?:holy|unholy)(?:\s*\((?:holy|unholy)\))?\s+water\b/gi;

/** Plain text of wikitext (links, templates, markup removed). */
export function plain(wiki) {
  return String(wiki ?? "")
    .replace(/\{\{[^{}]*\}\}/g, " ")
    .replace(/\[\[(?:[^|\]]*\|)?([^\]]*)\]\]/g, "$1")
    .replace(/'''?/g, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
}

/** Sentences of a page that name its material components. */
export function componentSentences(wiki) {
  const body = plain(String(wiki ?? "").replace(/^\{\{Infobox[\s\S]*?\n\}\}/m, ""));
  return body.split(/(?<=[.!?])\s+/).filter(s => /material components?\b|components? (?:of|for) (?:this|the) spell\b/i.test(s)
    || (/\brequires?\b/i.test(s) && (/\bcomponents?\b/i.test(s) || /\b(?:holy|unholy|religious)(?:\s*\((?:holy|unholy)\))?\s+(?:symbol|water)/i.test(s))));
}

/** Phrases that match a Table 16 name: "Bell, tiny" -> "bell, tiny", "tiny bell", "bell tiny", with plurals. */
export function namePhrases(name) {
  const base = String(name).toLowerCase().replace(/[+*]/g, "").trim();
  const parts = base.split(",").map(p => p.trim()).filter(Boolean);
  const forms = new Set([base]);
  if (parts.length === 2) {
    forms.add(`${parts[1]} ${parts[0]}`);
    forms.add(`${parts[0]} ${parts[1]}`);
  }
  const out = new Set();
  for (const f of forms) {
    out.add(f);
    out.add(`${f}s`);
    out.add(`${f}es`);
    if (f.endsWith("y")) out.add(`${f.slice(0, -1)}ies`);
  }
  return [...out].filter(p => p.length >= 3);
}

const escape = s => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Component links for a spell page: [{ identifier, name, consumed }].
 * @param {string} wiki     page wikitext
 * @param {Array<{identifier: string, name: string}>} catalog  component items (POSM Table 16)
 */
export function matchComponents(wiki, catalog = []) {
  const sentences = componentSentences(wiki);
  const links = [];
  const add = (identifier, name, consumed, label) => {
    const prev = links.find(l => l.identifier === identifier && l.consumed === consumed);
    if (!prev) links.push({ identifier, name, consumed, label });
  };
  const patterns = catalog.filter(c => c.identifier && c.name).map(c => ({
    c, re: new RegExp(`\\b(?:${namePhrases(c.name).sort((a, b) => b.length - a.length).map(escape).join("|")})\\b`, "g")
  }));
  for (const sentence of sentences) {
    let text = sentence.toLowerCase();
    const reusable = NOT_CONSUMED.test(sentence);
    if (HOLY_SYMBOL.test(text)) add(HOLY_ITEM.identifier, HOLY_ITEM.name, false, "holy symbol");
    if (HOLY_WATER.test(text)) add(HOLY_ITEM.identifier, HOLY_ITEM.name, !reusable, "holy water");
    HOLY_SYMBOL.lastIndex = 0;
    HOLY_WATER.lastIndex = 0;
    text = text.replace(HOLY_SYMBOL, m => " ".repeat(m.length)).replace(HOLY_WATER, m => " ".repeat(m.length));
    // All matches with their spans; keep the longest, then any that do not overlap a kept one.
    const found = [];
    for (const { c, re } of patterns) {
      re.lastIndex = 0;
      for (const m of text.matchAll(re)) found.push({ c, start: m.index, end: m.index + m[0].length });
    }
    found.sort((a, b) => (b.end - b.start) - (a.end - a.start) || a.start - b.start);
    const kept = [];
    for (const f of found) if (!kept.some(k => f.start < k.end && k.start < f.end)) kept.push(f);
    for (const k of kept.sort((a, b) => a.start - b.start)) add(k.c.identifier, k.c.name, !reusable, "");
  }
  return links;
}
