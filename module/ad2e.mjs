import { AD2E } from "./config.mjs";
import CharacterData from "./data/character.mjs";
import MonsterData from "./data/monster.mjs";
import ClassData from "./data/item-class.mjs";
import KitData from "./data/item-kit.mjs";
import RaceData from "./data/item-race.mjs";
import ProficiencyData from "./data/item-proficiency.mjs";
import WeaponData from "./data/item-weapon.mjs";
import AmmunitionData from "./data/item-ammunition.mjs";
import ArmorData from "./data/item-armor.mjs";
import CoinData from "./data/item-coin.mjs";
import EquipmentData from "./data/item-equipment.mjs";
import { migrateCurrency } from "./migrations.mjs";
import MonsterImporter from "./apps/monster-importer.mjs";
import AD2EActor from "./documents/actor.mjs";
import AD2ECombat from "./documents/combat.mjs";
import CharacterSheet from "./sheets/character-sheet.mjs";
import MonsterSheet from "./sheets/monster-sheet.mjs";
import { ClassSheet, KitSheet, ProficiencySheet, RaceSheet, WeaponSheet, AmmunitionSheet, ArmorSheet, CoinSheet, EquipmentSheet } from "./sheets/item-sheets.mjs";

Hooks.once("init", () => {
  console.log("AD2E | Initializing AD&D 2e system");

  CONFIG.AD2E = AD2E;

  // GM tool: import monsters from completecompendium.com (Configure Settings, or game.ad2e.importMonsters()).
  game.settings.registerMenu("ad2e", "monsterImporter", {
    name: "AD2E.Importer.Title", label: "AD2E.Importer.Open", hint: "AD2E.Importer.MenuHint",
    icon: "fa-solid fa-dragon", type: MonsterImporter, restricted: true
  });
  game.ad2e = { importMonsters: () => new MonsterImporter().render({ force: true }) };

  game.settings.register("ad2e", "encumbrance", {
    name: "AD2E.Enc.Setting", hint: "AD2E.Enc.SettingHint", scope: "world", config: true, type: String,
    choices: AD2E.encumbranceRules, default: "basic", requiresReload: true
  });

  CONFIG.Actor.documentClass = AD2EActor;
  CONFIG.Actor.dataModels.character = CharacterData;
  CONFIG.Actor.dataModels.monster = MonsterData;
  CONFIG.Item.dataModels.class = ClassData;
  CONFIG.Item.dataModels.kit = KitData;
  CONFIG.Item.dataModels.race = RaceData;
  CONFIG.Item.dataModels.proficiency = ProficiencyData;
  CONFIG.Item.dataModels.weapon = WeaponData;
  CONFIG.Item.dataModels.ammunition = AmmunitionData;
  CONFIG.Item.dataModels.armor = ArmorData;
  CONFIG.Item.dataModels.coin = CoinData;
  CONFIG.Item.dataModels.equipment = EquipmentData;

  CONFIG.Combat.documentClass = AD2ECombat;
  CONFIG.Combat.initiative = { formula: "1d10 + @init", decimals: 2 };

  const { DocumentSheetConfig } = foundry.applications.apps;
  DocumentSheetConfig.unregisterSheet(Actor, "core", foundry.appv1.sheets.ActorSheet);
  DocumentSheetConfig.registerSheet(Actor, "ad2e", CharacterSheet, {
    types: ["character"],
    makeDefault: true,
    label: "AD2E.Sheet.Character"
  });
  DocumentSheetConfig.registerSheet(Actor, "ad2e", MonsterSheet, { types: ["monster"], makeDefault: true, label: "AD2E.Sheet.Monster" });
  DocumentSheetConfig.registerSheet(Item, "ad2e", ClassSheet, { types: ["class"], makeDefault: true, label: "AD2E.Sheet.Class" });
  DocumentSheetConfig.registerSheet(Item, "ad2e", KitSheet, { types: ["kit"], makeDefault: true, label: "AD2E.Sheet.Kit" });
  DocumentSheetConfig.registerSheet(Item, "ad2e", RaceSheet, { types: ["race"], makeDefault: true, label: "AD2E.Sheet.Race" });
  DocumentSheetConfig.registerSheet(Item, "ad2e", ProficiencySheet, { types: ["proficiency"], makeDefault: true, label: "AD2E.Sheet.Proficiency" });
  DocumentSheetConfig.registerSheet(Item, "ad2e", WeaponSheet, { types: ["weapon"], makeDefault: true, label: "AD2E.Sheet.Weapon" });
  DocumentSheetConfig.registerSheet(Item, "ad2e", AmmunitionSheet, { types: ["ammunition"], makeDefault: true, label: "AD2E.Sheet.Ammunition" });
  DocumentSheetConfig.registerSheet(Item, "ad2e", ArmorSheet, { types: ["armor"], makeDefault: true, label: "AD2E.Sheet.Armor" });
  DocumentSheetConfig.registerSheet(Item, "ad2e", CoinSheet, { types: ["coin"], makeDefault: true, label: "AD2E.Sheet.Coin" });
  DocumentSheetConfig.registerSheet(Item, "ad2e", EquipmentSheet, { types: ["equipment"], makeDefault: true, label: "AD2E.Sheet.Equipment" });
});

// 0.0.20 stored coins as numbers on the character; convert them to coin items once (GM only).
Hooks.once("ready", () => {
  if (game.user.isGM) migrateCurrency();
});
