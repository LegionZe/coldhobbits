// Convert raw wiki pages ([{ title, wiki, revid, categories }], JSON file argv[2]) to spell item data on stdout,
// with the same parser the in-world spell importer uses. Called by tools/build-spell-data.py.
import fs from "node:fs";
import { spellItemData } from "../module/importers/adnd2e-wiki.mjs";
import { HOLY_ITEM } from "../module/importers/spell-components.mjs";

// Component items to link (POSM Table 16, packs/_source/components; run tools/build-component-data.py first).
const dir = "packs/_source/components";
const components = fs.readdirSync(dir).filter(f => !f.startsWith("_")).map(f => JSON.parse(fs.readFileSync(`${dir}/${f}`, "utf8")))
  .map(d => ({ identifier: d.system.identifier, name: d.name }));
if (!fs.readdirSync("packs/_source/equipment").some(f => f === `${HOLY_ITEM.identifier}.json`)) throw new Error(`no ${HOLY_ITEM.identifier} equipment item`);
const pages = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const items = pages.map(p => {
  const d = spellItemData(p.title, p.wiki, p.categories, components);
  if (d) d.flags.ad2e.wiki.revid = p.revid;
  return d;
}).filter(Boolean);
process.stdout.write(JSON.stringify(items));
