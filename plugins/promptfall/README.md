# Promptfall plugin

The Claude Code mod half of Promptfall. It runs the sim locally, sends the events in batches to
a ledger, and draws a band above the prompt. By default the ledger runs inside the plugin and
persists through `$.store`; `/promptfall server <url>` points it at an HTTP server instead, such as
the fake in `servers/fake`.

## Play

Load it from the repository root in an interactive session:

```sh
claude --plugin-dir plugins/promptfall
```

The band appears above the prompt once the session starts. Your three heroes fight on their own.
Every tool call Claude makes spawns an enemy, at most three fight at once and ten wait in a queue.
A turn with ten or more tool calls ends with a turn boss. Each prompt you submit heals the party
30% and revives the fallen. With nothing alive, the next enemy of the wave walks in, so an idle
session still fights, one round every 5 seconds instead of every 2.

A zone is ten waves and a boss. Beating the boss moves you to the next zone. A wipe sends you back
one zone at full health and costs nothing else.

### Commands

| Command | What it does |
| --- | --- |
| `/promptfall` | Opens the dialog on the Inventory tab |
| `/promptfall heroes` | Opens it on Heroes (also `inventory`, `market`, `orders`, `account`, `odds`) |
| `/promptfall chat` | Opens it on Chat, the cursor in the compose box |
| `/promptfall leaderboards` | Opens it on Leaderboards and loads the boards |
| `/promptfall off` | Hides the band for this session; the game keeps playing |
| `/promptfall on` | Brings it back |
| `/promptfall farm` | Toggles farming: a beaten zone boss restarts the zone instead of advancing |
| `/promptfall server <url>` | Plays on the HTTP server at `<url>`, for every session on this machine |
| `/promptfall server local` | Goes back to the in-process ledger |

### Servers

Each server keeps its own account: nothing moves between them, so the first switch to a server
starts a fresh one there. The setting is machine-wide and a session that is not playing follows
it within 10 seconds. When the server stops answering, the status row reads
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
toward the turn boss), a wiped party is healed in place with no retreat, and nothing drops, since
the boss never dies on your side. The server counts the damage your committed batches dealt.

The band shows it: the Party tab's enemy column is the boss, its name on the first row and its bar
on the second (the server's HP, less what your party dealt since the last poll), the status row ends in `boss 62% · 11m`, and the World
tab's second row reads `World boss <name> <bar> 62% · 11m left · you <damage>`. Toasts say when a
boss appears and when it is down. While a boss is live every session polls the world every 5
seconds.

Rewards land when the boss dies, or when its window ends: a guaranteed boss-rarity item for 200
damage or more (5% of the base), and on a kill one bonus roll each for the top 3. Each reward
toasts `Boss reward: <item> (<rarity>)` and shows as `boss reward <item> (+<gold>g)` in the loot
log. An item with no free slot toasts `Boss reward: <gold> gold` instead, waits in the returns
queue, and arrives as a `returned` loot line when a slot frees. The boss
board counts every hit, past the boss's remaining HP too.

The world boss changed the sim, so the game is at sim version 3. A store or a fake snapshot from
phase 2 is behind it: the band reads the older-version notice, and `/promptfall account`,
`Reset this machine's data` starts a fresh account. The in-process ledger has no world boss.

### Account tab

The settings are rows: Sound (`s`), Motion (`n`), Renderer (`x`), then the band shown or
collapsed and Band off. `Link GitHub` shows a code in the detail window and the link under the
picture, and polls until the server approves it, then reads `Linked as <login>`. The fakes approve on the first poll: the in-process ledger links you as
`player`, the HTTP fake as its `--player-name`. The polling belongs to the session, so closing the
dialog does not stop it. `Reset this machine's data` asks Yes or No, opening on No, then deletes
every Promptfall key in the store but the lease and starts a fresh account on the same server. It is how a state from an older version
of the game is cleared: the band then reads the older-version notice and the Account tab is the
one tab that still works.

### Hotkeys

The band takes keys after a click, or after `ctrl+x` then Tab with Ctrl released (`ctrl+tab` does
not focus it). Letters only: a bare digit at an empty prompt
would answer a survey.

| Key | Band | Dialog |
| --- | --- | --- |
| `p` / `l` / `w` | Party, loot log, world tabs | |
| `c` | Collapse to one row, or expand | |
| `i` / `h` / `m` / `r` / `a` / `o` | | Inventory, Heroes, Market, Orders, Account, Odds tabs |
| `c` / `b` | | Chat and Leaderboards tabs (outside a field) |
| `y` / `n` | | Yes or No |

### The pane

Every tab is windows: a list with a ▶, the ▶ row's details beside it (or under it below 96
columns), and a message window at the foot saying what the keys do.

| Key | Does |
| --- | --- |
| Tab, Shift+Tab, ↑ ↓ | Move the ▶; long lists page, with a `16-30/40` footer |
| Enter | Open the ▶ row's command window, or run the item under the ▶ |
| `e` `u` `s` `v` `f` | Equip, Unequip, Sell, Vendor, Reforge (an item's command window) |
| `p` `s` `d` | Party (or Unpick), Sell, Dismiss (a hero's command window) |
| `f` | Market: the filter window |
| `s` `n` `x` | Account: sound, motion, renderer |
| Tab | Leave a field (the sell price, the order price, the chat line) |
| `q` | Back out of a command window, a pick, a Yes/No, the sell window or the order form |

Vendor, Dismiss, Buy, the two cancels and Reset ask Yes or No first. Party picks three heroes one at a time; the third sends
the new party, which takes the field at the next zone change. The last row of Heroes recruits.
On the desktop, VS Code and mobile a `▲ ▼ ok back` row under the picture does the moving.

The windows need 16 rows with the tab window and 14 without it. A short pane drops the tab
window (the tab keys still work), so an inline pane in a 105 × 50 Terminal.app draws every tab.
At 80 × 24 it gets 7 rows and asks for more room; in fullscreen from 110 columns the pane docks
beside the conversation at full height.

Esc closes the dialog, from a sub-window too. The band collapses to one row by itself under 100 columns or when fewer
than 4 rows are free, and hides while Claude asks you a question.

### Stage

The band's Party tab draws the battle as pixel art: enemies on the left, the party on the right,
lunges, white flashes and damage numbers on each hit, a dissolve when an enemy dies and a pop when
it drops loot.

- **Renderers.** Kitty and Ghostty draw the stage as an `Image`. Every other terminal (iTerm2,
  Terminal.app, tmux) draws it as a `Raster` of half-block cells, two pixels per cell, with the
  numbers as text. The desktop app draws it as an `Svg`, always the full stage: 116 to 160
  columns, so 174 to 240 pixels of 1.5× art, scaled to the band's width (ADR 0004, ADR 0006). The desktop scrolls a band taller than
  its `maxRows`, so a boss stage there is scaled down to the rows left and draws narrower than the
  band. The stage is an image `Svg`: SMIL plays in it and a redraw swaps it without a blank frame.
- **Two art densities.** The full stage on an `Image` terminal and on the desktop draws the 1.5×
  art: `stageAt(…, { scale: 1.5 })` multiplies every stage-pixel distance by 1.5, so a 120 × 8
  stage is 180 × 24 pixels, and the `Image` is upscaled 4 times instead of 6 (the same size on
  screen). Damage numbers draw their 3 × 5 glyphs in 2 × 2 blocks. The `Raster`, the compact
  stage and the list windows keep the 1× art, since a half-block cell shows one pixel per column.
  The desktop `Svg` falls back to the 1× art for a frame whose 1.5× markup would pass the
  engine's 131,072-character cap; legal art stays under it (ADR 0006).
- **The probe.** Nothing says which terminals draw pictures, so the band asks: its status row draws
  a one-pixel `Image` and, 300 ms later, swaps it with `$.ui.blit`. A swap that is taken means
  pictures; a deny naming the alt means half-blocks; any other answer asks again on a later draw.
  Until the answer lands the stage rows stay empty, so the band does not change height.
- **Heights.** At rest the Party tab is 10 rows (8 for the stage, a party line, the status row).
  A turn boss grows it to 14 and a zone or world boss to 19; it shrinks back once the boss's
  dissolve and drop have played.
- **Compact and collapsed.** On terminals, the full stage needs 116 columns and room for its rows. With 100 to
  115 columns, or too few rows, the band keeps the three hero rows and the status row and draws a
  52-column, 4-row stage beside them. Under 100 columns it is one row. Loot and World keep their
  four rows and draw no stage.
- **Override.** `/promptfall renderer image|raster` forces a renderer on this machine and
  `/promptfall renderer auto` returns to the probe. It applies at the next session start.
- **Frames.** The render hook draws the first frame; a timer per surface blits the rest, about 12
  a second while something moves and 2 a second at rest (the idle bob). A hidden, collapsed or
  other-tab band blits nothing. The desktop's `Svg` animates itself with SMIL and redraws once a
  round.

### Sound and motion

- **Sound** is off by default. `/promptfall sound on` (or `s` on the Account tab) turns on four
  cues: a Rare or Epic drop, a Legendary drop, a level up, and a world boss appearing. Each plays
  beside its toast, at a fixed volume, only in the session that is playing (the primary); a
  secondary stays quiet. `/promptfall off` hides the band but keeps the cues. The engine plays
  sound on macOS only. The cues in `cues/` come from Juhani Junkala's CC0 pack "512 Sound Effects
  (8-bit style)".
- **Motion**: `/promptfall motion still` (or `n`) stops the idle bob; hits, dissolves and drops
  still play. `/promptfall motion full` brings the bob back.
- **Renderer**: `/promptfall renderer auto|image|raster` (or `x` to cycle), see Stage.

All three are per machine, kept in the plugin store under `promptfall:settings`; a reset keeps
them.

### What phase 1 has

Combat, waves, zones, bosses, loot with rarities and affixes, equipping, vendoring, reforging,
a tavern, hero contracts from bosses, party swaps that apply at the next zone change, inventory
and roster expansions, and published odds. Progress lives in the Claude Code store on this
machine. One session at a time plays: another session shows `playing in another session` and
takes over within about 10 seconds of the first one quitting. Typing a prompt or `/promptfall` in a
session makes it the one that plays at once.

### What it lacks

No mute or ban: the word list is
the only filter. The GitHub link is approved by the fakes, not by GitHub, and the in-process ledger
has no bots, so its market is yours alone and its chat is closed.

## Develop

A `--plugin-dir` folder reloads on save. The game packages live in `packages/`, and a mod can
import only files inside its own folder, so `pnpm vendor` bundles them into `hooks/vendor/`.
Run it after changing `packages/sim`, `packages/protocol` or `packages/ledger` and commit the
result. CI fails when
the bundles are stale (`pnpm vendor:check`).

Two rules of the mods runtime shape the code. A hook may not pass `$` or `$.store` on, so
`register.tsx` hands the rest of the code closures written at the hook. And `claude plugin
validate` reads an atom only where the calling module declares it, so each module declares the
atoms it uses.

```sh
claude plugin validate plugins/promptfall
claude plugin test plugins/promptfall
pnpm exec tsc -p plugins/promptfall
```

`tsc -p plugins/promptfall` needs the engine's declarations, which an interactive
`claude --plugin-dir plugins/promptfall` lays under `.claude-plugin/types/` on first load. They
are generated per Claude Code version and stay uncommitted.

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
  48x34) [--names kind/a,kind/b] [--native <dir>] [--hires <dir>]` cuts a magenta-keyed sheet. It finds each
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
- The Inventory and Heroes list windows lead each row with its sprite, fitted into 16 × 16 px,
  where pictures draw (an Image terminal, the desktop); the raster windows leave the two cells
  blank. The Market list keeps its sprite as before.
