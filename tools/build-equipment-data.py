#!/usr/bin/env python3
"""Generate equipment Items (packs/_source/equipment): currently the five PHB coins.

Sources: Table 42: Standard Exchange Rates ("Money and Equipment (PHB)") for each coin's value in copper pieces;
coin weight ("Treasure Tables (DMG)": 50 coins of any metal to the pound) is applied by the system, not stored.
Both are parsed by build-movement-tables.py (build_coins). Run from the repo root:  python3 tools/build-equipment-data.py
"""
import importlib.util

_spec = importlib.util.spec_from_file_location("classdata", "tools/build-class-data.py")
classdata = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(classdata)
_mspec = importlib.util.spec_from_file_location("movement", "tools/build-movement-tables.py")
movement = importlib.util.module_from_spec(_mspec)
_mspec.loader.exec_module(movement)

# Foundry core icons (the same paths dnd5e uses in json/icon-migration.json and its packs).
ICONS = {"pp": "coins-assorted-mix-platinum", "gp": "coins-plain-stack-gold", "ep": "coin-plain-gold",
         "sp": "coins-assorted-mix-silver", "cp": "coins-assorted-mix-copper"}
NAMES = {"pp": "Platinum piece", "gp": "Gold piece", "ep": "Electrum piece", "sp": "Silver piece", "cp": "Copper piece"}

if __name__ == "__main__":
    values, per_pound, rev42, _ = movement.build_coins()
    folder = classdata.folder_doc("equipment.coins", "Coins", sort=0)
    docs = [folder]
    for i, key in enumerate(["pp", "gp", "ep", "sp", "cp"]):
        system = {"identifier": key, "denomination": key, "value": values[key], "quantity": 1,
                  "source": "Player's Handbook", "url": classdata.url("Money and Equipment (PHB)"), "notes": ""}
        doc = classdata.item_doc("coin", "c." + key, NAMES[key], f"icons/commodities/currency/{ICONS[key]}.webp",
                                 system, i * 100)
        doc["folder"] = folder["_id"]
        docs.append(doc)
    classdata.write_docs("packs/_source/equipment", docs)
    print(f"wrote packs/_source/equipment: 5 coins (Table 42 rev {rev42}):", values)
