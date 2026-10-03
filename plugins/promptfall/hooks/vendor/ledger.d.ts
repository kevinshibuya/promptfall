import { Account, BudgetKind, KeyValue, ServerClient, Bootstrap, Auth, AccountInfo, Unauthorized, BatchAck, LinkStart, LinkPoll, ListingQuery, ListingPage, MarketResult, MyOrders, NewOrder, Order } from './protocol.js';
import { GameState, ServerEvent, Goods, TradeKind } from './sim.js';

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
};
declare const LOG_CAP = 500;

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

/** The next ledger id for a prefix (`L` listings, `O` orders, `t` transferred goods), base 36 over one global counter. */
declare function nextLedgerId(kv: KeyValue, prefix: 'L' | 'O' | 't'): Promise<string>;

type LedgerFlag = 'market.enabled' | 'chat.enabled' | 'worldboss.enabled' | 'maintenance';
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
};
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
    constructor(options: LedgerOptions);
    /**
     * The flush runs even when `fn` threw, so an operation must validate before
     * its first `set`; `author` throws before it touches the record for that reason.
     */
    private run;
    private flags;
    private config;
    private marketContext;
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
    private mint;
    private currentRecord;
    private credit;
    private settleAccount;
    private sweep;
}

export { type AccountRecord, COOLDOWN_MS, EXPIRY_MS, LINK_INTERVAL_MS, LINK_URL, LOG_CAP, Ledger, type LedgerFlag, type LedgerHost, type LedgerOptions, type LogEntry, MAX_PRICE, MIN_PRICE, type PendingReturn, listingFee, nextLedgerId, saleFee, saleNet, transfer, validPrice };
