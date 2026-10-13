---
status: accepted
---

# The desktop stage scales; the cell thresholds are for terminals only

ADR 0003 sized the stage in terminal cells: the full stage needs about 116 columns because a
half-block cell is one pixel wide, and the compact and collapsed escapes take over below
that. The desktop app reports its band in the same units, and on a 1440-point Mac with the
window at full width it reports 95 columns and 12 rows, so the shared rule collapsed the
desktop band to one line and the stage never drew there. The desktop draws the stage as an
`Svg`, which scales, so cells are the wrong limit for it. The desktop always draws the full
stage: the art at its terminal geometry (at least 116 pixels across, at most 160), scaled to
the band's width, and growing to the boss heights (14 and 19 rows) whatever `maxRows` says.
Kevin chose this knowing the stage can take much of a small window.

## Considered options

- **Lower the full-stage threshold for every surface**: rejected for terminals. Below about
  116 columns the party and the enemies overlap (by 17 px at 95 columns), or the actors pack
  so tight they touch.
- **Keep the boss stages within the desktop's `maxRows`** by scaling them down: kept only as
  the fallback if the desktop clips or scrolls a band taller than `maxRows`.

## Consequences

- Spec §10's "one geometry for all" now holds for the art, not for the thresholds (and
  since ADR 0018 the art is one scene on every surface): the
  compact stage and the one-line band are terminal escapes. On the desktop the band
  collapses only when the person collapses it, the session is not primary, or a survey is
  showing.
- The tests mount the desktop at the size it really reports (95 × 12), not at a terminal
  size.
