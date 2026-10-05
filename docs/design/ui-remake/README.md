# UI remake: style direction

Locked by Kevin on 2026-10-05: **B, Command Windows.**

Comparison page with all eight directions, drawn on the real stage with the game's sprites:
https://claude.ai/artifact/MnNPLXiqrkMG3BxW8CjCMh

## The direction

- **Spine:** Dragon Quest V (Super Famicom) battle and item menus. Black windows with a rounded
  white double border, a ▶ cursor, nested windows: a command window, a list window, an action
  window opened from the cursor, and a message window.
- **Grafts:** the HP bar and "HP" tag from Pokémon FireRed in the party windows; rarity as the
  item name's text colour.
- **Band:** the stage stays exactly as it is (120 × 16 stage px, scaled 6×). The two text rows
  under it become one 3-row graphic HUD strip: a window under each actor, the zone and gold
  window in the middle. The combat log runs in a message window in the empty middle of the
  stage. The band at rest grows from 10 rows to 11.
- **Pane:** every tab is the same window set. The tabs are a command window, Inventory is a list
  window plus an action window plus a message window, Market is a DQ shop (Buy / Sell / Leave),
  Orders is a list with a status column, Chat lives in the message window, Leaderboards and Odds
  are single list windows.
- **Keys:** arrows and Enter move the cursor, as in DQ; letters stay as shortcuts.

Not chosen: A (Pause Screen), C (Battle HUD and Bag), D (Wood and Slots), E (Ring Menu), and the
mixes F, G and H. F (B with A's pips and D's gear panel) was the recommended mix.

## Open before a plan

1. Transcribe Dragon Quest V's windows from real screenshots (design-from-references). The
   mockups were drawn from memory.
2. Spike: text. Bake a pixel font into the bitmap, or lay real terminal `Text` over the `Image`
   (does a positioned Box paint over an Image?).
3. Spike: whether the terminal scales a pane-sized `Image` without blurring the pixels.
4. Spike: clicks. `Client` modules get the pointer but cannot draw `Image`.
5. Order against phase 4 PR 2: its style-sheet gate first, so the frame palette comes from the
   sprite palette.

## Files

- `current-band.png`, `current-inventory.png`: the UI before the remake (2026-10-04).
