# Phase 4 plan review: codex leg

gpt-6-astra at xhigh, `codex review` with a custom prompt, 2026-10-04. Log `~/.claude/codex-runs/20261004-024242-78328-review-plan-phase-4.log`, exit 0, 917 s. Findings C1 to C25 in file order; the log printed the report twice, this is one copy.

The plan needs revision before execution: its geometry, transition delivery, animation lifecycle and several shared interfaces contain actionable contradictions. Read-only type, import, geometry and encoding-budget checks were performed; implementation tests and real-surface checks were not run.

Full review comments:

- [P1] Compare against the selected compact geometry — docs/plans/2026-10-04-promptfall-phase-4.md:197-197
  In compact mode, the mounted box has 4 rows, but `rowsAt()` returns 8, 12 or 17. This comparison therefore always invalidates and skips the blit; the next render mounts another 4-row box and repeats. Compare the mounted box against the selected full/compact layout, not the uncompressed stage height. Evidence: this plan's `rowsAt` contract at line 153 and compact acceptance case at line 347; `docs/spec/promptfall.md:394-397`.

- [P1] Fit both formations inside the minimum full-stage width — docs/plans/2026-10-04-promptfall-phase-4.md:294-294
  At the specified 120-column fixture, enemy 2 and hero 2 both start at x=52 and occupy the same 16 pixels. At 116 columns they still overlap by 12 pixels. The fixed pitch requires 136 columns merely to avoid overlap, before allowing lunges. Derive spacing from available width and sprite bounds while preserving the agreed 116-column threshold. Evidence: tuning at plan lines 114-116 and `docs/adr/0003-band-grows-for-the-stage.md:35-36`.

- [P1] Deliver step snapshots together with animation effects — docs/plans/2026-10-04-promptfall-phase-4.md:149-150
  `GameEngine.apply()` queues publication but immediately delivers effects (`plugins/promptfall/hooks/engine.ts:224-228,615-617`). Thus `onEffects()` runs before `observe()` knows which enemy departed; killing a rear enemy makes its drop use the front-enemy fallback. Multiple kills also cannot all be assigned to the last departed enemy. Pass an atomic step transition with actor snapshots and preserve each drop's victim association; do not reconstruct causality from independently sampled views. Drops are produced per victim in `packages/sim/src/progression.ts:226-243`.

- [P2] Preserve the API's required blit payload union — docs/plans/2026-10-04-promptfall-phase-4.md:184-184
  The proposed `LoopIo.blit` permits neither `cells` nor `source`, so forwarding its argument directly to `$.ui.blit(args)` as prescribed at line 203 does not type-check. A read-only TypeScript check reproduced this error. Use `UiBlitArgs` directly, or an equivalent union requiring one payload. Evidence: the supplied `claude-code.d.ts:8711-8725,5090-5103,12962-12969`.

- [P2] Declare atoms in their consuming hook modules — docs/plans/2026-10-04-promptfall-phase-4.md:342-343
  Task 6 puts exported atoms in `state.ts`, and Task 7 explicitly consumes that `settingsAtom`. The current repository documents that the validator recognizes atoms only when declared in the module calling `read` or `update` (`plugins/promptfall/hooks/state.ts:11-14`). Follow the existing pattern: share defaults and types, declare atoms locally, and add both keys to the `PluginState` augmentation at `plugins/promptfall/types/index.d.ts:208-225`.

- [P2] Expose the content exports required by the sprite build — docs/plans/2026-10-04-promptfall-phase-4.md:274-274
  `zoneRosters` is not exported by `@promptfall/sim`; adding the workspace dependency does not make this import available. A read-only tsx import confirmed this. `itemBases` must likewise be read through `content.itemBases`, not as a named package export. Specify the actual imports and either export `zoneRosters` or derive the mapping from exported content. Evidence: `packages/sim/src/index.ts:1-17` and `packages/sim/src/content/enemies.ts:193-194`.

- [P2] Carry the item base into inventory views — docs/plans/2026-10-04-promptfall-phase-4.md:395-396
  Task 8 adds `ListingView.base` but leaves `ItemView` without the content key needed to select inventory sprites. Inventory `id` identifies an instance, not an `item:<base>` sprite, so the renderer cannot reliably choose the icon. Add `ItemView.base` and populate it from `item.base`, with an assertion for the selected sprite rather than merely the element type. Evidence: `plugins/promptfall/types/index.d.ts:24-37` and `plugins/promptfall/hooks/view.ts:116-133`.

- [P2] Represent the desktop fallback in the loop contract — docs/plans/2026-10-04-promptfall-phase-4.md:180-180
  Task 6 requires the loop to run on desktop when the SMIL spike fails, but `StageSite` can represent only Raster or Image, and `mount(null)` stops it. The shared interface therefore cannot express the required invalidate-only SVG loop. Add a discriminated SVG site and its cadence/render behavior, and test `SVG_SMIL=false`. Evidence: the contradictory fallback instruction at plan line 345 and `docs/plans/2026-10-04-phase-4-grill.md:147-150`.

- [P2] Wake the idle timer when effects arrive — docs/plans/2026-10-04-promptfall-phase-4.md:191-197
  An effect arriving just after an idle tick waits almost 500 ms for the next tick because `onEffects()` only forwards effects and an unchanged mount does not re-arm. The 240 ms lunge and its flash can both finish before any animation frame is blitted. Re-arm promptly on new motion without restarting the loop on every ordinary render. Evidence: plan timings at lines 116-117 and `docs/spec/promptfall.md:399-405`.

- [P2] Paint a clean frame when still-mode motion finishes — docs/plans/2026-10-04-promptfall-phase-4.md:197-197
  With `motion: 'still'`, an ordinary nonlethal hit leaves the actor set unchanged. Once its last motion expires, this rule skips the cleanup blit, leaving the last damage-number or other animated frame visible indefinitely. Track the busy-to-idle transition and emit a final settled frame before suppressing idle blits. Evidence: number lifetime at plan line 116 and the requirement that still disables only bobbing in `docs/spec/promptfall.md:399-405`.

- [P2] Invalidate in-flight ticks when the mount changes — docs/plans/2026-10-04-promptfall-phase-4.md:191-197
  Cancelling the pending timer does not stop a callback already awaiting `now`, `view`, `settings` or `blit`. If the band hides or resizes during those awaits, the old tick can still blit and re-arm after `mount(null)`, violating the zero-hidden-blit requirement. Specify a mount generation checked after awaits and before blitting/re-arming. Evidence: async `LoopIo` operations at plan lines 182-187 and timer cancellation semantics in `claude-code.d.ts:3347-3352,12054-12058`.

- [P2] Distinguish probe unmounts from unsupported images — docs/plans/2026-10-04-promptfall-phase-4.md:199-199
  If a survey, collapse or tab change removes the probe during its 300 ms delay, the blit can deny because nothing is mounted, even in Ghostty. This rule permanently selects Raster for that session. A deny is not exclusively an alt-capability result: `claude-code.d.ts:12975-12983` also lists mount, size and source failures. Tie the probe to a live mount and retry transient failures instead of classifying every deny as unsupported pixels.

- [P2] Preserve elapsed time when regenerating SMIL — docs/plans/2026-10-04-promptfall-phase-4.md:174-174
  Clamping an already-started motion's begin to zero restarts it for its full duration whenever the SVG redraws. Those redraws occur on subscribed view/world writes, not only combat rounds (`plugins/promptfall/hooks/ui/band.tsx:114,133`; `claude-code.d.ts:3868-3869`). This also makes midpoint golden scenes restart their motion. Preserve elapsed progress using negative begin offsets or equivalent remaining-duration/keyframe calculations, and change the test at plan line 320 that currently enforces the restart.

- [P2] Pass the motion preference into the SVG encoder — docs/plans/2026-10-04-promptfall-phase-4.md:320-320
  This unconditional bob assertion conflicts with `motion: 'still'`. `renderSvg` receives no motion preference, and a sampled scene with zero bob offset cannot distinguish still mode from the zero-offset phase of full mode. Add an explicit idle-animation option and test both settings while retaining event animations. Evidence: the encoder signature at plan line 173 and `docs/spec/promptfall.md:404-405`.

- [P2] Include drop trajectories in the SMIL animation contract — docs/plans/2026-10-04-promptfall-phase-4.md:174-174
  The listed SMIL animations omit drop motion. A drop sampled into `Scene.drops` therefore stays at its initial position/opacity until another redraw, rather than rising and fading on the once-per-round desktop path. Specify timed translation and fade for drops, including drops scheduled later in the round, and add a corresponding SVG test. Evidence: the drop trajectory at plan line 301 and the all-surface requirement in `docs/plans/2026-10-04-phase-4-grill.md:99-101`.

- [P2] Test SVG complexity rather than only scene dimensions — docs/plans/2026-10-04-promptfall-phase-4.md:321-327
  A permitted two-colour checkerboard boss at 48×34 plus three distinct 16×16 heroes and one item requires 149,292 characters for straightforward horizontal-run rects alone, before wrappers or animation. Deduplicating art stems does not help distinct art, and the concept-only fixture misses this failure. Add an adversarial legal-art budget test and specify a more compact encoding or explicit complexity guard. Evidence: palette/size rules at plan line 17 and the hard cap in `claude-code.d.ts:11720-11724`.

- [P2] Keep damage numbers inside the stage viewport — docs/plans/2026-10-04-promptfall-phase-4.md:301-301
  The geometry test places a full-height 16 px actor at y=0 in the rest stage, and a 34 px boss at y=0 in its stage. Numbers positioned above those heads and rising further are entirely outside the framebuffer, so damage to those actors is invisible on Raster/Image. Define an in-frame number lane or clamped placement and test full-height actors. Evidence: plan lines 126 and 294, plus the visible-number requirement in `docs/spec/promptfall.md:399-401`.

- [P2] Exclude pixel-font numbers from the Raster base frame — docs/plans/2026-10-04-promptfall-phase-4.md:164-164
  `composeFrame` already burns each number into the RGBA frame as 3×5 pixel glyphs, but the Raster encoder then overlays ordinary text only across the text's single cell row. The remaining pixel-font cells survive around and below the text, producing duplicate/garbled numbers whenever they are visible. Give Raster a number-free base frame or separate the numeric layer before encoding. Evidence: the compositor and font contracts at plan lines 160-161 versus this overlay contract.

- [P2] Retain the departed world boss's sprite identity — docs/plans/2026-10-04-promptfall-phase-4.md:152-152
  Every world boss has `def: 'world_boss'`, while sprite selection requires its name. After disengagement the current view no longer contains that name, and this departed record retains neither name nor sprite key, so `sceneAt` cannot draw the correct boss during its dissolve. Retain the resolved sprite key or complete actor snapshot. Evidence: plan lines 40 and 301, and `plugins/promptfall/hooks/view.ts:203-212`.

- [P2] Preserve surviving enemy slots during a dissolve — docs/plans/2026-10-04-promptfall-phase-4.md:301-301
  Removing the front enemy compacts `view.enemies`, so placing survivors by their new array index moves the next enemy into slot 0 while the departed enemy explicitly keeps slot 0. They overlap throughout the dissolve. Retain stable slots for all actors through the transition, then compact after the departure finishes. Evidence: removal in `packages/sim/src/progression.ts:226-229` and positional assertions at plan line 294.

- [P2] Specify padded canvases for full sprites and item icons — docs/plans/2026-10-04-promptfall-phase-4.md:270-270
  The prescribed slicer preserves the cropped aspect ratio: its NES tank produces 16×11, contradicting this 16×16 assertion. Likewise, fitting a square item into 8×4 while preserving aspect produces 4×4, not the required 8×4 icon. Specify transparent padding to the contractual canvas sizes, or reconcile the tests and renderer dimensions. Evidence: `docs/plans/phase-4-concepts/slice.py:58-77`, the fit rule at plan line 107, and Raster icon dimensions at line 394.

- [P2] Probe upscale factors that satisfy the image budget — docs/plans/2026-10-04-promptfall-phase-4.md:224-224
  The spike measures only scale 1 and scale 8, but its required 160×34 worst-case frame at scale 8 uses 1,392,640 decoded bytes, exceeding `IMAGE_MAX_BYTES=1,048,576`; even scale 7 exceeds it. If scale 1 blurs and scale 8 looks crisp, the findings cannot identify a tested usable scale. Test factors 2 through 6 and define what happens if none is crisp within budget. Evidence: the byte formula at plan line 319 and budget at line 118.

- [P2] Propagate machine-wide settings to the active primary — docs/plans/2026-10-04-promptfall-phase-4.md:372-374
  Changing sound in a secondary session updates the shared store and that session's atom without claiming the lease, but the primary reads only its own `settingsAtom`, initialized at startup. Its cues therefore ignore the machine-wide toggle until restart. Define cross-session refresh or read the authoritative store when applying these preferences, and test two sessions. Evidence: plan lines 46 and 203, session-local state in `docs/spec/promptfall.md:77-80`, and the per-machine sound contract at lines 442-445.

- [P2] Restore hero sprites for market listings — docs/plans/2026-10-04-promptfall-phase-4.md:396-397
  The task explicitly suppresses hero-listing icons on every surface, whereas the settled decision gives inventory, heroes and market lists item and hero sprites (`docs/plans/2026-10-04-phase-4-grill.md:13-15`). Narrowing 7 exempts Raster hero rows only, not Image/SVG market listings. Carry the hero class through `ListingView` and render its sprite on those surfaces, or explicitly record and approve this additional narrowing.

- [P2] Make the early task gates executable — docs/plans/2026-10-04-promptfall-phase-4.md:8-8
  Requiring every task's final commit to pass this full line is impossible for Tasks 1 and 2: `sprites:check` is introduced only in Task 3. The same paragraph acknowledges that ordering but still requires the unavailable command. Define incremental check lines or apply the full gate only from Task 3 onward. Evidence: `package.json:9-16` has no sprite script, and this plan adds it at line 263.
