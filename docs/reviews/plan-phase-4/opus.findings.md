# Phase 4 plan review: opus leg

`reviewer` on Opus 5.5 at high, 2026-10-04, fresh context, read-only. Findings H1 to H7, M1 to
M12, L1 to L10 (the leg's own numbering; the lows are numbered here in its order).

Verdict: not ready for task 1. Seven blockers that would fail an acceptance check or put a visible
defect into the design, twelve medium findings and eight low ones. The API claims hold against the
d.ts. The trouble is in the geometry, the order of the timeline's inputs, the probe, and how files
are loaded.

## Blockers (high)

**H1. Actor geometry contradicts FULL_MIN_COLUMNS and the scene test.** `:115` (ACTOR_PITCH = 24,
ACTOR_EDGE = 4) and `:294` (scene test at 120 columns). One side spans 4 + 2×24 + 16 = 68 px, so
both sides need 136 columns. At 120 enemy 2 is at x = 52..68 and hero 2 at x = 120−4−16−48 = 52:
overlap. A 48 px boss at x = 4 ends at 52, also on hero 2. Fix: derive the pitch from 116, e.g.
ACTOR_PITCH = 18 gives 2×(4+36+16) = 112. Add a scene test asserting no overlap at FULL_MIN_COLUMNS.

**H2. In compact layout the loop never blits and invalidates on every tick.** `:197`: a compact box
always has rows = 4, but rowsAt returns 8, 12 or 17. Every compact tick invalidates and skips. Fix:
one shared `layoutFor(view, timeline, now, props)` returning {full|compact|collapsed, box}, used by
both the hook and the loop; the loop compares layouts, not raw rows.

**H3. The timeline is observed only in the loop, so a boss death flickers the band height.** `:197`,
`:345`, `:153`. When a zone boss dies, the view publish re-renders the band before the loop's next
tick observes the departure; rowsAt returns 8, the band goes 19 → 10, the tick then invalidates
back to 19, and the band shrinks again after the dissolve. Fix: the render hook calls
`timeline.observe(view, now)` on every surface before rowsAt and before composing.

**H4. The probe reads any deny as "raster".** `:199`; d.ts:2288-2291 and 12976-12984 list "not
mounted" and "another size" denies. The probe Image sits in the status row, which a collapsed band
does not draw (secondaries, bodyColumns < 100, maxRows < 4, a survey, mode off, a user collapse
within 300 ms). Fix: write 'raster' only when the deny names the alt; otherwise stay 'unknown' and
re-arm on the next render that draws the probe; arm only from a render that drew it.

**H5. The golden test cannot import JSON.** `:315`, `:321`; plugin-authoring reference.md:14: a
plugin file is loaded only if named .ts/.tsx/.js/…. Fix: stage-goldens.ts writes `goldens/index.ts`
(`export const GOLDENS = {…}`); the .svg files stay as unimported eyeball files.

**H6. Damage numbers have no room on the stage.** `:301`, `:294`: the stage is exactly as tall as
its sprites, so every number starts at a negative y; composeFrame clips it and encodeRaster's
`floor(y/2)` gives a negative row. Fix: anchor numbers inside the box and clamp in both encoders;
test a number on a 16 px actor at rest.

**H7. A drop cannot be attributed by "the last enemy that departed in this step".** `:149`;
engine.ts:227-228 calls onEffects synchronously after an un-awaited publish. Fix: attribute the drop
to the target of the nearest preceding `hit` in the same effects array (combat.ts:46-54: hitEnemy
pushes hit, then onEnemyKilled pushes drop); start it at that hit's flash end.

## Medium

**M1. The atoms would be declared where the validator's scan cannot see them.** `:46`, `:342-343`;
state.ts:11-14. Also `PluginState.promptfall` lacks `settings` and `renderer`
(types/index.d.ts:208-226). Fix: state.ts exports SETTINGS_DEFAULT only; each module declares its
own atoms; extend PluginState.

**M2. Inventory icons have no sprite key.** `:394-396`. ItemView has no `base`
(types/index.d.ts:24-37; view.ts:116-134). Fix: add `ItemView.base` in Task 8.

**M3. The slice tool's CLI has no target size and no row selection.** `:265`, `:268`;
slice.py:57-60 scales each cell to `grid` or fits 48×34. Fix: add `--size N | --fit WxH` and
`--row R`.

**M4. Generated files will fail `pnpm lint`.** biome.json lints everything except vendor, types and
docs. Fix: exclude `hooks/sprites/generated.ts` and `hooks/stage/goldens` in biome.json.

**M5. Raster numbers are drawn twice.** `:160` and `:164`: the 3×5 pixel glyph spans 3 columns × 3
rows and the text covers only its own cells. Fix: `composeFrame(scene, { numbers })`, false for
raster.

**M6. The loop never stops on a deny.** `:197`. An engine-side collapse, an unmount or a session end
leaves the loop blitting 12 times a second into "not mounted". Fix: on a not-mounted or size deny,
cancel the timer until the next `mount()`.

**M7. Terminal and desktop renders can fight over one StageLoop.** `:191`, `:345`;
register.tsx:602-603 lets a desktop attach to a process whose `game` exists. Fix: the Svg path never
calls `loop.mount`, or the loop keys sites by surface.

**M8. The band can't reach the session's timeline and loop.** `:345`, `:355`. `registerBand(on)`
(band.tsx:112) gets no game handle. Fix: `registerBand(on, game: () => GameHandle | null)` and say
who writes rendererAtom after the probe.

**M9. Stubbing `ui.invalidate` in the band tests stops the redraws they assert.** `:381`, `:347`.
Fix: record invalidate and call `next(e)`; count blits through the `on('ui.blit')` stub.

**M10. Svg colour handling is undefined.** `:174`, `:320`, `:441`. "One `<g id>` per art stem" has
no way to carry the per-actor rarity slot, the fallen-hero dim or the flash. renderSvg takes no
`motion` option, so `still` cannot drop the Svg bob. Fix: rarity-slot runs use
`fill="currentColor"` with `color` set per `<use>`; one white-silhouette `<filter>`; dim through
opacity; add `motion` to renderSvg's options.

**M11. The party line's enemy segment won't fit at 116-130 columns.** `:346`. Each hero takes about
35 columns, three plus separators about 111; `⚔ Goblin Brute 42/60` adds about 20. In compact
mode there is no party line, so the front enemy's name and HP need a home. Spec §10 keeps a global
HP bar in boss mode. Fix: a shorter HpBar in the party line, a fixed enemy segment width, an
explicit rule for compact, and the boss bar.

**M12. The spike's Image test doesn't match the stage, and the IMAGE_SCALE rule is garbled.**
`:224`. "The smallest integer…" is always 1; the crispness test downscales where the stage
upscales; scale 7 and 8 exceed IMAGE_MAX_BYTES; no blit throughput check. Fix: spike (b) draws a
120×16 checker in a 120×8 box at scales 1/4/6 and blits at 12 fps; the rule becomes "the smallest
crisp scale whose 160×34 bytes fit".

## Low

- **L1.** `:199`: the probe blits the same source it mounted. d.ts:5154-5155 says "A source equal
  to the last drawn sends nothing", which may answer `{}` without checking the alt. Probe with a
  second, distinct 1×1 pixel.
- **L2.** `:184`: LoopIo.blit's `{cells?, source?}` does not type-check against `UiBlitArgs`
  (d.ts:12969). Type it as `(args: UiBlitArgs) => Promise<UiBlitResult>`.
- **L3.** `:371`: Task 7 changes world.ts but it is not in the Files list; bossTransition returns
  one string for both appeared and down.
- **L4.** `:372`: the settings commands don't claim the lease, so `/promptfall sound on` in a
  secondary only updates that session's atom while the primary plays.
- **L5.** `:345`: "the collapsed rule extended with maxRows < STAGE_TEXT_ROWS + rowsAt" says
  collapse, but `:13` makes that case compact. Rewrite as the three-way rule.
- **L6.** `:107`: downsampling uses a single factor f; 16×16 → 8×4 needs fx ≠ fy, and 34 → 24 a
  non-integer f.
- **L7.** `:294`: the wave fixture has three enemies but the alt lists two zone 1 enemies while the
  fixture is zone 3.
- **L8.** Naming: `KvStore` is `StoreKeyValue` (storage.ts:17); register.tsx:367-368 is `reset()`;
  `zoneRosters` and `itemBases` are not exports of `@promptfall/sim` (index.ts exports `content`),
  and `HeroClass` is a type with no runtime list; `Cue` is never defined; the manifest example uses
  the magenta key as a rarity colour and `file:` where every PR 1 entry is an alias;
  combat.test.ts already exists.
- **L9.** `:85`: atob and btoa exist in the plugin runtime (d.ts:14107-14108). Hand-rolled base64
  is a choice, not a need.
- **L10.** CONTEXT.md:137 and :142 list "scene" and "icon" under Avoid; the plan names
  `Scene`/`sceneAt` and `icon`/`ItemIcon`.

## Verified correct

- Every API claim matches d.ts 2.1.289: Raster (8746-8772), ImageSource (5127-5190), Svg
  (11720-11750), blit (2283-2298, 12975-12984), audio.play (709-716, 2560-2575, 7280+), the event
  map (6552, 6696, 6726), `$.ui.invalidate('ui.render')` (5376, 9177), `clock.after` returns a
  cancelable Timer (3352, 12054). The test kit answers `$` calls through `on(...)` hooks
  (band.test.ts:15-31) and `mock.clock.advance` resolves due timers (14729-14770).
- `hit` is output only; four heroAct call sites; GOLDEN_HASH covers state only; replay returns
  effects (step.ts:79-88); the ledger reads only `rejected` (books.ts:122); toasts.ts has a
  `default` arm.
- Band heights consistent across spec §2/§10, ADR 0003 and the plan. Compact at 100 columns is
  52 + 48. The Raster pair budget is easily met.
- Line references check out: band.tsx:182-200, world.ts:165, dialog.tsx:347-362 and :478-488,
  market.tsx:190-200, view.ts:53, enemies.ts:50.
- Coverage: every record decision §1.1-§1.13 and every §3 spike has a task, a hand-over or a
  numbered narrowing. One gap: the spec's world-boss global HP bar (M11).
