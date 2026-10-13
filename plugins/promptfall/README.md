# Promptfall plugin

The Claude Code mod half of Promptfall. It runs the sim locally, sends the events in batches to
a ledger, and draws a band above the prompt. By default the ledger is the public server at
`https://promptfall.kevinshibuya.com`; `/promptfall server local` runs it inside the plugin instead,
persisted through `$.store`, and `/promptfall server <url>` points it at any other HTTP server, such
as the fake in `servers/fake`.

## Play

Install it from this repository's marketplace in a Claude Code session:

```
/plugin marketplace add kevinshibuya/promptfall
/plugin install promptfall@promptfall
```

The band appears above the prompt once the session starts. Your three heroes fight on their own.
Every tool call Claude makes spawns an enemy, at most three fight at once and ten wait in a queue.
A turn with ten or more tool calls ends with a turn boss. Each prompt you submit heals the party
50% and revives the fallen at 50%. With nothing alive, the next enemy of the wave walks in, so an
idle session still fights, one round every 5 seconds instead of every 2.

A zone is ten waves and a boss. Beating the boss moves you to the next zone. A wipe sends you back
one zone at full health and costs nothing else.

### Commands

| Command | What it does |
| --- | --- |
| `/promptfall` | Opens the dialog on the Inventory tab |
| `/promptfall heroes` | Opens it on Heroes (also `inventory`, `market`, `orders`, `account`, `odds`) |
| `/promptfall chat` | Opens it on Chat; Enter on a row moves to the compose field |
| `/promptfall leaderboards` | Opens it on Leaderboards and loads the boards |
| `/promptfall journal` | Opens it on the Journal and loads the day's goal, the streak and the achievements |
| `/promptfall off` | Hides the band for this session; the game keeps playing |
| `/promptfall on` | Brings it back |
| `/promptfall farm` | Toggles farming: a beaten zone boss restarts the zone instead of advancing |
| `/promptfall travel <zone>` | Moves the party to a zone it has reached, ending the fight with no drops and no XP |
| `/promptfall server` | Says which server this machine plays on: the public server, `local`, or a URL |
| `/promptfall server <url>` | Plays on the HTTP server at `<url>`, for every session on this machine |
| `/promptfall server local` | Plays on the in-process ledger, offline: no chat, no world boss |

### Servers

With no server set, the machine plays on the public server. `local` is a setting of its own, so
the in-process ledger is only ever an explicit choice, and the sandbox plays in-process whatever
the setting says. Each server keeps its own account: nothing moves between them, so the first switch to a server
starts a fresh one there. The setting is machine-wide and a session that is not playing follows
it within 10 seconds. When the server stops answering, or refuses a batch, the message window reads
`Promptfall: server unreachable, retrying`, the band keeps ticking and buffering for two minutes,
then it reads `Promptfall: server unreachable` and progress stops until the server is back. A
switch during an outage drops what could not be sent, and the reply says how many events.

### Market

Rare, epic and legendary items and heroes trade between players. The Market tab (`m`) browses
listings ten at a time. `f` (the `Filters` row) opens the filter window: Kind and Sort flip in
place, Base (items), Class (heroes) and Rarity open a pick. `Previous page` and `Next page` are
rows at either end of the list. Enter on a listing asks `Buy <name> for <price>G?`; `y` buys, `n`
or `q` backs out. Your own listings read `yours`. The goods arrive with a 24-hour cooldown before
they can be listed again, and a bought hero arrives at level 1.

Sell (`s`) in a Rare+ item's or hero's command window opens the sell window. An item lists the
buy orders it matches first, each with what you get: Enter on one sells at once at the order's
price. Then Set a price moves you to a price field under the picture; the message window shows
the listing fee (2%, at least 1 gold, kept on cancel) and what you get after the 5% sale fee,
and Enter lists it. A hero must be out of the party and wear nothing; goods in cooldown say when they
become tradeable. Listings and orders expire after 7 days.

The Orders tab (`r`) lists the count of returns waiting (cancelled goods that found no free
slot; they arrive when one frees), your listings and your buy orders. Enter on one asks to cancel
it: a listing keeps its fee, an order's held gold comes back. `New buy order` opens a form in the
detail window's place: a base, a minimum rarity and an optional affix (each a pick), then a
maximum price in the field under the picture, held in escrow until the order fills, is cancelled
or expires. Enter in the field, or `Place order`, places it. Trading needs a linked account and an
open market; cancelling works either way. Sales, purchases and returns toast and show in the
loot log.

### World

Every session polls the server's world every 15 seconds, every 5 while the Chat tab is shown, and
never blocks the game on it: a poll that fails is skipped and the next one tries again. The
band's World tab (`w`) has three rows: who is online and who shares your zone
(`13 online · zone 1: Ashgrove, Brindle`, or `nobody else here`), your highest zone, kills and
wipes, and the last chat line. The first row dims when no poll has answered for 45 seconds.

The Chat tab (`c` in the dialog) shows one message a row, newest at the bottom, with the ▶
message whole beside the list. Up pages back through the last 200. The compose field sits under
the picture but is not focused when the tab opens, so the tab keys still work: Enter on any row
puts you in it, Enter there posts, and Tab leaves it (Escape closes the pane). Posting needs a linked account, and any session may post, the one playing or
not. The server refuses, and the tab flashes for 5 seconds: a line over 200 characters (an emoji
counts two), more than 5 quick messages (then one every 10 seconds), a blocked word, or an empty
line. During an outage a post answers `Server unreachable`. On mobile the tab is read-only.

The Leaderboards tab (`b`) shows who is online by zone, the 20 highest zones reached, and this
week's world boss damage (the week starts Monday 00:00 UTC). Your rows are gold. Names are GitHub logins; an unlinked account shows as `adventurer`.

Each part sits behind a server flag: when the server turns chat, presence or the boards off, the
tab says so within one poll. The in-process ledger has chat off: its World tab reads
`1 online` and `chat needs a server`, and the Chat tab says how to reach one.

### World boss

A world boss spawns every 3 hours on the server's clock (00:00, 03:00, ... UTC) and lives 20
minutes or until it dies. Its HP is 4,000 for each account online when it spawns (one share when the
server turns presence off). Every account
online is engaged at the spawn, and one that comes online later is engaged on its first poll.
Engaged, the party fights the boss instead of waves: tool calls spawn nothing (they still count
toward the turn boss), a wiped party has every gauge emptied and is healed in place with no
retreat, and nothing drops, since
the boss never dies on your side. The server counts the damage your committed batches dealt.

The band shows it in the enemy window on every tab: the boss with its bar and percentage, the
window titled `World boss · 11m`. The bar is the server's HP less the damage your party has landed
on the stage since the last poll, so it drops with the hits you watch. Under 116 columns, where the
compact window has no enemy window, its title reads `World boss 11m` in the wave's place. Toasts
say when a boss appears and when it is down. While a boss is live every session polls the world every 5
seconds.

Rewards land when the boss dies, or when its window ends: a guaranteed boss-rarity item for 200
damage or more (5% of the base), and on a kill one bonus roll each for the top 3. Each reward
toasts `Your share of <boss>: <gold> gold and <item>` and shows as `boss reward <item> (+<gold>g)`
in the loot log. An item with no free slot toasts `Your share of <boss>: <gold> gold` instead, waits in the returns
queue, and arrives as a `returned` loot line when a slot frees. The boss
board counts every hit, past the boss's remaining HP too.

The game is at sim version 5 (`SIM_VERSION` in `packages/sim/src/types.ts`), and the plugin's
version moves with it. A store or a fake snapshot from an older sim is migrated by the ledger the
first time it loads it, in process as on a server; only one the migration chain cannot carry (a gap)
stays behind, and then the band reads the older-version notice and `/promptfall account`, `Reset
this machine's data` starts a fresh account. A server whose sim is newer than the plugin's pauses play with `Update Promptfall:
/plugin update promptfall`. The in-process ledger runs no world boss outside the sandbox.

### Account tab

The settings are rows: Sound (`s`), Motion (`n`), Renderer (`x`), then the band shown or
collapsed and Band off. `Link GitHub` shows a code in the detail window and the link under the
picture, and polls until the server approves it, then reads `Linked as <login>`. The fakes approve on the first poll: the in-process ledger links you as
`player`, the HTTP fake as its `--player-name`. The polling belongs to the session, so closing the
dialog does not stop it. `Reset this machine's data` asks Yes or No, opening on No, then deletes
every Promptfall key in the store but the lease and starts a fresh account on the same server. It is how a state from an older version
the server could not migrate is cleared: the band then reads the older-version notice and the Account tab is the
one tab that still works.

### Hotkeys

The band takes keys after a click, or after `ctrl+x` then Tab with Ctrl released (`ctrl+tab` does
not focus it). Letters only: a bare digit at an empty prompt
would answer a survey.

| Key | Band | Dialog |
| --- | --- | --- |
| `p` / `l` / `w` | Party, loot log, world tabs | |
| `c` | Collapse to one row, or expand | |
| `i` / `h` / `m` / `r` / `a` / `o` / `u` | | Inventory, Heroes, Market, Orders, Account, Odds, Journal tabs |
| `c` / `b` | | Chat and Leaderboards tabs (outside a field) |
| `y` / `n` | | Yes or No |

### The pane

Every tab is windows: a list with a ▶, the ▶ row's details beside it (or under it below 96
columns), and a message window at the foot saying what the keys do.

| Key | Does |
| --- | --- |
| Tab, Shift+Tab, ↑ ↓ | Move the ▶; long lists page, with a `16-30/40` footer |
| Enter | Open the ▶ row's command window, or run the item under the ▶ |
| `e` `n` `s` `v` `f` | Equip, Unequip, Sell, Vendor, Reforge (an item's command window) |
| `p` `s` `d` | Party (or Unpick), Sell, Dismiss (a hero's command window) |
| `f` | Market: the filter window |
| `t` | Journal: travel to the open zone page's zone |
| `s` `n` `x` | Account: sound, motion, renderer |
| Tab | Leave a field (the sell price, the order price, the chat line) |
| `q` | Back out of a command window, a pick, a Yes/No, a Journal page, the sell window or the order form |

Vendor, Dismiss, Buy, the two cancels and Reset ask Yes or No first. Party picks three heroes one at a time; the third sends
the new party, which takes the field at the next zone boss kill or wipe. The last row of Heroes recruits.
On the desktop, VS Code and mobile a `▲ ▼ ok back` row under the picture does the moving.

The windows need 16 rows with the tab window and 14 without it. A short pane drops the tab
window (the tab keys still work), so an inline pane in a 105 × 50 Terminal.app draws every tab.
At 80 × 24 it gets 7 rows and asks for more room; in fullscreen from 110 columns the pane docks
beside the conversation at full height.

Esc closes the dialog, from a sub-window too. The band collapses to one row by itself under 100 columns or when fewer
than 6 rows are free, and hides while Claude asks you a question.

### Stage

The band's Party tab draws the battle as pixel art: enemies on the left, the party on the right,
lunges, white flashes and damage numbers on each hit, a dissolve when an enemy dies and a chest when
it drops loot. Behind them hangs the zone's backdrop, one painting per zone, bottom-anchored and
centred (ADR 0009); the compact stage, and a zone without a painting, stand on a one-row ground
strip in the zone's colour.

Every window of the band draws the staged state (`hooks/stage/staged.ts`): the fight as the stage
has played it, the game's state less the hits, heals and deaths still to land. A hero stands until
the blow that kills him lands, a killed monster keeps its row until its dissolve and any chest have
played, the enemy window's title and the backdrop stay on the wave and zone being watched, and the
world boss bar drops as your party's hits land. Toasts read the game's state, so a wipe toast can
come up to one cadence before the last hero falls on the stage.

- **Choreography.** One action, from its start, in ms. Every attacker holds its wind-up frame in
  place for 140 (`WINDUP_HOLD_MS`), then moves in its shape; at impact the target shows its hit
  frame for 160 (`FLASH_MS`), and the number rises from it. Every attacker also takes the step:
  4 px forward at 1× and 6 at 1.5× (`STEP_PX`, the same for a goblin and the world
  boss), out over the first 80 of the hold (`STEP_OUT_MS`), held, and back over the last 80 of
  the action. The lunge thrusts from the stepped position, and numbers and effects measure from
  it. On the SMIL `Svg` the step is a translate on the actor's group; at 1× it moves the one
  drawing. Motion still keeps it, as it keeps the lunge.

  | Shape | Who | Frames and motion |
  | --- | --- | --- |
  | `step` | every attacker | out 0–80 inside the hold, held through the shape, back 420–500 |
  | `lunge` | every enemy | wind-up frame 0–260 (the lunge out from 140), strike frame 260–380 as it comes back; impact 260 |
  | `lunge_follow` | knight | as `lunge`, then the follow-through frame in place 380–500, stepping back from 420 |
  | `bolt` | black mage (fireball), archer (arrow) | wind-up in place 0–260, strike 260–460 while the effect flies from the attacker's front edge to the target's centre; impact 460, as the attacker steps back |
  | `burst` | white mage, attack and heal | wind-up 0–260, strike 260–460 while the light burst sits on the target; impact 360 |
  | `chest` | a kill that drops an item, from the chest's start | falls 0–300 from the enemy's centre to its ground, landing as the dissolve ends; sits closed 300–600; opens 600–1,100, the opening art to 850 and the open art after |
  | `reveal` | the dropped item, from the chest's start | rises 10 px out of the open chest 1,100–1,400 on a glow in its rarity colour, risen at 1,400 (the show time, `showAt`); holds 800 for a Common, 1,000 Uncommon, 1,200 Rare, 1,600 Epic, 2,000 Legendary (`REVEAL_HOLD_MS`); fades with the chest over 200 |

  `ACTION_MS` is 500, the hold and the knight's shape; the step plays inside it and costs no
  time. An `attack_all` plays one effect per target. A hit that comes without an action (a
  resync, a delivery) lands at 120, shows the hit frame and takes no step.

  The chest shows its three arts (`chest:closed`, `chest:opening`, `chest:open`) by phase on
  every surface. The glow is a disc in the item's `RARITY_RGB` behind the chest and the risen
  item, on the item's centre: its alpha ramps to 0.5 (`GLOW_ALPHA`) over the rise, holds, and
  fades with the item; its radius is 8 px for a Common to 12 for a Legendary at 1×
  (`GLOW_RADIUS_PX`), scaled with the item's art. The pixel surfaces dither it as they dither a
  fade; the SMIL `Svg` draws it as one circle with its opacity animated, and the chest's arts as
  defs shown in turn. The next enemy steps on 800 after the fade (`WAVE_GAP_MS`).
- **Poses.** At 1.5× each actor has six drawings: idle A (its 1.5× art), idle B, the wind-up,
  the strike and the follow-through (drawn frames, from the manifest; a hero's strike is its
  `hero_attack` art), and the hit. At rest it alternates idle A and idle B on the bob's clock
  (B in the second half of each second), with no vertical bob. Idle B and the hit are derived
  from idle A at draw time (`hooks/sprites/derive.ts`): idle B drops the figure's middle row and
  moves the rows above it down one; the hit leans the figure back from its facing side by one
  column per 12 rows, in a palette lightened by gamma 0.6, and the white flash blinks for 100 ms
  (`BLINK_MS`). At 1×, on the `Raster`, the compact stage and the 1× `Svg`, an actor keeps one
  drawing (a hero shows its attack art through the wind-up and strike) with the 1-pixel bob and
  the 160 ms flash, as before. A fallen hero shows idle A and never takes a hit frame.
- **The `Svg` frames.** At 1.5× under SMIL each actor carries idle A and idle B on the bob's
  clock and the frames in use, one visible at any instant: the frames of motions live at the
  redraw or starting before the next one (167 ms), with the rest of the same action. Idle B is
  two uses of idle A's def under row clips; the hit is idle A's def under one row clip per
  column of lean and a gamma filter; the drawn frames are defs of their own while in use.

- **The band is one picture** (ADR 0011): a playfield on a shell. The shell is the windows'
  charcoal and fills the band's whole box. The playfield sits on it, `min(columns, 160)` wide and
  centred: on Party the stage with the strip beneath it, on Loot and World the strip alone at the
  same width and centre. One white line with cut corners, the strip windows' own, goes around
  the playfield. It sits in the shell's margin when the band is wider than 160 columns, and over
  the stage's outermost pixel row and column and the strip's outer line when the playfield fills
  the band, so it costs the stage no row or column. Nothing sits between the stage's bottom edge
  and the windows' top lines.
- **Renderers.** Kitty, Ghostty and cmux draw the band as one `Image`, keyed by its cells so only
  a resize mounts a new one. Every other terminal (iTerm2, Terminal.app, tmux) draws it as one
  `Raster`: the stage in half-block cells, two pixels per cell, with the numbers as text, and the
  strip and the line in box-drawing text. The `Image` takes at most 255 columns, so past that the
  shell stops, centred, and the terminal shows on either side; the `Raster` takes 512. The
  `Raster`'s line takes the margin only when it has two cells a side, so 160 to 163 columns draw
  like 160. Over the stage's top row the `Raster`'s line opens where an actor's art reaches it, so
  a boss keeps its head. Ghostty and cmux fit the `Image` to its cell box keeping the picture's
  aspect, centred, rather than stretching it (checked 2026-10-09, Ghostty 1.3.1, cmux 0.64.25,
  Claude Code 2.1.296, `spikes/aspect`). The band is drawn at 8 × 16 pixels a cell; their cells
  are a little taller than that (16 × 34 screen pixels at Ghostty's default 13 pt), so a thin
  strip of terminal shows above and below the band, about two thirds of a row in all, split
  evenly. The desktop app draws two `Svg`s, the stage's and the strip's, since one of both would
  pass the engine's 131,072-character cap. Each is the band's width and draws its share of the
  shell and the line (the stage's the top and sides, the strip's the sides and bottom; on Loot and
  World the strip's draws all of it), so stacked they read as one picture. The stage is always
  the full stage there: 116 to 160 columns, so 174 to 240 pixels of 1.5× art, scaled to the
  band's width (ADR 0004, ADR 0006). The desktop scrolls a band taller than its `maxRows`, so the
  stage there is scaled down to the rows left and sits centred on the shell. The stage is an image
  `Svg`: SMIL plays in it and a redraw swaps it without a blank frame.
- **Two art densities.** The full stage on an `Image` terminal and on the desktop draws the 1.5×
  art: `stageAt(…, { scale: 1.5 })` multiplies every stage-pixel distance by 1.5, so a 120 × 8
  stage is 180 × 24 pixels. The band's `Image` is a PNG on the windows' grid, 8 × 16 pixels a
  cell, with each 1.5× art pixel drawn nearest-neighbour over 16/3 of them; at 255 columns and
  22 rows it is 2040 × 352. Damage numbers draw their 3 × 5 glyphs in 2 × 2 blocks. The `Raster`, the compact
  stage and the list windows keep the 1× art, since a half-block cell shows one pixel per column.
  The desktop `Svg` falls back to the 1× art for a frame whose 1.5× markup would pass the
  engine's 131,072-character cap; legal art stays under it (ADR 0006).
- **The probe.** Nothing says which terminals draw pictures, so the band asks: its status row draws
  a one-pixel `Image` and, 300 ms later, swaps it with `$.ui.blit`. A swap that is taken means
  pictures; a deny naming the alt means half-blocks; any other answer asks again on a later draw.
  Until the answer lands the band's rows stay empty, laid out by the verdict the last probe on
  this machine recorded (`probed` in the settings, apart from the player's `renderer`), or by the
  half-block rules before any. So the band holds its height from the second session on, and may
  change it once on a first run or after a terminal change.
- **Heights.** The Party tab is 22 rows in every fight: 17 for the stage, the boss height, so the
  party stands small on the zone's painting and a boss lands at its full size (ADR 0010), and the
  5-row window strip, inside the line. A band too short for that shows the whole scene smaller,
  still the playfield's width with the strip under it: an `Image` zooms it out into the rows left. A `Raster` cannot scale, so it keeps the art size and shows the
  stage's bottom rows, the sky cut, down to the tallest actor on it (8 rows for the party, 12
  with a turn boss, 17 with a boss), then goes compact.
- **Compact and collapsed.** On terminals, the full stage needs 116 columns, and rows above the
  strip: 4 for an `Image`, the tallest actor's height for a `Raster`. With 100 to 115 columns, or
  fewer rows, the band is one 6-row picture on the shell: a 52-column, 4-row stage beside one party
  window (three hero rows, the front enemy, the command line in its border) inside one line, the
  window's own top, bottom and right lines serving as the line's. Under 100 columns or 6 rows it
  is one row of text with no shell. Loot and World are the 5-row strip alone and draw no stage.
- **Override.** `/promptfall renderer image|raster` forces a renderer on this machine and
  `/promptfall renderer auto` returns to the probe. It applies at the next session start.
- **Frames.** The render hook draws the first frame; a timer per surface blits the rest, about 12
  a second while something moves and 2 a second at rest (the idle bob). On a terminal each blit is
  the whole band picture, the stage frame with the current strip, so a strip change alone (a log
  line typing out, a gauge filling) redraws it; on Loot and World the loop blits the strip alone,
  paced by the gauges. A hidden or collapsed band blits nothing. The desktop's `Svg` animates itself with SMIL and redraws once a
  round.

### Sound and motion

- **Sound** is on by default, at quiet. `/promptfall sound off|quiet|normal|loud` (or `s` on the
  Account tab, which cycles the steps) sets the volume, at a quarter, half or all of the engine's
  default gain; `on` means quiet. The cues ride their toasts: a Rare or Epic drop, a Legendary
  drop, a level up, a world boss appearing, a zone arrival (the zone-cleared cue), a recruit and
  a retreat, with a goal cue waiting for its toasts. Each plays only in the session that is
  playing (the primary); a secondary stays quiet. `/promptfall off` hides the band but keeps the
  cues. The engine plays sound on macOS and in the desktop app; a terminal elsewhere has no
  player, so the first cue it skips marks the session, which tries no more, and the Account row
  reads `quiet, silent here`. The eight clips in `cues/` are generated by the repository's
  `scripts/cues.ts` (`pnpm cues`).
- **Motion**: `/promptfall motion still` (or `n`) stops the idle bob, and at 1.5× the idle pair:
  each actor shows idle A at rest. Attacks, hits, dissolves and drops still play.
  `/promptfall motion full` brings the bob back.
- **Renderer**: `/promptfall renderer auto|image|raster` (or `x` to cycle), see Stage.

All three are per machine, kept in the plugin store under `promptfall:settings`; a reset keeps
them.

### What phase 1 has

Combat, waves, zones, bosses, loot with rarities and affixes, equipping, vendoring, reforging,
a tavern, hero contracts from bosses, party swaps that apply at the next zone boss kill or wipe, inventory
and roster expansions, and published odds. Progress lives in the Claude Code store on this
machine. One session at a time plays: another session shows `playing in another session` and
takes over within about 10 seconds of the first one quitting. Typing a prompt or `/promptfall` in a
session makes it the one that plays at once.

### What it lacks

No mute or ban: the word list is
the only filter. The GitHub link is approved by the fakes, not by GitHub, and the in-process ledger
has no bots, so its market is yours alone and its chat is closed.

## Develop

To play from a checkout, load the plugin from the repository root in an interactive session:

```sh
pnpm install
claude --plugin-dir plugins/promptfall
```

To trade with bots offline, run the HTTP fake and point the plugin at it:

```sh
pnpm fake --port 7777 --speed 10        # one terminal: the fake, with 12 bots
# --flag chat.enabled=false (repeatable) turns a server flag off
# --boss-in 60 brings the next world boss a minute out (a dev flag)
# --store sqlite:.promptfall/fake.sqlite runs on a SQLite file instead of the JSON one
# --host 0.0.0.0 binds every interface instead of loopback (the container does)
/promptfall server http://127.0.0.1:7777   # in the Claude Code session
```

A `--plugin-dir` folder reloads on save. The game packages live in `packages/`, and a mod can
import only files inside its own folder, so `pnpm vendor` bundles them into `hooks/vendor/`.
Run it after changing `packages/sim`, `packages/protocol` or `packages/ledger` and commit the
result; it also bundles the zlib part of `fflate` for the stage's PNG frames. CI fails when
the bundles are stale (`pnpm vendor:check`).

The `promptfall-content` skill's reference, `.claude/skills/promptfall-content/reference/content.md`,
is generated from the sim's content registry. Run `pnpm content` after changing a zone, enemy, item
or hero in `packages/sim` and commit the result; CI fails when it is stale (`pnpm content:check`).
The pixel font's glyphs work the same way (`pnpm font`, `pnpm font:check`).

Two rules of the mods runtime shape the code. A hook may not pass `$` or `$.store` on, so
`register.tsx` hands the rest of the code closures written at the hook. And `claude plugin
validate` reads an atom only where the calling module declares it, so each module declares the
atoms it uses.

```sh
claude plugin validate plugins/promptfall
claude plugin test plugins/promptfall
pnpm typecheck:plugin
```

A change to a rendered surface also runs the desktop smoke. `pnpm smoke:desktop` loads each stage
golden scenario's desktop Svg, SMIL on, in headless Chromium and fails on the first one whose root
does not render, that logs a console or page error, or that reaches the Svg cap. It first checks
that broken documents fail. It needs Playwright's Chromium once: `pnpm exec playwright install
chromium`. CI runs it after the tests.

`tsc -p plugins/promptfall` needs the engine's declarations, which an interactive
`claude --plugin-dir plugins/promptfall` lays under `.claude-plugin/types/` on first load. They
are generated per Claude Code version and stay uncommitted. In a worktree that has none,
`pnpm typecheck:plugin` copies the main checkout's first.

### Sprites

The art lives in `art/` at the repository root and becomes one generated module,
`hooks/sprites/generated.ts`. Never edit that file: run `pnpm sprites` and commit the result. CI
fails when it is stale (`pnpm sprites:check`).

- `art/manifest.json` has one entry per sprite id: `hero:<class>`, `hero_attack:<class>`,
  `enemy:<content id>`, `world_boss:<name key>`, `item:<item base>`, and `fallback`. An entry
  names its PNG with `file` (true size, under `art/`), a `style` (`nes` or `snes`), a
  `rarityColor` for heroes (the exact source colour that takes the hero's rarity colour), and an
  optional `fit: { height }`. An entry may instead name an `alias`, a stem that marks the sprite a
  placeholder; `PLACEHOLDER_COUNT` in the generated module counts them, and a plugin test holds it
  at 0. The build fails on a missing or extra content id.
- The real art lives in `art/sprites/<kind>/<name>.png`, cut from gpt-image-2 sprite sheets.
  `art/sheets.md` records each sheet: its prompt, its reference images, the commands that cut it,
  and a Redos table. The raw sheets stay in the gitignored `art/sheets/`.
- `art/palettes/nes.json` is the 64-entry NES master palette (the FCEUX table, duplicates kept so
  the indices match). `art/palettes/snes.json` is the shared 64-colour SNES master, written by
  `pnpm sprites --derive-snes-master` from the opaque pixels of every `snes` entry's `file`
  (aliases are skipped): all 28 bosses and world bosses. It is locked since zone 12's bosses landed;
  re-deriving it changes every boss's art.
- Every opaque pixel snaps to its style's master palette. An `nes` sprite may then hold at most 4
  colours and fit 16 × 16 (smaller art is padded, bottom-centred). An `snes` sprite may hold at
  most 16 colours and fit 48 × 34. The build fails a sprite that breaks either rule, naming it.
- The build also writes a `compact` variant (8 px tall) of every sprite and an 8 × 4 `small`
  variant of every item, for the compact stage and the half-block lists.
- Each sprite has a second drawing, its 1.5× art, for the full stage on `Image` terminals and the
  desktop. An entry names it with `fileHires` (a PNG in `art/sprites-hires/<kind>/<name>.png`)
  and, for a hero, `rarityColorHires`. The 1.5× art snaps to `art/palettes/hires.json`, a
  128-colour master that `pnpm sprites --derive-hires-master` writes from every `fileHires` PNG.
  It may hold 16 colours and fit 24 × 24 (`nes`, padded) or 72 × 51 (`snes`); a turn boss fits
  36 rows. A larger PNG is shrunk to fit, never grown. A hero's `rarityColorHires` slot must be
  one 8-connected region after the snap, or the build fails. An entry without `fileHires` gets
  its 1× art upscaled 1.5 times.
- `pnpm slice <sheet.png> <out-dir> --grid <cols>x<rows> [--row r] --colours n (--size 16 | --fit
  48x34) [--names kind/a,kind/b] [--native <dir>] [--hires <dir>] [--gutters <x,…>]` cuts a magenta-keyed sheet. It finds each
  sprite by the magenta gutters around it (`--grid` counts sprites per row and rows), reads the
  sprite's art-pixel size from its black outline, samples one value per art pixel, then shrinks
  to the canvas by a majority vote that keeps the outline black. `--native` also writes each
  sprite at its own pixel grid, and `--hires` its 1.5× cut: the native fitted to 1.5 times the
  canvas, in 16 colours. A sprite it cannot read is reported and skipped.
- `pnpm grid <in.png>` prints a sprite as text, a legend (`0` is black, `.` transparent) and one
  character per pixel; `pnpm grid --png <in.txt> <out.png>` writes it back. The hero sprites were
  cleaned up this way.
- `pnpm contact --zone <n> | --heroes | --items <a,b> | --world-bosses` renders each built sprite
  at 6× and its 1.5× art at 4× (`-hires`), its native cut at 4× and, for a zone, the stage at
  rest, with its zone boss and with its turn boss, at 1.5× (`stage-*.png`) and at 1×
  (`stage-*-1x.png`), into `.promptfall/contact/<label>/`, for review.
- **Frames.** An entry may name its drawn 1.5× frames with `frames: { windup, strike?, follow? }`
  (PNGs in `art/sprites-frames/<kind>/<name>-<frame>.png`). A frame snaps to the 1.5× master (16
  colours at most) and lands on its idle 1.5× art's canvas: shrunk to fit if larger, then padded
  bottom-centred to exactly that size, so every pose draws at the idle's place. A hero gives
  `windup` (and the knight `follow`) with `frameRarityColors`, one 8-connected region each after
  the snap; its strike is its `hero_attack` sprite's 1.5× art, by identity. Any other entry with
  `frames` gives `windup` and `strike`. The frames are 1.5× art only and do not feed the 1.5×
  master. The build lists every frame whose native's long side is more than 20% off its idle
  native's, or that the fit to the idle canvas shrinks by more than 20%, under `frame size
  drift:`: a report for the redo list in `art/sheets.md`, not an error.
- **Effect sprites.** `effect:fireball`, `effect:light_burst` and `effect:arrow` are ordinary
  `nes` sprites of kind `effect`, with 1× and 1.5× art; the stage moves them during a hero's
  action. They are not content, so `scripts/sprites.ts` lists them in `EFFECT_IDS`.
- `pnpm refsheet <out.png> --columns <n> --cell <w>x<h> --scale <k> <kind/name|blank>,…` lays out
  a frames sheet's reference: each sprite's 1.5× art scaled `k` times on magenta, bottom-centred
  in its cell 24 pixels above the floor, so the image model reads column n of the reference as
  column n of the sheet.
- `pnpm slice … --gutters <x,…>` reads those sheet columns as ground when finding the gaps in a
  row, for sprites that touch; beside a forced gutter, a box drops every component touching that
  edge but its largest (a neighbour's tip reaching across).
- The contact folders also write `<kind>-<name>-frames.png` per actor with frames (idle A, idle B,
  wind-up, strike, follow-through, hit, at 4×), `stage-strike.png` and `stage-hit.png` per zone
  (the front enemy 150 and 240 ms into its attack) and, for the heroes, `stage-bolt.png` and
  `stage-burst.png`.
- The Inventory and Heroes list windows lead each row with its sprite, fitted into 16 × 16 px,
  where pictures draw (an Image terminal, the desktop); the raster windows leave the two cells
  blank. The Market list keeps its sprite as before.
