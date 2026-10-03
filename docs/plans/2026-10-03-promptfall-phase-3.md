# Promptfall phase 3 implementation plan

**Goal:** Players see each other, chat, climb two leaderboards and fight a scheduled world boss together, against the HTTP fake with bots that play through the public API.
**Architecture:** World data (presence, the chat tail, the live boss) is never sim state: a session reads it with the world poll, `GET /v1/world`, which is also its heartbeat. The ledger holds presence in memory, chat and the boards in the store, and in PR 2 a boss record beside the sim. The sim gains boss mode (`SIM_VERSION` 3): the server event `boss_engaged` turns the party's encounter into one `world_boss` enemy that never dies locally, the state tallies the damage dealt, the server reads that tally from each committed batch as the account's contribution, and rolls rewards as `rewarded` server events. Bots become HTTP clients of the fake's own port with a client-side mirror, so they batch, fill orders, chat and fight the boss like a player.
**Spec:** `docs/spec/promptfall.md` (§3, §4.6, §6 to §10, §12 as amended on 2026-10-03), `docs/plans/2026-10-03-phase-3-grill.md` (the record: §1 decisions, §5 open items, §6 facts, §7 split), `docs/adr/0001-trades-as-server-events.md`, `docs/adr/0002-world-boss-as-boss-mode.md`, `CONTEXT.md`
**Execution model:** opus
**Review wave:** done 2026-10-03: reviewer on opus, reviewer on fable, codex-review on gpt-6-astra at xhigh. This is the fixed plan, consolidated in `docs/reviews/2026-10-03-phase-3-plan-fix-pass.md`; there is no second wave.
**Delivery:** two PRs into `ai-staging`. PR 1 (social) is Tasks 1 to 7 on `feat/phase-3`, which already holds the grill docs; no sim change, no reset. PR 2 (world boss) is Tasks 8 to 12 on `feat/phase-3-boss`, branched from PR 1's head; it bumps `SIM_VERSION` to 3 and its manual pass carries the reset. Each PR's review runs two legs, `reviewer` on Opus and `codex-review`, with no Fable leg until Kevin says otherwise. Red between tasks: in PR 1, from Task 1 to the end of Task 2 `packages/ledger` and `servers/fake` do not type-check (`ServerClient` has three methods the ledger lacks; the fake's handler table is keyed by `ROUTES`, `server.ts:142`), `servers/fake` stays red to the end of Task 3 (the three handlers), the suite's rules 25 to 32 fail over HTTP until Task 3, and the plugin type-checks against its vendored bundles until Task 5's `pnpm vendor` while `pnpm vendor:check` is stale from Task 1 to the end of Task 5. In PR 2, from Task 8 to the end of Task 9 `packages/protocol` does not type-check (`ServerEventSchema` lacks the three new kinds), the contract rules 33 to 40 fail until Task 10, and `vendor:check` is stale until Task 11. Each PR's last commit is clean on the full check line: `pnpm lint && pnpm typecheck && pnpm test && pnpm vendor:check && pnpm exec tsc -p plugins/promptfall && claude plugin test plugins/promptfall` (the root scripts cover the four packages only; the two plugin commands are the plugin's).

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
- Tuning numbers live in four named files and nowhere else: `packages/protocol/src/world.ts` (the contract-visible numbers and `weekStartOf`, PR 1 and PR 2: the suite asserts them, and `BUDGETS` in `packages/protocol/src/client.ts:100-107` is the precedent for a number the ledger imports from the protocol), `packages/ledger/src/boss-config.ts` (`WORLD_BOSSES`, PR 2), `plugins/promptfall/hooks/world.ts` (poll cadences and the stale marker), `servers/fake/src/bot-config.ts` (bots). Tests and the plugin's texts import them rather than repeating the values.
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
  speed: number                               // the server clock's rate, as ServerConfig.speed; a secondary never bootstraps
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
// Text limits in the schemas: ChatMessage.text 1..200 UTF-16 units (`.max(200)`, the unit `String.length` counts; an emoji counts two) after trimming, name 0..128. The chat body: ChatBodySchema = z.object({ text: z.string().max(2000) }); the ledger judges the length in the same unit.

// Contract-visible numbers and the week rule, in `world.ts` too, imported by the ledger, the suite and the plugin. PR 1:
export const PRESENCE_TTL_MS = 45_000
export const HERE_MAX = 10
export const CHAT_MAX_CHARS = 200
export const CHAT_BUCKET_CAPACITY = 5
export const CHAT_REFILL_MS = 10_000
export const CHAT_KEEP = 200
export const CHAT_SERVE = 50
export const BOARD_ROWS = 20
/** Monday 00:00 UTC of the week holding `now`: days = floor(now / 86_400_000); (days − (days + 3) % 7) × 86_400_000 (day 0 was a Thursday). */
export function weekStartOf(now: number): number
// PR 2, same file:
export const BOSS_GRID_MS = 10_800_000
export const BOSS_WINDOW_MS = 1_200_000
export const BOSS_BASE_HP = 4000
export const BOSS_THRESHOLD_BP = 500
export const BOSS_TOP_BONUS = 3
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

`Mirror` moves from `packages/protocol/src/contract/suite.ts` to `packages/protocol/src/mirror.ts`, unchanged (constructor `(boot: Bootstrap)`, `batch()` keeps `crypto.randomUUID()`), exported through a new package subpath `"./mirror": "./src/mirror.ts"` beside `./contract` and never from `index.ts`: `pnpm vendor` bundles `index.ts` only (`scripts/vendor.mjs:38-44`), so the plugin bundle does not carry it and no platform-global rule applies. The suite imports `../mirror`; the bots import `@promptfall/protocol/mirror`. It moves because `suite.ts:14` imports vitest, which the fake must not load.

### Server events added in PR 2 (`packages/sim/src/types.ts`)

```ts
export const SIM_VERSION = 3 as const
export type EnemyKind = 'wave' | 'zone_boss' | 'turn_boss' | 'world_boss'

export type ServerEvent =
  | /* the nine phase 2 kinds, unchanged */
  | { t: 'boss_engaged'; bossId: string; name: string; glyph: string; stats: Stats }   // zone 1's zone boss stats verbatim: { hp: 630, atk: 14, def: 4, spd: 5 }
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
- R1: `checkWipe` (`progression.ts:273-286`) in boss mode: `fullHealParty` once and nothing else: no retreat (`changeZone` not called), no `applyPendingParty` (spec §4.3 applies a pending party on a zone change only), no `wipes` increment, no `wipe` effect, the encounter kept, `pendingTurnBoss` kept; returns `true`. It runs after every enemy act as today (`combat.ts:121`), so the round ends there and the next tick starts with a full party.
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
// blocklist.ts (PR 1)
export const BLOCKED_WORDS: readonly string[]            // placeholder content: ['heck', 'darn', 'frick', 'blockedword']
export function isBlocked(text: string): boolean          // whole-word, case-insensitive: lower-case, split on /[^\p{L}\p{N}]+/u, any word in the list
// boss-config.ts (PR 2)
export const WORLD_BOSSES: readonly { name: string; glyph: string }[]   // 4 entries, e.g. { name: 'The Promptwyrm', glyph: '☠' }
```

Every number (`PRESENCE_TTL_MS`, `HERE_MAX`, the `CHAT_*` five, `BOARD_ROWS`, the `BOSS_*` five) and `weekStartOf` are imported from `@promptfall/protocol` (above); the ledger declares none of them.

Storage keys, beside phase 2's:

- `pf:chat` → `{ nextId: number; messages: ChatMessage[] }`, at most `CHAT_KEEP` messages, oldest first.
- `pf:boards` → `{ zone: BoardRow[]; week: { start: number; damage: Record<string, { name: string; value: number }> } }`. `zone` is the highest-zone board, at most `BOARD_ROWS` rows, value descending, ties by earlier insertion. `week.damage` holds every contributor of the current week (bounded by who contributed); the top `BOARD_ROWS` are cut at read. `week.start` is the Monday the entries belong to; a read in a later week answers the reset without writing; a contribution in a later week resets `week` before adding.
- `pf:world:boss` → `BossRecord = { bossId: string; name: string; glyph: string; spawnedAt: number; endsAt: number; maxHp: number; hp: number; contributions: Record<string, number>; closed: boolean }` (PR 2). `contributions` keys are the engaged accounts (0 until they deal damage). `closed` is set once rewards and disengages are authored; a closed record stays stored until the next spawn replaces it.
- `AccountRecord` gains `chat?: { tokens: number; refillAt: number }` (absent means a full bucket). No boss field: engagement is `accountId in contributions`, and the sim's `state.boss` says whether the record is in boss mode.

Presence is `private presence = new Map<string, { zone: number; name: string; at: number }>()` on the `Ledger` instance. `world()` writes it (no store write, so `TrackedKeyValue.dirty` stays false and nothing is flushed); the TTL check is `now − at < ttl`; entries past the TTL are pruned on each poll. The public name of a record is `publicName(record)`: the display name with every `\p{Cc}` character removed (`/\p{Cc}/gu`: C0, DEL, C1), then `adventurer` when there is no display name, when the result is empty, or when `isBlocked(name)`; used by presence, chat, the boards and `market.ts`'s `nameOf` (lines 46-48).

Rules the ledger enforces, by operation (every one under the mutex; reads write nothing and flush nothing):

- `world(auth, since)`: PR 2: `advanceBoss(now)` first, before `authenticate` and before any record is loaded (below), so the caller's record is read fresh after it. Authenticate, else `unauthorized`. If `flags['presence.enabled']` and `isCurrent(record)`: stamp `{ zone: record.state.zone, name: publicName(record), at: now }` under the account id. Snapshot: `serverNow = now`, `speed = options.speed ?? 1`, `online` = entries inside the TTL (the caller included), `zones` from them, `here` = the others in the caller's zone (`HERE_MAX`), all three empty and no stamp when presence is off. `chat`: when `flags['chat.enabled']`, `since <= 0` → the last `CHAT_SERVE` messages, else every kept message with `id > since`; `[]` when off. `boss` (PR 2): the stored record as `BossView` while `now < endsAt`, closed or not, so a killed boss shows `hp 0` until the window ends; `yours = contributions[accountId] ?? 0`; null after `endsAt`, when no record exists, or when `worldboss.enabled` is off. PR 2: an online, current account not in `contributions` of a record with `hp > 0` and `now < endsAt` is engaged here, `engage(record, boss)` on the record `world()` holds; record and boss saved.
- `chat(auth, text)`: `unauthorized`; `chat_closed` unless `flags['chat.enabled']`; `not_linked` unless `account.linked`; `cleaned = text.replace(/\p{Cc}/gu, '')` (control characters never reach a client's `Text`); `trimmed = cleaned.trim()`; `empty` when `trimmed === ''`; `too_long` when `trimmed.length > CHAT_MAX_CHARS` (UTF-16 units, the unit `ChatMessageSchema` counts, so a message the ledger accepts always parses); `blocked` when `isBlocked(trimmed)`; the bucket: `tokens = min(CAP, tokens + floor((now − refillAt) / CHAT_REFILL_MS))`, `refillAt += n × CHAT_REFILL_MS` (whole periods only, as the batch buckets do, `ledger.ts:258-269`), `rate_limited` when `tokens < 1`, else `tokens −= 1`; append `{ id: nextId, name: publicName(record), text: trimmed, at: now }`, `nextId += 1`, drop the oldest past `CHAT_KEEP`; save the record (bucket) and `pf:chat`; answer `{ ok: true, message }`. Order of checks is as listed: a closed channel says so before the gate.
- `leaderboards(auth)`: `unauthorized`; read `pf:boards`; when `weekStartOf(now) !== week.start` answer `damage: []` and `weekStart: weekStartOf(now)` without writing (the contribution path persists the reset); else `{ highestZone: zone rows, damage: top BOARD_ROWS of week.damage by value desc then name, weekStart }`; both lists `[]` when `flags['leaderboards.enabled']` is false. No `advanceBoss` here: the board is written on contribution, not on settle.
- `offerZone(boards, row)`: called in `submit` step 9 after a commit with `{ accountId, name: publicName, value: result.highestZone }` and in `host.mint` with the minted state's `highestZone`: if the account has a row, set its `name` to `row.name` (a player links after its first commit, so the stored name must follow) and its `value` to the higher of the two; else insert when the list has room or the value beats the last row; sort, cut to `BOARD_ROWS`. Cheap, so it runs on every commit rather than only when the zone rose.
- PR 2, `advanceBoss(now)`: runs first in `world` and `sweep`, before any record is loaded, and nowhere else (record §1.3: "advanced lazily on every world poll and every sweep"; `submit` reaches `settleBoss` only through its own contribution step). With `boss = kv.get('pf:world:boss')`, `gridIndex = floor(now / BOSS_GRID_MS)`, `spawnAt = gridIndex × BOSS_GRID_MS`, `bossId = 'wb' + gridIndex.toString(36)`, in this order:
  1. If `boss` exists, `!boss.closed`, and (`now >= boss.endsAt` or `flags['worldboss.enabled']` is false): `settleBoss(boss, { expired: true, inHand: null })`. An open record is settled before anything can replace it, whatever the clock did while the fake was down (`clock.ts:22-26` resumes at `virtualAt + downtime × speed`, which can land in a later window); and the flag turned off is treated as the window closing, so nobody stays in boss mode on a fake restarted with `--flag worldboss.enabled=false`.
  2. If the flag is on, `now < spawnAt + BOSS_WINDOW_MS`, and (`!boss` or `boss.bossId !== bossId`): spawn: `online = max(1, presence entries inside the TTL)`, `maxHp = hp = BOSS_BASE_HP × online`, `name`/`glyph` from `WORLD_BOSSES[gridIndex % length]`, `contributions = {}`, `closed: false`, save; then for every online account `record = books.load(id)`, `engage(record, boss)`, save, with `stats = content.enemies[content.zones[0].boss].stats` verbatim.
- PR 2, two helpers in `boss.ts` that never throw, because each checks the sim's precondition before `author` (`author` throws on a refused event, `books.ts:105-110`, and `run` flushes whatever was written before a throw, `ledger.ts:111-125`):
  - `engage(record, boss)`: skip a record that is not current. If `record.state.boss` is null → `author(record, boss_engaged { bossId, name, glyph, stats })`. If it names `boss.bossId` → nothing. If it names another id (a stale engagement) → `author(boss_disengaged { bossId: record.state.boss.bossId })` first, then `boss_engaged`. Then `boss.contributions[accountId] ??= 0`.
  - `disengage(record, bossId)`: `author(record, boss_disengaged { bossId })` only when `record.state.boss?.bossId === bossId`; otherwise skip and `log`.
- PR 2, contribution in `submit` step 9: `prevDealt = record.state.boss?.bossId === result.boss?.bossId ? record.state.boss.dealt : null` is captured before `record.state = result` (`ledger.ts:286`). After `settle(record)` (line 291) and before `deliverReturns`: if `prevDealt !== null`, `next = result.boss` names the stored record's `bossId`, the record is open, `hp > 0` and `now < endsAt`: `delta = next.dealt − prevDealt`; `hp = max(0, hp − delta)`; `contributions[accountId] += delta` (the whole delta, past the remaining HP too); in `pf:boards`, reset `week` if `weekStartOf(now) !== week.start`, then `week.damage[accountId] += delta` with the name refreshed, and save; if `hp === 0`: `settleBoss(boss, { expired: false, inHand: record })`. Ticks committed after the end or after the kill count for nothing (the condition fails). The killing commit's own ack carries the contributor's `rewarded` and `boss_disengaged` in its delivery, since they are authored into the record `submit` holds before `deliveryOf(record)` is built; the `hash_mismatch` branch's second `settle(record)` (line 296) folds them into the adopted state instead, as it does returns today. The commit happens either way.
- PR 2, `settleBoss(boss, { expired, inHand })`: `threshold = floor(BOSS_BASE_HP × BOSS_THRESHOLD_BP / 10000)` (200); `top = the BOSS_TOP_BONUS highest contributions > 0, ties by account id`. For every account in `contributions` (offline ones included): `record = inHand?.account.accountId === id ? inHand : await books.load(id)`; skip if missing or not current; `rolls = (contribution >= threshold ? 1 : 0) + (!expired && top.includes(id) ? 1 : 0)` (spec §6: the threshold gates the guaranteed drop, the top 3 get a bonus roll with no threshold, an expired boss pays no bonus); for each roll: `item = rollRewardItem(seedSource(), record.state.zone, party classes of record.state)`; when `item` is null the roll pays `author(rewarded { bossId, goods: null, gold })` and queues nothing; else `id` replaced by `nextLedgerId(kv, 'r')` (`ids.ts` prefix union gains `'r'`), `gold = 3 × content.rarity[item.rarity].vendorGoldPerZone × record.state.zone` (the sim's valuation of a boss contract vendored into a full roster, `heroes.ts:68`); if `hasRoom` → `author(record, rewarded { bossId, goods: { kind: 'item', item }, gold })`, else push `{ listingId: bossId, goods }` to `returns`, `syncReturnsQueue`, and `author(rewarded { bossId, goods: null, gold })`; then `disengage(record, boss.bossId)`; `books.save(record)` (saving the in-hand record here and again at the end of `submit` is harmless: it is the same object). Finally `closed = true`; save the boss. The loop skips rather than throws, so `closed` is always written.
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
  /** Every act's outcome, one line each: `bot <name> <action> ok` or `bot <name> <action> <reason>`; the tests read it. */
  log?: (line: string) => void
}
```

Each `tick()` acts for one bot, round robin, and the scheduler interval is `BOT_TICK_MS / count / speed` real ms, so every bot acts once per `BOT_TICK_MS` virtual ms (the phase 2 interval was per tick, so each bot acted once per 240 s; a heartbeat every 240 s would be offline). A bot's act: (1) `client.world(auth, chatMark)` (the heartbeat; the chat tail is read and the mark advanced, nothing else); (2) build `BATCH_TICKS_MIN + roll(BATCH_TICKS_SPREAD)` ticks, a `tool_call` before every `TOOL_CALL_EVERY`th tick, a `turn_end` at the end of every `TURN_END_EVERY_BATCHES`th batch, a `rest` at the start of every `REST_EVERY_BATCHES`th; `client.submit(mirror.batch(events), auth)`: `ok` → `mirror.commit(events); mirror.receive(ack.delivery)`; `cursor_behind` → `mirror.receive(ack.delivery)` and resubmit with the new cursor, once; a state-carrying refusal → `mirror.adopt(ack)`; a thrown call → log and end the act; (3) if `mirror.local.gold < STIPEND_FLOOR` → `host.credit(accountId, STIPEND, 'bot_stipend')` (the `credited` event reaches the mirror in the next ack); (4) one weighted action: `list` 4, `buy` 3, `order` 2, `fill` 2, `cancel` 1, `chat` 0 (chat is on its own cadence: every `CHAT_EVERY_TICKS`th act of a bot posts `BOT_LINES[roll]` through `client.chat`); `fill`: for up to 3 of the bot's Rare+ unequipped out-of-cooldown items, `client.matchingOrders(auth, itemId)`; accept the first with `client.fillOrder`. Every outcome is logged in the `log` shape above (refusals at debug level, ignored). At start, for each `i < count`: read `pf:bot:<i>`; mint when absent; bootstrap with the token; if `boot.state.v !== SIM_VERSION`, mint again and overwrite `pf:bot:<i>` (a phase 2 snapshot under `SIM_VERSION` 3: the old record stays orphaned in the snapshot, which the manual pass avoids by starting from a fresh `--data`); `mirror = new Mirror(boot)` from `@promptfall/protocol/mirror`.

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
  chatMark: number               // the id of the last message a poll delivered; sent as `since`; moves only on a poll
  clock: { serverNow: number; clientNow: number; speed: number } | null   // from the snapshot's serverNow and speed
  /** PR 2: what this party had committed for the live boss when the snapshot arrived, for the predicted bar. Null means: subtract nothing (a secondary, or a primary before its first reading). */
  committedDealt: { bossId: string; dealt: number } | null
}
```

- The poller belongs to `GameSession`, not the engine: secondaries poll too. It polls with the stored device token (as the secondary branch of `read()` does, `register.tsx:316-322`) through `server.client.world(auth, chatMark)`, never under the engine lock. It starts with one poll when the session becomes primary or secondary and after every `restart`, then on an `io.every` timer it re-arms whenever the cadence changes, as `setCadence` does. At most one poll is in flight: a timer tick while one is in flight is skipped, so a slow older answer can never land over a newer snapshot.
- Cadence: `WORLD_POLL_FAST_MS` while the boss is live (`snapshot.boss !== null && snapshot.boss.hp > 0`) or `now − chatSeenAt < CHAT_TAB_HOT_MS`, else `WORLD_POLL_MS`. The dialog calls `game.chatSeen(now)` from every render of the Chat tab; it writes a plain field `chatSeenAt` on `GameSession` and publishes nothing, so the render does not trigger itself. A visible Chat tab redraws on each poll (it reads the `world` atom), so the fast cadence sustains itself while the tab is shown and drops within 20 s of the pane closing (an undrawn pane raises no `ui.render`, d.ts E:3755 and E:13155-13157). The engine has a `ui.close` hook (E:6583); it is not used because the render rule needs no hook and no pane bookkeeping.
- A successful poll: `snapshot`, `fetchedAt = now`, `stale = false`, merge the snapshot's `chat` into `messages` by id (insert in ascending order, drop ids already held, cap 200 with the oldest dropped), `chatMark = the last id of the snapshot's chat` when it is non-empty (the mark moves only here), `clock = { serverNow: snapshot.serverNow, clientNow: now, speed: snapshot.speed }`, and (PR 2) `committedDealt` from `engine.committedBoss()` on the primary (null on a secondary). Then (PR 2) the toasts on transitions (Task 11). Publish once. A stale timer (`io.after(WORLD_STALE_MS)`) marks `stale: true` unless a fresher poll landed since (generation counter, as the engine's notices do).
- A thrown poll (unreachable, timeout, 5xx, bad body, `unauthorized` answer) is ignored: no outage, no notice, the next poll on the same cadence. Only `submit` and `bootstrap` enter the outage (`engine.ts`), unchanged.
- Posting: `game.chat(text)`: on the primary, when `engine.isUnreachable()` is true it throws `unreachable` at once, with no server call and no lock (record §1.1: posting in an outage answers the unreachable text; still no flush and no lease); otherwise, and always on a secondary (which has no outage state), it calls `server.client.chat(auth, text)` with the stored token. A thrown call surfaces as `Server unreachable` (`errorText`, `ui/trade.ts:53`); a refusal as its text. On `ok` the message is inserted into `messages` by id so it shows before the next poll; `chatMark` does not move (the next poll returns the message again and the merge drops the duplicate), so messages others posted in between are never skipped.
- Reads: `game.leaderboards()` calls `server.client.leaderboards(auth)` the same way, with no outage check (a thrown read flashes as the market's do).
- Gates: `gates(world: WorldState, account: AccountView)` in `view.ts` answers `{ chatOpen, presenceOpen, leaderboardsOpen, bossOpen, marketOpen }` from `world.snapshot.flags` when a snapshot exists, else from the `AccountView` booleans (the bootstrap config, which a primary refreshes only on `start` and `sync`, `engine.ts:526-532`). The dialog's gates, the band's World tab and the market gate (`gateText(view, world)`, `trade.ts:30`) read it, so a flag change reaches every surface within one poll (record §1.7).
- A server switch, a followed switch (`followSetting`, `register.tsx:375-380`) or a reset drops the poller's state: the `world` atom goes back to its default in `useServer` (`register.tsx:170-177`), which `restart` and `followSetting` both call, and the poller polls afresh. A hot reload restarts the poller at mark 0 over a populated buffer; the merge by id keeps that from duplicating messages.

The in-process host (`plugins/promptfall/hooks/server.ts`) constructs the `Ledger` with `flags: { 'chat.enabled': false, 'worldboss.enabled': false }`; presence and leaderboards stay on, so the snapshot there reads one online and the boards hold the one account.

### Tuning numbers and their working

| Number | Value | Where | Why |
| --- | --- | --- | --- |
| World poll | 15 s / 5 s | `world.ts` | the flush cadence (`register.tsx:78`); 5 s keeps a 20-minute boss and a chat tab live enough without a stream (record Q1, Q20) |
| Stale marker | 45 s | `world.ts` | three missed polls at the slow cadence, equal to the presence TTL |
| Presence TTL | 45 s real | `protocol/src/world.ts`, scaled by `speed` in the ledger | three slow polls; at `--speed 10` the player polls every 150 virtual s, so the TTL must follow real time or the player flickers offline between polls |
| `here` names | 10 | `protocol/src/world.ts` | one band row |
| Chat length | 200 UTF-16 units | `protocol/src/world.ts` | spec §6; the unit Zod and `String.length` share, so the ledger and the schema agree |
| Chat bucket | 5, one per 10 s | `protocol/src/world.ts` | spec §6 |
| Chat history | 200 kept, 50 served | `protocol/src/world.ts` | spec §6; 50 messages of 200 characters plus names is under 15 KB cold, within the 15 s fetch budget by a wide margin |
| Board rows | 20 | `protocol/src/world.ts` | spec §6 |
| Boss grid, window | 3 h, 20 min | `protocol/src/world.ts` | spec §6 |
| Threshold | 500 bp of base | `protocol/src/world.ts` | spec §6: 5% of `BOSS_BASE_HP` = 200 damage, 24 idle ticks for a fresh party, 5 for a day-one party (below) |
| Top bonus | 3 | `protocol/src/world.ts` | spec §6 |
| Boss stats | zone 1's zone boss stats verbatim | `boss_engaged.stats` | hits like the party's own zone boss after the sim's per-zone scaling; a wipe heals in place, so a stronger boss would only loop heals |
| Bot batch | 4 to 6 ticks per 20 s | `bot-config.ts` | 0.2 to 0.3 ticks per second, an idle human's 5 s cadence (record Q6) |
| Bot chat | one line per 6 acts | `bot-config.ts` | 12 bots at 20 s: a line every 10 s virtual, a readable ticker without drowning players |

`BOSS_BASE_HP = 4000`, derived from the sim's combat numbers as measured, not as the static formula gives them. Damage per hit is `max(1, floor(atk × v / 10000) − floor(def / 2))` with `v` uniform in `[9000, 11000]` (`combat.ts:7-10`), so the mean is `atk − floor(def / 2)`; the world boss's def at a party's zone equals that zone's zone boss def (the scaling rule above). The static sum over three heroes overstates a long fight: a fallen hero acts no more (`combat.ts:112-113`) and R1 heals only on a full wipe, so a party that loses one hero fights on with two until a rest (which revives at 30%, `progression.ts:109-115`) or a wipe. The reference party is the spec's pace target (§4.2): the balance harness's 8-hour day (`packages/sim/src/harness/harness.test.ts`, `seed 7, activeShareBp 6000, toolCallEverySec 8, turnLengthSec 90`), replayed with the harness's equip habit, then 2000 ticks of boss mode emulated (one undying enemy with the party's zone boss stats, a wipe undone in place), measured on this tree by the review (`docs/reviews/2026-10-03-phase-3-plan-fix-pass.md`, section 2.3; the Opus leg and codex measured the same):

| Party | Zone, levels | Zone boss atk/def (`content/enemies.ts`) | Static per tick | Sustained per idle tick | With a rest every 20 ticks |
| --- | --- | --- | --- | --- | --- |
| fresh (`createInitialState`) | 1, L1/1/1 | 14 / 4 | 14 | 8.4 (98 wipes in 2000) | 8.7 |
| 8 h, seeds 7 and 11 | 3, L8/8/8 | 38 / 8 | 59 and 55 | 41.3 and 41.6 | 46.1 and 44.2 |
| 40 h, seeds 7 and 11 | 3, L15/15/15 | 38 / 8 | 92 and 89 | 87.8 and 86.0 | 93.5 and 92.2 |
| 120 h, seed 7 | 5, L20/20/20 | 72 / 16 | 106 | 74.9 | 81.7 |
| the fake's bots, mean of `rollBotState(1, i)` | 11 of 12 at zone 1, L4 | 14 / 4 | 28.6 | 23.8 | 26.3 |
| a level-40 party (the suite's "strong" trader) | 1, L40 | 14 / 4 | 201 | 241.7 (min 217, max 262 over 200 ticks) | |

The record sizes the base so the parties present kill it in about 12 minutes of normal ticking, one tick per 5 s (`register.tsx:77`), 144 ticks. The parties present in phase 3 are the fake's bots and early players: the reference party gives `41 × 144 = 5,904`, the bots `24 × 144 = 3,456`. A bot deals 300 ticks per 20-minute window (0.25 ticks per virtual second at any `--speed`), so a bot kills its share of the window only when the base is under `300 × 24 = 7,140`. At `4000`: the reference party kills its share in 98 idle ticks (8.1 minutes; 3.3 in a turn at one tick per 2 s), the bots in 11.2 (10.1 with their rest every fourth batch), a 40-hour party in 3.8, and the default fake (12 bots and one reference player, `13 × 4000 = 52,000` HP against `12 × 5.95 + 8.2 = 79.6` damage per second) in 10.9 minutes. A fresh party alone never kills its share (1,210 in 12 idle minutes) but crosses the 200 threshold in 24 idle ticks (2 minutes; 48 s in a turn). At `6000` the bots take 16.8 minutes and the default fake 16.3; at `8000` neither kills inside the window (21.8 minutes for the default fake), which is why the review lowered it. The number is tuning: change it in `packages/protocol/src/world.ts` only.

## Task list

PR 1: Tasks 1 to 7. PR 2: Tasks 8 to 12.

### Task 1: Protocol: world types, routes, HttpClient, Mirror

**Files:**
- `packages/protocol/src/world.ts` (create): the types, Zod schemas, the PR 1 constants and `weekStartOf` under "`@promptfall/protocol` additions"
- `packages/protocol/src/world.test.ts` (create): `weekStartOf` on a Monday 00:00 UTC, one ms before it, and a Thursday
- `packages/protocol/package.json` (modify): the `"./mirror": "./src/mirror.ts"` export beside `./contract`
- `packages/protocol/src/client.ts` (modify): the three `ServerClient` methods
- `packages/protocol/src/http.ts` (modify): the three routes; `world(auth, since)` sends `query: { since }`; `chat` sends `{ text }`
- `packages/protocol/src/responses.ts` (modify): `WorldResponseSchema`, `BoardsResponseSchema`, re-export `ChatResultSchema`
- `packages/protocol/src/mirror.ts` (create): `Mirror` moved from the suite, unchanged
- `packages/protocol/src/contract/suite.ts` (modify, mechanically): import `Mirror` from `../mirror`; no rule changes here
- `packages/protocol/src/index.ts` (modify): export `world.ts` (types, schemas, constants, `weekStartOf`); not `Mirror`
- `packages/protocol/src/http.test.ts` (modify): one test per new method asserting method, path, query (`since=12`), auth header and body; a `ChatResult` refusal passes through as a value; a snapshot body missing `flags` or `speed` is `ServerError`

**Interfaces:**
- Consumes: today's protocol.
- Produces: `WorldSnapshot`, `ChatMessage`, `ChatResult`, `ChatRefusal`, `BossView`, `Boards`, `BoardRow`, their schemas, the PR 1 constants, `weekStartOf`, `ServerClient.world|chat|leaderboards`, `ROUTES.world|chat|leaderboards`, `Mirror` at `@promptfall/protocol/mirror`.

**Work:** Schemas are the contract on both ends; `HttpClient` parses each new response with its schema. No platform globals in `world.ts` or `http.ts` (`mirror.ts` is not bundled, so `crypto.randomUUID()` stays). `BossView` is defined in full now so PR 2 adds no protocol shape for the snapshot.

**Acceptance check:** `pnpm --filter @promptfall/protocol test` green; `pnpm exec tsc -b packages/protocol` clean. Red before: `http.test.ts` cannot find `world` on `HttpClient`. Expected red elsewhere after this task: `pnpm typecheck` fails in `packages/ledger` (the ledger does not implement the new methods) until Task 2.

**Boundaries:** No ledger logic. Do not touch `servers/fake` or the plugin. Do not add a contract rule here.

- [x] `world.ts` with types, schemas, constants and `weekStartOf`; `world.test.ts`; `ServerClient`, `ROUTES`, `responses.ts`
- [x] `mirror.ts` and the `./mirror` export; the suite imports it; `pnpm --filter @promptfall/protocol test` still green
- [x] `http.test.ts` red for the three methods, then `http.ts` green; commit `feat(protocol): world snapshot, chat, leaderboards, Mirror in the package root`

### Task 2: Ledger: presence, chat, leaderboards, flags, blocklist; contract rules 25 to 32

**Files:**
- `packages/ledger/src/blocklist.ts` (create): as under "`@promptfall/ledger` additions"
- `packages/ledger/src/world.ts` (create): presence, `world`, `chat`, `leaderboards`, `offerZone`, over a `WorldContext = { books, now, flags, presence: Map, ttl }`; the numbers and `weekStartOf` imported from `@promptfall/protocol`
- `packages/ledger/src/ledger.ts` (modify): `LedgerFlag`, `presenceTtlMs`, the six resolved flags, the three public methods, `offerZone` in `submit` step 9 and `mint`
- `packages/ledger/src/books.ts` (modify): `AccountRecord.chat?`; `publicName(record)`
- `packages/ledger/src/market.ts` (modify): `nameOf` uses `publicName`
- `packages/ledger/src/index.ts` (modify): export `isBlocked`, `BLOCKED_WORDS`
- `packages/ledger/src/world.test.ts` (create): `isBlocked` whole-word (`heckle` passes, `Heck!` refuses); `publicName` strips a control character (`'Ash\u001bgrove'` reads `Ashgrove`) and reads `adventurer` for a name that is empty after stripping; the bucket's whole-period refill; `offerZone` keeps 20 rows, replaces a lower row of the same account, and refreshes the name of a row at the same value; a blocked display name reads `adventurer` in a listing's `sellerName`
- `packages/protocol/src/contract/suite.ts` (modify): rules 25 to 32 below
- `packages/ledger/src/ledger.contract.test.ts` (modify): nothing, unless the runner needs `presenceTtlMs`

**Interfaces:**
- Consumes: Task 1.
- Produces: the social half of `ServerClient` on the in-process host; `publicName`; the storage keys.

**Work:** Contract rules, each run against both hosts through `make` (the HTTP runner passes rules 25 to 32 only after Task 3). The rules import `PRESENCE_TTL_MS`, the `CHAT_*` constants, `BOARD_ROWS` and `weekStartOf` from `../world`, never a literal:

- rule 25, presence: two minted linked traders A and B (`host.mint`, names `Ashgrove`, `Brindle`). A polls with `since 0`: `online 1`, `zones [{ zone: 1, count: 1 }]`, `here []`. B polls: `online 2`, `here ['Ashgrove']`. `clock.advance(45_000)`; B polls: `online 1`, `here []` (A expired; the TTL is open at the far end). A second account's two sessions are one entry: A polls twice, B's `online` is still 2.
- rule 26, chat gates: an unlinked account gets `not_linked`; with `{ 'chat.enabled': false }` a linked one gets `chat_closed`, the snapshot's `flags['chat.enabled']` is `false` and its `chat` is `[]`.
- rule 27, length and characters: 201 characters `too_long`; 200 `ok`; 101 emoji (`'😀'.repeat(101)`, 202 UTF-16 units) `too_long` and 100 `ok`, and the next poll parses; `'   '` `empty`; `'  hi  '` is stored as `hi`; `'hi\u001b[31m'` is stored as `hi[31m`; `'\n\t'` is `empty`; the answer's `message` equals the next poll's last message.
- rule 28, rate: five posts `ok`, the sixth `rate_limited`; `clock.advance(10_000)` allows one more; `clock.advance(50_000)` allows five.
- rule 29, blocklist: `'what the heck'` is `blocked` and the history is unchanged; a trader minted with the name `heck` posts as `adventurer` and shows in `here` as `adventurer`.
- rule 30, history: 60 messages (five, advance 50 s, repeat) then a poll with `since 0` answers the last 50 ascending; `since` = the 55th id answers the 5 newer ones; 210 messages in total: `since 0` answers ids 161 to 210, and `since 1` answers the same 200 kept.
- rule 31, highest zone: A is minted with `highestZone 5` and commits a tick; `leaderboards()` lists A first with `value 5`, then B with 1; 25 minted accounts at zones 2 to 26 leave 20 rows and B out; with `{ 'leaderboards.enabled': false }` both lists are `[]`; a blocked name reads `adventurer`; a fresh bootstrapped account that commits a tick, then links (`linkStart`, `linkPoll`), then commits another tick at the same zone shows its login, not `adventurer`; `weekStart` equals `weekStartOf(clock)`.
- rule 32, presence off: with `{ 'presence.enabled': false }` a poll answers `online 0`, `zones []`, `here []`, `flags['presence.enabled'] false`, and a second account sees nobody.

**Acceptance check:** `pnpm --filter @promptfall/ledger test` green with rules 0 to 32 and `world.test.ts`; `pnpm exec tsc -b packages/ledger` clean. Red before: the ledger does not compile against Task 1's `ServerClient`.

**Boundaries:** No boss code (PR 2). No HTTP routes. No plugin. `pf:chat` and `pf:boards` are the only new keys.

- [x] `blocklist.ts`, `publicName`; `world.test.ts` red then green
- [x] Presence, `world()`, flags; rules 25 and 32 red then green over the in-process host
- [x] Chat; rules 26 to 30
- [x] Boards, `offerZone` in `submit` and `mint`; rule 31; commit `feat(ledger): presence in memory, chat with a blocklist and a bucket, leaderboards, phase 3 flags`

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

**Acceptance check:** `pnpm --filter @promptfall/fake-server test` green: rules 0 to 32 over HTTP plus `server.test.ts`. Then `devserve run --port 7778 --ttl 5 -- pnpm fake --port 7778 --data /tmp/pf-p3.json --flag chat.enabled=false --bots 0` (it detaches, confirms the process is alive and returns with `pid=… port=… log=…`; the log holds the startup line ending in `flags chat.enabled=false`), and `curl -s 'localhost:7778/v1/world' -H 'authorization: Bearer <token from a bootstrap curl against 7778>'` answers a snapshot whose `flags` has `"chat.enabled":false`; `devserve stop 7778`; paste the startup line and the snapshot in the commit body. 7777 is Kevin's own fake and is never used by a check. Red before: rules 25 to 32 are 404 over HTTP.

**Boundaries:** No bot changes (Task 4). No plugin.

- [ ] `flags.ts` with its test; `--flag` in the CLI
- [ ] Routes; `server.test.ts`; the suite green over HTTP; run the acceptance check; commit `feat(fake-server): world, chat and leaderboards routes; --flag`

### Task 4: Bots as HTTP clients

**Files:**
- `servers/fake/src/bots.ts` (modify): the design under "`servers/fake` additions"
- `servers/fake/src/bot-config.ts` (modify): the new constants, `fill` in the weights, `BOT_LINES`
- `servers/fake/src/cli.ts` (modify): construct `new HttpClient({ baseUrl, fetch: nodeFetch })` after `listen`; pass `host: server.ledger.host`; the scheduler interval
- `servers/fake/src/bots.test.ts` (modify): every case runs over a listening `createFakeServer` on port 0 (as `server.contract.test.ts` does) with a manual clock; keep the population and determinism cases; replace the phase 2 assertions with: after 36 ticks (three rounds of 12 bots) every bot's committed `seq` is at least 3 and its `tick` counter rose; the snapshot from a viewer account reports `online 13` (the 12 bots and the viewer, whom the poll stamps too) and at least two zones; after 120 ticks (a bot's first chat line is its sixth act, tick `60 + i`) the chat history holds lines from at least two bot names, there are listings of both kinds, at least one order, at least one sale, and the collected `log` lines hold at least one `bot <name> fill ok` (an `order_filled` logs a `trade bought` entry, `server-events.ts:104-110`, which a plain buy logs too, so the fill is observed through the log); bots never call `host.settle` (the test wraps `host` and asserts)
- `servers/fake/src/bot-seed.ts`: unchanged

**Interfaces:**
- Consumes: `HttpClient`, `Mirror`, `LedgerHost.mint|credit`, the routes of Task 3.
- Produces: bots that heartbeat, batch, trade, fill and chat over HTTP.

**Work:** The mirror is the bot's whole client state; it never reads the ledger or the store beyond `pf:bot:<i>`. The seeded xorshift per bot stays; all draws (batch size, action, line) come from it so a seed repeats. On a thrown call the act ends and the next tick retries from the mirror as it is (a lost ack is answered `duplicate` or `seq_mismatch` and adopted; both are handled). `fill` needs no prior `matchingOrders` cache: it asks per item.

**Acceptance check:** `pnpm --filter @promptfall/fake-server test` green with the new `bots.test.ts`. Then `devserve run --port 7778 --ttl 5 -- pnpm fake --port 7778 --speed 10 --data /tmp/pf-bots3.json` and after 60 seconds `curl -s 'localhost:7778/v1/world' -H 'authorization: Bearer <token from a bootstrap curl against 7778>' | head -c 600` shows `"online":13` (12 bots and the curl's account) and chat lines with bot names; `devserve stop 7778`; paste it in the commit body. Red before: `bots.test.ts` cannot construct `startBots` with `client`.

**Boundaries:** Bots use `host.mint`, `host.credit` and `HttpClient` only; no `ledger.*` call, no `kv` write but `pf:bot:<i>`. No plugin changes. No boss logic.

- [ ] `bot-config.ts`; `bots.ts` over `client` and `Mirror`; the batch and heartbeat cases red then green
- [ ] Market actions with `fill`, chat lines, stipend, re-mint on an old sim version; the rest of the test; CLI wiring
- [ ] Run the acceptance check; commit `feat(fake-server): bots are HTTP clients that batch, fill, chat and heartbeat`

### Task 5: Plugin: the world poll, the World tab, in-process flags

**Files:**
- `scripts/vendor.mjs` (no change expected; run `pnpm vendor`): the bundles carry `world.ts` and `blocklist.ts`, not `mirror.ts`
- `plugins/promptfall/hooks/world.ts` (create): `WorldPoller` per the contract and the four constants; the `WorldState` type and `WORLD_DEFAULT` are declared elsewhere (below), not here
- `plugins/promptfall/hooks/state.ts` (modify): `WORLD_DEFAULT: WorldState`
- `plugins/promptfall/types/index.d.ts` (modify): `WorldState`, `PluginState.promptfall.world: WorldState`, `AccountView` gains `chatOpen: boolean`, `presenceOpen: boolean`, `leaderboardsOpen: boolean`, `bossOpen: boolean` from the bootstrap config (the fallback `gates` uses before the first snapshot)
- `plugins/promptfall/hooks/register.tsx` (modify): the `world` atom in both `Io.publish` literals (session.start and session.attach, `register.tsx:516-530` and `566-580`); `GameSession` owns the poller (start, cadence, the in-flight guard, `chatSeenAt`, `chat` with its outage check, `leaderboards`); `useServer` resets the `world` atom; `GameHandle` gains `chatSeen(now)`, `chat(text): Promise<ChatResult>`, `leaderboards(): Promise<Boards | Unauthorized>`
- `plugins/promptfall/hooks/engine.ts` (modify): `GameHandle` type additions; `isUnreachable()` and `serverConfig()` already exist
- `plugins/promptfall/hooks/engine.test.ts` (modify): `Recorder implements ServerClient` (line 28) gains `world`, `chat`, `leaderboards` stubs, or the plugin does not type-check against the vendored interface
- `plugins/promptfall/hooks/server.ts` (modify): the in-process `Ledger` gets `flags: { 'chat.enabled': false, 'worldboss.enabled': false }`
- `plugins/promptfall/hooks/view.ts` (modify): `toAccountView` reads the four flags from the config; `gates(world, account)` per the world-poll contract
- `plugins/promptfall/hooks/ui/trade.ts` (modify): `gateText(view, world)` reads `gates(world, view.account).marketOpen`; its three callers pass the `world` atom
- `plugins/promptfall/hooks/ui/band.tsx` (modify): the World tab's three rows per record §1.10, the flags through `gates`: (1) `${online} online · zone ${zone}: ${here.join(', ')}`, `nobody else here` when `here` is empty, `presence is off` when the flag is off, dim when `stale`; (2) `highest zone N · kills K · wipes W` (the boss line is Task 11); (3) the chat ticker `${name}: ${text}` from the last message held, `chat is quiet` when none, `chat is closed` when the flag is off. The line `Multiplayer arrives in phase 2` goes. Without a snapshot yet, row 1 reads `connecting to the world…` dim.
- `plugins/promptfall/hooks/band.test.ts` (modify): the World tab shows `1 online` and `chat is closed` on the in-process host; a stale snapshot dims row 1; a snapshot whose `flags['chat.enabled']` is false shows `chat is closed` even when the bootstrap config said true
- `plugins/promptfall/hooks/register.test.ts` (modify): against `/promptfall server http://test` with `on('http.fetch')` answering a bootstrap and canned snapshots: a poll goes out within 15 s of start and every 15 s after (`GET /v1/world?since=0`, then `since=<last id>`); the `world` atom holds the snapshot and the messages, and `clock.speed` equals the snapshot's `speed`; a snapshot with a boss whose `hp > 0` switches the period to 5 s and `boss: null` or `hp 0` switches it back (assert through the recorded `clock.every` periods); while a poll's fetch is held, the next timer tick sends no second `GET /v1/world`; a snapshot repeating an id already held adds no duplicate to `messages`; a throwing world fetch sets no notice and leaves the band ticking; after 45 s without a success `stale` is true and the next success clears it; a secondary session polls too (two sessions, the second with `mode secondary`, both fetch `/v1/world`); a secondary whose `server` store key changes under it (another session switched) resets the atom and polls the new base URL; `/promptfall server local` resets the atom; the in-process host's snapshot has `flags['chat.enabled'] === false`
- `plugins/promptfall/hooks/golden.test.ts`: unchanged (no sim change)

**Interfaces:**
- Consumes: Tasks 1 and 2 through the vendor bundles.
- Produces: the `world` atom, `GameHandle.chatSeen|chat|leaderboards`, the World tab rows, the in-process flags.

**Work:** Follow the world-poll contract verbatim for cadence, the in-flight guard, failure handling, chat buffering and the stale rule; the poller's internal layout is yours. The band's World tab reads the `world` atom beside `view`; the band module declares the atom with `WORLD_DEFAULT` (the validate scan reads atoms where they are declared, see `hooks/state.ts`'s comment). Every gate reads `gates(world, view.account)`: the snapshot's flags once there is one, the bootstrap config before, so a restarted fake's flags reach the dialog within one poll.

**Acceptance check:** `pnpm vendor && pnpm vendor:check` clean; `claude plugin validate plugins/promptfall` lists the same `$` calls as phase 2 and no new namespace; `claude plugin test plugins/promptfall` green including the new register and band tests; `pnpm exec tsc -p plugins/promptfall` clean. If `claude plugin test` refuses with "hooks modules are turned off ... rollout switch", start `claude` once with network access and run it again. Red before: the plugin does not type-check against Task 1's `ServerClient` (the `Ledger` bundle and `HttpClient` changed).

**Boundaries:** No dialog tabs (Task 6). No boss display. No change to the lease, the flush path or the outage rules.

- [ ] `pnpm vendor`; mechanical type fixes including the `Recorder` stubs; `server.ts` flags; `toAccountView` flags; `gates`; `gateText(view, world)`
- [ ] `world.ts`, the `world` atom in both `Io` literals, `GameSession` wiring, the reset in `useServer`; `register.test.ts` red then green for cadence, the in-flight guard, failures, stale, secondary, the followed switch
- [ ] World tab rows; `band.test.ts`; run the acceptance check; commit `feat(plugin): world poll, World tab presence and chat ticker, in-process flags`

### Task 6: Plugin: Chat and Leaderboards tabs, commands, README

**Files:**
- `plugins/promptfall/types/index.d.ts` (modify): `DialogTab` adds `'chat' | 'leaderboards'`; `ChatState = { draft: string; busy: boolean; error: string | null }`; `BoardsState = { boards: Boards | null; busy: boolean; error: string | null }`; `PluginState.promptfall.chat`, `.boards`
- `plugins/promptfall/hooks/state.ts` (modify): `CHAT_DEFAULT`, `BOARDS_DEFAULT`
- `plugins/promptfall/hooks/ui/chat.tsx` (create): `chatBody(els, view, world, chat, now, actions)`; `postChat(game, text, updChat, after)`
- `plugins/promptfall/hooks/ui/leaderboards.tsx` (create): `boardsBody(els, view, world, boards)`; `loadBoards(game, updBoards, after)`
- `plugins/promptfall/hooks/ui/dialog.tsx` (modify): tabs `c` Chat and `b` Leaderboards appended to `TABS` (`dialog.tsx:37-44`); `openTab('leaderboards')` calls `loadBoards`; the Chat tab render calls `game.chatSeen(now)`
- `plugins/promptfall/hooks/command.ts` (modify): `chat`, `leaderboards` args; the argument hint; opening on `leaderboards` loads the boards as `market` loads listings
- `plugins/promptfall/hooks/register.tsx` (modify): the `chat` and `boards` atoms in both `Io.publish` literals; `clearDialog`/`restart` reset them
- `plugins/promptfall/hooks/ui/trade.ts` (modify): `GATE_CHAT_CLOSED = 'Chat is closed.'`, `GATE_BOARDS_CLOSED = 'Leaderboards are closed.'`; `chatRefusalText(reason)`, its numbers from the vendored protocol constants, never literals: `too_long` → `` `Too long: ${CHAT_MAX_CHARS} characters at most` ``, `rate_limited` → `` `Slow down: ${CHAT_BUCKET_CAPACITY} quick messages, then one every ${CHAT_REFILL_MS / 1000} seconds` ``, `blocked` → `That word is not allowed here`, `empty` → `Nothing to send`, `not_linked` → `GATE_UNLINKED`, `chat_closed` → `GATE_CHAT_CLOSED`, `unauthorized` → `Session expired: /promptfall server <url> again` (a token the server no longer knows, as after a fresh `--data`; a secondary is not `unauthorized`, it posts)
- `plugins/promptfall/hooks/dialog.test.ts` (modify): against `/promptfall server http://test` with canned bodies: the Chat tab lists the held messages newest at the bottom and shows the compose input on terminal and desktop; Enter posts `POST /v1/chat` with `{ text }`, the message appears before the next poll, and the box is empty again; a `too_long` refusal flashes `Too long: 200 characters at most` for 5 s; a throwing chat fetch flashes `Server unreachable` and sets no band notice; with the engine in an outage (a held then failed submit, as `engine.test.ts` drives one) Enter flashes `Server unreachable` and no `POST /v1/chat` goes out; with the snapshot's `flags['chat.enabled']` false the tab reads `Chat is closed.` and has no input, whatever the bootstrap config said; unlinked reads `GATE_UNLINKED`; the read-only branch is tested by calling `chatBody` directly with an `els` whose `Input` is `undefined` (how `dialog.tsx:117` builds it when the surface's table lacks one; `SURFACES` in `dialog.test.ts:8` is `['terminal', 'desktop']` and no test mounts a surface without `Input`): the body has no input and carries the line `Posting needs a terminal or the desktop app.`; a secondary session can post; the Leaderboards tab fetches `GET /v1/leaderboards` on open, lists the zone counts from the snapshot, the two lists, and highlights the row whose `accountId` is the session's; closed reads `Leaderboards are closed.`; `/promptfall chat` and `/promptfall leaderboards` open on those tabs
- `plugins/promptfall/README.md` (modify): commands table (`chat`, `leaderboards`), the hotkeys table (`c`, `b` in the dialog column), a "World" section (World tab rows, Chat tab rules and refusals, Leaderboards tab), "What it lacks" rewritten (no world boss yet in PR 1; sprites and sound; mute and ban)

**Interfaces:**
- Consumes: Task 5's handle and atom.
- Produces: the phase 3 dialog tabs.

**Work:** Chat tab: the messages the pane fits (the pane opens with `rows: 20`; show the last 14 of `world.messages`, each `name: text` clipped to the width, dim names), newest at the bottom; below them the compose `Input`, controlled: `key="chat-compose"`, `value={chat.draft}`, `onInput` writes `draft`, `autoFocus`, `submitLabel="send"`, `onSubmit(text)` → `postChat`, which refuses an empty trimmed text locally with the `empty` flash and otherwise calls `game.chat(text)`; on `ok`, `draft = ''`, so the next draw clears the box without a remount (the d.ts: `value` is "the text the field holds when drawn; the person's typing replaces it until the hook draws another", E:5159-5200; a remount under a new `key` would move the focus ring, since `key` is the element's address); on a refusal `flash(updChat, after, chatRefusalText(reason))`, on a throw `flash(errorText(error))`. `autoFocus` puts the ring in the box when `/promptfall chat` opens the pane with focus (E:5190), which is what part A step 4 types into; the manual pass preamble already says a focused `Input` takes every printable key. The gate line (`GATE_CHAT_CLOSED` from `gates(world, view.account).chatOpen`, else `GATE_UNLINKED` from `view.account.linked`) stands in place of the input; the messages still show. Mobile (no `Input`): the read-only line. Leaderboards tab: `Online by zone: z1 3 · z2 6 · z3 4` from `world.snapshot.zones` (or `nobody online` / `presence is off`), then `Highest zone` rows `rank. name  zone N`, then `Boss damage this week` rows `rank. name  N` (`no boss damage yet this week` when empty), your row in cyan; `busy` shows `loading…`; errors flash as the market's do. Both tabs read `world` for the snapshot and never poll themselves.

**Acceptance check:** `pnpm vendor:check` clean; `claude plugin validate plugins/promptfall` unchanged; `claude plugin test plugins/promptfall` green with the extended dialog tests; `pnpm exec tsc -p plugins/promptfall` clean. Red before: `dialog.test.ts` cannot find the Chat tab.

**Boundaries:** No band change. No boss. No new `$` namespace. The chat path never calls `trade` or `sync`.

- [ ] Note, answered by the review from the d.ts (`plugins/promptfall/.claude-plugin/types/claude-code/index.d.ts`, `InputProps` at E:5159-5200): `Input` takes `value`, so the box is controlled and cleared through it; no remount, no `composeKey`. `ui/orders.tsx:228-238` is the pattern.
- [ ] Types (`ChatState.draft`, `CHAT_DEFAULT`), atoms, tabs, command args; `dialog.test.ts` red for the Chat tab
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
4. **Chat.** `/promptfall chat`: the last messages, newest at the bottom, bot lines arriving every few seconds, the cursor already in the compose box; type `hello` and Enter: your line appears at once with your name and the box is empty. Paste a 201-character line: `Too long: 200 characters at most` in red for 5 seconds, nothing posted. Send short lines quickly: the fifth or sixth (the `hello` spent one token) reads `Slow down: 5 quick messages, then one every 10 seconds`. Send `what the heck`: `That word is not allowed here`.
5. **Leaderboards.** Press `b`: `Online by zone` with counts summing to 13, `Highest zone` with the bots' names at zone 1 or 2 (they start near zone 1 and climb as they play) and your row highlighted at zone 1, `Boss damage this week` reading `no boss damage yet this week`. `/promptfall leaderboards` opens the same tab.
6. **Kill the fake.** Ctrl-C it. The band's status row reads the retrying notice within 15 seconds as in phase 2; after 45 seconds the World tab's first row is dim (stale); a chat post flashes `Server unreachable`; the band keeps ticking.
7. **Bring it back.** Restart with the same `--data`: within 15 seconds the World tab is bright again and the chat tail resumes with no gap in what you can see.
8. **Two sessions.** Open a second `claude --plugin-dir plugins/promptfall` in a third terminal: its band reads `playing in another session`; `/promptfall chat` there still posts (a line from the secondary shows in the first terminal within 15 seconds); the online count in both stays 13 (one entry per account).
9. **Backgrounded terminal.** Both sessions are one account, so the online count cannot show whether a hidden session's timers fire. Instead, hide or minimise the first terminal (the primary) for 2 minutes and watch the third terminal's band: if it keeps reading `playing in another session`, the hidden primary kept renewing its 30 s lease, so its timers fire while backgrounded; if within about 45 seconds it starts ticking as the primary, the lease lapsed and they do not. Bring the first terminal back (it becomes the secondary if it lost the lease). Write which it was into `docs/manual-pass/phase-3.md` under a "Findings" heading; it settles the record's open item on idle timers.
10. **Snapshot size.** `curl -s 'localhost:7777/v1/world' -H 'authorization: Bearer <a token from .promptfall/fake.json>' | wc -c`: under 16000 bytes with a full chat tail. Note the number under "Findings" (the record's open item on response size).
11. **A flag off.** Stop the fake, start it with `--flag chat.enabled=false`: within 15 seconds the band's row 3 reads `chat is closed` and the Chat tab reads `Chat is closed.` with no compose box; the Leaderboards still load. Restart without the flag.
12. **In-process.** `/promptfall server local`: the World tab reads `1 online · zone N: nobody else here` and `chat is closed`; the Chat tab says `Chat is closed.`; the Leaderboards tab lists you alone.

Then open the PR from `feat/phase-3` into `ai-staging` titled `Promptfall phase 3, PR 1: presence, chat, leaderboards, bots over HTTP`, body: what landed, the verification commands and their results, the manual pass pointer, the review legs (`reviewer` on Opus and `codex-review`), the attribution lines. Stop and hand Kevin part A.

**Acceptance check:** `pnpm lint && pnpm typecheck && pnpm test && pnpm vendor:check && pnpm exec tsc -p plugins/promptfall && claude plugin test plugins/promptfall` green in one run, pasted in the PR body; `gh pr view --json url` shows the PR.

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
- `packages/sim/src/loot.ts` (modify): `rollRewardItem` (`pushLog` in `heroes.ts` is typed `GameState['lootLog'][number]`, `heroes.ts:53`, so it needs no change)
- `packages/sim/src/server-events.test.ts` (modify): "covers nine kinds" (line 61) becomes twelve
- `packages/sim/src/index.ts` (modify): export `rollRewardItem`, `Stats` is already exported
- `packages/sim/src/golden.ts`, `golden.test.ts` (modify): `goldenEvents()` inserts `boss_engaged { bossId: 'wbgold', name: 'Golden Wyrm', glyph: '☠', stats: { hp: 630, atk: 14, def: 4, spd: 5 } }` after turn 3's `turn_end` and `boss_disengaged { bossId: 'wbgold' }` after turn 6's, and `rewarded { bossId: 'wbgold', goods: { kind: 'item', item: <a fixed rare steel_longsword with id 'r0'> }, gold: 45 }` after turn 7's; the script stays 300 events; new `GOLDEN_HASH`
- `packages/sim/src/determinism.test.ts` (modify): `randomServerEvent` draws `boss_engaged` (when `s.boss === null`, else a second one to exercise `already_engaged`), `boss_disengaged` (the live id, or `'wbjunk'` one time in ten), `rewarded` (an item, or `goods: null` with gold); the share of server events rises from 4% to 8% so boss stretches last long enough for ticks to land on the boss
- `packages/sim/src/boss.test.ts` (create): `boss_engaged` replaces an encounter of three wave enemies and a queue with one `world_boss`, keeps `pendingTurnBoss`; 20 ticks raise `dealt`, change no XP, gold, kills or inventory, and leave the enemy's `hp` at `maxHp`; a tool call spawns nothing and counts toward `turnToolCalls`; a party beaten to 0 HP is healed in place with `zone`, `wipes`, `encounter` and a set `pendingParty` unchanged and no `wipe` effect; `rest` heals and revives a fallen hero at 30%; `boss_disengaged` clears the encounter and the next tick spawns a wave (or the pending turn boss); `boss_disengaged` with the wrong id is `not_engaged`; `rewarded` inserts the item, adds the gold, logs `reward`, emits `rewarded`; `rewarded` into a full inventory is `inventory_full`; `scaledBossStats` at zone 1 equals the carried stats plus the spd offset and at zone 5 equals `72 / 14`-scaled atk and `16 / 4`-scaled def (`content/enemies.ts` baselines); `rollRewardItem(7, 3, ['knight','black_mage','white_mage'])` is a base with `minZone <= 3` wearable by one of those classes, with `id ''`, and the same seed gives the same item
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

**Work:** Rules 33 to 40, each over `make` with the suite's clock, red until Task 10. The rules import `BOSS_GRID_MS`, `BOSS_WINDOW_MS`, `BOSS_BASE_HP`, `BOSS_THRESHOLD_BP`, `BOSS_TOP_BONUS` and `weekStartOf` from `../world`. The clock starts at `1_700_000_000_000`, which is not on the 3 h grid (`1_700_000_000_000 mod 10_800_000 = 4_400_000`, 73 minutes past a grid point and past that point's 20-minute window); `nextGrid = 1_700_000_000_000 + 10_800_000 − 4_400_000`. A "strong" trader is `host.mint` of `traderState` with its three party heroes at level 40 and 50 000 gold; at zone 1 a level 40 party deals about 240 per tick against def 4 (measured over 200 ticks: 217 to 262; the static formula says 201, but the white mage never needs to heal there), so 20 ticks deal under `2 × BOSS_BASE_HP = 8000` and 60 ticks deal over it. A "fresh" trader is `traderState` as minted (about 8 to 14 per tick). The tick bucket holds 70 and refills one per 2 s (`client.ts:102-107`), so a second batch of 60 needs `clock.advance(120_000)` first.

- rule 33, the grid: two traders, A and B; a poll from each before `nextGrid` answers `boss: null`; `clock.advance` to `nextGrid − 10_000`; both poll again (their stamps are now inside the TTL at the grid point); `clock.advance(10_000)`; A's poll answers a boss with `bossId 'wb' + (nextGrid / 10_800_000).toString(36)`, `maxHp === hp === 2 × BOSS_BASE_HP`, `spawnedAt nextGrid`, `endsAt nextGrid + BOSS_WINDOW_MS`, `yours 0`, and A's `account()` delivery carries one `boss_engaged` whose `stats` equal `content.enemies[content.zones[0].boss].stats` (`bandit_captain`, `{ hp: 630, atk: 14, def: 4, spd: 5 }`); a second poll adds no event; B was engaged at the spawn too (its stamp was inside the TTL), so its `account()` delivery carries one `boss_engaged` without B polling; a third trader minted after the spawn is engaged on its first poll.
- rule 34, contribution: A (strong) applies the engaged event in its mirror, builds a batch of 20 ticks, submits: `ok`; the snapshot's `hp` fell by exactly `mirror.local.boss.dealt`, `yours` equals it; `leaderboards().damage` lists A with that value.
- rule 35, the kill: A strong, B fresh, both engaged and both mirrors holding `boss_engaged`; B commits one tick (a contribution under the threshold); A commits batches of 60 ticks, `clock.advance(120_000)` before each after the first, until an ack's delivery carries `boss_disengaged` (at `BOSS_BASE_HP` 4000 the first batch kills: 60 × 217 > 8000): that ack's delivery carries, in order, two `rewarded` for A (threshold and top 3; each with `goods.kind 'item'`, an `r`-prefixed id, `gold > 0`) then `boss_disengaged`; A's mirror applies them and hashes match the next ack; B's `account()` delivery carries one `rewarded` (B is one of two contributors, so in the top 3; the bonus has no threshold, spec §6) then `boss_disengaged`; the snapshot now shows `hp 0` and the same `bossId`; after `clock.advance(BOSS_WINDOW_MS)` it is `null`; a tick A commits after the kill adds nothing to `yours` or the board. `yours` after the kill equals A's whole delta, which may exceed `maxHp` (overkill counts in full).
- rule 36, threshold and returns: C, minted with a full inventory (30 common items) and strong, commits 3 ticks (over the threshold) and the boss is killed by A: C's delivery carries two `rewarded { goods: null, gold > 0 }` (threshold and top 3, both items into returns), `account().returns === 2`, and a batch vendoring one item gets one `returned` with `listingId === bossId` in its own ack, leaving `returns === 1`.
- rule 37, expiry: a boss with A (strong) engaged committing 3 ticks (over the threshold) and B (fresh) committing one (under it); `clock.advance(BOSS_WINDOW_MS)`; A's poll answers `boss: null`, A's delivery carries exactly one `rewarded` (no bonus on expiry) then `boss_disengaged`; B's carries `boss_disengaged` only.
- rule 38, flag off: with `{ 'worldboss.enabled': false }` the poll after `nextGrid` answers `boss: null` and no account is engaged.
- rule 39, the weekly board: after rule 34's contribution, `leaderboards().weekStart` equals `weekStartOf(now)`; `clock.advance` to the next Monday 00:00 UTC; `damage` is `[]` and `weekStart` moved (a read, so nothing was written: a second read answers the same).
- rule 40, restart mid-boss (host rule, skipped without `host`; the HTTP runner gives `make` a shared `MemoryKeyValue` through a second `make` call with the same options): a second host over the same store and clock answers the same `bossId`, `hp`, `endsAt` to a poll, with `online` rebuilt from that poll alone.

For rule 40 `ContractMake` gains an optional `options.kv?: KeyValue`; the two runners pass it to their ledger when given (`options.kv ?? new MemoryKeyValue()`), which is Task 10's change to them (they compile unchanged here, since the option is optional).

**Acceptance check:** `pnpm --filter @promptfall/protocol test` green; `pnpm exec tsc -b packages/protocol` clean. Red before: `schemas.test.ts` fails on `boss_engaged`. Expected red after: rules 33 to 40 fail on both hosts until Task 10.

**Boundaries:** No ledger code. No plugin.

- [ ] Schemas and their test; commit `feat(protocol): boss and reward event schemas`
- [ ] Rules 33 to 40 (red); `ContractMake.kv`; commit `test(contract): world boss rules 33 to 40`

### Task 10: Ledger: the boss record, schedule, contribution, rewards, weekly damage

**Files:**
- `packages/ledger/src/boss-config.ts` (create): `WORLD_BOSSES` under "`@promptfall/ledger` additions"; the numbers come from `@promptfall/protocol`
- `packages/ledger/src/boss.ts` (create): `advanceBoss`, `engage`, `disengage`, `contribute`, `settleBoss`, the `BossRecord` key, `toBossView`
- `packages/ledger/src/ledger.ts` (modify): `advanceBoss` first in `world` and `sweep`, before any record load, and nowhere else; `prevDealt` captured before the replay assignment and `contribute` after `settle(record)` in `submit` step 9; `worldboss.enabled`
- `packages/ledger/src/world.ts` (modify): `boss` in the snapshot (shown while `now < endsAt`); engage on poll through `engage`
- `packages/ledger/src/ids.ts` (modify): prefix `'r'`
- `packages/ledger/src/index.ts` (modify): export `WORLD_BOSSES`
- `packages/ledger/src/ledger.contract.test.ts` (modify, line 9) and `servers/fake/src/server.contract.test.ts` (modify, line 16): `kv: options.kv ?? new MemoryKeyValue()`, for rule 40
- `packages/ledger/src/boss.test.ts` (create): `bossId` and name for a grid index; `maxHp` with 0 online is `BOSS_BASE_HP`; a contribution past the remaining HP floors at 0 and counts in full; `settleBoss` rolls for the top 3 among ties by account id and gives one roll to the fourth, and gives a top-3 contributor under the threshold its one bonus roll; an account whose record is no longer current (a v2 state) is skipped without a throw; `rollRewardItem` is called with the contributor's zone and party classes; a null roll pays `rewarded { goods: null, gold }` and queues nothing. The lifecycle, one case each: (1) a stored open boss whose window passed, then a clock on a later grid point: one `advanceBoss` authors `rewarded` (where due) and `boss_disengaged` with the old id to every contributor, then `boss_engaged` with the new id to the online ones, and the new record is open; (2) `engage` on an account whose `state.boss` names a stale id authors disengage then engage without a throw, and on one already engaged with this id authors nothing; (3) `settleBoss` over a contributor whose `state.boss` is already null closes the boss without a throw and settles the others; (4) an open boss with `{ 'worldboss.enabled': false }`: the next `advanceBoss` settles it as expired (threshold drops only), disengages everyone, spawns nothing; (5) `submit` as the first operation after a grid point spawns nothing and the next `world()` does; (6) a killing `submit`: the record reloaded from the store after the ack holds the `rewarded` events and `boss_disengaged`, and the ack's delivery carried them
- `servers/fake/src/bots.ts` (modify): nothing but a comment: the mirror applies `boss_engaged`, so bots fight through their batches
- `servers/fake/src/bots.test.ts` (modify): one case: the clock advanced onto a grid point, 12 bots act for three rounds, the snapshot's `hp` is below `maxHp` and the damage board has bot rows
- `servers/fake/src/boss-in.ts` (create): `bossInRebase(virtualNow: number, seconds: number, speed: number): number | null`: `next = (floor(virtualNow / BOSS_GRID_MS) + 1) × BOSS_GRID_MS`, `target = next − seconds × 1000 × speed`; `target` when `target > virtualNow`, else null (the next grid point is already nearer than asked)
- `servers/fake/src/boss-in.test.ts` (create): `bossInRebase(1_700_000_000_000, 60, 10)` is `1_700_005_800_000` (`nextGrid − 600_000`); `bossInRebase(1_700_006_399_000, 60, 10)` is null
- `servers/fake/src/cli.ts` (modify): `--boss-in <seconds>` (a positive integer): the persisted clock is read as today, the virtual now computed as `VirtualClock` would (`virtualAt + (Date.now() − realAt) × speed`, or `Date.now()` without a snapshot), and when `bossInRebase` answers a target the clock is constructed from `{ virtualAt: target, realAt: Date.now() }` instead; the clock only ever moves forward, so it stays monotonic and the file's clock is rebased at the first flush. The startup line gains ` boss in <n>s` with the real seconds to the next grid point whenever `--boss-in` was passed. A dev flag for the manual pass: bosses in skipped windows never spawned and owe nothing; an open boss left in the data is settled as expired by the first poll

**Interfaces:**
- Consumes: Tasks 8 and 9.
- Produces: the boss half of `ServerClient` on both hosts; `BossRecord`.

**Work:** Follow the ledger rules under "`@promptfall/ledger` additions" (`advanceBoss` in its order, `engage` and `disengage`, contribution, `settleBoss` with the in-hand record) exactly: they are the concurrency contract of this task, and `boss.test.ts` cases 1 to 6 pin them. Everything runs inside the mutex and ends with the one flush; `settleBoss` may touch many records in one operation, which is one flush of the fake's snapshot (one rename, `file-kv.ts:57-64`). Presence is read through the same `Map` as `world()`. Internal layout of `boss.ts` is yours.

**Acceptance check:** `pnpm --filter @promptfall/ledger test` and `pnpm --filter @promptfall/fake-server test` green with rules 0 to 40 on both hosts, `boss.test.ts`, `boss-in.test.ts` and the bots' boss case. Then `devserve run --port 7778 --ttl 5 -- pnpm fake --port 7778 --speed 10 --bots 0 --data /tmp/pf-boss-in.json --boss-in 30` and the log's startup line ends in `boss in 30s`; `devserve stop 7778`. Red before: rules 33 to 40 fail.

**Boundaries:** No plugin. No new route (the snapshot carries the boss). No change to the market rules.

- [ ] `boss-config.ts`, `boss.ts`, `boss.test.ts` red then green, the six lifecycle cases included
- [ ] Wire `advanceBoss` in `world` and `sweep`, engage on poll, the contribution read, `settleBoss`; the two runners' `kv`; rules 33 to 40 green over the in-process host, then over HTTP
- [ ] `boss-in.ts`, its test, `--boss-in` in the CLI; the bots' case; run the acceptance check; commit `feat(ledger): world boss on the 3 hour grid, contribution from committed batches, rewards; --boss-in`

### Task 11: Plugin: the boss in the band, the toasts, the reward

**Files:**
- `scripts/vendor.mjs` (run `pnpm vendor`): v3 bundles
- `plugins/promptfall/types/index.d.ts` (modify): `GameView.boss: { bossId: string; name: string; glyph: string; dealt: number } | null`; `EnemyView.kind` already a string; `LootView` unchanged
- `plugins/promptfall/hooks/view.ts` (modify): `toGameView` fills `boss`; the `world_boss` enemy's `EnemyView` takes `name` and `glyph` from `state.boss` (it has no content entry); `lootLine` for `reward`: `boss reward <name> (+<gold>g)`
- `plugins/promptfall/hooks/engine.ts` (modify): `committedBoss(): { bossId: string; dealt: number } | null` from `this.committed`; the `rewarded` effect reaches `onEffects` through `receive` as every server-event effect does
- `plugins/promptfall/hooks/register.tsx` (modify): `effectToast` for `rewarded`: `Boss reward: <item name> (<rarity>)` when goods are present, else `Boss reward: <gold> gold`; the poller's transitions: `World boss <name> has appeared` when the previous snapshot had no boss or another `bossId` and the new one has a live boss (`hp > 0`); `<name> is down` when the same `bossId` goes from `hp > 0` to `hp === 0`; nothing on expiry, and nothing when a kill in the window's last seconds goes straight from `hp > 0` to `null` (the client cannot tell it from an expiry; rare, accepted). No poller-triggered `sync()`: `boss_engaged` reaches a playing primary through its next flush, whose `cursor_behind` answer delivers it and re-steps the batch in flight (`engine.ts:280-293`) within 15 s; the ledger replays that batch on the engaged state too, so its ticks count as contribution on both ends and only the display lags.
- `plugins/promptfall/hooks/world.ts` (modify): `committedDealt` on each snapshot (null on a secondary); the fast cadence while the boss is live is already in Task 5
- `plugins/promptfall/hooks/ui/band.tsx` (modify): R5, the Party tab's enemy slot: when `view.boss` is set and the snapshot holds a boss with the same `bossId`, the first enemy row reads `⚔ <glyph> <name>` followed by `HpBar(els, shownHp, maxHp)` and `<shownHp>/<maxHp>` with `shownHp = max(0, boss.hp − max(0, view.boss.dealt − baseline))` and `baseline = world.committedDealt?.bossId === boss.bossId ? world.committedDealt.dealt : view.boss.dealt` (so a null or foreign `committedDealt` subtracts nothing: exact on a secondary, whose view is the committed state, and on a primary before its first reading); when `view.boss` is set but the snapshot has no matching boss (a fake restart before the first poll, a stale stretch, the gap between expiry and the disengaging delivery) the row reads `⚔ <glyph> <name>` and `you <dealt>` with no bar; rows 2 and 3 of the slot are empty. The status row's last segment while the boss is live (`hp > 0`), on every tab: `boss <pct>% · <remaining>` where `pct = floor(shownHp × 100 / maxHp)` and `remaining = formatRemaining(remainingRealMs(endsAt, world.clock, now))` (`ui/time.ts`); a notice still wins over it, and it wins over `last: <drop>`; no segment at `hp 0`. The World tab's row 2 while live: `World boss <name> <bar> <pct>% · <remaining> left · you <dealt>` with an 8-cell bar and `dealt = view.boss?.bossId === boss.bossId ? view.boss.dealt : boss.yours`; `<name> is down · you <dealt>` once `hp === 0`. Without a boss in the snapshot row 2 is Task 5's.
- `plugins/promptfall/hooks/band.test.ts` (modify): with a `world` atom holding a live boss and a view in boss mode for it, the Party tab's first enemy row shows the boss name and a bar, the status row ends in `boss 62% · 11m` for `hp 6200 / 10000` and 11 minutes left at speed 1, and the World tab's row 2 reads the boss line; the predicted HP subtracts local `dealt` beyond `committedDealt`; with `committedDealt` null (a secondary) the bar equals the snapshot's `hp`; with a view in boss mode and a snapshot without that boss the row reads the name and `you` with no bar; a snapshot with `hp 0` reads `is down` and the status row carries no boss segment
- `plugins/promptfall/hooks/register.test.ts` (modify): a snapshot sequence `null → boss → hp 0` toasts `World boss <name> has appeared` then `<name> is down` once each; a delivery carrying `rewarded` with an item toasts `Boss reward: Steel Longsword (rare)` and the loot log gains `boss reward Steel Longsword (+45g)`; `rewarded` with `goods: null` toasts `Boss reward: 45 gold`; after a snapshot shows a boss while the local state is not engaged, the next flush's `cursor_behind` delivery carrying `boss_engaged` puts the primary in boss mode (`view.boss` set) with no `account` call
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
- [ ] Toasts, `committedDealt`; `register.test.ts`; README; run the acceptance check; commit `feat(plugin): world boss in the band, boss toasts, rewards in the loot log`

### Task 12: PR 2: manual pass part B, docs, pull request

**Files:**
- `docs/manual-pass/phase-3.md` (modify): part B
- `README.md` (modify): status says phase 3 is built
- `docs/spec/promptfall.md` (modify only if execution found a contract deviation that Kevin approved in chat; otherwise untouched)

**Work:** Part B. The fake runs at speed 10: the boss window is 2 real minutes. Three bosses are fought, each brought near with `--boss-in <seconds>` (Task 10), because the three outcomes need different company: an expiry needs the player alone (a fresh party deals about 500 in the window against 4000 HP), a certain kill needs the twelve bots (they deal about 85,000 in the window against 52,000 HP, so it lands at about 75 to 95 s), and a restart mid-boss needs a third window. Without the flag the three spawns are up to 54 real minutes apart, and the fast-forward trick (`--speed 2000 --bots 0`) cannot stop near a grid point (one real second is 33 virtual minutes). The numbers come from the measured damage under "Tuning numbers and their working". The "Boss reward" toast on a kill needs `you` over 200 before the kill lands, so the turn starts before the spawn; the top-3 bonus roll is not reachable by a fresh player beside twelve bots and is proven by contract rule 35 instead.

1. **Reset.** `SIM_VERSION` is 3: a phase 2 store and a phase 2 fake snapshot are both behind it. Start the fake on a fresh path with no bots and the first boss four minutes out: `pnpm fake --port 7777 --speed 10 --bots 0 --player-name <you> --data .promptfall/fake-p3.json --boss-in 240`: the startup line ends in `boss in 240s`. In the plugin session, `/promptfall server http://127.0.0.1:7777`: a fresh account there. Then `/promptfall server local`: the band is one line with the older-version notice; `/promptfall account`, `Reset this machine's data`: a fresh in-process account. Back to the fake with `/promptfall server http://127.0.0.1:7777` and link.
2. **When is the boss?** `curl -s localhost:7777/v1/health`: `now` is virtual ms; the seconds until the spawn are `(10800000 − now % 10800000) / 10000`. Note them.
3. **Start the turn first.** About 20 seconds before the spawn, ask Claude to run `sleep 5` thirty times, one at a time: the party ticks every 2 seconds through the whole window.
4. **It appears.** Within 15 seconds of the spawn (your session polls every 15 s until it has seen a boss, then every 5): a toast `World boss <name> has appeared` (after Esc if the dialog is open); the Party tab's first enemy row reads `⚔ ☠ <name>` with a bar and `4,000/4,000` (1 online × 4 000: you alone; more if a viewer account, a curl, polled inside the last 45 s); the status row ends in `boss 100% · 2m`; the World tab's row 2 reads the boss line with `you 0`.
5. **Fight it.** `you` on the World tab rises by about 8 a tick (a fresh party; heroes fall and the whole party is healed in place on a wipe, with no retreat and no wipe toast), the bar falls between polls and corrects at each poll, and no enemy spawns from the tool calls.
6. **It withdraws.** At the 2-minute mark the status row's segment disappears, no down toast; within 15 seconds one toast `Boss reward: <item> (<rarity>)` (you passed 200, 5% of the base, at about 50 s into the turn), the item in the Inventory tab, one `boss reward …` line in the loot log; the band is back to waves within 15 seconds.
7. **Leaderboards.** `/promptfall leaderboards`: `Boss damage this week` lists you alone, highlighted.
8. **It dies.** Ctrl-C the fake; restart it with twelve bots and a boss a minute out: `pnpm fake --port 7777 --speed 10 --bots 12 --player-name <you> --data .promptfall/fake-p3.json --boss-in 60` (same `--data`: your account and the window's boss history carry over). Start the `sleep 5` loop again about 20 seconds before the spawn. It appears as in step 4 with `52,000/52,000` (13 online × 4 000: you and the bots, who poll every 2 real seconds). Within 2 minutes: `<name> is down` (expected at about 75 to 95 seconds; the bar on the Party tab falls steadily between polls), then within 15 seconds one `Boss reward: …` toast and loot line if `you` passed 200 before the kill (it does when the turn started before the spawn; with it under 200 there is no reward, which is the threshold working, not a red), no second reward (the bots hold the top 3); the band is back to waves within 15 seconds. `/promptfall leaderboards`: `Boss damage this week` lists the bots above you, your row highlighted.
9. **A restart mid-boss.** Ctrl-C the fake; restart with the step 8 command. 30 seconds after the boss appears, Ctrl-C again and restart with the same command without `--boss-in`: within 15 seconds the boss line is back with the HP it had (the bots keep hitting it) and the fight resumes; the online count rebuilds from the polls.
10. **In-process.** `/promptfall server local` (reset done in step 1): no boss ever appears there, the World tab reads `1 online` and `chat is closed`.
11. **Validate.** `claude plugin validate plugins/promptfall` lists the same namespaces as phase 2.

PR from `feat/phase-3-boss` into `ai-staging` titled `Promptfall phase 3, PR 2: world boss`, same body shape as PR 1 with the review legs. The README's fake line gains `--boss-in`. Stop and hand Kevin part B.

**Acceptance check:** the full check line (`pnpm lint && pnpm typecheck && pnpm test && pnpm vendor:check && pnpm exec tsc -p plugins/promptfall && claude plugin test plugins/promptfall`) green and pasted; `gh pr view --json url`.

**Boundaries:** Docs only. Do not merge.

- [ ] Write part B; update the README; run the check line; open the PR; stop

## Spec conflicts and narrowings

1. **`rewarded` is one event per roll, not one per contributor.** The record (§1.3) fixes the shape `rewarded { bossId, goods: Goods | null, gold }` and says one event per contributor with one bonus roll each for the top 3. One event cannot carry two items in that shape, so a top-3 contributor gets two `rewarded` events; everyone else one. The shape stays verbatim.
2. **`goods: null` means the item waited in returns.** The record does not say when `goods` is null. Here: when the contributor had no free slot, the item is queued in `returns` under `listingId = bossId` and arrives as `returned` (its loot line reads `returned`); the `rewarded` event still carries the gold so the toast shows something.
3. **Reward gold.** The record names a `gold` field and no amount. Here every reward carries `3 × vendorGoldPerZone(rarity) × zone`, the sim's own valuation of a boss contract vendored into a full roster (`heroes.ts:68`), reused for an item of the same rarity.
4. **Presence TTL is 45 real seconds**, scaled by `speed` on the fake, because heartbeats arrive at the client's real cadence; at `--speed 10` an unscaled TTL would mark a player offline for 70% of each poll interval.
5. **`WorldSnapshot.serverNow` and `speed`** are added to the record's shape so a secondary (whose engine never bootstraps) can show the boss's time left and the bar's pace, and so no session has to remember a `ServerConfig` for the clock rate.
6. **Chat refusal `empty`** is added for a whitespace-only message; the client refuses it locally and the server refuses it too.
7. **`ChatResult.ok` carries the posted message** so the client shows it at once and advances its chat mark without waiting for a poll.
8. **The boss stays in the snapshot with `hp 0` until `endsAt`**, closed or not, so the down toast has a transition to fire on; "live" (the fast cadence, the status segment) means `hp > 0`, so a dead boss does not hold every session at 5 s for the rest of the window. Expiry has no toast (spec §10 lists appeared, down and reward only), and a kill in the window's last seconds that leaves the snapshot before a session polls shows no down toast either: the client cannot tell it from an expiry. Rare, accepted.
9. **World boss stats scale by the ratio to zone 1's zone boss** per stat (`atk × zoneBoss(zone).atk / zoneBoss(1).atk`, floored). The spec says "scaled to the party's zone" and names no rule.
10. **The highest-zone board is offered at every commit and at mint**, not only where `highestZone` rose, and the offer always refreshes the row's name and keeps the higher value: the check costs the same, a minted bot would otherwise never appear until it advanced, and a player's first commit lands before linking, so the row's `adventurer` must become the login without waiting for a higher zone.
11. **The name blocklist also covers listings' `sellerName`** through the shared `publicName`, since `market.ts` already derives the name there.
12. **The Chat tab's fast cadence is driven by renders** (`CHAT_TAB_HOT_MS`) rather than an open/close signal. The engine does have a `ui.close` hook (d.ts E:6583) and `$.ui.panes()` (E:2323); the render rule is kept because it needs no hook, no pane bookkeeping and no new `$` call, at the cost of at most 20 s of fast polling after the tab closes. A pane that is not drawn raises no `ui.render` (E:3755, E:13155-13157), so a closed tab stops refreshing the mark.
13. **`boss_engaged` reaches a playing primary through its next flush**, within 15 s: the snapshot carries no delivery, and the flush's `cursor_behind` answer delivers the event and re-steps the batch in flight (`engine.ts:280-293`); the ledger replays that batch on the engaged state too, so its ticks count as contribution on both ends. No poller-triggered `sync()`: it would save at most 15 s of display lag for a once-per-change memory and a flush started from the poller.
14. **Bots re-mint under a new sim version.** The record does not say what happens to phase 2 bot accounts in an old snapshot; here a saved bot whose state is behind `SIM_VERSION` is minted again, and the manual pass starts from a fresh `--data` anyway.
15. **Bot scheduling**: each bot acts once per `BOT_TICK_MS` virtual ms, so the scheduler interval is divided by the bot count; phase 2 ticked one bot per interval.
16. **`Mirror` moves to `packages/protocol/src/mirror.ts` behind a `./mirror` subpath export**, unchanged, so the bots can use it outside vitest (`suite.ts` imports vitest); it is not exported from the package root, so the vendor bundle does not carry it and its `crypto.randomUUID()` stays.
17. **`turnToolCalls` keeps counting in boss mode** (R2 says spawn nothing, not count nothing), so a long turn during a boss still earns its turn boss once the waves resume.
18. **The weekly damage board keeps every contributor of the week** and cuts the top 20 at read; a 20-row list could not rank a rising account correctly.
19. **Secondary sessions post chat and read boards with the stored token directly**, outside the engine, which is what "any session may post, no flush, no lease" needs.
20. **The idle-timer open item** (record §5) is manual pass part A step 9, read through the lease (a hidden primary that keeps its lease has firing timers; both sessions share one account, so the online count cannot show it); the response-size item is step 10. **`--boss-in <seconds>` is added to the fake** (Kevin, fix pass Q2): the record reserved an override for a manual pass that found the wait too long, and part B needs three windows (an expiry, a kill, a restart mid-boss), up to 54 real minutes apart at speed 10, while the fast-forward trick cannot land near a grid point. It only moves the clock forward.
21. **Reward items use the ledger id prefix `r`**, added to `ids.ts`; `transfer` re-ids them with `t` on a sale as it does any non-`t` id.
22. **`ContractMake` gains an optional `kv`** for the restart-mid-boss rule; both runners keep their defaults otherwise.
23. **Chat length is 200 UTF-16 code units** (`String.length`), the unit Zod's `.max` counts, so the ledger and the wire schema can never disagree; an emoji counts two. The spec's "200 characters" names no unit.
24. **Control characters are stripped**, not refused: `\p{Cc}` is removed from chat text before trimming and from display names in `publicName`. The engine refuses control characters in several places (d.ts E:1450, E:5395, E:6946) and says nothing about a `Text` child, so none may reach a client; stripping needs no new refusal and cannot surprise the plugin's single-line `Input`. The spec's "refuses, never masks" is about words and stands.
25. **`worldboss.enabled` turned off settles an open boss as expired**: the next poll or sweep pays the threshold drops, disengages every account and spawns nothing, so a fake restarted with the flag off leaves nobody in boss mode. The record says a flag change is a restart and nothing about an open boss.
26. **The contract-visible numbers live in `@promptfall/protocol`** (`world.ts`), not the ledger, because the suite is in the protocol package and cannot import the ledger without a cycle; `BUDGETS` already lives there for the same reason.
27. **`advanceBoss` runs on polls and sweeps only**, never in `submit` or `leaderboards`: the record's wording, and the only placement that keeps every record `submit` holds from being written twice. A kill is settled from `submit`'s own contribution step; an expiry waits for the next poll or sweep, and the `now < endsAt` guard keeps late ticks from counting.
28. **Overkill counts in full**: the killing batch's whole `dealt` delta goes to the contribution and the weekly board, so `yours` may exceed `maxHp`. Simpler than clipping, and the board ranks effort.
29. **A reward roll that returns null pays its gold only** (`rewarded { goods: null, gold }`, nothing queued). `rollItem` answers null only when no base fits the party, which the content makes unreachable; the rule exists so the ledger has an answer.
30. **An own chat post does not move the chat mark**: it is inserted into the buffer by id and the next poll returns it again, where the merge drops the duplicate. Moving the mark to the own post's id would skip messages others posted in between.
31. **`BOSS_BASE_HP` is 4000**, sized by measured sustained damage rather than the static formula (Kevin, fix pass Q1): the parties present in phase 3 are the bots and early players, and 4000 is where both kill their share inside the window; the day-one reference party kills its share in 8 idle minutes rather than the record's "about 12".

## Out of scope

The long-poll stream, presence in Redis, mute and ban, the admin CLI, pushed flag changes, deferred items M (a delivery with a gap after a 500-entry log fold) and Q (the virtual clock stepping back after a SIGKILL during a read-only stretch), and a transaction over the many records `settleBoss` writes (both phase 3 hosts flush atomically: one rename on the file fake, one process in memory) (phase 5); sound cues for the boss, sprites (phase 4); hero rewards from the boss (items only in phase 3); a chat word list beyond the placeholder (content, not mechanism); names colliding on a fake with more than one human (`--player-name` for every linked account; a fake limitation, noted in the record); rate limits on the world poll beyond the presence stamp being idempotent; migrations between sim versions.
