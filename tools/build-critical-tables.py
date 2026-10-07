#!/usr/bin/env python3
"""Generate module/rules/critical-tables.mjs: Combat & Tactics critical hits (Systems I and II).

Sources (AD&D 2e fandom wiki, MediaWiki API), each rule regex-checked:
  - "Critical Hits: System I (POCT)": a natural 18 or higher that hits by 5 or more; double damage dice before Strength,
    magic or special adjustments; damage already doubled for another reason is added, not doubled again (the lance: 3d6).
  - "Critical Hits: System II (POCT)": the same trigger; a saving throw vs. death avoids the specific injury; three weapon
    types x three target types (humanoids, animals, monsters: "If in doubt ... call it a monster"); location d10, d6 for
    low attacks (a creature two sizes larger), 1d6+4 for high attacks (two sizes smaller); a called shot hit uses the
    location aimed at; severity by weapon size vs. target size (smaller 1d6, equal 2d4, larger 2d6, two sizes larger 2d8);
    13+ = triple damage dice even when the save succeeds; arrows and bolts count as size M, heavy crossbow bolts L.
  - "Critical Hit Tables (POCT)": the nine Hit Location Charts (roll ranges and location names only). The injury
    effects are not copied (no rulebook text): the chat card links to the chart section.
Run from the repo root:  python3 tools/build-critical-tables.py
"""
import importlib.util
import json
import re

_spec = importlib.util.spec_from_file_location("classdata", "tools/build-class-data.py")
classdata = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(classdata)

TYPES = {"Bludgeoning": "B", "Slashing": "S", "Piercing": "P"}
TARGETS = {"Humanoids": "humanoid", "Animals": "animal", "Monsters": "monster"}


def need(text, pattern, what):
    assert re.search(pattern, text), f"rule changed: {what}"


def flat(title):
    w, rev, _ = classdata.page(title)
    return re.sub(r"\s+", " ", w), w, rev


def charts():
    w, rev, _ = classdata.page("Critical Hit Tables (POCT)")
    out = {}
    for m in re.finditer(r"==(Bludgeoning|Slashing|Piercing) vs\. (Humanoids|Animals|Monsters)==\n(.*?)(?=\n==[A-Z]|\Z)", w, re.S):
        body = m.group(3)
        t = body[body.index("Hit Location Chart"):]
        t = t[:t.index("\n|}")]
        locs = []
        for chunk in re.split(r"\n\|-", t)[1:]:
            cells = [c.lstrip("|").strip() for c in chunk.strip().split("\n") if c.startswith("|")]
            if len(cells) != 2:
                continue
            r = re.fullmatch(r"(\d+)(?:[–-](\d+))?", cells[0])
            assert r, cells
            locs.append({"min": int(r.group(1)), "max": int(r.group(2) or r.group(1)), "label": cells[1]})
        assert locs[0]["min"] == 1 and locs[-1]["max"] == 10, (m.group(0)[:40], locs)
        for a, b in zip(locs, locs[1:]):
            assert b["min"] == a["max"] + 1, locs
        key = f"{TYPES[m.group(1)]}-{TARGETS[m.group(2)]}"
        out[key] = {"title": f"{m.group(1)} vs. {m.group(2)}", "locations": locs,
                    "url": classdata.url("Critical Hit Tables (POCT)") + "#" + f"{m.group(1)}_vs._{m.group(2)}"}
    assert len(out) == 9, sorted(out)
    assert out["B-humanoid"]["locations"][-1]["label"] == "Head"
    return out, rev


def build():
    f1, _, rev1 = flat("Critical Hits: System I (POCT)")
    need(f1, r"natural 18 or higher ''and'' hits the target by a margin of 5 or more", "trigger")
    need(f1, r"inflicts double damage dice, calculated before adjustments for Strength, magic, or special circumstances", "double dice")
    need(f1, r"do not double the multiplied damage; add it instead", "already doubled")
    need(f1, r"the lance inflicts 3d6 damage, not 4d6", "lance example")
    f2, w2, rev2 = flat("Critical Hits: System II (POCT)")
    need(f2, r"if the victim fails a saving throw vs\. death, a specific injury occurs", "save vs. death")
    need(f2, r"If in doubt over whether something is a monster or not, call it a monster", "default monster")
    need(f2, r"If a weapon does not have a type, it cannot roll on a critical hit chart, although it can still inflict double damage", "no type")
    need(f2, r"the location die is ignored", "called shot")
    need(f2, r"fighting a creature two sizes larger .{0,60}use a single d6 for location", "low attacks")
    need(f2, r"two sizes larger than the defender, .{0,60}roll 1d6\+4", "high attacks")
    sev = re.findall(r"\|Weapon (size is < target size|size is = target size|size is > target size|is two sizes larger)\n\|(\w+)\n\|(\d+d\d+)", w2)
    assert [s[1] for s in sev] == ["Minor", "Major", "Severe", "Mortal"], sev
    need(f2, r"it is possible to reach the 13\+ column of the chart\. These hits inflict ''triple'' damage dice, even if the victim passes", "13+ triple")
    need(f2, r"arrows and bolts fired from bows and crossbows are considered size M weapons.{0,60}Heavy crossbow bolts are considered size L", "missile sizes")
    tables, rev3 = charts()
    return {
        "natural": 18, "margin": 5, "tripleAt": 13,
        "severity": {"smaller": sev[0][2], "equal": sev[1][2], "larger": sev[2][2], "twoLarger": sev[3][2]},
        "location": {"normal": "1d10", "low": "1d6", "high": "1d6+4"},
        "charts": tables, "sizes": ["T", "S", "M", "L", "H", "G"],
        "url1": classdata.url("Critical Hits: System I (POCT)"), "url2": classdata.url("Critical Hits: System II (POCT)"),
        "injuriesUrl": classdata.url("Specific Injuries (POCT)")
    }, (rev1, rev2, rev3)


if __name__ == "__main__":
    data, revs = build()
    with open("module/rules/critical-tables.mjs", "w") as f:
        f.write("// GENERATED by tools/build-critical-tables.py from the AD&D 2e fandom wiki (MediaWiki API): do not edit.\n")
        f.write(f"// Sources: Critical Hits: System I (POCT) rev {revs[0]}, System II (POCT) rev {revs[1]}, Critical Hit Tables (POCT) rev {revs[2]}"
                " (location names only; injury effects are linked, not copied).\n")
        f.write(f"export const CRITICALS = {json.dumps(data, ensure_ascii=False)};\n")
    print({k: [l["label"] for l in v["locations"]] for k, v in list(data["charts"].items())[:2]}, data["severity"])
