---
status: accepted
---

# The world boss is fought inside each party's sim, with one global HP outside it

A world boss has one HP shared by every online party, which no per-party sim can hold, yet
the party has to be seen fighting it and the player has to see the damage land. The ledger
owns the boss record (HP, window, contributions) and puts each online account into **boss
mode** through the server event `boss_engaged`: the sim's encounter becomes one enemy of kind
`world_boss` that never dies locally, every hit adds to the state's damage dealt, and the
server reads that tally from each committed batch as the account's contribution.
`boss_disengaged` ends it. Rewards are rolled server-side and arrive as `rewarded` events.

## Considered options

- **Contribution derived from kills** (no sim change): the server counts the kills a batch
  made during the window, weighted by zone. Rejected: kills are lumpy, nothing moves between
  them, and the party is not fighting the boss, it is fighting a wolf under a banner.
- **A damage counter on normal combat** (one sim line): every hit on any enemy counts while
  the boss is live, the boss is a banner. Rejected for the same reason, kept as the fallback
  if boss mode proves too heavy for one PR.
- **A boss enemy with its own HP in every party's sim**: rejected, each party would kill its
  own copy and the global HP would mean nothing.

## Consequences

- `SIM_VERSION` goes to 3 and every existing state is reset; phase 3 pays that once.
- Boss mode pauses normal waves for its window: tool calls spawn nothing, a wipe heals in
  place, the boss grants no XP, gold or drops.
- An account that comes online mid-boss is engaged by its first poll; one that goes offline
  keeps ticking in boss mode until its next delivery disengages it, and ticks the server
  commits after the boss ended count for nothing.
