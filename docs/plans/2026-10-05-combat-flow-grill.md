# Combat flow grill: action gauges and the action queue

Grilled on 2026-10-05 on branch `feat/combat-flow`, on Opus 5.5 (Fable out of credits), with
Kevin answering. This is the record the combat flow planner starts from. It holds decisions
and facts, not a plan. Decisions are Kevin's; "recommended, accepted" marks a recommendation
Kevin took. Written as the grill runs, so a later round can amend an earlier node.

Raised by Kevin during the UI remake grill (`docs/plans/2026-10-05-ui-remake-grill.md`, 1.14):
"each unit should have a bar that fills up so they can take an action, the action should be
picked randomly with a confidence factor that picks which action (basic attack, skill,
technique) makes more sense to use (e.g. for healers, when ally is below 50%, use heal skill),
then there's a queue between each unit (ours and enemies), that has the bar 100% filled, each
one will act in order of whom filled the bar first, no unit should act while another unit is
acting [...] we should show our party's units action bar filling up, enemy's should not
appear. skills and techniques that are unlockable for each character, should be implemented
in the future, for now let's focus on the flow of the auto-combat."

Inherited from the UI grill: log pacing under one action at a time, the gauge's fill rate and
how "full" shows in time, and the order the stage plays events in.

## 1. Settled design tree

### 1.1 Battle time (Q1, Q3, recommended, accepted)

- Each tick advances a fixed 2 seconds of battle time. During a turn (a tick every 2 s) the
  battle plays at real speed; idle (a tick every 5 s) the client stretches those 2 seconds
  over 5: gauges fill slower, attack animations keep their speed. Progress per tick and the
  server's rate caps are unchanged; the tick event keeps carrying no time.
- The fill rate is tuned so an average-speed unit acts about once per tick: kills per minute
  and the zone pace target stay where they are (the balance harness checks it).

### 1.2 Gauges and the queue (Q2, Q4, Q6, Q7, recommended, accepted)

- Active, as Final Fantasy VI: gauges keep filling while a unit acts. A unit whose gauge is
  full joins the action queue; units act one at a time, in the order their gauges filled;
  each action takes a fixed slice of battle time.
- Fill rate is proportional to speed plus a constant (tuned in the balance harness), so speed
  8 against 4 is about 1.3 times the actions, not 2.
- Enemies, the world boss included, have gauges and join the same queue; their gauges are
  never shown. The world boss damage the server counts is unchanged.
- Heroes keep their gauges across waves. A spawned enemy starts at a random 0-50%. A fallen
  hero's gauge stops and empties. After a wipe or a rest every gauge empties.

### 1.3 Actions (Q5, recommended, accepted)

- Every class has Attack, behaving as today: the knight hits the front enemy, the black mage
  every enemy at 60%, the archer the weakest enemy with a 20% double-damage chance. The white
  mage also has Heal.
- A picker draws among a class's actions by weight (Kevin's "confidence factor"). Attack's
  weight is fixed. Heal's weight is zero until an ally is below 50% HP, then rises the lower
  that ally falls. Future skills and techniques join the same picker.
- A heal becomes an event the combat log and the stage show (today it emits nothing).

### 1.4 Version and names (Q8, Q9, recommended, accepted)

- `SIM_VERSION` 3 to 4; every saved game resets through the Account tab, as in phases 2 and 3.
- Glossary: Action gauge, Action, Action queue, Battle time (`CONTEXT.md`).

### 1.5 Tempo (Q10, recommended, accepted; amends 1.1)

- An average-speed unit acts about once every 2 ticks, and every action deals (or heals)
  double. Kills per minute and the zone pace stay as today; there are about 3 actions per 2
  seconds of battle time, about 0.67 s each, so every combat log line can be read. This
  replaces 1.1's "about once per tick".

### 1.6 The stage per action (Q11, recommended, accepted)

- The acting unit lunges; all of its hits land together at the impact (the black mage's spell
  hits every enemy at once); a heal shows a green rising number on the healed hero; the next
  action starts only when this one is over. Idle, the gaps between actions stretch; each
  action's animation keeps its speed.

### 1.7 Rest (Q12, recommended, accepted; amends 1.2)

- A rest (every prompt Kevin sends) heals and leaves the gauges alone. Only a wipe empties
  them.

### 1.8 Healing (Q13, recommended, accepted, with Kevin's note)

- Heal targets the ally with the lowest HP percentage, for 0.8 x the white mage's attack,
  doubled by 1.5. The one-heal-per-round rule goes: actions are one at a time, so a second
  healer sees the first heal. A heal never targets a fallen hero; no revival.
- Kevin: the 50% heal was an example "so you have a rough idea on how to think of this for
  all characters and interactions they might have". The weighted choice is a principle for
  every unit, not a white mage rule. Round 3 takes it up.

### 1.9 Before the UI remake (Q14, recommended, accepted)

- The combat PR changes the stage (one action at a time, heals visible) and adds a small text
  gauge per hero to today's party line, so the queue can be checked by eye before UI PR 1.

### 1.10 The picker (Q15, Q16, recommended, accepted)

- The picker chooses an action and its target together: every (action, target) pair a unit
  could take gets a weight from rules about the current battle, and one seeded draw picks a
  pair. Heroes, enemies and the world boss all use it. The rules are content data per class
  and per enemy archetype, so later skills and techniques are new entries, not new code.
- Starting rules (the shape; the balance harness tunes the numbers):
  - Knight: Attack; the front enemy weighs 3, each other enemy 1.
  - Archer: Attack; the weakest enemy weighs 4, the others 1; the 20% double damage stays.
  - Black mage: Attack hits every enemy at 60%; no target to choose.
  - White mage: Heal weighs 0 while every ally is at 50% or more, then grows as the weakest
    ally falls (about 3 heals in 4 at 25%, nearly always under 10%); Attack has a fixed weight
    and targets the weakest enemy.
  - Enemies and the world boss: Attack; a knight weighs 3, every other hero 1 (with a full
    party, today's 60% on a knight).

### 1.11 Closing (Q17, recommended, accepted)

- The grill closes. Spec amendments land with the combat PR: §4.1 (a tick advances a slice of
  battle time), §4.3 (actions and the picker), §7 (`SIM_VERSION` 4).
- The plan is written next on Opus (Fable out); its header reads `Execution model: opus`. The
  review wave runs `reviewer` on Opus and `codex-review`; the Fable `reviewer` leg cannot run
  while Fable is out, and the plan says so.

### 1.12 Review amendments (plan review wave, 2026-10-05)

- Heroes start a fight with empty gauges, as 1.2 says, in play. Test fixtures that need an
  action in the first tick (contract rules 35 and 36, the plugin's `dropping()` helper) start
  with full party gauges instead; no contract rule changes (Kevin, review Q18, recommended,
  accepted).
- 1.10's "today's 60% on a knight" was a miscount: today it is about 73% (60% aimed plus a third
  of the random 40%). The plan keeps today's feel with weights 11 and 2.
- 1.5's tempo is checked as each hero acting every 1.7 to 2.5 combat ticks.

## 2. Facts gathered (2026-10-05)

- A `tick` player event has no fields. It runs one round: every living hero and enemy acts
  once, sorted by spd descending, heroes first on a tie (`packages/sim/src/combat.ts:129-157`).
  spd is read nowhere else.
- Damage is `max(1, floor(atk*v/10000) - floor(def/2))` with v a ±10% draw (`combat.ts:7-10`).
  No misses. Archer: 20% chance of double damage (`:106`).
- Class behaviour: the knight hits the front enemy; the black mage hits every enemy at 60% atk;
  the archer hits the lowest-HP enemy; the white mage heals the lowest-HP hero below 70% (one
  heal per round across healers, no effect emitted) when 2+ heroes live, else attacks the
  lowest-HP enemy (`combat.ts:65-106`). Enemies target a knight 60% of the time when one
  lives, else a random hero (`:113-126`).
- Seeded PRNG in state (`seed`, `rng`); draws per tick vary with the actions taken.
- Cadence: a tick every 2 s during a turn, every 5 s idle (`hooks/register.tsx:103-104`). No
  wall clock in the sim, no offline progress. Rate caps: 1 tick per 2 s, burst 70
  (`packages/protocol/src/client.ts:107-112`).
- The ledger replays every batch and compares hashes; on a mismatch the server state wins
  (`packages/ledger/src/ledger.ts:255-370`). `SIM_VERSION` is 3; every rules change bumps it,
  with no migration: older states reset from the Account tab (spec §7; phases 2 and 3 did so).
- Stats are hp, atk, def, spd. Hero spd 4-7 with no growth; spd affixes +1 to +2, spd traits
  +10% to +40%; enemy spd 2-8 plus zone/3 (`content/heroes.ts`, `content/enemies.ts`).
- No skills, mana or cooldowns exist; spec §4.3 defers a class resource until skills exist.
- `hit` (by, target, amount) is output only, outside the hash. The stage plays a tick's hits
  150 ms apart (`hooks/stage/tuning.ts:21-29`).
- Pinned by tests: the golden hashes (`packages/sim/src/golden.test.ts`), the round order and
  heal rules (`combat.test.ts:42-211`), determinism (`determinism.test.ts`), the tick buckets
  (contract suite rule 8), world boss rules 33-40.

## 3. For the planner

- One PR, `feat/combat-flow` into `ai-staging`, ahead of the UI remake's PR 1.
- The UI remake record (`docs/plans/2026-10-05-ui-remake-grill.md`, 1.14 and 1.15) consumes
  this PR's output: per-hero gauge values the view exposes, one event per action with its
  battle-time offset, heal events. Shape those for the window band, not only for today's text.
- Every pinned test in section 2 changes: the golden hashes, the round-order and heal tests in
  `combat.test.ts`. The determinism and contract suites must stay green unchanged.
