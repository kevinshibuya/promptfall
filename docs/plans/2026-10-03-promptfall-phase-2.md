# Promptfall phase 2 implementation plan

**Goal:** Players trade items and heroes on a market, against an HTTP fake with bots, with the sim still the single ledger of what every account owns.
**Architecture:** The sim's event union splits into player events (batchable) and server events (ledger-authored, the effects of trades), sequenced per account by a cursor. A new pure package `@promptfall/ledger` holds account records, batch replay and the market rules; three hosts run it: the in-process fake (default, inside the plugin), the HTTP fake at `servers/fake` (a `node:http` process with a JSON snapshot and seeded bots), and later the real server. `@promptfall/protocol` gains the market types, the widened `ServerClient` and an `HttpClient` over an injected fetch. The plugin's engine learns committed state, pending server events, re-stepping and outages, and the dialog gains Market and Orders tabs, a sell flow and the GitHub link flow.
**Spec:** `docs/spec/promptfall.md` (§5, §7, §9, §10 as amended on 2026-10-03), `docs/adr/0001-trades-as-server-events.md`, `CONTEXT.md`
**Execution model:** opus
**Delivery:** two PRs from `feat/phase-2` into `ai-staging`. PR 1 is Tasks 1 to 6 (transport and ledger, market empty). PR 2 is Tasks 7 to 10 (the market). Each PR gets its own three-leg review and manual pass. PR 2 branches from PR 1's head as `feat/phase-2-market`.

## Global constraints

- Everything in the phase 1 plan's global constraints still holds: integer-only sim, no `Date`/`Math.random`/floats in `packages/sim/src`, event-driven sim, rarity order, classes, slots, 15-second flush, lease, band manners, committed vendor bundles, Biome, English, attribution lines on commits.
- Spec §2: the server is the ledger. The sim never decides a trade; every change of ownership is a server event the ledger authored.
- Spec §7 amended: player events only in a batch; server events `listed`, `returned`, `sold`, `bought`, `order_placed`, `order_refunded`, `order_filled`, `order_sold`, `granted`; a batch declares `cursor`, which must equal the account's latest server event id; `baseHash` is the last committed hash; a batch behind the latest cursor is answered with the pending delivery and resubmitted, one ahead of it gets the authoritative state; every authenticated response may carry a delivery; market actions flush first and need the primary session.
- Spec §5 amended: Rare and above trade; fee `max(1, floor(price × 200 / 10000))` on listing, kept on cancel and expiry; price integer 1 to 1,000,000; sale fee `floor(price × 500 / 10000)` on listings and order fills; listings and orders expire after 7 days (`604_800_000` ms); cooldown 24 hours (`86_400_000` ms); returns never vendored; no self-trade; heroes listed bare and arriving at level 1, 0 XP, full HP; market entries in the loot log; browse open, trade gated by `linked` and `market.enabled`.
- Spec §7 outage: banner at once; sim ticks and buffers for `120_000` ms from the first failure, then pauses; retries back off `1_000 × 2^n` capped at `30_000` ms plus jitter of up to 50%; the first success flushes and clears. A thrown submit is an outage.
- `SIM_VERSION` becomes `2`. No migration. A state behind the server's sim version is reset from the Account tab.
- The plugin calls `$.ui`, `$.state`, `$.store`, `$.clock`, `$.command` and now `$.http.fetch`, nothing else. `claude plugin validate` must list `http.fetch` and no `fs`, `process`, `model`, `prompt`, `audio` or `session` call.
- `$.http.fetch(url, init?)` resolves `{ status, ok, headers, text }` once the body is read; `init` is `{ method?, headers?, body?: string }`. Tests mock it with `on('http.fetch', (_$, e) => ({ status, ok, headers, text }))`. Nothing in the engine's declarations says what a network failure throws, so the client treats any thrown value as an outage.
- The HTTP fake and the ledger are not in the plugin's test kit: they get vitest tests under their own packages. The plugin's HTTP path is covered by the contract suite over `HttpClient` plus plugin tests with a mocked `http.fetch`.
- Wall-clock values in sim state (`tradeableAt`, `expiresAt`) are data the server wrote; the sim never reads them in a rule. A grep for `tradeableAt` under `packages/sim/src` must hit only the type, the server-event handlers that copy it and tests.
- Branch flow: work on `feat/phase-2` (PR 1) and `feat/phase-2-market` (PR 2); PRs into `ai-staging`; nothing lands on `main`.

## Shared contracts

Load-bearing shapes. Later tasks import them by these exact names.

### `@promptfall/sim` additions (`packages/sim/src/types.ts`, re-exported from `index.ts`)

```ts
export const SIM_VERSION = 2 as const

export type Item = {
  id: string
  base: string
  rarity: Rarity
  affixes: Affix[]
  equippedBy: string | null
  /** Server epoch ms before which the ledger refuses to list it; null when never traded. Data, never a rule. */
  tradeableAt: number | null
}
export type Hero = { /* as today, plus: */ tradeableAt: number | null }

export type PlayerEvent =
  | { t: 'tick' } | { t: 'tool_call' } | { t: 'turn_end' } | { t: 'rest' }
  | { t: 'equip'; heroId: string; itemId: string }
  | { t: 'unequip'; heroId: string; slot: Slot }
  | { t: 'vendor'; itemId: string }
  | { t: 'reforge'; itemId: string; affixIndex: number }
  | { t: 'set_party'; heroIds: [string, string, string] }
  | { t: 'recruit' } | { t: 'dismiss'; heroId: string }
  | { t: 'set_farm'; on: boolean }
  | { t: 'expand_inventory' } | { t: 'expand_roster' }

export type TradeKind = 'item' | 'hero'
export type Goods = { kind: 'item'; item: Item } | { kind: 'hero'; hero: Hero }

/** Authored only by the ledger. Each carries everything the sim needs; the sim judges nothing. */
export type ServerEvent =
  | { t: 'listed'; listingId: string; kind: TradeKind; id: string; fee: number }
  | { t: 'returned'; listingId: string; goods: Goods }
  | { t: 'sold'; listingId: string; kind: TradeKind; base: string; rarity: Rarity; price: number; net: number }
  | { t: 'bought'; listingId: string; goods: Goods; price: number }
  | { t: 'order_placed'; orderId: string; escrow: number }
  | { t: 'order_refunded'; orderId: string; escrow: number }
  | { t: 'order_filled'; orderId: string; item: Item; price: number }
  | { t: 'order_sold'; orderId: string; itemId: string; base: string; rarity: Rarity; price: number; net: number }
  | { t: 'granted'; gold: number; reason: string }

export type Event = PlayerEvent | ServerEvent
export type PlayerEventKind = PlayerEvent['t']
export type ServerEventKind = ServerEvent['t']
export const SERVER_EVENT_KINDS: readonly ServerEventKind[]

export type LootEntry =
  | { k: 'item'; itemId: string; base: string; rarity: Rarity; vendoredFor: number | null }
  | { k: 'hero'; heroId: string; template: string; rarity: Rarity; via: 'contract' | 'tavern' }
  | { k: 'trade'; what: 'sold' | 'bought' | 'returned'; kind: TradeKind; base: string; rarity: Rarity; gold: number }

export type Effect = /* as today, plus: */
  | { k: 'traded'; entry: Extract<LootEntry, { k: 'trade' }> }
```

Server-event semantics, one line each (`base` for a hero is the template id):

- `listed`: remove item `id` from `inventory` (it must exist and be unequipped) or hero `id` from `roster` (it must exist, be out of `party` and `pendingParty`, and wear nothing); `gold -= fee`. No loot entry.
- `returned`: put the goods back (`inventory.length < inventoryCap`, `roster.length < rosterCap`); loot entry `returned` with `gold: 0`; effect `traded`.
- `sold`: `gold += net`; loot entry `sold` with `gold: net`; effect `traded`.
- `bought`: `gold -= price` (gold must suffice); put the goods in (cap must allow); loot entry `bought` with `gold: price`; effect `traded`.
- `order_placed`: `gold -= escrow` (must suffice). `order_refunded`: `gold += escrow`.
- `order_filled`: put the item in (cap must allow); loot entry `bought` with `gold: price`; effect `traded`.
- `order_sold`: remove item `itemId` (must exist, unequipped); `gold += net`; loot entry `sold`; effect `traded`.
- `granted`: `gold += gold`; effect `gold`.
- A precondition that fails returns `reject(state, event, 'server_event_unapplicable:<detail>')`. The ledger never produces one; the hash check surfaces it when something is wrong.
- Goods arrive as given: the sim never re-ids or re-rolls them. A hero in `bought`/`returned` is stored exactly as carried (the ledger set level 1, xp 0, hp to the level-1 max, `equipment` all null).

### `@promptfall/protocol` additions (`packages/protocol/src/`)

```ts
// schemas.ts
export type TimedEvent = PlayerEvent & { at: number }        // server events never pass the schema
export type Batch = { /* as today, plus: */ cursor: number }  // last server event id the client applied, 0 at start
export const ServerEventSchema: z.ZodType<ServerEvent>
export const ItemSchema: z.ZodType<Item>; export const HeroSchema: z.ZodType<Hero>

// market.ts (types + schemas)
export type Listing = {
  id: string; sellerId: string; sellerName: string; goods: Goods
  price: number; createdAt: number; expiresAt: number
}
export type Order = {
  id: string; buyerId: string; base: string; minRarity: Rarity
  affixId: string | null; maxPrice: number; createdAt: number; expiresAt: number
}
export type ListingQuery = {
  kind: TradeKind; base?: string; cls?: HeroClass; minRarity?: Rarity
  sort: 'price' | 'newest'; page: number                      // page is 0-based, 10 per page
}
export type ListingPage = { listings: Listing[]; page: number; total: number }
export type MarketRefusal =
  | 'market_closed' | 'not_linked' | 'unknown_goods' | 'not_tradeable_rarity' | 'in_cooldown'
  | 'in_party' | 'equipped' | 'bad_price' | 'not_enough_gold' | 'no_space' | 'self_trade'
  | 'gone' | 'not_owner' | 'no_match' | 'unauthorized'
export type MarketResult = { ok: true; delivery: Delivery } | { ok: false; reason: MarketRefusal }
export type NewOrder = { base: string; minRarity: Rarity; affixId: string | null; maxPrice: number }
export type MyOrders = { listings: Listing[]; orders: Order[]; returns: number }

// client.ts
export type Delivery = { cursor: number; events: { n: number; event: ServerEvent }[] }  // every logged event past the last commit; clients skip n <= their cursor
export type BatchAck =
  | { ok: true; seq: number; hash: string; duplicate: boolean; delivery: Delivery }
  | { ok: false; reason: 'unauthorized' }
  | { ok: false; reason: 'version_gate'; minClientVersion: string }
  | { ok: false; reason: 'sim_version'; simVersion: number }
  | { ok: false; reason: 'cursor_behind'; delivery: Delivery }   // apply, re-step, resubmit; nothing adopted
  | { ok: false; reason: 'seq_mismatch' | 'cursor_mismatch' | 'hash_mismatch' | 'rate_capped'
      seq: number; state: GameState; hash: string; cursor: number
      revokedItemIds?: string[]; kind?: PlayerEventKind }
export type Account = { /* as today */ }
export type AccountInfo = { account: Account; cursor: number; returns: number; config: ServerConfig }
export type Bootstrap = { /* as today, plus: */ cursor: number }
export type LinkStart = { code: string; url: string; intervalMs: number }
export type LinkPoll = { status: 'pending' } | { status: 'linked'; account: Account }

export interface ServerClient {
  bootstrap(input: { clientVersion: string; deviceToken: string | null }): Promise<Bootstrap>
  submit(batch: Batch, auth: Auth): Promise<BatchAck>
  account(auth: Auth): Promise<AccountInfo | { reason: 'unauthorized' }>
  linkStart(auth: Auth): Promise<LinkStart | { reason: 'unauthorized' }>
  linkPoll(auth: Auth, code: string): Promise<LinkPoll | { reason: 'unauthorized' }>
  // PR 2 adds:
  browse(auth: Auth, query: ListingQuery): Promise<ListingPage>
  list(auth: Auth, input: { kind: TradeKind; id: string; price: number }): Promise<MarketResult>
  cancelListing(auth: Auth, listingId: string): Promise<MarketResult>
  buy(auth: Auth, listingId: string): Promise<MarketResult>
  myOrders(auth: Auth): Promise<MyOrders>
  placeOrder(auth: Auth, input: NewOrder): Promise<MarketResult>
  cancelOrder(auth: Auth, orderId: string): Promise<MarketResult>
  matchingOrders(auth: Auth, itemId: string): Promise<Order[]>
  fillOrder(auth: Auth, orderId: string, itemId: string): Promise<MarketResult>
}

// http.ts
export type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body?: string })
  => Promise<{ status: number; ok: boolean; text: string }>
export class HttpClient implements ServerClient { constructor(options: { baseUrl: string; fetch: FetchLike }) }
```

`seq_mismatch`, `cursor_mismatch`, `hash_mismatch` and `rate_capped` share one shape so the engine has one adopt path; `cursor_behind` is the one refusal that adopts nothing. `revokedItemIds` is present only on `hash_mismatch` (always `[]` in phase 2), `kind` only on `rate_capped`. The refusal variants of `account`/`linkStart`/`linkPoll` are objects with a single `reason` key so the HTTP transport can carry them as 200 bodies like every other result.

### HTTP protocol (`servers/fake`, and phase 5)

Base path `/v1`. Auth: header `authorization: Bearer <deviceToken>` on everything but `bootstrap` and `health`. Bodies are JSON. The server answers `200` with the ledger's result for every ledger-level outcome, refusals included (`{ ok: false, reason }` or `{ reason: 'unauthorized' }`), `400 { error: 'schema', issues }` when a body or query fails Zod, `404 { error: 'route' }`, `500 { error: 'internal' }`. `HttpClient` throws on anything but 200 and on a thrown fetch, with `error.name = 'ServerUnreachable'` for the thrown fetch and `error.name = 'ServerError'` for a non-200.

| Method and path | Body | Result |
| --- | --- | --- |
| `GET /v1/health` | | `{ ok: true, simVersion, seed, speed, now }` |
| `POST /v1/bootstrap` | `{ clientVersion, deviceToken }` | `Bootstrap` |
| `POST /v1/batches` | `Batch` | `BatchAck` |
| `GET /v1/account` | | `AccountInfo` |
| `POST /v1/link/github` | | `LinkStart` |
| `POST /v1/link/github/poll` | `{ code }` | `LinkPoll` |
| `GET /v1/listings?kind&base&cls&minRarity&sort&page` | | `ListingPage` |
| `POST /v1/listings` | `{ kind, id, price }` | `MarketResult` |
| `DELETE /v1/listings/:id` | | `MarketResult` |
| `POST /v1/listings/:id/buy` | | `MarketResult` |
| `GET /v1/orders` | | `MyOrders` |
| `POST /v1/orders` | `NewOrder` | `MarketResult` |
| `DELETE /v1/orders/:id` | | `MarketResult` |
| `GET /v1/orders/matching?itemId` | | `Order[]` |
| `POST /v1/orders/:id/fill` | `{ itemId }` | `MarketResult` |

### `@promptfall/ledger` (`packages/ledger/src/index.ts`)

```ts
export type LedgerOptions = {
  kv: KeyValue
  now: () => Promise<number>
  minClientVersion: string
  seedSource: () => number
  tokenSource: () => string          // device tokens and account ids, as LocalServer today
  flags?: Partial<Record<'market.enabled' | 'chat.enabled' | 'worldboss.enabled' | 'maintenance', boolean>>
  /** Links approve on the first poll with this login (the fakes). Phase 5 replaces it with GitHub. */
  linkApprover: (code: string) => Promise<{ login: string } | null>
}
export class Ledger implements ServerClient {
  constructor(options: LedgerOptions)
  /** Host privileges: not routes, never reachable from a client. */
  host: {
    /** Mints an account with a given state and name (bots, tests). */
    mint(input: { state: GameState; name: string; linked: boolean }): Promise<{ accountId: string; deviceToken: string }>
    /** Authors a `granted` server event (bot stipends; phase 5 admin). */
    grant(accountId: string, gold: number, reason: string): Promise<void>
    /** Expires listings and orders past `expiresAt` and delivers returns where a slot is free. Hosts call it on a timer or before each request. */
    sweep(): Promise<void>
  }
}
```

Storage keys, all under the `KeyValue` the host provides (the plugin's `StoreKeyValue` prefixes `promptfall:` as today):

- `pf:acct:<id>:record` → `AccountRecord` = phase 1's record plus `cursor: number` (last server event id issued), `committedCursor: number` (the cursor the client last declared or was handed), `committedHash: string` (the hash at that point), `log: { n: number; event: ServerEvent }[]` (every event with `n > committedCursor`), `returns: Goods[]`. `state` is the **effective** state: every server event is applied to it the moment it is authored.
- `pf:token:<token>` → accountId (as today).
- `pf:link:<code>` → `{ accountId, createdAt }`.
- `pf:listing:<id>` → `Listing`; `pf:listings` → `string[]` of open listing ids (newest last).
- `pf:order:<id>` → `Order`; `pf:orders` → `string[]` of open order ids.
- `pf:counter` → `number`, the global counter behind ledger ids: listings `L<n>`, orders `O<n>`, transferred goods `t<n>`, all base 36.
- `pf:bot:<i>` → `{ accountId, deviceToken }` (written by the HTTP fake's bots, read by nobody else).

Rules the ledger enforces, by operation (every check against the account's committed state; a refusal changes nothing):

- `submit`: phase 1's steps 0 to 8, with two changes. Step 6a, after seq: `batch.cursor > record.cursor` → `cursor_mismatch` with the authoritative state; `batch.cursor < record.cursor` → `cursor_behind` with `delivery` (nothing changes). Step 7 compares `batch.baseHash` to `record.committedHash`, not to the hash of `record.state`. Step 9 replays `batch.events` alone on `record.state` (the server events up to `batch.cursor` are already in it), then sets `committedCursor = record.cursor`, `committedHash = hash`, trims `log`, runs `deliverReturns` for the account, and answers `delivery` = what the log now holds. A duplicate batch answers the committed hash and the current delivery.
- Every other authenticated call that mutates an account appends its server events to that account's `log` with fresh `n`s and applies them to `record.state` with `replay` at once, so every validation reads the effective state and no later player event can undo it (ADR 0001). The response carries `delivery` = the caller's log.
- Authoring an event for the *other* party (the seller when a buyer buys) appends to that account's log and state the same way; that party sees it in its next response, and a batch it already had in flight comes back `cursor_behind`.
- Whenever the server hands a client a full state (bootstrap, or a state-carrying refusal) that state is the new committed point: `committedHash = hash(state)`, `committedCursor = cursor`, `log` emptied. A bootstrap answers `cursor: record.cursor` and nothing pending.
- `deliverReturns(record)`: moves goods from `returns` into the state as `returned` events while a slot is free, oldest first. Runs after every batch commit, after every market mutation on that account, and in `sweep`.
- `list`: refuse `market_closed` unless `flags['market.enabled']` (default true in the fakes), `not_linked` unless `account.linked`; `unknown_goods` when the id is not in the committed inventory/roster; `not_tradeable_rarity` for common/uncommon; `in_cooldown` when `tradeableAt !== null && tradeableAt > now`; `equipped` for a worn item or a hero with any equipment; `in_party` for a hero in `party` or `pendingParty`; `bad_price` outside 1..1,000,000 or non-integer; `not_enough_gold` when gold < fee. Then: listing id `L<n>`, `expiresAt = now + 7 d`, event `listed { fee }` to the seller.
- `cancelListing`: `gone` when not open, `not_owner` when not the seller's. Returns the goods: a free slot → event `returned`; none → push to `returns` and the next `sweep`/response delivers. No refund.
- `buy`: `gone`, `self_trade`, `not_linked`, `market_closed`, `not_enough_gold` (gold < price), `no_space`. Then the goods get a fresh id `t<n>` **if their id does not already start with `t`**, `tradeableAt = now + 24 h`, a hero is reset to level 1, xp 0, hp = level-1 max via `heroStats(buyerState, hero)`, equipment null; buyer gets `bought`, seller gets `sold { net = price − floor(price × 500 / 10000) }`; the listing closes.
- `placeOrder`: `market_closed`, `not_linked`, `bad_price`, unknown base or affix → `unknown_goods`, `not_enough_gold` (gold < maxPrice). Escrow = maxPrice. Event `order_placed` to the buyer; id `O<n>`; `expiresAt = now + 7 d`.
- `cancelOrder`: `gone`, `not_owner`; event `order_refunded`.
- `matchingOrders(itemId)`: open orders where `base` matches, `rarity >= minRarity` in `RARITIES` order, `affixId` null or present on the item, buyer is not the caller; sorted by `maxPrice` descending.
- `fillOrder(orderId, itemId)`: `gone`, the seller-side checks of `list` (`unknown_goods`, `not_tradeable_rarity`, `in_cooldown`, `equipped`, `not_linked`, `market_closed`), `self_trade`, `no_match` when the item does not match, `no_space` when the buyer has no slot (the escrow stays, the order stays open). Price = `maxPrice`; the item is re-id'd and cooled as in `buy`; seller gets `order_sold { net }`, buyer gets `order_filled`; the order closes.
- `sweep`: for every open listing with `expiresAt <= now`: close it and return the goods as `cancelListing` does. For every open order with `expiresAt <= now`: close and `order_refunded`. Then `deliverReturns` for every account with `returns`.
- `linkStart`: code = 8 uppercase letters and digits from `tokenSource()`, `url = 'https://github.com/login/device'`, `intervalMs = 5000`; `linkPoll`: `linkApprover(code)` null → `pending`; else set `account.linked = { provider: 'github', login }`, `displayName = login`, `linked`.
- All ledger operations run through one in-process mutex (a promise chain), so two concurrent requests to the HTTP fake never interleave their reads and writes. Phase 5 replaces the mutex with Postgres transactions.

### `servers/fake` CLI

`pnpm fake -- [--port 7777] [--seed 1] [--speed 1] [--player-name player] [--data .promptfall/fake.json] [--bots 12]`. `--speed` scales a virtual clock: `now() = start + (Date.now() − realStart) × speed`, with `start` persisted so a restart continues the virtual time, and the bots' cadence `20_000 / speed` real ms. The snapshot file holds the whole `KeyValue` and is written after every `set`/`delete` (write to `<path>.tmp`, then rename). `.promptfall/` is git-ignored.

### Plugin engine contract (`plugins/promptfall/hooks/engine.ts`)

```ts
type Buffer = { events: TimedEvent[] }
// Fields the engine holds:
//   committed: GameState       the last state the server acknowledged (bootstrap or ok ack)
//   cursor: number             last server event id applied locally (declared in the next batch)
//   pending: ServerEvent[]     server events applied locally since `committed`, in order
//   buffer: Buffer | null      player events applied locally after `pending`
//   local: GameState           always equals replay(committed, [...pending, ...buffer.events])
// Batch sent: { seq, cursor, baseHash: hash(committed), resultHash: hash(local), events: buffer.events }
```

- `apply(event)`: steps `local`, pushes to `buffer`, publishes.
- `flush()`: single flight, sends the batch, remembers `sentResult = local` and `sentCursor = cursor`. On `ok`: `committed = sentResult`, `pending = []`, `seq = ack.seq`; then `receive(ack.delivery)`. On `cursor_behind`: put `sent` back at the front of the buffer, `receive(ack.delivery)`, and flush again at once (the loop ends because the server only authors events on real trades). On a state-carrying refusal: `committed = local = ack.state`, `cursor = ack.cursor`, `pending = []`, `buffer = null`, `seq = ack.seq`, as `adopt` today. On `version_gate`/`sim_version`/`unauthorized`: pause as today, with the sim-version pause naming the reset in the Account tab. `start()` pauses the same way when `boot.state.v !== SIM_VERSION` (a phase 1 store), with `'Promptfall: this machine's data is from an older version, reset it in /promptfall account'`. Thrown: see outage.
- `receive(delivery)`: drop entries with `n <= cursor`; if none remain, return. Else push the remaining events to `pending`, set `cursor = delivery.cursor`, and **re-step**: `local = replay(committed, pending).state`, then `buffer.events` one by one through `step`, collecting effects; the `rejected` effects of re-stepped player events are reported through `onEffects` (a pane notice), the server events' `traded`/`gold` effects go through `onEffects` as well (toasts). Publish once at the end.
- `trade(fn)`: `await flush()` (and wait for an in-flight one first), then `const r = await fn(client, auth)`; if `r.ok`, `receive(r.delivery)`; return `r`. Refused when the session is not primary or the engine is paused: `{ ok: false, reason: 'unauthorized' }` is never faked; instead `trade` throws `Error('not_primary')` and the dialog shows that.
- Outage: a thrown `submit` sets `outageSince = now` when null, re-queues the buffer at the front (the sent events go back before anything applied during the flight), publishes `notice: 'Promptfall: server unreachable, retrying'`, and schedules a retry at `min(30_000, 1_000 × 2^attempt) × (1 + jitter)` with `jitter` in `[0, 0.5)` from `Math.random()` (the engine is not the sim). `apply` keeps working while `now − outageSince < 120_000`; past that the engine pauses with `'Promptfall: server unreachable'` and stops accepting events. The first successful ack clears `outageSince`, `attempt` and the notice, and unpauses if the pause was the outage's. `trade` during an outage throws `Error('unreachable')`.

## Task list

PR 1: Tasks 1 to 6. PR 2: Tasks 7 to 10.

### Task 1: Sim: player and server events, trade data, SIM_VERSION 2

**Files:**
- `packages/sim/src/types.ts` — modify: the shapes under "Shared contracts"
- `packages/sim/src/server-events.ts` — create: one handler per server event kind
- `packages/sim/src/step.ts` — modify: register the server-event handlers; `Handlers` spans `Event['t']`
- `packages/sim/src/heroes.ts`, `packages/sim/src/loot.ts`, `packages/sim/src/state.ts` — modify: every place that builds an `Item` or `Hero` sets `tradeableAt: null`
- `packages/sim/src/progression.ts` — modify: the loot log cap stays 50; `pushLoot` (or whatever appends) accepts the `trade` entry
- `packages/sim/src/index.ts` — modify: export the new types and `SERVER_EVENT_KINDS`
- `packages/sim/src/golden.ts`, `packages/sim/src/golden.test.ts` — modify: new `GOLDEN_HASH` for v2 state
- `packages/sim/src/server-events.test.ts` — create
- `packages/sim/src/determinism.test.ts` — modify: the property test's event generator also draws server events (a `granted`, a `bought` of a generated item, a `listed` of an owned item) so replay determinism covers them
- Any other sim test that asserts a full `Item`/`Hero` literal — modify to add `tradeableAt: null`

**Interfaces:**
- Consumes: today's `step`, `draft`, `reject`, `clone`, `heroStats`, `findHero`.
- Produces: `PlayerEvent`, `ServerEvent`, `Goods`, `TradeKind`, `SERVER_EVENT_KINDS`, the `trade` loot entry, the `traded` effect, `SIM_VERSION = 2`, `Item.tradeableAt`, `Hero.tradeableAt`.

**Work:** Implement the server-event handlers with the semantics listed under "Shared contracts", using `draft` for the happy path and `reject` for a failed precondition (reason `server_event_unapplicable:<detail>`, detail one of `unknown_item`, `unknown_hero`, `equipped`, `in_party`, `inventory_full`, `roster_full`, `not_enough_gold`). The `bought`/`returned`/`order_filled` handlers insert the carried goods as they are: no `nextId`, no re-roll, no HP recompute (the ledger did that). `listed` on a hero also removes it from nowhere else: the ledger already refused a hero in `party` or `pendingParty`, the handler only re-checks. The `v` field is the only thing `createInitialState` changes for the version bump. Internal structure of `server-events.ts` is yours; keep the sim's existing idioms (`Of<'kind'>`, `draft`).

**Acceptance check:** `pnpm --filter @promptfall/sim test`. Red before: `server-events.test.ts` fails to import; `golden.test.ts` fails on the hash. Green after: every server event kind has a happy-path test that asserts the state delta and the loot entry, every precondition has a reject test, `determinism.test.ts` passes with server events in its generator, and `grep -rn "tradeableAt" packages/sim/src --include='*.ts' | grep -v test` lists only `types.ts`, the three constructors setting `null`, and `server-events.ts`.

**Boundaries:** No change to combat, progression rules, loot tables or content. No wall-clock comparison anywhere in the sim. Do not touch `packages/protocol`.

- [ ] Add the types; set `tradeableAt: null` everywhere an item or hero is built; bump `SIM_VERSION`; fix the type errors `pnpm typecheck` reports in `packages/sim`
- [ ] Write `server-events.test.ts` (red), then `server-events.ts` and the `step.ts` registration
- [ ] Extend the determinism generator; regenerate `GOLDEN_HASH` and note the new value in the commit message
- [ ] Run the acceptance check; commit `feat(sim): server events, trade data and SIM_VERSION 2`

### Task 2: Protocol: cursor, market types, widened client, HttpClient

**Files:**
- `packages/protocol/src/schemas.ts` — modify: `TimedEventSchema` over `PlayerEvent` only; `Batch.cursor`; `ItemSchema`, `HeroSchema`, `ServerEventSchema`, `GoodsSchema`
- `packages/protocol/src/market.ts` — create: the market types and their Zod schemas (`ListingSchema`, `OrderSchema`, `ListingQuerySchema`, `NewOrderSchema`, `MarketResultSchema`, `MyOrdersSchema`, `ListingPageSchema`)
- `packages/protocol/src/client.ts` — modify: `Delivery`, `BatchAck`, `AccountInfo`, `Bootstrap.cursor`, `LinkStart`, `LinkPoll`, the full `ServerClient` (market methods included; PR 1's `Ledger` implements them by refusing `market_closed`)
- `packages/protocol/src/http.ts` — create: `HttpClient`, `FetchLike`, the route table
- `packages/protocol/src/responses.ts` — create: Zod schemas for every response body (`BootstrapSchema`, `BatchAckSchema`, `AccountInfoSchema`, …), used by `HttpClient` to validate what it receives and by the fake to validate what it sends in tests
- `packages/protocol/src/fake/local.ts`, `packages/protocol/src/local.contract.test.ts` — delete (the ledger package takes over in Task 3)
- `packages/protocol/src/index.ts` — modify: exports; drop `LocalServer`
- `packages/protocol/src/schemas.test.ts` — modify: a batch carrying a server event fails the schema; `cursor` required
- `packages/protocol/src/http.test.ts` — create: `HttpClient` against a hand-rolled `FetchLike` that records requests and answers canned bodies; one test per method asserting method, path, query string, auth header and body; one test each for `ServerUnreachable` (fetch throws) and `ServerError` (status 500)
- `packages/protocol/package.json` — modify: nothing new to depend on; keep `zod`

**Interfaces:**
- Consumes: Task 1's types.
- Produces: everything under "`@promptfall/protocol` additions" and the route table under "HTTP protocol".

**Work:** The schemas are the contract on both ends: `HttpClient` parses every response with the matching schema from `responses.ts` and throws `ServerError` on a parse failure, so a drifting fake fails loudly. `HttpClient` builds `url = baseUrl.replace(/\/$/, '') + path`, sends `content-type: application/json` on bodies and `authorization: Bearer <token>` where the table says so, and maps query params with `URLSearchParams`, omitting undefined ones. It never retries: the engine owns retries. `MarketRefusal` and the other refusal objects pass through as values, never as throws.

**Acceptance check:** `pnpm --filter @promptfall/protocol test` green with `http.test.ts` and `schemas.test.ts`; `pnpm typecheck` reports no error in `packages/protocol` (it will report `plugins/` only through the vendor build, which is Task 5's concern). Red before: `http.test.ts` cannot import `HttpClient`.

**Boundaries:** No ledger logic here. Do not touch the plugin. The contract suite file `contract/suite.ts` is Task 3's.

- [ ] Split the schemas; add `cursor`; write the market and response schemas
- [ ] Widen `ServerClient`, `BatchAck`, `Bootstrap`; delete `fake/local.ts` and its test
- [ ] Write `http.test.ts` (red), then `http.ts`
- [ ] Run the acceptance check; commit `feat(protocol): cursor, market types, HttpClient`

### Task 3: Ledger package and the contract suite over it

**Files:**
- `packages/ledger/package.json`, `packages/ledger/tsconfig.json` — create: `@promptfall/ledger`, depends on `@promptfall/sim`, `@promptfall/protocol`, `vitest`; tsconfig references both
- `packages/ledger/src/index.ts` — create: exports `Ledger`, `LedgerOptions`
- `packages/ledger/src/ledger.ts` — create: the class, bootstrap/submit/account/link, the mutex, the record shape
- `packages/ledger/src/market.ts` — create in PR 1 as the refusing stub (`market_closed` for every market method, `browse` empty, `myOrders` empty, `matchingOrders` empty); PR 2 fills it
- `packages/ledger/src/ids.ts` — create: `nextLedgerId(kv, prefix)` over `pf:counter`
- `packages/ledger/src/ledger.contract.test.ts` — create: `runServerContract('Ledger over MemoryKeyValue', …)`
- `packages/ledger/src/ledger.test.ts` — create: unit tests for the cursor rules and `host.grant`/`host.mint`
- `packages/protocol/src/contract/suite.ts` — modify: the `Mirror` tracks `cursor` and applies deliveries; phase 1's rules keep passing; new rules 10 to 13 below
- `tsconfig` roots: `package.json` `typecheck` script adds `packages/ledger`; `pnpm-workspace.yaml` unchanged (`packages/*`)

**Interfaces:**
- Consumes: Task 1 and 2.
- Produces: `Ledger`, `LedgerOptions`, `Ledger.host`, the storage keys.

**Work:** Move phase 1's `LocalServer` logic into `Ledger` as the base, then add the cursor, the log and the committed point per "Shared contracts". The mutex wraps every public method and every `host` method: `private run<T>(fn: () => Promise<T>): Promise<T>` chaining on one promise. The Mirror after bootstrap holds `cursor = boot.cursor` with nothing pending; on a delivery it applies the events with `n > cursor` in order and sets `cursor`. `host.mint` writes a record with `linked` set when asked and the name as both `displayName` and the link login. `host.grant` appends a `granted` event and applies it.

Contract suite additions (two-account cases use a second `bootstrap` with a null token):

- rule 10: a batch whose `cursor` is above the latest gets `cursor_mismatch` with the authoritative state and nothing commits; one below the latest (after a `host.grant`) gets `cursor_behind` carrying the grant, nothing commits, and the same events resubmitted with the new cursor commit with the Mirror's hash.
- rule 11: `make` is `(clock: ContractClock, options: { flags: Record<string, boolean> }) => Promise<{ client: ServerClient; host?: ContractHost }>` with `ContractHost = { grant(accountId: string, gold: number, reason: string): Promise<void>; sweep(): Promise<void> }` (structurally `Ledger.host`; the HTTP fake's test passes its in-process ledger's host). After `host.grant`, `account()` carries the `granted` event in its delivery; a batch declaring that cursor commits and the server hash equals the Mirror's after `[granted, ...events]`; a second `account()` repeats nothing the batch declared. Host rules are skipped when `host` is absent.
- rule 12: a duplicate batch answers `ok, duplicate` with the current delivery; a delivery repeated across two responses carries the same `n`s and the Mirror applies each once.
- rule 13: `linkStart` then `linkPoll` with the code: `linked` with `login` set; `account` shows `linked`; a second account's token cannot poll the first's code (`pending`).

**Acceptance check:** `pnpm --filter @promptfall/ledger test` green (contract suite rules 0 to 13 plus unit tests). Red before: the package does not exist. Also `pnpm --filter @promptfall/protocol test` still green.

**Boundaries:** No market rules yet beyond the stub. No HTTP. Nothing in the plugin.

- [ ] Scaffold the package; move `LocalServer` in as `Ledger`; make phase 1's contract rules pass again under the new name
- [ ] Add cursor, log, delivery, `host`; extend the Mirror; write rules 10 to 13 (red), make them green
- [ ] Run the acceptance check; commit `feat(ledger): account ledger with cursor, deliveries and link flow`

### Task 4: The HTTP fake process

**Files:**
- `servers/fake/package.json`, `servers/fake/tsconfig.json` — create: `@promptfall/fake-server`, depends on `@promptfall/ledger`, `@promptfall/protocol`, `@promptfall/sim`, `tsx`, `vitest`; scripts `start` (`tsx src/cli.ts`), `test`
- `servers/fake/src/file-kv.ts` — create: `FileKeyValue implements KeyValue` with the tmp-and-rename snapshot
- `servers/fake/src/clock.ts` — create: the virtual clock with `speed` and the persisted start
- `servers/fake/src/server.ts` — create: `createFakeServer(options): { listen(port): Promise<{ port, close }> ; ledger: Ledger }` on `node:http`, the route table, auth parsing, Zod validation, the status-code rules
- `servers/fake/src/cli.ts` — create: flag parsing (`node:util` `parseArgs`), startup line `promptfall fake on http://127.0.0.1:<port> seed <n> speed <x> data <path>`, a `sweep` every `60_000 / speed` ms, SIGINT closes cleanly
- `servers/fake/src/server.contract.test.ts` — create: `runServerContract('HTTP fake', …)` where `make` listens on port 0 with a `MemoryKeyValue` and returns `new HttpClient({ baseUrl, fetch })` with `fetch` adapted from Node's global (`text: await r.text()`); `host` is passed too so rule 11 runs
- `servers/fake/src/server.test.ts` — create: `400` on a bad body, `404` on an unknown route, `401`-shaped `{ reason: 'unauthorized' }` at 200 on a bad token, `health` fields, snapshot round-trip (write, new `FileKeyValue` on the same path reads it back)
- `package.json` — modify: `test` script filter adds `./servers/*`; `typecheck` adds `servers/fake`; new script `fake`: `pnpm --filter @promptfall/fake-server start --`
- `pnpm-workspace.yaml` — modify: add `servers/*`
- `.gitignore` — modify: `.promptfall/`
- `.github/workflows/ci.yml` — no change needed if the scripts above cover it; verify

**Interfaces:**
- Consumes: Task 3's `Ledger`, Task 2's schemas and `HttpClient`.
- Produces: `createFakeServer`, the CLI.

**Work:** One `Ledger` per process over `FileKeyValue` (or `MemoryKeyValue` in tests) with `now` from the virtual clock, `linkApprover` answering the `--player-name` login for any live code, `flags: { 'market.enabled': true }`. The router matches `method + path` with `:id` segments; every handler parses auth, validates, calls the ledger inside a try/catch that maps a throw to `500`. The sweep timer runs `ledger.host.sweep()`. Internal structure (router helper, handler table) is yours. No framework.

**Acceptance check:** `pnpm --filter @promptfall/fake-server test` green: the contract suite (rules 0 to 13) passes over HTTP, plus `server.test.ts`. Then `pnpm fake -- --port 7777 --data /tmp/pf-fake.json` prints the startup line and `curl -s localhost:7777/v1/health` answers `{"ok":true,...}`; stop it with Ctrl-C. Paste the curl output in the commit body. Red before: the package does not exist.

**Boundaries:** No bots (Task 8). No market routes beyond what the stub answers. Nothing in the plugin.

- [ ] Scaffold; `FileKeyValue` with its round-trip test; the virtual clock
- [ ] `server.ts` with the route table; `server.test.ts` (red), then green
- [ ] `server.contract.test.ts` over port 0; make the suite pass over HTTP
- [ ] `cli.ts`; the root scripts; run the acceptance check; commit `feat(fake-server): HTTP fake over the ledger`

### Task 5: Plugin: vendor the ledger, engine with cursor and outages, server switching, link flow

**Files:**
- `scripts/vendor.mjs` — modify: third bundle `ledger` (external `@promptfall/sim`, `@promptfall/protocol`; rewrite both to `./sim.js` and `./protocol.js`); the no-`vitest`, no-workspace-import checks cover it
- `scripts/tsconfig.vendor.json` — modify: include `packages/ledger/src`
- `plugins/promptfall/hooks/engine.ts` — modify: the contract under "Plugin engine contract"
- `plugins/promptfall/hooks/server.ts` — create: `resolveClient(setting, io): { client: ServerClient; tokenKey: string; label: string }` — `local` → `new Ledger({ kv: StoreKeyValue, … , linkApprover: async () => ({ login: 'player' }) })` with `tokenKey = 'deviceToken'`; a URL → `new HttpClient({ baseUrl, fetch: io.fetch })` with `tokenKey = 'token:' + url`
- `plugins/promptfall/hooks/register.tsx` — modify: `Io.fetch` from `$.http.fetch` (adapted to `FetchLike`); read the `server` setting from the store (`promptfall:server` → `{ url: string | null }`); `GameSession.switchServer(url)`; pass `accountInfo` into the view; wire the engine's new deps
- `plugins/promptfall/hooks/command.ts` — modify: `server <url>|local` arg; argument hint
- `plugins/promptfall/hooks/ui/dialog.tsx` — modify: Account tab gains the server line (`Server: in-process` or the URL), the link flow (`Link GitHub` button → shows `code` and a `Link` to `url` and polls every `intervalMs` through `$.clock.after` until `linked`; then `Linked as <login>`), and `Reset this machine's data` (deletes every `promptfall:` key the store lists through `$.store.keys()`, which the test kit mocks as `store.keys`)
- `plugins/promptfall/hooks/storage.ts` — modify: `StoreCalls.keys` and `StoreKeyValue.keys()` returning the keys under the prefix, stripped
- `plugins/promptfall/types/index.d.ts` — modify: `GameView.account: { linked: string | null; server: string; marketOpen: boolean }` (`marketOpen` from `config.flags['market.enabled'] !== false`), `DialogState.link: { code: string; url: string } | null`, `PluginState.promptfall.server: string | null`
- `plugins/promptfall/hooks/view.ts` — modify: `toGameView` takes the account info
- `plugins/promptfall/hooks/engine.test.ts` — modify and extend: delivery during flight re-steps; a repeated delivery applies once; `cursor_behind` keeps the buffer, applies the delivery and resubmits; a `cursor_mismatch` adopts; a v1 state at bootstrap pauses with the reset notice; thrown submit → notice, buffer kept and re-queued, retry scheduled with backoff, pause after 120 s, recovery clears; `trade` flushes first and applies the delivery
- `plugins/promptfall/hooks/register.test.ts` — extend: `/promptfall server http://127.0.0.1:1` with `on('http.fetch')` answering a bootstrap, then a throwing fetch → the notice appears and the band keeps ticking; `/promptfall server local` returns to the in-process ledger; the link flow against the in-process ledger shows `Linked as player`
- `plugins/promptfall/README.md` — modify: the `server` command, the link flow, the reset
- `plugins/promptfall/hooks/golden.test.ts` — modify: the v2 golden

**Interfaces:**
- Consumes: Tasks 1 to 4 through the vendor bundles (`./vendor/sim.js`, `./vendor/protocol.js`, `./vendor/ledger.js`).
- Produces: `GameHandle.trade`, `GameHandle.switchServer`, the `server` store setting, the view's `account`.

**Work:** The engine refactor follows the contract verbatim for the fields, the batch shape, `receive`, `trade` and the outage rules; its internal method layout is yours. `switchServer`: flush if primary, cancel timers, rebuild the engine with the new client and token key, `start()` again; the lease is untouched (it is per machine, not per server). The reset button: only while not primary-and-in-flight; after deleting, `switchServer(current)` re-bootstraps a fresh account. The adapted fetch: `(url, init) => $.http.fetch(url, init).then(r => ({ status: r.status, ok: r.ok, text: r.text }))`. Jitter uses `Math.random()` in the plugin, never in the sim.

**Acceptance check:** `pnpm vendor && pnpm vendor:check` clean; `claude plugin validate plugins/promptfall` lists `http.fetch` and no other new namespace; `claude plugin test plugins/promptfall` green including the new engine and register tests; `pnpm exec tsc -p plugins/promptfall` clean. Red before: the plugin fails to type-check against the new `BatchAck`.

**Boundaries:** No market UI, no Market/Orders tabs (Task 9). Do not change the band. Do not change the lease.

- [ ] Vendor the ledger; make the plugin type-check against the new protocol (mechanical fixes only)
- [ ] Engine: committed/pending/re-step/`receive`/`trade`; `engine.test.ts` red then green
- [ ] Outage rules in the engine with their tests
- [ ] `server.ts`, the command arg, `switchServer`, the store setting; register tests
- [ ] Account tab: server line, link flow, reset; dialog test for the link flow
- [ ] README; run the full acceptance check; commit `feat(plugin): ledger in-process, HTTP client, outages, server switching, GitHub link`

### Task 6: PR 1: docs, manual pass, pull request

**Files:**
- `docs/manual-pass/phase-2.md` — create: part A (PR 1) steps; part B is Task 10's
- `README.md` — modify: the repository table gains `packages/ledger` and `servers/fake`; the checks line; the status paragraph
- `HANDOFF.md` — leave to the session mechanics; not committed (excluded)

**Work:** Manual pass part A, in the phase 1 document's voice (numbered steps, what you should see, a red is anything else):

1. `pnpm fake -- --port 7777 --player-name <your name>` in one terminal: the startup line.
2. `claude --plugin-dir plugins/promptfall` in another, `/promptfall server http://127.0.0.1:7777`: the Account tab says `Server: http://127.0.0.1:7777`, a fresh account (zone 1, 0 gold) since nothing moves between servers; the band ticks.
3. Kill the fake (Ctrl-C): within 15 seconds the status row reads `Promptfall: server unreachable, retrying`; the band keeps ticking for two minutes, then the status row reads `Promptfall: server unreachable` and HP stops moving.
4. Restart the fake with the same `--data`: within 30 seconds the notice clears and ticking resumes with the buffered progress kept (gold did not reset).
5. Account tab, `Link GitHub`: a code and a URL appear; within 5 seconds `Linked as <your name>`.
6. `/promptfall server local`: the in-process account comes back with its phase 1 progress untouched, or the reset notice if its store is a v1 state; `Reset this machine's data` then starts a fresh account.
7. Quit both. `cat .promptfall/fake.json | head -c 300` shows the snapshot.

Then open the PR from `feat/phase-2` into `ai-staging` titled `Promptfall phase 2, PR 1: ledger, HTTP fake, outages, link flow`, body: what landed, the verification commands and their results, the manual pass pointer, the attribution lines. Stop and hand Kevin the manual pass.

**Acceptance check:** `pnpm lint && pnpm typecheck && pnpm test && pnpm vendor:check` green in one run, pasted in the PR body; `gh pr view --json url` shows the PR.

**Boundaries:** No code changes in this task beyond docs. Do not merge.

- [ ] Write part A of the manual pass; update the READMEs
- [ ] Run the full check line; open the PR; stop

### Task 7: Ledger market rules, routes, contract cases

**Files:**
- `packages/ledger/src/market.ts` — modify: replace the stub with the rules under "`@promptfall/ledger`"
- `packages/ledger/src/goods.ts` — create: `transfer(goods, now, nextId)`: re-id if not `t`-prefixed, cooldown, hero reset via `heroStats`
- `packages/ledger/src/ledger.ts` — modify: `sweep` grows expiry and returns delivery; `account` reports `returns`
- `packages/ledger/src/market.test.ts` — create: unit tests for fee rounding (`price 1 → fee 1`, `price 49 → fee 1`, `price 50 → fee 1`, `price 51 → fee 1`, `price 100 → fee 2`; sale fee `price 19 → 0`, `price 20 → 1`), cooldown boundary (`tradeableAt === now` is tradeable), expiry boundary (`expiresAt === now` expires), returns delivery order
- `packages/protocol/src/contract/suite.ts` — modify: rules 14 to 24
- `servers/fake/src/server.ts` — modify: the nine market routes
- `servers/fake/src/server.test.ts` — modify: query parsing for `GET /v1/listings` (bad `page` → 400; missing `sort` → 400)

**Interfaces:**
- Consumes: Task 3's `Ledger`, Task 2's market types.
- Produces: the market half of `ServerClient` on both hosts.

**Work:** Contract rules, each a two-account scenario unless noted, with the Mirror on both sides asserting hashes after deliveries:

- rule 14: a common item cannot be listed (`not_tradeable_rarity`); an equipped rare cannot (`equipped`); a hero in the party cannot (`in_party`); a price of 0 or 1,000,001 cannot (`bad_price`).
- rule 15: listing a rare item removes it, charges `max(1, floor(price×200/10000))`, and `browse` shows it with the seller's name; the seller's own `browse` result marks nothing special (the client does that).
- rule 16: buying it moves the goods with a `t`-prefixed id and `tradeableAt = now + 24 h`, charges the buyer `price`, pays the seller `price − floor(price×500/10000)` in the seller's next delivery; both hashes match the server's.
- rule 17: buying your own listing is `self_trade`; buying with less gold is `not_enough_gold`; buying with a full inventory is `no_space` and the listing stays open.
- rule 18: cancel returns the goods; cancel with a full inventory puts them in `returns`, `account.returns === 1`, and a batch that vendors one item gets `returned` in its own ack's delivery.
- rule 19: a listing older than 7 days is gone after `sweep`; its goods return.
- rule 20: a bought item cannot be relisted before 24 h (`in_cooldown`); at exactly `tradeableAt` it can.
- rule 21: a hero sold at level 7 arrives at level 1, xp 0, hp equal to the level-1 max, same rarity and traits, no equipment; a hero with equipment cannot be listed (`equipped`).
- rule 22: `placeOrder` escrows `maxPrice`; `cancelOrder` refunds it; an expired order refunds on `sweep`.
- rule 23: `matchingOrders` matches base, minimum rarity in `RARITIES` order and the required affix, never the caller's own orders; `fillOrder` pays the seller `maxPrice − fee`, delivers the item to the buyer, closes the order; `no_match` for a wrong item; `no_space` leaves the order open.
- rule 24: with `flags['market.enabled'] = false` (the suite's `make` takes `flags`), every market mutation is `market_closed` and `browse` still answers; an unlinked account gets `not_linked` on `list`, `buy`, `placeOrder`, `fillOrder`.

**Acceptance check:** `pnpm --filter @promptfall/ledger test` and `pnpm --filter @promptfall/fake-server test` green with rules 0 to 24 on both hosts; `market.test.ts` green. Red before: rules 14 to 24 fail on the stub.

**Boundaries:** No bots. No plugin changes. No new server event kinds beyond the nine.

- [ ] `goods.ts` and the fee helpers with `market.test.ts` (red, then green)
- [ ] Rules 14 to 24 in the suite (red); `market.ts` until green over the in-process ledger
- [ ] Routes in the fake; the suite green over HTTP; commit `feat(ledger): market rules, orders, cooldowns, expiry and returns`

### Task 8: Bots

**Files:**
- `servers/fake/src/bots.ts` — create: `startBots(options): { stop() }`
- `servers/fake/src/bot-config.ts` — create: names, counts and multipliers (tuning)
- `servers/fake/src/bot-seed.ts` — create: `rollBotState(seed, i): GameState` by `replay(createInitialState(seed ^ i), script)` where the script is `tool_call, tick × 3` repeated `400 + (i × 37) % 200` times then `rest`, so every bot has zone progress, drops and gold without touching the ledger's caps
- `servers/fake/src/cli.ts` — modify: `--bots` flag, start the bots after listen
- `servers/fake/src/bots.test.ts` — create: with a seeded ledger over `MemoryKeyValue` and a manual clock, 12 bots after 50 ticks have produced listings in `browse`, at least one order in some bot's `myOrders`, and at least one sale between bots; the run is deterministic: two runs with the same seed produce the same listing ids and prices

**Interfaces:**
- Consumes: `Ledger.host.mint`, `Ledger.host.grant`, the public market methods, `vendorValue` from `@promptfall/sim` (export it from the sim's `loot.ts` through `index.ts` in this task; the plugin's `view.ts` copy stays).
- Produces: bots in the running fake.

**Work:** On start, for each `i < count`: read `pf:bot:<i>`; if absent, `host.mint({ state: rollBotState(seed, i), name: NAMES[i], linked: true })` and write it. Each bot owns a seeded PRNG (the sim's `rng.ts` functions over a bot-local counter, or a tiny xorshift in `bots.ts`; the sim's determinism rule does not bind the fake, but the run must be deterministic given `seed`). Every `cadenceMs / speed` real ms, one bot (round robin) acts: draw one of `list` (weight 4), `buy` (3), `order` (2), `cancel` (1). `list`: pick a tradeable, unequipped, out-of-cooldown rare+ item or out-of-party hero from its committed state (via `bootstrap` with its token), price `vendorValue × (3 + roll(6))` for items, `heroPrice[rarity]` from the config for heroes. `buy`: cheapest listing not its own under `vendorValue × 4` that it can afford. `order`: a random base from `content.itemBases` with `minRarity: 'rare'`, `maxPrice = vendorValue(base at rare) × 3`. `cancel`: its oldest listing. Before acting, if gold is under `STIPEND_FLOOR` (2000) the host grants `STIPEND` (1000) with reason `bot_stipend`. Every refusal is logged at debug level and ignored.

**Acceptance check:** `pnpm --filter @promptfall/fake-server test` green with `bots.test.ts`. Then `pnpm fake -- --port 7777 --speed 10 --data /tmp/pf-bots.json` and after 30 seconds `curl -s 'localhost:7777/v1/listings?kind=item&sort=newest&page=0' -H 'authorization: Bearer <a token from the snapshot>' | head -c 400` shows listings with bot names. Paste it in the commit body.

**Boundaries:** Bots use only `host.mint`, `host.grant` and public market methods. No direct `kv` writes except `pf:bot:<i>`. No plugin changes.

- [ ] `bot-seed.ts` and `bot-config.ts`; export `vendorValue` from the sim
- [ ] `bots.ts` with `bots.test.ts` (red, then green)
- [ ] CLI flag; run the acceptance check; commit `feat(fake-server): seeded bots that list, buy, order and cancel`

### Task 9: Plugin: Market and Orders tabs, sell flow, order form, toasts, loot lines

**Files:**
- `plugins/promptfall/types/index.d.ts` — modify: `DialogTab` adds `'market' | 'orders'`; `ListingView`, `OrderView`; `MarketState = { query: ListingQuery; page: ListingPage | null; busy: boolean; confirm: string | null; error: string | null }`; `OrdersState = { mine: MyOrders | null; form: { base: string; minRarity: Rarity; affixId: string | null; maxPrice: string } | null; busy: boolean; error: string | null }`; `DialogState.sell: { kind: TradeKind; id: string; matching: Order[]; price: string; error: string | null } | null`; `PluginState.promptfall.market`, `.orders`
- `plugins/promptfall/hooks/ui/market.tsx` — create: the Market tab body
- `plugins/promptfall/hooks/ui/orders.tsx` — create: the Orders tab body and the order form
- `plugins/promptfall/hooks/ui/sell.tsx` — create: the sell flow panel used by Inventory and Heroes
- `plugins/promptfall/hooks/ui/dialog.tsx` — modify: tabs `m` Market and `r` Orders; `Sell` buttons on rare+ items and heroes; mounts the three bodies; the gate lines (`The market is closed.` when `view.account.marketOpen` is false; `Link your GitHub account in the Account tab` with a hotkey `a` jump when not linked) shown in place of the trade buttons
- `plugins/promptfall/hooks/command.ts` — modify: `market`, `orders` args
- `plugins/promptfall/hooks/engine.ts` — modify: `trade` is exposed through `GameHandle.trade`
- `plugins/promptfall/hooks/register.tsx` — modify: toasts for the `traded` effect (`Sold <name> for <net>g`, `Bought <name> for <price>g`, `<name> returned to you`), `GameHandle.market` helpers (`browse`, `myOrders`, `matching`) that call the client without a flush (reads need none)
- `plugins/promptfall/hooks/view.ts` — modify: `lootLine` for the `trade` entry; `vendorValue` stays
- `plugins/promptfall/hooks/dialog.test.ts` — extend: Market tab renders listings from a mocked client; Buy → confirm → `trade` called once and the view shows the new item; sell flow lists matching orders first and the price form second; order form submits a `NewOrder`; gates render for unlinked and closed market
- `plugins/promptfall/hooks/engine.test.ts` — extend: `trade` with a non-empty buffer flushes first (the batch arrives before the market call)
- `plugins/promptfall/README.md` — modify: tabs, hotkeys, sell flow

**Interfaces:**
- Consumes: Task 5's engine and handle, Task 7's market methods.
- Produces: the phase 2 dialog.

**Work:** Market tab: a filter row (`kind` toggle button, `minRarity` through `pick` as in phase 1, `sort` toggle), 10 listing rows of two lines each (name, rarity colour, affixes or traits; seller, price, `buy` button or `yours`), `prev`/`next` buttons, and a confirm row `Buy <name> for <price>g? confirm / cancel` on `confirm`. Every fetch sets `busy` and clears it; errors show in red for 5 seconds as `paneNotice` does. The dialog fetches `browse` on tab entry and after every trade. Orders tab: `My listings` (cancel button each, `expires in <d>d <h>h` from `expiresAt − now` with `$.clock.now()` read at render), `My buy orders` (cancel each), `Returns waiting: N` when non-zero, `New order` form: base via `pick` over `content.itemBases` keys (name labels), minimum rarity via `pick` (rare, epic, legendary), affix via `pick` over `content.affixes` plus `none`, `maxPrice` through `Input` (`onSubmit`) where the surface has one, else four preset buttons at `vendorValue × 2 / 3 / 5 / 8` of the base at the chosen rarity. Sell flow (`Sell` on an item or a hero): first `Matching orders` (each `accept <maxPrice>g, you get <net>g`), then `List for` with the price `Input` (or presets), showing `fee <fee>g` and `you get <net>g` live from `onInput`; `list` calls `trade(list)`; a hero with equipment shows `unequip first` and three `unequip` buttons. Refusals map to one line each: `not_enough_gold` → `Not enough gold`, `no_space` → `No free slot`, `in_cooldown` → `Tradeable in <h>h` (from the goods' `tradeableAt`), the rest as spec words. The toast texts above use the item's base name or the hero's name.

**Acceptance check:** `pnpm vendor && pnpm vendor:check` clean; `claude plugin validate plugins/promptfall`; `claude plugin test plugins/promptfall` green with the extended dialog and engine tests; `pnpm exec tsc -p plugins/promptfall` clean. Red before: `dialog.test.ts` cannot find the Market tab.

**Boundaries:** No band change. No new `$` namespace. No market rule evaluated on the client beyond displaying fees and nets (`fee = max(1, floor(p×200/10000))`, `net = p − floor(p×500/10000)`): the client computes them for display only and the ledger's answer wins.

- [ ] Types, tabs, command args; `dialog.test.ts` red for the Market tab
- [ ] `market.tsx` with browse, paging, buy with confirm
- [ ] `sell.tsx` with matching orders and the price form; `Sell` buttons
- [ ] `orders.tsx` with listings, orders, returns, the order form
- [ ] Toasts and loot lines; README; run the acceptance check; commit `feat(plugin): market and orders tabs, sell flow, trade toasts`

### Task 10: PR 2: manual pass part B, docs, pull request

**Files:**
- `docs/manual-pass/phase-2.md` — modify: part B
- `README.md` — modify: status says phase 2 is built; play section mentions `pnpm fake`
- `docs/spec/promptfall.md` — modify only if execution found a contract deviation that Kevin approved in chat; otherwise untouched

**Work:** Part B steps:

1. `pnpm fake -- --port 7777 --speed 10 --player-name <you>`; plugin session on it, linked (part A steps 1, 2, 5).
2. `/promptfall market`: within 30 seconds listings from bots (`Aldric the ...` heroes and items with bot seller names). `m`/`r`/`i` switch tabs; `next` pages.
3. Buy the cheapest item you can afford: confirm row, then the item in the Inventory tab with a toast `Bought <name> for <price>g`, gold down by the price, and a loot-log line `bought <name>`.
4. `Sell` on that item: `Tradeable in 2h` (24 h at speed 10) and no price form. `Sell` on a rare drop you own: the price form, `fee` and `you get` update as you type; `list`; the item leaves the inventory; the Orders tab lists it with `expires in 16h`.
5. Wait up to 2 minutes: a bot buys it if priced near vendor value × 3; toast `Sold <name> for <net>g`, gold up.
6. Orders tab, `New order`: base, rarity rare, no affix, a max price; the order appears; gold down by the escrow. `cancel`: gold back.
7. A bot's order: `Sell` on a rare item of a base bots order shows `Matching orders` first; `accept`: gold up by `maxPrice − fee`, item gone.
8. Heroes tab: `Sell` on a hero in the party says `in party`; on a spare hero with gear says `unequip first`; bare and out of party: listable; cancel it on the Orders tab; it returns at its level.
9. Fill the inventory (30), cancel a listing: `Returns waiting: 1`; vendor one item; within 15 seconds the item is back and the count is 0.
10. `/promptfall server local`: the Market tab says `Link your GitHub account` until you link in Account (instant); listings are empty (no bots in-process) and `New order` works.
11. Stop the fake, start it with `--speed 1`: nothing lost.

PR from `feat/phase-2-market` into `ai-staging` titled `Promptfall phase 2, PR 2: market, orders, hero trading, bots`, same body shape as PR 1. Stop and hand Kevin part B.

**Acceptance check:** the full check line green and pasted; `gh pr view --json url`.

**Boundaries:** Docs only. Do not merge.

- [ ] Write part B; update the README; run the check line; open the PR; stop

## Out of scope

Presence, chat, leaderboards, world bosses (phase 3); sprites and sound (phase 4); real GitHub device flow, Postgres, Redis, admin CLI, Docker, the long-poll stream, `revokedItemIds` population, the server-side lease (phase 5); rate limits on market routes; hero buy orders; migrations between sim versions.
