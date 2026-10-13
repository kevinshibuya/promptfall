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
