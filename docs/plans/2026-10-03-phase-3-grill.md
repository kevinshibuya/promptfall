# Phase 3 grill: presence, chat, leaderboards, world boss

Grilled on 2026-10-03 on branch `feat/phase-3`, in a cloud session with Kevin answering
three rounds. This is the record the phase 3 planner starts from. It holds decisions and
facts, not a plan. Decisions are Kevin's unless marked; the recommendation Kevin accepted
is noted as "recommended, accepted".

## 1. Settled design tree

Each node names the decision, who made it, and the branches that hang off it.

### 1.1 Delivery: no stream in phase 3, a world poll instead (Kevin, Q1)

- World data (presence, the live boss, the chat tail) is never a server event and never
  sim state. It is read with the **world poll**, `GET /v1/world?since=<chatMark>`, which
  answers a **world snapshot**: `{ online, zones: { zone, count }[], here: string[] (names
  in your zone, you excluded, at most 10), boss: BossView | null, chat: ChatMessage[],
  flags }` (Q17, Q19).
- Cadence: the primary polls every 15 s on the flush cadence; every 5 s while a world
  boss is live or the Chat tab is open (Q1, Q20). Secondary sessions poll too (Q4, S1).
- The long-poll stream stays in phase 5. Spec §9 said phase 3; amended. The engine's
  `$.http.fetch` has no abort and no timeout field, the plugin gives every fetch 15 s and
  counts a longer one as an outage, so a held poll needs its own fetch path and failure
  rule, which phase 5 designs.
- A thrown world poll is ignored; the World tab dims as `stale` after 45 s without a fresh
  snapshot. Only a thrown submit or bootstrap enters the outage (Q23, O1). Chat posting in
  an outage answers the unreachable text like a trade. Boss mode keeps ticking locally for
  the 120 s outage buffer like any ticking.
- `ServerClient` gains `world`, `chat`, `leaderboards` (Q17).

### 1.2 Presence: the poll is the heartbeat, in ledger memory (Kevin, Q4 and Q10)

- Every world poll stamps `{ accountId, zone, name, at }`. **Online** means a stamp inside
  a 45 s TTL. Keyed by account, so two sessions of one account are one entry.
- The zone is the committed state's `zone` on the server, never a client claim.
- Presence lives in the `Ledger` instance's memory, never in the key-value store (amended
  after the adversarial review: a stamp per poll would rewrite the fake's whole snapshot
  file synchronously, and presence is ephemeral by definition). A restart loses it and the
  next polls rebuild it. Phase 5 holds it in Redis with the same TTL.
- Headless sessions start no game and never poll. A client in an outage drops offline after
  the TTL.
- `presence.enabled` flags it (Q7).

### 1.3 World boss (Kevin, Q2, Q9, Q12, Q13)

- **Where:** a ledger-owned record in the store (`pf:world:boss`: id, spawn and end times,
  max HP, HP, contributions by account), beside the sim. Survives a fake restart because
  the virtual clock resumes and the record is in the snapshot.
- **Schedule:** spawns on the server clock's 3 hour grid from epoch zero, lives 20
  minutes or until dead. Derived from `now()` alone, so no "next spawn" is persisted and a
  restart mid-boss resumes it. Advanced lazily on every world poll and every sweep, like
  market expiries. No dev override beyond `--speed` (18 real minutes at speed 10); add
  `--boss-at` only if the manual pass finds that too long.
- **HP:** `base × online count at spawn`, base sized so the parties present kill it in
  about 12 minutes of normal ticking. Base is tuning.
- **Boss mode (the sim):** the ledger authors `boss_engaged { bossId, name, glyph, stats }`
  to every online account at spawn and to any account that comes online during the window
  (on its first poll). The sim replaces the encounter with one enemy of kind `world_boss`
  that never dies locally, heroes hit it each tick, the sim adds the damage to
  `state.boss: { bossId, dealt }`, the boss hits back with the carried stats scaled to the
  party's zone. `boss_disengaged { bossId }` clears the encounter; the next tick spawns the
  wave. Side rules: a wipe heals fully in place, no retreat, no wipe counted (R1); tool
  calls spawn nothing (R2); no XP, gold or drops from the boss (R3); a rest heals as usual
  (R4); the band's enemy slot shows the boss (R5).
- **Contribution:** the server reads the `dealt` delta on each commit. Ticks the server
  commits after the boss ended count for nothing; an offline party's ticks are never
  submitted (no offline progress).
- **Rewards:** rolled by the ledger at the killing commit with the sim's loot tables at
  the contributor's zone and boss rarity weights. One server event `rewarded { bossId,
  goods: Goods | null, gold }` per contributor. Guaranteed drop for any contribution at or
  above 5% of `base` (T1); one bonus roll each for the top 3. An expired boss pays the
  threshold drop and no bonus rolls. Goods with no free slot go to returns, never vendored.
  Offline contributors find theirs in their next delivery, with `boss_disengaged`.
- **Display:** the Party tab's enemy slot shows the boss with the global HP bar; the status
  row's last segment reads `boss 62% · 11m` on every tab while live; no `$.ui.status` line
  (Q20, D1). Between polls the bar shows the last polled HP less the damage this party
  dealt since.
- `worldboss.enabled` flags it; the in-process host runs with it off (Q5).
- Fallback if boss mode proves too heavy for one PR (named in ADR 0002, not chosen): one
  `stats.damage` counter on normal combat, the boss as a banner.

### 1.4 Sim version: bump to 3 (Kevin, Q3, option B)

- Phase 3 changes the sim (boss mode, `world_boss` enemy kind, three server events).
  `SIM_VERSION` goes from 2 to 3. Every existing v2 state is reset through the existing
  path: the band's older-version notice and the Account tab's reset.
- The rule written into §7: any change to the sim bumps it.

### 1.5 Chat (Kevin, Q14)

- Gate: linked account and `chat.enabled`; refusals `not_linked`, `chat_closed`.
- 200 characters after trimming, refusal `too_long`.
- Rate limit: a per-account token bucket on the server clock, capacity 5, refill one per
  10 s, refusal `rate_limited`, enforced by the ledger so both fakes enforce it.
- Blocklist: a word list in the ledger package; a match refuses with `blocked`, no
  masking. The same list filters names (1.6).
- History: the ledger keeps the last 200 messages in one store key, serves the last 50 to
  a poll with no chat mark and only newer ones after. Message: `{ id, name, text, at }`
  with a global monotonic id. The **chat mark** is the id of the last message shown.
- Any session may post: chat needs no flush and no lease.
- Chat messages are not server events and never toast.
- Client: Chat tab on `c`, messages the pane fits, newest at the bottom, a compose `Input`
  with Enter to post, the gate said in place, a 5 s flash on a refusal naming the rule
  (`too_long` names the number), read-only on mobile (no `Input` there) (Q21).

### 1.6 Leaderboards (Kevin, Q15)

- Highest zone reached (all time) from committed states' `highestZone`; world boss damage
  this week from the contribution tally. Never client claims.
- Maintained incrementally (L1): one store key with two bounded lists, updated at each
  commit where `highestZone` rose and at each contribution. 20 rows each.
- Week: Monday 00:00 UTC on the server clock (virtual on the fake); weekly damage sums the
  bosses that spawned in the current week.
- Names: `displayName`, else `adventurer`; a name matching the blocklist shows as
  `adventurer`.
- Served by `GET /v1/leaderboards` on demand, not in the snapshot. Client: Leaderboards
  tab on `b`, the per-zone presence counts first, then the two lists, your row
  highlighted, fetched on open (Q21). `leaderboards.enabled` flags it.

### 1.7 Flags (Kevin, Q7)

- One per feature: `chat.enabled`, `worldboss.enabled`, `presence.enabled`,
  `leaderboards.enabled`, beside `market.enabled` and `maintenance`.
- The fake takes `--flag <name>=<value>`, repeatable, read at start; a change is a
  restart. Pushing a change is phase 5.
- The world snapshot carries `flags`, so a client sees a change within one poll.
- The in-process host passes `chat.enabled: false` and `worldboss.enabled: false`; the
  client says it in place like a closed market. Presence and leaderboards stay on there
  with a count of one (Q5, option B).

### 1.8 Moderation in phase 3 (Kevin, Q16)

- Name and chat blocklists and the chat flag. Mute and ban arrive in phase 5 with the
  admin CLI that issues them; no host privilege for them now.

### 1.9 Bots (Kevin, Q6 and Q11)

- Bots become batch-submitting players (Q6, A): each bot tick submits a batch of 4 to 6
  ticks (an idle human's pace) with `tool_call` and `turn_end` events mixed in on a
  cadence, with a mirror like the contract suite's `Mirror`. Their zones advance,
  presence spreads, the highest-zone board fills, and boss contribution follows the player
  rule.
- Bots are HTTP clients of the fake's own port for every action (B1): `HttpClient` over
  Node's fetch. `mint` at start and `credit` for the stipend stay in-process; `settle` is
  no longer needed because a commit settles.
- `fill` joins the action weights (B2): a bot with an item matching an open buy order
  accepts it.
- Chat: lines from a fixed list in `bot-config.ts`, posted through the public chat route
  under the bot's linked account, one line per N bot ticks.
- Numbers (ticks per batch, cadences, weights, lines) are tuning in `bot-config.ts`.

### 1.10 Client surfaces (Kevin, Q19 to Q22)

- World tab rows: (1) `12 online · zone 3: Hollis, Kestrel, Lark`, you excluded, clipped,
  `nobody else here` when empty; (2) the boss line while live (`World boss <name>
  ▮▮▮▮▮▯▯▯ 62% · 11m left · you 1,240`), else `highest zone · kills · wipes`; (3) the chat
  ticker `name: text`, `chat is quiet` when empty, or the closed state in place. The
  `Multiplayer arrives in phase 2` line goes.
- Toasts added: `World boss <name> has appeared`, `<name> is down` (both from the snapshot
  transition in whichever session polls), `Boss reward: <item or N gold>` (from the
  `rewarded` effect on the primary). A reward with goods lands in the loot log like a trade.
- `/promptfall chat` and `/promptfall leaderboards` open the new tabs.

### 1.11 Protocol and contract suite (Kevin, Q17)

- Routes: `GET /v1/world?since=` → `WorldSnapshot`; `POST /v1/chat { text }` →
  `ChatResult`; `GET /v1/leaderboards` → `Boards`.
- Contract cases, all on both hosts through the suite's `make` and its flags: a poll
  stamps presence and the TTL drops it; chat gate, length, rate limit, blocklist, history
  window; the boss spawns on the clock grid; a committed batch in boss mode adds
  contribution; the killing commit authors `rewarded` and `boss_disengaged`; an expired
  boss pays threshold drops only; flags off answer the closed refusals.

### 1.12 Phase 2 leftovers

- Deferred item M (a delivery with a gap after a 500-entry log fold) stays phase 5 (Q18).
  Phase 3 adds per account two boss events per boss and one reward; chat is not a server
  event; nothing approaches 500 between two flushes.
- Deferred item Q (the virtual clock stepping back after a SIGKILL during a read-only
  stretch) is untouched by phase 3 and stays as noted in the review. The boss schedule is
  derived from `now()`, so a clock that steps back lengthens a window and nothing else.

### 1.13 Scenarios checked

- A boss dies while a party is offline mid-batch: its contribution counted only while its
  batches committed during the window; its reward, if any, and `boss_disengaged` arrive in
  its next delivery; ticks committed after the end count for nothing.
- A chat message posted from a secondary session: allowed, no flush, no lease.
- Two sessions on one account heartbeating: one presence entry, keyed by account.
- A client on the in-process fake: chat and the boss are off by flag and said in place;
  presence and leaderboards of one.
- A fake killed and restarted mid-boss: the boss record is in the snapshot and the grid
  resumes it; presence is empty until the next polls; HP stays as sized at spawn.

## 2. Glossary terms added or changed (`CONTEXT.md`)

Added: **Delivery**, **World poll**, **World snapshot**, **Chat mark**, **Heartbeat**,
**Online**, **World boss**, **Boss mode**, **Contribution**, **Reward**.
Changed: **Bot** (plays and trades through the public API: batches, market, chat, boss).

## 3. ADRs written

- `docs/adr/0002-world-boss-as-boss-mode.md`: the world boss is fought inside each
  party's sim, with one global HP outside it.

No ADR for the poll-not-stream decision (reversible: the stream is an addition), for
presence in memory (reversible: a store move any time) or for bots over HTTP (reversible).

## 4. Spec sections amended (`docs/spec/promptfall.md`)

- Header: amended for phase 3.
- §3: the network fact no longer claims a long-poll is free; the 15 s fetch rule.
- §4.6 (new): boss mode rules.
- §6: rewritten for the world poll, presence, leaderboards, chat, the world boss, flags
  and moderation as decided.
- §7: any sim change bumps `SIM_VERSION` (3 in phase 3); the server event list gains
  `boss_engaged`, `boss_disengaged`, `rewarded`.
- §8: the flag list gains `presence.enabled`, `leaderboards.enabled`.
- §9: `--flag`; bots as HTTP clients that batch, fill and chat; the stream is phase 5 and
  world data is never a server event; world cases in the contract suite.
- §10: World tab rows, boss display, poll failures, Chat and Leaderboards tabs, toasts.
- §12: phase 3's two PRs.

## 5. Open items

- **HANDOFF.md** is not in the clone or in any commit on `feat/phase-3`. Its "Questions
  the grill must settle" and "Dead ends and facts" were not read. Settled by: Kevin
  checking those sections against this record in the local session before the plan prompt.
- **Timer behaviour in an idle or backgrounded session**: not documented in the engine
  facts. Affects whether a backgrounded terminal keeps polling and so stays online.
  Settled by: a manual check with two terminals, one backgrounded for 2 minutes, watching
  the other's online count.
- **Response size and concurrency caps on `$.http.fetch`**: not documented. The snapshot
  is small by design (10 names, 50 messages cold); settled by the engine d.ts if it says
  anything, else by measurement in the manual pass.
- **Numbers that are tuning, to be set in the plan**: the boss base HP, the per-zone
  stat scaling of the boss, the 5% threshold, the bot ticks per batch and chat cadence,
  the rate bucket (5, 10 s), history (200 kept, 50 served), the poll cadences (15 s, 5 s),
  the TTL (45 s), the stale marker (45 s).
- **Names on a fake with more than one human**: every linked account gets
  `--player-name`. Presence and chat names collide. Noted as a fake limitation, not fixed.
- **Where the chat word list lives inside the ledger package and its format**: the plan
  decides; the decision here is only that the ledger owns it and a match refuses.
- **`--boss-at` override**: not added; revisit after the manual pass.

## 6. Facts relied on

Engine facts are from the grill prompt (`docs/plans/cloud/01-phase-3-grill.md`, "The plugin
engine, from sources outside the repo"); the rest cite the clone at commit 03c7ae7.

Engine:
- `$.http.fetch` resolves once the body is read, no streaming, no abort, no timeout field
  (prompt E:3263-3281, E:4898-4932).
- `$.clock.after`, `$.clock.every`, minimum 1 ms; a hot reload cancels pending waits.
- `$.ui.status` is one pinned line per plugin (E:2262-2273); the plugin never calls it.
- `$.store` refuses over 4 MiB total; machine-wide. `$.session.id()` only; no API lists
  sessions. `session.end` has a 1.5 s bound.

Plugin:
- `FETCH_TIMEOUT_MS = 15_000`, `timedFetch` races every fetch, `register.tsx:50-74`.
- Cadences: tick 2 s in a turn, 5 s idle, flush 15 s, lease renewal 10 s,
  `register.tsx:76-79`.
- A timeout, unreachable host, 5xx or unreadable body is an outage; a 4xx on submit
  pauses with the update notice, `engine.ts:254-267`; backoff 1 s to 30 s with jitter,
  outage expires at 120 s, `engine.ts:474-504`, `OUTAGE_BUFFER_MS` at `engine.ts:92`.
- `receive` re-steps buffered player events over arriving server events,
  `engine.ts:362-390`.
- A secondary bootstraps every renew and replays the delivery read-only,
  `register.tsx:437-464`; market reads work from a secondary, `register.tsx:314-323`.
- The in-process host is the vendored `Ledger` over `StoreKeyValue` with no flags passed,
  `plugins/promptfall/hooks/server.ts:25-33`; it sweeps before each timed flush,
  `register.tsx:392-393`.
- Band World tab text, `plugins/promptfall/hooks/ui/band.tsx:116-131`; status row
  `band.tsx:133-175`; `isWorking` unused.
- Dialog hotkeys `i h m r a o`, `ui/dialog.tsx:37-44`; `$.ui.open` with `rows: 20`,
  `command.ts:77-84`; gates said in place, `ui/trade.ts:24-33`.
- Toast mapping, `register.tsx:86-112`; `boss_spawned` is not toasted today.
- Lease: 30 s TTL, `lease.ts:4`; secondary never ticks, submits or trades,
  `register.tsx:202-227, 386-400`.

Ledger and sim:
- `LedgerFlag` names, `packages/ledger/src/ledger.ts:50`; only `market.enabled` is read,
  `market.ts:42-44`; resolved flags `ledger.ts:127-129`; no runtime setter.
- `AccountRecord` shape, `books.ts:24-43`; `LOG_CAP = 500`, `BATCH_RING = 200`,
  `books.ts:45-46`; `author` applies an event at once and folds past the cap,
  `books.ts:105-123`.
- Submit order: schema, auth, versions, duplicate, seq, cursor, baseHash, buckets, replay,
  `ledger.ts:212-309`; `BUDGETS` at `packages/protocol/src/client.ts:100-107` (tick 2 s
  refill, capacity 70).
- Server event union, `packages/sim/src/types.ts:74-100`; `SIM_VERSION = 2`,
  `types.ts:1`; `isCurrent` resets a state behind the version, `books.ts:67-69`.
- `GameState` has `zone`, `highestZone`, `stats: { kills, bosses, wipes }` and no damage
  counter, `types.ts:133-156`; `highestZone` updated in `progression.ts:217-221`.
- Combat: `damage()`, `hitEnemy`, `combat.ts:7-25`; `onEnemyKilled` grants XP, gold,
  drops, `progression.ts:225-270`; `checkWipe` retreats, `progression.ts:273-286`;
  `onToolCall` spawns or queues, `progression.ts:150-156`; `spawnOnEmptyTick`,
  `progression.ts:176-197`. `EnemyKind = 'wave' | 'zone_boss' | 'turn_boss'`,
  `types.ts:35`.
- Ledger ids from one counter with prefixes `L`, `O`, `t`, `ids.ts:3-11`.
- Linking sets `displayName` to the login, `ledger.ts:348-365`; seller name falls back to
  `adventurer`, `market.ts:46-48`; no blocklist anywhere.
- Sweep: expiries and returns, `ledger.ts:514-522`; expiry also inline on authenticated
  market calls, `ledger.ts:412-423`.
- One mutex over every ledger operation, flush after each, `ledger.ts:115-125`.

Protocol:
- `ServerClient`, `packages/protocol/src/client.ts:83-98`; `ROUTES`, `http.ts:42-58`;
  `HttpClient` throws `ServerUnreachable` on a thrown fetch and `ServerError` on non-200
  or a bad body, `http.ts:98-146`; no retries, no timeout.
- `Delivery`, `client.ts:15-16`; `ServerConfig` with `flags`, `serverNow`, `speed`,
  `client.ts:18-27`; `Bootstrap`, `client.ts:66-78`.
- Contract suite: `ContractClock`, `ContractHost`, `ContractMake`, `Mirror`,
  `contract/suite.ts:19-114`; rules 0 to 24, `suite.ts:214-974`; runners at
  `packages/ledger/src/ledger.contract.test.ts:7-18` and
  `servers/fake/src/server.contract.test.ts:14-31`.

HTTP fake and bots:
- CLI flags and defaults, `servers/fake/src/cli.ts:13-24`; flags hardcoded
  `{ 'market.enabled': true }`, `cli.ts:58`; sweep every `60_000 / speed`, `cli.ts:90-92`.
- `VirtualClock` resumes from the snapshot plus downtime times speed, monotonic in
  process, `clock.ts:15-43`; written on every flush, `file-kv.ts:60`.
- `FileKeyValue.flushSync` rewrites the whole file synchronously, `file-kv.ts:53-65`.
- No `requestTimeout`, `headersTimeout` or `keepAliveTimeout` set; Node defaults.
- Bots: names and numbers, `bot-config.ts`; `BOT_TICK_MS = 20_000`; a bot tick is a
  bootstrap plus `host.settle`, then one of list, buy, order, cancel listing,
  `bots.ts:121-206`; bots call the ledger in-process, `cli.ts:75`; bots never submit
  batches, never `fillOrder`; bot accounts are minted linked, `bots.ts:96-119`,
  `ledger.ts:483`.
- The link approver answers `--player-name` for every code, `server.ts:139`.

Review and plan:
- Item C (the 15 s fetch timeout), `docs/reviews/2026-10-03-pr-2-review-fix-pass.md:143-191`.
- Deferred M and Q, same file, lines 520-533.
- The phase 2 plan put the long-poll in phase 5, `docs/plans/2026-10-03-promptfall-phase-2.md:639`.

## 7. Proposed PR split and order (Kevin, Q24)

**PR 1, social.** No sim change, so no reset.
- Ledger: presence in memory with the TTL; chat (gate, length, bucket, blocklist, history,
  chat mark); leaderboards maintained incrementally (highest zone only until PR 2 adds
  damage); readers for `chat.enabled`, `presence.enabled`, `leaderboards.enabled`; the
  name blocklist on display names.
- Protocol: `WorldSnapshot`, `ChatMessage`, `ChatResult`, `Boards` schemas; `world`,
  `chat`, `leaderboards` on `ServerClient` and `HttpClient`; the routes; the contract cases
  for presence, chat, leaderboards and flags on both hosts.
- Fake: `--flag`; bots as `HttpClient` users of the fake's own port that submit batches
  with a mirror, fill buy orders and post chat lines; mint and stipend in-process.
- Plugin: the world poll in the engine (15 s with the flush, 5 s while the Chat tab is
  open, failures ignored, stale after 45 s); World tab rows; Chat tab on `c`; Leaderboards
  tab on `b`; `/promptfall chat|leaderboards`; in-process flags off for chat and boss;
  README and manual pass part A.

**PR 2, world boss.**
- Sim: `SIM_VERSION` 3; `world_boss` enemy kind; `boss_engaged`, `boss_disengaged`,
  `rewarded` server events and handlers; `state.boss`; boss mode rules R1 to R4; golden
  and determinism tests updated.
- Ledger: the boss record, the 3 hour grid and 20 minute window advanced on polls and
  sweeps, HP from online count, engaging online and newly online accounts, contribution
  from the `dealt` delta on commit, rewards at the killing commit and at expiry, the
  weekly damage board, `worldboss.enabled` reader.
- Protocol: `BossView` in the snapshot; `rewarded` and the boss events in
  `ServerEventSchema`; contract cases for the grid, contribution, rewards and expiry.
- Fake and bots: nothing new beyond the mirror applying the boss events, which makes bots
  fight through their batches.
- Plugin: the 5 s poll while live, the Party tab enemy slot and status row segment with
  the predicted HP, the World tab boss row, the three toasts, the reward in the loot log,
  manual pass part B (speed 10, one boss in 18 minutes).

Order: PR 1 then PR 2. PR 2 is the one that resets states, so it ships with the reset
step in its manual pass.
