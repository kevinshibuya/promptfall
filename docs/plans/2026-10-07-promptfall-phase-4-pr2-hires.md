# Promptfall phase 4 PR 2: the 1.5× stage, implementation plan

**Goal:** Ship every sprite's native cut as its 1.5× art and draw the full stage at 1.5 times the
pixel density on the Image and Svg surfaces, keeping today's art as the 1× art everywhere else.
**Architecture:** The slicer writes a 1.5× cut beside each 1× cut; the build adds a `hires`
variant snapped to a derived 128-colour master. `stageAt` takes an optional scale (1 or 1.5) and
multiplies every stage-pixel quantity by it; the Image renderer composes the full stage at 1.5 and
upscales 4×, the Raster renderer and the compact stage stay at 1, and the desktop Svg renders at
1.5 with a fall-back to 1 over the engine's cap.
**Spec:** `docs/plans/2026-10-07-phase-4-pr2-hires-grill.md` (rounds 1, 2 and 4; round 3 is PR 3),
amending `docs/plans/2026-10-07-promptfall-phase-4-pr2-art.md`.
**Execution model:** opus

## Global constraints

- Branch `phase-4-pr2-art`, one PR into `ai-staging`, as the art plan.
- The art plan's full check line before each task's final commit. The plugin suite can time out at
  5 s under load: rerun it; timeouts alone are not a failure, an assertion is.
- No `any`.
- The band's size in cells does not change: 8, 12 and 17 rows, 120 columns, `FULL_MIN_COLUMNS`
  116, the 52 × 4 compact stage. Only the full stage's picture gains pixels.
- The detail scale is 1.5 (`HIRES_SCALE` in `stage/tuning.ts`). 1.5× canvases: `nes` sprites
  24 × 24 (padded, bottom-centred), `snes` sprites at most 72 × 51, turn bosses fit to 36 rows. The
  1.5× fit only ever shrinks. Every 1.5× sprite may hold 16 colours, snapped to the 1.5× master
  `art/palettes/hires.json` (128 colours). The 1× limits and masters are unchanged.
- Tuning constants in `stage/tuning.ts` stay in 1× stage pixels; code multiplies by the scale and
  rounds (`Math.round`): sprite slot 24, pitch 27, edge 6, lunge 6, bob 2, number rise 9, drop rise
  15, the ground 3 pixel rows, the number's offset above an actor 3. A frame's size is
  `ceil(columns · scale)` × `ceil(rows · 2 · scale)`. The damage numbers draw their 3 × 5 glyphs as
  2 × 2 blocks at 1.5 (glyph 6 × 10, advance 8) and as today at 1.
- 1× art draws on Raster terminals, the compact stage on every renderer, the list windows, and the
  Svg fall-back. 1.5× art draws on the full stage on Image terminals and on the desktop Svg.
- The Svg cap is the engine's: `SVG_MAX_CHARS` 131,072.
- The art plan's Task 11 is done (0 placeholders; the SNES master locked). Its Task 12 runs after
  this plan, with the additions in Task H7.

## Tasks

### Task H1: `pnpm slice --hires <dir>` writes the 1.5× cut

**Files:**
- `scripts/slice-sheet.ts` — modify: a `hires` result and the `--hires <dir>` flag
- `scripts/slice-sheet.test.ts` — modify

**Interfaces:**
- Produces: `SliceResult` success gains `hires: Rgba`: the native grid shrunk (never grown) to
  1.5 times the target (`--size 16`: 24 × 24, padded bottom-centred; `--fit 48x34`: the 72 × 51
  box, unpadded), quantised to 16 colours (black plus `medianCut` of 15, mapped with `nearest`, as
  the 1× quantise). `--hires <dir>` writes it to `<dir>/<name>.png`, sub-directories as
  `--native`. The CLI line gains `hires <w>x<h>`.

**Work:** Reuse the existing shrink and quantise; the 1× cut is unchanged. The 1.5× colour count is
the constant 16, not `--colours`. Internal structure is your choice.

**Acceptance check:** `pnpm vitest run scripts/slice-sheet.test.ts`: a 20 × 20 blob at block 10
with `size 16` gives a 24 × 24 `hires` holding the blob shrunk to 24 on its long side; a 12 × 10
blob gives a 24 × 24 `hires` with the blob bottom-centred and unshrunk; with `fit 48x34` a 60 × 40
blob gives a `hires` at most 72 × 51 and unpadded; a 30-colour blob gives at most 16 colours. Red
before: `hires` does not exist. Full check line.

**Boundaries:** No change to the 1× cut or the key.

- [x] tests, red; implement; full check line; commit (the shrink check uses a 30 × 30 native:
  a 20 × 20 one cannot shrink to 24, the fit never grows)

### Task H2: the build's `hires` variant and the 1.5× master

**Files:**
- `scripts/sprites.ts` — modify
- `scripts/sprites.test.ts` — modify
- `plugins/promptfall/hooks/sprites/types.ts` — modify: `Sprite` gains `hires: SpriteArt` and
  `raritySlotHires: number | null`
- `plugins/promptfall/hooks/sprites/generated.ts` — regenerated

**Interfaces:**
- `ManifestEntry` gains `fileHires?: string` (a PNG under `art/`) and `rarityColorHires?: string`.
- `Manifest.palettes` gains an optional `hires?: string`. `BuildInput.palettes` gains
  `hires: readonly number[]` (empty when the manifest names none).
- `Variants` gains `hires: Indexed`; the emitted `Variants` type and each `SPRITES` entry gain
  `hires` and `raritySlotHires`.
- `hiresMasterPaths(manifest: Manifest): string[]` (the distinct `fileHires` paths, in manifest
  order) and `pnpm sprites --derive-hires-master`, writing `art/palettes/hires.json` with 128
  colours by `medianCut` over every opaque pixel of those files, and adding `"hires":
  "palettes/hires.json"` to the manifest's palettes if missing.

**Work:** For an entry with `fileHires`: snap to the hires master, at most 16 colours, fit the 1.5×
canvas, shrinking only (a turn boss's `fit.height` times 1.5, so 36), pad `nes` to 24 × 24; any
breach is a build error naming the sprite, as today. A hero or hero attack with `fileHires` needs
`rarityColorHires` found in that PNG; its slot is `hires.palette.indexOf(nearest(colour, master))`
after the snap, and the pixels whose index is that slot must form one 8-connected region (else
`<id>: rarityColorHires is not one region`). An entry without `fileHires` (`fallback`, or every
entry until Task H3 lands art) gets `hires` as its `full` upscaled to 1.5 times its size by
nearest neighbour, with `raritySlotHires = raritySlot`.

**Acceptance check:** `pnpm vitest run scripts/sprites.test.ts`: an entry with a 24 × 24
`fileHires` builds a 24 × 24 `hires`; a 17-colour `fileHires` fails; a `fileHires` larger than the
canvas shrinks to fit; a turn boss's 30-row `fileHires` stays 30 rows (no growth); a hero whose
rarity slot lands in two separate regions after the snap fails, also when two different source
colours snap to the same master entry; an entry without `fileHires` gets `full` at 1.5 times its
size; `hiresMasterPaths` skips entries without `fileHires`; the emitted module is byte-identical
across two runs. Red before: none of it exists. `pnpm sprites` still reports 125 sprites and 0
placeholders with the current manifest (no `palettes.hires`). Full check line.

**Boundaries:** No change to the 1× variants, limits or masters, nor to plugin code beyond the
`Sprite` type and the generated module.

- [x] tests, red; implement; build; full check line; commit

### Task H3: land the 1.5× art

**Files:**
- `art/sprites-hires/<kind>/<name>.png` — create, one per `file` entry other than `fallback` (124)
- `art/manifest.json` — modify: `fileHires` on those 124 entries, `rarityColorHires` on the 8 hero
  poses, `palettes.hires`
- `art/palettes/hires.json` — create by the derive
- `art/sheets.md` — modify: the canonical cut script gains `--hires art/sprites-hires`, the
  write-back of hand-drawn 1× sprites, and the clean-up of `art/sprites-hires/x`
- `plugins/promptfall/hooks/sprites/generated.ts` — regenerated

**Work:** Run the canonical cut script from `art/sheets.md` with `--hires art/sprites-hires` added
to every call (the heroes' row writes 1× to a scratch dir as today and 1.5× to
`art/sprites-hires/`). After it, write the hand-drawn 1× sprites back:
`pnpm grid --png art/sheets/grids/<kind>-<name>.txt art/sprites/<kind>/<name>.png` for
`enemy:hollow_knight`, `enemy:throne_guard`, `enemy:court_mage`, `enemy:ink_horror` (the hero 1×
art is never written by the script), and remove `art/sprites/x` and `art/sprites-hires/x`. For each
hero pose, read its 1.5× PNG and set `rarityColorHires` to the rarity area's colour (knight cape,
black mage robe, white mage chest sigil, archer cape). Then `pnpm sprites --derive-hires-master`,
then `pnpm sprites`. A pose that fails the one-region rule gets a hand fix in its 1.5× PNG through
`pnpm grid` (for example the knight's plume shares the cape's red: repaint the plume in a red that
snaps to a different master entry, and check the snap); record each fix in `art/sheets.md`.

**Acceptance check:** `git diff --exit-code art/sprites` (the 1× art unchanged by the re-cut);
`pnpm sprites` builds with 0 placeholders; a test in `scripts/sprites.test.ts` reads the real
manifest and asserts every `file` entry other than `fallback` has a `fileHires`. Report the size of
`generated.ts` in the commit. Full check line.

**Boundaries:** No 1× art changes. No stage code.

- [ ] re-cut with `--hires`; write-backs; manifest; derive; build; hand fixes; full check line;
  commit

### Task H4: the stage at scale 1.5 on Image terminals

**Files:**
- `plugins/promptfall/hooks/stage/tuning.ts` — modify: `HIRES_SCALE = 1.5`
- `plugins/promptfall/hooks/stage/model.ts` — modify: `stageAt` opts gain `scale?: 1 | 1.5`
  (default 1); `StageModel` gains `scale`; `StageActor` gains `raritySlot: number | null` (the slot
  of the art it carries)
- `plugins/promptfall/hooks/stage/compose.ts` — modify: the frame, the ground and the numbers at
  the model's scale
- `plugins/promptfall/hooks/stage/font.ts` — modify: `drawText(frame, text, x, y, rgb, block = 1)`
  and `textWidth(text, block = 1)`
- `plugins/promptfall/hooks/stage/loop.ts` — modify: `stageFrame` builds the full stage at
  `HIRES_SCALE` for Image and at 1 for Raster and for the compact stage, and encodes at
  `IMAGE_SCALE / model.scale`
- `plugins/promptfall/hooks/stage/scenarios.ts` — modify: `Staged` gains `hires: StageModel` beside
  `model` (scale 1); `Golden` gains `imageHashHires`; the image budget is checked on the hires model
- `plugins/promptfall/hooks/stage/golden.test.ts`, `goldens/*`, `scripts/stage-goldens.ts` —
  modify and regenerate
- `plugins/promptfall/hooks/stage/model.test.ts`, `compose.test.ts`, `loop.test.ts` — modify

**Interfaces:**
- `stageAt(view, timeline, now, box, { compact, motion, scale? })`. At scale 1.5, sizes and
  distances per the Global constraints; a full-stage actor and drop use `sprite.hires` and
  `raritySlotHires`. The compact stage ignores the scale and builds at 1.
- `withinBudgets` encodes the hires model's frame at `IMAGE_SCALE / HIRES_SCALE` (4).

**Work:** At scale 1 every output is byte-identical to today: `imageHash`, `rasterHash` and
`svgHash` of every scenario stay as committed (the Svg stays on the scale-1 model until H5).
`imageHashHires` is new. Internal structure is your choice.

**Acceptance check:** `claude plugin test plugins/promptfall` with new tests: at scale 1.5 the
rest scenario's frame is 180 × 24 and the boss scenario's 180 × 51; an actor lunging moves 6
pixels; a number's glyph pixels are 2 × 2 blocks; the compact stage's Image source is 312 × 48
(52 × 8 at 6×) and the full stage's 720 × 96 (180 × 24 at 4×); `imageBytes` of the hires worst
case stays under `IMAGE_MAX_BYTES`; the committed scale-1 hashes are unchanged. Regenerate the
goldens (only `imageHashHires` is new) and say so in the commit. Full check line.

**Boundaries:** No Svg changes (Task H5). The two band call sites of `stageAt` keep compiling
unchanged (the scale is optional).

- [ ] tests, red; implement; goldens; full check line; commit

### Task H5: the desktop Svg at 1.5, with the fall-back

**Files:**
- `plugins/promptfall/hooks/stage/svg.ts` — modify: viewBox, motion distances, the number font
  and the drop at the model's scale; art and rarity slot from the model's actors; the SMIL drop
  path takes `sprite.hires` at scale 1.5; `svgWithFallback` and `stageSvg` added
- `plugins/promptfall/hooks/ui/band.tsx` — modify: the desktop stage calls `stageSvg`
- `plugins/promptfall/hooks/stage/svg.test.ts`, `golden.test.ts`, `scenarios.ts`, `goldens/*`,
  `scripts/stage-goldens.ts` — modify and regenerate

**Interfaces:**
- `svgWithFallback(hi: StageModel, lo: StageModel, motions: readonly Motion[], opts: { smil, now,
  width, motion }): string`: `renderSvg(hi, …)` when its length is under `SVG_MAX_CHARS`, else
  `renderSvg(lo, …)`.
- `stageSvg(view, timeline, now, box, opts: { smil, width, motion }): string`: builds the scale-1.5
  and scale-1 models and calls `svgWithFallback`.

**Work:** The rendered size (`width`, proportional height) is unchanged; only the viewBox grows.
The scenarios' `svgHash` moves to `svgWithFallback(hires, model, …)`.

**Acceptance check:** tests: the rest scenario's Svg has viewBox `0 0 180 24` and the same `width`
as before; the adversarial legal-art case at 1.5 (a 72 × 51 checker boss, three 24 × 24 checker
heroes with distinct palettes and a checker drop, built as hires and lo `StageModel`s on a 160 × 17
box) makes `svgWithFallback` return the lo Svg, under `SVG_MAX_CHARS`; every scenario's result is
under the cap. Regenerate the goldens. Full check line.

**Boundaries:** No change to the Image or Raster paths.

- [ ] tests, red; implement; band call site; goldens; full check line; commit

### Task H6: contact and review on the 1.5× art

**Files:**
- `scripts/contact.ts`, `scripts/contact.test.ts` — modify: each sprite also as
  `<kind>-<name>-hires.png` (its `hires` at 4×); heroes' rarity variants also from `hires` and
  `raritySlotHires`; stage views at scale 1.5 (4×) as `stage-*.png` and at scale 1 (6×) as
  `stage-*-1x.png`

**Work:** Then regenerate every contact folder and republish the review artifact
(https://claude.ai/artifact/W5SVGYNdDG8ojecpbx9RNt) leading with the 1.5× art, the 1× beside it;
the "How to answer" box says Kevin's GREEN is on the 1.5× art.

**Acceptance check:** `pnpm vitest run scripts/contact.test.ts`: zone 1 writes
`enemy-road_slime-hires.png` (96 × 96), `stage-boss.png` (720 × 204) and `stage-boss-1x.png`, and
the two differ byte for byte. The artifact is republished. Full check line.

**Boundaries:** No plugin code.

- [ ] tests, red; implement; contact folders; publish; full check line; commit

### Task H7: documentation, and the art plan's Task 12

**Files:**
- `plugins/promptfall/README.md` — modify: the Sprites section: 1× and 1.5× art,
  `art/sprites-hires/`, `fileHires`, `rarityColorHires`, `art/palettes/hires.json`,
  `--derive-hires-master`, `pnpm slice --hires`; the stage's scale (Image and Svg at 1.5, Raster
  and compact at 1, the Svg fall-back)
- `docs/manual-pass/phase-4.md` — modify Part B: Ghostty and the desktop show the 1.5× art, sharper
  than iTerm2's half-blocks of the same sprite; iTerm2 shows the 1× art; the compact stage is 1×;
  damage numbers a third larger than before on Ghostty and the desktop
- `docs/adr/0006-two-art-densities.md` — create: why two committed drawings per sprite and a scale
  on the stage instead of a larger canvas (the band's cells stay fixed; half-block terminals show
  one pixel per column), and why 1.5 rather than 2 (the natives' size)
- `docs/plans/2026-10-07-promptfall-phase-4-pr2-art.md` — modify: Task 12's goldens and check line
  include the hires scenarios; tick Task 11's remaining box once Kevin's GREENs are recorded

**Acceptance check:** every flag and file the docs name exists (`grep` each). Full check line.

**Boundaries:** No code.

- [ ] docs; ADR; plan notes; full check line; commit

## Self-review

- Grill coverage: Q1 (Global constraints, H4), Q2 (H3: every id), Q3 (H3), Q4 and Q24 (H1, H2
  canvases at 1.5, shrink only), Q5 (16 colours: H1, H2), Q6 (1× unchanged, H3's diff check), Q7
  (H2 one-region rule after the snap, H3), Q8 (H2 and H3 master), Q9 and Q25 (H4 font), Q10 (H4
  distances), Q11 (H4 Image at 4×), Q12 (H5), Q13 (H4 compact at 1), Q14 (lists untouched), Q15
  (`CONTEXT.md`, done), Q16 (H6, H7).
- Plan review (reviewer on Opus, 2026-10-07): the 2× size problem (now 1.5, Kevin's Q24); turn
  bosses grown by `downsample` (shrink only); an untestable `stageSvg` (now `svgWithFallback`);
  the required hires palette breaking H2 (optional); a required `scale` breaking call sites
  (optional, default 1); one `Staged` model for two scales (`hires` beside `model`, scale-1 hashes
  kept); the compact Image at the wrong upscale (`IMAGE_SCALE / model.scale`); the one-region rule
  on source pixels (now on the snapped slot, 8-connected); the re-cut overwriting hand-drawn 1× art
  (write-back, `git diff --exit-code`); a contact check that passed without the feature
  (`stage-*-1x.png` must differ); the drop path and rarity lookups bypassing the model; the ADR
  number (0006); the PNG count (124).
- Risk: `generated.ts` grows by the 1.5× art; H3 reports the size.
