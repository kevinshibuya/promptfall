declare const SIM_VERSION: 3;
type Rarity = 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary';
declare const RARITIES: readonly Rarity[];
type HeroClass = 'knight' | 'black_mage' | 'white_mage' | 'archer';
type Slot = 'weapon' | 'armour' | 'accessory';
type Stat = 'hp' | 'atk' | 'def' | 'spd';
type Stats = Record<Stat, number>;
type Affix = {
    id: string;
    value: number;
};
type Item = {
    id: string;
    base: string;
    rarity: Rarity;
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
type TradeKind = 'item' | 'hero';
type Goods = {
    kind: 'item';
    item: Item;
} | {
    kind: 'hero';
    hero: Hero;
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
    via: 'contract' | 'tavern';
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
};
type Event = PlayerEvent | ServerEvent;
type EventKind = Event['t'];
type PlayerEventKind = PlayerEvent['t'];
type ServerEventKind = ServerEvent['t'];
declare const SERVER_EVENT_KINDS: readonly ServerEventKind[];
type Effect = {
    k: 'drop';
    item: Item;
} | {
    k: 'drop_vendored';
    item: Item;
    gold: number;
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
} | {
    k: 'wipe';
    retreatedTo: number;
} | {
    k: 'party_applied';
    heroIds: [string, string, string];
} | {
    k: 'hero_recruited';
    hero: Hero;
    via: 'contract' | 'tavern';
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
    highestZone: number;
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
};
type StepResult = {
    state: GameState;
    effects: Effect[];
};

type EnemyDef = {
    id: string;
    name: string;
    glyph: string;
    zone: number;
    kind: EnemyKind;
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
    xpToNext: (level: number) => number;
};

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
declare const GOLDEN_HASH = "21ecdbaf9e864e9d";

declare function hashState(state: GameState): string;

declare function vendorValue(item: Item): number;
/** A boss-rarity item of the zone for a party of these classes, drawn from `seed` alone. `id` is '' for the caller to replace. */
declare function rollRewardItem(seed: number, zone: number, classes: readonly HeroClass[]): Item | null;

declare function heroStats(state: GameState, hero: Hero): Stats;

declare function createInitialState(seed: number): GameState;

declare function step(state: GameState, event: Event): StepResult;
declare function replay(state: GameState, events: readonly Event[]): StepResult;

export { type Affix, type AffixDef, type Content, type Effect, type Encounter, type Enemy, type EnemyDef, type EnemyKind, type Event, type EventKind, GOLDEN_HASH, GOLDEN_SEED, type GameState, type Goods, type Hero, type HeroClass, type HeroTemplate, type Item, type ItemBase, type LootEntry, type PlayerEvent, type PlayerEventKind, RARITIES, type Rarity, type RarityRule, SERVER_EVENT_KINDS, SIM_VERSION, type ServerEvent, type ServerEventKind, type Slot, type Stat, type Stats, type StepResult, type TradeKind, type Trait, type TraitDef, type ZoneDef, content, createInitialState, goldenEvents, hashState, heroStats, replay, rollRewardItem, step, vendorValue };
