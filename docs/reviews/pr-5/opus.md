# PR 5 review, Opus leg

**Verdict: no blocker or major findings.** The sim's boss mode, the ledger's boss lifecycle and the contract rules all match the plan. What I found is one wrong line in the manual pass, one contract assertion that cannot fail, and a few minor edge cases that depend on configuration.

**What I ran on `feat/phase-3-boss`:**
- sim tests: 104 pass
- ledger tests: 104 pass
- protocol tests: 46 pass
- fake-server tests: 72 pass, including rules 0 to 40 over HTTP
- `claude plugin test plugins/promptfall`: 105 pass
- `pnpm lint`, `pnpm typecheck`, `pnpm vendor:check` and `pnpm exec tsc -p plugins/promptfall`: all clean

**What I traced and found correct:**
- **Sim:**
  - `scaledBossStats` follows the plan's integer formula exactly.
  - In `hitEnemy`, a hit on the world boss adds to `dealt` and returns before the enemy's HP or `onEnemyKilled` is touched.
  - R1 (`checkWipe`) does only `fullHealParty` and returns true. R2 still counts the tool call and spawns nothing.
  - The three handlers check their preconditions before acting.
  - `rollItemFor` keeps the ordinary draw order (rarity, then base, then affixes), and the golden hash would catch any drift.
- **Ledger:**
  - `advanceBoss` settles an open boss before any replacement, spawns only when the stored id differs, and is idempotent.
  - In `world()`, `advanceBoss` runs before `authenticate`, so the caller's record is read after any settle or spawn writes.
  - `prevDealt` is captured before `record.state = result`.
  - `contribute` runs after `settle` and before `deliverReturns`.
  - `settleBoss` uses the in-hand record for the caller and loads every other record fresh.
  - The duplicate and adopt branches never contribute.
  - On `hash_mismatch`, the second `settle` folds the rewards into the adopted state.
  - The returns queue stays in sync because `syncReturnsQueue` re-reads `pf:returns` each time.
- **Records touched twice in one operation:** none found. Every store read is a fresh `JSON.parse` copy, and no operation holds a record across a `settleBoss` other than the in-hand one.

## Findings, most severe first

| # | Sev | Status | Where | Finding |
|---|---|---|---|---|
| 1 | minor | CONFIRMED | `docs/manual-pass/phase-3.md:96` | Step 4 promises `boss 100% · 2m`; it will read `1m` |
| 2 | minor | CONFIRMED | `packages/protocol/src/contract/suite.ts:1373-1402` | Rule 40's `online === 1` check cannot fail |
| 3 | minor | CONFIRMED (traced) | `packages/ledger/src/world.ts:107`, `boss.ts:195` | With presence off and the boss on, a boss spawns that nobody can fight |
| 4 | minor | CONFIRMED (traced), matches the plan | `packages/ledger/src/boss.ts:240` (`contribute`) | With the boss flag off, a submit before the first poll or sweep can still count and kill |
| 5 | minor | CONFIRMED (arithmetic) | `plugins/promptfall/hooks/ui/band.tsx:184` | The Party tab truncates the boss name at normal widths |
| 6 | nit | CONFIRMED | `plugins/promptfall/hooks/world.ts:82-84` | The "has appeared" toast fires again after a hot reload or in a new session |
| 7 | nit | CONFIRMED | `plugins/promptfall/README.md:107`, `docs/manual-pass/phase-3.md:102` | Two small wording mismatches in the docs |

### 1. Manual pass step 4: the status row will read `1m`, not `2m`

- **Why:**
  - `spawnedAt` and `endsAt` sit on the grid, but the spawn and the first poll land after the grid point.
  - So at render time `remainingRealMs(endsAt, clock, now)` is a little under 120,000 real ms at speed 10.
  - `formatRemaining` floors the minutes, which gives `1m`.
  - It reads `2m` only if `serverNow === spawnedAt` exactly.
- **Failure:** Kevin sees `boss 100% · 1m` and logs a red that isn't one. Step 8 says "as in step 4", so it inherits the same expectation. The plan's Task 12 text carries the same line.
- **Fix:** write `boss 100% · 1m`, or "`boss 100% · <minutes left>`, 1m at speed 10".

### 2. Rule 40 cannot fail on its "online rebuilt from that poll alone" claim

- **Why:** only one trader exists, so `online` is 1 on the first host and 1 on the second whether or not presence was rebuilt.
- **Failure:** if presence were wrongly persisted to the store, the test would still pass.
- **Fix:** on the first host, mint and poll two traders. On the second host, poll one. Assert `online === 1` there while the first host still answers 2.

### 3. Presence off with the boss on: a boss nobody can fight

- **Trace:**
  - With `presence.enabled=false`, nothing is ever stamped.
  - `advanceBoss` spawns with `online = []`, so `maxHp` is 4000.
  - The engage-on-poll in `world()` requires `ctx.presence.has(id)`, so nobody is ever engaged.
  - `toBossView` still shows the boss.
- **Failure:** on `pnpm fake --flag presence.enabled=false`, every session:
  - gets a "World boss … has appeared" toast;
  - polls every 5 s for 20 minutes;
  - shows `you 0` on a boss it cannot damage.
  
  The boss then expires and pays nothing.
- **Plan check:** this follows the plan's wording ("online" means present). The spec treats the four flags as independent.
- **Fix, either of:**
  - when presence is off, treat the poll itself as online (engage the caller; count the spawn as 1);
  - or make `toBossView` and the spawn require presence, and say so in "Spec conflicts and narrowings".

### 4. Flag off: a submit before the first poll or sweep can still count, and kill

- **Trace:**
  - `isLive` does not look at `worldboss.enabled`.
  - After a restart with `--flag worldboss.enabled=false`, the open boss is only settled as expired by the first `world()` or the first sweep (every 60 virtual s).
  - A plugin flush that lands before either is counted. If it takes the last HP, `settleBoss(expired: false)` pays the top-3 bonus rolls.
- **Plan check:** this matches the plan's step-9 conditions. It contradicts narrowing 25, which says flag-off is treated as the window closing.
- **Impact:** a rare race with a small effect.
- **Fix:** add `ctx.flags['worldboss.enabled'] !== false` to `contribute`'s guard.

### 5. The Party tab truncates the boss name at normal widths

- **Arithmetic:**
  - `labelWidth = enemyWidth − hpText.length − 13`, with `enemyWidth = floor(width / 3)`.
  - The band collapses below 100 columns, so the narrowest full band is 100 columns.
  - At 100 columns with `52,000/52,000`, the label gets 7 cells: `⚔ ☠ Th…`.
  - At 120 columns it gets 14: `⚔ ☠ The Promp…`.
- **Failure:** manual pass steps 4 and 8 expect `⚔ ☠ <name>`. The band test passes only because it renders wide.
- **Fix, any of:**
  - give the label priority over the numbers (drop `/maxHp`, or show `62%` instead);
  - shorten the bar for the boss row;
  - or change the manual pass to say the name may be clipped.

### 6. The "has appeared" toast fires again after a hot reload or in a new session

- **Why:** `start()` resets `snapshot` to null and keeps only the messages. `bossTransition(undefined, liveBoss)` then toasts again.
- **Plan check:** this matches the plan's literal rule ("previous snapshot had no boss").
- **Failure:** a reload or `/clear` during a live boss toasts "World boss … has appeared" a second time.
- **Fix:** keep the held snapshot's `boss` across `start()`, or accept it and note it in the README.

### 7. Two small wording mismatches in the docs

- **README:** "Each reward toasts `Boss reward: <item> (<rarity>)` and shows as `boss reward …` in the loot log" is not true for a reward with no free slot. That one toasts `Boss reward: <gold> gold`, adds no loot line, and later arrives as a `returned` line.
- **Manual pass step 6:** "Within 15 seconds" can run to about 20 s: the settle comes at the next 5 s poll, then the `cursor_behind` delivery waits up to one 15 s flush.

## Buckets

**Act on:**
- 1, the manual-pass line.
- 2, rule 40's assertion.

**Consider:**
- 3, presence off.
- 4, the flag guard in `contribute`.
- 5, label width.
- 6, re-toast on reload.

**Noted:**
- **`committedDealt` race (display only):**
  - The poller reads `engine.committedBoss()` after the fetch returns, and polls are not serialised with flushes.
  - So a flush that commits between the server answering and that read misaligns the baseline. The predicted bar is then off by one batch until the next poll, at most about 5 s.
- **Secondaries never show the boss in the band:** `collapsed` is forced when `mode !== 'primary'` (band.tsx, already true before this PR). The "exact on a secondary" branch of `shownBoss` is only reachable by the World-tab helpers.
- **A turn boss in progress is lost at `boss_engaged`:** the encounter is dropped and `pendingTurnBoss` was already cleared when it spawned. This matches the plan ("the old encounter and queue are dropped").
- **A killing commit on the `hash_mismatch` branch shows no reward toast:** the client adopts the state and gets no effects. This matches the plan.
- **Known deviations:**
  - The protocol was never red between Tasks 8 and 9: fine, because `GameStateSchema` passes unknown fields through.
  - A null roll pays rare gold: fine.
  - The optional `log`: fine; the fake drops it.
  - The move of `effectToast` to `toasts.ts`: fine.

**Dismissed:**
- **A `boss: undefined` state making `engage` throw `already_engaged`:** hypothetical. Every v3 state comes from `createInitialState` (bots, suite and plugin alike), and JSON keeps the `null`.
- **The circular import `world.ts` ↔ `boss.ts`:** `BOARDS_KEY` and `BOSS_KEY` are only read inside functions, never while the modules load.
- **`settleBoss` throwing partway and leaving the boss open:** every `author` call is guarded by `hasRoom` or the `disengage` check, and there is no other throw path.
- **The in-hand record saved twice:** it is the same object, as the plan says.
- **The caller's own stamp not counting toward spawn HP:** this is the plan's design; rule 33 pre-stamps for that reason.
- **A narrow-width overflow of the boss row below 100 columns:** the band collapses there.

## Remaining test gaps

- No ledger test of a killing commit on the `hash_mismatch` branch (rewards folded into the adopted state, the boss closed).
- No test that a tick committed after `endsAt` but before the settle counts for nothing. Rule 35 covers ticks after a kill, not after an expiry.
- No test that `sweep()` (rather than a poll) settles an expiry or spawns.
- No test that engage-on-poll skips a non-current record, or of `world()` when presence is off.
- No test that the snapshot hides an open boss while the flag is off. Rule 38 never spawns one, and lifecycle case 4 tests `advanceBoss` only.
- `--boss-in` is tested only through `bossInRebase`. The CLI wiring (the rebased `persisted`, the startup line) is covered only by the plan's devserve acceptance check.
- The band test renders wide, so it never exercises label truncation (finding 5).

Files: `/Users/luizarazzera/keki/dev/personal_projects/tbh-cc-mod/docs/manual-pass/phase-3.md`, `/Users/luizarazzera/keki/dev/personal_projects/tbh-cc-mod/packages/protocol/src/contract/suite.ts`, `/Users/luizarazzera/keki/dev/personal_projects/tbh-cc-mod/packages/ledger/src/world.ts`, `/Users/luizarazzera/keki/dev/personal_projects/tbh-cc-mod/packages/ledger/src/boss.ts`, `/Users/luizarazzera/keki/dev/personal_projects/tbh-cc-mod/plugins/promptfall/hooks/ui/band.tsx`, `/Users/luizarazzera/keki/dev/personal_projects/tbh-cc-mod/plugins/promptfall/hooks/world.ts`, `/Users/luizarazzera/keki/dev/personal_projects/tbh-cc-mod/plugins/promptfall/README.md`

