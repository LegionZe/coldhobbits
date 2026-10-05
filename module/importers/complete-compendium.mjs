/**
 * Reader for https://www.completecompendium.com/ (AD&D 2e Complete Monstrous Compendium, a static Gatsby site
 * served with "access-control-allow-origin: *", so a GM's browser can fetch it from a Foundry world).
 * - /catalog/ (HTML): settings and books (publication ID, title, number of monsters);
 * - /page-data/catalog/<setting>/<id>/page-data.json: the book's monster keys;
 * - /page-data/appendix/<key>/page-data.json: a monster page, `statblock` = { variant name: { row label: value } }.
 * Only the stat block (game mechanics), a link to the page and the URL of the page's monster picture are imported;
 * descriptive text is not, and pictures are not copied (the actor and token load them from the site).
 */
import { AD2E, creatureHitDice } from "../config.mjs";

export const SITE = "https://www.completecompendium.com";
export const DEFAULT_IMAGE = "icons/svg/mystery-man.svg";

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'", apos: "'", nbsp: " ", times: "×", ndash: "–",
  mdash: "—", frac12: "½", frac14: "¼", frac34: "¾", deg: "°", minus: "−" };

/** Plain text from a stat block cell: <br> -> "; ", tags removed, HTML entities decoded. */
export function cleanText(value) {
  return String(value ?? "")
    .replace(/<br\s*\/?>/gi, "; ")
    .replace(/<[^>]+>/g, "")
    .replace(/&(#\d+|#x[0-9a-f]+|\w+);/gi, (m, e) => {
      if (e[0] === "#") return String.fromCodePoint(e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : Number(e.slice(1)));
      return ENTITIES[e.toLowerCase()] ?? m;
    })
    .replace(/\s+/g, " ")
    .trim();
}

/** Settings and books listed on the /catalog/ page. */
export function parseCatalog(html) {
  const settings = [...html.matchAll(/class="setting-frame" title="(\w+)".*?class="setting-title">([^<]*)</g)]
    .map(m => ({ key: m[1], name: cleanText(m[2]) }));
  const books = [...html.matchAll(/href="\/catalog\/(\w+)\/(\d+)\/"><p class="[^"]*book-title[^"]*">([^<]*)<\/p><\/a>[\s\S]*?Number of monsters: <!-- -->(\d+)/g)]
    .map(m => ({ setting: m[1], id: m[2], title: cleanText(m[3]), count: Number(m[4]) }));
  return { settings, books };
}

export const catalogUrl = () => `${SITE}/catalog/`;
export const bookDataUrl = book => `${SITE}/page-data/catalog/${book.setting}/${book.id}/page-data.json`;
export const monsterDataUrl = key => `${SITE}/page-data/appendix/${key}/page-data.json`;
export const monsterPageUrl = key => `${SITE}/appendix/${key}/`;

/** Monster keys of a book page-data document. */
export function bookMonsterKeys(json) {
  const pc = json?.result?.pageContext?.pageContext ?? json?.result?.pageContext ?? {};
  return pc.monster_keys ?? [];
}

/**
 * Monster pictures from a page's `images` (<img> tags), as the site renders them: "img/x.gif" is served from
 * /images/monsters/img/x.gif, "/img/spc/x.gif" from the site root ("../../static/img/..." = /img/...); "grf/" images
 * are setting and publisher logos and are skipped. Returns [{ url, alt }] without duplicates.
 */
export function monsterImages(images) {
  const out = [];
  for (const tag of images ?? []) {
    const src = String(tag).match(/\bsrc="([^"]+)"/i)?.[1]?.trim();
    if (!src || /^(\.\.\/)*(static\/)?grf\//i.test(src) || /^https?:/i.test(src)) continue;
    let path;
    if (/^img\//i.test(src)) path = `/images/monsters/${src}`;
    else if (src.startsWith("/")) path = src;
    else if (/^(\.\.\/)+(static\/)?img\//i.test(src)) path = `/${src.replace(/^(\.\.\/)+(static\/)?/i, "")}`;
    else continue;
    const url = `${SITE}${path}`;
    if (out.some(i => i.url === url)) continue;
    const alt = cleanText(String(tag).match(/\b(?:alt|title)="([^"]*)"/i)?.[1] ?? "").replace(/^\\/, "");
    out.push({ url, alt });
  }
  return out;
}

/** Picture for a stat block variant: the one whose alt text names the variant, else the page's first picture. */
export function monsterImage(images, variant = "") {
  const v = cleanText(variant).toLowerCase();
  return (v && images?.find(i => i.alt.toLowerCase() === v)) || images?.[0] || null;
}

/** { title, sources, variants: [{ name, block }], images: [{ url, alt }] } from a monster page-data document. */
export function parseMonsterPage(json) {
  const pc = json?.result?.pageContext ?? json?.result?.data?.sitePage?.pageContext ?? {};
  const data = pc.monster_data ?? {};
  const variants = Object.entries(data.statblock ?? {}).map(([name, block]) => ({ name: cleanText(name), block }));
  return { key: pc.monster_key, title: cleanText(data.title ?? pc.title ?? ""), sources: data.TSR ?? pc.sources ?? [], variants,
    images: monsterImages(data.images) };
}

const firstInt = text => {
  const m = cleanText(text).replace(/(\d),(\d{3})/g, "$1$2").match(/-?\d+/);
  return m ? Number(m[0]) : null;
};

/** Damage roll from "1-8", "2-8", "1d3", "2d4+1"; null if none. */
export function damageFormula(token) {
  const t = cleanText(token);
  let m = t.match(/(\d+)d(\d+)\s*([+-]\s*\d+)?/i);
  if (m) return `${m[1]}d${m[2]}${m[3] ? m[3].replace(/\s/g, "") : ""}`;
  m = t.match(/(\d+)\s*[-–]\s*(\d+)/);
  if (!m) return null;
  const lo = Number(m[1]);
  const hi = Number(m[2]);
  if (lo === 1) return `1d${hi}`;
  if (hi % lo === 0) return `${lo}d${hi / lo}`;
  return `1d${hi - lo + 1}+${lo - 1}`;
}

/**
 * Elemental province named in a text (Al-Qadim provinces: flame, sand, sea, wind): words for fire, earth/sand, water
 * and air; cold and ice count as sea (Appendix A: Wizard Spells by Province (AA) puts Cone of Cold, Ice Storm and Wall of
 * Ice in the sea province). Lightning names no province (Lightning Bolt is universal). Returns { element, word } or null.
 */
const ELEMENT_WORDS = [
  ["flame", /\b(fire|fiery|flames?|flaming|burn(?:s|ing)?|heat|magma|lava)\b/i],
  ["sea", /\b(water|sea|waves?|drown(?:s|ing)?|cold|ice|icy|frost)\b/i],
  ["wind", /\b(air|winds?|whirlwind|gusts?)\b/i],
  ["sand", /\b(earth|sand)\b/i]
];
export function elementIn(text) {
  for (const [element, re] of ELEMENT_WORDS) {
    const m = String(text ?? "").match(re);
    if (m) return { element, word: m[1].toLowerCase() };
  }
  return null;
}

/**
 * A creature-level element suggestion for its natural attacks (not applied; the monster sheet offers it): from the
 * name ("Elemental, Fire"), else from the special attacks ("Breath weapon (fire)"). { element, word, from } or null.
 */
export function guessElement(name, specialAttacks) {
  const n = elementIn(name);
  if (n) return { ...n, from: "name" };
  const s = elementIn(specialAttacks);
  return s ? { ...s, from: "special" } : null;
}

/**
 * Natural attacks from "Damage/Attack": "1-2/1-2" -> two attacks; "1d3/1d3 or by weapon"; "1-8 (weapon)"; "1";
 * the first " or " alternative that contains damage ("Special or 1-2"). "By weapon" gives none (add weapon items).
 */
export function parseAttacks(text) {
  const label = globalThis.game?.i18n?.localize?.("AD2E.Monster.Attack") ?? "Attack";
  for (const alt of cleanText(text).split(/\s+or\s+/i)) {
    const attacks = alt.split("/").map((tok, i) => {
      const damage = /^\s*\d+\s*$/.test(tok) ? tok.trim() : damageFormula(tok);
      // An attack whose own text names an element ("2d8 (fire)") takes it.
      const element = damage ? elementIn(tok)?.element ?? "" : "";
      return damage ? { name: /weapon/i.test(tok) ? "Weapon" : `${label} ${i + 1}`, damage, bonus: 0, ...(element ? { element } : {}) } : null;
    }).filter(Boolean);
    if (attacks.length) return attacks;
  }
  return [];
}

/**
 * Monster actor data from one stat block variant. The listed THAC0 is kept as an override when it differs from
 * DMG Table 39 for the Hit Dice.
 */
export function monsterActorData({ key, title, sources, images }, { name, block }) {
  const get = label => cleanText(block[label] ?? "");
  const hitDice = get("Hit Dice") || "1";
  const hd = creatureHitDice(hitDice);
  const table = AD2E.creatureThac0;
  const computed = table[Math.min(hd.thac0Index, table.length - 1)];
  const listed = firstInt(get("THAC0"));
  const morale = get("Morale");
  const moraleNumbers = morale.match(/\d+/g);
  const avgHp = Math.max(1, Math.round(hd.dice ? hd.dice * 4.5 + hd.bonus : 3.5));
  const img = monsterImage(images, name)?.url ?? DEFAULT_IMAGE;
  return {
    name: name || title,
    type: "monster",
    img,
    system: {
      identifier: key, role: "monster",
      climate: get("Climate/Terrain"), frequency: get("Frequency"), organization: get("Organization"),
      activity: get("Activity Cycle"), diet: get("Diet"), intelligence: get("Intelligence"), treasure: get("Treasure"),
      alignment: get("Alignment"), numberAppearing: get("No. Appearing"),
      ac: { base: firstInt(get("Armor Class")) ?? 10, text: get("Armor Class") },
      // Human (MM) lists no movement for its human types: human base movement (PHB Table 64).
      movement: { base: firstInt(get("Movement")) ?? (key === "human" ? AD2E.baseMovement.human : 0), text: get("Movement") },
      hitDice, hp: { value: avgHp, max: avgHp },
      thac0: { override: listed !== null && listed !== computed ? listed : null },
      attacks: parseAttacks(get("Damage/Attack")),
      attacksText: get("No. of Attacks"), damageText: get("Damage/Attack"),
      specialAttacks: get("Special Attacks"), specialDefenses: get("Special Defenses"),
      magicResistance: get("Magic Resistance"), size: get("Size"),
      morale: { value: moraleNumbers ? Number(moraleNumbers.at(-1)) : 10, text: morale },
      xp: firstInt(get("XP Value")) ?? 0,
      url: monsterPageUrl(key), notes: ""
    },
    prototypeToken: { name: name || title, disposition: -1, actorLink: false, texture: { src: img } },
    flags: { ad2e: { completeCompendium: { key, variant: name, sources },
      ...(guessElement(name || title, get("Special Attacks")) ? { elementGuess: guessElement(name || title, get("Special Attacks")) } : {}) } }
  };
}
