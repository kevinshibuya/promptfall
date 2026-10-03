# Promptfall, product and architecture spec

Decided in a grilling session on 2026-10-02; amended for phase 2 on 2026-10-03. Every
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

- The game never gets in the way of the work. The band is 4 rows at rest,
  collapses to 1 row, hides while Claude asks a question, collapses under 100
  columns, and switches off per session with one command.
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
- The mod's footprint is interface, state, store, clock, HTTP and commands. No
  file system, no process spawning, no model calls, no prompt rewriting.
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
  Select, Link, Code, Markdown, Image (terminal only, pixel sprites on kitty and
  Ghostty).
- Dialog: `$.ui.open({ id, title, focus, closeOnEscape, holdToasts, rows })`
  drawn by a `ui.render` hook on `Pane`.
- Timers: `$.clock.every(ms, fn)`. Each hook dispatch has a 10 second budget;
  time spent inside `$` calls does not count.
- Network: `$.http.fetch(url, init)` only, resolves after the whole body. No
  WebSocket, no server-sent events. Long-poll works because fetch time is free.
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

- One combat round every 2 seconds while a model turn is running, every 5
  seconds while the session is idle. Cadence is the client's scheduling; the sim
  itself is purely event-driven and knows no wall clock.
- `tool.call` spawns one enemy into the current encounter. At most 3 enemies
  fight at once; up to 10 more queue; beyond that new spawns are dropped so a
  very long turn cannot create a death wall.
- `turn.complete` after a turn with 10 or more tool calls spawns a turn boss: a
  mini-boss with raised drop rates and a hero contract chance. It is not the
  zone boss.
- `prompt.submit` is a short rest: every hero heals 30% of max HP, fallen heroes
  revive at 30%.
- When no enemy is present a tick spawns the next enemy of the current wave, so
  idle sessions still fight.

### 4.2 Zones

- 12 zones, each 10 waves then a zone boss. Waves have 1 to 3 enemies drawn
  from the zone's enemy list.
- Clearing the zone boss advances to the next zone unless the farm toggle is on,
  in which case the zone restarts at wave 1.
- Wave clear heals every hero 15% and revives fallen heroes at 15%.
- Party wipe: retreat one zone (never below zone 1), wave 1, full heal, encounter
  and queue cleared. Nothing is lost.
- Pace target: an active 8 hour coding day (60% of the time inside turns, one
  tool call every 8 seconds inside turns, drops equipped when they improve a
  hero, no other play) clears zone 1 and slows afterwards. A headless balance harness in the sim package verifies the
  target and is the tool for tuning numbers.
- Difficulty tiers are a later prestige layer on the same ladder, not v1.

### 4.3 Heroes

- Four classes: Knight, Black Mage, White Mage, Archer. Party of three from the
  roster, chosen in the dialog's Heroes tab at any time, applied at the next
  zone change (advance or retreat), so swaps happen between zones.
- A hero is a template (class, name, portrait) times a rarity times rolled
  traits. Trait count by rarity: Common 0, Uncommon 1, Rare 2, Epic 3,
  Legendary 4. Level cap by rarity: 20, 30, 40, 45, 50.
- Hero names are the template name plus a generated epithet, never player
  typed.
- Stats: HP, attack, defence, speed. Growth per level by class table. XP from
  kills. A per-class resource (mana, stamina) is deferred until a skill system
  gives it a use.
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
- Inventory 30 slots, expandable with gold, and equipped items occupy slots. A
  drop into a full inventory is auto-vendored and the loot log says so.
- Reforge rerolls one affix for gold, price by rarity.

### 4.5 Gold

Sources: kills, vendoring items, dismissing heroes. Sinks: reforge, tavern,
inventory and roster expansions, market listing fee, 5 percent market sale fee.

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
- A listing can be cancelled any time before it sells. A listed item or hero
  leaves the inventory or roster and frees its slot.
- Expiry and cancel return the item or hero. With no free slot it waits in
  returns and is delivered the moment a slot frees. Returns are never vendored;
  auto-vendoring is for drops only.
- Buy orders: base type, minimum rarity, at most one required affix, maximum
  price. Gold is escrowed when the order is placed. No auto-match: a seller sees
  matching orders in the sell flow and accepts one explicitly. An order expires
  after 7 days, fills exactly once and closes; cancel refunds the escrow in full.
- A purchase needs a free inventory slot (roster slot for a hero) and the gold,
  or it is refused. Buyer and seller are never the same account.
- A hero is listed with no equipment: the dialog unequips into the inventory
  first and refuses when space is lacking. A transferred hero arrives at level
  1, 0 XP, full HP, same rarity and traits.
- Market events (sold, bought, returned) land in the loot log next to drops.
- Listings show the seller's name.
- Browsing is open to every account. Listing, buying and ordering need a linked
  GitHub account and `market.enabled`; the dialog says so in place.
- Published odds: an Odds screen in the dialog shows drop, rarity and tavern
  tables.

## 6. Social (phases 2 and 3)

- Presence: a count per zone, from heartbeats held in Redis with a TTL, with
  the names of players in the zone shown in the band's World tab.
- Leaderboards: highest zone reached (all time) and world boss damage (weekly
  reset). Names default to the GitHub login, filtered by a blocklist.
- Global chat: one channel. Posting needs a linked GitHub account, 200
  character limit, per-account rate limit, word blocklist. Delivered through the
  event stream. Lives in the dialog's Chat tab; the band's World tab shows the
  latest message as a one-line ticker.
- World boss: spawns every 3 hours, lives 20 minutes or until dead, visible to
  everyone online as a banner with a global HP bar. Every online party deals
  damage through its normal batches; the server tallies contribution. Rewards: a
  guaranteed drop above a participation threshold, bonus rolls for top
  contributors, all rolled server-side.
- Moderation in v1: name and chat blocklists, admin mute and ban, the chat flag.

## 7. Simulation and authority

- Package `@promptfall/sim`, pure, versioned by `SIM_VERSION`. API: create an
  initial state from a seed, step a state with one event into a new state plus
  effects, hash a state. Effects are UI notifications and carry no authority.
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
  authored only by the ledger and are the effects of trades on an account's
  inventory, roster and gold: `listed`, `returned`, `sold`, `bought`,
  `order_placed`, `order_refunded`, `order_filled`, `fee`. The sim applies a
  server event without judging it; one it cannot apply is a bug caught by the
  hash check, never a rejection. The batch schema accepts player events only.
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
  banner and the sim pauses. No multi-version replay on the server, and no
  state migration between sim versions: a state behind the server's sim version
  is reset from the Account tab.
- Server unreachable: the banner shows at once; the sim keeps ticking and
  buffering for 2 minutes of wall clock from the first failure, then pauses;
  retries back off from 1 to 30 seconds with jitter; the first success flushes
  the buffer and clears the banner. A thrown submit is an outage, never a
  permanent pause.
- One primary session per account ticks. Phase 1 elects it with a lease in the
  local store; phase 5 with a server lease. Other sessions show "playing in
  another session" and render read-only.

## 8. Server (phase 5)

- NestJS API, Postgres via Drizzle, Redis for presence, pub/sub, flag
  invalidation and queues, a worker process for world bosses, listing expiry and,
  when needed, batch replay off the request path. The replay function is pure
  from day one so moving it to the queue is configuration.
- REST with Zod schemas shared from `@promptfall/protocol`, validated on both
  ends.
- Event stream: long-poll, held up to 25 seconds, cursor based over a short
  per-account log in Redis Streams, so a reconnect never loses an event.
- Accounts: anonymous device accounts minted on first launch; GitHub device
  flow to link, which unlocks trading and chat. Tokens are opaque random values
  stored hashed, cached briefly in Redis, revocable.
- Flags: `chat.enabled`, `market.enabled`, `worldboss.enabled`, `maintenance`,
  `minClientVersion`, in Postgres, cached in process per instance, invalidated
  through Redis pub/sub, sent at startup and pushed on change.
- Admin: a CLI in the monorepo over authenticated admin endpoints. Actions:
  flip a flag, mute, ban, revoke an item. Every action lands in an audit table.
- Retention: raw event batches 30 days, state snapshots per batch head kept.
- Infra: Docker Compose locally (Postgres, Redis, API, worker). Oracle VPS
  later, same images.

## 9. Fake servers and the contract suite

- `@promptfall/ledger` is the server core: account records, batch replay and
  the market rules as pure functions over an injected clock and key-value
  store, with expiries run through `sweep(now)`. Three hosts run it: the
  in-process fake, the HTTP fake and the real server. A host adds transport,
  persistence and, for the HTTP fake, bots; it never adds rules.
- Phase 1: an in-process fake inside the plugin, no infrastructure, persisting
  through the local store. It replays batches like the real server will, so the
  client already sends inputs and reconciles hashes. It stays the default
  server: a plugin installed with nothing running still plays.
- Phase 2 on: the HTTP fake at `servers/fake`, a separate local Node process in
  the monorepo on `node:http`, speaking the real HTTP protocol with the shared
  schemas, persisting a JSON snapshot after every mutation. Flags: `--port`,
  `--seed`, `--speed`, `--player-name`, `--data`. `--speed` scales the bots'
  cadence and the ledger's clock together, so cooldowns and expiries can be
  watched. The GitHub link flow is approved on the first poll with
  `--player-name` as the login.
- Bots: 12 seeded accounts with names from a fixed list, inventories and
  rosters rolled from the sim's own loot tables, a gold stipend per tick so
  they never run dry. Each tick they list, buy, place or cancel through the
  same ledger API as a player, never a back door. Phase 3 adds chat, presence
  and the world boss. Their numbers live in one config file and are tuning,
  not contract. The bots are the load generator for the real server later.
- `/promptfall server <url>` points a session at an HTTP server and
  `/promptfall server local` back at the in-process fake. One device token per
  server; switching re-bootstraps and adopts that server's state. Nothing moves
  between servers, ever.
- Until the event stream exists (phase 3), server events ride on responses: the
  batch ack and the market responses carry what is pending past the client's
  cursor, and the dialog refreshes when opened. The cursor is explicit in the
  protocol so the stream is an addition, not a change.
- `HttpClient` in `@promptfall/protocol` implements `ServerClient` over an
  injected fetch: `$.http.fetch` in the plugin, the global in tests.
- One contract test suite in `@promptfall/protocol` runs against the in-process
  fake, the HTTP fake and the real API. Trade cases run two accounts against
  one host.

## 10. Client structure

- Band tabs on letter hotkeys: `p` Party, `l` Loot log, `w` World. `c`
  collapses. Hotkeys fire only while the band holds the keyboard (ctrl+x tab or
  a click).
- Band rows at rest: three hero rows (name, class glyph, level, HP bar) and one
  status row (zone, wave, gold, last drop). One line when collapsed, when
  `bodyColumns` is under 100, or when `maxRows` is under 4. Hidden while
  `hasSurvey`.
- Dialog via `/promptfall [tab]`: Inventory, Heroes, Account, Odds in phase 1;
  Market and Orders in phase 2; Chat in phase 3. Opened with focus,
  closes on Escape, holds toasts.
- Market tab: listings filtered by kind (items or heroes), base type or class
  and minimum rarity, sorted by price or newest, 10 per page, Buy on a hotkey
  with a confirm step. Orders tab: my listings, my buy orders, a form for a
  new order, the count waiting in returns. Selling starts from the Inventory
  and Heroes tabs: matching buy orders first, then the fixed-price form, with
  fee and net shown before confirming. Market and Orders are always listed; a
  closed market or an unlinked account is said in place, with a hotkey to the
  Account tab.
- Account tab: link GitHub (the device flow: a code, a URL, a poll), the
  current server, and a reset of this machine's data.
- `/promptfall off` switches the band off for the session. `/promptfall farm`
  toggles the farm flag. `/promptfall server <url>|local` picks the server.
- Toasts: Rare or better drop, level up, zone cleared, wipe, hero recruited,
  listing sold, purchase complete, order filled, item returned.
- Sound (phase 4): off by default, toggle in Account; cues for drop, level up,
  boss spawn.

## 11. Art (phase 4)

Style reference is early Final Fantasy. Actual Final Fantasy sprites are
copyrighted and excluded. Enemies and tiles from licensed packs, the
finalbossblues Time Fantasy family being the first candidate for one coherent
palette, with 0x72 DungeonTileset II plus Kenney Tiny Dungeon as the zero-cost
fallback; item icons from Shikashi's set recoloured to the hero palette; the
four heroes generated with Retro Diffusion or PixelLab on the pack's palette and
cleaned in Aseprite or Pixelorama. Licences get verified before purchase.
Sprites draw through the Image element where the terminal supports it and fall
back to glyphs everywhere else.

## 12. Phases

1. Solo loop: monorepo, sim, protocol, plugin with band and dialog, in-process
   fake, balance harness, determinism tests.
2. Market, buy orders, hero trading, against the HTTP fake with bots. Two PRs:
   the ledger, server events, `HttpClient`, the HTTP fake and the outage rules
   first, with the contract suite green against both fakes; the market second.
3. Presence, chat, leaderboards, world bosses, against the same fake.
4. Sprites and sound.
5. Real server: accounts, authority, flags, admin CLI, Docker Compose, contract
   suite green against it.

Each phase gets its own implementation plan when its turn comes.

## 13. Tooling and repository

- pnpm workspaces, TypeScript everywhere, tsup to bundle `@promptfall/sim` and
  `@promptfall/protocol` into the plugin folder (bundles committed so the plugin
  installs from git without a build; CI fails when they are stale), vitest for
  packages and servers, the official plugin test runner for the mod, Biome for
  lint and format.
- Determinism property test on the sim runs in CI on every change to the sim
  package.
- Verification bar per phase: typecheck, lint, package tests, plugin tests on
  terminal and desktop surfaces, `claude plugin validate`, and a manual pass in
  a live session.
- Branch flow: feature branch, PR into `ai-staging`, later `main`. Private
  during development, MIT at the server release. The monorepo is the plugin
  marketplace via a root `.claude-plugin/marketplace.json`.
