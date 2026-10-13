import { animationFor, sequencerHas } from "./spell-animations.mjs";
import { weaponAnimation } from "./weapon-animations.mjs";

/**
 * Sound effects from PSFX (Peri's Sound Effects, module id "psfx", https://github.com/JimHPerry/psfx; owner's request,
 * 1.0.53): when the world setting "psfxSounds" is on and Sequencer and PSFX are active, casting a spell and making an
 * attack play a matching sound for everyone. PSFX registers its sounds in Sequencer's database under "psfx" on the
 * "sequencer.ready" hook (psfx 0.18.0 scripts/init.js: `Sequencer.Database.registerEntries(MODULE_NAME, psfxDatabase)`);
 * every path below was checked against that release's scripts/psfx_sequencer.js (249 sounds). Sequencer plays them with
 * `sequence.sound().file(path).volume(v).delay(ms)` (src/sections/sound.js; traits/audio.js `volume`). Without the
 * modules nothing plays and nothing is reported. Independent of the JB2A animations (either can be on alone).
 *
 * Which sound fits which spell or weapon is an implementation choice: spells by the animation entry they match
 * (spell-animations.mjs `ANIMATIONS` ids), weapons by their animation entry (weapon-animations.mjs) and damage type.
 * Delays are implementation choices so a second sound (an explosion, an impact) follows the first.
 * A weapon item's own sound (`system.animation.sound`, weapon sheet; owner's request 1.0.56) replaces both the swing or shot
 * and the impact: "none" = silent, else a database path or a file path (wildcards allowed; spell-animations.mjs `isFilePath`).
 */

/** Spell sounds by animation id: [{ file, delay (ms) }]. PSFX paths ending in a distance use its 30 ft variant. */
export const SPELL_SOUNDS = {
  "magic-missile": [{ file: "psfx.1st-level-spells.magic-missile.v1.30ft" }],
  fireball: [{ file: "psfx.3rd-level-spells.fireball.v1.001.beam" }, { file: "psfx.3rd-level-spells.fireball.v1.001.explosion", delay: 1200 }],
  "lightning-bolt": [{ file: "psfx.3rd-level-spells.call-lightning.v1.primary" }],
  "chain-lightning": [{ file: "psfx.3rd-level-spells.call-lightning.v1.primary" }, { file: "psfx.3rd-level-spells.call-lightning.v1.secondary", delay: 600 }],
  "call-lightning": [{ file: "psfx.3rd-level-spells.call-lightning.v1.cast" }, { file: "psfx.3rd-level-spells.call-lightning.v1.primary", delay: 800 }],
  "cone-of-cold": [{ file: "psfx.5th-level-spells.cone-of-cold.v1.001" }],
  "burning-hands": [{ file: "psfx.1st-level-spells.burning-hands.v1.001" }],
  "flame-arrow": [{ file: "psfx.cantrips.fire-bolt.v1.30ft" }],
  "acid-arrow": [{ file: "psfx.cantrips.acid-splash.v1.30ft" }],
  disintegrate: [{ file: "psfx.ranged-magic.generic.beam.001" }],
  "gust-of-wind": [{ file: "psfx.cantrips.gust.v1" }],
  "ice-storm": [{ file: "psfx.impacts.magicaleffects.cold" }],
  "stinking-cloud": [{ file: "psfx.cantrips.poison-spray.v1" }],
  web: [{ file: "psfx.1st-level-spells.entangle.vines.v1.001.intro" }],
  entangle: [{ file: "psfx.1st-level-spells.entangle.vines.v1.001.intro" }],
  sleep: [{ file: "psfx.1st-level-spells.sleep.v1.001" }],
  shatter: [{ file: "psfx.cantrips.thunderclap.v1" }],
  "flame-strike": [{ file: "psfx.cantrips.sacred-flame.v1.001.target" }],
  "flaming-sphere": [{ file: "psfx.casting.fire.001" }],
  "wall-of-fire": [{ file: "psfx.casting.fire.001" }],
  cure: [{ file: "psfx.1st-level-spells.cure-wounds.v1.001" }],
  "cure-other": [{ file: "psfx.1st-level-spells.cure-wounds.v1.001" }],
  raise: [{ file: "psfx.1st-level-spells.cure-wounds.v1.001" }],
  healing: [{ file: "psfx.1st-level-spells.cure-wounds.v1.001" }],
  bless: [{ file: "psfx.1st-level-spells.bless.v1.001" }],
  shield: [{ file: "psfx.1st-level-spells.shield-spell.intro.v1.003" }],
  protection: [{ file: "psfx.magic-signs.circle" }],
  hold: [{ file: "psfx.1st-level-spells.dissonant-whispers.v1.001" }],
  charm: [{ file: "psfx.1st-level-spells.dissonant-whispers.v1.001" }],
  fear: [{ file: "psfx.1st-level-spells.dissonant-whispers.v1.001" }],
  "spiritual-hammer": [{ file: "psfx.weapon-swooshes.heavy.v1.group01" }, { file: "psfx.impacts.bludgeoning.v1", delay: 400 }],
  "detect-magic": [{ file: "psfx.1st-level-spells.detect-magic.v1.001" }],
  "dimension-door": [{ file: "psfx.2nd-level-spells.misty-step.v1.complete.generic" }],
  teleport: [{ file: "psfx.2nd-level-spells.misty-step.v1.complete.generic" }],
  invisibility: [{ file: "psfx.2nd-level-spells.misty-step.v1.complete.generic" }]
};
export const SPELL_FALLBACK = [{ file: "psfx.casting.generic.001" }];

/** Melee weapons swung heavily (weapon-animations.mjs ids); others use the light swoosh. */
export const HEAVY = new Set(["greataxe", "battleaxe", "greatsword", "nodachi", "flail", "maul", "warhammer", "mace", "greatclub",
  "club", "staff", "pick", "scythe", "glaive", "halberd", "rock"]);
export const WEAPON_SOUND = {
  light: "psfx.weapon-swooshes.light.v1.group01",
  heavy: "psfx.weapon-swooshes.heavy.v1.group01",
  spear: "psfx.weapon-attacks.spear.v1",
  bow: "psfx.ranged-weapons.longbow.v1.30ft",
  firearm: "psfx.ranged-weapons.guns.single-fire.revolver",
  bludgeoning: "psfx.impacts.bludgeoning.v1",
  slashing: "psfx.impacts.slashing.v1"
};

/** The spell's sounds (pure): [{ file, delay }] or [] when its animation is "none". */
export function spellSounds(spell) {
  const a = animationFor(spell);
  if (!a) return [];
  return SPELL_SOUNDS[a.id] ?? SPELL_FALLBACK;
}

/**
 * An attack's sounds (pure): the swing or shot, then on a hit an impact by damage type (B bludgeoning, else slashing;
 * PSFX has no piercing impact). Bows and crossbows twang; firearms fire; spears use PSFX's spear attack.
 */
export function attackSounds(attack, hit = null) {
  const own = String(attack?.sound ?? "").trim();
  if (own.toLowerCase() === "none") return [];
  if (own) return [{ file: own }];
  // The automatic sound follows the automatic animation entry (a weapon's own animation does not change it).
  const a = weaponAnimation({ ...attack, override: "" });
  if (!a) return [];
  const letter = String(attack.type ?? "").toUpperCase().match(/[SPB]/)?.[0] ?? (HEAVY.has(a.id) ? "B" : "S");
  const out = [];
  if (attack.missile) {
    if (a.id === "firearm") out.push({ file: WEAPON_SOUND.firearm });
    else if (["bow", "crossbow", "launcher"].includes(a.id)) out.push({ file: WEAPON_SOUND.bow });
    else out.push({ file: WEAPON_SOUND.light });
  } else if (a.id === "spear" || a.id === "javelin") out.push({ file: WEAPON_SOUND.spear });
  else out.push({ file: HEAVY.has(a.id) ? WEAPON_SOUND.heavy : WEAPON_SOUND.light });
  if (hit !== false) out.push({ file: letter === "B" ? WEAPON_SOUND.bludgeoning : WEAPON_SOUND.slashing, delay: attack.missile ? 700 : 300 });
  return out;
}

export function soundsOn() {
  try { return game.settings.get("ad2e", "psfxSounds") !== false; } catch { return false; }
}

export function soundVolume() {
  try { const v = Number(game.settings.get("ad2e", "psfxVolume")); return Number.isFinite(v) ? Math.min(Math.max(v, 0), 1) : 0.8; } catch { return 0.8; }
}

/** Sequencer and PSFX active, with Sequencer's globals present. */
export function psfxAvailable() {
  try {
    const active = id => !!game.modules?.get(id)?.active;
    return active("sequencer") && active("psfx") && typeof globalThis.Sequence === "function"
      && typeof globalThis.Sequencer?.Database?.entryExists === "function";
  } catch { return false; }
}

/** Play a list of sounds (never throws; entries missing from the database are skipped). */
export async function playSounds(list) {
  try {
    if (!list?.length || !soundsOn() || !psfxAvailable()) return false;
    const sounds = list.filter(s => sequencerHas(s?.file));
    if (!sounds.length) return false;
    const seq = new globalThis.Sequence({ moduleName: "ad2e", softFail: true });
    const volume = soundVolume();
    for (const s of sounds) {
      const snd = seq.sound().file(s.file).volume(volume);
      if (s.delay) snd.delay(s.delay);
    }
    await seq.play();
    return true;
  } catch (err) {
    console.debug("ad2e | sound skipped", err);
    return false;
  }
}

export const playSpellSound = spell => playSounds(spellSounds(spell));
export const playAttackSound = (attack, { hit = null } = {}) => playSounds(attackSounds(attack, hit));

export function registerSoundEffects() {
  game.settings.register("ad2e", "psfxSounds", {
    name: "AD2E.Sound.Setting", hint: "AD2E.Sound.SettingHint",
    scope: "world", config: true, type: Boolean, default: true
  });
  game.settings.register("ad2e", "psfxVolume", {
    name: "AD2E.Sound.Volume", hint: "AD2E.Sound.VolumeHint",
    scope: "world", config: true, type: Number, default: 0.8, range: { min: 0, max: 1, step: 0.05 }
  });
}
