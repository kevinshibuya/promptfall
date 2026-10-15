# Promptfall, product and architecture spec

Decided in a grilling session on 2026-10-02; amended for phase 2 on 2026-10-03, for
phase 3 on 2026-10-03, for phase 4 on 2026-10-04, for the staged state on
2026-10-09, for the curve on 2026-10-12, for sound on 2026-10-12, for the
reactive events on 2026-10-12, for the pull on 2026-10-13 and for the reactive
revamp on 2026-10-14. Every
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
  1 row under 100 columns or 6 rows, and switches off per session with one
  command. It stays up while Claude asks for a permission or a question, at
  the layout the rows it is given allow. Loot and World are the strip
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
- Sound: `$.audio.play({ asset }, { gain })` plays a file of the plugin's own,
  gain 0 to 4 (default 1), through `afplay` on a macOS terminal and through its
  own audio element on the desktop on any system. Clips do not queue. A Linux or
  Windows terminal has no player: as of v2.1.296 the engine logs "no audio player
  on <os>; not played" and resolves at once (the declarations say "played or
  skipped"), and it rejects only a clip that cannot play. The plugin tells a
  skipped play by timing it on the engine's clock: a terminal play that resolves
  in under 100 ms was skipped, since every cue is longer and a real play resolves
  when its clip ends. `docs/upstream/audio-playback.md` asks for players there.
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
- `tool.call` adds one enemy to the current wave: it goes into the encounter
  queue and counts toward the wave, which clears only when every enemy it got,
  drawn or joined, is dead. At most 3 enemies fight at once; up to 10 more
  queue; beyond that a call's enemy is dropped and counts toward nothing, so a
  very long turn cannot create a death wall. Which enemy is the tool kind's
  (spawn by tool kind, below). A call with no wave open (no encounter, or a
  turn boss alone) opens one with its draw, the call's enemy queued first. At
  wave 11, the zone boss's, a call opens no wave: its enemy joins the encounter
  and counts toward nothing, and that encounter never clears as a wave.
- Whenever the field has a free slot and the queue holds an enemy, that enemy
  spawns: when a wave opens, on a tool call, and on a kill, in the same step as
  the kill and before the clear check, so a refilled field never clears. A zone
  boss kill ends the encounter and spawns nothing.
- `turn.complete` after a turn with 10 or more tool calls spawns a turn boss: a
  mini-boss with raised drop rates and a hero contract chance. It is not the
  zone boss. It arrives on an empty field, between waves, in an encounter of its
  own, and counts toward no wave; a tool call during it opens the next wave in
  that encounter, the turn boss outside its count.
- `prompt.submit` is a short rest: every hero heals 50% of max HP, fallen heroes
  revive at 50%.
- When no encounter is open a tick opens the next wave, its whole draw queued
  and on the field at once, so idle sessions still fight; with one open it
  refills from the queue.
- Reactive events (spec #131, ADR 0014): five changes in the fight that answer
  what Claude is doing, each seen on the stage and read in the combat log
  (§10). **A reactive event shapes the fight and never the reward.** Four are
  player events of their own, `turn_start`, `tool_mishap`, `camp` and `guard`
  (carrying on or off); the fifth is a hint on `tool_call`. The state holds a
  haste countdown and a guard countdown in ticks (zero is off), a camp flag,
  and each enemy an enraged flag; a save migrated from before them starts with
  both countdowns at zero, not camped, and no enemy enraged. The plugin raises them from Claude
  Code's hooks; hooks fire in every session, and only the primary records
  them, as it does every event.
  - **Haste**, while a turn runs. `turn_start` sets the haste countdown to 90
    ticks (3 minutes of battle), refreshing it when already on. The plugin
    sends it at the main loop's turn start and again from the turn's model
    steps, at most once per 60 seconds, so a long turn stays hasted and a dead
    one runs out; a subagent's steps send nothing. `turn_end`, `rest` and the
    tick that takes the countdown to zero end it; an aborted main-loop turn
    sends `turn_end` too. While on, every hero's per-step gauge fill is scaled by
    12,500 basis points (`HASTE_BP`, at least 1); enemies fill as before. The
    gain is bounded: a quarter more hero actions, only during time already
    spent in turns, which the turn cadence already pays for. A haste effect
    with on or off is emitted on the change only.
  - **Spawn by tool kind.** `tool_call` carries an optional archetype hint,
    `swift`, `brute`, `caster` or `tank`, read in the plugin from a table of
    tool names (`hooks/tool-kinds.ts`, plugin content, not sim content): Read,
    WebFetch, WebSearch, LSP, Grep and Glob are swift; Edit, Write,
    NotebookEdit and MultiEdit brute; Bash caster; every other tool, every MCP
    tool and every call a subagent makes, whatever its tool, tank. The engine
    build of 2.1.296 has no Grep or Glob tool, so a search runs through Bash
    and spawns a caster. When the hint names an archetype the zone's wave list
    holds (every zone holds one of each), the wave draw spawns that enemy; with
    no hint, or one the list lacks, it draws uniformly. A hint never touches the
    zone boss, the turn boss or the world boss (boss mode spawns nothing from a
    tool call), and never changes the queue cap or the wave size.
  - **Rewards follow toughness.** A wave enemy's XP, its gold range and its
    drop chance are the zone's base scaled by its archetype's HP share over the
    four shares' mean, floored, at least 1. The shares are brute 12,000, swift
    8,000, tank 14,000 and caster 9,000 basis points, mean 10,750, so a tank
    pays about 1.30 times the base and a swift about 0.74. Reward per point of
    enemy HP is the same for every kind, so a claimed hint buys no farming
    rate, and an unhinted zone pays on average the base, less at most the one
    unit the floor drops per kind. Rarity weights, boss multiples, boss drop
    chances and boss drop tables are untouched.
  - **Enrage**, on a failed tool call. `tool_mishap` enrages the
    strongest living enemy on the field: the highest by kind (world boss, zone boss, turn boss,
    then a wave enemy), then the highest attack as the sim's stats give it (a
    world boss by the engaged boss's scaled stats), then the highest max HP,
    then the front-most. The queue never counts. It emits an enraged effect
    naming the pick. Its next attack uses its attack stat
    scaled by 15,000 basis points (`ENRAGE_BP`), floored, in place of its own,
    through the same variance, mitigation and doubling; then the flag clears.
    An enemy that dies enraged takes its flag with it. A mishap on an empty
    field, on a pick already enraged (no fall-through to the next strongest),
    or while camped does nothing. The plugin sends it
    from the classic post-tool-failure hook, at most one per 5 seconds, never
    for an interrupt by the user nor for a call the permission-denied hook
    named; a user's no at a prompt raises no failure hook at all.
  - **Camp**, on a compaction. `camp` carries an optional on, like `guard`;
    a `camp` without it reads as on. `camp` on heals every party hero 50% of
    max HP and revives the fallen at 50%, exactly as a rest heals, in place,
    sets the camp flag and emits a camp effect with on and each hero's id and
    heal. The encounter, its queue, the gauges, the action queue and the busy
    counter are held as they are. While camped a tick does nothing: no refill,
    no battle, no spawn, no countdown, and a hero's per-step fill reads zero.
    `guard` on and off, equips, vendoring, market and farm events run as
    always. Camp breaks, clearing the flag and emitting a camp effect with on
    false and no heals before the event's own work, on the four events that
    keep the encounter, `camp` off, `rest`, `turn_start` and `tool_call`,
    after which the next tick fights on from the held gauges and queue, and
    on any event that ends or replaces the encounter: `travel`,
    `boss_engaged`, `sandbox_boss`, `sandbox_zone` and `sandbox_wipe`. A
    refused event breaks nothing. `camp` on while camped and `camp` off while
    not camped are no-ops. With a world boss engaged, `camp` on heals, sets
    nothing and emits the camp effect with the heals and no on: no pause.
    Camp leaves Haste and Guard as they are. Haste never starts while
    camped, since the `turn_start` that would start it breaks camp first; one
    already on when camp is made waits with its countdown frozen, as every
    countdown is, and shows no speed lines at the fire (§10). `guard` on and
    off set and clear the guard countdown while camped, and the stage shows
    the stance alone. The plugin sends `camp` on from the engine's `session.compact`
    hook, which fires as a compaction is about to run, when its trigger is
    manual, auto or plugin and it carries no agent id (the engine's precompute
    and a fork's own compaction send nothing), at most one per minute. It sends
    `camp` off unpaced from the band's `g`, `/promptfall go`, the session's
    end when its process ends (not on a clear or a resume) and a primary
    stepping aside because it draws nowhere, each only while the party camps,
    so once per camp. The step-aside is what carries `/exit`: its teardown
    draws nowhere for seconds before the session ends, and the end then finds
    a secondary.
  - **Guard**, while a permission prompt waits. `guard` on sets the guard
    countdown to 60 ticks (2 minutes of battle); `guard` off, `rest` and the
    tick that takes it to zero end it; on while on, or off while off, is a
    no-op. While on, a hero's gauge fill is zero whatever Haste says, a hero at
    the head of the action queue does not act and keeps its place while the
    enemies behind it act, and the damage a hero takes is scaled by 5,000
    basis points (`GUARD_DAMAGE_BP`). A guard effect with on or off is emitted
    on the change only. The plugin sends on from the classic permission-request
    hook before its `next(e)`: a live check on 2.1.296 showed it is the one hook
    that fires as a prompt shows and never for an auto-allowed call. The tool
    check answering ask is not the signal, since a permission mode settles an
    ask after it. The plugin sends off when the awaited tool call resolves,
    allowed, denied or failed, or when the classic permission-denied hook
    fires. It keeps a flag of its own so a
    duplicate on or off sends nothing, and paces pairs at most one per 4
    seconds. Guard off follows any call that resolves, so a concurrent call
    resolving under a showing prompt lowers the guard early.
  - The plugin drops a reactive event sent faster than its pace, since a
    dropped one loses a flash at most, and its paces sit under the server's
    buckets (§7). `camp` off has no pace: the plugin applies it only while
    the engine's own state says camping, read before any await, so two
    breaks at once send one off and a camp spends one on and one off. The
    band's `g` reads the clock at the keypress, not at its last draw. Any later reactive event passes ADR 0014's test before it is
    designed: if faking it would pay, it is not a reactive event. A summon on a
    subagent start fails it and stays out.

### 4.2 Zones

- 12 zones, each 10 waves then a zone boss. A wave opens with 1 to 3 enemies
  drawn from the zone's enemy list, all queued at once, and grows by one with
  each tool call made while it is open (§4.1).
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
- Travel (spec #132): the player event `travel`, carrying a running zone,
  moves the party at once to any zone from 1 to the lesser of `highestZone`
  and the ladder's end, every tier's zones the party has reached included. The
  sim rejects it, the state unchanged, for a zone that is not an integer, one
  below 1 or past that bound (`zone_not_reached`), the zone the party is in
  (`already_in_zone`) and any travel in boss mode (`boss_mode`). A travel ends
  the encounter and the battle with no drops and no XP (every gauge empty, the
  action queue cleared), sets wave 1, resets the wipe count as any change of
  zone does, applies the pending party (§4.3) and emits `traveled` with from
  and to. The farm toggle is unchanged. It costs nothing and has no cooldown
  beyond its rate bucket (§7). `highestZone` never falls, so a retreat still
  drops the party one zone and a travel takes it straight back: a travel
  undoes a retreat. The Journal's zone pages and `/promptfall travel <zone>`
  send it (§10).
- Zone boss moves (spec #132): each zone boss has one of four moves, keyed by
  its base zone and the same in every tier. Zones 1, 5 and 9 strike twice: two
  hits on one target at 70% of attack each (`STRIKE_TWICE_BP`), a new action,
  the second skipped when the first fells its target. Zones 2, 6 and 10 heal
  themselves for 50% of attack (`SELF_HEAL_BP`), capped at the HP missing,
  weighed by need under half HP as the White Mage's heal is. Zones 3, 7 and
  11 hit the whole party, every hero standing at 60% (`HIT_ALL_BP`), about one
  action in three beside their single attack. Zones 4, 8 and 12 rage: under
  half HP every hit lands at 150% (`RAGE_BP`), and a `raging` effect marks the
  hit that first takes them under; a raging boss that is also enraged takes
  both on that hit. Each move sets the boss's attack multiplier in place of the
  boss archetype's 20,000 basis points (`MOVE_ATK_BP`: 15,000 strike twice,
  20,000 heal, 22,000 hit all, 13,500 rage), so the feel probe, which weighs a
  boss's actions as its tactics do, holds 3 to 4 boss actions at every zone.
  Turn bosses and the world boss keep the single attack.
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
- `pnpm test` excludes the sim's harness folder; `pnpm test:arc` runs that folder
  alone. No ticket's gate runs the arcs; the closing ticket of a sim-changing
  batch runs them once (ADR 0017). `arc.test.ts` measures nine seeds (1 to 9) of
  120 live hours each. Its assertions: every seed first clears zone 1 inside the
  first 30 minutes and first clears each zone later than the one before; at least seven
  of the nine first clear zone 12, and at least seven take the granted Legendary
  to 50, inside the run (the completion floors); at least seven of the nine
  first clear zone 13 with the arc's own party, inside the run; the feel probe
  holds at every zone. The three medians (zone
  12's first clear, the hours per level through 10 to 30, the Legendary's cap)
  are a report, never a gate: the test prints them with the per-seed table (with
  each zone's first-clear duration, zone 13's first clear, its wipes and its gap
  over zone 12). The batch's closing ticket pastes that table in its closing
  comment and reports any failed floors; retuning is Kevin's decision in a
  follow-up ticket, and Kevin judges the medians on the PR.

### 4.3 Heroes

- Four classes: Knight, Black Mage, White Mage, Archer. Party of three from the
  roster, chosen in the dialog's Heroes tab at any time, applied at the
  next zone boss kill, wipe or travel (a farm restart and a wipe in zone 1
  included), so swaps happen between zones. A pick on a fresh save, before the first kill,
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
  most often; a zone boss also has its move (§4.2), and combat honours the
  action the picker chose for an enemy as it does for a hero.
- A weighted picker chooses each action and its target together: every
  (action, target) pair a unit could take gets a weight from rules about the
  battle, and one seeded draw picks a pair. The rules are content data per hero
  class, per enemy definition (a zone boss's move, looked up first) and per
  enemy archetype (`packages/sim/src/content/tactics.ts`), so a later skill or
  technique is a new entry, not new code. Heal weighs nothing
  while every ally is at 50% HP or more and rises the lower the weakest falls
  (about 3 heals in 4 at 25%); a White Mage alone never heals.
- Acquisition: recruit contracts drop from zone bosses and, at a lower rate,
  turn bosses; a tavern recruits for gold at published odds. Roster cap 24,
  expandable with gold.
- The tavern guarantee (spec #132): a Rare or better within 20 tavern
  recruits, an Epic or better within 80, a Legendary within 400
  (`content.tavern.guarantees`). The state holds three counters
  (`guarantee`): recruits since the last Rare or better, since the last Epic or
  better, since the last Legendary. A tavern recruit raises all three, then
  rolls the odds; the floor is the highest rarity whose counter has reached its
  threshold, the result is the higher of the roll and the floor, and a result
  of rarity R resets the counters at R and below. The remaining count to each is
  the threshold less its counter, at least 1, which is the next recruit.
  Contracts and sandbox recruits leave the counters alone, though they count
  in the recruit tallies (§7). Published beside the odds (§5, §10).
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

Sources: kills, vendoring items, dismissing heroes, market sales (§5), and
what the ledger pays as server events: world boss and weekly hunt rewards
(`rewarded`, §6), and `credited` gold for an achievement step or a daily goal
met (spec #132). Sinks: reforge, tavern, inventory and roster expansions,
market listing fee, 5 percent market sale fee.

- Gold earned, the tally the gold ladder and the session summary read (§7,
  §10), counts kill gold, vendoring (by hand, on pickup, and a contract that
  finds the roster full), a sale's or a filled order's net, a reward's gold and
  every credit. It never counts a dismissal, a refund or escrow coming back.
- Achievements: a content table (`content/achievements.ts`), data no sim rule
  reads, so a row is no bump. Ladders, one row of up to four steps paying 100,
  400, 1,500 and 5,000 gold in order: kills 100 / 1k / 10k / 100k; zone bosses
  10 / 50 / 200 / 1,000; turn bosses 10 / 100 / 1,000; Rare or better drops 10
  / 100 / 1,000; Legendary drops 1 / 10 / 50; recruits 5 / 25 / 100; reforges
  10 / 100; gold earned 10k / 100k / 1M; daily goals met 10 / 50 / 200; streak
  work days 5 / 20 / 60 / 250; zones with every enemy defeated 1 / 4 / 8 / 12;
  bases held in every rarity 1 / 10 / 35. One-offs at 500 gold: a first Epic
  and a first Legendary (held, by drop, purchase, reward or recruit), zone 6
  reached, zone 12 cleared, tier 2 reached, tier 3 reached, a zone boss beaten
  with no wipe in its zone, all four classes at their cap. A step pays once, on
  the commit that crosses it; a commit that crosses several, a veteran's first
  after the bump among them, pays them all. Kills read the existing total and
  zone bosses start from the bosses beaten, so a veteran's ladders keep their
  past; the bestiary and collection ladders count from the bump.
- Daily goal: one pure function (`dailyGoal` in `@promptfall/sim`) draws a row
  of the goal table (`content/goals.ts`) with the sim's PRNG, seeded from a
  hash of the UTC day index and the account id, and scales its target to the
  party's zone at the day's first commit: kill 150 enemies plus 10 a zone past
  zone 1, beat 2 zone bosses plus 1 every 12 zones, see 3 Rare or better drops
  plus 1 every 6 zones, or beat one turn boss. The world boss is not in the
  pool, since its flag can be off. Progress is the tallies' rise since the
  day's first commit. Met, it pays the zone's mean wave gold midpoint times 300
  (`goalGold`), about an hour of kills at the reference cadence, from the zone
  the day opened at. The day is the server clock's UTC day, scaled by speed as
  everything is, and resets at its end. A missed goal costs nothing but the
  streak, and no goal pays twice in a day.
- Streak: the count of consecutive work days with the goal met; it pays
  nothing itself and feeds the streak ladder. A day is a work day unless it is
  one of the account's two rest days, Saturday and Sunday by default. A goal
  met on a work day grows the streak by one when no work day since the last
  met one went unmet, and starts it at one otherwise; a work day missed sets it
  to zero, as the next commit or read sees it. A goal met on a rest day pays
  and counts toward the goals ladder, and neither grows nor breaks the streak.
  A change of rest days applies from the next Monday, and each day is judged by
  the set in force on it, so a change never reaches back over a miss.

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
  tables, at zone 12's rarity odds past tier 1, then the tavern guarantee
  (§4.3) as three rows from the save's own counters, "Rare guaranteed in 13
  recruits", the Epic's and the Legendary's ("on the next recruit" at one),
  and says that rarity multiplies base stats, heroes and items alike, and that
  reforge is priced by rarity and tier.

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
- Weekly hunt (spec #132): one target a week shared by every account on the
  server, from Monday 00:00 UTC on the server clock. The ledger keeps one world
  record beside the boss's (`pf:world:hunt`): the week's start and end, the
  hunt drawn in turn from a content table (`content/hunts.ts`: casters,
  brutes, zone bosses, tanks, swifts; 20,000 of an archetype across every zone,
  or 1,000 zone bosses), the count, the contributions per account, closed. At
  each batch commit the ledger adds the account's rise in the hunt's tally (the
  archetype's defeated counts, or the zone bosses) to the count and to its
  contribution, never a bot's, as bots are kept off the boards. At the first
  world poll or sweep past the week's end the ledger closes it: every
  contributor at or above half a percent of the target (`HUNT_THRESHOLD_BP`,
  50) gets one reward rolled at its zone through the world boss's reward path,
  whether or not the count reached the target, a `rewarded` event with source
  `hunt` (§7), goods with no free slot waiting in returns. The next week's
  record opens in the same pass. The world snapshot gains `hunt` (name,
  target, count, ends at, yours), null with the flag off or once the week has
  ended. The World tab's records row shows it with its bar (§10).
- Flags: one per feature, `chat.enabled`, `worldboss.enabled`, `presence.enabled`,
  `leaderboards.enabled`, `hunt.enabled`. The in-process fake runs with chat,
  the world boss and the hunt off, said in place like a closed market; the
  sandbox turns the world boss on and leaves the hunt off. `hunt.enabled` is on
  by default on HTTP hosts. Achievements and the daily goal have no flag: they
  are not social, and they pay from the same gold the world boss pays.
- Moderation in phase 3: name and chat blocklists and the chat flag. Phase 5
  adds the ban and flag flips over the admin route (§8); there is no mute.

## 7. Simulation and authority

- Package `@promptfall/sim`, pure, versioned by `SIM_VERSION`. Any change to the
  sim bumps it, and the plugin's version moves with it; a state behind the
  client's sim version is reset (phase 3 bumps it to 3, the combat flow to 4,
  the staged-state set to 5, the pull's tallies, travel and guarantee to 16,
  its boss moves to 17 and waves that fill every free slot to 18). API: create
  an initial state from a seed, step a state with one event into a new state
  plus effects, hash a state. Effects are UI notifications and carry no
  authority.
- Tallies (spec #132): the ledger sees only state on replay, never effects, so
  what it counts for the journal and the hunt is state. `tallies` holds, per
  enemy definition, seen (raised at its spawn) and defeated counts; per item
  base, a mark per rarity held (a drop, a purchase, a reward or a return);
  counts of zone bosses, turn bosses, zone bosses beaten with the zone's wipe
  count at zero (`cleanZoneBosses`), drops by rarity (kept or vendored on
  pickup), recruits by rarity (tavern, contract and sandbox alike), reforges and
  gold earned (§4.5). Every tally is an integer and in the hash. The migration
  to 16 starts them at zero, so the bestiary and the collection count from the
  bump, except the zone bosses, seeded from the bosses already beaten. The
  plugin's view carries them, so the Journal's bestiary and collection pages
  read the view with no server read.
- The client runs the sim locally for instant feedback, buffers the events it
  fed in, and sends them in batches every 15 seconds. A batch carries a client
  generated id (retries are no-ops on the server), a per-account sequence
  number, the sim version, the client version, the hash before and the hash
  after.
- The server replays the batch with the same sim. Rate caps are per-account
  token buckets on the server's own clock, one per event kind: rounds refill at
  one per 2 seconds, tool calls at one per second, rests and turn ends at one per
  5 seconds, each with a capacity worth about two minutes, so a gap never banks
  more than that and a burst of tiny batches cannot outrun the clock. The
  reactive events (§4.1) have four buckets of their own, so a flood of claimed
  compactions heals the party no faster than a flood of prompts: `turn_start`
  and `tool_mishap` at one per 5 seconds with the turn ends' capacity of 30,
  `camp` at one per 30 seconds with a capacity of 10, since a compaction
  spends an on and an off, and `guard` at one per 2
  seconds with a capacity of 60, since every prompt costs an on and an off
  (`BUDGETS` in `@promptfall/protocol`). `travel` (§4.2) has its own bucket,
  capped as a rest is, one per 5 seconds with a capacity of 30. A record from
  before a bucket gets it full on its first load; one from before a bucket's
  resize keeps its count and refills to the new capacity. A batch over any bucket is rejected
  whole, and the player sees a resync. Since a human paces only rests and
  prompts, the plugin paces the reactive events itself, under the buckets: a
  turn's `turn_start` refresh at most once per 60 seconds after its start,
  `tool_mishap` one per 5 seconds, `camp` one per minute and a `guard` pair
  one per 4 seconds, its on and off together the guard bucket's rate, dropping what comes faster (`hooks/reactive.ts`).
  Every submission is authenticated by the
  device token and must name its own account. Client timestamps order events
  within a batch and nothing else.
- The sim's events are of two kinds. Player events originate on a client and
  travel in batches: combat, rests, the reactive events, equips, vendoring.
  The batch schema knows each kind by name and refuses one it does not, and
  `tool_call` takes an optional `hint` that must be one of the four
  archetypes; the server accepts a hint without judging it, since it cannot
  see Claude's tools and a hint buys no reward (ADR 0014). Server events are
  authored only by the ledger: the effects of trades on an account's inventory,
  roster and gold (`listed`, `returned`, `sold`, `bought`, `order_placed`,
  `order_refunded`, `order_filled`, `order_sold`, `credited`) and the world boss
  and the hunt (`boss_engaged`, `boss_disengaged`, `rewarded`).
  `credited` carries a reason, at most 64 characters, that the sim hands on in
  the gold effect it emits, so the toasts can tell its kinds apart:
  `achievement:<id>:<step>` for an achievement step, `goal:<day>` for a daily
  goal, `sandbox` for the sandbox's gold, `bot_stipend` for a bot's. Kill
  gold and a vendored contract emit a gold effect with no reason. `rewarded`
  carries an optional source, `boss` or `hunt`; an absent one reads as boss, as
  every event logged before it does, and the reward effect always carries it.
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
- The journal (spec #132) is a ledger record per account beside its record
  (`pf:acct:<id>:journal`): the achievement steps paid with their times, the
  goals met, the day (its index, its goal, the zone it opened at, the tallies it
  opened with as the baseline, met), the streak (its length and the last work
  day met) and the rest-day sets. The ledger evaluates it at each batch commit
  from the committed state, never from a client claim, on the accepted path and
  the hash mismatch's alike: it opens the day when the day changed, pays the
  goal on the commit that meets it and grows the streak, then pays each
  achievement step newly crossed, every payment a `credited` event authored onto
  the record. Rest days are ISO weekdays, 1 for Monday to 7 for Sunday, two
  distinct ones, `[6, 7]` by default. Each set is stored with the day index of
  the Monday it applies from, and a day is judged by the set in force on it. The
  `journal` read (`GET /v1/journal`) answers the achievements with their steps
  and times, the day's goal with its progress, met and reset time, the goals
  met, the streak and the rest days in force with any set still to come, and
  writes nothing; a streak a missed work day has broken reads zero. The
  `setRestDays` write (`POST /v1/journal/rest-days`, two days) stores the pair
  from the next Monday, replacing a set still to come, and refuses a count
  other than two (`rest_days_count`), a day outside 1 to 7 (`rest_days_range`)
  and the same day twice (`rest_days_same`). Both go under the account's token,
  `ServerClient.journal` and `setRestDays`, the in-process fake being the
  ledger.
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
  `presence.enabled`, `leaderboards.enabled`, `hunt.enabled`, `maintenance`. The start flags
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
  the message window's command line (`▶Party Loot World c ▾`, the `c ▾` dim
  and the collapse hotspot). `c` collapses, `f` toggles farm, `j` and `k` page
  the Party and Loot logs, and `g`, shown and bound only while the view says
  camping, breaks camp. Hotkeys fire only while the band holds the keyboard (ctrl+x tab
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
  boss with its percentage, and while the encounter queue holds N enemies a
  dim `+N waiting` footer cut into its bottom border, the view's `waiting`,
  never staged), the message window (the command line, then two rows of the
  combat log), the party window (each hero's
  name and level with ▶ while it acts, HP with a bar, and an action gauge that
  fills between ticks and turns gold when full) and the purse window (gold,
  the tactics, Push on or Farm here, and on its third row `Falls N/3`, the
  view's `zoneWipes` out of the sim's `RETREAT_AT`, never staged, left out in
  boss mode).
  While the view says camping the enemy window keeps its title and footer and
  draws its rows blank but for a dim `camping` on the first; the message
  window shows `g: back to the fight` in the row a notice takes, a hotspot as
  `f` is, under the newest log row, and the desktop's
  track types nothing; the compact window shows the dim `camping` in place of
  the front enemy. A notice wins its row in both. Goldens `strip-camping` and
  `strip-compact-camping` pin them.
  Both lines are in the windows' alt text. A hero's text turns orange under 25% HP
  and red at 0. Loot and World are the strip alone: the message window shows
  the loot log, or the World rows.
  The message window never cuts a line on Party or Loot: each log line wraps
  over as many rows as it needs, keeping its spans' colours. The log's wrapped
  rows, then a notice's (or the camp's `g` row's), are one paging space; at the
  newest the window shows the log's tail, or a notice's first rows. `j` pages
  two rows back and `k` two forward, the offset counted in wrapped rows back
  from the newest, held in a per-session scroll state keyed by tab and never
  saved with the prefs. A new line while paged back leaves the window where it
  is; at the newest it follows. A tab switch, a collapse, a compact layout and
  a zone change put it back at the newest. While the window is off the paging
  space's last row the command line's right end shows `5-6/61` before `c ▾`,
  dropped when the tabs, it and the hint overflow the window. The Loot tab
  reaches 40 lines (the sim keeps 50). The World tab never pages; a notice
  takes its bottom rows. The strip input carries the tab's scroll, so the
  loop's frames and the desktop's tracks draw the page the band drew. While `hasSurvey` the band stays up at
  the layout its rows allow and the stage keeps playing. The band is
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
  text, each window's side joining the line. The Raster's stage is the one
  1.5x scene the Image draws, composed the same way and resampled into the
  cells' pixels (one a column, two a row) at the Image's zoom-out factor, the
  scene's pixels over the cells', 3 to 2 at full size: each cell pixel takes
  the one scene colour, clear included, with the most area under it, so no new
  colour enters the cells (ADR 0018). Damage numbers stay text cells, each at
  the cell its scene position maps to, over the scene pixel there. The Raster's line takes the
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
  Raster crops the scene to the stage's bottom rows, three scene pixels a
  row, the sky cut, and resamples that, down to the tallest actor on it
  (8 rows for the party, 12 with a turn boss, 17 with a zone or world boss,
  held through a departed boss's dissolve) (ADR 0010). Under that it zooms
  the cropped scene out into the rows left as the Image does, widened so it
  still spans the playfield, down to `RASTER_MIN_ROWS` (8): under it a
  figure scaled into the Raster's half-block rows is a smear (#230). Compact,
  when the full band does
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
  has left (its dissolve, any chest and the party's victory pose over, then
  the party's step-off, the moment the staged state's zone flips): the
  arrival's log line and its toast land then. The timeline answers it as the
  kill's effects arrive, before any draw has departed the boss, as a
  prediction (the end of the blow shown on the boss plus the dissolve and the
  victory hold, or its chest's end, whichever is later, plus the step-off),
  and refines it as the draws schedule and
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
- Reactive events on the stage and in the log (§4.1, spec #131). Each shows on
  the stage and prints a line; none toasts and none plays a cue, so the toast
  table and the cue set are unchanged. Spawn by tool kind shows as the enemy
  that walks in and has no line of its own. The other four:
  - **Haste**: while the view says a hero is hasted its idle bob runs on a
    250 ms clock (`HASTE_FRAME_MS`) instead of 500 ms, and on the full stage,
    on every surface, each hasted living hero trails its speed lines: three
    or four horizontal runs of uneven length from its back across its height,
    in its class colour (`CLASS_RGB`) mixed toward white, lighter toward the
    tail (`SPEED_LINES` in `stage/model.ts`). The lines are a mark of the
    hero, drawn from its art box, so they move with it and never sit loose
    between two heroes. They have a pattern per bob frame and so flicker on
    the hasted bob's clock; the SMIL picture carries the two patterns on the
    bob's discrete clock, as it does the idle pair. They draw only with the
    idle pair: none on a fallen hero, in the guard stance, in an action's or
    the hit's frames, or while the party camps. On the compact stage the
    faster bob alone. The lines follow the state, so they hold across ticks
    and go when Haste ends; under Motion still the first pattern draws static
    and the bob stays stopped. The party window's gauges
    fill at the sim's effective per-step rate (`heroFill`, Haste and Guard
    applied), so the strip agrees with the stage.
  - **Enrage**: at the mishap the enemy flashes red, the white flash's
    mechanism in `ENRAGE_RGB` (a blink on the full stage, the whole flash on
    the compact stage), with a
    `redflash` SMIL filter beside `flash`, emitted only in a document that uses
    it. From then until its next hit's impact the enemy's palette is mixed 40%
    toward red (the filter at opacity 0.4 in the SMIL picture). The sim clears
    the flag in the tick that resolves the hit, before the stage plays it, so
    the timeline holds the tint to that hit's show time, and drops it when the
    enemy departs or a later view no longer has it enraged.
  - **Camp** pauses the fight on the stage. On a camp effect with on, each
    enemy walks off toward its own edge, the spawn's walk played backward
    over the spawn's span (`camp_leave`), and none draws while the view says
    camping; the living heroes huddle toward the front living hero with
    Guard's huddle motion; the `effect:campfire` sprite, its 1.5× art (its
    compact art on the compact stage), stands on the ground a hero's width in
    front of the front living hero and burns for the whole camp with no
    fade; each hero's heal lands with a green rising number, from the amounts
    the effect carries. The bob stops while camping (idle A), so Motion still
    changes nothing. On a camp effect with on false the party breaks camp:
    the fire fades over 400 ms (`CAMPFIRE_FADE_MS`), the heroes step back to
    their slots with the huddle's reverse, and the held enemies walk back in
    from their edge with the spawn's walk (`camp_return`), in their held
    order with their HP as held; an enemy the break's view no longer lists
    never returns. A camp effect with no on (a world boss engaged) sets the
    fire on the ground between the enemies' line and the party for 4 seconds
    (`CAMPFIRE_MS`), then fades it over 400 ms, and pauses nothing. The
    strip's camping rows are the band's (above).
  - **Guard**: while the view says the party is guarding, each hero holds the
    `guard` pose derived from its idle (`stance()` in `sprites/derive.ts`: a
    one-row squash leaned one column per 12 rows toward the enemies, feet kept,
    no drawn frame, within ADR 0007) and the idle bob stops; a hit still shows
    the hit frame. On the full stage, on every surface, the living heroes
    huddle: the front living hero keeps its slot and each living hero behind
    it stands with its figure `HUDDLE_GAP_PX` (one pixel) behind the figure
    before it, in party order. The huddle's members are fixed at guard-on, so
    the fallen keep their slots and a hero that falls under Guard shifts
    nobody; a hero camp's heal raises while Guard holds the huddle joins it
    at once, the members behind it making room in that frame. On the guard effect with on the timeline slides each member from
    its slot to its huddle position in idle A over `HUDDLE_MS` (200 ms), one
    span for all so they arrive together, and on the guard effect with off
    the reverse; a slide turned before it ends goes back from where the
    party stands, as one slide backdated to that share, so the pictures
    agree. The SMIL picture carries the slide as a frozen translate. A
    party first drawn guarding stands huddled with no motion. The front
    living hero holds the big shield, the `effect:shield` sprite (1.5× and
    1× art, about a hero's height), on the enemies' side: its bottom at the
    hero's feet, its back edge over the hero's front by `SHIELD_OVERLAP_PX`,
    drawn over the hero. When it falls the next hero standing takes the
    shield at once, with no motion. A hit on any guarding hero lands on the
    shield: the shield flashes white in the struck hero's flash while that
    hero shows its hit frame and the damage number rises from it. On the
    compact stage the front hero holds the 1× shield in the stance, with no
    huddle to show. While camping Guard is the stance alone: the party is
    already huddled and there is nothing to block.
  - The log prints seven lines for four effects, each at its effect's time and
    keyed as a line that is never dropped: "The party quickens." and "The
    party slows." for haste on and off; "Claude stumbles. Wood Goblin is
    enraged!", naming the enemy; "The party makes camp while Claude gathers
    its thoughts." on a camp's heal and "The party breaks camp." when it
    breaks, a break lighting no campfire; "The party stands guard." and "The party lowers its
    guard." for guard on and off.
  - Each visual has golden scenarios on every surface (the Raster, the Image
    and the SMIL picture), under the size caps: `haste` (a fallen hero with no
    lines), `enrage` (the bandit captain behind a field rat), `camp`,
    `camp-break`, `camp-boss`, `guard`, `guard-huddle` and `guard-hit`, and on
    the compact stage `compact-guard` and `compact-camping`.
    `pnpm stage:parity` lays three across the three surfaces for the eye:
    `parity-haste` over two hasted bob frames, its desktop row the static
    first pattern by design and labelled so, `parity-guard` over the huddle
    in and the hit on the shield, and `parity-camp` over `camp_leave` and
    `camp_return`.
- Stage moments and lines of the pull (spec #132). Each has a golden
  scenario, `travel`, `level-up`, `victory`, `boss-kill-travel` and
  `boss_move`, on every surface (the Raster, the Image and the SMIL picture),
  under the size caps.
  - **Travel**: on `traveled` the heroes step off toward the right
    (`TRAVEL_PX`), fading over 500 ms (`TRAVEL_OFF_MS`); the enemies the travel left
    stand until the backdrop changes to the destination's at the end of it,
    then go with no dissolve; the heroes step on from the left over 500 ms
    (`TRAVEL_ON_MS`). The backdrop change is a travel's show time, answered by
    the timeline as it answers a zone arrival's, and the log line
    "The party travels to zone 3, Marsh of Sighs." is a held line that lands
    then. A
    travel raises no toast and no cue. A stage never drawn plays nothing.
  - **Level-up**: the hero flashes gold, the hit flash's mechanism with a gold
    fill (`LEVEL_RGB`), and its gains rise over it as a gold number, `+3 atk
    +2 def`, atk, def and spd in that order, zero gains and HP left out. The
    number rises over 1.2 seconds (`LEVEL_NUMBER_MS`), where a hit's takes
    700 ms. Several level-ups in one group play one after another by party
    slot: the first at the blow's impact (or the group's time with no blow
    shown), each next 250 ms later (`LEVEL_STAGGER_MS`); a lone one plays at
    the first's time. The engine computes the gains from the hero's stats
    before and after the tick and hands them to the stage with the effect.
  - **Victory**: when a zone boss falls, after its dissolve, every hero holds
    the `victory` pose for 2 seconds (`VICTORY_MS`) and the boss's row is held
    with it, so the backdrop change and the arrival's words move after the hold.
    When the kill advances the zone (Push on: the `zone_cleared` effect names a
    higher zone), the party then walks on as a travel does: the step-off over
    `TRAVEL_OFF_MS` once the hold and any chest have both ended, whichever is
    later, the backdrop change as it ends, the step-on over `TRAVEL_ON_MS`. The
    boss's row is held through the step-off, so the arrival's words land at the
    new zone's first frame. With Farm here the party holds and does not walk.
    The pose is a slot: the drawn 1.5× victory frame of the hero's class where
    the manifest has one, its idle where it has none, on every surface, and the
    idle always on the compact stage (ADR 0007, ADR 0018). A turn boss and the world boss get no hold.
  - **Boss moves** (§4.2): the log prints "Gorvax strikes twice!" as the act
    starts, then each hit's own line; "Gorvax heals itself for 40.", the White
    Mage's light burst playing on the boss, in place; "Gorvax's rage grows!" on
    the `raging` effect. The whole-party hit has no line of its own: it prints
    the existing "hits 3 foes" line, and the stage plays it as the Black Mage's
    spell is played, one lunge and every hit landing at once. Strike twice
    lands both numbers at the lunge's one impact. These three lines and the
    travel line are keyed as lines that are never dropped.
  - The weekly hunt's reward logs "Your share of the hunt: 120G and Oak Staff.";
    an achievement step and a goal met print no line.
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
  room for it. The world boss shows in the enemy window instead. The records
  row (highest zone, kills, wipes) carries the weekly hunt (§6) after the kills:
  `Hunt: casters ████░░░░ 12,400 / 20,000, 3 days left`, the bar eight cells,
  dropped before the segment when the row is narrow, and `1 day left` or the
  hours under a day. With its flag off the row ends in `hunt is off`, or `world
  boss and hunt are off` with the boss off too, as on the in-process fake.
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
  Market and Orders in phase 2; Chat and Leaderboards in phase 3; Journal with
  the pull. Opened with focus, closes on Escape, holds toasts. The tab window
  reads Inventory `i`, Heroes `h`, Market `m`, Orders `r`, Account `a`, Odds
  `o`, Journal `u`, Chat `c`, Leaderboards `b`.
- All nine tabs draw as Dragon Quest V windows (UI PR 2 and 3, ADR 0005): a tab
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
- Journal tab (`u`, spec #132): the player's record. Its hotkey is `u`, not
  `j`, because the rung under the picture on the desktop, VS Code and mobile
  keeps `j` and `k` for ▼ and ▲, the one way those surfaces' keyboard moves the
  ▶; Unequip in the Inventory command window moves to `n`, since the tab
  hotkeys mount on every tab. The list: under a `Today` rule, the day's goal
  ("Kill 150 enemies") with its progress `n/target` or `met`, then `Resets in
  5 h · streak 3 work days` from the server's now; under a `Bestiary` rule, one
  row per base zone reached (all twelve past tier 1), `Zone 3, Marsh of Sighs`
  with its enemies defeated out of six; then `Collection` with the bases held
  and `Achievements` with the steps crossed. The goal shows on open, derived by
  `dailyGoal` from the view; its progress, the reset and the streak come with
  the `journal` read, loaded on open as the leaderboards load, with the same
  busy row and error flash, and `…` in their place until it answers. Enter on a
  zone opens its page: the four wave enemies, the zone boss and the turn boss,
  each with its seen and defeated counts and a `*` once defeated, then `Travel
  here` (`t`), or past tier 1 one `Travel to tier 2, zone 3, …` line per tier
  reached, left out for the zone the party is in and disabled for a secondary.
  Enter on Collection pages the 35 bases with the five rarity letters `C U R E
  L`, lit in each rarity held; Enter on Achievements pages each ladder as one
  row of step marks with the next step's gold and the last step's date, and
  each one-off with its mark and date. `q` backs out of a page. The tab fits one
  line at 100 columns and wraps below as the frame does. A session that is not
  playing reads the Journal and writes nothing.
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
  not the machine's: a secondary session shows it read-only), "Rest days: Sat,
  Sun" (spec #132; the account's too, read from the journal the tab loads on
  open: Enter opens a pick of the seven days with the two in force marked, the
  second day picked sends `setRestDays`, the row then reads "Rest days: Sat,
  Sun (Tue, Thu from Monday)" until that Monday, a refusal flashes in the
  message window, and a secondary shows it read-only), the band shown or
  collapsed, band off, link GitHub (the device flow: a code in
  the detail window, the URL as a link under the picture, a poll), and a reset
  of this machine's data, which asks Yes or No and opens on No. The detail
  window holds the server, the client, the mode and the session. Before a game
  view exists the pane says Promptfall has not started, and Account still
  offers the reset.
- `/promptfall off` switches the band off for the session. `/promptfall farm`
  toggles the farm flag. `/promptfall go` breaks camp as `g` does and answers
  "Back to the fight.", or "The party is not camping." when it is not. `/promptfall journal` opens the pane on the Journal.
  `/promptfall travel <zone>` sends `travel` (§4.2) and answers
  "The party travels to zone 3, Marsh of Sighs." or the refusal in words: a
  zone that is not a number answers the usage, one past the highest reached
  names the highest it can go to, the zone the party is in says it is already there, a
  world boss fight says travel waits until it ends, and a session not playing
  or paused says so. `/promptfall autovendor on|off` sets the auto-vendor
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
| recruit | rare good news | long | `Rare recruit: Mira the Bold` (rarity word from the hero) | never folds | recruit |
| reward | rare good news | long | `Your share of Gorvax: 120 gold and Ironwood Staff` (gold alone, or the hero's name for a hero; `the world boss` when the boss's name is not known); a hunt reward, `Your share of the hunt: 120 gold and Oak Staff` | never folds | none |
| retreat | wants a decision | long | `The party retreats to zone 3, Marsh of Sighs` | never folds | retreat |
| world boss appeared | rare good news | long | `World boss Gorvax has appeared` | n/a (one at a time) | boss |
| revoked | wants a decision | long | `The server revoked Ironwood Staff`, or `The server revoked an item` when the name is gone | `The server revoked 3 items` | none |
| wipe | wants a decision | short | `The party fell, back to wave 1 of zone 4, Old Barrow Hills` | never folds | none |
| zone arrival | wants a decision | short | `The party reached zone 4, Old Barrow Hills`, at the backdrop change | never folds | zone_cleared |
| rare / epic drop | rare good news | short | `Rare drop: Ironwood Staff` / `Epic drop: …`, at the reveal; epic before rare in one burst | never folds | drop |
| vendored, Rare or better | wants a decision | short | `Inventory full: Ironwood Staff vendored for 40 gold`, at the reveal | never folds | none |
| level up | rare good news | short | `Aldric reached level 5` | `Aldric reached level 6, Morwen level 4`; same level: `Aldric and Morwen reached level 6`; one hero several levels in a burst: the highest only | level_up |
| achievement | rare good news | short | `Achievement: a thousand kills, 1,500 gold` (the step's words from the table, on a credit with reason `achievement:<id>:<step>`) | never folds, oldest first | goal |
| goal met | rare good news | short | `Daily goal met: 40 gold` (a credit with reason `goal:<day>`) | never folds | goal |
| sold | money moved | short | `Ironwood Staff sold for 120 gold` | `3 items sold for 410 gold` | none |
| bought | money moved | short | `Ironwood Staff bought for 120 gold` | `2 items bought for 300 gold` | none |
| returned | money moved | short | `Ironwood Staff returned, unsold` | `3 items returned, unsold` | none |
| world boss down | rare good news | short | `World boss Gorvax is down` | n/a | none |

  The achievement and goal met rows read the reason the gold effect carries
  (§7); a credit whose reason they do not know, a bot's stipend or the
  sandbox's gold, toasts nothing.

  Four toasts sit outside the table, raised by the session rather than from a
  burst. The welcome: a first launch toasts `Welcome to Promptfall. /promptfall
  heroes to meet your party` at the host's default length, and the band holds a
  notice for 20 seconds: `Sound on; /promptfall sound off silences it. Welcome
  to Promptfall. /promptfall heroes to meet your party.`, or the toast's text
  when the sound setting is off. The sound clause leads so the band's one notice
  row shows the opt-out whole from 100 columns up. The sound news: the session
  that rewrites a stored boolean sound setting leaves the news in the store, and
  the first primary to start after the rewrite toasts it once, at the long tier,
  `Sound is now on by default. /promptfall sound off silences it.` A boss already up at the first world poll
  toasts the world boss appeared row's text and tier with no cue: the boss is
  news, not a fight starting. The session summary (spec #132), beside the
  welcome: the plugin keeps two records per server setting beside the shown
  cursor, each carrying its account id (another account's reads as none), and
  under the store's prefix, so a reset wipes them. The snapshot holds the
  counts the summary is a difference from (kills, zone bosses, the sum of the
  roster's levels, the Rare, Epic and Legendary drops from the tallies, the
  gold earned, the highest zone) and is taken when a session becomes primary.
  The stamp is when the account was last seen playing, written by the primary
  every 5 minutes, as it stops, on a server switch and as it hands over. When
  a session becomes primary and the stamp is this account's and more than ten
  minutes old, it toasts at the long tier with no cue and holds the line in
  the message window for 20 seconds, as the welcome does: `Since Tuesday: 412
  kills, 3 bosses, 2 levels, 1 Legendary, 2 Epics, 1,200 gold, zone 5 reached.
  Today's goal: kill 40 enemies.`, the weekday when a day or more has passed
  and `Since your last session` under a day, parts at zero left out, nothing
  said when every part is zero. Then it retakes the snapshot. A younger stamp
  says nothing and keeps the snapshot, so a short break loses nothing. A first
  launch toasts the welcome and only takes the snapshot.

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
  common or uncommon drop, a common item vendored, chat, a reactive event (the
  stage and the log show it, and it plays no cue), a travel (the stage and the
  log show it).

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
  never folds yields one toast per effect. Each achievement keeps its own
  toast with its step's words and gold, oldest first. A toast with a show time
  never folds: each lands at its own show time. A folded name list shows up to three
  names, then "and N more". A folded level-up joins its heroes with "and" only
  when every hero reached the same level; otherwise it has one clause per hero,
  in effect order.

- Sound: a per-machine volume with four steps, off, quiet, normal and loud,
  passing the engine gains of 0.25, 0.5 and 1. Quiet is the default. `s` on the
  Account tab cycles the steps and `/promptfall sound off|quiet|normal|loud`
  sets one; `on` means quiet. A boolean stored before the steps reads as quiet,
  true or false, since the renderer probe wrote it on every install; the session
  that reads it rewrites it as quiet and leaves the sound news in the store, and
  the first primary to start after the rewrite toasts it once.
  The setting survives a reset. Eight cues, each riding a toast row (the table's
  cue column). Only the primary session plays them; `/promptfall off` hides the
  band, not the cues. On a terminal, the first play skipped or rejected marks
  the session silent: it tries no more cues, the Account row reads
  `Sound: quiet, silent here` and the detail window says this system has no
  audio player and the setting is kept. The mark is not stored, so the next
  session tries again, and the desktop never sets it.
- Item sprites (phase 4): 16 px icons in the Inventory and Heroes list
  windows and the Market's on Image and Svg, none on half-block terminals (the
  raster windows leave the two cells blank).

## 11. Art (phase 4)

Style reference is early Final Fantasy; its own sprites and signature designs
are excluded (no black mage with a shadowed face and glowing eyes under a wide
brim, no white mage with red triangle trim, no archer in a green pointed cap).

- Heroes, monsters and items in the NES style. A sprite may use 16 colours: its
  1.5× art, for the stage on every surface, fits 24 × 24 with at most 16
  colours from a shared 128-colour master; its 1× art, for the compact stage
  and the list windows, fits 16 × 16 with at most 4 colours from
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
  Nothing third-party ships. The eight cues are generated by the repo's script
  (`scripts/cues.ts`, `pnpm cues`) in integer arithmetic, mono 16-bit at
  22,050 Hz, each under 900 ms at one common peak; `pnpm cues:check` fails CI
  when the committed clips are stale.
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
