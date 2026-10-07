# Phase 4 PR 2 grill: the real art

Started 2026-10-07 on Opus 5.5. Inputs: the PR 2 hand-over in
`docs/plans/2026-10-04-promptfall-phase-4.md` (§ "Hand-over for the PR 2 plan"), the phase 4 grill
`docs/plans/2026-10-04-phase-4-grill.md` (§1.8, §1.10, §1.12), `art/manifest.json`.

## 0. Facts at the start

- The codex weekly window had reset by the morning of 2026-10-07 (0% used, next reset Wed
  2026-10-14 07:00), although the handoff expected it to stay used up until Fri 2026-10-09. A luna
  smoke run (`quota-smoke`, 2026-10-07T08:59:08) answered. gpt-image-2 is available now.
- Claude can author pixel art as character grids rendered to PNG. Fine at 16 × 16 with 4 colours,
  clearly weaker than gpt-image-2 at 48 × 34 with 16, and it would not share the generated sheets'
  style.

## 1. Rulings

### Round 1

- **Q1, placeholders.** No hand-drawn placeholders. Every sprite is generated through codex-image.
  The concept aliases stay until each real sprite replaces them.
- **Q3, cue clips.** Claude downloads Juhani Junkala's CC0 "512 Sound Effects (8-bit style)" and
  shortlists 3 candidates per cue (`boss`, `drop`, `legendary`, `level_up`), each with an `afplay`
  line; Kevin picks the four. Runs alongside the art.
- **Q4, hand cleanup.** Claude does the cleanup of the 4 heroes, their 4 attack poses and the 4
  world bosses: sliced PNG to a character grid, fix stray pixels, outline and the rarity slot,
  back to PNG. Kevin approves on the contact page; Aseprite only if a sprite needs more.
- **Q2 and Q5** were answered together: Kevin wants the Final Fantasy feel kept but not copied,
  and three sample images first, to judge the direction and measure the quota cost before mass
  generation. They became Q6 to Q9.

### Round 2

- **Q6, the three samples are the style sheet split in three** (record §1.12's contents): sheet 1
  the 4 heroes idle and in their attack poses; sheet 2 zone 1's 4 monsters, zone boss and turn
  boss; sheet 3 one world boss (The Promptwyrm) and 4 item icons (iron sword, oak staff,
  chainmail, copper ring). On GREEN they are the style reference attached to every later run. A
  red on the heroes alone reruns sheet 1 only; if the heroes still miss, one extra run puts two
  variants per hero side by side.
- **Q7, FF distance.** Keep the archetype, silhouette class and colour family; change each
  trademark detail. Every hero is 3 colours plus the black outline, one of them the rarity slot.
  - Knight: the FF1 warrior class as on the concept sheet: open helm, plume, cross shield; the
    cape is the rarity slot.
  - Black mage: tall pointed hat, shadowed face with glowing eyes, dark robe kept; the hat tip is
    crooked with no straw brim or band, and a high scarf covers the lower face; the robe is the
    rarity slot.
  - White mage: white hooded robe and staff kept; no red triangle trim, a close round hood with
    no points, the face visible, a round chest sigil as the rarity slot, a ring-topped staff.
  - Archer: an FF-style ranger, not Link: short hood up, brown leather jerkin, longbow, a short
    cape as the rarity slot; no green, no long pointed cap.
- **Q8, reference for the samples.** The concept sheets are attached for style only
  (`nes-sheet.png` for the small sprites, `snes-sheet.png` for the bosses), with the hero changes
  in words and the record's sheet rules: pure magenta, a strict grid, no text, no grid lines.
- **Q9, review.** One private artifact page: each raw sheet; each sprite sliced and palette-locked
  at 4× with its id; the zone 1 stage as the game draws it; the quota the three runs used and the
  projection for the whole job. Kevin answers GREEN, RED or notes per sprite.

## 2. What the samples found (2026-10-07)

Review page: https://claude.ai/artifact/FgkfcBP9UwjDWRXc3Ubi2S. Nine image runs (registry labels
`pf2-*`), 7% of the weekly window and 46% of the 5-hour window by the end.

- **One run costs about 0.7% weekly and 5% of the 5-hour window**, 170 to 300 s.
- **The magenta rule has to come first in the prompt.** Two of the three first sheets came back on
  black with glow haloes, which the slicer cannot key (the outlines are black). With a "hard
  requirement, read first" block at the top, every later run was on magenta.
- **gpt-image-2 picks its own pixel size** (about 7 to 14 screen pixels per art pixel on a
  1536 × 1024 sheet). It ignores a pixel count in the prompt and a checkerboard template of the
  exact grid. It follows cell size: 4 × 2 cells drew heroes 25 to 33 art pixels tall (a 0.5 shrink
  to 16, faces lost); 8 × 4 cells of 192 × 256 drew heroes, monsters and items at 13 to 20 (a
  0.8 to 1.0 shrink, details kept). Zone bosses two to a row came out 58 × 42 (0.81 to 48 × 34);
  world bosses four to a row came out about 60 × 74 (0.46, muddy). A lone boss filling the sheet
  is worse still.
- **The slicer's point sampling breaks at non-integer ratios.** A scratch prototype recovers each
  cell's native grid (the art-pixel size is the commonest dark run, i.e. the one-pixel outline;
  the offset from colour transitions) and shrinks by an outline-aware majority vote (a target
  pixel with a third or more of dark source pixels stays outline). It replaces point sampling in
  `pnpm slice`.
- **Design.** The FF-adjacent heroes read as intended. Run 3 (take A) is closest to the classic,
  with a purple hat, a void face and yellow eyes; run 2 (take B) has a black hat with a pale scarf;
  the dense sheet mixed take A's colours with the scarf. Items are clean at either layout.

## 3. Open

- Kevin's verdict on the page: direction GREEN or RED, hero take, the dense-sheet recipe, the four
  cue clips.
- Downstream of the gate: sheet grouping (dense sheets across zones instead of one sheet per
  zone), the world boss rerun layout, the slicer rewrite, the contact page script, the run order.
