import type { GameState, PlayerEventKind, ServerEvent, TradeKind } from '@promptfall/sim'
import type {
  ListingPage,
  ListingQuery,
  MarketResult,
  MyOrders,
  NewOrder,
  Order,
  Unauthorized,
} from './market'
import type { Batch } from './schemas'
import type { Boards, ChatResult, WorldSnapshot } from './world'

export type Auth = { deviceToken: string }

/** The account's server event log since its committed point. Clients skip `n <= their cursor`. */
export type Delivery = { cursor: number; events: { n: number; event: ServerEvent }[] }

export type ServerConfig = {
  minClientVersion: string
  simVersion: number
  /** Resolved flags: `market.enabled` defaults to true. */
  flags: Record<string, boolean>
  /** The server's clock (virtual on the HTTP fake) when this response was built. */
  serverNow: number
  /** Virtual ms per real ms; 1 everywhere but the HTTP fake. */
  speed: number
}

export type AdoptReason = 'seq_mismatch' | 'cursor_mismatch' | 'hash_mismatch' | 'rate_capped'

export type BatchAck =
  | { ok: true; seq: number; hash: string; duplicate: boolean; delivery: Delivery }
  | { ok: false; reason: 'unauthorized' }
  | { ok: false; reason: 'version_gate'; minClientVersion: string }
  | { ok: false; reason: 'sim_version'; simVersion: number }
  /** Apply the delivery, re-step, resubmit; nothing is adopted. */
  | { ok: false; reason: 'cursor_behind'; delivery: Delivery }
  | {
      ok: false
      reason: AdoptReason
      seq: number
      state: GameState
      hash: string
      cursor: number
      /** Only on `hash_mismatch`; always `[]` in phase 2. */
      revokedItemIds?: string[]
      /** Only on `rate_capped`. */
      kind?: PlayerEventKind
    }

export type Account = {
  accountId: string
  seed: number
  createdAt: number
  displayName: string | null
  linked: null | { provider: 'github'; login: string }
}

export type AccountInfo = {
  account: Account
  returns: number
  config: ServerConfig
  delivery: Delivery
}

export type Bootstrap = {
  deviceToken: string
  account: Account
  config: ServerConfig
  /** The committed state. */
  state: GameState
  seq: number
  /** Hash and cursor of the committed state. */
  hash: string
  cursor: number
  /** What was authored since; the client applies it on top. */
  delivery: Delivery
}

export type LinkStart = { code: string; url: string; intervalMs: number }
export type LinkPoll = { status: 'pending' } | { status: 'linked'; account: Account }

export interface ServerClient {
  bootstrap(input: { clientVersion: string; deviceToken: string | null }): Promise<Bootstrap>
  submit(batch: Batch, auth: Auth): Promise<BatchAck>
  account(auth: Auth): Promise<AccountInfo | Unauthorized>
  linkStart(auth: Auth): Promise<LinkStart | Unauthorized>
  linkPoll(auth: Auth, code: string): Promise<LinkPoll | Unauthorized>
  browse(auth: Auth, query: ListingQuery): Promise<ListingPage | Unauthorized>
  list(auth: Auth, input: { kind: TradeKind; id: string; price: number }): Promise<MarketResult>
  cancelListing(auth: Auth, listingId: string): Promise<MarketResult>
  buy(auth: Auth, listingId: string): Promise<MarketResult>
  myOrders(auth: Auth): Promise<MyOrders | Unauthorized>
  placeOrder(auth: Auth, input: NewOrder): Promise<MarketResult>
  cancelOrder(auth: Auth, orderId: string): Promise<MarketResult>
  matchingOrders(auth: Auth, itemId: string): Promise<Order[] | Unauthorized>
  fillOrder(auth: Auth, orderId: string, itemId: string): Promise<MarketResult>
  /** The world poll: stamps the caller present and answers the snapshot. `since` is the chat mark; 0 asks for the last 50. */
  world(auth: Auth, since: number): Promise<WorldSnapshot | Unauthorized>
  chat(auth: Auth, text: string): Promise<ChatResult>
  leaderboards(auth: Auth): Promise<Boards | Unauthorized>
}

/**
 * The lowest client version a server lets submit: the launch version, so a pre-launch build is
 * told to update. It moves with the plugin's version only when old clients must go.
 */
export const MIN_CLIENT_VERSION = '0.3.0'

export type BudgetKind = 'tick' | 'tool_call' | 'rest' | 'turn_end'

export const BUDGETS: Record<BudgetKind, { refillMs: number; capacity: number }> = {
  tick: { refillMs: 2000, capacity: 70 },
  tool_call: { refillMs: 1000, capacity: 140 },
  rest: { refillMs: 5000, capacity: 30 },
  turn_end: { refillMs: 5000, capacity: 30 },
}
