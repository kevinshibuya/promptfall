---
status: accepted
---

# One stage density on every surface

ADR 0006 gave the stage two densities: the 1.5× art with its drawn frames (ADR 0007) on the
`Image` terminals and the desktop, and the 1× art, with no drawn frames and no marks, on the
`Raster` terminals. Kevin's manual pass on 2026-10-13 read the difference as the game being
"way more zoomed in with different hero art" on the Raster, and the desktop's knight lunging
where the terminal's swings. He asked for the same art, animations and timing on all three.

From now on the stage has one scene: the 1.5× art, its drawn and derived frames, its marks
(shield, streak, enrage tint) and its effects, built by one timeline from one set of tuning
constants. Each surface shows that scene at the pixels it has. The `Image` draws it as today.
The `Raster` renders the same scene and scales it to its box the way the `Image` zooms out, so
at the band's 116 to 160 columns and fixed 17 rows it shows about two-thirds of the pixels,
which is what the `Image` shows when a tall prompt shrinks it. The desktop's SMIL picture
carries the same frames and must fit the 131,072-character cap without a 1× fallback, since
there is no 1× stage art to fall back to; a research ticket finds the encoding, and if nothing
fits, the picture drops the idle pair and the hit filter before any drawn frame. The 1× stage
art set retires. The compact stage and the list windows keep their 1× idle sprites, and the
Raster keeps drawing damage numbers as text cells for legibility.

ADR 0006's reason still holds: a half-block cell shows one pixel per column, so the Raster
cannot show the 1.5× art at 1:1 inside the band's cells. The trade is accepted: on the Raster
the pixels are fewer, and the frames, effects and timing are the same.

## Considered options

- **The Raster draws 1.5× when the band is wide enough, 1× below**: rejected. It keeps two
  art sets and two code paths, and the common 116-column terminal never sees the frames.
- **A taller and wider Raster band (174 to 240 columns, 26 rows) for 1:1**: rejected. ADR
  0010 fixed the stage's rows so the band never changes height, and most terminals are not
  that wide.

## Consequences

- ADR 0006 is superseded by this one for the stage; its two drawings per sprite stay for the
  windows and the compact stage. ADR 0007's "Why 1.5× only" and ADR 0004's "holds for the art,
  not for the thresholds" are read with this ADR.
- A three-surface golden set for a few key scenarios (an attack with a hit, a dissolve and a
  spawn, a chest) is compared by eye once, at the PR, to catch a desktop that reads slow.
- **Chosen encoding** (2026-10-14, measured in #210 with `pnpm svg:measure`, built in #212):
  strokes. Each colour of each art, the backdrop included, is drawn as the shortest of three:
  its rectangles filled, its horizontal runs, or its vertical runs, the runs stroked one pixel
  wide down their middles; ids are one letter and colours three digits where they pair. It draws
  the same pixels as the encoding before it in every look Chromium took, and cuts 40 to 46%. The
  fullest scenario, `step-boss`, is 34,007 characters with SMIL on and 20,754 off (60,510 and
  38,403 before), so every scenario is under three quarters of the cap on the first rung. ADR
  0006's fuller legal frame is 64,487 at rest and 118,952 lunging with no backdrop, both on the
  first rung. At rest over its worst zone (zone 10) it is 84,894, on the first rung. Lunging
  over it, 139,359 on the first rung, it lands on the last, the backdrop dropped, at 114,061, as
  it does over zones 3, 8 and 9; over zones 7 and 11 it lands on the rung that drops the idle
  pair. No frame fits on no rung. Over the cap the engine's CLI refuses the tree and draws its
  own content in the band's slot for that redraw, read from the 2.1.299 bundle and not seen in
  the app. The open fact: the desktop app draws a PNG embedded as a data URI in the
  non-interactive stage picture (Kevin, on #210, 2026-10-14: yes). The PNG encoding measured
  13,902 characters on its largest scenario and puts every fuller frame on the first rung,
  17,578 lunging over zone 8, at the cost of a one-device-pixel seam along an art's edge where
  the scale is not whole, and of drawing nothing if `SVG_INTERACTIVE` is ever turned on, since
  that path's scrub forbids `<image>`. The build ran before the answer was read and took
  strokes, which fit without it; moving to embedded images is a later decision.
