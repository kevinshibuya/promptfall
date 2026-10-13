/** Battle time one tick advances, whatever the cadence (grill 1.1). Fixed. */
declare const TICK_MS = 2000;
/** Resolution of the battle loop: 20 steps per tick. Fixed. */
declare const STEP_MS = 100;
/** A full action gauge. Fixed. */
declare const GAUGE_FULL = 10000;
/** An action lasts this many steps of battle time. Tunable (plan Task 4). */
declare const ACTION_STEPS = 5;
/** Speed constant: fill is proportional to spd + FILL_K (grill 1.2). Tunable. */
declare const FILL_K = 10;
/** Per-step fill = floor((spd + FILL_K) × FILL_BP / 1000). Tunable. */
declare const FILL_BP = 16667;
/** Every damage and heal amount × POWER_BP / 10000 (grill 1.5). Tunable. */
declare const POWER_BP = 20000;
/** While Haste is on, a hero's per-step fill × HASTE_BP / 10000. Tunable (the arc check of #156). */
declare const HASTE_BP = 12500;
/** Haste's countdown: 90 ticks, 3 minutes of battle time. */
declare const HASTE_TICKS = 90;
/** Guard's countdown: 60 ticks, 2 minutes of battle time. */
declare const GUARD_TICKS = 60;
/** While Guard is on, the damage a hero takes × GUARD_DAMAGE_BP / 10000. */
declare const GUARD_DAMAGE_BP = 5000;
/** An enraged enemy's next attack uses its atk × ENRAGE_BP / 10000. */
declare const ENRAGE_BP = 15000;
/** A spawned enemy's gauge starts at draw(SPAWN_GAUGE_MAX + 1). */
declare const SPAWN_GAUGE_MAX = 5000;
/** Gauge gained per step at this speed, never below 1. */
declare function fill(spd: number): number;

declare const SIM_VERSION: 16;
type Rarity = 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary';
declare const RARITIES: readonly Rarity[];
type HeroClass = 'knight' | 'black_mage' | 'white_mage' | 'archer';
type Slot = 'weapon' | 'armour' | 'accessory';
type Stat = 'hp' | 'atk' | 'def' | 'spd';
type Stats = Record<Stat, number>;
type Affix = {
    id: string;
    /** The flat roll, as stored: what it counts for is scaled by its item's tier (`affixValue`). */
    value: number;
};
type Item = {
    id: string;
    base: string;
    rarity: Rarity;
    /** 1 to 6, set at the drop: it scales the affixes' rolls at read and the reforge price. */
    tier: number;
    affixes: Affix[];
    equippedBy: string | null;
    /** Server epoch ms before which the ledger refuses to list it; null when never traded. Data, never a rule. */
    tradeableAt: number | null;
};
type Trait = {
    id: string;
    valueBp: number;
};
type Hero = {
    id: string;
    template: string;
    cls: HeroClass;
    epithet: string;
    rarity: Rarity;
    traits: Trait[];
    level: number;
    xp: number;
    hp: number;
    equipment: Record<Slot, string | null>;
    /** Server epoch ms before which the ledger refuses to list it; null when never traded. Data, never a rule. */
    tradeableAt: number | null;
};
type EnemyKind = 'wave' | 'zone_boss' | 'turn_boss' | 'world_boss';
type Enemy = {
    id: string;
    def: string;
    kind: EnemyKind;
    hp: number;
    maxHp: number;
    /** Set by a mishap: its next attack lands harder, then it clears. */
    enraged: boolean;
};
/** A wave enemy's archetype: what a tool call's hint names. Every zone's wave list holds one of each. */
type WaveArchetype = 'swift' | 'brute' | 'caster' | 'tank';
declare const WAVE_ARCHETYPES: readonly WaveArchetype[];
type Encounter = {
    enemies: Enemy[];
    queue: {
        def: string;
        kind: EnemyKind;
    }[];
    waveSize: number;
    spawnedInWave: number;
};
/** Battle time state carried across ticks. Arrays, not records: canonical order is insertion order. */
type Battle = {
    /** One entry per unit on the field (living party heroes, encounter enemies). 0..GAUGE_FULL. */
    gauges: {
        id: string;
        g: number;
    }[];
    /** Unit ids whose gauge is full, in the order they filled. Head acts next. */
    queue: string[];
    /** Steps left in the running action; 0 when nobody is acting. Carries across ticks. */
    busy: number;
};
type ActionId = 'attack' | 'attack_all' | 'heal';
type TradeKind = 'item' | 'hero';
type Goods = {
    kind: 'item';
    item: Item;
} | {
    kind: 'hero';
    hero: Hero;
};
type RecruitVia = 'contract' | 'tavern' | 'sandbox';
/** Who a reward pays for: a world boss's fight, or the weekly hunt. */
type RewardSource = 'boss' | 'hunt';
/** The rarities the tavern guarantee promises, each within its own count of recruits. */
type GuaranteeRarity = 'rare' | 'epic' | 'legendary';
declare const GUARANTEE_RARITIES: readonly GuaranteeRarity[];
/** One integer per rarity. */
type RarityCounts = Record<Rarity, number>;
/**
 * What the party has seen and done since version 16, counted in the state because the ledger
 * replays state and never effects. Every field an integer, every one in the hash.
 */
type Tallies = {
    /** Per enemy definition: spawns met and kills. */
    enemies: Record<string, {
        seen: number;
        defeated: number;
    }>;
    /** Per item base: 1 at each rarity the party has held it in, by a drop, a purchase, a reward or a return. */
    collection: Record<string, RarityCounts>;
    zoneBosses: number;
    /** Zone bosses beaten with the zone's wipe count at zero at the kill. */
    cleanZoneBosses: number;
    turnBosses: number;
    /** Drops by rarity, kept or vendored on pickup. */
    drops: RarityCounts;
    /** Heroes joined by rarity: tavern, contract and sandbox alike. */
    recruits: RarityCounts;
    reforges: number;
    /** Kill gold, vendoring, a sale's net, a reward's gold and credits; never a refund or escrow. */
    goldEarned: number;
};
type LootEntry = {
    k: 'item';
    itemId: string;
    base: string;
    rarity: Rarity;
    vendoredFor: number | null;
} | {
    k: 'hero';
    heroId: string;
    template: string;
    rarity: Rarity;
    via: RecruitVia;
} | {
    k: 'trade';
    what: 'sold' | 'bought' | 'returned';
    kind: TradeKind;
    base: string;
    rarity: Rarity;
    gold: number;
} | {
    k: 'reward';
    base: string;
    rarity: Rarity;
    gold: number;
};
type PlayerEvent = {
    t: 'tick';
}
/** `hint` names the wave enemy the call spawns; absent, the draw is uniform. */
 | {
    t: 'tool_call';
    hint?: WaveArchetype;
} | {
    t: 'turn_start';
} | {
    t: 'turn_end';
} | {
    t: 'rest';
}
/** Moves the party to a zone it has reached, ending the fight with no drops and no XP. */
 | {
    t: 'travel';
    zone: number;
} | {
    t: 'tool_mishap';
} | {
    t: 'camp';
} | {
    t: 'guard';
    on: boolean;
} | {
    t: 'equip';
    heroId: string;
    itemId: string;
} | {
    t: 'unequip';
    heroId: string;
    slot: Slot;
} | {
    t: 'vendor';
    itemId: string;
} | {
    t: 'reforge';
    itemId: string;
    affixIndex: number;
} | {
    t: 'set_party';
    heroIds: [string, string, string];
} | {
    t: 'recruit';
} | {
    t: 'dismiss';
    heroId: string;
} | {
    t: 'set_farm';
    on: boolean;
} | {
    t: 'set_auto_vendor';
    on: boolean;
} | {
    t: 'expand_inventory';
} | {
    t: 'expand_roster';
};
/** Authored only by the ledger. Each carries everything the sim needs; the sim judges nothing. */
type ServerEvent = {
    t: 'listed';
    listingId: string;
    kind: TradeKind;
    id: string;
    fee: number;
} | {
    t: 'returned';
    listingId: string;
    goods: Goods;
} | {
    t: 'sold';
    listingId: string;
    kind: TradeKind;
    base: string;
    rarity: Rarity;
    price: number;
    net: number;
} | {
    t: 'bought';
    listingId: string;
    goods: Goods;
    price: number;
} | {
    t: 'order_placed';
    orderId: string;
    escrow: number;
} | {
    t: 'order_refunded';
    orderId: string;
    escrow: number;
} | {
    t: 'order_filled';
    orderId: string;
    item: Item;
    price: number;
} | {
    t: 'order_sold';
    orderId: string;
    itemId: string;
    base: string;
    rarity: Rarity;
    price: number;
    net: number;
} | {
    t: 'credited';
    gold: number;
    reason: string;
}
/** Boss mode: the encounter becomes one undying `world_boss` with these (zone 1 baseline) stats. */
 | {
    t: 'boss_engaged';
    bossId: string;
    name: string;
    glyph: string;
    stats: Stats;
} | {
    t: 'boss_disengaged';
    bossId: string;
}
/**
 * One reward roll; `goods` null when the item waited in returns. `source` absent reads as
 * boss, as every event logged before it does.
 */
 | {
    t: 'rewarded';
    bossId: string;
    goods: Goods | null;
    gold: number;
    source?: RewardSource;
} | SandboxEvent;
/** Authored only by a host with the sandbox on. Each hands out what play would earn, through play's own path. */
type SandboxEvent = 
/** Moves the party to the zone, ends the encounter, and has the next empty tick spawn that boss. */
{
    t: 'sandbox_boss';
    zone: number;
    boss: 'zone_boss' | 'turn_boss';
} | {
    t: 'sandbox_item';
    base: string;
    rarity: Rarity;
} | {
    t: 'sandbox_level';
    heroId: string;
    level: number;
} | {
    t: 'sandbox_zone';
    zone: number;
} | {
    t: 'sandbox_recruit';
    rarity: Rarity;
} | {
    t: 'sandbox_wipe';
};
type Event = PlayerEvent | ServerEvent;
type EventKind = Event['t'];
type PlayerEventKind = PlayerEvent['t'];
type ServerEventKind = ServerEvent['t'];
type SandboxEventKind = SandboxEvent['t'];
declare const SANDBOX_EVENT_KINDS: readonly SandboxEventKind[];
declare const SERVER_EVENT_KINDS: readonly ServerEventKind[];
type Effect = {
    k: 'drop';
    item: Item;
}
/** A drop sold on pickup: `full` for a full inventory, `setting` for the auto-vendor setting. */
 | {
    k: 'drop_vendored';
    item: Item;
    gold: number;
    cause: 'full' | 'setting';
}
/** `reason` is a `credited` event's own; kill gold and a vendored contract carry none. */
 | {
    k: 'gold';
    amount: number;
    reason?: string;
} | {
    k: 'level_up';
    heroId: string;
    level: number;
} | {
    k: 'wave_cleared';
    zone: number;
    wave: number;
} | {
    k: 'zone_cleared';
    zone: number;
    advancedTo: number;
} | {
    k: 'boss_spawned';
    kind: 'zone_boss' | 'turn_boss';
    def: string;
} | {
    k: 'hero_fell';
    heroId: string;
}
/** The party fell and restarts `zone`, the one it is in, at wave 1. */
 | {
    k: 'wipe';
    zone: number;
}
/** The party's third wipe in a zone: it fell back to `zone`, one lower, or restarts zone 1. */
 | {
    k: 'retreat';
    zone: number;
} | {
    k: 'party_applied';
    heroIds: [string, string, string];
} | {
    k: 'hero_recruited';
    hero: Hero;
    via: RecruitVia;
} | {
    k: 'rejected';
    event: Event;
    reason: string;
} | {
    k: 'rewarded';
    bossId: string;
    goods: Goods | null;
    gold: number;
    source: RewardSource;
}
/** The party traveled from one zone to another. */
 | {
    k: 'traveled';
    from: number;
    to: number;
} | {
    k: 'traded';
    entry: Extract<LootEntry, {
        k: 'trade';
    }>;
}
/** Output only: one per attack, by and target actor ids (Hero.id or Enemy.id); feeds no hash. */
 | {
    k: 'hit';
    by: string;
    target: string;
    amount: number;
}
/** Output only: an action starts. Every effect after it, up to the next `act`, is this action's. at: battle ms into this tick, 0..1999. */
 | {
    k: 'act';
    actor: string;
    action: ActionId;
    at: number;
}
/** Output only: a heal landed; amount is the HP actually restored. */
 | {
    k: 'heal';
    by: string;
    target: string;
    amount: number;
}
/** Haste turned on or off: emitted on the change only. */
 | {
    k: 'haste';
    on: boolean;
}
/** Guard turned on or off: emitted on the change only. */
 | {
    k: 'guard';
    on: boolean;
}
/** A mishap enraged this enemy (an Enemy.id). */
 | {
    k: 'enraged';
    enemyId: string;
}
/** The party camped: each party hero and the HP it restored. */
 | {
    k: 'camp';
    heals: {
        heroId: string;
        amount: number;
    }[];
};
type GameState = {
    v: typeof SIM_VERSION;
    seed: number;
    rng: number;
    counter: number;
    tick: number;
    gold: number;
    zone: number;
    wave: number;
    farm: boolean;
    /** The auto-vendor setting, off on every save: Commons, and Uncommons past zone 3, sold on pickup. */
    autoVendor: boolean;
    highestZone: number;
    /** Wipes in the current zone since it was entered or its zone boss last fell; the third retreats. */
    zoneWipes: number;
    roster: Hero[];
    party: [string, string, string];
    pendingParty: [string, string, string] | null;
    inventory: Item[];
    inventoryCap: number;
    rosterCap: number;
    recruits: number;
    turnToolCalls: number;
    encounter: Encounter | null;
    pendingTurnBoss: boolean;
    /** Ticks of Haste left; 0 is off. Set by turn_start, cleared by turn_end and rest. */
    hasteTicks: number;
    /** Ticks of Guard left; 0 is off. Set by guard on, cleared by guard off and rest. */
    guardTicks: number;
    lootLog: LootEntry[];
    stats: {
        kills: number;
        bosses: number;
        wipes: number;
    };
    tallies: Tallies;
    /** Tavern recruits since the last of each rarity or better: the tavern guarantee's counts. */
    guarantee: Record<GuaranteeRarity, number>;
    /** Boss mode: set by boss_engaged, cleared by boss_disengaged. `dealt` is the party's tally for this boss. */
    boss: {
        bossId: string;
        name: string;
        glyph: string;
        stats: Stats;
        dealt: number;
    } | null;
    battle: Battle;
};
type StepResult = {
    state: GameState;
    effects: Effect[];
};

/** Per guarantee, the recruits until one of its rarity or better is certain: 1 means the next. */
declare function tavernGuarantees(state: GameState): Record<GuaranteeRarity, number>;

type Archetype = 'brute' | 'swift' | 'tank' | 'caster' | 'boss' | 'turn_boss';
type EnemyDef = {
    id: string;
    name: string;
    glyph: string;
    zone: number;
    kind: EnemyKind;
    archetype: Archetype;
    stats: Stats;
    xp: number;
    gold: [number, number];
    dropBp: number;
    contractBp: number;
};
type ZoneDef = {
    index: number;
    name: string;
    enemies: string[];
    boss: string;
    turnBoss: string;
    rarityWeights: Record<Rarity, number>;
    bossRarityWeights: Record<Rarity, number>;
};
type ItemBase = {
    id: string;
    name: string;
    glyph: string;
    slot: Slot;
    classes: HeroClass[];
    stats: Partial<Stats>;
    minZone: number;
};
type AffixDef = {
    id: string;
    name: string;
    slots: Slot[];
    stat: Stat;
    range: [number, number];
};
type HeroTemplate = {
    id: string;
    name: string;
    cls: HeroClass;
    glyph: string;
    base: Stats;
    growth: Stats;
};
type TraitDef = {
    id: string;
    name: string;
    stat: Stat;
    rangeBp: [number, number];
};
type RarityRule = {
    affixCount: number;
    traitCount: number;
    levelCap: number;
    statMultBp: number;
    vendorGoldPerZone: number;
    reforgeCost: number;
};
type WeightRule = {
    kind: 'fixed';
    weight: number;
}
/** 0 while the lowest ally is at or above belowBp of max HP; then scale × d² / (belowBp/2)², d = belowBp − lowestBp */
 | {
    kind: 'ally_need';
    belowBp: number;
    scale: number;
};
type TargetRule = 
/** No target to choose (attack_all). */
{
    kind: 'none';
}
/** The front foe (encounter.enemies[0]) weighs `front`, every other foe `other`. */
 | {
    kind: 'front';
    front: number;
    other: number;
}
/** The foe with the lowest current HP (first on a tie) weighs `weakest`, every other foe `other`. */
 | {
    kind: 'weakest';
    weakest: number;
    other: number;
}
/** A living foe of this class weighs `match`, every other living foe `other`. */
 | {
    kind: 'class';
    cls: HeroClass;
    match: number;
    other: number;
}
/** One candidate, weight 1: the living ally with the lowest HP %, first in order on a tie. */
 | {
    kind: 'ally_lowest';
};
type Tactic = {
    action: ActionId;
    weight: WeightRule;
    target: TargetRule;
    /** Skipped while fewer allies than this live (the unit counts itself). */
    minAllies?: number;
};
type Tactics = {
    heroes: Record<HeroClass, Tactic[]>;
    enemies: Record<Archetype | 'world_boss', Tactic[]>;
};
/** What a daily goal counts: kills, zone bosses, Rare or better drops, or one turn boss. */
type GoalKind = 'kills' | 'zone_bosses' | 'rare_drops' | 'turn_boss';
/** A goal row: its target is `base`, plus `step` for every `everyZones` zones past zone 1. */
type GoalRow = {
    kind: GoalKind;
    base: number;
    step: number;
    everyZones: number;
};
/** What an achievement row reads, from the state or from the account's journal. */
type AchievementMetric = 'kills' | 'zone_bosses' | 'turn_bosses' | 'rare_drops' | 'legendary_drops' | 'recruits' | 'reforges' | 'gold_earned' | 'goals_met' | 'streak' | 'zones_complete' | 'bases_complete' | 'epic_held' | 'legendary_held' | 'highest_zone' | 'tier' | 'clean_zone_bosses' | 'classes_capped';
/** A step is crossed when its row's metric reaches `at`; it pays `gold`, and its toast says `words`. */
type AchievementStep = {
    at: number;
    gold: number;
    words: string;
};
/** A ladder has two to four steps, a one-off one. Steps are numbered from 1. */
type AchievementRow = {
    id: string;
    name: string;
    reads: AchievementMetric;
    steps: AchievementStep[];
};
type Content = {
    zones: ZoneDef[];
    enemies: Record<string, EnemyDef>;
    itemBases: Record<string, ItemBase>;
    affixes: Record<string, AffixDef>;
    heroTemplates: Record<string, HeroTemplate>;
    traits: Record<string, TraitDef>;
    epithets: string[];
    rarity: Record<Rarity, RarityRule>;
    tavern: {
        baseCost: number;
        costGrowthBp: number;
        odds: Record<Rarity, number>;
        /** The tavern guarantee: a recruit of each rarity or better comes within this many recruits. */
        guarantees: Record<GuaranteeRarity, number>;
    };
    expansions: {
        inventory: {
            step: number;
            max: number;
            costs: number[];
        };
        roster: {
            step: number;
            max: number;
            costs: number[];
        };
    };
    tactics: Tactics;
    xpToNext: (level: number) => number;
    /** An item tier's multiplier in basis points, tier 1 first. */
    itemTierMultBp: readonly number[];
    /** The ledger's achievement table: data no sim rule reads. */
    achievements: AchievementRow[];
    /** The daily goal's pool: data no sim rule reads. */
    goals: GoalRow[];
};

/** A ladder's steps pay these, in order: a three-step ladder pays the first three. */
declare const LADDER_GOLD: readonly [100, 400, 1500, 5000];
/** What a one-off pays. */
declare const ONE_OFF_GOLD = 500;
/** What the journal adds to the state for the rows that read it. */
type JournalCounts = {
    goalsMet: number;
    streak: number;
};
/** The count an achievement metric reads, from the state and the journal. */
declare function achievementCount(metric: AchievementMetric, state: GameState, journal: JournalCounts): number;

/**
 * The growth of an enemy's stats, xp and gold per zone past the first tier, in basis points, one
 * entry per tier from tier 2: zone 12 + k fights at zone 12's numbers grown once per zone, each
 * zone at its own tier's rate. Tier 2 ramps from zone 12 at ×1.1325, so zone 24 lands where a
 * ×2.78 step at zone 13 and ×1.04 a zone put it (1.1325¹² = 2.78 × 1.04¹² = 4.45, equal to the
 * fourth decimal, so a defence or an attack there may sit a point or two off); tier 3 grows ×1.04
 * from there. Both are tuned to the feel probe at tiers 2 and 3.
 */
declare const TIER_GROWTH_BP: readonly number[];

/** The last zone of the ladder, tier 3's zone 12: the advance gate farms from here, and no zone past it exists. */
declare const LADDER_END = 36;
type ZoneAt = {
    /** The zone within its tier, 1 to 12: whose enemies, boss, weights, name and backdrop it has. */
    base: number;
    tier: number;
    def: ZoneDef;
};
/**
 * A running zone number as its tier and base zone, with the base zone's content: 13 is tier 2's
 * zone 1. Every content lookup by zone goes through here. Nothing for a zone below 1.
 */
declare function zoneAt(zone: number): ZoneAt | undefined;
/**
 * An enemy as it fights at a running zone: the content's own inside tier 1, past it zone 12's
 * numbers grown per zone. Every lookup of an enemy's numbers by zone goes through here. Nothing
 * for an unknown enemy or a zone off the ladder.
 */
declare function enemyAt(id: string, zone: number): EnemyDef | undefined;
/** The zone whose rarity weights a running zone drops at: its base zone in tier 1, zone 12 past it. */
declare function oddsAt(zone: number): ZoneDef | undefined;

declare const content: Content;

type DailyGoal = {
    kind: GoalKind;
    target: number;
};
/**
 * The day's goal for an account: a row of the goal table drawn with the sim's PRNG, seeded from a
 * hash of the UTC day index and the account id, its target scaled to the party's zone. Pure: the
 * ledger and the plugin derive the same goal from the same inputs. No sim rule reads it.
 */
declare function dailyGoal(day: number, accountId: string, zone: number): DailyGoal;
/** What a goal of this kind counts, read from the state: progress is its rise since the day opened. */
declare function goalCount(kind: GoalKind, state: GameState): number;
/** A met goal pays this many of its zone's mean wave kill gold: about an hour of kills at the reference cadence. */
declare const GOAL_GOLD_KILLS = 300;
/**
 * What the day's goal pays, from the zone the day opened at: the mean over the zone's four wave
 * enemies of each one's gold range midpoint, times `GOAL_GOLD_KILLS`, rounded. 0 off the ladder.
 */
declare function goalGold(zone: number): number;

declare const GOLDEN_SEED = 20261002;
/**
 * A fixed 300-event script mixing world events, commands, the reactive events
 * (every turn hasted, hinted calls, a mishap, a guard, a camp in boss mode and
 * one out of it), a world boss stretch (engaged after turn 3, disengaged
 * after turn 6, a reward after turn 7), tavern recruits on a credit, and
 * travel (refused past the highest zone, then back from zone 2 after the
 * sandbox moves the party there). Ids are the ones the initial state
 * mints (h0 to h3) plus guesses, so some commands are rejected; rejections are
 * part of the contract too.
 */
declare function goldenEvents(options?: {
    boss?: boolean;
}): Event[];
declare const GOLDEN_HASH = "ea3cd5be0f52d490";

declare function hashState(state: GameState): string;

declare function vendorValue(item: Item): number;
/** The item tier of a base's drops: its minimum zone 1 to 3 is tier 1, 10 to 12 tier 4. */
declare function baseTier(baseId: string): number;
/**
 * The item tier of a base's drop at a running zone: its base's tier inside the ladder's first
 * tier, then one past the base tiers per ladder tier: 5 in tier 2, 6 in tier 3.
 */
declare function dropTier(zone: number, baseId: string): number;
/**
 * What an affix counts for on its item, in stats and wherever it is shown: the stored flat roll
 * scaled by the item's tier, floored. The sim and the plugin read it here and nowhere else.
 */
declare function affixValue(item: Item, affix: Affix): number;
/** The gold a reforge costs: the rarity's price scaled by the item's tier, floored. */
declare function reforgeCost(item: Item): number;
/** A boss-rarity item of the zone for a party of these classes, drawn from `seed` alone. `id` is '' for the caller to replace. */
declare function rollRewardItem(seed: number, zone: number, classes: readonly HeroClass[]): Item | null;

/** A stored state of any version, in the shape its version had. */
type VersionedState = {
    v: number;
} & Record<string, unknown>;
type Migration = {
    /** Rewrites a state of the step's version into the next one's shape. Pure on shape: it never reads the current rules. */
    state: (state: VersionedState) => VersionedState;
    /**
     * Rewrites goods held outside the state: the ledger's market book, returns and server-event
     * log. Absent, the identity: a step names one only when an item or hero changed shape.
     */
    goods?: (goods: Goods) => Goods;
};
/** One step per version, keyed by the version a step takes a state from. */
type MigrationChain = Readonly<Record<number, Migration>>;
declare const MIGRATIONS: MigrationChain;
type MigrateOptions = {
    chain?: MigrationChain;
    to?: number;
};
type MigrateRefusal = {
    ok: false;
    reason: 'ahead';
    from: number;
    to: number;
}
/** `at` is the first version the chain has no step for. */
 | {
    ok: false;
    reason: 'gap';
    from: number;
    to: number;
    at: number;
};
type MigrateResult = {
    ok: true;
    state: GameState;
    from: number;
    steps: number;
} | MigrateRefusal;
declare function migrate(state: VersionedState, options?: MigrateOptions): MigrateResult;
/** Walks goods stored at version `from` through each step's goods rule, as `migrate` walks a state. */
declare function migrateGoods(goods: Goods, from: number, options?: MigrateOptions): {
    ok: true;
    goods: Goods;
} | MigrateRefusal;

declare function heroStats(state: GameState, hero: Hero): Stats;

/** A hero's gauge gained per step as the battle fills it: zero while guarding, scaled while hasted. */
declare function heroFill(s: GameState, hero: Hero): number;

declare function createInitialState(seed: number): GameState;

declare function step(state: GameState, event: Event): StepResult;
declare function replay(state: GameState, events: readonly Event[]): StepResult;

export { ACTION_STEPS, type AchievementMetric, type AchievementRow, type AchievementStep, type ActionId, type Affix, type AffixDef, type Battle, type Content, type DailyGoal, ENRAGE_BP, type Effect, type Encounter, type Enemy, type EnemyDef, type EnemyKind, type Event, type EventKind, FILL_BP, FILL_K, GAUGE_FULL, GOAL_GOLD_KILLS, GOLDEN_HASH, GOLDEN_SEED, GUARANTEE_RARITIES, GUARD_DAMAGE_BP, GUARD_TICKS, type GameState, type GoalKind, type GoalRow, type Goods, type GuaranteeRarity, HASTE_BP, HASTE_TICKS, type Hero, type HeroClass, type HeroTemplate, type Item, type ItemBase, type JournalCounts, LADDER_END, LADDER_GOLD, type LootEntry, MIGRATIONS, type MigrateOptions, type MigrateRefusal, type MigrateResult, type Migration, type MigrationChain, ONE_OFF_GOLD, POWER_BP, type PlayerEvent, type PlayerEventKind, RARITIES, type Rarity, type RarityCounts, type RarityRule, type RecruitVia, type RewardSource, SANDBOX_EVENT_KINDS, SERVER_EVENT_KINDS, SIM_VERSION, SPAWN_GAUGE_MAX, STEP_MS, type SandboxEvent, type SandboxEventKind, type ServerEvent, type ServerEventKind, type Slot, type Stat, type Stats, type StepResult, TICK_MS, TIER_GROWTH_BP, type Tallies, type TradeKind, type Trait, type TraitDef, type VersionedState, WAVE_ARCHETYPES, type WaveArchetype, type ZoneAt, type ZoneDef, achievementCount, affixValue, baseTier, content, createInitialState, dailyGoal, dropTier, enemyAt, fill, goalCount, goalGold, goldenEvents, hashState, heroFill, heroStats, migrate, migrateGoods, oddsAt, reforgeCost, replay, rollRewardItem, step, tavernGuarantees, vendorValue, zoneAt };
