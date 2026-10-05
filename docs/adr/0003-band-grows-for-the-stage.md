---
status: accepted
---

# The band grows past 4 rows so the stage draws real pixels in every terminal

Phase 4 puts an animated battle stage in the band's Party tab, and it has to show pixel
sprites in every terminal, not only in the two (kitty, Ghostty) whose `Image` element draws
pixels. Everywhere else the only pixels are half-blocks in a `Raster`: two pixels a row, so
the 4-row band the spec held as a non-negotiable is 8 pixels tall. We drew the art at full
detail instead and let the band grow: the stage is 8 rows at rest (16 px heroes and
monsters), 12 rows for a turn boss, 17 rows for a zone or world boss (34 px SNES art), with
two text rows under it. The band is 10 rows at rest and up to 19 in a boss fight, and every
terminal shares that geometry, `Image` filling the same box crisp.

## Considered options

- **Keep 4 rows, shrink the art to 8 px** in half-block terminals: rejected, the sprites
  lose their detail and a boss can be no taller than a hero.
- **Glyph rows where pixels are missing** (today's band): rejected by Kevin on seeing it:
  "we need proper visuals, for every single terminal".
- **12 rows in a boss fight**: rejected for 17, so bosses keep their full SNES detail and
  stand twice a hero's height.
- **A fixed 17-row stage for every boss**: rejected, turn bosses come after every heavy
  turn and would make the band jump to 19 rows constantly; the stage grows only as tall as
  the boss needs.

## Consequences

- Spec §2's "the band is 4 rows at rest" now reads 10 at rest and up to 19 in a boss fight.
  Its intent survives through the escapes: a 4-row compact stage with downsampled sprites
  when the terminal is too short or 100 to 115 columns wide, 1 row under 100 columns, hidden
  while Claude asks a question, and `/promptfall off`.
- The Loot and World tabs keep 4 rows, so switching tabs changes the band's height.
- Half-block cost sets the stage's width too: a 16 px sprite is 16 columns, three heroes
  and three monsters about 110, which is why the full stage needs about 116 columns.
