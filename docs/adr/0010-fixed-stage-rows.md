---
status: accepted
---

# A 17-row stage in every fight, zoomed out to a short band

The stage is 17 rows whatever is on it: the boss height of ADR 0003, at rest and with a turn
boss too. `rowsAt` answers `STAGE_ROWS` for every view. The heroes and monsters stand small on
the full painting, and a zone or world boss lands at its full size against them.

A band too short for the stage shows the whole scene smaller, never a piece of it: the Image
zooms out (the widened scene of PR #18, scaled into the rows left, down to 4) and the desktop
scales the Svg to the rows left (ADR 0004). The Raster cannot scale, so it keeps its art size and
shows the stage's bottom rows as `cells` (`layoutFor`; `stageFrame` crops the frame to them, the
Raster's numbers moving up), down to the tallest actor on it (`minRowsAt`: 8 rows for the party,
12 with a turn boss, 17 with a zone or world boss, held through a departed boss's dissolve), then
goes compact. The engine's `maxRows` is a hard limit: a taller band scrolls in a window, so the
band cannot push into the transcript.

_ADR 0018 (2026-10-14): the Raster now scales. It draws the one 1.5× scene resampled into its
full box, three scene pixels to two cell pixels, so "cannot scale" above no longer holds. A short
band still keeps the crop: the scene is cropped to the rows shown, three scene pixels a cell row,
then resampled. The reason is legibility: at 8 rows the Raster has 16 pixels of height, and a
24-pixel figure scaled into them is a smear._

_#230 (2026-10-14): on the Raster the crop comes first and the zoom follows, to a floor. A band
too short for the tallest actor no longer goes compact at once: the cropped scene (that actor's
rows) zooms out into the rows left, widened so it still spans the playfield, the Image's way,
down to `RASTER_MIN_ROWS` (8), and only under that goes compact. The legibility note above
narrows to that floor: a wave's crop is already 8 rows, so a wave never zooms, and a boss zoomed
into 8 to 16 rows was judged better than the compact band in a large terminal that grants the
band fewer than 22 rows (a 46-row Ghostty). The floor is tuned on sight; a smear raises it._

Kevin asked for both on 2026-10-08, playing with the backdrops in: the boss fights showed the
whole painting and he wanted that view all the time, with the units small so a boss's size lands;
and a long prompt had shrunk the stage to a strip, which he did not want, "even if it means
consuming more of the terminal". The engine caps what the band may consume, so under that cap
the whole scene scales. A crop that kept the art size and gave up the sky was tried the same
afternoon: it cut a boss's head, and at rest it gave back the old 8-row look Kevin had just asked
to leave behind. The zoomed-out view is the one he wants, whatever the band's height.

## Considered options

- **Grow the band past `maxRows`**: not possible. The engine's band contract shows at most
  `maxRows` rows whole and scrolls a taller tree in a window with an "n more" row, which would
  hide the party.
- **Crop the sky, keep the art size** (this ADR's first form, 2026-10-08 afternoon): rejected by
  Kevin on seeing it. A zone boss is the full 17 rows, so the crop took its head, and at rest the
  cropped stage looked like the old 8-row one. It stays only where scaling is impossible, the
  Raster, with the tallest actor as its floor. The mirrored painting past the frame's sides
  serves the zoom-out's widened scene.
- **Grow the stage only for bosses** (ADR 0003): superseded. The turn-boss jump ADR 0003 worried
  about is gone the other way: the band never changes height for a fight.

## Consequences

- The band on the Party tab is 22 rows (17 and the 5-row strip) in every fight, from 13 at rest
  before; the terminal needs 22 rows of `maxRows` to show it at full size. Under that the Image
  and the desktop show it smaller, whole; the Raster shows its bottom rows down to the tallest
  actor, then that actor's rows zoomed out down to 8 (#230), then compact.
  ADR 0003's "the band is 10 rows at rest and up to 19 in a boss fight" and its amendment read 22
  always now.
- The backdrop shows whole at rest. The review artifact's rest views are drawn at 17 rows.
- The stage never changes size during a fight, so the Image is keyed by the cells it shows and
  only a band's resize mounts a new one; the loop's layout-change invalidation fires only on props.
- Damage numbers over the Raster's cropped rows: one drawn above the crop is clamped into the
  box's top row.
- Every stage golden is 17 rows; the `rest` scenario's frame is 180 × 51 at 1.5×.

## Note (2026-10-15, spec #234)

The stage stays on every tab. The 22-row band, the crop to the tallest actor, the zoom to the
floor and the compact escape apply on Loot and World as on Party, and the band and the loop lay
out the stage rows on every tab alike, so the band's height never moves with the tab.
