# Combat flow implementation plan

**Goal:** Replace "every unit acts once per tick" with action gauges, an action queue and a
weighted picker, so units act one at a time in the order their gauges filled.
**Architecture:** Each tick advances 2 seconds of battle time in 100 ms steps inside the sim.
Gauges fill by speed every step; full units join the action queue; the head of the queue acts
when no action is running, choosing an (action, target) pair by a seeded weighted draw over
content-data tactics. The sim marks each action with an output-only `act` effect carrying its
battle-time offset; the plugin's stage plays one action at a time at those offsets, stretched
to the tick cadence.
**Spec:** `docs/plans/2026-10-05-combat-flow-grill.md` (the grill record; section 1 is binding)
and `docs/spec/promptfall.md` (amended in Task 8).
**Execution model:** opus

Review wave note: Fable is out of credits locally and in the cloud, so this plan's review wave
runs `reviewer` on Opus and `codex-review` only; the Fable `reviewer` leg cannot run.

## Global constraints

- Sim: integer and basis-point math only; no floats, no `Date`, no `Math.random`; every random
  choice draws from the state's seeded stream (`draw`, `drawBp`, `drawWeighted` in
  `packages/sim/src/progression.ts`) (spec §2).
- `step` never mutates its input; `replay` is deterministic through JSON (determinism tests).
- The `tick` player event keeps carrying no fields. Rate caps (`packages/protocol/src/client.ts:107-112`)
  and the ledger's replay and hash rules do not change.
- `SIM_VERSION` goes 3 → 4. No migration: v3 states are reset through the existing Account
  tab path (spec §7).
- Output-only effects (`hit`, and the new `act` and `heal`) never feed the hash; effects are
  not part of `GameState`.
- Battle time per tick: 2000 ms, whatever the cadence (grill 1.1). The plugin stretches
  playback to its cadence: 2 s ticks play at real speed, 5 s idle ticks play 2.5× slower
  between actions, while each action's animation keeps its own speed.
- Pace targets stay: `packages/sim/src/harness/harness.test.ts` (8 h day reaches zone 2-3,
  rounds per kill in zone 1 between 2 and 6, 40 h reaches zone 4-7) passes unchanged.
- Full check line, run before each task's final commit:
  `pnpm lint && pnpm typecheck && pnpm test && pnpm vendor:check && pnpm sprites:check && pnpm exec tsc -p plugins/promptfall && claude plugin validate plugins/promptfall && claude plugin test plugins/promptfall`.
  Tasks 1 to 4 leave `pnpm vendor:check` stale and the plugin red until Task 5 runs
  `pnpm vendor`. They run their named sim test files only, with
  `pnpm --filter @promptfall/sim exec vitest run <file names>` (no `--`: `test -- x` runs every
  suite), plus `pnpm typecheck`. Expected red until a later task: `golden.test.ts` until Task 5,
  `harness/harness.test.ts` until Task 4.
- Plugin tests import `claude-code/testing` and run only through `claude plugin test plugins/promptfall`,
  never through plain vitest.

## Shared contracts

### State (`packages/sim/src/types.ts`)

```ts
export const SIM_VERSION = 4 as const

/** Battle time state carried across ticks. Arrays, not records: canonical order is insertion order. */
export type Battle = {
  /** One entry per unit on the field (living party heroes, encounter enemies). 0..GAUGE_FULL. */
  gauges: { id: string; g: number }[]
  /** Unit ids whose gauge is full, in the order they filled. Head acts next. */
  queue: string[]
  /** Steps left in the running action; 0 when nobody is acting. Carries across ticks. */
  busy: number
}

// GameState gains:  battle: Battle
// createInitialState: battle = { gauges: [], queue: [], busy: 0 }
```

### Effects (`packages/sim/src/types.ts`), output only

```ts
  /** Output only: an action starts. Every effect after it, up to the next `act`, is this action's. */
  | { k: 'act'; actor: string; action: ActionId; at: number }   // at: battle ms into this tick, 0..1999
  /** Output only: a heal landed. */
  | { k: 'heal'; by: string; target: string; amount: number }
```

`hit` keeps its shape. An action's `act` comes first, then its `hit`/`heal` effects, then
whatever those cause (`hero_fell`, `level_up`, `gold`, drops, `wave_cleared`, `wipe`...), in
today's order.

### Battle constants (`packages/sim/src/battle.ts`, exported through `packages/sim/src/index.ts`)

| Name | Start value | Meaning |
|---|---|---|
| `TICK_MS` | 2000 | battle time one tick advances |
| `STEP_MS` | 100 | resolution of the battle loop (20 steps per tick) |
| `GAUGE_FULL` | 10000 | a full gauge |
| `ACTION_STEPS` | 5 | an action lasts 500 ms of battle time |
| `FILL_K` | 10 | speed constant: fill ∝ spd + FILL_K (grill 1.2) |
| `FILL_BP` | 16667 | per-step fill = floor((spd + FILL_K) × FILL_BP / 1000); spd 5 fills in 40 steps (4 s) |
| `POWER_BP` | 20000 | every damage and heal amount × 2 (grill 1.5) |
| `SPAWN_GAUGE_MAX` | 5000 | a spawned enemy starts at draw(SPAWN_GAUGE_MAX + 1) |

Task 4 may retune `FILL_K`, `FILL_BP`, `ACTION_STEPS` and `POWER_BP` to hold the pace targets;
`TICK_MS`, `STEP_MS` and `GAUGE_FULL` are fixed.

Power scaling, integer at every step: `scaled(raw) = Math.max(1, Math.floor((raw * POWER_BP) / 10000))`,
where `raw` is today's damage (`max(1, …)`) or today's heal base `floor(atk * 8000 / 10000)`. The
archer's doubling applies to the scaled amount.

### The battle loop (one tick; `advanceBattle` replaces `resolveRound`)

```
s.tick += 1
if checkWipe(s): return
sync gauges: drop entries for units no longer on the field (and from the queue);
             add a 0 entry for any living party hero without one
for step in 0..19:
  if encounter is null or has no enemies: break
  1. fill: for every unit on the field, alive, not in the queue:
       g += fill(spd); if g >= GAUGE_FULL: record overflow = g - GAUGE_FULL, g = GAUGE_FULL
     units that filled this step join the queue ordered by overflow desc,
     then heroes before enemies, then party order / encounter order
  2. if busy > 0: busy -= 1
  3. if busy == 0: pop queue heads until one is alive and on the field (or the queue is empty);
       set its gauge to 0; emit act { at: step * STEP_MS }; run its action (picker);
       busy = ACTION_STEPS
       after an enemy's action: if checkWipe(s): return
```

- Active, as grill 1.2: gauges fill every step, during actions too; the actor refills from 0.
- With no enemy on the field, gauges do not fill and no action starts, but time still passes:
  when the loop breaks early, `busy = max(0, busy - steps left in the tick)`. `step.ts` keeps
  its if/else exactly as today (`refillFromQueue`, then `advanceBattle` when enemies are alive,
  else `spawnOnEmptyTick`) and only swaps `resolveRound` for `advanceBattle`; the spawn-only
  branch sets `battle.busy = 0` (a whole tick passed). `s.tick` still counts combat ticks only,
  which the harness's rounds-per-kill reads.
- A null choice from the picker (no candidate): the unit's gauge resets to 0, no `act` is
  emitted, `busy` stays 0, and the next queue head may act in the same step.
- Enemy spawn (`spawnEnemy`, and the world boss in `bossEngaged`): the new enemy's gauge entry
  is `draw(s, SPAWN_GAUGE_MAX + 1)` at spawn time.
- A hero who falls: gauge 0, removed from the queue. A rest leaves gauges alone (grill 1.7);
  a revived hero gets a 0 entry at the next sync. A wipe: `battle = { gauges: [], queue: [], busy: 0 }`.
- An empty encounter ends the tick's loop; heroes keep their gauges into the next wave.

### Tactics (`packages/sim/src/content/tactics.ts`) and the picker (`packages/sim/src/picker.ts`)

```ts
// ActionId = 'attack' | 'attack_all' | 'heal', declared in types.ts
export type WeightRule =
  | { kind: 'fixed'; weight: number }
  /** 0 while the lowest ally is at or above belowBp of max HP; then scale × d² / (belowBp/2)², d = belowBp − lowestBp */
  | { kind: 'ally_need'; belowBp: number; scale: number }
export type TargetRule =
  | { kind: 'none' }                                            // attack_all
  | { kind: 'front'; front: number; other: number }             // encounter.enemies[0]
  | { kind: 'weakest'; weakest: number; other: number }         // lowest current HP enemy, first on a tie
  | { kind: 'class'; cls: HeroClass; match: number; other: number }  // living heroes
  | { kind: 'ally_lowest' }                                     // one candidate, weight 1: the living hero with the lowest HP %, first in party order on a tie
export type Tactic = { action: ActionId; weight: WeightRule; target: TargetRule; minAllies?: number }

export const heroTactics: Record<HeroClass, Tactic[]> = {
  knight: [{ action: 'attack', weight: { kind: 'fixed', weight: 10 }, target: { kind: 'front', front: 3, other: 1 } }],
  black_mage: [{ action: 'attack_all', weight: { kind: 'fixed', weight: 10 }, target: { kind: 'none' } }],
  white_mage: [
    { action: 'attack', weight: { kind: 'fixed', weight: 10 }, target: { kind: 'weakest', weakest: 1, other: 0 } },
    { action: 'heal', weight: { kind: 'ally_need', belowBp: 5000, scale: 30 }, target: { kind: 'ally_lowest' }, minAllies: 2 },
  ],
  archer: [{ action: 'attack', weight: { kind: 'fixed', weight: 10 }, target: { kind: 'weakest', weakest: 4, other: 1 } }],
}
const ENEMY_ATTACK: Tactic[] = [
  { action: 'attack', weight: { kind: 'fixed', weight: 10 }, target: { kind: 'class', cls: 'knight', match: 11, other: 2 } },
]
/** Keyed by enemy archetype (grill 1.10), plus the world boss. All share one table for now. */
export const enemyTactics: Record<Archetype | 'world_boss', Tactic[]> = {
  brute: ENEMY_ATTACK, swift: ENEMY_ATTACK, tank: ENEMY_ATTACK, caster: ENEMY_ATTACK,
  boss: ENEMY_ATTACK, turn_boss: ENEMY_ATTACK, world_boss: ENEMY_ATTACK,
}
```

- `EnemyDef` gains `archetype: Archetype` (the value `enemies.ts` already builds with, today
  dropped at export); `Archetype` moves to `content/types.ts`. An enemy's tactics are
  `enemyTactics[def.archetype]`, the world boss's `enemyTactics.world_boss`.
- Knight pull: today an enemy hits a lone knight 60% + 40%/3 ≈ 73% of the time with three heroes
  up (`combat.ts:118-119`); the grill's "today's 60%" was a miscount, and its intent was to
  reproduce today's feel, so the weights are 11 and 2 (11/15 ≈ 73%).
- `ally_need` integer form: `d = belowBp - lowestBp`; weight `Math.floor((scale * d * d) / ((belowBp / 2) ** 2))`,
  0 when `d <= 0`. It stays 0 until about 45% HP (the floor), then 1 heal in 3 at 40%, 3 in 4 at
  25%, about 9 in 10 at 10%.
- Picker: for each tactic of the unit, skip it when `minAllies` exceeds the living heroes; its
  weight W comes from the rule; each target T gets weight w(T) from the target rule (`none`
  gives one candidate); candidate key `${action}:${targetId}` (`attack_all:*` for none) gets
  W × w(T). Drop zero weights. No candidate left: the unit does nothing this turn (gauge still
  resets). Else one `drawWeighted(s, weights)`.
- `ally_need` with belowBp 5000, scale 30 against attack's 10: 0 at 50%+, about 1 heal in 3 at
  40%, 3 in 4 at 25%, about 9 in 10 at 10% (grill 1.10).
- Action effects, amounts × `POWER_BP` / 10000:
  - `attack`: today's damage formula (`combat.ts:7-10`) on the target; the archer keeps its
    `drawBp(s) < 2000` doubling after the damage draw.
  - `attack_all`: each live enemy at atk × 6000 / 10000, in encounter order, skipping any the
    sweep already removed (today's `combat.ts:71-77`).
  - `heal`: `scaled(floor(atk × 8000 / 10000))`, capped at the target's max HP; the `heal`
    effect's `amount` is the HP actually restored (0 is not emitted). Never targets a fallen hero. The one-heal-per-round rule is gone (grill 1.8).
  - Enemies hit with today's formula against the hero's def; `hero_fell` at 0 HP.
  - World boss: `hitEnemy`'s world-boss branch is unchanged (`dealt` grows, HP never drops).

### View (`plugins/promptfall/types/index.d.ts`, `HeroView`)

```ts
  /** 0..10000, the hero's action gauge after the last applied tick. */
  gauge: number
  /** True while the hero waits in the action queue. */
  queued: boolean
  /** fill(spd): gauge gained per 100 ms of battle time, so a renderer can fill smoothly. */
  gaugePerStep: number
```

`gauge` is the value at the end of the last applied tick, which runs ahead of playback by up to a
tick; a hero's reset happens at its `act.at`. A renderer that animates the fill replays from the
tick's `act` offsets and `gaugePerStep`.

The UI remake's window band reads these two fields (`docs/plans/2026-10-05-ui-remake-grill.md`
1.15); smooth filling between ticks is that remake's job, not this plan's.

## Task list

### Task 1: State, effects and constants

**Files:**
- `packages/sim/src/types.ts`: modify: `SIM_VERSION` 4, `Battle`, `GameState.battle`, the
  `act` and `heal` effects, and `ActionId` (declared here; `content/tactics.ts` imports it).
- `packages/sim/src/battle.ts`: create: the constants table above and `fill(spd)`.
- `packages/sim/src/state.ts`: modify: `battle` in `createInitialState`.
- `packages/sim/src/index.ts`: modify: export the constants and `fill`.
- `packages/sim/src/state.test.ts`, `packages/sim/src/battle.test.ts` (create): tests.

**Interfaces:**
- Produces: `Battle`, `GameState.battle`, `TICK_MS`, `STEP_MS`, `GAUGE_FULL`, `ACTION_STEPS`,
  `FILL_K`, `FILL_BP`, `POWER_BP`, `SPAWN_GAUGE_MAX`, `fill(spd: number): number`.

**Work:** Declare the shapes exactly as in Shared contracts. `fill` is
`Math.floor(((spd + FILL_K) * FILL_BP) / 1000)`, never below 1.

**Acceptance check:** `pnpm --filter @promptfall/sim exec vitest run state battle` passes: a new state
has `v === 4` and an empty battle; `fill(5) === 250`; `fill(0) >= 1`. Red before: `battle.ts`
does not exist.

**Boundaries:** No combat logic here. Golden tests will fail until Task 5; that is expected.

- [x] Add the types and constants
- [x] Write the two tests, run them, commit

### Task 2: Tactics and the picker

**Files:**
- `packages/sim/src/content/tactics.ts`: create: the tactic types and tables above.
- `packages/sim/src/content/index.ts`: modify: expose `tactics` on `content`.
- `packages/sim/src/content/types.ts`: modify: `Content.tactics`, `Tactic`/`WeightRule`/`TargetRule`
  types, `Archetype`, and `EnemyDef.archetype`.
- `packages/sim/src/content/enemies.ts`: modify: keep each def's archetype on the exported def.
- `packages/sim/src/content/validate.ts`: modify: every hero class has at least one tactic;
  every weight and target weight is a non-negative integer.
- `packages/sim/src/picker.ts`: create: `pickAction(s, unit): Choice | null`.
- `packages/sim/src/picker.test.ts`: create.

**Interfaces:**
- Consumes: `drawWeighted`, `livingParty`, `heroStats` from `progression.ts`; enemy stats as
  `combat.ts` computes them (export `enemyStats` from `combat.ts` if the picker needs max HP;
  it needs only current HP for `weakest` and hero max HP for `ally_lowest`).
- Produces:
  ```ts
  export type Unit = { side: 'hero'; hero: Hero } | { side: 'enemy'; enemy: Enemy }
  export type Choice = { action: ActionId; targetId: string | null }   // null for attack_all
  export function pickAction(s: GameState, unit: Unit): Choice | null
  ```

**Work:** Implement the candidate rules in Shared contracts. Integer math only. Exactly one
`drawWeighted` call when at least one candidate exists, none otherwise. Internal structure is
your choice.

**Acceptance check:** `pnpm --filter @promptfall/sim exec vitest run picker content` passes with:
- a knight against three enemies picks the front one in about 3 of 5 draws over 1000 seeds
  (accept 55-65%);
- the white mage never heals when every ally is at 50%+, heals in 70-80% of 1000 draws when
  the lowest ally is at 25%, and never heals when she is the only living hero;
- an enemy against knight + two others targets the knight in 68-78% of 1000 draws;
- the black mage's choice is `{ action: 'attack_all', targetId: null }`;
- `pickAction` does not touch anything but `s.rng`.
Red before: `picker.ts` does not exist.

**Boundaries:** Do not change `combat.ts` behaviour yet beyond an export. Stop and report
`blocked: <ambiguity>` if a rule in the contract cannot be expressed with the state the sim has.

- [x] Tactics content and validation
- [x] Picker and its tests, run, commit

### Task 3: The battle loop

**Files:**
- `packages/sim/src/combat.ts`: modify: replace `resolveRound` with `advanceBattle(s, effects)`
  per the loop contract; actions through `pickAction`; `POWER_BP`; the `act` and `heal`
  effects; remove the `Round` type and the one-heal-per-round rule.
- `packages/sim/src/step.ts`: modify: `tick` calls `advanceBattle`.
- `packages/sim/src/progression.ts`: modify: `spawnEnemy` gives the new enemy a gauge entry
  (`draw(s, SPAWN_GAUGE_MAX + 1)`); `checkWipe` clears `battle` on a real wipe (not the boss
  mode heal-in-place).
- `combat.ts` (listed above) also owns the fall: where it emits `hero_fell`, it removes the hero
  from the queue and zeroes its gauge.
- `packages/sim/src/server-events.ts`: modify: `bossEngaged` gives the world boss a gauge entry
  the same way; `bossDisengaged` drops its entry.
- `packages/sim/src/combat.test.ts`: modify: replace the round-order and heal tests.
- `packages/sim/src/boss.test.ts`, `packages/sim/src/progression.test.ts`: modify only where
  they assert one-round-per-tick behaviour.

**Interfaces:**
- Consumes: Task 1 constants and `Battle`; Task 2 `pickAction`.
- Produces: `advanceBattle(s: GameState, effects: Effect[]): void` (exported; `resolveRound`
  removed).

**Work:** Follow the loop contract line by line; it is load-bearing (determinism, queue order,
Active filling). Sync of gauges happens once at the start of each tick. `act.at` is
`step * STEP_MS`. Hits and heals keep their effect order after their `act`.

**Acceptance check:** `pnpm --filter @promptfall/sim exec vitest run combat boss progression determinism`
passes with new tests that show:
- a tick emits at most 4 `act` effects (20 steps / 5), each `at` a multiple of 100 in [0, 1900],
  strictly increasing within the tick;
- no two `act`s in one tick are closer than `ACTION_STEPS × STEP_MS`;
- over 50 ticks against a dummy encounter, a spd 9 hero acts more often than a spd 4 hero, but
  fewer than twice as often;
- the queue order: two units that fill in the same step act in overflow order;
- an `act` is always followed by its `hit`, `heal` or nothing (a `null` choice), never by
  another unit's `hit` before the next `act`;
- a wipe empties `battle`; a rest leaves it unchanged; a spawned enemy's gauge is in [0, 5000];
- the white mage's heal emits `heal` and no `hit`;
- a world boss hit still raises `dealt` and leaves its HP;
- a kill that empties the encounter at step 0 leaves `busy` at 0 by the tick's end, and a
  spawn-only tick leaves `busy` at 0;
- the power scaling never yields a fraction (a test with `POWER_BP` 21000 and atk 8).
Red before: `advanceBattle` does not exist.

**Boundaries:** No tuning in this task: use the start values. Do not touch the harness, the
golden test or the plugin.

- [x] Loop and gauges sync
- [x] Spawn, wipe, fall and boss hooks
- [x] Rewrite the combat tests, run, commit

### Task 4: Pace

**Files:**
- `packages/sim/src/battle.ts`: modify: retune `FILL_K`, `FILL_BP`, `ACTION_STEPS`,
  `POWER_BP` only if the harness needs it.
- `packages/sim/src/harness/scenario.ts`: modify: add `heroActsPerCombatTick` (party hero `act`
  effects ÷ (combat ticks × living party heroes), where a combat tick is one that ran
  `advanceBattle`) and `maxQueue` (largest queue seen) to the report.
- `packages/sim/src/harness/harness.test.ts`: modify: add `heroActsPerCombatTick` between 0.40
  and 0.60 (grill 1.5: a hero acts about once every 2 ticks) to the 8 h test; the existing
  targets stay as they are.

**Interfaces:** Consumes Task 3.

**Work:** Run `pnpm --filter @promptfall/sim harness` and the harness tests; adjust the four
tunable constants until every target passes. Record the final values and the harness output in
the commit message. If no setting satisfies all targets, stop and report
`blocked: <which target cannot hold and the closest values>`; do not move a target.

**Acceptance check:** `pnpm --filter @promptfall/sim exec vitest run harness` passes. Red before:
the `heroActsPerCombatTick` assertion fails (the field is undefined).

Known risk, recorded not tested: at high zones six fast units can want more than 4 actions per
tick, so the queue saturates; the harness checks only up to zone 7. Report `maxQueue` in the
commit message.

**Boundaries:** Only the four tunable constants and the two harness files.

- [x] Report fields
- [x] Tune, run, commit with the numbers (no retune: start values hold every target)

### Task 5: Golden, vendor, and the rest of the repo green

**Files:**
- `packages/sim/src/golden.ts`, `packages/sim/src/golden.test.ts`: modify: new `GOLDEN_HASH`;
  remove the `GOLDEN_HASH_V2` test and constant (the v2 draw order intentionally changes); the
  "reports hits without moving the hash" test asserts the new literal and that `act` effects
  appear too.
- `plugins/promptfall/hooks/vendor/*`, `plugins/promptfall/hooks/version.ts`: regenerate with
  `pnpm vendor` (never edit by hand).
- `packages/ledger/**`, `packages/protocol/**`, `servers/fake/**`: modify only tests or fixtures
  that pin v3 states or hashes, if any fail.
- `packages/protocol/src/contract/suite.ts`: modify fixtures only (Kevin, review Q18): the
  starting states the world boss rules build (`traderState`, `strongState` or the helper they
  share) begin with every party hero's gauge full, so rule 35's one-tick commit and rule 36's
  three-tick threshold hold. No rule's text or assertion changes.
- `plugins/promptfall/hooks/register.test.ts`: modify: `dropping()` (around line 1163) starts its
  state with full party gauges, so its tick still kills the 1 HP enemy.

**Interfaces:** Consumes Tasks 1-4.

**Work:** Set the new golden literal from a replay; run the whole repo's tests; fix fixtures
that embed `v: 3` or a v3 hash. The contract suite's rules must pass unchanged.

**Acceptance check:** `pnpm lint && pnpm typecheck && pnpm test && pnpm vendor:check && claude plugin test plugins/promptfall`
passes (the plugin suite may still fail only in the stage and party line tests that Tasks 6
and 7 rewrite; name each in the commit message).
Red before: the golden test fails on the old literal.

**Boundaries:** Do not change contract suite rules (fixtures only, as above), rate caps, or
ledger logic. A failure that
needs a rules change in the ledger: stop and report `blocked: <test and why>`.

- [x] Golden literal and tests
- [x] `pnpm vendor`, repo tests, fixtures, commit

### Task 6: The stage plays one action at a time

**Files:**
- `plugins/promptfall/hooks/stage/timeline.ts`: modify: `onEffects(effects, now, cadenceMs)`;
  group effects by `act`; each action starts at `now + floor(act.at × cadenceMs / TICK_MS)`;
  the actor lunges once at the action's start; every `hit` of the action flashes and numbers
  its target at `start + LUNGE_MS / 2`; every `heal` shows a number in `NUMBER_RGB_HEAL` on its
  target at the same impact, no flash; a drop attaches to the target of the hit that precedes
  it within the action (today's running `last`), at that hit's flash end. Effects before the
  first `act` (a delivery or resync) play as one action at offset 0 with no lunge. Actions
  never overlap across batches: an action starts at
  `max(scheduled start, end of the previous action already on the timeline)`, so a cadence
  switch from 5000 to 2000 mid-playback delays new actions instead of overtaking old ones.
- `plugins/promptfall/hooks/stage/tuning.ts`: modify: remove `HIT_STAGGER_MS`; add
  `NUMBER_RGB_HEAL = 0x58d858`.
- `plugins/promptfall/hooks/register.tsx`: modify: pass the current cadence to
  `timeline.onEffects` (2000 or 5000).
- `plugins/promptfall/hooks/stage/scenarios.ts`, `plugins/promptfall/hooks/stage/goldens/*`:
  modify: scenarios emit `act` effects; regenerate goldens with `pnpm stage:goldens`.
- `plugins/promptfall/hooks/stage/timeline.test.ts`, `loop.test.ts`, `golden.test.ts`,
  `model.test.ts`, `svg.test.ts`: modify: fixtures that stand for attacks prepend an `act`.

**Interfaces:**
- Consumes: `act`, `heal`, `TICK_MS` from the vendored sim.
- Produces: `StageTimeline.onEffects(effects: readonly Effect[], now: number, cadenceMs?: number): void`
  (`cadenceMs` defaults to `TICK_MS`).

**Work:** Each action's animation (lunge, flash, number) keeps its own duration whatever the
cadence; only the start offsets stretch (grill 1.6).

**Acceptance check:** `claude plugin test plugins/promptfall` passes with tests that show: two actions at `at` 0 and 500 start 500 ms apart at cadence 2000 and 1250 ms apart at
5000; a black mage action with three hits shows three numbers at one impact time; a heal shows
a green number and no flash; a hit-only effect list with no `act` plays at offset 0 without a
lunge; a black mage kill of the first of two targets drops from the first target; a batch
applied at cadence 2000 while a 5000 batch is still playing starts after the last old action
ends. Red before: the timeline staggers by `HIT_STAGGER_MS`.

**Boundaries:** No band layout or party line changes here (Task 7). No sim changes.

- [x] Timeline grouping and stretch
- [x] Heal numbers, cadence plumbing
- [x] Scenarios and goldens, run, commit

### Task 7: The text gauge in today's party line

**Files:**
- `plugins/promptfall/hooks/view.ts`: modify: `HeroView.gauge` from `state.battle.gauges`
  (0 when absent), `HeroView.queued` from `state.battle.queue`, `HeroView.gaugePerStep` from
  `fill(heroStats(state, hero).spd)`.
- `plugins/promptfall/hooks/stage/fixtures.ts`: modify: the hero factory sets the three fields
  (with a queued and a fallen example for gauge tests).
- `plugins/promptfall/types/index.d.ts`: modify: the two `HeroView` fields.
- `plugins/promptfall/hooks/ui/parts.tsx`: modify: `PartyLine` draws a 3-cell gauge after the
  HP numbers: `▰` per filled third, `▱` for the rest, yellow when `queued`, dim when the hero
  is down. `HERO_SEGMENT` grows from 27 to 31 and the HP padding subtracts the gauge's 4 cells
  (` ▰▰▱`), so a segment is exactly 31 cells; the enemy room stays `width − (31 × 3 + 9)`. The
  wrapped (Svg) form adds the same 3 cells.
- `plugins/promptfall/hooks/band.test.ts`: modify: party line tests.

**Interfaces:** Consumes Task 5's vendored state shape.

**Work:** The gauge reflects the last applied tick; it does not interpolate (the UI remake
does that).

**Acceptance check:** `claude plugin test plugins/promptfall` and `pnpm exec tsc -p plugins/promptfall`
pass, with tests that a hero at gauge 6700 shows `▰▰▱`, a queued hero's gauge is yellow, each
hero segment renders exactly 31 cells, and the full layout at 116 columns keeps a front enemy
segment of 116 − 102 = 14 cells (clipped, not wrapped). Red before: `HeroView` has no `gauge`.

**Boundaries:** No window band, no layout thresholds, no compact layout changes.

- [x] View fields
- [x] Party line gauge and tests, run, commit

### Task 8: Spec, manual pass, pull request

**Files:**
- `docs/spec/promptfall.md`: modify: §4.1 first bullet (a tick advances 2 s of battle time;
  gauges, the action queue, one action at a time; cadence stretches playback); §4.3 (actions,
  the weighted picker, tactics as content data; the heal rule); §7 (`SIM_VERSION` 4 reset
  follows the existing path); §10 stage motion (one action at a time, stretched to cadence).
- `docs/manual-pass/2026-10-05-combat-flow.md`: create: the manual steps below with results.

**Work:** Run the full check line. Then the manual pass, driven by the implementing session the
way phase 4's was (cmux and Terminal.app), and listed for Kevin:
1. Start Claude Code with the plugin on the in-process server; the band shows the
   older-version notice; reset from the Account tab.
2. During a turn: the stage plays one action at a time (one lunge, then its hits), never two
   units moving at once; the party line gauges fill and turn yellow when queued.
3. Idle: actions come further apart; each lunge keeps its speed.
4. Let an ally drop below 50%: the white mage heals with a green number; above 50% she only
   attacks.
5. Black mage: all enemies take damage at one impact.
6. A world boss engagement (HTTP fake): the boss acts in turn; contribution still rises.
Open the PR from `feat/combat-flow` into `ai-staging` with the manual steps and what was
verified, then stop (CLAUDE.md: the review is Kevin's to trigger).

**Acceptance check:** the full check line passes; the manual pass file records each step's
result; `gh pr view` shows the PR.

**Boundaries:** No code changes in this task except fixes the manual pass finds, each committed
on its own with the failing step named.

- [x] Spec amendments
- [x] Full check line
- [x] Manual pass, record results (steps 1-3 driven in Terminal.app; 4-6 Kevin's, test-covered; stopped at 93% weekly usage)
- [x] PR, stop (https://github.com/kevinshibuya/promptfall/pull/7)
