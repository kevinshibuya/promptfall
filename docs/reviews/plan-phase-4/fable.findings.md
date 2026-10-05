# Phase 4 plan review: fable leg

`reviewer` on Fable 5.1 at high, 2026-10-04, fresh context, read-only. Findings F1 to F14 in the
leg's own order; "Noted" items are F15 onward in the fix pass.

Verdict: the seam (timeline / scene / compose / encoder / loop) is right and the plan is executable
in outline, but four findings would surface only in Task 6 or on the real terminal. Fix pass needed
before task 1.

## Act on (ranked)

**F1. The full-stage geometry overlaps at 116 and 120 columns.** Plan `:115` sets `ACTOR_PITCH = 24`,
`ACTOR_EDGE = 4`, `SPRITE_PX = 16`; `:294` asserts enemy i at `x = 4 + 24i`, hero i at
`x = W − 4 − 16 − 24i`. One side needs `4 + 2·24 + 16 = 68` px; two sides need 136 > 120 (the test
box) and > `FULL_MIN_COLUMNS = 116`. At 120 columns enemy 2 (52–68) and hero 2 (52–68) draw on top
of each other; a 48 px boss (4–52) touches hero 2. `scene.test.ts` asserts the formula, so it stays
green while the stage is wrong. Fix: `ACTOR_PITCH = 18` (one side 56, both 112 ≤ 116, 2 px between
sprites), or raise `FULL_MIN_COLUMNS` to 136 and amend ADR 0003's "about 116". Keep the test
formula, change the constant.

**F2. The probe writes `'raster'` on Ghostty whenever its Image is not mounted.** `:199` arms
`after(PROBE_DELAY_MS, probe)` "once per session" from the render hook and maps any `{ deny }` to
`'raster'`; `:348` tests only the alt deny. The d.ts says deny also means "nothing of this plugin's
is mounted there" (`claude-code.d.ts:2290-2292`, `:12975-12985`). The first terminal render has
`view === null` (the engine publishes the view only after bootstrap, `engine.ts:206`) and
`band.tsx:116-131` draws no status row then; `hasSurvey`, `mode !== 'primary'`, `bodyColumns < 100`
and `prefs.collapsed` all skip the status row too (`band.tsx:142-164`). A probe armed from any of
those renders fires at an unmounted Image, is denied, and the session is `'raster'` for good. Fix:
arm the probe only from a render that put `<Image key="probe">` in the returned tree; on a deny
while the probe was not in the latest tree, or whose reason is not the alt reason, stay `'unknown'`
and re-arm; have Task 1's findings table record the exact deny strings for "alt" and "not mounted".

**F3. `drop` attribution cannot work in the order effects arrive.** `:149` attributes a `drop`
motion to "the last enemy that departed in this step (else the front enemy)". `engine.ts:227-228`
queues the view publish asynchronously and calls `onEffects` synchronously, so the timeline sees the
round's effects before any `observe` can see the enemy gone; the rule always falls through to the
front enemy, wrong for every archer, white-mage and black-mage kill (they target lowest HP,
`combat.ts:95-104`). Fix: attribute a `drop` to the target of the nearest preceding `hit` in the
same list; `combat.ts:46-54` with Task 2's change pushes `hit` first and `onEnemyKilled`
(`progression.ts:226-245`) pushes gold and drops right after. Also say whether `drop_vendored` pops.

**F4. The desktop Svg replays motions on every re-render.** `:174`: `begin = (motion.from −
opts.now)` clamped at 0. The band re-renders on every atom write it read (view each tick, world poll
every 5–15 s, notices, prefs), and each render yields a different source string (new `now`), so the
frame reloads and every motion under way restarts: a world-poll publish 400 ms into a four-hit
stagger replays hits 1–3. Fix: emit negative `begin` for motions with `from < now` (SMIL
`begin="-0.17s"` starts mid-way) and omit motions with `until <= now`; add to Task 1's desktop spike
"does a redraw with a byte-identical Svg source restart SMIL?".

**F5. The first lunge after idle is skipped.** `:197` re-arms the timer only at the end of a tick
and `:192` says `onEffects` only forwards. At rest the timer is `IDLE_FRAME_MS = 500`; a hit at t0
starts a `LUNGE_MS = 240` lunge that is over before the next tick. Fix: `StageLoop.onEffects`
cancels the pending timer and arms one at 0 ms.

## Consider

**F6. The Svg white flash needs a mechanism.** `:174`, narrowing 6: a `<use>` of a `<g>` whose
`<rect>`s carry explicit `fill` cannot be recoloured from the `<use>`; it needs a `<filter>`
(`feFlood` white + `feComposite operator="in" in2="SourceAlpha"`) or a `<mask>`. Name it.

**F7. `mount(null)` from a desktop render kills the terminal loop.** `:345` lists the null cases for
the hook in general; a desktop AbovePrompt render on the Party tab is neither a site nor in the
list. With both surfaces attached (`register.tsx:545` then `:603`), a desktop redraw that calls
`mount(null)` cancels the terminal's timer. Fix: a render with `e.surface !== 'terminal'` never
calls `mount`, or sites are keyed by surface.

**F8. Hits on actors the timeline never saw.** `tool_call` events (`register.tsx:673-677`) arrive
faster than the idle tick; an enemy spawned by one tool call and killed by a tick inside 500 ms is
hit and gone before any `observe`. `sceneAt` on an unknown def would throw. One sentence: motions
naming an actor the timeline has not observed are dropped.

**F9. The downsample rule has one factor; the icon needs two.** `:107` "a grid of `ceil(w / f) ×
ceil(h / f)` blocks". The icon goes 16 × 16 → 8 × 4 (`fx = 2`, `fy = 4`). State per-axis factors.

**F10. The `IMAGE_SCALE` rule is inverted and its cap is wrong.** `:224` "the smallest integer at
which `imageBytes` of a 160 × 34 frame stays under `IMAGE_MAX_BYTES` ... (8 at most)". Smallest is
always 1; under 1 MiB the cap is 6 (160·6 × 34·6 × 4 = 783 KB; 7 gives 1.07 MB). At 6 every blit
carries ~1 MB of base64, 12 a second. Fix: "the largest integer ≤ 6 at which the pre-upscaled
checker was crisp", and have the spike time one blit at scale 4 and 6.

**F11. Missing file in Task 5.** The FNV-1a hash is used by `scripts/stage-goldens.ts` (`:315`) and
recomputed by `golden.test.ts` under `claude plugin test` (`:321`); the plugin cannot import from
`scripts/`, so the hash lives under `hooks/stage/` (`stage/hash.ts`). Add it to the Files list.

**F12. Fixture and alt disagree.** `:292` `wave()` is "zone 3, wave 2, ..., three wave enemies";
`:294` expects two enemies, both zone 1 defs (`enemies.ts:44-49`; zone 3 is Bog Lurker, Marsh
Leech, Mire Toad, `enemies.ts:60-66`). Pick one and spell the alt for it.

**F13. Svg budget.** Estimate for the 17-row boss scene with run-length `<rect>`s at ~50 chars each:
a 48 × 34 16-colour boss ≈ 550 runs ≈ 28 KB; three distinct hero stems ≈ 15 KB; a drop ≈ 5 KB;
animation ≈ 3 KB; total ≈ 50 KB. The pathological case (dithered shading: 1,632 + 3 × 256
single-pixel runs) is ≈ 130 KB, at the edge, and gpt-image-2 shading dithers. One `<path
d="M12 3h4v1h-4z…">` per colour per stem (~12 chars a run) gives PR 2 a 4× margin.

**F14. PR 2 as its own plan.** Narrowing 1's first reason ("no fixed task count") is overstated: the
loop is 12 zones plus one gate. The second reason (prompts and slicer settings depend on the
pipeline as PR 1 leaves it) is the real one and is enough. Drop the first reason.

## Noted

- `:46` cites `register.tsx:367-368` as "a server switch"; that is `reset()`, which deletes every
  key but `LEASE_KEY`. Say "reset keeps `settings`" and name the `key !== SETTINGS_KEY` edit.
- `registerBand(on)` (`band.tsx:112`) has no path to the session's loop; the plan implies
  `registerBand(on, () => game)` like `registerDialog`.
- `Cue` in `Record<Cue, string>` (`:370`) is never declared.
- Task 7: `bossTransition` (`world.ts:38-49`) returns a string for both "appeared" and "down"; say
  how the poller tells them apart for the cue.
- Task 2 toasts.ts "if there is one": `toasts.ts:42` has a `default`; drop the file from the list.
- `n` is the Market tab's buy-cancel (`market.tsx:170`); a different tab, no collision.
- `SPRITE_COUNT` = 4 + 4 + 72 + 4 + 40 + 1 = 125; the generated module at PR 2 is ≈ 150 KB. Fine.

## Dismissed

- "Re-render replaces the Raster and loses the last blit": true (`claude-code.d.ts:5119-5121`),
  harmless, since the hook composes the current frame at `now` and the next blit lands within ≤
  83/500 ms; a blit against a resized mount is denied and ignored (`:8707-8710`).
- "`isInteractive` for the bob only": no, every SMIL needs it (`:11745-11750`); the plan has
  `isInteractive={SVG_SMIL}`, correct.
- World boss: hp never moves locally (`combat.ts:48-51`); Task 2 pushes `hit` before the early
  return; departure arrives as `boss_disengaged` emptying the encounter, which `observe` sees as a
  departure → dissolve at 17 rows → shrink. Sound.
- Hits on an enemy killed in the same round: `hit` arrives first, flashes are scheduled, the next
  `observe` finds the id gone and the stored last flash. Sound.

## Verified correct

- d.ts: `ui.blit` semantics and 120/60 rates `:2278-2298`; `UiBlitArgs` `:12970`, deny reasons
  `:12975-12985`; `ImageProps` `:5127-5160`; `ImageSource` rgba 1–2048, 2 MiB `:5162-5190`;
  `RasterProps` `:8746-8785`; `SvgProps` `:11720-11755`; `AudioClip.asset` `:709-720`,
  `PlayOptions.gain` 0–4 `:7280-7305`; `invalidate` `:2266-2277`; `AbovePrompt` props
  `:9717-9742`; `e.requestId` `:5854`, `:13254`; `MockClock` `:14729-14775`; event map `audio.play`
  `:6552`, `ui.invalidate` `:6696`, `ui.blit` `:6726`. Every API claim in the plan matches.
- `hit` is output-only: `hashState` hashes state; the ledger reads only `rejected`
  (`books.ts:122`); no exhaustive switch on `Effect.k` anywhere. Four `hitEnemy` call sites
  (`combat.ts:65,73,96,104`), one `enemyAct` attack (`:120`).
- Narrowings 2–17 each trace to a record line; only 5 widens, and says so. Record decisions
  1.1–1.13 all have a task.
- `@promptfall/sim` exports `./src/index.ts`, so `scripts/sprites.ts` resolves it under tsx;
  `WORLD_BOSSES` is exported (`ledger/src/index.ts:4`).
- Compact width 52 = 3 × 8 + 4 + 3 × 8; the loop design is sound once F5 is in.
