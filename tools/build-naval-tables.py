#!/usr/bin/env python3
"""Generate module/rules/naval-tables.mjs: ships, nautical travel and detailed naval combat from Of Ships and the Sea
(DMGR9, "OSS"; owner's request 1.0.80).

Sources (AD&D 2e fandom wiki, MediaWiki API), every table parsed and every rule used regex-checked:
  - "Ship Particulars (OSS)": Table 1 (draft, length, beam, cost, building time; variable-length footnotes) and Table 2
    (movement, seaworthiness, pursuit, maneuverability, size, crew max/average/minimum, passengers, cargo).
  - "Movement (OSS)": rowing (2 x rate miles a day; 1d20 12+ with +3 for a Seamanship check: +1/3 rate for 5 rounds,
    3 turns at most, rest twice as long at 1/3 rate; daily push +1/3 then 12 hours' rest), small craft (hours = Con / 2
    rounded up, Con check per extra hour, -1 Con per extra hour, Strength check every 5 rounds for +1/3), sailing (Table 3
    wind and course; x3 a day sailing through the night, x2 anchoring; +1/3 for 10 minutes), Table 4 (wind strength,
    next-day dice for 1d4 days), gales (seaworthiness check daily, blown off course an equal distance, Seamanship -1/3;
    into the gale: backwards 1/3, Seamanship 0) and storms (-3, no Seamanship), Table 5 (wind direction, 1d4 days).
  - "Shipwrecks (OSS)": seaworthiness checks (d20 above the rating fails), foundering (1d10 hours; storm 20 capsizes:
    save vs. death), grounding (soft: refloat in 1d6 days, -3 until repaired; rocky: 1d3 hours; 20 splinters).
  - "Vision (OSS)": Table 6 and its size/height/terrain multipliers.
  - "Encounter Tables (OSS)": checks per day and chances, Tables 7-10 (d8 + d12), encounter distance.
  - Chapter 4: "Time in Nautical Combat (OSS)" Table 11; "The Maneuvering Phase (OSS)" Tables 12-14, personnel, rower
    endurance; "Action Phase (OSS)" Tables 15-27; "Resolution Phase (OSS)" Tables 28-33, foundering, repairs, escape,
    casualties; "Monsters in Naval Combat (OSS)" Tables 34-37; "Scuttling and Crippling (OSS)"; "Fleet Battles (OSS)"
    Table 38 (combat statistics, the figures naval combat uses).
Zakharan ships (owner's request 1.0.83; Golden Voyages' ship figures are not on the wiki, so the owner chose the Arabian
Adventures ones): "Equipment Descriptions (AA)" (barijah, sambuk, zaruq, dunij and qarib launches: length, beam, crew,
passengers, cargo, DMG base/emergency rates, seaworthiness % in sight of land / open water), "Equipment Lists (AA)" (A/N/B
prices; N is used), "Movement on Water (DMG)" (Table 76 riverboats in feet per round, Table 77 ship rates and seaworthiness
%). Converted to the OSS figures (see `aa_ships`): sailing rate = DMG base move x 3 (asserted for the caravel and cog, the
OSS sail-only ships Table 77 lists); seaworthiness rating = least-squares line of OSS Table 2 ratings on Table 77
percentages over the eight ships both list, rounded (30% lies below the fitted range); the launches' 60 feet per round is
Table 76's barge and raft speed, OSS rate 3; the figures neither book gives come from a template OSS ship (sohar for the
dhows: the OSS "Arabian" merchant ship; skiff for the launches) with hull, crippling and marines scaled by length, beam
from the sambuk's beam/length; pursuit is 1d6 + a third of the rate (the OSS rule).
No rulebook text is copied: tables hold numbers and short labels; the effects are paraphrased in lang/en.json.
Run from the repo root:  python3 tools/build-naval-tables.py
"""
import importlib.util
import json
import re

_spec = importlib.util.spec_from_file_location("classdata", "tools/build-class-data.py")
classdata = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(classdata)


def plain(text):
    """Wikitext without links, bold/italic quotes and frac templates, whitespace collapsed (for the rule checks)."""
    t = re.sub(r"\[\[(?:[^|\]]*\|)?([^\]]*)\]\]", r"\1", text)
    t = re.sub(r"\{\{[Ff]rac\|(\d+)\|(\d+)\}\}", r"\1/\2", t)
    t = t.replace("'''", "").replace("''", "")
    return re.sub(r"\s+", " ", t)


def need(text, pattern, what):
    m = re.search(pattern, plain(text))
    assert m, f"rule changed: {what}"
    return m


def clean(cell):
    c = re.sub(r"<sup>.*?</sup>", "", cell)
    c = re.sub(r"\{\{[Ff]rac\|(\d+)\|(\d+)\}\}", r"\1/\2", c)
    c = re.sub(r"\{\{br\}\}", " ", c).replace("&nbsp;", " ")
    c = re.sub(r"\[\[(?:[^|\]]*\|)?([^\]]*)\]\]", r"\1", c)
    c = re.sub(r"'''|''", "", c)
    return c.strip()


def table(wiki, title):
    """Rows (lists of cells) of the table that follows `title`; header rows ("!") are skipped."""
    # The caption ("|+ <h4>Table N: ...") when there is one: prose often names the table before it.
    m = re.search(r"\|\+[^\n]*" + re.escape(title), wiki)
    i = m.start() if m else wiki.index(title)
    start = wiki.rindex("{|", 0, i) if m else wiki.index("{|", i)
    end = wiki.index("\n|}", start)
    rows = []
    for chunk in re.split(r"\n\|-", wiki[start:end]):
        cells = []
        for line in chunk.split("\n"):
            if line.startswith("|") and not line.startswith(("|}", "|+", "|-")):
                cells += [clean(c) for c in line[1:].split("||")]
        cells = [c for c in cells]
        if cells and any(cells):
            rows.append(cells)
    return rows


def slug(label):
    return re.sub(r"[^a-z0-9]+", "-", label.lower()).strip("-")


def camel(label):
    parts = re.findall(r"[a-z0-9]+", label.lower())
    return parts[0] + "".join(p.title() for p in parts[1:])


def dice(text):
    """"1d6+4" -> { n, die, plus }."""
    m = re.fullmatch(r"(\d+)d(\d+)(?:\+(\d+))?", text.strip())
    assert m, f"dice: {text}"
    return {"n": int(m[1]), "die": int(m[2]), "plus": int(m[3] or 0)}


def rng(text):
    """"4-5" / "12+" / "3" / "1 or less" / "20 or more" / "-5 or better" -> [lo, hi] (None = open)."""
    t = text.strip().replace("–", "-").replace(" ", "")
    if m := re.fullmatch(r"(-?\d+)(?:orless)", t):
        return [None, int(m[1])]
    if m := re.fullmatch(r"(-?\d+)(?:ormore|\+|orbetter)", t):
        return [int(m[1]), None]
    if m := re.fullmatch(r"(-?\d+)to(-?\d+)", t):
        a, b = int(m[1]), int(m[2])
        return [min(a, b), max(a, b)]
    if m := re.fullmatch(r"(-?\d+)-(-?\d+)", t):
        a, b = int(m[1]), int(m[2])
        return [min(a, b), max(a, b)]
    return [int(t), int(t)]


def rate3(text):
    """"18/6/12" -> both/sail/oar; a single number -> that number for its one propulsion."""
    parts = [int(x) for x in text.split("/")]
    return parts


def frac(text):
    """"-1/3", "+ 2/3", "2/3", "Double", "NM", "—" -> multiplier added to the base rate (NM = None: no movement)."""
    t = text.replace(" ", "")
    if t in ("—", "-", ""):
        return 0
    if t == "Double":
        return 1
    if t == "NM":
        return None
    m = re.fullmatch(r"([+-]?)(\d+)/(\d+)", t)
    assert m, f"wind modifier: {text}"
    v = int(m[2]) / int(m[3])
    return -v if m[1] == "-" else v


SIZE = {"S": "small", "M": "medium", "L": "large", "VL": "veryLarge"}
SIZE_ORDER = ["small", "medium", "large", "veryLarge"]
SIZE_WORD = {"Small": "small", "Medium": "medium", "Large": "large", "Very Large": "veryLarge"}

# Single-rate ships (Table 2 shows one movement figure): the means of propulsion. From the ship descriptions where they say
# it ("Coasters/Seafarers/Inlanders (OSS)": the cargo ship's and cog's sails, the barge paddled or poled, the raft with the
# current); the others are implementation choices (canoe, skiff and keelboat rowed or paddled; caravel, sohar, fishing boat
# and manta sailed).
PROPULSION = {"barge": "oar", "canoe": "oar", "caravel": "sail", "cargo-ship": "sail", "cog": "sail", "fishing-boat": "sail",
              "keelboat": "oar", "manta": "sail", "raft": "oar", "skiff": "oar", "sohar": "sail"}
PROPULSION_CHECKS = {"cargo-ship": r"two masts and triangular sails", "cog": r"single mast supporting a square sail",
                     "barge": r"paddle or pole the craft", "raft": r"travel with the current"}
# Variable-length ships (footnotes to Tables 1, 2 and 38): per step of feet above (or below) the standard length.
VARIABLE = {
    "barge": {"step": 10, "beam": 5, "cost": 25, "buildDays": 1, "cargoTons": 4, "crew": 2, "passengers": 1, "marines": 1, "hull": 1},
    "canoe": {"step": 5, "cost": 10, "buildDays": 1, "cargoLb": 50, "crew": 1},
    "outrigger": {"step": 10, "beam": 4, "cost": 25, "buildDays": 2, "cargoLb": 100, "crew": 2, "hull": 1, "seaworthinessBelow": 1},
    "raft": {"step": 10, "beam": 10, "cost": 10, "buildDays": 1, "cargoTons": 3, "crew": 1}
}


def ships_tables():
    w, rev, _ = classdata.page("Ship Particulars (OSS)")
    p = re.sub(r"\s+", " ", w)
    need(p, r"Increase the vessel's beam by 5 feet, its cost by 25 gp, and its building time by 1 day for every 10 feet of the barge above the standard length", "barge")
    need(p, r"Increase the vessel's cost by 10 gp and its building time by 1 day for every 5 feet of the canoe above the standard length", "canoe")
    need(p, r"Increase the vessel's beam by 4 feet, its cost by 25 gp, and its building time by 2 days for every 10 feet of outrigger", "outrigger")
    need(p, r"Increase the vessel's beam by 10 feet, its cost by 10 gp, and its building time by 1 day for every 10 feet of the raft", "raft")
    need(p, r"Increase cargo capacity by 4 tons, crew capacity by 2, and passenger capacity by 1 for every 10 feet", "barge cargo")
    need(p, r"Increase cargo capacity by 50 pounds and crew capacity by 1 person for every 5 feet", "canoe cargo")
    need(p, r"Increase cargo capacity by 100 pounds and crew capacity by 2 people for every 10 feet", "outrigger cargo")
    need(p, r"decrease the vessel's seaworthiness rating by 1 point for every 10 feet below the standard length", "outrigger seaworthiness")
    need(p, r"Increase the vessel's cargo capacity by 3 tons and its crew capacity by one person for every 10 feet of the raft", "raft cargo")
    need(p, r"A vessel's pursuit rating is equal to 1d6 plus one third of its current movment rating", "pursuit")
    need(p, r"Small equals 5–19 feet long, Medium equals 20–59 feet long, Large equals 60–100 feet long, and Very Large equals 100\+ feet long", "sizes")
    need(p, r"ships manned by skeleton crews cannot attempt to increase their movement rate", "skeleton speed")
    need(p, r"such ships move at only two thirds of their normal movement rates", "skeleton 2/3")
    need(p, r"ships with skeleton crews suffer a -2 penalty on all Seaworthiness checks and a -2 penalty to maneuverability and pursuit dice rolls", "skeleton -2")
    need(p, r"a skeleton crew can avoid the movement rate reduction and the Seaworthiness penalty by making a successful morale check", "skeleton morale")
    need(p, r"their morale rating drops by one regardless of the attempt's success or failure", "skeleton morale -1")
    need(p, r"A crew's morale improves one point per full day of rest", "morale rest")
    need(p, r"If a ship's crew ever falls below the minimum required, the ship's movement rating falls to 3", "below minimum 3")
    need(p, r"The ship's maneuverability rating falls to 1d4, and the ship cannot attempt to ram, board, or evade", "below minimum 1d4")
    need(p, r"ships can substitute one passenger for every 1 ton of reduction", "passenger per ton")
    need(p, r"one officer per 10 sailors or 20 rowers", "officers")
    described = " ".join(re.sub(r"\s+", " ", classdata.page(t)[0]) for t in ("Coasters (OSS)", "Seafarers (OSS)", "Inlanders (OSS)"))
    for key, pat in PROPULSION_CHECKS.items():
        need(described, pat, f"{key} propulsion")
    t1 = {}
    for name, draft, length, beam, cost, build in table(w, "Table 1: Ships"):
        name = name.rstrip("*").strip()
        ft = lambda s: float(re.sub(r"\s*(feet|foot)$", "", s).replace("1/2", ".5").replace(" .5", ".5"))
        t1[slug(name)] = {"label": name, "draft": ft(draft), "length": int(ft(length)), "beam": int(ft(beam)),
                          "cost": int(cost.replace(",", "").replace(" gp", "")), "build": build}
    assert len(t1) == 20 and t1["dromond"]["length"] == 175 and t1["canoe"]["draft"] == 0.5 and t1["cog"]["draft"] == 4.5
    t2 = {}
    for name, move, sea, pursuit, manv, size, crew, pas, cargo in table(w, "Table 2: Ship Characteristics=="):
        key = slug(name.rstrip("*").strip())
        mv = rate3(move)
        mn = [dice(x) for x in manv.split("/")]
        cr = [int(x) for x in crew.split("/")]
        sizes = [SIZE[s] for s in size.split("-")]
        cargo_t = cargo.replace(",", "")
        if m := re.fullmatch(r"(\d+) tons", cargo_t):
            cg = {"tons": int(m[1])}
        elif m := re.fullmatch(r"(\d+) (pounds|lbs)", cargo_t):
            cg = {"lb": int(m[1])}
        else:
            cg = {"tons": 0}
        t2[key] = {"move": mv, "seaworthiness": int(sea), "pursuit": dice(pursuit), "maneuver": mn, "size": sizes,
                   "crew": {"max": cr[0], "average": cr[1], "minimum": cr[2]},
                   "passengers": 0 if pas in ("—", "-") else int(pas), "cargo": cg}
    assert len(t2) == 20 and t2["great-galley"]["move"] == [18, 6, 12] and t2["trireme"]["crew"]["minimum"] == 71
    # Footnoted rowers of the galleys (rowers / skeleton / minimum rowers, warriors instead of cargo).
    rowers = {}
    for key, label in [("dromond", "dromond"), ("great-galley", "great galley"), ("knarr", "knarr"), ("pentekonter", "pentekonter"), ("trireme", "trireme")]:
        m = need(p, rf"(?:A |The )?{label}(?:'s)? crew includes (\d+) rowers; (\d+) rowers constitute a skeleton crew and the minimum number of rowers is (\d+)", f"{key} rowers")
        rowers[key] = {"rowers": int(m[1]), "skeleton": int(m[2]), "minimum": int(m[3])}
    warriors = {}
    for key, label in [("dromond", "Dromonds can carry an additional (\\d+) warriors"), ("great-galley", "Great galleys can carry (\\d+) warriors"),
                       ("pentekonter", "Pentekonters can carry (\\d+) warriors"), ("trireme", "Triremes can carry an additional (\\d+) warriors")]:
        warriors[key] = int(need(p, label, f"{key} warriors")[1])
    need(p, r"All of the crew aboard a curragh, drakkar, or longship row", "all row")
    need(p, r"they cannot mount weapons requiring more than 15 units of deck space each\. A trireme's total artillery armament cannot require more than 30 tons", "trireme artillery")
    return t1, t2, rowers, warriors, rev, w


def movement_rules():
    w, rev, _ = classdata.page("Movement (OSS)")
    p = re.sub(r"\s+", " ", w)
    need(p, r"a full day of travel is about ten hours", "ten hours")
    need(p, r"multiplying the ship's movement rate by 2", "row x2")
    need(p, r"must roll a 12 or better on 1d20 to get the extra speed\. A successful Seamanship proficiency check grants a \+3 bonus to the roll", "boost 12 +3")
    need(p, r"the vessel's movement rate increases by one third for five rounds", "boost 1/3 5 rounds")
    need(p, r"A ship's officers can attempt to increase speed only once every five rounds", "boost once per 5 rounds")
    need(p, r"Rowers can keep such a backbreaking pace for a maximum of three turns\. After this period, the exhausted rowers must rest for a number of rounds equal to twice the amount of time", "rowers 3 turns")
    need(p, r"Ships with resting rowers can only move at one third of their normal rate", "resting 1/3")
    need(p, r"a successful Seamanship proficiency check \(with a -2 penalty\) grants a \+3 bonus to the roll\. Success indicates that the ship's daily movement increases by one third", "daily push")
    need(p, r"a ship's complement of rowers must rest for at least 12 hours before they can row again", "rest 12 hours")
    need(p, r"Such a ship's daily movement rate in miles equals three times its adjusted movement rate", "sail x3")
    need(p, r"Characters can row for a number of hours equal to one-half their Constitution scores rounded up", "small craft hours")
    need(p, r"characters lose one Constitution point for every extra hour of rowing", "con loss")
    need(p, r"Lost Constitution points return at a rate of one per full hour of rest", "con return")
    need(p, r"a character can increase his boat's rowed movement rate by making a Strength check\. Success indicates that the character in question has increased his boat's movement by one third", "str boost")
    need(p, r"The character must make a Strength check every five rounds", "str every 5")
    need(p, r"The absolute maximum amount of time for sustaining such a pace is three turns", "3 turns")
    need(p, r"The speed increase lasts 10 minutes", "sail boost 10 min")
    need(p, r"If a ship anchors from dusk to dawn rather than sailing through the night, multiply its base movement rate by 2", "anchor x2")
    need(p, r"must always remain in sight of land and must anchor each night, otherwise, the vessel becomes lost at sea", "night lost")
    need(p, r"rolls 2d6 and consults Table 4: Wind Strength on the first day", "wind 2d6")
    need(p, r"He should use this die roll every day for 1d4 days", "wind 1d4 days")
    need(p, r"Sailing ships have a movement rate of 0 in a calm", "calm 0")
    need(p, r"These fierce winds blow for 1d4 days\. They force ships to make Seaworthiness checks each day", "gale checks")
    need(p, r"then move the ship an equal distance in the direction of the gale\. A successful Seamanship proficiency check by a ship's captain or helmsman reduces the distance a gale-tossed ship travels off course by one third", "gale drift")
    need(p, r"A ship turned into a gale or storm actually moves backwards at one third of its base movement rate", "into gale")
    need(p, r"if the captain or helmsman makes a successful Seamanship check, the ship's daily gale movement becomes zero if the ship turns into the wind", "into gale seamanship")
    need(p, r"These fearsome winds force ships to make Seaworthiness checks each day with a -3 penalty", "storm -3")
    need(p, r"storms do not allow any Seamanship checks to reduce total movement", "storm no seamanship")
    need(p, r"The wind maintains its direction 1d4 days", "direction 1d4 days")
    need(p, r"ships have an effective movement rate of 0 if they attempt to sail into a Strong wind", "NM")
    need(p, r"cog \(movement rate of 9\) sailing across a strong wind would have two thirds its base movement rate added", "cog example")
    wind = {}
    for label, mods in table(w, "Table 3: Sailing Movement and Winds"):
        k = {"Light": "light", "Moderate": "moderate", "Strong": "strong", "Gale/Storm*": "gale"}[label]
        m = re.fullmatch(r"Into\s*(.+?)\s*With\s*(.+?)\s*Across\s*(.+)", mods)
        assert m, mods
        wind[k] = {"into": frac(m[1]), "with": frac(m[2]), "across": frac(m[3])}
    # "Moderate ... Across 1/3" is printed without a sign: the other rows add to the base rate when sailing across.
    assert wind["strong"]["across"] == 2 / 3 and wind["light"]["with"] == 1 / 3 and wind["strong"]["into"] is None
    # Gale/storm "Into 1/3": a ship turned into a gale or storm moves backwards at a third of its base rate (handled by
    # module/naval.mjs as `gale.into`, not as an added fraction).
    wind["gale"]["into"] = None
    wind["storm"] = dict(wind["gale"])
    strength = []
    for roll, name, first, nxt in table(w, "Table 4: Wind Strength"):
        strength.append({"roll": int(roll), "wind": name.lower(), "next": nxt.rstrip("*")})
    assert len(strength) == 11 and strength[0]["wind"] == "calm" and strength[-1]["wind"] == "storm"
    direction = []
    for roll, warm, cold in table(w, "Table 5: Wind Direction"):
        direction.append({"roll": int(roll), "warm": warm.lower(), "cold": cold.lower()})
    assert len(direction) == 11
    return wind, strength, direction, rev


def shipwreck_rules():
    w, rev, _ = classdata.page("Shipwrecks (OSS)")
    p = re.sub(r"\s+", " ", w)
    need(p, r"If the roll is greater than the Seaworthiness value, the ship either founders or grounds", "check d20")
    need(p, r"a storm imposes a -3 penalty to a Seaworthiness check\)\. A ship that fails its Seaworthiness check sinks after 1d10 hours", "founder 1d10")
    need(p, r"A roll of 20 on a storm-induced Seaworthiness check indicates that the vessel in question has capsized", "capsize")
    need(p, r"must make successful saving throws vs\. death magic or be trapped in the wreck and killed", "save death")
    need(p, r"Grounding occurs when a ship enters coastal waters in a fog, storm, or gale", "grounding")
    need(p, r"the crew can repair and refloat it after 1d6 days of work", "refloat 1d6")
    need(p, r"makes all future Seaworthiness checks with a -3 penalty until properly repaired at a shipyard", "jury -3")
    need(p, r"Ships that ground on rocky coastline or coral reefs sink within 1d3 hours\. A natural roll of 20", "rocky 1d3")
    need(p, r"designate one item per three character levels", "items kept")
    need(p, r"On a roll of 12 or better, the character keeps the item", "keep 12")
    return rev


def vision_rules():
    w, rev, _ = classdata.page("Vision (OSS)")
    p = re.sub(r"\s+", " ", w)
    need(p, r"Those ships in the Medium category double the ranges on Table 6\. Large ships triple the ranges, and Very Large ships quadruple the ranges", "size x")
    need(p, r"become visible at four times the listed range if fairly flat\. Hills or cliffs become visible at five times the listed range\. Very tall cliffs or low mountains become visible at six times", "land x")
    need(p, r"A viewer perched in a crow's nest can see roughly twice as far as one on a ship's deck\. A viewer flying at more than twice mast height can see about three times as far", "height x")
    need(p, r"None of these multipliers apply to the Detail category\. Height multipliers do not apply to the ID category, but size multipliers do", "exceptions")
    rows = []
    for cond, mvm, spotted, typ, ident, detail in table(w, "Table 6: Visibility Ranges"):
        n = lambda s: int(s.replace(",", ""))
        rows.append({"key": camel(cond.replace(",", " ")), "label": cond, "movement": n(mvm), "spotted": n(spotted), "type": n(typ),
                     "id": n(ident), "detail": n(detail)})
    assert len(rows) == 8 and rows[0]["spotted"] == 1500
    return rows, rev


def encounter_rules():
    w, rev, _ = classdata.page("Encounter Tables (OSS)")
    p = re.sub(r"\s+", " ", w)
    need(p, r"Inhabited coastlines refer to any area within 10 miles of a coastline .* DMS should check for possible encounters three times per day\. Encounters occur on a roll of 1 or 2 on a six-sided die", "inhabited")
    need(p, r"DMs should check for encounters twice daily\. Encounters occur on a roll of 1 on a six-sided die", "uninhabited")
    need(p, r"The open sea refers to any area at least 11 miles away from any coastline\. .* DMs should check for encounters three times a day\. Encounters occur on a 1 on a six-sided die", "open sea")
    need(p, r"Encounters with ships or creatures traveling on or above the surface usually take place at Spotted range", "distance spotted")
    need(p, r"Creatures traveling below the surface generally come within 1d10x10 feet", "distance below")
    out = {}
    for key, title in [("inhabited", "Table 7: Inhabited Coastline Encounters"), ("uninhabited", "Table 8: Uninhabited Coastline Encounters"),
                       ("openSea", "Table 9: Open Sea Encounters"), ("phenomena", "Table 10: Natural Phenomena")]:
        rows = [{"roll": int(r[0]), "label": re.sub(r"\s*\(see page \d+\)", "", r[1]).replace("Foating", "Floating")} for r in table(w, title)]
        assert [r["roll"] for r in rows] == list(range(2, 21)), key
        out[key] = rows
    # Natural phenomena with a mechanical effect handled by the voyage tool (keys -> lang AD2E.Naval.Phenomenon.*).
    need(p, r"Calms last 1d6 hours", "calm 1d6 h")
    need(p, r"all ship movement slows by one third of the base rate\. In addition, Small ships must make Seaworthiness checks with a -1 penalty", "choppy")
    need(p, r"Favorable winds last 1d12 hours", "favourable 1d12 h")
    need(p, r"This thick blanket of condensation lasts 2d6 hours", "fog 2d6 h")
    need(p, r"Any ship within 3 miles of the whirlpool becomes caught in the maelstrom's grip unless its movement rate is 18 or higher", "maelstrom 18")
    need(p, r"A good omen adds 5 to the morale rating of a ship's crew", "omen 5")
    need(p, r"Riptides slow ship movement by half the current rate \(rounding down any fractions\) and last 1d4 turns", "riptide")
    need(p, r"Ships encountering rocky shoals must make successful Seaworthiness checks with a -1 penalty", "shoals -1")
    need(p, r"they blow themselves out in only 1d3 days", "squalls 1d3 days")
    return out, rev


def combat_rules():
    tw, trev, _ = classdata.page("Time in Nautical Combat (OSS)")
    rounds = []
    for dist, time, actions in table(tw, "Table 11: Naval Combat Rounds"):
        lo, hi = re.fullmatch(r"([\d,]+)(?:-([\d,]+)|\+) Yards", dist).groups()
        acts = [camel(a.strip("* ")) for a in actions.split(",")]
        rounds.append({"min": int(lo.replace(",", "")), "max": int(hi.replace(",", "")) if hi else None,
                       "minutes": int(time.split()[0]), "actions": acts})
    assert [r["minutes"] for r in rounds] == [1, 10, 30] and "ram" in rounds[0]["actions"] and "artillery" not in rounds[2]["actions"]

    mw, mrev, _ = classdata.page("The Maneuvering Phase (OSS)")
    mp = re.sub(r"\s+", " ", mw)
    need(mp, r"In a 30-minute or 10-minute round, the ships use their pursuit dice\. Ships use their maneuverability dice during one-minute rounds", "dice by round")
    need(mp, r"To randomly determine a crew's quality, roll 3d4\. For trading vessels and ships carrying pirates or buccaneers, add \+2 to the dice\. Add \+3 for privateers and warships", "crew 3d4")
    need(mp, r"Overall crew experience decreases by one category for every one quarter of a ship's current crew \(rounded up\) replaced by untrained crewmen", "untrained")
    need(mp, r"Rowers have a chance to tire after every ten minutes of combat\. Roll 1d10; on a roll of 4 or less, the rowers tire\. If the ship moves under both sail and oars, add one to the die roll\. If the rowers qualify as Mates, they automatically pass their first check\. If they qualify as Mariners or Old Salts, they automatically pass their first two checks", "rower endurance")
    need(mp, r"the ship loses one point from its maneuverability and pursuit ratings, but neither rating can fall below 1d6", "tired -1")
    need(mp, r"Tired rowers can only recover after three hours of normal \(non-combat\) movement or a half hour of complete rest", "tired recovery")
    need(mp, r"No matter what the value shown on the table, however, the range between two ships can never shift more than one category on Table 11", "one category")
    need(mp, r"If both vessels choose to close, the range is reduced by the sum of their current movement rates", "both close")
    need(mp, r"If both vessels choose to flee, the range increases by the sum of their current movement rates", "both flee")
    need(mp, r"The faster vessel is the vessel with the highest current movement rate", "faster")
    need(mp, r"When a vessel evades, the opposing ship automatically becomes free to change the range by an amount determined by its maneuverability roll", "evasion")
    need(mp, r"The range changes in the winning ship's favor by an amount equal to the pursuit or maneuverability roll minus the value of the loser's roll", "note 2")
    need(mp, r"simply subtract 21 from the ship's speed and note the range change for that number, then add that number to the value for a ship with a speed of 21", "over 21")
    crew = []
    for roll, name, mod in table(mw, "Table 12: Crew Experience and Maneuverability"):
        crew.append({"key": camel(name), "range": rng(roll), "mod": 0 if mod in ("—", "-") else int(mod)})
    assert [c["key"] for c in crew] == ["landlubbers", "scurvyRats", "mates", "mariners", "oldSalts"] and crew[-1]["mod"] == 2
    wages = {}
    for key, label in [("landlubbers", "Landlubbers hire themselves out for (\\d+) gp per month"), ("scurvyRats", "Scurvy Rats hire themselves out for (\\d+) gp per month"),
                       ("mates", "Mates hire themselves out for (\\d+) gp per month"), ("mariners", "They hire themselves out for (\\d+) gp a month"),
                       ("oldSalts", "Old salts hire themselves out for (\\d+) gp a month")]:
        wages[key] = int(need(mp, label, f"wage {key}")[1])
    # Table 13: the outcome columns, checked against the printed cells; the actions are coded in module/naval-combat.mjs.
    t13 = table(mw, "Table 13: Maneuverability and Combat")
    assert [r[0] for r in t13] == ["A Wants to Flee", "A Wants to Close With B", "A Wants to Ram B", "A Wants to Evade B", "A Wants to Board B"]
    cells = {r[0]: r[1:] for r in t13}
    need(cells["A Wants to Flee"][0], r"A opens the range\. A gains a \+1 bonus on its next maneuverability or pursuit roll and gains a \+3 bonus to missile and artillery", "flee 2x")
    need(cells["A Wants to Flee"][1], r"A opens the range\. .*\+2 bonus to missile and artillery", "flee >")
    need(cells["A Wants to Flee"][2], r"Range changes in favor of the faster vessel by 1d10x10 yards", "tie")
    need(cells["A Wants to Flee"][3], r"B closes the range\. A suffers a -1 penalty", "flee <")
    need(cells["A Wants to Flee"][4], r"B closes the range\. A suffers a -2 penalty", "flee 1/2")
    need(cells["A Wants to Ram B"][0], r"\+1 bonus on its next maneuverability roll and receives a \+2 bonus to ramming", "ram 2x")
    need(cells["A Wants to Ram B"][1], r"\+1 bonus to ramming", "ram >")
    need(cells["A Wants to Evade B"][0], r"B receives a -3 penalty to ramming and boarding", "evade 2x")
    need(cells["A Wants to Evade B"][1], r"B receives a -2 penalty", "evade >")
    need(cells["A Wants to Evade B"][2], r"B receives a -1 penalty", "evade =")
    need(cells["A Wants to Evade B"][3], r"B receives a \+1 bonus", "evade <")
    need(cells["A Wants to Evade B"][4], r"B receives a \+2 bonus", "evade 1/2")
    need(cells["A Wants to Board B"][0], r"A closes the range and grapples B; 3/4 of A's boarding party storms aboard B this round", "board 2x")
    need(cells["A Wants to Board B"][1], r"A receives a \+2 bonus on all boarding rolls", "board >")
    t13 = {
        "flee": {"great": {"move": "open1", "next": 1, "missile": 3}, "win": {"move": "open2", "next": 1, "missile": 2}, "tie": {"move": "faster"},
                 "lose": {"move": "close2", "missile": -1}, "badly": {"move": "close1", "missile": -2}},
        "close": {"great": {"move": "close1", "next": 1, "missile": 3}, "win": {"move": "close2", "next": 1, "missile": 2}, "tie": {"move": "faster"},
                  "lose": {"move": "open2", "missile": -1}, "badly": {"move": "open1", "missile": -2}},
        "ram": {"great": {"move": "close1", "next": 1, "ram": 2}, "win": {"move": "close2", "next": 1, "ram": 1}, "tie": {"move": "faster", "evasion": True},
                "lose": {"move": "open2", "evasion": True}, "badly": {"move": "open1", "evasion": True}},
        "evade": {"great": {"next": 1, "foeRamBoard": -3}, "win": {"next": 1, "foeRamBoard": -2}, "tie": {"foeRamBoard": -1},
                  "lose": {"foeRamBoard": 1}, "badly": {"foeRamBoard": 2}},
        "board": {"great": {"move": "close1", "grapple": True, "boarders": 0.75}, "win": {"move": "close2", "board": 2}, "tie": {"move": "faster", "evasion": True},
                  "lose": {"move": "open2", "evasion": True}, "badly": {"move": "open1", "evasion": True}}
    }
    t14 = table(mw, "Table 14: Range Changes")
    for i, (rate, one, ten, thirty) in enumerate(t14, start=1):
        assert int(rate) == i and int(one.replace(",", "")) == 10 * i and int(ten.replace(",", "")) == 100 * i and int(thirty.replace(",", "")) == 300 * i, rate
    assert len(t14) == 21
    range_per = {"1": 10, "10": 100, "30": 300}

    aw, arev, _ = classdata.page("Action Phase (OSS)")
    ap = re.sub(r"\s+", " ", aw)
    need(ap, r"Missile and artillery attacks\. \* Ramming Attempts \* Boarding Attempts \* Boarding Melees", "order")
    need(ap, r"rolls 1d20 for every 10 missile factors", "1d20 per 10")
    need(ap, r"If the number of missile factors is not evenly divisible by 10, roll once on Table 15 for the remnant and then roll on Table 16", "remnant")
    need(ap, r"Each hit has the potential to inflict one hit die of damage to crew and passengers", "hit = 1 HD")
    need(ap, r"Bonus hit points of \+3 or more count as an extra hit die and bonuses of \+2 or less are ignored\. For purposes of naval combat, all creatures have at least one hit die", "HD rules")
    need(ap, r"A ship's crew can prepare one to four volleys of incendiary missiles during any 1-minute round", "volleys 1-4")
    need(ap, r"Weapons firing incendiaries suffer a range reduction of one third, rounded down", "incendiary range")
    need(ap, r"the target is the ship, which is considered armor class 10", "incendiary AC 10")
    need(ap, r"When a fire inflicts maximum damage, it immediately grows to the next larger size and starts a second fire; hull fires spread to the rigging or oars, and crippling fires spread to the hull\. The steps after d10 are d12 and d20", "fire growth")
    need(ap, r"Roll one die equal to the fire's size for each firefighter\. On a roll of 1, the fire goes out", "firefighting")
    need(ap, r"it continues to inflict damage every minute until it goes out", "fire per minute")
    need(ap, r"Ballistae targets are effectively AC 10\. \* Catapult and trebuchet targets are effectively AC 0\. \* Greek fire projector targets are effectively AC 5", "artillery AC")
    need(ap, r"At medium range, a weapon has a -2 attack roll penalty\. At long range a weapon has a -5 attack roll penalty", "range penalties")
    need(ap, r"The usual -5 attack modifier for long range does not apply to catapults or trebuchets", "catapult long")
    need(ap, r"the weapon's rate of fire decreases by one for every person missing", "crew short")
    need(ap, r"such ships have one unit of deck space available for each hull point they have when undamaged", "deck space")
    need(ap, r"Only ships with defense classes of A, B, or C can mount artillery", "defense ABC")
    need(ap, r"Small vessels cannot mount any\. Medium ships can mount only one, in the bow\. Large and Very Large ships can mount two", "greek fire mounts")
    need(ap, r"Vessels with less than 10 hull points cannot mount a greek fire projector", "greek fire hull 10")
    need(ap, r"A hit always starts one hull fire; in addition, roll five times on Table 18: Missile Hit Allocation, and five times on Table 19", "greek fire hit")
    need(ap, r"Defense Class X vessels hit by greek fire are automatically destroyed\. If aimed at boarders, a greek fire projector automatically inflicts 10 hits", "greek fire X")
    need(ap, r"Defense Class X vessels always suffer normal Crippling and Sinking damage if struck by artillery", "class X artillery")
    need(ap, r"Class X vessels suffer double damage from any critical hit", "class X crit")
    need(ap, r"Roll once on Table 18: Missile Hit Allocation\. The group indicated suffers three hits", "personnel casualty")
    need(ap, r"The ship in question suffers an additional 2d6 points of hull damage and must make a Seaworthiness check", "hull smashed")
    need(ap, r"The damaged vessel suffers an extra 2d6 points of crippling damage\. In addition, the vessel's sailors or rowers suffer three hits", "crippling strike")
    need(ap, r"The ship in question suffers twice the normal damage indicated on Table 21", "tactical")
    need(ap, r"reducing the target's Ram Factor to 0\. Do not roll for additional damage\. In addition, the ship in question loses 1d6 hull points", "ram smashed")
    need(ap, r"only oared ships can perform ramming maneuvers", "oared ram")
    need(ap, r"Ships that inflict more than a glancing strike during a ramming maneuver receive \+2 on their boarding rolls", "ram then board")
    need(ap, r"Ramming vessels receive a \+1 bonus to their Ramming roll for every size category greater", "ram size +")
    need(ap, r"ramming ships suffer a -1 penalty for every size category smaller", "ram size -")
    need(ap, r"the opponents must wait one round before attempting to ram again", "ram wait")
    need(ap, r"The target ship loses half its original hull points\. .* The target ship must also make a successful Seaworthiness check at its current rating \(see page 52\) with an additional -2 penalty", "deadly strike")
    need(ap, r"If the result is six or less, the ramming ship becomes stuck in the hull of the target vessel", "stuck")
    need(ap, r"To get free, the ship must roll a 4 or more on 1d6", "free 4+")
    need(ap, r"it gains a \+2 bonus to the roll\. If the roll fails, the ship can try to get free again during the next combat round, but suffers a cumulative -1 penalty", "free modifiers")
    need(ap, r"the target vessel loses a quarter of its normal total hull or crippling points \(round fractions up\)", "crippling strike quarter")
    need(ap, r"The DM simply compares the attacker's and defender's boarding factors and subtracts the lower number from the higher, then modifies the boarding action die roll by one for every five points", "boarding factors")
    need(ap, r"Partially grappled ships can immediately make one attempt to free themselves by rolling a 5 or 6 on 1d6\. .* Every group of 10 crewmen participating adds \+1 to the die roll, but a roll of 1 always fails", "partial free")
    need(ap, r"Ships partially secured by grapples suffer a -2 penalty to all maneuverability checks", "partial -2")
    need(ap, r"Secured ships can immediately attempt to free themselves from the grapples by rolling a 6 on 1d6", "grappled free 6")
    need(ap, r"it gains a \+6 bonus on its Boarding Action roll during the next Action phase", "grappled +6")
    need(ap, r"Each round after the first, an additional one quarter of the attacker's boarding party can cross over", "quarter per round")
    need(ap, r"Grappled ships automatically lose any maneuverability check made during the Maneuvering phase and have a movement rate of 0", "grappled 0")
    need(ap, r"Remember that ships utilizing skeleton crews can only move at one half their maximum movement rate", "boarding skeleton half")

    t15 = table(aw, "Table 15: General Naval Combat")
    t15 = [[int(x) for x in r[1:]] for r in t15]
    assert len(t15) == 20 and all(len(r) == 25 for r in t15) and t15[0][0] == 8 and t15[19][24] == 1
    t16 = [[int(x) for x in r[1:]] for r in table(aw, "Table 16: Hits From Excess Attack Factors")]
    assert len(t16) == 9 and all(len(r) == 11 for r in t16) and t16[8][10] == 9
    archers = {SIZE_WORD[s]: int(n) for s, n in table(aw, "Table 17: Naval Archers")}
    assert archers == {"small": 5, "medium": 20, "large": 30, "veryLarge": 40}
    word = {"—": "", "Sailor": "sailor", "Rower": "rower", "Marine": "marine", "Marine*": "marine*", "Special": "special", "n/a": "na"}
    t18 = {k: [] for k in "ABCDX"}
    for r in table(aw, "Table 18: Missile Hit Allocation"):
        assert int(r[0]) == len(t18["A"]) + 1
        for k, v in zip("ABCDX", r[1:]):
            t18[k].append(word[v])
    assert t18["D"][2] == "sailor" and t18["A"][9] == "special" and len(t18["A"]) == 10

    def inc(v):
        v = v.replace("•", "*").strip()
        if v == "***":
            return "destroyed"
        if v in ("—", ""):
            return ""
        m = re.fullmatch(r"Fire, (crippling|hull)(\**)", v)
        assert m, v
        return m[1] + ("+" * len(m[2]))
    t19 = {k: [] for k in "ABCDX"}
    for r in table(aw, "Table 19: Incendiary Hit Allocation"):
        for k, v in zip("ABCDX", r[1:]):
            t19[k].append(inc(v))
    assert t19["B"][3] == "hull+" and t19["D"][2] == "hull++" and t19["X"][0] == "destroyed" and t19["X"][6] == ""
    fires = [{"range": rng(r[0]), "die": int(r[1][1:])} for r in table(aw, "Table 20: Fires")]
    assert [f["die"] for f in fires] == [4, 6, 8, 10]
    artillery = []
    for name, ranges, dmg, gun_crew, rof, thac0, cost, space in table(aw, "Table 21: Artillery"):
        nm = name.strip()
        rg = [None if x in ("—", "-") else int(x) for x in re.sub(r"1$", "", ranges).split("/")]
        if "Greek" in nm:
            crew_f, ship_d, crit = None, None, 0
        else:
            m = re.fullmatch(r"(\d+)/(—|[\dd+]+)(?: \(\+(\d)\))?", dmg)
            assert m, dmg
            crew_f, ship_d, crit = int(m[1]), (None if m[2] == "—" else m[2]), int(m[3] or 0)
        rof_m = re.fullmatch(r"1/(\d)(?: \((\d)\))?", rof)
        sp = re.fullmatch(r"(—|\d+)(?: \((\d+)\))?", space)
        artillery.append({"key": camel(nm), "label": nm, "range": {"min": rg[0], "short": rg[1], "medium": rg[2], "long": rg[3]},
                          "crewFactors": crew_f, "damage": ship_d, "critBonus": crit, "crew": int(gun_crew), "every": int(rof_m[1]),
                          "perTen": int(rof_m[2]) if rof_m[2] else None, "thac0": int(thac0), "cost": int(re.sub(r"[^\d]", "", cost)),
                          "space": None if sp[1] == "—" else int(sp[1]), "tons": int(sp[2]) if sp[2] else None})
    keys = [a["key"] for a in artillery]
    assert keys == ["ballistaLight", "ballistaMedium", "ballistaHeavy", "catapultLight", "catapultMedium", "catapultHeavy", "greekFireProjector", "trebuchet"], keys
    assert artillery[1]["range"] == {"min": 1, "short": 10, "medium": 20, "long": 30} and artillery[2]["damage"] == "1d4+2" and artillery[2]["critBonus"] == 1
    t22 = []
    effects22 = {"Glancing Blow": "glancing", "Partial Hit: -2 points of Crippling": "crippling-2", "Partial Hit: -1 point of Crippling": "crippling-1",
                 "Rigging/Oar Hit: normal Crippling damage plus Personnel": "crippling+casualty", "Rigging/Oar Hit": "crippling",
                 "Partial Hull Strike": "hull-1", "Hull Strike: normal Hull damage plus": "hull+casualty", "Hull Strike": "hull",
                 "Critical Hit: roll on Table 23 plus": "critical+casualty", "Critical Hit: attack inflicts": "critical+both", "Critical Hit": "critical"}
    for roll, eff in table(aw, "Table 22: Artillery Effects"):
        key = next(v for k, v in effects22.items() if eff.startswith(k))
        t22.append({"range": rng(roll), "effect": key})
    assert [t["effect"] for t in t22] == ["glancing", "crippling-2", "crippling-1", "crippling", "hull-1", "hull", "crippling+casualty", "hull+casualty", "critical", "critical+casualty", "critical+both"]
    need(ap, r"The DM then rolls 2d10 on Table 22", "table 22 2d10")
    t23 = [{"range": rng(r), "effect": camel(e.replace("/", " "))} for r, e in table(aw, "Table 23: Artillery Critical Hits")]
    assert [t["effect"] for t in t23] == ["hullSmashed", "cripplingStrike", "tacticalStrike", "artilleryHitCrewCasualty", "ramSmashed", "hullSmashed"]
    t24 = []
    for roll, res in table(aw, "Table 24: Ramming Action Results"):
        r = res.strip()
        if r.startswith("Ramming Ship suffers Critical Miss"):
            e = {"effect": "criticalMiss"}
        elif m := re.fullmatch(r"Ramming [Ss]hip loses (\d)d6 damage points", r):
            e = {"effect": "selfDamage", "dice": int(m[1])}
        elif r == "Complete Miss":
            e = {"effect": "miss"}
        elif m := re.fullmatch(r"Glancing Strike: Target loses (\d)d6 damage points", r):
            e = {"effect": "damage", "dice": int(m[1]), "glancing": True}
        elif m := re.fullmatch(r"Target loses (\d)d6 damage points", r):
            e = {"effect": "damage", "dice": int(m[1])}
        elif r == "Target suffers Critical Hit":
            e = {"effect": "critical", "dice": 0}
        elif m := re.fullmatch(r"Target suffers Critical Hit and loses (\d)d6 damage points", r):
            e = {"effect": "critical", "dice": int(m[1])}
        elif r == "Deadly Strike":
            e = {"effect": "deadly"}
        else:
            raise AssertionError(r)
        t24.append({"range": rng(roll), **e})
    assert len(t24) == 14 and t24[0]["range"] == [None, 1] and t24[-1]["range"] == [18, None]
    t25 = [{"range": rng(r), "effect": camel(e.replace("/", " "))} for r, e in table(aw, "Table 25: Ramming Critical Miss Results")]
    assert [t["effect"] for t in t25] == ["ramShatters", "oarsShearedSailsTear", "ramDamaged", "fouledOarsRigging", "poorTacticalPosition", "collision", "ramShatters"]
    t26 = [{"range": rng(r), "effect": camel(e.replace("/", " "))} for r, e in table(aw, "Table 26: Ramming Critical Hit Results")]
    assert [t["effect"] for t in t26] == ["deadlyStrike", "oarsShearedMastCracked", "crewStunned", "tacticalAdvantage", "cripplingStrike", "deadlyStrike"]
    t27 = []
    for roll, res in table(aw, "Table 27: Boarding Action Results"):
        r = res.strip()
        if r == "Grapples Repulsed":
            e = {"effect": "repulsed"}
        elif r == "Target Ship Partially Grappled":
            e = {"effect": "partial"}
        elif r == "Target Ship Grappled":
            e = {"effect": "grappled"}
        else:
            m = re.fullmatch(r"(1/4|1/2|3/4|Entire) Boarding Party", r)
            assert m, r
            e = {"effect": "board", "part": {"1/4": 0.25, "1/2": 0.5, "3/4": 0.75, "Entire": 1}[m[1]]}
        t27.append({"range": rng(roll), **e})
    assert len(t27) == 7 and t27[0]["range"] == [None, 6] and t27[-1]["part"] == 1
    # Ramming critical effect figures (paraphrased in lang/en.json).
    need(ap, r"causes the target ship to lose 1d6 hull points \(even if the attack was aimed at the oars\)\. The blow shatters the attacking ship's ram, reducing the ship's Ramming Factor to 0\. In addition, the attacking ship must attempt a Seaworthiness check with a -3 penalty", "ram shatters")
    need(ap, r"The event kills half the ship's rowers", "oars sheared")
    need(ap, r"reducing its Ramming Factor by 1\. Ships without a ram \(those with a Ramming Factor of 0\) must make a successful Seaworthiness check with a -2 penalty or lose 2d6 hull points", "ram damaged")
    need(ap, r"the ship's movement is reduced by two thirds of its base rate for the remainder of the round", "fouled")
    need(ap, r"Ships with this result receive a -3 penalty to their maneuverability checks during the Maneuvering phase next combat round", "poor position")
    need(ap, r"during its ramming action and loses 2d6 hull points", "collision")
    need(ap, r"it suffers a -4 penalty on its maneuverability check during the Maneuvering phase of the next combat round\. PCs on board ships so struck must make successful saving throws vs\. breath weapon", "crew stunned")
    need(ap, r"The attacking ship receives a \+3 bonus to its maneuverability check and a \+2 bonus to any boarding action during the next naval combat round", "tactical advantage")
    need(ap, r"the target ship's movement rate decreases by two thirds of its base rate and it suffers a -3 penalty to all subsequent maneuverability checks", "ram crippling strike")

    rw, rrev, _ = classdata.page("Resolution Phase (OSS)")
    rp = re.sub(r"\s+", " ", rw)
    need(rp, r"Most ships have numbers of crippling points equal to their hull points", "crippling = hull")
    need(rp, r"every time a ship loses one-half of its original hull points \(rounded down\), it must make a successful Seaworthiness check or founder in 1d10 hours", "half check")
    need(rp, r"every time a ship loses an additional quarter of its remaining hull points it must make another check to avoid foundering\. If the Seaworthiness roll fails on a roll of 20, the ship sinks", "quarter check")
    need(rp, r"Ships lose 1/3 of their adjusted movement rate .* and suffer a -2 penalty on all maneuverability dice rolls .* once they lose half their original hull points\. When a ship loses % of its original hull points, the penalty increases\. Such ships lose an additional % of their original, adjusted movement rates and suffer a -3 penalty", "hull effects")
    need(rp, r"Once a ship reaches 0 hull points or below, it automatically begins sinking", "0 hull sinks")
    need(rp, r"For every of total crippling points lost, reduce a ship's current movement rate by 1/3 and penalize its maneuverability die rolls by 2", "crippling effects")
    need(rp, r"Such repair attempts can restore only 1d6 points of hull damage and 1d12 points of crippling damage\. Repairing hull damage takes 1d4 days plus 2 days per size category above Small", "repairs at sea")
    need(rp, r"Crews can repair crippling damage in 1d4 days\. If a ship begins foundering from battle damage, it can be temporarily patched on a roll of 12 or better on 1d20 .* If someone aboard makes a successful Seamanship or Shipbuilding proficiency roll, add \+3", "patch")
    need(rp, r"crews cannot restore more hull or crippling points than the particular event caused", "repair limit")
    need(rp, r"Extensive repairs \(more than 6 points\) require the skills and materials of a shipyard", "shipyard")
    need(rp, r"Then the DM rolls 2d10 and adds the numbers together\. If the total number rolled is less than or equal to the crew's adjusted rating, the crew in question passes", "morale 2d10")
    need(rp, r"These penalties last for the duration of the battle", "penalties last")
    need(rp, r"opponents can search for the fleeing ship, locating it on a roll of 6 on 1d6\. If the battle took place near a coast, add one to the die roll\. Also, add one for each extra ship searching; however, a roll of 1 always fails", "search")
    need(rp, r"they are permitted a saving throw vs\. paralyzation if they receive some sort of healing or first aid immediately after the battle", "recover casualties")
    need(rp, r"all ships break off and will not engage each other for at least two hours", "both surrender")
    need(rp, r"If the ships have different Pursuit and Maneuverability ratings, the group must use the lowest one", "units lowest")
    t28 = {SIZE_WORD[s]: [int(x) for x in v.split("/")] for s, v in table(rw, "Table 28: Seaworthiness Reduction Rates")}
    assert t28 == {"small": [2, 1], "medium": [2, 3], "large": [1, 3], "veryLarge": [1, 4]}
    t29 = {}
    for s, v in table(rw, "Table 29: Sinking Times"):
        t29[SIZE_WORD[s]] = "1" if v.startswith("1 round") else re.match(r"(\d+d\d+)", v)[1]
    assert t29 == {"small": "1", "medium": "1d8", "large": "1d10", "veryLarge": "1d12"}
    t30 = {}
    for s, cost, time in table(rw, "Table 30: Vessel Repair Cost and Time"):
        a, b = time.split("/")
        t30[SIZE_WORD[s]] = {"cost": int(cost), "points": int(a), "days": int(re.sub(r"[^\d]", "", b) or 1)}
    assert t30["large"] == {"cost": 150, "points": 1, "days": 3} and t30["small"] == {"cost": 10, "points": 2, "days": 1}
    t31 = {camel(e.rstrip("*")): int(m) for e, m in table(rw, "Table 31: Crew Experience and Morale")}
    assert t31 == {"landlubbers": 9, "scurvyRats": 11, "mates": 13, "mariners": 15, "oldSalts": 17}
    t32 = []
    for sit, mod in table(rw, "Table 32: Situational Morale Modifiers"):
        s = sit.strip()
        if "/" in mod:
            # "Crew received good/bad omen +2/-2": two entries.
            t32.append({"key": "goodOmen", "label": "Crew received good omen", "mod": 2})
            t32.append({"key": "badOmen", "label": "Crew received bad omen", "mod": -2})
            continue
        t32.append({"key": camel(s), "label": s, "mod": int(mod.rstrip("*")), "each": mod.endswith("*")})
    assert len(t32) == 29 and next(m for m in t32 if m["key"] == "unableToHurtOpponent")["mod"] == -8
    t33 = []
    for deg, res in table(rw, "Table 33: Effects of failed Morale Check"):
        m = re.fullmatch(r"(-\d) to all combat rolls", res)
        t33.append({"range": rng(deg.replace(" or less", "orless")), "penalty": int(m[1]) if m else None, "surrender": res == "Surrender"})
    assert t33[-1]["surrender"] and t33[0]["penalty"] == -1 and t33[0]["range"] == [None, 2]

    nw, nrev, _ = classdata.page("Monsters in Naval Combat (OSS)")
    npg = re.sub(r"\s+", " ", nw)
    need(npg, r"Their pursuit ratings are 1d6 plus one third of their swimming movement rates", "creature pursuit")
    need(npg, r"creatures receive a \+1 bonus to maneuverability if their swimming movement rates are 12 or higher", "creature +1")
    need(npg, r"Completely submerged creatures become immune to missile fire\. Partially submerged creatures gain a \+8 Armor Class bonus", "submerged")
    need(npg, r"Artillery can fire at Huge and Gargantuan creatures just as it does at ships-smaller creatures and fully submerged creatures of any size are immune", "artillery creatures")
    need(npg, r"A vessel's ramming factor applies as a penalty to the saving throw", "rf penalty")
    need(npg, r"it can free itself with a successful Dexterity check\. Assume a creature has a Dexterity score equal to one half its fastest movement rate", "creature dex")
    need(npg, r"Two Man-sized creatures can immobilize a Small vessel this way\. Larger vessels require 15 creatures, plus another 15 for each size class of the target vessel above medium", "immobilize")
    need(npg, r"four Tiny or two Small creatures equal one Man-sized one\. A Large creature counts as two man-sized creatures, and Huge creatures count as four", "immobilize counts")
    t34 = {}
    for size, manv, pursuit in table(nw, "Table 34: Creature Maneuverability and Pursuit"):
        t34[camel(size)] = {"maneuver": dice(manv), "autoPass": int(pursuit)}
    assert t34["tiny"]["maneuver"]["plus"] == 9 and t34["gargantuan"]["autoPass"] == 4
    t35 = {camel(w_): d.rstrip("*") for w_, d in table(nw, "Table 35: Artillery vs. Creatures")}
    assert t35["ballistaHeavy"] == "3d12" and t35["greekFireProjector"] == "3d10" and len(t35) == 8
    t36 = {}
    for row in table(nw, "Table 36: Creatures and Ramming"):
        # The Huge row is printed "Medium | 3d10" (a single bar in the source): split it.
        size, rams_as, dmg = row if len(row) == 3 else [row[0], *[c.strip() for c in row[1].split("|")]]
        rams = SIZE_WORD.get(rams_as)
        t36[camel(size)] = {"ramsAs": rams, "damage": None if dmg.strip() in ("—", "-") else dmg.strip().rstrip("*")}
    assert t36["huge"] == {"ramsAs": "medium", "damage": "3d10"} and t36["gargantuan"]["damage"] == "4d10" and t36["man"]["ramsAs"] is None
    t37 = [{"range": rng(ac.replace(" to ", "to")), "mod": int(m.rstrip("*"))} for ac, m in table(nw, "Table 37: Creature Ramming Effects")]
    assert t37[0] == {"range": [None, 8], "mod": -1} and t37[-1] == {"range": [-5, None], "mod": 4}

    sw, srev, _ = classdata.page("Scuttling and Crippling (OSS)")
    sp = re.sub(r"\s+", " ", sw)
    need(sp, r"Six man-sized creatures can inflict 1d2 points of hull damage per round if appropriately armed\. Teams of less than six creatures can still inflict damage, but they suffer a one-round delay for every creature missing", "scuttle 6")
    need(sp, r"surface-dwelling creatures must have a minimum of eight attackers", "surface 8")
    need(sp, r"this attack causes 1d4 points of crippling damage each round rather than hull damage", "cripple 1d4")
    need(sp, r"one Huge creature counts as three Man- sized creatures", "huge 3")

    fw, frev, _ = classdata.page("Fleet Battles (OSS)")
    fp = re.sub(r"\s+", " ", fw)
    need(fp, r"adds 1 to the dice roll for every five extra points", "fleet marines/5")
    need(fp, r"adds the difference between its ramming factor and that of the opponent to the die roll", "fleet rf")
    need(fp, r"adds one to the die roll for every 3 points of extra Seaworthiness", "fleet sea/3")
    need(fp, r"Each such round should take a half hour of game time", "fleet 30 min")
    t38 = {}
    for name, move, sea, pursuit, manv, size, rf, dc, marines, hull in table(fw, "Table 38: Ship Combat Statistics"):
        key = slug(name.strip())
        mar = [int(x) for x in marines.split("/")]
        hp = hull.split("/")
        t38[key] = {"move": rate3(move), "seaworthiness": int(sea), "pursuit": dice(pursuit), "maneuver": [dice(x) for x in manv.split("/")],
                    "rf": None if rf.strip() in ("", "-", "—") else int(rf), "defense": dc.strip(), "marines": mar[0],
                    "warMarines": mar[1] if len(mar) > 1 else None, "hull": int(hp[0]), "crippling": None if hp[1] in ("-", "—") else int(hp[1])}
    assert len(t38) == 20 and t38["caravel"]["hull"] == 54 and t38["great-galley"]["rf"] == 4 and t38["canoe"]["crippling"] is None
    need(fp, r"Increase the number of marines and hull points by 1 for every 10 feet above the standard length of 20 feet", "barge marines/hull")
    need(fp, r"Increase hull points by 1 for every 10 feet above the standard 5 feet length", "canoe hull")
    need(fp, r"A raft gains a defense class of D if it is at least 30 feet long", "raft D")

    return {"rounds": rounds, "crew": crew, "wages": wages, "maneuver": t13, "rangePer": range_per, "rangeMaxRate": 21,
            "hits": t15, "extraHits": t16, "archers": archers, "missileHits": t18, "incendiaryHits": t19, "fires": fires,
            "fireSteps": [4, 6, 8, 10, 12, 20], "artillery": artillery, "artilleryAc": {"ballista": 10, "catapult": 0, "trebuchet": 0, "greekFire": 5},
            "rangePenalty": {"short": 0, "medium": -2, "long": -5}, "artilleryEffects": t22, "artilleryCrits": t23,
            "ramming": t24, "ramMisses": t25, "ramCrits": t26, "boarding": t27, "seaworthinessLoss": t28, "sinking": t29,
            "repairs": t30, "morale": t31, "moraleMods": t32, "moraleFailure": t33, "creatures": t34, "creatureArtillery": t35,
            "creatureRam": t36, "creatureRamAc": t37, "combatShips": t38}, {
        "Time in Nautical Combat (OSS)": trev, "The Maneuvering Phase (OSS)": mrev, "Action Phase (OSS)": arev,
        "Resolution Phase (OSS)": rrev, "Monsters in Naval Combat (OSS)": nrev, "Scuttling and Crippling (OSS)": srev, "Fleet Battles (OSS)": frev}



WORDS = {"two": 2, "three": 3, "four": 4, "five": 5, "six": 6, "ten": 10}


def aa_ships(t1, t2, combat_ships):
    """Arabian Adventures ships in the OSS ship format (implementation choices in the module docstring)."""
    w, rev, _ = classdata.page("Equipment Descriptions (AA)")
    p = plain(w.replace("&nbsp;", " "))
    lw, lrev, _ = classdata.page("Equipment Lists (AA)")
    dw, drev, _ = classdata.page("Movement on Water (DMG)")
    num = lambda x: int(x.replace(",", ""))
    b = need(p, r"Barijah: This small, (\d+)-foot dhow .*? It lacks a sterncastle\. It is lateen-rigged .*? The ship carries a crew of (\d+) men, "
             r"but it can comfortably bear four times that amount, or (\d+) tons of cargo\. The barijah has a base movement rate of (\d+), an emergency "
             r"rate of (\d+), and a seaworthiness of (\d+) percent when traveling in sight of land\. In open water, seaworthiness drops to (\d+) percent", "barijah")
    sb = need(p, r"Sambuk: .*? It has a keel length of (\d+) feet and a beam \(width\) of (\d+) feet\. The crew comprises (\d+) to (\d+) sailors\. In addition, "
              r"the sambuk can carry up to (\d+) passengers or (\d+) tons of cargo\. .*? lateen \(triangular\) sails\. It is marginally more reliable than the "
              r"barijah, having a (\d+) percent seaworthiness in all waters\. The sambuk's base movement rate is (\d+), and its emergency rate is (\d+)", "sambuk")
    z = need(p, r"Zaruq: .*? On average, the ship measures (\d+) to (\d+) feet in length\. It carries a crew of (\d+) to (\d+) men, and can also carry up to "
             r"(\d+) tons of cargo\. The ship's base movement rate is (\d+), its emergency rate is (\d+), and its seaworthiness is an admirable (\d+) percent "
             r"when sailing in sight of the shoreline\..*? In open water, however, the zaruq's seaworthiness drops precipitously to (\d+) percent", "zaruq")
    ln = need(p, r"The smaller ship is the dunij; it can hold (\w+) passengers, move (\d+) feet per round, or (\d+) mph, and can carry ([\d,]+) pounds\. "
              r"The larger boat is the qarib; it can hold up to (\d+) passengers or ([\d,]+) pounds of cargo, with the same movement rates as the dunij\. "
              r"Some qaribs may be fitted with a lateen sail as well, and may move three times as fast", "launches")
    need(p, r"See \"?Ocean Voyaging\"? in Chapter 14 of the DMG", "AA rates are DMG Table 77's")
    prices = {}
    for r in table(lw, "Transport"):
        if len(r) >= 4 and re.fullmatch(r"[\d,]+ gp", r[2] or ""):
            prices[r[0]] = {k: num(v.replace(" gp", "")) for k, v in zip("ABN", (r[1], r[3], r[2]))}
    for k in ("Barijah", "Sambuk", "Zaruq", "Launch, large (qarib)", "Launch, small (dunij)"):
        assert k in prices, f"price {k}"
    # DMG Table 77 against OSS Table 2: rates and seaworthiness.
    t77 = {slug(r[0]): r for r in table(dw, "Table 77: Ship Types") if len(r) == 4}
    need(dw, r"Base move per hour is the average speed of the vessel under good conditions", "Table 77 base move")
    need(dw, r"If the roll is equal to or less than the seaworthiness rating of the ship, it remains afloat", "Table 77 seaworthiness")
    for k in ("caravel", "cog"):
        assert t2[k]["move"] == [3 * int(t77[k][1])], f"OSS rate = 3 x DMG base ({k})"
    pairs = [(int(t77[k][3].rstrip("%")), t2[k]["seaworthiness"]) for k in t77 if k in t2]
    assert len(pairs) == 8, pairs
    n = len(pairs)
    mx = sum(x for x, _ in pairs) / n
    my = sum(y for _, y in pairs) / n
    slope = sum((x - mx) * (y - my) for x, y in pairs) / sum((x - mx) ** 2 for x, _ in pairs)
    icept = my - slope * mx
    assert max(abs(icept + slope * x - y) for x, y in pairs) < 3, "fit"
    sea = lambda pct: min(max(round(icept + slope * pct), 1), 20)
    t76 = {slug(r[0]): r for r in table(dw, "Table 76: Boat Movement") if len(r) >= 3}
    assert t76["barge"][1] == t76["keelboat-or-raft"][1] == ln[2], "launch speed = Table 76 barge / raft"
    assert t2["barge"]["move"] == [3] and t2["raft"]["move"] == [3]
    beam_ratio = int(sb[2]) / int(sb[1])
    out = []

    def make(key, label, src_price, length, beam, crew, passengers, cargo, base, emergency, pct, pct_open, template, propulsion):
        t, c = t1[template], combat_ships[template]
        tt = t2[template]
        scale = length / t["length"]
        rate = 3 * base if propulsion == "sail" else 3
        sea_c = sea(pct) if pct is not None else tt["seaworthiness"]
        sea_o = sea(pct_open) if pct_open is not None else None
        move = {"both": None, "sail": rate if propulsion == "sail" else None, "oar": rate if propulsion == "oar" else None}
        size = "small" if length < 20 else "medium" if length < 60 else "large" if length <= 100 else "veryLarge"
        hull = max(round(c["hull"] * scale), 1)
        crip = max(round((c["crippling"] or c["hull"]) * scale), 1) if c["crippling"] else None
        minimum = max(round(crew[0] * tt["crew"]["minimum"] / tt["crew"]["max"]), 1)
        out.append({"key": key, "label": label, "source": "AA", "draft": None, "length": length, "beam": beam, "cost": prices[src_price]["N"],
                    "build": None, "propulsion": propulsion, "move": move, "seaworthiness": sea_c, "seaworthinessOpen": sea_o,
                    "pursuit": {"n": 1, "die": 6, "plus": rate // 3}, "maneuver": {"sail": tt["maneuver"][0], "oar": tt["maneuver"][-1]},
                    "size": [size], "crew": {"max": crew[0], "average": crew[1], "minimum": minimum}, "rowers": None, "warriors": None,
                    "allRow": False, "passengers": passengers, "cargo": cargo,
                    "combat": {"move": dict(move), "seaworthiness": sea_c, "pursuit": {"n": 1, "die": 6, "plus": rate // 3},
                               "maneuver": {"sail": tt["maneuver"][0], "oar": tt["maneuver"][-1]}, "rf": c["rf"], "defense": c["defense"],
                               "marines": round(c["marines"] * scale), "warMarines": None, "hull": hull, "crippling": crip},
                    "variable": None, "template": template,
                    "aa": {"base": base, "emergency": emergency, "coastal": pct, "open": pct_open, "prices": prices[src_price],
                           "lateenX3": key == "qarib"}})

    bl = int(b[1])
    make("barijah", "Barijah (AA)", "Barijah", bl, round(bl * beam_ratio), (int(b[2]), int(b[2])), 4 * int(b[2]) - int(b[2]),
         {"tons": int(b[3])}, int(b[4]), int(b[5]), int(b[6]), int(b[7]), "sohar", "sail")
    make("sambuk", "Sambuk (AA)", "Sambuk", int(sb[1]), int(sb[2]), (int(sb[4]), int(sb[3])), int(sb[5]), {"tons": int(sb[6])},
         int(sb[8]), int(sb[9]), int(sb[7]), None, "sohar", "sail")
    zl = (int(z[1]) + int(z[2])) // 2
    make("zaruq", "Zaruq (AA)", "Zaruq", zl, round(zl * beam_ratio), (int(z[4]), int(z[3])), 0, {"tons": int(z[5])},
         int(z[6]), int(z[7]), int(z[8]), int(z[9]), "sohar", "sail")
    dun = WORDS.get(ln[1], None) or int(ln[1])
    for key, label, price, pas, lb in [("dunij", "Dunij (AA launch)", "Launch, small (dunij)", dun, num(ln[4])),
                                       ("qarib", "Qarib (AA launch)", "Launch, large (qarib)", int(ln[5]), num(ln[6]))]:
        sk = t2["skiff"]
        make(key, label, price, t1["skiff"]["length"], t1["skiff"]["beam"], (sk["crew"]["max"], sk["crew"]["average"]), pas, {"lb": lb},
             None, None, None, None, "skiff", "oar")
        e = out[-1]
        e["seaworthiness"] = e["combat"]["seaworthiness"] = sk["seaworthiness"]
        e["aa"].update({"feetPerRound": int(ln[2]), "mph": int(ln[3])})
    assert [s["seaworthiness"] for s in out[:3]] == [sea(40), sea(40), sea(50)] and out[0]["move"]["sail"] == 9 and out[2]["move"]["sail"] == 15
    return out, {"Equipment Descriptions (AA)": rev, "Equipment Lists (AA)": lrev, "Movement on Water (DMG)": drev}, \
        {"slope": round(slope, 4), "intercept": round(icept, 4), "pairs": pairs}

def build():
    t1, t2, rowers, warriors, ship_rev, ship_wiki = ships_tables()
    wind, strength, direction, move_rev = movement_rules()
    wreck_rev = shipwreck_rules()
    vision, vision_rev = vision_rules()
    encounters, enc_rev = encounter_rules()
    combat, combat_revs = combat_rules()
    ships = []
    for key, a in t1.items():
        b = t2[key]
        c = combat["combatShips"][key]
        mv = b["move"]
        if len(mv) == 3:
            prop, move = "both", {"both": mv[0], "sail": mv[1], "oar": mv[2]}
        else:
            prop = PROPULSION[key]
            move = {"both": None, "sail": mv[0] if prop == "sail" else None, "oar": mv[0] if prop == "oar" else None}
        cm = c["move"]
        cmove = {"both": cm[0], "sail": cm[1], "oar": cm[2]} if len(cm) == 3 else dict(move)
        ships.append({"key": key, "label": a["label"], "draft": a["draft"], "length": a["length"], "beam": a["beam"], "cost": a["cost"],
                      "build": a["build"], "propulsion": prop, "move": move, "seaworthiness": b["seaworthiness"], "pursuit": b["pursuit"],
                      "maneuver": {"sail": b["maneuver"][0], "oar": b["maneuver"][-1]}, "size": b["size"], "crew": b["crew"],
                      "rowers": rowers.get(key), "warriors": warriors.get(key), "allRow": key in ("curragh", "drakkar", "longship"),
                      "passengers": b["passengers"], "cargo": b["cargo"],
                      "combat": {"move": cmove, "seaworthiness": c["seaworthiness"], "pursuit": c["pursuit"],
                                 "maneuver": {"sail": c["maneuver"][0], "oar": c["maneuver"][-1]}, "rf": c["rf"], "defense": c["defense"],
                                 "marines": c["marines"], "warMarines": c["warMarines"], "hull": c["hull"], "crippling": c["crippling"]},
                      "variable": VARIABLE.get(key)})
    aa, aa_revs, aa_fit = aa_ships(t1, t2, combat["combatShips"])
    ships.sort(key=lambda s: s["label"])
    ships += aa
    # Table 2 and Table 38 differ for two ships (great galley movement 18/6/12 vs 18/9/15; dromond maneuverability):
    # travel uses Table 2, naval combat Table 38 ("Ship Combat Statistics"), as the book's chapters do.
    gg = next(s for s in ships if s["key"] == "great-galley")
    assert gg["move"] == {"both": 18, "sail": 6, "oar": 12} and gg["combat"]["move"] == {"both": 18, "sail": 9, "oar": 15}
    data = {
        "ships": ships, "aaFit": aa_fit, "sizes": SIZE_ORDER, "sizeFeet": {"small": 5, "medium": 20, "large": 60, "veryLarge": 101},
        "travel": {"rowMilesPerRate": 2, "sailMilesPerRate": 3, "anchorMilesPerRate": 2, "dayHours": 10,
                   "boost": {"die": 20, "target": 12, "seamanship": 3, "fraction": 1 / 3, "rowRounds": 5, "rowMaxTurns": 3, "sailMinutes": 10},
                   "push": {"die": 20, "target": 12, "seamanship": 3, "seamanshipPenalty": -2, "fraction": 1 / 3, "restHours": 12},
                   "resting": 1 / 3, "skeleton": {"rate": 2 / 3, "seaworthiness": -2, "dice": -2, "moraleCost": 1},
                   "belowMinimum": {"move": 3, "maneuver": {"n": 1, "die": 4, "plus": 0}},
                   "smallCraft": {"hoursPerCon": 0.5, "conLossPerHour": 1, "boost": 1 / 3, "boostEveryRounds": 5, "boostMaxTurns": 3}},
        "wind": wind, "windStrength": strength, "windDirection": direction, "windDays": "1d4",
        "gale": {"checkPenalty": 0, "drift": 1, "seamanshipDrift": 2 / 3, "into": -1 / 3, "days": "1d4"}, "storm": {"checkPenalty": -3},
        "wreck": {"founderHours": "1d10", "groundSoftDays": "1d6", "juryPenalty": -3, "rockyHours": "1d3", "keepItemsPerLevels": 3, "keepItemTarget": 12},
        "vision": vision, "visionSize": {"small": 1, "medium": 2, "large": 3, "veryLarge": 4}, "visionLand": {"flat": 4, "hills": 5, "cliffs": 6},
        "visionHeight": {"deck": 1, "crowsNest": 2, "flying": 3},
        "encounters": {"inhabited": {"checks": 3, "chance": 2, "rows": encounters["inhabited"]},
                       "uninhabited": {"checks": 2, "chance": 1, "rows": encounters["uninhabited"]},
                       "openSea": {"checks": 3, "chance": 1, "rows": encounters["openSea"]}, "phenomena": encounters["phenomena"],
                       "belowFeet": "1d10*10"},
        "combat": {k: v for k, v in combat.items() if k != "combatShips"},
        "urls": {"particulars": classdata.url("Ship Particulars (OSS)"), "movement": classdata.url("Movement (OSS)"),
                 "shipwrecks": classdata.url("Shipwrecks (OSS)"), "vision": classdata.url("Vision (OSS)"),
                 "encounters": classdata.url("Encounter Tables (OSS)"), "time": classdata.url("Time in Nautical Combat (OSS)"),
                 "maneuvering": classdata.url("The Maneuvering Phase (OSS)"), "action": classdata.url("Action Phase (OSS)"),
                 "resolution": classdata.url("Resolution Phase (OSS)"), "monsters": classdata.url("Monsters in Naval Combat (OSS)"),
                 "scuttling": classdata.url("Scuttling and Crippling (OSS)"), "fleet": classdata.url("Fleet Battles (OSS)"),
                 "pcs": classdata.url("Player Characters in Detailed Naval Combat (OSS)"),
                 "aaShips": classdata.url("Equipment Descriptions (AA)"), "aaPrices": classdata.url("Equipment Lists (AA)"),
                 "dmgShips": classdata.url("Movement on Water (DMG)")}
    }
    revs = {"Ship Particulars (OSS)": ship_rev, "Movement (OSS)": move_rev, "Shipwrecks (OSS)": wreck_rev, "Vision (OSS)": vision_rev,
            "Encounter Tables (OSS)": enc_rev, **combat_revs, **aa_revs}
    return data, revs


if __name__ == "__main__":
    data, revs = build()
    with open("module/rules/naval-tables.mjs", "w") as f:
        f.write("// GENERATED by tools/build-naval-tables.py from the AD&D 2e fandom wiki (MediaWiki API): do not edit.\n")
        f.write("// Sources (Of Ships and the Sea; Zakharan ships: Arabian Adventures and the DMG): " + ", ".join(f"{k} rev {v}" for k, v in revs.items()) + ".\n")
        f.write(f"export const NAVAL = {json.dumps(data, ensure_ascii=False)};\n")
    print(len(data["ships"]), "ships,", len(data["combat"]["artillery"]), "artillery,", len(data["combat"]["moraleMods"]), "morale modifiers")
