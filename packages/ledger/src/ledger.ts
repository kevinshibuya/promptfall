import {
  type AccountDeleted,
  type AccountInfo,
  type AdoptReason,
  type Auth,
  type Banned,
  type BatchAck,
  BatchSchema,
  type Boards,
  type Bootstrap,
  type BootstrapRefused,
  BUDGETS,
  type BudgetKind,
  type ChatResult,
  compareSemver,
  type Journal,
  type KeyValue,
  type LinkEnd,
  type LinkPoll,
  type LinkRefused,
  type LinkStart,
  type ListingPage,
  type ListingQuery,
  type MarketResult,
  type MyOrders,
  type NewOrder,
  type Order,
  PRESENCE_TTL_MS,
  type RestDaysResult,
  type ServerClient,
  type ServerConfig,
  ServerEventSchema,
  type Unauthorized,
  type Weekday,
  type WorldSnapshot,
} from '@promptfall/protocol'
import {
  createInitialState,
  type GameState,
  hashState,
  MIGRATIONS,
  type MigrationChain,
  type PlayerEvent,
  type PlayerEventKind,
  replay,
  SANDBOX_EVENT_KINDS,
  type SandboxEvent,
  SIM_VERSION,
  type TradeKind,
} from '@promptfall/sim'
import {
  type AccountRecord,
  author,
  BATCH_RING,
  Books,
  deliveryOf,
  FLAGS_KEY,
  isCurrent,
  KINDS,
  type Link,
  type LoginBan,
  linkKey,
  loginBanKey,
  newRecord,
  publicName,
  settle,
  TrackedKeyValue,
  tokenKey,
  tryAuthor,
} from './books'
import * as boss from './boss'
import * as hunt from './hunt'
import * as journal from './journal'
import * as market from './market'
import * as world from './world'

export type LedgerFlag =
  | 'market.enabled'
  | 'chat.enabled'
  | 'worldboss.enabled'
  | 'presence.enabled'
  | 'leaderboards.enabled'
  | 'hunt.enabled'
  | 'maintenance'
  | 'sandbox.enabled'

/** The flags an operator may set while the host runs: every flag but the sandbox's. */
export const SETTABLE_FLAGS = [
  'market.enabled',
  'chat.enabled',
  'worldboss.enabled',
  'presence.enabled',
  'leaderboards.enabled',
  'hunt.enabled',
  'maintenance',
] as const satisfies readonly LedgerFlag[]
export type SettableFlag = (typeof SETTABLE_FLAGS)[number]

/** The settable flags in `raw` that are booleans; anything else is dropped. */
function settable(raw: unknown): Partial<Record<SettableFlag, boolean>> {
  const out: Partial<Record<SettableFlag, boolean>> = {}
  if (typeof raw !== 'object' || raw === null) return out
  for (const flag of SETTABLE_FLAGS) {
    const value = (raw as Record<string, unknown>)[flag]
    if (typeof value === 'boolean') out[flag] = value
  }
  return out
}

/** What a sandbox host call answers: the refusal is an answer, not a throw. */
export type SandboxOutcome =
  | { ok: true }
  | { ok: false; reason: 'sandbox_off' | 'boss_live' | 'no_boss' | 'unapplicable'; detail?: string }

export type LedgerOptions = {
  kv: KeyValue
  now: () => Promise<number>
  /** Reported in ServerConfig; default 1. */
  speed?: number
  minClientVersion: string
  seedSource: () => number
  /** Device tokens, account ids and link codes. */
  tokenSource: () => string
  flags?: Partial<Record<LedgerFlag, boolean>>
  /** Who approves a link: `approveAs` in the fakes, GitHub's device flow on a `github` host. */
  linkApprover: LinkApprover
  /** Online means a heartbeat inside this many server-clock ms. Default PRESENCE_TTL_MS × (speed ?? 1): heartbeats arrive at real cadence. */
  presenceTtlMs?: number
  /** Ledger notes that are not errors (a disengage with nothing to undo, a migrated record). Default: dropped. */
  log?: (line: string) => void
  /** The migration chain a record behind the sim version walks on load. Default the sim's; tests register a stub. */
  migrations?: MigrationChain
}

export type LedgerHost = {
  /** Mints an account with a given state and name (bots, tests). `bot` marks it off the boards. */
  mint(input: {
    state: GameState
    name: string
    linked: boolean
    bot?: boolean
  }): Promise<{ accountId: string; deviceToken: string }>
  /** Authors a `credited` server event (bot stipends; phase 5 admin). */
  credit(accountId: string, gold: number, reason: string): Promise<void>
  /** Folds the log into the committed state for an account that never batches (bots). */
  settle(accountId: string): Promise<void>
  /** Expires listings and orders past `expiresAt` and delivers returns where a slot is free. */
  sweep(): Promise<void>
  /**
   * Authors a sandbox grant in cursor position. With the flag off it answers `sandbox_off` before
   * anything else; with it on it throws on an unknown account or a non-sandbox event.
   */
  sandbox(accountId: string, event: SandboxEvent): Promise<SandboxOutcome>
  /** Spawns a world boss whose window starts now and engages the online accounts. */
  spawnBoss(): Promise<SandboxOutcome>
  /** Settles the open world boss now, paying every engaged account. */
  settleBoss(): Promise<SandboxOutcome>
  /**
   * Sets flags over the start flags, from the next call on, and stores them so the next start
   * loads them too. Answers the resolved flags.
   */
  setFlags(flags: Partial<Record<SettableFlag, boolean>>): Promise<Record<string, boolean>>
  /**
   * Bans an account: from the next call on, every authenticated call it makes but a delete is
   * refused with `reason`. A linked account's login is banned too, so no account links it.
   * Answers the ban as stored, or null when no account has the id.
   */
  ban(accountId: string, reason: string): Promise<{ reason: string; at: number } | null>
  /**
   * Lifts a login's ban, and the ban of each account it names that is still there. Answers the
   * login lowercased and the accounts lifted, or null for a login never banned.
   */
  unban(login: string): Promise<{ login: string; lifted: string[] } | null>
}

/**
 * A read's store writes. `expire` off leaves listings and orders past `expiresAt` in place;
 * `advance` off leaves the world boss as stored, unspawned, unsettled and unengaged, and the weekly hunt unclosed and unopened; `persist` off
 * leaves the market book at its version mark, unwalked. A secondary session reads with all three
 * off: those writes are the primary's, under its lease.
 */
export type ReadOptions = { expire?: boolean; advance?: boolean; persist?: boolean }

/** A minted name doubles as the GitHub login, which the wire takes at 1 to 64 characters. */
export const PLAYER_NAME_MAX = 64

export const LINK_URL = 'https://github.com/login/device'
export const LINK_INTERVAL_MS = 5000
/** GitHub's device code lives 15 minutes; the sweep drops a link row after that, × the speed. */
export const LINK_TTL_MS = 15 * 60_000

/**
 * The two calls of a link. Both run outside the ledger's mutex, so a slow answer stalls only
 * the caller. `start` gets a code the ledger drew; an approver with its own codes ignores it.
 * `deviceCode` stays in the link record and never reaches the client.
 */
export type LinkApprover = {
  start(code: string): Promise<(LinkStart & { deviceCode: string }) | LinkRefused>
  poll(
    deviceCode: string,
  ): Promise<
    | { status: 'pending' }
    | { status: 'approved'; login: string }
    | { status: 'ended'; reason: LinkEnd; message: string }
  >
}

/** The fakes' approver: the ledger's code, the first poll approves as `login`; `null` never does. */
export function approveAs(login: string | null): LinkApprover {
  return {
    start: async (code) => ({
      code,
      url: LINK_URL,
      intervalMs: LINK_INTERVAL_MS,
      deviceCode: code,
    }),
    poll: async () => (login === null ? { status: 'pending' } : { status: 'approved', login }),
  }
}

const unauthorized: Unauthorized = { reason: 'unauthorized' }
/** A bootstrap with a token the books do not know: only a null token mints. */
const unknownToken: BootstrapRefused = {
  refusal: 'unknown',
  message: 'The server does not know this account.',
}
const pending: LinkPoll = { status: 'pending' }
const refusedUnauthorized: MarketResult = { ok: false, reason: 'unauthorized' }
const chatUnauthorized: ChatResult = { ok: false, reason: 'unauthorized' }
const sandboxOff: SandboxOutcome = { ok: false, reason: 'sandbox_off' }

/** A banned record's refusal, or null for one that plays: the reason is the message. */
function bannedOf(record: AccountRecord): Banned | null {
  if (!record.banned) return null
  return {
    reason: 'banned',
    message: `Promptfall: this account is banned: ${record.banned.reason}`,
  }
}

/** `bannedOf` where the call's refusals carry `ok: false`. */
function refusedBanned(record: AccountRecord): ({ ok: false } & Banned) | null {
  const banned = bannedOf(record)
  return banned ? { ok: false, ...banned } : null
}

/**
 * The account ledger: records, batch replay, server events and the market.
 * Every operation, `host` included, runs through one in-process mutex and
 * ends with one `flush` of whatever it wrote.
 */
export class Ledger implements ServerClient {
  readonly host: LedgerHost
  private readonly kv: TrackedKeyValue
  private readonly books: Books
  private chain: Promise<unknown> = Promise.resolve()
  private readonly presence: world.Presence = new Map()
  private readonly memo = new world.WorldMemo()
  /** The flags under `pf:flags`, over the start flags. */
  private stored: Partial<Record<SettableFlag, boolean>> = {}
  /** Whether this ledger has brought the market book up to the sim version. */
  private bookCurrent = false
  /** The stored flags read at start; every operation waits on it. */
  private readonly loaded: Promise<void>

  constructor(private readonly options: LedgerOptions) {
    this.kv = new TrackedKeyValue(options.kv, (key) => this.memo.written(key))
    this.books = new Books(this.kv, {
      chain: options.migrations ?? MIGRATIONS,
      now: options.now,
      log: options.log ?? (() => undefined),
    })
    this.loaded = (async () => {
      this.stored = settable(await options.kv.get(FLAGS_KEY))
    })()
    // A failed read fails every operation that waits on it, not the process.
    this.loaded.catch(() => undefined)
    this.host = {
      mint: (input) => this.run(() => this.mint(input)),
      credit: (accountId, gold, reason) => this.run(() => this.credit(accountId, gold, reason)),
      settle: (accountId) => this.run(() => this.settleAccount(accountId)),
      sweep: () => this.run(() => this.sweep()),
      sandbox: (accountId, event) => this.run(() => this.sandbox(accountId, event)),
      spawnBoss: () => this.run(() => this.spawnBoss()),
      settleBoss: () => this.run(() => this.settleBoss()),
      setFlags: (flags) => this.run(() => this.setFlags(flags)),
      ban: (accountId, reason) => this.run(() => this.ban(accountId, reason)),
      unban: (login) => this.run(() => this.unban(login)),
    }
  }

  /**
   * The flush runs even when `fn` threw, so an operation must validate before
   * its first `set`; `author` throws before it touches the record for that reason.
   */
  private run<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.chain.then(async () => {
      try {
        await this.loaded
        return await fn()
      } finally {
        await this.kv.flush()
      }
    })
    this.chain = next.catch(() => undefined)
    return next
  }

  private flags(): Record<string, boolean> {
    return {
      'market.enabled': true,
      'chat.enabled': true,
      'worldboss.enabled': true,
      'presence.enabled': true,
      'leaderboards.enabled': true,
      'hunt.enabled': true,
      maintenance: false,
      'sandbox.enabled': false,
      ...this.options.flags,
      ...this.stored,
    }
  }

  private async setFlags(
    flags: Partial<Record<SettableFlag, boolean>>,
  ): Promise<Record<string, boolean>> {
    this.stored = { ...this.stored, ...settable(flags) }
    await this.kv.set(FLAGS_KEY, this.stored)
    return this.flags()
  }

  private async ban(
    accountId: string,
    reason: string,
  ): Promise<{ reason: string; at: number } | null> {
    const record = await this.books.load(accountId)
    if (!record) return null
    record.banned = { reason, at: await this.options.now() }
    await this.books.save(record)
    // The login too, so a fresh account cannot link it; a second ban only adds its account.
    const login = record.account.linked?.login
    if (login) {
      const prior = await this.books.loginBan(login)
      const ban: LoginBan = prior ?? { ...record.banned, accountIds: [] }
      if (!ban.accountIds.includes(accountId)) ban.accountIds = [...ban.accountIds, accountId]
      await this.kv.set(loginBanKey(login), ban)
    }
    return record.banned
  }

  private async unban(login: string): Promise<{ login: string; lifted: string[] } | null> {
    const ban = await this.books.loginBan(login)
    if (!ban) return null
    await this.kv.delete(loginBanKey(login))
    const lifted: string[] = []
    for (const accountId of ban.accountIds) {
      const record = await this.books.load(accountId)
      if (!record?.banned) continue
      delete record.banned
      await this.books.save(record)
      lifted.push(accountId)
    }
    return { login: login.toLowerCase(), lifted }
  }

  private async config(): Promise<ServerConfig> {
    return {
      minClientVersion: this.options.minClientVersion,
      simVersion: SIM_VERSION,
      flags: this.flags(),
      serverNow: await this.options.now(),
      speed: this.options.speed ?? 1,
    }
  }

  /**
   * Every market call starts here, so the book is normalised before its first read. A read that
   * does not persist leaves it as stored; a refused walk is tried again on the next call.
   */
  private async marketContext({ persist }: ReadOptions = {}): Promise<market.MarketContext> {
    const ctx = { books: this.books, now: await this.options.now(), flags: this.flags() }
    if (!this.bookCurrent && persist !== false) {
      const { chain, log } = this.books.migrator
      this.bookCurrent = await market.normaliseBook(ctx, chain, log)
    }
    return ctx
  }

  private async worldContext(at?: number): Promise<world.WorldContext> {
    const speed = this.options.speed ?? 1
    return {
      books: this.books,
      now: at ?? (await this.options.now()),
      flags: this.flags(),
      presence: this.presence,
      memo: this.memo,
      ttl: this.options.presenceTtlMs ?? PRESENCE_TTL_MS * speed,
      speed,
      seedSource: this.options.seedSource,
      log: this.options.log ?? (() => undefined),
    }
  }

  // ---------------------------------------------------------------------------
  // Accounts

  /** A null token always mints; a token mints never, and one the books do not know is `unknown`. */
  bootstrap(input: { clientVersion: string; deviceToken: null }): Promise<Bootstrap>
  bootstrap(input: {
    clientVersion: string
    deviceToken: string | null
  }): Promise<Bootstrap | BootstrapRefused>
  bootstrap(input: {
    clientVersion: string
    deviceToken: string | null
  }): Promise<Bootstrap | BootstrapRefused> {
    return this.run(async (): Promise<Bootstrap | BootstrapRefused> => {
      // Only a null token mints: any string, the empty one too, is a token the books must know.
      if (input.deviceToken !== null) {
        // A known token writes nothing: a secondary session bootstraps every few seconds.
        const record = await this.books.authenticate({ deviceToken: input.deviceToken })
        const banned = record && bannedOf(record)
        if (banned) return { refusal: 'banned', message: banned.message }
        if (record) return this.bootFor(input.deviceToken, record)
        return unknownToken
      }
      const now = await this.options.now()
      const seed = this.options.seedSource() >>> 0
      const deviceToken = this.options.tokenSource()
      const accountId = this.options.tokenSource()
      const record = newRecord(
        { accountId, seed, createdAt: now, displayName: null, linked: null },
        createInitialState(seed),
        now,
      )
      await this.books.save(record)
      await this.kv.set(tokenKey(deviceToken), accountId)
      return this.bootFor(deviceToken, record)
    })
  }

  /** Whether `deviceToken` names an account: a read that writes nothing. */
  knowsToken(deviceToken: string): Promise<boolean> {
    return this.run(async () => (await this.books.authenticate({ deviceToken })) !== null)
  }

  private async bootFor(deviceToken: string, record: AccountRecord): Promise<Bootstrap> {
    const config = await this.config()
    if (!isCurrent(record)) {
      return {
        deviceToken,
        account: record.account,
        config,
        state: record.state,
        seq: record.seq,
        hash: hashState(record.state),
        cursor: 0,
        delivery: { cursor: 0, events: [] },
      }
    }
    return {
      deviceToken,
      account: record.account,
      config,
      state: record.committedState,
      seq: record.seq,
      hash: record.committedHash,
      cursor: record.committedCursor,
      delivery: deliveryOf(record),
    }
  }

  account(auth: Auth): Promise<AccountInfo | Unauthorized | Banned> {
    return this.run(async () => {
      const record = await this.books.authenticate(auth)
      if (!record) return unauthorized
      const banned = bannedOf(record)
      if (banned) return banned
      return {
        account: record.account,
        returns: isCurrent(record) ? record.returns.length : 0,
        config: await this.config(),
        delivery: deliveryOf(record),
      }
    })
  }

  /**
   * Deletes the caller's account. Its open listings and orders close with nothing returned or
   * refunded, its rows leave both boards and presence, and its record and token go. Nothing
   * else is settled: a counterparty, the boss record and the chat history are untouched. The
   * one call a ban lets through: a banned player may leave. A login ban stays behind.
   */
  deleteAccount(auth: Auth): Promise<AccountDeleted | Unauthorized | Banned> {
    return this.run(async () => {
      const record = await this.books.authenticate(auth)
      if (!record) return unauthorized
      const id = record.account.accountId
      await market.closeAllOf(await this.marketContext(), id)
      await world.dropFromBoards(this.kv, id)
      if (this.presence.delete(id)) this.memo.presenceChanged()
      if (record.linkCode) await this.books.dropLink(record.linkCode)
      await this.kv.delete(journal.journalKey(id))
      await this.books.remove(record, auth.deviceToken)
      return { deleted: true } as const
    })
  }

  // ---------------------------------------------------------------------------
  // Batches

  submit(input: Parameters<ServerClient['submit']>[0], auth: Auth): Promise<BatchAck> {
    return this.run(async () => {
      // 0. Schema: throws a ZodError.
      const batch = BatchSchema.parse(input)

      // 3. Authentication.
      const owner = await this.books.accountFor(auth.deviceToken)
      if (!owner || owner !== batch.accountId) return { ok: false, reason: 'unauthorized' }
      const record = await this.books.load(owner)
      if (!record) return { ok: false, reason: 'unauthorized' }
      const banned = refusedBanned(record)
      if (banned) return banned

      // 4. Versions.
      const { minClientVersion } = this.options
      if (compareSemver(batch.clientVersion, minClientVersion) < 0) {
        return { ok: false, reason: 'version_gate', minClientVersion }
      }
      if (batch.simVersion !== SIM_VERSION || !isCurrent(record)) {
        return { ok: false, reason: 'sim_version', simVersion: SIM_VERSION }
      }

      // 5. Duplicates.
      const seen = record.batches.find((c) => c.batchId === batch.batchId)
      if (seen) {
        return {
          ok: true,
          duplicate: true,
          seq: seen.seq,
          hash: seen.hash,
          delivery: deliveryOf(record),
        }
      }

      // 6. Sequence.
      if (batch.seq !== record.seq) return this.adopt(record, 'seq_mismatch')

      // 6a. Cursor. Ahead of the log, or behind what the log still holds: adopt.
      if (batch.cursor > record.cursor || batch.cursor < record.committedCursor) {
        return this.adopt(record, 'cursor_mismatch')
      }
      if (batch.cursor < record.cursor) {
        return { ok: false, reason: 'cursor_behind', delivery: deliveryOf(record) }
      }

      // 7. Base hash, against the committed point.
      if (batch.baseHash !== record.committedHash) return this.adopt(record, 'hash_mismatch')

      // 8. Budgets on the server's clock.
      const now = await this.options.now()
      // Each bucket's clock advances by whole refill periods only, so the
      // remainder carries over and a steady honest cadence never drains it.
      const buckets = {} as Record<BudgetKind, number>
      const refillAt = {} as Record<BudgetKind, number>
      for (const kind of KINDS) {
        const { refillMs, capacity } = BUDGETS[kind]
        const n = Math.floor(Math.max(0, now - record.refillAt[kind]) / refillMs)
        buckets[kind] = Math.min(capacity, record.buckets[kind] + n)
        refillAt[kind] = record.refillAt[kind] + n * refillMs
      }
      const counts = {} as Record<BudgetKind, number>
      for (const kind of KINDS) counts[kind] = 0
      for (const e of batch.events) if (e.t in counts) counts[e.t as BudgetKind] += 1
      for (const kind of KINDS) {
        if (counts[kind] > buckets[kind]) return this.adopt(record, 'rate_capped', kind)
      }

      // 9. Replay the player events on the effective state, which already
      // holds every server event up to the batch's cursor.
      const events: PlayerEvent[] = batch.events.map(
        ({ at: _at, ...event }) => event as PlayerEvent,
      )
      const result = replay(record.state, events).state
      const prevDealt = boss.dealtBefore(record.state, result)
      const before = record.state
      const hash = hashState(result)
      const seq = record.seq + 1
      for (const kind of KINDS) buckets[kind] -= counts[kind]
      record.state = result
      record.seq = seq
      record.refillAt = refillAt
      record.buckets = buckets
      record.batches = [...record.batches, { batchId: batch.batchId, hash, seq }].slice(-BATCH_RING)
      settle(record)
      // The batch's damage to the world boss; a killing commit authors the rewards here.
      const worldCtx = await this.worldContext(now)
      await boss.contribute(worldCtx, record, prevDealt)
      await hunt.countHunt(worldCtx, record, before)
      await this.books.deliverReturns(record)
      // The journal reads the committed state, on this path and the hash mismatch's alike.
      await journal.onCommit(this.kv, record, now)
      await this.offerZone(record, now)
      if (hash === batch.resultHash) {
        await this.books.save(record)
        return { ok: true, duplicate: false, seq, hash, delivery: deliveryOf(record) }
      }
      settle(record)
      await this.books.save(record)
      return {
        ok: false,
        reason: 'hash_mismatch',
        seq,
        state: record.state,
        hash: record.committedHash,
        cursor: record.cursor,
        revokedItemIds: [],
      }
    })
  }

  /** A state-carrying refusal: the client adopts the effective state, so the committed point moves there. */
  private async adopt(
    record: AccountRecord,
    reason: AdoptReason,
    kind?: PlayerEventKind,
  ): Promise<BatchAck> {
    settle(record)
    await this.books.save(record)
    const common = {
      ok: false as const,
      seq: record.seq,
      state: record.state,
      hash: record.committedHash,
      cursor: record.cursor,
    }
    if (reason === 'hash_mismatch') return { ...common, reason, revokedItemIds: [] }
    if (reason === 'rate_capped' && kind) return { ...common, reason, kind }
    return { ...common, reason }
  }

  // ---------------------------------------------------------------------------
  // GitHub link: the approver's round trips sit between two short locked steps.

  async linkStart(auth: Auth): Promise<LinkStart | LinkRefused | Unauthorized | Banned> {
    const found = await this.run(async () => {
      const record = await this.books.authenticate(auth)
      if (!record) return unauthorized
      return bannedOf(record) ?? record.account.accountId
    })
    if (typeof found !== 'string') return found
    const accountId = found
    const started = await this.options.linkApprover.start(this.linkCode())
    if ('refusal' in started) return started
    const { deviceCode, ...start } = started
    return this.run(async () => {
      // An account deleted during the round trip gets no row back.
      const record = await this.books.authenticate(auth)
      if (!record || record.account.accountId !== accountId) return unauthorized
      // One open link per account: a new start replaces the last one's row.
      if (record.linkCode) await this.books.dropLink(record.linkCode)
      await this.books.putLink(start.code, {
        accountId,
        createdAt: await this.options.now(),
        deviceCode,
      })
      record.linkCode = start.code
      await this.books.save(record)
      return start
    })
  }

  async linkPoll(auth: Auth, code: string): Promise<LinkPoll | Unauthorized | Banned> {
    const found = await this.run(async () => {
      const record = await this.books.authenticate(auth)
      if (!record) return unauthorized
      const banned = bannedOf(record)
      if (banned) return banned
      const link = (await this.kv.get(linkKey(code))) as Link | undefined
      if (!link || link.accountId !== record.account.accountId) return pending
      return link
    })
    if (!('accountId' in found)) return found
    const answer = await this.options.linkApprover.poll(found.deviceCode ?? code)
    if (answer.status === 'pending') return pending
    return this.run(async () => {
      const record = await this.books.authenticate(auth)
      if (!record) return unauthorized
      const banned = bannedOf(record)
      if (banned) return banned
      const link = (await this.kv.get(linkKey(code))) as Link | undefined
      // A poll that raced this one already settled the link.
      if (!link || link.accountId !== record.account.accountId) {
        return record.account.linked ? { status: 'linked', account: record.account } : pending
      }
      await this.books.dropLink(code)
      if (record.linkCode === code) delete record.linkCode
      if (answer.status === 'ended') {
        await this.books.save(record)
        return answer
      }
      // A banned login ends the link denied; the account is not banned by that.
      const loginBan = await this.books.loginBan(answer.login)
      if (loginBan) {
        await this.books.save(record)
        return {
          status: 'ended',
          reason: 'denied',
          message: `Promptfall: this GitHub account is banned: ${loginBan.reason}`.slice(0, 200),
        }
      }
      record.account = {
        ...record.account,
        displayName: answer.login,
        linked: { provider: 'github', login: answer.login },
      }
      await this.books.save(record)
      return { status: 'linked', account: record.account }
    })
  }

  /** Eight uppercase letters and digits drawn from the token source. */
  private linkCode(): string {
    let code = ''
    for (let i = 0; i < 16 && code.length < 8; i++) {
      code += this.options
        .tokenSource()
        .replace(/[^0-9a-z]/gi, '')
        .toUpperCase()
    }
    if (code.length < 8) throw new Error('tokenSource gave no letters or digits')
    return code.slice(0, 8)
  }

  // ---------------------------------------------------------------------------
  // Market

  private marketRead<T>(
    auth: Auth,
    { expire = true, persist = true }: ReadOptions,
    fn: (ctx: market.MarketContext, record: AccountRecord) => Promise<T>,
  ): Promise<T | Unauthorized | Banned> {
    return this.run(async () => {
      const record = await this.authenticated(auth, expire, persist)
      if (!record) return unauthorized
      if ('message' in record) return record
      return fn(record.ctx, record.record)
    })
  }

  private marketWrite(
    auth: Auth,
    expire: boolean,
    fn: (ctx: market.MarketContext, record: AccountRecord) => Promise<MarketResult>,
  ): Promise<MarketResult> {
    return this.run(async () => {
      const record = await this.authenticated(auth, expire)
      if (!record) return refusedUnauthorized
      if ('message' in record) return { ok: false, ...record }
      return fn(record.ctx, record.record)
    })
  }

  /**
   * The caller's current record, after expiring what is due. Expiry runs only
   * for an authenticated caller, and the record is read after it, since
   * expiring the caller's own listing changes the caller's record. A banned caller expires nothing.
   */
  private async authenticated(
    auth: Auth,
    expire: boolean,
    persist = true,
  ): Promise<{ ctx: market.MarketContext; record: AccountRecord } | Banned | null> {
    const ctx = await this.marketContext({ persist })
    const caller = await this.books.authenticate(auth)
    if (!caller || !isCurrent(caller)) return null
    const banned = bannedOf(caller)
    if (banned) return banned
    if (!expire) return { ctx, record: caller }
    await market.expireDue(ctx)
    const record = await this.books.load(caller.account.accountId)
    return record ? { ctx, record } : null
  }

  browse(
    auth: Auth,
    query: ListingQuery,
    options: ReadOptions = {},
  ): Promise<ListingPage | Unauthorized | Banned> {
    return this.marketRead(auth, options, (ctx, record) => market.browse(ctx, record, query))
  }

  list(auth: Auth, input: { kind: TradeKind; id: string; price: number }): Promise<MarketResult> {
    return this.marketWrite(auth, false, (ctx, record) => market.list(ctx, record, input))
  }

  cancelListing(auth: Auth, listingId: string): Promise<MarketResult> {
    return this.marketWrite(auth, true, (ctx, record) =>
      market.cancelListing(ctx, record, listingId),
    )
  }

  buy(auth: Auth, listingId: string): Promise<MarketResult> {
    return this.marketWrite(auth, true, (ctx, record) => market.buy(ctx, record, listingId))
  }

  myOrders(auth: Auth, options: ReadOptions = {}): Promise<MyOrders | Unauthorized | Banned> {
    return this.marketRead(auth, options, (ctx, record) => market.myOrders(ctx, record))
  }

  placeOrder(auth: Auth, input: NewOrder): Promise<MarketResult> {
    return this.marketWrite(auth, false, (ctx, record) => market.placeOrder(ctx, record, input))
  }

  cancelOrder(auth: Auth, orderId: string): Promise<MarketResult> {
    return this.marketWrite(auth, true, (ctx, record) => market.cancelOrder(ctx, record, orderId))
  }

  matchingOrders(
    auth: Auth,
    itemId: string,
    options: ReadOptions = {},
  ): Promise<Order[] | Unauthorized | Banned> {
    return this.marketRead(auth, options, (ctx, record) =>
      market.matchingOrders(ctx, record, itemId),
    )
  }

  fillOrder(auth: Auth, orderId: string, itemId: string): Promise<MarketResult> {
    return this.marketWrite(auth, true, (ctx, record) =>
      market.fillOrder(ctx, record, orderId, itemId),
    )
  }

  // ---------------------------------------------------------------------------
  // World: presence, chat, leaderboards

  world(
    auth: Auth,
    since: number,
    { advance = true }: ReadOptions = {},
  ): Promise<WorldSnapshot | Unauthorized | Banned> {
    return this.run(async () => {
      const ctx = await this.worldContext()
      // Before any record loads: the caller's record is read fresh after it. Once a second: a
      // grid point falls on a whole second, so the first poll at or past one still spawns it.
      if (advance && this.memo.advanceDue(ctx.now)) {
        await boss.advanceBoss(ctx)
        await hunt.advanceHunt(ctx)
      }
      const record = await this.books.authenticate(auth)
      if (!record) return unauthorized
      // Banned: no heartbeat either, so the account leaves the online count.
      const banned = bannedOf(record)
      if (banned) return banned
      return world.world(ctx, record, since, advance)
    })
  }

  chat(auth: Auth, text: string): Promise<ChatResult> {
    return this.run(async () => {
      const ctx = await this.worldContext()
      const record = await this.books.authenticate(auth)
      if (!record) return chatUnauthorized
      const banned = refusedBanned(record)
      if (banned) return banned
      return world.chat(ctx, record, text)
    })
  }

  leaderboards(auth: Auth): Promise<Boards | Unauthorized | Banned> {
    return this.run(async () => {
      const ctx = await this.worldContext()
      const record = await this.books.authenticate(auth)
      if (!record) return unauthorized
      const banned = bannedOf(record)
      if (banned) return banned
      return world.leaderboards(ctx)
    })
  }

  // ---------------------------------------------------------------------------
  // Journal

  /** The caller's journal from its committed state: a read that never writes. */
  journal(auth: Auth): Promise<Journal | Unauthorized | Banned> {
    return this.run(async () => {
      const record = await this.books.authenticate(auth)
      if (!record || !isCurrent(record)) return unauthorized
      const banned = bannedOf(record)
      if (banned) return banned
      const stored = await journal.loadJournal(this.kv, record.account.accountId)
      return journal.journalView(stored, record, await this.options.now())
    })
  }

  setRestDays(auth: Auth, days: Weekday[]): Promise<RestDaysResult> {
    return this.run(async (): Promise<RestDaysResult> => {
      const record = await this.books.authenticate(auth)
      if (!record || !isCurrent(record)) return { ok: false, reason: 'unauthorized' }
      const banned = refusedBanned(record)
      if (banned) return banned
      const refusal = journal.restDaysRefusal(days)
      if (refusal) return { ok: false, reason: refusal }
      const now = await this.options.now()
      const stored = await journal.loadJournal(this.kv, record.account.accountId)
      journal.setRestDays(stored, days, now)
      await this.kv.set(journal.journalKey(record.account.accountId), stored)
      return { ok: true, journal: journal.journalView(stored, record, now) }
    })
  }

  // ---------------------------------------------------------------------------
  // Host privileges

  private async mint(input: {
    state: GameState
    name: string
    linked: boolean
    bot?: boolean
  }): Promise<{ accountId: string; deviceToken: string }> {
    if (input.name.length < 1 || input.name.length > PLAYER_NAME_MAX) {
      throw new Error(
        `mint: name wants 1 to ${PLAYER_NAME_MAX} characters; got ${input.name.length}`,
      )
    }
    const now = await this.options.now()
    const accountId = this.options.tokenSource()
    const deviceToken = this.options.tokenSource()
    const record = newRecord(
      {
        accountId,
        seed: input.state.seed,
        createdAt: now,
        displayName: input.name,
        linked: input.linked ? { provider: 'github', login: input.name } : null,
      },
      input.state,
      now,
    )
    if (input.bot) record.bot = true
    await this.books.save(record)
    await this.kv.set(tokenKey(deviceToken), accountId)
    await this.offerZone(record, now)
    return { accountId, deviceToken }
  }

  /** Offers the account's row to the highest-zone board; a bot's is never offered. */
  private async offerZone(record: AccountRecord, now: number): Promise<void> {
    if (record.bot) return
    await world.offerZone(
      this.kv,
      now,
      {
        accountId: record.account.accountId,
        name: publicName(record),
        value: record.state.highestZone,
      },
      (id) => world.isPlaying(this.books, id),
    )
  }

  private async currentRecord(accountId: string): Promise<AccountRecord> {
    const record = await this.books.load(accountId)
    if (!record || !isCurrent(record)) throw new Error(`no current account ${accountId}`)
    return record
  }

  private async credit(accountId: string, gold: number, reason: string): Promise<void> {
    // What the wire schema refuses would make every response for this account unreadable.
    if (!Number.isInteger(gold) || gold < 0) throw new Error(`credit: bad gold ${gold}`)
    if (reason.length > 64) throw new Error('credit: reason over 64 characters')
    const record = await this.currentRecord(accountId)
    author(record, { t: 'credited', gold, reason })
    await this.books.save(record)
  }

  private async sandbox(accountId: string, input: SandboxEvent): Promise<SandboxOutcome> {
    // The flag first: with it off nothing below runs, so the answer is never a throw.
    if (!this.flags()['sandbox.enabled']) return sandboxOff
    // The wire schema's own check, so a grant never makes the account's deliveries unreadable.
    const event = ServerEventSchema.parse(input)
    if (!(SANDBOX_EVENT_KINDS as readonly string[]).includes(event.t)) {
      throw new Error(`sandbox: not a sandbox event: ${event.t}`)
    }
    const record = await this.currentRecord(accountId)
    const refused = tryAuthor(record, event)
    if (refused !== null) {
      return {
        ok: false,
        reason: 'unapplicable',
        detail: refused.replace(/^server_event_unapplicable:/, ''),
      }
    }
    await this.books.save(record)
    return { ok: true }
  }

  private async spawnBoss(): Promise<SandboxOutcome> {
    if (!this.flags()['sandbox.enabled']) return sandboxOff
    return (await boss.spawnNow(await this.worldContext()))
      ? { ok: true }
      : { ok: false, reason: 'boss_live' }
  }

  private async settleBoss(): Promise<SandboxOutcome> {
    if (!this.flags()['sandbox.enabled']) return sandboxOff
    return (await boss.settleNow(await this.worldContext()))
      ? { ok: true }
      : { ok: false, reason: 'no_boss' }
  }

  private async settleAccount(accountId: string): Promise<void> {
    const record = await this.currentRecord(accountId)
    settle(record)
    await this.books.save(record)
  }

  private async sweep(): Promise<void> {
    const ctx = await this.worldContext()
    await boss.advanceBoss(ctx)
    await hunt.advanceHunt(ctx)
    await market.expireDue(await this.marketContext())
    for (const accountId of await this.books.returnsQueue()) {
      const record = await this.books.load(accountId)
      if (!record) continue
      await this.books.deliverReturns(record)
      await this.books.save(record)
    }
    await this.sweepLinks()
  }

  /** Drops the link rows past their lifetime and clears each account's pointer to one. */
  private async sweepLinks(): Promise<void> {
    const cutoff = (await this.options.now()) - LINK_TTL_MS * (this.options.speed ?? 1)
    for (const { code, createdAt } of await this.books.openLinks()) {
      if (createdAt > cutoff) continue
      const link = (await this.kv.get(linkKey(code))) as Link | undefined
      await this.books.dropLink(code)
      const record = link ? await this.books.load(link.accountId) : null
      if (record?.linkCode !== code) continue
      delete record.linkCode
      await this.books.save(record)
    }
  }
}
