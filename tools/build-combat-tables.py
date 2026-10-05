#!/usr/bin/env python3
"""Generate module/rules/combat-tables.mjs: two-weapon fighting and unarmed (non-lethal) combat.

Sources (AD&D 2e fandom wiki, MediaWiki API):
  * "Attacking with Two Weapons (PHB)": -2 main weapon, -4 second weapon, modified by the Dexterity Reaction Adjustment
    but never above 0; warriors and rogues only; rangers exempt (in studded leather or lighter: "Ranger (PHB)").
    The second weapon must be smaller in size and weight than the main one; a dagger is always allowed.
  * "Attacking Without Killing (PHB)": Table 57 (armour modifiers for wrestling, applied to the attack roll of the
    character wrestling in armour), Table 58 (punching and wrestling results by modified attack roll), overbearing
    (4 per size category of difference, -2 per defender leg beyond two, +1 per attacker beyond the first), non-lethal
    weapon attacks (-4 to hit, 50% damage). "Attacking Without Killing (DMG)" Tables 42/43 are asserted identical.
  * "Initiative (PHB)": Table 55 (standard modifiers), Table 56 (optional modifiers: weapon speed, casting time, breath
    weapon, monster size with natural weapons, innate spell ability, magical items), magical weapons' speed factor
    reduction (the lesser bonus, never below 0), and casting times with units (a round or more: end of the round).
Armour identifiers per Table 57 row are curated in WRESTLING_ARMOR (row labels asserted against the page).
Run from the repo root:  python3 tools/build-combat-tables.py
"""
import importlib.util
import json
import re

_spec = importlib.util.spec_from_file_location("classdata", "tools/build-class-data.py")
classdata = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(classdata)

# Table 57 row label -> armour item identifiers (packs/_source/armor). Unlisted armour has no modifier.
WRESTLING_ARMOR = {
    "Studded leather": ["studded-leather"],
    "Chain, ring, and scale mail": ["chain-mail", "ring-mail", "scale-mail"],
    "Banded, splint, and plate mail": ["banded-mail", "splint-mail", "plate-mail"],
    "Field plate armor": ["field-plate"],
    "Full plate armor": ["full-plate"],
}
SIZES = ["T", "S", "M", "L", "H", "G"]


def table(wiki, caption):
    i = wiki.index(caption)
    return wiki[i:wiki.index("|}", i)]


def rows(t):
    out = []
    for chunk in re.split(r"\n\|-", t)[1:]:
        cells = [c.strip() for line in chunk.strip().split("\n") if line.startswith("|") and not line.startswith(("|+", "|}"))
                 for c in line[1:].split("||")]
        if cells:
            out.append(cells)
    return out


# Table 51 rows ticked by a target token's status (core 14.368 CONFIG.statusEffects ids, from the owner's diagnostic):
# held = paralysed or restrained; an unconscious defender is helpless like a sleeping one.
STATUS_51 = {"defender-sleeping-or-held": ["sleep", "paralysis", "restrain", "unconscious"],
             "defender-stunned-or-prone": ["stun", "prone"],
             "defender-invisible": ["invisible"]}


def need(text, pattern, what):
    assert re.search(pattern, text), f"rule changed: {what}"


if __name__ == "__main__":
    tw, rev_tw, _ = classdata.page("Attacking with Two Weapons (PHB)")
    need(tw, r"available only to warriors and rogues", "two weapons: warriors and rogues")
    need(tw, r"rangers are exempt from the attack roll penalty", "two weapons: rangers exempt")
    need(tw, r"main weapon suffer a -2 penalty, and attacks made with the second weapon suffer a -4 penalty", "two weapons: -2/-4")
    need(tw, r"Reaction Adjustment can, at best, raise the attack roll penalties to 0", "two weapons: Dexterity up to 0")
    need(tw, r"smaller in size and weight than the character's main weapon", "two weapons: smaller second weapon")
    need(tw, r"dagger can always be used as a second weapon", "two weapons: dagger")
    need(tw, r"one additional attack each combat round", "two weapons: one extra attack")
    rw, rev_ranger, _ = classdata.page("Ranger (PHB)")
    cw, rev_corsair, _ = classdata.page("Corsair - Al-Qadim (Character Kit)")
    need(cw, r"All other restrictions for two-weapon attacks apply .{0,120}but the corsair suffers no penalty to attack rolls", "corsair two weapons")
    need(cw, r"corsairs cannot employ their special benefits when wearing armor heavier than AC 7", "corsair armour limit")
    need(rw, r"When wearing studded leather or lighter armor, a ranger can fight two-handed with no penalty", "ranger exemption")

    pw, rev_awk, _ = classdata.page("Attacking Without Killing (PHB)")
    dw, rev_awk_dmg, _ = classdata.page("Attacking Without Killing (DMG)")
    t57 = rows(table(pw, "Table 57: Armor Modifiers for Wrestling"))  # header cells start with "!"
    assert [r[0] for r in t57] == list(WRESTLING_ARMOR), t57
    wrestling = [{"label": r[0], "value": int(r[1].replace("−", "-")), "armor": WRESTLING_ARMOR[r[0]]} for r in t57]
    t42 = [r for r in rows(table(dw, "Table 42: Armor Modifiers for Wrestling"))]
    assert [(r[0], int(r[1])) for r in t42] == [(w["label"], w["value"]) for w in wrestling], t42
    need(pw, r"these are penalties to the attacker's attack roll", "Table 57 applies to the attacker")

    t58 = rows(table(pw, "Table 58: Punching and Wrestling Results"))
    t43 = rows(table(dw, "Table 43: Punching and Wrestling Results"))
    norm = lambda rs: [[c.replace(" ", "").lower() for c in r] for r in rs]
    assert norm(t58) == norm(t43), "PHB Table 58 and DMG Table 43 differ"
    results = []
    for r in t58:
        roll, punch, dmg, ko, wrestle = r
        hold = wrestle.endswith("*")
        if roll.endswith("+"):
            lo, hi = int(roll[:-1]), None
        elif roll.lower().startswith("less than"):
            lo, hi = None, int(roll.split()[-1]) - 1
        else:
            lo = hi = int(roll)
        results.append({"min": lo, "max": hi, "punch": punch, "damage": int(dmg), "ko": int(ko),
                        "wrestle": wrestle.rstrip("*").strip(), "hold": hold})
    assert results[0]["min"] == 20 and results[-1]["max"] == 0 and len(results) == 21, results
    assert all(results[i]["min"] == 20 - i for i in range(1, 20)), results
    need(pw, r"Metal gauntlets, brass knuckles, and the like cause 1d3 points of damage", "gauntlet 1d3")
    need(pw, r"Strength bonus, if any, does apply to punching attacks", "punch Strength bonus")
    need(pw, r"Only 25% of the damage caused by a bare-handed attack is normal damage", "punch 25% lasting")
    need(pw, r"stunned for 1d10 rounds", "KO 1d10 rounds")
    need(pw, r"All wrestling moves inflict 1 point of damage plus Strength bonus \(if the attacker desires\)", "wrestle damage")
    need(pw, r"continued holds cause cumulatively 1 more point of damage for each round", "hold damage")
    need(pw, r"the attack roll is modified by 4 \(\+4 if the attacker is larger; -4 if the defender is larger\)", "overbear size")
    need(pw, r"a -2 penalty to the attacker's roll for every leg beyond two", "overbear legs")
    need(pw, r"\+1 bonus for each attacker beyond the first", "overbear attackers")
    need(pw, r"the defender gains a \+4 bonus to his attack and damage rolls", "armed defender +4")
    need(pw, r"the character has a -4 penalty to his attack roll", "non-lethal weapon -4")
    need(pw, r"The damage from such an attack is 50% normal; one-half of this damage is temporary", "non-lethal 50%")

    iw, rev_init, _ = classdata.page("Initiative (PHB)")
    label55 = lambda c: re.sub(r"\[\[(?:[^\]|]*\|)?([^\]]*)\]\]", r"\1", c).replace("*", "").strip()
    t55 = [{"key": re.sub(r"[^a-z]+", "-", label55(r[0]).lower()).strip("-"), "label": label55(r[0]), "value": int(r[1])}
           for r in rows(table(iw, "<h3>Table 55: Standard Modifiers to Initiative"))]
    assert [x["value"] for x in t55] == [-2, 2, -1, -2, 2, 4, 6, 3, 1], t55
    cell = lambda c: re.sub(r'^style="[^"]*"\s*\|\s*', "", c).strip()  # indented sub-rows carry a style attribute
    t56 = {cell(r[0]): cell(r[1]) if len(r) > 1 else "" for r in rows(table(iw, "<h3>Table 56: Optional Modifiers to Initiative"))}
    size56 = {k[0]: int(t56[k]) for k in ("Tiny", "Small", "Medium", "Large", "Huge", "Gargantuan")}
    items56 = {"misc": int(t56["Miscellaneous Magic"]), "potion": int(t56["Potion"]), "ring": int(t56["Ring"]),
               "rod": int(t56["Rods"]), "staff": int(t56["Stave"]), "wand": int(t56["Wand"])}
    assert t56["Attacking with weapon"] == "Weapon speed" and t56["Casting a spell"] == "Casting time", t56
    assert t56["Scroll"] == "Casting time of spell", t56
    need(iw, r"each bonus point conferred by a magical weapon reduces the speed factor of that weapon by 1", "magic speed")
    need(iw, r"When a weapon has two bonuses, the lesser one is used\. No weapon can have a speed factor of less than 0", "speed min 0")
    need(iw, r"a spell requiring one round to cast takes effect at the end of the current round", "round casting")
    need(iw, r"creatures with natural weapons are not affected by weapon speed", "natural weapons")
    # Table 51 Combat Modifiers ("PHB Table 51" = The Attack Roll (PHB)): situations other than missile range (already
    # in the attack dialog). Token status ids (core 14.368 CONFIG.statusEffects, owner's diagnostic) that tick a row.
    a51, rev_51, _ = classdata.page("PHB Table 51")
    need(a51, r"Positive numbers are bonuses for the attacker; negative numbers are penalties", "Table 51 sign")
    need(a51, r"the attack automatically hits and causes normal damage", "Table 51 automatic hit")
    t51 = []
    for r in rows(table(a51, "<h4>Table 51 Combat Modifiers")):
        label, value = r[0], r[1]
        if label.startswith("Missile fire"):
            continue
        key = re.sub(r"[^a-z0-9]+", "-", label.lower()).strip("-")
        t51.append({"key": key, "label": label, "value": "auto" if value.startswith("Automatic") else int(value.replace("+", "")),
                    "statuses": STATUS_51.get(key, [])})
    assert [x["key"] for x in t51] == ["attacker-on-higher-ground", "defender-invisible", "defender-off-balance",
        "defender-sleeping-or-held", "defender-stunned-or-prone", "defender-surprised", "rear-attack"], t51
    assert {x["key"]: x["value"] for x in t51}["defender-stunned-or-prone"] == 4 and t51[1]["value"] == -4, t51
    assert all(k in {x["key"] for x in t51} for k in STATUS_51), STATUS_51
    # DMG Table 53 Mounted Missile Fire (mount's movement this round -> attack modifier) and the rate of fire rule.
    uw, rev_unusual, _ = classdata.page("Unusual Combat Situations (DMG)")
    mounted_keys = {"Not moving": "still", "Less than 1/2 normal rate": "half", "1/2 to 3/4 normal rate": "threeQuarters",
                    "Greater than 3/4 normal rate": "full"}
    mounted = [{"key": mounted_keys[r[0].strip()], "label": r[0].strip(), "value": int(r[1].replace("–", "-").strip())}
               for r in classdata.table_rows(uw, "Table 53")]
    assert [m["value"] for m in mounted] == [0, -1, -3, -5], mounted
    need(uw, r"When firing while on the move, the rider has his rate of fire reduced by one", "mounted rate of fire")
    need(uw, r"Missile fire'*\s*from the back of a moving horse is possible only if the rider is proficient in horsemanship", "mounted proficiency")
    initiative = {"standard": t55, "breath": int(t56["Breath weapon"]), "innate": int(t56["Innate spell ability"]),
                  "size": size56, "items": items56}
    data = {
        "initiative": initiative,
        "twoWeapon": {"main": -2, "off": -4, "groups": ["warrior", "rogue"], "rangerMaxArmorAc": 7, "smallAlways": "dagger-or-dirk",
                      "exemptKits": ["corsair-al-qadim"]},
        "wrestlingArmor": wrestling,
        "punchWrestle": results,
        "punch": {"gauntlet": "1d3", "lasting": 0.25, "stun": "1d10"},
        "wrestle": {"damage": 1},
        "overbear": {"sizes": SIZES, "perSize": 4, "perLeg": -2, "perAttacker": 1},
        "armedDefender": 4,
        "combatModifiers": t51,
        "nonlethal": {"hit": -4, "damage": 0.5},
        "mountedMissile": mounted,
    }
    lines = ["/**",
             " * GENERATED by tools/build-combat-tables.py - do not edit by hand.",
             f" *   Two weapons: {classdata.url('Attacking with Two Weapons (PHB)')} (revision {rev_tw}); ranger exemption:",
             f" *   {classdata.url('Ranger (PHB)')} (revision {rev_ranger}); corsair (same armour limit):",
             f" *   {classdata.url('Corsair - Al-Qadim (Character Kit)')} (revision {rev_corsair})",
             f" *   Tables 57/58, overbearing, non-lethal weapon attacks: {classdata.url('Attacking Without Killing (PHB)')} (revision {rev_awk});",
             f" *   DMG Tables 42/43 identical: {classdata.url('Attacking Without Killing (DMG)')} (revision {rev_awk_dmg})",
             f" *   Initiative Tables 55/56: {classdata.url('Initiative (PHB)')} (revision {rev_init})",
             f" *   Table 51 Combat Modifiers: {classdata.url('PHB Table 51')} (revision {rev_51}); status ids: core CONFIG.statusEffects",
             f" *   DMG Table 53 Mounted Missile Fire: {classdata.url('Unusual Combat Situations (DMG)')} (revision {rev_unusual})",
             " */",
             "export const COMBAT_TABLES = " + json.dumps(data) + ";", ""]
    open("module/rules/combat-tables.mjs", "w").write("\n".join(lines))
    print(f"wrote module/rules/combat-tables.mjs: {len(wrestling)} wrestling armour rows, {len(results)} Table 58 rows")
