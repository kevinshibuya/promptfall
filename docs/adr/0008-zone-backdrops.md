---
status: accepted
---

# One painting per zone, bottom-anchored under the stage

Every zone ships one backdrop painting at the full stage's largest size: 240 × 51 stage pixels at
1.5× (`art/backdrops-hires/`) and 160 × 34 at 1× (`art/backdrops/`), 16 colours at most, baked
into `generated.ts` beside the sprites. The composer paints it over the whole frame before the
actors, bottom-anchored and centred: a narrower terminal crops the sides evenly, the 8-row rest
stage shows the bottom 24 rows (ground and the near scenery), a turn boss 36, and a zone or world
boss all 51 (the sky). A frame wider than the painting (an `Image` stage zooming out, ADR 0004)
extends the edge columns. The compact stage and a zone without a painting keep the ground strip
of `ZONE_GROUND`. The `Svg` draws it as paths like any art, never an `<image>`.

Kevin asked for backdrops because the stage drew a flat strip under finished sprites
(2026-10-08). The stage is a strip, not a canvas: 24 rows at rest. A painting designed around
that, with its ground on the bottom edge, its calm low-contrast band where the actors stand and
its detail above, reads at rest and opens up for a boss without a second drawing or any camera
logic.

## Considered options

- **One painting per stage height**: rejected. Three drawings per zone to keep in step, for a
  change the bottom-anchored crop gives for free.
- **Tiling a narrow strip**: rejected. gpt-image-2 does not draw seamless tiles, and the widest
  stage is only 240 pixels, one painting's width.
- **A procedural backdrop in code**: rejected. Twelve hand-authored scenes is more authoring than
  twelve prompts, and the sprites already come from gpt-image-2 in this style.
- **An `<image>` with a data URI in the Svg**: rejected. The stage Svg carries no `<image>` by
  the phase 4 plan, and the engine's handling of one is unknown.

## Consequences

- `pnpm backdrop <sheet> --zone <n>` cuts both densities from one magenta-keyed sheet: the painted
  band is snapped to a 16-colour median cut, resampled by block vote (the sprite cut's rule) to
  240 wide, fitted to 51 rows from the bottom (the sky cropped or extended), and the same at 160.
  The prompt asks for a 1536 × 330 strip; gpt-image-2 draws it about 360 tall, so a few sky rows go.
- The `Svg` grows by the painting's paths, about 20,000 characters at 1.5× and 10,000 at 1×
  (`rectPaths` joins vertical runs into rectangles, 25% under `artPaths`). The zone 1 rest Svg is
  45,000 characters and a zone boss 39,000 to 53,000. The adversarial fuller frame of ADR 0006
  measures 131,666, 600 over the cap, so it draws the 1× Svg through `svgWithFallback`; no real
  scenario comes near it.
- The `Image` PNG per frame grows from about 10 KB to 11 KB at rest and from 16 KB to 26 to 35 KB
  for a boss; the encode from 3 ms to 4 ms at rest and 6 ms to 7 to 9 ms for a boss (measured on
  zone 1, 2026-10-08).
- The `Raster` draws the 1× painting in half-block cells: 141 to 174 colour pairs for a boss,
  against the 1,024 budget.
- The damage numbers, drops and effects draw over the painting; the calm lower band keeps them
  readable, and the review artifact shows each zone at rest, with the zone boss and with the turn
  boss for Kevin's call.
- `generated.ts` grows by about 25 KB a zone.
