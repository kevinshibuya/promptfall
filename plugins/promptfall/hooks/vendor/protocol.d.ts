import { Event, GameState, EventKind } from './sim.js';
declare namespace z {
  type SafeParse<T> = { success: true; data: T } | { success: false; error: Error }
  interface ZodType<T> {
    parse(value: unknown): T
    safeParse(value: unknown): SafeParse<T>
  }
  type ZodString = ZodType<string>
}

declare const HEX16: z.ZodString;
type TimedEvent = Event & {
    at: number;
};
declare const TimedEventSchema: z.ZodType<TimedEvent>;
type Batch = {
    batchId: string;
    accountId: string;
    seq: number;
    clientVersion: string;
    simVersion: number;
    baseHash: string;
    resultHash: string;
    events: TimedEvent[];
};
declare const BatchSchema: z.ZodType<Batch>;
declare function compareSemver(a: string, b: string): -1 | 0 | 1;

type Auth = {
    deviceToken: string;
};
type BatchAck = {
    ok: true;
    seq: number;
    hash: string;
    duplicate: boolean;
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
} | {
    ok: false;
    reason: 'seq_mismatch';
    seq: number;
    state: GameState;
    hash: string;
} | {
    ok: false;
    reason: 'hash_mismatch';
    seq: number;
    state: GameState;
    hash: string;
    revokedItemIds: string[];
} | {
    ok: false;
    reason: 'rate_capped';
    seq: number;
    state: GameState;
    hash: string;
    kind: EventKind;
};
type ServerConfig = {
    minClientVersion: string;
    simVersion: number;
    flags: Record<string, boolean>;
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
type Bootstrap = {
    deviceToken: string;
    account: Account;
    config: ServerConfig;
    state: GameState;
    seq: number;
    hash: string;
};
interface ServerClient {
    bootstrap(input: {
        clientVersion: string;
        deviceToken: string | null;
    }): Promise<Bootstrap>;
    submit(batch: Batch, auth: Auth): Promise<BatchAck>;
}
type BudgetKind = 'tick' | 'tool_call' | 'rest' | 'turn_end';
declare const BUDGETS: Record<BudgetKind, {
    refillMs: number;
    capacity: number;
}>;

interface KeyValue {
    get(key: string): Promise<unknown>;
    set(key: string, value: unknown): Promise<void>;
    delete(key: string): Promise<void>;
}
/** In-memory KeyValue. Values round-trip through JSON, as they would through a store file. */
declare class MemoryKeyValue implements KeyValue {
    private readonly data;
    get(key: string): Promise<unknown>;
    set(key: string, value: unknown): Promise<void>;
    delete(key: string): Promise<void>;
    keys(): string[];
}

type LocalServerOptions = {
    kv: KeyValue;
    now: () => Promise<number>;
    minClientVersion: string;
    seedSource: () => number;
    tokenSource: () => string;
};
declare class LocalServer implements ServerClient {
    private readonly options;
    constructor(options: LocalServerOptions);
    private config;
    private load;
    private accountFor;
    bootstrap(input: {
        clientVersion: string;
        deviceToken: string | null;
    }): Promise<Bootstrap>;
    submit(input: Batch, auth: Auth): Promise<BatchAck>;
}

declare const PROTOCOL_VERSION: 1;

export { type Account, type Auth, BUDGETS, type Batch, type BatchAck, BatchSchema, type Bootstrap, HEX16, type KeyValue, LocalServer, type LocalServerOptions, MemoryKeyValue, PROTOCOL_VERSION, type ServerClient, type ServerConfig, type TimedEvent, TimedEventSchema, compareSemver };
