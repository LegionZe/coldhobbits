import { LANGUAGE_TABLES } from "./rules/language-tables.mjs";

/**
 * Character languages (module/rules/language-tables.mjs from tools/build-language-tables.py; Proficiencies tab).
 * Rules: every character speaks the native language free (Intelligence (PHB)); Table 4 "Number of Languages" is the
 * number of additional languages, speaking only; Reading/Writing gives literacy in a modern language the character
 * speaks; Languages, Ancient gives an ancient language, read and written or spoken (the character's choice).
 * Owner's rulings (1.0.25): world settings for counting (`languageMode`: "slots" = Table 4 adds nonweapon slots and each
 * modern language beyond the free ones takes a Languages, Modern slot, as before; "table4" = Table 4 additional
 * languages free, no extra nonweapon slots), for when they are chosen (`languageStart`: "start" = picked at creation,
 * "learn" = the number is a maximum learned in play, only the GM adds or removes them), a universal common language
 * (`commonLanguage`, free for everyone, blank = none) and the campaign's language list (`languageList`); racial initial
 * lists from the PHB race pages; free text; Midani (Al-Qadim); a literacy tick per language.
 * Implementation choices: one language per proficiency slot (each copy of the proficiency plus its extra slots);
 * ancient languages always take Languages, Ancient slots (also under "table4"); the native and common languages and
 * every modern language ticked as literate count against Reading/Writing slots; a modern language outside the race's
 * initial list, the campaign list and the common language is flagged, not refused ("any others your DM allows").
 */
export const LANGUAGES = LANGUAGE_TABLES;
export const LANGUAGE_PROFS = { modern: "languages-modern", ancient: "languages-ancient", reading: "reading-writing" };

const norm = s => String(s ?? "").trim().toLowerCase();
const title = s => String(s ?? "").replace(/\b\w/g, c => c.toUpperCase());

export function registerLanguages() {
  const reg = (key, data) => game.settings.register("ad2e", key, { scope: "world", config: true, ...data });
  reg("languageMode", { name: "AD2E.Language.ModeSetting", hint: "AD2E.Language.ModeHint", type: String, default: "slots",
    choices: { slots: "AD2E.Language.Mode.slots", table4: "AD2E.Language.Mode.table4" }, requiresReload: true });
  reg("languageStart", { name: "AD2E.Language.StartSetting", hint: "AD2E.Language.StartHint", type: String, default: "start",
    choices: { start: "AD2E.Language.Start.start", learn: "AD2E.Language.Start.learn" } });
  reg("commonLanguage", { name: "AD2E.Language.CommonSetting", hint: "AD2E.Language.CommonHint", type: String, default: "Common" });
  reg("languageList", { name: "AD2E.Language.ListSetting", hint: "AD2E.Language.ListHint", type: String, default: "" });
}

/** The world settings (defaults when not registered, e.g. in tests). */
export function languageSettings() {
  const get = (k, d) => { try { return game.settings.get("ad2e", k) ?? d; } catch { return d; } };
  return { mode: get("languageMode", "slots") === "table4" ? "table4" : "slots", start: get("languageStart", "start") === "learn" ? "learn" : "start",
    common: String(get("commonLanguage", "Common") ?? "").trim(), list: splitList(get("languageList", "")) };
}

/** A comma- or line-separated list of names (pure). */
export function splitList(text) {
  return String(text ?? "").split(/[,;\n]/).map(s => s.trim()).filter(Boolean);
}

/** Languages given by owned copies of a proficiency (pure): one per copy plus its extra slots. */
export function profLanguages(items, identifier) {
  return [...(items ?? [])].filter(i => i.type === "proficiency" && i.system?.identifier === identifier)
    .reduce((n, i) => n + 1 + (Number(i.system.extraSlots) || 0), 0);
}

/** The race's own tongue as a default native language (pure); none for half-elves and humans. */
export function defaultNative(raceId, common = "") {
  const own = LANGUAGES.own[raceId];
  return own ? title(own) : common;
}

/** Suggestions for the add field (pure): common, racial initial list, campaign list, Midani; unique by name. */
export function languageSuggestions(raceId, settings) {
  const out = [];
  for (const n of [settings.common, ...(LANGUAGES.racial[raceId] ?? []).map(title), ...settings.list, ...LANGUAGES.aq]) {
    if (n && !out.some(x => norm(x) === norm(n))) out.push(n);
  }
  return out;
}

/**
 * Languages of a character (pure): `sys` the character data ({ languages, abilityData }), `items` its items, `raceId`,
 * `settings` (languageSettings()). Returns rows, counts against their limits and issues.
 */
export function languageStatus(sys, items, raceId, settings) {
  const L = sys.languages ?? {};
  const native = { name: L.native || defaultNative(raceId, settings.common), set: !!L.native, literate: !!L.nativeLiterate };
  const common = settings.common && norm(settings.common) !== norm(native.name) ? { name: settings.common, literate: !!L.commonLiterate } : null;
  const free = [native.name, common?.name].filter(Boolean).map(norm);
  const racial = (LANGUAGES.racial[raceId] ?? []).map(norm);
  const campaign = settings.list.map(norm);
  const seen = new Set(free);
  const rows = (L.known ?? []).map((k, index) => {
    const n = norm(k.name);
    const duplicate = !n || seen.has(n);
    seen.add(n);
    const kind = k.kind === "ancient" ? "ancient" : "modern";
    const outside = kind === "modern" && !!n && !racial.includes(n) && !campaign.includes(n) && !LANGUAGES.aq.map(norm).includes(n);
    return { index, name: k.name, kind, literate: !!k.literate, duplicate, outside };
  });
  const counted = rows.filter(r => !r.duplicate);
  const modernUsed = counted.filter(r => r.kind === "modern").length;
  const table4 = Number(sys.abilityData?.int?.languages) || 0;
  const modern = { used: modernUsed, allowed: settings.mode === "table4" ? table4 : profLanguages(items, LANGUAGE_PROFS.modern), source: settings.mode };
  const ancient = { used: counted.filter(r => r.kind === "ancient").length, allowed: profLanguages(items, LANGUAGE_PROFS.ancient) };
  const literate = { used: (native.literate ? 1 : 0) + (common?.literate ? 1 : 0) + counted.filter(r => r.kind === "modern" && r.literate).length,
    allowed: profLanguages(items, LANGUAGE_PROFS.reading) };
  const issues = [];
  if (modern.used > modern.allowed) issues.push("modern");
  if (ancient.used > ancient.allowed) issues.push("ancient");
  if (literate.used > literate.allowed) issues.push("literate");
  if (rows.some(r => r.duplicate)) issues.push("duplicate");
  return { native, common, rows, modern, ancient, literate, issues, table4 };
}
