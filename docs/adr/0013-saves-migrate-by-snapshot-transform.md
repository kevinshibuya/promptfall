---
status: proposed
---

# Saves migrate by snapshot transform

Spec §7 said a state behind the client's sim version is reset from the Account tab, and the
plugin and ledger do exactly that today: an old save is stranded, the player starts over. That
was fine while every sim change was a bug fix on a game nobody had played for long. The core
loop work changes the combat formula, the XP curve, hero stats and affix values, each a
`SIM_VERSION` bump, and the game is played on a public server by people who keep their party
for months. A reset per bump would throw their party away four times in a row.

So a sim bump ships with a **migration**: a pure function per step, `migrate(state, from)`,
that rewrites a stored `GameState` of version N into one of version N+1 and nothing else. The
ledger runs it on both snapshots of an account record (`state` and `committedState`) when the
record is first read under the new version, before any server event in the log is applied,
and recomputes the committed hash. The plugin runs the same function on the machine's save
and on the sandbox save. A golden test per step pins it: a fixture of version N in, the
expected version N+1 state out.

Rules a migration follows, so every step reads the same way:

- A hero keeps its level; its XP into the level becomes 0. Stats are derived from level,
  class and rarity, so a new formula applies to old heroes at once.
- Items keep their base, rarity and affix names; affix values are re-derived.
- Gold, zone, wave, roster, inventory, listings and the market are copied untouched.
- Anything the new version has that the old one lacked starts at its initial value.

## Considered options

- **Reset, as spec §7 says.** Zero code. Rejected: it makes every tuning change a wipe of
  every player's months, so tuning would stop.
- **Replay the account's history under the new rules.** The ledger keeps no player-event log;
  an account record is two state snapshots and a short log of server events (`books.ts`).
  Keeping every player event would multiply the store's size by the number of ticks, and a
  replay under new rules changes the past: a kill that rolled an Epic would roll a Common, and
  the item in the player's hands would vanish. Rejected.
- **Snapshot transform, keeping level.** Chosen. One function per step, both snapshots, one
  golden each. The only judgement is what to keep: level stays because the player saw it.
- **Snapshot transform, keeping cumulative XP.** Heroes would jump several levels on update
  day under a flatter curve. A free gift the player did not earn, and a confusing one.
  Rejected.

## Consequences

- Spec §7's "no state migration between sim versions" is amended: a state behind the client's
  sim version migrates; a state ahead of it still raises the update notice.
- Every sim bump carries a migration and its golden, in the same ticket as the change.
  A sim change with no state shape change still ships an identity migration, so the version
  chain has no gaps.
- Content tables are not in the state hash, so a content change without a bump breaks replay
  with nothing at runtime to catch it; the golden hash test is the only guard. A content change
  bumps the version like any other sim change.
- The ledger applies a migration before the log's server events, so a server event authored
  under the old version is applied to a migrated state. Server events carry ids and counts,
  never stats, so this holds; a server event that ever carries a stat must be versioned.
- The vendored sim inside the plugin carries the migrations, so the client migrates on its own
  before the server answers.
