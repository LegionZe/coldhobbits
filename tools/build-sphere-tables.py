#!/usr/bin/env python3
"""Generate module/rules/sphere-tables.mjs: priest spheres of influence and the PHB classes' access (owner's request 1.0.87,
priests praying for spells from the compendiums).

Sources (AD&D 2e fandom wiki, MediaWiki API), every rule used regex-checked:
  - "Priest (PHB)": the 16 spheres; major access = all spells of the sphere, minor access = 1st- to 3rd-level spells.
  - "Cleric (PHB)": major access to every sphere but plant, animal, weather and elemental; minor access to elemental.
  - "Druid (PHB)": major all, animal, elemental, healing, plant, weather; minor divination.
  - "Paladin (PHB)": combat, divination, healing and protective spheres (major: no limit is given beyond the paladin's
    own spell levels).
  - "Ranger (PHB)": plant and animal spheres.
  - Al-Qadim cleric kits (owner's request 1.0.88): "Kahin", "Ethoist", "Moralist", "Pragmatist", "Hakima", "Mystic - Al-Qadim"
    (Character Kit) pages, "* Major Access: ..." / "* Minor Access: ..." lines; they replace the cleric's spheres.
  - Specialty priests (owner's request 1.0.88): every page of "Category:The Complete Priest's Handbook" with a "Spheres of
    Influence:" paragraph ("Major Access to ... Minor Access to ..."), the Race page one priesthood per race. Spells limited
    within a sphere (a parenthesis after it) are kept as `restricted` (shown, not enforced: implementation choice); the
    half-elf's choice of one sphere is `choice`. Options and DM substitutions in the paragraph are not applied.
The character's own sphere fields override all of these.
Run from the repo root:  python3 tools/build-sphere-tables.py
"""
import importlib.util
import json
import re

_spec = importlib.util.spec_from_file_location("classdata", "tools/build-class-data.py")
classdata = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(classdata)


def plain(text):
    t = re.sub(r"\[\[(?:[^|\]]*\|)?([^\]]*)\]\]", r"\1", text)
    t = t.replace("'''", "").replace("''", "")
    return re.sub(r"\s+", " ", t)


def need(text, pattern, what):
    m = re.search(pattern, plain(text))
    assert m, f"rule changed: {what}"
    return m


def names(text):
    """'all, animal, elemental, and weather' -> ['all', 'animal', 'elemental', 'weather']."""
    return [w.strip().lower() for w in re.split(r",\s*(?:and\s+)?|\s+and\s+|\s+or\s+", text) if w.strip()]


# Limits within a priesthood's sphere (owner's request 1.0.89: enforced in the prayer window). Each entry's `match` must
# occur in the priesthood's "Spheres of Influence" paragraph (plain text). Rule fields: `names` = the only spells allowed
# (exact names), `words` = spell names with a word starting so (also allowed), `reversed` = only reversible spells, prayed
# as their reversed form (owner's ruling 1.0.90), `reversedWhereApplicable` = reversible spells only reversed (others allowed), `exclude` =
# names not allowed, `excludeWords` = name words not allowed. Implementation choices: Dawn's "spells involving heat, fire,
# or air" read as names with fire, flame, heat, pyrotechnics, air or wind (and chariot of Sustarre); Earth's "dealing
# with dust, stone, rock, mud, and earth" as names with those words; Oceans' "insect-related" Animal spells as names with
# "insect" or "creeping doom"; its sea-life-only Animal spells and water-elemental conjuring are notes.
FIRE_WORDS = ["fire", "flame", "heat", "pyrotechnics"]
LIMITS = {
    "agriculture": {"summoning": {"match": r"Summoning \(can only use wall of thorns , weather summoning , and creeping doom from this sphere\)",
                                  "names": ["wall of thorns", "weather summoning", "creeping doom"]}},
    "dawn": {"elemental": {"match": r"Elemental \(only spells involving heat, fire, or air; earth and water spells may not be used\)",
                           "words": FIRE_WORDS + ["air", "wind"], "names": ["chariot of sustarre"]}},
    "disease": {"healing": {"match": r"Healing \(reversed forms of spells only\)", "reversed": True},
                "necromantic": {"match": r"Necromantic \(reversed forms of spells only\)", "reversed": True},
                # Owner's ruling 1.0.90: "where applicable" = wherever a reversed form exists; non-reversible spells are left out.
                "protection": {"match": r"Protection \(reversed forms of spells only, where applicable\)", "reversed": True}},
    "earth": {"elemental": {"match": r"Elemental \(the priest may only use spells dealing with dust, stone, rock, mud, and earth, plus transmute metal to wood",
                            "words": ["dust", "stone", "rock", "mud", "earth"], "names": ["transmute metal to wood"]}},
    "evil-philosophy": {"protection": {"match": r"Protection \(may only use reversed forms of the spells\)", "reversed": True}},
    "fire": {"elemental": {"match": r"Elemental \(the priest may only use the spells whose names include the words Fire, Flame, Heat, Pyrotechnics, and the spell chariot of Sustarre",
                           "words": FIRE_WORDS, "names": ["chariot of sustarre"]}},
    "life-death-rebirth-cycle-force": {"necromantic": {"match": r"These priests cannot use resurrection spell; they use reincarnate instead",
                                                       "exclude": ["resurrection"]}},
    "lightning": {"elemental": {"match": r"Elemental \(the priest may only use the spells whose names include the words Air, Wind, Fire, Flame, Heat, Pyrotechnics, and the spell chariot of Sustarre",
                                "words": ["air", "wind"] + FIRE_WORDS, "names": ["chariot of sustarre"]}},
    "metalwork": {"elemental": {"match": r"Elemental \(the priest may only use the spells whose names include the words Fire, Flame, Heat, Pyrotechnics, and the spell chariot of Sustarre",
                                "words": FIRE_WORDS, "names": ["chariot of sustarre"]}},
    "sky-weather": {"elemental": {"match": r"Elemental \(the priest can only use spells with the words Water, Air, and Wind in their names, and the spell chariot of Sustarre",
                                  "words": ["water", "air", "wind"], "names": ["chariot of sustarre"]}},
    "sun": {"elemental": {"match": r"Elemental \(the priest can only use spells with the words fire, flame, heat, and pyrotechnics in the names\)",
                          "words": FIRE_WORDS}},
    "wind": {"elemental": {"match": r"Elemental \(the priest can only use the spells dust devil, air walk, chariot of Sustarre, and wind walk",
                           "names": ["dust devil", "air walk", "chariot of sustarre", "wind walk"]}},
    "oceans-rivers": {
        "animal": {"match": r"Within his Animal sphere, the priest can only cast spells dealing with sea animals.*cannot use the insect-related spells at all",
                   "excludeWords": ["insect"], "exclude": ["creeping doom"], "note": True},
        "elemental": {"match": r"Within his Elemental sphere, the priest can only use spells with the word \"water\" in the name; he can also use the earthquake and transmute rock to mud spells",
                      "words": ["water"], "names": ["earthquake", "transmute rock to mud"], "note": True}},
}


AQ_KITS = {"kahin": "Kahin (Character Kit)", "ethoist": "Ethoist (Character Kit)", "moralist": "Moralist (Character Kit)",
           "pragmatist": "Pragmatist (Character Kit)", "hakima": "Hakima (Character Kit)", "mystic-al-qadim": "Mystic - Al-Qadim (Character Kit)"}


def access_list(text, spheres):
    """'All, Animal (only ...), and Plant' -> (keys, restricted keys, choice keys)."""
    # Race (CPrH), halflings: the page splits a word ("Pro  tection"); joined here.
    t = re.sub(r"\bPro\s+tection\b", "Protection", text)
    choice = []
    m = re.search(r",?\s*and player's choice of one from the following list: ([A-Za-z, ]+)", t)
    if m:
        choice = [c for c in names(m[1].replace(" or ", ", "))]
        t = t[:m.start()]
    restricted = []
    out = []
    for part in re.split(r",(?![^(]*\))", t):
        part = part.strip().strip(".")
        part = re.sub(r"^and\s+", "", part)
        if not part or part.lower() == "none":
            continue
        word = re.match(r"([A-Za-z]+)", part)[1].lower()
        assert word in spheres, (word, text)
        out.append(word)
        if "(" in part:
            restricted.append(word)
    for c in choice:
        assert c in spheres, (c, text)
    return out, restricted, choice


def kit_spheres(spheres, revs):
    kits = {}
    for key, title in AQ_KITS.items():
        w, revs[title], _ = classdata.page(title)
        major = need(w, r"\* Major Access: ([^*]+?)\s*\* Minor Access: ([^*]+?)\s*\* Forbidden Spheres", f"{key} spheres")
        a, _, _ = access_list(major[1].replace(".", ""), spheres)
        b, _, _ = access_list(major[2].replace(".", ""), spheres)
        kits[key] = {"major": a, "minor": b}
    assert kits["kahin"] == {"major": ["all", "animal", "divination", "elemental", "healing", "plant", "weather"], "minor": ["creation", "protection", "sun"]}
    assert kits["moralist"]["minor"] == [] and kits["hakima"]["minor"] == ["charm", "creation", "guardian", "weather"]
    return kits


def priesthoods(spheres, revs):
    titles, cont = [], {}
    while True:
        r = classdata.api(action="query", list="categorymembers", cmtitle="Category:The Complete Priest's Handbook", cmlimit=500, **cont)
        titles += [m["title"] for m in r["query"]["categorymembers"]]
        if "continue" not in r:
            break
        cont = r["continue"]
    out = []
    for i in range(0, len(titles), 50):
        r = classdata.api(action="query", prop="revisions", rvprop="content|ids", rvslots="main", titles="|".join(titles[i:i + 50]))
        for p in r["query"]["pages"].values():
            wiki = p["revisions"][0]["slots"]["main"]["*"]
            if "Spheres of Influence:" not in wiki or p["title"] == "Priesthoods (CPrH)":
                continue
            text = plain(wiki)
            base = p["title"].replace(" (CPrH)", "")
            found = list(re.finditer(r"(?:([A-Z][A-Za-z-]+): )?Major Access to (.+?)\.\s*(?:Minor Access to (.+?)\.)?(?=\s|$)", text))
            if p["title"] == "Race (CPrH)":
                found = [m for m in found if m[1]]
                assert len(found) == 6, [m[1] for m in found]
            else:
                found = found[:1]
            assert found, p["title"]
            revs[p["title"]] = p["revisions"][0]["revid"]
            para = re.search(r"Spheres of Influence:\s*(.*?)(?:Powers:|$)", text)[1]
            for m in found:
                major, r1, choice = access_list(m[2], spheres)
                minor, r2, _ = access_list(m[3] or "", spheres)
                label = f"{base}: {m[1]}" if p["title"] == "Race (CPrH)" else base
                key = re.sub(r"[^a-z0-9]+", "-", label.lower()).strip("-")
                limits = {}
                for sphere, rule in LIMITS.get(key, {}).items():
                    assert re.search(rule["match"], para), f"limit changed: {key} {sphere}"
                    assert sphere in major + minor, (key, sphere)
                    limits[sphere] = {k: v for k, v in rule.items() if k != "match"}
                out.append({"key": key, "label": label, "major": major, "minor": minor,
                            "restricted": sorted(set(r1 + r2) | set(limits)), "limits": limits, "choice": choice, "url": classdata.url(p["title"])})
    out.sort(key=lambda x: x["label"])
    by = {x["key"]: x for x in out}
    assert len(out) == 64, len(out)
    assert by["death"]["major"] == ["all", "astral", "charm", "divination", "protection"] and by["death"]["minor"] == ["guardian", "necromantic", "sun", "weather"]
    assert by["war"]["major"] == ["combat", "healing"] and by["community"]["minor"] == ["combat", "protection"]
    assert by["fire"]["restricted"] == ["elemental"] and by["race-half-elves"]["choice"] == ["animal", "plant", "protection", "summoning"]
    assert by["race-halflings"]["major"][-1] == "protection"
    for p in out:  # every sphere limited in brackets has a rule (Life-Death-Rebirth's note is in brackets too)
        assert set(p["restricted"]) == set(p["limits"]), (p["key"], p["restricted"], list(p["limits"]))
    assert set(LIMITS) <= set(by), set(LIMITS) - set(by)
    return out


def build():
    revs = {}
    w, revs["Priest (PHB)"], _ = classdata.page("Priest (PHB)")
    m = need(w, r"The 16 spheres of influence are as follows: ([A-Za-z, ]+?)\.", "the 16 spheres")
    spheres = names(m[1])
    assert len(spheres) == 16 and "all" in spheres and "weather" in spheres, spheres
    need(w, r"A priest with major access to a sphere can \(eventually\) cast all spells in the sphere", "major access")
    need(w, r"A priest with minor access to a sphere can cast only 1st-, 2nd-, and 3rd-level spells from that sphere", "minor access")

    w, revs["Cleric (PHB)"], _ = classdata.page("Cleric (PHB)")
    m = need(w, r"A cleric has major access to every sphere of influence except the ([a-z, ]+?) spheres \(he has minor access to the "
                r"(\w+) sphere and cannot cast spells of the other three spheres\)", "cleric")
    excluded = names(m[1])
    assert sorted(excluded) == ["animal", "elemental", "plant", "weather"], excluded
    cleric = {"major": [s for s in spheres if s not in excluded], "minor": [m[2].lower()]}

    w, revs["Druid (PHB)"], _ = classdata.page("Druid (PHB)")
    major = names(need(w, r"They have major access to the following spheres: ([a-z, ]+?)\.", "druid major")[1])
    minor = names(need(w, r"They have minor access to the (\w+) sphere", "druid minor")[1])
    druid = {"major": major, "minor": minor}

    w, revs["Paladin (PHB)"], _ = classdata.page("Paladin (PHB)")
    m = need(w, r"He can cast only spells of the ([a-z, ]+?) spheres", "paladin")
    paladin = {"major": ["protection" if s == "protective" else s for s in names(m[1])], "minor": []}

    w, revs["Ranger (PHB)"], _ = classdata.page("Ranger (PHB)")
    m = need(w, r"but only those of the ([a-z ]+?) spheres", "ranger")
    ranger = {"major": names(m[1]), "minor": []}

    classes = {"cleric": cleric, "druid": druid, "paladin": paladin, "ranger": ranger}
    for k, v in classes.items():
        for s in v["major"] + v["minor"]:
            assert s in spheres, (k, s)
    assert druid["major"] == ["all", "animal", "elemental", "healing", "plant", "weather"] and druid["minor"] == ["divination"]
    assert paladin["major"] == ["combat", "divination", "healing", "protection"] and ranger["major"] == ["plant", "animal"]
    kits = kit_spheres(spheres, revs)
    priests = priesthoods(spheres, revs)
    return {"spheres": spheres, "minorMaxLevel": 3, "classes": classes, "kits": kits, "priesthoods": priests,
            "urls": {k: classdata.url(k) for k in revs if "(CPrH)" not in k}}, revs


if __name__ == "__main__":
    data, revs = build()
    with open("module/rules/sphere-tables.mjs", "w") as f:
        f.write("// GENERATED by tools/build-sphere-tables.py from the AD&D 2e fandom wiki (MediaWiki API): do not edit.\n")
        f.write("// Sources: " + ", ".join(f"{k} rev {v}" for k, v in revs.items()) + ".\n")
        f.write(f"export const SPHERE_TABLES = {json.dumps(data, ensure_ascii=False)};\n")
    print(len(data["priesthoods"]), "priesthoods,", len(data["kits"]), "kits;", len(data["spheres"]), "spheres;", {k: (len(v["major"]), len(v["minor"])) for k, v in data["classes"].items()})
