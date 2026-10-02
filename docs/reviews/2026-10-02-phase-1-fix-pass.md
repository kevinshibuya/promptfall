# Phase 1 fix pass: PR #1 review consolidation

Consolidates the three-leg review of PR #1 (`feat/phase-1` into `ai-staging`): `reviewer` on
opus, `reviewer` on fable, `codex-review` on gpt-6-astra, plus the main session's live manual
pass. Written by `reasoner` (fable) on 2026-10-02; the main session (opus) executes it item by
item. One fix pass, no second review wave: after it, the verification line, a short re-run of
the affected manual-pass steps, then Kevin's own pass and GREEN.

Contract: `docs/spec/promptfall.md` and `docs/plans/2026-10-02-promptfall-phase-1.md`. Where
an item changes what the plan says, section 12 carries the amendment so the plan stays the
contract. The spec needs no change.

## Decisions that cut across items

**SIM_VERSION stays 1 unless the golden hash moves.** Two sim rules change (items 2 and 3).
Both are hash-neutral on the golden script, by evidence: a replay of `goldenEvents()` from
`GOLDEN_SEED` ends at zone 1 wave 1 with 35 kills, 0 `zone_cleared`, 1 wipe and 2
`party_applied` (one at event 0, one at the wipe, which full-heals afterwards), and the golden
party never holds two White Mages (the roster has one; the party is pinned to `h0,h1,h2` at turn
4). So neither new rule is reached by the script. The rule in `golden.ts` is "changing the
literal requires bumping `SIM_VERSION`", and the converse is not required: nothing has shipped,
no stored batch exists, and a version only starts to mean something when the phase 5 server
refuses a client. If `golden.test.ts` fails after items 2 and 3, that is a sign the change
touched a path it should not have; investigate first, and bump to 2 only if the change is
intended. Any sim change needs `pnpm vendor` afterwards, since the plugin tests read the
committed bundle.

**`/promptfall off` hides the band and changes nothing else.** Item 4 settles findings C and D
together this way; the alternative (off releases the lease) is written out there, as Kevin's
call if he wants it.

**The engine-laid types are not committed.** Item 9. The engine writes its own `.gitignore`
there; `claude plugin validate` and `claude plugin test` both pass without the folder (checked
on a copy of the plugin with the folder removed: validate passed, 24 tests passed, and neither
command laid the folder). Only `tsc -p plugins/promptfall` needs it, and only an interactive
load lays it.

**Deferred** (section 11): the tool-call budget under parallel work, the thrown-submit pause,
the duplicate-after-hash-mismatch ack, the early-game feel, and the live Desktop check.

## Order and method

Items run in the order below. Each one: write the test, see it fail, make the change, see it
pass, commit. Sim items end with `pnpm vendor`. The record format of the fake server changes in
item 1, so pre-fix store files stop working: delete
`~/.claude/plugins/store/promptfall_inline-*.json` (and the `.manual-pass-backup`) before the
manual re-run; nothing has shipped and Kevin's pass starts fresh anyway.

1. Rate budget: carry the refill remainder (A)
2. Two or three White Mages: one heal per round (B)
3. Zone advance heals and revives like a wave clear (G)
4. Mode is derived by the session; off is a render flag (C, D)
5. Flush only as primary; welcome once; flush and release on `session.end` (E, K, F)
6. Restart on reload wherever a game ran; rest on bridge prompts (J, L8)
7. Notices clear only themselves; integer `at` (L1, L2, L3)
8. Dialog: unequip, two-line item rows, collapsed line shows any notice (H, M, L9)
9. Housekeeping: types folder, `vendor:check`, PR body (I, L6, L10)
10. Docs: plan, manual pass, README (section 12)

---

## 1. Rate budget: carry the refill remainder (A)

**Finding.** All three legs, confirmed by probe. `packages/protocol/src/fake/local.ts` rule 8/9
sets `t0 = now` on every commit and refills `floor(elapsed / refillMs)`, so the sub-period
remainder is thrown away each batch. Plan rules 8 and 9 say exactly this (`T0 = T`), so the flaw
is in the plan, not a deviation from it.

**Arithmetic, recomputed.** The plugin ticks every 2 s in a turn and flushes every 15 s, so
batches alternate 8 and 7 ticks. Refill per batch today: `floor(15000 / 2000) = 7`. Bucket
before batch k (k odd, an 8-tick batch) is `70 - (k - 1) / 2`; it goes under 8 at k = 127, which
is 127 × 15 s = 31.75 min. That is the "capped from minute 32". With the remainder carried: batch
1 at T0 + 15 000 refills 7 and leaves the clock at T0 + 14 000; batch 2 at T0 + 30 000 refills
`floor(16000 / 2000) = 8`. The bucket oscillates 69, 70, 69, 70 and never drops.

**Why no slack is needed.** Ticks are scheduled on the same `$.clock` the fake reads, at least
2 000 ms apart (`every(2000)` or `every(5000)`; a cadence switch cancels and recreates the timer,
so the next tick is a full period away). In any window of length L the client fits at most
`floor(L / 2000) + 1` ticks and the server refills `floor(L / 2000)` with the remainder carried,
so over any horizon the bucket drops by at most 1 below where it started, plus one tick per hot
reload. Capacity is 70.

**What this does not fix.** The tool-call case in the finding (a tool call every 0.8 s, capped
at 8.5 min) is the honest rate exceeding the spec's budget (one per second, section 7), not the
remainder: `15000 / 1000` has no remainder. Deferred, section 11.

**Decision.** Per-bucket refill clocks. Replace `t0: number` in `AccountRecord` with
`refillAt: Record<BudgetKind, number>`. On submit, for each kind: `n = floor((now -
refillAt[kind]) / refillMs)`, `bucket = min(capacity, bucket + n)`, `refillAt[kind] += n *
refillMs`. A capped batch stores nothing (the recomputation next time gives the same result).
A commit stores the advanced clocks and the refilled-minus-consumed buckets. `bootstrap` sets
every clock to `now`. No migration of old records.

**Files.** `packages/protocol/src/fake/local.ts`; `packages/protocol/src/contract/suite.ts`
(new case); `plugins/promptfall/hooks/dialog.test.ts` (the seeded record carries `t0:
1_000_000`; change to `refillAt: { tick: 1_000_000, tool_call: 1_000_000, rest: 1_000_000,
turn_end: 1_000_000 }`).

**Test first.** In `suite.ts`, a new rule 8 case: "a steady 7 to 8 ticks per 15 s for an hour
never caps". 240 batches; before each, `clock.advance(15_000)`; batch i has 8 ticks when i is
even and 7 when odd; every submit is `{ ok: true }`; `mirror.commit` after each. Fails today at
batch 127 with `rate_capped`. The four existing rule 8 cases must keep passing: 80 ticks after
10 s (refill 5, 75 < 80, capped); the dry bucket within one second; 71 capped and 70 pass after
10 minutes (300 refilled, clamped to 70); a capped batch consumes nothing.

**Done when** `pnpm --filter @promptfall/protocol test` passes with the new case, and
`claude plugin test plugins/promptfall` still passes after the dialog harness edit.

## 2. Two or three White Mages: one heal per round (B)

**Finding.** Fable, confirmed by probe. Commit 279ac63 made a lone White Mage attack, but with
two or three White Mages in the party (reachable through the tavern or a contract plus
`set_party`) each heals the other every round and nobody attacks; 1000+ rounds frozen.

**Decision.** One heal per round. `resolveRound` carries a round context `{ healed: boolean }`
into `heroAct`; a White Mage heals only when `!healed` and the existing conditions hold (another
living hero, lowest under 7000 bp), then sets `healed = true`; otherwise she attacks the
lowest-hp enemy. With this, every round with at least one living party hero has at least one
attack of at least 1 damage, so an encounter always ends. With one White Mage the path is
identical to today (the flag is false when she acts), which is why the golden hash holds.

Rejected alternative: "a White Mage never heals another White Mage" leaves two mages healing a
Knight forever.

**Files.** `packages/sim/src/combat.ts`; `packages/sim/src/combat.test.ts`.

**Test first.** In `combat.test.ts`: from `createInitialState`, clone the White Mage under a
new id (`hw2`, same template and equipment) and once more (`hw3`); run two scenarios, (a) party
`[wm, hw2, knight]` with the Knight at 0 hp and both mages at half hp, (b) party `[wm, hw2,
hw3]` at half hp; inject two `goblin_scout` through the file's `injectEnemy`; run 300 ticks;
assert `stats.kills + stats.wipes >= 1` in each. Before the fix neither state moves (the probe
showed 1000+ frozen rounds). The existing lone-mage test stays as the one-mage guard.

**Done when** `pnpm --filter @promptfall/sim test` passes, including `golden.test.ts` unchanged,
and `harness.test.ts` (the harness party never changes, so no drift expected).

## 3. Zone advance heals and revives like a wave clear (G)

**Finding.** Opus and fable, confirmed by probe. A pending party whose benched heroes fell
earlier (a hero down when the boss died, swapped out at that moment, swapped back later) enters
the next zone at 0 hp and wipes two ticks later.

**Decision, wider than proposed.** The proposal revives only the incoming party. The underlying
gap is that the zone boss kill (`onEnemyKilled`, `zone_boss` branch) heals nobody: a party that
beats the boss with two heroes down enters the next zone with two heroes down whether or not a
swap is pending. The boss is wave 11; spec 4.2 says a wave clear heals 15% and revives at 15%.
So: in the `zone_boss` branch, after `changeZone` and `applyPendingParty`, call `healParty(s,
1500)`. That heals and revives the party that actually takes the field, swap or not, with the
number the spec already has. No `wave_cleared` effect (the `zone_cleared` effect is there). The
wipe path already full-heals after the swap and is untouched.

Balance drift: a 15% heal once per zone advance, a handful of times a day. The harness bands
(zone 2 to 3 at 8 h, 4 to 7 at 40 h) are wide; the harness run will say. If Kevin wants zero
drift, the narrow form is: in `applyPendingParty`, set every incoming hero at 0 hp to
`max(1, floor(max * 1500 / 10000))`. I recommend the wide form.

**Files.** `packages/sim/src/progression.ts`; `packages/sim/src/progression.test.ts`.

**Test first.** A state at zone 1, wave 11, with `pendingParty = [knight, bmage, archer]` where
the Archer sits benched at 0 hp and the White Mage (in the party) is at 0 hp; inject the zone
boss through the test's helper with `hp: 1`; tick up to 5 times until `zone_cleared` fires;
assert zone 2, `party` equals the pending list, `pendingParty` null, and the Archer's hp equals
`max(1, floor(heroStats(s, archer).hp * 1500 / 10000))`. Before the fix the Archer is at 0.
A second assertion without a pending party: the fallen White Mage is revived at the same
fraction.

**Done when** `pnpm --filter @promptfall/sim test` passes with `golden.test.ts` and
`harness.test.ts` unchanged; then `pnpm vendor && pnpm vendor:check` and
`claude plugin test plugins/promptfall` (its `golden.test.ts` reads the bundle).

## 4. Mode is derived by the session; off is a render flag (C, D)

**Findings.** C (all three legs): `/promptfall on` restores `previousMode`, not the live role.
A secondary that goes off, gets promoted while off, and comes back on is drawn as "playing in
another session" with a read-only dialog; `on` without a prior `off` labels a secondary or paused
session primary; `setPaused` publishes `paused` over `off`; `becomePrimary`/`becomeSecondary`
skip the mode publish while off, which is the root of the stale restore. D (opus, fable): the
off session keeps renewing the lease while `canApply()` is false, so nothing plays anywhere.

**Decision.** One owner: `GameSession` derives `mode = off ? 'off' : engine.isPaused() ?
'paused' : role` and publishes it on every transition (`becomePrimary`, `becomeSecondary`,
`setOff`). The engine's own `{ mode }` patches (from `setPaused`) are rewritten to the derived
value in the session's existing `publish` wrapper (one line, next to the `firstRun` latch).
`canApply()` becomes `role === 'primary' && !engine.isPaused()`: off no longer stops events.
`previousMode` goes away entirely (types, command, dialog). The command handlers become
`game()?.setOff(true)` and `game()?.setOff(false)`; reply texts unchanged.

Why off should keep playing rather than release the lease: spec 10 says "`/promptfall off`
switches the band off for the session" and non-negotiable 2 says the game must never get in the
way; both are about the band, and an invisible sim ticking every 5 s with a store write every 15 s
is not in the way. It is also the smaller change: no release path, no re-acquire path, no
flush-before-release, no new test surface. The dialog stays usable while the band is hidden,
which removes the odd "off: read-only" header. D then needs no fix: the off session is the
player. What the plan said ("apply events only while mode === primary") was the implementer's
reading of a mode list, not a spec rule; section 12 amends it.

Kevin's alternative, if he wants `off` to mean "stop playing here": `setOff(true)` flushes,
releases the lease (item 5's `release`), sets the role to secondary and stops ticking;
`setOff(false)` acquires and runs `becomePrimary` or `becomeSecondary`; `renew` is skipped while
off. About 25 more lines and two more tests. Not recommended for phase 1.

**Files.** `plugins/promptfall/types/index.d.ts` (drop `previousMode`);
`plugins/promptfall/hooks/register.tsx` (`GameSession`: `mode()`, `publishMode()`, wrapper
rewrite, `canApply`, `setOff`); `plugins/promptfall/hooks/command.ts` (drop `previousModeAtom`
and both atom writes); `plugins/promptfall/hooks/ui/dialog.tsx` (drop `previousModeAtom`, the
band-off button calls `setOff(true)` only, `readOnly` unchanged in form but the `mode === 'off'`
branch of `why` is now unreachable and goes); `plugins/promptfall/hooks/command.test.ts`.

**Test first.** In `command.test.ts`: (a) replace the `previousMode` assertion; after `off`,
advance the mock clock 10 s and assert the `view` atom's tick-driven fields moved (enemies or
`kills`, as the register test does) while `mode` reads `off`; `on` returns `primary`. (b) A
secondary session: seed the store map with `promptfall:lease = { owner: 'other', until: now +
60_000 }` before `session.start`; assert `mode` is `secondary`; `off` then `on`; assert `mode` is
`secondary`, not `primary`. (b) fails today with `primary`.

**Done when** `claude plugin test plugins/promptfall` passes and `claude plugin validate
plugins/promptfall` lists no `promptfall.previousMode` in state reads or writes.

## 5. Flush only as primary; welcome once; flush and release on `session.end` (E, K, F)

### 5a. A demoted primary stops flushing (E)

**Finding.** All three legs. After losing the lease (a suspended process, a lapse over 30 s),
the old primary's flush timer still submits its stale buffer. If it lands before the new
primary's first batch it commits at the server's seq, and the new primary's first batch gets
`seq_mismatch` and loses 15 s.

**Decision.** Gate the flush timer on the role: `if (this.role === 'primary') void
this.engine.flush()`. Re-promotion runs `engine.start()`, which already clears the buffer, so no
discard is needed at demotion.

**Test first.** In `register.test.ts` with the file's own `clock(on)` and `store(on)`: start an
interactive terminal session, apply three `tool.call`, write `promptfall:lease = { owner:
'other', until: t + 60_000 }` into the store map, advance 10 s (renew fails, mode `secondary`),
advance 6 s more past the flush, and assert no store write with `seq === 1` exists. Fails today.

### 5b. The welcome shows once per account, not once per promotion (K)

**Finding.** Opus. `GameSession` latches `firstRun` from any published view whose `firstRun` is
true, and the engine keeps `firstRun` true for its whole first life, so every view publish
re-arms the latch; on the next `becomePrimary` (after a demotion and re-promotion) the welcome
fires again.

**Decision.** In `GameEngine.start()`, set `this.firstRun = false` right after the first view
publish. Only the minted account's first view says `firstRun: true`; the session's latch is set
exactly once and consumed by the first `becomePrimary`. Nothing else reads `view.firstRun`
(checked: `engine.ts`, `register.tsx`, `view.ts` only).

**Test first.** Extend the 5a scenario: after the demotion, delete the foreign lease from the
store map, advance 10 s (re-promoted, mode `primary`), and assert the toasts array holds the
welcome text exactly once. Fails today with two.

### 5c. `session.end`: flush, then release the lease when the process ends (F)

**Finding.** Opus, fable, and the manual pass: a relaunch within 30 s shows "playing in another
session"; up to 15 s of progress is lost on quit; the lease is never released.

**Engine facts, from the laid types.** `session.end` fires once when the session ends, with
`e.reason` one of `prompt_input_exit`, `clear`, `resume`, `logout`, `other`; the whole hook chain
shares one short wall-clock bound, 1.5 s by default, including `$` waits, and `next.budget.
remainingMs` reads it (`index.d.ts` lines 4140 to 4155 and 10364 to 10398). On `clear` and
`resume` the process goes on under a new session id and no `session.start` fires, so the game
must keep running in those two cases. The testing kit exposes `$.session.end(input)` (line
4461), and under it `remainingMs` is `Infinity`.

**Decision.** Add `release(kv, owner)` to `lease.ts`: read the lease, delete it only when
`owner` matches. Add `GameSession.end(release: boolean, remainingMs: () => number)`: if primary
and `remainingMs() > 200`, `await engine.flush()`; if `release`, cancel the timers and, if
primary, `await release(kv, owner)`. Hook: `on('session.end', async ($, e, next) => { await
game?.end(e.reason !== 'clear' && e.reason !== 'resume', () => next.budget.remainingMs); return
next(e) })`. A flush is one store get and one store set on a local JSON file, well inside 1.5 s.
`$.store` and `$.clock` only, so the validate output keeps its five nouns.

**Test first.** `lease.test.ts`: `release` by a non-owner leaves the lease and `b` still fails to
acquire; `release` by the owner lets `b` acquire at once. `register.test.ts`: start, apply three
`tool.call`, no clock advance, `$.session.end({ reason: 'prompt_input_exit', sessionId: 's1',
resume: { id: 's1' } })`; assert a store write with `seq === 1` exists and the store map no longer
holds `promptfall:lease`. A second case with `reason: 'clear'`: the batch is written and the
lease stays. Both fail today (no hook).

**Files.** `plugins/promptfall/hooks/lease.ts`, `plugins/promptfall/hooks/register.tsx`,
`plugins/promptfall/hooks/engine.ts` (5b), `plugins/promptfall/hooks/register.test.ts`,
`plugins/promptfall/hooks/lease.test.ts`.

**Done when** `claude plugin test plugins/promptfall` passes and `claude plugin validate
plugins/promptfall` lists `session.end` among the hooks and still no `$.session` call.

## 6. Restart on reload wherever a game ran; rest on bridge prompts (J, L8)

**Finding J.** Codex, listed as a known limit in the PR: after a hot reload, `session.start`
fires again and reports surface null for a Desktop session, so only a fresh `session.attach`
starts the game. The proposed `$.session.surfaces()` is a `session` call, which the plan's
global constraints forbid and spec 2's footprint list does not include.

**Decision.** No `session` call is needed. The `leaseOwner` atom is non-null exactly when this
session has started a game before (terminal or desktop), and `$.state` survives a hot reload,
which is what the atom already relies on for the owner id. In `session.start`, start the game
when `(e.isInteractive && e.surface === 'terminal') || (await read($, leaseOwnerAtom)) !==
null`. A `-p` run or SDK host never had a game, so its atom is null and nothing changes there.
The attach handler keeps its `!game` guard.

**Finding L8.** Opus, plausible, not verifiable here: `prompt.submit` applies `rest` only for
`origin.kind === 'composer'`. The laid types (lines 8239 to 8260) define `composer` as "the user's
own gesture at the terminal" and `bridge` as "the user's message through the Remote Control
bridge (a phone or web client)". Whether the Desktop app stamps `composer` or `bridge` I do not
know; the spec says each prompt the player submits is a rest, and a bridge prompt is the
player's. Accept both kinds. The rest bucket (one per 5 s, capacity 30) bounds any abuse.

**Files.** `plugins/promptfall/hooks/register.tsx`; `plugins/promptfall/hooks/register.test.ts`.

**Test first.** (a) `session.attach({ surface: 'desktop', clientId: 'c1' })` on a session started
non-interactive with surface null; then `session.start({ surface: null, isInteractive: false })`
again; assert `time.periods` grew after the second start and the `view` atom is non-null. Fails
today (`game = null`, no restart). (b) `prompt.submit` with `origin: { kind: 'bridge' }` on a
primary session: the next store write's events include a `rest`. The kit's `SessionAttachInput`
shape is `SessionAttachInput` at line 10018 of the laid `claude-code/index.d.ts`: `{ surface, clientId }`.

**Done when** both tests pass; the PR's "Desktop after a hot reload" known limit becomes
"kit-tested only; Desktop remains unverified live (manual pass step 13)".

## 7. Notices clear only themselves; integer `at` (L1, L2, L3)

**Findings.** L1 (opus): the welcome's 20 s timer clears whatever notice is up, a pause reason
included. L2 (opus): a rejection's 5 s timer clears a later pane notice early. L3 (fable): a
non-integer `at` fails `TimedEventSchema` (`z.number().int()`), the fake throws a `ZodError`,
and the engine pauses until restart.

**Decision.** A generation counter per channel. Make `GameEngine.notice(text, ms)` public with
`private noticeGen`: each call increments it, the timer clears only when its generation is still
current and the engine is not paused (keep the existing guard). `GameSession` shows the welcome
through `engine.notice(WELCOME, WELCOME_MS)` instead of its own publish and timer, so the welcome
and the engine's 10 s notices share one rule. `GameSession.onEffects` gets the same counter for
`paneNotice`. For L3, `apply` stores `at: Math.floor(at)`. L1 is nearly unreachable in phase 1
(a pause within 20 s of a first run), but the counter costs the same as any narrower fix.

**Files.** `plugins/promptfall/hooks/engine.ts`, `plugins/promptfall/hooks/register.tsx`,
`plugins/promptfall/hooks/engine.test.ts`.

**Test first.** `engine.test.ts`, passing an `after` that records `{ ms, fn }` pairs: `notice('a',
10_000)`, `notice('b', 10_000)`, fire the first timer, assert the last notice patch is still `b`
(no `{ notice: null }` after it); fire the second, assert `null`. And: `apply({ t: 'tick' },
1000.5)` then `flush()` acks `ok: true` (throws today, leaving `isPaused()` true).

**Done when** `claude plugin test plugins/promptfall` passes.

## 8. Dialog: unequip, two-line item rows, collapsed line shows any notice (H, M, L9)

**Finding H.** Opus and codex. The sim has `unequip` and `equip` rejects an item worn by another
hero with `already_equipped`, so an equipped item can be neither moved nor sold from the dialog.
The plan's Task 11 button list omits it.

**Finding M.** The manual pass: in a docked pane of about 62 columns, three buttons share the
row with the name, affixes and wearer, and the text truncates. The Pane body scrolls (the test
props carry `scroll: { offset, bodyRows }` and `ui.scroll` fires on a Pane body), so more rows
per item cost nothing but scrolling.

**Finding L9.** Fable, cosmetic: `collapsedLine` shows the notice only in paused mode, so under
100 columns a `Promptfall resynced` never shows.

**Decision.** Two rows per item. Row 1: `glyph name (rarity, slot)` in the rarity colour, then
the affixes dim, both truncating. Row 2, indented two spaces: the `[wearer]` marker when
equipped, then the buttons: unequipped items get `equip`, `vendor Ng`, `reforge Ng` (the last only
with affixes); equipped items get `unequip` (key `unequip-<id>`, applies `{ t: 'unequip', heroId:
item.equippedBy, slot: item.slot }`) and `reforge Ng`. The `equip` button leaves equipped rows
(it could only re-equip on the same hero). The pickers stay where they are, under the item. In
`collapsedLine`, drop the `mode === 'paused'` condition: any notice joins the line. Button
labels are Kevin's taste; this is the layout that never truncates a button at 62 columns.

**Files.** `plugins/promptfall/hooks/ui/dialog.tsx`; `plugins/promptfall/hooks/ui/band.tsx`;
`plugins/promptfall/hooks/dialog.test.ts`; `plugins/promptfall/hooks/band.test.ts`.

**Test first.** `dialog.test.ts`, both surfaces: seed the Iron Sword with `equippedBy: knight.id`
and the Knight's `equipment.weapon = 'iseed'`; assert `vendor-iseed` is absent and
`unequip-iseed` present; press it; assert the view's item has `equippedBy: null`, the Knight's
row in the view no longer wears it, and `vendor-iseed` is now present. `band.test.ts`: with
`mode: 'primary'`, `bodyColumns: 80` and `notice: 'Promptfall resynced'` in state, the one row
contains the notice. Both fail today.

**Done when** `claude plugin test plugins/promptfall` passes on both surfaces.

## 9. Housekeeping: types folder, `vendor:check`, PR body (I, L6, L10)

**Finding I.** Codex, confirmed by the main session. `plugins/promptfall/.claude-plugin/types/`
holds a `.gitignore` of `*` written by the engine, so the declarations were never committed
although plan Task 8 ticked "commit the engine-laid tsconfig and types". `plugins/promptfall/
tsconfig.json` (the one-line `extends`) is tracked. The folder is 880 KB of generated
declarations, `claude-code-mcp/index.d.ts` reflects this machine's MCP servers, and the engine
refreshes the files per Claude Code version.

**Decision.** Do not commit them; correct the record. `claude plugin validate` and `claude
plugin test` pass without the folder (section "Decisions"), so the verification line only needs
an interactive load before `tsc -p plugins/promptfall`. Amend plan Task 8 (section 12) and add
one line to `plugins/promptfall/README.md` under the checks: "`tsc -p plugins/promptfall` needs
the engine's declarations, which an interactive `claude --plugin-dir plugins/promptfall` lays
under `.claude-plugin/types/` on first load; they are generated per Claude Code version and stay
uncommitted." No code change.

**Finding L6.** Opus: `vendor:check` runs `git diff --exit-code`, which ignores untracked files.
The script emits a fixed set of files, so an untracked newcomer means tsup started emitting
something new. One-line change in `package.json`: `"vendor:check": "node scripts/vendor.mjs &&
test -z \"$(git status --porcelain -- plugins/promptfall/hooks/vendor
plugins/promptfall/hooks/version.ts)\""`. Check it locally by touching a stray file under
`vendor/`, seeing the command fail, and removing it.

**Finding L10.** Fable: the equip picker lists the roster, where the plan says party heroes.
Keep the roster: a benched hero can be geared before the swap, which the plan's own pending-party
rule makes useful. It is an undocumented departure: add it to the PR body's departures and amend
Task 11 (section 12).

**PR body edits** (`gh pr edit 1 --body-file`): departures gain the roster picker, "off hides the
band and keeps playing", and "engine-laid types stay uncommitted"; known limits drop the Desktop
hot-reload entry and keep "Desktop untested live"; the manual pass paragraph for steps 10 to 12
follows the amended script.

## 10. Docs

Apply section 12 to the plan, the manual pass and the README in one commit after the code items,
so the diff reads as the record of what changed and why.

## 11. Deferred, with reasons

- **Tool-call budget under parallel work (L7, and the tool-call half of A).** Spec 7 sets one
  tool call per second with a two-minute capacity. Three parallel subagents each calling a tool
  every 3 s sit at the budget; one call every 0.8 s sustained drains 140 tokens in 560 s. A cap
  costs one 15 s batch and a resync notice, not the account. The number is a spec decision and
  the real server (phase 5) is where it gets data; a client-side mirror of the bucket is the fix
  if it bites earlier. Name it in the phase 5 plan.
- **Thrown submit pauses until restart with the error name (L4).** Plan Task 9 specifies it, and
  in phase 1 the fake throws only on our own schema bug, where a loud permanent pause is right.
  Item 7 removes the one honest trigger (a float `at`). Phase 2's HTTP fake brings spec 7's
  outage rules.
- **Duplicate retry of a `hash_mismatch` commit answers `ok: true, duplicate: true` (L5).**
  Contract rule 9 says so and the suite asserts it: the server committed its own result and the
  batch id names that commit. Phase 5 can revisit when the client's claim is sent.
- **Early-game feel (M, second part).** Within the tuned targets; it is Kevin's feel check in
  his pass, and a content-number change if he reds it.
- **Desktop live (step 13).** Item 6 makes reload and bridge rests kit-tested; no Desktop
  session exists here to verify either live.

## 12. Plan, manual pass and README amendments

### `docs/plans/2026-10-02-promptfall-phase-1.md`

Shared contracts, server rules:

- Rule 1, replace "a full set of budgets (each at its capacity) and `T0 = now`" with: "a full set
  of budgets (each at its capacity) and a refill clock per bucket, `R[kind] = now`".
- Rule 8, replace with: "Budgets: with `T = now`, every bucket refills by `n = floor((T -
  R[kind]) / refillMs)` tokens, clamped to `capacity`, and its clock advances by `n * refillMs`
  (never set to `T`, so the sub-period remainder carries over and a steady honest cadence never
  drains a bucket). For each kind in `BUDGETS`, the batch's count of that kind must not exceed
  the bucket; otherwise `rate_capped` naming the first `kind` that failed, nothing applied, no
  tokens consumed, nothing stored."
- Rule 9, replace "consumes the tokens, and sets `T0 = T`" with: "consumes the tokens, and
  stores the advanced refill clocks".
- Task 7 Work, replace "the next `seq`, `T0`, the four bucket levels" with "the next `seq`, the
  four bucket levels and their refill clocks"; add to the suite list: "a steady case of 240
  batches alternating 8 and 7 ticks 15 s apart that never caps".

Task 4 Work, "Zone boss killed" sentence, append: "After the zone change and the pending party
rule, heal every party hero 1500 bp and revive the fallen at 1500 bp, as a wave clear does: the
boss is wave 11 and the party that takes the field in the new zone must be able to fight." And
in the combat round rules, replace the White Mage sentence with: "White Mage heals the lowest-hp
living hero by `floor(atk * 8000 / 10000)` when that hero is under 7000 bp of max hp and no heal
has landed yet this round; otherwise she attacks the lowest-hp enemy. Alone, she attacks."

Task 8:

- Files, replace "`plugins/promptfall/tsconfig.json`, `plugins/promptfall/.claude-plugin/types/**`
  — engine-laid on first load, committed" with: "`plugins/promptfall/tsconfig.json` — created,
  one line extending the engine's; `plugins/promptfall/.claude-plugin/types/**` — engine-laid on
  the first interactive load, self-ignored by the engine's own `.gitignore`, never committed".
- Work, replace "commit both so `tsc -p plugins/promptfall` runs without a session (they are
  build-specific and get refreshed when Claude Code updates)" with: "`tsc -p plugins/promptfall`
  is a local check that runs after one interactive load; `claude plugin validate` and `claude
  plugin test` need no declarations".
- `PluginState`: drop `previousMode: Mode | null`.
- Checklist: "load once, commit the engine-laid tsconfig and types" becomes "load once; the
  engine lays and ignores its types".

Task 9 Work:

- Gating: "on `session.start`, when `e.isInteractive && e.surface === 'terminal'`, or when the
  `leaseOwner` atom is set (this session ran a game before a hot reload, on any surface), start
  the engine".
- Hooks: "`prompt.submit` applies `rest` when `e.origin.kind` is `composer` or `bridge`"; add
  "`session.end`: if primary, flush within `next.budget`; when `e.reason` is neither `clear` nor
  `resume` the process ends, so cancel the timers and release the lease if held".
- Timers: "one of 15000 ms calling `flush` while the session is primary".
- Replace "All hooks and timers apply events only while `mode === 'primary'`" with: "Events
  apply only while the session holds the lease and the engine is not paused. `mode` is derived by
  the session, `off ? 'off' : paused ? 'paused' : role`, and published on every transition; `off`
  hides the band and changes nothing else."
- Lease: add "`release(kv, owner)` deletes the lease when `owner` holds it".
- `toGameView`: "`firstRun` true on the first view the engine publishes after minting the
  account, false on every later view".
- Hot reload note, append: "a session that had a game restarts it on reload whatever the surface".

Task 11 Work:

- Replace the `off`/`on` sentence with: "`off` calls `setOff(true)` on the session, which
  publishes mode `off` and keeps playing; `on` calls `setOff(false)` and the derived mode comes
  back".
- Inventory tab: "two rows per item: the name line with its affixes, then the wearer marker and
  the Buttons: `equip`, `vendor`, `reforge` on an unequipped item; `unequip` and `reforge` on an
  equipped one; the equip picker lists every roster hero whose class the item admits".
- Account tab: "`band off` calls `setOff(true)`".
- Acceptance: add "pressing `unequip` on a worn item frees it and its `vendor` Button appears".

Task 12: the manual pass sentence gains "unequip it".

### `docs/manual-pass/phase-1.md`

- Step 5, append: "Press `unequip` on it: the `[hero name]` goes and `vendor` comes back."
- Step 10, replace with: "Run `/promptfall off`. The band disappears and the reply reads
  `Promptfall band is off for this session`; the game keeps playing out of sight, and
  `/promptfall` still opens the dialog. Run `/promptfall on`. The band comes back with the
  progress made meanwhile."
- Step 11, replace "within about 40 seconds" with "within about 10 seconds: quitting releases
  the lease".
- Step 12, replace the last sentence with: "Quitting flushes the last batch, so nothing is lost;
  only a crash loses the last 15 seconds."
- Final paragraph, append: "A store written before the 2026-10-02 fix pass carries the old
  budget record and must be deleted."

### `plugins/promptfall/README.md`

- Commands table, `/promptfall off`: "Hides the band for this session; the game keeps playing".
- A line under the checks as worded in item 9.

## 13. Verification and the manual re-run

Full line, every command exit 0, on the last fix commit:

```
pnpm lint && pnpm typecheck && pnpm test && pnpm vendor:check \
  && claude plugin validate plugins/promptfall && claude plugin test plugins/promptfall \
  && pnpm exec tsc -p plugins/promptfall
```

`claude plugin validate` must list `session.end` among the hooks, calls only on `ui`, `state`,
`store`, `clock` and `command`, and no `promptfall.previousMode`. `tsc` needs the declarations
from one interactive load.

Manual re-run, after deleting the pre-fix store files: steps 5 (with unequip), 10, 11 and 12 of
the amended script. Item 1 has no cheap manual check: the old code caps only after about 32
minutes spent inside turns (idle ticks every 5 s refill faster than they spend, so an idle soak
proves nothing). The contract case is the proof; during Kevin's pass, a `progress capped,
resynced` notice at any point in normal work is a red.
