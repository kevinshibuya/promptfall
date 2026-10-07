# Promptfall phase 4 PR 2: the 2× stage, implementation plan

**Goal:** Ship every sprite's native cut as its 2× art and draw the stage at twice the pixel
density on the Image and Svg surfaces, with today's art kept as the 1× art everywhere else.
**Architecture:** The slicer writes a 2× cut beside each 1× cut; the build adds a `hires` variant
snapped to a derived 128-colour master. `stageAt` takes a scale (1 or 2) and multiplies every
stage-pixel quantity by it; the Image renderer composes at 2 and upscales 3×, the Raster renderer
stays at 1, and the Svg renders at 2 with a fall-back to 1 over the engine's cap.
**Spec:** `docs/plans/2026-10-07-phase-4-pr2-hires-grill.md` (rounds 1 and 2; round 3 is PR 3),
amending `docs/plans/2026-10-07-promptfall-phase-4-pr2-art.md`.
**Execution model:** opus

## Global constraints

- Branch `phase-4-pr2-art`, one PR into `ai-staging`, as the art plan.
- The full check line of the art plan, before each task's final commit. The plugin suite can time
  out at 5 s under load: rerun it; timeouts alone are not a failure, an assertion is.
- No `any`.
- The band's size in cells does not change: 8, 12 and 17 rows, 120 columns, `FULL_MIN_COLUMNS`
  116, the 52 × 4 compact stage. Only the stage picture gains pixels.
- 2× canvases: `nes` sprites 32 × 32 (padded, bottom-centred), `snes` sprites at most 96 × 68;
  turn bosses fit to 48 rows. Every 2× sprite may hold 16 colours, snapped to the 2× master
  `art/palettes/hires.json` (128 colours). The 1× limits and masters are unchanged.
- Tuning constants in `stage/tuning.ts` stay in 1× stage pixels; code multiplies them by the scale.
- 1× art draws on: Raster terminals, the compact stage on every renderer, the list windows, and
  the Svg fall-back. 2× art draws on: the full stage on Image terminals and on the desktop Svg.
- The Svg cap is the engine's: `SVG_MAX_CHARS` 131,072.
- After this plan, the art plan's Task 11 (zone 12's bosses, the placeholder test, the GREENs) and
  Task 12 (finish) run as written, with the 2× additions listed in Task H7.

## Tasks

### Task H1: `pnpm slice --hires <dir>` writes the 2× cut

**Files:**
- `scripts/slice-sheet.ts` — modify: a `hires` result and the `--hires <dir>` flag
- `scripts/slice-sheet.test.ts` — modify

**Interfaces:**
- Produces: `SliceResult` success gains `hires: Rgba`: the native grid shrunk (never grown) to
  twice the target (`2·size` square, padded bottom-centred, or the `fit` box doubled), quantised to
  16 colours (black plus `medianCut` of 15, as the 1× quantise). `--hires <dir>` writes it to
  `<dir>/<name>.png` (sub-directories as `--native`). The CLI line gains `hires <w>x<h>`.

**Work:** Reuse the existing shrink and quantise; the 1× cut is unchanged. The colour count for the
2× cut is the constant 16, not `--colours`.

**Acceptance check:** `pnpm vitest run scripts/slice-sheet.test.ts`: a 20 × 20 blob at block 10
with `size 16` gives a 32 × 32 `hires` that is the blob padded bottom-centred, unshrunk; a 40 × 40
blob gives a 32 × 32 `hires`; a 30-colour blob gives at most 16 colours in `hires`. Red before:
`hires` does not exist. Full check line.

**Boundaries:** No change to the 1× cut or the key.

- [ ] tests, red; implement; full check line; commit

### Task H2: the build's `hires` variant and the 2× master

**Files:**
- `scripts/sprites.ts` — modify
- `scripts/sprites.test.ts` — modify
- `plugins/promptfall/hooks/sprites/types.ts` — modify: `Sprite` gains `hires: SpriteArt` and
  `raritySlot2x: number | null`
- `plugins/promptfall/hooks/sprites/generated.ts` — regenerated
- `art/manifest.json`, `art/palettes/hires.json` — not yet (Task H3)

**Interfaces:**
- `ManifestEntry` gains `file2x?: string` (a PNG under `art/`) and `rarityColor2x?: string`.
- `Manifest.palettes` gains `hires: string`. `BuildInput.palettes` gains `hires: readonly number[]`.
- `Variants` gains `hires: Indexed`; the emitted `Variants` type and each `SPRITES` entry gain
  `hires` and `raritySlot2x`.
- `hiresMasterPaths(manifest): string[]` (the distinct `file2x` paths) and
  `pnpm sprites --derive-hires-master`, writing `art/palettes/hires.json` with 128 colours by
  `medianCut` over every opaque pixel of those files.

**Work:** For an entry with `file2x`: snap to the hires master, at most 16 colours, fit the 2×
canvas (`fit.height` doubled for turn bosses), pad `nes` to 32 × 32; any breach is a build error
naming the sprite, as today. A hero or hero attack with `file2x` needs `rarityColor2x`, found in
that PNG, whose pixels form one 4-connected region (else the error
`<id>: rarityColor2x is not one region`). An entry without `file2x` (an alias, `fallback`) gets
`hires` as its `full` upscaled 2× nearest-neighbour, with `raritySlot2x = raritySlot`. Until Task
H3 lands art, every sprite takes that path and the stage is unchanged.

**Acceptance check:** `pnpm vitest run scripts/sprites.test.ts`: an entry with a 32 × 32 `file2x`
builds a 32 × 32 `hires`; a 17-colour `file2x` fails; a hero whose `rarityColor2x` appears in two
separate regions fails; an entry without `file2x` gets `full` doubled; `hiresMasterPaths` skips
entries without `file2x`; the emitted module is byte-identical across two runs. Red before: none of
it exists. `pnpm sprites` then reports the same 125 sprites. Full check line.

**Boundaries:** No change to the 1× variants, limits or masters, nor to plugin code beyond the
`Sprite` type.

- [ ] tests, red; implement; build; full check line; commit

### Task H3: land the 2× art

**Files:**
- `art/sprites-2x/<kind>/<name>.png` — create, one per shipped sprite (123, then 125 with zone
  12's bosses)
- `art/manifest.json` — modify: `file2x` on every entry with a `file` except `fallback`;
  `rarityColor2x` on the 8 hero poses; `palettes.hires`
- `art/palettes/hires.json` — create by the derive
- `art/sheets.md` — modify: the canonical cut script gains `--hires art/sprites-2x`
- `art/sheets/grids/` — hand-fix grids, gitignored, as the 1× ones
- `plugins/promptfall/hooks/sprites/generated.ts` — regenerated

**Work:** Re-run the canonical cut script with `--hires art/sprites-2x` on every call. The heroes'
row writes their 2× art (their 1× art stays hand-drawn: cut that row to a scratch out-dir for 1×,
as the script does today). For each hero pose, read the 2× PNG's colours and set
`rarityColor2x` to the rarity area's colour (knight cape, black mage robe, white mage sigil, archer
cape). Then `pnpm sprites --derive-hires-master`, then `pnpm sprites`. A pose that fails the
one-region rule gets a hand fix through `pnpm grid` (for example the knight's plume, which shares
the cape's red: recolour the plume to the nearest other red). Record the fixes in `art/sheets.md`.

**Acceptance check:** `pnpm sprites` builds with 2 placeholders and every non-placeholder sprite
has a `hires` from its own `file2x` (a test in `scripts/sprites.test.ts` reads the real manifest
and asserts every `file` entry other than `fallback` has a `file2x`). Report the size of
`generated.ts` in the commit. Full check line.

**Boundaries:** No 1× art changes. No stage code.

- [ ] re-cut with `--hires`; manifest; derive; build; hand fixes; full check line; commit

### Task H4: the stage at scale 2 on Image terminals

**Files:**
- `plugins/promptfall/hooks/stage/model.ts` — modify: `stageAt` opts gain `scale: 1 | 2`; the
  model carries it
- `plugins/promptfall/hooks/stage/compose.ts` — modify: the frame and the ground strip at the
  model's scale; numbers drawn at the scale
- `plugins/promptfall/hooks/stage/font.ts` — modify: `drawText` takes a pixel scale
- `plugins/promptfall/hooks/stage/loop.ts` — modify: Image composes at 2 and encodes at
  `IMAGE_SCALE / 2`; Raster stays at 1
- `plugins/promptfall/hooks/stage/scenarios.ts`, `golden.test.ts`, `goldens/*` — modify and
  regenerate: each scenario's image hash and budgets at scale 2, its raster hash at scale 1
- `plugins/promptfall/hooks/stage/model.test.ts`, `compose.test.ts` — modify

**Interfaces:**
- `stageAt(view, timeline, now, box, { compact, motion, scale })`; `StageModel` gains `scale`.
  Width is `columns · scale`, height `rows · 2 · scale`; `SPRITE_PX`, `ACTOR_PITCH`, `ACTOR_EDGE`,
  `COMPACT_PITCH`, `LUNGE_PX`, `IDLE_BOB_PX`, `NUMBER_RISE_PX`, `DROP_RISE_PX`, the ground's
  2 rows and the glyph metrics are multiplied by `scale`. At scale 2 a full-stage actor and drop
  use `sprite.hires` and the rarity slot `raritySlot2x`; the compact stage always uses scale 1.
- `drawText(frame, text, x, y, rgb, scale = 1)`.

**Work:** At scale 1 every output is byte-identical to today (the raster goldens and every scale-1
test stay green unchanged). Internal structure is your choice.

**Acceptance check:** `claude plugin test plugins/promptfall` with new tests: at scale 2 the rest
scenario's frame is 240 × 32, an actor's x is twice its scale-1 x when its 2× art is twice as wide,
a lunge moves 8 pixels, a number is drawn with 2 × 2 blocks; at scale 1 the frame is byte-identical
to the pre-change golden. `imageBytes` of the scale-2 worst case at `IMAGE_SCALE / 2` stays under
`IMAGE_MAX_BYTES`. Regenerate the goldens and say so in the commit. Full check line.

**Boundaries:** No Svg changes (Task H5). No band layout changes.

- [ ] tests, red; implement; goldens; full check line; commit

### Task H5: the desktop Svg at scale 2, with the fall-back

**Files:**
- `plugins/promptfall/hooks/stage/svg.ts` — modify: viewBox, motion distances and the number font
  at the model's scale; art from the model (2× when the model is 2×); `stageSvg` added
- `plugins/promptfall/hooks/ui/band.tsx` — modify: the desktop stage calls `stageSvg`
- `plugins/promptfall/hooks/stage/svg.test.ts`, `golden.test.ts`, `scenarios.ts`, `goldens/*` —
  modify and regenerate

**Interfaces:**
- `stageSvg(view, timeline, now, box, opts: { smil, width, motion }): string`: renders the scale-2
  model; when the result's length is `SVG_MAX_CHARS` or more, renders the scale-1 model instead.

**Work:** The rarity `currentColor` uses `raritySlot2x` for 2× art. The rendered size (`width`,
proportional height) is unchanged; only the viewBox doubles.

**Acceptance check:** tests: the rest scenario's Svg has viewBox `0 0 240 32` and its width as
before; the adversarial legal-art case at 2× (a 96 × 68 checker boss, three 32 × 32 checker heroes
with distinct palettes, a checker drop, at 160 × 17) makes `stageSvg` return the scale-1 Svg, under
`SVG_MAX_CHARS`; every scenario's `stageSvg` is under the cap. Regenerate the goldens. Full check
line.

**Boundaries:** No change to the Image or Raster paths.

- [ ] tests, red; implement; band call site; goldens; full check line; commit

### Task H6: contact and review on the 2× art

**Files:**
- `scripts/contact.ts`, `scripts/contact.test.ts` — modify: each sprite also as
  `<kind>-<name>@2x.png` (its `hires` at 3×), stage views at scale 2 (3×) as `stage-*.png` and at
  scale 1 as `stage-*-1x.png`

**Work:** Then regenerate every contact folder and republish the review artifact
(https://claude.ai/artifact/W5SVGYNdDG8ojecpbx9RNt) leading with the 2× art at 3×, the 1× beside
it; the "How to answer" box says Kevin's GREEN is on the 2× art.

**Acceptance check:** `pnpm vitest run scripts/contact.test.ts`: zone 1 writes `enemy-road_slime@2x.png`
(96 × 96) and `stage-boss.png` at 720 × 204 (240 × 68 at 3×). The artifact is republished. Full
check line.

**Boundaries:** No plugin code.

- [ ] tests, red; implement; contact folders; publish; full check line; commit

### Task H7: documentation, and the art plan's remaining tasks

**Files:**
- `plugins/promptfall/README.md` — modify: the Sprites section: 1× and 2× art, `art/sprites-2x/`,
  `file2x`, `rarityColor2x`, `art/palettes/hires.json` and `--derive-hires-master`, `--hires`; the
  stage's scale (Image and Svg at 2, Raster and compact at 1, the Svg fall-back)
- `docs/manual-pass/phase-4.md` — modify Part B: Ghostty and the desktop show the 2× art (sharper
  than iTerm2's half-blocks of the same sprite); iTerm2 shows the 1× art; the compact stage is 1×
- `docs/adr/0005-two-art-densities.md` — create: why two committed drawings per sprite and a scale
  on the stage rather than a larger canvas (the band's cells stay fixed; half-block terminals cannot
  show more than one pixel per column)
- `docs/plans/2026-10-07-promptfall-phase-4-pr2-art.md` — modify: Task 11 and 12 notes: zone 12's
  bosses are cut with `--hires`; Task 12's goldens and check line include the 2× scenarios

**Acceptance check:** the docs name only flags and files that exist (`grep` each). Full check line.

**Boundaries:** No code.

- [ ] docs; ADR; plan notes; full check line; commit

## Self-review

- Grill coverage: Q1 (Global constraints, H4), Q2 (H3, every id), Q3 (H3), Q4 (H1, H2 limits),
  Q5 (16 colours, H1, H2), Q6 (1× unchanged), Q7 (H2 one-region rule, H3), Q8 (H2, H3 master),
  Q9 (H4 font), Q10 (H4 distances), Q11 (H4 Image), Q12 (H5), Q13 (H4 compact at 1), Q14 (lists
  untouched), Q15 (`CONTEXT.md`, done), Q16 (H6, H7 manual pass).
- Order: H2 makes the stage unchanged until H3 lands art; H4 and H5 can then switch surfaces.
- Risk: `generated.ts` grows by the 2× art (an estimated 400 KB on 156 KB); H3 reports the size.
