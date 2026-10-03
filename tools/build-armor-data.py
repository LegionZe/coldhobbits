#!/usr/bin/env python3
"""Generate armour, shield and helmet Items (packs/_source/armor).

Sources (AD&D 2e fandom wiki, MediaWiki API):
  * Armor List (PHB): item, cost, weight. The "Helmet" and "Shield" rows are headings for the rows after them.
  * Table 46: Armor Class Ratings (Armor (PHB)): AC rating per armour; a "+ shield" entry is one better.
  * Shields (Armor (PHB)): "All shields improve a character's Armor Class by 1 or more against a specified number
    of attacks"; buckler "only one attack per melee round"; small shield "two frontal attacks"; medium shield "any
    frontal or flank attacks"; body shield "by 1 against melee attacks and by 2 against missile attacks".
Run from the repo root (after build-class-data.py, whose helpers it uses):  python3 tools/build-armor-data.py
"""
import importlib.util
import re

_spec = importlib.util.spec_from_file_location("classdata", "tools/build-class-data.py")
classdata = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(classdata)

HEADINGS = {"Helmet": "helmet", "Shield": "shield"}
# Shield rows (names under the "Shield" heading) -> AC improvement vs. melee / missiles, attacks blocked per round
# (None = any frontal or flank attack).
SHIELDS = {"Buckler": (1, 1, 1), "Small": (1, 1, 2), "Medium": (1, 1, None), "Body": (1, 2, None)}


def slug(s):
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")


def armor_list():
    wiki, rev, _ = classdata.page("Armor List (PHB)")
    t = wiki[wiki.index("{|"):wiki.index("|}")]
    rows, heading = [], None
    for chunk in re.split(r"\n\|-", t)[1:]:
        cells = [l[1:].strip() for l in chunk.strip().split("\n") if l.startswith("|") and not l.startswith(("|}", "|+"))]
        if len(cells) != 3:
            continue
        name, cost, weight = cells
        if name in HEADINGS:
            heading = HEADINGS[name]
            continue
        # Helmets are the two rows after "Helmet"; shields the four after "Shield"; everything else is body armour.
        kind = heading if (heading == "helmet" and name in ("Great helm", "Basinet")) or (heading == "shield" and name in SHIELDS) else "body"
        m = re.match(r"([\d.]+)", weight)
        rows.append({"name": name, "kind": kind, "cost": cost, "weight": float(m.group(1)) if m else None})
    return rows, rev


def table46(names):
    """AC per body armour from Table 46; "+ shield" entries must be exactly one better than the armour alone."""
    wiki, rev, _ = classdata.page("Armor (PHB)")
    t = wiki[wiki.index("Table 46"):]
    t = t[:t.index("|}")]
    keys = {re.sub(r"\s*armor$", "", n.lower()): n for n in names}
    alone, shielded = {}, {}
    for chunk in re.split(r"\n\|-", t)[1:]:
        cells = [l[1:].strip() for l in chunk.strip().split("\n") if l.startswith("|")]
        if len(cells) != 2 or not cells[1].isdigit():
            continue
        text, ac = cells[0].lower(), int(cells[1])
        for part in re.split(r",\s*", text):
            with_shield = "+ shield" in part
            part = part.replace("+ shield", "").replace("armor", "").strip()
            for piece in re.split(r"(?:^|\s+)or\s+", part):
                piece = piece.strip()
                # "leather or padded" / "splint mail, banded mail, or bronze plate mail"
                for cand in (piece, piece + " mail"):
                    if cand in keys:
                        (shielded if with_shield else alone).setdefault(keys[cand], ac)
                        break
                else:
                    if piece and piece not in ("none", "shield only", "mail"):
                        raise AssertionError(f"Table 46 entry not in the armour list: {piece!r}")
    # "Leather or padded" names both; "studded leather" and "ring mail" share their row.
    missing = set(names) - set(alone)
    assert not missing, f"no Table 46 AC for {missing}"
    for n, ac in shielded.items():
        assert ac == alone[n] - 1, f"Table 46: {n} + shield {ac} vs alone {alone[n]}"
    return alone, rev


if __name__ == "__main__":
    rows, rev_list = armor_list()
    body = [r["name"] for r in rows if r["kind"] == "body"]
    ac, rev46 = table46(body)
    assert len(body) == 14 and sum(r["kind"] == "shield" for r in rows) == 4 and sum(r["kind"] == "helmet" for r in rows) == 2, rows
    url_list, url_46 = classdata.url("Armor List (PHB)"), classdata.url("Armor (PHB)")
    folders = {k: classdata.folder_doc(f"armor.{k}", label, sort=i * 1000)
               for i, (k, label) in enumerate([("body", "Armour"), ("shield", "Shields"), ("helmet", "Helmets")])}
    docs = list(folders.values())
    img = {"body": "icons/svg/statue.svg", "shield": "icons/svg/shield.svg", "helmet": "icons/svg/shield.svg"}
    for i, r in enumerate(sorted(rows, key=lambda r: r["name"].lower())):
        name = f"{r['name']} shield" if r["kind"] == "shield" and r["name"] != "Buckler" else r["name"]
        melee, missile, attacks = SHIELDS.get(r["name"], (0, 0, None))
        system = {"identifier": slug(name), "kind": r["kind"], "ac": ac.get(r["name"]),
                  "shield": {"melee": melee, "missile": missile, "attacks": attacks},
                  "bonus": 0, "equipped": False, "cost": r["cost"], "weight": r["weight"],
                  "source": "Player's Handbook", "url": url_46 if r["kind"] != "helmet" else url_list, "notes": ""}
        doc = classdata.item_doc("armor", "a." + slug(name), name, img[r["kind"]], system, i * 100)
        doc["folder"] = folders[r["kind"]]["_id"]
        docs.append(doc)
    classdata.write_docs("packs/_source/armor", docs)
    print(f"wrote packs/_source/armor: {len(body)} armour, 4 shields, 2 helmets "
          f"(Armor List rev {rev_list}, Table 46 rev {rev46})", {n: ac[n] for n in body})
