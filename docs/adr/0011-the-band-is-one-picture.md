---
status: accepted
---

# The band is one picture: a playfield on a shell

On the Party tab the band draws one bitmap: a charcoal shell filling the band's whole box, and
on it the playfield, the stage with the strip beneath it, edged by one window line with cut
corners. One `Image` on kitty, Ghostty and cmux, one `Raster` on half-block terminals, one Svg
scene on the desktop. Loot and World draw the strip alone as the playfield, on the same shell;
compact draws its 4-row stage and its window inside one line. The line is drawn in pixels: it
takes the shell's margin when the band is wider than the playfield and sits over the stage's
outermost pixel row and column when the playfield fills the band, so ADR 0010's 17 stage rows
and 22-row band stand. Inside the playfield there is no shell between stage and strip: the
stage's ground meets the windows' top lines.

Kevin asked for it on 2026-10-09, from a cmux screenshot at 170 columns with a tall prompt: a
blank row of terminal between the stage and the strip, and a zoomed-out stage sitting small in
an empty band. The stage and strip were two elements laid out by Ink, the stage centred and the
strip left-aligned, so even without a zoom they were 5 columns apart at that width, and every
cell they did not cover showed the terminal. His reference was the Game Boy Advance: a screen set
into a solid shell that fills whatever is around it, so "everything is glued together". The line
around both, not around the stage alone, is his call: the strip's windows already carry their
own lines, and he wants one shared edge over them.

## Considered options

- **Paint the leftover cells with Ink**, keeping the stage and strip as separate elements:
  cheap and renderer-independent, but cell-coarse. The playfield's edge would be a cell wide on
  an Image terminal next to one-pixel window lines, and a seam between two elements can still
  open, since the host stretches a PNG into its cell box and exposes no cell pixel size.
- **A line around the stage alone**, the strip's windows sitting on the shell as Dragon Quest V
  windows sit on black: rejected by Kevin for the shared edge above.
- **A console-coloured shell with buttons**: rejected. The game's framing vocabulary is the
  Dragon Quest window (ADR 0005); a second vocabulary would sit beside it, and decoration costs
  columns for nothing the game needs.

## Consequences

- The strip is composed into every stage frame on Image terminals, so a strip change redraws the
  band bitmap, and the per-window `Image` elements go. At 160 columns the band bitmap is
  1280 × 352, about 2.3 times the pixels of the stage PNG it replaces (960 × 204).
- The host's `Image` takes at most 255 columns: the shell stops there, centred, and the terminal
  shows beyond it. The `Raster` takes 512.
- Ghostty and cmux fit the PNG to its cell box preserving aspect, centred, rather than stretching
  it (checked 2026-10-09 with `spikes/aspect`, Ghostty 1.3.1 and cmux 0.64.25). Their cells are a
  little taller than the band's 8 × 16, so a thin strip of terminal shows above and below the
  whole picture, split evenly: about two thirds of a row in all at Ghostty's default font. The
  real cell ratio cannot be read from inside the plugin, so the residue is accepted.
- Switching tabs never flashes terminal background: the shell is the band's field on every tab
  and layout, except the one-line collapsed summary, which stays text.

## Note (2026-10-15, spec #234)

The stage stays on every tab: Loot and World draw the stage with the strip beneath it as the
playfield, as Party does, no longer the strip alone, and compact draws its small stage beside the
tab's window rows. One picture, at one height, on every tab.
