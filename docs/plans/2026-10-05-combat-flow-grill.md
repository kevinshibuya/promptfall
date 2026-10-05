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

(Filled as rounds settle.)

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
