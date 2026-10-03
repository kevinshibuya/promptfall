# Promptfall phase 3 implementation plan

**Goal:** Players see each other, chat, climb two leaderboards and fight a scheduled world boss together, against the HTTP fake with bots that play through the public API.
**Architecture:** World data (presence, the chat tail, the live boss) is never sim state: a session reads it with the world poll, `GET /v1/world`, which is also its heartbeat. The ledger holds presence in memory, chat and the boards in the store, and in PR 2 a boss record beside the sim. The sim gains boss mode (`SIM_VERSION` 3): the server event `boss_engaged` turns the party's encounter into one `world_boss` enemy that never dies locally, the state tallies the damage dealt, the server reads that tally from each committed batch as the account's contribution, and rolls rewards as `rewarded` server events. Bots become HTTP clients of the fake's own port with a client-side mirror, so they batch, fill orders, chat and fight the boss like a player.
**Spec:** `docs/spec/promptfall.md` (§3, §4.6, §6 to §10, §12 as amended on 2026-10-03), `docs/plans/2026-10-03-phase-3-grill.md` (the record: §1 decisions, §5 open items, §6 facts, §7 split), `docs/adr/0001-trades-as-server-events.md`, `docs/adr/0002-world-boss-as-boss-mode.md`, `CONTEXT.md`
**Execution model:** opus
**Review wave:** pending: one wave (reviewer on opus, reviewer on fable, codex-review on gpt-6-astra at xhigh), consolidated into one fix pass
**Delivery:** two PRs into `ai-staging`. PR 1 (social) is Tasks 1 to 7 on `feat/phase-3`, which already holds the grill docs; no sim change, no reset. PR 2 (world boss) is Tasks 8 to 12 on `feat/phase-3-boss`, branched from PR 1's head; it bumps `SIM_VERSION` to 3 and its manual pass carries the reset. Each PR's review runs two legs, `reviewer` on Opus and `codex-review`, with no Fable leg until Kevin says otherwise. Red between tasks: in PR 1, from Task 1 to the end of Task 2 the ledger does not type-check (`ServerClient` has three methods the ledger lacks), and from Task 1 to the end of Task 5 the plugin does not type-check and `vendor:check` is stale; the suite's rules 25 to 32 fail over HTTP until Task 3. In PR 2, from Task 8 to the end of Task 9 `packages/protocol` does not type-check (`ServerEventSchema` lacks the three new kinds), the contract rules 33 to 40 fail until Task 10, and `vendor:check` is stale until Task 11. Each PR's last commit is clean on the full check line.

## Global constraints

- Everything in the phase 2 plan's global constraints still holds (`docs/plans/2026-10-03-promptfall-phase-2.md`, "Global constraints"), with these changes: `SIM_VERSION` becomes `3` in PR 2 (spec §7: any sim change bumps it; a state behind it is reset from the Account tab); the phase 2 rule "no new server event kinds beyond the nine" is lifted for exactly `boss_engaged`, `boss_disengaged`, `rewarded`; the `tradeableAt` grep rule gains no new file (a reward item is built by `loot.ts`).
- Spec §2: every social feature sits behind a server flag. Phase 3 flags: `chat.enabled`, `worldboss.enabled`, `presence.enabled`, `leaderboards.enabled`, beside `market.enabled` and `maintenance`. All resolve to `true` on the ledger unless set; the in-process host passes `chat.enabled: false` and `worldboss.enabled: false`.
- Spec §6 and record §1.1: world data is never a server event and never sim state. The world poll runs every `15_000` ms on the primary's flush cadence and every `5_000` ms while a world boss is live or the Chat tab is open; secondaries poll too. A thrown poll is ignored; the World tab dims as stale after `45_000` ms without a fresh snapshot. Only a thrown submit or bootstrap enters the outage.
- Spec §6 presence: online means a heartbeat inside the TTL, `45_000` real ms; keyed by account; zone from the committed state on the server; in the `Ledger` instance's memory, never in the store.
- Spec §6 chat: linked and `chat.enabled`; `200` characters after trimming; token bucket per account on the server clock, capacity `5`, refill one per `10_000` ms; the word blocklist refuses, never masks; the last `200` kept, the last `50` served to a poll with no chat mark; chat is not a server event, needs no flush and no lease, never toasts.
- Spec §6 leaderboards: highest zone (all time) and world boss damage (weekly, Monday 00:00 UTC on the server clock); from the ledger's records, never client claims; `20` rows each; names are `displayName`, else `adventurer`, and a blocklisted name shows as `adventurer`.
- Spec §6 and §4.6 world boss: spawns on the server clock's `10_800_000` ms grid from epoch zero, lives `1_200_000` ms or until dead; HP is `BOSS_BASE_HP × online at spawn`; every online account is engaged at spawn and a newly online one on its first poll; contribution is the `dealt` delta on each committed batch; rewards at the killing commit: a guaranteed drop at or above `500` bp (5%) of `BOSS_BASE_HP`, one bonus roll each for the top 3; an expired boss pays the threshold drop only; goods with no free slot wait in returns, never vendored; boss mode rules R1 to R5.
- Spec §7 outage rules are unchanged (`register.tsx:50-74`, `engine.ts`). Chat posting during an outage answers `Server unreachable` like a trade.
- Spec §9: bots use `host.mint` and `host.credit` only; every other action goes through `HttpClient` against the fake's own port. `host.settle` is retired.
- Engine facts (record §6): `$.http.fetch` has no abort and no timeout; the plugin's `timedFetch` gives every fetch 15 s. No new `$` namespace: `claude plugin validate plugins/promptfall` lists the same calls as phase 2 (`ui`, `state`, `store`, `clock`, `command`, `http.fetch`). Nothing bundled into the plugin may use a platform global (`scripts/tsconfig.vendor.json` has `lib: ["ES2022"]`, `types: []`).
- Tuning numbers live in four named files and nowhere else: `packages/ledger/src/world-config.ts` (PR 1), `packages/ledger/src/boss-config.ts` (PR 2), `plugins/promptfall/hooks/world.ts` (poll cadences and the stale marker), `servers/fake/src/bot-config.ts` (bots). Tests import them rather than repeating the values.
- Branch flow: `feat/phase-3` (PR 1), `feat/phase-3-boss` (PR 2); PRs into `ai-staging`; nothing lands on `main`.

## Shared contracts

Load-bearing shapes. Later tasks import them by these exact names.

### `@promptfall/protocol` additions (`packages/protocol/src/world.ts`, re-exported from `index.ts`)

```ts
export type ChatMessage = { id: number; name: string; text: string; at: number }   // id: global, monotonic, starts at 1
export type ChatRefusal =
  | 'not_linked' | 'chat_closed' | 'empty' | 'too_long' | 'rate_limited' | 'blocked' | 'unauthorized'
export type ChatResult = { ok: true; message: ChatMessage } | { ok: false; reason: ChatRefusal }

export type BossView = {
  bossId: string; name: string; glyph: string
  maxHp: number; hp: number        // hp is 0 from the killing commit until endsAt, then the boss leaves the snapshot
  spawnedAt: number; endsAt: number // server epoch ms
  yours: number                    // the caller's tallied contribution
}

export type WorldSnapshot = {
  serverNow: number
  online: number
  zones: { zone: number; count: number }[]   // ascending zone, counts > 0 only
  here: string[]                              // names in the caller's zone, caller excluded, at most 10, most recent heartbeat first
  boss: BossView | null                       // always null in PR 1
  chat: ChatMessage[]                         // ascending id
  flags: Record<string, boolean>              // the resolved flags, same object as ServerConfig.flags
}

export type BoardRow = { accountId: string; name: string; value: number }
export type Boards = { highestZone: BoardRow[]; damage: BoardRow[]; weekStart: number }   // 20 rows at most each, value descending; damage is empty in PR 1

// Zod: ChatMessageSchema, ChatResultSchema, BossViewSchema, WorldSnapshotSchema, BoardRowSchema, BoardsSchema,
// plus WorldResponseSchema = orUnauthorized(WorldSnapshotSchema), BoardsResponseSchema = orUnauthorized(BoardsSchema) in responses.ts.
// Text limits in the schemas: ChatMessage.text 1..200 after trimming, name 0..128. The chat body: ChatBodySchema = z.object({ text: z.string().max(2000) }); the ledger judges the length.
```

`ServerClient` (`packages/protocol/src/client.ts`) gains, after `fillOrder`:

```ts
  /** The world poll: stamps the caller present and answers the snapshot. `since` is the chat mark; 0 asks for the last 50. */
  world(auth: Auth, since: number): Promise<WorldSnapshot | Unauthorized>
  chat(auth: Auth, text: string): Promise<ChatResult>
  leaderboards(auth: Auth): Promise<Boards | Unauthorized>
```

`ROUTES` (`packages/protocol/src/http.ts`) gains `world: { method: 'GET', path: '/v1/world' }`, `chat: { method: 'POST', path: '/v1/chat' }`, `leaderboards: { method: 'GET', path: '/v1/leaderboards' }`. The HTTP shapes, in the phase 2 table's terms:

| Method and path | Body | Result |
| --- | --- | --- |
| `GET /v1/world?since=<n>` | | `WorldSnapshot \| Unauthorized` (`since` optional, a non-negative integer; absent means 0; anything else is `400 schema`) |
| `POST /v1/chat` | `{ text }` | `ChatResult` |
| `GET /v1/leaderboards` | | `Boards \| Unauthorized` |

All three take `authorization: Bearer <deviceToken>`. A bad token answers `{ reason: 'unauthorized' }` at 200 on the two reads and `{ ok: false, reason: 'unauthorized' }` on chat, as the market does.

`Mirror` moves from `packages/protocol/src/contract/suite.ts` to `packages/protocol/src/mirror.ts`, exported from the package root, with one change: the constructor takes `(boot: Bootstrap, options: { newBatchId?: () => string } = {})`; `batch()` uses `options.newBatchId`, default a per-instance counter rendered as `mirror-${n}` padded to 19 characters (the `BatchSchema` floor is 16). It uses no platform global, so it may be bundled. The suite passes `{ newBatchId: () => crypto.randomUUID() }` and keeps its behaviour; the bots pass `randomUUID` from `node:crypto`.

### Server events added in PR 2 (`packages/sim/src/types.ts`)

```ts
export const SIM_VERSION = 3 as const
export type EnemyKind = 'wave' | 'zone_boss' | 'turn_boss' | 'world_boss'

export type ServerEvent =
  | /* the nine phase 2 kinds, unchanged */
  | { t: 'boss_engaged'; bossId: string; name: string; glyph: string; stats: Stats }   // stats at zone 1 scale
  | { t: 'boss_disengaged'; bossId: string }
  | { t: 'rewarded'; bossId: string; goods: Goods | null; gold: number }               // goods null: the item waited in returns

export type GameState = { /* as today, plus: */
  /** Boss mode: set by boss_engaged, cleared by boss_disengaged. `dealt` is the party's tally for this boss. */
  boss: { bossId: string; name: string; glyph: string; stats: Stats; dealt: number } | null
}

export type LootEntry = /* as today, plus: */ | { k: 'reward'; base: string; rarity: Rarity; gold: number }
export type Effect = /* as today, plus: */ | { k: 'rewarded'; bossId: string; goods: Goods | null; gold: number }
```

`SERVER_EVENT_KINDS` gains the three names. `ServerEventSchema` (protocol) gains the three objects; `stats` is `z.object({ hp, atk, def, spd })` of non-negative integers; `gold` non-negative.

Semantics, one line each, with the sim's existing `reject(state, event, 'server_event_unapplicable:<detail>')` for a failed precondition:

- `boss_engaged`: `state.boss !== null` → `already_engaged`. Else the encounter becomes `{ enemies: [e], queue: [], waveSize: 0, spawnedInWave: 0 }` with `e = { id: newId(s, 'e'), def: 'world_boss', kind: 'world_boss', hp: stats.hp, maxHp: stats.hp }` (the old encounter and queue are dropped; `pendingTurnBoss` and `turnToolCalls` are kept), and `state.boss = { bossId, name, glyph, stats, dealt: 0 }`. No effect.
- `boss_disengaged`: `state.boss?.bossId !== bossId` → `not_engaged`. Else `encounter = null`, `boss = null`. The next tick spawns as usual (`spawnOnEmptyTick`, `progression.ts:174-194`). No effect.
- `rewarded`: `goods` non-null and no room → `inventory_full` / `roster_full` (the ledger never authors that: it routes to returns first). Else insert the goods as carried, `gold += gold`, loot entry `{ k: 'reward', base, rarity, gold }` when goods are present, effect `rewarded` always.

Boss mode rules in the sim (spec §4.6, record §1.3), binding on the implementer:

- The world boss's local stats: `enemyStats` (`combat.ts:12-14`) becomes `enemyStats(s, enemy)`; for `kind === 'world_boss'` it answers `scaledBossStats(s)`: with `z1 = content.enemies[content.zones[0].boss].stats` and `zb = content.enemies[content.zones[s.zone - 1].boss].stats`, `atk = floor(s.boss.stats.atk × zb.atk / z1.atk)`, `def = floor(s.boss.stats.def × zb.def / z1.def)`, `spd = s.boss.stats.spd + floor(s.zone / 3)` (the same offset `enemies.ts:173` gives every enemy), `hp = s.boss.stats.hp`. Integer math only. With the stats the ledger carries (below), a world boss hits exactly as hard as the party's own zone boss.
- `hitEnemy` (`combat.ts:22-25`): for a `world_boss`, `s.boss.dealt += amount` and the enemy's `hp` is untouched; `onEnemyKilled` is never reached, so no XP, gold or drops (R3).
- R1: `checkWipe` (`progression.ts:273-286`) in boss mode: `fullHealParty` twice as today around `applyPendingParty`, but no retreat (`changeZone` not called), no `wipes` increment, no `wipe` effect, the encounter kept, `pendingTurnBoss` kept; returns `true`.
- R2: `onToolCall` (`progression.ts:147-153`) in boss mode increments `turnToolCalls` and spawns nothing.
- R4: `onRest` is unchanged. Wave-clear heals never fire in boss mode (nothing dies).
- R5 is the client's (Task 11).

### `@promptfall/ledger` additions

```ts
// ledger.ts
export type LedgerFlag =
  | 'market.enabled' | 'chat.enabled' | 'worldboss.enabled' | 'presence.enabled' | 'leaderboards.enabled' | 'maintenance'
export type LedgerOptions = { /* as today, plus: */
  /** Online means a heartbeat inside this many server-clock ms. Default PRESENCE_TTL_MS × (speed ?? 1): heartbeats arrive at real cadence. */
  presenceTtlMs?: number
}
// world-config.ts (PR 1)
export const PRESENCE_TTL_MS = 45_000
export const HERE_MAX = 10
export const CHAT_MAX_CHARS = 200
export const CHAT_BUCKET_CAPACITY = 5
export const CHAT_REFILL_MS = 10_000
export const CHAT_KEEP = 200
export const CHAT_SERVE = 50
export const BOARD_ROWS = 20
// blocklist.ts (PR 1)
export const BLOCKED_WORDS: readonly string[]            // placeholder content: ['heck', 'darn', 'frick', 'blockedword']
export function isBlocked(text: string): boolean          // whole-word, case-insensitive: lower-case, split on /[^\p{L}\p{N}]+/u, any word in the list
// boss-config.ts (PR 2)
export const BOSS_GRID_MS = 10_800_000
export const BOSS_WINDOW_MS = 1_200_000
export const BOSS_BASE_HP = 8000
export const BOSS_THRESHOLD_BP = 500
export const BOSS_TOP_BONUS = 3
export const WORLD_BOSS_STAT_BP = 10000
export const WORLD_BOSSES: readonly { name: string; glyph: string }[]   // 4 entries, e.g. { name: 'The Promptwyrm', glyph: '☠' }
```

Storage keys, beside phase 2's:

- `pf:chat` → `{ nextId: number; messages: ChatMessage[] }`, at most `CHAT_KEEP` messages, oldest first.
- `pf:boards` → `{ zone: BoardRow[]; week: { start: number; damage: Record<string, { name: string; value: number }> } }`. `zone` is the highest-zone board, at most `BOARD_ROWS` rows, value descending, ties by earlier insertion. `week.damage` holds every contributor of the current week (bounded by who contributed); the top `BOARD_ROWS` are cut at read. `week.start` is the Monday the entries belong to; a read or write in a later week resets `week` first.
- `pf:world:boss` → `BossRecord = { bossId: string; name: string; glyph: string; spawnedAt: number; endsAt: number; maxHp: number; hp: number; contributions: Record<string, number>; closed: boolean }` (PR 2). `contributions` keys are the engaged accounts (0 until they deal damage). `closed` is set once rewards and disengages are authored.
- `AccountRecord` gains `chat?: { tokens: number; refillAt: number }` (absent means a full bucket) and `boss?: { lastBossId: string }` is not needed: engagement is `accountId in contributions`.

Presence is `private presence = new Map<string, { zone: number; name: string; at: number }>()` on the `Ledger` instance. `world()` writes it (no store write, so `TrackedKeyValue.dirty` stays false and nothing is flushed); the TTL check is `now − at < ttl`; entries past the TTL are pruned on each poll. The public name of a record is `publicName(record) = isBlocked(displayName) ? 'adventurer' : (displayName ?? 'adventurer')`, used by presence, chat, the boards and `market.ts`'s `nameOf` (lines 46-48).

Rules the ledger enforces, by operation (every one under the mutex, reads flush nothing):

- `world(auth, since)`: authenticate, else `unauthorized`. PR 2: `advanceBoss(now)` first (below). If `flags['presence.enabled']` and `isCurrent(record)`: stamp `{ zone: record.state.zone, name: publicName(record), at: now }` under the account id. Snapshot: `online` = entries inside the TTL (the caller included), `zones` from them, `here` = the others in the caller's zone (`HERE_MAX`), all three empty and no stamp when presence is off. `chat`: when `flags['chat.enabled']`, `since <= 0` → the last `CHAT_SERVE` messages, else every kept message with `id > since`; `[]` when off. `boss` (PR 2): the open record as `BossView` with `yours = contributions[accountId] ?? 0`, null when none is open or `worldboss.enabled` is off. PR 2: an online, current account not yet in `contributions` of an open, unkilled boss is engaged here (`author(record, boss_engaged)`, `contributions[accountId] = 0`, record and boss saved).
- `chat(auth, text)`: `unauthorized`; `chat_closed` unless `flags['chat.enabled']`; `not_linked` unless `account.linked`; `trimmed = text.trim()`; `empty` when `trimmed === ''`; `too_long` when `[...trimmed].length > CHAT_MAX_CHARS`; `blocked` when `isBlocked(trimmed)`; the bucket: `tokens = min(CAP, tokens + floor((now − refillAt) / CHAT_REFILL_MS))`, `refillAt += n × CHAT_REFILL_MS` (whole periods only, as the batch buckets do, `ledger.ts:258-269`), `rate_limited` when `tokens < 1`, else `tokens −= 1`; append `{ id: nextId, name: publicName(record), text: trimmed, at: now }`, `nextId += 1`, drop the oldest past `CHAT_KEEP`; save the record (bucket) and `pf:chat`; answer `{ ok: true, message }`. Order of checks is as listed: a closed channel says so before the gate.
- `leaderboards(auth)`: `unauthorized`; PR 2: `advanceBoss(now)`; reset `week` if `weekStartOf(now) !== week.start`; answer `{ highestZone: zone rows, damage: top BOARD_ROWS of week.damage by value desc then name, weekStart }`, both lists `[]` when `flags['leaderboards.enabled']` is false.
- `offerZone(boards, row)`: called in `submit` step 9 after a commit with `{ accountId, name: publicName, value: result.highestZone }` and in `host.mint` with the minted state's `highestZone`: replace the account's row if present and lower, else insert when the list has room or the value beats the last row; sort, cut to `BOARD_ROWS`. Cheap, so it runs on every commit rather than only when the zone rose.
- `weekStartOf(now)`: `days = floor(now / 86_400_000)`; `(days − (days + 3) % 7) × 86_400_000` (day 0 was a Thursday, so Monday is `days − (days + 3) % 7`).
- PR 2, `advanceBoss(now)`: runs at the start of `world`, `leaderboards`, `sweep` and `submit` (after authentication, before the replay). When `flags['worldboss.enabled']` is false it does nothing. `gridIndex = floor(now / BOSS_GRID_MS)`, `spawnAt = gridIndex × BOSS_GRID_MS`, `bossId = 'wb' + gridIndex.toString(36)`. If `now < spawnAt + BOSS_WINDOW_MS` and the stored record's `bossId !== bossId`: spawn: `online = max(1, presence entries inside the TTL)`, `maxHp = hp = BOSS_BASE_HP × online`, `name`/`glyph` from `WORLD_BOSSES[gridIndex % length]`, `contributions = {}`, `closed: false`; then engage every online current account (`author` `boss_engaged` with `stats = scale(content.enemies[content.zones[0].boss].stats, WORLD_BOSS_STAT_BP)`, each stat `floor(v × bp / 10000)`, at least 1). If a stored record is open (`!closed`) and `now >= endsAt` with `hp > 0`: expire: `settleBoss(record, expired: true)`. A record whose window passed stays stored, closed, until the next spawn overwrites it, so the snapshot answers `boss: null`.
- PR 2, contribution in `submit` step 9: `prev = record.state.boss`, `next = result.boss`; if both are set with the same `bossId`, that is the stored record's `bossId`, the record is open, `hp > 0` and `now < endsAt`: `delta = next.dealt − prev.dealt`; `hp = max(0, hp − delta)`; `contributions[accountId] += delta`; `week.damage[accountId] += delta` (name refreshed); if `hp === 0`: `settleBoss(record, expired: false)`. Ticks committed after the end or after the kill count for nothing (the condition fails). The killing commit's own ack carries the contributor's `rewarded` and `boss_disengaged` in its delivery, since `author` runs before `deliveryOf(record)` is built; the commit happens either way.
- PR 2, `settleBoss(boss, expired)`: `threshold = floor(BOSS_BASE_HP × BOSS_THRESHOLD_BP / 10000)` (400); `top = the BOSS_TOP_BONUS highest contributions > 0, ties by account id`. For every account in `contributions` (offline ones included): load the record; if current, `rolls = (contribution >= threshold ? 1 : 0) + (!expired && account in top && contribution >= threshold ? 1 : 0)`; for each roll: `item = rollRewardItem(seedSource(), record.state.zone, party classes of record.state)` with its `id` replaced by `nextLedgerId(kv, 'r')` (`ids.ts` prefix union gains `'r'`), `gold = 3 × content.rarity[item.rarity].vendorGoldPerZone × record.state.zone` (the sim's own valuation of a boss roll at a zone, `heroes.ts:68`); if `hasRoom` → `author(record, rewarded { bossId, goods: { kind: 'item', item }, gold })`, else push `{ listingId: bossId, goods }` to `returns`, `syncReturnsQueue`, and `author(rewarded { bossId, goods: null, gold })`; then `author(record, boss_disengaged { bossId })` for every engaged account, after its rewards; save each record; `closed = true`; save the boss.
- `config()` resolves all six flags: `{ 'market.enabled': true, 'chat.enabled': true, 'worldboss.enabled': true, 'presence.enabled': true, 'leaderboards.enabled': true, 'maintenance': false, ...options.flags }`.

### `@promptfall/sim` export added in PR 2

```ts
/** A boss-rarity item of the zone for a party of these classes, drawn from `seed` alone. `id` is '' for the caller to replace. */
export function rollRewardItem(seed: number, zone: number, classes: readonly HeroClass[]): Item | null
```

The draw order of ordinary drops (`rollItem`, `loot.ts:13-37`) must not change; internal structure is the implementer's (a scratch state built from `createInitialState(seed)` with `zone` set and a party of the given classes is acceptable). The result has `tradeableAt: null`, `equippedBy: null`.

### `servers/fake` additions

CLI: `--flag <name>=<value>`, repeatable (`parseArgs` with `multiple: true`); `name` must be one of the six `LedgerFlag` names and `value` one of `true`, `false`; anything else exits 2 naming the six. The startup line gains ` flags <name>=<value>,...` listing only the flags passed. Defaults: nothing passed, so every flag resolves to the ledger's default. The bots get `baseUrl = http://127.0.0.1:<port>` after `listen`. `servers/fake/src/node-fetch.ts` holds `nodeFetch` (moved from `test-support.ts`, which re-exports it).

Bots (`bots.ts`):

```ts
export type BotOptions = {
  client: ServerClient                  // the HttpClient over the fake's own port
  host: Pick<LedgerHost, 'mint' | 'credit'>
  kv: KeyValue                          // pf:bot:<i> only
  seed: number; count: number; speed: number
  schedule: (ms: number, fn: () => void) => { cancel(): void }
  newBatchId?: () => string             // default randomUUID
  log?: (line: string) => void
}
```

Each `tick()` acts for one bot, round robin, and the scheduler interval is `BOT_TICK_MS / count / speed` real ms, so every bot acts once per `BOT_TICK_MS` virtual ms (the phase 2 interval was per tick, so each bot acted once per 240 s; a heartbeat every 240 s would be offline). A bot's act: (1) `client.world(auth, chatMark)` (the heartbeat; the chat tail is read and the mark advanced, nothing else); (2) build `BATCH_TICKS_MIN + roll(BATCH_TICKS_SPREAD)` ticks, a `tool_call` before every `TOOL_CALL_EVERY`th tick, a `turn_end` at the end of every `TURN_END_EVERY_BATCHES`th batch, a `rest` at the start of every `REST_EVERY_BATCHES`th; `client.submit(mirror.batch(events), auth)`: `ok` → `mirror.commit(events); mirror.receive(ack.delivery)`; `cursor_behind` → `mirror.receive(ack.delivery)` and resubmit with the new cursor, once; a state-carrying refusal → `mirror.adopt(ack)`; a thrown call → log and end the act; (3) if `mirror.local.gold < STIPEND_FLOOR` → `host.credit(accountId, STIPEND, 'bot_stipend')` (the `credited` event reaches the mirror in the next ack); (4) one weighted action: `list` 4, `buy` 3, `order` 2, `fill` 2, `cancel` 1, `chat` 0 (chat is on its own cadence: every `CHAT_EVERY_TICKS`th act of a bot posts `BOT_LINES[roll]` through `client.chat`); `fill`: for up to 3 of the bot's Rare+ unequipped out-of-cooldown items, `client.matchingOrders(auth, itemId)`; accept the first with `client.fillOrder`. Every refusal is logged at debug level and ignored. At start, for each `i < count`: read `pf:bot:<i>`; mint when absent; bootstrap with the token; if `boot.state.v !== SIM_VERSION`, mint again and overwrite `pf:bot:<i>` (a phase 2 snapshot under `SIM_VERSION` 3: the old record stays orphaned in the snapshot, which the manual pass avoids by starting from a fresh `--data`); `mirror = new Mirror(boot, { newBatchId })`.

`bot-config.ts` gains: `BATCH_TICKS_MIN = 4`, `BATCH_TICKS_SPREAD = 3`, `TOOL_CALL_EVERY = 3`, `TURN_END_EVERY_BATCHES = 2`, `REST_EVERY_BATCHES = 4`, `CHAT_EVERY_TICKS = 6`, `BOT_LINES` (12 short lines, no blocklisted word), `ACTION_WEIGHTS = { list: 4, buy: 3, order: 2, fill: 2, cancel: 1 }`. `BOT_TICK_MS = 20_000` keeps its value with a new comment: virtual ms between one bot's acts.

Budgets check: a bot submits at most 6 ticks per 20 virtual s against a bucket refilling one tick per 2 s (`BUDGETS`, `client.ts:102-107`): 10 refills per interval, never capped. One `turn_end` per 40 s and one `rest` per 80 s against one per 5 s: never capped.

### Plugin world-poll contract (`plugins/promptfall/hooks/world.ts`)

```ts
export const WORLD_POLL_MS = 15_000
export const WORLD_POLL_FAST_MS = 5_000
export const WORLD_STALE_MS = 45_000
/** The Chat tab counts as open for this long after its last render; each render of the tab refreshes it. */
export const CHAT_TAB_HOT_MS = 20_000

// The atom `world` (types/index.d.ts, PluginState.promptfall.world), published by the poller:
export type WorldState = {
  snapshot: WorldSnapshot | null
  fetchedAt: number | null       // client clock of the last fresh snapshot
  stale: boolean                 // true once WORLD_STALE_MS passed since fetchedAt without a fresh one
  messages: ChatMessage[]        // the client's chat buffer, at most 200, ascending id
  chatMark: number               // the id of the last message held; sent as `since`
  clock: { serverNow: number; clientNow: number; speed: number } | null   // from the snapshot and the last ServerConfig seen
  /** PR 2: what this party had committed for the live boss when the snapshot arrived, for the predicted bar. */
  committedDealt: { bossId: string; dealt: number } | null
}
```

- The poller belongs to `GameSession`, not the engine: secondaries poll too. It polls with the stored device token (as `read()` does, `register.tsx:314-323`) through `server.client.world(auth, chatMark)`, never under the engine lock. It starts with one poll when the session becomes primary or secondary and after every `restart`, then on an `io.every` timer it re-arms whenever the cadence changes, as `setCadence` does.
- Cadence: `WORLD_POLL_FAST_MS` while `snapshot.boss !== null` or `now − chatSeenAt < CHAT_TAB_HOT_MS`, else `WORLD_POLL_MS`. The dialog calls `game.chatSeen(now)` from every render of the Chat tab; a visible Chat tab redraws on each poll (it reads the `world` atom), so the fast cadence sustains itself while the tab is shown and drops within 20 s of the pane closing. No pane-close hook is relied on.
- A successful poll: `snapshot`, `fetchedAt = now`, `stale = false`, append the messages with `id > chatMark` (cap 200, oldest dropped), `chatMark = last id`, `clock`, and (PR 2) `committedDealt` from `engine.committedBoss()` on the primary (null on a secondary). Then (PR 2) the toasts on transitions and the sync trigger (Task 11). Publish once. A stale timer (`io.after(WORLD_STALE_MS)`) marks `stale: true` unless a fresher poll landed since (generation counter, as the engine's notices do).
- A thrown poll (unreachable, timeout, 5xx, bad body, `unauthorized` answer) is ignored: no outage, no notice, the next poll on the same cadence. Only `submit` and `bootstrap` enter the outage (`engine.ts`), unchanged.
- Posting: `game.chat(text)` calls `server.client.chat(auth, text)` with the stored token, from any session, with no flush and no lease. A thrown call surfaces as `Server unreachable` (`errorText`, `ui/trade.ts`); a refusal as its text. On `ok` the message is appended to `messages` at once and `chatMark` advanced, so it shows before the next poll.
- Reads: `game.leaderboards()` calls `server.client.leaderboards(auth)` the same way.
- Session memory: `GameSession` keeps `lastConfig: ServerConfig | null`, set from the engine's `serverConfig()` after `start`/`sync` and from a secondary's `refresh()`; the poller's `clock.speed` comes from it (1 when unknown).
- A server switch or a reset (`restart`) drops the poller's state (`world` atom back to its default) and polls afresh.

The in-process host (`plugins/promptfall/hooks/server.ts`) constructs the `Ledger` with `flags: { 'chat.enabled': false, 'worldboss.enabled': false }`; presence and leaderboards stay on, so the snapshot there reads one online and the boards hold the one account.

### Tuning numbers and their working

| Number | Value | Where | Why |
| --- | --- | --- | --- |
| World poll | 15 s / 5 s | `world.ts` | the flush cadence (`register.tsx:78`); 5 s keeps a 20-minute boss and a chat tab live enough without a stream (record Q1, Q20) |
| Stale marker | 45 s | `world.ts` | three missed polls at the slow cadence, equal to the presence TTL |
| Presence TTL | 45 s real | `world-config.ts`, scaled by `speed` in the ledger | three slow polls; at `--speed 10` the player polls every 150 virtual s, so the TTL must follow real time or the player flickers offline between polls |
| `here` names | 10 | `world-config.ts` | one band row |
| Chat length | 200 | `world-config.ts` | spec §6 |
| Chat bucket | 5, one per 10 s | `world-config.ts` | spec §6 |
| Chat history | 200 kept, 50 served | `world-config.ts` | spec §6; 50 messages of 200 characters plus names is under 15 KB cold, within the 15 s fetch budget by a wide margin |
| Board rows | 20 | `world-config.ts` | spec §6 |
| Boss grid, window | 3 h, 20 min | `boss-config.ts` | spec §6 |
| Threshold | 500 bp of base | `boss-config.ts` | spec §6: 5% of `BOSS_BASE_HP` = 400 damage, about 30 idle ticks for a day-one party (below) |
| Top bonus | 3 | `boss-config.ts` | spec §6 |
| Boss stats | 10000 bp of zone 1's zone boss | `boss-config.ts` | hits like the party's own zone boss after the sim's per-zone scaling; a wipe heals in place, so a stronger boss would only loop heals |
| Bot batch | 4 to 6 ticks per 20 s | `bot-config.ts` | 0.2 to 0.3 ticks per second, an idle human's 5 s cadence (record Q6) |
| Bot chat | one line per 6 acts | `bot-config.ts` | 12 bots at 20 s: a line every 10 s virtual, a readable ticker without drowning players |

`BOSS_BASE_HP = 8000`, derived from the sim's combat numbers. Damage per hit is `max(1, floor(atk × v / 10000) − floor(def / 2))` with `v` uniform in `[9000, 11000]` (`combat.ts:7-10`), so the mean is `atk − floor(def / 2)`. The world boss's def at a party's zone equals that zone's zone boss def (the scaling rule above). The reference party is the spec's pace target (§4.2): the balance harness's 8-hour day (`packages/sim/src/harness/harness.test.ts`, `seed 7, activeShareBp 6000, toolCallEverySec 8, turnLengthSec 90`), replayed with the harness's equip habit, measured on this tree:

| Party | Zone, levels | Zone boss atk/def (`content/enemies.ts`) | Expected damage per tick |
| --- | --- | --- | --- |
| fresh (`createInitialState`) | 1, L1/1/1 | 14 / 4 | 14 |
| 8 h, seeds 7 and 11 | 3, L8/8/8 | 38 / 8 | 59 and 55 |
| 40 h, seeds 7 and 11 | 3, L15/15/15 | 38 / 8 | 92 and 89 |
| 120 h, seed 7 | 5, L20/20/20 | 72 / 16 | 106 |

Per tick: knight `atk − def/2`, black mage `floor(atk × 0.6) − def/2` (`combat.ts:40`), white mage counted at half (she heals when anyone is under 70%, `combat.ts:61`), all three alive (R1 keeps them alive). The reference party deals about 57 per tick. Normal ticking is the idle cadence, one tick per 5 s (`register.tsx:77`): 144 ticks in 12 minutes, `57 × 144 = 8208`, rounded to `8000`. Checks: in a turn (2 s) the same party needs 4.7 minutes; a fresh party alone needs 48 minutes and never kills it, but passes the 400 threshold in 29 idle ticks (2.4 minutes); a 40-hour party needs 7.5 idle minutes. With the fake's 12 bots online (zone 2 to 3 after `rollBotState`, about 30 to 55 per tick, 0.25 ticks per second each) plus one reference player: HP `13 × 8000 = 104 000` against about `12 × 11 + 11 = 143` damage per second, dead in about 12 minutes. The number is tuning: change it in `boss-config.ts` only.

## Task list

PR 1: Tasks 1 to 7. PR 2: Tasks 8 to 12.

### Task 1: Protocol: world types, routes, HttpClient, Mirror

**Files:**
- `packages/protocol/src/world.ts` (create): the types and Zod schemas under "`@promptfall/protocol` additions"
- `packages/protocol/src/client.ts` (modify): the three `ServerClient` methods
- `packages/protocol/src/http.ts` (modify): the three routes; `world(auth, since)` sends `query: { since }`; `chat` sends `{ text }`
- `packages/protocol/src/responses.ts` (modify): `WorldResponseSchema`, `BoardsResponseSchema`, re-export `ChatResultSchema`
- `packages/protocol/src/mirror.ts` (create): `Mirror` as described, moved from the suite
- `packages/protocol/src/contract/suite.ts` (modify, mechanically): import `Mirror` from `../mirror`, pass `{ newBatchId: () => crypto.randomUUID() }`; no rule changes here
- `packages/protocol/src/index.ts` (modify): export `world.ts` and `Mirror`
- `packages/protocol/src/http.test.ts` (modify): one test per new method asserting method, path, query (`since=12`), auth header and body; a `ChatResult` refusal passes through as a value; a snapshot body missing `flags` is `ServerError`

**Interfaces:**
- Consumes: today's protocol.
- Produces: `WorldSnapshot`, `ChatMessage`, `ChatResult`, `ChatRefusal`, `BossView`, `Boards`, `BoardRow`, their schemas, `ServerClient.world|chat|leaderboards`, `ROUTES.world|chat|leaderboards`, `Mirror`.

**Work:** Schemas are the contract on both ends; `HttpClient` parses each new response with its schema. No platform globals in `world.ts`, `mirror.ts` or `http.ts`. `BossView` is defined in full now so PR 2 adds no protocol shape for the snapshot.

**Acceptance check:** `pnpm --filter @promptfall/protocol test` green; `pnpm exec tsc -b packages/protocol` clean. Red before: `http.test.ts` cannot find `world` on `HttpClient`. Expected red elsewhere after this task: `pnpm typecheck` fails in `packages/ledger` (the ledger does not implement the new methods) until Task 2.

**Boundaries:** No ledger logic. Do not touch `servers/fake` or the plugin. Do not add a contract rule here.

- [ ] `world.ts` with types and schemas; `ServerClient`, `ROUTES`, `responses.ts`
- [ ] `mirror.ts`; the suite imports it; `pnpm --filter @promptfall/protocol test` still green
- [ ] `http.test.ts` red for the three methods, then `http.ts` green; commit `feat(protocol): world snapshot, chat, leaderboards, Mirror in the package root`

### Task 2: Ledger: presence, chat, leaderboards, flags, blocklist; contract rules 25 to 32

**Files:**
- `packages/ledger/src/world-config.ts` (create), `packages/ledger/src/blocklist.ts` (create): as under "`@promptfall/ledger` additions"
- `packages/ledger/src/world.ts` (create): presence, `world`, `chat`, `leaderboards`, `offerZone`, `weekStartOf`, over a `WorldContext = { books, now, flags, presence: Map, ttl }`
- `packages/ledger/src/ledger.ts` (modify): `LedgerFlag`, `presenceTtlMs`, the six resolved flags, the three public methods, `offerZone` in `submit` step 9 and `mint`
- `packages/ledger/src/books.ts` (modify): `AccountRecord.chat?`; `publicName(record)`
- `packages/ledger/src/market.ts` (modify): `nameOf` uses `publicName`
- `packages/ledger/src/index.ts` (modify): export the config constants, `isBlocked`, `BLOCKED_WORDS`
- `packages/ledger/src/world.test.ts` (create): `weekStartOf` on a Monday 00:00 UTC, one ms before it, and a Thursday; `isBlocked` whole-word (`heckle` passes, `Heck!` refuses); the bucket's whole-period refill; `offerZone` keeps 20 rows and replaces a lower row of the same account; a blocked display name reads `adventurer` in a listing's `sellerName`
- `packages/protocol/src/contract/suite.ts` (modify): rules 25 to 32 below
- `packages/ledger/src/ledger.contract.test.ts` (modify): nothing, unless the runner needs `presenceTtlMs`

**Interfaces:**
- Consumes: Task 1.
- Produces: the social half of `ServerClient` on the in-process host; `publicName`; the storage keys.

**Work:** Contract rules, each run against both hosts through `make` (the HTTP runner passes rules 25 to 32 only after Task 3):

- rule 25, presence: two minted linked traders A and B (`host.mint`, names `Ashgrove`, `Brindle`). A polls with `since 0`: `online 1`, `zones [{ zone: 1, count: 1 }]`, `here []`. B polls: `online 2`, `here ['Ashgrove']`. `clock.advance(45_000)`; B polls: `online 1`, `here []` (A expired; the TTL is open at the far end). A second account's two sessions are one entry: A polls twice, B's `online` is still 2.
- rule 26, chat gates: an unlinked account gets `not_linked`; with `{ 'chat.enabled': false }` a linked one gets `chat_closed`, the snapshot's `flags['chat.enabled']` is `false` and its `chat` is `[]`.
- rule 27, length: 201 characters `too_long`; 200 `ok`; `'   '` `empty`; `'  hi  '` is stored as `hi`; the answer's `message` equals the next poll's last message.
- rule 28, rate: five posts `ok`, the sixth `rate_limited`; `clock.advance(10_000)` allows one more; `clock.advance(50_000)` allows five.
- rule 29, blocklist: `'what the heck'` is `blocked` and the history is unchanged; a trader minted with the name `heck` posts as `adventurer` and shows in `here` as `adventurer`.
- rule 30, history: 60 messages (five, advance 50 s, repeat) then a poll with `since 0` answers the last 50 ascending; `since` = the 55th id answers the 5 newer ones; 210 messages in total: `since 0` answers ids 161 to 210, and `since 1` answers the same 200 kept.
- rule 31, highest zone: A is minted with `highestZone 5` and commits a tick; `leaderboards()` lists A first with `value 5`, then B with 1; 25 minted accounts at zones 2 to 26 leave 20 rows and B out; with `{ 'leaderboards.enabled': false }` both lists are `[]`; a blocked name reads `adventurer`; `weekStart` equals `weekStartOf(clock)`.
- rule 32, presence off: with `{ 'presence.enabled': false }` a poll answers `online 0`, `zones []`, `here []`, `flags['presence.enabled'] false`, and a second account sees nobody.

**Acceptance check:** `pnpm --filter @promptfall/ledger test` green with rules 0 to 32 and `world.test.ts`; `pnpm exec tsc -b packages/ledger` clean. Red before: the ledger does not compile against Task 1's `ServerClient`.

**Boundaries:** No boss code (PR 2). No HTTP routes. No plugin. `pf:chat` and `pf:boards` are the only new keys.

- [ ] `world-config.ts`, `blocklist.ts`, `publicName`; `world.test.ts` red then green
- [ ] Presence, `world()`, flags; rules 25 and 32 red then green over the in-process host
- [ ] Chat; rules 26 to 30
- [ ] Boards, `offerZone` in `submit` and `mint`; rule 31; commit `feat(ledger): presence in memory, chat with a blocklist and a bucket, leaderboards, phase 3 flags`

### Task 3: HTTP fake: the three routes and `--flag`

**Files:**
- `servers/fake/src/server.ts` (modify): handlers `world` (query `since`: absent → 0, `/^\d+$/` → number, else 400), `chat` (`ChatBodySchema`), `leaderboards`
- `servers/fake/src/cli.ts` (modify): `--flag`, the startup line, `presenceTtlMs` left to the ledger's default
- `servers/fake/src/node-fetch.ts` (create), `servers/fake/src/test-support.ts` (modify): move `nodeFetch`
- `servers/fake/src/server.test.ts` (modify): `since=abc` is 400; `since` absent works; the three bodies pass their schemas; a `parseFlags` unit test (`['chat.enabled=false']` → `{ 'chat.enabled': false }`; `bogus=true` and `chat.enabled=maybe` throw) over a function exported from `cli.ts`'s new sibling `servers/fake/src/flags.ts`
- `servers/fake/src/flags.ts` (create): `parseFlags(values: string[]): Partial<Record<LedgerFlag, boolean>>`

**Interfaces:**
- Consumes: Tasks 1 and 2.
- Produces: the routes over HTTP; `parseFlags`.

**Work:** The router and status rules are phase 2's (`server.ts:142-164` handler table). `parseFlags` is pure so the CLI stays untested as a process.

**Acceptance check:** `pnpm --filter @promptfall/fake-server test` green: rules 0 to 32 over HTTP plus `server.test.ts`. Then `pnpm fake --port 7777 --data /tmp/pf-p3.json --flag chat.enabled=false --bots 0` prints the startup line ending in `flags chat.enabled=false`, and `curl -s 'localhost:7777/v1/world' -H 'authorization: Bearer <token from a bootstrap curl>'` answers a snapshot whose `flags` has `"chat.enabled":false`; stop it; paste both in the commit body. Red before: rules 25 to 32 are 404 over HTTP.

**Boundaries:** No bot changes (Task 4). No plugin.

- [ ] `flags.ts` with its test; `--flag` in the CLI
- [ ] Routes; `server.test.ts`; the suite green over HTTP; run the acceptance check; commit `feat(fake-server): world, chat and leaderboards routes; --flag`

### Task 4: Bots as HTTP clients

**Files:**
- `servers/fake/src/bots.ts` (modify): the design under "`servers/fake` additions"
- `servers/fake/src/bot-config.ts` (modify): the new constants, `fill` in the weights, `BOT_LINES`
- `servers/fake/src/cli.ts` (modify): construct `new HttpClient({ baseUrl, fetch: nodeFetch })` after `listen`; pass `host: server.ledger.host`; the scheduler interval
- `servers/fake/src/bots.test.ts` (modify): every case runs over a listening `createFakeServer` on port 0 (as `server.contract.test.ts` does) with a manual clock; keep the population and determinism cases; replace the phase 2 assertions with: after 36 ticks (three rounds of 12 bots) every bot's committed `seq` is at least 3 and its `tick` counter rose; the snapshot from a viewer account reports `online 12` and at least two zones; the chat history holds lines from at least two bot names; after 120 ticks there are listings of both kinds, at least one order, at least one sale, and at least one `order_filled` in some bot's committed loot log (a `fill`); bots never call `host.settle` (the test wraps `host` and asserts)
- `servers/fake/src/bot-seed.ts`: unchanged

**Interfaces:**
- Consumes: `HttpClient`, `Mirror`, `LedgerHost.mint|credit`, the routes of Task 3.
- Produces: bots that heartbeat, batch, trade, fill and chat over HTTP.

**Work:** The mirror is the bot's whole client state; it never reads the ledger or the store beyond `pf:bot:<i>`. The seeded xorshift per bot stays; all draws (batch size, action, line) come from it so a seed repeats. On a thrown call the act ends and the next tick retries from the mirror as it is (a lost ack is answered `duplicate` or `seq_mismatch` and adopted; both are handled). `fill` needs no prior `matchingOrders` cache: it asks per item.

**Acceptance check:** `pnpm --filter @promptfall/fake-server test` green with the new `bots.test.ts`. Then `pnpm fake --port 7777 --speed 10 --data /tmp/pf-bots3.json` and after 60 seconds `curl -s 'localhost:7777/v1/world' -H 'authorization: Bearer <token>' | head -c 600` shows `"online":12` (or 13 with the viewer) and chat lines with bot names; paste it in the commit body. Red before: `bots.test.ts` cannot construct `startBots` with `client`.

**Boundaries:** Bots use `host.mint`, `host.credit` and `HttpClient` only; no `ledger.*` call, no `kv` write but `pf:bot:<i>`. No plugin changes. No boss logic.

- [ ] `bot-config.ts`; `bots.ts` over `client` and `Mirror`; the batch and heartbeat cases red then green
- [ ] Market actions with `fill`, chat lines, stipend, re-mint on an old sim version; the rest of the test; CLI wiring
- [ ] Run the acceptance check; commit `feat(fake-server): bots are HTTP clients that batch, fill, chat and heartbeat`

### Task 5: Plugin: the world poll, the World tab, in-process flags

**Files:**
- `scripts/vendor.mjs` (no change expected; run `pnpm vendor`): the bundles carry `world.ts`, `mirror.ts`, `blocklist.ts`
- `plugins/promptfall/hooks/world.ts` (create): `WorldPoller` per the contract; `WORLD_DEFAULT: WorldState`
- `plugins/promptfall/hooks/state.ts` (modify): `WORLD_DEFAULT`, `CHAT_DEFAULT` (Task 6 uses it)
- `plugins/promptfall/types/index.d.ts` (modify): `WorldState`, `PluginState.promptfall.world: WorldState`, `AccountView` gains `chatOpen: boolean`, `presenceOpen: boolean`, `leaderboardsOpen: boolean`, `bossOpen: boolean` from the flags
- `plugins/promptfall/hooks/register.tsx` (modify): the `world` atom in both `Io.publish` literals (session.start and session.attach, `register.tsx:516-530` and `566-580`); `GameSession` owns the poller (start, cadence, restart, `chatSeen`, `chat`, `leaderboards`, `lastConfig`); `GameHandle` gains `chatSeen(now)`, `chat(text): Promise<ChatResult>`, `leaderboards(): Promise<Boards | Unauthorized>`
- `plugins/promptfall/hooks/engine.ts` (modify): `GameHandle` type additions; `serverConfig()` already exists
- `plugins/promptfall/hooks/server.ts` (modify): the in-process `Ledger` gets `flags: { 'chat.enabled': false, 'worldboss.enabled': false }`
- `plugins/promptfall/hooks/view.ts` (modify): `toAccountView` reads the four flags
- `plugins/promptfall/hooks/ui/band.tsx` (modify): the World tab's three rows per record §1.10: (1) `${online} online · zone ${zone}: ${here.join(', ')}`, `nobody else here` when `here` is empty, `presence is off` when the flag is off, dim when `stale`; (2) `highest zone N · kills K · wipes W` (the boss line is Task 11); (3) the chat ticker `${name}: ${text}` from the last message held, `chat is quiet` when none, `chat is closed` when the flag is off. The line `Multiplayer arrives in phase 2` goes. Without a snapshot yet, row 1 reads `connecting to the world…` dim.
- `plugins/promptfall/hooks/band.test.ts` (modify): the World tab shows `1 online` and `chat is closed` on the in-process host; a stale snapshot dims row 1
- `plugins/promptfall/hooks/register.test.ts` (modify): against `/promptfall server http://test` with `on('http.fetch')` answering a bootstrap and canned snapshots: a poll goes out within 15 s of start and every 15 s after (`GET /v1/world?since=0`, then `since=<last id>`); the `world` atom holds the snapshot and the messages; a snapshot with `boss` non-null switches the period to 5 s and `boss: null` switches it back (assert through the recorded `clock.every` periods); a throwing world fetch sets no notice and leaves the band ticking; after 45 s without a success `stale` is true and the next success clears it; a secondary session polls too (two sessions, the second with `mode secondary`, both fetch `/v1/world`); `/promptfall server local` resets the atom; the in-process host's snapshot has `flags['chat.enabled'] === false`
- `plugins/promptfall/hooks/golden.test.ts`: unchanged (no sim change)

**Interfaces:**
- Consumes: Tasks 1 and 2 through the vendor bundles.
- Produces: the `world` atom, `GameHandle.chatSeen|chat|leaderboards`, the World tab rows, the in-process flags.

**Work:** Follow the world-poll contract verbatim for cadence, failure handling, chat buffering and the stale rule; the poller's internal layout is yours. The band's World tab reads the `world` atom beside `view`; the band module declares the atom with `WORLD_DEFAULT` (the validate scan reads atoms where they are declared, see `hooks/state.ts`'s comment). `toAccountView` gains the four booleans so the dialog gates read from the view as `marketOpen` does.

**Acceptance check:** `pnpm vendor && pnpm vendor:check` clean; `claude plugin validate plugins/promptfall` lists the same `$` calls as phase 2 and no new namespace; `claude plugin test plugins/promptfall` green including the new register and band tests; `pnpm exec tsc -p plugins/promptfall` clean. If `claude plugin test` refuses with "hooks modules are turned off ... rollout switch", start `claude` once with network access and run it again. Red before: the plugin does not type-check against Task 1's `ServerClient` (the `Ledger` bundle and `HttpClient` changed).

**Boundaries:** No dialog tabs (Task 6). No boss display. No change to the lease, the flush path or the outage rules.

- [ ] `pnpm vendor`; mechanical type fixes; `server.ts` flags; `toAccountView` flags
- [ ] `world.ts`, the `world` atom in both `Io` literals, `GameSession` wiring; `register.test.ts` red then green for cadence, failures, stale, secondary
- [ ] World tab rows; `band.test.ts`; run the acceptance check; commit `feat(plugin): world poll, World tab presence and chat ticker, in-process flags`

### Task 6: Plugin: Chat and Leaderboards tabs, commands, README

**Files:**
- `plugins/promptfall/types/index.d.ts` (modify): `DialogTab` adds `'chat' | 'leaderboards'`; `ChatState = { busy: boolean; error: string | null; composeKey: number }`; `BoardsState = { boards: Boards | null; busy: boolean; error: string | null }`; `PluginState.promptfall.chat`, `.boards`
- `plugins/promptfall/hooks/state.ts` (modify): `CHAT_DEFAULT`, `BOARDS_DEFAULT`
- `plugins/promptfall/hooks/ui/chat.tsx` (create): `chatBody(els, view, world, chat, now, actions)`; `postChat(game, text, updChat, after)`
- `plugins/promptfall/hooks/ui/leaderboards.tsx` (create): `boardsBody(els, view, world, boards)`; `loadBoards(game, updBoards, after)`
- `plugins/promptfall/hooks/ui/dialog.tsx` (modify): tabs `c` Chat and `b` Leaderboards appended to `TABS` (`dialog.tsx:37-44`); `openTab('leaderboards')` calls `loadBoards`; the Chat tab render calls `game.chatSeen(now)`
- `plugins/promptfall/hooks/command.ts` (modify): `chat`, `leaderboards` args; the argument hint; opening on `leaderboards` loads the boards as `market` loads listings
- `plugins/promptfall/hooks/register.tsx` (modify): the `chat` and `boards` atoms in both `Io.publish` literals; `clearDialog`/`restart` reset them
- `plugins/promptfall/hooks/ui/trade.ts` (modify): `GATE_CHAT_CLOSED = 'Chat is closed.'`, `GATE_BOARDS_CLOSED = 'Leaderboards are closed.'`; `chatRefusalText(reason)`: `too_long` → `Too long: 200 characters at most`, `rate_limited` → `Slow down: 5 messages per 50 seconds`, `blocked` → `That word is not allowed here`, `empty` → `Nothing to send`, `not_linked` → `GATE_UNLINKED`, `chat_closed` → `GATE_CHAT_CLOSED`, `unauthorized` → `Playing in another session`
- `plugins/promptfall/hooks/dialog.test.ts` (modify): against `/promptfall server http://test` with canned bodies: the Chat tab lists the held messages newest at the bottom and shows the compose input on terminal and desktop; Enter posts `POST /v1/chat` with `{ text }` and the message appears before the next poll; a `too_long` refusal flashes `Too long: 200 characters at most` for 5 s; a throwing chat fetch flashes `Server unreachable` and sets no band notice; with `flags['chat.enabled'] false` the tab reads `Chat is closed.` and has no input; unlinked reads `GATE_UNLINKED`; without an `Input` element (a surface whose `$.ui.resolve` table lacks it, as the market tests simulate mobile) the tab is read-only with the line `Posting needs a terminal or the desktop app.`; a secondary session can post; the Leaderboards tab fetches `GET /v1/leaderboards` on open, lists the zone counts from the snapshot, the two lists, and highlights the row whose `accountId` is the session's; closed reads `Leaderboards are closed.`; `/promptfall chat` and `/promptfall leaderboards` open on those tabs
- `plugins/promptfall/README.md` (modify): commands table (`chat`, `leaderboards`), the hotkeys table (`c`, `b` in the dialog column), a "World" section (World tab rows, Chat tab rules and refusals, Leaderboards tab), "What it lacks" rewritten (no world boss yet in PR 1; sprites and sound; mute and ban)

**Interfaces:**
- Consumes: Task 5's handle and atom.
- Produces: the phase 3 dialog tabs.

**Work:** Chat tab: the messages the pane fits (the pane opens with `rows: 20`; show the last 14 of `world.messages`, each `name: text` clipped to the width, dim names), newest at the bottom; below them the compose `Input` with `submitLabel="send"`, `onSubmit(text)` → `postChat`, which refuses an empty trimmed text locally with the `empty` flash and otherwise calls `game.chat(text)`; on `ok`, `composeKey += 1` so the input remounts empty (executor step below), on a refusal `flash(updChat, after, chatRefusalText(reason))`, on a throw `flash(errorText(error))`. The gate line (`GATE_CHAT_CLOSED` from `view.account.chatOpen`, else `GATE_UNLINKED` from `view.account.linked`) stands in place of the input; the messages still show. Mobile (no `Input`): the read-only line. Leaderboards tab: `Online by zone: z1 3 · z2 6 · z3 4` from `world.snapshot.zones` (or `nobody online` / `presence is off`), then `Highest zone` rows `rank. name  zone N`, then `Boss damage this week` rows `rank. name  N` (`no boss damage yet this week` when empty), your row in cyan; `busy` shows `loading…`; errors flash as the market's do. Both tabs read `world` for the snapshot and never poll themselves.

**Acceptance check:** `pnpm vendor:check` clean; `claude plugin validate plugins/promptfall` unchanged; `claude plugin test plugins/promptfall` green with the extended dialog tests; `pnpm exec tsc -p plugins/promptfall` clean. Red before: `dialog.test.ts` cannot find the Chat tab.

**Boundaries:** No band change. No boss. No new `$` namespace. The chat path never calls `trade` or `sync`.

- [ ] Read `Input` in the engine d.ts (`plugins/promptfall/.claude-plugin/types/claude-code/index.d.ts`, the terminal elements around E:3594-3660): does it take a `value` prop that resets it? If yes, clear through it after a post and drop `composeKey`; if not, remount with `key={`compose-${chat.composeKey}`}`. Write the finding in the commit body.
- [ ] Types, atoms, tabs, command args; `dialog.test.ts` red for the Chat tab
- [ ] `chat.tsx` with the compose, the flashes, the gates, mobile; `chatSeen` from the render
- [ ] `leaderboards.tsx`; README; run the acceptance check; commit `feat(plugin): Chat and Leaderboards tabs, /promptfall chat|leaderboards`

### Task 7: PR 1: docs, manual pass part A, pull request

**Files:**
- `docs/manual-pass/phase-3.md` (create): part A below; part B is Task 12's
- `README.md` (modify): status paragraph (phase 3 PR 1 built: presence, chat, leaderboards, bots over HTTP), the fake's line mentions `--flag`

**Work:** Manual pass part A, in `docs/manual-pass/phase-2.md`'s voice (numbered steps, what Kevin should see, a red is anything else; two terminals, 100 columns; focus is reverse video; Tab cycles the dialog's tabs, then the body buttons, then close; a focused `Input` takes every printable key, so press Tab or click out of the compose box before typing a tab hotkey; the pane holds toasts until Esc):

1. **Start the fake.** `pnpm fake --port 7777 --player-name <your name>`: the startup line, now with no `flags` suffix.
2. **Play on it.** `claude --plugin-dir plugins/promptfall`, `/promptfall server http://127.0.0.1:7777`, link in the Account tab (phase 2 part A steps 2 and 5).
3. **World tab.** Press `w` on the band within 15 seconds: row 1 reads `13 online · zone 1: …` with the names of bots in zone 1 or `nobody else here`; row 2 `highest zone 1 · kills … · wipes …`; row 3 a bot's chat line within a minute, `chat is quiet` before.
4. **Chat.** `/promptfall chat`: the last messages, newest at the bottom, bot lines arriving every few seconds; type `hello` and Enter: your line appears at once with your name. Paste a 201-character line: `Too long: 200 characters at most` in red for 5 seconds, nothing posted. Send six short lines quickly: the sixth reads `Slow down: 5 messages per 50 seconds`. Send `what the heck`: `That word is not allowed here`.
5. **Leaderboards.** Press `b`: `Online by zone` with counts summing to 13, `Highest zone` with bot names and zones 2 to 3 above your row (highlighted) at zone 1, `Boss damage this week` reading `no boss damage yet this week`. `/promptfall leaderboards` opens the same tab.
6. **Kill the fake.** Ctrl-C it. The band's status row reads the retrying notice within 15 seconds as in phase 2; after 45 seconds the World tab's first row is dim (stale); a chat post flashes `Server unreachable`; the band keeps ticking.
7. **Bring it back.** Restart with the same `--data`: within 15 seconds the World tab is bright again and the chat tail resumes with no gap in what you can see.
8. **Two sessions.** Open a second `claude --plugin-dir plugins/promptfall` in a third terminal: its band reads `playing in another session`; `/promptfall chat` there still posts (a line from the secondary shows in the first terminal within 15 seconds); the online count in both stays 13 (one entry per account).
9. **Backgrounded terminal.** Leave the second terminal's window hidden or minimised for 2 minutes while watching the first terminal's World tab: the count stays 13 if its timers keep firing while backgrounded, and drops to 12 for a while if they do not. Write which it was into `docs/manual-pass/phase-3.md` under a "Findings" heading; it settles the record's open item on idle timers.
10. **Snapshot size.** `curl -s 'localhost:7777/v1/world' -H 'authorization: Bearer <a token from .promptfall/fake.json>' | wc -c`: under 16000 bytes with a full chat tail. Note the number under "Findings" (the record's open item on response size).
11. **A flag off.** Stop the fake, start it with `--flag chat.enabled=false`: within 15 seconds the band's row 3 reads `chat is closed` and the Chat tab reads `Chat is closed.` with no compose box; the Leaderboards still load. Restart without the flag.
12. **In-process.** `/promptfall server local`: the World tab reads `1 online · zone N: nobody else here` and `chat is closed`; the Chat tab says `Chat is closed.`; the Leaderboards tab lists you alone.

Then open the PR from `feat/phase-3` into `ai-staging` titled `Promptfall phase 3, PR 1: presence, chat, leaderboards, bots over HTTP`, body: what landed, the verification commands and their results, the manual pass pointer, the review legs (`reviewer` on Opus and `codex-review`), the attribution lines. Stop and hand Kevin part A.

**Acceptance check:** `pnpm lint && pnpm typecheck && pnpm test && pnpm vendor:check` green in one run, pasted in the PR body; `gh pr view --json url` shows the PR.

**Boundaries:** Docs only. Do not merge.

- [ ] Write part A; update the READMEs
- [ ] Run the full check line; open the PR; stop

### Task 8: Sim: boss mode, the three server events, SIM_VERSION 3

**Files:**
- `packages/sim/src/types.ts` (modify): the shapes under "Server events added in PR 2"; `SIM_VERSION = 3`
- `packages/sim/src/state.ts` (modify): `boss: null` in the initial state
- `packages/sim/src/combat.ts` (modify): `enemyStats(s, enemy)` with `scaledBossStats`; `hitEnemy` diverts a `world_boss` hit into `s.boss.dealt`
- `packages/sim/src/progression.ts` (modify): R1 in `checkWipe`, R2 in `onToolCall`
- `packages/sim/src/server-events.ts` (modify): `bossEngaged`, `bossDisengaged`, `rewarded`
- `packages/sim/src/step.ts` (modify): register the three handlers
- `packages/sim/src/loot.ts` (modify): `rollRewardItem`
- `packages/sim/src/heroes.ts` (modify): `pushLog` accepts the `reward` entry (type only)
- `packages/sim/src/index.ts` (modify): export `rollRewardItem`, `Stats` is already exported
- `packages/sim/src/golden.ts`, `golden.test.ts` (modify): `goldenEvents()` inserts `boss_engaged { bossId: 'wbgold', name: 'Golden Wyrm', glyph: '☠', stats: { hp: 630, atk: 14, def: 4, spd: 5 } }` after turn 3's `turn_end` and `boss_disengaged { bossId: 'wbgold' }` after turn 6's, and `rewarded { bossId: 'wbgold', goods: { kind: 'item', item: <a fixed rare steel_longsword with id 'r0'> }, gold: 45 }` after turn 7's; the script stays 300 events; new `GOLDEN_HASH`
- `packages/sim/src/determinism.test.ts` (modify): `randomServerEvent` draws `boss_engaged` (when `s.boss === null`, else a second one to exercise `already_engaged`), `boss_disengaged` (the live id, or `'wbjunk'` one time in ten), `rewarded` (an item, or `goods: null` with gold); the share of server events rises from 4% to 8% so boss stretches last long enough for ticks to land on the boss
- `packages/sim/src/boss.test.ts` (create): `boss_engaged` replaces an encounter of three wave enemies and a queue with one `world_boss`, keeps `pendingTurnBoss`; 20 ticks raise `dealt`, change no XP, gold, kills or inventory, and leave the enemy's `hp` at `maxHp`; a tool call spawns nothing and counts toward `turnToolCalls`; a party beaten to 0 HP is healed in place with `zone`, `wipes`, `encounter` unchanged and no `wipe` effect; `rest` heals; `boss_disengaged` clears the encounter and the next tick spawns a wave (or the pending turn boss); `boss_disengaged` with the wrong id is `not_engaged`; `rewarded` inserts the item, adds the gold, logs `reward`, emits `rewarded`; `rewarded` into a full inventory is `inventory_full`; `scaledBossStats` at zone 1 equals the carried stats plus the spd offset and at zone 5 equals `72 / 14`-scaled atk and `16 / 4`-scaled def (`content/enemies.ts` baselines); `rollRewardItem(7, 3, ['knight','black_mage','white_mage'])` is a base with `minZone <= 3` wearable by one of those classes, with `id ''`, and the same seed gives the same item
- Every other sim test asserting a full `GameState` literal (modify): add `boss: null`

**Interfaces:**
- Consumes: today's sim.
- Produces: `SIM_VERSION = 3`, `EnemyKind` with `world_boss`, the three events and handlers, `GameState.boss`, the `reward` loot entry, the `rewarded` effect, `rollRewardItem`.

**Work:** Follow the boss mode rules under "Server events added in PR 2" exactly; their placement inside the existing functions is yours. `enemyStats` gains the state parameter at its six call sites in `combat.ts` (lines 36, 44, 67, 73, 89 and 105). The view of a `world_boss` enemy is the client's problem (Task 11), but `content.enemies['world_boss']` must not exist: nothing in content changes.

**Acceptance check:** `pnpm --filter @promptfall/sim test` green, including `boss.test.ts`, the determinism property test with boss events in its generator, the harness targets unchanged, and the new golden hash noted in the commit message. Red before: `boss.test.ts` fails to import. Expected red after: `packages/protocol` does not type-check until Task 9 (`ServerEventSchema`).

**Boundaries:** No change to zone content, loot tables, drop rates or the pace target (`harness.test.ts` must stay green untouched). No wall-clock value in the sim. Do not touch `packages/protocol` or the ledger.

- [ ] Types, `boss: null`, `SIM_VERSION 3`; fix the type errors in `packages/sim`
- [ ] `boss.test.ts` red; `combat.ts`, `progression.ts`, `server-events.ts`, `step.ts` until green
- [ ] `rollRewardItem` and its test; the determinism generator; the golden script and hash; commit `feat(sim): boss mode, world_boss enemy, boss and reward server events, SIM_VERSION 3`

### Task 9: Protocol: the three event schemas; contract rules 33 to 40

**Files:**
- `packages/protocol/src/schemas.ts` (modify): the three objects in `ServerEventSchema`; `StatsSchema`
- `packages/protocol/src/schemas.test.ts` (modify): a delivery carrying `boss_engaged` parses; a batch carrying it fails
- `packages/protocol/src/contract/suite.ts` (modify): rules 33 to 40 below, and `ContractHost` unchanged
- `packages/protocol/src/index.ts` (modify): export `StatsSchema`

**Interfaces:**
- Consumes: Task 8.
- Produces: the wire shapes of the three events; the boss contract.

**Work:** Rules 33 to 40, each over `make` with the suite's clock, red until Task 10. The clock starts at `1_700_000_000_000`, which is not on the 3 h grid (`1_700_000_000_000 mod 10_800_000 = 4_400_000`, 73 minutes past a grid point and past that point's 20-minute window); `nextGrid = 1_700_000_000_000 + 10_800_000 − 4_400_000`. A "strong" trader is `host.mint` of `traderState` with its three party heroes at level 40 and 50 000 gold; at zone 1 a level 40 party deals about `(9+78) + floor((11+117)×0.6) + (8+78)/2` ≈ 200 per tick against def 4.

- rule 33, the grid: with two traders polling, a poll before `nextGrid` answers `boss: null`; `clock.advance` to `nextGrid`; A's poll answers a boss with `bossId 'wb' + (nextGrid / 10_800_000).toString(36)`, `maxHp === hp === 2 × BOSS_BASE_HP`, `spawnedAt nextGrid`, `endsAt nextGrid + 1_200_000`, `yours 0`, and A's `account()` delivery carries one `boss_engaged` whose `stats` equal `content.enemies['bandit_captain'].stats` scaled by `WORLD_BOSS_STAT_BP`; a second poll adds no event; B, who had not polled since the spawn, is engaged on its next poll; a third trader minted after the spawn is engaged on its first poll.
- rule 34, contribution: A (strong) applies the engaged event in its mirror, builds a batch of 30 ticks, submits: `ok`; the snapshot's `hp` fell by exactly `mirror.local.boss.dealt`, `yours` equals it; `leaderboards().damage` lists A with that value.
- rule 35, the kill: A strong, B fresh, both engaged; B commits one tick (a small contribution under 400); A commits batches of 60 ticks until `hp` reaches 0: the killing ack's delivery carries, in order, two `rewarded` for A (A is in the top 3; each with `goods.kind 'item'`, an `r`-prefixed id, `gold > 0`) then `boss_disengaged`; A's mirror applies them and hashes match the next ack; B's `account()` delivery carries `boss_disengaged` and no `rewarded`; the snapshot now shows `hp 0` and the same `bossId`; after `clock.advance(1_200_000)` it is `null`; a tick A commits after the kill adds nothing to `yours` or the board.
- rule 36, threshold and returns: C, minted with a full inventory (30 common items) and strong, deals over 400 and the boss is killed by A: C's delivery carries `rewarded { goods: null, gold > 0 }`, `account().returns === 1`, and a batch vendoring one item gets `returned` with `listingId === bossId` in its own ack.
- rule 37, expiry: a boss with A engaged dealing 500 and B dealing 100; `clock.advance(1_200_000)`; A's poll answers `boss: null`, A's delivery carries exactly one `rewarded` (no bonus on expiry) then `boss_disengaged`; B's carries `boss_disengaged` only.
- rule 38, flag off: with `{ 'worldboss.enabled': false }` the poll after `nextGrid` answers `boss: null` and no account is engaged.
- rule 39, the weekly board: after rule 34's contribution, `leaderboards().weekStart` equals `weekStartOf(now)`; `clock.advance` to the next Monday 00:00 UTC; `damage` is `[]` and `weekStart` moved.
- rule 40, restart mid-boss (host rule, skipped without `host`; the HTTP runner gives `make` a shared `MemoryKeyValue` through a second `make` call with the same options): a second host over the same store and clock answers the same `bossId`, `hp`, `endsAt` to a poll, with `online` rebuilt from that poll alone.

For rule 40 `ContractMake` gains an optional `options.kv?: KeyValue`; both runners pass it to their ledger when given.

**Acceptance check:** `pnpm --filter @promptfall/protocol test` green; `pnpm exec tsc -b packages/protocol` clean. Red before: `schemas.test.ts` fails on `boss_engaged`. Expected red after: rules 33 to 40 fail on both hosts until Task 10.

**Boundaries:** No ledger code. No plugin.

- [ ] Schemas and their test; commit `feat(protocol): boss and reward event schemas`
- [ ] Rules 33 to 40 (red); `ContractMake.kv`; commit `test(contract): world boss rules 33 to 40`

### Task 10: Ledger: the boss record, schedule, contribution, rewards, weekly damage

**Files:**
- `packages/ledger/src/boss-config.ts` (create): the constants under "`@promptfall/ledger` additions"
- `packages/ledger/src/boss.ts` (create): `advanceBoss`, `engage`, `contribute`, `settleBoss`, the `BossRecord` key, `toBossView`
- `packages/ledger/src/ledger.ts` (modify): `advanceBoss` at the four call sites; the contribution read in `submit` step 9; `worldboss.enabled`
- `packages/ledger/src/world.ts` (modify): `boss` in the snapshot; engage on poll; the damage board write
- `packages/ledger/src/ids.ts` (modify): prefix `'r'`
- `packages/ledger/src/index.ts` (modify): export the boss constants
- `packages/ledger/src/boss.test.ts` (create): `bossId` and name for a grid index; `maxHp` with 0 online is `BOSS_BASE_HP`; a contribution past the remaining HP floors at 0 and counts in full; `settleBoss` rolls for the top 3 among ties by account id and gives one roll to the fourth; an account whose record is no longer current (a v2 state) is skipped without a throw; `rollRewardItem` is called with the contributor's zone and party classes
- `servers/fake/src/bots.ts` (modify): nothing but a comment: the mirror applies `boss_engaged`, so bots fight through their batches
- `servers/fake/src/bots.test.ts` (modify): one case: the clock advanced onto a grid point, 12 bots act for three rounds, the snapshot's `hp` is below `maxHp` and the damage board has bot rows

**Interfaces:**
- Consumes: Tasks 8 and 9.
- Produces: the boss half of `ServerClient` on both hosts; `BossRecord`.

**Work:** Follow the ledger rules under "`@promptfall/ledger` additions" (`advanceBoss`, engage, contribution, `settleBoss`). Everything runs inside the mutex and ends with the one flush; `settleBoss` may touch many records in one operation, which is one flush of the fake's snapshot. Presence is read through the same `Map` as `world()`. Internal layout of `boss.ts` is yours.

**Acceptance check:** `pnpm --filter @promptfall/ledger test` and `pnpm --filter @promptfall/fake-server test` green with rules 0 to 40 on both hosts, `boss.test.ts`, and the bots' boss case. Red before: rules 33 to 40 fail.

**Boundaries:** No plugin. No new route (the snapshot carries the boss). No change to the market rules.

- [ ] `boss-config.ts`, `boss.ts`, `boss.test.ts` red then green
- [ ] Wire `advanceBoss`, engage on poll, the contribution read, `settleBoss`; rules 33 to 40 green over the in-process host, then over HTTP
- [ ] The bots' case; commit `feat(ledger): world boss on the 3 hour grid, contribution from committed batches, rewards`

### Task 11: Plugin: the boss in the band, the toasts, the reward

**Files:**
- `scripts/vendor.mjs` (run `pnpm vendor`): v3 bundles
- `plugins/promptfall/types/index.d.ts` (modify): `GameView.boss: { bossId: string; name: string; glyph: string; dealt: number } | null`; `EnemyView.kind` already a string; `LootView` unchanged
- `plugins/promptfall/hooks/view.ts` (modify): `toGameView` fills `boss`; the `world_boss` enemy's `EnemyView` takes `name` and `glyph` from `state.boss` (it has no content entry); `lootLine` for `reward`: `boss reward <name> (+<gold>g)`
- `plugins/promptfall/hooks/engine.ts` (modify): `committedBoss(): { bossId: string; dealt: number } | null` from `this.committed`; the `rewarded` effect reaches `onEffects` through `receive` as every server-event effect does
- `plugins/promptfall/hooks/register.tsx` (modify): `effectToast` for `rewarded`: `Boss reward: <item name> (<rarity>)` when goods are present, else `Boss reward: <gold> gold`; the poller's transitions: `World boss <name> has appeared` when the previous snapshot had no boss or another `bossId` and the new one has a live boss; `<name> is down` when the same `bossId` goes from `hp > 0` to `hp === 0`; nothing on expiry. The sync trigger on the primary: when the snapshot shows a live boss whose `bossId` is not `local.boss?.bossId`, or no live boss while `local.boss` is set, call `engine.sync()` once per such change (remember the last `bossId` synced for), swallowing `unreachable`.
- `plugins/promptfall/hooks/world.ts` (modify): `committedDealt` on each snapshot; the fast cadence while `snapshot.boss` is live is already in Task 5
- `plugins/promptfall/hooks/ui/band.tsx` (modify): R5, the Party tab's enemy slot: when `view.boss` is set, the first enemy row reads `⚔ <glyph> <name>` followed by `HpBar(els, shownHp, maxHp)` and `<shownHp>/<maxHp>` with `shownHp = max(0, boss.hp − max(0, view.boss.dealt − (world.committedDealt?.bossId === boss.bossId ? world.committedDealt.dealt : 0)))` from the snapshot's boss; rows 2 and 3 of the slot are empty. The status row's last segment while a boss is live, on every tab: `boss <pct>% · <remaining>` where `pct = floor(shownHp × 100 / maxHp)` and `remaining = formatRemaining(remainingRealMs(endsAt, world.clock, now))` (`ui/time.ts`); a notice still wins over it, and it wins over `last: <drop>`. The World tab's row 2 while live: `World boss <name> <bar> <pct>% · <remaining> left · you <dealt>` with an 8-cell bar and `dealt = view.boss?.bossId === boss.bossId ? view.boss.dealt : boss.yours`; `<name> is down` with the same `you` once `hp === 0`. Without a live boss row 2 is Task 5's.
- `plugins/promptfall/hooks/band.test.ts` (modify): with a `world` atom holding a live boss and a view in boss mode for it, the Party tab's first enemy row shows the boss name and a bar, the status row ends in `boss 62% · 11m` for `hp 6200 / 10000` and 11 minutes left at speed 1, and the World tab's row 2 reads the boss line; the predicted HP subtracts local `dealt` beyond `committedDealt`; a snapshot with `hp 0` reads `is down`
- `plugins/promptfall/hooks/register.test.ts` (modify): a snapshot sequence `null → boss → hp 0` toasts `World boss <name> has appeared` then `<name> is down` once each; a delivery carrying `rewarded` with an item toasts `Boss reward: Steel Longsword (rare)` and the loot log gains `boss reward Steel Longsword (+45g)`; `rewarded` with `goods: null` toasts `Boss reward: 45 gold`; the primary calls `account` (the sync) within one poll of a boss appearing in the snapshot while the local state is not engaged
- `plugins/promptfall/hooks/golden.test.ts` (modify): the v3 golden
- `plugins/promptfall/hooks/engine.test.ts` (modify): `committedBoss` follows `committed`, not `local`
- `plugins/promptfall/README.md` (modify): a "World boss" section (the grid, boss mode, the display, rewards, the reset the version bump forces)

**Interfaces:**
- Consumes: Tasks 8 to 10 through the vendor bundles, Task 5's poller.
- Produces: the phase 3 band.

**Work:** The predicted bar is display arithmetic only; the server's HP wins at the next poll. `boss_engaged` and `boss_disengaged` effects do not exist; the toasts come from the snapshot transitions in whichever session polls, so both a primary and a secondary toast in their own terminals. The reward toast comes from the `rewarded` effect on the primary (secondaries replay deliveries read-only and toast nothing, as for trades).

**Acceptance check:** `pnpm vendor && pnpm vendor:check` clean; `claude plugin validate plugins/promptfall` unchanged; `claude plugin test plugins/promptfall` green with the extended band, register and engine tests; `pnpm exec tsc -p plugins/promptfall` clean. Red before: the plugin does not type-check against the v3 `GameState` (`boss` missing from `toGameView`'s view) and the golden test fails on the hash.

**Boundaries:** No `$.ui.status` (record D1). No new dialog tab. No sound. The outage, lease and flush rules are untouched.

- [ ] `pnpm vendor`; the v3 golden; `toGameView.boss`, the `world_boss` enemy view, the loot line; `engine.committedBoss`
- [ ] Band: enemy slot, status segment, World row; `band.test.ts` red then green
- [ ] Toasts, the sync trigger, `committedDealt`; `register.test.ts`; README; run the acceptance check; commit `feat(plugin): world boss in the band, boss toasts, rewards in the loot log`

### Task 12: PR 2: manual pass part B, docs, pull request

**Files:**
- `docs/manual-pass/phase-3.md` (modify): part B
- `README.md` (modify): status says phase 3 is built
- `docs/spec/promptfall.md` (modify only if execution found a contract deviation that Kevin approved in chat; otherwise untouched)

**Work:** Part B. The fake runs at speed 10 and with two bots: the boss window is 2 real minutes, the next grid point is at most 18 real minutes away, and two bots leave the boss alive long enough for you to pass the threshold. The fast-forward trick (`--speed 2000 --bots 0` for 50 s) is not used here: at that speed one real second is 33 virtual minutes, so it cannot be stopped inside a 20-minute window; waiting at speed 10 is the reliable path, and `--boss-at` stays unadded unless this pass finds 18 minutes too long.

1. **Reset.** `SIM_VERSION` is 3: a phase 2 store and a phase 2 fake snapshot are both behind it. Start the fake on a fresh path: `pnpm fake --port 7777 --speed 10 --bots 2 --player-name <you> --data .promptfall/fake-p3.json`. In the plugin session, `/promptfall server http://127.0.0.1:7777`: a fresh account there. Then `/promptfall server local`: the band is one line with the older-version notice; `/promptfall account`, `Reset this machine's data`: a fresh in-process account. Back to the fake with `/promptfall server http://127.0.0.1:7777` and link.
2. **When is the boss?** `curl -s localhost:7777/v1/health`: `now` is virtual ms; the seconds until the next spawn are `(10800000 − now % 10800000) / 10000`. Note them (at most 1080).
3. **It appears.** Within 5 seconds of that moment (the fake's two bots poll every 2 real seconds, and your session every 15, so the spawn is advanced by whoever polls first): a toast `World boss <name> has appeared` (after Esc if the dialog is open); the Party tab's first enemy row reads `⚔ ☠ <name>` with a bar and `24,000/24,000` (3 online × 8 000: you and two bots; more if a secondary session or a viewer account polled); the status row ends in `boss 100% · 2m`; the World tab's row 2 reads the boss line with `you 0`.
4. **Fight it in a turn.** Ask Claude to run `sleep 5` ten times, one at a time, so the party ticks every 2 seconds for the fight: within 20 seconds `you` on the World tab rises by about 14 a tick, the bar falls between polls and corrects at each poll, and no enemy spawns from the tool calls. HP bars of your heroes may hit zero and jump back to full with no retreat and no wipe toast.
5. **It dies or withdraws.** Within 2 minutes either the toast `<name> is down` and then, within 15 seconds, `Boss reward: <item> (<rarity>)` twice (you are in the top 3 of 3 and above 5%, which in a turn you reach in about 60 seconds), the two items in the Inventory tab and two `boss reward …` lines in the loot log; or, if the bots were slow, the status row's segment disappears at the 2-minute mark with no down toast and one `Boss reward` toast if you were above 5%. Either way the band is back to waves within 15 seconds.
6. **Leaderboards.** `/promptfall leaderboards`: `Boss damage this week` lists you and the bots with your row highlighted.
7. **A restart mid-boss.** Wait for the next spawn (step 2), then after 30 seconds Ctrl-C the fake and restart it with the same command and `--data`: within 15 seconds the boss line is back with the HP it had and the fight resumes; the online count rebuilds from the polls.
8. **In-process.** `/promptfall server local` (reset done in step 1): no boss ever appears there, the World tab reads `1 online` and `chat is closed`.
9. **Validate.** `claude plugin validate plugins/promptfall` lists the same namespaces as phase 2.

PR from `feat/phase-3-boss` into `ai-staging` titled `Promptfall phase 3, PR 2: world boss`, same body shape as PR 1 with the review legs. Stop and hand Kevin part B.

**Acceptance check:** the full check line green and pasted; `gh pr view --json url`.

**Boundaries:** Docs only. Do not merge.

- [ ] Write part B; update the README; run the check line; open the PR; stop

## Spec conflicts and narrowings

1. **`rewarded` is one event per roll, not one per contributor.** The record (§1.3) fixes the shape `rewarded { bossId, goods: Goods | null, gold }` and says one event per contributor with one bonus roll each for the top 3. One event cannot carry two items in that shape, so a top-3 contributor gets two `rewarded` events; everyone else one. The shape stays verbatim.
2. **`goods: null` means the item waited in returns.** The record does not say when `goods` is null. Here: when the contributor had no free slot, the item is queued in `returns` under `listingId = bossId` and arrives as `returned` (its loot line reads `returned`); the `rewarded` event still carries the gold so the toast shows something.
3. **Reward gold.** The record names a `gold` field and no amount. Here every reward carries `3 × vendorGoldPerZone(rarity) × zone`, the sim's own valuation of a boss roll (`heroes.ts:68`).
4. **Presence TTL is 45 real seconds**, scaled by `speed` on the fake, because heartbeats arrive at the client's real cadence; at `--speed 10` an unscaled TTL would mark a player offline for 70% of each poll interval.
5. **`WorldSnapshot.serverNow`** is added to the record's shape so a secondary (whose engine never bootstraps) can show the boss's time left and the bar's pace.
6. **Chat refusal `empty`** is added for a whitespace-only message; the client refuses it locally and the server refuses it too.
7. **`ChatResult.ok` carries the posted message** so the client shows it at once and advances its chat mark without waiting for a poll.
8. **The boss stays in the snapshot with `hp 0` until `endsAt`**, so the down toast has a transition to fire on; expiry has no toast (spec §10 lists appeared, down and reward only).
9. **World boss stats scale by the ratio to zone 1's zone boss** per stat (`atk × zoneBoss(zone).atk / zoneBoss(1).atk`, floored). The spec says "scaled to the party's zone" and names no rule.
10. **The highest-zone board is offered at every commit and at mint**, not only where `highestZone` rose: the check costs the same and bots minted at zone 2 to 3 would otherwise never appear until they advance.
11. **The name blocklist also covers listings' `sellerName`** through the shared `publicName`, since `market.ts` already derives the name there.
12. **The Chat tab's fast cadence is driven by renders** (`CHAT_TAB_HOT_MS`) rather than an open/close signal, because no pane-close hook is among the engine facts.
13. **`boss_engaged` reaches a playing primary through a `sync()` the poller triggers**, since the snapshot carries no delivery and the next flush is up to 15 s away; the ack path (`cursor_behind`, re-step) handles a batch already in flight.
14. **Bots re-mint under a new sim version.** The record does not say what happens to phase 2 bot accounts in an old snapshot; here a saved bot whose state is behind `SIM_VERSION` is minted again, and the manual pass starts from a fresh `--data` anyway.
15. **Bot scheduling**: each bot acts once per `BOT_TICK_MS` virtual ms, so the scheduler interval is divided by the bot count; phase 2 ticked one bot per interval.
16. **`Mirror` moves to the protocol root** with an injected batch-id source, so the bots can use it outside vitest and the vendor bundle stays free of platform globals.
17. **`turnToolCalls` keeps counting in boss mode** (R2 says spawn nothing, not count nothing), so a long turn during a boss still earns its turn boss once the waves resume.
18. **The weekly damage board keeps every contributor of the week** and cuts the top 20 at read; a 20-row list could not rank a rising account correctly.
19. **Secondary sessions post chat and read boards with the stored token directly**, outside the engine, which is what "any session may post, no flush, no lease" needs.
20. **The idle-timer open item** (record §5) is manual pass part A step 9; the response-size item is step 10. `--boss-at` is not added; part B says why the fast-forward is not used.
21. **Reward items use the ledger id prefix `r`**, added to `ids.ts`; `transfer` re-ids them with `t` on a sale as it does any non-`t` id.
22. **`ContractMake` gains an optional `kv`** for the restart-mid-boss rule; both runners keep their defaults otherwise.

## Out of scope

The long-poll stream, presence in Redis, mute and ban, the admin CLI, pushed flag changes, deferred items M (a delivery with a gap after a 500-entry log fold) and Q (the virtual clock stepping back after a SIGKILL during a read-only stretch) (phase 5); `--boss-at` (revisit after manual pass part B; not added); sound cues for the boss, sprites (phase 4); hero rewards from the boss (items only in phase 3); a chat word list beyond the placeholder (content, not mechanism); names colliding on a fake with more than one human (`--player-name` for every linked account; a fake limitation, noted in the record); rate limits on the world poll beyond the presence stamp being idempotent; migrations between sim versions.
