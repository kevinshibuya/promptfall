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
ledger runs the chain when it first loads a record whose committed state is behind: it
migrates the **committed snapshot only**, rebuilds the effective state by replaying the
record's log of server events over it, recomputes the committed hash and writes the record
back. The client does the same replay from the bootstrap, so the two agree; migrating the
two snapshots independently would not, since a server event replayed over a migrated state
is not the same as a migrated state that already held its effect. The client never migrates
on its own: the server's bootstrap answers a current state, and the in-process fake is the
ledger, so the local and sandbox saves go through the same code. A golden test per step pins
it: a fixture of version N in, the expected version N+1 state out, on a plain fixture and on
a deep one with rare heroes, tiered items and a boss engaged.

Rules a migration follows, so every step reads the same way:

- A step is pure on shape: it rewrites fields and never reads the current rules, so its
  pinned output does not drift when a later bump changes a formula.
- A hero keeps its level; its XP into the level becomes 0. Stats are derived from level,
  class and rarity, so a new formula applies to old heroes at once.
- Items keep their base, rarity and affix rolls. An affix stores its flat roll and is scaled
  at read by the item's tier, so a value rule never needs a migration.
- Gold, zone, wave, roster, inventory and market goods are copied untouched.
- Anything the new version has that the old one lacked starts at its initial value.
- A step may name a goods rule for items and heroes the ledger holds outside the state (the
  market book, the returns, the log's server events); identity unless an item or hero
  changed shape. The ledger applies it once, under a version mark, as it applies the chain
  to a record.
- Two finishers run once at the chain's end and read the current rules: outside boss mode
  the encounter and the battle are cleared so the next tick spawns, and in boss mode both
  are left as they are; each hero's HP is clamped to its new maximum. A hero stores no old
  maximum, so a share cannot be carried; a clamp never heals and never kills.

## Considered options

- **Reset, as spec §7 says.** Zero code. Rejected: it makes every tuning change a wipe of
  every player's months, so tuning would stop.
- **Replay the account's history under the new rules.** The ledger keeps no player-event log;
  an account record is two state snapshots and a short log of server events (`books.ts`).
  Keeping every player event would multiply the store's size by the number of ticks, and a
  replay under new rules changes the past: a kill that rolled an Epic would roll a Common, and
  the item in the player's hands would vanish. Rejected.
- **Snapshot transform of both snapshots.** The first draft. Rejected once checked against the
  plugin's boot, which replays the delivery over the committed snapshot: the client and the
  server would disagree whenever a delivery was pending.
- **Snapshot transform of the committed snapshot, replay for the rest.** Chosen. One function
  per step, one snapshot, one replay, one golden per fixture.
- **Keeping cumulative XP.** Heroes would jump several levels on update day under a flatter
  curve. A free gift the player did not earn, and a confusing one. Rejected.
- **Keeping HP as a share of the old maximum.** The old maximum needs the old rules, which the
  code no longer holds. Rejected for the clamp.

## Consequences

- Spec §7's "no state migration between sim versions" is amended: a state behind the client's
  sim version migrates on the server; a state ahead of it still raises the update notice; a
  record the server cannot migrate (a gap in the chain) still raises the reset notice, and the
  ledger logs why.
- Every sim bump carries a migration and its goldens, in the same ticket as the change, and
  moves the plugin's version. A sim change with no state shape change still ships an identity
  step, so the version chain has no gaps.
- Content tables are not in the state hash, so a content change without a bump breaks replay
  with nothing at runtime to catch it; the golden hash test is the only guard. A content change
  bumps the version like any other sim change.
- Server events may carry stats and goods (`boss_engaged` carries the boss's stats; trades
  carry items and heroes). Replaying them over the migrated committed snapshot is what keeps
  them right; the goods rule covers the shape of what they carry.
- The vendored sim inside the plugin carries the migrations because the in-process fake is the
  ledger; the plugin itself never calls them.
