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

### Round 3

- **Q10, direction: GREEN.**
- **Q11, heroes: the dense sheet's mix.** Take A's colours and silhouettes with the black mage's
  pale scarf over the lower face.
- **Q12, recipe: dense sheets.** 8 × 4 cells for every 16-pixel sprite (heroes, monsters, items);
  zone and turn bosses two to a row, four to a sheet. Replaces record §1.8's one sheet per zone.
  Every sheet attaches the approved sheets as its style reference.
- **Q13, cues.** `drop` = `sfx_coin_double3`, `legendary` = `sfx_coin_cluster8`, `level_up` =
  `sfx_sounds_powerup3`, `boss` = `sfx_alarm_loop3`, from Juhani Junkala's CC0 pack.

### Round 4

- **Q14, keepers.** The approved samples are final unless rejected at review: the 8 hero sprites,
  zone 1's 4 monsters and 20 items from the dense sheet, and the Bandit Captain and Wild Boar from
  zone 1 run 3. The dense sheet (small sprites) and zone 1 run 3 (bosses) are the style
  reference attached to every later run. 34 sprites are kept (corrected from 42 in chat); 90 are left.
- **Q15, grouping.** Monsters: dense sheet A takes zones 2 to 9 (two zones a row), sheet B zones
  10 to 12 plus pending redos. Items: one dense sheet for the remaining 20 plus redos. Zone and
  turn bosses: six sheets of four, two zones each. World bosses: one rerun. About 10 runs plus
  redos, zones in order.
- **Q16, world bosses.** One rerun in a 2 × 2 grid with the current world boss sheet attached as
  the design to keep; Claude's hand cleanup at 48 × 34 after.
- **Q17, briefs.** Claude writes one line per remaining enemy id into the plan (name, zone theme,
  role); Kevin skims it at plan approval.
- **Q18, slicer.** The prototype (native grid from the outline's run length, outline-aware
  majority shrink) replaces point sampling inside `pnpm slice`, same CLI, test-first against
  fixture sheets with a known grid. No flag for the old behaviour.
- **Q19, contact page.** `pnpm contact <zone>` (also items and heroes) writes one PNG: the
  sprites native and at ship size, plus the stage at rest and with the boss through the real
  composer. Batches are published to one review artifact, updated in place; Kevin answers per zone
  with GREEN or the ids to redo.
- **Q20, files.** Approved PNGs are committed under `art/sprites/<kind>/<name>.png` and the
  manifest switches from `alias` to `file`. Raw sheets stay in a gitignored `art/sheets/` with
  copies on the review artifact. Each sheet's prompt and slice command are committed in
  `art/sheets.md`.
- **Q21, SNES master.** Re-derived once with `--derive-snes-master` from zone 1's two bosses and
  the four world bosses after the rerun, then locked.
- **Q22, cues.** The four picks overwrite `plugins/promptfall/cues/*.wav` under the same names;
  `scripts/placeholder-cues.ts` and `cues:placeholders` are deleted; the README credits the pack.
- **Quota discipline (Kevin).** No Opus spent idling on codex: image runs go to the background and
  the session waits for their notification, never polling. If the codex limit hits, everything
  stops at once and the reset time is reported; no retry, no workaround.

### Round 5

- **Q23, defaults, as recommended.** Review never blocks the work: code tasks run while sheets
  generate, redos ride the spare cells of the next sheet, and the PR opens once every zone is
  GREEN. Verification: a test asserting `PLACEHOLDER_COUNT === 0`, regenerated stage goldens
  (said in the commit), the adversarial Svg budget test green, `sprites:check`, the full check
  line, a Ghostty manual pass; the `codex-computer-use` check is skipped and said so in the PR if
  the codex quota is gone. One PR into `ai-staging`; the review wave is `reviewer` on Opus alone.
- **Saved inputs.** The approved raw sheets, the prompt parts and the four picked cue clips are in
  the gitignored `art/sheets/` (dense sheet: `dense-heroes-zone1-items.png`; zone 1 bosses:
  `zone1-bosses.png`; world bosses to keep as designs: `world-bosses-r1.png`). The cue pack is
  https://opengameart.org/content/512-sound-effects-8-bit-style. The slicer prototype is committed
  at `docs/plans/phase-4-pr2/slice-prototype.ts`.

## 3. Open

Nothing. The frontier closed after five rounds.
