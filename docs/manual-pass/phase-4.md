# Phase 4 manual pass

Run from the repository root. Each step says what you should see; a step that shows something else
is a red. Part A covers PR 1 (the engine, on the concept sprites as placeholders); part B comes with
PR 2 (the art).

The band needs room: the full stage wants at least 116 columns and 10 free rows (19 with a zone
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

15. **Svg.** Open the session in the desktop app. The band's stage is drawn as an SVG: the same
    actors and ground. Hits lunge, flash and show numbers; dissolves and spawns fade; the idle bob
    moves (SMIL). Pressing things in the band or a new round does not make a motion jump back to its
    start.
16. **Lists.** The Inventory, Heroes and Market rows lead with 16 px sprites.
