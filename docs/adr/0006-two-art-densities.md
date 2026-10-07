---
status: accepted
---

# Two drawings per sprite, and a scale on the stage

Every sprite ships twice: the 1× art (16 × 16 or up to 48 × 34) and the 1.5× art (24 × 24 or up
to 72 × 51, in `art/sprites-hires/`). The full stage on an `Image` terminal and on the desktop
draws the 1.5× art by giving `stageAt` a scale of 1.5. Every stage-pixel distance (slot, pitch,
edge, lunge, bob, rises, the ground) is multiplied by it and rounded, and the frame is 1.5 times
the box. The `Raster` terminals, the compact stage and the list windows keep the 1× art.

The band's size in cells does not change: 8, 12 and 17 rows, 116 to 160 columns. ADR 0003 sized
the stage in cells because a half-block cell shows one pixel per column, and that still holds on
the `Raster`. A larger canvas would have meant a wider band there, or 1.5× art squeezed back down
to one pixel a column, which is the 1× art with extra steps. A scale on the stage keeps the cells
fixed and spends the extra pixels only where the renderer can show them. The `Image` upscales the
1.5× frame 4 times instead of 6, so it is the same size on screen and the same bytes. The desktop
`Svg` keeps its rendered width and grows its viewBox.

Kevin wanted the natives' detail on screen (grill round 4, 2026-10-07). gpt-image-2 draws the
natives at a median of 22 px. The 1× cut shrinks that by about 0.6 and loses the detail, and a
smarter 16 px reducer did not get it back.

## Considered options

- **2× (32 × 32 art)**: rejected. The natives are smaller than 32 px, so they would either draw a
  third smaller than today in their slot or be grown, which smears the pixels. At 1.5 almost every
  native fits its 24 px slot with no growth, and the fit only ever shrinks.
- **One drawing, upscaled at draw time**: no gain. The detail has to come from the natives.
- **A wider band in cells**: rejected for the reason above. Half-block terminals would pay for
  pixels they cannot show.

## Consequences

- Two drawings per sprite to keep in step. `art/sheets.md`'s canonical cut writes both from the
  same native. The 1.5× hero poses carry hand fixes, kept as grids and written back by the script.
- The 1.5× art has its own 128-colour master, `art/palettes/hires.json`, derived from every 1.5×
  PNG. The 1× masters are unchanged.
- The `Svg` of a 1.5× frame is longer. Measured, the worst legal frame (a 72 × 51 checker boss
  and three checker heroes) is 81,653 characters, under the engine's 131,072. `svgWithFallback`
  still draws the 1× `Svg` for a frame past the cap.
- `generated.ts` holds both drawings: 335 KB, from 157 KB.
