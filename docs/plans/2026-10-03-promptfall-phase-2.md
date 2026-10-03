# Promptfall phase 2 implementation plan

**Goal:** Players trade items and heroes on a market, against an HTTP fake with bots, with the sim still the single ledger of what every account owns.
**Architecture:** The sim's event union splits into player events (batchable) and server events (ledger-authored, the effects of trades), sequenced per account by a cursor. A new pure package `@promptfall/ledger` holds account records, batch replay and the market rules; three hosts run it: the in-process fake (default, inside the plugin), the HTTP fake at `servers/fake` (a `node:http` process with a JSON snapshot and seeded bots), and later the real server. `@promptfall/protocol` gains the market types, the widened `ServerClient` and an `HttpClient` over an injected fetch. The plugin's engine learns committed state, pending server events, re-stepping, one lock around every server call and outages; the dialog gains Market and Orders tabs, a sell flow and the GitHub link flow.
**Spec:** `docs/spec/promptfall.md` (§5, §7, §9, §10 as amended on 2026-10-03), `docs/adr/0001-trades-as-server-events.md`, `CONTEXT.md`
**Execution model:** opus
**Review wave:** done on 2026-10-03 (reviewer on opus, reviewer on fable, codex-review on gpt-6-astra at xhigh); this is the fixed plan, consolidated in `docs/reviews/2026-10-03-phase-2-plan-fix-pass.md`. No second wave.
**Delivery:** two PRs into `ai-staging`. PR 1 is Tasks 1 to 6 on `feat/phase-2` (transport and ledger, market stubbed). PR 2 is Tasks 7 to 10 on `feat/phase-2-market`, branched from PR 1's head. Each PR gets its own three-leg review and manual pass. Between Task 2 and Task 5a the plugin does not type-check and `vendor:check` is stale; that is expected inside PR 1 and the PR's final commit must be clean.

## Global constraints

- Everything in the phase 1 plan's global constraints still holds: integer-only sim, no `Date`/`Math.random`/floats in `packages/sim/src`, event-driven sim, rarity order, classes, slots, 15-second flush, lease, band manners, committed vendor bundles, Biome, English, attribution lines on commits.
- Spec §2: the server is the ledger. The sim never decides a trade; every change of ownership is a server event the ledger authored.
- Spec §7 amended: player events only in a batch; server events `listed`, `returned`, `sold`, `bought`, `order_placed`, `order_refunded`, `order_filled`, `order_sold`, `credited`; a batch declares `cursor`, which must equal the account's latest server event id; `baseHash` is the hash at the last commit; a batch behind the latest cursor is answered with the pending delivery and resubmitted, one ahead of it gets the authoritative state; every authenticated response may carry a delivery, numbered so a client applies each event once; market actions flush first and need the primary session.
- Spec §5 amended: Rare and above trade; fee `max(1, floor(price × 200 / 10000))` on listing, kept on cancel and expiry; price integer 1 to 1,000,000; sale fee `floor(price × 500 / 10000)` on listings and order fills; listings and orders expire after 7 days (`604_800_000` ms); cooldown 24 hours (`86_400_000` ms); returns never vendored; no self-trade; heroes listed bare and arriving at level 1, 0 XP, full HP on transfer only (a returned hero is unchanged); market entries in the loot log; browse open, trade gated by `linked` and `market.enabled`; cancelling a listing or an order is allowed with the market closed.
- Spec §7 outage: banner at once; sim ticks and buffers for `120_000` ms from the first failure, then pauses; retries back off `1_000 × 2^n` capped at `30_000` ms plus jitter of up to 50%; the first success flushes and clears. A thrown submit or bootstrap is an outage. The batch in flight when the outage began is retried verbatim (same `batchId`, payload and hashes) until it is answered.
- `SIM_VERSION` becomes `2`. No migration. A state behind the server's sim version is reset from the Account tab, which renders without a game view.
- The plugin calls `$.ui`, `$.state`, `$.store`, `$.clock`, `$.command` and now `$.http.fetch`, nothing else. `claude plugin validate` must list `http.fetch` and no `fs`, `process`, `model`, `prompt`, `audio` or `session` call.
- `$.http.fetch(url, init?)` resolves `{ status, ok, headers, text }` once the body is read; `init` is `{ method?, headers?, body?: string }`. Tests mock it with `on('http.fetch', (_$, e) => ({ status, ok, headers, text }))`. Nothing in the engine's declarations says what a network failure throws, so the client treats any thrown value as an outage. `$.store.keys()` exists and the test kit mocks `store.keys`.
- The HTTP fake and the ledger are not in the plugin's test kit: they get vitest tests under their own packages. The plugin's HTTP path is covered by the contract suite over `HttpClient` plus plugin tests with a mocked `http.fetch`.
- `scripts/tsconfig.vendor.json` has `lib: ["ES2022"]` and `types: []`: nothing bundled into the plugin may use `URLSearchParams`, `URL`, `fetch` or any other platform global. `encodeURIComponent` is an ES global and allowed.
- Wall-clock values in sim state (`tradeableAt`) are data the server wrote; the sim never reads them in a rule. A grep for `tradeableAt` under `packages/sim/src` (tests excluded) must hit only `types.ts`, the two constructors that set `null` (`heroes.ts`, `loot.ts`) and `server-events.ts`.
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
  | { t: 'credited'; gold: number; reason: string }

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

- `listed`: remove item `id` from `inventory` (it must exist and be unequipped) or hero `id` from `roster` (it must exist, be out of `party` and `pendingParty`, and wear nothing); `gold -= fee` (gold must suffice). No loot entry.
- `returned`: put the goods back exactly as carried (`inventory.length < inventoryCap`, `roster.length < rosterCap`); loot entry `returned` with `gold: 0`; effect `traded`. A returned hero keeps its level, XP and HP: the reset is for transfers only.
- `sold`: `gold += net`; loot entry `sold` with `gold: net`; effect `traded`.
- `bought`: `gold -= price` (gold must suffice); put the goods in (cap must allow); loot entry `bought` with `gold: price`; effect `traded`.
- `order_placed`: `gold -= escrow` (must suffice). `order_refunded`: `gold += escrow`.
- `order_filled`: put the item in (cap must allow); loot entry `bought` with `gold: price`; effect `traded`.
- `order_sold`: remove item `itemId` (must exist, unequipped); `gold += net`; loot entry `sold`; effect `traded`.
- `credited`: `gold += gold`; effect `gold`.
- A precondition that fails returns `reject(state, event, 'server_event_unapplicable:<detail>')`. The ledger asserts that applying an event it authored produces no `rejected` effect and throws without writing otherwise; a client that sees one shows it as a pane notice, and the hash check catches the divergence.
- Goods arrive as given: the sim never re-ids or re-rolls them. A hero in `bought` is stored exactly as carried (the ledger set level 1, xp 0, hp to the level-1 max, `equipment` all null before authoring).

### `@promptfall/protocol` additions (`packages/protocol/src/`)

```ts
// schemas.ts
export type TimedEvent = PlayerEvent & { at: number }        // server events never pass the schema
export type Batch = { /* as today, plus: */ cursor: number }  // the last server event id the client applied; 0 for a fresh account
export const ServerEventSchema: z.ZodType<ServerEvent>
export const ItemSchema: z.ZodType<Item>; export const HeroSchema: z.ZodType<Hero>
/** Structural check of a sim state: `v`, `seed`, `gold`, `inventory`, `roster` present with the right primitive types; the rest passes through. */
export const GameStateSchema: z.ZodType<GameState>

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
export type Unauthorized = { reason: 'unauthorized' }

// client.ts
export type Delivery = { cursor: number; events: { n: number; event: ServerEvent }[] }  // the account's log; clients skip n <= their cursor
export type ServerConfig = {
  minClientVersion: string; simVersion: number; flags: Record<string, boolean>   // flags resolved: `market.enabled` defaults true
  serverNow: number   // the server's clock (virtual on the HTTP fake) when this response was built
  speed: number       // virtual ms per real ms; 1 everywhere but the HTTP fake
}
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
export type AccountInfo = { account: Account; returns: number; config: ServerConfig; delivery: Delivery }
export type Bootstrap = {
  deviceToken: string; account: Account; config: ServerConfig
  state: GameState      // the committed state
  seq: number; hash: string; cursor: number   // hash and cursor of the committed state
  delivery: Delivery    // what was authored since; the client applies it on top
}
export type LinkStart = { code: string; url: string; intervalMs: number }
export type LinkPoll = { status: 'pending' } | { status: 'linked'; account: Account }

export interface ServerClient {
  bootstrap(input: { clientVersion: string; deviceToken: string | null }): Promise<Bootstrap>
  submit(batch: Batch, auth: Auth): Promise<BatchAck>
  account(auth: Auth): Promise<AccountInfo | Unauthorized>
  linkStart(auth: Auth): Promise<LinkStart | Unauthorized>
  linkPoll(auth: Auth, code: string): Promise<LinkPoll | Unauthorized>
  // PR 2 fills these; PR 1's ledger answers `market_closed`, empty pages and empty lists:
  browse(auth: Auth, query: ListingQuery): Promise<ListingPage | Unauthorized>
  list(auth: Auth, input: { kind: TradeKind; id: string; price: number }): Promise<MarketResult>
  cancelListing(auth: Auth, listingId: string): Promise<MarketResult>
  buy(auth: Auth, listingId: string): Promise<MarketResult>
  myOrders(auth: Auth): Promise<MyOrders | Unauthorized>
  placeOrder(auth: Auth, input: NewOrder): Promise<MarketResult>
  cancelOrder(auth: Auth, orderId: string): Promise<MarketResult>
  matchingOrders(auth: Auth, itemId: string): Promise<Order[] | Unauthorized>
  fillOrder(auth: Auth, orderId: string, itemId: string): Promise<MarketResult>
}

// http.ts
export type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body?: string })
  => Promise<{ status: number; ok: boolean; text: string }>
export class HttpClient implements ServerClient { constructor(options: { baseUrl: string; fetch: FetchLike }) }
```

`seq_mismatch`, `cursor_mismatch`, `hash_mismatch` and `rate_capped` share one shape so the engine has one adopt path; `cursor_behind` is the one refusal that adopts nothing. `revokedItemIds` is present only on `hash_mismatch` (always `[]` in phase 2), `kind` only on `rate_capped`. A `MarketResult` refusal carries no delivery. Reads (`browse`, `myOrders`, `matchingOrders`) carry no delivery either: the engine refreshes through `account()`.

### HTTP protocol (`servers/fake`, and phase 5)

Base path `/v1`. Auth: header `authorization: Bearer <deviceToken>` on everything but `bootstrap` and `health`. Bodies are JSON. The server answers `200` with the ledger's result for every ledger-level outcome, refusals included (`{ ok: false, reason }` or `{ reason: 'unauthorized' }`), `400 { error: 'schema', issues }` when a body or query fails Zod, `404 { error: 'route' }`, `500 { error: 'internal' }`. `HttpClient` throws on anything but 200 and on a thrown fetch, with `error.name = 'ServerUnreachable'` for the thrown fetch and `error.name = 'ServerError'` for a non-200 or a body that fails its response schema.

| Method and path | Body | Result |
| --- | --- | --- |
| `GET /v1/health` | | `{ ok: true, simVersion, seed, speed, now }` |
| `POST /v1/bootstrap` | `{ clientVersion, deviceToken }` | `Bootstrap` |
| `POST /v1/batches` | `Batch` | `BatchAck` |
| `GET /v1/account` | | `AccountInfo \| Unauthorized` |
| `POST /v1/link/github` | | `LinkStart \| Unauthorized` |
| `POST /v1/link/github/poll` | `{ code }` | `LinkPoll \| Unauthorized` |
| `GET /v1/listings?kind&base&cls&minRarity&sort&page` | | `ListingPage \| Unauthorized` |
| `POST /v1/listings` | `{ kind, id, price }` | `MarketResult` |
| `DELETE /v1/listings/:id` | | `MarketResult` |
| `POST /v1/listings/:id/buy` | | `MarketResult` |
| `GET /v1/orders` | | `MyOrders \| Unauthorized` |
| `POST /v1/orders` | `NewOrder` | `MarketResult` |
| `DELETE /v1/orders/:id` | | `MarketResult` |
| `GET /v1/orders/matching?itemId` | | `Order[] \| Unauthorized` |
| `POST /v1/orders/:id/fill` | `{ itemId }` | `MarketResult` |

Query strings are built by hand: `key=encodeURIComponent(value)` joined with `&`, undefined values omitted.

### `@promptfall/ledger` (`packages/ledger/src/index.ts`)

```ts
export interface KeyValue {   // widened in @promptfall/protocol/kv.ts
  get(key: string): Promise<unknown>
  set(key: string, value: unknown): Promise<void>
  delete(key: string): Promise<void>
  /** Optional: persist everything written since the last flush, atomically where the host can. The ledger calls it after every mutating operation. */
  flush?(): Promise<void>
}
export type LedgerOptions = {
  kv: KeyValue
  now: () => Promise<number>
  speed?: number                     // reported in ServerConfig; default 1
  minClientVersion: string
  seedSource: () => number
  tokenSource: () => string          // device tokens, account ids and link codes
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
    /** Authors a `credited` server event (bot stipends; phase 5 admin). */
    credit(accountId: string, gold: number, reason: string): Promise<void>
    /** Folds the log into the committed state for an account that never batches (bots). */
    settle(accountId: string): Promise<void>
    /** Expires listings and orders past `expiresAt` and delivers returns where a slot is free. Hosts call it on a timer or before a request. */
    sweep(): Promise<void>
  }
}
```

Storage keys, all under the `KeyValue` the host provides (the plugin's `StoreKeyValue` prefixes `promptfall:` as today):

- `pf:acct:<id>:record` → `AccountRecord` = phase 1's record (`account`, `state`, `seq`, `refillAt`, `buckets`, `committed` ring of batch ids) plus `cursor: number` (last server event id issued), `committedCursor: number`, `committedState: GameState` (the state at `committedCursor`), `committedHash: string`, `log: { n: number; event: ServerEvent }[]` (every event with `n > committedCursor`, at most 500), `returns: { listingId: string; goods: Goods }[]`. `state` is the **effective** state: every server event is applied to it the moment it is authored. Phase 1's `committed` ring is renamed `batches` to free the word.
- `pf:token:<token>` → accountId (as today).
- `pf:link:<code>` → `{ accountId, createdAt }`.
- `pf:listing:<id>` → `Listing`; `pf:listings` → `string[]` of open listing ids (newest last).
- `pf:order:<id>` → `Order`; `pf:orders` → `string[]` of open order ids.
- `pf:returns` → `string[]` of account ids with a non-empty `returns`.
- `pf:counter` → `number`, the global counter behind ledger ids: listings `L<n>`, orders `O<n>`, transferred goods `t<n>`, all base 36.
- `pf:bot:<i>` → `{ accountId, deviceToken }` (written by the HTTP fake's bots, read by nobody else).

Rules the ledger enforces, by operation (every check reads the effective `state`; a refusal changes nothing):

- `bootstrap` **writes nothing for a known token**: it answers `state: committedState`, `hash: committedHash`, `cursor: committedCursor`, `seq`, `delivery: { cursor: record.cursor, events: log }`. A null or unknown token mints as today (that write is the only one). A record whose `state.v !== SIM_VERSION` is answered as it is, with `cursor: 0` and an empty delivery, and the phase 2 fields are not read.
- `submit`: phase 1's steps 0 to 8, with two changes. Step 6a, after seq: `batch.cursor > record.cursor` → `cursor_mismatch` with the authoritative state; `batch.cursor < record.cursor` → `cursor_behind` with `delivery` (nothing changes); a `batch.cursor` older than the log's oldest entry can only be `< committedCursor` and gets `cursor_mismatch`. Step 7 compares `batch.baseHash` to `record.committedHash`. Step 9 replays `batch.events` alone on `record.state` (the server events up to `batch.cursor` are already in it), then sets `committedState = state`, `committedCursor = cursor`, `committedHash = hash`, empties `log`, runs `deliverReturns` for the account, and answers `delivery` = what the log now holds. A duplicate batch answers the batch's hash and the current delivery. A post-commit `hash_mismatch` answers the state and cursor after `deliverReturns`.
- Every other call that authors server events appends them to the account's `log` with fresh `n`s and applies them to `record.state` with `replay` at once, asserting no `rejected` effect (else throw, write nothing). Every validation therefore reads a state no later player event can undo (ADR 0001). The response carries `delivery` = the caller's log.
- Authoring an event for the *other* party (the seller when a buyer buys) appends to that account's log and state the same way; that party sees it in its next response, and a batch it already had in flight comes back `cursor_behind`.
- State-carrying refusals (`seq_mismatch`, `cursor_mismatch`, `hash_mismatch`, `rate_capped`) hand the client the effective state and are the only other moves of the committed point: `committedState = state`, `committedCursor = cursor`, `committedHash = hash(state)`, `log` emptied.
- `host.settle(accountId)` does the same without a client.
- `deliverReturns(record)`: for each entry in `returns`, oldest first, if the goods' kind has a free slot, remove it and author `returned { listingId, goods }`; an entry without a slot is skipped, not blocking the next kind. Removes the account from `pf:returns` when empty. Runs after every batch commit, after every market mutation on that account, and in `sweep`.
- `expireDue(now)`: closes every open listing with `expiresAt <= now` (goods back to the owner as `cancelListing` does, no refund) and every open order with `expiresAt <= now` (`order_refunded`). Runs at the start of `buy`, `fillOrder`, `cancelListing`, `cancelOrder`, `browse`, `myOrders`, `matchingOrders` and `sweep`, under the mutex, so nothing expired can trade.
- `list`: refuse `market_closed` unless `flags['market.enabled']`, `not_linked` unless `account.linked`; `unknown_goods` when the id is not in the effective inventory/roster; `not_tradeable_rarity` for common/uncommon; `in_cooldown` when `tradeableAt !== null && tradeableAt > now`; `equipped` for a worn item or a hero with any equipment; `in_party` for a hero in `party` or `pendingParty`; `bad_price` outside 1..1,000,000 or non-integer; `not_enough_gold` when gold < fee. Then: listing id `L<n>`, `expiresAt = now + 7 d`, event `listed { fee }` to the seller.
- `cancelListing`: `gone` when not open, `not_owner` when not the seller's; allowed with the market closed. Returns the goods unchanged: a free slot → event `returned`; none → push `{ listingId, goods }` to `returns`, add the account to `pf:returns`. No refund.
- `buy`: `gone`, `self_trade`, `market_closed`, `not_linked`, `not_enough_gold` (gold < price), `no_space`. Then `transfer`: the goods get a fresh id `t<n>` **if their id does not already start with `t`**, `tradeableAt = now + 24 h`, a hero is reset to level 1, xp 0, hp = `heroStats(buyerState, hero).hp` at level 1, equipment null; buyer gets `bought`, seller gets `sold { net = price − floor(price × 500 / 10000) }`; the listing closes.
- `placeOrder`: `market_closed`, `not_linked`, `bad_price`, `not_tradeable_rarity` when `minRarity` is common or uncommon, unknown base or affix → `unknown_goods`, `not_enough_gold` (gold < maxPrice). Escrow = maxPrice. Event `order_placed` to the buyer; id `O<n>`; `expiresAt = now + 7 d`.
- `cancelOrder`: `gone`, `not_owner`; allowed with the market closed; event `order_refunded`.
- `matchingOrders(itemId)`: open orders where `base` matches, `rarity >= minRarity` in `RARITIES` order, `affixId` null or present on the item, buyer is not the caller; sorted by `maxPrice` descending.
- `fillOrder(orderId, itemId)`: `gone`, the seller-side checks of `list` (`unknown_goods`, `not_tradeable_rarity`, `in_cooldown`, `equipped`, `not_linked`, `market_closed`), `self_trade`, `no_match` when the item does not match, `no_space` when the buyer has no slot (the escrow stays, the order stays open). Price = `maxPrice`; the item goes through `transfer`; seller gets `order_sold { net }`, buyer gets `order_filled`; the order closes.
- `sweep`: `expireDue(now)`, then `deliverReturns` for every account in `pf:returns`.
- `linkStart`: code = 8 uppercase letters and digits from `tokenSource()`, `url = 'https://github.com/login/device'`, `intervalMs = 5000`; `linkPoll`: a code not issued to the caller → `pending`; `linkApprover(code)` null → `pending`; else set `account.linked = { provider: 'github', login }`, `displayName = login`, delete the code, answer `linked`.
- `config()` answers resolved flags (`market.enabled` true unless set false), `serverNow = await now()`, `speed`.
- All ledger operations, `host` included, run through one in-process mutex (a promise chain); a mutating operation ends with `await kv.flush?.()`. Phase 5 replaces the mutex and the flush with Postgres transactions. On the in-process host two sessions share one store with no compare-and-set; only the primary writes (bootstrap is read-only), which is what keeps that safe.

### `servers/fake` CLI

`pnpm fake [--port 7777] [--seed 1] [--speed 1] [--player-name player] [--data .promptfall/fake.json] [--bots 12]`. The root script is `pnpm --filter @promptfall/fake-server start` with no trailing `--`; `cli.ts` drops a leading `--` from `process.argv` before `parseArgs`, so both `pnpm fake --port 7777` and `pnpm fake -- --port 7777` work. `--speed` scales a virtual clock: the snapshot stores `clock: { virtualAt, realAt }` on every flush and the process resumes from `virtualAt + (Date.now() − realAt) × speed`, so virtual time never goes backwards and a changed `--speed` rebases. Bots tick every `20_000 / speed` real ms. The snapshot file holds the whole `KeyValue` and is written on `flush()` (write to `<path>.tmp`, then rename), so one ledger operation is one durable write. `.promptfall/` is git-ignored.

### Plugin engine contract (`plugins/promptfall/hooks/engine.ts`)

```ts
// Fields the engine holds:
//   committed: GameState       the last state the server acknowledged (bootstrap or ok ack)
//   cursor: number             last server event id applied locally (declared in the next batch)
//   pending: ServerEvent[]     server events applied locally since `committed`, in order
//   sent: { batch: Batch; result: GameState } | null   the batch in flight or awaiting retry, immutable until answered
//   buffer: TimedEvent[]       player events applied locally after `sent` (or after `pending` when nothing is sent)
//   local: GameState           always equals replay(committed, [...pending, ...sent.batch.events, ...buffer])
//   outage: { since: number; attempt: number } | null
//   clock: { serverNow: number; clientNow: number; speed: number }   from the last config seen
// Batch built: { seq, cursor, baseHash: hash(committed), resultHash: hash(local at build time), events: buffer, batchId: fresh }
```

- **One lock.** `flush`, `trade`, `sync`, `link*`, `resync` and `start` run through one promise chain. `receive` is called only inside it. The 15 s timer calls `flushIfIdle`, which returns at once when the lock is held or `outage` is set.
- `apply(event: PlayerEvent)`: refused when paused, or when `outage` is set and `now − outage.since >= 120_000`. Steps `local`, pushes to `buffer`, publishes.
- `flush()`: if `sent` is null and `buffer` is empty, return. If `sent` is null, build the batch from `buffer`, `sent = { batch, result: local }`, `buffer = []`. Submit `sent.batch` verbatim. On `ok`: if `ack.duplicate && ack.hash !== hash(sent.result)` → `resync()`; else `committed = sent.result`, `pending = []`, `seq = ack.seq`, `sent = null`, `receive(ack.delivery)`. On `cursor_behind`: `receive(ack.delivery)` with `sent` kept, then submit again (the loop ends because the server only authors events on real trades; after 5 consecutive `cursor_behind` without the cursor moving, `resync()`). On a state-carrying refusal: `committed = local = ack.state`, `cursor = ack.cursor`, `pending = []`, `sent = null`, `buffer = []`, `seq = ack.seq`. On `version_gate`/`sim_version`/`unauthorized`: pause as today. Thrown: outage (below), `sent` kept.
- `receive(delivery)`: drop entries with `n <= cursor`; set `cursor = max(cursor, delivery.cursor)`; if nothing remains, return. Push the remaining events to `pending` and **re-step**: `local = replay(committed, pending)`, then `sent.batch.events` (if any) and `buffer` one by one through `step`, collecting effects; the `rejected` effects of re-stepped player events go to `onEffects` (a pane notice), the server events' `traded`/`gold` effects go to `onEffects` too (toasts). Publish once at the end.
- `start()`: bootstrap; `committed = boot.state`, `cursor = boot.cursor`, `seq = boot.seq`, `pending = []`, `sent = null`, `buffer = []`, `local = committed`, remember `clock`; if `boot.state.v !== SIM_VERSION` pause with `'Promptfall: this machine's data is from an older version, reset it in /promptfall account'` and publish no view; else `receive(boot.delivery)`. A thrown bootstrap enters the outage state and retries `start()` on the backoff.
- `resync()`: a read-only bootstrap with the stored token, then the `start()` steps; the buffer is dropped (the server wins). Used on a duplicate with a foreign hash and on a stuck `cursor_behind`.
- `trade(fn)`: inside the lock: `flush()` (throws `Error('unreachable')` when it ends in an outage), then `r = await fn(client, auth)`; if `r.ok`, `receive(r.delivery)`; return `r`. Throws `Error('not_primary')` when the session does not hold the lease or the engine is paused.
- `sync()`: inside the lock: `flush()`, then `account()`, remember `returns` and `clock`, `receive(info.delivery)`. The dialog calls it on open and after every trade.
- Outage: a thrown `submit` or `bootstrap` sets `outage = { since: now, attempt: 0 }` when null, publishes `notice: 'Promptfall: server unreachable, retrying'`, and schedules the next attempt through `deps.after` (now required; tests provide it) at `min(30_000, 1_000 × 2^attempt) × (1 + jitter)`, `jitter` in `[0, 0.5)` from `Math.random()` (the engine is not the sim). The attempt re-runs `flush()` (or `start()`), bypassing the 120 s apply guard. Past 120 s the band's notice becomes `'Promptfall: server unreachable'` and `apply` refuses; the state is not `paused` (the pause is for versions and auth). The first success clears `outage` and the notice. `trade` and `sync` during an outage throw `Error('unreachable')`.
- `switchServer(url | null)`: inside the lock: `flush()` once; if it ends in an outage, the unsent events (`sent` plus `buffer`) are dropped and the count is reported to the caller; rebuild the client, the token key and the engine state; `start()`.
- Display of server deadlines: `remainingRealMs(deadline) = (deadline − (clock.serverNow + (clientNow − clock.clientNow) × clock.speed)) / clock.speed`; the dialog shows real time left (`2h` for a 24 h cooldown at speed 10).

## Task list

PR 1: Tasks 1 to 6. PR 2: Tasks 7 to 10.

### Task 1: Sim: player and server events, trade data, SIM_VERSION 2

**Files:**
- `packages/sim/src/types.ts` — modify: the shapes under "Shared contracts"
- `packages/sim/src/draft.ts` — create: `draft`, `reject` and `clone` moved here so `step.ts`, `commands.ts` and `server-events.ts` import them without a cycle (`commands.ts` duplicated them for that reason; the duplicates go)
- `packages/sim/src/server-events.ts` — create: one handler per server event kind
- `packages/sim/src/step.ts`, `packages/sim/src/commands.ts`, `packages/sim/src/progression.ts` — modify: import from `draft.ts`; `step.ts` registers the server-event handlers; `Handlers` spans `Event['t']`
- `packages/sim/src/heroes.ts`, `packages/sim/src/loot.ts` — modify: the two constructors set `tradeableAt: null`; `pushLog` (heroes.ts) accepts the `trade` entry; `vendorValue` stays where it is and is exported from `index.ts`
- `packages/sim/src/index.ts` — modify: export the new types, `SERVER_EVENT_KINDS`, `vendorValue`
- `packages/sim/src/golden.ts`, `packages/sim/src/golden.test.ts` — modify: new `GOLDEN_HASH` for v2 state
- `packages/sim/src/server-events.test.ts` — create
- `packages/sim/src/determinism.test.ts` — modify: the property test's event generator also draws server events (a `credited`, a `bought` of a generated item, a `listed` of an owned item) so replay determinism covers them
- Any other sim test that asserts a full `Item`/`Hero` literal — modify to add `tradeableAt: null`

**Interfaces:**
- Consumes: today's `step`, `heroStats`, `findHero`, `pushLog`.
- Produces: `PlayerEvent`, `ServerEvent`, `Goods`, `TradeKind`, `SERVER_EVENT_KINDS`, the `trade` loot entry, the `traded` effect, `SIM_VERSION = 2`, `Item.tradeableAt`, `Hero.tradeableAt`, `vendorValue` from the package root.

**Work:** Implement the server-event handlers with the semantics listed under "Shared contracts", using `draft` for the happy path and `reject` for a failed precondition (reason `server_event_unapplicable:<detail>`, detail one of `unknown_item`, `unknown_hero`, `equipped`, `in_party`, `inventory_full`, `roster_full`, `not_enough_gold`). The `bought`/`returned`/`order_filled` handlers insert the carried goods as they are: no `nextId`, no re-roll, no HP recompute. The `v` field is the only thing `createInitialState` changes for the version bump. Internal structure of `server-events.ts` is yours; keep the sim's existing idioms (`Of<'kind'>`, `draft`).

**Acceptance check:** `pnpm --filter @promptfall/sim test`. Red before: `server-events.test.ts` fails to import; `golden.test.ts` fails on the hash. Green after: every server event kind has a happy-path test that asserts the state delta and the loot entry, every precondition has a reject test, a `returned` hero keeps level, XP and HP, `determinism.test.ts` passes with server events in its generator, and `grep -rn "tradeableAt" packages/sim/src --include='*.ts' | grep -v test` lists only `types.ts`, `heroes.ts`, `loot.ts` and `server-events.ts`.

**Boundaries:** No change to combat, progression rules, loot tables or content. No wall-clock comparison anywhere in the sim. Do not touch `packages/protocol`.

- [x] `draft.ts`; add the types; set `tradeableAt: null` in both constructors; bump `SIM_VERSION`; fix the type errors `pnpm typecheck` reports in `packages/sim`
- [x] Write `server-events.test.ts` (red), then `server-events.ts` and the `step.ts` registration
- [x] Extend the determinism generator; regenerate `GOLDEN_HASH` and note the new value in the commit message
- [x] Run the acceptance check; commit `feat(sim): server events, trade data and SIM_VERSION 2`

### Task 2: Protocol: cursor, market types, widened client, HttpClient

**Files:**
- `packages/protocol/src/schemas.ts` — modify: `TimedEventSchema` over `PlayerEvent` only; `Batch.cursor`; `ItemSchema`, `HeroSchema`, `ServerEventSchema`, `GoodsSchema`, `GameStateSchema`
- `packages/protocol/src/market.ts` — create: the market types and their Zod schemas (`ListingSchema`, `OrderSchema`, `ListingQuerySchema`, `NewOrderSchema`, `MarketResultSchema`, `MyOrdersSchema`, `ListingPageSchema`, `UnauthorizedSchema`)
- `packages/protocol/src/client.ts` — modify: `Delivery`, `ServerConfig`, `BatchAck`, `AccountInfo`, `Bootstrap`, `LinkStart`, `LinkPoll`, `Unauthorized`, the full `ServerClient`
- `packages/protocol/src/kv.ts` — modify: optional `flush?()` on `KeyValue`
- `packages/protocol/src/http.ts` — create: `HttpClient`, `FetchLike`, the route table, the hand-rolled query encoder
- `packages/protocol/src/responses.ts` — create: Zod schemas for every response body (`BootstrapSchema`, `BatchAckSchema`, `AccountInfoSchema`, `LinkStartSchema`, `LinkPollSchema`, …), used by `HttpClient` to validate what it receives and by the fake's tests to validate what it sends
- `packages/protocol/src/contract/suite.ts` — modify, mechanically only: `Mirror.batch` takes `PlayerEvent[]` and sets `cursor: 0`; the file compiles. Task 3 rewrites the Mirror
- `packages/protocol/src/fake/local.ts`, `packages/protocol/src/local.contract.test.ts` — delete (Task 3 recovers the logic with `git show 54262d1:packages/protocol/src/fake/local.ts`)
- `packages/protocol/src/index.ts` — modify: exports; drop `LocalServer`
- `packages/protocol/src/schemas.test.ts` — modify: a batch carrying a server event fails the schema; `cursor` required
- `packages/protocol/src/http.test.ts` — create: `HttpClient` against a hand-rolled `FetchLike` that records requests and answers canned bodies; one test per method asserting method, path, query string, auth header and body; one test each for `ServerUnreachable` (fetch throws), `ServerError` (status 500) and `ServerError` (a 200 body failing its schema)

**Interfaces:**
- Consumes: Task 1's types.
- Produces: everything under "`@promptfall/protocol` additions" and the route table under "HTTP protocol".

**Work:** The schemas are the contract on both ends: `HttpClient` parses every response with the matching schema from `responses.ts`. `HttpClient` builds `url = baseUrl.replace(/\/$/, '') + path`, sends `content-type: application/json` on bodies and `authorization: Bearer <token>` where the table says so. It never retries: the engine owns retries. `MarketRefusal` and the other refusal objects pass through as values, never as throws. No platform globals (see the constraint on the vendor tsconfig).

**Acceptance check:** `pnpm --filter @promptfall/protocol test` green with `http.test.ts` and `schemas.test.ts`; `pnpm typecheck` reports no error in `packages/protocol`. Red before: `http.test.ts` cannot import `HttpClient`.

**Boundaries:** No ledger logic here. Do not touch the plugin. The Mirror's new behaviour is Task 3's.

- [x] Split the schemas; add `cursor`; write the market and response schemas; `KeyValue.flush?`
- [x] Widen `ServerClient`, `BatchAck`, `Bootstrap`, `ServerConfig`; delete `fake/local.ts` and its test; mechanical fix of `suite.ts`
- [x] Write `http.test.ts` (red), then `http.ts`
- [x] Run the acceptance check; commit `feat(protocol): cursor, market types, HttpClient`

### Task 3: Ledger package and the contract suite over it

**Files:**
- `packages/ledger/package.json`, `packages/ledger/tsconfig.json` — create: `@promptfall/ledger`, depends on `@promptfall/sim`, `@promptfall/protocol`, `vitest`; tsconfig references both
- `packages/ledger/src/index.ts` — create: exports `Ledger`, `LedgerOptions`
- `packages/ledger/src/ledger.ts` — create: the class, bootstrap/submit/account/link, the mutex, the record shape, `deliverReturns`, `expireDue` (listings and orders empty in PR 1), `host`
- `packages/ledger/src/market.ts` — create in PR 1 as the refusing stub (`market_closed` for every market mutation, `browse` empty page, `myOrders` empty, `matchingOrders` empty); PR 2 fills it
- `packages/ledger/src/ids.ts` — create: `nextLedgerId(kv, prefix)` over `pf:counter`
- `packages/ledger/src/ledger.contract.test.ts` — create: `runServerContract('Ledger over MemoryKeyValue', …)` passing `host`
- `packages/ledger/src/ledger.test.ts` — create: unit tests for `host.mint`, `host.credit`, `host.settle`, the log ring cap, `deliverReturns` per kind, a v1 record at bootstrap, and `flush` being called once per mutating operation
- `packages/protocol/src/contract/suite.ts` — modify: the Mirror rewrite and rules 10 to 13 below
- `package.json` — modify: `typecheck` adds `packages/ledger`

**Interfaces:**
- Consumes: Task 1 and 2.
- Produces: `Ledger`, `LedgerOptions`, `Ledger.host`, the storage keys, the suite's `make` signature.

**Work:** Recover phase 1's `LocalServer` logic into `Ledger` as the base, then add the committed point, the cursor, the log and `host` per "Shared contracts". The mutex wraps every public method and every `host` method: `private run<T>(fn: () => Promise<T>): Promise<T>` chaining on one promise, with `await kv.flush?.()` at the end of a mutating `run`.

The Mirror mirrors the engine: `committed`, `pending`, `cursor`, `seq`, `local`. `batch(events)` builds `{ cursor, baseHash: hash(committed), resultHash: hash(replay(local, events)), events }`; `commit(events)` sets `committed = replay(local, events)`, `pending = []`, `local = committed`, `seq += 1`; `receive(delivery)` skips `n <= cursor`, applies the rest to `pending` and `local`, sets `cursor`. After bootstrap: `committed = boot.state`, `cursor = boot.cursor`, then `receive(boot.delivery)`. Phase 1's rules 1 to 9 keep their meaning; their `toEqual` shapes gain `delivery` and `cursor`. `make` becomes `(clock: ContractClock, options: { flags: Record<string, boolean> }) => Promise<{ client: ServerClient; host?: ContractHost }>` with `ContractHost = { credit(accountId: string, gold: number, reason: string): Promise<void>; settle(accountId: string): Promise<void>; sweep(): Promise<void> }` (structurally `Ledger.host`). Host rules are skipped when `host` is absent.

Contract suite additions:

- rule 10: a batch whose `cursor` is above the latest gets `cursor_mismatch` with the authoritative state and nothing commits; one below the latest (after a `host.credit`) gets `cursor_behind` carrying the credit, nothing commits, and the same batch resubmitted with the new cursor and a result hash over `[credited, ...events]` commits.
- rule 11: after `host.credit`, `account()` carries the `credited` event in its delivery; a batch declaring that cursor commits with the Mirror's hash; a second `account()` carries an empty delivery. A bootstrap with the same token after the credit answers the old committed state, the old cursor, and the credit in `delivery`; a second bootstrap answers the same (bootstrap writes nothing).
- rule 12: a committed batch resubmitted verbatim answers `ok, duplicate: true` with the batch's hash and the current delivery; a delivery repeated across two responses carries the same `n`s and the Mirror applies each once.
- rule 13: `linkStart` then `linkPoll` with the code: `linked` with `login` set; `account` shows `linked`; a second account's token polling the first's code gets `pending`; `linkPoll` with an unknown code gets `pending`.

**Acceptance check:** `pnpm --filter @promptfall/ledger test` green (contract suite rules 0 to 13 plus unit tests). Red before: the package does not exist. Also `pnpm --filter @promptfall/protocol test` still green.

**Boundaries:** No market rules yet beyond the stub and `expireDue` over empty lists. No HTTP. Nothing in the plugin.

- [x] Scaffold the package; recover `LocalServer` as `Ledger`; make phase 1's contract rules pass again under the new Mirror
- [x] Add the committed point, cursor, log, delivery, `host`, `deliverReturns`; write rules 10 to 13 (red), make them green
- [x] Run the acceptance check; commit `feat(ledger): account ledger with cursor, deliveries and link flow`

### Task 4: The HTTP fake process

**Files:**
- `servers/fake/package.json`, `servers/fake/tsconfig.json` — create: `@promptfall/fake-server`, depends on `@promptfall/ledger`, `@promptfall/protocol`, `@promptfall/sim`, `tsx`, `vitest`; scripts `start` (`tsx src/cli.ts`), `test`
- `servers/fake/src/file-kv.ts` — create: `FileKeyValue implements KeyValue` holding a `Map`, persisting on `flush()` with tmp-and-rename, loading the file in its constructor
- `servers/fake/src/clock.ts` — create: `VirtualClock({ speed, persisted: { virtualAt, realAt } | null })` with `now()` and `snapshot()`; monotonic across restarts
- `servers/fake/src/server.ts` — create: `createFakeServer(options: { kv: KeyValue; now: () => Promise<number>; speed: number; flags: Record<string, boolean>; seedSource: () => number; tokenSource: () => string; playerName: string; seed: number }): { listen(port: number): Promise<{ port: number; close(): Promise<void> }>; ledger: Ledger }` on `node:http`, the route table, auth parsing, Zod validation, the status-code rules
- `servers/fake/src/cli.ts` — create: drops a leading `--`, `parseArgs` from `node:util`, startup line `promptfall fake on http://127.0.0.1:<port> seed <n> speed <x> data <path>`, a `sweep` every `60_000 / speed` real ms, a clock snapshot on every `flush`, SIGINT closes cleanly
- `servers/fake/src/server.contract.test.ts` — create: `runServerContract('HTTP fake', …)` where `make` listens on port 0 with a `MemoryKeyValue`, the contract clock and the given flags, and returns `{ client: new HttpClient({ baseUrl, fetch }), host: server.ledger.host }` with `fetch` adapted from Node's global (`text: await r.text()`)
- `servers/fake/src/server.test.ts` — create: `400` on a bad body, `404` on an unknown route, `{ reason: 'unauthorized' }` at 200 on a bad token, `health` fields, the snapshot round-trip (write, new `FileKeyValue` on the same path reads it back), the clock resuming monotonically after a restart with a different speed, every response body passing its `responses.ts` schema
- `package.json` — modify: `test` script filter adds `./servers/*`; `typecheck` adds `servers/fake`; new script `fake`: `pnpm --filter @promptfall/fake-server start`
- `pnpm-workspace.yaml` — modify: add `servers/*`
- `.gitignore` — modify: `.promptfall/`

**Interfaces:**
- Consumes: Task 3's `Ledger`, Task 2's schemas and `HttpClient`.
- Produces: `createFakeServer`, `FileKeyValue`, `VirtualClock`, the CLI.

**Work:** One `Ledger` per process over `FileKeyValue` (or `MemoryKeyValue` in tests) with `now` from the virtual clock, `speed`, `linkApprover` answering the `playerName` login for any live code, the given flags (`market.enabled: true` by default from the CLI). The router matches `method + path` with `:id` segments; every handler parses auth, validates, calls the ledger inside a try/catch that maps a throw to `500`. Internal structure (router helper, handler table) is yours. No framework.

**Acceptance check:** `pnpm --filter @promptfall/fake-server test` green: the contract suite (rules 0 to 13) passes over HTTP, plus `server.test.ts`. Then `pnpm fake --port 7777 --data /tmp/pf-fake.json` prints the startup line and `curl -s localhost:7777/v1/health` answers `{"ok":true,...}`; stop it with Ctrl-C and start it again: the health `now` is larger than before. Paste both curl outputs in the commit body. Red before: the package does not exist.

**Boundaries:** No bots (Task 8). No market routes beyond what the stub answers. Nothing in the plugin.

- [x] Scaffold; `FileKeyValue` with its round-trip test; `VirtualClock` with its restart test
- [x] `server.ts` with the route table; `server.test.ts` (red), then green
- [x] `server.contract.test.ts` over port 0; make the suite pass over HTTP
- [x] `cli.ts`; the root scripts; run the acceptance check; commit `feat(fake-server): HTTP fake over the ledger`

### Task 5a: Plugin engine: vendor the ledger, lock, cursor, re-step, outages

**Files:**
- `scripts/vendor.mjs` — modify: third bundle `ledger` (external `@promptfall/sim`, `@promptfall/protocol`; rewrite both to `./sim.js` and `./protocol.js`); the no-`vitest`, no-workspace-import, no-platform-global checks cover it (add a check that `ledger.js` and `protocol.js` contain no `URLSearchParams`)
- `scripts/tsconfig.vendor.json` — modify: include `packages/ledger/src`, exclude its tests
- `plugins/promptfall/hooks/engine.ts` — modify: the contract under "Plugin engine contract"; `apply` takes `PlayerEvent`; `EngineDeps.after` required; `EngineDeps.random: () => number` for jitter
- `plugins/promptfall/hooks/register.tsx` — modify: wire the new deps; `flushIfOwner` becomes `flushIfIdle` semantics through the engine; the v1 pause publishes `view: null` and `mode: 'paused'`; mechanical fixes for the new `BatchAck`
- `plugins/promptfall/hooks/engine.test.ts` — modify and extend: a flush timer firing during `trade` is skipped and the trade's delivery is applied after the flush's ack; a repeated delivery applies once; `cursor_behind` keeps `sent`, applies the delivery and resubmits with the new cursor; a `cursor_mismatch` adopts; a v1 state at bootstrap pauses with the reset notice and no view; thrown submit → notice, `sent` kept and retried verbatim (same `batchId`) on the backoff, `apply` still works before 120 s and refuses after, recovery clears the notice; a `duplicate` ack with a foreign hash resyncs; a thrown bootstrap retries `start()` on the backoff and recovers; `sync` flushes, calls `account` and applies its delivery
- `plugins/promptfall/hooks/golden.test.ts` — modify: the v2 golden

**Interfaces:**
- Consumes: Tasks 1 to 3 through the vendor bundles (`./vendor/sim.js`, `./vendor/protocol.js`, `./vendor/ledger.js`).
- Produces: `GameEngine` per the contract; `GameHandle.trade`, `GameHandle.sync`.

**Work:** The engine refactor follows the contract verbatim for the fields, the lock, the batch shape, `receive`, `start`, `resync`, `trade`, `sync` and the outage rules; its internal method layout is yours. `register.tsx` constructs the in-process `Ledger` where it constructed `LocalServer`, with `linkApprover: async () => ({ login: 'player' })`, `speed: 1`, and calls `host.sweep()` before each timed flush (the in-process host's only sweep).

**Acceptance check:** `pnpm vendor && pnpm vendor:check` clean; `claude plugin validate plugins/promptfall` lists the same `$` calls as phase 1 (no `http.fetch` yet); `claude plugin test plugins/promptfall` green including the extended engine tests; `pnpm exec tsc -p plugins/promptfall` clean. Red before: the plugin fails to type-check against the new `BatchAck`.

**Boundaries:** No dialog, command or view changes beyond what the type-check forces. No `$.http` yet. Do not change the band or the lease.

- [ ] Vendor the ledger; make the plugin type-check (mechanical fixes only)
- [ ] Engine: lock, committed/pending/sent/buffer, `receive`, `start`, `resync`, `trade`, `sync`; `engine.test.ts` red then green
- [ ] Outage rules with their tests; run the acceptance check; commit `feat(plugin): ledger in-process, cursor-aware engine, outages`

### Task 5b: Plugin: HTTP client, server switching, Account tab link flow and reset

**Files:**
- `plugins/promptfall/hooks/server.ts` — create: `resolveClient(setting: string | null, io): { client: ServerClient; tokenKey: string; label: string }` — `null` → the in-process `Ledger` with `tokenKey = 'deviceToken'`, `label = 'in-process'`; a URL → `new HttpClient({ baseUrl, fetch: io.fetch })` with `tokenKey = 'token:' + url`, `label = url`
- `plugins/promptfall/hooks/register.tsx` — modify: `Io.fetch` adapted from `$.http.fetch`; read `promptfall:server` from the store at start (machine-wide; a secondary follows it on its next renew); `GameSession.switchServer(url)` per the engine contract, answering the dropped-event count; `GameSession.link()` owning the device-flow polling through `io.after` (survives a closed dialog; a hot reload restarts it from the Account tab); `GameSession.reset()`
- `plugins/promptfall/hooks/command.ts` — modify: `server <url>|local` arg; argument hint; reply `Promptfall now plays on <label>` or `Promptfall now plays on <label>; N unsent events on <old> were dropped`
- `plugins/promptfall/hooks/storage.ts` — modify: `StoreCalls.keys` and `StoreKeyValue.keys()` returning the keys under the prefix, stripped
- `plugins/promptfall/hooks/ui/dialog.tsx` — modify: the Account tab renders without a view (server line, `Reset this machine's data`, and the version notice when paused for it); with a view it adds `Link GitHub` → `code` and a `Link` to `url` while `link()` polls → `Linked as <login>`; the reset deletes every `promptfall:` key but `lease`, then `switchServer(current)`
- `plugins/promptfall/types/index.d.ts` — modify: `GameView.account: { linked: string | null; server: string; marketOpen: boolean; returns: number }` (`marketOpen` from `config.flags['market.enabled']`), `DialogState.link: { code: string; url: string } | null`, `PluginState.promptfall.server: string | null`
- `plugins/promptfall/hooks/view.ts` — modify: `toGameView` takes the account info and the server label
- `plugins/promptfall/hooks/register.test.ts` — extend: `/promptfall server http://127.0.0.1:1` with `on('http.fetch')` answering a bootstrap, then a throwing fetch → the notice appears and the band keeps ticking; a session starting with the store pointing at a server whose fetch throws enters the outage and recovers when the fetch answers; `/promptfall server local` during an outage reports the dropped count and returns to the in-process ledger; the link flow against the in-process ledger shows `Linked as player`; the reset on a v1 store starts a fresh account
- `plugins/promptfall/README.md` — modify: the `server` command, the link flow, the reset

**Interfaces:**
- Consumes: Task 5a's engine, Task 2's `HttpClient`.
- Produces: `GameHandle.switchServer`, `GameHandle.link`, `GameHandle.reset`, the `server` store setting, the view's `account`.

**Work:** The adapted fetch: `(url, init) => $.http.fetch(url, init).then(r => ({ status: r.status, ok: r.ok, text: r.text }))`. The lease is untouched by switching and by the reset (it is per machine, not per server).

**Acceptance check:** `pnpm vendor:check` clean; `claude plugin validate plugins/promptfall` lists `http.fetch` and no other new namespace; `claude plugin test plugins/promptfall` green; `pnpm exec tsc -p plugins/promptfall` clean. Red before: `register.test.ts` cannot find the `server` command.

**Boundaries:** No market UI, no Market/Orders tabs (Task 9). Do not change the band or the lease.

- [ ] `server.ts`, `Io.fetch`, the command arg, `switchServer`, the store setting; register tests red then green
- [ ] Account tab without a view; link flow owned by the session; reset; dialog and register tests
- [ ] README; run the acceptance check; commit `feat(plugin): HTTP client, server switching, GitHub link, reset`

### Task 6: PR 1: docs, manual pass, pull request

**Files:**
- `docs/manual-pass/phase-2.md` — create: part A (PR 1) steps; part B is Task 10's
- `README.md` — modify: the repository table gains `packages/ledger` and `servers/fake`; the checks line; the status paragraph

**Work:** Manual pass part A, in the phase 1 document's voice (numbered steps, what you should see, a red is anything else):

1. `pnpm fake --port 7777 --player-name <your name>` in one terminal: the startup line.
2. `claude --plugin-dir plugins/promptfall` in another, `/promptfall server http://127.0.0.1:7777`: the reply `Promptfall now plays on http://127.0.0.1:7777`; the Account tab says `Server: http://127.0.0.1:7777`; a fresh account (zone 1, 0 gold) since nothing moves between servers; the band ticks.
3. Kill the fake (Ctrl-C): within 15 seconds the status row reads `Promptfall: server unreachable, retrying`; the band keeps ticking for two minutes, then the status row reads `Promptfall: server unreachable` and HP stops moving.
4. Restart the fake with the same `--data`: within 45 seconds the notice clears and ticking resumes with the buffered progress kept (gold did not reset).
5. Account tab, `Link GitHub`: a code and a URL appear; within 5 seconds `Linked as <your name>`.
6. `/promptfall server local`: with a phase 1 store, the band is one line reading the older-version notice, `/promptfall account` shows the server line and `Reset this machine's data`, and the reset starts a fresh account; with no phase 1 store, a fresh account directly.
7. Quit both. `head -c 300 .promptfall/fake.json` shows the snapshot.

Then open the PR from `feat/phase-2` into `ai-staging` titled `Promptfall phase 2, PR 1: ledger, HTTP fake, outages, link flow`, body: what landed, the verification commands and their results, the manual pass pointer, the attribution lines. Stop and hand Kevin the manual pass.

**Acceptance check:** `pnpm lint && pnpm typecheck && pnpm test && pnpm vendor:check` green in one run, pasted in the PR body; `gh pr view --json url` shows the PR.

**Boundaries:** No code changes in this task beyond docs. Do not merge.

- [ ] Write part A of the manual pass; update the READMEs
- [ ] Run the full check line; open the PR; stop

### Task 7: Ledger market rules, routes, contract cases

**Files:**
- `packages/ledger/src/market.ts` — modify: replace the stub with the rules under "`@promptfall/ledger`"
- `packages/ledger/src/goods.ts` — create: `transfer(goods, now, nextId, receiverState)`: re-id if not `t`-prefixed, cooldown, hero reset via `heroStats`
- `packages/ledger/src/ledger.ts` — modify: `expireDue` over real listings and orders; `account` reports `returns`
- `packages/ledger/src/market.test.ts` — create: unit tests for fee rounding (`price 1 → fee 1`, `price 49 → fee 1`, `price 50 → fee 1`, `price 51 → fee 1`, `price 100 → fee 2`; sale fee `price 19 → 0`, `price 20 → 1`), cooldown boundary (`tradeableAt === now` is tradeable), expiry boundary (`expiresAt === now` expires, inside `buy` without a sweep), returns delivery per kind after a ledger reload from the same `KeyValue`, `transfer` leaving a returned hero unchanged
- `packages/protocol/src/contract/suite.ts` — modify: rules 14 to 24
- `servers/fake/src/server.ts` — modify: the nine market routes
- `servers/fake/src/server.test.ts` — modify: query parsing for `GET /v1/listings` (bad `page` → 400; missing `sort` → 400)

**Interfaces:**
- Consumes: Task 3's `Ledger`, Task 2's market types.
- Produces: the market half of `ServerClient` on both hosts.

**Work:** Contract rules, each a two-account scenario unless noted, with the Mirror on both sides asserting hashes after deliveries:

- rule 14: a common item cannot be listed (`not_tradeable_rarity`); an equipped rare cannot (`equipped`); a hero in the party cannot (`in_party`); a price of 0 or 1,000,001 cannot (`bad_price`); listing goods the caller does not own is `unknown_goods`.
- rule 15: listing a rare item removes it, charges `max(1, floor(price×200/10000))`, and `browse` shows it with the seller's name.
- rule 16: buying it moves the goods with a `t`-prefixed id and `tradeableAt = now + 24 h`, charges the buyer `price`, pays the seller `price − floor(price×500/10000)` in the seller's next delivery (via `account()`); both hashes match the server's; buying the listing again is `gone`.
- rule 17: buying your own listing is `self_trade`; buying with less gold is `not_enough_gold`; buying with a full inventory is `no_space` and the listing stays open.
- rule 18: cancel returns the goods; cancel with a full inventory puts them in `returns`, `account().returns === 1`, and a batch that vendors one item gets `returned` in its own ack's delivery; a cancel after a sale is `gone`.
- rule 19: a listing at exactly 7 days is gone from `browse` and its goods return, with no `sweep` call; an order at exactly 7 days refunds the same way.
- rule 20: a bought item cannot be relisted before 24 h (`in_cooldown`); at exactly `tradeableAt` it can.
- rule 21: a hero sold at level 7 arrives at level 1, xp 0, hp equal to the level-1 max, same rarity and traits, no equipment; a hero with equipment cannot be listed (`equipped`); a hero cancelled back at level 7 is still level 7.
- rule 22: `placeOrder` escrows `maxPrice`; `cancelOrder` refunds it; `minRarity: 'common'` is `not_tradeable_rarity`.
- rule 23: `matchingOrders` matches base, minimum rarity in `RARITIES` order and the required affix, never the caller's own orders; `fillOrder` pays the seller `maxPrice − fee`, delivers the item to the buyer, closes the order; `no_match` for a wrong item; `no_space` leaves the order open.
- rule 24: with `flags['market.enabled'] = false`, `list`, `buy`, `placeOrder` and `fillOrder` are `market_closed`, `cancelListing` and `cancelOrder` still work, and `browse` still answers; an unlinked account gets `not_linked` on `list`, `buy`, `placeOrder`, `fillOrder`.

**Acceptance check:** `pnpm --filter @promptfall/ledger test` and `pnpm --filter @promptfall/fake-server test` green with rules 0 to 24 on both hosts; `market.test.ts` green. Red before: rules 14 to 24 fail on the stub.

**Boundaries:** No bots. No plugin changes. No new server event kinds beyond the nine.

- [ ] `goods.ts` and the fee helpers with `market.test.ts` (red, then green)
- [ ] Rules 14 to 24 in the suite (red); `market.ts` until green over the in-process ledger
- [ ] Routes in the fake; the suite green over HTTP; commit `feat(ledger): market rules, orders, cooldowns, expiry and returns`

### Task 8: Bots

**Files:**
- `servers/fake/src/bots.ts` — create: `startBots(options: { ledger: Ledger; seed: number; count: number; speed: number; schedule: (ms: number, fn: () => void) => { cancel(): void } }): { stop(): void; tick(): Promise<void> }` (`tick` runs one bot's action; the scheduler calls it, tests call it directly)
- `servers/fake/src/bot-config.ts` — create: names, counts and multipliers (tuning)
- `servers/fake/src/bot-seed.ts` — create: `rollBotState(seed, i): GameState`
- `servers/fake/src/cli.ts` — modify: `--bots` flag, start the bots after listen with `setTimeout`-based scheduling
- `servers/fake/src/bots.test.ts` — create: with a seeded ledger over `MemoryKeyValue` and a manual clock, the seeded population of 12 holds at least 3 Rare+ unequipped items and at least 2 Rare+ heroes outside any party in total; after 60 `tick()`s there are listings in `browse` for both kinds, at least one order in some bot's `myOrders`, and at least one sale between bots; two runs with the same seed produce the same listing ids and prices

**Interfaces:**
- Consumes: `Ledger.host.mint`, `Ledger.host.credit`, `Ledger.host.settle`, the public market methods, `vendorValue`, `createInitialState`, `replay`, `content` from `@promptfall/sim`.
- Produces: bots in the running fake.

**Work:** `rollBotState(seed, i)`: `s = createInitialState((seed ^ (i + 1)) >>> 0)`, then `s.gold = 50_000` (host construction, not a trade), then a deterministic script computed against the evolving state: `600 + (i × 37) % 300` rounds of `tool_call, tick, tick, tick`; every 20 rounds a `vendor` of every common and uncommon item in the inventory; every 60 rounds a `recruit`; a `rest` at the end. Build it with `replay` step by step (the script reads the state to pick ids). On start, for each `i < count`: read `pf:bot:<i>`; if absent, `host.mint({ state: rollBotState(seed, i), name: NAMES[i], linked: true })` and write it. Each bot owns a seeded xorshift PRNG in `bots.ts` (the sim's determinism rule does not bind the fake, but the run must be deterministic given `seed`). Each `tick`, one bot (round robin) acts: read its effective state through `bootstrap` with its token then `host.settle`; if gold is under `STIPEND_FLOOR` (2000), `host.credit(STIPEND = 1000, 'bot_stipend')`; draw one of `list` (weight 4), `buy` (3), `order` (2), `cancel` (1). `list`: a tradeable, unequipped, out-of-cooldown Rare+ item or out-of-party bare Rare+ hero, price `vendorValue × (3 + roll(6))` for items, `heroPrice[rarity]` from the config for heroes. `buy`: the cheapest listing not its own under `vendorValue × 4` that it can afford. `order`: a random base from `content.itemBases` with `minRarity: 'rare'`, `maxPrice = vendorValue of that base at rare × 3`. `cancel`: its oldest listing. Every refusal is logged at debug level and ignored.

**Acceptance check:** `pnpm --filter @promptfall/fake-server test` green with `bots.test.ts`. Then `pnpm fake --port 7777 --speed 10 --data /tmp/pf-bots.json` and after 30 seconds `curl -s 'localhost:7777/v1/listings?kind=item&sort=newest&page=0' -H 'authorization: Bearer <a token from the snapshot>' | head -c 400` shows listings with bot names. Paste it in the commit body.

**Boundaries:** Bots use only `host.mint`, `host.credit`, `host.settle` and public methods. No direct `kv` writes except `pf:bot:<i>`. No plugin changes.

- [ ] `bot-seed.ts` and `bot-config.ts`; the population assertion in `bots.test.ts` (red, then green)
- [ ] `bots.ts` with the rest of `bots.test.ts` (red, then green)
- [ ] CLI flag; run the acceptance check; commit `feat(fake-server): seeded bots that list, buy, order and cancel`

### Task 9: Plugin: Market and Orders tabs, sell flow, order form, toasts, loot lines

**Files:**
- `plugins/promptfall/types/index.d.ts` — modify: `DialogTab` adds `'market' | 'orders'`; `ItemView.tradeableAt: number | null`, `RosterHeroView.tradeableAt: number | null`; `ListingView`, `OrderView`; `MarketState = { query: ListingQuery; page: ListingPage | null; busy: boolean; confirm: string | null; error: string | null }`; `OrdersState = { mine: MyOrders | null; form: { base: string; minRarity: Rarity; affixId: string | null; maxPrice: string } | null; busy: boolean; error: string | null }`; `DialogState.sell: { kind: TradeKind; id: string; matching: Order[]; price: string; error: string | null } | null`; `PluginState.promptfall.market`, `.orders`
- `plugins/promptfall/hooks/ui/market.tsx` — create: the Market tab body
- `plugins/promptfall/hooks/ui/orders.tsx` — create: the Orders tab body and the order form
- `plugins/promptfall/hooks/ui/sell.tsx` — create: the sell flow panel used by Inventory and Heroes
- `plugins/promptfall/hooks/ui/time.ts` — create: `remainingRealMs` per the engine contract and `formatRemaining(ms)` (`3d 4h`, `16h`, `45m`, `<1m`)
- `plugins/promptfall/hooks/ui/dialog.tsx` — modify: tabs `m` Market and `r` Orders; `Sell` buttons on Rare+ items and heroes; mounts the three bodies; the gate lines (`The market is closed.` when `view.account.marketOpen` is false; `Link your GitHub account: press a for the Account tab` when not linked) shown in place of the trade buttons
- `plugins/promptfall/hooks/command.ts` — modify: `market`, `orders` args
- `plugins/promptfall/hooks/register.tsx` — modify: toasts for the `traded` effect (`Sold <name> for <net>g`, `Bought <name> for <price>g`, `<name> returned to you`); `GameHandle.market` helpers (`browse`, `myOrders`, `matching`) that call the client without a flush (reads need none) and `GameHandle.clock()` for `time.ts`
- `plugins/promptfall/hooks/view.ts` — modify: `lootLine` for the `trade` entry; `tradeableAt` into the views
- `plugins/promptfall/hooks/dialog.test.ts` — extend, against `/promptfall server http://test` with `on('http.fetch')` canned bodies: the Market tab renders listings; changing a filter resets the page to 0 and refetches; Buy → confirm (`y`) → one `POST /v1/listings/:id/buy` and the view shows the new item; the sell flow lists matching orders first and the price form second, with fee and net; a bought item's sell flow says `Tradeable in …`; the order form submits a `NewOrder`; gates render for unlinked and closed market
- `plugins/promptfall/hooks/engine.test.ts` — extend: `trade` with a non-empty buffer flushes first (the batch arrives before the market call)
- `plugins/promptfall/README.md` — modify: tabs, hotkeys, sell flow

**Interfaces:**
- Consumes: Task 5's engine and handle, Task 7's market methods.
- Produces: the phase 2 dialog.

**Work:** Market tab: a filter row (`kind` toggle button; `base` via `pick` over `content.itemBases` keys when kind is item, `cls` via `pick` over the four classes when kind is hero, both with an `any` option; `minRarity` via `pick`; `sort` toggle), any filter change resets `page` to 0 and refetches; 10 listing rows of two lines each (name, rarity colour, affixes or traits; seller, price, `buy` button or `yours`), `prev`/`next` buttons, and a confirm row `Buy <name> for <price>g?` with `confirm` on hotkey `y` and `cancel` on `n`. Every fetch sets `busy` and clears it; errors show in red for 5 seconds as `paneNotice` does. The dialog calls `sync()` on open, then `browse`; after every trade it calls `sync()` and refetches. Orders tab: `My listings` (cancel button each, `expires in <remaining>` from `time.ts`), `My buy orders` (cancel each), `Returns waiting: N` when non-zero, `New order` form: base via `pick` (name labels), minimum rarity via `pick` (rare, epic, legendary), affix via `pick` over `content.affixes` plus `none`, `maxPrice` through `Input` (`onSubmit`) where the surface has one, else four preset buttons at `vendorValue × 2 / 3 / 5 / 8` of the base at the chosen rarity. Sell flow (`Sell` on an item or a hero): first `Matching orders` (each `accept <maxPrice>g, you get <net>g`), then `List for` with the price `Input` (or presets), showing `fee <fee>g` and `you get <net>g` live from `onInput`; `list` calls `trade(list)`; a hero with equipment shows `unequip first` and its `unequip` buttons; goods in cooldown show `Tradeable in <remaining>` and no form. Refusals map to one line each: `not_enough_gold` → `Not enough gold`, `no_space` → `No free slot`, `in_cooldown` → `Tradeable in <remaining>`, the rest as spec words. The toast texts above use the item's base name or the hero's name. Fee and net are computed on the client for display only (`fee = max(1, floor(p×200/10000))`, `net = p − floor(p×500/10000)`); the ledger's answer wins.

**Acceptance check:** `pnpm vendor:check` clean; `claude plugin validate plugins/promptfall`; `claude plugin test plugins/promptfall` green with the extended dialog and engine tests; `pnpm exec tsc -p plugins/promptfall` clean. Red before: `dialog.test.ts` cannot find the Market tab.

**Boundaries:** No band change. No new `$` namespace. No market rule evaluated on the client beyond the display arithmetic above.

- [ ] Types, tabs, command args, `time.ts`; `dialog.test.ts` red for the Market tab
- [ ] `market.tsx` with browse, filters, paging, buy with confirm
- [ ] `sell.tsx` with matching orders, the price form and the cooldown line; `Sell` buttons
- [ ] `orders.tsx` with listings, orders, returns, the order form
- [ ] Toasts and loot lines; README; run the acceptance check; commit `feat(plugin): market and orders tabs, sell flow, trade toasts`

### Task 10: PR 2: manual pass part B, docs, pull request

**Files:**
- `docs/manual-pass/phase-2.md` — modify: part B
- `README.md` — modify: status says phase 2 is built; play section mentions `pnpm fake`
- `docs/spec/promptfall.md` — modify only if execution found a contract deviation that Kevin approved in chat; otherwise untouched

**Work:** Part B steps:

1. `pnpm fake --port 7777 --speed 10 --player-name <you>`; plugin session on it, linked (part A steps 1, 2, 5).
2. `/promptfall market`: within 30 seconds listings from bots (items and heroes with bot seller names). `m`/`r`/`i` switch tabs; `next` pages; picking a base filters the list and returns to page 0.
3. Buy the cheapest item you can afford: confirm with `y`, then the item in the Inventory tab with a toast `Bought <name> for <price>g`, gold down by the price, and a loot-log line `bought <name>`.
4. `Sell` on that item: `Tradeable in 2h` (24 virtual hours at speed 10) and no price form. `Sell` on a Rare+ drop you own: the price form, `fee` and `you get` update as you type; `list`; the item leaves the inventory; the Orders tab lists it with `expires in 16h`.
5. Wait up to 2 minutes: a bot buys it if priced near vendor value × 3; toast `Sold <name> for <net>g`, gold up.
6. Orders tab, `New order`: base, rarity rare, no affix, a max price; the order appears; gold down by the escrow. `cancel`: gold back.
7. A bot's order: `Sell` on a Rare+ item of a base bots order shows `Matching orders` first; `accept`: gold up by `maxPrice − fee`, item gone.
8. Heroes tab: `Sell` on a hero in the party says `in party`; on a spare hero with gear says `unequip first`; bare and out of party: listable; cancel it on the Orders tab; it returns at its level.
9. Fill the inventory (30), cancel a listing: `Returns waiting: 1`; vendor one item; within 15 seconds the item is back and the count is 0.
10. `/promptfall server local`: the Market tab says `Link your GitHub account` until you link in Account (instant); listings are empty (no bots in-process) and `New order` works.
11. Stop the fake, start it with `--speed 1`: nothing lost; the Orders tab's `expires in` is now in real days.

PR from `feat/phase-2-market` into `ai-staging` titled `Promptfall phase 2, PR 2: market, orders, hero trading, bots`, same body shape as PR 1. Stop and hand Kevin part B.

**Acceptance check:** the full check line green and pasted; `gh pr view --json url`.

**Boundaries:** Docs only. Do not merge.

- [ ] Write part B; update the README; run the check line; open the PR; stop

## Out of scope

Presence, chat, leaderboards, world bosses (phase 3); sprites and sound (phase 4); real GitHub device flow, Postgres, Redis, admin CLI, Docker, the long-poll stream, `revokedItemIds` population, the server-side lease (phase 5); rate limits on market routes; hero buy orders; migrations between sim versions; durable transactions on the in-process host (its store has no atomic multi-key write; phase 1 already accepts that).
