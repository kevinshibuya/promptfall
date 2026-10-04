# Phase 4 manual pass

Run from the repository root. Each step says what you should see; a step that shows something else
is a red. Part A covers PR 1 (the engine, on the concept sprites as placeholders); part B comes with
PR 2 (the art).

On terminals, the band needs room: the full stage wants at least 116 columns and 10 free rows (19 with a zone
boss), the compact stage 100 columns. Widen the window or shrink the font when a step asks for a
width. `/promptfall` opens the dialog; `/promptfall account` opens it on the Account tab.

Settings are per machine and survive sessions. Start the pass with `/promptfall sound off`,
`/promptfall motion full` and `/promptfall renderer auto`, and run the renderer step's command in one
session, then quit it and start another, since the renderer applies at the next session start.

## Part A: the stage, sound and list sprites (PR 1)

### Ghostty

1. **Start.** `claude --plugin-dir plugins/promptfall` in a window at least 130 columns wide. The
   band's Party tab is 10 rows: 8 rows of stage, then a party line
   (`Aldric … L1 ██████ 60/60 · Morwen … L1 …`), then the status row (`Zone 1 Greenmeadow Road ·
   wave …` with `p: party l: loot w: world c: ▾`). For a moment the stage rows may be empty while
   the renderer probe runs, and the band does not change height when the stage appears.
2. **The renderer.** `/promptfall account`: the Account tab reads `Renderer: auto (image)`. The
   stage is sharp pixel art: heroes on the right facing left on a green ground strip, a grey knight,
   a blue-hatted black mage and a white mage.
3. **A fight.** Run a few tool calls (or wait for idle ticks). An enemy appears at the left, fading
   in. On each round attackers step toward the other side, the hit actor flashes white, and a
   number rises over it. The party line ends with `⚔ <enemy> <hp>/<max>`. When an enemy dies it
   dithers away; an item it drops pops out of it and rises.
4. **Bosses.** Keep playing to wave 11 (the zone boss) or wait for a turn boss after a long turn.
   A turn boss grows the band to 14 rows, a zone boss to 19, and the boss stands taller than the
   heroes. After it dies the band shrinks back to 10 rows once the dissolve and the drop have played.
5. **Sound.** `/promptfall sound on` answers `Sound on`. The next Rare or Epic drop plays a short
   beep with its toast (`drop.wav`), a Legendary a higher one, a level up a third. Common and
   Uncommon drops are silent. `/promptfall sound off` silences them again.
6. **Motion.** `/promptfall motion still` answers `Motion: still`. At rest the sprites stop bobbing;
   hits, flashes and dissolves still play. `/promptfall motion full` brings the bob back.
7. **Compact.** Narrow the window to about 110 columns. The band is 4 rows: the three hero rows
   with their enemy slot and the status row at the left, a small 52-column stage at the right.
8. **One row.** Narrow to under 100 columns: one row, `Promptfall · Z1 w… · K… B… W… · …g`.
9. **Off.** `/promptfall off` hides the band. With sound on, a Rare drop still plays its cue.
   `/promptfall on` brings the band back.
10. **Lists.** `/promptfall`: each Inventory row starts with a small picture of its item (a sword,
    a chest plate or a ring); the Heroes tab's rows start with their class's sprite; the Market tab's
    listings start with the item's or the hero class's sprite.
11. **Other tabs.** Press `l`, then `w`: Loot and World keep their 4 rows and draw no stage.

### iTerm2 and Terminal.app

12. **Raster.** Start as in step 1. The Account tab reads `Renderer: auto (raster)`. The stage is
    drawn in half-block characters (`▀▄`), two pixels per cell, with damage numbers as text. Repeat
    steps 3 to 8 and 10: the same layouts and motion, in half-blocks. Item rows lead with an 8 × 2
    half-block sprite; hero rows keep their glyph. Known: Terminal.app paints the half-blocks in
    black and grey rather than colour (it is a 256-colour terminal and the engine maps the cells
    that way; iTerm2 and Ghostty draw them in colour).

### tmux inside Ghostty

13. **Raster under tmux.** Run step 1 inside `tmux`. The Account tab reads `Renderer: auto (raster)`
    and the stage is half-blocks, as in step 12.

### The renderer override

14. **Force raster.** In Ghostty, `/promptfall renderer raster` answers
    `Renderer: raster (applies at the next session start)`. Quit, start again: the stage is
    half-blocks and the Account tab reads `Renderer: raster (from next start)`. `x` on the Account
    tab cycles `auto → image → raster`. Finish with `/promptfall renderer auto` and a restart.

### Desktop app

The desktop pass runs against the HTTP fake, whose bots fill the market and chat (the in-process
fake has no other players). The desktop never uses the terminal thresholds: it always draws the
full stage, scaled to the band (ADR 0004). A plugin change only reaches a NEW desktop session.

15. **Start.** `pnpm fake --port 7777 --data .promptfall/fake-desktop.json --player-name <you> --boss-in 300` in a terminal. In Claude.app a NEW Code session in the repo (the "+" beside the "promptfall" project group). `/promptfall server http://127.0.0.1:7777`: the reply names the server. `/promptfall account`, `Link GitHub`: `Linked as <you>` within about 5 s. Known: the composer prints "/promptfall isn't a command here." under each `/promptfall` command although the command ran (the reply shows); the desktop's command list does not know plugin commands.
16. **The stage at rest.** The band is the full stage as wide as the band (an SVG: heroes on the right on the ground strip), then the party line, then the status row. Narrow the window to about 860 points: still the full stage, smaller; never the compact or one-row band. The party line's segments wrap: no hero name is cut, and an enemy segment that does not fit starts a second row.
17. **A fight.** Enemies fade in at the left; on each round attackers lunge, the hit actor flashes white, a number rises; a dead enemy fades away and its drop pops out. At rest the sprites bob (SMIL; with `SVG_SMIL = false` there is no bob at rest and the motions redraw about 6 times a second instead). Click `loot` then `party`, and press the collapse control twice, while a motion runs: the motion does not jump back to its start.
18. **Turn boss.** Prompt the session "Run the Bash command true 10 times as separate tool calls" (approve them) and let the turn end: once the field is empty a turn boss arrives (a turn of 10+ tool calls is the only trigger; a wipe cancels it): the stage grows (its art is 24 px tall, the boss stands above the heroes) and shrinks back after its dissolve and drop.
19. **World boss.** Before the boss is due, turn sound on and start the watcher (step 21's first two actions): the boss cue plays only as the boss appears. About 300 s after the fake started the world boss toast shows and `boss.wav` is logged; the stage grows to the 34 px art, and the boss segment, on its own row of the party line, shows the boss name and a 6-cell bar. (A zone boss at wave 11 shows the same height.)
20. **Motion.** `/promptfall motion still`: the bob stops; hits, flashes and fades still play. `/promptfall motion full` brings it back (with `SVG_SMIL = false`: no bob in either mode; check only that hits and fades still play under `still`).
21. **Sound.** `/promptfall sound on`; `.promptfall/tools/drv/afplay_watch.sh <log>` in a terminal logs `drop.wav`, `level_up.wav`, `boss.wav` as their toasts show. `/promptfall sound off`.
22. **Tabs and hotkeys.** Click the band, then `l`, `w`, `p`: Loot and World keep four rows and draw no stage; `c` collapses to one line and back.
23. **Off.** `/promptfall off` hides the band; with sound on a Rare drop still plays. `/promptfall on`.
24. **Toasts.** A Rare or better drop, a level up and the world boss each toast.
25. **Inventory.** `/promptfall` opens the docked pane. Each row leads with its 16 px sprite and no glyph; the name row and the buttons fit the pane's width (long affixes drop to their own line, buttons wrap, nothing is cut at the right edge). `equip`, `vendor` and `reforge` work.
26. **Heroes.** Rows lead with the class sprite, no glyph, and fit the pane. `sell` opens the sell form.
27. **Market.** Listings from the bots lead with the item's or the class's sprite. Buy one (`buy`, then confirm): gold drops, the item shows in Inventory, a toast. List an item (`sell` in Inventory, a price): it shows in Market and Orders; a bot may buy it within a few minutes (a toast and gold).
28. **Orders.** Place a buy order from the form; it shows under Orders; cancel it (the escrow returns); cancel the listing from step 27.
29. **Chat.** Post a line: it shows in the tail beside the bots' lines.
30. **Account, Odds, Leaderboards.** Account shows the server URL and the linked name (its Renderer row is the terminal probe's; record what it reads). Odds and Leaderboards draw their tables.
31. **Finish.** `/promptfall server local`.

- n/a: the renderer probe, the Account tab's `Renderer: auto (…)` and
  `/promptfall renderer image|raster` are terminal-only (the desktop has one renderer, the Svg).
- n/a: compact and one-row widths: the desktop never uses the cell thresholds (ADR 0004).
