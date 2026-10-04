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

Run on 2026-10-04 by the implementing session (Claude Code 2.1.289), on the two surfaces this Mac has: cmux (Ghostty's engine, `TERM_PROGRAM=ghostty`), driven through `cmux workspace create` / `send` / `read-screen` with a window capture for the scales, and Terminal.app, driven through AppleScript. iTerm2, tmux, standalone Ghostty and the Claude desktop app are not installed here: their rows are Kevin's to fill.

| Surface | Probe answer (×3) | Deny for an unmounted key | Crisp scales | Mean blit ms (1 / 2 / 4 / 6) | Alpha shows background | Raster sent / denies | SMIL moves | Redraw restarts |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| cmux (Ghostty engine) | `image` · `image` · `image` | `no Image of its own is mounted under key "nothing" in spike` | 6 crisp; 4 slightly soft at the edges; 2 and 1 blurred | 1.1 / 1.4 / 1.5 / 1.8 (58 or 59 sent each, 0 denies) | not checked | 57 / 0, 3.2 ms | n/a | n/a |
| Terminal.app | `the Image draws its alt here: the terminal draws no placeholder images (env: terminal=Apple_Terminal, not asked yet, no answer)`, all three | same as cmux | n/a (every Image blit denied with the alt deny) | 0.7 / 0.8 / 1.1 / 1.5, 58 denies each | n/a | 56 / 0, 4.8 ms | n/a | n/a |
| Ghostty | | | | | | | n/a | n/a |
| iTerm2 | | | n/a | | n/a | | n/a | n/a |
| tmux in Ghostty | | | | | | | n/a | n/a |
| Desktop app | n/a | n/a | n/a | n/a | n/a | n/a | | |

Notes:

- The engine's source (2.1.289) spells out every Image blit deny: `the Image is not drawn under a terminal root`; `the Image draws its alt here: the terminal draws no placeholder images (<cause>)`; `the Image draws its alt here: every 8-bit image id is in use`; and two about file and shm sources, which bytes never hit. The cause in parentheses varies with the terminal (`env: terminal=Apple_Terminal, not asked yet, no answer` above), so the probe matches the fixed prefix, not the whole string.
- The engine answers that deny while the terminal's graphics capability is still pending, too. The probe fires 300 ms after a band render, long after startup's query has settled, and cmux answered `image` on all three probes.
- The window captures that read the scales were kept in the session's scratchpad, not committed.

## Decisions the findings set

Task 6 applies these to `plugins/promptfall/hooks/stage/tuning.ts`.

- **`IMAGE_SCALE`**: the smallest of 1, 2, 4, 6 that reads crisp in Ghostty. Scale 6 keeps a 160 × 34 frame at 783,360 bytes, under `IMAGE_MAX_BYTES` (1 MiB). If none reads crisp, `1`, with a note here.
- **`SVG_SMIL`**: `true` when the squares move on the desktop. `false` switches the desktop to the redraw fallback (`SVG_FALLBACK_FRAME_MS`, no idle bob).
- **`PROBE_ALT_DENY`**: the deny text the probe gets in a terminal that draws the alt, copied from the iTerm2 and Terminal.app rows (its fixed part: see the notes).
- **The probe rule** stands when every terminal but Ghostty denies naming the alt and Ghostty answers `{}`. Only a deny starting with `PROBE_ALT_DENY` settles on `raster`; any other deny (the unmounted one above) leaves the renderer unknown and re-arms the probe.
- **The fallback.** If a terminal that draws no pixels answers `{}`, the renderer default becomes `'raster'` for every terminal and `settings.renderer = 'image'` opts in per machine (record §1.2's fallback). Task 6 applies it and this sheet says so.

Result, applied in Task 6:

- `IMAGE_SCALE = 6`: the smallest scale that reads crisp in the Ghostty engine. A 160 × 34 frame at 6 is 783,360 bytes, under `IMAGE_MAX_BYTES`; its blits averaged 1.8 ms.
- `SVG_SMIL = true`: provisional. `SvgProps.isInteractive` documents SMIL as running in the sandboxed frame; the desktop row above stays Kevin's to confirm, and `false` switches the desktop to the redraw fallback.
- `PROBE_ALT_DENY = 'the Image draws its alt here: the terminal draws no placeholder images'`, matched as a prefix of the deny (narrowing 24 in the plan).
- The probe rule stands on both surfaces run: Ghostty's engine answers `{}`, Terminal.app denies naming the alt. No terminal that draws no pixels answered `{}`, so the renderer default stays `auto`.
