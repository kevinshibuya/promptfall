# Phase 4 plan: review wave and fix pass

Plan: `docs/plans/2026-10-04-promptfall-phase-4.md` at `218a215`. One wave on 2026-10-04:
`reviewer` on opus (`docs/reviews/plan-phase-4/opus.findings.md`, H1 to H7, M1 to M12, L1 to L10),
`reviewer` on fable (`fable.findings.md`, F1 to F14 plus the noted items), `codex-review` on
gpt-6-astra at xhigh (`codex.findings.md`, C1 to C25 in file order; log
`~/.claude/codex-runs/20261004-024242-78328-review-plan-phase-4.log`, exit 0, 917 s). Consolidated
inline by the Fable session that wrote the plan. Every cite below was read on this tree before the
ruling. Findings are evidence; each line is the ruling and the amendment it made.

## 1. Rulings

### Blockers, all three legs agreeing

1. **Actor pitch** (H1, F1, C2). Confirmed by arithmetic: 4 + 2·24 + 16 = 68 a side, 136 for both,
   over the 116 the ADR argues from. `ACTOR_PITCH` becomes 18 (one side 56, both 112 ≤ 116, a 4 px
   gap between the inner sprites at 116, enough for a 4 px lunge). A scene test asserts no overlap
   at `FULL_MIN_COLUMNS` with a 48 px boss in slot 0.
2. **Drop attribution** (H7, F3, C3). Confirmed: `engine.ts:227-228` publishes the view un-awaited
   and calls `onEffects` synchronously, so nothing has been observed as departed when the `drop`
   arrives. A `drop` or `drop_vendored` now attaches to the target of the nearest preceding `hit`
   in the same effects list (`combat.ts:46-54` pushes `hit` before `onEnemyKilled` pushes the drop,
   `progression.ts:226-245`), starting when that hit's flash ends; with no preceding hit, the front
   enemy. Codex's "pass an atomic step transition" is the heavier fix; the nearest-hit rule gives
   the same victim with no engine change.
3. **The probe** (H4, F2, C12, L1). Confirmed: `UiBlitResult.deny` covers not-mounted and
   wrong-size (d.ts 12975-12985), and `band.tsx:116-131` and `:142-164` draw no status row while
   the view is null, collapsed, hidden or secondary. The probe is now armed only by a render whose
   returned tree holds the probe Image; it blits a second, distinct pixel (L1: an equal source sends
   nothing); only a deny naming the alt writes `'raster'`; any other deny leaves `'unknown'` and the
   next probe-bearing render arms it again. Task 1 records the exact deny strings.
4. **Compact layout versus `rowsAt`** (H2, C1). Confirmed from the plan's own text: a 4-row compact
   box never equals 8, 12 or 17. A shared `layoutFor` in `stage/layout.ts` returns the layout kind
   and box for the hook and the loop; the loop invalidates when the layout differs from the mounted
   one, not when the raw rows do.
5. **Observe only in the loop** (H3). Confirmed: the view publish re-renders the band before the
   loop's tick. The render hook calls `timeline.observe` on every surface before `layoutFor`.
6. **First lunge skipped at idle** (F5, C9). Confirmed: a 240 ms lunge inside a 500 ms idle period.
   `StageLoop.onEffects` cancels the pending timer and arms one at 0 ms.
7. **SMIL restarts on every re-render** (F4, C13). Confirmed: the band re-renders on every atom it
   read. Started motions get a negative `begin`; finished motions are omitted; the svg test for a
   started lunge now expects a negative begin. Task 1's desktop spike also asks whether an identical
   source restarts the frame.

### Blockers, one leg

8. **Goldens as JSON** (H5). Confirmed against `plugin-authoring/reference.md:14`: the plugin loads
   `.ts`, `.tsx`, `.js` and friends only. The goldens are `stage/goldens/index.ts` exporting
   `GOLDENS`; the `.svg` files stay for eyeballing. The hash lives in `stage/hash.ts` (F11).
9. **Damage numbers off the frame** (H6, C17). Confirmed: a 16 px actor on a 16 px stage has no
   room above its head. Numbers float inside the frame: the text's top is
   `clamp(actorTop + 2 − rise, 0, height − 5)`, centred over the actor; both encoders clamp.
10. **Numbers drawn twice on raster** (M5, C18). Confirmed from the plan's own two contracts.
    `composeFrame(stage, { numbers })`; the raster encoder composes without numbers and overlays
    text cells.

### Medium, accepted

11. **Atoms per module and `PluginState`** (M1, C5). Confirmed at `state.ts:11-14` and
    `types/index.d.ts:208-226`. `state.ts` exports `SETTINGS_DEFAULT` only; each module declares its
    atoms; `PluginState.promptfall` gains `settings` and `renderer`.
12. **`ItemView.base`** (M2, C7, C24). Confirmed: `ItemView` has no base. Added in Task 8, filled in
    `view.ts`; `ListingView` gains `base` and `cls`, and hero listings get the class sprite on
    Image and Svg (C24: record §1.1 names the market list).
13. **Slicer CLI and padded canvases** (M3, C21). Confirmed: `slice.py` takes a grid size and fits
    bosses; cropped NES art is not 16 × 16. The slicer takes `--grid`, `--row`, `--size` or
    `--fit`, `--colours`, `--names`, and pads NES art to a 16 × 16 canvas bottom-centred; the build
    pads any smaller NES art the same way, so `full` is always 16 × 16 for NES sprites. Icons are
    8 × 4 by per-axis factors (F9, L6): the record's 2-row icon is 8 columns by 2 rows of
    half-blocks, square on screen at the cell's 1:2 aspect.
14. **Lint on generated files** (M4). Confirmed: `biome.json` excludes vendor, types and docs only.
    `generated.ts` and `stage/goldens/` are excluded there in Tasks 3 and 5.
15. **Loop lifecycle** (M6, M7, F7, C8, C10, C11). A not-mounted or size deny stops the loop until
    the next `mount`; sites are keyed by surface, one `StageLoop` per surface sharing the timeline,
    so a desktop render never cancels the terminal's timer; a tick captures the mount generation
    and bails after each await when it changed; with `motion: 'still'` the loop blits one settled
    frame on the busy-to-idle transition; the desktop fallback (`SVG_SMIL` false) is a site with
    renderer `'svg'` whose tick calls `invalidate` at `SVG_FALLBACK_FRAME_MS` while busy and never
    at rest (the bob is dropped on that path, a narrowing).
16. **The band reaches the loop** (M8, F noted). `registerBand(on, game)` like `registerDialog`;
    `GameHandle` gains `stage`. The probe lives in `band.tsx`, which owns `rendererAtom` and arms
    `$.clock.after` itself.
17. **Band tests and the invalidate stub** (M9). The harness records `ui.invalidate` and calls
    `next(e)`; blits are counted through the `on('ui.blit')` stub.
18. **Svg colour and motion** (M10, F6, C14, C15). Rarity-slot runs use `fill="currentColor"` with
    `color` on the `<use>`; the flash is a `<filter>` (`feFlood` white, `feComposite in
    SourceAlpha`); a fallen hero is `opacity="0.5"`; `renderSvg` takes `motion`; drops get their own
    timed translate and fade. The art is emitted as one `<path>` per colour per stem (F13, C16),
    and an adversarial budget test uses a 2-colour checkerboard boss with three checkerboard heroes
    and a drop.
19. **Party line widths** (M11). Hero segments are name ≤ 8, ` L<n> `, a 6-cell bar, ` <hp>/<max>`
    (27 columns), three plus separators 90; the enemy segment takes the rest (≥ 26 at 116),
    right-aligned, truncated. In boss mode it reads `⚔ <name ≤ 12> <6-cell bar> <shown>/<max>`, the
    spec's global bar. The compact layout keeps today's hero rows with their enemy slot, so the
    front enemy is named there.
20. **`IMAGE_SCALE` rule** (M12, F10, C22). The spike draws the stage's own case (a 120 × 16 checker
    in a 120 × 8 box) at pre-upscaled scales 1, 2, 4 and 6 and blits each at 12 fps for 5 s. The
    rule: the smallest scale Kevin reads as crisp, at most 6 (160 × 6 by 34 × 6 by 4 is 783,360
    bytes, under the 1 MiB budget); none crisp means 1 and a note.
21. **World boss identity on departure** (C19) and **stable slots** (C20 second half, C19's
    neighbour). The timeline remembers each enemy's resolved sprite id and slot at `observe`; a
    departed enemy keeps both until its motions end; survivors keep their slots; a new enemy takes
    the lowest free slot. Motions naming an actor the timeline never observed are dropped (F8).
22. **Settings reach the primary** (C23, L4). The three settings commands claim the lease like every
    other subcommand (`command.ts:52`), so the session that typed them is the primary and holds the
    atom; no store read per tick.
23. **Check line before Task 3** (C25). Tasks 1 and 2 run the line without `sprites:check`.
24. **`bossTransition` kind** (F noted, L3). It returns `{ kind: 'appeared' | 'down'; text } | null`;
    `world.ts` joins Task 7's Files list.
25. **`LoopIo.blit` type** (L2, C4). `(args: UiBlitArgs) => Promise<UiBlitResult>`.
26. **Fixture and alt** (F12, L7). The wave fixture is zone 1, wave 2, with Goblin Scout, Field Rat
    and Road Slime; the alt names all three.
27. **Names** (L8, C6, F noted). `StoreKeyValue`; `reset()` keeps `settings` (`key !== SETTINGS_KEY`);
    the build reads `content.enemies`, `content.itemBases`, `content.heroTemplates` (the classes
    deduped from the templates' `cls`) and `WORLD_BOSSES`; `Cue` is declared with `'boss'`; the
    manifest example shows PR 1's alias shape and names a plausible rarity colour;
    `combat.test.ts` is modified, not created; `toasts.ts` leaves Task 2's list.
28. **Glossary** (L10). CONTEXT.md avoids "scene" and "icon". `Scene` is `StageModel` and `sceneAt`
    is `stageAt`; the item variant is `small` and the list element `ListSprite`.
29. **base64** (L9). `btoa` and `atob` exist in the runtime (d.ts 14107); `base64.ts` wraps them
    with chunked `String.fromCharCode` instead of a hand-rolled coder.
30. **PR 2's reason** (F14). Narrowing 1 keeps the second reason only.

### Dismissed

- "Re-render replaces the Raster and loses the last blit" (fable, dismissed by the leg itself): the
  hook composes the current frame and the next blit lands within a tick.
- "Pass an atomic step transition" (C3's fix direction): the nearest-hit rule covers every drop with
  no engine change; see ruling 2.
- "Store read for machine-wide settings" (C22's fix direction): the lease claim covers it; see 22.

## 2. Amendments

The plan was rewritten at the paths above; the Shared contracts and Tasks 1, 3, 4, 5, 6, 7 and 8
changed. No spec change: every ruling is inside the record's decisions. New narrowings: 18 (numbers
float inside the frame), 19 (stable slots), 20 (one `<path>` per colour per stem), 21 (the desktop
fallback drops the bob), 22 (settings commands claim the lease), 23 (glossary renames).
