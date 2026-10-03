/**
 * Reader for https://www.completecompendium.com/ (AD&D 2e Complete Monstrous Compendium, a static Gatsby site
 * served with "access-control-allow-origin: *", so a GM's browser can fetch it from a Foundry world).
 * - /catalog/ (HTML): settings and books (publication ID, title, number of monsters);
 * - /page-data/catalog/<setting>/<id>/page-data.json: the book's monster keys;
 * - /page-data/appendix/<key>/page-data.json: a monster page, `statblock` = { variant name: { row label: value } }.
 * Only the stat block (game mechanics) and a link to the page are imported; descriptive text is not.
 */
import { AD2E, creatureHitDice } from "../config.mjs";

export const SITE = "https://www.completecompendium.com";

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

/** { title, sources, variants: [{ name, block }] } from a monster page-data document. */
export function parseMonsterPage(json) {
  const pc = json?.result?.pageContext ?? json?.result?.data?.sitePage?.pageContext ?? {};
  const data = pc.monster_data ?? {};
  const variants = Object.entries(data.statblock ?? {}).map(([name, block]) => ({ name: cleanText(name), block }));
  return { key: pc.monster_key, title: cleanText(data.title ?? pc.title ?? ""), sources: data.TSR ?? pc.sources ?? [], variants };
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
 * Natural attacks from "Damage/Attack": "1-2/1-2" -> two attacks; "1d3/1d3 or by weapon"; "1-8 (weapon)"; "1";
 * the first " or " alternative that contains damage ("Special or 1-2"). "By weapon" gives none (add weapon items).
 */
export function parseAttacks(text) {
  const label = globalThis.game?.i18n?.localize?.("AD2E.Monster.Attack") ?? "Attack";
  for (const alt of cleanText(text).split(/\s+or\s+/i)) {
    const attacks = alt.split("/").map((tok, i) => {
      const damage = /^\s*\d+\s*$/.test(tok) ? tok.trim() : damageFormula(tok);
      return damage ? { name: /weapon/i.test(tok) ? "Weapon" : `${label} ${i + 1}`, damage, bonus: 0 } : null;
    }).filter(Boolean);
    if (attacks.length) return attacks;
  }
  return [];
}

/**
 * Monster actor data from one stat block variant. The listed THAC0 is kept as an override when it differs from
 * DMG Table 39 for the Hit Dice.
 */
export function monsterActorData({ key, title, sources }, { name, block }) {
  const get = label => cleanText(block[label] ?? "");
  const hitDice = get("Hit Dice") || "1";
  const hd = creatureHitDice(hitDice);
  const table = AD2E.creatureThac0;
  const computed = table[Math.min(hd.thac0Index, table.length - 1)];
  const listed = firstInt(get("THAC0"));
  const morale = get("Morale");
  const moraleNumbers = morale.match(/\d+/g);
  const avgHp = Math.max(1, Math.round(hd.dice ? hd.dice * 4.5 + hd.bonus : 3.5));
  return {
    name: name || title,
    type: "monster",
    img: "icons/svg/mystery-man.svg",
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
    prototypeToken: { name: name || title, disposition: -1, actorLink: false },
    flags: { ad2e: { completeCompendium: { key, variant: name, sources } } }
  };
}
