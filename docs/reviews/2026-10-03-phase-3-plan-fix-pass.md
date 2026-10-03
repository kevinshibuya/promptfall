# Phase 3 plan: review wave and fix pass

Plan: `docs/plans/2026-10-03-promptfall-phase-3.md` at `2143237`. One wave on 2026-10-03:
`reviewer` on opus (`docs/reviews/plan-phase-3/opus.findings.md`, 26 findings, O1 to O26 below),
`reviewer` on fable (`fable.findings.md`, 20 findings, F1 to F20), `codex-review` on gpt-6-astra at
xhigh (`codex.findings.md`, 24 findings, C1 to C24 in file order; log
`~/.claude/codex-runs/20261003-133258-5303-plan3-review-custom.log`, exit 0, 798 s). Engine claims
were checked against the d.ts on Kevin's machine (`docs/reviews/plan-phase-3/local-facts.md` and
the cites below). Consolidated by `reasoner` on Fable from the local session. Findings are
evidence; each line below is the ruling. Two rulings went to Kevin as questions (section 3); both were answered as recommended, and the
rulings and amendments marked (Q1) or (Q2) are settled by those answers.

Every code cite below was read on this tree. Two measurements were run from scratch scripts
against the sim (section 2.3); nothing in the repo changed.

## 1. Rulings

### Blockers

1. **The boss lifecycle in the ledger** (O2, O3, F1, F2, F3, C1, C2, C3). Three legs found the
   same family: spawn checked before expiry, so a clock jump overwrites an open boss unsettled;
   `advanceBoss` and `settleBoss` write records that `submit` holds in memory, so the last save
   wins and an engage or the rewards are lost; a refused `author` in a multi-account loop
   half-writes and then throws on every later poll; a restart with `worldboss.enabled=false`
   strands engaged accounts. Ruling: fix now, as one contract (section 2.1): settle before spawn;
   `advanceBoss` runs in `world` and `sweep` only, before any record is loaded; `submit` reaches
   `settleBoss` only through its own contribution step, after `settle(record)` and before
   `deliverReturns`, passing the record it holds; engage and disengage are guarded helpers that
   never throw; the flag off settles an open boss as expired. Six `boss.test.ts` cases.
2. **Contract-visible constants cannot be imported by the suite** (O1). Verified:
   `packages/protocol/package.json` depends on `@promptfall/sim` only; `packages/ledger` depends on
   protocol; `tsconfig.json` references follow. Ruling: fix now. The numbers the suite asserts and
   `weekStartOf` live in `packages/protocol/src/world.ts`, as `BUDGETS` already lives in
   `packages/protocol/src/client.ts:100-107` and the ledger imports it. The ledger's
   `world-config.ts` goes; `boss-config.ts` keeps only `WORLD_BOSSES`. Section 2.2.

### Majors, taken

3. **A killed boss in the snapshot** (O4, F9, C5). Shown while `now < endsAt`, closed or not,
   with `hp 0` after a kill; null after `endsAt`. "Live" means `hp > 0` for the fast cadence and
   the status segment. Section 2.5.
4. **The top-3 bonus gated by the threshold** (O7, F4, C6). Follow the spec: one bonus roll each
   for the top 3, no threshold on it. Rules 35 and 36 change with it. Section 2.4.
5. **`BOSS_BASE_HP` and the kill-time claim** (O8, C7) (Q1). The plan's per-tick table is the
   static formula; sustained damage is lower because fallen heroes stay down until a rest or a
   full wipe. Measured on this tree (section 2.3): the reference party deals 41 per idle tick,
   not 57; the fake's bots 24. Ruling: size by the measured number; recommended `4000`. Part B
   is rewritten so a kill is certain (ruling 18).
6. **Flags reaching the dialog gates** (O9, F6, C9). The gates read the snapshot's `flags` when a
   snapshot exists, the bootstrap config otherwise, through one helper. Section 2.7.
7. **Chat length counted two ways** (O10, C11). One unit at both ends: UTF-16 code units
   (`text.length`), which is what Zod's `.max(200)` counts. Narrowing added. Section 2.6.
8. **Highest-zone board names never refreshed** (O11, C12). `offerZone` always rewrites the
   account's name and keeps the higher value.
9. **Control characters in chat** (O12). The ledger strips `\p{Cc}` (C0, DEL, C1) before
   trimming, in chat text and in `publicName`; a message empty after that is `empty`. Rule 27
   gains the case. Section 2.6.
10. **Posting advances the chat mark past unseen messages** (C4) and **duplicates after a hot
    reload** (O19 second half). The mark moves only from polls; an own post is inserted into the
    buffer by id; every merge inserts by id and drops duplicates. Section 2.6.
11. **Chat posting during an outage** (C13). On the primary, `game.chat` throws `unreachable`
    when `engine.isUnreachable()` is true, without calling the server and without the lock; a
    secondary has no outage state and calls. Section 2.6.
12. **Rules 33, 35 and 36 cannot go green as written** (O5, O6, F5, F11, C17, C18, C19). Rule 33
    advances to `nextGrid − 10_000`, both traders poll, then `advance(10_000)`; rule 35 names the
    `clock.advance(120_000)` between 60-tick batches (tick bucket 70, one per 2 s,
    `client.ts:102-107`); rule 36 asserts two `rewarded { goods: null }` and `returns === 2`,
    which is what the spec's bonus gives a top-3 contributor.
13. **The weekly reset writes on a read** (F7, C10, O "consider"). `leaderboards()` computes the
    reset in memory and writes nothing; the reset is persisted on the contribution path only.
14. **The predicted HP bar double-counts on a secondary** (O13, C8). `committedDealt === null`
    means "subtract nothing"; a secondary's view is the committed state, so this is exact there,
    and it is also right on a primary before its first `committedBoss()` reading.
15. **Red windows, the PR check line and the ports** (O17, F19, O21). `servers/fake` is red from
    Task 1 to the end of Task 3; the plugin type-checks against its vendored bundles until Task 5's
    `pnpm vendor` and only `vendor:check` is stale; the PR check line gains
    `pnpm exec tsc -p plugins/promptfall && claude plugin test plugins/promptfall`; acceptance
    fakes run through `devserve run --port 7778 --ttl 5 -- pnpm fake --port 7778 …` and
    `devserve stop 7778`. Section 2.10.
16. **Files lists miss what the tasks must touch** (C14, C15, C16, O15). Task 5 adds
    `plugins/promptfall/hooks/engine.test.ts` (`Recorder implements ServerClient`, line 28, gains
    the three methods); Task 8 adds `packages/sim/src/server-events.test.ts` ("covers nine kinds",
    line 61, becomes twelve); Task 10 adds both contract runners
    (`packages/ledger/src/ledger.contract.test.ts:7-9`, `servers/fake/src/server.contract.test.ts:14-16`)
    for `options.kv`.
17. **Three `bots.test` assertions cannot pass as worded** (O16, C20, C21, C22). The viewer is
    counted, so `online 13`; the chat assertion moves to the 120-tick checkpoint (a bot's first
    line is its sixth act, tick 60 + i); a fill is observed through the bots' log line
    `bot <name> fill ok`, since `order_filled` logs a `trade bought` entry, not an `order_filled`
    one (`server-events.ts:104-110`).
18. **Manual pass part B cannot show a kill** (O8, O20, C24) (Q1, Q2). Rewritten as three
    bosses, each reached with `--boss-in <seconds>`: expiry with `--bots 0` (certain), a kill with
    `--bots 12` (certain, about 75 to 95 s into the 120 s window at base 4000), a restart
    mid-boss. The "Boss reward twice" the old step 5 promised is not reachable by a fresh player
    beside bots and is proven by rule 35 instead. "Within 5 seconds" becomes within 15. Section 2.12.

### Minors, taken

19. **The Task 6 executor check** (O14): the d.ts answers it (`InputProps.value`, E:5159-5200).
    `ChatState.draft` replaces `composeKey`; the compose `Input` is controlled and gets
    `autoFocus`. Section 2.11.
20. **Overlapping polls** (O18, F8): one poll in flight at a time; the timer skips while one is.
21. **Poller state on a followed switch** (O19 first half): the atom resets in `useServer`
    (`register.tsx:170-177`), which `restart` and `followSetting` both call.
22. **Manual pass part A steps** (O20, C23): step 5 expects bots at zone 1 or 2; step 4 says the
    fifth or sixth quick line is refused; step 9 backgrounds the primary and watches whether the
    secondary takes the lease (a same-account count can never move); step 11 unchanged once
    ruling 6 holds.
23. **`rollRewardItem` returning null** (O22): the roll pays its gold only, `rewarded { goods: null, gold }`,
    nothing queued.
24. **Refusal texts** (O23, F16): built from the protocol constants. `unauthorized` is a token
    the server no longer knows (a fresh `--data`), not a secondary (`errorText` maps the thrown
    `not_primary` to `Playing in another session`, `trade.ts:52`), so it reads
    `Session expired: /promptfall server <url> again`; `rate_limited` reads
    `Slow down: ${CHAT_BUCKET_CAPACITY} quick messages, then one every ${CHAT_REFILL_MS / 1000} seconds`.
25. **R1 applies a pending party** (O24): it does not; spec §4.3 applies it on a zone change only.
    R1 is `fullHealParty` once, nothing else.
26. **Conflict 3's cite** (O25): `heroes.ts:68` values a boss contract vendored into a full
    roster; the wording follows.
27. **Names with two homes** (O26): `WorldState` in `types/index.d.ts` only, `WORLD_DEFAULT` in
    `state.ts` only; `CHAT_DEFAULT` and `ChatState` both move to Task 6.
28. **The Party tab's slot without a matching snapshot boss** (F10): `⚔ <glyph> <name>` and
    `you <dealt>`, no bar.
29. **Task 6's mobile cite** (F12): `SURFACES` is `['terminal', 'desktop']` (`dialog.test.ts:8`);
    no test mounts a surface without `Input`. The read-only branch is tested by calling `chatBody`
    with an `els` whose `Input` is `undefined` (how `dialog.tsx:117` builds it).
30. **`chatSeen` and the closed pane** (F13, O "consider" on conflict 12): `chatSeen(now)` writes a
    plain field on `GameSession`, publishes nothing. The d.ts says `ui.render` fires when the engine
    is about to draw (E:3755) and an undrawn pane raises none (E:13155-13157), so a closed tab stops
    refreshing the mark. Conflict 12's reason is corrected: the engine has `ui.close` (E:6583) and
    `$.ui.panes()` (E:2323); the render rule is kept because it needs no hook and no bookkeeping.
31. **`Mirror` in the package root** (F14): it moves to `packages/protocol/src/mirror.ts` behind a
    `./mirror` export, imported by the suite and the bots, never by `index.ts`. It is then not
    bundled, so the injected batch-id source goes and the constructor stays `(boot)`. Section 2.13.
32. **`WORLD_BOSS_STAT_BP = 10000`** (F15): dropped. `boss_engaged.stats` is zone 1's zone boss
    stats verbatim (`content.enemies[content.zones[0].boss].stats`, `{ hp: 630, atk: 14, def: 4, spd: 5 }`).
33. **`pushLog` needs no change** (F17): `heroes.ts` leaves Task 8's Files.
34. **The poller's cite** (F18): `register.tsx:316-322`, the secondary branch of `read()`.
35. **Conflict 13, the poller-triggered `sync()`** (O "consider", F judgement): dropped. The next
    flush delivers `boss_engaged` through `cursor_behind` and the re-step (`engine.ts:280-293`),
    at most 15 s later, and the batch in flight is replayed on the engaged state on both ends, so
    no damage is lost. Section 2.9.
36. **`lastConfig`** (O "consider"): `WorldSnapshot` gains `speed`, beside `serverNow`; the
    session memory goes. Narrowing 5 extends.
37. **`advanceBoss` in `leaderboards()`**: dropped (the record says polls and sweeps; the board
    is written on contribution, not on settle).

### Deferred

- **A transaction over many records in `settleBoss`** (implied by C1, F3): the fake's
  `FileKeyValue.flushSync` writes the whole store in one rename and `MemoryKeyValue` is one
  process, so one flush is atomic on both phase 3 hosts. The real server's transaction is phase 5;
  added to Out of scope.
- **Pushed flag changes** (C3's wider point): phase 5, already listed.

### Accepted as is, noted in the plan

- **The down toast on a kill in the last seconds of the window** (F20): the client cannot tell a
  late kill from an expiry once the record leaves the snapshot. Rare; noted under narrowing 8.
- **A killing commit that also hits `hash_mismatch`** (O noted): the rewards fold into the
  adopted state (`settle(record)` runs again, `ledger.ts:296`) with no toast. Noted.
- **`presence.enabled` off with `worldboss.enabled` on engages nobody** (O noted): the spec says
  online accounts are engaged; nobody is online. Noted.
- **Overkill counts in full**: the killing batch's whole delta goes to `contributions` and the
  board (`boss.test.ts` already says so). Kept for simplicity; `yours` may exceed `maxHp`.

### Not taken

- **`advanceBoss` before the caller's load inside `submit`** (O2's first alternative): dropping it
  from `submit` is simpler and is what the record says. Expiry is noticed by the next poll or
  sweep; the `now < endsAt` guard on contribution covers the ticks in between.
- **Three stronger contributors in rule 36** (O5, F5, C19's alternative): asserting two returns is
  the rule the spec gives, with one fewer fixture.
- **Refusing control characters with a new reason** (O12's "refuse or strip"): stripping needs no
  new `ChatRefusal` and never surprises a real client, whose single-line `Input` cannot type one.
- **Refusing `switchServer`-style guards on the world poll**: nothing to add; the poll stays out
  of the outage path (clean in all three legs).

### Clean, no change

The grid arithmetic (`1_700_000_000_000 mod 10_800_000 = 4_400_000`), `weekStartOf`, the
`scaledBossStats` ratio rule, `hashState` covering `boss.dealt`, the authority of every number,
the outage separation, the vendor rule, the validate namespaces, the TTL scaling by `speed`, the
bot budgets, the PR split, the cites the legs spot-checked. All three legs agree.

## 2. Reasoning

### 2.1 The boss lifecycle, as one contract

What the plan said (L169-171) and why it fails, verified on this tree:

- `Ledger.run` (`ledger.ts:111-125`) flushes in `finally`, so a throw after a `set` leaves the
  partial writes in the store, and `author` (`books.ts:105-110`) throws on a sim refusal.
- `submit` loads the owner's record at `ledger.ts:220` and saves that object at 294 or 298. Both
  stores hand back JSON copies (`kv.ts:13-16`, `file-kv.ts:36-38`), so a second load of the same
  account is a second object; whichever is saved last wins.
- The plan's `advanceBoss` tests `bossId !== stored.bossId` before `now >= endsAt`, so a stored
  open record from an earlier window is overwritten by the spawn, never settled. The clock jumps
  exactly this way on a restart (`clock.ts:22-26`: `virtualAt + downtime × speed`).

The contract that replaces L169-171, binding on Task 10:

**Where it runs.** `advanceBoss(now)` runs first in `world()` and `sweep()`, before
`books.authenticate` or any `books.load`, so every record it writes is reloaded fresh by the
operation after it. It does not run in `submit` or `leaderboards`. (Record §1.3: "advanced lazily
on every world poll and every sweep".)

**Order inside `advanceBoss`.** With `boss = kv.get('pf:world:boss')`:

1. If `boss` exists and `!boss.closed` and (`now >= boss.endsAt` or `flags['worldboss.enabled']`
   is false): `settleBoss(boss, { expired: true, inHand: null })`. An open record is settled before
   anything else can replace it; the flag off is treated as the window closing (threshold drops
   paid, every engaged account disengaged), so nobody is left in boss mode when the feature is
   turned off.
2. If the flag is on, `now < spawnAt + BOSS_WINDOW_MS`, and (`!boss` or `boss.bossId !== bossId`):
   spawn as the plan says (`online = max(1, presence entries inside the TTL)`,
   `maxHp = hp = BOSS_BASE_HP × online`, name and glyph from `WORLD_BOSSES[gridIndex % length]`,
   `contributions = {}`, `closed = false`), save it, then `engage(record, boss)` for every online
   current account and save each.

**Two helpers that never throw** (`boss.ts`):

- `engage(record, boss)`: if `record.state.boss` is null → `author(record, boss_engaged)`. If it
  names `boss.bossId` → nothing. If it names another id → `author(boss_disengaged { bossId: record.state.boss.bossId })`
  first (the precondition holds by construction), then `boss_engaged`. Then
  `contributions[accountId] ??= 0`. A record that is not current is skipped.
- `disengage(record, bossId)`: `author(boss_disengaged)` only when `record.state.boss?.bossId === bossId`;
  otherwise skip and log.

Because both helpers check the sim's precondition before `author`, the loops cannot throw, and
`closed = true` is written even when some accounts were skipped.

**`settleBoss(boss, { expired, inHand })`.** `threshold = floor(BOSS_BASE_HP × BOSS_THRESHOLD_BP / 10000)`;
`top` = the `BOSS_TOP_BONUS` highest `contributions` above 0, ties by account id. For every
account in `contributions`: `record = inHand?.account.accountId === id ? inHand : await books.load(id)`;
skip if missing or not current; `rolls = (c >= threshold ? 1 : 0) + (!expired && top.includes(id) ? 1 : 0)`;
each roll as the plan says, except that a null `rollRewardItem` pays
`rewarded { bossId, goods: null, gold }` and queues nothing; then `disengage(record, boss.bossId)`;
`books.save(record)` (saving the in-hand record here and again in `submit` is harmless: it is the
same object). Finally `boss.closed = true`, save the boss.

**Contribution in `submit`**, after `settle(record)` (`ledger.ts:291`) and before
`deliverReturns`: `prevDealt` is captured from `record.state.boss` before `record.state = result`
(line 286). With `next = result.boss`, if `prevDealt` and `next` name the same `bossId`, that is
the stored boss's id, the record is open, `hp > 0` and `now < endsAt`: `delta = next.dealt − prevDealt`;
`hp = max(0, hp − delta)`; `contributions[id] += delta`; the weekly board (reset first if
`weekStartOf(now) !== week.start`) `damage[id] += delta` with the name refreshed; if `hp === 0`:
`settleBoss(boss, { expired: false, inHand: record })`. The ack's `deliveryOf(record)` then
carries the submitter's own `rewarded` and `boss_disengaged`, since they were authored into the
record `submit` holds. The `hash_mismatch` branch's second `settle(record)` folds them into the
adopted state, as it does returns today.

**Engage on poll** stays in `world()` after `authenticate`: an online current account not in
`contributions` of an open boss with `hp > 0` and `now < endsAt` gets `engage(record, boss)`; the
record is the one `world()` holds and saves.

**`boss.test.ts` cases that prove each:**

1. A stored open boss whose window passed, then a clock on a later grid point: one `advanceBoss`
   authors `rewarded` (where due) and `boss_disengaged` with the old id to every contributor, then
   `boss_engaged` with the new id to the online ones; the new record is open.
2. `engage` on an account whose `state.boss` names a stale id authors disengage then engage and
   does not throw; on an account already engaged with this id it authors nothing.
3. `settleBoss` over a contributor whose `state.boss` is already null closes the boss without a
   throw; the other contributors are settled.
4. An open boss with the flag turned off: the next `advanceBoss` settles it as expired (threshold
   drops only), everyone disengaged, nothing spawns.
5. `submit` as the first operation after a grid point spawns nothing; the next `world()` does.
6. A killing `submit`: the saved record (reloaded from the store after the ack) holds the
   `rewarded` events and `boss_disengaged`, and the ack's delivery carried them.

What would change this: a ledger whose `run` rolled back on a throw. It does not, and changing
`run` is a phase 2 contract.

### 2.2 Where the contract-visible constants live

Verified: `packages/protocol/package.json` depends on `@promptfall/sim` only, `packages/ledger`
on protocol and sim, `servers/fake` on all three; `tsconfig.json` references match. A ledger
import from `packages/protocol/src/contract/suite.ts` is a cycle. The precedent is already in the
tree: `BUDGETS` (`packages/protocol/src/client.ts:100-107`) and `LISTINGS_PER_PAGE` are protocol
constants the ledger imports and the suite asserts.

Ruling: `packages/protocol/src/world.ts` holds, beside the types, `PRESENCE_TTL_MS`, `HERE_MAX`,
`CHAT_MAX_CHARS`, `CHAT_BUCKET_CAPACITY`, `CHAT_REFILL_MS`, `CHAT_KEEP`, `CHAT_SERVE`,
`BOARD_ROWS` and `weekStartOf` (PR 1), and `BOSS_GRID_MS`, `BOSS_WINDOW_MS`, `BOSS_BASE_HP`,
`BOSS_THRESHOLD_BP`, `BOSS_TOP_BONUS` (PR 2). They are the wire contract's numbers: a phase 5
server that disagrees with them fails the suite, which is the point. The ledger's
`world-config.ts` is not created; `boss-config.ts` keeps `WORLD_BOSSES` (content, not a number).
The vendored protocol bundle carries them, so the plugin's refusal texts read `CHAT_MAX_CHARS`
instead of a literal (O23). The global constraint "tuning numbers live in four named files"
becomes: `packages/protocol/src/world.ts`, `packages/ledger/src/boss-config.ts`,
`plugins/promptfall/hooks/world.ts`, `servers/fake/src/bot-config.ts`.

### 2.3 `BOSS_BASE_HP` and the kill-time claim

I measured sustained damage on this tree with a scratch script (not in the repo): the harness
day replayed exactly as `packages/sim/src/harness/scenario.ts` does, with its equip habit, then
2000 ticks of boss mode emulated as one undying enemy carrying the party's zone boss stats (what
`scaledBossStats` yields, verified by the Opus leg at all 12 zones), with a full wipe undone in
place (zone and encounter restored, party healed) before the next tick. The damage dealt in the
wiping round is lost to the measurement, a small undercount.

| Party | Zone, levels | Static per tick (plan) | Sustained, idle, no rest | Wipes in 2000 | Sustained, rest every 20 ticks |
| --- | --- | --- | --- | --- | --- |
| fresh | 1, L1/1/1 | 14.0 | 8.4 | 98 | 8.7 |
| 8 h seed 7 | 3, L8 | 59.0 | 41.3 | 18 | 46.1 |
| 8 h seed 11 | 3, L8 | 55.0 | 41.6 | 35 | 44.2 |
| 40 h seed 7 | 3, L15 | 92.0 | 87.8 | 0 | 93.5 |
| 40 h seed 11 | 3, L15 | 89.0 | 86.0 | 0 | 92.2 |
| 120 h seed 7 | 5, L20 | 106.0 | 74.9 | 37 | 81.7 |
| bots, mean of `rollBotState(1, i)` | 11 of 12 at zone 1, L4 | 28.6 | 23.8 | | 26.3 |
| level-40 party (rule 35's "strong") | 1, L40 | 201 | 241.7 (min 217, max 262) | 0 | |

These reproduce the Opus leg's numbers to the decimal (41.3, 41.6, 87.8, 86.0, 74.9, fresh
8.3 vs my 8.4) and codex's 189 to 191 ticks to 8000 for the 8 h party (8000 / 41.3 = 194). The
plan's table is the static formula and is correct as such; the premise "R1 keeps them alive" is
wrong, since `checkWipe` (`progression.ts:273`) acts only when `livingParty` is empty and a
fallen hero acts no more (`combat.ts:112`). A rest revives at 30% (`healParty`,
`progression.ts:109-115`), which is why the rest column is higher.

The working, redone. The record's rule: base sized so the parties present kill it in about 12
minutes of normal ticking (one tick per 5 s, 144 ticks).

- Reference party (the day-one player): 41 × 144 = 5,904 → base ≈ 6000.
- The fake's bots: 24 × 144 = 3,456 (26 × 144 = 3,744 with their rest every fourth batch) → base ≈ 3500 to 3700.
- A fresh party: 8.4 × 144 = 1,210; it can never kill its own share at any base above that.

Bots deal 300 ticks per 20-minute window (0.25 ticks per virtual second, any `--speed`), so a
bot kills its share of the window only when base < 300 × 24 = 7,140 (7,890 with rests). At
8000 the default fake (12 bots, a player) always sees an expiry: 104,000 HP against 12 × 5.95 +
8.2 = 79.6 damage per second = 1,306 s, past the 1,200 s window.

| Base | Reference party, idle | Reference, in a turn | Bots alone | Default fake (12 bots + reference player) | Fresh party to the threshold, in a turn |
| --- | --- | --- | --- | --- | --- |
| 4000 | 98 ticks, 8.1 min | 3.3 min | 11.2 min (10.1 with rests) | 10.9 min | 200 damage: 24 ticks, 48 s |
| 6000 | 146 ticks, 12.2 min | 4.9 min | 16.8 min (15.2) | 16.3 min | 300: 36 ticks, 72 s |
| 8000 | 195 ticks, 16.3 min | 6.5 min | 22.4 min: expiry | 21.8 min: expiry | 400: 48 ticks, 96 s |

Recommendation: 4000 (question Q1). It is the only value where the parties actually present in
phase 3, the bots, kill the boss comfortably inside the window and part B can show a kill with
the plan's own tools. 6000 follows the record's reference party literally, but a kill on the
fake lands at 15 to 17 minutes of 20, bursty, and the part B kill with 12 bots lands at about
110 s of 120, not certain. The number stays tuning in one file; the plan's text says which
measurement it came from.

### 2.4 The top-3 bonus and the 5% threshold

Spec §6 and record §1.3 T1: "a guaranteed drop for any contribution at or above 5 percent of
the base, one bonus roll each for the top 3 contributors". The plan added `contribution >= threshold`
to the bonus and did not list it. With 3 online and three contributors at 300 each, the spec
pays three rolls and the plan pays none. The spec's reading rewards showing up, which is what a
shared boss wants; the plan's reading has no stated reason. Ruling: follow the spec. Rule 35
changes: B, a one-tick contributor who is one of two, gets one `rewarded` (the bonus) then
`boss_disengaged`. Rule 36: C gets two rolls, both into returns. Nothing goes to Kevin because
nothing departs from what Kevin decided.

### 2.5 A killed boss in the snapshot

The plan said both "null when none is open" (L164) and "hp 0 until endsAt" (L39, conflict 8,
rule 35). Ruling: the snapshot carries the stored record as `BossView` while `now < endsAt`,
whatever `closed` says, so a kill shows `hp 0` until the window ends and the `<name> is down`
toast has a transition; after `endsAt` it is null. "Live" is `hp > 0`: the fast cadence
(Task 5) and the status row's segment (Task 11) use it, so a dead boss does not keep every
session at 5 s for the rest of the window or draw `boss 0% · 11m` (F9). The World tab's row 2
reads `<name> is down · you <dealt>` at `hp 0`.

### 2.6 Chat delivery and limits

**The chat mark** (C4): with the mark at 10, another post 11, an own post 12 appended with the
mark moved to 12, the next poll asks `since=12` and 11 is never seen. Ruling: `chatMark` moves
only when a poll lands (`chatMark = last id of the snapshot's chat`); an own post is inserted
into `messages` by id and the mark stays. Every merge (poll or own post) inserts by id, keeps
ascending order and drops duplicates, which also covers a hot reload's restart at mark 0 over a
populated buffer (O19). The cost: one duplicate of the own post comes back in the next poll and
is dropped.

**The length unit** (O10, C11): the ledger counted code points, Zod counts UTF-16 units; a
150-emoji message passes the ledger and breaks every snapshot parse (`http.ts:141-144`). Ruling:
`text.length` at both ends, 200 UTF-16 units. It is what every JS `length` and Zod's `max` count,
needs no refine, and the client can check it locally the same way. An emoji counts as two; the
spec's "200 characters" is narrowed to that unit (new narrowing).

**Control characters** (O12): the d.ts refuses one in a pane title (E:6946), bounds `Code` the
same way as `Text` (E:1450), and allows only tab and newline in `Markdown` (E:5395); what a `Text`
child with ESC or a newline does is not stated, so it is unsafe. The ledger is the phase 5
server core, so the rule belongs there. Ruling: `chat()` strips `\p{Cc}` (`/\p{Cc}/gu`: C0, DEL,
C1) before trimming; `publicName` does the same to the display name; a message empty after
stripping is `empty`. Rule 27 gains: `'hi\u001b[31m'` is stored as `hi[31m`, `'\n\t'` is
`empty`. Stripping rather than refusing adds no `ChatRefusal` and cannot surprise the plugin's
single-line `Input`.

**Posting in an outage** (C13): record §1.1 says chat in an outage answers the unreachable text.
`engine.isUnreachable()` exists (`engine.ts` after `clearOutage`). Ruling: on the primary,
`game.chat` checks it first and throws `unreachable` without a server call and without the lock
(no flush, no lease, as the record wants); on a secondary there is no outage state and the call
goes out. `dialog.test.ts` gains: with the engine in an outage, Enter flashes `Server unreachable`
and no `POST /v1/chat` goes out.

### 2.7 Flags reaching the dialog gates

Verified: `rememberConfig` (`engine.ts:526-532`) runs from `doStart` and `sync` only; outage
recovery goes through `doFlush`, which does not call it; `toAccountView` (`view.ts:133-145`)
reads `config.flags`. So after a restart with `--flag chat.enabled=false` the band's row 3 (from
the snapshot) says closed within 15 s while the Chat tab (from the config) keeps its compose box:
part A step 11 is red as designed, against record §1.7.

Ruling: one helper in `view.ts`, `gates(world: WorldState, account: AccountView)`, answers
`{ chatOpen, presenceOpen, leaderboardsOpen, bossOpen, marketOpen }` from
`world.snapshot?.flags` when a snapshot exists, else from the `AccountView` booleans (which keep
coming from the bootstrap config, as the fallback before the first poll). The dialog's gates, the
band's World tab and the market gate (`gateText`, `trade.ts:30`) read it; `marketOpen` joins so
that all five flags obey one rule. The source of truth for a gate is the newest thing the client
has seen, which is the snapshot once there is one.

### 2.8 The secondary's predicted HP and the leaderboard write

**Predicted HP** (O13, C8): a secondary's view is the committed state plus the delivery
(`register.tsx:437-464`), so `view.boss.dealt` there is already in the server's HP; subtracting
it is double counting. Ruling: `shownHp = max(0, boss.hp − max(0, view.boss.dealt − baseline))`
with `baseline = committedDealt?.bossId === boss.bossId ? committedDealt.dealt : view.boss.dealt`,
that is, a missing or foreign `committedDealt` subtracts nothing. The secondary publishes
`committedDealt: null` as planned and is exact; a primary before its first reading is exact too.

**The weekly reset on read** (F7, C10): the plan said "reads flush nothing" one paragraph above a
read that writes `pf:boards`. On the in-process host each session constructs its own `Ledger`
over the shared store (`server.ts:24-34`), so a secondary's read could overwrite the primary's
zone board with an older copy. Ruling: `leaderboards()` answers `damage: []` and
`weekStart: weekStartOf(now)` when the stored week is older, writing nothing; the contribution
path resets and persists `week` before adding. Reads stay reads.

### 2.9 Conflicts 12 and 13

**Conflict 12.** The local facts show `ui.close` (E:6583, with `PaneCloseInput` at E:2295-2302)
and `$.ui.panes()` (E:2323), so "no pane-close hook among the engine facts" was true of the facts
the planner had and false of the engine. Does the design change? No. The render-driven rule
needs no hook, no pane bookkeeping, no new `$` call for validate to list, and the test kit drives
renders already; its cost is at most 20 s of fast polling after the tab closes. The one risk,
that a closed pane keeps rendering, is answered by the d.ts: `ui.render` fires when the engine is
about to draw (E:3755) and a pane that waits undrawn raises none (E:13155-13157). The reason is
rewritten; `chatSeen` is stated to write a plain field and publish nothing (F13).

**Conflict 13.** The poller-triggered `sync()` buys at most 15 s over the next flush, which
delivers `boss_engaged` through `cursor_behind` and re-steps the batch in flight
(`engine.ts:280-293`). The ledger replays that batch on the engaged state too, so the ticks
inside it hit the boss on both ends and no contribution is lost; only the display lags. In
exchange the sync adds a once-per-change memory, a flush started from the poller, and a test.
Ruling: drop it. Narrowing 13 becomes a statement of how `boss_engaged` reaches a playing
primary (the flush path, within 15 s) and why that is enough. The Fable leg judged the sync
sound; it is, but the simpler path is sound too.

### 2.10 Acceptance checks and red windows

Verified: `servers/fake/src/server.ts:142` keys `handlers` by `ROUTES`, and the fake depends on
the ledger, so `servers/fake` is red from Task 1 to the end of Task 3 (O17, F19). The plugin
compiles against `hooks/vendor/*` until `pnpm vendor` runs in Task 5, so it is not red after
Task 1; `vendor:check` is stale. Root `package.json`: `typecheck` builds the four packages and
`test` filters `packages/*` and `servers/*`; neither touches the plugin. Ruling: the PR check
line is `pnpm lint && pnpm typecheck && pnpm test && pnpm vendor:check && pnpm exec tsc -p plugins/promptfall && claude plugin test plugins/promptfall`.
Acceptance fakes: `devserve run --port 7778 --ttl 5 -- pnpm fake --port 7778 --data /tmp/pf-p3.json …`,
the curls against 7778, then `devserve stop 7778`. Checked by the main session: `devserve run` detaches the process,
waits up to 2 s to confirm it is alive, registers it and returns to the shell printing
`pid=… port=… log=… ttl=…`; `devserve stop <pid|port>` stops it. 7777 stays Kevin's.

### 2.11 The Task 6 executor check

The d.ts answers it (local facts): `InputProps.value` is "the text the field holds when drawn;
the person's typing replaces it until the hook draws another", `key` is the element's address
and a remount with a new key may move the focus ring, and `autoFocus` puts the ring on the field
when the site takes the keyboard (a pane opened with `focus` is a take). The codebase already
draws controlled inputs (`ui/orders.tsx:228-238`). Ruling: `ChatState = { draft: string; busy; error }`;
`onInput` writes `draft`; `onSubmit` posts and sets `draft = ''` on `ok`, so the box clears
without a remount. `autoFocus` yes: `/promptfall chat` opens with focus and lands in the box,
which is what part A step 4 types into; the hotkey trap (a focused `Input` takes every printable
key) is already in the manual pass preamble. The executor step becomes a note, not a check.

### 2.12 Manual pass part B and `--boss-in`

With the measured numbers, the old part B (speed 10, two bots, one boss) cannot show a kill:
24,000 HP against two bots' 14,280 plus a fresh player's 500 in the 120 s window. At base 4000
with two bots it is a coin flip (12,000 against 14,800, bursty, and 11,700 once the bots reach
zone 2). Certainty needs the two outcomes separated:

- **Expiry, certain:** `--bots 0`, HP 4000, the player alone deals about 500 in a turn. The
  threshold (200) is crossed at about 48 s of the turn, so one `Boss reward` follows the expiry.
- **Kill, certain:** `--bots 12`, HP 52,000 (13 × 4000), the bots deal 85,680 in the window
  (67,000 if they have reached zone 2): the kill lands at 73 to 93 s. The player is not in the
  top 3 beside 12 bots, so one reward at most, and only if the turn started before the spawn so
  `you` passes 200 (about 48 s) before the kill (73 s at the earliest). The "Boss reward twice"
  of the old step 5 is unreachable for a fresh player with a kill and is proven by rule 35.
- **Restart mid-boss:** a third spawn.

Three spawns at speed 10 are up to 54 real minutes of waiting, and the HANDOFF fast-forward
trick cannot stop near a grid point (one second at speed 2000 is 33 virtual minutes). Hence Q2:
`--boss-in <seconds>`, a fake-only flag that moves the virtual clock forward at start so the
next grid point is that many real seconds away. It only ever moves forward, so the clock stays
monotonic; skipping windows is harmless because a boss that never spawned owes nothing, and an
open boss left in the data is settled as expired by the first poll (2.1). The record said
"add `--boss-at` only if the manual pass finds 18 minutes too long"; the pass now needs three
windows, which is the case the record reserved. "Within 5 seconds" of the grid point becomes
within 15: the session polls every 15 s until it has seen a boss (C24).

### 2.13 `Mirror`'s home

`scripts/vendor.mjs:38-44` bundles `packages/protocol/src/index.ts`, so a root export carries
`Mirror` into `hooks/vendor/protocol.js`, which nothing in the plugin uses; the package already
has a `./contract` subpath export. The move out of `suite.ts` is right (`suite.ts:14` imports
vitest, which the fake must not load). Ruling: `packages/protocol/src/mirror.ts` behind
`"./mirror": "./src/mirror.ts"` in `package.json`, imported by the suite and the bots, never by
`index.ts`. Not bundled, so `crypto.randomUUID()` can stay (Node 22 and vitest both have it) and
the constructor is unchanged: no injected id source, one less option.

## 3. Kevin's answers

Answered on 2026-10-03, verbatim:

> "Q1: ok, the recommended;
> Q2: ok, the recommended;"

So Q1 is (a), `BOSS_BASE_HP = 4000`, and Q2 is (a), `--boss-in <seconds>` is added. The round as put:

❓ **Q1** - **`BOSS_BASE_HP`**: the plan's 8000 rests on a static damage formula; measured sustained damage (section 2.3) is 41 per idle tick for the day-one reference party and 24 for the fake's bots, so at 8000 the bots never kill the boss and the default fake always sees an expiry. Options: (a) `4000`: the bots kill their share in about 11 minutes, the day-one player in 8 idle (3.3 in a turn), a 40-hour party in 4; the threshold is 200 damage; part B shows a certain kill with 12 bots. (b) `6000`: the day-one player's share takes 12.2 idle minutes, the record's wording to the letter; the bots take 15 to 17 of 20, so the default fake kills late and not always, and part B's kill with 12 bots lands at about 110 s of 120, not certain. (c) keep `8000`: the kill path is proven by rule 35 and never seen on the fake or in the manual pass.

➡️ (a) `4000`. The record sizes the base by "the parties present", and in phase 3 those are the bots and early players; 4000 is the value at which both kill inside the window with margin, and it is the only one that makes part B's kill certain with the plan's own tools. It stays one number in one file.

---

❓ **Q2** - **`--boss-in <seconds>` on the fake**: the record (§1.3, §5) added no dev override and said to add `--boss-at` only if the manual pass found 18 minutes too long. Part B now needs three spawns (an expiry with no bots, a kill with 12, a restart mid-boss), which at speed 10 is up to 54 real minutes of waiting, and the fast-forward trick cannot land near a grid point. Options: (a) add `--boss-in <seconds>`, which moves the virtual clock forward at start so the next grid point is that many real seconds away (forward only, monotonic kept; a pure function with a unit test; the startup line prints `boss in <n>s`); (b) no override: part B waits for three spawns, or shows fewer paths.

➡️ (a). It is the case the record reserved the override for, the clock stays monotonic, and it is one pure function plus a CLI line. Without it the manual pass either takes an hour or stops checking the kill path by hand.

---

## 4. Ordered amendments

Applied to `docs/plans/2026-10-03-promptfall-phase-3.md` in this order. Line numbers are the
plan's at `2143237`.

1. **Header.** `Review wave:` reads: `done 2026-10-03: reviewer on opus, reviewer on fable, codex-review on gpt-6-astra at xhigh; this is the fixed plan, consolidated in docs/reviews/2026-10-03-phase-3-plan-fix-pass.md; no second wave`. `Delivery:` red windows: in PR 1, `packages/ledger` and `servers/fake` do not type-check from Task 1 to the end of Task 2 (`ServerClient` has three methods the ledger lacks; the fake's handler table is keyed by `ROUTES`) and `servers/fake` stays red to the end of Task 3; rules 25 to 32 fail over HTTP until Task 3; the plugin type-checks against its vendored bundles until Task 5 but `vendor:check` is stale from Task 1 to the end of Task 5. PR 2 as before. The PR check line everywhere (header, Tasks 7 and 12) is `pnpm lint && pnpm typecheck && pnpm test && pnpm vendor:check && pnpm exec tsc -p plugins/promptfall && claude plugin test plugins/promptfall`.
2. **Global constraints, L22.** Tuning files: `packages/protocol/src/world.ts` (the contract-visible numbers and `weekStartOf`), `packages/ledger/src/boss-config.ts` (`WORLD_BOSSES`), `plugins/promptfall/hooks/world.ts`, `servers/fake/src/bot-config.ts`. Tests import them.
3. **Shared contracts, protocol (L29-81).** `WorldSnapshot` gains `speed: number`. `ChatMessage.text` is 1 to 200 UTF-16 units after trimming. The constants of amendment 2 and `weekStartOf` are declared here (PR 1 set and PR 2 set, with `BOSS_BASE_HP = 4000` (Q1)). `Mirror`: `packages/protocol/src/mirror.ts` behind a `./mirror` export, constructor `(boot: Bootstrap)` unchanged, `batch()` keeps `crypto.randomUUID()`, never exported from `index.ts`; the suite imports `../mirror`, the bots `@promptfall/protocol/mirror`.
4. **Shared contracts, sim (L106-119).** `boss_engaged.stats` is zone 1's zone boss stats verbatim; `WORLD_BOSS_STAT_BP` and `scale` go. R1: `fullHealParty` once, no `applyPendingParty`, no retreat, no `wipes` increment, no `wipe` effect, encounter and `pendingTurnBoss` kept, returns `true`.
5. **Ledger additions (L123-172).** Drop `world-config.ts`; `boss-config.ts` is `WORLD_BOSSES` only; the constants import from `@promptfall/protocol`. Replace the rules for `world`, `chat`, `leaderboards`, `offerZone`, `advanceBoss`, contribution and `settleBoss` with section 2.1 and 2.6 to 2.8: `advanceBoss` in `world` and `sweep` only, before any load, settle before spawn, flag off settles as expired; `engage`/`disengage` helpers; `settleBoss(boss, { expired, inHand })` with the spec's bonus and the null-roll rule; contribution after `settle(record)` with `prevDealt` captured before the assignment, the week reset persisted there; `chat` strips `\p{Cc}`, counts `text.length`; `publicName` strips `\p{Cc}`; `leaderboards` resets in memory and writes nothing; `offerZone` rewrites the name and keeps the higher value. `boss.test.ts` cases of 2.1.
6. **Plugin world-poll contract (L207-238).** `WorldState.clock.speed` from the snapshot; `lastConfig` goes. `chatMark` moves only on a poll; merges insert by id and drop duplicates; an own post is inserted without moving the mark. One poll in flight at a time. The atom resets in `useServer`. `committedDealt` null means "subtract nothing". `game.chat` throws `unreachable` on the primary when `engine.isUnreachable()`. `chatSeen(now)` writes a plain field. No sync trigger. "Live" is `snapshot.boss !== null && hp > 0` for the cadence.
7. **Tuning table and working (L240-268).** `BOSS_BASE_HP = 4000` (Q1), the measured table and the working of section 2.3 replace L259-268; the threshold row reads `200 damage, 24 idle ticks for a fresh party`; the boss stats row drops the bp.
8. **Task 1.** Files: `mirror.ts` (unchanged `Mirror`), `packages/protocol/package.json` (the `./mirror` export), `world.ts` holds the constants and `weekStartOf`; `packages/protocol/src/world.test.ts` (create): `weekStartOf` on a Monday 00:00 UTC, one ms before, a Thursday. `WorldSnapshotSchema` includes `speed`.
9. **Task 2.** Files: no `world-config.ts`; `world.test.ts` loses the `weekStartOf` cases and gains: `publicName` strips a control character; `offerZone` refreshes a name at the same value. Rule 27 gains the control-character and UTF-16 cases (an emoji counts two). Rule 31 gains: a trader linked after its first commit shows its login at the same zone. Rules 25 to 32 import the constants from `../world`.
10. **Task 3.** Acceptance check through `devserve run --port 7778 --ttl 5 -- pnpm fake --port 7778 --data /tmp/pf-p3.json --flag chat.enabled=false --bots 0`, curls against 7778, `devserve stop 7778`.
11. **Task 4.** `bots.test.ts`: `online 13` from a viewer; chat lines from at least two bot names at the 120-tick checkpoint; a fill observed as a `bot <name> fill ok` log line (the bots log every action's outcome in that shape); keep the rest. Acceptance check through `devserve` on 7778 as in 10.
12. **Task 5.** Files add `plugins/promptfall/hooks/engine.test.ts` (`Recorder` gains `world`, `chat`, `leaderboards`). `WorldState` declared in `types/index.d.ts` only; `WORLD_DEFAULT` in `state.ts` only; `CHAT_DEFAULT` leaves this task. `view.ts` gains `gates(world, account)`; `toAccountView` keeps the four booleans as the fallback; `gateText(view, world)`. `register.test.ts` adds: a second poll is not sent while one is in flight; a snapshot repeating a held id adds no duplicate; a secondary following a switch of the `server` key resets the atom and polls the new base URL; `clock.speed` equals the snapshot's. The cadence case reads `hp > 0`.
13. **Task 6.** `ChatState = { draft: string; busy: boolean; error: string | null }`; the compose `Input` is controlled (`value={chat.draft}`, `onInput` writes it, `autoFocus`), cleared by `draft = ''` on `ok`; the executor step becomes a note citing the d.ts. Refusal texts from the protocol constants; `unauthorized` reads `Session expired: /promptfall server <url> again`. The mobile case tests `chatBody` with `els.Input` undefined. New test: in an outage, Enter flashes `Server unreachable` with no `POST /v1/chat`. `chatSeen` as in 6. Gates through `gates(world, view.account)`.
14. **Task 7.** Part A: step 4 "the fifth or sixth quick line"; step 5 bots at zone 1 or 2; step 9 hides the first terminal (the primary) for 2 minutes and watches the second: `playing in another session` stays if timers fire while backgrounded, the second becomes the primary (the lease lapsed) if they do not; step 11 unchanged. The check line of amendment 1.
15. **Task 8.** Files add `packages/sim/src/server-events.test.ts` ("covers nine kinds" → twelve); drop `heroes.ts`. `boss.test.ts` wipe case: healed in place, `pendingParty` untouched. Golden stats unchanged (they are zone 1's boss verbatim).
16. **Task 9.** Rules 33 to 40 rewritten: constants from `../world`; rule 33 advances to `nextGrid − 10_000`, both poll, `advance(10_000)`, `maxHp === 2 × BOSS_BASE_HP`, stats equal `content.enemies[content.zones[0].boss].stats`; rule 34 uses 20 ticks (a level-40 party deals about 240 per tick, measured, so 20 ticks stay under 8000); rule 35: B one tick, A batches of 60 with `clock.advance(120_000)` before each after the first until the ack carries `boss_disengaged` (at base 4000 the first batch kills), A's delivery two `rewarded` then `boss_disengaged`, B's one `rewarded` (the bonus) then `boss_disengaged`, snapshot `hp 0` same id, null after `advance(1_200_000)`, a later tick adds nothing; rule 36: C's two `rewarded { goods: null, gold > 0 }`, `returns === 2`, one `returned` after vendoring one item; rule 37: A commits 3 ticks (about 725, over any threshold), B one tick (under), expiry pays A one `rewarded` only; rules 38 to 40 as before (the flag-off settlement is `boss.test.ts` case 4, not a contract rule, since it needs an open record under a host with the flag off).
17. **Task 10.** Files add both contract runners (`options.kv ?? new MemoryKeyValue()`), `servers/fake/src/boss-in.ts` with `bossInRebase(virtualNow, seconds, speed): number | null` and its test, `servers/fake/src/cli.ts` (`--boss-in`, the startup line's ` boss in <n>s`) (Q2). `boss.ts` exports `advanceBoss`, `engage`, `disengage`, `contribute`, `settleBoss`, `toBossView`. `boss.test.ts` holds the six cases of 2.1 beside the plan's. `advanceBoss` wired in `world` and `sweep` only.
18. **Task 11.** Predicted HP with the "subtract nothing" baseline; the status segment and the World row only while `hp > 0`; `<name> is down · you <dealt>` at `hp 0`; the slot without a matching snapshot boss reads `⚔ <glyph> <name>` and `you <dealt>`; no sync trigger (the register test for it goes; one is added: after a snapshot shows a boss, the next flush's `cursor_behind` re-step puts the primary in boss mode without an `account` call); `band.test.ts` adds the secondary case (`committedDealt` null, bar equals the snapshot's `hp`).
19. **Task 12.** Part B rewritten per 2.12, at speed 10 with `--boss-in` (Q1, Q2): 1 reset with `--bots 0 --boss-in 240`; 2 the countdown from `/v1/health`; 3 start the turn (`sleep 5` thirty times) before the spawn; 4 it appears within 15 s: `4,000/4,000`, `boss 100% · 2m`, `you 0`; 5 the fight: `you` rises about 8 a tick, heroes fall and the party heals in place on a wipe, no spawns from tool calls; 6 expiry at 2 minutes: no down toast, one `Boss reward: <item> (<rarity>)` within 15 s, the loot line, waves back; 7 leaderboards list you; 8 Ctrl-C, restart `--bots 12 --boss-in 60`, turn started before the spawn: `52,000/52,000`, `<name> is down` at about 75 to 95 s, one `Boss reward` if `you` passed 200 before the kill (that is the threshold working; the top-3 bonus is rule 35's), the boards list you and the bots; 9 restart mid-boss: `--boss-in 60`, Ctrl-C 30 s after it appears, restart without `--boss-in`, the line is back within 15 s with the HP it had; 10 in-process; 11 validate.
20. **Spec conflicts and narrowings.** 3 cites the contract valuation; 5 adds `speed`; 8 adds "live is `hp > 0`" and the late-kill note; 10 adds the name refresh and the max; 12's reason corrected (the engine has `ui.close`; the render rule is kept for simplicity, a closed pane raises no render); 13 becomes "`boss_engaged` reaches a playing primary through the next flush's `cursor_behind` re-step, within 15 s; no poller-triggered sync"; 16 reworded (`./mirror` subpath, no injection); 20 says `--boss-in` is added (Q2). New: 23 chat length is 200 UTF-16 units; 24 control characters are stripped from chat text and names; 25 `worldboss.enabled` off settles an open boss as expired; 26 the contract-visible numbers live in `@promptfall/protocol`; 27 `advanceBoss` runs on polls and sweeps only, never in `submit`; 28 overkill counts in full; 29 a null reward roll pays its gold only; 30 own posts do not move the chat mark; 31 `BOSS_BASE_HP` is sized by measured sustained damage, 4000 (Q1). The threshold-on-bonus narrowing is not added: the plan follows the spec.
21. **Out of scope.** Add: a transaction over many records in `settleBoss` (phase 5; both phase 3 hosts flush atomically); remove `--boss-in` from the list (Q2).
