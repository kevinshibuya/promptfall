# Phase 4 PR 2: the 2× stage, grill

Kevin, 2026-10-07: the native cuts look far better than the 16-pixel shrinks, so PR 2 also draws
the stage at twice the pixel density on the surfaces that can show it, and ships those natives.
This amends `docs/plans/2026-10-07-promptfall-phase-4-pr2-art.md`, whose "the engine is untouched"
no longer holds.

## Facts (scout, 2026-10-07)

- The stage is composed in stage pixels: one per column, two per row (`stage/compose.ts:71`).
  The Image encoder upscales that frame by `IMAGE_SCALE` 6 (`stage/image.ts`, `stage/loop.ts:104`);
  the Raster encoder maps one pixel per column and two per row as half-blocks; the Svg draws the
  sprites itself as run-length rects from the `SpriteArt` (`stage/svg.ts:21`).
- Budgets: Image under `IMAGE_MAX_BYTES` 1 MiB; the engine caps `Svg.source` at 131,072
  characters; Raster at 1,024 colour pairs. Today's real scenes are 7,081 to 10,277 Svg characters.
- The damage numbers are a 3 × 5 pixel font drawn into the frame (`stage/font.ts`).
- The dialog's list windows fit a sprite into a 16 × 16 picture-pixel slot, one cell row tall
  (`windows/kit.ts:184`); raster windows leave the slot blank.

## Round 1 (Kevin, 2026-10-07)

- Q1: the band keeps every size it has in cells (8, 12 and 17 rows, 120 columns, the 116-column
  minimum, the 52 × 4 compact stage); only the picture gets twice the pixels.
- Q2: every sprite id (all 125) gets a 2× drawing; drops reuse the item's.
- Q3: the 2× art is the native cut as drawn, snapped and limited; hand fixes only where a check
  fails or Kevin names an id.
- Q4: 2× canvases are exactly twice today's: 32 × 32 for heroes, monsters and items, up to 96 × 68
  for bosses, turn bosses fit to 48 rows. A native that does not fit shrinks by the majority vote.
- Q5: every 2× sprite may hold 16 colours (Kevin: the bosses' 16 colours are why they look better;
  the recommendation was 8 for heroes, monsters and items).
- Q6: today's 1× art stays as a second maintained set: half-block terminals, the compact stage.
- Q7: each 2× hero pose takes its own `rarityColor` from its native; that colour may appear nowhere
  else on the pose, or the pose gets a hand fix.

## Round 2 (Kevin, 2026-10-07)

- Q8: one derived 128-colour palette for all 2× art, bosses included, from every native; the 1×
  set keeps the NES and SNES masters.
- Q9: the damage numbers keep the 3 × 5 glyphs, drawn at 2×.
- Q10: every motion distance doubles (lunge 8, bob 2, number rise 12, drop rise 20 hi-res pixels).
- Q11: the Image renderer composes the 2× frame and upscales it 3×: same output size and bytes.
- Q12: the Svg draws 2× art and falls back to 1× art for a frame whose 2× markup would pass the
  engine's 131,072-character cap; the adversarial budget test pins the fallback.
- Q13: the compact stage stays 1× on every renderer.
- Q14: the list windows keep 1× art in their one-row slot.
- Q15: glossary: a Sprite has **1× art** and **2× art**; "native" stays a pipeline word.
- Q16: the review page leads with the 2× art at 3×, the 1× beside it; Kevin's GREEN is on the 2×
  art; manual-pass Part B checks the 2× stage in Ghostty and the desktop, 1× in iTerm2.

Kevin then asked for three to four more frames for every hero, monster and boss (an idle loop, an
attack, a hit), and a different attack animation for each hero. Round 3 opens that branch.

## Round 3 (Kevin, 2026-10-07): animation frames, for PR 3

- Q17: frames are phase 4 PR 3, after PR 2 merges with still 2× art; they are drawn over it.
- Q18: every actor (4 heroes, 48 monsters, 24 zone and turn bosses, 4 world bosses) gets four
  frames beyond today's drawing: idle B, attack wind-up, attack strike, hit. A hero's existing
  attack pose is its strike; its fourth new frame is class-specific (Q20).
- Q19: the 2-frame idle loop replaces the 1-pixel bob; wind-up and strike play during the lunge;
  the hit frame shows for the flash's duration, the white flash shrunk to a blink at its start;
  dissolve and drop unchanged; `/promptfall motion still` freezes idle on idle A.
- Q20: distinct hero attacks. The knight winds up, slashes and lunges, with a follow-through frame.
  The black mage casts in place and a fireball crosses the stage. The white mage raises the staff
  and light bursts on the target. The archer draws, releases, and an arrow flies. The fireball,
  light burst and arrow are effect sprites the stage moves, as it moves drops.
- Q21: frames are 2× only; 1× surfaces keep one drawing and code motion; the effect sprites show
  at 1× too.
- Q22: each Svg redraw carries only the frames in use (both idle frames, attack and hit frames
  while their motion runs), falling back to 1× over the cap.
- Q23: gpt-image-2 draws the attack frames with the shipped native attached as the reference;
  idle B (a one-row squash) and hit (a lean-back tilt, a lighter palette) are derived from frame 1
  by fixed transforms. About 25 image runs.

## Scope

PR 2 adds the 2× stage (rounds 1 and 2). PR 3 is the frames (round 3) and gets its own plan.

## Round 4 (Kevin, 2026-10-07, after the plan review)

The plan review found that at 2× the natives (median 22 px on the long side) draw about a third
smaller than today's sprites, since a 2× slot is 32 px; growing them would smear the pixels. A
mock of the resting stage confirmed it.

- Q24: the detail density is 1.5×, not 2×. Canvases: `nes` 24 × 24, `snes` at most 72 × 51, turn
  bosses fit to 36 rows (shrink only). The full stage is 180 × 24 pixels at rest (51 with a zone
  boss); the Image renderer upscales it 4× (same bytes as today). Every motion distance and layout
  constant is multiplied by 1.5 and rounded. Rounds 1 and 2 hold with 1.5 for 2.
- Q25: the damage numbers draw their 3 × 5 glyphs as 2 × 2 blocks at 1.5×: a third larger than
  today on screen.
- The glossary term becomes **1.5× art** (Q15's "2× art").
