import { AD2E, armorSummary, equipmentSummary, schoolStems } from "../config.mjs";
import { modifierText, promptModifier } from "../roll-modifiers.mjs";
import AbilityRoller from "../apps/ability-roller.mjs";
import { promptHitPoints, temporaryHp } from "../health.mjs";
import { canFightTwoWeapons, twoWeaponExempt, twoWeaponPenalty, twoWeaponStyle } from "../combat-options.mjs";
import { henchmenInfo, rollHenchmanMorale } from "../henchmen.mjs";
import { learnChance, rollLearnSpell } from "../learn-spells.mjs";
import { isElementalMage, isSorcerer, PROVINCES } from "../elemental.mjs";
import { daysSinceAttempt, familiarDeath, familiarInfo, findFamiliar, FAMILIAR, isFamiliar } from "../familiars.mjs";
import { animalsInfo, isAnimal, pushText, raceWeight, refreshAnimals, rollBodyWeight } from "../animals.mjs";
import { containerContext, dragItemRow, dropOnContainer, guardDraggableInputs, inContainer, insideText } from "./containers-ui.mjs";
import { SP, weaponFamiliarity } from "../sp-weapons.mjs";
import { dualClassOn, dualEligibility } from "../dual-class.mjs";
import { multiClassOn, multiEligibility, multiEntries, SINGLE_CLASS_KITS } from "../multi-class.mjs";
import { kitSpecial, meditate, meditationActive, rollSocialRank, weaponMasterDisplay } from "../kit-features.mjs";
import { sideOf } from "../initiative.mjs";
import { bondInfo, bondKind, canBond, COMPANIONS, companionLost, mountDied, mountFled, oversizeCompanion, rollBondCreature, setBond } from "../companions.mjs";
import { breakGenLink, dismissGen, genBack, genDeath, genInfo, genStatusText, raiseGen, sendGenAway, summonGen } from "../gens.mjs";
import { GEN_KINDS, genReturns, isShair, repeatsOf, requestChance, requestSpell, searchUnit, spellStanding, spellTitle } from "../shair.mjs";

const { HandlebarsApplicationMixin } = foundry.applications.api;

/** "Agriculture or Fishing, Survival" from kit proficiency entries ({ choice: [identifier, ...] }). */
export function formatKitProficiencies(entries) {
  const title = id => id.split("-").map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
  return (entries ?? []).map(e => e.choice.map(title).join(` ${game.i18n.localize("AD2E.Prof.Or")} `)).join(", ");
}

/** Recommended proficiency identifiers as a name list ("Etiquette, Heraldry, ..."). */
export function formatKitRecommended(ids) {
  const title = id => id.split("-").map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
  return (ids ?? []).map(title).join(", ");
}

/** A kit's weapon specialization exception as text ("" when the class rule applies). */
export function formatKitSpecialization(spec) {
  if (!spec) return "";
  const title = id => id.split("-").map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
  const parts = [spec.mode ? game.i18n.localize(`AD2E.Prof.SpecMode.${spec.mode}`) : null,
    (spec.free ?? []).length ? game.i18n.format("AD2E.Prof.SpecFree", { weapons: spec.free.map(title).join(", ") }) : null];
  return parts.filter(Boolean).join("; ");
}

/**
 * One kit modifier as text: "Saving throws +2 (magical effects based on music)", "Attack +1, +1 per 6 levels from
 * level 3 (his chosen type of sword)". `m` may carry `value` already resolved at a level (derived kitMods list).
 */
export function formatKitModifier(m, { resolved = false } = {}) {
  const i18n = k => game.i18n.localize(k);
  const title = id => id.split("-").map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
  const keyLabel = k => ({ save: `AD2E.Save.${k}`, skill: `AD2E.Skill.${k}`, ability: `AD2E.Ability.${k}`, score: `AD2E.Ability.${k}` }[m.target]);
  const keys = m.key ? m.key.split(",").map(k => k.trim()).map(k => (keyLabel(k) ? i18n(keyLabel(k)) : title(k))).join(", ") : "";
  const unit = m.target === "skill" ? "%" : "";
  const value = resolved ? m.current : m.value;
  const parts = [`${i18n(`AD2E.Kit.Target.${m.target}`)}${keys ? ` (${keys})` : ""} ${value > 0 ? "+" : ""}${value}${unit}`];
  if (m.every > 0) {
    parts.push(game.i18n.format(m.every === 1 ? "AD2E.Kit.ScalingLevel" : "AD2E.Kit.Scaling", { step: m.step, every: m.every, from: m.from }));
  } else if (m.from > 1) parts.push(game.i18n.format("AD2E.Kit.FromLevel", { n: m.from }));
  if (m.max !== null && m.max !== undefined) parts.push(game.i18n.format("AD2E.Kit.Max", { n: m.max }));
  if (m.armor) parts.push(i18n(`AD2E.Kit.Armor.${m.armor}`));
  return parts.join(", ") + (m.condition ? ` — ${m.condition}` : "");
}

/** "Wand (DMG Table 94) · 45/100 charges · 1 lb · unidentified" for a magical item. */
export function magicSummary(item) {
  const s = item.system;
  const table = AD2E.treasureTables.magicCategories.find(c => c.key === s.category)?.table;
  // An unidentified item (module/identify.mjs): players see only its category, weight and "unidentified".
  if (s.hidden) return [game.i18n.localize(`AD2E.Magic.Category.${s.category}`), s.weight ? `${s.weight} lb` : null,
    game.i18n.localize("AD2E.Magic.Unidentified")].filter(Boolean).join(" · ");
  return [`${game.i18n.localize(`AD2E.Magic.Category.${s.category}`)}${table ? ` (DMG ${table})` : ""}`,
    s.charges.max !== null ? game.i18n.format("AD2E.Magic.ChargesOf", { value: s.charges.value, max: s.charges.max }) : null,
    s.weight ? `${s.weight} lb` : null, s.usableBy || null, s.identified ? null : game.i18n.localize("AD2E.Magic.Unidentified")]
    .filter(Boolean).join(" · ");
}

/** "Gem, precious · 500 gp each" for a gem, piece of jewellery or object of art. */
export function jewellerySummary(item) {
  const s = item.system;
  const unit = s.unitValue;
  return [game.i18n.localize(`AD2E.Treasure.Kind.${s.kind}`)
    + (s.kind === "gem" && s.gemClass ? `, ${game.i18n.localize(`AD2E.Treasure.Gem.${s.gemClass}`)}` : "")
    + (s.kind === "gem" && s.uncut ? ` (${game.i18n.localize("AD2E.Treasure.Uncut").toLowerCase()})` : ""),
  unit !== null ? game.i18n.format("AD2E.Treasure.Each", { value: unit }) : null, s.weight ? `${s.weight} lb` : null]
    .filter(Boolean).join(" · ");
}

/** "dwarf 15, gnome 6" from a { race: maxLevel | null } map ("unlimited" for null). */
export function formatRaceLimits(limits) {
  return Object.entries(limits ?? {}).map(([race, max]) =>
    `${race} ${max ?? game.i18n.localize("AD2E.Race.Unlimited")}`).join(", ");
}

const signed = v => (v > 0 ? `+${v}` : `${v}`);
const pct = v => (v === null || v === undefined ? "—" : `${v}%`);
const plain = v => (v === null || v === undefined || v === "" ? "—" : `${v}`);
const ordinals = list => (list?.length ? list.map(n => `${n}`).join(", ") : "—");

/** Columns shown per ability: [lang key suffix, row -> display string]. */
const DETAIL_COLUMNS = {
  str: [
    ["hit", r => signed(r.hit)], ["dmg", r => signed(r.dmg)],
    ["weight", r => `${r.weight}`], ["press", r => `${r.press}`],
    ["openDoors", r => (r.openLocked ? `${r.openDoors} (${r.openLocked})` : `${r.openDoors}`)],
    ["bendBars", r => pct(r.bendBars)]
  ],
  dex: [["reaction", r => signed(r.reaction)], ["missile", r => signed(r.missile)], ["defense", r => signed(r.ac)]],
  con: [
    ["hp", r => (r.warrior !== r.hp ? `${signed(r.hp)} (${signed(r.warrior)})` : signed(r.hp))],
    ["systemShock", r => pct(r.systemShock)], ["resurrection", r => pct(r.resurrection)],
    ["poison", r => signed(r.poison)], ["regen", r => (r.regen ? `${r.regen.hp}/${r.regen.turns}` : "—")]
  ],
  int: [
    ["languages", r => `${r.languages}`], ["maxSpellLevel", r => plain(r.maxSpellLevel)],
    ["learnSpell", r => pct(r.learnSpell)], ["maxSpells", r => plain(r.maxSpells)],
    ["illusionImmunity", r => plain(r.illusionImmunity)]
  ],
  wis: [
    ["magicDef", r => signed(r.magicDef)], ["bonusSpells", r => ordinals(r.bonusSpells)],
    ["spellFailure", r => pct(r.spellFailure)], ["immunity", r => (r.immunity.length ? r.immunity.join(", ") : "—")]
  ],
  cha: [["henchmen", r => `${r.henchmen}`], ["loyalty", r => signed(r.loyalty)], ["reaction", r => signed(r.reaction)]]
};
/** Armour list order: body armour, shields, helmets. */
const AD2E_KIND_ORDER = { body: 0, shield: 1, helmet: 2 };

/** "+1/+1" for a magical attack/damage bonus; "" when none. */
function magicBonus({ hit, dmg }) {
  const signed = n => (n >= 0 ? `+${n}` : `${n}`);
  return hit || dmg ? `${signed(hit)}/${signed(dmg)}` : "";
}

/** Attack/damage buttons and a summary line for a derived weapon entry (weapon item or weapon proficiency). */
function weaponDisplay(e) {
  const w = e.item.system.weapon;
  const signed = n => (n >= 0 ? `+${n}` : `${n}`);
  const damage = w.damage.filter(d => d.sm || d.l)
    .map(d => `${d.label ? `${d.label}: ` : ""}${d.sm ?? "—"} / ${d.l ?? "—"}`).join("; ");
  const uses = ["melee", "missile"].filter(u => e.attack?.[u]).map(u => {
    const a = e.attack[u];
    const label = u === "melee" ? "AD2E.Weapon.Attack" : (w.melee ? "AD2E.Weapon.Throw" : "AD2E.Weapon.Fire");
    // With a second weapon in hand: the rate including the extra attack, e.g. "3/2 (5/2)".
    // An unidentified weapon (module/identify.mjs): players see the totals without its magical bonus.
    const hidden = e.item.system.hidden ? e.item.system.bonus ?? { hit: 0, dmg: 0 } : { hit: 0, dmg: 0 };
    return { use: u, label: game.i18n.localize(label), hit: signed(a.hit - hidden.hit), dmg: signed(a.dmg - hidden.dmg),
      rate: a.rateTwo ? `${a.rate} (${a.rateTwo})` : a.rate,
      rateHint: a.rateTwo ? game.i18n.format("AD2E.TwoWeapons.RateHint", { rate: a.rate, two: a.rateTwo }) : game.i18n.localize("AD2E.Weapon.Rate"),
      pointBlank: !!a.pointBlank, damageHint: damage };
  });
  const meta = [w.size, w.type, w.speed !== null ? `${game.i18n.localize("AD2E.Weapon.Speed")} ${w.speed}` : null, damage,
    e.twoHanded ? game.i18n.localize("AD2E.TwoWeapons.TwoHands") : null]
    .filter(v => v).join(" · ");
  return { uses, meta };
}

/** Short description of what a Skills & Powers group, style, armour or shield proficiency does (module/sp-weapons.mjs). */
function spEffect(sys) {
  const f = (k, d = {}) => game.i18n.format(k, d);
  if (sys.kind === "group") {
    const g = SP.groups[sys.spGroup];
    return g ? f("AD2E.SP.Effect.group", { weapons: g.weapons.join(", ") }) : "";
  }
  if (sys.kind === "style") return SP.styles[sys.style] ? game.i18n.localize(`AD2E.SP.Effect.style.${sys.style}`) : "";
  if (sys.kind === "armor") return f("AD2E.SP.Effect.armor", { armor: sys.armorType });
  if (sys.kind === "shield") {
    const r = SP.shields[sys.shieldType];
    return r ? f("AD2E.SP.Effect.shield", { ac: r.ac, missile: r.missile, n: r.attackers }) : "";
  }
  return "";
}

const { ActorSheetV2 } = foundry.applications.sheets;

export default class CharacterSheet extends HandlebarsApplicationMixin(ActorSheetV2) {
  static DEFAULT_OPTIONS = {
    classes: ["ad2e", "character"],
    position: { width: 760, height: 760 },
    window: { resizable: true },
    form: { submitOnChange: true },
    actions: {
      rollAbility: CharacterSheet.onRollAbility,
      rollSave: CharacterSheet.onRollSave,
      rollTest: CharacterSheet.onRollTest,
      openItem: CharacterSheet.onOpenItem,
      rollFirstLevelHp: CharacterSheet.onRollFirstLevelHp,
      levelUp: CharacterSheet.onLevelUp,
      drainLevels: CharacterSheet.#onDrainLevels,
      restoreLevel: CharacterSheet.#onRestoreLevel,
      deleteItem: CharacterSheet.onDeleteItem,
      toggleSeverity: CharacterSheet.onToggleSeverity,
      rollProficiency: CharacterSheet.onRollProficiency,
      clearDualPenalty: CharacterSheet.#onClearDualPenalty,
      undoDualClass: CharacterSheet.#onUndoDualClass,
      rollAttack: CharacterSheet.onRollAttack,
      rollWeaponAttack: CharacterSheet.onRollWeaponAttack,
      rollWeaponDamage: CharacterSheet.onRollWeaponDamage,
      toggleSpecialized: CharacterSheet.onToggleSpecialized,
      toggleProfFlag: CharacterSheet.onToggleProfFlag,
      adjustQuantity: CharacterSheet.onAdjustQuantity,
      toggleEquipped: CharacterSheet.onToggleEquipped,
      stowWeapon: CharacterSheet.onStowWeapon,
      dropWeapon: CharacterSheet.onDropWeapon,
      pickUpWeapon: CharacterSheet.onPickUpWeapon,
      rollJump: CharacterSheet.onRollJump,
      toggleCarried: CharacterSheet.onToggleCarried,
      adjustPrepared: CharacterSheet.onAdjustPrepared,
      castSpell: CharacterSheet.onCastSpell,
      rollSpellDamage: CharacterSheet.onRollSpellDamage,
      restSpells: CharacterSheet.onRestSpells,
      requestSpell: CharacterSheet.onRequestSpell,
      summonGen: CharacterSheet.onSummonGen,
      dismissGen: CharacterSheet.onDismissGen,
      genDeath: CharacterSheet.onGenDeath,
      raiseGen: CharacterSheet.onRaiseGen,
      genAway: CharacterSheet.onGenAway,
      genBack: CharacterSheet.onGenBack,
      breakGenLink: CharacterSheet.onBreakGenLink,
      genReturnNow: CharacterSheet.onGenReturnNow,
      rollClassSkill: CharacterSheet.onRollClassSkill,
      rollTurnUndead: CharacterSheet.onRollTurnUndead,
      layOnHands: CharacterSheet.onLayOnHands,
      useMagicItem: CharacterSheet.onUseMagicItem,
      rollAbilityScores: CharacterSheet.onRollAbilityScores,
      hpDamage: CharacterSheet.onHpDamage,
      hpHeal: CharacterSheet.onHpHeal,
      recoverTemp: CharacterSheet.onRecoverTemp,
      hpRest: CharacterSheet.onHpRest,
      bindWounds: CharacterSheet.onBindWounds,
      raiseDead: CharacterSheet.onRaiseDead,
      rollSurprise: CharacterSheet.onRollSurprise,
      rollUnarmed: CharacterSheet.onRollUnarmed,
      openHenchman: CharacterSheet.onOpenHenchman,
      learnSpell: CharacterSheet.onLearnSpell,
      removeHenchman: CharacterSheet.onRemoveHenchman,
      henchmanMorale: CharacterSheet.onHenchmanMorale,
      awardXp: CharacterSheet.onAwardXp,
      takeOut: CharacterSheet.onTakeOut,
      toggleRiding: CharacterSheet.onToggleRiding,
      importAnimal: CharacterSheet.onImportAnimal,
      findFamiliar: CharacterSheet.onFindFamiliar,
      familiarDeath: CharacterSheet.onFamiliarDeath,
      removeFamiliar: CharacterSheet.onRemoveFamiliar,
      bondRoll: CharacterSheet.#onBondRoll,
      socialRank: CharacterSheet.#onSocialRank,
      meditate: CharacterSheet.#onMeditate,
      display: CharacterSheet.#onDisplay,
      bondSet: CharacterSheet.#onBondSet,
      bondClear: CharacterSheet.#onBondClear,
      companionLost: CharacterSheet.#onCompanionLost,
      mountDied: CharacterSheet.#onMountDied,
      mountFled: CharacterSheet.#onMountFled,
      removeAnimal: CharacterSheet.onRemoveAnimal,
      rollBodyWeight: CharacterSheet.onRollBodyWeight
    }
  };

  static PARTS = {
    header: { template: "systems/ad2e/templates/actor/character-header.hbs" },
    tabs: { template: "templates/generic/tab-navigation.hbs" },
    main: { template: "systems/ad2e/templates/actor/character-main.hbs", scrollable: [""] },
    combat: { template: "systems/ad2e/templates/actor/character-combat.hbs", scrollable: [""] },
    weapons: { template: "systems/ad2e/templates/actor/character-weapons.hbs", scrollable: [""] },
    class: { template: "systems/ad2e/templates/actor/character-class.hbs", scrollable: [""] },
    features: { template: "systems/ad2e/templates/actor/character-features.hbs", scrollable: [""] },
    proficiencies: { template: "systems/ad2e/templates/actor/character-proficiencies.hbs", scrollable: [""] },
    spells: { template: "systems/ad2e/templates/actor/character-spells.hbs", scrollable: [""] },
    abilities: { template: "systems/ad2e/templates/actor/character-abilities.hbs", scrollable: [""] },
    bio: { template: "systems/ad2e/templates/actor/character-bio.hbs" },
    footer: { template: "systems/ad2e/templates/actor/character-footer.hbs" }
  };

  static TABS = {
    primary: {
      tabs: [{ id: "main" }, { id: "combat" }, { id: "weapons" }, { id: "class" }, { id: "features" }, { id: "proficiencies" }, { id: "spells" }, { id: "abilities" }, { id: "bio" }],
      initial: "main",
      labelPrefix: "AD2E.Tab"
    }
  };

  /** Coin quantity inputs edit the coin item (they have no form name, so the actor form ignores them). */
  _onRender(context, options) {
    super._onRender?.(context, options);
    guardDraggableInputs(this.element);
    for (const input of this.element?.querySelectorAll?.("input[data-coin-quantity]") ?? []) {
      input.addEventListener("change", event => {
        const coin = this.actor.items.get(event.currentTarget.dataset.itemId);
        const n = Math.max(Math.floor(Number(event.currentTarget.value) || 0), 0);
        coin?.update({ "system.quantity": n });
      });
    }
    // Multi-class: level and experience of the classes other than the main one (no form name: the whole array is
    // written at once, module/multi-class.mjs multiEntries).
    for (const input of this.element?.querySelectorAll?.("input.ad2e-multi-field") ?? []) {
      input.addEventListener("change", event => {
        const el = event.currentTarget;
        const classes = this.actor.system.multi?.classes;
        if (!classes) return;
        const field = el.dataset.field;
        const n = Math.max(Math.floor(Number(el.value) || 0), field === "level" ? 1 : 0);
        this.actor.update({ "system.multiClass.classes": multiEntries(classes, el.dataset.classId, { [field]: field === "level" ? Math.min(n, 30) : n }) });
      });
    }
  }

  /** Give each tab part its own ApplicationTab entry (same pattern as dnd5e WelcomeScreen). */
  /**
   * The Spells tab only for characters with spells (`system.spells.available`: slots at their level, a sha'ir, or owned
   * spell items); its part still renders, never active (ApplicationV2#_getTabsConfig / #_prepareTabs, Foundry v14 API).
   */
  _getTabsConfig(group) {
    const config = super._getTabsConfig(group);
    if (group !== "primary" || !config || this.document?.system?.spells?.available !== false) return config;
    return { ...config, tabs: config.tabs.filter(t => t.id !== "spells") };
  }

  _prepareTabs(group) {
    if (group === "primary" && this.tabGroups?.primary === "spells" && this.document?.system?.spells?.available === false) {
      this.tabGroups.primary = "main";
    }
    return super._prepareTabs(group);
  }

  async _preparePartContext(partId, context, options) {
    context = await super._preparePartContext(partId, context, options);
    if (context.tabs?.[partId]) context.tab = context.tabs[partId];
    return context;
  }

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    context.actor = this.document;
    context.system = this.document.system;
    const sys = this.document.system;
    context.abilities = AD2E.abilities.map(key => ({
      key,
      label: game.i18n.localize(`AD2E.Ability.${key}`),
      value: sys.abilities[key].value,
      total: sys.abilities[key].total,
      adjusted: sys.abilities[key].total !== sys.abilities[key].value,
      isStr: key === "str",
      // The stored value (a Mystic's meditation raises the derived one; the input must not save the boost).
      exceptional: this.document._source?.system?.abilities?.[key]?.exceptional ?? sys.abilities[key].exceptional
    }));
    context.saves = AD2E.saves.map(key => ({
      key,
      label: game.i18n.localize(`AD2E.Save.${key}`),
      value: sys.saves[key].value,
      table: sys.saves[key].table,
      override: sys.saves[key].override ?? "",
      overridden: sys.saves[key].override !== null,
      bonus: sys.saves[key].bonus,
      poison: key === "par" ? sys.raceInfo.poisonBonus : 0
    }));
    context.abilityDetails = AD2E.abilities.map(key => {
      const row = sys.abilityData[key];
      const score = sys.abilities[key].total;
      const exc = sys.abilities[key].exceptional;
      return {
        key,
        label: game.i18n.localize(`AD2E.Ability.${key}`),
        score: (key === "str" && score === 18 && exc > 0) ? `18/${exc === 100 ? "00" : String(exc).padStart(2, "0")}` : `${score}`,
        stats: DETAIL_COLUMNS[key].map(([col, fmt]) => ({
          label: game.i18n.localize(`AD2E.Table.${key}.${col}`),
          value: fmt(row)
        })),
        tests: Object.entries(AD2E.abilityTests)
          .filter(([, t]) => t.ability === key)
          .map(([testKey, t]) => ({
            key: testKey,
            label: game.i18n.localize(`AD2E.Test.${testKey}`),
            disabled: row[t.field] === null || row[t.field] === undefined
          }))
      };
    });
    context.alignments = AD2E.alignments;
    context.classTab = this._classTabContext(sys);
    context.profTab = this._proficiencyTabContext(sys);
    context.henchmen = this._henchmenContext();
    context.familiar = this._familiarContext();
    context.bond = this._bondContext();
    context.weaponMasterDisplay = !!kitSpecial(this.document).display;
    context.spellTab = this._spellTabContext(sys);
    context.featureTab = this._featureTabContext(sys);
    // Combat tab copy: shown as text (the Class Abilities tab holds the inputs; duplicate names break the form).
    context.combatFeatureTab = { ...context.featureTab, combat: true };
    context.movement = this._movementContext(sys);
    const enc = sys.encumbrance.info;
    context.moveLabel = `${enc.rate}${enc.category ? ` (${game.i18n.localize(`AD2E.Enc.${enc.category}`)})` : ""}`
      + (context.movement.mounted ? ` · ${game.i18n.format("AD2E.Move.MountedShort", { rate: context.movement.mounted.rate })}` : "");
    context.weaponTab = this._weaponTabContext(sys);
    const st = sys.hpState ?? {};
    // Energy drain (module/level-drain.mjs): GM buttons and the levels lost and not yet regained.
    const drain = this.document.system.drainInfo;
    context.drain = { isGM: !!game.user?.isGM, any: !!drain?.any, zero: !!drain?.zero,
      pending: (drain?.pending ?? []).map(e => game.i18n.format("AD2E.Drain.PendingRow", { class: e.name, level: e.level })).join(", ") };
    context.hpStatus = { state: st.state, label: st.state && st.state !== "ok" ? game.i18n.localize(`AD2E.Health.State.${st.state}`) : "",
      bleeding: st.bleeding, stable: sys.hp.stable && st.state === "unconscious", feeble: sys.hp.feeble, dead: st.state === "dead",
      knockedOut: st.knockedOut, temporary: temporaryHp(sys.hp),
      rule: game.i18n.localize(st.doorRule ? "AD2E.Health.RuleDeathsDoorShort" : "AD2E.Health.RuleStandardShort") };
    context.classGroups = AD2E.classGroups;
    return context;
  }

  /** Display data for the class/kit items (header and Class tab). */
  _classTabContext(sys) {
    const info = sys.classInfo;
    const abilityLabel = key => game.i18n.localize(`AD2E.Ability.${key}`);
    const fmt = v => (v === null || v === undefined ? "—" : `${v}`);
    const cls = info.classItem?.system ?? null;
    const race = sys.raceInfo;
    return {
      raceItem: race.raceItem,
      race: race.race,
      raceRequirementsMet: race.requirementsMet,
      raceRows: race.requirements.map(r => ({
        label: abilityLabel(r.key), min: fmt(r.min), max: fmt(r.max),
        adjust: r.adjust ? (r.adjust > 0 ? `+${r.adjust}` : `${r.adjust}`) : "—",
        rolled: r.rolled, total: r.total, met: r.met
      })),
      infravision: race.race ? (race.race.infravisionByLineage ? game.i18n.localize("AD2E.Race.ByLineage")
        : (race.race.infravision ? `${race.race.infravision} ft` : "—")) : "",
      conSaveBonus: race.conSaveBonus,
      poisonBonus: race.poisonBonus,
      classAllowedByRace: info.classAllowedByRace,
      levelLimit: info.levelLimit,
      needsRaceKit: info.needsRaceKit,
      kitRaceLimits: formatRaceLimits(info.kitItem?.system.raceLimits),
      // Dual-class (module/dual-class.mjs): earlier classes, restriction status, penalty flags (GM clears them).
      dual: sys.dual ? {
        previous: sys.dual.previous.map(p => game.i18n.format("AD2E.Dual.PreviousRow", { name: p.name, level: p.level })).join(", "),
        restricted: sys.dual.restricted,
        status: game.i18n.format(sys.dual.drained ? "AD2E.Drain.DualRestricted" : (sys.dual.restricted ? "AD2E.Dual.Restricted" : "AD2E.Dual.Unrestricted"), { level: sys.dual.maxOld + 1 }),
        oldThac0: sys.dual.oldThac0, oldSaves: AD2E.saves.map(k => `${game.i18n.localize(`AD2E.Save.${k}`)} ${sys.dual.oldSaves[k] ?? "—"}`).join(", "),
        encounter: sys.dual.penalty.encounter, adventure: sys.dual.penalty.adventure,
        penaltyText: sys.dual.penalty.encounter || sys.dual.penalty.adventure ? game.i18n.localize("AD2E.Dual.PenaltyPending") : "",
        isGM: !!game.user?.isGM
      } : null,
      // Multi-class (module/multi-class.mjs): each class with its level, experience and racial level limit.
      multi: sys.multi ? {
        rows: sys.multi.classes.map(c => ({ id: c.item.id, identifier: c.identifier, name: c.name, primary: c.primary,
          group: game.i18n.localize(AD2E.classGroups?.[c.group] ?? c.group), level: c.level, xp: c.xp, xpNext: c.xpNext ?? "—",
          hitDice: c.hitDice.bonus ? `${c.hitDice.dice}d${c.hitDice.die}+${c.hitDice.bonus}` : `${c.hitDice.dice}d${c.hitDice.die}`,
          limit: c.levelLimit ?? game.i18n.localize("AD2E.Race.Unlimited"), atLimit: c.atLimit,
          bonus: c.bonus ? `+${c.bonus}%` : "—", canLevel: c.xpNext !== null && c.xp >= c.xpNext && !c.atLimit })),
        allowed: sys.multi.allowed,
        bardKits: sys.multi.bard ? game.i18n.format(sys.multi.bard.ok ? "AD2E.Multi.BardKitOk" : "AD2E.Multi.BardKitNeeded",
          { kits: sys.multi.bard.kits.map(k => k.replace(/-/g, " ")).join(", ") }) : "",
        bardOk: !sys.multi.bard || sys.multi.bard.ok
      } : null,
      // Skills & Powers kit features (module/kit-features.mjs): social rank, Mystic meditation.
      socialRank: (info.kitFits && info.kitItem?.system.socialRanks?.length) ? {
        text: sys.socialRank ? game.i18n.localize(`AD2E.KitFeature.Rank.${sys.socialRank}`) + (sys.socialTitle ? ` (${sys.socialTitle})` : "") : "—" } : null,
      meditation: kitSpecial(this.document).meditation ? {
        text: sys.meditation?.ability ? game.i18n.format(meditationActive(sys.meditation, game.time?.worldTime ?? 0) ? "AD2E.KitFeature.Boosted" : "AD2E.KitFeature.MeditationPending",
          { ability: game.i18n.localize(`AD2E.Ability.${sys.meditation.ability}`) }) : game.i18n.localize("AD2E.KitFeature.NoMeditation") } : null,
      // Cavalier and Noble (POSP) "must purchase a mount" (owner's ruling: a warning while no mount is owned).
      mountNeeded: bondInfo(this.document).mountNeeded,
      kitSingleClass: sys.multi && info.kitItem && SINGLE_CLASS_KITS[info.kitItem.system.source]
        ? game.i18n.format("AD2E.Multi.KitSingleClass", { source: info.kitItem.system.source, page: SINGLE_CLASS_KITS[info.kitItem.system.source] }) : "",
      kitRacesBarred: (info.kitItem?.system.racesBarred ?? []).join(", "),
      kitBonusProfs: formatKitProficiencies(info.kitItem?.system.bonusProficiencies),
      kitRequiredProfs: formatKitProficiencies(info.kitItem?.system.requiredProficiencies),
      kitRecommended: formatKitRecommended(info.kitItem?.system.recommendedProficiencies),
      kitSpecialization: formatKitSpecialization(info.kitItem?.system.specialization),
      kitBonusSlots: info.kitItem ? [["weapon", "AD2E.Prof.Weapon"], ["nonweapon", "AD2E.Prof.Nonweapon"]]
        .filter(([k]) => info.kitItem.system.bonusSlots?.[k]).map(([k, l]) => `+${info.kitItem.system.bonusSlots[k]} ${game.i18n.localize(l)}`).join(", ") : "",
      overLevelLimit: !!info.levelLimit && sys.level > info.levelLimit,
      classItem: info.classItem,
      kitItem: info.kitItem,
      // Elemental mage kit: the chosen province (module/elemental.mjs).
      // Sorcerer kit: two provinces (`element`, `element2`).
      elementChoice: isElementalMage(this.document) || isSorcerer(this.document) ? [["", "—"], ...PROVINCES.map(p => [p, game.i18n.localize(`AD2E.Elemental.Province.${p}`)])]
        .map(([value, label]) => ({ value, label, selected: value === (sys.element ?? "") })) : null,
      element2Choice: isSorcerer(this.document) ? [["", "—"], ...PROVINCES.map(p => [p, game.i18n.localize(`AD2E.Elemental.Province.${p}`)])]
        .map(([value, label]) => ({ value, label, selected: value === (sys.element2 ?? "") })) : null,
      sorcerer: isSorcerer(this.document),
      kitFits: info.kitFits,
      cls,
      kit: info.kitItem?.system ?? null,
      groupLabel: game.i18n.localize(AD2E.classGroups[sys.classGroup]),
      hitDie: AD2E.hitDie[sys.classGroup],
      prime: cls ? [...cls.prime].map(abilityLabel).join(", ") : "",
      xpBonus: info.xpBonus,
      alignmentAllowed: info.alignmentAllowed,
      alignments: cls ? (cls.alignments.size === 9 ? game.i18n.localize("AD2E.Class.AnyAlignment")
        : [...cls.alignments].map(a => game.i18n.localize(AD2E.alignments[a])).join(", ")) : "",
      races: cls ? [...cls.races].join(", ") : "",
      requirements: info.requirements.map(r => ({
        label: abilityLabel(r.key), classMin: fmt(r.classMin),
        kitMin: r.kitMin === 0 ? game.i18n.localize("AD2E.Class.NoMinimum") : fmt(r.kitMin),
        score: r.score, met: r.met
      }))
    };
  }

  /**
   * Footer: paces at the current (encumbered) movement rate (Movement (PHB) rev 262232; Movement in Combat (PHB)
   * rev 70534). Cautious/dungeon pace: rate x 10 feet per round; walking: x 10 yards; combat: x 10 feet (closing
   * to melee 1/2, withdrawing 1/3, charge +50%); jog: x 2 (Constitution rounds, then Constitution checks); run:
   * x 3 (Strength check), x 4 (check -4), x 5 (check -8); march: x 2 miles a day, force march x 2 1/2.
   * Jumping (proficiency, PHB): running broad 2d6 + level ft, running high 1d3 + level/2 ft, standing broad
   * 1d6 + level/2 ft, standing high 3 ft; the PHB gives no jump distances without the proficiency.
   */
  _movementContext(sys) {
    const m = sys.encumbrance.info.rate;
    const fmt = game.i18n.format.bind(game.i18n);
    const half = Math.floor(sys.level / 2);
    const canJump = !!this.document.items?.find?.(i => i.type === "proficiency" && i.system.identifier === "jumping");
    return {
      sneak: m * 10, walk: m * 10, combat: m * 10, jog: m * 20, run3: m * 30, run4: m * 40, run5: m * 50,
      march: m * 2, forceMarch: m * 2.5,
      combatHint: fmt("AD2E.Move.CombatHint", { close: m * 5, withdraw: Math.floor(m * 10 / 3), charge: Math.floor(m * 15) }),
      jogHint: fmt("AD2E.Move.JogHint", { rounds: sys.abilities.con.total }),
      canJump,
      jump: { runningBroad: `2d6+${sys.level}`, runningHigh: `1d3+${half}`, standingBroad: `1d6+${half}`, standingHigh: "3" },
      jumpHint: game.i18n.localize(canJump ? "AD2E.Move.JumpHint" : "AD2E.Move.NoJump"),
      mounted: this._mountedContext()
    };
  }

  /**
   * Riding (module/animals.mjs): the mount's movement with this rider's weight in its load; rounds as on foot (tens of
   * yards outdoors) and overland "a number of miles per day equal to their movement rate", pushed to double (Movement
   * (DMG), Mounted Overland Movement).
   */
  _mountedContext() {
    try {
      const row = animalsInfo(this.document).rows.find(r => r.riding && !r.missing);
      if (!row) return null;
      return { name: row.name, rate: row.rate, round: row.rate * 10, day: row.rate, pushed: row.rate * 2,
        band: row.band ? game.i18n.localize(`AD2E.Monster.Load.${row.band}`) : "", over: row.band === "over",
        hint: game.i18n.format("AD2E.Move.MountedHint", { name: row.name, weight: row.weight, full: row.full ?? "—" }) };
    } catch (err) {
      console.error("ad2e | mounted movement", err);
      return null;
    }
  }

  /** Display data for the Class Abilities tab: skills table, class ability buttons, class features, kit. */
  _featureTabContext(sys) {
    const info = sys.classAbilities.info;
    const i18n = k => game.i18n.localize(k);
    const fmt = (k, d) => game.i18n.format(k, d);
    const sgn = v => (v ? signed(v) : "—");
    // Dual-class: skills of an earlier class (module/dual-class.mjs) use that class's tables and titles.
    const skillId = info.skillClassId ?? info.classId;
    const def = AD2E.skillClasses[skillId] ?? null;
    const oldFrom = [...new Set(Object.values(info.old ?? {}))];
    const dualNote = oldFrom.length && sys.dual ? fmt(sys.dual.restricted ? "AD2E.Dual.OldAbilitiesRestricted" : "AD2E.Dual.OldAbilitiesFree",
      { classes: oldFrom.join(", "), level: sys.dual.maxOld + 1 }) : "";
    const features = (AD2E.classFeatures[info.classId] ?? []).map(([key, level, ns]) => ({
      name: i18n(`AD2E.Feature.${ns ?? info.classId}.${key}.name`), text: i18n(`AD2E.Feature.${ns ?? info.classId}.${key}.text`),
      level: fmt("AD2E.Ability2.Level", { n: level }), gained: sys.level >= level
    }));
    const kitItem = sys.classInfo.kitFits ? sys.classInfo.kitItem : null;
    const kitAdjust = kitItem ? AD2E.thiefSkills.filter(k => kitItem.system.skillAdjust?.[k])
      .map(k => `${i18n(`AD2E.Skill.${k}`)} ${signed(kitItem.system.skillAdjust[k])}%`).join(", ") : "";
    // Kit modifiers at the character's level: applied automatically, situational (roll dialogs), or for the DM.
    const kitMods = (sys.kitMods?.list ?? []).map(m => ({
      text: (m.origin ? `${m.origin}: ` : "") + formatKitModifier(m, { resolved: m.active }), status: m.status, statusLabel: i18n(`AD2E.Kit.Status.${m.status}`)
    }));
    const kp = kitItem?.system.skillPoints ?? {};
    const has = v => v !== null && v !== undefined;
    const kitPoints = info.classId === "bard" ? (has(kp.bardFirst) ? fmt("AD2E.Kit.BardPoints", { first: kp.bardFirst }) : "")
      : (info.classId === "thief" && has(kp.first) ? fmt("AD2E.Kit.SkillPoints", { first: kp.first, per: kp.perLevel ?? 30 }) : "");
    return {
      classItem: sys.classInfo.classItem,
      hasSkills: info.skills.length > 0,
      skillTitle: i18n({ thief: "AD2E.Skill.Skills", bard: "AD2E.Skill.BardAbilities", ranger: "AD2E.Skill.RangerSkills" }[skillId] ?? "AD2E.Skill.Skills"),
      dualNote, dualRestricted: !!sys.dual?.restricted && oldFrom.length > 0,
      showPoints: !!def?.points,
      showArmor: !!def?.armor,
      skills: info.skills.map(sk => ({ ...sk, label: i18n(`AD2E.Skill.${sk.key}`), raceText: sgn(sk.race), dexText: sgn(sk.dex),
        armorText: sgn(sk.armor), kitText: sgn(sk.kit) })),
      budget: info.budget ? fmt("AD2E.Skill.Budget", info.budget) : "",
      budgetOver: !!info.budget?.over,
      perSkillMax: info.perSkillMax !== null ? fmt("AD2E.Skill.PerSkillMax", { n: info.perSkillMax }) : "",
      cap: skillId === "thief",
      ranger: skillId === "ranger",
      trapNote: info.skills.some(sk => sk.key === "rt"),
      armorBlocked: info.armorBlocked,
      armorLimited: !!info.armorLimited,
      backstab: info.backstab ? fmt("AD2E.Ability2.BackstabText", { mult: info.backstab }) : "",
      turnLevel: info.turnLevel ? fmt("AD2E.Ability2.TurnLevel", { level: info.turnLevel }) : "",
      layOnHands: info.layOnHands ? { text: fmt("AD2E.Ability2.LayOnHandsText", { hp: info.layOnHands.hp }), used: info.layOnHands.used } : null,
      cureDisease: info.cureDisease ? fmt("AD2E.Ability2.CureDisease", { n: info.cureDisease }) : "",
      tracking: info.tracking !== null ? fmt("AD2E.Ability2.Tracking", { n: info.tracking }) : "",
      speciesEnemy: info.classId === "ranger",
      saveBonus: sys.classInfo.saveBonus,
      features,
      kitItem,
      kitAdjust,
      kitMods,
      kitPoints
    };
  }

  /** Display data for the Spells tab: one section per spell level with slots and memorized spells. */
  _spellTabContext(sys) {
    const sp = sys.spells;
    const i18n = k => game.i18n.localize(k);
    const ordinal = n => game.i18n.format("AD2E.Spell.LevelN", { n });
    const shair = !!sp.shair && isShair(this.document);
    const gen = sys.gen ?? {};
    const now = game.time?.worldTime ?? 0;
    // Sha'ir: each owned spell can be requested from the gen (chance and search unit shown; module/shair.mjs).
    const request = i => {
      const st = spellStanding(i);
      const repeats = repeatsOf(gen.attempts, spellTitle(i) ?? i.name, now);
      const c = requestChance({ shairLevel: sys.level, spellLevel: st.level, ...st, repeats });
      const unit = searchUnit({ shairLevel: sys.level, spellLevel: st.level, ...st });
      return { chance: c.chance, hint: game.i18n.format("AD2E.Shair.RowHint", { chance: c.chance, unit: i18n(`AD2E.Shair.Unit.${unit}`),
        standing: i18n(st.priest ? "AD2E.Shair.Priest" : (st.native ? (st.general ? "AD2E.Shair.Common" : "AD2E.Shair.Native") : "AD2E.Shair.Foreign")) }) };
    };
    const f = gen.fetch ?? {};
    const gi = shair ? genInfo(this.document) : null;
    const ga = gi?.actor?.system;
    const genPanel = shair ? {
      actor: gi.actor ? { uuid: gi.uuid, name: gi.actor.name, img: gi.actor.img, dead: gi.dead,
        meta: game.i18n.format("AD2E.Gen.Meta", { hp: ga.hp.value, max: ga.hp.max, hd: ga.hitDice, thac0: ga.thac0?.value ?? "—",
          ac: ga.ac?.value ?? ga.ac?.base, loyalty: ga.morale?.value ?? "—" }) } : null,
      missing: !!gi.missing, near: gi.near, needsDeath: !!gi.actor && gi.dead && !gi.deathResolved,
      canSummon: !gi.actor || gi.dead || gi.broken,
      relink: !!gi.actor && !gi.dead && gi.broken, canRaise: !!gi.actor && gi.dead,
      linked: !!gi.actor && !gi.dead && !gi.broken, away: gi.away, linkStatus: genStatusText(this.document),
      kinds: Object.fromEntries(GEN_KINDS.map(k => [k, `AD2E.Shair.Kind.${k}`])), kind: gen.kind ?? "", replacements: gen.replacements ?? 0,
      busy: !!f.spellId, isGM: !!game.user?.isGM,
      status: !f.spellId ? i18n("AD2E.Shair.Idle")
        : (f.ready ? game.i18n.format("AD2E.Shair.Ready", { spell: f.name, min: Math.max(Math.ceil(((f.expiresAt ?? now) - now) / 60), 0) })
          : game.i18n.format("AD2E.Shair.Searching", { spell: f.name, n: f.count, unit: i18n(`AD2E.Shair.Unit.${f.unit || "round"}`),
            min: Math.max(Math.ceil(((f.returnsAt ?? now) - now) / 60), 0) }))
    } : null;
    const levels = sp.levels.map(l => ({
      ...l,
      label: (l.level === 0 ? i18n("AD2E.Spell.Cantrips") : ordinal(l.level))
        + (sp.extra?.length ? ` (${l.oldClass ? game.i18n.format("AD2E.Dual.OldSpells", { class: l.oldClass, kind: i18n(`AD2E.Spell.${l.kind}`) })
          : i18n(`AD2E.Spell.${l.kind}`)})` : ""),
      slotText: !(l.bonus || l.school) ? "" : [l.base ? `${l.base}` : null, l.bonus ? `+${l.bonus} ${i18n("AD2E.Spell.WisdomBonus")}` : null,
        l.school ? `+${l.school} ${i18n("AD2E.Spell.SchoolBonus")}` : null].filter(Boolean).join(" "),
      rows: l.spells.map(i => {
        const s = i.system;
        const comps = ["verbal", "somatic", "material"].filter(c => s.components[c]).map(c => c[0].toUpperCase()).join("");
        // Wizard spells not yet understood: the chance to learn and why a roll is not possible now.
        const unlearned = !shair && s.kind === "wizard" && s.learned === false;
        const lc = unlearned ? learnChance(this.document, i) : null;
        return { id: i.id, name: i.name, img: i.img, reversible: s.reversible, prepared: s.prepared,
          remaining: Math.max(s.prepared - s.cast, 0), usable: shair || s.kind === (l.kind ?? sp.kind), unlearned,
          learnText: lc ? (lc.blocked ? game.i18n.format(`AD2E.Learn.Blocked.${lc.blocked}`, { name: i.name, level: s.learnFailedLevel ?? "" })
            : game.i18n.format("AD2E.Learn.ChanceText", { chance: lc.chance })) : "",
          learnBlocked: !!lc?.blocked, damage: (s.damage ?? []).some(d => d.formula),
          ...(shair ? { request: request(i), fetched: gen.fetch?.spellId === i.id && gen.fetch?.ready } : {}),
          meta: [(s.kind === "priest" ? s.spheres : s.schools).join("/"), comps,
            `${i18n("AD2E.Spell.CT")} ${s.castingTime}`, `${i18n("AD2E.Spell.R")} ${s.range}`,
            `${i18n("AD2E.Spell.D")} ${s.duration}`, `${i18n("AD2E.Spell.AoE")} ${s.area}`, `${i18n("AD2E.Spell.Save")} ${s.save}`]
            .filter(v => v && !/ $/.test(v)).join(" · ") };
      }).sort((a, b) => a.name.localeCompare(b.name))
    }));
    // Dual-class: the earlier class's spells (module/dual-class.mjs); casting them while restricted costs experience.
    const oldCaster = sp.old ? game.i18n.format(sys.dual?.restricted ? "AD2E.Dual.OldCasterRestricted" : "AD2E.Dual.OldCaster",
      { class: sp.old.className, kind: i18n(`AD2E.Spell.${sp.old.kind}`), level: sp.old.castingLevel }) : "";
    return { kind: sp.kind ? i18n(`AD2E.Spell.${sp.kind}`) : (sp.old ? i18n(`AD2E.Spell.${sp.old.kind}`) : null),
      castingLevel: sp.kind ? sp.castingLevel : sp.old?.castingLevel ?? null, oldCaster, oldRestricted: !!(sp.old && sys.dual?.restricted), levels,
      hasSlots: sp.levels.some(l => l.slots > 0), shair, gen: genPanel };
  }

  /** Display data for the Weapons tab: owned weapon items and their proficiency status. */
  _weaponTabContext(sys) {
    const actor = this.document;
    const inv = sys.encumbrance.info?.inventory;
    const rows = sys.weapons.map(e => ({
      inside: insideText(inv, e.item),
      id: e.item.id, name: e.item.name, img: e.item.img, url: e.item.system.url, quantity: e.item.system.quantity, ...weaponDisplay(e),
      equipped: !!e.item.system.equipped, dropped: !!e.item.system.dropped,
      restriction: e.restriction ? game.i18n.localize(`AD2E.Weapon.Restrict.${e.restriction}`) : "",
      status: e.proficient
        ? [game.i18n.localize(e.mastery ? "AD2E.SP.Mastery" : (e.specialized ? "AD2E.Weapon.Specialized"
          : (e.expertise ? "AD2E.SP.Expertise" : "AD2E.Weapon.Proficient"))), e.choice ? game.i18n.localize("AD2E.SP.Choice") : ""]
          .filter(Boolean).join(", ")
        : game.i18n.format(e.familiar ? "AD2E.SP.Familiar" : "AD2E.Weapon.NotProficient", { penalty: e.penalty }),
      proficient: e.proficient, specialized: e.specialized, profId: e.proficiency?.id ?? null,
      bonus: e.item.system.hidden ? "" : magicBonus(e.item.system.bonus),
      ammo: (actor.ammunitionFor?.(e.item) ?? []).map(a => `${a.name} ×${a.system.quantity}`).join(", "),
      launcher: !!actor.ammunitionFor?.(e.item)
    })).sort((a, b) => a.name.localeCompare(b.name));
    const weaponNames = new Map(sys.weapons.map(e => [e.item.system.identifier, e.item.name]));
    const label = id => weaponNames.get(id) ?? id.replace(/-/g, " ");
    const ammo = (actor.items?.filter(i => i.type === "ammunition") ?? []).map(a => ({
      id: a.id, name: a.name, img: a.img, url: a.system.url, quantity: a.system.quantity, empty: a.system.quantity < 1, inside: insideText(inv, a),
      launchers: [...a.system.launchers].map(label).join(", "),
      damage: `${a.system.damage.sm ?? "—"} / ${a.system.damage.l ?? "—"}`,
      bonus: a.system.hidden ? "" : magicBonus(a.system.bonus)
    })).sort((a, b) => a.name.localeCompare(b.name));
    const a = sys.armor;
    const armor = (actor.items?.filter(i => i.type === "armor") ?? []).map(i => ({
      id: i.id, name: i.name, img: i.img, url: i.system.url, kind: i.system.kind, equipped: i.system.equipped, summary: armorSummary(i.system),
      inside: insideText(inv, i),
      meta: [i.system.cost, i.system.weight !== null ? `${i.system.weight} lb` : null].filter(Boolean).join(" · "),
      // an equipped item that does not count (a second body armour or shield) is marked
      unused: i.system.equipped && ((i.system.kind === "body" && a.body && a.body.id !== i.id)
        || (i.system.kind === "shield" && a.shield && a.shield.id !== i.id)),
      // size and class limits (Armor (PHB); class pages): shown in the row
      warning: [i.system.size ? game.i18n.format("AD2E.Armor.SizeLabel", { size: i.system.size }) : null,
        a.misfit?.some(m => m.id === i.id) ? game.i18n.localize("AD2E.Armor.Misfit") : null,
        (() => { const r = a.restricted?.find(x => x.item.id === i.id)?.reason; return r ? game.i18n.localize(`AD2E.Armor.Restrict.${r}`) : null; })()]
        .filter(Boolean).join(" · ")
    })).sort((x, y) => AD2E_KIND_ORDER[x.kind] - AD2E_KIND_ORDER[y.kind] || x.name.localeCompare(y.name));
    const acSummary = { front: a.front, rear: a.rear, missile: a.missile, missileDiffers: a.missile !== a.front,
      source: a.body ? a.body.name : game.i18n.localize("AD2E.Armor.NoArmor"), shield: a.shield?.name ?? null,
      shieldAttacks: a.shieldAttacks };
    const e = sys.encumbrance.info;
    const i18n = k => game.i18n.localize(k);
    const enc = {
      ...e, other: sys.encumbrance.other, override: sys.movement.override ?? "", raceBase: sys.raceInfo.race?.move ?? 12,
      clothing: AD2E.clothingWeight,
      feet: e.rate * 10, yards: e.rate * 10,
      categoryLabel: e.category ? i18n(`AD2E.Enc.${e.category}`) : "",
      penaltyText: [e.overMax ? i18n("AD2E.Enc.OverMax") : "", e.penalty.hit ? `${i18n("AD2E.Weapon.Attack")} ${e.penalty.hit}` : "",
        e.penalty.ac ? `AC +${e.penalty.ac}` : ""].filter(Boolean).join(" · "),
      // Table 47 upper weights for this Strength (basic rule)
      thresholds: e.rule === "none" ? "" : AD2E.encumbranceCategories
        .map((c, i) => `${i18n(`AD2E.Enc.${c}`)} ≤ ${e.limits[i]}`).join(" · ")
    };
    // Coin items (highest denomination first), total value in gp (Table 42) and weight.
    const order = [...AD2E.coins, "other"];
    const coins = {
      list: (actor.items?.filter(i => i.type === "coin") ?? []).map(i => ({
        id: i.id, name: i.name, img: i.img, url: i.system.url, quantity: i.system.quantity, denomination: i.system.denomination, inside: insideText(inv, i),
        value: Math.round(i.system.quantity * i.system.value / AD2E.coinValues.gp * 100) / 100
      })).sort((x, y) => order.indexOf(x.denomination) - order.indexOf(y.denomination) || x.name.localeCompare(y.name)),
      gp: Math.round(e.coinValue / AD2E.coinValues.gp * 100) / 100, count: e.coinCount, weight: e.coinWeight
    };
    // Equipment items grouped by category (PHB Table 44 lists).
    const gearItems = actor.items?.filter(i => i.type === "equipment") ?? [];
    const gear = Object.entries(AD2E.equipmentCategories).map(([key, label]) => ({
      key, label: i18n(label),
      rows: gearItems.filter(i => i.system.category === key).map(i => ({
        id: i.id, name: i.name, img: i.img, url: i.system.url, quantity: i.system.quantity, carried: i.system.carried,
        summary: equipmentSummary(i.system), inside: insideText(inv, i), contained: inContainer(inv, i),
        total: i.system.weight && i.system.quantity > 1 ? Math.round(i.system.weight * i.system.quantity * 10) / 10 : null
      })).sort((x, y) => x.name.localeCompare(y.name))
    })).filter(g => g.rows.length);
    // Magical items (DMG Table 88 order) and gems, jewellery and objects of art with their gp value.
    const catOrder = Object.keys(AD2E.magicCategories);
    const magic = (actor.items?.filter(i => i.type === "magic") ?? []).map(i => ({
      id: i.id, name: i.name, img: i.img, url: i.system.url, quantity: i.system.quantity, carried: i.system.carried, summary: magicSummary(i),
      inside: insideText(inv, i), contained: inContainer(inv, i),
      category: i.system.category, usable: i.system.usesCharges ? i.system.charges.value > 0 : (!i.system.consumable || i.system.quantity > 0)
    })).sort((x, y) => catOrder.indexOf(x.category) - catOrder.indexOf(y.category) || x.name.localeCompare(y.name));
    const jewelleryItems = actor.items?.filter(i => i.type === "jewellery") ?? [];
    const treasure = {
      list: jewelleryItems.map(i => ({ id: i.id, name: i.name, img: i.img, url: i.system.url, quantity: i.system.quantity, carried: i.system.carried,
        inside: insideText(inv, i), contained: inContainer(inv, i),
        summary: jewellerySummary(i), total: i.system.totalValue })).sort((x, y) => x.name.localeCompare(y.name)),
      gp: Math.round(jewelleryItems.reduce((n, i) => n + (i.system.totalValue ?? 0), 0) * 100) / 100
    };
    treasure.wealth = Math.round((coins.gp + treasure.gp) * 100) / 100;
    // Unarmed attacks (punch, wrestle, overbear) and the two-weapon penalties ("Attacking with Two Weapons (PHB)").
    const sign = n => `${n > 0 ? "+" : ""}${n}`;
    const twoStyle = !!sys.proficiencies?.sp?.styles?.twoWeapon;
    const twoOpts = { reaction: sys.abilityData?.dex?.reaction ?? 0, ranger: twoWeaponExempt(sys),
      armorAc: sys.armor?.body?.system.ac ?? null, style: twoWeaponStyle(sys, twoStyle ? { main: SP.twoWeapon.main, off: SP.twoWeapon.off } : null) };
    const unarmed = { hit: sign(sys.mods?.meleeAttack ?? 0),
      twoWeapons: canFightTwoWeapons(sys.classGroup) || twoStyle ? game.i18n.format("AD2E.TwoWeapons.Summary",
        { main: sign(twoWeaponPenalty("main", twoOpts)), off: sign(twoWeaponPenalty("off", twoOpts)) }) : "" };
    // Combat tab: the equipped weapons (Stow and Drop buttons) and the worn armour (no tick boxes).
    const combatRows = rows.filter(r => r.equipped && !r.dropped).map(r => ({ ...r, combat: true }));
    const combatNote = game.i18n.localize(rows.length ? "AD2E.Weapon.EquipHint" : "AD2E.Weapon.NoneYet");
    const combatArmor = armor.filter(x => x.equipped).map(x => ({ ...x, combat: true }));
    return { rows, combatRows, combatNote, combatArmor, ammo, armor, enc, coins, gear, magic, treasure, unarmed, ac: acSummary, thac0: sys.thac0.value,
      containers: containerContext(inv), animals: this._animalsContext(sys) };
  }

  /** Mounts and pack animals (module/animals.mjs): each animal's load with this character's weight when ridden. */
  _animalsContext(sys) {
    try {
      return this._animalsContextInner(sys);
    } catch (err) {
      // Never let this section stop the sheet from opening.
      console.error("ad2e | mounts and pack animals", err);
      return { bodyWeight: sys.bodyWeight ?? "", canRoll: false, riderTotal: 0, riderText: "", rows: [],
        error: game.i18n.localize("AD2E.Animal.Error") };
    }
  }

  _animalsContextInner(sys) {
    const i18n = k => game.i18n.localize(k);
    const info = animalsInfo(this.document);
    const r = info.rider;
    return {
      bodyWeight: sys.bodyWeight ?? "",
      canRoll: !!raceWeight(sys.raceInfo?.raceItem?.system.identifier),
      riderTotal: r.total,
      riderText: game.i18n.format(r.missingBody ? "AD2E.Animal.RiderNoBody" : "AD2E.Animal.RiderParts", { body: r.body ?? 0, gear: r.gear }),
      missingBody: r.missingBody,
      rows: info.rows.map(x => x.missing ? { ...x, meta: i18n(x.compendium ? "AD2E.Animal.InCompendium" : "AD2E.Animal.Missing") } : {
        ...x,
        over: x.band === "over",
        meta: [x.role ? i18n(`AD2E.Monster.Role.${x.role}`) : null,
          `${i18n("AD2E.Enc.Load")} ${x.full !== null ? `${x.weight} / ${x.full} lb` : `${x.weight} lb`}${x.band ? ` (${i18n(`AD2E.Monster.Load.${x.band}`)})` : ""}`,
          `${i18n("AD2E.Move.Movement")} ${x.rate} / ${x.base}`, x.riding ? game.i18n.format("AD2E.Animal.WithRider", { lb: r.total }) : null,
          x.actor ? pushText(x.actor) || null : null]
          .filter(Boolean).join(" · "),
        otherRiderText: x.otherRider ? game.i18n.format("AD2E.Animal.RiddenBy", { name: x.otherRider }) : ""
      })
    };
  }

  /** Display data for the Proficiencies tab. */
  _proficiencyTabContext(sys) {
    const p = sys.proficiencies;
    const abilityAbbr = key => (key ? game.i18n.localize(`AD2E.Ability.${key}`).slice(0, 3) : "—");
    const row = e => ({
      id: e.item.id, name: e.item.name, img: e.item.img, cost: e.cost, crossGroup: e.crossGroup,
      granted: !!e.item.system.grantedBy, target: e.target,
      ability: abilityAbbr(e.item.system.ability),
      modifier: e.item.system.modifier === null ? "" : (e.item.system.modifier > 0 ? `+${e.item.system.modifier}` : `${e.item.system.modifier}`),
      url: e.item.system.url
    });
    const sortByName = (a, b) => a.name.localeCompare(b.name);
    // Skills & Powers ratings (module/sp-proficiencies.mjs): "Wis 7 +3" with a breakdown; extra slots "+n".
    const signed = n => (n >= 0 ? `+${n}` : `${n}`);
    const nonweaponRow = e => {
      const r = row(e);
      if (e.extra) r.extra = game.i18n.format("AD2E.Prof.ExtraShort", { n: e.extra });
      const s = e.spRating;
      if (!s) return r;
      return { ...r, ability: abilityAbbr(s.ability), modifier: `${s.unmodified} ${signed(s.abilityMod)}`, spRated: true,
        checkHint: game.i18n.format(s.capped ? "AD2E.SPProf.HintCapped" : "AD2E.SPProf.Hint",
          { base: s.base, extra: e.extra, unmodified: s.unmodified, ability: abilityAbbr(s.ability), mod: signed(s.abilityMod) }) };
    };
    // Skills & Powers: cost breakdown (CP converted to slots) and reasons a purchase gives no benefit.
    const spText = e => ({
      costHint: e.parts?.length ? e.parts.map(x => x.cp === null
        ? game.i18n.format("AD2E.SP.PartSlots", { part: game.i18n.localize(`AD2E.SP.Part.${x.key}`), slots: x.slots })
        : game.i18n.format("AD2E.SP.PartCp", { part: game.i18n.localize(`AD2E.SP.Part.${x.key}`), cp: x.cp, slots: x.slots })).join("; ")
        : game.i18n.localize("AD2E.Prof.SlotsUsed"),
      invalidText: (e.invalid ?? []).map(k => game.i18n.localize(`AD2E.SP.Invalid.${k}`)).join(" ")
    });
    const weaponRow = e => ({ ...row(e), ...weaponDisplay(e), ...spText(e), specialized: e.specialized, specInvalid: e.specInvalid,
      choice: !!e.item.system.choice, expertise: !!e.item.system.expertise, mastery: !!e.item.system.mastery,
      masteryInvalid: !!e.masteryInvalid, covered: !!e.covered,
      typeConflict: e.typeConflict ? game.i18n.localize("AD2E.KitFeature.TypeConflict") : "" });
    const spKinds = ["group", "style", "armor", "shield"];
    const spRow = e => {
      const sys = e.item.system;
      return { ...row(e), ...spText(e), kind: game.i18n.localize(AD2E.proficiencyKinds[sys.kind]), spOff: e.spOff,
        improvable: sys.kind === "style" && ["one-handed", "two-weapon"].includes(sys.style), improved: !!sys.improved,
        effect: spEffect(sys) };
    };
    const spRows = p.entries.filter(e => spKinds.includes(e.item.system.kind)).map(spRow).sort(sortByName);
    return {
      sp: !!p.sp,
      // Weapon Master: the weapon of choice is the chosen weapon (no box).
      choiceBox: !!p.sp && !p.weaponType,
      // Weapon Master: the chosen weapon is the specialized (else expertise) melee weapon, at no extra cost.
      weaponMaster: p.weaponType?.choice ? "" : (p.weaponType ? game.i18n.localize("AD2E.KitFeature.ChooseWeapon") : ""),
      chosenWeapon: p.weaponType?.choice ? game.i18n.format(p.sp ? "AD2E.KitFeature.ChosenWeaponSp" : "AD2E.KitFeature.ChosenWeapon", { name: p.weaponType.name }) : "",
      spPenalty: p.sp ? game.i18n.format("AD2E.SP.PenaltySummary", { non: p.sp.penalty.nonproficient, fam: p.sp.penalty.familiar }) : "",
      spRows,
      weapon: { ...p.weapon, over: p.weapon.used > p.weapon.available,
        rows: p.entries.filter(e => e.item.system.kind === "weapon").map(weaponRow).sort(sortByName) },
      nonweapon: { ...p.nonweapon, over: p.nonweapon.used > p.nonweapon.available,
        rows: p.entries.filter(e => e.item.system.kind === "nonweapon").map(nonweaponRow).sort(sortByName) },
      spRatings: !!p.spRatings,
      penalty: p.penalty,
      groups: p.groups.map(g => game.i18n.localize(AD2E.nonweaponGroups[g])).join(", "),
      specRule: formatKitSpecialization(p.specRule),
      specMissing: !!p.specRule?.missing,
      recommended: formatKitRecommended(sys.classInfo.kitFits ? sys.classInfo.kitItem?.system.recommendedProficiencies : null),
      traits: this._traitContext(sys)
    };
  }

  /** Traits and disadvantages (Skills & Powers; balanced by disadvantages, owner's ruling). */
  _traitContext(sys) {
    const t = sys.traits ?? { rows: [], cost: 0, points: 0, over: false };
    const i18n = k => game.i18n.localize(k);
    const row = r => ({ id: r.item.id, name: r.item.name, img: r.item.img, url: r.item.system.url, value: r.value,
      severe: r.item.system.severity === "severe", canSevere: r.kind === "disadvantage" && r.item.system.points?.severe !== null
        && r.item.system.points?.severe !== undefined,
      effects: (r.item.system.modifiers ?? []).map(m => formatKitModifier(m)).join("; ") });
    return {
      traits: t.rows.filter(r => r.kind === "trait").map(row).sort((a, b) => a.name.localeCompare(b.name)),
      disadvantages: t.rows.filter(r => r.kind === "disadvantage").map(row).sort((a, b) => a.name.localeCompare(b.name)),
      balance: game.i18n.format("AD2E.Trait.Balance", { cost: t.cost, points: t.points }), over: t.over,
      severeLabel: i18n("AD2E.Trait.Severe"), moderateLabel: i18n("AD2E.Trait.Moderate")
    };
  }

  /** An item dropped on a container goes into it (module/sheets/containers-ui.mjs); otherwise _dropItemDefault. */
  /** Dual-class: the GM clears the encounter penalty flag, or both ("end of adventure"); data-kind "encounter" | "all". */
  static async #onDrainLevels() {
    if (!game.user?.isGM) return;
    return this.actor.drainLevels();
  }

  static async #onRestoreLevel() {
    if (!game.user?.isGM) return;
    return this.actor.restoreLevel();
  }

  static async #onUndoDualClass() {
    if (!game.user?.isGM) return;
    return this.actor.undoDualClass();
  }

  static async #onClearDualPenalty(event, target) {
    if (!game.user?.isGM) return;
    const all = target.dataset.kind === "all";
    await this.actor.update({ "system.dualClass.penalty.encounter": false, ...(all ? { "system.dualClass.penalty.adventure": false } : {}) });
  }

  /**
   * Dual-class prompt when a class is dropped on a character that has one (world setting on): "dual" (keep the
   * current class as an earlier class; only when eligible, module/dual-class.mjs), "replace", or null (cancelled).
   */
  async #askDualClass(current, next, raceItem) {
    const sys = this.actor.system;
    const scores = Object.fromEntries(AD2E.abilities.map(k => [k, sys.abilities[k].total]));
    const elig = dualEligibility({ raceId: raceItem?.system.identifier ?? "", level: sys.level, current: current.system, next: next.system,
      scores, alignment: sys.alignment, previous: sys.dualClass?.previous ?? [] });
    const i18n = k => game.i18n.localize(k);
    const esc = v => foundry.utils.escapeHTML(String(v ?? ""));
    const reasons = elig.reasons.map(r => `<li>${esc(game.i18n.format(`AD2E.Dual.Reason.${r}`, { from: current.name, to: next.name }))}</li>`).join("");
    const buttons = [];
    if (elig.ok) buttons.push({ action: "dual", label: game.i18n.format("AD2E.Dual.Become", { from: current.name, to: next.name }), default: true });
    buttons.push({ action: "replace", label: game.i18n.format("AD2E.Dual.Replace", { from: current.name, to: next.name }) });
    buttons.push({ action: "cancel", label: i18n("Cancel") });
    const choice = await foundry.applications.api.DialogV2.wait({
      window: { title: i18n("AD2E.Dual.Title") },
      content: `<p>${esc(game.i18n.format("AD2E.Dual.Question", { from: current.name, to: next.name }))}</p>`
        + (elig.ok ? `<p class="ad2e-note">${esc(game.i18n.format("AD2E.Dual.Explain", { from: current.name, to: next.name }))}</p>`
          : `<p class="ad2e-unmet">${esc(i18n("AD2E.Dual.NotEligible"))}</p><ul>${reasons}</ul>`),
      buttons, rejectClose: false
    });
    return choice === "dual" || choice === "replace" ? choice : null;
  }

  /**
   * Multi-class prompt when a class is dropped on a demihuman that has one (world setting on): "multi" (add the class;
   * only when eligible, module/multi-class.mjs), "replace", or null (cancelled).
   */
  async #askMultiClass(classItems, next, raceItem) {
    const sys = this.actor.system;
    const scores = Object.fromEntries(AD2E.abilities.map(k => [k, sys.abilities[k].total]));
    const stored = sys.multiClass?.classes ?? [];
    const classes = classItems.map(i => {
      const id = i.system.identifier;
      const multi = sys.multi?.classes.find(c => c.identifier === id);
      return multi ? { identifier: id, level: multi.level, xp: multi.xp }
        : (stored.find(c => c.identifier === id) ?? { identifier: id, level: sys.level, xp: sys.xp });
    });
    const elig = multiEligibility({ combinations: raceItem?.system.multiClass, kitCombos: raceItem?.system.multiClassKits, classes,
      next: next.system, alignment: sys.alignment, scores });
    const i18n = k => game.i18n.localize(k);
    const esc = v => foundry.utils.escapeHTML(String(v ?? ""));
    const names = classItems.map(i => i.name).join("/");
    const fmt = { from: names, to: next.name, race: raceItem?.name ?? "—" };
    const reasons = elig.reasons.map(r => `<li>${esc(game.i18n.format(`AD2E.Multi.Reason.${r}`, fmt))}</li>`).join("");
    const cap = id => id.charAt(0).toUpperCase() + id.slice(1);
    const kitName = id => cap(id.replace(/-/g, " "));
    const combos = [...[...(raceItem?.system.multiClass ?? [])].map(c => c.split("/").map(cap).join("/")),
      ...Object.entries(raceItem?.system.multiClassKits ?? {}).map(([c, kits]) => `${c.split("/").map(cap).join("/")} (${kits.map(kitName).join(" / ")})`)].join(", ");
    const buttons = [];
    if (elig.ok) buttons.push({ action: "multi", label: game.i18n.format("AD2E.Multi.Become", fmt), default: true });
    buttons.push({ action: "replace", label: game.i18n.format("AD2E.Dual.Replace", { from: names, to: next.name }) });
    buttons.push({ action: "cancel", label: i18n("Cancel") });
    const choice = await foundry.applications.api.DialogV2.wait({
      window: { title: i18n("AD2E.Multi.Title") },
      content: `<p>${esc(game.i18n.format("AD2E.Multi.Question", fmt))}</p>`
        + (combos ? `<p class="ad2e-note">${esc(game.i18n.format("AD2E.Multi.Combinations", { race: fmt.race, list: combos }))}</p>` : "")
        + (elig.ok ? `<p class="ad2e-note">${esc(i18n("AD2E.Multi.Explain"))}</p>`
          : `<p class="ad2e-unmet">${esc(i18n("AD2E.Multi.NotEligible"))}</p><ul>${reasons}</ul>`),
      buttons, rejectClose: false
    });
    return choice === "multi" || choice === "replace" ? choice : null;
  }

  async _onDropItem(event, item) {
    const onContainer = await dropOnContainer(this, event, item, () => this._dropItemDefault(event, item));
    return onContainer === undefined ? this._dropItemDefault(event, item) : onContainer;
  }

  /** Item rows (`draggable`, `data-item-id`) drag the owned item (module/sheets/containers-ui.mjs). */
  async _onDragStart(event) {
    if (dragItemRow(this, event)) return;
    return super._onDragStart(event);
  }

  /**
   * Race, class and kit items: one of each per character. A race or class is refused if the
   * race does not allow the class. A dropped class replaces the current class (and drops a kit
   * that does not fit it); a kit must be open to the current class.
   */
  async _dropItemDefault(event, item) {
    if (this.actor.isOwner && item.type === "proficiency" && item.parent !== this.actor) {
      const dupe = this.actor.items.find(i => i.type === "proficiency" && i.system.identifier === item.system.identifier
        && i.system.kind === item.system.kind);
      if (dupe) {
        ui.notifications.warn(game.i18n.format("AD2E.Prof.AlreadyHave", { name: item.name }));
        return null;
      }
    }
    // A dropped coin stack joins an owned stack of the same coin.
    if (this.actor.isOwner && item.type === "coin" && item.parent !== this.actor) {
      const stack = this.actor.items.find(i => i.type === "coin" && i.system.identifier === item.system.identifier);
      if (stack) return stack.update({ "system.quantity": stack.system.quantity + item.system.quantity });
    }
    // Spells: notices only (the spell is still added) for spells this class cannot use.
    // A sha'ir's spells are only the ones its gen may be asked for (module/shair.mjs): no class checks, nothing to learn.
    if (this.actor.isOwner && item.type === "spell" && item.parent !== this.actor && !isShair(this.actor)) {
      const sp = this.actor.system.spells;
      const cls = this.actor.system.classInfo.classItem?.system;
      const warn = key => ui.notifications.warn(game.i18n.format(key, { name: item.name, class: this.actor.system.classInfo.classItem?.name ?? "—" }));
      // Dual- and multi-class characters may cast a second kind of spells (`spells.extra`).
      const kinds = [sp.kind, ...(sp.extra ?? []).map(e => e.kind)].filter(Boolean);
      if (!kinds.includes(item.system.kind)) warn("AD2E.Spell.WrongKind");
      else if (cls?.opposition && item.system.schools.some(sc => schoolStems(sc).some(st => schoolStems(cls.opposition).includes(st)))) {
        warn("AD2E.Spell.OppositionSchool");
      } else if (AD2E.limitedSpheres[sp.table]
        && !item.system.spheres.some(sp2 => ["all", ...AD2E.limitedSpheres[sp.table]].includes(sp2.toLowerCase()))) {
        warn("AD2E.Spell.SphereNotAllowed");
      }
      // A wizard spell found by a wizard (or bard): roll to learn it (Intelligence (PHB)), or add it without a roll.
      if (kinds.includes("wizard") && item.system.kind === "wizard") {
        const choice = await foundry.applications.api.DialogV2.wait({
          window: { title: game.i18n.format("AD2E.Learn.DropTitle", { name: item.name }) },
          content: `<p>${foundry.utils.escapeHTML?.(game.i18n.format("AD2E.Learn.DropText", { chance: learnChance(this.actor, item).chance })) ?? ""}</p>`,
          buttons: [{ action: "roll", label: game.i18n.localize("AD2E.Learn.Roll"), default: true },
            { action: "add", label: game.i18n.localize("AD2E.Learn.AddKnown") },
            { action: "cancel", label: game.i18n.localize("AD2E.Learn.Cancel") }],
          rejectClose: false
        });
        if (!choice || choice === "cancel") return null;
        if (choice === "roll") {
          const data = item.toObject();
          delete data._id;
          foundry.utils.mergeObject(data, { system: { learned: false, learnFailedLevel: null, prepared: 0, cast: 0 } });
          const [created] = await this.actor.createEmbeddedDocuments("Item", [data]);
          if (created) await rollLearnSpell(this.actor, created);
          return created ?? null;
        }
      }
    }
    if (this.actor.isOwner && item.type === "weapon" && item.parent !== this.actor) {
      const sp = this.actor.system.proficiencies?.sp;
      const prof = sp ? weaponFamiliarity(item.system.proficiency, sp.known) === "proficient"
        : this.actor.items.find(i => i.type === "proficiency" && i.system.kind === "weapon" && i.system.identifier === item.system.proficiency);
      if (!prof) ui.notifications.info(game.i18n.format("AD2E.Weapon.DropNotProficient",
        { name: item.name, penalty: this.actor.system.proficiencies.penalty }));
    }
    if (!this.actor.isOwner || !["race", "class", "kit"].includes(item.type)) return super._onDropItem(event, item);
    if (item.parent === this.actor) return super._onDropItem(event, item); // sorting an owned item
    const current = this.actor.items;
    const raceItem = current.find(i => i.type === "race");
    const classItem = current.find(i => i.type === "class");
    // Multi-class (world setting): every class item; a kit or race must suit them (the kit: any of them).
    const classItems = multiClassOn() ? current.filter(i => i.type === "class") : (classItem ? [classItem] : []);
    const kitItem = current.find(i => i.type === "kit");
    const remove = [];
    const raceAllows = (race, classId) => race.system.classes.has(classId) || race.system.kitClasses?.has(classId);
    // Can this kit be used by this race for this class? (race-only kits; classes reached only through a kit)
    const kitOkForRace = (kit, race, classId) => {
      if (!race) return true;
      if ((kit.system.racesBarred ?? []).includes(race.system.identifier)) return false;
      const listed = race.system.identifier in (kit.system.raceLimits ?? {});
      if (kit.system.raceOnly && !listed) return false;
      return race.system.classes.has(classId) || listed;
    };
    if (item.type === "race") {
      const barred = classItems.find(c => !raceAllows(item, c.system.identifier));
      if (barred) {
        ui.notifications.warn(game.i18n.format("AD2E.Race.ClassNotForRace", { class: barred.name, race: item.name }));
        return null;
      }
      if (raceItem) remove.push(raceItem.id);
      if (kitItem && classItems.length && !classItems.some(c => kitOkForRace(kitItem, item, c.system.identifier))) remove.push(kitItem.id);
    } else if (item.type === "class") {
      if (raceItem && !raceAllows(raceItem, item.system.identifier)) {
        ui.notifications.warn(game.i18n.format("AD2E.Race.ClassNotForRace", { class: item.name, race: raceItem.name }));
        return null;
      }
      // Multi-class (world setting, module/multi-class.mjs): a demihuman whose race has combinations may add the class.
      if (classItem && multiClassOn() && ([...(raceItem?.system.multiClass ?? [])].length || Object.keys(raceItem?.system.multiClassKits ?? {}).length)
        && !classItems.some(c => c.system.identifier === item.system.identifier)) {
        const choice = await this.#askMultiClass(classItems, item, raceItem);
        if (!choice) return null;
        if (choice === "multi") {
          // All classes start at 1st level with no experience (creation only): entries for every class but the primary
          // one, whichever that turns out to be (module/multi-class.mjs primaryClass).
          const ids = [...classItems.map(c => c.system.identifier), item.system.identifier];
          await this.actor.update({ "system.multiClass.classes": ids.map(identifier => ({ identifier, level: 1, xp: 0 })),
            "system.level": 1, "system.xp": 0 });
          const created = await super._onDropItem(event, item);
          await ChatMessage.create({ speaker: ChatMessage.getSpeaker({ actor: this.actor }), content: `<p>${foundry.utils.escapeHTML(
            game.i18n.format("AD2E.Multi.Added", { name: this.actor.name, classes: [...classItems.map(c => c.name), item.name].join("/") }))}</p>` });
          return created;
        }
        // Replacing: every current class goes.
        for (const c of classItems) if (c !== classItem) remove.push(c.id);
      } else if (classItem && dualClassOn() && classItem.system.identifier !== item.system.identifier) {
        // Dual-class (world setting, module/dual-class.mjs): keep the current class as an earlier class instead of replacing it.
        const choice = await this.#askDualClass(classItem, item, raceItem);
        if (!choice) return null;
        if (choice === "dual") {
          const prev = this.actor.system.dualClass?.previous ?? [];
          await this.actor.update({
            "system.dualClass.previous": [...prev.map(p => ({ ...p, prime: [...(p.prime ?? [])] })), {
              identifier: classItem.system.identifier, name: classItem.name, group: classItem.system.group,
              level: this.actor.system.level, school: classItem.system.school ?? "", prime: [...(classItem.system.prime ?? [])],
              xp: this.actor.system.xp ?? 0 }],
            "system.dualClass.penalty": { encounter: false, adventure: false },
            "system.level": 1, "system.xp": 0
          });
          await ChatMessage.create({ speaker: ChatMessage.getSpeaker({ actor: this.actor }), content: `<p>${foundry.utils.escapeHTML(
            game.i18n.format("AD2E.Dual.Switched", { name: this.actor.name, from: classItem.name, level: this.actor.system.dualClass.previous.at(-1)?.level ?? "", to: item.name }))}</p>` });
        }
      }
      if (classItem) remove.push(classItem.id);
      if (kitItem && (!kitItem.system.classes.has(item.system.identifier)
        || !kitOkForRace(kitItem, raceItem, item.system.identifier))) remove.push(kitItem.id);
      if (raceItem && !raceItem.system.classes.has(item.system.identifier)) {
        ui.notifications.info(game.i18n.format("AD2E.Race.NeedsRaceKit", { class: item.name, race: raceItem.name }));
      }
    } else {
      if (!classItem) {
        ui.notifications.warn(game.i18n.localize("AD2E.Class.NeedClassFirst"));
        return null;
      }
      // Multi-class: one kit, open to any of the classes (owner's ruling).
      const kitClass = classItems.find(c => item.system.classes.has(c.system.identifier) && kitOkForRace(item, raceItem, c.system.identifier))
        ?? classItems.find(c => item.system.classes.has(c.system.identifier));
      if (!kitClass) {
        ui.notifications.warn(game.i18n.format("AD2E.Class.KitNotForClass",
          { kit: item.name, class: classItems.map(c => c.name).join("/") }));
        return null;
      }
      if (!kitOkForRace(item, raceItem, kitClass.system.identifier)) {
        ui.notifications.warn(game.i18n.format("AD2E.Race.KitNotForRace", { kit: item.name, race: raceItem.name }));
        return null;
      }
      if (kitItem) remove.push(kitItem.id);
      if (classItems.length > 1 && SINGLE_CLASS_KITS[item.system.source]) {
        ui.notifications.warn(game.i18n.format("AD2E.Multi.KitSingleClass", { source: item.system.source, page: SINGLE_CLASS_KITS[item.system.source] }));
      }
    }
    // A removed kit takes the bonus proficiencies it granted with it.
    for (const id of remove) {
      const removed = current.get?.(id) ?? current.find(i => i.id === id);
      if (removed?.type === "kit") await this.actor.removeKitProficiencies(removed.system.identifier);
    }
    if (remove.length) await this.actor.deleteEmbeddedDocuments("Item", remove);
    const created = await super._onDropItem(event, item);
    if (item.type === "kit" && created) await this.actor.grantKitProficiencies(item);
    return created;
  }

  static async onRollFirstLevelHp() {
    if (this.actor.system.level > 1) {
      const ok = await foundry.applications.api.DialogV2.confirm({
        window: { title: game.i18n.localize("AD2E.HP.RollFirst") },
        content: `<p>${game.i18n.localize("AD2E.HP.ConfirmReset")}</p>`, rejectClose: false
      });
      if (!ok) return;
    }
    return this.actor.rollFirstLevelHitPoints();
  }

  static onLevelUp(event, target) {
    return this.actor.levelUp(target?.dataset?.classId || null);
  }

  static onOpenItem(event, target) {
    return this.actor.items.get(target.dataset.itemId)?.sheet.render({ force: true });
  }

  static async onDeleteItem(event, target) {
    const item = this.actor.items.get(target.dataset.itemId);
    if (item?.type === "kit") await this.actor.removeKitProficiencies(item.system.identifier);
    return item?.delete();
  }

  static onRollWeaponAttack(event, target) {
    return this.actor.rollWeaponAttack(target.dataset.itemId, target.dataset.use);
  }

  static onRollWeaponDamage(event, target) {
    return this.actor.rollWeaponDamage(target.dataset.itemId, target.dataset.use);
  }

  /** +/- memorized count of a spell. */
  static onAdjustPrepared(event, target) {
    const spell = this.actor.items.get(target.dataset.itemId);
    if (!spell || spell.system.learned === false) return;
    const prepared = Math.max(spell.system.prepared + Number(target.dataset.delta), 0);
    return spell.update({ "system.prepared": prepared, "system.cast": Math.min(spell.system.cast, prepared) });
  }

  static onLearnSpell(event, target) {
    const spell = this.actor.items.get(target.dataset.itemId);
    return spell ? rollLearnSpell(this.actor, spell) : null;
  }

  static onRollSpellDamage(event, target) {
    return this.actor.rollSpellDamage(target.dataset.itemId);
  }

  static onCastSpell(event, target) {
    return this.actor.castSpell(target.dataset.itemId);
  }

  static onSummonGen() { return summonGen(this.actor); }

  static onDismissGen() { return dismissGen(this.actor); }

  static onGenDeath() { return genDeath(this.actor); }
  /** A disadvantage taken as moderate or severe (its points). */
  static onToggleSeverity(event, target) {
    const item = this.actor.items.get(target.dataset.itemId);
    if (item?.type === "trait") return item.update({ "system.severity": item.system.severity === "severe" ? "moderate" : "severe" });
  }
  static onRaiseGen() { return raiseGen(this.actor); }
  static onGenBack() { return genBack(this.actor); }
  static onBreakGenLink() { return breakGenLink(this.actor, "dispel"); }
  /** Send the gen away: forced away, threatened, master on another plane or an elemental plane, an errand. */
  static async onGenAway() {
    const i18n = k => game.i18n.localize(k);
    const reason = await foundry.applications.api.DialogV2.wait({ window: { title: i18n("AD2E.Gen.AwayTitle") },
      content: `<p>${i18n("AD2E.Gen.AwayText")}</p>`,
      buttons: ["forced", "threatened", "plane", "elemental", "errand"].map(k => ({ action: k, label: i18n(`AD2E.Gen.Away.${k}`) })), rejectClose: false });
    if (reason) return sendGenAway(this.actor, reason);
  }

  static onRequestSpell(event, target) {
    return requestSpell(this.actor, target.dataset.itemId);
  }

  /** GM: the gen comes back now (without waiting for world time). */
  static onGenReturnNow() {
    if (game.user.isGM) return genReturns(this.actor);
  }

  static onRestSpells() {
    return this.actor.restSpells();
  }

  static onRollClassSkill(event, target) {
    return this.actor.rollClassSkill(target.dataset.skill);
  }

  static onRollSurprise() { return this.actor.rollSurprise(); }

  static onRecoverTemp() { return this.actor.recoverTemporary(); }

  static onRollUnarmed(event, target) { return this.actor.rollUnarmed(target.dataset.form); }

  /** Henchmen section (Bio tab): Charisma limits (PHB Table 6), the list, and level / lifetime-limit warnings. */
  /** Familiar (module/familiars.mjs): shown for wizards and whenever one is linked. */
  _familiarContext() {
    const sys = this.actor.system;
    const f = familiarInfo(this.actor);
    if (sys.classGroup !== "wizard" && !f.uuid) return null;
    const i18n = k => game.i18n.localize(k);
    const days = daysSinceAttempt(this.actor);
    const a = f.actor;
    return { ...f, isGM: !!game.user?.isGM, name: a?.name ?? "", img: a?.img ?? "icons/svg/pawprint.svg",
      meta: a ? [`HP ${a.system.hp.value}/${a.system.hp.max}`, `AC ${a.system.ac?.value ?? a.system.ac?.base}`, f.senses,
        f.surprise ? `${i18n("AD2E.Familiar.Surprise")} +${f.surprise}` : null].filter(Boolean).join(" · ") : "",
      needsDeathRoll: f.dead && !f.deathResolved,
      attemptText: days === null ? i18n("AD2E.Familiar.NoAttempt") : game.i18n.format("AD2E.Familiar.LastAttempt", { days }),
      tooSoon: days !== null && days < 365,
      rule: game.i18n.format("AD2E.Familiar.Rule", { range: FAMILIAR.rules.range }) };
  }

  _henchmenContext() {
    const info = henchmenInfo(this.actor);
    const sign = n => `${n >= 0 ? "+" : ""}${n}`;
    return { ...info, loyaltyText: sign(info.loyalty),
      rows: info.list.map(h => ({ ...h, detail: h.level !== null ? game.i18n.format("AD2E.Henchmen.Level", { level: h.level })
        : (h.hitDice ? game.i18n.format("AD2E.Henchmen.HitDice", { hd: h.hitDice }) : (h.actor ? "" : game.i18n.localize("AD2E.Henchmen.Missing"))) })) };
  }

  /** An actor dropped on the sheet becomes a henchman (Henchmen (PHB)); not the character itself, not twice. */
  async _onDropActor(event, actor) {
    if (!this.actor.isOwner || !actor || actor.uuid === this.actor.uuid) return null;
    // A familiar (module/familiars.mjs): one at a time; from a compendium it is imported into the world first.
    if (isFamiliar(actor)) {
      if (this.actor.system.familiar?.uuid && this.actor.system.familiar.uuid !== actor.uuid) {
        const cur = familiarInfo(this.actor);
        if (cur.actor && !cur.dead) {
          ui.notifications.warn(game.i18n.format("AD2E.Familiar.HasOne", { name: cur.actor.name }));
          return null;
        }
      }
      const fam = actor.pack ? await CharacterSheet.#importToWorld(actor) : actor;
      if (!fam) return null;
      await this.actor.update({ "system.familiar.uuid": fam.uuid, "system.familiar.deathResolved": false });
      return fam;
    }
    // Mounts, pack animals and pets go to the animal list (module/animals.mjs); other actors are henchmen.
    if (isAnimal(actor)) {
      // From a compendium: import a copy into the world (a compendium entry cannot carry a load or a rider).
      const animal = actor.pack ? await CharacterSheet.#importToWorld(actor) : actor;
      if (!animal) return null;
      const animals = this.actor.system.animals?.actors ?? [];
      if (!animals.includes(animal.uuid)) await this.actor.update({ "system.animals.actors": [...animals, animal.uuid] });
      // Animal Master / Rider (module/companions.mjs): offer to bond a fitting animal when there is no bond yet.
      const kind = bondKind(this.actor);
      const fits = kind && animal.system?.role === (kind === "companion" ? "pet" : "mount") && !this.actor.system.bond?.[kind];
      if (fits && !canBond(this.actor, animal, kind)) {
        const ok = await foundry.applications.api.DialogV2.confirm({ window: { title: game.i18n.localize(`AD2E.Bond.Title.${kind}`) },
          content: `<p>${foundry.utils.escapeHTML(game.i18n.format(`AD2E.Bond.Ask.${kind}`, { name: animal.name }))}</p>`
            + (kind === "companion" && oversizeCompanion(animal) ? `<p class="ad2e-unmet">${foundry.utils.escapeHTML(game.i18n.format("AD2E.Bond.Oversize",
              { name: animal.name, size: animal.system.size }))}</p>` : ""), rejectClose: false });
        if (ok) await setBond(this.actor, animal, kind);
      }
      return animal;
    }
    const list = this.actor.system.henchmen?.actors ?? [];
    if (list.includes(actor.uuid)) return null;
    await this.actor.update({ "system.henchmen.actors": [...list, actor.uuid] });
    return actor;
  }

  /** A world copy of a compendium actor (null, with a warning, when the user may not create actors). */
  static async #importToWorld(actor) {
    if (!(Actor.implementation.canUserCreate?.(game.user) ?? game.user.isGM)) {
      ui.notifications.warn(game.i18n.format("AD2E.Animal.ImportFirst", { name: actor.name }));
      return null;
    }
    const animal = await Actor.implementation.create(game.actors.fromCompendium(actor));
    if (animal) ui.notifications.info(game.i18n.format("AD2E.Animal.Imported", { name: animal.name }));
    return animal ?? null;
  }

  /** An animal saved as a compendium link (0.0.75): import it into the world and replace the link in place. */
  static async onImportAnimal(event, target) {
    const uuid = target.dataset.uuid;
    const source = await fromUuid(uuid);
    if (!source) return ui.notifications.warn(game.i18n.localize("AD2E.Animal.Missing"));
    const animal = await CharacterSheet.#importToWorld(source);
    if (!animal) return null;
    const animals = this.actor.system.animals ?? { actors: [], riding: "" };
    return this.actor.update({ "system.animals.actors": animals.actors.map(u => (u === uuid ? animal.uuid : u)),
      "system.animals.riding": animals.riding === uuid ? animal.uuid : animals.riding });
  }

  /** Ride an animal (one at a time) or dismount. */
  static onToggleRiding(event, target) {
    return this.actor.update({ "system.animals.riding": target.checked ? target.dataset.uuid : "" });
  }

  /** Remove an animal from the list (dismounting first); its load no longer includes this character. */
  static async onRemoveAnimal(event, target) {
    const uuid = target.dataset.uuid;
    const animals = this.actor.system.animals ?? { actors: [], riding: "" };
    await this.actor.update({ "system.animals.actors": animals.actors.filter(u => u !== uuid),
      "system.animals.riding": animals.riding === uuid ? "" : animals.riding });
    refreshAnimals(this.actor, [uuid]);
  }

  static onRollBodyWeight() { return rollBodyWeight(this.actor); }

  static onFindFamiliar() { return findFamiliar(this.actor); }

  static onFamiliarDeath() { return familiarDeath(this.actor); }

  /** Animal companion / bonded mount panel (module/companions.mjs). */
  _bondContext() {
    const info = bondInfo(this.document);
    if (!info.kind) return null;
    const i18n = k => game.i18n.localize(k);
    const row = r => (r && !r.missing ? { ...r, meta: `${i18n("AD2E.Character.hp")} ${r.value}/${r.max}${r.dead ? ` · ${i18n("AD2E.Familiar.Dead")}` : ""}`
      + (r.bearing ? ` · ${r.bearing.distance} ${r.bearing.units} ${r.bearing.direction}` : "") } : r);
    // Animals in the list that could be bonded (role pet for a companion, mount for a mount), not already bonded.
    const role = info.kind === "companion" ? "pet" : "mount";
    const candidates = (this.document.system.animals?.actors ?? []).map(u => (foundry.utils.fromUuidSync ?? globalThis.fromUuidSync)?.(u, { strict: false }))
      .filter(a => a?.system?.role === role && !canBond(this.document, a, info.kind)).map(a => ({ uuid: a.uuid, name: a.name }));
    return { ...info, companion: row(info.companion), mount: row(info.mount), isGM: !!game.user?.isGM, candidates,
      isCompanion: info.kind === "companion", isMount: info.kind === "mount",
      current: info.kind ? (info.kind === "companion" ? row(info.companion) : row(info.mount)) : null,
      barredText: info.barred.join(", "),
      rule: info.kind ? i18n(info.kind === "companion" ? "AD2E.Bond.CompanionRule" : "AD2E.Bond.MountRule") : "" };
  }

  static #onSocialRank() {
    return rollSocialRank(this.actor);
  }

  static #onMeditate() {
    return meditate(this.actor);
  }

  static #onDisplay() {
    return weaponMasterDisplay(this.actor, sideOf);
  }

  static async #onBondRoll() {
    if (!game.user?.isGM) return;
    const kind = bondKind(this.actor);
    if (kind !== "mount") return rollBondCreature(this.actor, kind);
    // Rider: the homeland's subtable or Table 43 as printed (module/companions.mjs, owner's choice).
    const lands = ["any", ...Object.keys(COMPANIONS.homelands ?? {})];
    const homeland = await foundry.applications.api.DialogV2.prompt({
      window: { title: game.i18n.localize("AD2E.Bond.MountTable") },
      content: `<div class="form-group"><label>${game.i18n.localize("AD2E.Bond.HomelandLabel")}</label><select name="homeland">`
        + lands.map(l => `<option value="${l}">${foundry.utils.escapeHTML(game.i18n.localize(`AD2E.Bond.Homeland.${l}`))}`
          + `${l === "any" ? "" : ` (${COMPANIONS.homelands[l].map(r => r.name).join(", ")})`}</option>`).join("")
        + `</select></div><p class="ad2e-note">${game.i18n.localize("AD2E.Bond.HomelandHint")}</p>`,
      ok: { label: game.i18n.localize("AD2E.Bond.Roll"), callback: (event, button) => button.form.elements.homeland.value },
      rejectClose: false });
    if (!homeland) return;
    return rollBondCreature(this.actor, kind, homeland);
  }

  static #onBondSet(event, target) {
    const sel = target.closest("fieldset")?.querySelector("select[data-bond-candidate]");
    const actor = sel?.value ? (foundry.utils.fromUuidSync ?? globalThis.fromUuidSync)?.(sel.value, { strict: false }) : null;
    return actor ? setBond(this.actor, actor, bondKind(this.actor)) : null;
  }

  static #onBondClear() {
    const kind = bondKind(this.actor);
    return kind ? this.actor.update({ [`system.bond.${kind}`]: "" }) : null;
  }

  static async #onCompanionLost(event, target) {
    if (!game.user?.isGM) return;
    const careless = target.dataset.careless === "true";
    if (careless) {
      const ok = await foundry.applications.api.DialogV2.confirm({ window: { title: game.i18n.localize("AD2E.Bond.LostCareless") },
        content: `<p>${game.i18n.localize("AD2E.Bond.CarelessConfirm")}</p>`, rejectClose: false });
      if (!ok) return;
    }
    return companionLost(this.actor, careless);
  }

  static async #onMountDied() {
    if (!game.user?.isGM) return;
    const choice = await foundry.applications.api.DialogV2.wait({ window: { title: game.i18n.localize("AD2E.Bond.MountDiedTitle") },
      content: `<p>${game.i18n.localize("AD2E.Bond.MountDiedQuestion")}</p>`,
      buttons: [{ action: "normal", label: game.i18n.localize("AD2E.Bond.NotNegligent"), default: true },
        { action: "negligent", label: game.i18n.localize("AD2E.Bond.WasNegligent") }, { action: "cancel", label: game.i18n.localize("Cancel") }],
      rejectClose: false });
    if (!choice || choice === "cancel") return;
    return mountDied(this.actor, choice === "negligent");
  }

  static async #onMountFled() {
    if (!game.user?.isGM) return;
    const ok = await foundry.applications.api.DialogV2.confirm({ window: { title: game.i18n.localize("AD2E.Bond.FledTitle") },
      content: `<p>${game.i18n.localize("AD2E.Bond.FledConfirm")}</p>`, rejectClose: false });
    return ok ? mountFled(this.actor) : null;
  }

  static onRemoveFamiliar() {
    return this.actor.update({ "system.familiar.uuid": "", "system.familiar.separated": false, "system.familiar.deathResolved": false });
  }

  static async onOpenHenchman(event, target) {
    const actor = (foundry.utils.fromUuidSync ?? globalThis.fromUuidSync)?.(target.dataset.uuid, { strict: false });
    return actor?.sheet?.render({ force: true });
  }

  static async onRemoveHenchman(event, target) {
    const list = (this.actor.system.henchmen?.actors ?? []).filter(u => u !== target.dataset.uuid);
    return this.actor.update({ "system.henchmen.actors": list });
  }

  static async onHenchmanMorale(event, target) {
    const actor = (foundry.utils.fromUuidSync ?? globalThis.fromUuidSync)?.(target.dataset.uuid, { strict: false }) ?? null;
    return rollHenchmanMorale(this.actor, actor);
  }

  static onAwardXp() { return this.actor.awardExperience(); }

  static onHpDamage() { return promptHitPoints(this.actor, false); }

  static onHpHeal() { return promptHitPoints(this.actor, true); }

  static onHpRest() { return this.actor.restHeal(); }

  static onBindWounds() { return this.actor.bindWounds(); }

  static onRaiseDead() { return this.actor.raiseFromDead(); }

  /** Generate ability scores (PHB Methods II-VI). */
  static onRollAbilityScores() {
    return new AbilityRoller(this.actor).render({ force: true });
  }

  static onUseMagicItem(event, target) {
    return this.actor.useMagicItem(target.dataset.itemId);
  }

  static onRollTurnUndead() {
    return this.actor.rollTurnUndead();
  }

  static onLayOnHands() {
    return this.actor.layOnHands();
  }

  /** Containers: take an item out (it is then carried loose). */
  static onTakeOut(event, target) {
    return this.actor.items.get(target.dataset.itemId)?.update({ "system.container": "" });
  }

  /** Carried equipment counts toward encumbrance. */
  static onToggleCarried(event, target) {
    return this.actor.items.get(target.dataset.itemId)?.update({ "system.carried": target.checked });
  }

  /** Roll a jump distance (Jumping proficiency, PHB) in feet. */
  static async onRollJump(event, target) {
    const sys = this.actor.system;
    const half = Math.floor(sys.level / 2);
    const formula = { runningBroad: "2d6 + @level", runningHigh: "1d3 + @half", standingBroad: "1d6 + @half" }[target.dataset.jump];
    if (!formula) return;
    const input = await promptModifier(game.i18n.localize(`AD2E.Move.Jump_${target.dataset.jump}`));
    if (!input) return;
    const roll = await new Roll(`${formula} + @mod`, { level: sys.level, half, mod: input.mod }).evaluate();
    return roll.toMessage({
      speaker: ChatMessage.getSpeaker({ actor: this.actor }),
      flavor: `${game.i18n.localize(`AD2E.Move.Jump_${target.dataset.jump}`)}: ${roll.total} ft${modifierText(input.mod, input.note)}`
        + (target.dataset.jump.endsWith("Broad") && target.dataset.jump.startsWith("running")
          ? ` (${game.i18n.localize("AD2E.Move.BroadCap")})` : "")
        + (target.dataset.jump === "runningHigh" ? ` (${game.i18n.localize("AD2E.Move.HighCap")})` : "")
    });
  }

  /** Equip/unequip armour; equipping body armour or a shield unequips the other items of that kind. */
  static onToggleEquipped(event, target) {
    const item = this.actor.items.get(target.dataset.itemId);
    if (!item) return;
    const updates = [{ _id: item.id, "system.equipped": target.checked }];
    if (target.checked && item.type === "weapon") updates[0]["system.dropped"] = false;
    if (target.checked && item.system.kind !== "helmet") {
      for (const other of this.actor.items) {
        if (other.type === "armor" && other.id !== item.id && other.system.kind === item.system.kind && other.system.equipped) {
          updates.push({ _id: other.id, "system.equipped": false });
        }
      }
    }
    return this.actor.updateEmbeddedDocuments("Item", updates);
  }

  /** Combat tab: put a weapon away (sheathed, slung or stowed; still carried). */
  static onStowWeapon(event, target) {
    return this.actor.stowWeapon(target.dataset.itemId, { drop: false });
  }

  /** Combat tab: drop a weapon (no longer carried until picked up). */
  static onDropWeapon(event, target) {
    return this.actor.stowWeapon(target.dataset.itemId, { drop: true });
  }

  /** Equipment tab: pick up a dropped weapon (carried, not in hand). */
  static onPickUpWeapon(event, target) {
    return this.actor.items.get(target.dataset.itemId)?.update({ "system.dropped": false });
  }

  /** +/- buttons for weapon and ammunition quantities. */
  static onAdjustQuantity(event, target) {
    const item = this.actor.items.get(target.dataset.itemId);
    if (!item) return;
    return item.update({ "system.quantity": Math.max(item.system.quantity + Number(target.dataset.delta), 0) });
  }

  static onToggleSpecialized(event, target) {
    const item = this.actor.items.get(target.dataset.itemId);
    return item?.update({ "system.specialized": target.checked });
  }

  /** Skills & Powers proficiency options (weapon of choice, expertise, mastery, a style's improvement). */
  static onToggleProfFlag(event, target) {
    const field = target.dataset.field;
    if (!["choice", "expertise", "mastery", "improved"].includes(field)) return;
    const item = this.actor.items.get(target.dataset.itemId);
    return item?.update({ [`system.${field}`]: target.checked });
  }

  static onRollProficiency(event, target) {
    return this.actor.rollProficiency(target.dataset.itemId);
  }

  static onRollAbility(event, target) {
    return this.document.rollAbilityCheck(target.dataset.ability);
  }

  static onRollTest(event, target) {
    return this.document.rollAbilityTest(target.dataset.test);
  }

  static onRollSave(event, target) {
    return this.document.rollSave(target.dataset.save);
  }

  static onRollAttack(event, target) {
    return this.document.rollAttack({ missile: target.dataset.missile === "true" });
  }
}
