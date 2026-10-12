/**
 * Spell animations with JB2A through Sequencer (owner's request, 1.0.51): when a spell is cast and the world setting
 * "jb2aAnimations" is on, the Sequencer module is active and a JB2A module (jb2a_patreon or the free JB2A_DnD5e) is active,
 * a fitting animation plays from the caster's token to the targeted tokens. Without them nothing happens: no error and no
 * notice (owner's requirement).
 *
 * Sources:
 * - JB2A registers its files in Sequencer's database under "jb2a" on the "sequencer.ready" hook (jb2a_patreon 0.9.4
 *   scripts/jb2a.js: `Sequencer.Database.registerEntries("jb2a", patreonDatabase)`); every path below was checked against
 *   that release's database (scripts/jb2a_sequencer.js, 10,144 file paths).
 * - Sequencer (https://github.com/fantasycalendar/FoundryVTT-Sequencer, module id "sequencer", 10.0.0 verified for 14):
 *   `window.Sequence` / `window.Sequencer` (src/module.js), `new Sequence({ moduleName, softFail })`,
 *   `Sequencer.Database.entryExists(path)` (a dot-delimited prefix matches), effect methods `file`, `atLocation`,
 *   `stretchTo`, `scaleToObject`, `size(n, { gridUnits })`, `rotateTowards`, `waitUntilFinished`.
 *
 * Which animation a spell gets is an implementation choice (curated list by spell name below; a GM override per spell on
 * the spell sheet; otherwise a healing glow for healing spells and a generic casting glow on the caster).
 */
export const MODES = ["missile", "cone", "burst", "target", "caster"];

/**
 * Curated spells: `match` is tested against the lower-cased spell name; `steps` play in order. Modes: missile = from the
 * caster to each target, cone = from the caster towards the first target, burst = on the first target (else the caster),
 * target = on each target (else the caster), caster = on the caster. `size` = grid squares (burst), `scale` = times the
 * token (target, caster).
 */
export const ANIMATIONS = [
  { id: "magic-missile", match: /magic missile(?! reflection)/, steps: [{ mode: "missile", file: "jb2a.magic_missile.purple" }] },
  { id: "fireball", match: /fireball|meteor swarm/, steps: [{ mode: "missile", file: "jb2a.fireball.beam.orange" },
    { mode: "burst", file: "jb2a.fireball.explosion.orange", size: 8 }] },
  { id: "lightning-bolt", match: /lightning bolt/, steps: [{ mode: "missile", file: "jb2a.lightning_bolt.wide.blue" }] },
  { id: "chain-lightning", match: /chain lightning/, steps: [{ mode: "missile", file: "jb2a.chain_lightning.primary.blue" }] },
  { id: "call-lightning", match: /call lightning/, steps: [{ mode: "burst", file: "jb2a.call_lightning.high_res.blue", size: 4 }] },
  { id: "cone-of-cold", match: /cone of cold/, steps: [{ mode: "cone", file: "jb2a.cone_of_cold.blue" }] },
  { id: "burning-hands", match: /burning hands/, steps: [{ mode: "cone", file: "jb2a.burning_hands.01.orange" }] },
  { id: "flame-arrow", match: /flame arrow|flame bolt/, steps: [{ mode: "missile", file: "jb2a.fire_bolt.orange" }] },
  { id: "acid-arrow", match: /acid arrow/, steps: [{ mode: "missile", file: "jb2a.spell_projectile.poison.greenyellow" }] },
  { id: "disintegrate", match: /disintegrate/, steps: [{ mode: "missile", file: "jb2a.disintegrate.green" }] },
  { id: "gust-of-wind", match: /gust of wind/, steps: [{ mode: "cone", file: "jb2a.gust_of_wind.default" }] },
  { id: "ice-storm", match: /ice storm/, steps: [{ mode: "burst", file: "jb2a.sleet_storm.01.blue", size: 8 }] },
  { id: "stinking-cloud", match: /stinking cloud|cloudkill|death fog/, steps: [{ mode: "burst", file: "jb2a.fog_cloud.02.green", size: 6 }] },
  { id: "fog", match: /fog cloud|wall of fog|obscurement|solid fog/, steps: [{ mode: "burst", file: "jb2a.fog_cloud.01.white", size: 6 }] },
  { id: "darkness", match: /^darkness|^(create|creeping|crawling) darkness|enveloping darkness/, steps: [{ mode: "burst", file: "jb2a.darkness.black", size: 6 }] },
  { id: "web", match: /\bweb\b/, steps: [{ mode: "burst", file: "jb2a.web.02", size: 4 }] },
  { id: "entangle", match: /(^|\s)entangle$/, steps: [{ mode: "burst", file: "jb2a.entangle.green", size: 6 }] },
  { id: "grease", match: /grease/, steps: [{ mode: "burst", file: "jb2a.grease.dark_brown.loop", size: 2 }] },
  { id: "sleep", match: /^sleep$|deep slumber/, steps: [{ mode: "burst", file: "jb2a.sleep.cloud.01.blue", size: 6 }] },
  { id: "shatter", match: /^shatter/, steps: [{ mode: "burst", file: "jb2a.shatter.blue", size: 2 }] },
  { id: "black-tentacles", match: /black tentacles/, steps: [{ mode: "burst", file: "jb2a.black_tentacles.dark_purple", size: 6 }] },
  { id: "flaming-sphere", match: /flaming sphere/, steps: [{ mode: "burst", file: "jb2a.flaming_sphere.200px.orange.01", size: 1 }] },
  { id: "flame-strike", match: /flame strike/, steps: [{ mode: "burst", file: "jb2a.sacred_flame.target.yellow", size: 2 }] },
  { id: "wall-of-fire", match: /wall of fire/, steps: [{ mode: "burst", file: "jb2a.wall_of_fire.300x100.yellow", size: 6 }] },
  { id: "wall-of-force", match: /wall of force|forcecage/, steps: [{ mode: "burst", file: "jb2a.wall_of_force.horizontal.blue", size: 4 }] },
  { id: "plant-growth", match: /plant growth/, steps: [{ mode: "burst", file: "jb2a.plant_growth.02.round.4x4.complete.greenred", size: 8 }] },
  { id: "cure", match: /^cure (light|moderate|serious|critical) wounds|^heal$|^mass cure|^regenerate/,
    steps: [{ mode: "target", file: "jb2a.cure_wounds.400px.blue", scale: 1.5 }] },
  { id: "cure-other", match: /^cure (disease|blindness|deafness)|neutralize poison|slow poison|remove curse|remove fear/,
    steps: [{ mode: "target", file: "jb2a.healing_generic.200px.green", scale: 1.5 }] },
  { id: "raise", match: /raise dead|resurrection|restoration/, steps: [{ mode: "target", file: "jb2a.healing_generic.400px.yellow", scale: 2 }] },
  { id: "bless", match: /^bless$|^prayer$|^chant$|^aid$/, steps: [{ mode: "target", file: "jb2a.bless.400px.intro.yellow", scale: 1.5 }] },
  { id: "shield", match: /^shield$|^armor$/, steps: [{ mode: "caster", file: "jb2a.shield.01.intro.blue", scale: 1.5 }] },
  { id: "protection", match: /protection from (evil|good)/, steps: [{ mode: "target", file: "jb2a.ward.star.yellow.01", scale: 1.5 }] },
  { id: "hold", match: /^hold (person|monster|animal|plant|undead)/, steps: [{ mode: "target", file: "jb2a.icon.stun.purple", scale: 1 }] },
  { id: "charm", match: /^charm |suggestion|friends$|^command$|^enthrall/, steps: [{ mode: "target", file: "jb2a.icon.heart.pink", scale: 1 }] },
  { id: "fear", match: /^fear$|^scare$|cause fear|^emotion( control)?$/, steps: [{ mode: "target", file: "jb2a.icon.fear.dark_purple", scale: 1 }] },
  { id: "spiritual-hammer", match: /spiritual hammer|spiritual weapon/, steps: [{ mode: "target", file: "jb2a.spiritual_weapon.hammer.01.spectral.02.orange", scale: 1.5 }] },
  { id: "bigby", match: /bigby|interposing hand|forceful hand|grasping hand|clenched fist|crushing hand/, steps: [{ mode: "target", file: "jb2a.arcane_hand.blue", scale: 1.5 }] },
  { id: "detect-magic", match: /^detect /, steps: [{ mode: "caster", file: "jb2a.detect_magic.circle.blue", scale: 4 }] },
  { id: "dimension-door", match: /dimension door|blink/, steps: [{ mode: "caster", file: "jb2a.misty_step.01.blue", scale: 1.5 }] },
  { id: "teleport", match: /^(mass |reverse )?teleport(?!er| block)|word of recall/, steps: [{ mode: "caster", file: "jb2a.teleport.01.blue", scale: 1.5 }] },
  { id: "invisibility", match: /invisibility(?! purge)/, steps: [{ mode: "target", file: "jb2a.smoke.puff.centered.grey", scale: 1.5 }] }
];

/** Fallbacks (implementation choice): healing spells glow green on the targets, any other spell glows on the caster. */
export const HEALING_FALLBACK = { id: "healing", steps: [{ mode: "target", file: "jb2a.healing_generic.200px.green", scale: 1.5 }] };
export const GENERIC_FALLBACK = { id: "generic", steps: [{ mode: "caster", file: "jb2a.cast_generic.01.blue", scale: 1.5 }] };

/** Lower-case name without book tags such as "(Wizard Spell)" (pure). */
export function normalizeName(name) {
  return String(name ?? "").toLowerCase().replace(/\([^)]*\)/g, " ").replace(/['’]/g, "").replace(/\s+/g, " ").trim();
}

/**
 * The animation for a spell (pure): the spell sheet's override (`system.animation` { file, mode }; file "none" = no
 * animation), else the first curated match, else the healing or generic fallback.
 */
export function animationFor(spell) {
  const own = spell?.system?.animation ?? {};
  const file = String(own.file ?? "").trim();
  if (file.toLowerCase() === "none") return null;
  if (file) return { id: "custom", steps: [{ mode: MODES.includes(own.mode) ? own.mode : "target", file, size: 4, scale: 1.5 }] };
  const name = normalizeName(spell?.name);
  const hit = ANIMATIONS.find(a => a.match.test(name));
  if (hit) return hit;
  const healing = (spell?.system?.damage ?? []).some(d => d.kind === "healing" && d.formula);
  return healing ? HEALING_FALLBACK : GENERIC_FALLBACK;
}

/**
 * The effects to play (pure): [{ file, at, to, size, scale }] where at/to are the caster or a target. A step needing a
 * target (missile, cone) is played on the caster with the generic glow when there is none.
 */
export function animationSteps(entry, { caster, targets = [] }) {
  const out = [];
  if (!entry || !caster) return out;
  for (const s of entry.steps) {
    const base = { file: s.file, size: s.size ?? null, scale: s.scale ?? null };
    if (s.mode === "missile") {
      if (!targets.length) { out.push({ ...GENERIC_FALLBACK.steps[0], at: caster, size: null }); continue; }
      for (const t of targets) out.push({ ...base, at: caster, to: t });
    } else if (s.mode === "cone") {
      if (!targets.length) { out.push({ ...GENERIC_FALLBACK.steps[0], at: caster, size: null }); continue; }
      out.push({ ...base, at: caster, to: targets[0] });
    } else if (s.mode === "burst") out.push({ ...base, at: targets[0] ?? caster });
    else if (s.mode === "target") for (const t of (targets.length ? targets : [caster])) out.push({ ...base, at: t });
    else out.push({ ...base, at: caster });
  }
  return out;
}

/* -------------------------------------------- */
/*  Foundry side                                */
/* -------------------------------------------- */

const JB2A_MODULES = ["jb2a_patreon", "JB2A_DnD5e"];

export function animationsOn() {
  try { return game.settings.get("ad2e", "jb2aAnimations") !== false; } catch { return false; }
}

/** Sequencer and a JB2A module active, with Sequencer's globals present. */
export function jb2aAvailable() {
  try {
    const active = id => !!game.modules?.get(id)?.active;
    return active("sequencer") && JB2A_MODULES.some(active) && typeof globalThis.Sequence === "function"
      && typeof globalThis.Sequencer?.Database?.entryExists === "function";
  } catch { return false; }
}

/** The caster's token on the viewed scene: a controlled one first. */
export function casterToken(actor) {
  const controlled = globalThis.canvas?.tokens?.controlled?.find(t => t.actor === actor);
  return controlled ?? actor?.getActiveTokens?.()?.[0] ?? null;
}

/**
 * Play the spell's animation (AD2EActor#castSpell). Never throws: anything missing (setting off, modules, canvas,
 * tokens, a database entry) means no animation.
 */
export async function playSpellAnimation(actor, spell, targetTokens = null) {
  try {
    if (!animationsOn() || !jb2aAvailable()) return false;
    const caster = casterToken(actor);
    if (!caster) return false;
    const targets = [...(targetTokens ?? globalThis.game?.user?.targets ?? [])].filter(t => t && t !== caster);
    let steps = animationSteps(animationFor(spell), { caster, targets });
    const exists = f => { try { return !!globalThis.Sequencer.Database.entryExists(f); } catch { return false; } };
    // The free JB2A module lacks some files: those steps fall back to the generic glow, else nothing.
    steps = steps.map(s => exists(s.file) ? s : (exists(GENERIC_FALLBACK.steps[0].file) ? { ...GENERIC_FALLBACK.steps[0], at: caster, size: null } : null))
      .filter(Boolean);
    if (!steps.length) return false;
    const seq = new globalThis.Sequence({ moduleName: "ad2e", softFail: true });
    steps.forEach((s, i) => {
      const fx = seq.effect().file(s.file).atLocation(s.at);
      if (s.to) fx.stretchTo(s.to);
      else if (s.size) fx.size(s.size, { gridUnits: true });
      else fx.scaleToObject(s.scale ?? 1);
      // Each step after the previous one (a fireball's explosion after its beam).
      if (i < steps.length - 1 && steps[i + 1].file !== s.file) fx.waitUntilFinished(-500);
    });
    await seq.play();
    return true;
  } catch (err) {
    console.debug("ad2e | spell animation skipped", err);
    return false;
  }
}

export function registerSpellAnimations() {
  game.settings.register("ad2e", "jb2aAnimations", {
    name: "AD2E.Animation.Setting", hint: "AD2E.Animation.SettingHint",
    scope: "world", config: true, type: Boolean, default: true
  });
}
