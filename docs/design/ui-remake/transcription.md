# Dragon Quest V windows: transcription

Task 2 of `docs/plans/2026-10-05-ui-pr1-window-band.md`, done with `design-from-references`.
The references are Super Famicom screenshots (256 × 224) from
https://www.hardcoregaming101.net/dragon-quest-v-hand-of-the-heavenly-bride/, files
`dq5-N.png` on that page. They are not committed (copyright). Measurements are in source pixels,
read from the files, not from memory.

| # | File | Kind | What it shows |
| --- | --- | --- | --- |
| 1 | dq5-8 | battle | **Spine.** Party window (3 members), tactics window, command window, enemy window |
| 2 | dq5-2 | battle | Party window (2 members), command window, enemy window with 3 groups |
| 3 | dq5-6 | battle | Party window (2), tactics window, command window, enemy window |
| 4 | dq5-18 | battle | Party window (3) with only an H row, tactics window, message window |
| 5 | dq5-12 | battle | Message window alone, 3 lines of combat log |
| 6 | dq5-5 | dialogue | Message window, speaker inline, ▼ prompt |
| 7 | dq5-16 | dialogue | Message window plus a yes/no window |
| 8 | dq5-17 | dialogue | Message window with ▼ |

## The spine: dq5-8, slot by slot

| Slot | Record |
| --- | --- |
| Window shape | Field rectangle, a white line 2 px thick inset 1 px inside the field's edge, the line's outermost corner pixel cut (a 1 px rounding); the field's own corner pixel cut too. No shadow, no gradient, no double line. |
| Field colour | `0x303028` (48, 48, 40), every window. Not black. |
| Line and text colour | `0xf0f0e8` (240, 240, 232), one white for borders, dividers, text and the cursor. |
| Text grid | 8 px advance, 16 px line pitch. Window text starts 5 px inside the white line (x 24 for a white line at x 17-18). |
| Type | 1 px strokes. Latin and digits about 6 × 7 px (`H` is 6 wide, 7 tall; digits 6 × 8), sitting at rows 5-11 of their 16 px line: 9 px of leading. |
| Party window | x 16-144, y 16-84. Header row: names, one per column. A 1 px white divider under it, joined to the border on both sides. Then rows `H`, `M`, `Lv:` (a ligature glyph and a colon). Columns 5 cells (40 px) apart: label, space, number right-aligned in 3. HP as numbers only. |
| Tactics window | Top right, 2 rows ("めいれい / させろ"), no header, no cursor. |
| Command window | Bottom left. Header row: the acting member's name, centred; divider; 4 items; ▶ cursor left of the chosen item. |
| Enemy window | Bottom right, beside the command window. One row per group: name, then `—` and the count right-aligned ("つちわらし — 2ひき"). No HP, no bar, no header. |
| Cursor ▶ | A filled triangle 4 px wide, 7 px tall (widths 1, 2, 3, 4, 3, 2, 1), at x 2-5 of its cell, level with the glyphs. |
| Numbers | Right-aligned in a fixed width. |
| Placement | Party and tactics windows over the top of the scene; command and enemy windows over the bottom; enemies stand between. |

## The other references

| # | What differs from the spine |
| --- | --- |
| dq5-2 | Party window with 2 columns; enemy window with 3 groups (3 rows); no tactics window. Same field, line, type, divider. |
| dq5-6 | Same windows as the spine with 2 party members; the command window's header names the acting member. |
| dq5-18 | The party window drops to a header and one `H` row when nothing else is shown: windows size to their rows. |
| dq5-12 | During the log, only the message window shows: 3 lines, about 26 cells wide, no header, no cursor. Each event is its own line ("Gonz attacks! / Papas takes 18 damage! / Papas has died!"). |
| dq5-5, dq5-17 | Dialogue window: same field and line; the speaker is inline ("ソフィア「…"); a ▼ (7 px wide, 4 tall: widths 7, 5, 3, 1) centred under the last line asks for a key press. |
| dq5-16 | A yes/no window sits top right of the dialogue window, a list window like the tactics window. |

## Font: DQ V against the candidates

Measured above: 7 px caps, 1 px strokes, 16 px line. DotGothic16 (grill 1.5) at its native
16 px has 13 px caps and a 24 px line (ascent 19, descent 5): in a 16 px row it leaves no leading
and clips descenders by about 2 px. Misaki Gothic 2nd's full-width Latin at 8 px has 7 × 7
glyphs with 1 px strokes, the same scale and weight as DQ V's. Kevin chose Misaki Gothic 2nd
(grill 1.18) from a side-by-side render; its lowercase reads letter-spaced (narrow glyphs on an
8 px advance), an accepted cost. Its 8 × 8 glyph goes in the 8 × 16 cell at `GLYPH_Y = 5`, so the
glyph's ink sits at rows 5-11, as DQ V's does.

## Kit values

| Constant | Value | Source |
| --- | --- | --- |
| `FIELD_RGB` | `0x303028` | spine, sampled |
| `BORDER_RGB`, `TEXT_RGB` | `0xf0f0e8` | spine, sampled |
| `DIM_RGB` | `0x888880` | graft: the band's dim text (no dimming in the references) |
| `WARN_RGB`, `DOWN_RGB` | `0xf8a030`, `0xe83830` | grill 1.13 (no low-HP shot in the references; kept from the plan) |
| `HP_BAR_RGB`, `BAR_BACK_RGB` | `0x58d858`, `0x484840` | graft: the Pokémon HP bar (grill 1.12); the back is the field lifted one step |
| `GAUGE_RGB`, `GAUGE_FULL_RGB` | `0x58a8f8`, `0xf8d038` | graft: the Final Fantasy action gauge (grill 1.14, 1.15) |
| `BORDER_PX` | 2 | spine: the white line |
| `MARGIN_PX` | 1 | spine: field outside the white line |
| `PAD_PX` | 4 | spine: field between the white line and the content cell (the glyph's own 1 px bearing makes DQ's 5) |
| `GLYPH_Y` | 5 | spine: the first row of the 8 × 8 glyph in the 16 px cell |

### The frame in whole cells

DQ V's frame is thinner than a cell. In our cells the frame sits against the content, the rest
of the border cell is transparent (alpha 0, the terminal's background shows):

- left border cell (8 wide): x 0 transparent, x 1 field (margin), x 2-3 white, x 4-7 field;
  the right border cell mirrors it;
- top border row (16 tall): y 0-8 transparent, y 9 field, y 10-11 white, y 12-15 field;
  the bottom border row: y 0-3 field, y 4-5 white, y 6 field, y 7-15 transparent.
- A title or footer (grill 1.16, a graft: DQ V has no titles in borders) is drawn across the
  whole border row on a field plate one cell wider than the text on each side, breaking the
  white line; its glyphs keep `GLYPH_Y`.

## Bitmaps (8 × 16, `#` white, `.` field, `-` transparent)

Top-left corner (the other corners mirror it; edges repeat its last column or row):

```
--------
--------
--------
--------
--------
--------
--------
--------
--------
--......
-..#####
-.######
-.##....
-.##....
-.##....
-.##....
```

Divider (`rule`): one white row at y 15 of the ruled line, across the inner cells and into both
border cells as far as their white line (`-.######` in the left border cell at y 15).

▶ cursor:

```
........
........
........
........
........
..#.....
..##....
..###...
..####..
..###...
..##....
..#.....
........
........
........
........
```

▼ (the dialogue prompt, PR 2):

```
........
........
........
........
........
........
#######.
.#####..
..###...
...#....
........
........
........
........
........
........
```

▾ (the collapse mark; a graft from the current band, smaller than ▼):

```
........
........
........
........
........
........
........
.#####..
..###...
...#....
........
........
........
........
........
........
```

## Absence list

Not in any reference, and not to be added: drop shadows; double borders; gradients or textured
fields; icons beside list items; header bars in a second colour; rounded corners larger than
1 px; a second text colour for labels; HP bars on enemies in DQ V (ours are a graft, below);
borders in colour.

## Grafts, by name

- HP bars in the party and enemy windows: Pokémon FireRed (grill 1.12, README).
- The action gauge row: Final Fantasy's ATB gauge (grill 1.14, 1.15).
- Titles and footers in borders: grill 1.16.
- The command line `▶Party Loot World ▾`: the command window's ▶ list, laid on one row
  (grill 1.7).
- The purse window: the tactics window's shape holding gold and the tactics (grill 1.13, 1.16).
- Rarity colours on drop lines: README.

## Deltas from the spine, decided

- All windows sit in one strip under the stage, not over the scene's top and bottom (grill 1.7).
- The party window shows `H` and the gauge, not `M` and `Lv` (grill 1.15); the level joins the
  name in the header.
- The enemy window shows one row per enemy with an HP bar, not groups with counts (grill 1.7):
  a wave holds at most 3 enemies.
- There is no command window: the game is idle, nobody picks actions (grill 1.4, 1.7).
