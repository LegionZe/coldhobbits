import { AD2E, armorSummary, equipmentSummary, schoolStems } from "../config.mjs";
import { modifierText, promptModifier } from "../roll-modifiers.mjs";

const { HandlebarsApplicationMixin } = foundry.applications.api;

/** "Agriculture or Fishing, Survival" from kit proficiency entries ({ choice: [identifier, ...] }). */
export function formatKitProficiencies(entries) {
  const title = id => id.split("-").map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
  return (entries ?? []).map(e => e.choice.map(title).join(` ${game.i18n.localize("AD2E.Prof.Or")} `)).join(", ");
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
    return { use: u, label: game.i18n.localize(label), hit: signed(a.hit), dmg: signed(a.dmg), rate: a.rate,
      pointBlank: !!a.pointBlank, damageHint: damage };
  });
  const meta = [w.size, w.type, w.speed !== null ? `${game.i18n.localize("AD2E.Weapon.Speed")} ${w.speed}` : null, damage]
    .filter(v => v).join(" · ");
  return { uses, meta };
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
      deleteItem: CharacterSheet.onDeleteItem,
      rollProficiency: CharacterSheet.onRollProficiency,
      rollAttack: CharacterSheet.onRollAttack,
      rollWeaponAttack: CharacterSheet.onRollWeaponAttack,
      rollWeaponDamage: CharacterSheet.onRollWeaponDamage,
      toggleSpecialized: CharacterSheet.onToggleSpecialized,
      adjustQuantity: CharacterSheet.onAdjustQuantity,
      toggleEquipped: CharacterSheet.onToggleEquipped,
      rollJump: CharacterSheet.onRollJump,
      toggleCarried: CharacterSheet.onToggleCarried,
      adjustPrepared: CharacterSheet.onAdjustPrepared,
      castSpell: CharacterSheet.onCastSpell,
      restSpells: CharacterSheet.onRestSpells,
      rollClassSkill: CharacterSheet.onRollClassSkill,
      rollTurnUndead: CharacterSheet.onRollTurnUndead,
      layOnHands: CharacterSheet.onLayOnHands,
      useMagicItem: CharacterSheet.onUseMagicItem
    }
  };

  static PARTS = {
    header: { template: "systems/ad2e/templates/actor/character-header.hbs" },
    tabs: { template: "templates/generic/tab-navigation.hbs" },
    main: { template: "systems/ad2e/templates/actor/character-main.hbs", scrollable: [""] },
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
      tabs: [{ id: "main" }, { id: "weapons" }, { id: "class" }, { id: "features" }, { id: "proficiencies" }, { id: "spells" }, { id: "abilities" }, { id: "bio" }],
      initial: "main",
      labelPrefix: "AD2E.Tab"
    }
  };

  /** Coin quantity inputs edit the coin item (they have no form name, so the actor form ignores them). */
  _onRender(context, options) {
    super._onRender?.(context, options);
    for (const input of this.element?.querySelectorAll?.("input[data-coin-quantity]") ?? []) {
      input.addEventListener("change", event => {
        const coin = this.actor.items.get(event.currentTarget.dataset.itemId);
        const n = Math.max(Math.floor(Number(event.currentTarget.value) || 0), 0);
        coin?.update({ "system.quantity": n });
      });
    }
  }

  /** Give each tab part its own ApplicationTab entry (same pattern as dnd5e WelcomeScreen). */
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
      exceptional: sys.abilities[key].exceptional
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
    context.spellTab = this._spellTabContext(sys);
    context.featureTab = this._featureTabContext(sys);
    context.movement = this._movementContext(sys);
    const enc = sys.encumbrance.info;
    context.moveLabel = `${enc.rate}${enc.category ? ` (${game.i18n.localize(`AD2E.Enc.${enc.category}`)})` : ""}`;
    context.weaponTab = this._weaponTabContext(sys);
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
      kitBonusProfs: formatKitProficiencies(info.kitItem?.system.bonusProficiencies),
      kitRequiredProfs: formatKitProficiencies(info.kitItem?.system.requiredProficiencies),
      kitBonusSlots: info.kitItem ? [["weapon", "AD2E.Prof.Weapon"], ["nonweapon", "AD2E.Prof.Nonweapon"]]
        .filter(([k]) => info.kitItem.system.bonusSlots?.[k]).map(([k, l]) => `+${info.kitItem.system.bonusSlots[k]} ${game.i18n.localize(l)}`).join(", ") : "",
      overLevelLimit: !!info.levelLimit && sys.level > info.levelLimit,
      classItem: info.classItem,
      kitItem: info.kitItem,
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
      jumpHint: game.i18n.localize(canJump ? "AD2E.Move.JumpHint" : "AD2E.Move.NoJump")
    };
  }

  /** Display data for the Class Abilities tab: skills table, class ability buttons, class features, kit. */
  _featureTabContext(sys) {
    const info = sys.classAbilities.info;
    const i18n = k => game.i18n.localize(k);
    const fmt = (k, d) => game.i18n.format(k, d);
    const sgn = v => (v ? signed(v) : "—");
    const def = AD2E.skillClasses[info.classId] ?? null;
    const features = (AD2E.classFeatures[info.classId] ?? []).map(([key, level]) => ({
      name: i18n(`AD2E.Feature.${info.classId}.${key}.name`), text: i18n(`AD2E.Feature.${info.classId}.${key}.text`),
      level: fmt("AD2E.Ability2.Level", { n: level }), gained: sys.level >= level
    }));
    const kitItem = sys.classInfo.kitFits ? sys.classInfo.kitItem : null;
    const kitAdjust = kitItem ? AD2E.thiefSkills.filter(k => kitItem.system.skillAdjust?.[k])
      .map(k => `${i18n(`AD2E.Skill.${k}`)} ${signed(kitItem.system.skillAdjust[k])}%`).join(", ") : "";
    // Kit modifiers at the character's level: applied automatically, situational (roll dialogs), or for the DM.
    const kitMods = (sys.kitMods?.list ?? []).map(m => ({
      text: formatKitModifier(m, { resolved: m.active }), status: m.status, statusLabel: i18n(`AD2E.Kit.Status.${m.status}`)
    }));
    const kitPoints = kitItem?.system.skillPoints?.first !== null && kitItem?.system.skillPoints?.first !== undefined
      ? fmt("AD2E.Kit.SkillPoints", { first: kitItem.system.skillPoints.first, per: kitItem.system.skillPoints.perLevel ?? 30 }) : "";
    return {
      classItem: sys.classInfo.classItem,
      hasSkills: info.skills.length > 0,
      skillTitle: i18n({ thief: "AD2E.Skill.Skills", bard: "AD2E.Skill.BardAbilities", ranger: "AD2E.Skill.RangerSkills" }[info.classId] ?? "AD2E.Skill.Skills"),
      showPoints: !!def?.points,
      showArmor: !!def?.armor,
      skills: info.skills.map(sk => ({ ...sk, label: i18n(`AD2E.Skill.${sk.key}`), raceText: sgn(sk.race), dexText: sgn(sk.dex),
        armorText: sgn(sk.armor), kitText: sgn(sk.kit) })),
      budget: info.budget ? fmt("AD2E.Skill.Budget", info.budget) : "",
      budgetOver: !!info.budget?.over,
      perSkillMax: info.perSkillMax !== null ? fmt("AD2E.Skill.PerSkillMax", { n: info.perSkillMax }) : "",
      cap: info.classId === "thief",
      ranger: info.classId === "ranger",
      trapNote: info.skills.some(sk => sk.key === "rt"),
      armorBlocked: info.armorBlocked,
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
    const levels = sp.levels.map(l => ({
      ...l,
      label: l.level === 0 ? i18n("AD2E.Spell.Cantrips") : ordinal(l.level),
      slotText: !(l.bonus || l.school) ? "" : [l.base ? `${l.base}` : null, l.bonus ? `+${l.bonus} ${i18n("AD2E.Spell.WisdomBonus")}` : null,
        l.school ? `+${l.school} ${i18n("AD2E.Spell.SchoolBonus")}` : null].filter(Boolean).join(" "),
      rows: l.spells.map(i => {
        const s = i.system;
        const comps = ["verbal", "somatic", "material"].filter(c => s.components[c]).map(c => c[0].toUpperCase()).join("");
        return { id: i.id, name: i.name, img: i.img, reversible: s.reversible, prepared: s.prepared,
          remaining: Math.max(s.prepared - s.cast, 0), usable: s.kind === sp.kind,
          meta: [(s.kind === "priest" ? s.spheres : s.schools).join("/"), comps,
            `${i18n("AD2E.Spell.CT")} ${s.castingTime}`, `${i18n("AD2E.Spell.R")} ${s.range}`,
            `${i18n("AD2E.Spell.D")} ${s.duration}`, `${i18n("AD2E.Spell.AoE")} ${s.area}`, `${i18n("AD2E.Spell.Save")} ${s.save}`]
            .filter(v => v && !/ $/.test(v)).join(" · ") };
      }).sort((a, b) => a.name.localeCompare(b.name))
    }));
    return { kind: sp.kind ? i18n(`AD2E.Spell.${sp.kind}`) : null, castingLevel: sp.castingLevel, levels,
      hasSlots: sp.levels.some(l => l.slots > 0) };
  }

  /** Display data for the Weapons tab: owned weapon items and their proficiency status. */
  _weaponTabContext(sys) {
    const actor = this.document;
    const rows = sys.weapons.map(e => ({
      id: e.item.id, name: e.item.name, img: e.item.img, url: e.item.system.url, quantity: e.item.system.quantity, ...weaponDisplay(e),
      status: e.proficient
        ? game.i18n.localize(e.specialized ? "AD2E.Weapon.Specialized" : "AD2E.Weapon.Proficient")
        : game.i18n.format("AD2E.Weapon.NotProficient", { penalty: e.penalty }),
      proficient: e.proficient, specialized: e.specialized, profId: e.proficiency?.id ?? null,
      bonus: magicBonus(e.item.system.bonus),
      ammo: (actor.ammunitionFor?.(e.item) ?? []).map(a => `${a.name} ×${a.system.quantity}`).join(", "),
      launcher: !!actor.ammunitionFor?.(e.item)
    })).sort((a, b) => a.name.localeCompare(b.name));
    const weaponNames = new Map(sys.weapons.map(e => [e.item.system.identifier, e.item.name]));
    const label = id => weaponNames.get(id) ?? id.replace(/-/g, " ");
    const ammo = (actor.items?.filter(i => i.type === "ammunition") ?? []).map(a => ({
      id: a.id, name: a.name, img: a.img, url: a.system.url, quantity: a.system.quantity, empty: a.system.quantity < 1,
      launchers: [...a.system.launchers].map(label).join(", "),
      damage: `${a.system.damage.sm ?? "—"} / ${a.system.damage.l ?? "—"}`,
      bonus: magicBonus(a.system.bonus)
    })).sort((a, b) => a.name.localeCompare(b.name));
    const a = sys.armor;
    const armor = (actor.items?.filter(i => i.type === "armor") ?? []).map(i => ({
      id: i.id, name: i.name, img: i.img, url: i.system.url, kind: i.system.kind, equipped: i.system.equipped, summary: armorSummary(i.system),
      meta: [i.system.cost, i.system.weight !== null ? `${i.system.weight} lb` : null].filter(Boolean).join(" · "),
      // an equipped item that does not count (a second body armour or shield) is marked
      unused: i.system.equipped && ((i.system.kind === "body" && a.body && a.body.id !== i.id)
        || (i.system.kind === "shield" && a.shield && a.shield.id !== i.id))
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
        id: i.id, name: i.name, img: i.img, url: i.system.url, quantity: i.system.quantity, denomination: i.system.denomination,
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
        summary: equipmentSummary(i.system),
        total: i.system.weight && i.system.quantity > 1 ? Math.round(i.system.weight * i.system.quantity * 10) / 10 : null
      })).sort((x, y) => x.name.localeCompare(y.name))
    })).filter(g => g.rows.length);
    // Magical items (DMG Table 88 order) and gems, jewellery and objects of art with their gp value.
    const catOrder = Object.keys(AD2E.magicCategories);
    const magic = (actor.items?.filter(i => i.type === "magic") ?? []).map(i => ({
      id: i.id, name: i.name, img: i.img, url: i.system.url, quantity: i.system.quantity, carried: i.system.carried, summary: magicSummary(i),
      category: i.system.category, usable: i.system.usesCharges ? i.system.charges.value > 0 : (!i.system.consumable || i.system.quantity > 0)
    })).sort((x, y) => catOrder.indexOf(x.category) - catOrder.indexOf(y.category) || x.name.localeCompare(y.name));
    const jewelleryItems = actor.items?.filter(i => i.type === "jewellery") ?? [];
    const treasure = {
      list: jewelleryItems.map(i => ({ id: i.id, name: i.name, img: i.img, url: i.system.url, quantity: i.system.quantity, carried: i.system.carried,
        summary: jewellerySummary(i), total: i.system.totalValue })).sort((x, y) => x.name.localeCompare(y.name)),
      gp: Math.round(jewelleryItems.reduce((n, i) => n + (i.system.totalValue ?? 0), 0) * 100) / 100
    };
    treasure.wealth = Math.round((coins.gp + treasure.gp) * 100) / 100;
    return { rows, ammo, armor, enc, coins, gear, magic, treasure, ac: acSummary, thac0: sys.thac0.value };
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
    const weaponRow = e => ({ ...row(e), ...weaponDisplay(e), specialized: e.specialized, specInvalid: e.specInvalid });
    return {
      weapon: { ...p.weapon, over: p.weapon.used > p.weapon.available,
        rows: p.entries.filter(e => e.item.system.kind === "weapon").map(weaponRow).sort(sortByName) },
      nonweapon: { ...p.nonweapon, over: p.nonweapon.used > p.nonweapon.available,
        rows: p.entries.filter(e => e.item.system.kind === "nonweapon").map(row).sort(sortByName) },
      penalty: p.penalty,
      groups: p.groups.map(g => game.i18n.localize(AD2E.nonweaponGroups[g])).join(", ")
    };
  }

  /**
   * Race, class and kit items: one of each per character. A race or class is refused if the
   * race does not allow the class. A dropped class replaces the current class (and drops a kit
   * that does not fit it); a kit must be open to the current class.
   */
  async _onDropItem(event, item) {
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
    if (this.actor.isOwner && item.type === "spell" && item.parent !== this.actor) {
      const sp = this.actor.system.spells;
      const cls = this.actor.system.classInfo.classItem?.system;
      const warn = key => ui.notifications.warn(game.i18n.format(key, { name: item.name, class: this.actor.system.classInfo.classItem?.name ?? "—" }));
      if (!sp.kind || item.system.kind !== sp.kind) warn("AD2E.Spell.WrongKind");
      else if (cls?.opposition && item.system.schools.some(sc => schoolStems(sc).some(st => schoolStems(cls.opposition).includes(st)))) {
        warn("AD2E.Spell.OppositionSchool");
      } else if (AD2E.limitedSpheres[sp.table]
        && !item.system.spheres.some(sp2 => ["all", ...AD2E.limitedSpheres[sp.table]].includes(sp2.toLowerCase()))) {
        warn("AD2E.Spell.SphereNotAllowed");
      }
    }
    if (this.actor.isOwner && item.type === "weapon" && item.parent !== this.actor) {
      const prof = this.actor.items.find(i => i.type === "proficiency" && i.system.kind === "weapon"
        && i.system.identifier === item.system.proficiency);
      if (!prof) ui.notifications.info(game.i18n.format("AD2E.Weapon.DropNotProficient",
        { name: item.name, penalty: this.actor.system.proficiencies.penalty }));
    }
    if (!this.actor.isOwner || !["race", "class", "kit"].includes(item.type)) return super._onDropItem(event, item);
    if (item.parent === this.actor) return super._onDropItem(event, item); // sorting an owned item
    const current = this.actor.items;
    const raceItem = current.find(i => i.type === "race");
    const classItem = current.find(i => i.type === "class");
    const kitItem = current.find(i => i.type === "kit");
    const remove = [];
    const raceAllows = (race, classId) => race.system.classes.has(classId) || race.system.kitClasses?.has(classId);
    // Can this kit be used by this race for this class? (race-only kits; classes reached only through a kit)
    const kitOkForRace = (kit, race, classId) => {
      if (!race) return true;
      const listed = race.system.identifier in (kit.system.raceLimits ?? {});
      if (kit.system.raceOnly && !listed) return false;
      return race.system.classes.has(classId) || listed;
    };
    if (item.type === "race") {
      if (classItem && !raceAllows(item, classItem.system.identifier)) {
        ui.notifications.warn(game.i18n.format("AD2E.Race.ClassNotForRace", { class: classItem.name, race: item.name }));
        return null;
      }
      if (raceItem) remove.push(raceItem.id);
      if (kitItem && classItem && !kitOkForRace(kitItem, item, classItem.system.identifier)) remove.push(kitItem.id);
    } else if (item.type === "class") {
      if (raceItem && !raceAllows(raceItem, item.system.identifier)) {
        ui.notifications.warn(game.i18n.format("AD2E.Race.ClassNotForRace", { class: item.name, race: raceItem.name }));
        return null;
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
      if (!item.system.classes.has(classItem.system.identifier)) {
        ui.notifications.warn(game.i18n.format("AD2E.Class.KitNotForClass",
          { kit: item.name, class: classItem.name }));
        return null;
      }
      if (!kitOkForRace(item, raceItem, classItem.system.identifier)) {
        ui.notifications.warn(game.i18n.format("AD2E.Race.KitNotForRace", { kit: item.name, race: raceItem.name }));
        return null;
      }
      if (kitItem) remove.push(kitItem.id);
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

  static onLevelUp() {
    return this.actor.levelUp();
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
    if (!spell) return;
    const prepared = Math.max(spell.system.prepared + Number(target.dataset.delta), 0);
    return spell.update({ "system.prepared": prepared, "system.cast": Math.min(spell.system.cast, prepared) });
  }

  static onCastSpell(event, target) {
    return this.actor.castSpell(target.dataset.itemId);
  }

  static onRestSpells() {
    return this.actor.restSpells();
  }

  static onRollClassSkill(event, target) {
    return this.actor.rollClassSkill(target.dataset.skill);
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
    if (target.checked && item.system.kind !== "helmet") {
      for (const other of this.actor.items) {
        if (other.type === "armor" && other.id !== item.id && other.system.kind === item.system.kind && other.system.equipped) {
          updates.push({ _id: other.id, "system.equipped": false });
        }
      }
    }
    return this.actor.updateEmbeddedDocuments("Item", updates);
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
