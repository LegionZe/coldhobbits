/**
 * Monster menu (owner's request 1.0.73): which Monstrous Manual creatures can be eaten, and what eating them does.
 * Structure after Skerples' "Monster Menu" posts (Coins and Scrolls, 2017; `SOURCES`): ordinary meats with a d6 roll (+1 well
 * cooked, -4 rotten; +2 when starving, part 2), intelligent "people", creatures that leave nothing to eat, and special
 * creatures with their own d10 table. The posts carry no licence, so nothing of their text is used (owner's ruling 1.0.73:
 * original AD&D effects and new flavour text): every flavour line and effect here is written for this system, in AD&D
 * terms (the five saving throws, hit points, rounds and turns), and the special creatures share themed tables instead of
 * one table each (implementation choice). Texts are lang keys: AD2E.Menu.Flavour.<creature>, AD2E.Menu.Effect.<table>.<n>.
 * Hand-written data (not generated): edit it here. Creature `match` is a regular expression tried, in list order, on the
 * actor's name in lower case and on its reversed form ("spider, phase" -> "phase spider", curly
 * apostrophes straightened; module/monster-menu.mjs `creatureFor`); the first match wins (so specific entries come before general ones).
 */
export const SOURCES = {
  part1: "https://coinsandscrolls.blogspot.com/2017/07/monster-menu-all-part-1-eating-ad.html",
  part2: "https://coinsandscrolls.blogspot.com/2017/07/monster-menu-all-part-2-veins-of-earth.html",
  hunting: "https://adnd2e.fandom.com/wiki/Hunting_(Proficiency)"
};

/** Roll modifiers on every meat table: well cooked +1, rotten -4 (part 1), starving +2 (part 2). */
export const MODIFIERS = { well: 1, rotten: -4, starving: 2 };

/** Proficiencies a butcher may check with (the best target counts; owner's ruling 1.0.73). */
export const BUTCHER_PROFS = ["hunting", "survival", "cooking"];

/**
 * Rations by size: Complete Barbarian's Handbook Table 33 (module/rules/forage-tables.mjs FORAGE.hunting.rations, S-H)
 * plus Tiny and Gargantuan, which the table does not list (implementation choice: Tiny 1 ration, Gargantuan twice Huge).
 */
export const EXTRA_RATIONS = { T: { average: "1", rending: "1" }, G: { average: "2d7+16", rending: "2d11+28" } };

/** Keeping meat (implementation choices): fresh for 2 days, salted or smoked for 30 days; rotten after that. */
export const KEEP = { freshDays: 2, preservedDays: 30 };

/** The meat item's identifier: one day of food a unit (module/travel-days.mjs rationDays). */
export const MEAT_ID = "monster-meat";

export const CATEGORIES = ["normal", "rare", "vermin", "people", "special", "inedible"];

/** Save keys: par = paralyzation, poison or death magic; rsw = rod, staff or wand; pet = petrification or polymorph;
 * br = breath weapon; sp = spell (PHB Table 60). */

/** Ordinary meat (every creature not on a themed table): d6. */
export const NORMAL = { die: 6, results: [
  { range: [-10, 1], save: "par", lost: true },
  { range: [2, 5] },
  { range: [6, 20], heal: "1" }
] };

/**
 * Themed d10 tables for special creatures. Result fields: range [low, high] (modified rolls outside 1-10 use the end
 * ranges), save (key above; failing it brings the damage, success halves it when `half`), damage (formula), heal (formula),
 * lost (the meal does not count as food), plus the text AD2E.Menu.Effect.<table>.<index>.
 */
export const THEMES = {
  beast: { die: 10, results: [
    { range: [-10, 1], save: "par", lost: true },
    { range: [2, 8] },
    { range: [9, 20], heal: "1d2" }
  ] },
  draconic: { die: 10, results: [
    { range: [-10, 2], save: "br", damage: "1d6", half: true },
    { range: [3, 8] },
    { range: [9, 9] },
    { range: [10, 20], heal: "1d6" }
  ] },
  petrifying: { die: 10, results: [
    { range: [-10, 1], save: "pet" },
    { range: [2, 9] },
    { range: [10, 20] }
  ] },
  aberrant: { die: 10, results: [
    { range: [-10, 2], save: "sp" },
    { range: [3, 8] },
    { range: [9, 9] },
    { range: [10, 20] }
  ] },
  ooze: { die: 10, results: [
    { range: [-10, 3], save: "par", damage: "2d6", lost: true },
    { range: [4, 9] },
    { range: [10, 20] }
  ] },
  fungal: { die: 10, results: [
    { range: [-10, 2], save: "par", damage: "1d6" },
    { range: [3, 9] },
    { range: [10, 20], heal: "1" }
  ] },
  undead: { die: 10, results: [
    { range: [-10, 2], save: "par", damage: "1d6", lost: true },
    { range: [3, 9], lost: true },
    { range: [10, 20] }
  ] },
  celestial: { die: 10, results: [
    { range: [-10, 3], save: "sp" },
    { range: [4, 9] },
    { range: [10, 20], heal: "1d4" }
  ] },
  fey: { die: 10, results: [
    { range: [-10, 3], save: "sp" },
    { range: [4, 8] },
    { range: [9, 20], heal: "1" }
  ] },
  venomous: { die: 10, results: [
    { range: [-10, 3], save: "par", damage: "2d4" },
    { range: [4, 9] },
    { range: [10, 20] }
  ] },
  paralytic: { die: 10, results: [
    { range: [-10, 3], save: "par" },
    { range: [4, 9] },
    { range: [10, 20] }
  ] },
  regenerating: { die: 10, results: [
    { range: [-10, 2], save: "par", damage: "1d4", lost: true },
    { range: [3, 8] },
    { range: [9, 20], heal: "1d4" }
  ] },
  shapechanger: { die: 10, results: [
    { range: [-10, 1], save: "pet" },
    { range: [2, 9] },
    { range: [10, 20] }
  ] },
  parasite: { die: 10, results: [
    { range: [-10, 3], save: "par", damage: "1d4" },
    { range: [4, 20] }
  ] },
  flickering: { die: 10, results: [
    { range: [-10, 1], save: "sp" },
    { range: [2, 9] },
    { range: [10, 20] }
  ] },
  fiery: { die: 10, results: [
    { range: [-10, 3], save: "br", damage: "1d6", half: true },
    { range: [4, 9] },
    { range: [10, 20] }
  ] },
  foul: { die: 10, results: [
    { range: [-10, 4], save: "par", lost: true },
    { range: [5, 20], lost: true }
  ] }
};

/**
 * Creatures in match order: key (flavour lang key), match (regex source on the lower-case name), category, theme (special
 * creatures). Names after the Monstrous Manual; categories after part 1 of the posts, adjusted where AD&D 2e differs
 * (implementation choices: skeletons, iron and stone golems, gargoyles and xorn have no flesh to eat; ettins are people).
 */
export const CREATURES = [
  // Nothing to eat: extraplanar, incorporeal, or not flesh.
  { key: "extraplanar", match: "\\b(tanar'?ri|demon|baatezu|devil|yugoloth|daemon|djinn|efreet|elemental|aerial servant|invisible stalker|imp|quasit|hell ?hound|nightmare|night hag|titan|wind walker|water weird|thought eater)\\b", category: "inedible" },
  { key: "incorporeal", match: "\\b(ghost|banshee|groaning spirit|spectre|specter|shadow|wraith|will o'? ?(the )?wisp|haunt|poltergeist|phantom)\\b", category: "inedible" },
  { key: "bones", match: "\\b(skeleton|golem, (iron|stone)|(iron|stone) golem|gargoyle|xorn)\\b", category: "inedible" },
  // Special creatures.
  { key: "basilisk", match: "\\bbasilisk\\b", category: "special", theme: "petrifying" },
  { key: "cockatrice", match: "\\bcockatrice\\b", category: "special", theme: "petrifying" },
  { key: "gorgon", match: "\\bgorgon\\b", category: "special", theme: "petrifying" },
  { key: "medusa", match: "\\bmedusa\\b", category: "special", theme: "petrifying" },
  { key: "beholder", match: "\\b(beholder|eye tyrant)\\b", category: "special", theme: "aberrant" },
  { key: "floatingEye", match: "\\b(floating eye|eye, floating|eye of the deep)\\b", category: "special", theme: "aberrant" },
  { key: "mindFlayer", match: "\\b(mind flayer|illithid)\\b", category: "special", theme: "aberrant" },
  { key: "brainEater", match: "\\b(intellect devourer|brain mole|cerebral parasite|morkoth)\\b", category: "special", theme: "aberrant" },
  { key: "umberHulk", match: "\\bumber hulk\\b", category: "special", theme: "aberrant" },
  { key: "ooze", match: "\\b(black pudding|pudding|gelatinous cube|gr[ae]y ooze|ooze|ochre jelly|jelly|green slime|slime|slithering tracker)\\b", category: "special", theme: "ooze" },
  { key: "fungus", match: "\\b(violet fung|fungus|fungi|shrieker|gas spore|mold|mould|shambling mound|myconid)", category: "special", theme: "fungal" },
  { key: "ghoul", match: "\\b(ghoul|ghast)\\b", category: "special", theme: "paralytic" },
  { key: "carrionCrawler", match: "\\bcarrion crawler\\b", category: "special", theme: "paralytic" },
  { key: "undead", match: "\\b(mummy|vampire|wight|lich|zombie|golem, flesh|flesh golem|revenant|crypt thing)\\b", category: "special", theme: "undead" },
  { key: "smallDragon", match: "\\b(pseudo-?dragon|faerie dragon|dragonet)\\b", category: "special", theme: "draconic" },
  { key: "dragon", match: "\\b(dragon turtle|dragon|dracolisk)\\b", category: "special", theme: "draconic" },
  { key: "chimera", match: "\\b(chimera|dragonne)\\b", category: "special", theme: "draconic" },
  { key: "wyvern", match: "\\bwyvern\\b", category: "special", theme: "venomous" },
  { key: "manticore", match: "\\bmanticore\\b", category: "special", theme: "venomous" },
  { key: "purpleWorm", match: "\\bpurple worm\\b", category: "special", theme: "venomous" },
  { key: "catoblepas", match: "\\bcatoblepas\\b", category: "special", theme: "venomous" },
  { key: "troll", match: "\\btroll\\b", category: "special", theme: "regenerating" },
  { key: "hydra", match: "\\bhydra\\b", category: "special", theme: "regenerating" },
  { key: "celestial", match: "\\b(couatl|ki-?rin|lammasu|shedu|unicorn|pegasus|sphinx|androsphinx|gynosphinx|asura|aasimon|deva|planetar)\\b", category: "special", theme: "celestial" },
  { key: "fey", match: "\\b(dryad|treant|pixie|sprite|nixie|leprechaun|sylph|nymph|brownie|satyr|korred)\\b", category: "special", theme: "fey" },
  { key: "shapechanger", match: "\\b(doppleganger|doppelganger|mimic|rakshasa|jackalwere|werewolf|wererat|wereboar|werebear|weretiger|werefox|lycanthrope|wolfwere)\\b", category: "special", theme: "shapechanger" },
  { key: "parasite", match: "\\b(rot grub|ear seeker|stirge|leech)\\b", category: "special", theme: "parasite" },
  { key: "displacer", match: "\\b(displacer beast|blink dog|phase spider)\\b", category: "special", theme: "flickering" },
  { key: "fiery", match: "\\b(salamander|remorhaz|fire snake|firenewt)\\b", category: "special", theme: "fiery" },
  { key: "foul", match: "\\b(harpy|otyugh|neo-?otyugh|peryton|carrion|vulture)\\b", category: "special", theme: "foul" },
  { key: "rustMonster", match: "\\brust monster\\b", category: "special", theme: "beast" },
  { key: "magicalBeast", match: "\\b(bulette|griffon|gryphon|hippogriff|hippocampus|owlbear|piercer|roper|trapper|lurker|strangle ?weed|su-monster|yeti|ankheg|anhkheg|behir)\\b", category: "special", theme: "beast" },
  { key: "jellyfish", match: "\\b(man-?o-?war|jellyfish)\\b", category: "special", theme: "venomous" },
  // People: intelligent creatures.
  { key: "giant", match: "\\b(giant, (hill|stone|frost|fire|cloud|storm)|(hill|stone|frost|fire|cloud|storm) giant|ettin|cyclops|fomorian)\\b", category: "people" },
  { key: "ogre", match: "\\bogre\\b", category: "people" },
  { key: "goblinoid", match: "\\b(goblin|hobgoblin|bugbear|orc|kobold|gnoll|norker|xvart)\\b", category: "people" },
  { key: "reptilePeople", match: "\\b(lizard ?man|lizard ?folk|troglodyte|lamia|naga|yuan-?ti|kuo-?toa)\\b", category: "people" },
  { key: "fishPeople", match: "\\b(sahuagin|locathah|merm[ae]n|merfolk|triton|ixitxachitl|sea hag)\\b", category: "people" },
  { key: "beastPeople", match: "\\b(centaur|minotaur)\\b", category: "people" },
  { key: "demihuman", match: "\\b(elf|elves|drow|dwarf|dwarves|gnome|halfling|human|man|men|bandit|brigand|mercenary|soldier|merchant|pilgrim|nomad|pirate|buccaneer|berserker|dervish|hireling|guard)\\b", category: "people" },
  // Insects and other vermin.
  { key: "insect", match: "\\b(ant|beetle|wasp|hornet|scorpion|spider|tick|centipede|bee|fly|mosquito|termite)s?\\b", category: "vermin" },
  { key: "shellfish", match: "\\b(crab|crayfish|lobster|shrimp|slug|snail|larva|worm)s?\\b", category: "vermin" },
  // Rare meats: big game, predators, beasts few people eat.
  { key: "bigGame", match: "\\b(elephant|mammoth|mastodon|rhinoceros|hippopotamus|baluchitherium|titanothere|dinosaur|tyrannosaurus|triceratops|brontosaurus)\\b", category: "rare" },
  { key: "predator", match: "\\b(lion|tiger|leopard|jaguar|panther|lynx|cat|wolf|wolves|jackal|hyena|dog|bear|badger|wolverine|ape|baboon|gorilla|skunk|porcupine)s?\\b", category: "rare" },
  { key: "bigBird", match: "\\b(roc|eagle|axe ?beak|ostrich|emu|flightless bird|hawk|falcon)s?\\b", category: "rare" },
  { key: "seaHorse", match: "\\bsea ?horse\\b", category: "rare" },
  // Normal meats.
  { key: "fish", match: "\\b(fish|barracuda|gar|pike|eel|lamprey|shark|ray|masher|carp|trout|piranha)s?\\b", category: "normal" },
  { key: "seaMammal", match: "\\b(whale|dolphin|seal|sea ?lion|otter|walrus|beaver)s?\\b", category: "normal" },
  { key: "reptile", match: "\\b(crocodile|alligator|lizard|snake|serpent|turtle|tortoise|frog|toad)s?\\b", category: "normal" },
  { key: "cephalopod", match: "\\b(squid|octopus)\\b", category: "normal" },
  { key: "beef", match: "\\b(cattle|bull|cow|ox|oxen|buffalo|bison|yak|aurochs|herd animal)\\b", category: "normal" },
  { key: "mutton", match: "\\b(goat|ram|sheep)s?\\b", category: "normal" },
  { key: "pork", match: "\\b(boar|pig|swine|warthog|rat|weasel)s?\\b", category: "normal" },
  { key: "venison", match: "\\b(deer|stag|elk|moose|antelope|irish deer)\\b", category: "normal" },
  { key: "horse", match: "\\b(horse|mule|pony|donkey|camel)s?\\b", category: "normal" },
  { key: "fowl", match: "\\b(owl|bird|chicken|duck|goose|swan)s?\\b", category: "normal" }
];

/** Meat of a creature not on the list: normal (implementation choice; the GM can set another category on the monster). */
export const DEFAULT_ENTRY = { key: "unknown", category: "normal" };
