#!/usr/bin/env python3
"""Generate weapon proficiencies and weapon items for the Skills & Powers Table 49 weapons that have no PHB or Al-Qadim
item (Player's Option: Combat & Tactics):

  packs/_source/proficiencies/poct-*.json   folder "Weapon Proficiencies (POCT)"
  packs/_source/weapons/poct-*.json         folder "Weapons (POCT)"

Sources (AD&D 2e fandom wiki, MediaWiki API): Master Weapon List (POCT) (weight, size, type, speed, reach, rate of fire,
range, damage) and Equipment Groups (POCT) (prices, per culture list; every listed price is kept with its culture,
owner's ruling). Conversions to the PHB fields: speed = the number in "Av(7)"; range squares x 5 = yards (a square is 5
yards at missile scale; e.g. hand axe 2/4/6 -> PHB 10/20/30); rate of fire "N/rnd" -> "N/1" ("1"), "1/2 rnd" -> "1/2".
One proficiency per Table 49 name (named as Table 49 names it, so tools/build-sp-weapon-data.py links it to its groups);
one weapon item per master-list row in `TARGETS` (firearms: one per lock type, owner's ruling; the plain "pick" is the
farming tool, owner's ruling). Grip rows (one-handed / two-handed) become damage options; a launcher's single ammunition
row gives its damage (no ammunition items: none are generated). Footnotes kept as notes: two hands regardless of size,
knockdown/explosion dice, set vs. charge, mounted charge, misfire numbers. No weapon descriptions are copied.
Run after build-proficiency-data.py (which rewrites both folders) and before build-sp-weapon-data.py.
"""
import glob
import importlib.util
import json
import os
import re

_spec = importlib.util.spec_from_file_location("classdata", "tools/build-class-data.py")
classdata = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(classdata)

LIST = "Master Weapon List (POCT)"
PRICES = "Equipment Groups (POCT)"
SOURCE = "Player's Option: Combat & Tactics"

# Table 49 name -> master-list rows (one weapon item each). Firearms: every lock type that has the weapon.
TARGETS = {
    "Adze": ["Adze"], "Bill": ["Polearm, Bill"], "Bo stick": ["Bo stick"], "Brandistock": ["Brandistock"], "Chain": ["Chain"],
    "Chijikiri": ["Chijikiri"], "Cho-ku-no": ["Crossbow, Cho-ku-no"], "Claymore": ["Sword, Claymore"], "Drusus": ["Sword, Drusus"],
    "Estoc": ["Sword, Estoc"], "Falchion": ["Sword, Falchion"], "Gladius": ["Sword, Gladius"], "Great club": ["Club, Great"],
    "Hatchet": ["Hatchet"], "Jitte": ["Jitte"], "Katana": ["Sword, Katana"], "Kau sin ke": ["Kau sin ke"], "Kawanaga": ["Kawanaga"],
    "Kusari-gama": ["Kusari-gama"], "Lajatang": ["Polearm, Lajatang"], "Long spear": ["Spear, Long"], "Mace-axe": ["Mace-axe"],
    "Main-gauche": ["Dagger, Main-gauche"], "Maul": ["Maul"], "Nagimaki": ["Polearm, Nagimaki"], "Naginata": ["Polearm, Naginata"],
    "Ninja-to": ["Sword, Ninja-to"], "No-dachi": ["Sword, No-dachi"], "Nunchaku": ["Nunchaku"], "Parrying dagger": ["Dagger, Parrying"],
    "Pellet bow": ["Crossbow, Pellet bow"], "Pick": ["Pick, Farming tool"], "Pilum": ["Pilum"], "Rapier": ["Sword, Rapier"],
    "Sabre": ["Sword, Sabre"], "Sai": ["Sai"], "Sang kauw": ["Sang kauw"], "Sapara": ["Sword, Sapara"], "Sledge": ["Sledge hammer"],
    "Spatha": ["Sword, Spatha"], "Stiletto": ["Dagger, Stiletto"], "Sword-axe": ["Sword, Sword-axe"], "Tetsubo": ["Polearm, Tetsubo"],
    "Three-piece rod": ["Three-piece rod"], "Tulwar": ["Sword, Tulwar"], "Two-handed axe": ["Axe, Two-handed"],
    "Wakizashi": ["Sword, Wakizashi"], "War club": ["Club, War"],
    "Belt pistol": ["Flintlock, Belt Pistol", "Snaplock, Belt Pistol", "Wheellock, Belt pistol"],
    "Caliver": ["Matchlock, Caliver"], "Hand gunne": ["Hand Match, Handgunne"],
    "Horse pistol": ["Flintlock, Horse Pistol", "Snaplock, Horse Pistol", "Wheellock, Horse pistol"],
    "Musket": ["Flintlock, Musket", "Matchlock, Musket w/rest", "Snaplock, Musket"],
}
# Item names for rows whose master-list name is "Group, Weapon" (e.g. "Sword, Katana" -> "Katana").
LOCKS = {"Flintlock": "flintlock", "Snaplock": "snaplock", "Wheellock": "wheellock", "Matchlock": "matchlock", "Hand Match": "hand match"}
CROSSBOWS = {"Cho-ku-no", "Pellet bow"}
T35 = {"Cho-ku-no": "lightCrossbow", "Pellet bow": "lightCrossbow", "Stiletto": "thrownDagger"}
# Footnote letters / numbers (Master Weapon List (POCT)) kept as short notes (paraphrased).
NOTE = {"h": "two hands regardless of size", "k": "knockdown 7+: roll another damage die (repeat on 7+)",
        "c": "double damage set vs. a charge", "m": "double damage in a mounted charge", "s": "martial arts attacks",
        "b": "bone/stone: may break on maximum damage", "3": "misfires on a natural 1", "5": "misfires on 5 or less (10 wet); range penalties doubled",
        "7": "misfires on 3 or less (6 wet)", "9": "misfires on 2 or less"}


def slug(s):
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")


def clean(cell):
    return re.sub(r"<sup>.*?</sup>", "", cell).replace("—", "").strip()


def sups(cell):
    return [x.strip() for m in re.findall(r"<sup>(.*?)</sup>", cell) for x in m.split(",")]


def master_rows(wiki):
    """Rows of the master table: {full name: {indent, notes, cells, children: [names]}} (two levels of headings)."""
    t = wiki[wiki.index("==Master Weapons Table=="):]
    t = t[:t.index("\n|}")]
    rows, order = {}, []
    p0 = p2 = None
    for chunk in re.split(r"\n\|-", t)[1:]:
        cells = [l[1:].strip() for l in chunk.split("\n") if l.startswith("|") and not l.startswith(("|}", "|+"))]
        if not cells:
            continue
        raw = cells[0]
        ind = int(re.search(r"padding-left:\s*(\d)em", raw).group(1)) if "padding-left" in raw else 0
        name = re.sub(r'style="[^"]*"\s*\|\s*', "", raw)
        marks = sups(name)
        name = classdata.link_text(re.sub(r"<sup>.*?</sup>", "", name)).strip()
        if ind == 0:
            p0, p2, full = name, None, name
        elif ind == 2:
            p2, full = name, f"{p0}, {name}"
            rows.setdefault(p0, {"indent": 0, "notes": [], "cells": [], "children": []})["children"].append(full)
        else:
            full = f"{p0}, {p2}, {name}"
            rows[f"{p0}, {p2}"]["children"].append(full)
        prev = rows.get(full, {"children": []})
        rows[full] = {"indent": ind, "notes": marks, "cells": cells[1:], "children": prev["children"]}
        order.append(full)
    return rows


def prices(wiki):
    """Price per lower-cased "group, weapon" name: [(price, culture)] from every culture list."""
    out = {}
    pos = [(m.start(), m.group(1).strip()) for m in re.finditer(r"^==+\s*([^=\n]+?)\s*==+\s*$", wiki, re.M)]
    for m in re.finditer(r"\{\|.*?\n\|\}", wiki, re.S):
        culture = [name for p, name in pos if p < m.start()][-1]
        parent = None
        # A table without indented rows (the firearms list) uses unpriced rows as headings (lock types).
        flat = "padding-left" not in m.group(0)
        for chunk in re.split(r"\n\|-", m.group(0))[1:]:
            cells = [l[1:].strip() for l in chunk.split("\n") if l.startswith("|") and not l.startswith(("|}", "|+"))]
            if len(cells) < 2:
                continue
            ind = "padding-left" in cells[0] or (flat and parent is not None and bool(cells[1]))
            name = classdata.link_text(re.sub(r'style="[^"]*"\s*\|\s*', "", cells[0])).strip()
            if not ind:
                parent = name
            full = (f"{parent}, {name}" if ind else name).lower()
            if cells[1]:
                out.setdefault(full, [])
                if (cells[1], culture) not in out[full]:
                    out[full].append((cells[1], culture))
    return out


def cost_text(cost):
    """"17 gp (Hundred Years' War, Middle Eastern); 30 gp (Dark Ages)": every price with the cultures that list it."""
    by = {}
    for p, c in cost:
        by.setdefault(p.replace("gp/", "gp /"), []).append(c)
    return "; ".join(f"{p} ({', '.join(c)})" for p, c in by.items())


def weight(v):
    v = clean(v)
    if v == "*":
        return 0.1
    if "/" in v:
        a, b = v.split("/")
        return round(int(a) / int(b), 2)
    return float(v) if v else 0


def rof(v):
    v = clean(v)
    m = re.match(r"^(\d+)(?:/(\d+))?\s*/?\s*rn?d?$", v) or re.match(r"^(\d+)/(\d+)\s*rnd?$", v)
    if not v or not m:
        return ""
    a = int(m.group(1))
    b = int(m.group(2)) if m.group(2) else 1
    if re.match(r"^\d+/rnd?$", v):
        return "1" if a == 1 else f"{a}/1"
    return f"{a}/{b}"


def weapon_data(name, row, rows):
    c = row["cells"]
    size, typ, speed = clean(c[1]) or None, clean(c[2]) or None, re.search(r"\((\d+)\)", c[3])
    rng = [int(x) * 5 for x in clean(c[6]).split("/")] if re.match(r"^\d+/\d+/\d+$", clean(c[6])) else None
    damage = []
    if clean(c[7]) or clean(c[8]):
        damage.append({"label": "", "sm": clean(c[7]) or None, "l": clean(c[8]) or None, "speed": None})
    notes = list(row["notes"])
    for child in row["children"]:
        cc = rows[child]["cells"]
        label = child.split(", ")[-1]
        if label in ("One-handed", "Two-handed"):
            damage.append({"label": label, "sm": clean(cc[7]) or None, "l": clean(cc[8]) or None, "speed": None})
        elif not damage:  # a launcher's ammunition row (its damage type is the weapon's)
            damage.append({"label": "", "sm": clean(cc[7]) or None, "l": clean(cc[8]) or None, "speed": None})
            typ = typ or clean(cc[2]) or None
            rng = rng or ([int(x) * 5 for x in clean(cc[6]).split("/")] if re.match(r"^\d+/\d+/\d+$", clean(cc[6])) else None)
    if name.endswith("Cho-ku-no") and not damage:  # "similar to a light crossbow" (Weapon Descriptions (POCT)): light quarrels
        q = rows["Crossbow, Light, Light quarrel"]["cells"]
        damage.append({"label": "", "sm": clean(q[7]), "l": clean(q[8]), "speed": None})
        typ = typ or clean(q[2]) or None
    notes += [n for n in sum((sups(x) for x in c[7:9]), []) if n not in notes]
    melee = bool(clean(c[4]))
    missile = rng is not None
    lock = name.split(", ")[0] if name.split(", ")[0] in LOCKS else None
    if lock:  # the lock type's misfire footnote (numbered; the lettered ones are for other weapons)
        notes += [n for n in rows[lock]["notes"] if n.isdigit() and n not in notes]
    return {
        "size": size, "type": typ, "speed": int(speed.group(1)) if speed else None, "damage": damage, "melee": melee, "missile": missile,
        "range": {"rof": rof(c[5]) if missile else "", "short": str(rng[0]) if rng else "", "medium": str(rng[1]) if rng else "",
                  "long": str(rng[2]) if rng else ""},
        "family": "crossbow" if name.split(", ")[-1] in ("Cho-ku-no", "Pellet bow") else "other",
        "missileColumn": "", "strength": "full",
    }, notes, lock


if __name__ == "__main__":
    wiki, rev, _ = classdata.page(LIST)
    pwiki, prev, _ = classdata.page(PRICES)
    rows = master_rows(wiki)
    price = prices(pwiki)
    for t, names in TARGETS.items():
        for n in names:
            assert n in rows and rows[n]["cells"], f"{t}: row {n} not in {LIST}"
    # Spot checks against the list (conversion rules above).
    w, _, _ = weapon_data("Axe, Hand/throwing", rows["Axe, Hand/throwing"], rows)
    assert w["range"] == {"rof": "1", "short": "10", "medium": "20", "long": "30"} and w["speed"] == 4, w
    w, _, _ = weapon_data("Sword, Katana", rows["Sword, Katana"], rows)
    assert [d["label"] for d in w["damage"]] == ["One-handed", "Two-handed"] and w["damage"][1]["sm"] == "2d6", w
    existing = {json.load(open(f))["system"]["identifier"] for f in glob.glob("packs/_source/proficiencies/*.json")
                if not os.path.basename(f).startswith(("_folder", "poct-"))}
    prof_folder = classdata.folder_doc("profs.weapon.poct", "Weapon Proficiencies (POCT)", sort=2000)
    weap_folder = classdata.folder_doc("weapons.poct", "Weapons (POCT)", sort=3000)
    profs, items, unpriced = [], [], []
    for n, (t, names) in enumerate(sorted(TARGETS.items())):
        ident = slug(t)
        assert ident not in existing, f"{t}: identifier {ident} already exists"
        first = None
        for k, row_name in enumerate(names):
            row = rows[row_name]
            w, notes, lock = weapon_data(row_name, row, rows)
            if t in CROSSBOWS:
                w["missileColumn"], w["strength"] = T35[t], "none"
            elif w["missile"]:
                w["missileColumn"] = T35.get(t, "otherMissile")
                w["strength"] = "none" if lock else "full"
            first = first or w
            label = f"{t} ({LOCKS[lock]})" if lock else t
            cost = price.get(row_name.lower()) or price.get(row_name.split(", ")[-1].lower()) or price.get(t.lower()) or []
            if not cost:  # listed under another heading ("Polearm, Sai", "Dagger, Parrying dagger")
                own = {row_name.split(", ")[-1].lower(), t.lower()}
                cost = next((v for k, v in price.items() if k.split(", ")[-1] in own), [])
            if not cost:
                unpriced.append(row_name)
            note = "; ".join(dict.fromkeys(NOTE[x] for x in notes if x in NOTE))
            doc = classdata.item_doc("weapon", f"poct-{slug(label)}", label, "icons/svg/sword.svg", {
                "identifier": slug(label), "proficiency": ident, "weapon": w,
                "cost": cost_text(cost), "weight": weight(row["cells"][0]), "quantity": 1, "equipped": False,
                "bonus": {"hit": 0, "dmg": 0}, "source": SOURCE, "url": classdata.url(LIST), "notes": note}, n * 100 + k)
            doc["folder"] = weap_folder["_id"]
            items.append(doc)
        doc = classdata.item_doc("proficiency", f"poct-{ident}", t, "icons/svg/sword.svg", {
            "identifier": ident, "kind": "weapon", "slots": 1, "ability": None, "modifier": None, "groups": [],
            "sp": {"ability": "", "rating": None, "cost": None}, "weapon": first, "source": SOURCE, "url": classdata.url(LIST),
            "notes": ""}, n * 100)
        doc["folder"] = prof_folder["_id"]
        profs.append(doc)
    for folder, docs, fd in (("packs/_source/proficiencies", profs, prof_folder), ("packs/_source/weapons", items, weap_folder)):
        for f in glob.glob(f"{folder}/poct-*.json"):
            os.remove(f)
        with open(f"{folder}/_folder-{fd['_id']}.json", "w") as f:
            json.dump(fd, f, indent=2, ensure_ascii=False)
            f.write("\n")
        for d in docs:
            with open(f"{folder}/poct-{d['system']['identifier']}.json", "w") as f:
                json.dump(d, f, indent=2, ensure_ascii=False)
                f.write("\n")
    print(f"wrote {len(profs)} proficiencies and {len(items)} weapons ({LIST} rev {rev}, {PRICES} rev {prev})")
    print("no price found:", ", ".join(unpriced) or "none")
