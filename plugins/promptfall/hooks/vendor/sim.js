// packages/sim/src/battle.ts
var TICK_MS = 2e3;
var STEP_MS = 100;
var GAUGE_FULL = 1e4;
var ACTION_STEPS = 5;
var FILL_K = 10;
var FILL_BP = 16667;
var POWER_BP = 2e4;
var SPAWN_GAUGE_MAX = 5e3;
function fill(spd) {
  return Math.max(1, Math.floor((spd + FILL_K) * FILL_BP / 1e3));
}
function scaled(raw, powerBp = POWER_BP) {
  return Math.max(1, Math.floor(raw * powerBp / 1e4));
}

// packages/sim/src/content/affixes.ts
var W = ["weapon"];
var A = ["armour"];
var X = ["accessory"];
var WX = ["weapon", "accessory"];
var AX = ["armour", "accessory"];
var ALL = ["weapon", "armour", "accessory"];
var LIST = [
  { id: "keen", name: "Keen", slots: WX, stat: "atk", range: [1, 2] },
  { id: "brutal", name: "Brutal", slots: W, stat: "atk", range: [2, 4] },
  { id: "vicious", name: "Vicious", slots: W, stat: "atk", range: [3, 7] },
  { id: "tempered", name: "Tempered", slots: W, stat: "def", range: [1, 2] },
  { id: "swift", name: "Swift", slots: ALL, stat: "spd", range: [1, 1] },
  { id: "hasty", name: "Hasty", slots: WX, stat: "spd", range: [1, 2] },
  { id: "vital", name: "Vital", slots: ALL, stat: "hp", range: [3, 10] },
  { id: "hearty", name: "Hearty", slots: AX, stat: "hp", range: [8, 22] },
  { id: "sturdy", name: "Sturdy", slots: AX, stat: "def", range: [1, 2] },
  { id: "warded", name: "Warded", slots: A, stat: "def", range: [2, 5] },
  { id: "bulwark", name: "Bulwark", slots: A, stat: "def", range: [3, 7] },
  { id: "nimble", name: "Nimble", slots: A, stat: "spd", range: [1, 1] },
  { id: "thorned", name: "Thorned", slots: A, stat: "atk", range: [1, 2] },
  { id: "lucky", name: "Lucky", slots: X, stat: "spd", range: [1, 2] },
  { id: "mighty", name: "Mighty", slots: X, stat: "atk", range: [2, 5] },
  { id: "guardian", name: "Guardian", slots: X, stat: "def", range: [2, 5] },
  { id: "lifebound", name: "Lifebound", slots: W, stat: "hp", range: [5, 15] }
];
var affixes = Object.fromEntries(LIST.map((a) => [a.id, a]));

// packages/sim/src/content/enemies.ts
var ARCHETYPES = {
  brute: { hpBp: 12e3, atkBp: 11e3, defBp: 9e3, spd: 3 },
  swift: { hpBp: 8e3, atkBp: 1e4, defBp: 7e3, spd: 8 },
  tank: { hpBp: 14e3, atkBp: 8e3, defBp: 13e3, spd: 2 },
  caster: { hpBp: 9e3, atkBp: 12500, defBp: 8e3, spd: 6 },
  boss: { hpBp: 7e4, atkBp: 2e4, defBp: 12e3, spd: 5 },
  turn_boss: { hpBp: 3e4, atkBp: 12e3, defBp: 11e3, spd: 5 }
};
var ENEMY_TUNING = {
  zone1: { hp: 90, atk: 8, def: 4, xp: 5, goldMin: 1, goldMax: 3 },
  growthBp: { hp: 12750, atk: 13e3, def: 13e3, xp: 11300, gold: 11300 },
  zoneAtkBp: [10800, 8500, 8350, 6750, 7050, 6650, 5500, 6700, 9100, 8100, 7300, 6650],
  zoneHpBp: [5650, 5650, 5650, 5650, 5650, 5650, 4500, 4500, 3400, 3150, 3850, 4750],
  zoneXpBp: [13e3, 13e3, 13e3, 13e3, 13e3, 13e3, 13e3, 13e3, 13e3, 13e3, 13e3, 13e3]
};
function grow(value, bp, steps) {
  let v = value * 1e4;
  for (let i = 0; i < steps; i++) v = Math.floor(v * bp / 1e4);
  return Math.max(1, Math.floor(v / 1e4));
}
function baseline(t, z) {
  const { zone1, growthBp } = t;
  return {
    hp: Math.floor(grow(zone1.hp, growthBp.hp, z) * (t.zoneHpBp[z] ?? 1e4) / 1e4),
    atk: Math.floor(grow(zone1.atk, growthBp.atk, z) * (t.zoneAtkBp[z] ?? 1e4) / 1e4),
    def: grow(zone1.def, growthBp.def, z),
    xp: Math.floor(grow(zone1.xp, growthBp.xp, z) * (t.zoneXpBp[z] ?? 1e4) / 1e4),
    goldMin: grow(zone1.goldMin, growthBp.gold, z),
    goldMax: grow(zone1.goldMax, growthBp.gold, z)
  };
}
var ROSTERS = [
  [
    ["road_slime", "Road Slime", "tank"],
    ["field_rat", "Field Rat", "swift"],
    ["goblin_scout", "Goblin Scout", "brute"],
    ["hedge_sprite", "Hedge Sprite", "caster"],
    ["bandit_captain", "Bandit Captain", "boss"],
    ["wild_boar", "Wild Boar", "turn_boss"]
  ],
  [
    ["bramble_wolf", "Bramble Wolf", "swift"],
    ["moss_golem", "Moss Golem", "tank"],
    ["wood_goblin", "Wood Goblin", "brute"],
    ["whisper_wisp", "Whisper Wisp", "caster"],
    ["elder_treant", "Elder Treant", "boss"],
    ["owlbear_cub", "Owlbear Cub", "turn_boss"]
  ],
  [
    ["bog_lurker", "Bog Lurker", "brute"],
    ["marsh_leech", "Marsh Leech", "swift"],
    ["mire_toad", "Mire Toad", "tank"],
    ["will_o_wisp", "Will-o'-Wisp", "caster"],
    ["sigh_hag", "The Sighing Hag", "boss"],
    ["giant_heron", "Giant Heron", "turn_boss"]
  ],
  [
    ["barrow_wight", "Barrow Wight", "caster"],
    ["grave_hound", "Grave Hound", "swift"],
    ["bone_soldier", "Bone Soldier", "brute"],
    ["cairn_crawler", "Cairn Crawler", "tank"],
    ["barrow_king", "The Barrow King", "boss"],
    ["crypt_ogre", "Crypt Ogre", "turn_boss"]
  ],
  [
    ["salt_crab", "Salt Crab", "tank"],
    ["gull_harpy", "Gull Harpy", "swift"],
    ["drowned_sailor", "Drowned Sailor", "brute"],
    ["tide_witch", "Tide Witch", "caster"],
    ["glass_leviathan", "Glass Leviathan", "boss"],
    ["reef_troll", "Reef Troll", "turn_boss"]
  ],
  [
    ["ember_imp", "Ember Imp", "swift"],
    ["magma_beetle", "Magma Beetle", "tank"],
    ["cinder_orc", "Cinder Orc", "brute"],
    ["flame_adept", "Flame Adept", "caster"],
    ["emberfall_wyrm", "Emberfall Wyrm", "boss"],
    ["slag_giant", "Slag Giant", "turn_boss"]
  ],
  [
    ["frost_wolf", "Frost Wolf", "swift"],
    ["ice_troll", "Ice Troll", "brute"],
    ["rime_golem", "Rime Golem", "tank"],
    ["snow_shaman", "Snow Shaman", "caster"],
    ["frostvein_yeti", "Frostvein Yeti", "boss"],
    ["avalanche_drake", "Avalanche Drake", "turn_boss"]
  ],
  [
    ["drowned_monk", "Drowned Monk", "brute"],
    ["abbey_gargoyle", "Abbey Gargoyle", "tank"],
    ["bell_wraith", "Bell Wraith", "caster"],
    ["eel_serpent", "Eel Serpent", "swift"],
    ["sunken_abbot", "The Sunken Abbot", "boss"],
    ["choir_of_bones", "Choir of Bones", "turn_boss"]
  ],
  [
    ["ash_ghoul", "Ash Ghoul", "brute"],
    ["dust_stalker", "Dust Stalker", "swift"],
    ["cinder_colossus", "Cinder Colossus", "tank"],
    ["ash_oracle", "Ash Oracle", "caster"],
    ["waste_tyrant", "Tyrant of the Waste", "boss"],
    ["sand_basilisk", "Sand Basilisk", "turn_boss"]
  ],
  [
    ["star_sentinel", "Star Sentinel", "tank"],
    ["comet_hound", "Comet Hound", "swift"],
    ["spire_warden", "Spire Warden", "brute"],
    ["astral_seer", "Astral Seer", "caster"],
    ["fallen_star", "The Fallen Star", "boss"],
    ["void_manta", "Void Manta", "turn_boss"]
  ],
  [
    ["hollow_knight", "Hollow Knight", "brute"],
    ["court_jester", "Court Jester", "swift"],
    ["throne_guard", "Throne Guard", "tank"],
    ["court_mage", "Court Mage", "caster"],
    ["hollow_king", "The Hollow King", "boss"],
    ["royal_chimera", "Royal Chimera", "turn_boss"]
  ],
  [
    ["ink_horror", "Ink Horror", "brute"],
    ["blank_page", "Blank Page", "swift"],
    ["quill_golem", "Quill Golem", "tank"],
    ["erased_scribe", "Erased Scribe", "caster"],
    ["unwritten_one", "The Unwritten One", "boss"],
    ["margin_beast", "Margin Beast", "turn_boss"]
  ]
];
var GLYPHS = {
  brute: "B",
  swift: "s",
  tank: "T",
  caster: "c",
  boss: "\u03A9",
  turn_boss: "\u03A8"
};
function kindOf(archetype) {
  if (archetype === "boss") return "zone_boss";
  if (archetype === "turn_boss") return "turn_boss";
  return "wave";
}
function scale(value, bp) {
  return Math.max(1, Math.floor(value * bp / 1e4));
}
function enemyOf([id, name, archetype], zone, b, spdZone) {
  const a = ARCHETYPES[archetype];
  const kind = kindOf(archetype);
  const stats = {
    hp: scale(b.hp, a.hpBp),
    atk: scale(b.atk, a.atkBp),
    def: scale(b.def, a.defBp),
    spd: a.spd + Math.floor(spdZone / 3)
  };
  const bossMult = kind === "zone_boss" ? 8 : kind === "turn_boss" ? 4 : 1;
  return {
    id,
    name,
    glyph: GLYPHS[archetype],
    zone,
    kind,
    archetype,
    stats,
    xp: b.xp * bossMult,
    gold: [b.goldMin * bossMult, b.goldMax * bossMult],
    dropBp: kind === "zone_boss" ? 1e4 : kind === "turn_boss" ? 6e3 : 1500,
    contractBp: kind === "zone_boss" ? 1500 : kind === "turn_boss" ? 400 : 0
  };
}
function buildEnemies(t) {
  const out = {};
  ROSTERS.forEach((roster, i) => {
    const b = baseline(t, i);
    for (const entry of roster) out[entry[0]] = enemyOf(entry, i + 1, b, i + 1);
  });
  return out;
}
var TIER_GROWTH_BP = [11325, 10400];
function growThrough(value, bps) {
  let v = value * 1e4;
  for (const bp of bps) v = Math.floor(v * bp / 1e4);
  return Math.max(1, Math.floor(v / 1e4));
}
function buildTierEnemies(t, growthBp, last) {
  const top = ROSTERS.length;
  const b12 = baseline(t, top - 1);
  const out = {};
  const steps = [];
  for (let zone = top + 1; zone <= last; zone++) {
    const tier = Math.floor((zone - 1) / top) + 1;
    const bp = growthBp[tier - 2] ?? growthBp[growthBp.length - 1];
    if (bp === void 0) throw new Error(`no tier growth for zone ${zone}`);
    steps.push(bp);
    const b = {
      hp: growThrough(b12.hp, steps),
      atk: growThrough(b12.atk, steps),
      def: growThrough(b12.def, steps),
      xp: growThrough(b12.xp, steps),
      goldMin: growThrough(b12.goldMin, steps),
      goldMax: growThrough(b12.goldMax, steps)
    };
    const at = {};
    for (const roster of ROSTERS)
      for (const entry of roster) at[entry[0]] = enemyOf(entry, zone, b, top);
    out[zone] = at;
  }
  return out;
}
var enemies = buildEnemies(ENEMY_TUNING);
var zoneRosters = ROSTERS.map((r) => r.map(([id]) => id));

// packages/sim/src/content/epithets.ts
var epithets = [
  "the Steadfast",
  "the Quiet",
  "the Gentle",
  "the Bold",
  "the Wanderer",
  "the Unbroken",
  "the Lantern",
  "the Grey",
  "the Swift",
  "the Patient",
  "the Unready",
  "the Kind",
  "the Restless",
  "the Lucky",
  "the Stubborn",
  "the Far-Sighted",
  "of the Marsh",
  "of the Long Road",
  "of the Ninth Bell",
  "of Hollow Hill",
  "the Ember",
  "the Thorn",
  "the Lark",
  "the Owl",
  "the Mender",
  "the Last",
  "the Ashen",
  "the Bright",
  "the Faithful",
  "the Wry",
  "the Stormborn",
  "the Merciful",
  "the Silent",
  "the Laughing",
  "the Twice-Lost",
  "the Oathkeeper",
  "the Tidewalker",
  "the Hearthless",
  "the Starward",
  "the Unwritten",
  "the Mossback",
  "the Saltblood"
];

// packages/sim/src/content/expansions.ts
var expansions = {
  inventory: { step: 10, max: 90, costs: [500, 1e3, 2e3, 4e3, 8e3, 16e3] },
  roster: { step: 4, max: 48, costs: [400, 800, 1600, 3200, 6400, 12800] }
};

// packages/sim/src/content/heroes.ts
var heroTemplates = {
  knight_1: {
    id: "knight_1",
    name: "Aldric",
    cls: "knight",
    glyph: "\u265E",
    base: { hp: 60, atk: 9, def: 6, spd: 4 },
    growth: { hp: 9, atk: 2, def: 2, spd: 0 }
  },
  black_mage_1: {
    id: "black_mage_1",
    name: "Morwen",
    cls: "black_mage",
    glyph: "\u2736",
    base: { hp: 36, atk: 11, def: 2, spd: 5 },
    growth: { hp: 5, atk: 3, def: 1, spd: 0 }
  },
  white_mage_1: {
    id: "white_mage_1",
    name: "Selene",
    cls: "white_mage",
    glyph: "\u271A",
    base: { hp: 40, atk: 8, def: 3, spd: 6 },
    growth: { hp: 6, atk: 2, def: 1, spd: 0 }
  },
  archer_1: {
    id: "archer_1",
    name: "Kestrel",
    cls: "archer",
    glyph: "\u27B6",
    base: { hp: 44, atk: 11, def: 3, spd: 7 },
    growth: { hp: 6, atk: 3, def: 1, spd: 0 }
  }
};

// packages/sim/src/content/items.ts
var K = ["knight"];
var BM = ["black_mage"];
var WM = ["white_mage"];
var AR = ["archer"];
var MAGES = ["black_mage", "white_mage"];
var ALL2 = ["knight", "black_mage", "white_mage", "archer"];
function base(id, name, glyph, slot, classes, stats, minZone) {
  return { id, name, glyph, slot, classes, stats, minZone };
}
var LIST2 = [
  // Knight weapons
  base("iron_sword", "Iron Sword", "/", "weapon", K, { atk: 4, def: 1 }, 1),
  base("bronze_axe", "Bronze Axe", "/", "weapon", K, { atk: 5 }, 1),
  base("steel_longsword", "Steel Longsword", "/", "weapon", K, { atk: 11 }, 4),
  base("mithril_blade", "Mithril Blade", "/", "weapon", K, { atk: 23, spd: 1 }, 7),
  base("dragonfang", "Dragonfang", "/", "weapon", K, { atk: 42 }, 10),
  // Black Mage weapons
  base("oak_staff", "Oak Staff", "|", "weapon", BM, { atk: 5 }, 1),
  base("ember_rod", "Ember Rod", "|", "weapon", BM, { atk: 4, spd: 1 }, 1),
  base("rune_staff", "Rune Staff", "|", "weapon", BM, { atk: 12 }, 4),
  base("storm_rod", "Storm Rod", "|", "weapon", BM, { atk: 24, spd: 1 }, 7),
  base("void_scepter", "Void Scepter", "|", "weapon", BM, { atk: 45 }, 10),
  // White Mage weapons
  base("willow_staff", "Willow Staff", "|", "weapon", WM, { atk: 4, hp: 4 }, 1),
  base("healers_mace", "Healer's Mace", "!", "weapon", WM, { atk: 4, def: 1 }, 1),
  base("silver_crook", "Silver Crook", "|", "weapon", WM, { atk: 10, hp: 10 }, 4),
  base("sacred_mace", "Sacred Mace", "!", "weapon", WM, { atk: 21, def: 4 }, 7),
  base("seraph_staff", "Seraph Staff", "|", "weapon", WM, { atk: 38, hp: 40 }, 10),
  // Archer weapons
  base("oak_bow", "Oak Bow", ")", "weapon", AR, { atk: 5 }, 1),
  base("short_bow", "Short Bow", ")", "weapon", AR, { atk: 4, spd: 1 }, 1),
  base("longbow", "Longbow", ")", "weapon", AR, { atk: 12 }, 4),
  base("elven_bow", "Elven Bow", ")", "weapon", AR, { atk: 24, spd: 1 }, 7),
  base("starshot_bow", "Starshot Bow", ")", "weapon", AR, { atk: 44 }, 10),
  // Heavy armour
  base("chainmail", "Chainmail", "[", "armour", K, { def: 3, hp: 8 }, 1),
  base("bronze_plate", "Bronze Plate", "[", "armour", K, { def: 4, hp: 6 }, 1),
  base("steel_plate", "Steel Plate", "[", "armour", K, { def: 9, hp: 25 }, 4),
  base("mithril_mail", "Mithril Mail", "[", "armour", K, { def: 18, hp: 60 }, 7),
  base("dragon_plate", "Dragon Plate", "[", "armour", K, { def: 32, hp: 120 }, 10),
  // Robes
  base("cloth_robe", "Cloth Robe", "(", "armour", MAGES, { def: 1, hp: 8 }, 1),
  base("silk_robe", "Silk Robe", "(", "armour", MAGES, { def: 2, hp: 5, spd: 1 }, 1),
  base("mystic_robe", "Mystic Robe", "(", "armour", MAGES, { def: 5, hp: 22 }, 4),
  base("sage_robe", "Sage Robe", "(", "armour", MAGES, { def: 11, hp: 50 }, 7),
  base("astral_robe", "Astral Robe", "(", "armour", MAGES, { def: 20, hp: 100 }, 10),
  // Light armour
  base("leather_vest", "Leather Vest", "[", "armour", AR, { def: 2, hp: 7 }, 1),
  base("hide_coat", "Hide Coat", "[", "armour", AR, { def: 3, hp: 5 }, 1),
  base("ranger_garb", "Ranger Garb", "[", "armour", AR, { def: 7, hp: 22, spd: 1 }, 4),
  base("shadow_leather", "Shadow Leather", "[", "armour", AR, { def: 14, hp: 50 }, 7),
  base("wind_cloak", "Wind Cloak", "[", "armour", AR, { def: 25, hp: 100, spd: 1 }, 10),
  // Accessories
  base("copper_ring", "Copper Ring", "=", "accessory", ALL2, { atk: 1, hp: 4 }, 1),
  base("bone_charm", "Bone Charm", '"', "accessory", ALL2, { def: 1, hp: 6 }, 1),
  base("silver_amulet", "Silver Amulet", '"', "accessory", ALL2, { atk: 4, hp: 15 }, 4),
  base("gold_bangle", "Gold Bangle", "=", "accessory", ALL2, { def: 6, hp: 35, spd: 1 }, 7),
  base("phoenix_pendant", "Phoenix Pendant", '"', "accessory", ALL2, { atk: 14, hp: 80 }, 10)
];
var itemBases = Object.fromEntries(LIST2.map((b) => [b.id, b]));

// packages/sim/src/content/rarity.ts
var rarity = {
  common: {
    affixCount: 0,
    traitCount: 0,
    levelCap: 20,
    statMultBp: 1e4,
    vendorGoldPerZone: 2,
    reforgeCost: 10
  },
  uncommon: {
    affixCount: 1,
    traitCount: 1,
    levelCap: 30,
    statMultBp: 11e3,
    vendorGoldPerZone: 5,
    reforgeCost: 25
  },
  rare: {
    affixCount: 2,
    traitCount: 2,
    levelCap: 40,
    statMultBp: 12e3,
    vendorGoldPerZone: 15,
    reforgeCost: 60
  },
  epic: {
    affixCount: 3,
    traitCount: 3,
    levelCap: 45,
    statMultBp: 13500,
    vendorGoldPerZone: 40,
    reforgeCost: 150
  },
  legendary: {
    affixCount: 4,
    traitCount: 4,
    levelCap: 50,
    statMultBp: 15e3,
    vendorGoldPerZone: 100,
    reforgeCost: 400
  }
};

// packages/sim/src/content/tactics.ts
var ENEMY_ATTACK = [
  // A knight weighs 11 against 2 for any other hero: 11/15 ≈ 73% with a full party, today's pull.
  {
    action: "attack",
    weight: { kind: "fixed", weight: 10 },
    target: { kind: "class", cls: "knight", match: 11, other: 2 }
  }
];
var heroTactics = {
  knight: [
    {
      action: "attack",
      weight: { kind: "fixed", weight: 10 },
      target: { kind: "front", front: 3, other: 1 }
    }
  ],
  black_mage: [
    { action: "attack_all", weight: { kind: "fixed", weight: 10 }, target: { kind: "none" } }
  ],
  white_mage: [
    {
      action: "attack",
      weight: { kind: "fixed", weight: 10 },
      target: { kind: "weakest", weakest: 1, other: 0 }
    },
    // Alone she only fights: healing herself could outlast the enemy forever.
    {
      action: "heal",
      weight: { kind: "ally_need", belowBp: 5e3, scale: 30 },
      target: { kind: "ally_lowest" },
      minAllies: 2
    }
  ],
  archer: [
    {
      action: "attack",
      weight: { kind: "fixed", weight: 10 },
      target: { kind: "weakest", weakest: 4, other: 1 }
    }
  ]
};
var enemyTactics = {
  brute: ENEMY_ATTACK,
  swift: ENEMY_ATTACK,
  tank: ENEMY_ATTACK,
  caster: ENEMY_ATTACK,
  boss: ENEMY_ATTACK,
  turn_boss: ENEMY_ATTACK,
  world_boss: ENEMY_ATTACK
};
var tactics = { heroes: heroTactics, enemies: enemyTactics };

// packages/sim/src/content/tavern.ts
var tavern = {
  baseCost: 200,
  costGrowthBp: 1500,
  odds: { common: 6e3, uncommon: 2800, rare: 950, epic: 200, legendary: 50 }
};

// packages/sim/src/content/tiers.ts
var itemTierMultBp = [1e4, 2e4, 35e3, 6e4, 1e5, 16e4];
var ZONES_PER_ITEM_TIER = 3;

// packages/sim/src/content/traits.ts
var traits = {
  stalwart: { id: "stalwart", name: "Stalwart", stat: "hp", rangeBp: [500, 1500] },
  hale: { id: "hale", name: "Hale", stat: "hp", rangeBp: [1e3, 2500] },
  fierce: { id: "fierce", name: "Fierce", stat: "atk", rangeBp: [500, 1500] },
  berserker: { id: "berserker", name: "Berserker", stat: "atk", rangeBp: [1e3, 2500] },
  ironhide: { id: "ironhide", name: "Ironhide", stat: "def", rangeBp: [500, 1500] },
  warded: { id: "warded", name: "Warded", stat: "def", rangeBp: [1e3, 2500] },
  fleet: { id: "fleet", name: "Fleet", stat: "spd", rangeBp: [1e3, 2500] },
  quickened: { id: "quickened", name: "Quickened", stat: "spd", rangeBp: [2e3, 4e3] }
};

// packages/sim/src/content/xp.ts
var XP_TO_NEXT = [
  60,
  195,
  388,
  633,
  926,
  1262,
  1640,
  2058,
  2514,
  3007,
  3536,
  4100,
  4697,
  5328,
  5991,
  6686,
  7412,
  8168,
  8954,
  9770,
  10615,
  11489,
  12390,
  13320,
  14277,
  15262,
  16273,
  17311,
  18375,
  19465,
  20581,
  21722,
  22889,
  24080,
  25297,
  26538,
  27803,
  29093,
  30406,
  31743,
  33104,
  34489,
  35896,
  37327,
  38780,
  40257,
  41756,
  43277,
  44821,
  46387
];
function xpToNext(level) {
  return XP_TO_NEXT[Math.min(Math.max(level, 1), XP_TO_NEXT.length) - 1] ?? 0;
}

// packages/sim/src/content/zones.ts
var NAMES = [
  "Greenmeadow Road",
  "Whisperwood",
  "Marsh of Sighs",
  "Old Barrow Hills",
  "Saltglass Coast",
  "Emberfall Caves",
  "Frostvein Pass",
  "Sunken Abbey",
  "Ashen Waste",
  "Starfall Spire",
  "Hollow King's Court",
  "The Unwritten Reach"
];
function weights(zone, boss) {
  const z = zone - 1;
  if (boss) {
    return {
      common: Math.max(1500, 5200 - z * 300),
      uncommon: 3500,
      rare: 1e3 + z * 150,
      epic: 250 + z * 90,
      legendary: 50 + z * 40
    };
  }
  return {
    common: Math.max(2e3, 7e3 - z * 400),
    uncommon: 2200 + z * 150,
    rare: 650 + z * 150,
    epic: 130 + z * 70,
    legendary: 20 + z * 15
  };
}
var zones = NAMES.map((name, i) => {
  const roster = zoneRosters[i] ?? [];
  return {
    index: i + 1,
    name,
    enemies: roster.slice(0, 4),
    boss: roster[4] ?? "",
    turnBoss: roster[5] ?? "",
    rarityWeights: weights(i + 1, false),
    bossRarityWeights: weights(i + 1, true)
  };
});

// packages/sim/src/content/zone.ts
var LADDER_END = 36;
function zoneAt(zone) {
  if (!Number.isInteger(zone) || zone < 1) return void 0;
  const base2 = (zone - 1) % zones.length + 1;
  const def = zones[base2 - 1];
  if (!def) return void 0;
  return { base: base2, tier: Math.floor((zone - 1) / zones.length) + 1, def };
}
var tierEnemies = buildTierEnemies(ENEMY_TUNING, TIER_GROWTH_BP, LADDER_END);
function enemyAt(id, zone) {
  const at = zoneAt(zone);
  if (!at || zone > LADDER_END) return void 0;
  return at.tier === 1 ? enemies[id] : tierEnemies[zone]?.[id];
}
function oddsAt(zone) {
  const at = zoneAt(zone);
  if (!at) return void 0;
  return at.tier === 1 ? at.def : zones[zones.length - 1];
}

// packages/sim/src/content/index.ts
var content = {
  zones,
  enemies,
  itemBases,
  affixes,
  heroTemplates,
  traits,
  epithets,
  rarity,
  tavern,
  expansions,
  tactics,
  xpToNext,
  itemTierMultBp
};

// packages/sim/src/golden.ts
var GOLDEN_BOSS = "wbgold";
var GOLDEN_REWARD = {
  id: "r0",
  base: "steel_longsword",
  rarity: "rare",
  tier: 2,
  affixes: [],
  equippedBy: null,
  tradeableAt: null
};
var GOLDEN_SEED = 20261002;
function goldenEvents(options = {}) {
  const boss = options.boss ?? true;
  const events = [
    { t: "set_party", heroIds: ["h0", "h3", "h2"] },
    { t: "set_farm", on: false },
    { t: "recruit" }
  ];
  for (let turn = 0; events.length < 300; turn++) {
    events.push({ t: "rest" });
    for (let i = 0; i < 12 && events.length < 296; i++) {
      events.push({ t: "tick" });
      if (i % 3 === 0) events.push({ t: "tool_call" });
    }
    events.push({ t: "turn_end" });
    if (boss && turn === 3) {
      events.push({
        t: "boss_engaged",
        bossId: GOLDEN_BOSS,
        name: "Golden Wyrm",
        glyph: "\u2620",
        stats: { hp: 630, atk: 14, def: 4, spd: 5 }
      });
    }
    if (boss && turn === 6) events.push({ t: "boss_disengaged", bossId: GOLDEN_BOSS });
    if (boss && turn === 7) {
      events.push({
        t: "rewarded",
        bossId: GOLDEN_BOSS,
        goods: { kind: "item", item: GOLDEN_REWARD },
        gold: 45
      });
    }
    if (turn === 2) events.push({ t: "equip", heroId: "h0", itemId: "i10" });
    if (turn === 4) events.push({ t: "set_party", heroIds: ["h0", "h1", "h2"] });
    if (turn === 5) events.push({ t: "dismiss", heroId: "h3" });
    if (turn === 6) events.push({ t: "expand_inventory" });
    if (turn === 7) events.push({ t: "set_farm", on: true });
    if (turn === 8) events.push({ t: "vendor", itemId: "i20" });
    if (turn === 9) events.push({ t: "unequip", heroId: "h0", slot: "weapon" });
    if (turn === 10) events.push({ t: "reforge", itemId: "i10", affixIndex: 0 });
    if (turn === 11) events.push({ t: "recruit" });
    if (turn === 12) events.push({ t: "expand_roster" });
    if (turn === 13) {
      for (const heroId of ["h0", "h1", "h2", "h3"])
        events.push({ t: "equip", heroId, itemId: "i9" });
    }
  }
  return events.slice(0, 300);
}
var GOLDEN_HASH = "3d3528f569bd176b";

// packages/sim/src/rng.ts
function nextU32(s) {
  s = s + 1831565813 >>> 0;
  let t = s;
  t = Math.imul(t ^ t >>> 15, t | 1);
  t ^= t + Math.imul(t ^ t >>> 7, t | 61);
  return { s, u: (t ^ t >>> 14) >>> 0 };
}
function roll(state, n) {
  const { s, u } = nextU32(state.rng);
  const bound = Math.max(1, Math.floor(n));
  return { state: { ...state, rng: s }, value: u % bound };
}
function sortedKeys(record) {
  return Object.keys(record).sort(compareCodeUnits);
}
function compareCodeUnits(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}
function pickWeighted(state, weights2) {
  const keys = sortedKeys(weights2);
  let total = 0;
  for (const k of keys) total += Math.max(0, weights2[k]);
  if (total <= 0 || keys.length === 0) {
    throw new Error("pickWeighted: no positive weight");
  }
  const r = roll(state, total);
  let acc = 0;
  for (const k of keys) {
    acc += Math.max(0, weights2[k]);
    if (r.value < acc) return { state: r.state, value: k };
  }
  return { state: r.state, value: keys[keys.length - 1] };
}

// packages/sim/src/hash.ts
function canonicalJson(value) {
  if (value === null) return "null";
  if (Array.isArray(value)) {
    return `[${value.map((v) => v === void 0 ? "null" : canonicalJson(v)).join(",")}]`;
  }
  if (typeof value === "object") {
    const obj = value;
    const parts = [];
    for (const key of Object.keys(obj).sort(compareCodeUnits)) {
      const v = obj[key];
      if (v === void 0) continue;
      parts.push(`${JSON.stringify(key)}:${canonicalJson(v)}`);
    }
    return `{${parts.join(",")}}`;
  }
  return JSON.stringify(value);
}
function fnv1a32(text, offset) {
  let h = offset >>> 0;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h;
}
function hex8(n) {
  return n.toString(16).padStart(8, "0");
}
function hashState(state) {
  const json = canonicalJson(state);
  return hex8(fnv1a32(json, 2166136261)) + hex8(fnv1a32(json, 84696351));
}

// packages/sim/src/progression.ts
function draw(s, n) {
  const { s: next, u } = nextU32(s.rng);
  s.rng = next;
  return u % Math.max(1, Math.floor(n));
}
function drawBp(s) {
  return draw(s, 1e4);
}
function drawWeighted(s, weights2) {
  const r = pickWeighted(s, weights2);
  s.rng = r.state.rng;
  return r.value;
}
function newId(s, prefix) {
  const id = prefix + s.counter.toString(36);
  s.counter += 1;
  return id;
}
var STATS = ["hp", "atk", "def", "spd"];
var SLOTS = ["weapon", "armour", "accessory"];
function heroStats(state, hero) {
  const template = content.heroTemplates[hero.template];
  const stats = { hp: 1, atk: 0, def: 0, spd: 0 };
  const heroMult = content.rarity[hero.rarity].statMultBp;
  if (template) {
    for (const stat of STATS) {
      const raw = template.base[stat] + template.growth[stat] * (hero.level - 1);
      stats[stat] = Math.floor(raw * heroMult / 1e4);
    }
  }
  for (const slot of SLOTS) {
    const itemId = hero.equipment[slot];
    if (!itemId) continue;
    const item = state.inventory.find((i) => i.id === itemId);
    if (!item) continue;
    const base2 = content.itemBases[item.base];
    const mult = content.rarity[item.rarity].statMultBp;
    if (base2) {
      for (const stat of STATS) {
        const v = base2.stats[stat];
        if (v) stats[stat] += Math.floor(v * mult / 1e4);
      }
    }
    for (const affix of item.affixes) {
      const def = content.affixes[affix.id];
      if (def) stats[def.stat] += affixValue(item, affix);
    }
  }
  const pre = { ...stats };
  for (const trait of hero.traits) {
    const def = content.traits[trait.id];
    if (def) stats[def.stat] += Math.floor(pre[def.stat] * trait.valueBp / 1e4);
  }
  stats.hp = Math.max(1, stats.hp);
  return stats;
}
function clampHp(s, hero) {
  hero.hp = Math.max(0, Math.min(hero.hp, heroStats(s, hero).hp));
}
function findHero(s, id) {
  return s.roster.find((h) => h.id === id);
}
function partyHeroes(s) {
  const out = [];
  for (const id of s.party) {
    const hero = findHero(s, id);
    if (hero) out.push(hero);
  }
  return out;
}
function livingParty(s) {
  return partyHeroes(s).filter((h) => h.hp > 0);
}
function healParty(s, bp) {
  for (const hero of partyHeroes(s)) {
    const max = heroStats(s, hero).hp;
    const amount = Math.max(1, Math.floor(max * bp / 1e4));
    hero.hp = hero.hp > 0 ? Math.min(max, hero.hp + amount) : amount;
  }
}
function fullHealParty(s) {
  for (const hero of partyHeroes(s)) hero.hp = heroStats(s, hero).hp;
}
function applyPendingParty(s, effects) {
  if (!s.pendingParty) return;
  s.party = [...s.pendingParty];
  s.pendingParty = null;
  effects.push({ k: "party_applied", heroIds: [...s.party] });
}
function openEncounter(s, waveSize) {
  const encounter = { enemies: [], queue: [], waveSize, spawnedInWave: 0 };
  s.encounter = encounter;
  return encounter;
}
function spawnEnemy(s, encounter, defId, kind) {
  const def = enemyAt(defId, s.zone);
  const hp = def ? def.stats.hp : 1;
  const enemy = { id: newId(s, "e"), def: defId, kind, hp, maxHp: hp };
  encounter.enemies.push(enemy);
  s.battle.gauges.push({ id: enemy.id, g: draw(s, SPAWN_GAUGE_MAX + 1) });
}
function pickWaveEnemy(s) {
  const zone = zoneAt(s.zone)?.def;
  const weights2 = {};
  for (const id of zone?.enemies ?? []) weights2[id] = 1;
  return drawWeighted(s, weights2);
}
function onToolCall(s) {
  s.turnToolCalls += 1;
  if (s.boss) return;
  const encounter = s.encounter ?? openEncounter(s, 1 + draw(s, 3));
  const defId = pickWaveEnemy(s);
  if (encounter.enemies.length < 3) spawnEnemy(s, encounter, defId, "wave");
  else if (encounter.queue.length < 10) encounter.queue.push({ def: defId, kind: "wave" });
}
function onTurnEnd(s) {
  if (s.turnToolCalls >= 10) s.pendingTurnBoss = true;
  s.turnToolCalls = 0;
}
function onRest(s) {
  healParty(s, 5e3);
}
function refillFromQueue(s) {
  const encounter = s.encounter;
  if (!encounter) return;
  while (encounter.enemies.length < 3) {
    const next = encounter.queue.shift();
    if (!next) break;
    spawnEnemy(s, encounter, next.def, next.kind);
  }
}
function spawnOnEmptyTick(s, effects) {
  const zone = zoneAt(s.zone)?.def;
  if (!zone) return;
  if (s.pendingTurnBoss) {
    const encounter2 = s.encounter ?? openEncounter(s, 0);
    spawnEnemy(s, encounter2, zone.turnBoss, "turn_boss");
    s.pendingTurnBoss = false;
    effects.push({ k: "boss_spawned", kind: "turn_boss", def: zone.turnBoss });
    return;
  }
  if (s.wave === 11) {
    const encounter2 = s.encounter ?? openEncounter(s, 0);
    spawnEnemy(s, encounter2, zone.boss, "zone_boss");
    effects.push({ k: "boss_spawned", kind: "zone_boss", def: zone.boss });
    return;
  }
  const encounter = s.encounter ?? openEncounter(s, 1 + draw(s, 3));
  spawnEnemy(s, encounter, pickWaveEnemy(s), "wave");
  encounter.spawnedInWave += 1;
}
function grantXp(s, hero, xp, effects) {
  const cap = content.rarity[hero.rarity].levelCap;
  if (hero.level >= cap) {
    hero.xp = 0;
    return;
  }
  hero.xp += xp;
  while (hero.level < cap && hero.xp >= content.xpToNext(hero.level)) {
    const before = heroStats(s, hero).hp;
    hero.xp -= content.xpToNext(hero.level);
    hero.level += 1;
    const after = heroStats(s, hero).hp;
    if (hero.hp > 0) hero.hp = Math.min(after, hero.hp + Math.max(0, after - before));
    effects.push({ k: "level_up", heroId: hero.id, level: hero.level });
  }
  if (hero.level >= cap) hero.xp = 0;
}
function changeZone(s, zone) {
  s.zone = zone;
  s.wave = 1;
  s.zoneWipes = 0;
  if (zone > s.highestZone) s.highestZone = zone;
}
function onEnemyKilled(s, enemy, effects, drop) {
  const encounter = s.encounter;
  if (!encounter) return;
  encounter.enemies = encounter.enemies.filter((e) => e.id !== enemy.id);
  const def = enemyAt(enemy.def, s.zone);
  if (def) {
    for (const hero of livingParty(s)) grantXp(s, hero, def.xp, effects);
    const [min, max] = def.gold;
    const gold = min + draw(s, max - min + 1);
    s.gold += gold;
    effects.push({ k: "gold", amount: gold });
  }
  s.stats.kills += 1;
  if (enemy.kind !== "wave") s.stats.bosses += 1;
  if (drop) takeDrop(s, drop, effects);
  else if (def) {
    const r = rollDrops(s, def);
    Object.assign(s, r.state);
    effects.push(...r.effects);
  }
  if (enemy.kind === "zone_boss") {
    const zone = s.zone;
    s.encounter = null;
    const advance = !s.farm && zone < LADDER_END;
    const advancedTo = advance ? zone + 1 : zone;
    effects.push({ k: "zone_cleared", zone, advancedTo });
    changeZone(s, advancedTo);
    applyPendingParty(s, effects);
    healParty(s, 1500);
    return;
  }
  const current = s.encounter;
  if (!current || current.enemies.length > 0 || current.queue.length > 0) return;
  if (current.waveSize > 0 && current.spawnedInWave >= current.waveSize) {
    healParty(s, 1500);
    effects.push({ k: "wave_cleared", zone: s.zone, wave: s.wave });
    s.encounter = null;
    s.wave = Math.min(11, s.wave + 1);
    return;
  }
  if (current.waveSize === 0) s.encounter = null;
}
var RETREAT_AT = 3;
function checkWipe(s, effects) {
  if (livingParty(s).length > 0) return false;
  s.battle = { gauges: [], queue: [], busy: 0 };
  if (s.boss) {
    fullHealParty(s);
    return true;
  }
  s.encounter = null;
  s.pendingTurnBoss = false;
  s.stats.wipes += 1;
  fullHealParty(s);
  if (s.zoneWipes + 1 < RETREAT_AT) {
    effects.push({ k: "wipe", zone: s.zone });
    s.wave = 1;
    s.zoneWipes += 1;
  } else {
    const zone = Math.max(1, s.zone - 1);
    effects.push({ k: "retreat", zone });
    changeZone(s, zone);
  }
  applyPendingParty(s, effects);
  fullHealParty(s);
  return true;
}

// packages/sim/src/heroes.ts
function generateHero(s, rarity2, templateId) {
  let template = templateId ? content.heroTemplates[templateId] : void 0;
  if (!template) {
    const ids = Object.keys(content.heroTemplates).sort(compareCodeUnits);
    template = content.heroTemplates[ids[draw(s, ids.length)] ?? ""];
  }
  if (!template) throw new Error("no hero templates");
  const pool = Object.keys(content.traits).sort(compareCodeUnits);
  const traits2 = [];
  for (let i = 0; i < content.rarity[rarity2].traitCount && pool.length > 0; i++) {
    const [id] = pool.splice(draw(s, pool.length), 1);
    const def = id ? content.traits[id] : void 0;
    if (!def || !id) continue;
    const [min, max] = def.rangeBp;
    traits2.push({ id, valueBp: min + draw(s, max - min + 1) });
  }
  const epithet = content.epithets[draw(s, content.epithets.length)] ?? "";
  const hero = {
    id: newId(s, "h"),
    template: template.id,
    cls: template.cls,
    epithet,
    rarity: rarity2,
    traits: traits2,
    level: 1,
    xp: 0,
    hp: 1,
    equipment: { weapon: null, armour: null, accessory: null },
    tradeableAt: null
  };
  hero.hp = heroStats(s, hero).hp;
  return hero;
}
function recruitHero(s, hero, via, effects) {
  s.roster.push(hero);
  effects.push({ k: "hero_recruited", hero, via });
  pushLog(s, { k: "hero", heroId: hero.id, template: hero.template, rarity: hero.rarity, via });
}
function pushLog(s, entry) {
  s.lootLog.push(entry);
  if (s.lootLog.length > 50) s.lootLog.splice(0, s.lootLog.length - 50);
}
function rollContract(s, effects) {
  const odds = oddsAt(s.zone);
  if (!odds) return;
  const rarity2 = drawWeighted(s, odds.bossRarityWeights);
  const hero = generateHero(s, rarity2);
  if (s.roster.length < s.rosterCap) {
    recruitHero(s, hero, "contract", effects);
    return;
  }
  const gold = 3 * content.rarity[rarity2].vendorGoldPerZone * s.zone;
  s.gold += gold;
  effects.push({ k: "gold", amount: gold });
  pushLog(s, { k: "item", itemId: hero.id, base: "contract", rarity: rarity2, vendoredFor: gold });
}

// packages/sim/src/types.ts
var SIM_VERSION = 13;
var RARITIES = ["common", "uncommon", "rare", "epic", "legendary"];
var SANDBOX_EVENT_KINDS = [
  "sandbox_boss",
  "sandbox_item",
  "sandbox_level",
  "sandbox_zone",
  "sandbox_recruit",
  "sandbox_wipe"
];
var SERVER_EVENT_KINDS = [
  "listed",
  "returned",
  "sold",
  "bought",
  "order_placed",
  "order_refunded",
  "order_filled",
  "order_sold",
  "credited",
  "boss_engaged",
  "boss_disengaged",
  "rewarded",
  ...SANDBOX_EVENT_KINDS
];

// packages/sim/src/state.ts
function createInitialState(seed) {
  const state = {
    v: SIM_VERSION,
    seed: seed >>> 0,
    rng: seed >>> 0,
    counter: 0,
    tick: 0,
    gold: 0,
    zone: 1,
    wave: 1,
    farm: false,
    autoVendor: false,
    highestZone: 1,
    zoneWipes: 0,
    roster: [],
    party: ["", "", ""],
    pendingParty: null,
    inventory: [],
    inventoryCap: 30,
    rosterCap: 24,
    recruits: 0,
    turnToolCalls: 0,
    encounter: null,
    pendingTurnBoss: false,
    lootLog: [],
    stats: { kills: 0, bosses: 0, wipes: 0 },
    boss: null,
    battle: { gauges: [], queue: [], busy: 0 }
  };
  const roster = ["knight_1", "black_mage_1", "white_mage_1", "archer_1"].map(
    (id) => generateHero(state, "common", id)
  );
  state.roster = roster;
  state.rng = state.seed;
  const [k, b, w] = roster;
  return { ...state, roster, party: [k?.id ?? "", b?.id ?? "", w?.id ?? ""] };
}

// packages/sim/src/loot.ts
function vendorValue(item) {
  const minZone = content.itemBases[item.base]?.minZone ?? 1;
  return content.rarity[item.rarity].vendorGoldPerZone * minZone;
}
function baseTier(baseId) {
  const minZone = content.itemBases[baseId]?.minZone ?? 1;
  return Math.max(1, Math.ceil(minZone / ZONES_PER_ITEM_TIER));
}
function dropTier(zone, baseId) {
  const tier = zoneAt(zone)?.tier ?? 1;
  if (tier === 1) return baseTier(baseId);
  return Math.ceil(content.zones.length / ZONES_PER_ITEM_TIER) + tier - 1;
}
function tierMultBp(tier) {
  return content.itemTierMultBp[tier - 1] ?? 1e4;
}
function affixValue(item, affix) {
  return Math.floor(affix.value * tierMultBp(item.tier) / 1e4);
}
function reforgeCost(item) {
  return Math.floor(content.rarity[item.rarity].reforgeCost * tierMultBp(item.tier) / 1e4);
}
function rollItem(s, boss) {
  return rollItemFor(
    s,
    boss,
    partyHeroes(s).map((h) => h.cls)
  );
}
function rollItemFor(s, boss, classes) {
  const zone = oddsAt(s.zone);
  if (!zone) return null;
  const rarity2 = drawWeighted(s, boss ? zone.bossRarityWeights : zone.rarityWeights);
  const bases = Object.keys(content.itemBases).sort(compareCodeUnits).filter((id) => {
    const b = content.itemBases[id];
    return b !== void 0 && b.minZone <= s.zone && b.classes.some((c) => classes.includes(c));
  });
  if (bases.length === 0) return null;
  const baseId = bases[draw(s, bases.length)] ?? "";
  return rollItemOf(s, baseId, rarity2);
}
function rollItemOf(s, baseId, rarity2) {
  const affixes2 = rollAffixes(s, baseId, rarity2);
  return {
    id: newId(s, "i"),
    base: baseId,
    rarity: rarity2,
    tier: dropTier(s.zone, baseId),
    affixes: affixes2,
    equippedBy: null,
    tradeableAt: null
  };
}
function rollAffixes(s, baseId, rarity2) {
  const slot = content.itemBases[baseId]?.slot;
  const pool = Object.keys(content.affixes).sort(compareCodeUnits).filter((id) => slot !== void 0 && content.affixes[id]?.slots.includes(slot));
  const affixes2 = [];
  for (let i = 0; i < content.rarity[rarity2].affixCount && pool.length > 0; i++) {
    const [id] = pool.splice(draw(s, pool.length), 1);
    const def = id ? content.affixes[id] : void 0;
    if (!def || !id) continue;
    const [min, max] = def.range;
    affixes2.push({ id, value: min + draw(s, max - min + 1) });
  }
  return affixes2;
}
function rollRewardItem(seed, zone, classes) {
  const scratch = { ...createInitialState(seed), zone };
  const item = rollItemFor(scratch, true, classes);
  return item ? { ...item, id: "" } : null;
}
function autoVendors(s, item) {
  if (!s.autoVendor) return false;
  if (item.rarity !== "common" && !(item.rarity === "uncommon" && s.zone > 3)) return false;
  const base2 = content.itemBases[item.base];
  if (!base2) return false;
  return !partyHeroes(s).some(
    (h) => h.equipment[base2.slot] === null && base2.classes.includes(h.cls)
  );
}
function takeDrop(s, item, effects) {
  const cause = s.inventory.length >= s.inventoryCap ? "full" : autoVendors(s, item) ? "setting" : null;
  let gold = null;
  if (cause === null) {
    s.inventory.push(item);
    effects.push({ k: "drop", item });
  } else {
    gold = vendorValue(item);
    s.gold += gold;
    effects.push({ k: "drop_vendored", item, gold, cause });
  }
  pushLog(s, {
    k: "item",
    itemId: item.id,
    base: item.base,
    rarity: item.rarity,
    vendoredFor: gold
  });
}
function rollDrops(state, def) {
  const s = state;
  const effects = [];
  const boss = def.kind !== "wave";
  if (drawBp(s) < def.dropBp) {
    const item = rollItem(s, boss);
    if (item) takeDrop(s, item, effects);
  }
  if (boss && def.contractBp > 0 && drawBp(s) < def.contractBp) rollContract(s, effects);
  return { state: s, effects };
}
function rerollAffix(s, item, index) {
  const affix = item.affixes[index];
  const def = affix ? content.affixes[affix.id] : void 0;
  if (!affix || !def) return;
  const [min, max] = def.range;
  affix.value = min + draw(s, max - min + 1);
}

// packages/sim/src/draft.ts
function clone(value) {
  if (Array.isArray(value)) return value.map((v) => clone(v));
  if (value !== null && typeof value === "object") {
    const out = {};
    for (const key of Object.keys(value)) out[key] = clone(value[key]);
    return out;
  }
  return value;
}
function reject(state, event, reason) {
  return { state, effects: [{ k: "rejected", event, reason }] };
}
function draft(state, mutate) {
  const s = clone(state);
  const effects = [];
  mutate(s, effects);
  return { state: s, effects };
}

// packages/sim/src/migrate.ts
var MIGRATIONS = {
  // 5 → 6: ratio mitigation, gentler enemy growth and the flatter xp curve. Stats are derived, so
  // every hero keeps its level and starts it again at 0 xp, a hero the ledger holds too; nothing
  // changes shape.
  5: {
    state: (s) => ({
      ...s,
      roster: s.roster.map((h) => ({ ...h, xp: 0 }))
    }),
    goods: (g) => g.kind === "hero" ? { kind: "hero", hero: { ...g.hero, xp: 0 } } : g
  },
  // 6 → 7: a hero's rarity multiplies its base stats and growth. Stats are derived and the xp curve
  // is unchanged, so nothing changes shape and the xp is kept; the rule applies at read.
  6: { state: (s) => s },
  // 7 → 8: an item carries its tier, from its base. The flat roll is what an affix stores and the
  // tier scales it at read, so no roll changes; the items held outside the state gain it too.
  7: {
    state: (s) => ({ ...s, inventory: s.inventory.map(withBaseTier) }),
    goods: (g) => g.kind === "item" ? { kind: "item", item: withBaseTier(g.item) } : g
  },
  // 8 → 9: a wipe restarts the zone and the third is a retreat; rests heal 50%. The state gains
  // the count of wipes in its zone, at zero: no save remembers them, and zero only defers a retreat.
  8: { state: (s) => ({ ...s, zoneWipes: 0 }) },
  // 9 → 10: the auto-vendor setting. The state gains its flag, off: a save never sells a drop its
  // player did not ask to sell.
  9: { state: (s) => ({ ...s, autoVendor: false }) },
  // 10 → 11: zone 12's boss opens tier 2, and the ladder runs to zone 36. `zone` stays one running
  // number and every tier's numbers are derived from it, so nothing changes shape.
  10: { state: (s) => s },
  // 11 → 12: the arc retuned for the dedicated harness player (#151). Only content constants moved,
  // and every enemy's numbers are derived from them, so nothing changes shape.
  11: { state: (s) => s },
  // 12 → 13: boss contracts past tier 1 roll the tier's odds, and tier 2 ramps from zone 12 with no
  // step at its door (#152). Rules and content moved, and nothing changes shape.
  12: { state: (s) => s }
};
function withBaseTier(item) {
  const minZone = content.itemBases[item.base]?.minZone ?? 1;
  return { ...item, tier: Math.max(1, Math.ceil(minZone / 3)) };
}
function walk(from, to, chain) {
  if (!Number.isInteger(from)) return { ok: false, reason: "gap", from, to, at: from };
  if (from > to) return { ok: false, reason: "ahead", from, to };
  const steps = [];
  for (let v = from; v < to; v++) {
    const step2 = chain[v];
    if (!step2) return { ok: false, reason: "gap", from, to, at: v };
    steps.push(step2);
  }
  return steps;
}
function finish(s) {
  if (!s.boss) {
    s.encounter = null;
    s.battle = { gauges: [], queue: [], busy: 0 };
  }
  for (const hero of s.roster) clampHp(s, hero);
  return s;
}
function migrate(state, options = {}) {
  const { chain = MIGRATIONS, to = SIM_VERSION } = options;
  const from = state.v;
  const steps = walk(from, to, chain);
  if (!Array.isArray(steps)) return steps;
  if (steps.length === 0) return { ok: true, state, from, steps: 0 };
  let current = clone(state);
  for (const [i, step2] of steps.entries()) current = { ...step2.state(current), v: from + i + 1 };
  return { ok: true, state: finish(current), from, steps: steps.length };
}
function migrateGoods(goods, from, options = {}) {
  const { chain = MIGRATIONS, to = SIM_VERSION } = options;
  const steps = walk(from, to, chain);
  if (!Array.isArray(steps)) return steps;
  let current = goods;
  for (const step2 of steps) current = step2.goods ? step2.goods(clone(current)) : current;
  return { ok: true, goods: current };
}

// packages/sim/src/picker.ts
function heroBodies(s) {
  return livingParty(s).map((h) => ({ id: h.id, hp: h.hp, max: heroStats(s, h).hp, cls: h.cls }));
}
function enemyBodies(s) {
  const out = [];
  for (const e of s.encounter?.enemies ?? [])
    if (e.hp > 0) out.push({ id: e.id, hp: e.hp, max: Math.max(1, e.maxHp), cls: null });
  return out;
}
function tacticsOf(unit) {
  if (unit.side === "hero") return content.tactics.heroes[unit.hero.cls] ?? [];
  if (unit.enemy.kind === "world_boss") return content.tactics.enemies.world_boss;
  const archetype = content.enemies[unit.enemy.def]?.archetype;
  return archetype ? content.tactics.enemies[archetype] : [];
}
function lowestShare(bodies) {
  let best;
  for (const b of bodies) if (!best || b.hp * best.max < best.hp * b.max) best = b;
  return best;
}
function tacticWeight(rule, allies) {
  if (rule.kind === "fixed") return rule.weight;
  const lowest = lowestShare(allies);
  if (!lowest) return 0;
  const d = rule.belowBp - Math.floor(lowest.hp * 1e4 / lowest.max);
  if (d <= 0) return 0;
  return Math.floor(rule.scale * d * d * 4 / (rule.belowBp * rule.belowBp));
}
function targets(rule, allies, foes) {
  switch (rule.kind) {
    case "none":
      return foes.length > 0 ? [[null, 1]] : [];
    case "front":
      return foes.map((f, i) => [f.id, i === 0 ? rule.front : rule.other]);
    case "weakest": {
      let weakest;
      for (const f of foes) if (!weakest || f.hp < weakest.hp) weakest = f;
      return foes.map((f) => [f.id, f === weakest ? rule.weakest : rule.other]);
    }
    case "class":
      return foes.map((f) => [f.id, f.cls === rule.cls ? rule.match : rule.other]);
    case "ally_lowest": {
      const lowest = lowestShare(allies);
      return lowest ? [[lowest.id, 1]] : [];
    }
  }
}
function pickAction(s, unit) {
  const heroes = heroBodies(s);
  const enemies2 = enemyBodies(s);
  const allies = unit.side === "hero" ? heroes : enemies2;
  const foes = unit.side === "hero" ? enemies2 : heroes;
  const weights2 = {};
  const byKey = /* @__PURE__ */ new Map();
  for (const tactic of tacticsOf(unit)) {
    if (tactic.minAllies !== void 0 && tactic.minAllies > allies.length) continue;
    const w = tacticWeight(tactic.weight, allies);
    if (w <= 0) continue;
    for (const [targetId, tw] of targets(tactic.target, allies, foes)) {
      if (tw <= 0) continue;
      const key = `${tactic.action}:${targetId ?? "*"}`;
      weights2[key] = (weights2[key] ?? 0) + w * tw;
      byKey.set(key, { action: tactic.action, targetId });
    }
  }
  if (byKey.size === 0) return null;
  return byKey.get(drawWeighted(s, weights2)) ?? null;
}

// packages/sim/src/combat.ts
var STEPS = TICK_MS / STEP_MS;
function mitigationBp(def) {
  return Math.floor(1e6 / (100 + Math.max(0, def)));
}
function hitDamage(atk, def, varianceBp) {
  return scaled(Math.max(1, Math.floor(atk * mitigationBp(def) * varianceBp / 1e8)));
}
function damage(s, atk, def) {
  return hitDamage(atk, def, 9e3 + draw(s, 2001));
}
var NO_STATS = { hp: 1, atk: 1, def: 0, spd: 0 };
function zoneBossStats(zone) {
  return enemyAt(zoneAt(zone)?.def.boss ?? "", zone)?.stats ?? NO_STATS;
}
function scaledBossStats(s) {
  const carried = s.boss?.stats ?? NO_STATS;
  const z1 = zoneBossStats(1);
  const zb = zoneBossStats(s.zone);
  return {
    hp: carried.hp,
    atk: Math.floor(carried.atk * zb.atk / Math.max(1, z1.atk)),
    def: Math.floor(carried.def * zb.def / Math.max(1, z1.def)),
    spd: carried.spd + zb.spd - z1.spd
  };
}
function enemyStats(s, enemy) {
  if (enemy.kind === "world_boss") return scaledBossStats(s);
  return enemyAt(enemy.def, s.zone)?.stats ?? NO_STATS;
}
function hitEnemy(s, by, enemy, amount, effects) {
  effects.push({ k: "hit", by, target: enemy.id, amount });
  if (enemy.kind === "world_boss") {
    if (s.boss) s.boss.dealt += amount;
    return;
  }
  enemy.hp = Math.max(0, enemy.hp - amount);
  if (enemy.hp === 0) onEnemyKilled(s, enemy, effects);
}
function gaugeOf(s, id) {
  let entry = s.battle.gauges.find((e) => e.id === id);
  if (!entry) {
    entry = { id, g: 0 };
    s.battle.gauges.push(entry);
  }
  return entry;
}
function fall(s, hero, effects) {
  effects.push({ k: "hero_fell", heroId: hero.id });
  gaugeOf(s, hero.id).g = 0;
  s.battle.queue = s.battle.queue.filter((id) => id !== hero.id);
}
function heroAction(s, hero, choice, effects) {
  const encounter = s.encounter;
  const stats = heroStats(s, hero);
  switch (choice.action) {
    case "attack": {
      const target = encounter?.enemies.find((e) => e.id === choice.targetId);
      if (!target) return;
      let amount = damage(s, stats.atk, enemyStats(s, target).def);
      if (hero.cls === "archer" && drawBp(s) < 2e3) amount *= 2;
      hitEnemy(s, hero.id, target, amount, effects);
      return;
    }
    case "attack_all": {
      const atk = Math.floor(stats.atk * 6e3 / 1e4);
      for (const target of [...encounter?.enemies ?? []]) {
        if (!s.encounter?.enemies.includes(target)) continue;
        hitEnemy(s, hero.id, target, damage(s, atk, enemyStats(s, target).def), effects);
      }
      return;
    }
    case "heal": {
      const target = findHero(s, choice.targetId ?? "");
      if (!target || target.hp <= 0) return;
      const max = heroStats(s, target).hp;
      const amount = Math.min(
        Math.max(0, max - target.hp),
        scaled(Math.floor(stats.atk * 8e3 / 1e4))
      );
      if (amount <= 0) return;
      target.hp += amount;
      effects.push({ k: "heal", by: hero.id, target: target.id, amount });
      return;
    }
  }
}
function enemyAction(s, enemy, choice, effects) {
  const target = findHero(s, choice.targetId ?? "");
  if (!target || target.hp <= 0) return;
  const amount = damage(s, enemyStats(s, enemy).atk, heroStats(s, target).def);
  target.hp = Math.max(0, target.hp - amount);
  effects.push({ k: "hit", by: enemy.id, target: target.id, amount });
  if (target.hp === 0) fall(s, target, effects);
}
function unitOf(s, id) {
  const hero = livingParty(s).find((h) => h.id === id);
  if (hero) return { side: "hero", hero };
  const enemy = s.encounter?.enemies.find((e) => e.id === id && e.hp > 0);
  return enemy ? { side: "enemy", enemy } : void 0;
}
function syncGauges(s) {
  const onField = /* @__PURE__ */ new Set();
  for (const h of livingParty(s)) onField.add(h.id);
  for (const e of s.encounter?.enemies ?? []) onField.add(e.id);
  s.battle.gauges = s.battle.gauges.filter((e) => onField.has(e.id));
  s.battle.queue = s.battle.queue.filter((id) => onField.has(id));
  for (const id of onField) gaugeOf(s, id);
}
function advanceBattle(s, effects) {
  s.tick += 1;
  if (checkWipe(s, effects)) return;
  syncGauges(s);
  const battle = s.battle;
  const perStep = /* @__PURE__ */ new Map();
  const fillOf = (unit) => {
    const id = unit.side === "hero" ? unit.hero.id : unit.enemy.id;
    let f = perStep.get(id);
    if (f === void 0) {
      f = fill(unit.side === "hero" ? heroStats(s, unit.hero).spd : enemyStats(s, unit.enemy).spd);
      perStep.set(id, f);
    }
    return f;
  };
  for (let step2 = 0; step2 < STEPS; step2++) {
    const encounter = s.encounter;
    if (!encounter || encounter.enemies.length === 0) {
      battle.busy = Math.max(0, battle.busy - (STEPS - step2));
      return;
    }
    const units = [
      ...livingParty(s).map((hero) => ({ side: "hero", hero })),
      ...encounter.enemies.filter((e) => e.hp > 0).map((enemy) => ({ side: "enemy", enemy }))
    ];
    const filled = [];
    units.forEach((unit, order) => {
      const id = unit.side === "hero" ? unit.hero.id : unit.enemy.id;
      if (battle.queue.includes(id)) return;
      const entry = gaugeOf(s, id);
      entry.g += fillOf(unit);
      if (entry.g >= GAUGE_FULL) {
        filled.push({ id, over: entry.g - GAUGE_FULL, order });
        entry.g = GAUGE_FULL;
      }
    });
    filled.sort((a, b) => b.over - a.over || a.order - b.order);
    for (const f of filled) battle.queue.push(f.id);
    if (battle.busy > 0) battle.busy -= 1;
    while (battle.busy === 0 && battle.queue.length > 0) {
      const id = battle.queue.shift() ?? "";
      const unit = unitOf(s, id);
      if (!unit) continue;
      gaugeOf(s, id).g = 0;
      const choice = pickAction(s, unit);
      if (!choice) continue;
      effects.push({ k: "act", actor: id, action: choice.action, at: step2 * STEP_MS });
      battle.busy = ACTION_STEPS;
      if (unit.side === "hero") heroAction(s, unit.hero, choice, effects);
      else {
        enemyAction(s, unit.enemy, choice, effects);
        if (checkWipe(s, effects)) return;
      }
    }
  }
}

// packages/sim/src/commands.ts
function tavernPrice(state) {
  const { baseCost, costGrowthBp } = content.tavern;
  return Math.floor(baseCost * (1e4 + costGrowthBp * state.recruits) / 1e4);
}
function nextExpansionCost(state, which) {
  const rule = content.expansions[which];
  const start = which === "inventory" ? 30 : 24;
  const cap = which === "inventory" ? state.inventoryCap : state.rosterCap;
  if (cap >= rule.max) return null;
  return rule.costs[Math.floor((cap - start) / rule.step)] ?? null;
}
function equip(state, event) {
  const hero = findHero(state, event.heroId);
  if (!hero) return reject(state, event, "unknown_hero");
  const item = state.inventory.find((i) => i.id === event.itemId);
  if (!item) return reject(state, event, "unknown_item");
  const base2 = content.itemBases[item.base];
  if (!base2?.classes.includes(hero.cls)) return reject(state, event, "class_mismatch");
  if (item.equippedBy !== null && item.equippedBy !== hero.id) {
    return reject(state, event, "already_equipped");
  }
  return draft(state, (s) => {
    const h = findHero(s, event.heroId);
    const it = s.inventory.find((i) => i.id === event.itemId);
    if (!h || !it) return;
    const oldId = h.equipment[base2.slot];
    if (oldId && oldId !== it.id) {
      const old = s.inventory.find((i) => i.id === oldId);
      if (old) old.equippedBy = null;
    }
    h.equipment[base2.slot] = it.id;
    it.equippedBy = h.id;
    clampHp(s, h);
  });
}
function unequip(state, event) {
  const hero = findHero(state, event.heroId);
  if (!hero) return reject(state, event, "unknown_hero");
  if (!hero.equipment[event.slot]) return reject(state, event, "slot_empty");
  return draft(state, (s) => {
    const h = findHero(s, event.heroId);
    if (!h) return;
    const it = s.inventory.find((i) => i.id === h.equipment[event.slot]);
    if (it) it.equippedBy = null;
    h.equipment[event.slot] = null;
    clampHp(s, h);
  });
}
function vendor(state, event) {
  const item = state.inventory.find((i) => i.id === event.itemId);
  if (!item) return reject(state, event, "unknown_item");
  if (item.equippedBy !== null) return reject(state, event, "item_equipped");
  return draft(state, (s) => {
    s.inventory = s.inventory.filter((i) => i.id !== event.itemId);
    s.gold += vendorValue(item);
  });
}
function reforge(state, event) {
  const item = state.inventory.find((i) => i.id === event.itemId);
  if (!item) return reject(state, event, "unknown_item");
  const index = event.affixIndex;
  if (!Number.isInteger(index) || index < 0 || index >= item.affixes.length) {
    return reject(state, event, "bad_affix_index");
  }
  const cost = reforgeCost(item);
  if (state.gold < cost) return reject(state, event, "not_enough_gold");
  return draft(state, (s) => {
    const it = s.inventory.find((i) => i.id === event.itemId);
    if (!it) return;
    s.gold -= cost;
    rerollAffix(s, it, index);
    const wearer = it.equippedBy ? findHero(s, it.equippedBy) : void 0;
    if (wearer) clampHp(s, wearer);
  });
}
function setParty(state, event) {
  const ids = event.heroIds;
  for (const id of ids) if (!findHero(state, id)) return reject(state, event, "unknown_hero");
  if (new Set(ids).size !== ids.length) return reject(state, event, "duplicate_hero");
  return draft(state, (s, effects) => {
    const party = [ids[0], ids[1], ids[2]];
    if (s.encounter === null && s.wave === 1 && s.stats.kills === 0) {
      s.party = party;
      s.pendingParty = null;
      effects.push({ k: "party_applied", heroIds: [...party] });
    } else {
      s.pendingParty = party;
    }
  });
}
function recruit(state, event) {
  const price = tavernPrice(state);
  if (state.gold < price) return reject(state, event, "not_enough_gold");
  if (state.roster.length >= state.rosterCap) return reject(state, event, "roster_full");
  return draft(state, (s, effects) => {
    s.gold -= price;
    s.recruits += 1;
    const rarity2 = drawWeighted(s, content.tavern.odds);
    recruitHero(s, generateHero(s, rarity2), "tavern", effects);
  });
}
function dismiss(state, event) {
  const hero = findHero(state, event.heroId);
  if (!hero) return reject(state, event, "unknown_hero");
  if (state.party.includes(hero.id) || state.pendingParty?.includes(hero.id)) {
    return reject(state, event, "in_party");
  }
  if (state.roster.filter((h) => h.cls === hero.cls).length <= 1) {
    return reject(state, event, "last_of_class");
  }
  return draft(state, (s) => {
    for (const it of s.inventory) if (it.equippedBy === hero.id) it.equippedBy = null;
    s.roster = s.roster.filter((h) => h.id !== hero.id);
    s.gold += content.rarity[hero.rarity].vendorGoldPerZone * 2;
  });
}
function setFarm(state, event) {
  return draft(state, (s) => {
    s.farm = event.on === true;
  });
}
function setAutoVendor(state, event) {
  return draft(state, (s) => {
    s.autoVendor = event.on === true;
  });
}
function expand(state, event, which) {
  const cost = nextExpansionCost(state, which);
  if (cost === null) return reject(state, event, "at_max");
  if (state.gold < cost) return reject(state, event, "not_enough_gold");
  const step2 = content.expansions[which].step;
  return draft(state, (s) => {
    s.gold -= cost;
    if (which === "inventory") s.inventoryCap += step2;
    else s.rosterCap += step2;
  });
}
function expandInventory(state, event) {
  return expand(state, event, "inventory");
}
function expandRoster(state, event) {
  return expand(state, event, "roster");
}

// packages/sim/src/server-events.ts
function unapplicable(state, event, detail) {
  return reject(state, event, `server_event_unapplicable:${detail}`);
}
function noRoom(state, goods) {
  if (goods.kind === "item") {
    return state.inventory.length < state.inventoryCap ? null : "inventory_full";
  }
  return state.roster.length < state.rosterCap ? null : "roster_full";
}
function insert(s, goods) {
  if (goods.kind === "item") s.inventory.push(clone(goods.item));
  else s.roster.push(clone(goods.hero));
}
function goodsEntry(goods, what, gold) {
  return goods.kind === "item" ? { k: "trade", what, kind: "item", base: goods.item.base, rarity: goods.item.rarity, gold } : { k: "trade", what, kind: "hero", base: goods.hero.template, rarity: goods.hero.rarity, gold };
}
function logTrade(s, effects, entry) {
  pushLog(s, entry);
  effects.push({ k: "traded", entry: { ...entry } });
}
function listed(state, event) {
  if (event.kind === "item") {
    const item = state.inventory.find((i) => i.id === event.id);
    if (!item) return unapplicable(state, event, "unknown_item");
    if (item.equippedBy !== null) return unapplicable(state, event, "equipped");
  } else {
    const hero = findHero(state, event.id);
    if (!hero) return unapplicable(state, event, "unknown_hero");
    if (state.party.includes(hero.id) || state.pendingParty?.includes(hero.id)) {
      return unapplicable(state, event, "in_party");
    }
    if (Object.values(hero.equipment).some((id) => id !== null)) {
      return unapplicable(state, event, "equipped");
    }
  }
  if (state.gold < event.fee) return unapplicable(state, event, "not_enough_gold");
  return draft(state, (s) => {
    if (event.kind === "item") s.inventory = s.inventory.filter((i) => i.id !== event.id);
    else s.roster = s.roster.filter((h) => h.id !== event.id);
    s.gold -= event.fee;
  });
}
function returned(state, event) {
  const full = noRoom(state, event.goods);
  if (full) return unapplicable(state, event, full);
  return draft(state, (s, effects) => {
    insert(s, event.goods);
    logTrade(s, effects, goodsEntry(event.goods, "returned", 0));
  });
}
function sold(state, event) {
  return draft(state, (s, effects) => {
    s.gold += event.net;
    const { kind, base: base2, rarity: rarity2, net } = event;
    logTrade(s, effects, { k: "trade", what: "sold", kind, base: base2, rarity: rarity2, gold: net });
  });
}
function bought(state, event) {
  if (state.gold < event.price) return unapplicable(state, event, "not_enough_gold");
  const full = noRoom(state, event.goods);
  if (full) return unapplicable(state, event, full);
  return draft(state, (s, effects) => {
    s.gold -= event.price;
    insert(s, event.goods);
    logTrade(s, effects, goodsEntry(event.goods, "bought", event.price));
  });
}
function orderPlaced(state, event) {
  if (state.gold < event.escrow) return unapplicable(state, event, "not_enough_gold");
  return draft(state, (s) => {
    s.gold -= event.escrow;
  });
}
function orderRefunded(state, event) {
  return draft(state, (s) => {
    s.gold += event.escrow;
  });
}
function orderFilled(state, event) {
  const goods = { kind: "item", item: event.item };
  const full = noRoom(state, goods);
  if (full) return unapplicable(state, event, full);
  return draft(state, (s, effects) => {
    insert(s, goods);
    logTrade(s, effects, goodsEntry(goods, "bought", event.price));
  });
}
function orderSold(state, event) {
  const item = state.inventory.find((i) => i.id === event.itemId);
  if (!item) return unapplicable(state, event, "unknown_item");
  if (item.equippedBy !== null) return unapplicable(state, event, "equipped");
  return draft(state, (s, effects) => {
    s.inventory = s.inventory.filter((i) => i.id !== event.itemId);
    s.gold += event.net;
    const { base: base2, rarity: rarity2, net } = event;
    logTrade(s, effects, { k: "trade", what: "sold", kind: "item", base: base2, rarity: rarity2, gold: net });
  });
}
function credited(state, event) {
  return draft(state, (s, effects) => {
    s.gold += event.gold;
    effects.push({ k: "gold", amount: event.gold });
  });
}
function bossEngaged(state, event) {
  if (state.boss !== null) return unapplicable(state, event, "already_engaged");
  return draft(state, (s) => {
    const { hp } = event.stats;
    const id = newId(s, "e");
    s.encounter = {
      enemies: [{ id, def: "world_boss", kind: "world_boss", hp, maxHp: hp }],
      queue: [],
      waveSize: 0,
      spawnedInWave: 0
    };
    s.battle.gauges.push({ id, g: draw(s, SPAWN_GAUGE_MAX + 1) });
    s.boss = {
      bossId: event.bossId,
      name: event.name,
      glyph: event.glyph,
      stats: { ...event.stats },
      dealt: 0
    };
  });
}
function bossDisengaged(state, event) {
  if (state.boss?.bossId !== event.bossId) return unapplicable(state, event, "not_engaged");
  return draft(state, (s) => {
    const id = s.encounter?.enemies.find((e) => e.kind === "world_boss")?.id;
    s.battle.gauges = s.battle.gauges.filter((e) => e.id !== id);
    s.battle.queue = s.battle.queue.filter((q) => q !== id);
    s.encounter = null;
    s.boss = null;
  });
}
function rewarded(state, event) {
  const goods = event.goods;
  if (goods) {
    const full = noRoom(state, goods);
    if (full) return unapplicable(state, event, full);
  }
  return draft(state, (s, effects) => {
    s.gold += event.gold;
    if (goods) {
      insert(s, goods);
      const { base: base2, rarity: rarity2 } = goods.kind === "item" ? goods.item : { base: goods.hero.template, rarity: goods.hero.rarity };
      pushLog(s, { k: "reward", base: base2, rarity: rarity2, gold: event.gold });
    }
    effects.push({ k: "rewarded", bossId: event.bossId, goods: clone(goods), gold: event.gold });
  });
}
function noSuchZone(zone) {
  return zoneAt(zone) === void 0 || zone > LADDER_END;
}
function noSuchRarity(rarity2) {
  return !Object.hasOwn(content.rarity, rarity2);
}
function endEncounter(s) {
  s.encounter = null;
  s.battle = { gauges: [], queue: [], busy: 0 };
}
function sandboxBoss(state, event) {
  if (state.boss) return unapplicable(state, event, "boss_mode");
  if (noSuchZone(event.zone)) return unapplicable(state, event, "no_such_zone");
  return draft(state, (s) => {
    if (s.zone !== event.zone) changeZone(s, event.zone);
    endEncounter(s);
    if (event.boss === "zone_boss") {
      s.wave = 11;
      s.pendingTurnBoss = false;
    } else s.pendingTurnBoss = true;
  });
}
function sandboxItem(state, event) {
  if (!Object.hasOwn(content.itemBases, event.base)) {
    return unapplicable(state, event, "unknown_base");
  }
  if (noSuchRarity(event.rarity)) return unapplicable(state, event, "unknown_rarity");
  return draft(state, (s, effects) => {
    const item = rollItemOf(s, event.base, event.rarity);
    const hero = livingParty(s)[0];
    const enemy = s.encounter?.enemies.find((e) => e.kind !== "world_boss");
    if (!hero || !enemy) {
      takeDrop(s, item, effects);
      return;
    }
    effects.push({ k: "act", actor: hero.id, action: "attack", at: 0 });
    effects.push({ k: "hit", by: hero.id, target: enemy.id, amount: enemy.hp });
    enemy.hp = 0;
    onEnemyKilled(s, enemy, effects, item);
  });
}
function sandboxLevel(state, event) {
  const hero = findHero(state, event.heroId);
  if (!hero) return unapplicable(state, event, "unknown_hero");
  if (event.level <= hero.level) return unapplicable(state, event, "level_not_above");
  const cap = content.rarity[hero.rarity].levelCap;
  if (hero.level >= cap) return unapplicable(state, event, "level_cap");
  return draft(state, (s, effects) => {
    const h = findHero(s, event.heroId);
    while (h && h.level < event.level && h.level < cap) {
      grantXp(s, h, content.xpToNext(h.level) - h.xp, effects);
    }
  });
}
function sandboxZone(state, event) {
  if (state.boss) return unapplicable(state, event, "boss_mode");
  if (noSuchZone(event.zone)) return unapplicable(state, event, "no_such_zone");
  return draft(state, (s) => {
    changeZone(s, event.zone);
    endEncounter(s);
  });
}
function sandboxRecruit(state, event) {
  if (noSuchRarity(event.rarity)) return unapplicable(state, event, "unknown_rarity");
  if (state.roster.length >= state.rosterCap) return unapplicable(state, event, "roster_full");
  return draft(state, (s, effects) => {
    recruitHero(s, generateHero(s, event.rarity), "sandbox", effects);
  });
}
function sandboxWipe(state, event) {
  if (state.boss) return unapplicable(state, event, "boss_mode");
  return draft(state, (s, effects) => {
    for (const hero of partyHeroes(s)) hero.hp = 0;
    checkWipe(s, effects);
  });
}

// packages/sim/src/step.ts
var handlers = {
  tick: (state) => draft(state, (s, effects) => {
    refillFromQueue(s);
    if (s.encounter && s.encounter.enemies.length > 0) advanceBattle(s, effects);
    else {
      spawnOnEmptyTick(s, effects);
      s.battle.busy = 0;
    }
  }),
  tool_call: (state) => draft(state, (s) => onToolCall(s)),
  turn_end: (state) => draft(state, (s) => onTurnEnd(s)),
  rest: (state) => draft(state, (s) => onRest(s)),
  equip,
  unequip,
  vendor,
  reforge,
  set_party: setParty,
  recruit,
  dismiss,
  set_farm: setFarm,
  set_auto_vendor: setAutoVendor,
  expand_inventory: expandInventory,
  expand_roster: expandRoster,
  listed,
  returned,
  sold,
  bought,
  order_placed: orderPlaced,
  order_refunded: orderRefunded,
  order_filled: orderFilled,
  order_sold: orderSold,
  credited,
  boss_engaged: bossEngaged,
  boss_disengaged: bossDisengaged,
  rewarded,
  sandbox_boss: sandboxBoss,
  sandbox_item: sandboxItem,
  sandbox_level: sandboxLevel,
  sandbox_zone: sandboxZone,
  sandbox_recruit: sandboxRecruit,
  sandbox_wipe: sandboxWipe
};
function step(state, event) {
  const handler = handlers[event.t];
  if (!handler) return reject(state, event, "unknown_event");
  return handler(state, event);
}
function replay(state, events) {
  let current = state;
  const effects = [];
  for (const event of events) {
    const r = step(current, event);
    current = r.state;
    for (const e of r.effects) effects.push(e);
  }
  return { state: current, effects };
}
export {
  ACTION_STEPS,
  FILL_BP,
  FILL_K,
  GAUGE_FULL,
  GOLDEN_HASH,
  GOLDEN_SEED,
  LADDER_END,
  MIGRATIONS,
  POWER_BP,
  RARITIES,
  SANDBOX_EVENT_KINDS,
  SERVER_EVENT_KINDS,
  SIM_VERSION,
  SPAWN_GAUGE_MAX,
  STEP_MS,
  TICK_MS,
  TIER_GROWTH_BP,
  affixValue,
  baseTier,
  content,
  createInitialState,
  dropTier,
  enemyAt,
  fill,
  goldenEvents,
  hashState,
  heroStats,
  migrate,
  migrateGoods,
  oddsAt,
  reforgeCost,
  replay,
  rollRewardItem,
  step,
  vendorValue,
  zoneAt
};
