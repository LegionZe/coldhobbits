/**
 * Compile packs/_source/<pack>/*.json into LevelDB compendium packs at packs/<pack>.
 * Same tool dnd5e uses (utils/packs.mjs). Run: npm run build:packs
 */
import { compilePack } from "@foundryvtt/foundryvtt-cli";
import fs from "node:fs";

for (const entry of fs.readdirSync("packs/_source", { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;
  await compilePack(`packs/_source/${entry.name}`, `packs/${entry.name}`, { log: true });
}
