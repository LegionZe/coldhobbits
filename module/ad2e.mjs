import { rollEncounterReaction } from "./reaction.mjs";
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
import MagicItemData from "./data/item-magic.mjs";
import JewelleryData from "./data/item-jewellery.mjs";
import TraitData from "./data/item-trait.mjs";
import { migrateCurrency, migrateKitMechanics } from "./migrations.mjs";
import { registerOpaqueWindows } from "./opaque-windows.mjs";
import { registerSidebarColours } from "./sidebar-colours.mjs";
import { registerHealth } from "./health.mjs";
import { registerAnimalHooks } from "./animals.mjs";
import { registerTokenRiders } from "./token-riders.mjs";
import { rollTreasureDialog } from "./treasure.mjs";
import { registerFamiliarHooks } from "./familiars.mjs";
import MonsterImporter, { registerMonsterImageSetting, updateExistingMonsters } from "./apps/monster-importer.mjs";
import Manual, { PlayerGuide, registerManual } from "./apps/manual.mjs";
import SpellImporter, { updateExistingSpells } from "./apps/spell-importer.mjs";
import AwardXp from "./apps/award-xp.mjs";
import SpellData from "./data/item-spell.mjs";
import AD2EActor from "./documents/actor.mjs";
import AD2EChatMessage from "./documents/chat-message.mjs";
import { registerAqRules } from "./aq-rules.mjs";
import { registerSpWeapons } from "./sp-weapons.mjs";
import { registerSpProficiencies } from "./sp-proficiencies.mjs";
import { registerDualClass } from "./dual-class.mjs";
import { registerMultiClass } from "./multi-class.mjs";
import { registerCompanions } from "./companions.mjs";
import { registerKitFeatures } from "./kit-features.mjs";
import { registerShairHooks } from "./shair.mjs";
import { registerGenHooks } from "./gens.mjs";
import AD2ECombat, { AD2ECombatant } from "./documents/combat.mjs";
import CharacterSheet from "./sheets/character-sheet.mjs";
import MonsterSheet from "./sheets/monster-sheet.mjs";
import { ClassSheet, KitSheet, ProficiencySheet, RaceSheet, WeaponSheet, AmmunitionSheet, ArmorSheet, CoinSheet, EquipmentSheet, SpellSheet, MagicItemSheet, JewellerySheet, TraitSheet } from "./sheets/item-sheets.mjs";

Hooks.once("init", () => {
  console.log("AD2E | Initializing AD&D 2e system");

  CONFIG.AD2E = AD2E;

  // GM tool: import monsters from completecompendium.com (Configure Settings, or game.ad2e.importMonsters()).
  game.settings.registerMenu("ad2e", "monsterImporter", {
    name: "AD2E.Importer.Title", label: "AD2E.Importer.Open", hint: "AD2E.Importer.MenuHint",
    icon: "fa-solid fa-dragon", type: MonsterImporter, restricted: true
  });
  registerMonsterImageSetting();
  // GM tool: import spells from the AD&D 2e wiki by source book (Configure Settings, or game.ad2e.importSpells()).
  game.settings.registerMenu("ad2e", "spellImporter", {
    name: "AD2E.SpellImporter.Title", label: "AD2E.SpellImporter.Open", hint: "AD2E.SpellImporter.MenuHint",
    icon: "fa-solid fa-wand-sparkles", type: SpellImporter, restricted: true
  });
  // GM tool: group experience award (Configure Settings, or game.ad2e.awardExperience()).
  game.settings.registerMenu("ad2e", "awardXp", {
    name: "AD2E.Xp.Title", label: "AD2E.Xp.Open", hint: "AD2E.Xp.MenuHint", icon: "fa-solid fa-star", type: AwardXp, restricted: true
  });
  // GM manual (Configure Settings, the Settings sidebar tab, or game.ad2e.manual()).
  registerManual();
  game.ad2e = {
    manual: () => new Manual().render({ force: true }),
    playerGuide: () => new PlayerGuide().render({ force: true }),
    importMonsters: () => new MonsterImporter().render({ force: true }),
    updateMonsters: () => updateExistingMonsters(),
    importSpells: () => new SpellImporter().render({ force: true }),
    updateSpells: () => updateExistingSpells(),
    awardExperience: () => new AwardXp().render({ force: true }),
    rollReaction: creature => rollEncounterReaction(creature),
    rollTreasure: actor => rollTreasureDialog(actor ?? null)
  };

  game.settings.register("ad2e", "encumbrance", {
    name: "AD2E.Enc.Setting", hint: "AD2E.Enc.SettingHint", scope: "world", config: true, type: String,
    choices: AD2E.encumbranceRules, default: "basic", requiresReload: true
  });
  // Ask for a situational modifier (and reason) when one combatant rolls initiative.
  registerOpaqueWindows();
  registerSidebarColours();
  registerHealth();
  registerAnimalHooks();
  registerTokenRiders();
  registerFamiliarHooks();
  registerShairHooks();
  registerGenHooks();
  // Material components used up when casting (module/components.mjs); optional (Material Spell Components (POSM)).
  game.settings.register("ad2e", "trackComponents", {
    name: "AD2E.Components.Setting", hint: "AD2E.Components.SettingHint", scope: "world", config: true, type: Boolean,
    default: false
  });
  game.settings.register("ad2e", "initiativePrompt", {
    name: "AD2E.Init.Setting", hint: "AD2E.Init.SettingHint", scope: "world", config: true, type: Boolean, default: true
  });
  // Maximum number of spells per level (Intelligence (PHB) Table 4, an optional rule): enforced when learning spells.
  game.settings.register("ad2e", "maxSpellsPerLevel", {
    name: "AD2E.Learn.MaxSetting", hint: "AD2E.Learn.MaxSettingHint", scope: "world", config: true, type: Boolean, default: true
  });
  // Roll damage automatically when an attack hits (per user).
  game.settings.register("ad2e", "autoDamage", {
    name: "AD2E.Weapon.AutoDamageSetting", hint: "AD2E.Weapon.AutoDamageHint", scope: "client", config: true, type: Boolean, default: true
  });
  // Initiative method (Initiative (PHB)): one roll per side (standard procedure, or group with individual modifiers) or
  // one roll per combatant (individual, optional rule).
  game.settings.register("ad2e", "initiativeMode", {
    name: "AD2E.Init.ModeSetting", hint: "AD2E.Init.ModeHint", scope: "world", config: true, type: String,
    choices: { individual: "AD2E.Init.Mode.individual", group: "AD2E.Init.Mode.group", standard: "AD2E.Init.Mode.standard" },
    default: "individual"
  });

  registerAqRules();
  registerSpWeapons();
  registerSpProficiencies();
  registerDualClass();
  registerCompanions();
  registerKitFeatures();
  registerMultiClass();
  // "A round is approximately one minute long. Ten combat rounds equal a turn" (The Combat Round (PHB)): world time
  // advances one minute per combat round (dnd5e sets its own 6 seconds the same way).
  CONFIG.time.roundTime = 60;
  CONFIG.Actor.documentClass = AD2EActor;
  CONFIG.ChatMessage.documentClass = AD2EChatMessage;
  // Sheet partials shared by tabs (registered by name, as dnd5e's preloadHandlebarsTemplates).
  foundry.applications.handlebars.loadTemplates({
    "ad2e.weapon-list": "systems/ad2e/templates/actor/parts/weapon-list.hbs",
    "ad2e.armor-list": "systems/ad2e/templates/actor/parts/armor-list.hbs",
    "ad2e.class-abilities": "systems/ad2e/templates/actor/parts/class-abilities.hbs",
    "ad2e.container-list": "systems/ad2e/templates/actor/parts/container-list.hbs"
  });
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
  CONFIG.Item.dataModels.spell = SpellData;
  CONFIG.Item.dataModels.magic = MagicItemData;
  CONFIG.Item.dataModels.jewellery = JewelleryData;
  CONFIG.Item.dataModels.trait = TraitData;

  CONFIG.Combat.documentClass = AD2ECombat;
  CONFIG.Combatant.documentClass = AD2ECombatant;
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
  DocumentSheetConfig.registerSheet(Item, "ad2e", SpellSheet, { types: ["spell"], makeDefault: true, label: "AD2E.Sheet.Spell" });
  DocumentSheetConfig.registerSheet(Item, "ad2e", MagicItemSheet, { types: ["magic"], makeDefault: true, label: "AD2E.Sheet.Magic" });
  DocumentSheetConfig.registerSheet(Item, "ad2e", JewellerySheet, { types: ["jewellery"], makeDefault: true, label: "AD2E.Sheet.Jewellery" });
  DocumentSheetConfig.registerSheet(Item, "ad2e", TraitSheet, { types: ["trait"], makeDefault: true, label: "AD2E.Sheet.Trait" });
});

// 0.0.20 stored coins as numbers on the character; convert them to coin items once (GM only).
Hooks.once("ready", () => {
  if (game.user.isGM) {
    migrateCurrency();
    migrateKitMechanics();
  }
});
