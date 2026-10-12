# Promptfall, product and architecture spec

Decided in a grilling session on 2026-10-02; amended for phase 2 on 2026-10-03, for
phase 3 on 2026-10-03, for phase 4 on 2026-10-04, for the staged state on
2026-10-09 and for the curve on 2026-10-12. Every
section is a decision, not a proposal. A change here is a change of contract and goes
through the same gate.

## 1. What it is

Promptfall is an idle fantasy RPG that runs inside Claude Code as a mod. A band
above the prompt shows a party of three heroes fighting while Claude works. Each
tool call Claude makes spawns an enemy, each long turn ends in a boss, each
prompt the player submits is a short rest. Heroes level, items drop, and from
phase 2 on players trade items and heroes on a global marketplace, see each other
in the world, chat, and fight scheduled world bosses together. The reference for
the look is early Final Fantasy pixel art; the reference for the market is Task
Bar Hero's use of the Steam Community Market, minus the real money.

Name: Promptfall. Plugin name `promptfall`, slash command `/promptfall`, npm scope
`@promptfall`.

## 2. Non-negotiables

- The game never gets in the way of the work. The band on the Party tab is 22
  rows in every fight, the 17-row stage over the 5-row window strip (ADR 0010),
  and never takes more than the engine's `maxRows`. A shorter band shows the
  whole stage smaller where it can (the Image zooms out, the Svg scales) and
  crops the Raster's sky down to the tallest actor on the stage; past that it
  drops to a 6-row compact band, as it does at 100 to 115 columns, collapses to
  1 row under 100 columns or 6 rows, hides while Claude asks a question, and
  switches off per session with one command. Loot and World are the strip
  alone, 5 rows. VS Code and mobile add a row of hotkeys.
- No real money anywhere. Gold is the only currency. No cash-out, no purchases.
- The server is the ledger. The client renders and predicts; it never decides a
  drop. Every drop, trade and hero exists because the server rolled it or
  replayed it.
- One deterministic simulation package runs on client and server. Integer math
  only, fixed-point percentages in basis points (10000 = 100%), a seeded PRNG of
  our own, no `Date`, no `Math.random`, no floating point inside the sim. Input
  is an ordered list of events, output is a state and a hash.
- Progress needs a live interactive Claude Code session. No offline progress, no
  catch-up. Headless sessions (`claude -p`, subagents, cloud, VS Code chat
  panel) never tick.
- The mod's footprint is interface (including images and sound from the mod's
  own files), state, store, clock, HTTP and commands. No file system, no process
  spawning, no model calls, no prompt rewriting.
- Every social feature sits behind a server flag that can switch it off for
  every client at once.

## 3. Platform facts the design rests on

Checked against Claude Code v2.1.287's mods API.

- A mod is TypeScript event hooks run inside Claude Code. Drawing works in the
  terminal and the Desktop app; hooks also run where nothing draws.
- `session.start` reports `isInteractive` and `surface`: `terminal` under the
  REPL, null for `-p` and SDK hosts. The Desktop app connects as a client and
  announces its surface through `session.attach`. The mod ticks when the start is
  interactive on `terminal`, or when a client attaches with surface `desktop`.
- Band: `ui.render` on `AbovePrompt`, props `hasSurvey`, `isWorking`, `maxRows`,
  `bodyColumns`. Elements: Box, Text, Button (with single-key `hotkey`), Input,
  Select, Link, Code, Markdown, Image (terminal only, pixels on kitty and
  Ghostty, its `alt` elsewhere, no capability flag: `$.ui.blit` refuses an Image
  drawing its alt), Raster (terminal only, a grid of cells each one BMP glyph
  with a foreground and a background, up to 512 × 256, 1024 colour pairs at
  once; half-blocks give 2 pixels a row). Desktop, VS Code and mobile have Svg
  instead (at most 131,072 characters; `isInteractive` runs SMIL in a sandboxed
  frame) and no Image or Raster. `$.ui.blit` repaints a Raster or swaps a keyed
  Image without a redraw, up to 120 a second taken.
- Sound: `$.audio.play({ asset })` plays a file of the plugin's own through
  `afplay` on macOS; Linux and Windows terminals play nothing. Clips do not queue.
- Dialog: `$.ui.open({ id, title, focus, closeOnEscape, holdToasts, rows })`
  drawn by a `ui.render` hook on `Pane`.
- Timers: `$.clock.every(ms, fn)`. Each hook dispatch has a 10 second budget;
  time spent inside `$` calls does not count.
- Network: `$.http.fetch(url, init)` only, resolves after the whole body. No
  WebSocket, no server-sent events, no abort signal and no timeout field. The plugin
  gives every fetch 15 seconds and treats a longer one as an outage, so a held
  long-poll needs its own fetch path and its own failure rule (none yet: §8).
- Persistence: `$.store` (a JSON file under the user's Claude Code config
  directory, shared by every session on the machine, 4 MiB total, no atomic
  compare-and-set) and `$.state` (per session, survives a hot reload, read while
  drawing subscribes the drawing).
- A bare digit typed at an empty prompt presses a band Button with that digit as
  hotkey, so band hotkeys are letters.
- Imports: a mod imports only files inside its own plugin folder, no dynamic
  `import()`, no `node_modules`. Shared packages are bundled into the plugin
  folder by a build step. A `--plugin-dir` folder hot-reloads on save in an
  interactive session.
- `claude plugin validate <dir>` lists a mod's hooks and `$` calls. `claude
  plugin test <dir>` runs `*.test.ts` against the engine with a mock clock.

## 4. Core loop

### 4.1 Cadence and encounter rules

- Every tick advances 2 seconds of battle time, in 100 ms steps. Ticks come
  every 2 seconds while a model turn is running and every 5 seconds while the
  session is idle; the client stretches each tick's 2 seconds of playback over
  its cadence, so an idle battle plays 2.5 times slower between actions while
  each action's animation keeps its speed. Cadence is the client's scheduling;
  the sim itself is purely event-driven and knows no wall clock.
- Every hero and enemy on the field, the world boss included, has an action
  gauge that fills by speed (proportional to speed plus a constant), during
  actions too. A full gauge joins the action queue; units act one at a time in
  the order their gauges filled, each action taking 500 ms of battle time, and
  the actor's gauge empties. Heroes keep their gauges across waves and through a
  rest; a spawned enemy starts between 0 and 50%; a fallen hero's gauge empties;
  a wipe empties them all. Only the party's gauges are shown.
- `tool.call` spawns one enemy into the current encounter. At most 3 enemies
  fight at once; up to 10 more queue; beyond that new spawns are dropped so a
  very long turn cannot create a death wall.
- `turn.complete` after a turn with 10 or more tool calls spawns a turn boss: a
  mini-boss with raised drop rates and a hero contract chance. It is not the
  zone boss. One that spawns mid-wave joins the wave's encounter and leaves its
  progress alone: the wave clears, with its heal, when its last monster is gone.
- `prompt.submit` is a short rest: every hero heals 50% of max HP, fallen heroes
  revive at 50%.
- When no enemy is present a tick spawns the next enemy of the current wave, so
  idle sessions still fight.

### 4.2 Zones

- 12 zones, each 10 waves then a zone boss. Waves have 1 to 3 enemies drawn
  from the zone's enemy list.
- Clearing the zone boss advances to the next zone unless the farm toggle is on
  or the party is at the ladder's end, in which case the zone restarts at wave 1.
- Wave clear heals every hero 15% and revives fallen heroes at 15%.
- Party wipe: every hero down. Full heal, encounter and queue cleared, the
  pending party applied, nothing lost. The state counts the wipes in the
  current zone (`zoneWipes`); a zone boss kill and any change of zone reset the
  count. A wipe with fewer than two before it restarts the same zone at wave 1
  and raises the count; its effect is a wipe naming the zone.
- Retreat: the third wipe in a zone with no zone boss kill between them. The
  party falls back one zone to wave 1 (in zone 1 it restarts zone 1) and the
  count resets; its effect is a retreat naming the zone fallen to. Boss mode's
  wipe counts nothing (§4.6), and the farm toggle is unchanged.
- Tiers: zone 12's boss opens tier 2, the same twelve zones again as zones 13
  to 24, and zone 24's boss opens tier 3, zones 25 to 36. The ladder ends at
  tier 3 for now (`LADDER_END`, 36), where the advance gate farms as the farm
  toggle does. `zone` stays one running number in the state and on the wire, and
  `highestZone` with it, so tier 2's zone 1 ranks above tier 1's zone 12. One
  accessor (`zoneAt`) gives a running zone's tier and base zone (1 to 12), and
  every content lookup by zone goes through it, so the content stays twelve
  zones. A zone past 12 holds its base zone's enemies, boss, name and backdrop
  at zone 12's numbers grown once per zone past 12 on HP, attack, defence, XP
  and gold at its tier's rate (`TIER_GROWTH_BP`): a ramp with no step at the
  tier's door, ×1.1325 a zone through tier 2 and ×1.04 through tier 3, so zone
  24 lands where a ×2.78 step at zone 13 put it. Speed stays at zone 12's. It
  drops, and its boss contracts roll, at zone 12's rarity weights, every item at
  item tier 5 in tier 2 and 6 in tier 3 (§4.4).
  The world boss scales by the running zone through the same accessor.
- Arc targets, in live hours at the reference cadence (turns drawn from Kevin's
  transcripts: a median of 2 tool calls a turn, about 5 prompts an hour, 60% of
  live time inside turns, a rest on every prompt), for a dedicated player and read
  on the median of nine seeds: zone 1 first cleared inside the first 30 minutes;
  zone 12 first cleared between 40 and 60 hours; a level every 0.5 to 1 hour
  through levels 10 to 30; a Legendary hero at 50 between 75 and 100 hours. The
  feel target holds at every zone: the reference Knight survives 6 to 10 wave
  hits and 3 to 4 boss hits.
- A headless balance harness in the sim package measures the arc and is the tool
  for tuning numbers. Its player is a dedicated one, with one habit per decision:
  it scores an item on every stat, weighted by its worth in a fight; it wears a
  drop on the hero it raises most, party first, and moves the displaced item on
  to the next hero it beats; at a turn's end it recruits while the roster has
  room (dismissing its weakest bench hero from a full roster no better than the
  party), expands a full inventory and reforges a worn item's weakest affix when
  that costs under a tenth of its gold, and never trades; after a recruit it
  fields one hero a class, the Knight first, then the Black Mage and the White
  Mage, each the best of its class by score; and it vendors the unworn items no
  hero would wear. It grants itself a Legendary Knight at hour 9, at the level
  of the Knight it replaces.
- `arc.test.ts` measures the arc in every gate: nine seeds (1 to 9) of 120 live
  hours each. What gates: every seed first clears zone 1 inside the first 30
  minutes and first clears each zone later than the one before; at least seven
  of the nine first clear zone 12, and at least seven take the granted Legendary
  to 50, inside the run (the completion floors); at least seven of the nine
  first clear zone 13 with the arc's own party, inside the run; the feel probe
  holds at every zone. The three medians (zone
  12's first clear, the hours per level through 10 to 30, the Legendary's cap)
  are a report, never a gate: the test prints them with the per-seed table (with
  each zone's first-clear duration, zone 13's first clear, its wipes and its gap
  over zone 12), each
  bump ticket pastes that table in its closing comment, and Kevin judges the
  medians on the PR.

### 4.3 Heroes

- Four classes: Knight, Black Mage, White Mage, Archer. Party of three from the
  roster, chosen in the dialog's Heroes tab at any time, applied at the
  next zone boss kill or wipe (a farm restart and a wipe in zone 1 included), so
  swaps happen between zones. A pick on a fresh save, before the first kill,
  applies at once.
- A hero is a template (class, name, portrait) times a rarity times rolled
  traits. Trait count by rarity: Common 0, Uncommon 1, Rare 2, Epic 3,
  Legendary 4. Level cap by rarity: 20, 30, 40, 45, 50.
- Hero names are the template name plus a generated epithet, never player
  typed.
- Stats: HP, attack, defence, speed. Growth per level by class table. A hero's
  rarity multiplies its template's base stats and per-level growth by the
  rarity's stat multiplier, the table items use (§4.4): 100, 110, 120, 135, 150
  percent. Traits apply to the pre-trait total; affixes add flat. XP from
  kills. A per-class resource (mana, stamina) is deferred until a skill system
  gives it a use.
- Actions: every class attacks. The Knight hits one enemy, the front one most
  often; the Black Mage hits every enemy at 60% attack; the Archer hits one
  enemy, the weakest most often, with a 20% chance of double damage; the White
  Mage attacks the weakest enemy or heals. Every damage and heal amount is
  doubled against the pre-gauge game, since a unit acts about once every two
  ticks. A heal restores 0.8 × attack to the living ally with the lowest HP
  share, capped at max HP, and never revives. Enemies attack a hero, a Knight
  most often.
- A weighted picker chooses each action and its target together: every
  (action, target) pair a unit could take gets a weight from rules about the
  battle, and one seeded draw picks a pair. The rules are content data per hero
  class and per enemy archetype (`packages/sim/src/content/tactics.ts`), so a
  later skill or technique is a new entry, not new code. Heal weighs nothing
  while every ally is at 50% HP or more and rises the lower the weakest falls
  (about 3 heals in 4 at 25%); a White Mage alone never heals.
- Acquisition: recruit contracts drop from zone bosses and, at a lower rate,
  turn bosses; a tavern recruits for gold at published odds. Roster cap 24,
  expandable with gold.
- Starting roster: one Common hero of each class. First launch auto-picks
  Knight, Black Mage and White Mage, and a toast points at the Heroes tab.

### 4.4 Items

- Three slots per hero: weapon, armour, accessory. Items are class-gated by
  base type.
- An item is a base type times a rarity times rolled affixes. Affix count by
  rarity: 0, 1, 2, 3, 4. Rarity also multiplies base stats: 100, 110, 120, 135,
  150 percent.
- Rarity tiers everywhere: Common, Uncommon, Rare, Epic, Legendary.
- An item stores its item tier, set when it drops: a base's minimum zone 1 to 3
  is tier 1, 4 to 6 tier 2, 7 to 9 tier 3, 10 to 12 tier 4, and every drop past
  the ladder's tier 1 is tier 5 (tier 2) or 6 (tier 3). An affix stores its flat
  roll, and the tier's multiplier scales it at read: ×1, ×2, ×3.5, ×6, ×10, ×16,
  in basis points, floored. The scaled value is what the affix counts for in
  stats and wherever the plugin shows it (the detail window, a listing), so
  stats still add flat and a deeper item beats a rarer shallow one.
- Inventory 30 slots, expandable with gold, and equipped items occupy slots. A
  drop into a full inventory is auto-vendored and the loot log says so.
- Reforge rerolls one affix for gold: the same flat range, the item's tier kept.
  The price is the rarity's price times the item tier's multiplier, floored,
  shown on the Reforge row of the Inventory command window before the pick.
- Auto-vendor: a per-account setting in the state beside the farm flag
  (`autoVendor`), off on every save, set by the player event `set_auto_vendor`.
  When on, a Common drop, or an Uncommon drop while the party's zone is past 3,
  is vendored on pickup unless a party hero has the item's slot empty and could
  wear it; a Rare or better never. The vendored effect carries its cause, a full
  inventory or the setting; the chest plays as for a full inventory and the loot
  log reads `Oak Staff vendored, 3G.`

### 4.5 Gold

Sources: kills, vendoring items, dismissing heroes. Sinks: reforge, tavern,
inventory and roster expansions, market listing fee, 5 percent market sale fee.

### 4.6 Boss mode (phase 3)

- The server event `boss_engaged` replaces the party's encounter with one enemy of
  kind `world_boss`, carrying the stats the event gives, scaled to the party's zone.
  It never dies locally; every hit adds to the state's damage dealt for that boss.
  `boss_disengaged` clears it and the next tick spawns the wave as usual.
- In boss mode tool calls spawn nothing, a wipe resets the battle like any wipe
  (every gauge empty, the action queue cleared) and heals the party in place with
  no retreat and no wipe counted, a rest heals as usual, and the boss grants no XP,
  gold or drops. Rewards come from the server (§6).

## 5. Economy and market (phase 2)

- Rare and above trade. Common and Uncommon vendor only.
- Heroes Rare and above trade. Level resets to 1 on transfer. A hero in the
  active party cannot be listed.
- No binding. An item or hero that changes hands cannot be relisted for 24
  hours.
- Fixed price listings, expiring after 7 days. Prices are integers from 1 to
  1,000,000 gold. Listing fee 2 percent of the asking price, minimum 1 gold,
  paid on listing and kept on cancel and expiry. Sale fee 5 percent of the
  price, `floor(price × 500 / 10000)`, on listings and on buy-order fills alike.
- A listing can be cancelled any time before it sells, market open or closed,
  and so can a buy order. A listed item or hero leaves the inventory or roster
  and frees its slot.
- Expiry and cancel return the item or hero. With no free slot it waits in
  returns and is delivered the moment a slot frees. Returns are never vendored;
  auto-vendoring is for drops only.
- Buy orders: base type, minimum rarity, at most one required affix, maximum
  price. Gold is escrowed when the order is placed. No auto-match: a seller sees
  matching orders in the sell flow and accepts one explicitly. An order expires
  after 7 days, fills exactly once and closes; cancel refunds the escrow in full.
- A purchase needs a free inventory slot (roster slot for a hero) and the gold,
  or it is refused. Buyer and seller are never the same account. A fill whose
  buyer has no free slot is refused as `buyer_full`, apart from a buyer's own
  `no_space`, and the order stays open.
- A hero is listed with no equipment: the dialog unequips into the inventory
  first and refuses when space is lacking. A transferred hero arrives at level
  1, 0 XP, full HP, same rarity and traits.
- Market events (sold, bought, returned) land in the loot log next to drops.
- Listings show the seller's name.
- Browsing is open to every account. Listing, buying and ordering need a linked
  GitHub account and `market.enabled`; the dialog says so in place.
- Published odds: an Odds screen in the dialog shows drop, rarity and tavern
  tables, at zone 12's rarity odds past tier 1, and says that rarity multiplies
  base stats, heroes and items alike, and that reforge is priced by rarity and
  tier.

## 6. Social (phase 3)

- World data (presence, the live world boss, the chat tail) is never sim state. A
  session reads it with the world poll, `GET /v1/world`, every 15 seconds on the
  flush cadence and every 5 seconds while a world boss is live or the Chat tab is
  open. The poll is the heartbeat. Nothing is pushed: there is no stream (§8).
- Presence: an account is online while its last heartbeat is inside a 45 second
  TTL. Its zone is the committed state's zone on the server, never a client claim.
  Presence is keyed by account, so a secondary session polling adds nothing. It
  lives in the ledger's memory on every host, the real server too; a restart
  loses it and the next polls rebuild it. The World tab shows the count online
  and the names in your zone; the Leaderboards pane shows the count per zone.
- Leaderboards: highest zone reached (all time, the running zone, read `T2 Z1`
  past 12) and world boss damage (weekly, reset Monday 00:00 UTC on the server
  clock). Both come from the ledger's own
  records, never from client claims, maintained incrementally at each commit and
  each contribution, 20 rows each, read on demand. Names are the display name,
  else `adventurer`; a name matching the blocklist shows as `adventurer`.
- Global chat: one channel. Posting needs a linked GitHub account and
  `chat.enabled`, 200 characters, a per-account token bucket on the server clock
  (capacity 5, one per 10 seconds), and a word blocklist that refuses the message
  instead of masking it. Any session of an account may post: chat needs no flush
  and no lease. The ledger keeps the last 200 messages and serves the last 50 to a
  poll with no chat mark, newer ones only after. Chat messages are not server
  events. Lives in the dialog's Chat tab; the band's World tab shows the latest
  message as a one-line ticker.
- World boss: spawns on the server clock's 3 hour grid, lives 20 minutes or until
  dead, visible to everyone online with a global HP bar. HP is a per-party base
  times the count online at spawn. Every online account enters boss mode (§4.6)
  through `boss_engaged`, an account that comes online during the window enters
  it on its first poll, and the server reads the damage dealt from each committed
  batch as the account's contribution. `boss_disengaged` ends boss mode when the
  boss dies or expires. Rewards are rolled server-side at the killing commit with
  the sim's loot tables at the contributor's zone: a guaranteed drop for any
  contribution at or above 5 percent of the base, one bonus roll each for the top
  3 contributors, all as `rewarded` server events, found in the next delivery by
  anyone offline. An expired boss pays the threshold drop and no bonus rolls.
  Goods with no free slot wait in returns, never vendored.
- Flags: one per feature, `chat.enabled`, `worldboss.enabled`, `presence.enabled`,
  `leaderboards.enabled`. The in-process fake runs with chat and the world boss
  off, said in place like a closed market.
- Moderation in phase 3: name and chat blocklists and the chat flag. Phase 5
  adds the ban and flag flips over the admin route (§8); there is no mute.

## 7. Simulation and authority

- Package `@promptfall/sim`, pure, versioned by `SIM_VERSION`. Any change to the
  sim bumps it, and the plugin's version moves with it; a state behind the
  client's sim version is reset (phase 3 bumps it to 3, the combat flow to 4,
  the staged-state set to 5). API: create an initial state from a seed, step a state with one
  event into a new state plus effects, hash a state. Effects are UI notifications
  and carry no authority.
- The client runs the sim locally for instant feedback, buffers the events it
  fed in, and sends them in batches every 15 seconds. A batch carries a client
  generated id (retries are no-ops on the server), a per-account sequence
  number, the sim version, the client version, the hash before and the hash
  after.
- The server replays the batch with the same sim. Rate caps are per-account
  token buckets on the server's own clock, one per event kind: rounds refill at
  one per 2 seconds, tool calls at one per second, rests and turn ends at one per
  5 seconds, each with a capacity worth about two minutes, so a gap never banks
  more than that and a burst of tiny batches cannot outrun the clock. A batch
  over any bucket is rejected whole. Every submission is authenticated by the
  device token and must name its own account. Client timestamps order events
  within a batch and nothing else.
- The sim's events are of two kinds. Player events originate on a client and
  travel in batches: combat, rests, equips, vendoring. Server events are
  authored only by the ledger: the effects of trades on an account's inventory,
  roster and gold (`listed`, `returned`, `sold`, `bought`, `order_placed`,
  `order_refunded`, `order_filled`, `order_sold`, `credited`) and the world boss
  (`boss_engaged`, `boss_disengaged`, `rewarded`).
  The sim applies a server event without judging it; one it cannot apply is a
  bug caught by the hash check, never a rejection. The batch schema accepts
  player events only.
- A batch declares the cursor of the last server event its client applied,
  and the server accepts it only when that is the account's latest: server
  events are applied the moment the ledger authors them, so every trade is
  validated against a state no later player event can undo. A batch behind the
  latest cursor is answered with the pending server events and resubmitted
  after the client applies them; one ahead of it gets the authoritative state
  back. `baseHash` is the hash at the last commit, `resultHash` the hash after
  the server events and the batch. Every authenticated response may carry the
  server events pending past the last commit, each numbered so a client applies
  it once. The client re-steps its buffered player events over server events as
  they arrive, so a locally seen spend can turn into a rejection when a trade
  drained the gold first: the server wins.
- A market action flushes the client's buffer and waits for the ack before the
  request, so the ledger validates against state at most one round trip old.
  Only the primary session trades.
- An item or hero that changes hands gets a ledger id in the ledger's own
  namespace and keeps it for life. Transferred items and heroes carry
  `tradeableAt`, listings and orders carry `expiresAt`, all server epoch
  milliseconds; the sim stores them and never compares them. The ledger
  enforces cooldowns and expiries on its own clock.
- On hash mismatch the server wins. Small drift is corrected silently; a revoked
  drop raises a toast; repeated revocations flag the account.
- Hard version gate: a client below the server's minimum version shows an update
  banner and the sim pauses. No multi-version replay on the server.
- Saves migrate (ADR 0013). The sim exports one `migrate` that walks a stored
  state from any version at or above 5 to the current one, one pure step per
  version, and refuses a version with no step (a gap) or one ahead. The ledger
  runs it the first time it loads a record whose committed state is behind:
  the committed snapshot walks the chain, the goods held outside the state (the
  log's server events and the returns) walk each step's goods rule, the
  effective state is rebuilt by replaying the log over the migrated snapshot,
  the committed hash is recomputed and the record is saved current. The market
  book's listings walk the goods rule once per bump, under the book's version
  mark. The client never migrates: it replays the same delivery over the same
  snapshot, and the in-process fake is the ledger, so the local and sandbox
  saves migrate by the same code, and a bot behind the version is migrated, not
  minted again. The ledger logs one line per migrated record and per refusal,
  with the account and the versions.
- A batch whose sim version is not the server's is refused with `sim_version`,
  and a client behind the server shows the update notice: the server is
  updated first, always. A record the chain refuses is answered as stored; the
  plugin raises the reset notice for it, and the player resets this machine's
  data from the Account tab. A state ahead of the client's sim version raises
  the update notice. Only the version-gate and sim-version acks pause a submit
  with the update notice. Every bump moves the plugin's version.
- Server unreachable: the banner shows at once; the sim keeps ticking and
  buffering for 2 minutes of wall clock from the first failure, then pauses;
  retries back off from 1 to 30 seconds with jitter; the first success flushes
  the buffer and clears the banner. A thrown submit is an outage, never a
  permanent pause.
- One primary session per account ticks, elected with a lease in the local
  store, so one machine plays an account at a time; the server lease is out
  until a number asks for it (§8). Other sessions show "playing in another
  session" and render read-only.
- A paused primary refuses trades, farm and the sandbox verbs with a reason of
  its own, shown as "Promptfall is paused", never as "playing in another
  session".

## 8. Server (phase 5)

The real server is the HTTP host of §9 on a SQLite store (ADR 0012,
`the-real-server-is-the-ledger-host-on-sqlite`): the same ledger, the same
routes and the same contract suite as the HTTP fake, started with production
flags. No second server program, no Postgres, no Redis, no worker.

- Store: a `KeyValue` over Node's built-in `node:sqlite`, one table of key and
  JSON value, WAL on, chosen with `--store sqlite:<path>`. `get`, `set` and
  `delete` work on a write buffer that reads see first; the ledger's `flush`
  commits the buffer as one transaction, so one ledger operation is one durable
  write and a crash never leaves half a trade on disk. The store carries the
  clock snapshot the file store carries.
- Process: `--host` binds the address (default `127.0.0.1`; the container
  passes `0.0.0.0`), `--speed 1` runs the real clock, `--link github` runs
  GitHub's device flow with the client id from `PROMPTFALL_GITHUB_CLIENT_ID`
  (§9), and `--bots <n>` runs the bots (6 for the soft wave, 0 at the public
  listing). Presence, the chat and boss memos and the mint cap live in process
  memory; a restart loses them and the next polls rebuild them.
- World poll: the snapshot's shared parts (presence counts and zones, the chat
  slice, the boss record) are memoised inside the ledger for one server-clock
  second and dropped sooner on a presence change or a write to their key;
  `here`, the caller's boss view and the engage write stay per poll, and every
  poll still stamps its heartbeat. The boss advance runs on the first poll of
  each second.
- Accounts: anonymous device accounts minted on first launch, one opaque
  random device token each. Linking runs GitHub's device flow and unlocks
  trading and chat; the server keeps the GitHub login and drops the access
  token. Bootstrap answers the bootstrap or `{refusal, message}` with `refusal`
  `rate_limited`, `banned` or `unknown`. Only a bootstrap with a null token
  mints; one with a token the ledger does not know is refused as `unknown` and
  mints nothing. The HTTP layer caps minting (a bootstrap with a null token) at
  five an hour per client address, the last hop of `x-forwarded-for` behind
  Caddy; any other token passes the cap and the ledger stays address-blind.
- Flags: `chat.enabled`, `market.enabled`, `worldboss.enabled`,
  `presence.enabled`, `leaderboards.enabled`, `maintenance`. The start flags
  come from `--flag`; a flag set over the admin route is stored under
  `pf:flags`, loaded at start over the start flags, and in force from the next
  call. The version floor is not a flag: the bootstrap's config carries the
  protocol's `MIN_CLIENT_VERSION`, the launch version 0.3.0, and a batch from
  an older plugin answers `version_gate`.
- Admin: with `PROMPTFALL_ADMIN_TOKEN` in the environment, three routes take
  it as a bearer. `POST /v1/admin/flags` sets flags (`sandbox.enabled` is
  refused); `POST /v1/admin/ban` stores a record-only `banned: {reason, at}`,
  after which every authenticated call of that account but its delete answers
  `banned` with the reason, and the plugin pauses with it. A ban on a linked
  account also records its GitHub login, lowercased, under `pf:ban:<login>`
  with the first ban's reason and every banned account that carried the login
  (linking never made a login unique). Link approval refuses a recorded login:
  the poll that would attach it ends `denied` with the ban's message, and the
  account stays unlinked and unbanned. An account that never linked is banned
  by id alone. `POST /v1/admin/unban` with `{login}`, in any case, removes the
  login's record and lifts the ban of each account it names that still
  exists; it answers `{login, lifted}`, or 404 for a login never recorded.
  There is no unban by account id. Each admin call writes one log line with
  its time, target and outcome, never the token. Without the token the host
  has no admin routes. No mute, no item revoke, no audit table, no admin CLI.
- Account delete: `DELETE /v1/account` closes the caller's listings and buy
  orders with nothing returned or refunded, takes it off both boards and
  presence, and deletes its record and token. Nothing else is settled: a
  counterparty, the boss record and the chat history are untouched. Delete is
  the one authenticated call a ban lets through, so a banned player may
  leave; the login's ban stays behind it.
- Logs: one access line per request on stdout (method, path, status,
  milliseconds; no header, address, token or body), the admin lines and the
  backup lines. `docker compose logs` is the log.
- Backups: with `--backup-dir`, the host writes a consistent copy of the
  SQLite file with the online backup API daily at 03:00 UTC, on SIGUSR1 and on
  SIGTERM, keeping the newest seven. `deploy/backup.sh`, from the box's cron,
  asks for a copy over SIGUSR1 and ships it gzipped to Cloudflare R2, thirty
  days kept; the restore is in `deploy/README.md`.
- Infra: one image, Node LTS and the server bundled to one file
  (`pnpm build:server`), running as a non-root user, built by CI for arm64 and
  amd64 and pushed to GHCR on a `v*` tag. On the box it is the compose project
  `~/apps/promptfall`: one service `promptfall` on 7777, `mem_limit` 512m,
  `restart: unless-stopped`, the `web` network, a healthcheck on `/v1/health`,
  the store and the backups on named volumes. Caddy's site block for
  `promptfall.kevinshibuya.com` holds TLS and proxies to the container;
  nothing listens on the host. `deploy/deploy.sh` and `rollback.sh` run from
  the laptop over ssh; `deploy/smoke.sh` checks the image in CI and the public
  server after a deploy.
- Out until a measured number asks for it: the long-poll event stream, a
  worker, Redis, Postgres and the server lease.

## 9. Fake servers and the contract suite

- `@promptfall/ledger` is the server core: account records, batch replay and
  the market rules as pure functions over an injected clock and key-value
  store, with expiries enforced on every market call and swept by the host. A
  read can leave expiries and the world boss alone: a secondary session's reads
  of the in-process store do, so only the primary writes it.
  Two programs host it: the in-process fake inside the plugin, and the HTTP
  host in `servers/fake`, which is the HTTP fake on a laptop and, with the
  production flags, the real server on the box (§8). A host adds transport,
  persistence and, for the HTTP host, bots; it never adds rules.
- Phase 1: an in-process fake inside the plugin, no infrastructure, persisting
  through the local store. It replays batches like the real server does, so the
  client already sends inputs and reconciles hashes. It is the `local` server:
  `/promptfall server local` and the sandbox choose it, and it plays with
  nothing running. It is not the default: a fresh install, with no server
  setting, plays on the public server, whose URL is a constant in the plugin.
- Phase 2 on: the HTTP fake at `servers/fake`, a separate local Node process in
  the monorepo on `node:http`, speaking the real HTTP protocol with the shared
  schemas, persisting a JSON snapshot after every mutation, or a SQLite file
  with `--store sqlite:<path>` (§8). Flags: `--host`, `--port`, `--seed`,
  `--speed`, `--player-name`, `--data`, `--store`, `--bots`, `--backup-dir`,
  `--boss-in`. `--speed` scales the bots'
  cadence and the ledger's clock together, so cooldowns and expiries can be
  watched. `--flag <name>=<value>`, repeatable, sets a flag at start; after
  that a flag changes over the admin route (§8). `--link github|fake` picks who approves a link. Under
  `fake`, the default, the first poll approves with `--player-name` as the
  login, 1 to 64 characters as the wire takes a login: anything else exits at
  startup with the reason, and the ledger's mint holds names to the same
  bound. Under `github` the link start answers GitHub's device flow (its user
  code, verification URL and poll interval) for the OAuth app whose client id
  is in `PROMPTFALL_GITHUB_CLIENT_ID`; the device code stays in the link
  record, a poll exchanges it for a token, reads the login and drops the
  token, so the ledger stores the login only. The GitHub round trips run
  outside the ledger's mutex. A decline, an expired code or a GitHub call
  that does not answer within 10 s ends the link unlinked with a message
  (`{status: 'ended', reason, message}`); a `github` host without a client
  id answers every link start `{refusal: 'link_unavailable', message}`.
- Bots: `--bots <n>` seeded accounts (12 by default) with names from a fixed
  list prefixed `[bot] `, inventories and rosters rolled from the sim's own
  loot tables, a gold stipend per tick so they never run dry. From phase 3 a bot is an HTTP client
  of the fake's own port: each tick it submits a batch of ticks at an idle
  player's pace, then lists, buys, fills a buy order, places or cancels an
  order, or posts a chat line from a fixed list, through the same routes as a
  player. Minting and the stipend are the only in-process calls. Bots advance
  through zones, show in presence and fight the world boss through their
  batches, never a back door. A bot is minted with a mark on its record (never
  on the wire) and the boards skip marked accounts, so a bot holds no rank.
  Their numbers live in one config file and are tuning, not contract. On the
  real server they stock the soft wave's market (6), and the public listing
  runs none; on a laptop they are the load generator.
- `/promptfall server <url>` points a session at an HTTP server,
  `/promptfall server local` at the in-process fake, and no setting at all
  means the public server. One device token per
  server; switching re-bootstraps and adopts that server's state. Nothing moves
  between servers, ever.
- The sandbox (ADR `sandbox-grants-are-server-events`, "The sandbox hands things
  out as server events"). The ledger flag `sandbox.enabled`, default off, gates
  three host calls that answer a typed outcome, never a throw:
  `sandbox(accountId, event)` authors a sandbox server event into the account's
  log in cursor position, `spawnBoss()` opens a world boss whose window starts
  now and engages every online account, and `settleBoss()` settles the open boss
  as if its window had passed, paying every engaged account as if each had
  reached the reward threshold. With the flag off each answers `sandbox_off`.
  The switch is `PROMPTFALL_SANDBOX=1` in Claude Code's environment, read at session
  start: the plugin then plays the in-process fake with `sandbox.enabled`
  and `worldboss.enabled` on and chat off, ignores a stored server URL
  (`/promptfall server` answers that the sandbox pins the server), and registers
  `/promptfall sandbox <verb>`. Without it the verb is not registered, and typing
  it answers that the sandbox is off and how to turn it on. The verbs: `boss
  <name>` (`sandbox_boss`: the party moves to the boss's zone, the encounter ends,
  the next empty tick spawns the zone or turn boss), `worldboss` and `worldboss
  end` (`spawnBoss` and `settleBoss`, then one world poll so the "appeared" or
  "down" toast fires inside the command), `item <base> [rarity]`
  (`sandbox_item`: the sim's roll through the drop intake, vendored when the
  inventory is full or the auto-vendor setting sells it), `level <hero> <n>`
  (`sandbox_level`: XP level by level, up to the rarity cap), `gold <n>`
  (`credited` with reason `sandbox`), `zone <n>` (`sandbox_zone`: wave 1, any
  zone up to the ladder's end, 36), `recruit [rarity]` (`sandbox_recruit`,
  refused on a full roster), `wipe` (`sandbox_wipe`: the wipe path, so the third
  in a zone retreats) and `reset` (the account reset). Rarity defaults to
  common; names match by case-insensitive prefix of
  the display name, a word in it or the id. `boss`, `zone` and `wipe` are
  unapplicable in boss mode. Each verb syncs after the host call, so the grant is
  in the view before the reply. The sandbox save is separate: its books, device
  token and lease live under the store prefix `promptfall-sandbox:`, the settings
  stay shared, and its link approver always answers no. The grid keeps running
  beside the sandbox bosses, which take their own id space. The HTTP fake
  accepts `--flag sandbox.enabled=true` by name and has no sandbox route, so
  nothing over HTTP can author a grant. The real server never sets the flag and
  refuses every sandbox call.
- With no event stream (§8 leaves it out), server events ride on responses: the
  batch ack and the market responses carry what is pending past the client's
  cursor, and the dialog refreshes when opened. The cursor is explicit in the
  protocol so the stream is an addition, not a change. World data (§6) is never a
  server event; it is read with the world poll from phase 3 on.
- `HttpClient` in `@promptfall/protocol` implements `ServerClient` over an
  injected fetch: `$.http.fetch` in the plugin, the global in tests.
- One contract test suite in `@promptfall/protocol` runs over three wirings:
  the ledger in process, the HTTP host over the JSON file, and the HTTP host
  over a SQLite file, which is the real server's suite. Trade cases run two accounts against
  one host. World cases drive the host's clock: presence stamps and expires,
  chat gates and limits, the boss spawns on the grid, a committed batch in boss
  mode adds contribution, the killing commit authors the rewards, flags off
  answer the closed refusals.

## 10. Client structure

- Band tabs on letter hotkeys: `p` Party, `l` Loot log, `w` World, drawn as
  the message window's command line (`▶Party Loot World ▾`). `c` collapses, `f`
  toggles farm. Hotkeys fire only while the band holds the keyboard (ctrl+x tab
  or a click). On terminals and the desktop their Buttons sit out of view in a
  zero-width Box; VS Code and mobile show them as a row under the strip.
- Party tab (phase 4): the stage, 17 rows in every fight (ADR 0010), the
  encounter's enemies on the left and the party on the right, side-on, small
  against the zone's backdrop painting, bottom-anchored and centred (ADR 0009),
  so a zone or world boss lands at its full size; the compact stage and a zone
  with no painting stand on a one-row ground strip coloured per zone. Under it
  the window strip (ADR 0005), Dragon Quest V's
  windows in its pixel font: the enemy window (titled with the zone and wave,
  `T2 Z1 · Wave 3` past tier 1, one row per enemy with an HP bar, a
  boss with its percentage), the message window (the command line, then the
  combat log), the party window (each hero's
  name and level with ▶ while it acts, HP with a bar, and an action gauge that
  fills between ticks and turns gold when full) and the purse window (gold and
  the tactics, Push on or Farm here). A hero's text turns orange under 25% HP
  and red at 0. Loot and World are the strip alone: the message window shows
  the last two drops, or the World rows. Hidden while `hasSurvey`. The band is
  22 rows and never changes height for a fight.
- The band as one picture (ADR 0011): a playfield on a shell. The shell is the
  windows' charcoal, flat, with no decoration, and fills every cell of the
  band's box that the playfield does not cover: the side margins past 160
  columns and any rows the layout leaves. The playfield is `min(columns, 160)`
  wide, every row of the band, centred: on Party the stage with the strip
  beneath it, the stage's bottom edge on the windows' top lines with no shell
  between; on Loot and World the strip alone, at the same width and centre.
  One line goes around it, the strip windows' white line with cut corners. On
  a band wider than the playfield the line sits in the shell's margin; where
  the playfield meets the band's edge it sits over the stage's outermost pixel
  row and column and over the strip's own outer line, so it costs no stage row
  or column (ADR 0010). The strip's windows keep their own lines inside it.
  The terminal never shows through the band, except past the Image's 255
  columns and on the one-line summary.
- Band renderers. Kitty, Ghostty and cmux draw the band as one Image, keyed by
  its cells so that only a resize mounts a new one: a PNG on the windows' grid,
  8 × 16 pixels a cell, the 1.5x stage drawn into it nearest-neighbour at 16/3
  pixels an art pixel and the strip's windows at their own 1x art. The host's
  Image takes at most 255 columns: past that the shell stops, centred, and the
  terminal shows beyond it. At 255 columns and 22 rows the PNG is 2040 × 352.
  Every other terminal draws one Raster of the same placement in cells, up to
  512 columns: the stage in half-blocks, the strip and the line in box-drawing
  text, each window's side joining the line. The Raster's line takes the
  margin only when the margin is two cells or more a side, so 160 to 163
  columns draw like 160, and over the stage's top row it opens where an actor's
  art reaches it, so a boss keeps its head. Ghostty and cmux fit the Image to
  its cell box keeping its aspect, centred; their cells are a little taller
  than 8 × 16, so a thin strip of terminal shows above and below the picture
  (checked on Ghostty 1.3.1 and cmux 0.64.25). The desktop, VS Code and mobile draw two Svgs, the
  stage's and the strip's, since one Svg of both would pass the
  131,072-character cap. Each is the band's width and draws its share of the
  shell (a rect behind its art) and the line (a path over it): the stage's the
  top and sides, the strip's the sides and the bottom, so stacked they read as
  one picture; on Loot and World the strip's Svg draws the whole line. One art
  geometry for all, in cells on terminals and scaled on the Svg surfaces (ADR
  0004). While the renderer probe is pending the band lays out with the
  verdict the last session recorded, the half-block rules before any, its
  rows empty. Every Image and Svg has an alt that carries its text.
- Band layouts on terminals. Full: 116 columns or more and 22 rows, the
  17-row stage over the 5-row strip. A band with fewer rows keeps the
  playfield's width: the Image zooms the whole scene out into the rows left,
  widened so it still spans the playfield, down to 4 rows, the 5 strip rows
  under it; the
  Raster keeps its art size and shows the stage's bottom rows, the sky cut,
  down to the tallest actor on it (8 rows for the party, 12 with a turn boss,
  17 with a zone or world boss, held through a departed boss's dissolve)
  (ADR 0010). Compact, when the full band does
  not fit or `bodyColumns` is 100 to 115: one 6-row picture, the 4-row stage
  (sprites downsampled) beside one party window (three hero rows, the front
  enemy, the command line in its border), the window on the right with its
  own top, bottom and right lines serving as the line's, so its title and
  command line stay. The collapsed summary, one line of text with no shell,
  when `bodyColumns` is under 100 or `maxRows` is under 6. Loot and World are
  5 rows. On the Svg surfaces: always the full stage, the art
  `clamp(bodyColumns, 116, 160)` pixels wide scaled to the band's width,
  17 rows whatever `maxRows` says, scaled down where it would pass the rows the surface shows whole once the
  strip and the hotkey row are counted (the desktop scrolls the rest), and
  then centred on the shell; the band collapses only by hand or as a
  secondary.
- Stage motion (phase 4, spec #72): idle bob, the step, attack lunge (heroes
  switch to a drawn attack or cast pose), hit flash, death dissolve, spawn
  fade-in, floating damage numbers, and the chest. Every attacker, hero or
  monster of any size, steps a fixed distance forward (a hero toward the
  enemies, a monster toward the party) in its wind-up hold and back in its action's tail, so the step costs no time; the lunge
  thrusts from the stepped position. A kill that drops an item leaves a chest:
  it falls out of the fading enemy, sits, opens, and the item rises on a glow
  in its rarity colour (the reveal), held longer the rarer the item, then
  fades; the next enemy enters after it. A line or toast about an event the
  stage plays is a **held line**: it lands at the event's **show time**, the
  moment the stage plays it, not before; an event the stage never plays, or
  plays while no band is drawn, has no show time and its words land with the
  state (GLOSSARY). A drop's show time is its reveal, the item fully risen:
  the drop's log line, its Loot row, its toast and its cue all land then. A
  zone arrival's show time is the backdrop change, when the zone boss's row
  has left (its dissolve and any chest over, the moment the staged state's zone
  flips): the arrival's log line and its toast land then. The timeline answers
  it as the kill's effects arrive, before any draw has departed the boss, as a
  prediction (the end of the blow shown on the boss plus the dissolve, or its
  chest's end, whichever is later), and refines it as the draws schedule and
  re-time those motions. The boss's drop reveals before its row leaves, so its
  words land first and the zone's after. The farming line ("Zone N cleared.")
  is not held.
  While a stage is drawn the log holds the held toasts and drains them on the
  stage loop's clock: on a frame loop at the first frame at or after the show
  time, on the desktop's SMIL site at a wake armed for it, and on every
  session tick, before the engine's accept check. SMIL plays the actors and the
  chest but not the backdrop, so a wake that releases a toast also redraws the
  band, and the zone's words land with its backdrop. A held entry whose show
  time the timeline stops answering (a resync revived the enemy, so the chest
  is gone) is due at once. With no stage drawn on any
  surface (band off, collapsed, paused, secondary) everything held is due, so a
  toast held before the band went off is raised on the next tick. Driven by the sim's
  output-only effects: `act` starts an action at its battle-time offset, then
  come its `hit` and `heal` effects. One action plays at a time: the actor
  lunges once and all of its hits land at one impact (the Black Mage's spell
  hits every enemy at once); a heal shows a green rising number and no flash.
  Action starts stretch to the cadence and never overlap, across ticks too.
  About 12 frames a second during an event, 4 while only gauges fill, the idle
  bob at 2, nothing while the band is hidden or collapsed. On terminals the
  loop draws the band's picture, the stage frame with the current strip, so a
  change in the strip alone (a log line typing out, a gauge filling) redraws
  it; on Loot and World it draws the strip alone. The combat log types out each action's line
  as the stage plays it, in Dragon Quest's words ("Aldric hits Wood Goblin for
  12.", "Wood Goblin is defeated!"), whole lines under Motion still; hit lines
  more than a tick behind are dropped, never kills, drops, level-ups, deaths or
  sales. A drop's line is held until its reveal's show time, and a zone
  arrival's until the backdrop change; each then queues as if it had just
  arrived, so it never delays the lines after it. The desktop
  redraws once a tick with the tick's motion as SMIL, the action gauges and
  the HP bars both keyed from the tick's landings, so a bar drops at its hit's
  impact without a redraw. A monster that enters mid-tick plays its first
  actions animated on every surface. Account setting "Motion: full / still",
  default full; still drops the idle bob.
- The staged state: what the band shows during a fight is the **staged
  state**, the fight as the stage has played it so far: the sim's state less
  every hit, heal and death the stage has not landed yet (GLOSSARY). One
  producer (`stage/staged.ts`) builds it from the view and the stage's
  timeline, in the view's shape, and is the only reader of the timeline's
  landings. A hero's HP is the view's less the landings still pending for him,
  and he stands, lunges and flashes while that HP is above zero, even when the
  view says he is dead. A change the state makes without a blow (a wipe's
  heal, a wave clear's revive, a rest) is a landing too, landing once the
  stage has let the tick go: the action under way over and every row the tick
  took off the field faded and dropped. So a wiped hero falls on his blow and
  stands up at full only after the field has cleared. The enemies are the
  timeline's line in arrival order, a departed one kept with its row until it
  has faded, a killed one at 0 and one cleared alive at its last HP, each with
  its HP staged the same way. A departed enemy fades after the last action
  shown on it, its own blow included. The encounter's zone, wave and title stay on the wave
  or zone a held enemy was seen in, and newcomers stay out until the timeline
  admits them, so the next wave enters after the last of the previous one has
  gone, and the backdrop changes zone when the zone boss's row leaves. The
  stage (and its alt text), the enemy window, the party window, the strip's
  titles, the compact window and its front enemy, and the world boss bar on
  every tab read the staged state. The sim, the server and the pane read the
  state. The toasts read the state, except those with a show time, which land
  when the stage plays their event; the wipe and retreat toasts may lead the
  last hero's fall by at most one cadence. The strip's hero HP trails the state
  and never leads it.
- World tab rows (phase 3), in the message window: the count online and the
  names in your zone, you excluded; then the latest chat message as a ticker,
  or highest zone, kills and wipes when chat is closed or quiet, ending in
  `world boss is off` when the server's flag has the boss off and the row has
  room for it. The world boss shows in the enemy window instead.
- World boss display (phase 3): in boss mode the enemy window shows the boss
  with the global HP bar and its percentage, its title the time left, on every
  tab. Under 116 columns, where the Party tab is the compact window and has no
  enemy window, the compact window's title carries `World boss` and the time
  left in the wave's place. Between polls the bar shows the last polled HP less
  the damage this party has landed since the poll's baseline, so it drops as
  the stage lands the party's hits; damage still in the air is subtracted from
  a fresh poll too. A bar this party has emptied holds at zero, the boss
  standing, until the server disengages it; it dissolves then. No other
  surface.
- World poll failures (phase 3): a thrown poll is ignored and the World tab dims
  as stale after 45 seconds without a fresh snapshot; only a thrown submit or
  bootstrap is an outage. Chat posting during an outage answers the unreachable
  text like a trade.
- Dialog via `/promptfall [tab]`: Inventory, Heroes, Account, Odds in phase 1;
  Market and Orders in phase 2; Chat and Leaderboards in phase 3. Opened with
  focus, closes on Escape, holds toasts.
- All eight tabs draw as Dragon Quest V windows (UI PR 2 and 3, ADR 0005): a tab
  window, a list window with a ▶ cursor, a detail window beside it from 96
  columns (under it below that), command, pick and form windows, a Yes/No, and a
  message window. The picture takes at most 24 rows and 120 columns, centred on
  a wider pane. A short pane drops the tab window and keeps its hotkeys, so an
  inline pane of 14 rows still draws every tab; under 40 columns, or with fewer
  rows than that, only the message window shows, asking for more room. Keys: Tab
  or the arrows move the ▶, Enter runs the row under it (or opens its command
  window), `q` backs out of a sub-window, Escape closes the pane, and each
  item's letter (drawn gold) runs it. Vendor, Dismiss, Buy, the two cancels and
  Reset ask Yes or No first. Long lists page with a `16-30/40` footer and a ▼
  while more follow. The typed fields (the sell price, the order price, the
  chat line) and the GitHub link sit under the picture, one at a time. The
  desktop, VS Code and mobile add a `▲ ▼ ok back` row under the picture: their
  focus ring moves without telling the plugin.
- Chat tab (`c`): one row per message, newest at the bottom, the ▶ message whole
  in the detail window. The ▶ follows new messages until moved. Up pages back
  through the 200 messages the client holds. Enter on a row puts the cursor in
  the compose field, which is not focused when the tab opens; Enter there posts
  and Tab leaves it. The gate is said in the message window (unlinked, chat
  off), a refusal flashes for 5 seconds naming the rule, and mobile is
  read-only. Any session may post. Leaderboards tab (`b`): highest zone and boss
  damage this week under their headings, 20 rows each, your rows in gold,
  fetched on open, with who is online by zone in the detail window; a closed
  state is said in place.
- Market tab: a `Filters` row (`f`) opens a filter window for kind (items or
  heroes), sort (cheapest or newest), base type or class and minimum rarity;
  the last two open pick windows. Ten listings a page with `Previous page` and
  `Next page` rows; Enter on a listing asks Yes or No to buy it, and your own
  listings read `yours`. Orders tab: the count waiting in returns, my listings
  and my buy orders under their headings (Enter asks to cancel one, naming what
  happens to the fee or the held gold), then `New buy order`, which opens a
  form window in the detail window's place with base, rarity and affix picks,
  the price field and `Place order`. Selling starts from the Inventory and
  Heroes command windows: a sell window takes the detail window's place,
  matching buy orders first (each with the net), then Set a price, which
  focuses the price field; the message window shows the fee and net for a
  typed price. Mobile has no field and lists preset prices. Market and Orders
  are always listed; a closed market or an unlinked account is said in the
  message window, with a hotkey to the Account tab.
- Account tab: the settings as rows (`s` sound, `n` motion, `x` renderer, and
  "Auto-vendor: off / on", which sends `set_auto_vendor` and is the account's,
  not the machine's: a secondary session shows it read-only), the band shown or
  collapsed, band off, link GitHub (the device flow: a code in
  the detail window, the URL as a link under the picture, a poll), and a reset
  of this machine's data, which asks Yes or No and opens on No. The detail
  window holds the server, the client, the mode and the session. Before a game
  view exists the pane says Promptfall has not started, and Account still
  offers the reset.
- `/promptfall off` switches the band off for the session. `/promptfall farm`
  toggles the farm flag. `/promptfall autovendor on|off` sets the auto-vendor
  setting. `/promptfall server <url>|local` picks the server.
- Toasts: one sentence in the game's voice for an event worth a glance away
  from Claude's work: rare good news, a state that wants a decision, or money
  that moved. The table below says which events toast and how each reads, and
  `hooks/toasts.ts` mirrors it row for row, in its order, which is also the
  stacking order within a burst. The short tier lasts 4 000 ms (the host's
  default, passed explicitly), the long tier 8 000 ms.

| event | purpose | tier | toast | folded (same kind, one burst) | cue |
|---|---|---|---|---|---|
| legendary drop | rare good news | long | `Legendary drop: Ironwood Staff`, at the reveal | never folds | legendary |
| recruit | rare good news | long | `Rare recruit: Mira the Bold` (rarity word from the hero) | never folds | none |
| boss reward | rare good news | long | `Your share of Gorvax: 120 gold and Ironwood Staff` (gold alone, or the hero's name for a hero; `the world boss` when the boss's name is not known) | never folds | none |
| retreat | wants a decision | long | `The party retreats to zone 3, Marsh of Sighs` | never folds | none |
| world boss appeared | rare good news | long | `World boss Gorvax has appeared` | n/a (one at a time) | boss |
| revoked | wants a decision | long | `The server revoked Ironwood Staff`, or `The server revoked an item` when the name is gone | `The server revoked 3 items` | none |
| wipe | wants a decision | short | `The party fell, back to wave 1 of zone 4, Old Barrow Hills` | never folds | none |
| zone arrival | wants a decision | short | `The party reached zone 4, Old Barrow Hills`, at the backdrop change | never folds | none |
| rare / epic drop | rare good news | short | `Rare drop: Ironwood Staff` / `Epic drop: …`, at the reveal; epic before rare in one burst | never folds | drop |
| vendored, Rare or better | wants a decision | short | `Inventory full: Ironwood Staff vendored for 40 gold`, at the reveal | never folds | none |
| level up | rare good news | short | `Aldric reached level 5` | `Aldric reached level 6, Morwen level 4`; same level: `Aldric and Morwen reached level 6`; one hero several levels in a burst: the highest only | level_up |
| sold | money moved | short | `Ironwood Staff sold for 120 gold` | `3 items sold for 410 gold` | none |
| bought | money moved | short | `Ironwood Staff bought for 120 gold` | `2 items bought for 300 gold` | none |
| returned | money moved | short | `Ironwood Staff returned, unsold` | `3 items returned, unsold` | none |
| world boss down | rare good news | short | `World boss Gorvax is down` | n/a | none |

  Two toasts sit outside the table, raised by the session rather than from a
  burst. The welcome: a first launch toasts `Welcome to Promptfall. /promptfall
  heroes to meet your party` at the host's default length, and the band holds
  it as a notice for 20 seconds. A boss already up at the first world poll
  toasts the world boss appeared row's text and tier with no cue: the boss is
  news, not a fight starting.

  The toasts read the state, not the staged state, except the drop, vendored
  and zone arrival rows, which are held lines. A drop or vendored toast lands
  at its reveal's show time, with its log line and its Loot row, and its cue
  plays then; a zone arrival lands at the backdrop change, when the zone boss's
  row has left, with its log line, after the boss's drop. A drop whose item has
  no chest on the stage, a zone arrival with no zone boss row on the stage, or
  either while no stage is drawn, toasts with its burst. The wipe and retreat
  toasts may lead the last hero's fall on the stage by at most one cadence: the
  tick that wipes the party toasts as it lands, while the stage plays that
  tick's blows over the cadence that follows.

  Never toasts: hits, heals, actions, waves cleared, gold ticks, a zone boss or
  turn boss appearing (the stage shows it), a hero falling mid-fight (the stage
  and the log show it), a party change the player made, a farming clear, a
  common or uncommon drop, a common item vendored, chat.

  Rules behind the rows:

  - Subject first. The rarity word leads when the rarity is the news (drops,
    recruits). No glyphs, no parentheticals, no exclamation marks, no
    plugin-name prefix in the text (the host adds its own).
  - "gold" is spelled out in toasts. A hero is named by its full name with the
    epithet, looked up in the roster by id; a hero the roster does not hold
    reads "A hero". A traded hero reads its template name, since a trade entry
    carries no epithet. A reward whose boss name is not known reads
    "Your share of the world boss: …".
  - Items are named by their base name.
  - A zone arrival toasts only when the party advances to a higher zone; the
    zone's name follows its number with no article ("zone 4, Old Barrow
    Hills", since zone 12 is "The Unwritten Reach"), and a zone with no name
    reads "The party reached zone N". Past tier 1 the tier leads: "tier 2,
    zone 1, Greenmeadow Road". The wipe, retreat and arrival rows, the log
    and the Odds tab's title name a zone this one way; the enemy window's
    title, with 21 cells, takes the short `T2 Z1` the boards use
    (`hooks/zone-words.ts`).
  - The combat log says "The party fell." for a wipe and "The party retreats
    to zone 3." for a retreat.
  - The vendored row fires only for Rare or better: a full inventory vendors
    every drop, and the loss of something worth keeping is the signal.
  - The combat log uses the same nouns and verbs for the same events, with "G"
    for gold and its own punctuation, and does not name the boss in a reward.

  Bursts. A burst is what the engine's effects callback receives in one call: a
  tick's effects, or one delivery's. Folding is computed per call, over the
  toasts the burst raises at once. A held toast leaves its burst: it is raised
  at its show time, its lifetime starting there, and its cue plays when it is
  raised; toasts released by one drain play each distinct cue once, after
  them. Nothing else is held across calls, and the only timer is the stage
  loop's own wake for the next show time. Toasts of one burst are raised in
  the table's order, so the long tier lands on top of the stack. Cues keep
  their rule: the burst's distinct cues, each played once, after the toasts.
  Only the primary session toasts, the world boss included. The primary
  records in the shared store the cursor it has shown events through; a
  session's bootstrap, a promotion included, hands on only the events past
  it, so a handover neither repeats what was toasted nor silences what nobody
  saw.

  Folding. Within a burst, effects are grouped by row. A row that folds yields
  one toast carrying the count and, where the row has one, the sum; a row that
  never folds yields one toast per effect. A toast with a show time never
  folds: each lands at its own show time. A folded name list shows up to three
  names, then "and N more". A folded level-up joins its heroes with "and" only
  when every hero reached the same level; otherwise it has one clause per hero,
  in effect order.

- Sound (phase 4): off by default, a per-machine toggle in Account and
  `/promptfall sound on|off`, fixed gain. Four cues, each with a toast: drop
  (Rare, Epic), legendary drop, level up, world boss appeared. Only the primary
  session plays them; `/promptfall off` hides the band, not the cues.
- Item sprites (phase 4): 16 px icons in the Inventory and Heroes list
  windows and the Market's on Image and Svg, none on half-block terminals (the
  raster windows leave the two cells blank).

## 11. Art (phase 4)

Style reference is early Final Fantasy; its own sprites and signature designs
are excluded (no black mage with a shadowed face and glowing eyes under a wide
brim, no white mage with red triangle trim, no archer in a green pointed cap).

- Heroes, monsters and items in the NES style. A sprite may use 16 colours: its
  1.5× art, for the stage on Image and Svg, fits 24 × 24 with at most 16
  colours from a shared 128-colour master; its 1× art, for the Raster, the
  compact stage and the list windows, fits 16 × 16 with at most 4 colours from
  the NES master palette, the black outline included. One sprite per hero
  class plus an attack or cast pose; one palette slot takes the hero's rarity
  colour (Common grey, Uncommon green, Rare blue, Epic magenta, Legendary gold).
- Zone, turn and world bosses in the SNES style, each its own art: up to 48 ×
  34, turn bosses about two-thirds of that, at most 16 colours each from one
  shared 64-colour master palette.
- Made with gpt-image-2 through codex-image, one sheet per zone, every sheet
  generated against a style sheet Kevin approved first; the build slices and
  palette-locks them and fails a sprite that breaks a palette rule. The four
  heroes and four world bosses get a hand cleanup in Aseprite or Pixelorama.
  Nothing third-party ships. Cues are four clips from Juhani Junkala's CC0 "512
  Sound Effects (8-bit style)".
- Source PNGs live in an `art/` folder; a build step turns them into a committed,
  generated module of indexed sprites (CI fails when stale). The mod reads no
  files for sprites; cues are plugin files the engine plays.

## 12. Phases

1. Solo loop: monorepo, sim, protocol, plugin with band and dialog, in-process
   fake, balance harness, determinism tests.
2. Market, buy orders, hero trading, against the HTTP fake with bots. Two PRs:
   the ledger, server events, `HttpClient`, the HTTP fake and the outage rules
   first, with the contract suite green against both fakes; the market second.
3. Presence, chat, leaderboards, world bosses, against the same fake. Two PRs:
   social first (presence, chat, leaderboards, flags, bots as HTTP clients that
   batch, fill and chat, the World, Chat and Leaderboards tabs), no sim change;
   the world boss second (`SIM_VERSION` 3 with boss mode, the boss record,
   contribution and rewards, bots fighting, the boss display and toasts).
4. Sprites and sound. Two PRs: the engine first (the pixel-detection, Ghostty
   scaling and desktop SMIL spikes, the sprite pipeline, the three renderers,
   the stage with grow, compact and collapse, the motion set, the sim's
   output-only `hit` effect, cues, the motion toggle, item icons) on concept
   sprites; the art second (the style sheet gate, then every sprite zone by
   zone, and the cue clips).
5. The soft launch (ADR 0012): the HTTP host becomes the real server on a
   SQLite store, with GitHub's device flow, bots marked and off the boards,
   admin routes for flags and bans, the mint cap per address and the account
   delete; one image built by CI, deployed to the shared box behind Caddy with
   nightly backups to R2; the contract suite green over SQLite. The plugin
   plays on the public server by default and `local` offline, at the launch
   version 0.3.0. A soft wave of invited players first, then the public
   listing.

Each phase gets its own implementation plan when its turn comes.

## 13. Tooling and repository

- pnpm workspaces, TypeScript everywhere, tsup to bundle `@promptfall/sim`,
  `@promptfall/protocol`, `@promptfall/ledger` (the in-process ledger) and the
  zlib part of `fflate` (the stage's PNG frames) into `hooks/vendor/` (bundles
  committed so the plugin installs from git without a build; CI fails when they
  are stale), vitest for
  packages and servers, the official plugin test runner for the mod, Biome for
  lint and format.
- Generated files are committed and CI regenerates each one, failing on a
  diff: the vendored bundles (`vendor:check`), the sprites (`sprites:check`),
  the font glyphs (`font:check`) and the content skill's reference
  (`content:check`).
- Determinism property test on the sim runs in CI on every change to the sim
  package.
- The server: tsup bundles the host with the workspace packages into one file
  (`pnpm build:server`) for the image. CI validates `deploy/`'s compose file and
  runs `deploy/smoke.sh` (build the image, bring it up, expect `/v1/health`) on
  every change; the `release` workflow builds the image for arm64 and amd64 and
  pushes it to GHCR on a `v*` tag. Deploys, rollbacks and backups are scripts
  in `deploy/`, with the secrets only on the box.
- Verification bar per phase: typecheck, lint, package tests, plugin tests on
  terminal and desktop surfaces, `claude plugin validate`, and a manual pass in
  a live session.
- Branch flow: feature branch, PR into `ai-staging`, later `main`. Private
  during development; public under MIT (`LICENSE`) from the soft wave, the
  third-party notices kept in the plugin's `NOTICE.md`. The monorepo is the plugin
  marketplace via a root `.claude-plugin/marketplace.json`.
