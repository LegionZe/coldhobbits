#!/usr/bin/env python3
"""Generate module/rules/province-tables.mjs: the elemental province of wizard spells (Al-Qadim).

Source (AD&D 2e fandom wiki, MediaWiki API): "Appendix A: Wizard Spells by Province (AA)" (Arabian Adventures): for
each spell level, lists headed Universal, Flame, Sand, Sea and Wind; a spell under a province belongs to it (a few
are in two, e.g. Wall of Fog: sea and wind). Universal spells have no province. Keyed by the linked page title.
Used by the spell importer (spell `system.provinces`) and the elemental mage kit ("+1 to each damage die inflicted with
an attack using that element", Elemental Mage (Character Kit)).
SPELL_NATIVE: every spell of the appendix, universal ones included (title -> spell level): the spells "native" to the
Land of Fate ("All "native" spells are listed in Appendix A", Requesting a Spell (AA)), used by the sha'ir's gen.
Run from the repo root:  python3 tools/build-province-tables.py
"""
import importlib.util
import json
import re

_spec = importlib.util.spec_from_file_location("classdata", "tools/build-class-data.py")
classdata = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(classdata)

PAGE = "Appendix A: Wizard Spells by Province (AA)"
PROVINCES = {"Flame": "flame", "Sand": "sand", "Sea": "sea", "Wind": "wind"}
# Kits that change learning wizard spells (Al-Qadim kits; each pattern must match the kit page):
#  bonus: % to learn a spell of a chosen province; provinces: how many the character chooses (0 = universal only);
#  classes: the rule applies to these classes only; maxLevel: no spells above this level.
KIT_LEARN = {
    "elemental-mage": ("Elemental Mage (Character Kit)", {"bonus": 40, "provinces": 1},
                       r"An elemental mage gains a 40 percent bonus to his or her chance to learn spells within the chosen province\. "
                       r"Spells designated \"universal\" are learned normally.*?Except for universal spells, elemental mages can never gain "
                       r"magics outside their chosen province"),
    "sorcerer": ("Sorcerer (Character Kit)", {"bonus": 20, "provinces": 2},
                 r"Each sorcerer may specialize in two elemental provinces.*?sorcerers gain a 20 percent bonus to their chance to learn "
                 r"spells within the two elemental provinces they have chosen.*?Sorcerers cannot use spells from the two elemental "
                 r"provinces in which they have chosen not to specialize"),
    "barber": ("Barber (Character Kit)", {"provinces": 0, "classes": ["bard"]},
               r"\"Barbering bards\" are limited to spells from the universal province; they may not learn or use elemental magic"),
    "mageweaver": ("Mageweaver (Character Kit)", {"maxLevel": 6}, r"they may never learn to cast spells above the sixth level"),
    "mystic-of-nog": ("Mystic of Nog (Character Kit)", {"maxLevel": 5}, r"No Mystic of Nog may ever learn spells above 5th level"),
}


def plain(wiki):
    """Wiki text without links and bold/italic quotes, whitespace collapsed."""
    text = re.sub(r"\[\[(?:[^|\]]*\|)?([^\]]*)\]\]", r"\1", wiki).replace("'" * 3, "").replace("'" * 2, "")
    return re.sub(r"\s+", " ", text)

if __name__ == "__main__":
    wiki, rev, _ = classdata.page(PAGE)
    levels = re.findall(r"==(\d)(?:st|nd|rd|th)-level Spells==", wiki)
    assert levels == [str(n) for n in range(1, 10)], levels
    out = {}
    native = {}
    heading = None
    level = None
    for line in wiki.split("\n"):
        lv = re.match(r"==(\d)(?:st|nd|rd|th)-level Spells==", line.strip())
        if lv:
            level = int(lv.group(1))
        h = re.match(r"^'''([A-Za-z]+)'''\s*$", line.strip())
        if h:
            heading = h.group(1)
            assert heading in PROVINCES or heading == "Universal", heading
            continue
        if line.startswith("=="):
            heading = None
            continue
        link = re.search(r"\[\[([^|\]]+)(?:\|[^\]]*)?\]\]", line)
        if link and line.startswith(":") and heading and level:
            native.setdefault(link.group(1).strip(), level)
        if link and line.startswith(":") and heading in PROVINCES:
            out.setdefault(link.group(1).strip(), [])
            if PROVINCES[heading] not in out[link.group(1).strip()]:
                out[link.group(1).strip()].append(PROVINCES[heading])
    assert out.get("Lightning Bolt (Wizard Spell)") is None and out.get("Burning Hands (Wizard Spell)") == ["flame"], out.get("Burning Hands (Wizard Spell)")
    assert out.get("Wall of Fog (Wizard Spell)") == ["sea", "wind"], out.get("Wall of Fog (Wizard Spell)")
    counts = {p: sum(p in v for v in out.values()) for p in PROVINCES.values()}
    # Requesting a Spell (AA) examples: burning hands (1st, flame) and legend lore (6th, universal) are native.
    assert native.get("Burning Hands (Wizard Spell)") == 1 and native.get("Legend Lore (Wizard Spell)") == 6, (
        native.get("Burning Hands (Wizard Spell)"), native.get("Legend Lore (Wizard Spell)"))
    assert set(out) <= set(native) and set(native.values()) == set(range(1, 10)), "province spells missing from the native list"

    kit_learn = {}
    kit_revs = {}
    for ident, (title, rule, pattern) in KIT_LEARN.items():
        kw, krev, _ = classdata.page(title)
        assert re.search(pattern, plain(kw)), f"{title}: learning rule changed ({pattern!r})"
        kit_learn[ident] = rule
        kit_revs[title] = krev
    open("module/rules/province-tables.mjs", "w").write("\n".join([
        "/**",
        " * GENERATED by tools/build-province-tables.py - do not edit by hand.",
        f" * {PAGE}: {classdata.url(PAGE)} (revision {rev}).",
        " * Wizard spell page title -> elemental provinces (flame, sand, sea, wind); universal spells are not listed.",
        " */",
        "export const SPELL_PROVINCES = " + json.dumps(dict(sorted(out.items())), ensure_ascii=False) + ";",
        "/** Every spell of the appendix (universal included): page title -> spell level. Native to the Land of Fate. */",
        "export const SPELL_NATIVE = " + json.dumps(dict(sorted(native.items())), ensure_ascii=False) + ";",
        "/**",
        " * Kits that change learning wizard spells (kit identifier -> { bonus: % in a chosen province, provinces: number chosen",
        " * (0 = universal only), classes, maxLevel }):",
        *[f" * {t}: {classdata.url(t)} (revision {r})." for t, r in kit_revs.items()],
        " */",
        "export const KIT_LEARN = " + json.dumps(kit_learn) + ";", ""]))
    print(f"wrote module/rules/province-tables.mjs: {len(out)} province spells {counts}, {len(native)} native spells ({PAGE} rev {rev})")
