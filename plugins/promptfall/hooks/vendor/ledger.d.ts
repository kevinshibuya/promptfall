import { Account, BudgetKind, KeyValue, ServerClient, Bootstrap, Auth, AccountInfo, Unauthorized, BatchAck, LinkStart, LinkPoll, ListingQuery, ListingPage, MarketResult, MyOrders, NewOrder, Order, WorldSnapshot, ChatResult, Boards } from './protocol.js';
import { GameState, ServerEvent, Goods, SandboxEvent, TradeKind } from './sim.js';

/** Placeholder content: the mechanism is phase 3's, the word list is not. */
declare const BLOCKED_WORDS: readonly string[];
/** Whole-word and case-insensitive: any word of the text, split on what is not a letter or digit, in the list. */
declare function isBlocked(text: string): boolean;

type BatchRecord = {
    batchId: string;
    hash: string;
    seq: number;
};
type LogEntry = {
    n: number;
    event: ServerEvent;
};
type PendingReturn = {
    listingId: string;
    goods: Goods;
};
/** Everything the ledger knows about one account, written in one `set`. */
type AccountRecord = {
    account: Account;
    /** The effective state: every server event is applied the moment it is authored. */
    state: GameState;
    seq: number;
    /** Per bucket, the time its refill has been counted up to. */
    refillAt: Record<BudgetKind, number>;
    buckets: Record<BudgetKind, number>;
    /** Ring of committed batch ids. */
    batches: BatchRecord[];
    /** Last server event id issued to this account. */
    cursor: number;
    committedCursor: number;
    /** The state at `committedCursor`: what the client's next `baseHash` is checked against. */
    committedState: GameState;
    committedHash: string;
    /** Every event with `n > committedCursor`. */
    log: LogEntry[];
    returns: PendingReturn[];
    /** The chat token bucket; absent means full. */
    chat?: {
        tokens: number;
        refillAt: number;
    };
};
declare const LOG_CAP = 500;

/** The world bosses, one per grid point in turn. Names and glyphs only: the numbers live in the protocol package. */
declare const WORLD_BOSSES: readonly {
    name: string;
    glyph: string;
}[];

declare const COOLDOWN_MS = 86400000;
declare const EXPIRY_MS = 604800000;
declare const MIN_PRICE = 1;
declare const MAX_PRICE = 1000000;
/** The listing fee, kept on cancel and expiry: 2%, at least 1 gold. */
declare function listingFee(price: number): number;
/** The sale fee on listings and order fills: 5%, rounded down. */
declare function saleFee(price: number): number;
/** What the seller receives. */
declare function saleNet(price: number): number;
declare function validPrice(price: number): boolean;
/**
 * Goods changing owner: a fresh `t` id unless they already carry one, the
 * cooldown from `now`, and a hero reset to level 1, no XP, full level-1 HP,
 * nothing worn. A returned listing never comes through here.
 */
declare function transfer(goods: Goods, now: number, nextId: () => Promise<string>, receiver: GameState): Promise<Goods>;

/** The next ledger id for a prefix (`L` listings, `O` orders, `t` transferred goods, `r` boss rewards, `sb` sandbox bosses), base 36 over one global counter. */
declare function nextLedgerId(kv: KeyValue, prefix: 'L' | 'O' | 't' | 'r' | 'sb'): Promise<string>;

type LedgerFlag = 'market.enabled' | 'chat.enabled' | 'worldboss.enabled' | 'presence.enabled' | 'leaderboards.enabled' | 'maintenance' | 'sandbox.enabled';
/** What a sandbox host call answers: the refusal is an answer, not a throw. */
type SandboxOutcome = {
    ok: true;
} | {
    ok: false;
    reason: 'sandbox_off' | 'boss_live' | 'no_boss' | 'unapplicable';
    detail?: string;
};
type LedgerOptions = {
    kv: KeyValue;
    now: () => Promise<number>;
    /** Reported in ServerConfig; default 1. */
    speed?: number;
    minClientVersion: string;
    seedSource: () => number;
    /** Device tokens, account ids and link codes. */
    tokenSource: () => string;
    flags?: Partial<Record<LedgerFlag, boolean>>;
    /** Links approve on the first poll with this login (the fakes). Phase 5 replaces it with GitHub. */
    linkApprover: (code: string) => Promise<{
        login: string;
    } | null>;
    /** Online means a heartbeat inside this many server-clock ms. Default PRESENCE_TTL_MS × (speed ?? 1): heartbeats arrive at real cadence. */
    presenceTtlMs?: number;
    /** Ledger notes that are not errors (a disengage with nothing to undo). Default: dropped. */
    log?: (line: string) => void;
};
type LedgerHost = {
    /** Mints an account with a given state and name (bots, tests). */
    mint(input: {
        state: GameState;
        name: string;
        linked: boolean;
    }): Promise<{
        accountId: string;
        deviceToken: string;
    }>;
    /** Authors a `credited` server event (bot stipends; phase 5 admin). */
    credit(accountId: string, gold: number, reason: string): Promise<void>;
    /** Folds the log into the committed state for an account that never batches (bots). */
    settle(accountId: string): Promise<void>;
    /** Expires listings and orders past `expiresAt` and delivers returns where a slot is free. */
    sweep(): Promise<void>;
    /**
     * Authors a sandbox grant in cursor position. With the flag off it answers `sandbox_off` before
     * anything else; with it on it throws on an unknown account or a non-sandbox event.
     */
    sandbox(accountId: string, event: SandboxEvent): Promise<SandboxOutcome>;
    /** Spawns a world boss whose window starts now and engages the online accounts. */
    spawnBoss(): Promise<SandboxOutcome>;
    /** Settles the open world boss now, paying every engaged account. */
    settleBoss(): Promise<SandboxOutcome>;
};
/**
 * A read's store writes. `expire` off leaves listings and orders past `expiresAt` in place;
 * `advance` off leaves the world boss as stored, unspawned, unsettled and unengaged. A
 * secondary session reads with both off: those writes are the primary's, under its lease.
 */
type ReadOptions = {
    expire?: boolean;
    advance?: boolean;
};
/** A minted name doubles as the GitHub login, which the wire takes at 1 to 64 characters. */
declare const PLAYER_NAME_MAX = 64;
declare const LINK_URL = "https://github.com/login/device";
declare const LINK_INTERVAL_MS = 5000;
/**
 * The account ledger: records, batch replay, server events and the market.
 * Every operation, `host` included, runs through one in-process mutex and
 * ends with one `flush` of whatever it wrote.
 */
declare class Ledger implements ServerClient {
    private readonly options;
    readonly host: LedgerHost;
    private readonly kv;
    private readonly books;
    private chain;
    private readonly presence;
    constructor(options: LedgerOptions);
    /**
     * The flush runs even when `fn` threw, so an operation must validate before
     * its first `set`; `author` throws before it touches the record for that reason.
     */
    private run;
    private flags;
    private config;
    private marketContext;
    private worldContext;
    bootstrap(input: {
        clientVersion: string;
        deviceToken: string | null;
    }): Promise<Bootstrap>;
    private bootFor;
    account(auth: Auth): Promise<AccountInfo | Unauthorized>;
    submit(input: Parameters<ServerClient['submit']>[0], auth: Auth): Promise<BatchAck>;
    /** A state-carrying refusal: the client adopts the effective state, so the committed point moves there. */
    private adopt;
    linkStart(auth: Auth): Promise<LinkStart | Unauthorized>;
    linkPoll(auth: Auth, code: string): Promise<LinkPoll | Unauthorized>;
    /** Eight uppercase letters and digits drawn from the token source. */
    private linkCode;
    private marketRead;
    private marketWrite;
    /**
     * The caller's current record, after expiring what is due. Expiry runs only
     * for an authenticated caller, and the record is read after it, since
     * expiring the caller's own listing changes the caller's record.
     */
    private authenticated;
    browse(auth: Auth, query: ListingQuery, { expire }?: ReadOptions): Promise<ListingPage | Unauthorized>;
    list(auth: Auth, input: {
        kind: TradeKind;
        id: string;
        price: number;
    }): Promise<MarketResult>;
    cancelListing(auth: Auth, listingId: string): Promise<MarketResult>;
    buy(auth: Auth, listingId: string): Promise<MarketResult>;
    myOrders(auth: Auth, { expire }?: ReadOptions): Promise<MyOrders | Unauthorized>;
    placeOrder(auth: Auth, input: NewOrder): Promise<MarketResult>;
    cancelOrder(auth: Auth, orderId: string): Promise<MarketResult>;
    matchingOrders(auth: Auth, itemId: string, { expire }?: ReadOptions): Promise<Order[] | Unauthorized>;
    fillOrder(auth: Auth, orderId: string, itemId: string): Promise<MarketResult>;
    world(auth: Auth, since: number, { advance }?: ReadOptions): Promise<WorldSnapshot | Unauthorized>;
    chat(auth: Auth, text: string): Promise<ChatResult>;
    leaderboards(auth: Auth): Promise<Boards | Unauthorized>;
    private mint;
    private currentRecord;
    private credit;
    private sandbox;
    private spawnBoss;
    private settleBoss;
    private settleAccount;
    private sweep;
}

export { type AccountRecord, BLOCKED_WORDS, COOLDOWN_MS, EXPIRY_MS, LINK_INTERVAL_MS, LINK_URL, LOG_CAP, Ledger, type LedgerFlag, type LedgerHost, type LedgerOptions, type LogEntry, MAX_PRICE, MIN_PRICE, PLAYER_NAME_MAX, type PendingReturn, type ReadOptions, type SandboxOutcome, WORLD_BOSSES, isBlocked, listingFee, nextLedgerId, saleFee, saleNet, transfer, validPrice };
