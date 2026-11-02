#!/usr/bin/env python3
"""Generate module/rules/underwater-tables.mjs: the underwater chapters of Of Ships and the Sea (owner's request 1.0.82).

Sources (AD&D 2e fandom wiki, MediaWiki API), tables parsed and the rules used regex-checked:
  - "Breathing (OSS)": conversion / transformation / adaptation magic (which lets the user speak, resists pressure).
  - "Vision - Underwater (OSS)": Tables 39-41 (clear / turbid / murky water by surface condition) and the depth steps
    (clear: one condition per 50 feet, blind past 250 + 50; turbid: 35 feet, 175; murky: 10 feet, 50), artificial light,
    infravision a quarter of its range.
  - "Temperature (OSS)": below 300 feet unprotected -2 attack and damage, +2 initiative; optional freezing (hourly
    Constitution check at -2 below 100 feet, 1d4 Constitution lost).
  - "Communication (OSS)": Table 42 hearing ranges.
  - "Movement - Underwater (OSS)": swimming rates (nonproficient a third of land movement x 5 yards, proficient half),
    walking a third x 5, sinking 10 / 40 feet a round, floating 10, maximum depth saves (vs. paralyzation each turn;
    4d10 + 1d10 per Depth Unit; -1 per Depth Unit beyond the first), Dexterity checks for abrupt maneuvers (-4 nonproficient).
    Table 43 is a picture on the wiki: only the figures the text gives (human 400, dwarf 600) are used; others are set
    per actor.
  - "Combat Effects (OSS)": +4 initiative and -4 to hit (Underwater Combat proficiency +2 / -2), no specialization bonuses,
    thrown weapons and bows do not work, surface crossbows a tenth of their range and -1 damage, decomposition saves.
  - "Special Weapons (OSS)": Tables 44 (underwater characteristics of weapons) and 45 (underwater missile weapons).
  - "Casting Spells Underwater (OSS)": verbal components need air, somatic +4 initiative (2 for specialty priests of water
    and elementalists, optional), Table 46 material component saving throws.
  - "Spells Allowed Underwater (OSS)": the wizard and priest spells that function (* component notes, @ altered).
  - "Underwater Alterations (OSS)": Table 47 (non-functioning magical items), Table 48 (altered).
  - "Underwater Encounters (OSS)": checks per day and chances, Tables 49-59.
  - "Swimming (PHB)": holding one's breath (a third of Constitution in rounds, halved exerting, halved without a good gulp,
    at least one round; then Constitution checks at a cumulative -2).
No rulebook text is copied: tables keep numbers and names; effects are paraphrased in lang/en.json.
Run from the repo root:  python3 tools/build-underwater-tables.py
"""
import importlib.util
import json
import re

_spec = importlib.util.spec_from_file_location("classdata", "tools/build-class-data.py")
classdata = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(classdata)



def tidy(label):
    """A table cell as a short label: wiki row markers, a repeated roll number and "(see page N)" references removed."""
    label = re.sub(r"^\|\s*", "", label.strip())
    label = re.sub(r"^\d+\s+", "", label)
    return re.sub(r"\s*\(see page \d+\)?$", "", label).strip()

def plain(text):
    t = re.sub(r"\[\[(?:[^|\]]*\|)?([^\]]*)\]\]", r"\1", text)
    t = re.sub(r"\{\{[Ff]rac\|(\d+)\|(\d+)\}\}", r"\1/\2", t)
    t = t.replace("'''", "").replace("''", "")
    return re.sub(r"\s+", " ", t)


def need(text, pattern, what):
    m = re.search(pattern, plain(text))
    assert m, f"rule changed: {what}"
    return m


def cell(c):
    c = re.sub(r"<sup>.*?</sup>", "", c)
    c = re.sub(r'^\s*style="[^"]*"\s*\|', "", c)
    c = re.sub(r"\{\{br\}\}", " ", c)
    c = re.sub(r"\[\[(?:[^|\]]*\|)?([^\]]*)\]\]", r"\1", c)
    c = c.replace("'''", "").replace("''", "")
    return c.strip()


def rows_of(wiki, caption):
    m = re.search(r"\|\+[^\n]*" + re.escape(caption), wiki)
    assert m, caption
    start = wiki.rindex("{|", 0, m.start())
    end = wiki.index("\n|}", start)
    out = []
    for line in wiki[start:end].split("\n"):
        if line.startswith("|") and not line.startswith(("|+", "|-", "|}")):
            out.append([cell(c) for c in line[1:].split("||")])
    return out


def yards(v):
    """"80" -> 80 yards; "10 feet" -> 10/3 yards; "—" -> None."""
    v = v.strip().replace(",", "")
    if v in ("—", "-", ""):
        return None
    m = re.fullmatch(r"(\d+) feet", v)
    if m:
        return round(int(m[1]) / 3, 2)
    return int(v)


def vision(w):
    out = {}
    for key, cap in [("clear", "Table 39"), ("turbid", "Table 40"), ("murky", "Table 41")]:
        rows = []
        for r in rows_of(w, cap):
            r = [c for c in r if c != ""] if r and r[0] == "" else r
            m = re.fullmatch(r"(Moonless Night)\s+(\S.*)", r[0])
            if m and len(r) == 5:
                r = [m[1], m[2], *r[1:]]
            assert len(r) == 6, (cap, r)
            rows.append({"surface": re.sub(r"[^a-z]", "", r[0].lower()), "label": tidy(r[0]), "movement": yards(r[1]), "spotted": yards(r[2]),
                         "type": yards(r[3]), "id": yards(r[4]), "detail": yards(r[5])})
        assert [x["surface"] for x in rows] == ["clearday", "overcast", "stormy", "moonlitnight", "moonlessnight"], cap
        out[key] = rows
    assert out["clear"][0]["movement"] == 100 and out["murky"][4]["movement"] == 1.67 and out["turbid"][4]["movement"] == 10
    p = plain(w)
    need(w, r"For every 50 feet of depth, the DM should move the surface condition down one category", "clear 50")
    need(w, r"Once a character moves beyond a depth of 250 feet .* he sees as if he were swimming on a Moonless Night in turbid water\. If the character moves down another 50 feet, he is unable to see", "clear 250")
    need(w, r"For every 35 feet of depth below the surface, the DM should move the surface condition down one category", "turbid 35")
    need(w, r"If a character moves down to a depth beyond 175 feet", "turbid 175")
    need(w, r"For every 10 feet of depth below the surface, the DM should move the surface condition down one category", "murky 10")
    need(w, r"If a character moves down beyond a depth of 50 feet", "murky 50")
    need(w, r"Any artificial light that illuminates with the same intensity as sunlight raises the prevailing surface condition to Clear Day", "sunlight")
    need(w, r"Any light source that does not equal sunlight in intensity only raises the prevailing surface condition to Overcast", "torch")
    need(w, r"Infravision functions underwater, though its range is only one quarter that of normal", "infravision")
    return out, {"clear": {"step": 50, "blind": 250, "extra": 50}, "turbid": {"step": 35, "blind": 175}, "murky": {"step": 10, "blind": 50}}


def hearing(w):
    rows = rows_of(w, "Table 42")
    out = {}
    group = None
    for r in rows:
        if len(r) < 4 or not r[0]:
            continue
        label = r[0]
        top = {"Natural": "natural", "Speech": "speech", "Surface Activity": "surface", "Underwater Activity": "underwater"}
        if label in top:
            group = top[label]
            key = "base"
        else:
            key = label.lower()
        out.setdefault(group, {})[key] = {"unassisted": yards(r[1]), "assisted": yards(r[2]), "marine": yards(r[3])}
    need(w, r"The ranges listed on the table are the maximum distance, in yards, that a creature can hear", "hearing yards")
    assert out["natural"]["cataclysmic"]["marine"] == 35000 and out["speech"]["complex"]["unassisted"] is None and out["underwater"]["heavy"]["assisted"] == 900
    return out


def weapons(w):
    out = []
    m = re.search(r"\|\+[^\n]*Table 44", w)
    start = w.rindex("{|", 0, m.start())
    body = w[start:w.index("\n|}", start)]
    groups = {}
    for line in body.split("\n"):
        if not line.startswith("|") or line.startswith(("|+", "|-", "|}")):
            continue
        ind = re.match(r'\|\s*style="padding-left:\s*(\d)em;"', line)
        level = int(ind[1]) // 2 if ind else 0
        r = [cell(c) for c in line[1:].split("||")]
        if not r[0] or r[0] == "Sm-Med":
            continue
        name = ", ".join([groups[i] for i in range(level) if i in groups] + [r[0]])
        # A row at a level ends the groups at that level and below; its own name heads the rows indented under it.
        for k in [k for k in groups if k >= level]:
            del groups[k]
        groups[level] = r[0]
        if len(r) == 1:
            continue
        if len(r) == 2 and "N/A" in r[1]:
            out.append({"name": name, "na": True})
            continue
        if len(r) < 7:
            continue
        out.append({"name": name, "na": False, "weight": r[1], "size": r[2], "type": r[3], "speed": r[4], "damage": [r[5], r[6]]})
    names = {x["name"] for x in out}
    assert "Bow (All types)" in names and "Trident, Two-handed" in names and "Spear, Stone, One-handed" in names and next(x for x in out if x["name"] == "Bow (All types)")["na"]
    assert next(x for x in out if x["name"] == "Trident, Two-handed")["damage"] == ["1d8+1", "3d4"]
    missiles = []
    group = None
    for r in rows_of(w, "Table 45"):
        if len(r) == 1:
            group = r[0]
            continue
        rng = [int(x) for x in r[2:5]]
        missiles.append({"name": f"{group}, {r[0]}", "rate": r[1], "range": rng})
    assert len(missiles) == 5 and missiles[0]["range"] == [5, 10, 15]
    return out, missiles


def components(w):
    out = []
    group = None
    for r in rows_of(w, "Table 46"):
        if len(r) == 1:
            if r[0]:
                group = r[0]
            continue
        if not r[0]:
            continue
        v = r[1].strip()
        digits = re.sub(r"[^\d]", "", v)
        # "—*": immersion disperses or spoils the component at once.
        out.append({"group": group, "name": r[0].rstrip("*").strip(), "save": int(digits) if digits else None, "spoils": "*" in v or r[0].endswith("*")})
    assert len(out) > 40 and next(x for x in out if x["name"] == "Bag, silk")["save"] == 16
    assert next(x for x in out if x["name"].startswith("Powder"))["spoils"]
    return out


def spell_lists(w):
    out = {}
    for kind, head in [("wizard", "==Wizard Spells Available Underwater=="), ("priest", "==Priest Spells Available Underwater==")]:
        i = w.index(head)
        j = w.index("==Priest Spells Available Underwater==") if kind == "wizard" else len(w)
        part = w[i:j]
        level = 0
        spells = []
        for line in part.split("\n"):
            m = re.search(r"'''(\d)(?:st|nd|rd|th) Level'''", line)
            if m:
                level = int(m[1])
            for lm in re.finditer(r"\[\[([^|\]]+?) \((?:Wizard|Priest) Spell\)(?:\|[^\]]*)?\]\]('')?\s*(\*)?\s*(<sup>@</sup>)?", line):
                spells.append({"name": lm[1], "level": level, "component": bool(lm[3]), "altered": bool(lm[4])})
        out[kind] = spells
    assert len(out["wizard"]) > 150 and len(out["priest"]) > 100, (len(out["wizard"]), len(out["priest"]))
    assert any(s["name"] == "Alarm" and s["altered"] for s in out["wizard"]) and any(s["name"] == "Audible Glamer" and s["component"] for s in out["wizard"])
    return out


def items(w):
    out = {}
    for key, head, nxt in [("none", "==Table 47: Non-functioning Magical Items==", "==Table 48"), ("altered", "==Table 48: Altered Magical Items==", None)]:
        i = w.index(head)
        j = w.index(nxt, i) if nxt else len(w)
        names = [re.sub(r"\s*\((?:Magic|Magical)[^)]*\)$", "", m[1]) for m in re.finditer(r"\[\[([^|\]]+)(?:\|[^\]]*)?\]\]", w[i:j])]
        out[key] = sorted(set(names))
    assert "Potion of Fire Breath" in out["none"] and "Wand of Lightning" in out["altered"]
    return out


def encounters(w):
    p = plain(w)
    areas = {}
    spec = [("shelf", "Table 49", r"==Continental Shelf== Check for random encounters three times a day\. Encounters occur on a roll of 1 or 2 on 1d6", 3, 2),
            ("slope", "Table 50", r"==Continental Slope and Rise== .*?(twice|three times) a day.*?(1 or 2|1) on 1d6", None, None),
            ("abyssal", "Table 51", r"==Abyssal Hills and Plains== .*?(twice|three times|once) a day.*?(1 or 2|1) on 1d6", None, None),
            ("seamount", "Table 53", r"==Seamounts and Guyouts== Roll twice a day for random encounters\. Encounters occur on a roll of 1 on 1d6", 2, 1),
            ("ridge", "Table 54", r"==Oceanic Ridge== .*?(twice|three times|once) a day.*?(1 or 2|1) on 1d6", None, None),
            ("reef", "Table 55", r"==Coral Reef== .*?(twice|three times|once) a day.*?(1 or 2|1) on 1d6", None, None),
            ("river", "Table 56", r"==Rivers and Lakes== Roll for random encounters twice a day\. Encounters occur on a roll of 1 on 1d6", 2, 1)]
    words = {"once": 1, "twice": 2, "three times": 3}
    for key, cap, pat, checks, chance in spec:
        m = re.search(pat, p)
        assert m, key
        if checks is None:
            checks, chance = words[m[1]], 2 if m[2] == "1 or 2" else 1
        rows = [{"roll": int(r[0]), "label": tidy(r[1])} for r in rows_of(w, cap) if len(r) >= 2 and r[0].isdigit()]
        assert [r["roll"] for r in rows] == list(range(2, 21)), key
        areas[key] = {"checks": checks, "chance": chance, "rows": rows}
    need(w, r"Characters adventuring in an underwater trench have a 15% chance per day of a random encounter", "trench 15%")
    areas["trench"] = {"percent": 15, "die": "1d8", "rows": [{"roll": int(r[0]), "label": r[1]} for r in rows_of(w, "Table 52") if r[0].isdigit()]}
    assert len(areas["trench"]["rows"]) == 8
    races = [{"roll": int(r[0]), "label": r[1]} for r in rows_of(w, "Table 57") if r[0].isdigit()]
    hazards = [{"roll": int(r[0]), "label": r[1]} for r in rows_of(w, "Table 58") if r[0].isdigit()]
    vortex = [{"roll": int(r[0]), "label": re.sub(r"\s*\(.*\)$", "", r[1])} for r in rows_of(w, "Table 59") if r[0].isdigit()]
    assert len(races) == 8 and len(hazards) == 10 and len(vortex) == 6
    assert all(re.fullmatch(r"[A-Z][^|()]*(\([^()]*\))?[^|()]*", r["label"]) for a in areas.values() for r in a["rows"]), "area labels"
    need(w, r"There is a 5% chance per hour that a creature from the Elemental Plane of Water will appear through the vortex", "vortex 5%")
    return areas, races, hazards, vortex


def build():
    revs = {}

    def page(title):
        w, rev, _ = classdata.page(title)
        revs[title] = rev
        return w

    br = page("Breathing (OSS)")
    need(br, r"Conversion dweomers allow the caster or wielder to speak while underwater", "conversion speech")
    need(br, r"conversion dweomers automatically compensate for changes in pressure", "conversion pressure")
    need(br, r"The recipient's lungs and vocal chords fill with water, thereby cutting off the possibility of speech, including spellcasting", "water breathing no speech")
    need(br, r"the stone's power does not allow the user to speak without air", "ioun no speech")
    need(br, r"The adaptation dweomer completely protects the wearer from the effects of pressure", "necklace pressure")
    vw = page("Vision - Underwater (OSS)")
    vis, steps = vision(vw)
    tw = page("Temperature (OSS)")
    need(tw, r"Any surface-dwelling character traveling at depths below 300 feet must possess some magical means of protection against the cold\. Unprotected characters receive a -2 penalty to attack and damage rolls, and must add \+2 to initiative rolls", "cold")
    need(tw, r"Unprotected surface dwellers must attempt a Constitution check with a -2 penalty each hour they remain submerged at a cold depth \(below 100 feet\)\. Failure indicates that the character in question loses 1d4 Constitution points", "freezing")
    need(tw, r"a character can regain Constitution points at a rate of 1 per hour if he rests in a warm area", "warm rest")
    cw = page("Communication (OSS)")
    hear = hearing(cw)
    need(cw, r"unassisted surface dwellers cannot understand Complex speech at any distance", "complex speech")
    mw = page("Movement - Underwater (OSS)")
    need(mw, r"Nonproficient swimmers .* swim at a rate equal to one third of their current land movement times five in yards", "nonproficient")
    need(mw, r"Encumbered nonproficient swimmers \(even lightly encumbered ones\) cannot swim any distance", "encumbered nonproficient")
    need(mw, r"Characters with the Swimming proficiency can swim at a rate equal to one half of their land movement times five in yards", "proficient")
    need(mw, r"Lightly encumbered proficient swimmers travel at one third of their land movement rates times five in yards\. Moderately \(and more heavily\) encumbered characters cannot swim", "proficient encumbered")
    need(mw, r"Under no circumstances should a Dungeon Master allow a character in nonmagical metal armor to swim", "metal armour")
    need(mw, r"rise at a rate of 10 feet per round", "float 10")
    need(mw, r"Sinking characters descend at a rate of 10 feet per round\. This rate of descent increases to 40 feet per round if a character wears metal armor or carries more than 30 pounds of equipment", "sinking")
    need(mw, r"it must make a successful saving throw vs\. paralyzation to resist the detrimental effects of pressure\. The creature must attempt the saving throw at the end of each turn it remains below its maximum depth\. Failure indicates that the creature suffers 4d10 points of crushing damage per round, plus 1d10 points of damage for each Depth Unit below the creature's maximum depth", "depth damage")
    need(mw, r"the Depth Unit for a dwarf is 600 feet", "dwarf 600")
    need(mw, r"Her normal maximum depth is 400 feet", "human 400")
    need(mw, r"creatures functioning beyond their maximum depths do so with a -1 penalty to initiative rolls, attack rolls, saving throws, and ability checks for each Depth Unit beyond the first", "depth penalty")
    need(mw, r"can function at an additional Depth Unit-albeit less efficiently-for up to one day", "acclimate")
    need(mw, r"A character must attempt a Dexterity check when performing abrupt or complex maneuvers underwater\. Failure indicates that the character cannot perform the action until the end of the next round\. .* Nonproficient swimmers suffer a -4 penalty", "dex check")
    need(mw, r"A character can walk at a rate equal to one third of his land movement times five in yards per round", "walk")
    need(mw, r"For each full day of rest, a character regains 1d3 Constitution points", "rest 1d3")
    ce = page("Combat Effects (OSS)")
    need(ce, r"Surface dwellers add 4 to their initiative rolls and suffer a -4 penalty to their attack rolls when fighting underwater\. In addition, .* prevent characters from receiving any offensive bonuses from weapon specialization", "combat -4")
    need(ce, r"Thrown weapons such as daggers and darts do not function underwater\. In addition, normal bows and crossbows are not effective", "missiles")
    need(ce, r"Characters with the Underwater Combat proficiency only add 2 to their initiative rolls and suffer only a -2 penalty to their attack rolls", "proficiency -2")
    need(ce, r"Adventurers who fill four proficiency slots with Underwater Combat may add their combat bonuses \(attack, damage, and extra attacks\) for a single level of weapon specialization", "four slots")
    need(ce, r"These weapons must make an item saving throw \(as metal\) against acid for every turn they remain underwater\. Each turn after the first, however, the crossbow suffers a cumulative -1 penalty", "crossbow decomposition")
    need(ce, r"Ranges for these weapons are reduced to one tenth of the original values\. In addition, surface quarrels subtract 1 from their damage", "crossbow 1/10")
    need(ce, r"the normal 4 attack penalty still applies to submerged characters without such magical augmentation as a ring of free action", "free action")
    sw = page("Special Weapons (OSS)")
    wps, missiles = weapons(sw)
    cs = page("Casting Spells Underwater (OSS)")
    need(cs, r"To cast spells with verbal components underwater, all spellcasters must use a magical item or spell that generates a field of air", "verbal air")
    need(cs, r"all spellcasters must add 4 to their initiative rolls when casting spells underwater", "somatic +4")
    need(cs, r"The initiative penalty is not cumulative with the normal underwater combat penalty", "not cumulative")
    need(cs, r"Specialty priests of water deities suffer an initiative penalty of only 2", "specialty 2")
    need(cs, r"A special saving throw applies whenever a spellcaster uses a material component underwater", "component save")
    comps = components(cs)
    sa = page("Spells Allowed Underwater (OSS)")
    need(sa, r"fire-based spells do not function underwater unless cast and targeted within a pocket of air", "fire spells")
    spells = spell_lists(sa)
    ua = page("Underwater Alterations (OSS)")
    mitems = items(ua)
    need(ua, r"Books, Librams, Manuals, and Tomes \* These items are destroyed by immersion in water", "books destroyed")
    ue = page("Underwater Encounters (OSS)")
    areas, races, hazards, vortex = encounters(ue)
    sp = page("Swimming (PHB)")
    need(sp, r"a character can hold his breath up to 1/3 his Constitution score in rounds \(rounded up\)\. If the character is exerting himself, this time is halved \(again, rounded up\)", "breath 1/3")
    need(sp, r"If unable to get a good gulp of air, these times are reduced by 1/2\. All characters are able to hold their breath for one round", "gulp")
    need(sp, r"The first check has no modifiers, but each subsequent check suffers a -2 cumulative penalty\. Once a check is failed, the character must breathe \(if he cannot reach the surface, he drowns\)", "breath checks")
    data = {
        "combat": {"attack": -4, "initiative": 4, "proficient": {"attack": -2, "initiative": 2}, "cold": {"depth": 300, "attack": -2, "damage": -2, "initiative": 2},
                   "freezing": {"depth": 100, "check": -2, "loss": "1d4"}, "crossbow": {"range": 0.1, "damage": -1}, "spellInitiative": 4, "specialtyInitiative": 2},
        "movement": {"swim": {"nonproficient": 1 / 3, "proficient": 1 / 2, "proficientLight": 1 / 3, "yardsPer": 5}, "walk": 1 / 3, "sink": {"normal": 10, "heavy": 40, "heavyLb": 30},
                     "float": 10, "dexCheckNonproficient": -4},
        "depth": {"known": {"human": 400, "dwarf": 600}, "damage": "4d10", "perUnit": "1d10", "penaltyPerUnit": -1},
        "breath": {"conFraction": 1 / 3, "exerting": 0.5, "noGulp": 0.5, "minimum": 1, "checkStep": -2},
        "vision": vis, "visionSteps": steps, "infravision": 0.25, "hearing": hear, "weapons": wps, "missiles": missiles, "components": comps,
        "spells": spells, "items": mitems, "areas": areas, "races": races, "hazards": hazards, "vortex": vortex,
        "urls": {k: classdata.url(k) for k in revs}
    }
    return data, revs


if __name__ == "__main__":
    data, revs = build()
    with open("module/rules/underwater-tables.mjs", "w") as f:
        f.write("// GENERATED by tools/build-underwater-tables.py from the AD&D 2e fandom wiki (MediaWiki API): do not edit.\n")
        f.write("// Sources: " + ", ".join(f"{k} rev {v}" for k, v in revs.items()) + ".\n")
        f.write(f"export const UNDERWATER = {json.dumps(data, ensure_ascii=False)};\n")
    print(len(data["weapons"]), "weapons,", len(data["components"]), "components,", len(data["spells"]["wizard"]), "+", len(data["spells"]["priest"]), "spells")
