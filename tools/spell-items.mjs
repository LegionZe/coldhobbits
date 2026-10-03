// Convert raw wiki pages ([{ title, wiki, revid, categories }], JSON file argv[2]) to spell item data on stdout,
// with the same parser the in-world spell importer uses. Called by tools/build-spell-data.py.
import fs from "node:fs";
import { spellItemData } from "../module/importers/adnd2e-wiki.mjs";

const pages = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const items = pages.map(p => {
  const d = spellItemData(p.title, p.wiki, p.categories);
  if (d) d.flags.ad2e.wiki.revid = p.revid;
  return d;
}).filter(Boolean);
process.stdout.write(JSON.stringify(items));
