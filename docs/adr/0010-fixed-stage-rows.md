---
status: accepted
---

# A 17-row stage in every fight, and a short band crops the sky

The stage is 17 rows whatever is on it: the boss height of ADR 0003, at rest and with a turn
boss too. `rowsAt` answers `STAGE_ROWS` for every view. The heroes and monsters stand small on
the full painting, and a zone or world boss lands at its full size against them.

A band too short for the stage keeps the art at its size and loses the sky: `layoutFor` keeps the
17-row box and gives the stage the rows left above the strip as `cells`, down to `STAGE_MIN_ROWS`
(8, the actors' height); the composer draws the whole box and `stageFrame` crops the frame to the
cells' bottom pixels, the Raster's numbers moving up with it. Under 8 rows the band is compact,
as before. The desktop does the same through the Svg's viewBox. The engine's `maxRows` is a hard
limit: a taller band scrolls in a window, so the band cannot push into the transcript.

Kevin asked for both on 2026-10-08, playing with the backdrops in: the boss fights showed the
whole painting and he wanted that view all the time, with the units small so a boss's size lands;
and a long prompt had shrunk the stage to a strip, which he did not want, "even if it means
consuming more of the terminal". The engine caps what the band may consume, so the stage keeps
its size and gives up the sky instead.

## Considered options

- **Grow the band past `maxRows`**: not possible. The engine's band contract shows at most
  `maxRows` rows whole and scrolls a taller tree in a window with an "n more" row, which would
  hide the party.
- **Keep the zoom-out** (PR #18: the scene widened and drawn into fewer rows): rejected by Kevin,
  the art shrank. It also needed the painting mirrored past its sides; that code stays as a
  safety, since no frame is wider than the painting now.
- **Grow the stage only for bosses** (ADR 0003): superseded. The turn-boss jump ADR 0003 worried
  about is gone the other way: the band never changes height for a fight.

## Consequences

- The band on the Party tab is 22 rows (17 and the 5-row strip) in every fight, from 13 at rest
  before; the terminal needs 22 rows of `maxRows` to show it whole, 13 to show the actors' rows.
  ADR 0003's "the band is 10 rows at rest and up to 19 in a boss fight" and its amendment read 22
  always now.
- The backdrop shows whole at rest. The review artifact's rest views are drawn at 17 rows.
- The stage never changes size during a fight, so the Image is keyed by the cells it shows and
  only a band's resize mounts a new one; the loop's layout-change invalidation fires only on props.
- Damage numbers over the cropped rows: a number drawn above the crop is cut on the Image, and
  the Raster clamps it into the box's top row.
- Every stage golden is 17 rows; the `rest` scenario's frame is 180 × 51 at 1.5×.
