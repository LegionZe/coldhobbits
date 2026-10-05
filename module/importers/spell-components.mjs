/**
 * Material components of a spell page, linked to component items at import (pure; used by the in-world spell importer
 * and tools/spell-items.mjs). Only the links are stored, never the page's text.
 *  - Text: the sentences of the page that name its material components ("The material component(s) ...", or "requires"
 *    with components, holy water or a holy symbol: "the bless spell requires holy water").
 *  - Holy symbols ("holy symbol", "religious symbol", "unholy symbol") link the PHB holy item and are never consumed
 *    (owner's ruling); holy or unholy water links the same item and is consumed.
 *  - Other items: POSM Table 16 component names in several word orders (namePhrases: "tiny bell", "chip of mica",
 *    "magnetized iron bar", plurals); the sentence without articles, with "A or B C" / "X of A or B" also read as each
 *    alternative. Of overlapping matches the one ending last wins, then the longest ("acid" within "citric acid" and
 *    "piece of iron" within "piece of iron pyrite" are dropped).
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

/**
 * Phrases that match a Table 16 name: "Bell, tiny" -> "bell, tiny", "tiny bell", "bell tiny", "bell of tiny"...;
 * "Bar, iron, magnetized" -> "magnetized iron bar"; "Mica, chip" -> "chip of mica"; "Pine sprig" -> "sprig of pine";
 * "Grasshopper leg" -> "grasshopper's leg"; "Mercury (Quicksilver)" -> either word; "Dirt/earth from grave" -> either
 * first word; "Slug, live" -> also "slug". With plurals (of the last word, and of the first word of "X of Y").
 */
export function namePhrases(name) {
  const base = String(name).toLowerCase().replace(/[+*]/g, "").trim();
  const alias = base.match(/^(.*?)\s*\(([^)]+)\)\s*$/);
  const bases = (alias ? [alias[1].trim(), alias[2].trim()] : [base]).flatMap(b => {
    const slash = b.match(/^([a-z-]+)\/([a-z-]+)(.*)$/);
    return slash ? [slash[1] + slash[3], slash[2] + slash[3]] : [b];
  });
  const forms = new Set();
  for (const b of bases) {
    const parts = b.split(",").map(p => p.trim()).filter(Boolean);
    forms.add(b);
    if (parts.length >= 2) {
      const [head, ...quals] = parts;
      forms.add(`${[...quals].reverse().join(" ")} ${head}`);
      forms.add(`${head} ${quals.join(" ")}`);
      if (quals.length === 1) {
        forms.add(`${head} of ${quals[0]}`);
        forms.add(`${quals[0]} of ${head}`);
        forms.add(`${head} from ${quals[0]}`);
        if (quals[0] === "live") forms.add(head);
      }
    } else {
      const words = b.split(/\s+/);
      if (words.length === 2) {
        forms.add(`${words[1]} of ${words[0]}`);
        forms.add(`${words[0]}'s ${words[1]}`);
      }
    }
  }
  const plural = w => [w, `${w}s`, `${w}es`, ...(w.endsWith("y") ? [`${w.slice(0, -1)}ies`] : [])];
  const out = new Set();
  for (const f of forms) {
    for (const p of plural(f)) out.add(p);
    const of = f.match(/^([a-z-]+) (of|from) (.+)$/);
    if (of) for (const p of plural(of[1])) out.add(`${p} ${of[2]} ${of[3]}`);
  }
  return [...out].filter(p => p.length >= 3);
}

/** Sentence text prepared for matching: lower case, no articles or brackets. */
export function normalizeText(sentence) {
  return String(sentence).toLowerCase().replace(/[()]/g, " ").replace(/\b(?:a|an|the)\s+/g, "").replace(/\s+/g, " ");
}

/**
 * Alternatives read from a normalized text: "A or B C" also as "A C" and "B C", "X of A or B" also as "X of B"
 * (appended after a separator, so spans never join the original text).
 */
export function expandAlternatives(text) {
  const extra = [];
  for (const m of text.matchAll(/\b([a-z-]+) or ([a-z-]+) ([a-z-]+)\b/g)) extra.push(`${m[1]} ${m[3]}`, `${m[2]} ${m[3]}`);
  for (const m of text.matchAll(/\b([a-z-]+) (of|from) ([a-z-]+(?: [a-z-]+)?) or ([a-z-]+(?: [a-z-]+)?)\b/g)) extra.push(`${m[1]} ${m[2]} ${m[4]}`);
  return extra.length ? `${text} | ${extra.join(" | ")}` : text;
}

/** Both steps (normalize, then alternatives). */
export function matchText(sentence) {
  return expandAlternatives(normalizeText(sentence));
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
    let text = normalizeText(sentence);
    const reusable = NOT_CONSUMED.test(sentence);
    if (HOLY_SYMBOL.test(text)) add(HOLY_ITEM.identifier, HOLY_ITEM.name, false, "holy symbol");
    if (HOLY_WATER.test(text)) add(HOLY_ITEM.identifier, HOLY_ITEM.name, !reusable, "holy water");
    HOLY_SYMBOL.lastIndex = 0;
    HOLY_WATER.lastIndex = 0;
    text = text.replace(HOLY_SYMBOL, m => " ".repeat(m.length)).replace(HOLY_WATER, m => " ".repeat(m.length));
    // Alternatives after the holy phrases are blanked ("holy or unholy water" never leaves a bare "water").
    text = expandAlternatives(text);
    // All matches with their spans; keep the longest, then any that do not overlap a kept one.
    const found = [];
    for (const { c, re } of patterns) {
      re.lastIndex = 0;
      for (const m of text.matchAll(re)) found.push({ c, start: m.index, end: m.index + m[0].length });
    }
    // The match ending last wins an overlap (the head noun comes last: "piece of iron pyrite" is iron pyrite), then
    // the longest ("white feather" over "feather").
    found.sort((a, b) => b.end - a.end || (b.end - b.start) - (a.end - a.start) || a.start - b.start);
    const kept = [];
    for (const f of found) if (!kept.some(k => f.start < k.end && k.start < f.end)) kept.push(f);
    for (const k of kept.sort((a, b) => a.start - b.start)) add(k.c.identifier, k.c.name, !reusable, "");
  }
  return links;
}
