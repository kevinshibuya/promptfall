# PR 5 review, second Opus leg

**Verdict: nothing blocks the merge.** I found no blocker or major issue. All six applied fixes are correct and none of them broke anything I could find. What I found is one minor contract-hygiene gap and a few nits. Everything else I traced matches the plan.

## What I ran (on `feat/phase-3-boss`)
- **Tests:**
  - sim: 104 pass
  - ledger: 110 pass (up from 104 after the fix pass)
  - protocol: 46 pass
  - `servers/fake`: 72 pass, which includes rules 33 to 40 over HTTP and the bots-at-grid case
- **Checks:** `pnpm lint`, `pnpm typecheck`, `pnpm vendor:check` and `pnpm exec tsc -p plugins/promptfall` are all clean.
- **Plugin tests did not run.** `claude plugin test plugins/promptfall` refused in this process ("hooks modules are turned off … rollout switch was saved off"). So the band, register, engine and golden tests on the plugin side are **not verified by me**. The fix pass and the driven manual pass are the evidence there.
- **Draw-order check:** the golden literal was regenerated in this PR, so on its own it cannot prove that ordinary drops did not drift. I checked it directly instead:
  - I extracted `feat/phase-3`'s sim into the scratchpad and replayed the old golden script and an 8,000-tick tool-call/rest script on both sims, with seeds 20261002, 7, 42 and 99.
  - The final states are identical once `boss` is stripped. Inventories filled to 30 and zones reached 2 to 3, so drops and zone clears were exercised.
  - **CONFIRMED:** `rollItem`'s draw order and every non-boss path are unchanged.

## The applied fixes
1. **Presence off: the poll engages the caller** (`packages/ledger/src/world.ts:101-115`). Correct.
   - With presence on, the caller is stamped just before the check (`world.ts:74-76`), so `ctx.presence.has(id)` is true for every current record and behaviour is unchanged.
   - With presence off, `advanceBoss` sizes the boss at `max(1, 0)`, which is one player's HP, and each poll engages the caller.
   - The new test fails without the fix (it asserts `['boss_engaged']` in the log).
2. **The flag guard in `contribute`** (`packages/ledger/src/boss.ts:244`). Correct, and it matches narrowing 25.
   - It returns before any write.
   - The test "with the flag off, a committed batch contributes nothing" fails without the guard: the boss is live at `GRID+1000` and `delta` is 300.
3. **Rule 40 with two traders** (`packages/protocol/src/contract/suite.ts:1373+`). It can now fail.
   - The first host sees 2 online: B stamped at `NEXT_GRID−10s`, A at `NEXT_GRID`, and the TTL is 45 s.
   - The second host sees only A's poll, so 1. The first host still answers 2.
   - If presence were persisted to the store, the second host would answer 2 and the rule would go red.
4. **The two-row boss slot** (`plugins/promptfall/hooks/ui/band.tsx:178-200`). Correct.
   - Row 1 is the name, with the full `enemyWidth − 2` available: 31 cells at 100 columns, and the longest name, `⚔ ≋ The Context Leviathan`, is 25.
   - Row 2 is `3 + HpBar(CELLS=10) + (enemyWidth − 13)`, which is exactly `enemyWidth`. `52,000/52,000` (14 cells) fits in 20.
   - Row 3 is empty.
   - The no-snapshot branch shows `you <dealt>` on row 2.
5. **The held snapshot kept across `WorldPoller.start`** (`plugins/promptfall/hooks/world.ts:80-88`). Correct.
   - `bossTransition` compares against the held boss. The new poller test fails without the fix.
   - `reset()` still clears to `WORLD_DEFAULT`, so a server switch announces again, which is intended.
6. **Manual pass and README wording.** Step 4's `1m`, step 6's "within 20 seconds" and the README's no-slot reward wording are all accurate against the code.
   - The `/v1/health` `now` field exists (`servers/fake/src/server.ts:153-159`).
   - The step 2 formula `/10000` is right for speed 10.
   - The bots act every `BOT_TICK_MS = 20_000` virtual ms, which is 2 real seconds.
   - The in-process ledger runs with `worldboss.enabled: false` (`plugins/promptfall/hooks/server.ts:34`).
   - `chat needs a server` matches `band.tsx:103`.

## Independent hunt: traced and found correct
- **Sim:**
  - `scaledBossStats` is integer-only and matches the plan's formula.
  - In boss mode the zone cannot change, because a zone clear needs a kill and a retreat needs a wipe. So the scaling is stable for the whole engagement.
  - R1 returns before `changeZone`, `pendingTurnBoss = false`, the `wipes` count and the `wipe` effect.
  - R2 counts the tool call and then returns.
  - `onTurnEnd` can still set `pendingTurnBoss`, but `spawnOnEmptyTick` is unreachable while the world boss enemy exists. The turn boss spawns on the first tick after `boss_disengaged`.
  - `rollRewardItem` draws from a fresh `createInitialState(seed)`, whose rng is reset to the seed.
  - `hashState` is canonical JSON over every field, so `boss.dealt` is hashed.
- **`advanceBoss`:**
  - It settles before it spawns.
  - It is idempotent: a closed record is never re-settled, and a record with the same `bossId` blocks a respawn.
  - Flag off → on in the same window does not respawn.
  - A long downtime settles the old boss as expired and then spawns the current grid point's boss if its window is open.
- **`settleBoss`:**
  - It has no throw path: `rewarded` with goods is gated by `hasRoom`, which is the same predicate as the sim's `noRoom`; a null-goods `rewarded` and `disengage` are both precondition-checked. So `closed` is always written.
  - It uses the in-hand record for the caller and loads every other contributor fresh.
  - A contributor with zero rolls is still disengaged.
  - The returns queue goes through `syncReturnsQueue`, which re-reads `pf:returns` each time.
- **The submit path:**
  - `prevDealt` is taken from the effective state before `record.state = result`.
  - `contribute` runs after `settle` and before `deliverReturns`.
  - `offerZone` reloads the boards, so the weekly write is kept.
  - On the success path the ack's delivery carries the rewards and the disengage, and the next batch's base hash still matches (rule 35).
  - On `hash_mismatch`, the second `settle` folds them into the adopted state.
- **`--boss-in`:**
  - It only moves the clock forward: `target > virtualNow`, otherwise null.
  - The rebase uses the same formula as `VirtualClock`.
  - The rebased clock is flushed at startup (`cli.ts` `kv.flushSync()`).
- **The plugin's predicted bar:** `shownHp` follows the plan's formula, and a null or foreign `committedDealt` subtracts nothing.

## Findings, most severe first

| # | Sev | Status | Where | Finding |
|---|---|---|---|---|
| 1 | minor | CONFIRMED | `docs/plans/2026-10-03-promptfall-phase-3.md` ("Spec conflicts and narrowings", Task 10/11 text) | The plan was never amended for three fix-pass deviations |
| 2 | nit | CONFIRMED | `packages/ledger/src/world.ts:66` | The `world()` doc comment still says "Writes nothing to the store" |
| 3 | nit | CONFIRMED | `plugins/promptfall/README.md` (World boss section) | "Its HP is 4,000 for each account online when it spawns" is wrong with presence off |
| 4 | nit | PLAUSIBLE, hard to reach | `plugins/promptfall/hooks/ui/band.tsx:62-65`, `hooks/world.ts:84` | The status segment can read `boss 62% · ` with nothing after it |

### 1. The plan does not record the fix-pass deviations (minor)
- **What:** the plan's diff in this PR only ticks checkboxes. It does not record three deviations the fix pass introduced:
  - With presence off, the poll engages the caller. The plan's `world()` text says "an online, current account".
  - The boss slot is two rows. Task 11 says the first row carries the name, the bar and the HP, and rows 2 and 3 are empty.
  - The poller keeps the held snapshot across `start()`. Task 5/11 describe a fresh state.
- **Failure:** the plan is the contract. A later reviewer (the Fable leg, or the rerun codex leg) reading the plan will flag `world.ts:109`, `band.tsx:186-199` and `world.ts:85` as off-contract. The only record that these were decided is `docs/reviews/pr-5/fix-pass.md`.
- **Fix:** add three numbered entries to "Spec conflicts and narrowings", and adjust the Task 11 R5 and `band.test` text.

### 2. Stale doc comment on `world()` (nit)
- **What:** the comment still says "Writes nothing to the store". Since PR 2 the poll saves the caller's record and the boss when it engages the caller (`world.ts:111-114`). `advanceBoss` before it writes too. The plan's general line "reads write nothing and flush nothing" no longer applies to `world` either.
- **Failure:** misleading only. No runtime effect.
- **Fix:** "Stamps the caller present and answers the snapshot; writes only to engage the caller with a live boss."

### 3. README HP wording with presence off (nit)
- **What:** with `presence.enabled=false` the boss is sized for one (`boss.ts:198` `max(1, 0)`), and every polling account engages against that single share.
- **Failure:** someone running `--flag presence.enabled=false` with bots sees 4,000 HP, not 4,000 × N. No code defect.
- **Fix:** add one clause: "(with presence off, one share)".

### 4. Status segment with nothing after the separator (nit)
- **What:** `remainingOf` returns `''` when `world.clock` is null, giving `boss 62% · `. After fix 5 the poller can hold a snapshot with `clock: null`.
- **Path:** the first poll after a reload throws, then a chat post succeeds, and `insert()` publishes the held state. This is transient and needs the server reachable for the post but not for the poll, so it is near-unreachable.
- **Fix, either of:**
  - carry `held.clock` along with `held.snapshot` in `start()`;
  - or have `bossSegment` omit `· <remaining>` without a clock.

## Buckets
- **Act on:** none required for merge. Finding 1 is cheap and saves the next review leg a false positive.
- **Consider:** 1, 2, 4.
- **Noted (no action implied):**
  - **Rewards jump the returns queue.** A reward takes a free slot before an older waiting return (`boss.ts:166` vs `books.ts:221`). The spec only says goods with no slot wait, so this is consistent.
  - **"is down" toast on session start.** A boss killed while the session was closed toasts `<name> is down` when the session starts: the held snapshot had `hp > 0` and the first poll has the same id at `hp 0`. This matches the plan's literal rule.
  - **Boss ids repeat across servers.** `wb<gridIndex>` is the same on every server, so after a server switch with a stale held atom the "appeared" toast can be missed. `reset()` normally clears the atom, so this is unlikely.
  - **A fresh account's party change goes pending.** An account engaged before its first kill (`encounter === null && wave 1 && kills 0` is false in boss mode) gets its `set_party` queued as pending until a zone change. This is pre-existing pending-party semantics.
  - **Still as the first leg left them:**
    - the `committedDealt` read races a flush (display only);
    - a secondary's band is collapsed, so it shows no boss segment;
    - a turn boss in progress is dropped at `boss_engaged`;
    - a killing commit on the `hash_mismatch` path shows no reward toast;
    - the fake drops the ledger's `log`.
- **Dismissed:**
  - **`advanceBoss` replacing an open boss without settling it.** This needs the clock to go backwards (a different `bossId` while the stored boss's `now < endsAt`). The fake's clock is monotonic and `--boss-in` only moves forward. Hypothetical for this PR; worth a guard in phase 5.
  - **A partial `settleBoss` flushed, then rewards paid twice.** No `author` call in the loop can throw: every call checks the sim's precondition first.
  - **A stale engagement blocking engage-on-poll.** `engage` disengages a stale id first. An account with this id but missing from `contributions` cannot arise, because each operation flushes once.
  - **`boss` missing from the hash.** `canonicalJson` covers every key.

## Residual test gaps
- **No pinned non-boss regression.** Nothing replays the v2 golden script on the v3 sim and asserts the state minus `boss` is unchanged. The regenerated `GOLDEN_HASH` cannot catch a draw-order drift in ordinary drops on its own. My scratch comparison shows there is none today; a 10-line test would keep it that way.
- **No ledger test of a killing commit on `hash_mismatch`.** Nothing checks that the rewards are folded into the adopted state and the boss is closed.
- **No test of `world()` when the engaged account has a stale `state.boss` id at poll time.** `engage`'s disengage-then-engage path is only tested directly (lifecycle case 2), not through `world()`.
- **`--boss-in`'s CLI wiring is untested.** The rebased `persisted`, the startup-line seconds and the startup flush are covered only by the manual pass.
- **Plugin tests unverified by this leg** (see "What I ran").

Files: `docs/plans/2026-10-03-promptfall-phase-3.md`, `packages/ledger/src/world.ts`, `packages/ledger/src/boss.ts`, `plugins/promptfall/README.md`, `plugins/promptfall/hooks/ui/band.tsx`, `plugins/promptfall/hooks/world.ts`
