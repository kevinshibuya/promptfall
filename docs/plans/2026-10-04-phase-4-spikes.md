# Phase 4 spikes: findings sheet

Task 1 of `docs/plans/2026-10-04-promptfall-phase-4.md`. A throwaway plugin under `spikes/phase-4`, never shipped and never in CI, answers three questions the stage depends on. Kevin runs it on five surfaces and fills the table; Task 6 reads the table and sets the constants below.

## The three questions

1. **The probe.** Does a 1 × 1 keyed `Image` answer a blit with `{}` where the terminal draws pixels (kitty, Ghostty) and with a deny naming the alt everywhere else? What is the exact deny text, and how does it differ from the deny for a key that is not mounted?
2. **Scaling and speed in Ghostty.** At which upscale factor (1, 2, 4, 6) does a 120 × 16 pixel checkerboard in a 120 × 8 cell `Image` read crisp? How long does `await $.ui.blit` take per frame at each scale, and does alpha 0 show the terminal background? How does a 100 × 8 `Raster` blitted at 12 frames a second fare?
3. **SMIL on the desktop.** Does an `isInteractive` `Svg` run `<animateTransform>` and `<animate>`? Does a redraw with a byte-identical source restart the animation?

## How to run

```sh
claude --plugin-dir spikes/phase-4
```

Then type `/spike`. A pane opens.

- **Terminal.** The pane runs by itself for about 30 seconds. The first line shows the probe answers (three blits, 300 ms apart). The second shows the deny for a blit to a key that is not mounted. Then four labelled checkerboards animate one after the other for 5 seconds each (scale 1, 2, 4, 6), each line counting blits sent, denies and the mean blit time once it is done. A small red-and-gap square tests alpha. Last, a Raster of random half-blocks animates for 5 seconds with its own counter. `/spike` again restarts the run.
- **Desktop app.** The pane shows two squares: the left one should slide, the right one should fade. Press `redraw` a few times and watch whether either animation jumps back to its start.

Surfaces: Ghostty, iTerm2, Terminal.app, tmux inside Ghostty, the desktop app.

## Findings

Fill one row per surface. Copy deny texts verbatim. "Crisp" means the checker squares have hard edges at normal viewing distance.

| Surface | Probe answer (×3) | Deny for an unmounted key | Crisp scales | Mean blit ms (1 / 2 / 4 / 6) | Alpha shows background | Raster sent / denies | SMIL moves | Redraw restarts |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Ghostty | | | | | | | n/a | n/a |
| iTerm2 | | | n/a | | n/a | | n/a | n/a |
| Terminal.app | | | n/a | | n/a | | n/a | n/a |
| tmux in Ghostty | | | | | | | n/a | n/a |
| Desktop app | n/a | n/a | n/a | n/a | n/a | n/a | | |

Notes:

## Decisions the findings set

Task 6 applies these to `plugins/promptfall/hooks/stage/tuning.ts`.

- **`IMAGE_SCALE`**: the smallest of 1, 2, 4, 6 that reads crisp in Ghostty. Scale 6 keeps a 160 × 34 frame at 783,360 bytes, under `IMAGE_MAX_BYTES` (1 MiB). If none reads crisp, `1`, with a note here.
- **`SVG_SMIL`**: `true` when the squares move on the desktop. `false` switches the desktop to the redraw fallback (`SVG_FALLBACK_FRAME_MS`, no idle bob).
- **`PROBE_ALT_DENY`**: the deny text the probe gets in a terminal that draws the alt, copied from the iTerm2 and Terminal.app rows.
- **The probe rule** stands when every terminal but Ghostty denies naming the alt and Ghostty answers `{}`. Only a deny equal to `PROBE_ALT_DENY` settles on `raster`; any other deny (the unmounted one above) leaves the renderer unknown and re-arms the probe.
- **The fallback.** If a terminal that draws no pixels answers `{}`, the renderer default becomes `'raster'` for every terminal and `settings.renderer = 'image'` opts in per machine (record §1.2's fallback). Task 6 applies it and this sheet says so.

Result: _pending Kevin's run._
