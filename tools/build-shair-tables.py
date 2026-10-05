#!/usr/bin/env python3
"""Generate module/rules/shair-tables.mjs: how a sha'ir's gen fetches spells (Al-Qadim: Arabian Adventures).

Sources (AD&D 2e fandom wiki, MediaWiki API): Requesting a Spell (AA) (search time, chance of success, priest spells),
Summoning a Familiar (AA) ("common knowledge" spells), Sha'ir (Character Kit) (races whose sha'ir abilities fail).
Every rule has a regex that must still match its page; the three worked examples of Requesting a Spell (AA) are
recomputed from the rules and asserted. The wiki's "Chance of Requesting" tables on the same page are not used: from 5th
level they disagree with the text (Example One: 75%, the table: 89%).
Run from the repo root:  python3 tools/build-shair-tables.py
"""
import importlib.util
import json
import re

_spec = importlib.util.spec_from_file_location("classdata", "tools/build-class-data.py")
classdata = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(classdata)

REQUEST = "Requesting a Spell (AA)"
FAMILIAR = "Summoning a Familiar (AA)"
KIT = "Sha'ir (Character Kit)"

RULES = {
    "searchNative": (REQUEST, r"a native wizard of the same experience level could normally cast, then the gen searches for 1d6 rounds plus 1 round "
                              r"per level of the spell", {"unit": "round", "die": "1d6", "perLevel": 1}),
    "searchHigh": (REQUEST, r"If a native wizard of the same experience level could not normally cast the desired spell, then the gen searches for "
                            r"1d6 turns \+ 1 turn per level of the spell", {"unit": "turn", "die": "1d6", "perLevel": 1}),
    "searchForeign": (REQUEST, r"If the spell is not native to the Land of Fate.or is a priest spell.the gen searches for 1d6 hours plus 1 hour per "
                               r"level of the spell", {"unit": "hour", "die": "1d6", "perLevel": 1}),
    "base": (REQUEST, r"A roll of 90 or more always indicates failure\. Otherwise, all gens have a 50 percent base chance of finding a spell",
             {"chance": 50, "failAt": 90}),
    "perShairLevel": (REQUEST, r"Each level of sha'ir: \+5 percent", 5),
    "perSpellLevel": (REQUEST, r"Each level of spell being sought: -10 percent", -10),
    "generalKnowledge": (REQUEST, r"Spell is \"general knowledge\" \(by the definition above\): \+10 percent", 10),
    "foreignOrPriest": (REQUEST, r"Spell is priestly magic, or does not appear in Appendix A: -30 percent", -30),
    "repeat": (REQUEST, r"Gen repeats search for spell on same day after initial failure: -10 percent per attempt", -10),
    "repeatWindow": (REQUEST, r"drops an additional 10 percent for each attempt within a given 24-hour period", 24 * 3600),
    "delay00": (REQUEST, r"If the DM rolls \"00\" when checking for success, the gen is automatically delayed [l1]d[l1]O additional rounds, turns, or "
                         r"hours", "1d10"),
    "castWithin": (REQUEST, r"The sha'ir can cast the spell within three turns; thereafter the magic is lost", 3),
    "oneAtATime": (REQUEST, r"The gen cannot set out to retrieve another spell for its master until the previous magic has been cast or has expired",
                   True),
    "priestNotice": (REQUEST, r"There is a 10 percent chance per level of the desired spell that a god or higher being observes the gen's activity",
                     10),
    "replacementDelay": (REQUEST, r"time to recover spells increases by one increment \(round, turn, or hour, depending on the spell\) with each "
                                  r"replacement", 1),
    "commonLevels": (FAMILIAR, r"All 1st- and 2nd-level wizard spells shown in Appendix A are considered common knowledge", 2),
    # The gen (Requesting a Spell (AA), section Gens; Summoning a Familiar (AA)).
    "genStats": (REQUEST, r"all gens stand between 8 and 12 inches tall, are of Low intelligence, AC 5, and have a movement rate of 9\. Each has a "
                          r"number of hit points equaling half its master's current maximum, Hit Dice equaling half its master's level, and the "
                          r"THAC0 of a monster that's half their master's level in Hit Dice\. Gens inflict 1d6 points of damage, and are of small size",
                 {"ac": 5, "move": 9, "intelligence": "Low", "size": "S", "damage": "1d6"}),
    "genKinds": (REQUEST, r"Air gens.*?can fly at MV 12 \(maneuverability class B\).*?Fire gens.*?can produce flame at will.*?Water gens.*?"
                          r"can swim at MV 12, and can breathe underwater.*?Earth gens.*?can inflict double damage \(2d6 points\)",
                 {"air": {"move": "Fl 12 (B)", "province": "wind"}, "fire": {"move": "", "province": "flame"},
                  "water": {"move": "Sw 12", "province": "sea"}, "earth": {"move": "", "province": "sand", "damage": "2d6"}}),
    "genWard": (REQUEST, r"All attacks of the proper element are at -2 to hit, all saving throws against that element are at \+2, and all damage "
                         r"from that form of attack are at -2 per die \(minimum damage of 1 point per die\)\. This magical protection applies to "
                         r"the gen at all times\. The sha'ir enjoys these benefits when the gen is within 10 feet",
                {"hit": -2, "save": 2, "perDie": -2, "minPerDie": 1, "feet": 10}),
    "genSaves": (REQUEST, r"An elemental familiar makes saving throws at twice the current level of its master", 2),
    "genDeath": (REQUEST, r"The sha'ir's hit points drop by half\. If this loss reduces a sha'ir to 0 or fewer hit points, the wizard must make a "
                          r"saving throw vs\. death magic\. Success means that the sha'ir remains alive, with 1 hit point, while failure indicates death",
                 {"factor": 0.5, "save": "par", "survive": 1}),
    "genLoyalty": (REQUEST, r"The first gen summoned is of fanatical morale and loyalty \(18\).*?For each successive gen, the loyalty drops 1 point, "
                            r"to a minimum of 5", {"first": 18, "perReplacement": -1, "min": 5}),
    "genAlignment": (REQUEST, r"Gens attached to characters of similar alignment or tendencies gain a \+1 bonus to rolls for loyalty \(but not morale\)", 1),
    "genTendencies": (REQUEST, r"Djinnlings are usually aloof and moralistic\. They tend toward good and lawful behavior.*?Fire gens are usually malicious "
                               r"and judgmental\. They tend toward evil and lawful behavior.*?Maridans are usually capricious and playful\. They tend "
                               r"toward good and chaotic behavior.*?Earth gen are usually tactless and direct\. They tend toward evil and chaos",
                      {"air": "lg", "fire": "le", "water": "cg", "earth": "ce"}),
    # Gen details (Requesting a Spell (AA), section Gens).
    "genRaised": (REQUEST, r"A gen that has died and is later brought back to life suffers a permanent 1-point penalty in morale and loyalty", -1),
    "genRelink": (REQUEST, r"A successful dispel magic or similar spell also can break the link\. The latter does not harm the sha'ir, who can reforge "
                           r"the link with that particular gen by summoning it again", True),
    "genMasterDeath": (REQUEST, r"The death of the caster also frees the gen of its obligations, and the elemental familiar immediately returns to its "
                                r"native elemental plane\. If the sha'ir is raised, he or she can regain the same gen by the act of summoning and binding "
                                r"the familiar", True),
    "genAway": (REQUEST, r"all must stay within 100 yards of their masters while on the Prime Material Plane\. If a gen is forced to move beyond that "
                         r"radius.*?attempting to return to its master in 1d6 turns\. If the master moves to another plane, the gen follows in 1d6 days "
                         r"\(1d6 rounds for elemental planes\)\. Gens can spy, perform errands, and carry messages for their masters in other planes"
                         r".*?If threatened while on the Prime Material Plane and more than 10 feet from its master, the elemental familiar will pop "
                         r"back into its home plane to hide, returning to its master \(if possible\) in 1d6 turns",
                {"forced": ["1d6", "turn"], "threatened": ["1d6", "turn"], "plane": ["1d6", "day"], "elemental": ["1d6", "round"], "errand": None,
                 "yards": 100}),
    "genSense": (REQUEST, r"the sha'ir knows the gen has been delayed, and can sense that it's still alive", True),
    "genCharm": (REQUEST, r"A gen can be ensnared by charm or similar spells, but it won't turn against its master unless a morale check is failed", True),
    "genSummon": (FAMILIAR, r"The act of summoning and binding a gen lasts [l1]d20 hours", "1d20"),
    "raceFailure": (KIT, r"for races such as dwarves.who have an inherent nonmagical nature.sha'ir abilities fail 20 percent of the time",
                    {"dwarf": 20}),
}
# Seconds per unit: "A round is approximately one minute long. Ten combat rounds equal a turn" (The Combat Round (PHB)).
UNIT_SECONDS = {"round": 60, "turn": 600, "hour": 3600, "day": 86400}


def chance(r, shair_level, spell_level, general=False, foreign=False, repeats=0):
    c = r["base"]["chance"] + r["perShairLevel"] * shair_level + r["perSpellLevel"] * spell_level
    c += r["generalKnowledge"] if general else 0
    c += r["foreignOrPriest"] if foreign else 0
    c += r["repeat"] * repeats
    return c


if __name__ == "__main__":
    pages = {}
    for t in (REQUEST, FAMILIAR, KIT):
        w, rev, _ = classdata.page(t)
        pages[t] = (re.sub(r"\[\[(?:[^|\]]*\|)?([^\]]*)\]\]", r"\1", w).replace("'''", "").replace("''", ""), rev)
    rules = {}
    for key, (title, pattern, value) in RULES.items():
        assert re.search(pattern, pages[title][0], flags=re.S), f"{key}: pattern no longer matches {title}"
        rules[key] = value
    req = pages[REQUEST][0]
    # Worked examples (Requesting a Spell (AA)).
    assert re.search(r"In summary, the gen has a 75 percent chance of success \(50 \+ 25 - 10 \+ 10 = 75\)", req)
    assert chance(rules, 5, 1, general=True) == 75
    assert re.search(r"leaving only a 5 percent chance of success", req)
    assert chance(rules, 3, 6) == 5
    assert re.search(r"the gen has a 15 percent chance of success and will search for 1d6 \+ 5 hours\. If the gen fails to recover the spell and "
                     r"Hazam immediately sends it out to try again, the gen's chance of success drops to 5 percent", req)
    assert chance(rules, 9, 5, foreign=True) == 15 and chance(rules, 9, 5, foreign=True, repeats=1) == 5
    out = {"sources": {t: {"url": classdata.url(t), "revision": pages[t][1]} for t in pages}, "unitSeconds": UNIT_SECONDS, **rules}
    with open("module/rules/shair-tables.mjs", "w") as f:
        f.write("\n".join([
            "/**",
            " * GENERATED by tools/build-shair-tables.py - do not edit by hand.",
            *[f" * {t}: {classdata.url(t)} (revision {pages[t][1]})." for t in pages],
            " * A sha'ir's gen fetching spells: search time, chance of success, priest spells. unitSeconds: The Combat Round (PHB).",
            " */",
            "export const SHAIR = " + json.dumps(out, ensure_ascii=False) + ";", ""]))
    print("wrote module/rules/shair-tables.mjs", ", ".join(f"{t} rev {pages[t][1]}" for t in pages))
