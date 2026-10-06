# UI remake spikes: findings sheet

Task 1 of `docs/plans/2026-10-05-ui-pr1-window-band.md`. A throwaway plugin under
`spikes/ui-remake`, never shipped and never in CI, answers five questions the window band and
the PR 2 pane depend on (grill 1.10, 1.16).

## The five questions

1. **Over a picture.** Does an absolutely positioned `Box` holding a `Text` and a plain `Button`
   paint over an `Image`, a `Raster`, an `Svg`? Does that Button's hotkey fire while the band
   holds the keyboard?
2. **Sharpness and cost.** A 1 px checker, 1 px vertical lines and 8 × 16 test glyphs, at 8 × 16
   picture pixels per cell, scale 1 and 2, at strip size (120 × 5 cells) and pane size
   (120 × 24): crisp or soft; bytes; mean blit over 50 blits.
3. **Clicks.** Does a click on an `Image` raise anything the plugin sees?
4. **The pane's focus ring.** Does the plugin learn which Button holds focus? Does a Button with a
   one-space label join the ring and keep its hotkey?
5. **Hotkeys off screen.** Does a band Button keep its hotkey inside a zero-width `Box`
   (`overflow="hidden"`), or placed past the right edge?

## How to run

```sh
claude --plugin-dir spikes/ui-remake
```

The band shows a 40 × 5 window picture with `TEXT OVER x: over` positioned on it, a 40 × 3
box-drawn `Raster` with `TEXT OVER r: over` on it, a tally row, a Button `y` inside a zero-width
Box and a Button `k` placed past the right edge. Click into the band, press `x`, `r`, `y`, `k`;
the tally counts each. `/spike-ui` opens the pane: Buttons `alpha`, `beta`, a one-space Button on
`q`, `next` on `n`; a focus and press log; a small picture with a `click` Button over it; then one
sharpness variant at a time (`n` cycles), each running 50 blits and printing its stats.

## Findings

Run on 2026-10-05 by the implementing session (Claude Code 2.1.289) on cmux (Ghostty's engine)
and Terminal.app, driven with `cmux send`/`read-screen`, AppleScript, System Events keystrokes and
a JXA CGEvent click. Screenshots stayed in the session's scratchpad.

| Surface | 1. Paint over | 1. Hotkey over | 2. Crisp | 2. Bytes / mean blit | 3. Click on Image | 3. Click on Button over Image | 4. Focus ring | 5. `y` zero-width | 5. `k` past edge |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| cmux (Ghostty engine) | yes, as a cut-out: the Box's cells replace the picture's placeholder cells, drawn as terminal text on the terminal background | `x` fired | scale 1 crisp: glyph strokes, the 1 px checker and the 1 px lines hold hard edges | strip s1 307,200 B / 2.3 ms; strip s2 1,228,800 B / 6.0 ms; pane s1 1,474,560 B / 6.5 ms; pane s2 5,898,240 B: 50 of 50 denied, `source.rgba decodes to more than 2097152 bytes` | nothing raised | `ui.press` with the Button's key | `ui.focus` names each Button (`alpha`, `beta`, `space`, origin `person`); the one-space Button joins the ring; `q` fired | fired, nothing visible | fired, but the Button is drawn, wrapped down the right edge |
| Terminal.app | the Image draws its alt on one row; the Box over it is not visible there; over the `Raster` it paints as text in the window | `x` and `r` fired | n/a (no pictures) | n/a | n/a | n/a | not run (same engine code path as cmux) | fired, nothing visible | fired, drawn as on cmux |
| Ghostty (standalone) | | | | | | | | | |
| Desktop app (Claude.app, 2026-10-05, driven by the implementing session) | yes: the Box's text draws over the Svg | `x` fired | n/a | n/a | not run | not run | not run | fired, nothing visible | fired |

The desktop and standalone Ghostty rows are Kevin's.

## Decisions the findings set

- **`WINDOW_SCALE = 1`.** 8 × 16 picture pixels per cell read crisp in the Ghostty engine. The
  stage's spike found 6 × 12 crisp and 4 × 8 soft; 8 × 16 is finer still.
- **Hotkey rung on terminals: (a′).** Plain Buttons inside a zero-width `Box` with
  `overflow="hidden"` keep their hotkeys on both terminal surfaces and draw nothing. The band
  places `p`, `l`, `w`, `c`, `f` that way: no row and no columns lost, nothing laid over the
  picture. Rung (a) works too, but as a cut-out of terminal text in the picture, so it ranks
  below (a′).
- **Hotkey rung on the desktop: (a′)** (its row above): the band's hotkeys sit in a zero-width,
  absolutely positioned Box, since the desktop strip lives in a column. VS Code and mobile are
  untested and keep rung (c), a row of Buttons under the strip.
- **PR 2 notes, not applied here.**
  - A pane-sized picture (120 × 24 cells) at scale 1 is 1,474,560 bytes, above the plugin's
    `IMAGE_MAX_BYTES` (1 MiB) and below the engine's 2 MiB; its blit averaged 6.5 ms. PR 2
    either raises the plugin cap to the engine's or draws the pane as several window Images
    (the band's way). Scale 2 is out at pane size.
  - Focus: `ui.focus` tells the plugin which Button takes the ring, by key, before it moves, and
    a hook can redirect it (`next({ ...e, element })`). The ▶ cursor can follow the ring, with
    one-space Buttons as the ring's stops; no `Client` is needed.
  - Clicks: a click on a picture raises nothing, but a plain Button positioned over it takes the
    click. Clicks inside pictures are possible at the cost of a terminal-text cut-out per
    Button; v1 stays keyboard only (grill 1.4).

## PR 2 pane spike

Task 1 of `docs/plans/2026-10-06-ui-pr2-pane-windows.md`. `/spike-pane` in the same throwaway
plugin opens a pane (`closeOnEscape`, `rows: 24`, focused) that holds six plain window pictures
laid out by nested row and column Boxes with one gap Box, a zero-width `overflow="hidden"` Box of
eight one-space Buttons `s0`…`s7` (`s3` has `autoFocus`) and a Button on `q`, an `Input`, and a
log line. The `ui.focus` hook logs each move and redirects the first move onto `s5` to `s6`; `q`
re-renders and calls `$.ui.focus` onto `s1`; the `ui.close` hook refuses the first close by the
person. The grid shrinks to the body it is given (a window is at most 40 × 6 cells, the gap 8
cells by at most 4 rows), so it fits a small terminal.

### Questions

1. **Hidden ring.** (a) Do Tab, Shift+Tab and Enter walk and press the hidden Buttons? (b) Does
   the ring start on the `autoFocus` Button? (c) Does `$.ui.focus` after a re-render land on a
   hidden Button? (d) Does a redirect land? Where do the ends of the ring go?
2. **Arrows.** Do Up and Down move the ring, or scroll?
3. **Escape refused.** After a refused close, does the pane keep the keyboard?
4. **Tiles.** Do the pictures and the gap land where the tile tree says?
5. **Input height.** How many rows does the `Input` take?

### How to run

```sh
claude --plugin-dir spikes/ui-remake
```

Then `/spike-pane`. The log line at the top names each `ui.focus` (element and origin), each
press, the refused close and the result of `$.ui.focus(s1)`.

### Findings

Run on 2026-10-06 by the implementing session (Claude Code 2.1.291). cmux was driven with
`cmux send`, `send-key` and `read-screen` in a background workspace; Terminal.app with `do script`
for the command line and `bg.js keycode` (keys posted to Terminal's pid, no activation; `bg.js`
gained a `shift` modifier for this).

| Surface | 1a. Tab, Shift+Tab, Enter | 1b. `autoFocus` | 1c. `$.ui.focus` after `q` | 1d. Redirect; the ends | 2. Arrows | 3. After a refused Escape | 4. Tiles | 5. Input rows |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| cmux (docked, 148 columns; the body 66 columns) | yes: Tab walks `s0`…`s7`, then `back`, then `price` (the Input); Shift+Tab walks back; Enter on `s0` raised `ui.press s0` | yes: `focus s3 by plugin` on open, and again when `/spike-pane` re-took the keyboard | yes: the next Down went to `s2`. But the plugin's own `ui.focus` hook did not hear that move (no `focus s1 by plugin` line), though it did hear `autoFocus` | yes: Tab onto `s5` landed on `s6` (the next Tab went to `s7`). Both ends pass through one engine stop (`ui.focus` with no element): forward, last element → engine stop → `s0`; back, `s0` → engine stop → last element | move the ring: one `ui.focus` per press, origin `person`, in ring order, through `back` and `price` | the pane stays open but loses the keyboard: `q` and Down went to the prompt (`❯ q`); re-running the command took it back | yes: three 22 × 6 pictures across the top, then the middle column's gap pushes its second picture down 4 rows, as the tree says; nothing extra across or down (read from the picture's placeholder cells) | 1, focused or not (`price: 1200  ⏎ list`) |
| Terminal.app (inline, 80 × 24; the body 7 rows) | yes, as on cmux | yes | yes, the same, the hook again silent | yes, as on cmux | move the ring, as on cmux | the same: the keyboard goes to the prompt | n/a: each Image draws its alt on one row (`w0w2      w4`), as in the PR 1 spike; the raster renderer draws the pane there | 1 |
| Desktop app | | | | | | | | |
| Ghostty (standalone) | | | | | | | | |

The desktop and standalone Ghostty rows are Kevin's: the session that ran this did not drive
Claude.app while the Mac was in use.

Other facts the run turned up:
- The Input joins the ring after the hidden Buttons. While it has focus every printable key goes
  to it, so `q` types a `q` there instead of backing out.
- `rows: 24` is a request. An inline pane on an 80 × 24 Terminal.app got 7 body rows, below the
  plan's too-small floors, so a default-size Terminal.app draws the too-small window. cmux at
  148 columns docked the pane beside the transcript.

### Decisions

- **Cursor rung: (a′) on cmux and Terminal.app**: hidden one-space Buttons in a zero-width Box,
  questions 1 (a) to (d) hold on both. The desktop takes rung (c) until its row says (a′); VS Code
  and mobile take (c).
- **`MOVE_HELP = 'Tab or arrows: move.'`**: the arrows move the ring on both terminals. No `j`/`k`
  Buttons.
- **Back-out: Escape always closes the pane; `q` is the only back-out.** A refused close keeps the
  pane open but hands the keyboard to the prompt, so refusing Escape would strand the person. So
  Task 8's `paneClose` passes every close, and its test asserts the pass instead of a refusal;
  Task 11's README says Escape closes the pane and `q` backs out, without the close-mark line.
- **Wrap (for Task 8's redirect):** each end of the ring passes through one engine stop before it
  wraps. The hook passes engine stops (`next(e)`), so Tab off the last stop goes to the engine
  stop, then onto the first stop in the ring, which the redirect sends to the first cursor stop;
  Shift+Tab mirrors it. The price Input, when shown, is the ring's last element.
- **Re-focus does not lean on the hook:** `$.ui.focus` from a press moved the ring without raising
  the plugin's own `ui.focus` hook. Task 8's re-focus targets `PaneBuild.focus`, which the dialog
  state already names, so no cursor write is lost; nothing may assume the hook sees it.
- **`PRICE_INPUT_ROWS = 1`.**
- **Tiles: yes.** The image mount uses the tile tree.
