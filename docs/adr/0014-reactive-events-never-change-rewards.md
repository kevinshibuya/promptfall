---
status: accepted
---

# Reactive events never change rewards

Promptfall reacts to what Claude does. Today the reaction is one: a tool call spawns an
enemy. The core loop grill of 2026-10-11 adds a family of **reactive events**: Haste while a
turn runs, Enrage on a failed tool call, Camp on compaction, Guard while a permission prompt
waits, and the kind of enemy a tool kind spawns. Each one is a player event, or for the enemy
kind a hint on the `tool_call` player event: the client saw the hook fire and tells the server so
in a batch.

The server cannot check any of them. It never sees Claude's tools, its failures, its
compactions or its prompts; it sees a batch of events a client claims happened, replayed under
rate caps. A client that lies about a tool failure to enrage an enemy gains nothing worth
having. A client that lies about enemy kinds to spawn the ones with the better drop table gains
gold and items, and so would every client the day a script learns the trick. The busywork
measurement of the diagnosis showed progress follows hours in a live session; a reactive event
that paid would be the first thing a player could farm from a script.

So the rule: **a reactive event shapes the fight and never the reward.** Enemy kinds are
chosen from the zone's own list and drop from the zone's own table at its rarity odds. A wave
enemy's XP, gold and drop chance follow its toughness, the zone's base scaled by its archetype's
HP share over the four kinds' mean share, so a brute and a swift at zone 4 pay the same per
point of HP it takes to kill them and a claimed tool kind buys no farming rate. Haste speeds the
heroes' gauges, Enrage hardens one enemy hit, Camp heals, Guard halves damage taken; none of
them touches XP, gold, drop chances or rarity odds.
Any later reactive event passes the same test before it is designed: if faking it would pay,
it is not a reactive event.

The ledger caps each reactive event kind in its own token bucket, as it caps rests and turn
ends, so a flood of claimed compactions heals the party no faster than a flood of prompts. The
enemy kind rides the tool calls' own bucket.

## Considered options

- **Server-verified reactions.** The server cannot see Claude Code. Rejected as impossible
  without the plugin forwarding tool payloads, which the mod's footprint (spec §2) forbids.
- **Reactions that pay, capped by rate.** A cap bounds the gain per hour; it does not remove
  the reason to fake. Rejected: a script running all day at the cap is the busywork hazard
  the diagnosis measured.
- **No reactions beyond the spawn.** Zero risk. Rejected: the game's reason to exist is that it
  plays alongside Claude, and the player asked for the fight to feel the work.
- **Reactions that shape, never pay.** Chosen. Faking one buys a flash on the stage.

## Consequences

- Spec §4.1 gains the reactive events and this rule; §7 gains their rate buckets
  (`turn_start`, `tool_mishap`, `camp` and `guard`) and the hint; §10 gains their stage and log
  lines, and none of them toasts or plays a cue.
- Haste touches pace, the one reactive event that does. It passes the test as shape: a quarter
  more hero actions, only during a turn, with a countdown, in time the turn cadence already
  pays for. Its arc run at sim 15 moved the medians by under 5% against sim 14.
- Camp pauses the fight until it breaks (sim 19, #222). Stopping a fight pays nothing: a held
  tick spawns, kills and drops nothing, and with a world boss engaged camp pauses nothing, so a
  shared fight is never forfeited.
- A summon on a subagent start (a fourth unit that fights while the subagent runs) fails the
  test and stays out, however good it looks. It can return the day the server can see
  subagents, which is never, or as something that does not fight.
- Enemy kind is an optional `hint` on the `tool_call` event, one of `swift`, `brute`, `caster`
  or `tank`, that the server accepts without judging. The table that maps tool names to kinds
  lives in the plugin (`hooks/tool-kinds.ts`), since the sim only needs the kind.
- Wave rewards moved from flat per zone to the HP-share rule above, mean-normalised, so an
  unhinted zone still pays on average what it paid before. Boss rewards, rarity weights and
  drop tables did not move.
- Every reactive event has a stage effect and a combat log line, so the player can feel it
  and then read what it was.
