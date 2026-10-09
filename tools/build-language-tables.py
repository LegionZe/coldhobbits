#!/usr/bin/env python3
"""Generate module/rules/language-tables.mjs: data for character languages (module/languages.mjs).

Sources (AD&D 2e fandom wiki, MediaWiki API), lists parsed and rules regex-checked:
  - "Dwarf (PHB)", "Elf (PHB)", "Gnome (PHB)", "Half-Elf (PHB)", "Halfling (PHB)": the initial languages a character of
    the race may choose (the lists end with "any others your DM allows" or similar); "Human (PHB)" names none.
  - "Intelligence (PHB)": Table 4 "Number of Languages" (already in ability-tables.mjs) = languages "beyond their native
    language"; the native language needs no slot; Table 4 knowledge is speaking only; the DM decides whether the number
    is known at the start or a maximum to learn.
  - "Languages, Modern (Proficiency)", "Languages, Ancient (Proficiency)", "Reading/Writing (Proficiency)".
  - "The People of Zakhara (AA)" / "Glossary (AA)": Midani, Zakharan Common (the only Al-Qadim language the wiki names).
Run from the repo root:  python3 tools/build-language-tables.py
"""
import importlib.util
import json
import re

_spec = importlib.util.spec_from_file_location("classdata", "tools/build-class-data.py")
classdata = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(classdata)
_tspec = importlib.util.spec_from_file_location("travel", "tools/build-travel-tables.py")
travel = importlib.util.module_from_spec(_tspec)
_tspec.loader.exec_module(travel)
need = travel.need

# Race identifier -> (page, regex capturing the list, the race's own tongue or None, expected list).
RACES = {
    "dwarf": ("Dwarf (PHB)", r"The initial languages a dwarf can learn are (.+?), and any others your DM allows", "dwarf",
              ["common", "dwarf", "gnome", "goblin", "kobold", "orc"]),
    "elf": ("Elf (PHB)", r"As initial languages, an elf can choose (.+?)\.", "elf",
            ["common", "elf", "gnome", "halfling", "goblin", "hobgoblin", "orc", "gnoll"]),
    "gnome": ("Gnome (PHB)", r"a beginning gnome character can choose to know the following languages, in addition to any others "
              r"allowed by the DM: (.+?) \(moles", "gnome",
              ["common", "dwarf", "gnome", "halfling", "goblin", "kobold", "burrowing mammals"]),
    "half-elf": ("Half-Elf (PHB)", r"choose any of the following languages \(plus any other allowed by the DM\): (.+?)\.", None,
                 ["common", "elf", "gnome", "halfling", "goblin", "hobgoblin", "orc", "gnoll"]),
    "halfling": ("Halfling (PHB)", r"choose initial languages from (.+?), in addition to any other languages the DM allows", "halfling",
                 ["common", "halfling", "dwarf", "elf", "gnome", "goblin", "orc"]),
}


def plain(text):
    text = re.sub(r"\[\[(?:[^\]|]*\|)?([^\]]*)\]\]", r"\1", text)
    return re.sub(r"\s+", " ", text).strip()


def split_list(text):
    parts = re.split(r",\s*(?:and\s+)?|\s+and\s+", plain(text))
    out = []
    for p in parts:
        p = p.strip().lower()
        p = re.sub(r"^the simple common speech of ", "", p)
        if p:
            out.append(p)
    return out


def build():
    revs = {}
    racial, own = {}, {}
    for race, (page, pattern, tongue, expected) in RACES.items():
        w, rev, _ = classdata.page(page)
        revs[page] = rev
        m = need(re.sub(r"\s+", " ", w), pattern, f"{race} languages")
        langs = split_list(m.group(1))
        assert langs == expected, (race, langs)
        racial[race] = langs
        own[race] = tongue
    hw = re.sub(r"\s+", " ", plain(classdata.page("Half-Elf (PHB)")[0]))
    need(hw, r"Half-elves do not have a language of their own", "half-elf tongue")
    hu, hu_rev, _ = classdata.page("Human (PHB)")
    revs["Human (PHB)"] = hu_rev
    assert not re.search(r"initial languages", hu), "Human (PHB) now names languages"
    racial["human"], own["human"] = [], None

    iw, i_rev, _ = classdata.page("Intelligence (PHB)")
    revs["Intelligence (PHB)"] = i_rev
    it = re.sub(r"\s+", " ", iw)
    need(it, r"number of additional languages the character can speak beyond their native language", "Table 4 meaning")
    need(it, r"Every character can speak their native language, no matter what their intelligence is", "native free")
    need(it, r"This knowledge extends only to speaking the language; it does not include reading or writing", "speaking only")
    need(it, r"The DM must decide if your character begins the game already knowing these additional languages or if the number "
             r"shows only how many languages your character can possibly learn", "start or learn")
    need(it, r"The character never needs to spend any proficiency slots to speak their native language", "native slot")

    mw, m_rev, _ = classdata.page("Languages, Modern (Proficiency)")
    need(re.sub(r"\s+", " ", mw), r"For each additional character point spent on modern Languages, the character can speak one additional language",
         "modern languages")
    aw, a_rev, _ = classdata.page("Languages, Ancient (Proficiency)")
    need(re.sub(r"\s+", " ", aw), r"This proficiency enables the character to either read and write or speak the language \(his choice\)", "ancient")
    rw, r_rev, _ = classdata.page("Reading/Writing (Proficiency)")
    need(re.sub(r"\s+", " ", rw), r"The character can read and write a modern language he can speak", "reading/writing")
    need(re.sub(r"\s+", " ", rw), r"This proficiency does not enable the character to learn ancient languages", "reading/writing ancient")
    pw, p_rev, _ = classdata.page("The People of Zakhara (AA)")
    need(re.sub(r"\s+", " ", pw), r"They share a common language, Midani", "Midani")
    gw, g_rev, _ = classdata.page("Glossary (AA)")
    need(re.sub(r"\s+", " ", gw), r"''Midani:'' Zakharan Common", "Midani glossary")
    revs.update({"Languages, Modern (Proficiency)": m_rev, "Languages, Ancient (Proficiency)": a_rev,
                 "Reading/Writing (Proficiency)": r_rev, "The People of Zakhara (AA)": p_rev, "Glossary (AA)": g_rev})

    pages = {r: classdata.url(p) for r, (p, *_rest) in RACES.items()}
    pages["human"] = classdata.url("Human (PHB)")
    return {"racial": racial, "own": own, "aq": ["Midani"],
            "urls": {"races": pages, "intelligence": classdata.url("Intelligence (PHB)"),
                     "modern": classdata.url("Languages, Modern (Proficiency)"), "ancient": classdata.url("Languages, Ancient (Proficiency)"),
                     "reading": classdata.url("Reading/Writing (Proficiency)"), "aq": classdata.url("The People of Zakhara (AA)")}}, revs


if __name__ == "__main__":
    data, revs = build()
    with open("module/rules/language-tables.mjs", "w") as f:
        f.write("// GENERATED by tools/build-language-tables.py from the AD&D 2e fandom wiki (MediaWiki API): do not edit.\n")
        f.write("// Sources: " + ", ".join(f"{k} rev {v}" for k, v in revs.items()) + ".\n")
        f.write(f"export const LANGUAGE_TABLES = {json.dumps(data, ensure_ascii=False)};\n")
    print({k: len(v) for k, v in data["racial"].items()})
