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
