// Check packs/_source documents against the data model schemas with Foundry's field rules (a StringField with choices is
// neither blank-able nor nullable unless set; required, integer, min/max, nullable). Foundry drops invalid values when
// it loads a pack, so this catches data loss the Node tests cannot. Run from the repo root: node tools/check-pack-data.mjs
import fs from "node:fs";
const R = process.cwd();
class Field { constructor(o = {}) { this.o = o; } }
const mk = kind => class extends Field { constructor(a, b) { super(kind === "schema" ? {} : (kind === "array" || kind === "set") ? (b ?? {}) : (a ?? {})); this.kind = kind; if (kind === "schema") this.fields = a; if (kind === "array" || kind === "set") this.element = a; } };
globalThis.foundry = { data: { fields: { StringField: mk("string"), NumberField: mk("number"), BooleanField: mk("boolean"), SchemaField: mk("schema"),
  ArrayField: mk("array"), SetField: mk("set"), ObjectField: mk("object"), HTMLField: mk("html") } }, abstract: { TypeDataModel: class {} }, utils: {} };
globalThis.game = { i18n: { localize: k => k, format: k => k } };
const { AD2E } = await import(`${R}/module/config.mjs`);
globalThis.CONFIG = { AD2E };
const models = { kit: "item-kit", jewellery: "item-jewellery", magic: "item-magic", class: "item-class", race: "item-race", proficiency: "item-proficiency",
  weapon: "item-weapon", ammunition: "item-ammunition", armor: "item-armor", coin: "item-coin", equipment: "item-equipment", spell: "item-spell", trait: "item-trait", monster: "monster" };
const schemas = {};
for (const [t, f] of Object.entries(models)) schemas[t] = (await import(`${R}/module/data/${f}.mjs`)).default.defineSchema();
const problems = [];
function check(field, v, path) {
  const o = field.o ?? {};
  if (field.kind === "schema") { for (const [k, f] of Object.entries(field.fields)) check(f, v?.[k], `${path}.${k}`); return; }
  if (field.kind === "array" || field.kind === "set") { (v ?? []).forEach((x, i) => check(field.element, x, `${path}[${i}]`)); return; }
  if (v === undefined) return; // initial used
  if (field.kind === "string") {
    const choices = typeof o.choices === "function" ? o.choices() : o.choices;
    const blank = o.blank ?? (choices ? false : true);
    const nullable = o.nullable ?? false;
    if (v === null) { if (!nullable) problems.push(`${path}: null not allowed`); return; }
    if (v === "") { if (!blank) problems.push(`${path}: blank not allowed${choices ? " (has choices)" : ""}`); return; }
    if (choices) { const keys = Array.isArray(choices) ? choices : Object.keys(choices); if (!keys.includes(v)) problems.push(`${path}: "${v}" not a choice`); }
  }
  if (field.kind === "number") {
    if (v === null) { if (!o.nullable && o.nullable !== undefined ? true : o.nullable === false) problems.push(`${path}: null not allowed`); return; }
    if (typeof v !== "number") { problems.push(`${path}: not a number (${JSON.stringify(v)})`); return; }
    if (o.integer && !Number.isInteger(v)) problems.push(`${path}: not an integer ${v}`);
    if (o.min !== undefined && o.min !== null && v < o.min) problems.push(`${path}: ${v} < min ${o.min}`);
    if (o.max !== undefined && o.max !== null && v > o.max) problems.push(`${path}: ${v} > max ${o.max}`);
  }
}
let n = 0;
for (const pack of fs.readdirSync(`${R}/packs/_source`)) {
  for (const f of fs.readdirSync(`${R}/packs/_source/${pack}`).filter(f => !f.startsWith("_"))) {
    const d = JSON.parse(fs.readFileSync(`${R}/packs/_source/${pack}/${f}`));
    const docs = [d, ...(d.items ?? [])];
    for (const doc of docs) {
      const s = schemas[doc.type]; if (!s) continue; n++;
      for (const [k, fld] of Object.entries(s)) check(fld, doc.system?.[k], `${pack}/${doc.name}.${k}`);
    }
  }
}
const grouped = {};
for (const p of problems) { const key = p.replace(/^[^/]+\/[^.]+\./, "").replace(/\[\d+\]/g, "[]").replace(/"[^"]*"/, "\"…\""); grouped[key] = (grouped[key] ?? 0) + 1; }
console.log(`${n} documents checked, ${problems.length} problems`);
console.log(Object.entries(grouped).sort((a, b) => b[1] - a[1]).slice(0, 40).map(([k, c]) => `${c} × ${k}`).join("\n"));
console.log(problems.slice(0, 10).join("\n"));
if (problems.length) process.exit(1);
