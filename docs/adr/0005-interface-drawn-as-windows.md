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
