import { casterToken, jb2aAvailable, sequencerHas } from "./spell-animations.mjs";

/**
 * Weapon attack animations with JB2A through Sequencer (owner's request, 1.0.52): after an attack roll (character weapon
 * attacks, the sheet's plain melee/missile attack, unarmed attacks, monster attacks), when the world setting
 * "jb2aWeaponAnimations" is on and Sequencer plus a JB2A module are active (spell-animations.mjs `jb2aAvailable`), the
 * attacker's token strikes or shoots at each targeted token; a miss uses Sequencer's `missed()` ("Causes the effect to
 * target a location close to the .stretchTowards() location, but not on it", src/sections/effect.js). Nothing happens
 * without the modules, a token or a target, and nothing is reported.
 *
 * Paths were checked against the jb2a_patreon 0.9.4 database (scripts/jb2a_sequencer.js): weapon entries carry the
 * "melee" or "ranged" template (played from the attacker stretched to the target); bite and claws have none (played on
 * the target, hits only). Which animation fits which weapon is an implementation choice (curated list below, matched on
 * the weapon's identifier and name; otherwise by damage type S/P/B, or an arrow for missiles).
 * A weapon item's own choice (`system.animation.file`, weapon sheet; owner's request 1.0.56) replaces it: "none" = no
 * animation, else a database path or a file path (spell-animations.mjs `isFilePath`), played from the attacker to the target.
 */

/** Curated weapons: `match` on "<identifier> <name>" (lower case); `melee` / `missile` = database path. */
export const WEAPONS = [
  { id: "sling", match: /sling|pellet-bow/, missile: "jb2a.slingshot" },
  { id: "crossbow", match: /crossbow|cho-ku-no/, missile: "jb2a.bolt.physical.white" },
  { id: "bow", match: /\bbow\b|long-bow|short-bow/, missile: "jb2a.arrow.physical.white.02" },
  { id: "firearm", match: /arquebus|pistol|musket|caliver|hand-gunne/, missile: "jb2a.bullet.01.orange" },
  { id: "dart", match: /\bdart\b|blowgun|shuriken/, missile: "jb2a.dart.01.throw.physical.white" },
  { id: "javelin", match: /javelin|pilum/, melee: "jb2a.spear.melee.01.white", missile: "jb2a.javelin.01.throw" },
  { id: "dagger", match: /dagger|dirk|knife|stiletto|main-gauche|jambiya|katar|razor/, melee: "jb2a.dagger.melee.02.white",
    missile: "jb2a.dagger.throw.01.white" },
  { id: "handaxe", match: /hand-or-throwing-axe|hatchet|adze/, melee: "jb2a.handaxe.melee.standard.white", missile: "jb2a.handaxe.throw.01" },
  { id: "greataxe", match: /two-handed-axe/, melee: "jb2a.greataxe.melee.standard.white" },
  { id: "battleaxe", match: /battle-axe|mace-axe|sword-axe/, melee: "jb2a.melee_attack.02.battleaxe" },
  { id: "greatsword", match: /two-hand-sword|claymore|bastard-sword|great-scimitar/, melee: "jb2a.greatsword.melee.standard.white" },
  { id: "nodachi", match: /no-dachi/, melee: "jb2a.melee_attack.05.nodachi" },
  { id: "katana", match: /katana/, melee: "jb2a.melee_attack.04.katana" },
  { id: "shortsword", match: /short-sword|gladius|wakizashi|ninja-to|drusus/, melee: "jb2a.shortsword.melee.01.white" },
  { id: "scimitar", match: /scimitar|tulwar|cutlass|khopesh|sapara|sabre/, melee: "jb2a.scimitar.melee.01.white" },
  { id: "falchion", match: /falchion/, melee: "jb2a.falchion.melee.01.white" },
  { id: "rapier", match: /rapier|estoc/, melee: "jb2a.rapier.melee.01.white" },
  { id: "sword", match: /sword|spatha/, melee: "jb2a.sword.melee.01.white" },
  { id: "flail", match: /flail|nunchaku|three-piece-rod|chain|scourge|kusari-gama/, melee: "jb2a.melee_attack.01.flail" },
  { id: "maul", match: /\bmaul\b|tetsubo/, melee: "jb2a.maul.melee.standard.white" },
  { id: "warhammer", match: /warhammer|lucern-hammer|sledge/, melee: "jb2a.warhammer.melee.01.white", missile: "jb2a.hammer.throw" },
  { id: "mace", match: /mace|morning-star/, melee: "jb2a.mace.melee.01.white" },
  { id: "greatclub", match: /great-club/, melee: "jb2a.greatclub.standard.white" },
  { id: "club", match: /club|jitte|sai\b/, melee: "jb2a.club.melee.01.white", missile: "jb2a.hammer.throw" },
  { id: "staff", match: /quarterstaff|bo-stick/, melee: "jb2a.quarterstaff.melee.01.white" },
  { id: "pick", match: /pick|bec-de-corbin|elephant-goad/, melee: "jb2a.melee_attack.02.pickaxe" },
  { id: "scythe", match: /scythe/, melee: "jb2a.melee_attack.05.scythe" },
  { id: "sickle", match: /sickle|chijikiri/, melee: "jb2a.melee_attack.01.sickle" },
  { id: "glaive", match: /glaive|naginata|nagimaki|fauchard|lajatang/, melee: "jb2a.glaive.melee.01.white" },
  { id: "halberd", match: /halberd|bardiche|voulge|guisarme|\bbill\b|bill-/, melee: "jb2a.halberd.melee.01.white" },
  { id: "spear", match: /spear|lance|harpoon|trident|fork|partisan|ranseur|spetum|pike|brandistock|sang-kauw|kau-sin-ke/,
    melee: "jb2a.spear.melee.01.white", missile: "jb2a.spear.throw.01" },
  { id: "claws", match: /tiger-claws|bagh-nakh/, melee: "jb2a.claws.400px.red", onTarget: true },
  { id: "whip", match: /whip/, melee: "jb2a.melee_generic.slashing.one_handed" }
];

/** Monster natural attacks by name (implementation choice). `onTarget`: played on the target. */
export const NATURAL = [
  { id: "bite", match: /bite|beak|jaws|fang/, melee: "jb2a.bite.400px.red", onTarget: true },
  { id: "claw", match: /claw|talon|rake|scratch/, melee: "jb2a.claws.400px.red", onTarget: true },
  { id: "pincer", match: /pincer|pinch|nip/, melee: "jb2a.melee_generic.creature_attack.pincer.001.red" },
  { id: "fist", match: /fist|punch|slam|smash|pummel|butt|kick|hoof|hooves|tail|tentacle|crush|constrict|squeeze|trample/,
    melee: "jb2a.melee_generic.creature_attack.fist.001.red" },
  { id: "sting", match: /sting|gore|horn|tusk|spike|stab/, melee: "jb2a.melee_generic.piercing.one_handed" },
  { id: "rock", match: /rock|boulder|hurl/, melee: "jb2a.boulder.toss.01", missile: "jb2a.boulder.toss.01" }
];

export const UNARMED = "jb2a.unarmed_strike.physical.01.yellow";
export const BY_TYPE = { S: "jb2a.melee_generic.slashing.one_handed", P: "jb2a.melee_generic.piercing.one_handed",
  B: "jb2a.melee_generic.bludgeoning.one_handed" };
export const MISSILE_FALLBACK = "jb2a.arrow.physical.white.02";
/** Thrown weapons without their own animation, by damage type. */
export const THROWN_BY_TYPE = { S: "jb2a.handaxe.throw.01", P: "jb2a.spear.throw.01", B: "jb2a.hammer.throw" };

/** A weapon item's own animation and sound choices as attack fields: { override, sound } ("" = automatic). */
export function itemEffects(item) {
  const a = item?.system?.animation ?? {};
  return { override: String(a.file ?? "").trim(), sound: String(a.sound ?? "").trim() };
}

/**
 * The animation for an attack (pure): { file, onTarget } or null. `kind`: "weapon" (item fields), "natural" (monster
 * attack name), "unarmed", "plain" (the sheet's melee/missile buttons). `missile`: the attack is fired or thrown;
 * `thrown`: the weapon itself is thrown (not a launcher).
 */
export function weaponAnimation({ kind = "weapon", name = "", identifier = "", type = "", missile = false, thrown = false, override = "" } = {}) {
  const own = String(override ?? "").trim();
  if (own.toLowerCase() === "none") return null;
  if (own) return { id: "custom", file: own, onTarget: false };
  if (kind === "unarmed") return { id: "unarmed", file: UNARMED, onTarget: false };
  const key = `${identifier} ${String(name).toLowerCase().replace(/['’]/g, "").replace(/\s+/g, "-")}`;
  const list = kind === "natural" ? [...NATURAL, ...WEAPONS] : WEAPONS;
  const hit = kind === "plain" ? null : list.find(w => w.match.test(key) && (missile ? w.missile : w.melee));
  if (hit) return { id: hit.id, file: missile ? hit.missile : hit.melee, onTarget: !missile && !!hit.onTarget };
  const letter = String(type ?? "").toUpperCase().match(/[SPB]/)?.[0] ?? "S";
  if (missile) return { id: thrown ? `thrown-${letter}` : "launcher", file: thrown ? THROWN_BY_TYPE[letter] : MISSILE_FALLBACK, onTarget: false };
  return { id: `type-${letter}`, file: BY_TYPE[letter], onTarget: false };
}

export function weaponAnimationsOn() {
  try { return game.settings.get("ad2e", "jb2aWeaponAnimations") !== false; } catch { return false; }
}

/**
 * Play an attack's animation (not awaited by the rolls; never throws). `hit`: true, false, or null (unknown: played as a
 * hit). Each targeted token gets one effect; with no target nothing plays.
 */
export async function playWeaponAnimation(actor, attack, { hit = null, targetTokens = null } = {}) {
  try {
    if (!weaponAnimationsOn() || !jb2aAvailable()) return false;
    const from = casterToken(actor);
    if (!from) return false;
    const targets = [...(targetTokens ?? globalThis.game?.user?.targets ?? [])].filter(t => t && t !== from);
    if (!targets.length) return false;
    const anim = weaponAnimation(attack);
    if (!anim) return false;
    const exists = sequencerHas;
    let file = anim.file;
    let onTarget = anim.onTarget;
    if (!exists(file)) {
      // The free JB2A lacks some files: the generic one for the damage type, else nothing.
      file = attack.missile ? MISSILE_FALLBACK : BY_TYPE.S;
      onTarget = false;
      if (!exists(file)) return false;
    }
    // On-target animations (bite, claws) show hits only.
    if (onTarget && hit === false) return false;
    const seq = new globalThis.Sequence({ moduleName: "ad2e", softFail: true });
    for (const t of targets) {
      const fx = seq.effect().file(file);
      if (onTarget) fx.atLocation(t).scaleToObject(1.5);
      else {
        fx.atLocation(from).stretchTo(t);
        if (hit === false) fx.missed(true);
      }
    }
    await seq.play();
    return true;
  } catch (err) {
    console.debug("ad2e | weapon animation skipped", err);
    return false;
  }
}

export function registerWeaponAnimations() {
  game.settings.register("ad2e", "jb2aWeaponAnimations", {
    name: "AD2E.Animation.WeaponSetting", hint: "AD2E.Animation.WeaponSettingHint",
    scope: "world", config: true, type: Boolean, default: true
  });
}
