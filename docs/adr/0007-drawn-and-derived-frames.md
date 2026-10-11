---
status: accepted
---

# Two frames drawn, two derived, all on the idle's canvas

Every actor on the 1.5× stage animates through six drawings: idle A (its 1.5× art), idle B, a
wind-up, a strike, a follow-through (the knight only) and a hit. The wind-up and the strike are
drawn by gpt-image-2 against the shipped 1.5× art and committed as PNGs in
`art/sprites-frames/`; a hero's strike is its `hero_attack` art. Idle B and the hit are not
committed: `hooks/sprites/derive.ts` computes them from idle A at draw time (`squash` drops the
figure's middle row; `shear` leans it back by one column per 12 rows, in a palette lightened by
gamma 0.6), memoised per art.

## Why two derived

Idle B is a one-row squash and the hit a lean and a lighten: fixed transforms of idle A that a
drawn frame would only approximate. Committing them would be 160 more PNGs (two per actor at
both art sizes would be more) to keep in step with every redraw of an idle, for no detail the
transform does not already give. In the `Svg` they cost no def: idle B is two uses of idle A's
def under row clips, one a pixel down, and the hit is `k + 1` row-clipped uses under a
`feComponentTransfer` gamma filter equal to `lighten`. The idle loop and a hit add a few hundred
characters per actor.

## Why drawn frames sit on the idle's canvas

A frame is padded bottom-centred to its idle 1.5× art's width and height, and shrunk to fit if
larger. Every pose then draws at the idle's place: packing, numbers and drops measure from the
idle, and only the hit (which grows on the actor's back side) carries an offset. The cost is the
fit: a pose that reaches past the idle's footprint (a raised sword, a lunge) is shrunk, so its
pixels draw smaller than the idle's. The build lists every frame whose native is more than 20%
off its idle's, or that the fit shrinks by more than 20%, under `frame size drift:`.

That list is long. gpt-image-2, asked for the same figure in a new pose, draws attack poses
larger than the idle (a median of about +30% on the long side), and a turn boss's 36-row canvas
shrinks a wide strike to two thirds. Of the 157 drawn frames, the drift list holds 122, on 60
actors; `art/sheets.md` carries them under "Redos (frames)". They ship as drawn: the 22 image runs
of PR 3 spent most of a weekly codex window, and redoing the list would cost about 19 more with
the same prompts (Kevin, 2026-10-08). A later pass refines the frames Kevin marks on the review
page.

## Why 1.5× only

A half-block terminal shows one pixel per column, and the compact stage is 8 pixels tall: a
16 px figure has no room for a wind-up that reads as more than noise (grill Q21). At 1× the
actor keeps one drawing (a hero shows its attack art through the wind-up and strike) and the
code motion it had: the lunge, the bob, the 160 ms flash. The 1× goldens did not move.

The effect sprites (fireball, light burst, arrow) are ordinary `nes` sprites with 1× and 1.5×
art, so they draw at both densities and on the compact stage.

## Headroom

The SMIL `Svg` draws every pose from the actor's poses, never from the drawing at the redraw's instant, so its length does not depend on which half of the bob's clock a redraw lands in. Drawn frames are defs of their own while in use: the frames of motions live at a redraw or
starting before the next one (167 ms), with the rest of the same action. A whole tick's queued
actions would put every attacker's frames in one document.

- ADR 0006's fuller legal frame (a 72 × 51 boss and four 24 × 24 enemies dithered in 16
  colours, two dissolving, three checker heroes, a drop) is a committed fixture. At rest, with
  the idle pair, its 1.5× SMIL `Svg` is 113,047 characters, under the 131,072 cap.
- The same frame with the boss 60 ms into a lunge on two dithered 72 × 51 frames and a hero hit
  is 216,353 characters: `svgWithFallback` draws the 1× `Svg` (51,341) for it. Adversarial art
  at the edge of legal costs the desktop its 1.5× drawing during a boss's attack.
- The real bandit captain 60 ms into its lunge, on its drawn frames (the `boss-strike`
  scenario), is 32,731 characters: a quarter of the cap.

## Consequences

- `art/sprites-frames/` holds 157 PNGs (two per actor, three for the knight, one per other
  hero), cut from 21 frames sheets in 22 runs (one boss sheet came back on black and was run
  again); their prompts, picks and cuts are in `art/sheets.md`. `generated.ts` grew from 335 KB
  to 615 KB.
- The slicer gained `--gutters`: attack poses reach into the next cell, and a forced gutter
  splits two touching sprites, dropping a neighbour's tip that reaches across.
- The derived frames are pure functions of idle A: a redrawn idle redraws them too.
