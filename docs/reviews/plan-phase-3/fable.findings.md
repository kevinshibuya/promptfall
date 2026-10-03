# Phase 3 plan review, reviewer on Fable

Target: `docs/plans/2026-10-03-promptfall-phase-3.md` at `fe01e64`, reviewed from a fresh
clone with `pnpm install`, `pnpm typecheck` and `pnpm test` green on the tree (13 + 2 + 3 + 3
test files). Plan line numbers are from that commit. Every `file:line` below was read.

## Findings, most severe first

### 1. Blocker. `advanceBoss` spawns before it expires, so an unsettled boss is overwritten

- Plan line 169. Code: `servers/fake/src/clock.ts:130-133`, `packages/ledger/src/books.ts:105-110`.
- Defect: the spawn check runs before the expiry check, and only a *closed* record is said to
  stay stored, so an open record whose window passed while the clock jumped a grid point is
  replaced and never settled.
- Scenario: Kevin stops the fake with a boss live (manual pass part B leaves one live after
  step 7) and restarts it later. The virtual clock resumes at `virtualAt + downtime × speed`
  (`clock.ts:130-133`): 18 real minutes at speed 10, or the HANDOFF fast-forward trick, is a
  new grid window. The first poll finds `bossId !== stored.bossId` inside a window and
  spawns. The old boss's contributors (every bot, the player) keep `state.boss` set to the old
  id and never get `rewarded` or `boss_disengaged`. The new spawn's `boss_engaged` to any of
  them is `already_engaged`; `author` throws (`books.ts:108-110`), the operation throws,
  `run` still flushes what was written (`ledger.ts:111-125`), and every later `world()`,
  `sweep()` and `submit()` retries the same spawn and throws again. The fake's world poll
  answers 500 for everyone until the window passes, and the next grid point throws again.
  Rule 40 does not catch it: it restarts without downtime.
- Direction: settle the stored record first (expired or killed and not closed), then spawn.
- Confidence high. Verified against the clock and `author`.

### 2. Major. `advanceBoss` and `settleBoss` inside `submit` write records that `submit` holds in memory

- Plan lines 169 to 171. Code: `packages/ledger/src/ledger.ts:220, 286-298`.
- Defect: `submit` loads the submitter's record at line 220 and saves that object at line 294
  or 298; the plan runs `advanceBoss` "after authentication, before the replay" and has
  `settleBoss` "load the record" for every contributor, so both can author onto a second copy
  of the submitter's record that the later save overwrites.
- Scenario A: the first request after a grid point is a flush from an online account.
  `advanceBoss` engages it through a loaded copy and saves; `submit` replays on the stale
  in-memory record and saves it over the engaged one. `contributions` says engaged, the
  state is not, the party never fights, and at settle `boss_disengaged` is `not_engaged`
  and throws (finding 3).
- Scenario B: every killing commit. `settleBoss` loads the killer's stored record, which is
  the pre-batch one, authors two `rewarded` and `boss_disengaged`, saves; `submit` then saves
  its in-memory record over it. The rewards are gone, `state.boss` stays set, the ack's
  delivery is empty, and the next spawn throws `already_engaged`. Rule 35 would go red, and
  the executor would have to improvise the fix.
- Direction: run `advanceBoss` before `books.load(owner)`, and give `settleBoss` the
  submitter's in-memory record in place of a load.
- Confidence high on the hazard; which scenario happens depends on the executor's choice,
  and the plan steers toward both.

### 3. Major. A refused `author` inside a multi-record operation leaves the ledger half written and retrying forever

- Plan lines 169 to 171. Code: `packages/ledger/src/books.ts:105-110`, `ledger.ts:111-125`.
- Defect: the engage loop and `settleBoss` author into many records in one operation, and
  the plan skips only a record that is not current; `author` throws on `already_engaged` or
  `not_engaged`, and the plan says nothing about either.
- Scenario: one account whose `state.boss` disagrees with `contributions` (findings 1 and 2,
  or a `settleBoss` that threw halfway last time) makes the loop throw. Records authored
  before it were saved; the boss record was not closed. Every later poll, sweep and submit
  enters `advanceBoss`, hits the same account, throws again. No client can poll.
- Direction: in both loops, check `record.state.boss` before authoring and skip with a log
  line instead of letting `author` throw; close the boss even when some accounts were skipped.
- Confidence high. Verified against `author` and `run`.

### 4. Major. The top-3 bonus is gated by the threshold; the record and the spec do not gate it

- Plan line 171 (`rolls = … + (!expired && account in top && contribution >= threshold ? 1 : 0)`)
  and rule 35, line 518 ("B's `account()` delivery carries `boss_disengaged` and no
  `rewarded`"). Contract: record §1.3 ("Guaranteed drop for any contribution at or above 5%
  of base (T1); one bonus roll each for the top 3"), spec §6, same words.
- Defect: the plan adds a second condition to the bonus roll and does not list it under
  "Spec conflicts and narrowings".
- Scenario: 13 online, the top three contributors dealt 300 each and nobody reached 400. The
  record gives each of them one roll; the plan gives nobody anything. Rule 35 bakes the
  plan's reading in, so the tests would enforce the departure.
- Direction: either drop the second `contribution >= threshold` or add the departure to the
  narrowings with its reason; I report the contradiction and pick no side.
- Confidence high. Not a code question.

### 5. Major. Rule 36 contradicts `settleBoss` as written

- Plan line 519 against line 171.
- Defect: C is strong, over the threshold and one of two contributors, so C is in the top 3
  and `settleBoss` gives two rolls, two items into returns, two `rewarded { goods: null }`
  and `returns === 2`; the rule asserts one `rewarded` and `returns === 1`.
- Scenario: the executor writes the rule as specified, it fails against a correct `settleBoss`,
  and the executor must choose which contract to break.
- Direction: make C's expected count two, or mint a third strong account so C is fourth.
- Confidence high.

### 6. Major. Flag changes reach the dialog gates through a bootstrap config the primary never refreshes

- Plan lines 388, 392, 402 (`AccountView` gains `chatOpen`, `presenceOpen`,
  `leaderboardsOpen`, `bossOpen`; `toAccountView` reads the four flags) and manual pass part
  A step 11, line 459. Contract: record §1.7 ("a client sees a change within one poll").
  Code: `plugins/promptfall/hooks/engine.ts:526-542` (`config` is set only by `start` and
  `sync`), `engine.ts:267` (`clearOutage` after a successful submit, no bootstrap),
  `view.ts:133-145`.
- Defect: the band's row 3 reads the snapshot's `flags` and the Chat tab's gate reads the
  engine's bootstrap config, so the two surfaces learn a flag change at different times, and
  the primary's dialog learns it only at the next Market or Orders sync or a restart.
- Scenario: step 11 restarts the fake with `--flag chat.enabled=false`. The band says
  `chat is closed` within 15 s; the Chat tab keeps its compose box, and a post flashes
  `chat closed`. The step is red as designed.
- Direction: derive the four booleans from `world.snapshot.flags` when a snapshot exists, the
  bootstrap config otherwise.
- Confidence high. Verified against the engine's config path.

### 7. Minor. The weekly reset on `leaderboards()` is a write on a read path

- Plan line 166 against line 162 ("reads flush nothing").
- Defect: a read resets `week` in the store; on the in-process host a secondary session's
  own `Ledger` instance would write `pf:boards` into the shared store.
- Scenario: harmless today because `week.damage` is always empty in-process, but it breaks
  the single-writer rule the plan states one paragraph earlier.
- Direction: reset in memory on read; persist the reset only on the contribution path.
- Confidence high.

### 8. Minor. No rule for overlapping polls

- Plan lines 229 to 232. Engine fact: a timed-out fetch is not cancelled (record §6).
- Defect: at the 5 s cadence against a stalled server, three polls can be in flight, and a
  late answer can land after a newer one and publish the older snapshot; the generation
  counter is stated for the stale timer only.
- Scenario: the fake pauses for 20 s; the snapshot flickers back by one poll.
- Direction: skip a poll while one is in flight and drop a response older than the last published.
- Confidence medium. Not verifiable without the engine.

### 9. Minor. "Live" is undefined for the fast cadence and the status segment after a kill

- Plan lines 230 (`snapshot.boss !== null`), 570, and narrowing 8 (the boss stays in the
  snapshot with `hp 0` until `endsAt`).
- Defect: after a kill every session polls every 5 s for the rest of the window, up to 20
  minutes, and the status row would read `boss 0% · 11m`.
- Direction: live means `hp > 0` for the cadence and the segment; keep the `hp 0` snapshot
  for the down toast only.
- Confidence high.

### 10. Minor. The Party tab's enemy slot has no source when the local boss and the snapshot disagree

- Plan line 570: the slot is specified only for a snapshot boss matching `view.boss`.
- Scenario: after a fake restart before the first poll, during a stale stretch, or between
  expiry and the disengaging delivery, `boss.hp` and `maxHp` do not exist.
- Direction: say what the slot shows then (the name and local `dealt`, no bar).
- Confidence high.

### 11. Minor. Rule 35's batches of 60 ticks need clock advances the rule does not name

- Plan line 518. Code: `packages/protocol/src/client.ts:103` (tick capacity 70, one per 2 s).
- Defect: two batches of 60 need at least `clock.advance(100_000)` between them, inside a
  20 minute window; the rule says "until `hp` reaches 0" and nothing about the bucket.
- Confidence high.

### 12. Minor. Task 6 cites a mobile simulation the tests do not have

- Plan line 423 ("as the market tests simulate mobile"). Code:
  `plugins/promptfall/hooks/dialog.test.ts:8`, `band.test.ts:6`: `SURFACES` is
  `['terminal', 'desktop']`; no test mounts a surface without `Input`.
- Defect: the executor is pointed at a pattern that does not exist, and whether the test kit
  can mount a mobile surface is not in the engine facts. Unverified.
- Direction: make it an executor step like the `Input` value prop one, with what to do if the
  kit has no such surface.

### 13. Minor. `chatSeen` from a render needs a no-publish rule, and the closed-pane case is unverified

- Plan line 230 and narrowing 12.
- Defect: `game.chatSeen(now)` is called from every Chat tab render; if it writes an atom the
  pane re-renders on its own write. The plan should say it writes a plain field. Whether the
  engine calls the Pane render hook while the pane is closed is not among the engine facts;
  if it does, the fast cadence never drops. Unverified.

### 14. Minor. `Mirror` in the package root puts dead code in the plugin bundle

- Plan line 81 and narrowing 16. Code: `scripts/vendor.mjs:38-44` bundles
  `packages/protocol/src/index.ts`; `packages/protocol/package.json` already exports
  `./contract`.
- Defect: the root export carries `Mirror` into `hooks/vendor/protocol.js`, which no plugin
  code uses; the stated reason, keeping platform globals out of the bundle, is a constraint
  the move creates. The move out of `suite.ts` itself is right: `suite.ts:14` imports vitest,
  which the fake must not load.
- Direction: `packages/protocol/src/mirror.ts` behind a `./mirror` package export, imported by
  the suite and the bots, never by `index.ts`.
- Confidence high.

### 15. Nit. `WORLD_BOSS_STAT_BP = 10000` is a multiplier of one

- Plan lines 149, 169, 255. A constant with no effect and a `scale` call to keep.

### 16. Nit. Two refusal texts misdescribe the rule

- Plan line 422. `unauthorized` is a bad token, not a secondary, so `Playing in another
  session` is wrong (`ui/trade.ts:139-144` maps the thrown `not_primary` to that text, not the
  refusal). `Slow down: 5 messages per 50 seconds` misstates a bucket of 5 refilling one per
  10 s.

### 17. Nit. `pushLog` needs no change

- Plan line 481. `packages/sim/src/heroes.ts:53` types the entry as
  `GameState['lootLog'][number]`, so the Files entry is noise.

### 18. Nit. The poller's cite points at the wrong half of `read()`

- Plan line 229 cites `register.tsx:314-323` for "with the stored token, never under the
  engine lock". Line 315 sends a primary through `engine.call`, which takes the lock and
  throws in an outage; only the secondary branch (316 to 322) is the pattern meant.

### 19. Nit. The PR 1 red window omits the fake

- Plan line 8. `pnpm typecheck` builds `servers/fake`, which depends on the ledger, so it is
  red from Task 1 to the end of Task 2 too.

### 20. Nit. The down toast can be missed on a kill in the last seconds of the window

- Plan line 568. The record closes at `endsAt`, so a session polling every 5 s can see
  `boss` go from `hp > 0` straight to `null`.

## Judgement of the named narrowings

- Two `rewarded` events for a top-3 contributor (narrowing 1): holds. The record fixed the
  shape, and one event cannot carry two items in it.
- Presence TTL as 45 real seconds scaled by speed (narrowing 4): holds. Heartbeats arrive at
  real cadence; at speed 10 an unscaled TTL expires 15 s polls. `LedgerOptions.speed`
  exists (`ledger.ts:52-64`), so the default is implementable.
- The Chat tab's fast cadence driven by renders (narrowing 12): holds with finding 13's two
  caveats.
- `boss_engaged` reaching a playing primary through a `sync()` the poller triggers
  (narrowing 13): holds. `sync()` (`engine.ts:415-438`) flushes under the lock, handles
  `cursor_behind` by re-stepping (`engine.ts:280-293`), and a thrown `account()` throws
  `unreachable` without entering the outage; the flush inside may enter it, which is the
  normal submit rule. Without the sync the next flush does the same within 15 s.
- The Mirror moved to the protocol root (narrowing 16): the move is right, the destination is
  not (finding 14).

## Areas that came up clean

- Authority: contribution is the `dealt` delta between two server-replayed states, never a
  client number; the zone and the boards come from committed records; chat names come from
  the record; `boss_engaged` applies at once through `author` and is sequenced by the cursor.
- Determinism: `scaledBossStats` is integer math; `boss_engaged` draws its enemy id from the
  state's counter; `rollRewardItem` draws from its seed alone and leaves `rollItem`'s draw
  order untouched; no wall-clock value enters the sim.
- The spawn grid: `1_700_000_000_000 mod 10_800_000 = 4_400_000`, past the window; grid points
  fall on 00:00, 03:00 … 21:00 UTC, so no window straddles Monday 00:00 and the weekly board's
  reset by contribution time equals the record's "by spawn week".
- `BOSS_BASE_HP = 8000`: replayed the harness day on this tree with the plan's equip habit.
  Expected damage per tick against the zone boss's def: fresh 14; 8 h seeds 7 and 11 at zone
  3, L8: 59 and 55; 40 h: 92 and 89; 120 h seed 7 at zone 5, L20: 106. The zone boss
  atk/def figures (14/4, 38/8, 72/16) and the golden stats `{ hp: 630, atk: 14, def: 4,
  spd: 5 }` match `content/enemies.ts`. The 12 minute claim follows from `57 × 144 = 8208`.
- The sim cites: `enemyStats` at `combat.ts:12-14` with its six call sites at 36, 44, 67, 73,
  89 and 105; `hitEnemy` at 22-25; `checkWipe` at `progression.ts:273-286`; `onToolCall` at
  147-153; `spawnOnEmptyTick` at 174-194; the spd offset at `enemies.ts:173`; the contract
  valuation at `heroes.ts:68`. The golden script keeps 300 events through its slice
  (`golden.ts:38`); the determinism share is 4% today (`determinism.test.ts:103`).
- The ledger cites: `seedSource` is a real `LedgerOptions` field, counters on the contract
  runners and `randomInt` on the fake; `host.mint` takes `{ state, name, linked }`;
  `account()` answers `returns`; `isCurrent` resets by `state.v`, so the bots' re-mint check
  on `boot.state.v` works; the chat bucket mirrors the batch buckets at `ledger.ts:258-269`;
  `transfer` re-ids any non-`t` id; `weekStartOf` is right for day 0 a Thursday.
- The protocol: `HttpClient` already builds query strings without `URLSearchParams`;
  `orUnauthorized` exists in `responses.ts`; `BatchSchema` floors `batchId` at 16, so the
  Mirror's padded default fits; `ContractMake` takes `(clock, { flags })`, so `kv?` is an
  additive change; the fake's handler table and `GET` query parsing cover the three routes.
- The fake and bots: tokens are plaintext keys in the snapshot, so step 10's token works;
  `/v1/health` answers `now`; a stale token against a fresh `--data` mints a new account and
  the engine stores the new token (`engine.ts:173-175`), so part B step 1 works; the budgets
  claim for bots holds against `BUDGETS`; `rollBotState` and `traderState` spread
  `createInitialState`, so `boss: null` needs no change there.
- The plugin against the engine facts: `timedFetch` only rejects, so a thrown poll outside
  the engine enters nothing; only `doStart` and `doFlush` call `enterOutage`; the `rewarded`
  effect reaches `onEffects` through `receive` (`engine.ts:389`) like `traded`; the test kit
  records `clock.every` periods (`register.test.ts:53-56`); no `b` or `c` hotkey conflicts in
  the dialog's body (`market.tsx:168-169` uses `y` and `n`); no new `$` namespace is needed;
  `isBlocked`'s `\p{L}` regex and the injected batch ids keep the vendored code free of
  platform globals; `holdToasts` and the compose `Input`'s key capture are in the manual pass.
- Coverage: every record §1 decision and every spec §4.6, §6, §9 and §10 phase 3 requirement
  has a task; the §5 open items are each a step, a task or an out-of-scope line; the header
  lines, the red windows (finding 19 aside), the two PR tasks, the reset in part B, and the
  contract rule numbers 25 to 40 are consistent across tasks; no placeholder patterns.
- Scenarios from record §1.13: a boss dying while a party is offline mid-batch, a secondary
  posting chat, two sessions of one account, the in-process client, and a restart mid-boss
  without downtime all follow from the plan's rules as written.
