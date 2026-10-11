#!/usr/bin/env python3
"""Generate module/rules/calendar-tables.mjs: the Zakharan (Al-Qadim) calendar (module/calendar.mjs, world setting
`zakharanCalendar`, owner's request 1.0.43).

Sources (MediaWiki API):
  - AD&D 2e fandom wiki "Astrologer - Sha'ir (Character Kit)" (The Complete Sha'ir's Handbook): "a list of the months of
    the Zakharan calendar and the constellations that are completely visible during each month" (table parsed: month
    order and constellations).
  - Forgotten Realms wiki "Zakharan calendar" (cites the Corsairs of the Great Sea cards): "360 days in its year plus five
    High Holy Days", "twelve 30-day months", "The five High Holy Days followed the month of Qawafil and preceded the month
    of Safa" and the five names (regex-checked; the month order is asserted against the Astrologer table).
  - Forgotten Realms wiki "Zakharan holidays" (cites City of Delights, Golden Huzuz pp. 18-19): holiday dates (regex per
    holiday; only the name and date are kept, the holidays of Golden Huzuz).
  - Travel seasons (owner's request 1.0.45): the "Zakharan calendar" page pairs each month with a Harptos month ("; Taraq :
    [[Hammer (month)|Hammer]]" ...), and Forgotten Realms wiki "Calendar of Harptos" (cites the Forgotten Realms Campaign
    Setting 3rd edition p. 77) dates "Spring Equinox on Ches 19", "Summer Solstice on Kythorn 20", "Autumn Equinox on
    Eleint 21", "Winter Solstice on Nightal 20": each season starts on the paired Zakharan month's day (regex-checked).
Not in the sources (implementation choices, module/calendar.mjs): no leap day, years counted from 0 (the GM sets the
year), a ten-day cycle of numbered weekdays (Foundry's calendar needs weekdays; none are named in the sources).
Run from the repo root:  python3 tools/build-calendar-tables.py
"""
import importlib.util
import json
import re
import urllib.parse
import urllib.request

_spec = importlib.util.spec_from_file_location("classdata", "tools/build-class-data.py")
classdata = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(classdata)
_tspec = importlib.util.spec_from_file_location("travel", "tools/build-travel-tables.py")
travel = importlib.util.module_from_spec(_tspec)
_tspec.loader.exec_module(travel)
need = travel.need

ASTRO = "Astrologer - Sha'ir (Character Kit)"
FR_API = "https://forgottenrealms.fandom.com/api.php"
FR_WIKI = "https://forgottenrealms.fandom.com/wiki/"
CAL = "Zakharan calendar"
HOL = "Zakharan holidays"
HARPTOS = "Calendar of Harptos"
# Travel season (module/travel.mjs SEASONS) -> the Harptos page's day that starts it.
SEASON_DAYS = {"spring": "Spring Equinox", "summer": "Summer Solstice", "fall": "Autumn Equinox", "winter": "Winter Solstice"}
WORDS = {"five": 5, "twelve": 12}
# Holiday key -> (regex on the holidays page, month or "holy", day; "last" = the month's last day).
HOLIDAYS = {
    "founders": (r"Founder's Day''' : Occurring on 10 \[\[Taraq\]\]", "Taraq", 10),
    "fates": (r"Fate's Day''' : The last day of \[\[Masta\]\]", "Masta", "last"),
    "ancestors": (r"Feast of the Ancestors''' : On the 25th of \[\[Magarib\]\]", "Magarib", 25),
    "harim": (r"First day of \[\[Gammam\]\]''' : The women of the \[\[Royal Harim of Huzuz\]\] were honored", "Gammam", 1),
    "love": (r"Day of Love''' : The 25th of \[\[Mihla\]\]", "Mihla", 25),
    "ajami": (r"'''6 \[\[Qawafil\]\]''' or '''Ajami Day'''", "Qawafil", 6),
    "caliph": (r"'''27 \[\[Dar\]\]''' : This date was the \[\[Khalil al-Assad al-Zahir\|current Grand Caliph's\]\] birthday", "Dar", 27),
    "genies": (r"Genies' Day''' : Celebrated on the 12th of \[\[Nau\]\]", "Nau", 12),
    "wizards": (r"Wizard's Day''' : The last day of \[\[Saris\]\]", "Saris", "last"),
    "ascension": (r"Yasad was also '''Ascension Day'''", "holy", 5),
}


def fr_page(title):
    req = urllib.request.Request(FR_API + "?" + urllib.parse.urlencode(
        {"action": "parse", "page": title, "prop": "wikitext|revid", "redirects": 1, "format": "json"}), headers=classdata.UA)
    with urllib.request.urlopen(req) as r:
        p = json.load(r)["parse"]
    return p["wikitext"]["*"], p["revid"]


def fr_url(title):
    return FR_WIKI + urllib.parse.quote(title.replace(" ", "_"), safe="()/'")


def astrologer_months(wiki):
    t = wiki[wiki.index("months of the Zakharan calendar"):]
    t = t[t.index("{|"):t.index("|}")]
    rows = []
    for block in t.split("|-")[1:]:
        m = re.search(r"^\|\s*([A-Z][a-z]+)\s*\|\|\s*(.+?)\s*$", block.strip(), re.M)
        if m:
            rows.append((m.group(1), [c.strip() for c in m.group(2).split(",")]))
    return rows


def main():
    w, rev, _ = classdata.page(ASTRO)
    rows = astrologer_months(w)
    assert len(rows) == 12, rows
    names = [r[0] for r in rows]
    cw, crev = fr_page(CAL)
    ct = re.sub(r"\s+", " ", cw)
    year = need(ct, r"had (\d+) days in its year plus (\w+) High Holy Days", "days in the year")
    months = need(ct, r"Each year had (\w+) (\d+)-day months", "months")
    need(ct, r"The five High Holy Days followed the month of Qawafil and preceded the month of Safa each year", "holy days place")
    holy = need(ct, r"; Ahad, Atnen, Salas, Arba, Yasad \(also called Ascension Day\) : High Holy Days", "holy day names")
    listed = re.findall(r"^; (\w+) : \[\[", cw, re.M)
    assert listed == names, (listed, names)
    per, n = int(months.group(2)), WORDS[months.group(1)]
    holyDays = WORDS[year.group(2)]
    assert int(year.group(1)) == per * n == 360 and holyDays == 5, (year.groups(), months.groups())
    hw, hrev = fr_page(HOL)
    ht = re.sub(r"\s+", " ", hw)
    need(ht, r"The five High Holy Days—'''Ahad''', '''Atnen''', '''Salas''', '''Arba''', and '''Yasad'''—occurred between the months of Qawafil and \[\[Safa\]\]", "holy days (holidays page)")
    holidays = []
    for key, (pattern, month, day) in HOLIDAYS.items():
        need(ht, pattern, key)
        holidays.append({"key": key, "month": month, "day": per if day == "last" else day})
    pairs = dict(re.findall(r"^; (\w+) : \[\[(?:[^|\]]*\|)?(\w+)\]\]", cw, re.M))
    assert list(pairs) == names, pairs
    to_zakhara = {v: k for k, v in pairs.items()}
    pw, prev = fr_page(HARPTOS)
    seasons = []
    for key, label in SEASON_DAYS.items():
        m = need(pw, r"\[\[" + label + r"\]\] on \[\[(\w+) (\d+)\]\]", label)
        seasons.append({"key": key, "month": to_zakhara[m.group(1)], "day": int(m.group(2)), "harptos": f"{m.group(1)} {m.group(2)}"})
    assert [(x["month"], x["day"]) for x in seasons] == [("Magarib", 19), ("Qawafil", 20), ("Riyah", 21), ("Saris", 20)], seasons
    data = {
        "months": [{"key": name.lower(), "name": name, "days": per, "constellations": stars} for name, stars in rows],
        "holy": {"after": "Qawafil", "days": ["Ahad", "Atnen", "Salas", "Arba", "Yasad"]},
        "daysPerYear": per * n + holyDays, "holidays": holidays, "seasons": seasons, "harptos": pairs,
        "urls": {"astrologer": classdata.url(ASTRO), "calendar": fr_url(CAL), "holidays": fr_url(HOL), "harptos": fr_url(HARPTOS)},
    }
    assert holy and data["daysPerYear"] == 365
    with open("module/rules/calendar-tables.mjs", "w") as f:
        f.write("// GENERATED by tools/build-calendar-tables.py from the AD&D 2e and Forgotten Realms fandom wikis (MediaWiki API): do not edit.\n")
        f.write(f"// Sources: {ASTRO} rev {rev} (months, constellations); {CAL} rev {crev} (Corsairs of the Great Sea cards); "
                f"{HOL} rev {hrev} (City of Delights pp. 18-19); {HARPTOS} rev {prev} (FRCS 3e p. 77: seasons).\n")
        f.write(f"export const CALENDAR_TABLES = {json.dumps(data, ensure_ascii=False)};\n")
    print(names, data["daysPerYear"], [h["key"] for h in holidays])


if __name__ == "__main__":
    main()
