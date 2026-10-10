import { TradeKind, HeroClass, Rarity, Goods, PlayerEvent, GameState, Hero, Item, ServerEvent, Stats, PlayerEventKind } from './sim.js';
declare namespace z {
  type SafeParse<T> = { success: true; data: T } | { success: false; error: Error }
  interface ZodType<T> {
    parse(value: unknown): T
    safeParse(value: unknown): SafeParse<T>
  }
  type ZodString = ZodType<string>
}

type Listing = {
    id: string;
    sellerId: string;
    sellerName: string;
    goods: Goods;
    price: number;
    createdAt: number;
    expiresAt: number;
};
type Order = {
    id: string;
    buyerId: string;
    base: string;
    minRarity: Rarity;
    affixId: string | null;
    maxPrice: number;
    createdAt: number;
    expiresAt: number;
};
type ListingQuery = {
    kind: TradeKind;
    base?: string;
    cls?: HeroClass;
    minRarity?: Rarity;
    sort: 'price' | 'newest';
    /** 0-based, 10 per page. */
    page: number;
};
type ListingPage = {
    listings: Listing[];
    page: number;
    total: number;
};
type MarketRefusal = 'market_closed' | 'not_linked' | 'unknown_goods' | 'not_tradeable_rarity' | 'in_cooldown' | 'in_party' | 'equipped' | 'bad_price' | 'not_enough_gold' | 'no_space' | 'buyer_full' | 'self_trade' | 'gone' | 'not_owner' | 'no_match' | 'unauthorized';
type MarketResult = {
    ok: true;
    delivery: Delivery;
} | {
    ok: false;
    reason: MarketRefusal;
};
type NewOrder = {
    base: string;
    minRarity: Rarity;
    affixId: string | null;
    maxPrice: number;
};
type MyOrders = {
    listings: Listing[];
    orders: Order[];
    returns: number;
};
type Unauthorized = {
    reason: 'unauthorized';
};
declare const LISTINGS_PER_PAGE = 10;
declare const DeliverySchema: z.ZodType<Delivery>;
declare const ListingSchema: z.ZodType<Listing>;
declare const OrderSchema: z.ZodType<Order>;
declare const ListingQuerySchema: z.ZodType<ListingQuery>;
declare const ListingPageSchema: z.ZodType<ListingPage>;
declare const MARKET_REFUSALS: readonly ["market_closed", "not_linked", "unknown_goods", "not_tradeable_rarity", "in_cooldown", "in_party", "equipped", "bad_price", "not_enough_gold", "no_space", "buyer_full", "self_trade", "gone", "not_owner", "no_match", "unauthorized"];
declare const MarketResultSchema: z.ZodType<MarketResult>;
/** The price is checked by the ledger (`bad_price`), so the schema only wants an integer. */
declare const NewOrderSchema: z.ZodType<NewOrder>;
declare const MyOrdersSchema: z.ZodType<MyOrders>;
declare const UnauthorizedSchema: z.ZodType<Unauthorized>;
/** The body of `POST /v1/listings`. */
declare const NewListingSchema: z.ZodObject<{
    kind: z.ZodEnum<["item", "hero"]>;
    id: z.ZodString;
    price: z.ZodNumber;
}, "strip", z.ZodTypeAny, {
    id: string;
    kind: "item" | "hero";
    price: number;
}, {
    id: string;
    kind: "item" | "hero";
    price: number;
}>;

declare const HEX16: z.ZodString;
/** A player event with the client's timestamp. Server events never pass this schema. */
type TimedEvent = PlayerEvent & {
    at: number;
};
declare const TimedEventSchema: z.ZodType<TimedEvent>;
declare const PLAYER_EVENT_KINDS: readonly ["tick", "tool_call", "turn_end", "rest", "equip", "unequip", "vendor", "reforge", "set_party", "recruit", "dismiss", "set_farm", "expand_inventory", "expand_roster"];
declare const ItemSchema: z.ZodType<Item>;
declare const HeroSchema: z.ZodType<Hero>;
declare const GoodsSchema: z.ZodType<Goods>;
declare const StatsSchema: z.ZodType<Stats>;
declare const ServerEventSchema: z.ZodType<ServerEvent>;
/** Structural check of a sim state: the fields every version has; the rest passes through. */
declare const GameStateSchema: z.ZodType<GameState>;
type Batch = {
    batchId: string;
    accountId: string;
    seq: number;
    clientVersion: string;
    simVersion: number;
    /** The last server event id the client applied; 0 for a fresh account. */
    cursor: number;
    baseHash: string;
    resultHash: string;
    events: TimedEvent[];
};
declare const BatchSchema: z.ZodType<Batch>;
declare function compareSemver(a: string, b: string): -1 | 0 | 1;

type ChatMessage = {
    id: number;
    name: string;
    text: string;
    at: number;
};
type ChatRefusal = 'not_linked' | 'chat_closed' | 'empty' | 'too_long' | 'rate_limited' | 'blocked' | 'unauthorized';
type ChatResult = {
    ok: true;
    message: ChatMessage;
} | {
    ok: false;
    reason: ChatRefusal;
};
type BossView = {
    bossId: string;
    name: string;
    glyph: string;
    maxHp: number;
    /** 0 from the killing commit until `endsAt`, then the boss leaves the snapshot. */
    hp: number;
    /** Server epoch ms. */
    spawnedAt: number;
    endsAt: number;
    /** The caller's tallied contribution. */
    yours: number;
};
type WorldSnapshot = {
    serverNow: number;
    /** The server clock's rate, as `ServerConfig.speed`; a secondary never bootstraps. */
    speed: number;
    online: number;
    /** Ascending zone, counts above 0 only. */
    zones: {
        zone: number;
        count: number;
    }[];
    /** Names in the caller's zone, caller excluded, at most `HERE_MAX`, most recent heartbeat first. */
    here: string[];
    boss: BossView | null;
    /** Ascending id. */
    chat: ChatMessage[];
    /** The resolved flags, the same object as `ServerConfig.flags`. */
    flags: Record<string, boolean>;
};
type BoardRow = {
    accountId: string;
    name: string;
    value: number;
};
/** At most `BOARD_ROWS` rows each, value descending. */
type Boards = {
    highestZone: BoardRow[];
    damage: BoardRow[];
    weekStart: number;
};
/** Online means a heartbeat inside this many real ms. */
declare const PRESENCE_TTL_MS = 45000;
declare const HERE_MAX = 10;
/** UTF-16 units after trimming, the unit `String.length` and Zod's `.max` count. */
declare const CHAT_MAX_CHARS = 200;
declare const CHAT_BUCKET_CAPACITY = 5;
declare const CHAT_REFILL_MS = 10000;
declare const CHAT_KEEP = 200;
declare const CHAT_SERVE = 50;
declare const BOARD_ROWS = 20;
/** Bosses spawn on this grid of the server clock, from epoch zero. */
declare const BOSS_GRID_MS = 10800000;
/** A boss lives this long, or until dead. */
declare const BOSS_WINDOW_MS = 1200000;
/** HP per account online at the spawn. */
declare const BOSS_BASE_HP = 4000;
/** A contribution at or above this share of BOSS_BASE_HP, in basis points, earns the guaranteed drop. */
declare const BOSS_THRESHOLD_BP = 500;
/** The top contributors of a killed boss each get one bonus roll. */
declare const BOSS_TOP_BONUS = 3;
/** Monday 00:00 UTC of the week holding `now` (day 0 was a Thursday). */
declare function weekStartOf(now: number): number;
declare const ChatMessageSchema: z.ZodType<ChatMessage>;
declare const ChatResultSchema: z.ZodType<ChatResult>;
declare const ChatBodySchema: z.ZodObject<{
    text: z.ZodString;
}, "strip", z.ZodTypeAny, {
    text: string;
}, {
    text: string;
}>;
declare const BossViewSchema: z.ZodType<BossView>;
declare const WorldSnapshotSchema: z.ZodType<WorldSnapshot>;
declare const BoardRowSchema: z.ZodType<BoardRow>;
declare const BoardsSchema: z.ZodType<Boards>;

type Auth = {
    deviceToken: string;
};
/** The account's server event log since its committed point. Clients skip `n <= their cursor`. */
type Delivery = {
    cursor: number;
    events: {
        n: number;
        event: ServerEvent;
    }[];
};
type ServerConfig = {
    minClientVersion: string;
    simVersion: number;
    /** Resolved flags: `market.enabled` defaults to true. */
    flags: Record<string, boolean>;
    /** The server's clock (virtual on the HTTP fake) when this response was built. */
    serverNow: number;
    /** Virtual ms per real ms; 1 everywhere but the HTTP fake. */
    speed: number;
};
type AdoptReason = 'seq_mismatch' | 'cursor_mismatch' | 'hash_mismatch' | 'rate_capped';
type BatchAck = {
    ok: true;
    seq: number;
    hash: string;
    duplicate: boolean;
    delivery: Delivery;
} | {
    ok: false;
    reason: 'unauthorized';
} | {
    ok: false;
    reason: 'version_gate';
    minClientVersion: string;
} | {
    ok: false;
    reason: 'sim_version';
    simVersion: number;
}
/** Apply the delivery, re-step, resubmit; nothing is adopted. */
 | {
    ok: false;
    reason: 'cursor_behind';
    delivery: Delivery;
} | {
    ok: false;
    reason: AdoptReason;
    seq: number;
    state: GameState;
    hash: string;
    cursor: number;
    /** Only on `hash_mismatch`; always `[]` in phase 2. */
    revokedItemIds?: string[];
    /** Only on `rate_capped`. */
    kind?: PlayerEventKind;
};
type Account = {
    accountId: string;
    seed: number;
    createdAt: number;
    displayName: string | null;
    linked: null | {
        provider: 'github';
        login: string;
    };
};
type AccountInfo = {
    account: Account;
    returns: number;
    config: ServerConfig;
    delivery: Delivery;
};
type Bootstrap = {
    deviceToken: string;
    account: Account;
    config: ServerConfig;
    /** The committed state. */
    state: GameState;
    seq: number;
    /** Hash and cursor of the committed state. */
    hash: string;
    cursor: number;
    /** What was authored since; the client applies it on top. */
    delivery: Delivery;
};
type LinkStart = {
    code: string;
    url: string;
    intervalMs: number;
};
/** A host that cannot link now: a `github` host without a client id, or GitHub not answering. */
type LinkRefused = {
    refusal: 'link_unavailable';
    message: string;
};
/** Why a link ended unlinked: declined on GitHub, its code expired, or GitHub did not answer. */
type LinkEnd = 'denied' | 'expired' | 'unavailable';
type LinkPoll = {
    status: 'pending';
} | {
    status: 'linked';
    account: Account;
} | {
    status: 'ended';
    reason: LinkEnd;
    message: string;
};
interface ServerClient {
    bootstrap(input: {
        clientVersion: string;
        deviceToken: string | null;
    }): Promise<Bootstrap>;
    submit(batch: Batch, auth: Auth): Promise<BatchAck>;
    account(auth: Auth): Promise<AccountInfo | Unauthorized>;
    linkStart(auth: Auth): Promise<LinkStart | LinkRefused | Unauthorized>;
    linkPoll(auth: Auth, code: string): Promise<LinkPoll | Unauthorized>;
    browse(auth: Auth, query: ListingQuery): Promise<ListingPage | Unauthorized>;
    list(auth: Auth, input: {
        kind: TradeKind;
        id: string;
        price: number;
    }): Promise<MarketResult>;
    cancelListing(auth: Auth, listingId: string): Promise<MarketResult>;
    buy(auth: Auth, listingId: string): Promise<MarketResult>;
    myOrders(auth: Auth): Promise<MyOrders | Unauthorized>;
    placeOrder(auth: Auth, input: NewOrder): Promise<MarketResult>;
    cancelOrder(auth: Auth, orderId: string): Promise<MarketResult>;
    matchingOrders(auth: Auth, itemId: string): Promise<Order[] | Unauthorized>;
    fillOrder(auth: Auth, orderId: string, itemId: string): Promise<MarketResult>;
    /** The world poll: stamps the caller present and answers the snapshot. `since` is the chat mark; 0 asks for the last 50. */
    world(auth: Auth, since: number): Promise<WorldSnapshot | Unauthorized>;
    chat(auth: Auth, text: string): Promise<ChatResult>;
    leaderboards(auth: Auth): Promise<Boards | Unauthorized>;
}
/**
 * The lowest client version a server lets submit: the launch version, so a pre-launch build is
 * told to update. It moves with the plugin's version only when old clients must go.
 */
declare const MIN_CLIENT_VERSION = "0.3.0";
type BudgetKind = 'tick' | 'tool_call' | 'rest' | 'turn_end';
declare const BUDGETS: Record<BudgetKind, {
    refillMs: number;
    capacity: number;
}>;

type FetchLike = (url: string, init: {
    method: string;
    headers: Record<string, string>;
    body?: string;
}) => Promise<{
    status: number;
    ok: boolean;
    text: string;
}>;
/** The route table, base path included. `:id` marks a path segment. */
declare const ROUTES: {
    readonly health: {
        readonly method: "GET";
        readonly path: "/v1/health";
    };
    readonly bootstrap: {
        readonly method: "POST";
        readonly path: "/v1/bootstrap";
    };
    readonly submit: {
        readonly method: "POST";
        readonly path: "/v1/batches";
    };
    readonly account: {
        readonly method: "GET";
        readonly path: "/v1/account";
    };
    readonly linkStart: {
        readonly method: "POST";
        readonly path: "/v1/link/github";
    };
    readonly linkPoll: {
        readonly method: "POST";
        readonly path: "/v1/link/github/poll";
    };
    readonly browse: {
        readonly method: "GET";
        readonly path: "/v1/listings";
    };
    readonly list: {
        readonly method: "POST";
        readonly path: "/v1/listings";
    };
    readonly cancelListing: {
        readonly method: "DELETE";
        readonly path: "/v1/listings/:id";
    };
    readonly buy: {
        readonly method: "POST";
        readonly path: "/v1/listings/:id/buy";
    };
    readonly myOrders: {
        readonly method: "GET";
        readonly path: "/v1/orders";
    };
    readonly placeOrder: {
        readonly method: "POST";
        readonly path: "/v1/orders";
    };
    readonly cancelOrder: {
        readonly method: "DELETE";
        readonly path: "/v1/orders/:id";
    };
    readonly matchingOrders: {
        readonly method: "GET";
        readonly path: "/v1/orders/matching";
    };
    readonly fillOrder: {
        readonly method: "POST";
        readonly path: "/v1/orders/:id/fill";
    };
    readonly world: {
        readonly method: "GET";
        readonly path: "/v1/world";
    };
    readonly chat: {
        readonly method: "POST";
        readonly path: "/v1/chat";
    };
    readonly leaderboards: {
        readonly method: "GET";
        readonly path: "/v1/leaderboards";
    };
};
/**
 * The ServerClient over HTTP. It never retries: the engine owns retries. Ledger
 * refusals come back as values; transport failures throw `ServerUnreachable`
 * (the fetch threw) or `ServerError` (not 200, or a body failing its schema).
 */
declare class HttpClient implements ServerClient {
    private readonly baseUrl;
    private readonly fetch;
    constructor(options: {
        baseUrl: string;
        fetch: FetchLike;
    });
    private call;
    bootstrap(input: {
        clientVersion: string;
        deviceToken: string | null;
    }): Promise<Bootstrap>;
    submit(batch: Batch, auth: Auth): Promise<BatchAck>;
    account(auth: Auth): Promise<AccountInfo | Unauthorized>;
    linkStart(auth: Auth): Promise<LinkStart | LinkRefused | Unauthorized>;
    linkPoll(auth: Auth, code: string): Promise<LinkPoll | Unauthorized>;
    browse(auth: Auth, query: ListingQuery): Promise<ListingPage | Unauthorized>;
    list(auth: Auth, input: {
        kind: TradeKind;
        id: string;
        price: number;
    }): Promise<MarketResult>;
    cancelListing(auth: Auth, listingId: string): Promise<MarketResult>;
    buy(auth: Auth, listingId: string): Promise<MarketResult>;
    myOrders(auth: Auth): Promise<MyOrders | Unauthorized>;
    placeOrder(auth: Auth, input: NewOrder): Promise<MarketResult>;
    cancelOrder(auth: Auth, orderId: string): Promise<MarketResult>;
    matchingOrders(auth: Auth, itemId: string): Promise<Order[] | Unauthorized>;
    fillOrder(auth: Auth, orderId: string, itemId: string): Promise<MarketResult>;
    world(auth: Auth, since: number): Promise<WorldSnapshot | Unauthorized>;
    chat(auth: Auth, text: string): Promise<ChatResult>;
    leaderboards(auth: Auth): Promise<Boards | Unauthorized>;
}

interface KeyValue {
    get(key: string): Promise<unknown>;
    set(key: string, value: unknown): Promise<void>;
    delete(key: string): Promise<void>;
    /** Optional: persist everything written since the last flush, atomically where the host can. The ledger calls it after every mutating operation. */
    flush?(): Promise<void>;
}
/** In-memory KeyValue. Values round-trip through JSON, as they would through a store file. */
declare class MemoryKeyValue implements KeyValue {
    private readonly data;
    get(key: string): Promise<unknown>;
    set(key: string, value: unknown): Promise<void>;
    delete(key: string): Promise<void>;
    keys(): string[];
}

declare const AccountSchema: z.ZodType<Account>;
declare const ServerConfigSchema: z.ZodType<ServerConfig>;
declare const BootstrapSchema: z.ZodType<Bootstrap>;
declare const BatchAckSchema: z.ZodType<BatchAck>;
declare const AccountInfoSchema: z.ZodType<AccountInfo>;
declare const LinkStartSchema: z.ZodType<LinkStart>;
declare const LinkRefusedSchema: z.ZodType<LinkRefused>;
declare const LinkPollSchema: z.ZodType<LinkPoll>;
declare const HealthSchema: z.ZodObject<{
    ok: z.ZodLiteral<true>;
    simVersion: z.ZodNumber;
    seed: z.ZodNumber;
    speed: z.ZodNumber;
    now: z.ZodNumber;
}, "strip", z.ZodTypeAny, {
    seed: number;
    simVersion: number;
    ok: true;
    speed: number;
    now: number;
}, {
    seed: number;
    simVersion: number;
    ok: true;
    speed: number;
    now: number;
}>;
type Health = z.infer<typeof HealthSchema>;
declare const AccountResponseSchema: z.ZodType<Unauthorized | AccountInfo, z.ZodTypeDef, Unauthorized | AccountInfo>;
declare const LinkStartResponseSchema: z.ZodType<Unauthorized | LinkStart | LinkRefused, z.ZodTypeDef, Unauthorized | LinkStart | LinkRefused>;
declare const LinkPollResponseSchema: z.ZodType<Unauthorized | LinkPoll, z.ZodTypeDef, Unauthorized | LinkPoll>;
declare const ListingPageResponseSchema: z.ZodType<ListingPage | Unauthorized>;
declare const MyOrdersResponseSchema: z.ZodType<MyOrders | Unauthorized>;
declare const MatchingOrdersResponseSchema: z.ZodType<Order[] | Unauthorized>;
declare const WorldResponseSchema: z.ZodType<WorldSnapshot | Unauthorized>;
declare const BoardsResponseSchema: z.ZodType<Boards | Unauthorized>;

/** The error bodies of non-200 answers. */
declare const ErrorBodySchema: z.ZodUnion<[z.ZodObject<{
    error: z.ZodLiteral<"schema">;
    issues: z.ZodArray<z.ZodUnknown, "many">;
}, "strip", z.ZodTypeAny, {
    issues: unknown[];
    error: "schema";
}, {
    issues: unknown[];
    error: "schema";
}>, z.ZodObject<{
    error: z.ZodLiteral<"route">;
}, "strip", z.ZodTypeAny, {
    error: "route";
}, {
    error: "route";
}>, z.ZodObject<{
    error: z.ZodLiteral<"internal">;
}, "strip", z.ZodTypeAny, {
    error: "internal";
}, {
    error: "internal";
}>]>;

declare const PROTOCOL_VERSION: 1;

export { type Account, type AccountInfo, AccountInfoSchema, AccountResponseSchema, AccountSchema, type AdoptReason, type Auth, BOARD_ROWS, BOSS_BASE_HP, BOSS_GRID_MS, BOSS_THRESHOLD_BP, BOSS_TOP_BONUS, BOSS_WINDOW_MS, BUDGETS, type Batch, type BatchAck, BatchAckSchema, BatchSchema, type BoardRow, BoardRowSchema, type Boards, BoardsResponseSchema, BoardsSchema, type Bootstrap, BootstrapSchema, type BossView, BossViewSchema, type BudgetKind, CHAT_BUCKET_CAPACITY, CHAT_KEEP, CHAT_MAX_CHARS, CHAT_REFILL_MS, CHAT_SERVE, ChatBodySchema, type ChatMessage, ChatMessageSchema, type ChatRefusal, type ChatResult, ChatResultSchema, type Delivery, DeliverySchema, ErrorBodySchema, type FetchLike, GameStateSchema, GoodsSchema, HERE_MAX, HEX16, type Health, HealthSchema, HeroSchema, HttpClient, ItemSchema, type KeyValue, LISTINGS_PER_PAGE, type LinkEnd, type LinkPoll, LinkPollResponseSchema, LinkPollSchema, type LinkRefused, LinkRefusedSchema, type LinkStart, LinkStartResponseSchema, LinkStartSchema, type Listing, type ListingPage, ListingPageResponseSchema, ListingPageSchema, type ListingQuery, ListingQuerySchema, ListingSchema, MARKET_REFUSALS, MIN_CLIENT_VERSION, type MarketRefusal, type MarketResult, MarketResultSchema, MatchingOrdersResponseSchema, MemoryKeyValue, type MyOrders, MyOrdersResponseSchema, MyOrdersSchema, NewListingSchema, type NewOrder, NewOrderSchema, type Order, OrderSchema, PLAYER_EVENT_KINDS, PRESENCE_TTL_MS, PROTOCOL_VERSION, ROUTES, type ServerClient, type ServerConfig, ServerConfigSchema, ServerEventSchema, StatsSchema, type TimedEvent, TimedEventSchema, type Unauthorized, UnauthorizedSchema, WorldResponseSchema, type WorldSnapshot, WorldSnapshotSchema, compareSemver, weekStartOf };
