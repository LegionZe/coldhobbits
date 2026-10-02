import { AD2E } from "./config.mjs";
import CharacterData from "./data/character.mjs";
import AD2EActor from "./documents/actor.mjs";
import AD2ECombat from "./documents/combat.mjs";
import CharacterSheet from "./sheets/character-sheet.mjs";

Hooks.once("init", () => {
  console.log("AD2E | Initializing AD&D 2e system");

  CONFIG.AD2E = AD2E;

  CONFIG.Actor.documentClass = AD2EActor;
  CONFIG.Actor.dataModels.character = CharacterData;

  CONFIG.Combat.documentClass = AD2ECombat;
  CONFIG.Combat.initiative = { formula: "1d10 + @init", decimals: 2 };

  const { DocumentSheetConfig } = foundry.applications.apps;
  DocumentSheetConfig.unregisterSheet(Actor, "core", foundry.appv1.sheets.ActorSheet);
  DocumentSheetConfig.registerSheet(Actor, "ad2e", CharacterSheet, {
    types: ["character"],
    makeDefault: true,
    label: "AD2E.Sheet.Character"
  });
});
