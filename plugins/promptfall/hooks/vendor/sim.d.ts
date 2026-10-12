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
/** A spawned enemy's gauge starts at draw(SPAWN_GAUGE_MAX + 1). */
declare const SPAWN_GAUGE_MAX = 5000;
/** Gauge gained per step at this speed, never below 1. */
declare function fill(spd: number): number;

declare const SIM_VERSION: 12;
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
};
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
} | {
    t: 'tool_call';
} | {
    t: 'turn_end';
} | {
    t: 'rest';
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
/** One reward roll; `goods` null when the item waited in returns. */
 | {
    t: 'rewarded';
    bossId: string;
    goods: Goods | null;
    gold: number;
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
} | {
    k: 'gold';
    amount: number;
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
    lootLog: LootEntry[];
    stats: {
        kills: number;
        bosses: number;
        wipes: number;
    };
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
};

/**
 * The step onto the later tiers, in basis points: once, at zone 13, on an enemy's hp, atk and def
 * over zone 12's. The party the feel probe measures there is capped and in tier-5 gear, far past
 * tier 1's zone-12 party, so tier 2 opens on it; xp and gold take no step.
 */
declare const TIER_ENTRY_BP = 27800;
/**
 * The growth of an enemy's stats, xp and gold per zone past the first tier, in basis points:
 * zone 12 + k fights at zone 12's numbers, its stats stepped by TIER_ENTRY_BP, grown k times.
 * Both are tuned to the feel probe at tiers 2 and 3.
 */
declare const TIER_GROWTH_BP = 10400;

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

declare const GOLDEN_SEED = 20261002;
/**
 * A fixed 300-event script mixing world events, commands and a world boss
 * stretch (engaged after turn 3, disengaged after turn 6, a reward after
 * turn 7). Ids are the ones the initial state mints (h0 to h3) plus guesses,
 * so some commands are rejected; rejections are part of the contract too.
 */
declare function goldenEvents(options?: {
    boss?: boolean;
}): Event[];
declare const GOLDEN_HASH = "50186730cdb9fff6";

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

declare function createInitialState(seed: number): GameState;

declare function step(state: GameState, event: Event): StepResult;
declare function replay(state: GameState, events: readonly Event[]): StepResult;

export { ACTION_STEPS, type ActionId, type Affix, type AffixDef, type Battle, type Content, type Effect, type Encounter, type Enemy, type EnemyDef, type EnemyKind, type Event, type EventKind, FILL_BP, FILL_K, GAUGE_FULL, GOLDEN_HASH, GOLDEN_SEED, type GameState, type Goods, type Hero, type HeroClass, type HeroTemplate, type Item, type ItemBase, LADDER_END, type LootEntry, MIGRATIONS, type MigrateOptions, type MigrateRefusal, type MigrateResult, type Migration, type MigrationChain, POWER_BP, type PlayerEvent, type PlayerEventKind, RARITIES, type Rarity, type RarityRule, type RecruitVia, SANDBOX_EVENT_KINDS, SERVER_EVENT_KINDS, SIM_VERSION, SPAWN_GAUGE_MAX, STEP_MS, type SandboxEvent, type SandboxEventKind, type ServerEvent, type ServerEventKind, type Slot, type Stat, type Stats, type StepResult, TICK_MS, TIER_ENTRY_BP, TIER_GROWTH_BP, type TradeKind, type Trait, type TraitDef, type VersionedState, type ZoneAt, type ZoneDef, affixValue, baseTier, content, createInitialState, dropTier, enemyAt, fill, goldenEvents, hashState, heroStats, migrate, migrateGoods, oddsAt, reforgeCost, replay, rollRewardItem, step, vendorValue, zoneAt };
