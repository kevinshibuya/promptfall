---
status: accepted
---

# The interface is drawn as pictures of windows, with the pixel font baked in

The band's text rows and every pane tab were terminal text: monospaced rows, bracket buttons,
emoji-sized icons. Next to the pixel sprites they read as raw. Kevin chose a Dragon Quest V
window style (command windows: a dark field, a rounded white border, a pixel font, a ▶
cursor) and chose to bake the font into the pictures rather than lay terminal text over
graphic frames. So the interface is one window model, laid out in cells, drawn by three
encoders, the way the stage already is: an RGBA image for terminals that draw pictures, an
`Svg` for the desktop, VS Code and mobile, and box-drawing text for terminals that draw none.
Only fields the player types into (chat, order forms) stay real `Input`s, under the picture.

## Considered options

- **Terminal text inside graphic frames**: rejected. Crisp and selectable, and it follows the
  player's font size, but it mixes smooth type with pixel frames, and nothing in the engine
  says a positioned Box paints over an `Image`.
- **Restyled terminal text only** (box-drawing windows everywhere): kept as the encoder for
  terminals without pictures, rejected as the main look. Kevin asked for "actual graphics".

## Consequences

- Text in the windows cannot be selected or copied, and does not follow the terminal's font
  size. Screen readers get each picture's `alt`, which must carry the window's text.
- The font (DotGothic16, SIL Open Font License) ships with the plugin.
- A window change is a redraw of a picture, so the pane redraws on input, and the band strip
  redraws with the stage's frame loop.
- Clicks inside a picture are not free: a `Client` gets the pointer but cannot draw an
  `Image`. v1 is keyboard only.

## Amended (2026-10-05, UI PR 1)

- The font is Misaki Gothic 2nd, not DotGothic16 (grill 1.18): measured against Dragon Quest V,
  DotGothic16's 13 px capitals fill a 16 px row and clip descenders, where DQ V sets 7 px
  capitals with 9 px of leading. NOTICE.md carries its licence.
- Terminals that draw pictures get one Image per window, not one picture for the strip: each
  window blits only when its own content changes.
- Hotkeys need Buttons on screen. Terminals and the desktop keep them in a zero-width Box, out
  of view; VS Code and mobile, untested, show them as a row under the strip
  (`docs/plans/2026-10-05-ui-remake-spikes.md`).

## Amended (2026-10-06, UI PR 2)

- The pane's ▶ follows the focus ring through hidden one-space Buttons, one per row or item.
  That works on terminals. The desktop's ring moves without raising `ui.focus`, so the desktop
  pane (and VS Code and mobile, untested) shows a `▲ ▼ ok back` row under the picture.
- The engine keeps the ring by position. When rows appear or go under it, the pane puts the
  ring back on the ▶ itself.
- An inline pane gets the rows the layout spares, not the 24 it asks for: 14 body rows in a
  105 × 50 Terminal.app, 7 in 80 × 24. The windows need 16 at least, so an inline pane in an
  ordinary terminal shows only the message window asking for room. A docked pane (fullscreen
  terminals from 110 columns) gets its full height.

## Amended (2026-10-06, UI PR 3)

- All eight tabs are windows now. The only things under the picture are the typed fields (the
  sell price, the order price, the chat line) and the GitHub device-flow link, one at a time,
  because a URL baked into a picture can't be opened. On a terminal the pane gives them their
  rows by building the picture again without them. Escape in a field closes the pane, as it
  does anywhere else, so the field says `Tab: leave the field.`
- A short pane drops the tab window and keeps its hotkeys. That answers PR 2's inline problem
  for wide panes: an inline pane in a 105 × 50 terminal gets 14 rows, and both layouts fit 14
  without the tab window. A narrow pane at exactly 14 rows with a field showing still asks for
  room, and 80 × 24 inline (7 rows) still doesn't fit.
- The pane probes the renderer itself while it is unknown. A docked pane collapses the band, and
  a collapsed band never probed, so the pane drew raster in cmux until the renderer was forced.
