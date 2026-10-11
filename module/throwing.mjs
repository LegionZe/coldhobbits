import { THROW_TABLES } from "./rules/throw-tables.mjs";
import { AD2E } from "./config.mjs";
import { ad2eDialog } from "./dialogs.mjs";
import { modifierFields, modifierText, readModifier } from "./roll-modifiers.mjs";

/**
 * Throwing objects (owner's request, 1.0.36; module/rules/throw-tables.mjs from tools/build-throw-tables.py):
 *  - Grenade-like missiles (Missile Weapons in Combat (PHB/DMG)): "A missile of five pounds or less can be thrown about 30
 *    feet. Short range is 10 feet, medium range is 20 feet"; heavier objects: "Just how far an object can be thrown is
 *    decided by the DM" (the GM picks the band); "Exceptionally heavy items can be thrown only if the character rolls a
 *    successful bend bars/lift gates check" (a tick box: the GM decides which items are); never heavier than the
 *    character's Maximum Press (Strength (PHB)). The usual missile range modifiers apply (-2 medium, -5 long). A hit rolls
 *    Table 45's direct damage (flagged for the GM's apply buttons, to the targets) and its splash damage (no targets:
 *    "All creatures within 3' of the area of effect"); a miss rolls the scatter (1d10 on the Scatter Diagram, 1d6 / 1d10 /
 *    2d10 feet by range, doubled for a boulder). Flaming oil's second round (1d6) is noted for the GM.
 *  - The Throwing proficiency (Player's Option: Skills & Powers): +10 feet to each range category and +1 to the attack or
 *    the damage (chosen each throw); each extra slot on the proficiency counts as one further character point, +5 feet
 *    (as the owner's ruling for Skills & Powers nonweapon ratings: an extra slot = one point). Thrown weapons: the attack dialog
 *    (AD2EActor#rollWeaponAttack, damage carried to rollWeaponDamage).
 * Implementation choices: the proficiency's bonuses also apply to thrown objects (they are thrown missiles); no
 * non-proficiency penalty for objects (they are not weapons); the attack uses the character's missile attack adjustment
 * (Dexterity, encumbrance, fatigue as other missiles) against the AC entered (the first target's, as other attacks);
 * contents default from the item (lamp oil and Greek fire = oil, lit; holy items = holy water; acids = acid); an object
 * marked "used up" loses one from its quantity.
 */
export const THROW = THROW_TABLES;
const esc = v => foundry.utils?.escapeHTML?.(String(v ?? "")) ?? String(v ?? "");

/** The character's Throwing proficiency item, or null (pure on an item list). */
export function throwingProficiency(items) {
  return [...(items ?? [])].find(i => i.type === "proficiency" && i.system?.identifier === THROW.proficiency.identifier) ?? null;
}

/** Feet added to each range category by a Throwing proficiency item (pure): 10, +5 per extra slot; 0 without it. */
export function throwingFeet(prof) {
  if (!prof) return 0;
  return THROW.proficiency.feet + THROW.proficiency.perPoint * Math.max(Number(prof.system?.extraSlots) || 0, 0);
}

/** Range bands of a thrown object in feet (pure): { short, medium, long, heavy (over 5 lb: the GM decides) }. */
export function objectRanges(weight, extraFeet = 0) {
  const r = THROW.ranges;
  return { short: r.short + extraFeet, medium: r.medium + extraFeet, long: r.long + extraFeet, heavy: Number(weight) > THROW.lightWeight };
}

/** Whether a character with this Maximum Press can throw an object of this weight at all (pure). */
export function canLift(weight, press) {
  return !(Number.isFinite(press) && Number(weight) > press);
}

/** Table 45 row key an item defaults to ("" = none; pure). */
export function contentsOf(item) {
  return THROW.contents[item?.system?.identifier] ?? "";
}

/** Scatter of a miss (pure): direction from the 1d10, `feet` rolled (doubled for a boulder). */
export function scatterResult(direction, feet, boulder = false) {
  const degrees = THROW.scatter.degrees[String(direction)];
  return { direction, degrees, feet: feet * (boulder ? THROW.scatter.boulderFactor : 1) };
}

/** Weight of one of an item (liquid containers by their current fill), or null when unknown. */
export function itemWeight(item) {
  const w = item?.system?.unitWeight ?? item?.system?.weight;
  return Number.isFinite(Number(w)) && w !== null && w !== "" ? Number(w) : null;
}

/** Items that can be thrown as objects: equipment and jewellery with some left. */
export function throwableItems(items) {
  return [...(items ?? [])].filter(i => ["equipment", "jewellery"].includes(i.type) && (i.system?.quantity ?? 1) > 0)
    .sort((a, b) => a.name.localeCompare(b.name));
}

const i18n = (k, d) => (d ? game.i18n.format(k, d) : game.i18n.localize(k));

/** Throw an object (character sheet Combat tab): dialog, attack roll, then damage or scatter. */
export async function throwObject(actor) {
  if (actor?.type !== "character") return null;
  const Actor = CONFIG.Actor.documentClass;
  const targets = Actor.targetsNow?.() ?? [];
  const prof = throwingProficiency(actor.items);
  const extra = throwingFeet(prof);
  const items = throwableItems(actor.items);
  const str = actor.system.abilityData?.str ?? {};
  const field = (label, html) => `<div class="form-group"><label>${label}</label>${html}</div>`;
  const ranges = objectRanges(0, extra);
  const rangeOpts = ["short", "medium", "long"].map(k => `<option value="${k}">${i18n(`AD2E.Weapon.${k[0].toUpperCase()}${k.slice(1)}`)} (${
    i18n("AD2E.Throw.UpTo", { ft: ranges[k] })})</option>`).join("");
  const contentOpts = [["auto", i18n("AD2E.Throw.Contents.auto")], ["", i18n("AD2E.Throw.Contents.none")],
    ...Object.keys(THROW.rows).map(k => [k, i18n(`AD2E.Throw.Contents.${k}`)]), ["oilUnlit", i18n("AD2E.Throw.Contents.oilUnlit")]]
    .map(([k, l]) => `<option value="${k}">${esc(l)}</option>`).join("");
  const input = await ad2eDialog.prompt({
    window: { title: i18n("AD2E.Throw.Title") },
    content: `<p class="hint">${esc(i18n("AD2E.Throw.Rule", { lb: THROW.lightWeight, ...THROW.ranges, press: str.press ?? "—" }))}</p>`
      + field(i18n("AD2E.Throw.Object"), `<select name="item"><option value="">${esc(i18n("AD2E.Throw.Other"))}</option>${
        items.map(i => `<option value="${i.id}">${esc(i.name)} (${itemWeight(i) ?? "?"} lb, ${i.system.quantity ?? 1})</option>`).join("")}</select>`)
      + field(i18n("AD2E.Throw.OtherWeight"), `<input type="number" name="weight" value="1" min="0" step="0.1">`)
      + field(i18n("AD2E.Throw.ContentsLabel"), `<select name="contents">${contentOpts}</select>`)
      + field(i18n("AD2E.Throw.OtherDamage"), `<input type="text" name="damage" placeholder="1d2">`)
      + field(i18n("AD2E.Roll.TargetAC"), `<input type="number" name="ac" value="${Actor.targetAcOf?.(targets, true) ?? 10}" autofocus>`)
      + field(i18n("AD2E.Weapon.Range"), `<select name="range">${rangeOpts}</select>`)
      + (prof ? field(i18n("AD2E.Throw.Proficiency", { ft: extra, n: THROW.proficiency.bonus }),
        `<select name="profBonus"><option value="hit">${esc(i18n("AD2E.Throw.ProfHit", { n: THROW.proficiency.bonus }))}</option>`
        + `<option value="damage">${esc(i18n("AD2E.Throw.ProfDamage", { n: THROW.proficiency.bonus }))}</option></select>`) : "")
      + field(i18n("AD2E.Throw.UsedUp"), `<input type="checkbox" name="usedUp" checked>`)
      + field(i18n("AD2E.Throw.Heavy", { n: str.bendBars ?? 0 }), `<input type="checkbox" name="heavy">`)
      + field(i18n("AD2E.Throw.Boulder"), `<input type="checkbox" name="boulder">`)
      + modifierFields(),
    ok: {
      label: i18n("AD2E.Throw.Throw"),
      callback: (event, button) => {
        const f = button.form.elements;
        return { item: f.item.value, weight: Number(f.weight.value) || 0, contents: f.contents.value, damage: String(f.damage.value ?? "").trim(),
          ac: Number(f.ac.value) || 0, range: f.range.value, profBonus: f.profBonus?.value ?? "", usedUp: !!f.usedUp.checked,
          heavy: !!f.heavy.checked, boulder: !!f.boulder.checked, manual: readModifier(button.form) };
      }
    },
    rejectClose: false
  });
  if (!input) return null;
  const item = input.item ? actor.items.get(input.item) : null;
  const weight = item ? (itemWeight(item) ?? 0) : input.weight;
  const name = item?.name ?? i18n("AD2E.Throw.AnObject");
  if (!canLift(weight, str.press)) {
    ui.notifications?.warn(i18n("AD2E.Throw.TooHeavy", { name, weight, press: str.press }));
    return null;
  }
  const speaker = ChatMessage.getSpeaker({ actor });
  if (input.heavy) {
    const bb = await new Roll("1d100").evaluate();
    const ok = bb.total <= (str.bendBars ?? 0);
    await bb.toMessage({ speaker, flavor: i18n(ok ? "AD2E.Throw.HeavyOk" : "AD2E.Throw.HeavyFail", { name, n: str.bendBars ?? 0 }) });
    if (!ok) return null;
  }
  const contents = input.contents === "auto" ? contentsOf(item) : input.contents;
  const row = contents && contents !== "oilUnlit" ? THROW.rows[contents] : null;
  const profHit = input.profBonus === "hit" ? THROW.proficiency.bonus : 0;
  const profDmg = input.profBonus === "damage" ? THROW.proficiency.bonus : 0;
  const thac0 = actor.system.thac0.value;
  const needed = thac0 - input.ac;
  const rangeMod = AD2E.rangeModifiers?.[input.range] ?? 0;
  const roll = await new Roll("1d20 + @adj + @range + @mod", { adj: (actor.system.mods?.missileAttack ?? 0) + profHit, range: rangeMod,
    mod: input.manual.mod }).evaluate();
  const hit = roll.total >= needed;
  const bands = objectRanges(weight, extra);
  const notes = [];
  if (bands.heavy) notes.push(i18n("AD2E.Throw.HeavyRange", { lb: THROW.lightWeight }));
  if (profHit) notes.push(i18n("AD2E.Throw.ProfHit", { n: profHit }));
  if (item && input.usedUp) {
    const left = Math.max((item.system.quantity ?? 1) - 1, 0);
    await item.update({ "system.quantity": left });
    notes.push(i18n("AD2E.Ammo.Left", { name: item.name, n: left }));
  }
  const rangeText = `${i18n(`AD2E.Weapon.${input.range[0].toUpperCase()}${input.range.slice(1)}`)}, ${i18n("AD2E.Throw.UpTo", { ft: bands[input.range] })}`;
  const targetText = targets.length ? ` → ${targets.map(t => esc(t.name)).join(", ")}` : "";
  await roll.toMessage({ speaker, flavor: `${esc(i18n("AD2E.Throw.Throws", { name }))}${contents ? ` (${esc(i18n(`AD2E.Throw.Contents.${contents}`))})` : ""} (${esc(rangeText)}) `
    + `vs AC ${input.ac}${targetText} (THAC0 ${thac0}, ${i18n("AD2E.Roll.Needs")} ${needed}+): ${i18n(hit ? "AD2E.Roll.Hit" : "AD2E.Roll.Miss")}`
    + (notes.length ? ` [${esc(notes.join("; "))}]` : "") + modifierText(input.manual.mod, input.manual.note) });
  if (!hit) return scatter(actor, input, row);
  // Direct hit: Table 45 damage (or the damage entered for another object), then the splash.
  const direct = row?.direct ?? (row ? null : input.damage || null);
  if (direct && !row && globalThis.Roll?.validate && !Roll.validate(direct)) {
    ui.notifications?.warn(i18n("AD2E.Throw.BadFormula", { formula: direct }));
  } else if (direct) {
    const dmg = await new Roll(profDmg ? `${direct} + ${profDmg}` : direct).evaluate();
    await dmg.toMessage({ speaker, flags: { ad2e: { damage: Math.max(dmg.total, 0), targets } },
      flavor: `${esc(i18n("AD2E.Throw.DirectHit", { name }))}${targetText}${row ? ` (${esc(row.name)}: ${esc(row.directText)}, ${esc(row.areaText)})` : ""}`
        + (profDmg ? ` [${esc(i18n("AD2E.Throw.ProfDamage", { n: profDmg }))}]` : "") });
  }
  if (row?.splash) {
    const splash = await new Roll(row.splash).evaluate();
    await splash.toMessage({ speaker, flags: { ad2e: { damage: splash.total, targets: [] } },
      flavor: esc(i18n("AD2E.Throw.Splash", { name: row.name, ft: THROW.splashFeet, area: row.areaText, text: row.splashText })) });
  }
  const extraNote = rowNote(contents, row);
  if (extraNote) await ChatMessage.implementation.create({ speaker, content: `<p>${esc(extraNote)}</p>` });
  return roll;
}

/** GM notes for the contents: flaming oil's second round, holy water's targets, poison, unlit oil. */
function rowNote(contents, row) {
  if (contents === "oil" && row?.later?.length) return i18n("AD2E.Throw.OilLater", { dice: row.later.join(", ") });
  if (contents === "holyWater") return i18n("AD2E.Throw.HolyNote");
  if (contents === "poison") return i18n("AD2E.Throw.PoisonNote");
  if (contents === "oilUnlit") return i18n("AD2E.Throw.OilUnlitNote");
  return "";
}

/** A miss: where the object lands (Scatter Diagram direction, feet by range; boulders twice as far). */
async function scatter(actor, input, row) {
  const dir = await new Roll(THROW.scatter.direction).evaluate();
  const dist = await new Roll(THROW.scatter.dice[input.range]).evaluate();
  const s = scatterResult(dir.total, dist.total, input.boulder);
  const text = i18n("AD2E.Throw.Scatter", { feet: s.feet, dir: i18n(`AD2E.Throw.Dir.${s.degrees}`), d10: dir.total, dice: THROW.scatter.dice[input.range],
    rolled: dist.total }) + (input.boulder ? ` ${i18n("AD2E.Throw.BoulderDoubled")}` : "")
    + (row?.direct ? ` ${i18n("AD2E.Throw.WhereItLands", { direct: row.directText, splash: row.splashText, ft: THROW.splashFeet })}` : "");
  return ChatMessage.implementation.create({ speaker: ChatMessage.getSpeaker({ actor }), rolls: [dir, dist], content: `<p>${esc(text)}</p>` });
}
