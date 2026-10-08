# Promptfall phase 4 PR 3: the animation frames, implementation plan

**Goal:** Every actor on the 1.5× stage breathes on a two-frame idle loop, winds up and strikes
on its own drawn frames, and shows a hit frame when struck; each hero class attacks differently,
three of them with an effect sprite that crosses the stage.
**Architecture:** Two of the four new frames per actor are drawn by gpt-image-2 against the
shipped 1.5× art (wind-up, strike) and land through the slicer and the build as 1.5×-only art on
the `Sprite`, on the idle art's canvas; the other two (idle B, hit) are fixed transforms of the
idle art, computed in the plugin at draw time. The timeline grows from one `lunge` per action
into a choreography (wind-up, strike, follow-through, bolt or burst, hit) inside today's action
span, the model exposes a pose per actor with the art of every pose and a list of effect sprites,
and each renderer draws the pose's art at its scale: the 1.5× surfaces the frames, the 1×
surfaces one drawing and code motion, byte for byte as today.
**Spec:** `docs/plans/2026-10-07-phase-4-pr2-hires-grill.md`, round 3 (Q17 to Q23), read at
1.5× per round 4; on top of `docs/adr/0006-two-art-densities.md`.
**Execution model:** opus

## Readings

Round 3 was answered when the art was 2×; round 4 made it 1.5× and said rounds 1 and 2 hold
with 1.5 for 2. This plan applies the same to round 3: "2× only" (Q21, Q22) reads as 1.5× only.
Where the grill left a value open, the plan fixes one; Kevin's approval of the plan is the approval
of these, and a review finding against one of them is a finding against the plan, not the grill.

1. Q19's "wind-up and strike play during the lunge" is taken literally: the wind-up frame covers
   the lunge's outward half, the strike frame shows from the apex, and impact stays at the apex
   (`LUNGE_MS / 2`, 120 ms, as today). The in-place shapes (bolt, burst) keep the same 120 ms
   wind-up before their strike. `ACTION_MS` stays under the sim's 500 ms action floor
   (`timeline.test.ts` "playback never drifts"), and every scale-1 golden stays byte-identical.
2. Idle B and hit are not committed PNGs. They are pure functions of the idle art, in the plugin,
   memoised per art (Q23 says "derived from frame 1 by fixed transforms"; 160 extra PNGs for a
   one-row squash would be art to keep in step for nothing). The transforms are pinned in Task F1.
3. The timings, in ms, all in `stage/tuning.ts`: `WINDUP_MS` 120 (asserted equal to
   `LUNGE_MS / 2`), `LUNGE_MS` 240 (unchanged), `FOLLOW_MS` 120, `BOLT_MS` 200, `BURST_MS` 200,
   `FLASH_MS` 160 (unchanged: the hit frame's duration, and the 1× flash), `BLINK_MS` 100 (the
   white at 1.5×: longer than one event frame, `EVENT_FRAME_MS` 83, so the Image loop cannot
   step over it).
4. The white mage's heal plays its burst on the healed ally, with the same wind-up and strike
   pose; a white mage that only heals would otherwise never show Q20's attack.
5. The 1× surfaces are unchanged for the lunge shapes: the lunge, the `hero_attack` swap for its
   whole span, the flash for `FLASH_MS`, the bob regardless of pose. The in-place shapes are new
   there too (a mage no longer lunges; it stands in `hero_attack` art while the effect flies), and
   the effect sprites draw at 1× (Q21).
6. A sheet's reference is one composite image of the batch's shipped 1.5× art, laid out in the
   sheet's columns (Task F2), not one `-i=` per native: the model then reads "column 3 of the
   reference" as "column 3 of the sheet".
7. Every drawn frame lands on its idle art's canvas: same width and height, bottom-centred,
   shrunk to fit if larger. So every pose of an actor has the idle's size and draws at the idle's
   place; the hit frame is the one exception (it grows on the actor's back side) and carries its
   offset. A frame whose native is much larger or smaller than its idle's native is a redo
   candidate (Task F3's report), since the fit changes its pixel scale.
8. The hero strike frame at 1.5× is the `hero_attack` sprite's 1.5× art (Q18); the build emits a
   reference to the same object, so the Svg's identity dedupe holds. An actor's `spriteId` on the
   stage is always its idle sprite's id; poses come through the actor's `poses`.
9. The frames do not feed `art/palettes/hires.json`; they snap to the master as it is. A
   re-derive would move every shipped sprite's snap for no gain.
10. In the Svg, the two derived frames are drawn from idle A's def: idle B through two row clips
    (one translated a pixel down), the hit frame through `k + 1` row clips and a gamma filter
    equal to `lighten`. Neither adds a def; the idle loop and a hit cost a few hundred characters
    per actor. The drawn frames (wind-up, strike, follow-through) are defs of their own while in
    use (Q22). "In use" means a motion live at `now` or starting before the next redraw
    (`now + SVG_FALLBACK_FRAME_MS`); the timeline queues a whole tick's actions at once, and a
    document carrying every attacker's frames of the tick would sit near the cap in boss fights.
11. An `attack_all` plays one effect per hit target. A hit without an action (a resync, a
    delivery) keeps today's impact at `LUNGE_MS / 2` and shows the hit frame.

## Global constraints

- Branch `phase-4-pr3-frames` from `ai-staging`, one PR into `ai-staging`.
- Full check line, before each task's final commit:
  `pnpm lint && pnpm typecheck && pnpm test && pnpm vendor:check && pnpm sprites:check && pnpm font:check && pnpm exec tsc -p plugins/promptfall && claude plugin validate plugins/promptfall && claude plugin test plugins/promptfall`.
  The sim balance test can time out at 5 s under load: rerun it or add `--testTimeout 30000`; a
  timeout alone is not a failure, an assertion is. `.promptfall/tools/check.sh <log>` runs the
  line into a log.
- No `any`.
- Nothing in cells changes: the band's rows and columns, the compact stage, the list windows.
- Frames are 1.5× art only, on the idle art's canvas (reading 7): `nes` 24 × 24, `snes` the
  idle's width and height (at most 72 × 51, a turn boss's at most 36 rows), 16 colours snapped
  to `art/palettes/hires.json`, fit only shrinks. The three effect sprites are ordinary `nes`
  sprites with 1× and 1.5× art, kind `effect`.
- The 1× art, the 1× stage, the compact stage, the Raster path and the list windows draw as
  today, apart from reading 5. The committed scale-1 golden hashes (`rasterHash`, `imageHash`,
  `svgHashLo`, `svgHash` of `compact`) never change in this PR; a task whose check line shows one
  moved stops and reports it as a defect.
- The Svg cap is the engine's `SVG_MAX_CHARS` 131,072; `svgWithFallback` keeps the fall-back.
- Image runs follow the art plan's "Codex image runs" rules
  (`docs/plans/2026-10-07-promptfall-phase-4-pr2-art.md`, lines 44 to 66), with these
  substitutions: labels `pf3-…`; the attachments are the sheet's composite reference first, then
  the style sheet of its kind (`art/sheets/dense-heroes-zone1-items.png` for `nes` sheets,
  `art/sheets/zone1-bosses.png` for boss sheets); `frames-common.txt` in place of `common.txt`.
  The rest verbatim: `codex-run.sh`, `run_in_background: true`, Bash timeout 600000, no polling,
  two runs in flight at most, `file <out>` then `codex-usage.sh` after each, no run above 85% of
  the 5-hour window, a limit hit stops everything and reports the reset time. 21 runs is the
  floor and about 25 the budget (5% each): the boss sheets span two 5-hour windows. A sheet's cut,
  manifest, build and goldens are committed before the next pair starts, so a stop loses nothing.
- Review never blocks: a sheet task publishes and continues. Redo ids collect in `art/sheets.md`
  under "Redos (frames)".

## The choreography

One action by attacker A on target T, starting at `start` (today's `start`), in ms from it. At
1.5× the actor draws the frame named; at 1× it draws `hero_attack` art for a hero and its one
drawing otherwise, through both wind-up and strike, as today.

| Shape | Who | Frames and motion |
| --- | --- | --- |
| `lunge` | every enemy | the lunge as today (`LUNGE_PX` out and back over 240): 0–120 wind-up frame, 120–240 strike frame; impact 120 |
| `lunge_follow` | knight | as `lunge`, then 240–360 follow-through in place |
| `bolt` | black mage (fireball), archer (arrow) | 0–120 wind-up in place; 120–320 strike in place while the effect flies from A's front edge to T's centre; impact 320 |
| `burst` | white mage (attack and heal) | 0–120 wind-up in place; 120–320 strike in place while the light burst sits on T's centre; impact 220 |

At impact T shows `hit` for `FLASH_MS` and, at 1.5×, the white overlay for `BLINK_MS`; at 1× the
white overlay for `FLASH_MS` as today. The number rises from impact as today; the drop anchors on
the last hit's flash end as today. `ACTION_MS = max(LUNGE_MS + FOLLOW_MS, WINDUP_MS + BOLT_MS,
LUNGE_MS / 2 + FLASH_MS)` (360): the attacker's longest busy span; a hit tail may overlap the next
action's wind-up, which is in place and on another actor (or, on the same actor, `hit` wins the
pose). For the lunge shapes nothing about `start`, impact or `ACTION_MS`'s meaning changes.

Idle: at 1.5× the actor alternates idle A and idle B on the bob's clock (`bobbingAt`: B during
the second 500 ms of each second), with no vertical bob; at 1× the 1-pixel bob as today,
whatever the pose. Under `motion: 'still'` the idle is A and does not move; every other motion
plays, as today. Fallen heroes show idle A and never take a hit frame.

## Tasks

### Task F1: the derived frames

**Files:**
- `plugins/promptfall/hooks/sprites/derive.ts` — create: `squash`, `shear`, `lighten`,
  `opaqueRows`, `opaqueBox`
- `plugins/promptfall/hooks/sprites/derive.test.ts` — create

**Interfaces:**
- Produces: `opaqueRows(art: SpriteArt): { r0: number; r1: number } | null` (the first and last
  rows holding an opaque pixel), `opaqueBox(art): { x0, y0, x1, y1 } | null`, `squash(art:
  SpriteArt): SpriteArt` (idle B), `shear(art: SpriteArt): { art: SpriteArt; grow: number }`
  (the hit silhouette), `lighten(rgb: number): number` (the hit palette). `squash`, `shear` and
  the box functions are memoised per input `SpriteArt` in a `WeakMap`, so two calls return the
  same object (the Svg dedupes defs by identity; `generated.ts` emits each art once as a
  module-level object, so identity is stable at runtime).

**Work:** Pixels are base64 row-major palette indices, index 0 transparent (`SpriteArt` in
`sprites/types.ts`); decode as `stage/compose.ts` does. With `r0`, `r1` from `opaqueRows` and
`H = r1 - r0 + 1`:
- `squash`: if `H < 3`, return the input. Else `m = r0 + floor(H / 2)`; rows `r0..m-1` move down
  one row, row `m` is dropped, rows below `m` stay; row `r0` ends transparent. Same width, height
  and palette.
- `shear`: `k = max(1, round(H / 12))`. The output is `k` wider; row `y` in `r0..r1` is copied to
  `x + k - round(k * (r1 - y) / (r1 - r0))`: in the output canvas the top row keeps its columns
  and the bottom row moves `k` to the right, so once the caller places the output `k` further
  left (Task F6), the feet stay and the head leans back from the facing side, which is right.
  `H < 2` returns `{ art, grow: 0 }`. Same height and palette; `grow = k`.
- `lighten`: per channel `round(255 * (v / 255) ** 0.6)`; black stays black, white stays white.
  The caller lightens palettes; the rarity colour is substituted before it (Task F6).

**Acceptance check:** `claude plugin test plugins/promptfall` with `derive.test.ts`: a 24 × 24
art with a 10-row figure squashes to 9 rows with the top row moved down one and the figure's
middle row gone, the bottom row unchanged; a 2-row figure is returned as is; a 24-row figure
shears with `grow` 2 and width 26, its top row's pixels at the same columns and its bottom row's
at `x + 2`; `lighten(0)` is 0, `lighten(0xffffff)` is `0xffffff`, `lighten(0x808080)` is
`0xa9a9a9`; `squash(a) === squash(a)`; `opaqueBox` of a 16 × 16 art holding one pixel at (5, 12)
is `{ 5, 12, 5, 12 }`. Red before: the module does not exist. Full check line.

**Boundaries:** No change to `types.ts`, the build or the stage.

- [ ] tests, red; implement; full check line; commit

### Task F2: the reference sheet and the hero sheet

**Files:**
- `scripts/ref-sheet.ts` — create; `package.json` — modify: `"refsheet": "tsx scripts/ref-sheet.ts"`
- `scripts/ref-sheet.test.ts` — create
- `art/sheets/frames-common.txt` — create (gitignored)
- `art/sheets.md` — modify: a `## frames-heroes.png` section (references, prompt, cut), and the
  "Redos (frames)" section
- `art/sprites-frames/hero/*.png` (5), `art/sprites/effect/*.png` (3),
  `art/sprites-hires/effect/*.png` (3) — create by the cut

**Interfaces:**
- `pnpm refsheet <out.png> --columns <n> --cell <w>x<h> --scale <k> <kind/name|blank>,…`: a
  magenta (`#FF00FF`) PNG `n` cells wide and one cell tall, each listed sprite's
  `art/sprites-hires/<kind>/<name>.png` scaled `k` times nearest-neighbour and bottom-centred in
  its cell, 24 screen pixels above the cell's floor; `blank` leaves a cell empty. Monster sheets:
  `--columns 8 --cell 192x256 --scale 7`; boss sheets: `--columns 2 --cell 768x512 --scale 7`.

**Work:** `frames-common.txt` is `common.txt` with its STYLE heading's "but these are NEW designs,
not copies of the reference figures" replaced by "these are the SAME figures as the attached
reference, in new poses: same design, same size, same colours, same pixel size". The prompt is
assembled as the art plan says (`bg.txt`, the body, `frames-common.txt`, the image_gen line),
written into `art/sheets.md` before the run; attachments per the Global constraints.

The hero composite, `--columns 8 --cell 192x256 --scale 7`, in the sheet's column order:
`hero/knight,hero_attack/knight,hero/black_mage,hero/white_mage,hero/archer,hero_attack/black_mage,hero_attack/white_mage,hero_attack/archer`.

The hero sheet body (one run, `pf3-frames-heroes`, output `art/sheets/frames-heroes.png`):

```text
Generate one landscape 1536x1024 sprite sheet: a strict grid of 8 columns x 4 rows, 32 small sprites, one per cell, every cell the same size (192 x 256 screen pixels). The attached reference sheet shows, left to right: column 1 the knight idle, column 2 the knight attacking, column 3 the black mage, column 4 the white mage, column 5 the archer, and columns 6 to 8 the black mage casting, the white mage casting and the archer shooting (for their staffs and bow only).
Row 1, one per column: 1 the knight winding up (sword raised high behind the head, weight back); 2 the knight's follow-through (sword swung down past the front foot, cape flying); 3 the black mage gathering fire (staff raised, a small flame at its tip, robe billowing); 4 the white mage raising the staff overhead with both hands; 5 the archer drawing the bow (string pulled to the cheek, arrow nocked); 6 a fireball (a round orange and yellow ball of fire with a short trailing flame, flying right, no figure); 7 a burst of holy light (a white and gold eight-rayed star, no figure); 8 a wooden arrow with a steel head and feather fletching, flying right, drawn horizontally, no figure.
Rows 2, 3 and 4: three more different takes of the same eight, in the same columns.
The hero sprites keep the exact designs of the reference (same armour, hats, capes, colours, same size), only in these poses. Characters face right.
```

Cut, for the chosen row `<r>` per sprite: `pnpm slice art/sheets/frames-heroes.png
/tmp/promptfall-frame-cuts --grid 8x4 --colours 4 --size 16 --native art/sheets/native --hires
art/sprites-frames --row <r> --names
hero/knight-windup,hero/knight-follow,hero/black_mage-windup,hero/white_mage-windup,hero/archer-windup,x/a,x/b,x/c`
(`--names` with `x/…` for the columns not taken from that row), then the effects with `--hires
art/sprites-hires` and the out dir `art/sprites`: `--names
x/d,x/e,x/f,x/g,x/h,effect/fireball,effect/light_burst,effect/arrow`. Remove the `x/` scratch
kinds. Pick the row per sprite by eye from the sheet (a contact needs the build: Task F4 publishes
it; the pick is recorded in `art/sheets.md`).

**Acceptance check:** `pnpm vitest run scripts/ref-sheet.test.ts`: two 24 × 24 sprites and a
`blank` with `--columns 3 --cell 192x256 --scale 7` give a 576 × 256 magenta PNG with each
sprite 168 wide, bottom-centred, its lowest opaque row at `y = 231`, the third cell all magenta.
Red before: the script does not exist. `file art/sheets/frames-heroes.png` is PNG; the five frame
PNGs are 24 × 24 and the three effect pairs 16 × 16 and 24 × 24 (`sips -g pixelWidth -g
pixelHeight`). The manifest and the build are untouched, so `pnpm sprites:check` still passes.
Full check line.

**Boundaries:** No manifest, build or stage change. No change to the shipped hero art.

- [ ] refsheet tests, red; implement; the composite; the prompt into `art/sheets.md`; run; cut;
  full check line; commit

### Task F3: the manifest, the build and the `effect` kind

**Files:**
- `scripts/sprites.ts` — modify
- `scripts/sprites.test.ts` — modify
- `plugins/promptfall/hooks/sprites/types.ts` — modify: `SpriteKind` gains `'effect'`; `Sprite`
  gains `frames: SpriteFrames | null`
- `plugins/promptfall/hooks/sprites/index.ts` — modify only if `spriteFor`'s kind type needs it
- `plugins/promptfall/hooks/sprites/sprites.test.ts` — modify: the count test adds
  `EFFECT_IDS.length` (3)
- `art/manifest.json` — modify: `frames` on the four hero entries, three effect entries
- `art/sheets.md` — modify: hand fixes recorded under the hero hand fixes
- `art/sheets/grids/hires-hero-<name>-<frame>.txt` — create per hand fix (gitignored)
- `plugins/promptfall/hooks/sprites/generated.ts` — regenerated

**Interfaces:**
- `ManifestEntry` gains `frames?: { windup: string; strike?: string; follow?: string }` (PNG paths
  under `art/`) and `frameRarityColors?: { windup: string; follow?: string }`.
- `types.ts`: `type SpriteFrame = { art: SpriteArt; raritySlot: number | null }`;
  `type SpriteFrames = { windup: SpriteFrame; strike: SpriteFrame; follow: SpriteFrame | null }`.
- `scripts/sprites.ts` exports `EFFECT_IDS = ['effect:fireball', 'effect:light_burst',
  'effect:arrow'] as const` and `expectedIds()` (appending `EFFECT_IDS`). Effects are `nes`, with
  `file` and `fileHires` like any sprite. The plugin-side count test imports nothing from
  `scripts/`: it adds the literal 3 with a comment naming `EFFECT_IDS`.
- The emitted `SPRITES` entries gain `frames`; a hero's `frames.strike.art` is the same object as
  its `hero_attack` sprite's `hires` (emit a reference to that `aN.hires`, not a second literal),
  with `raritySlot` that sprite's `raritySlotHires`.

**Work:** A frame PNG is processed as a `fileHires` is (`scripts/sprites.ts` 300 to 353: snap to
the hires master, at most 16 colours), then fitted to the entry's idle 1.5× art: shrunk by the
same fit if wider or taller than that art, then padded bottom-centred to exactly its width and
height (reading 7; for `nes` that is 24 × 24 as today). A breach is a build error naming the
sprite and the frame (`<id>: frames.windup …`). The build also prints, per frame, the native's
long side against the idle native's (`art/sheets/native/<kind>/<name>.png` beside
`<name>-<frame>.png`, when both exist) and lists under `frame size drift:` every frame off by
more than 20%: a report, not an error; those ids go to "Redos (frames)". A hero entry with
`frames` needs `frameRarityColors.windup` (and `.follow` when `frames.follow` is set), each found
in its PNG and one 8-connected region after the snap, as `rarityColorHires`. A hero may omit
`frames.strike` (the build takes `hero_attack`); a non-hero with `frames` must give `strike`. An
entry without `frames` emits `frames: null`. `hiresMasterPaths` is unchanged (reading 9).
Internal structure is your choice.

Then the real manifest: `frames: { windup: "sprites-frames/hero/knight-windup.png", follow:
"sprites-frames/hero/knight-follow.png" }` on the knight, `windup` on the other three,
`frameRarityColors` read from the cut PNGs (cape, robe, staff orb, cape: the areas `art/sheets.md`
names), and the three effect entries. A frame that fails the one-region rule gets a hand fix
through `pnpm grid`, kept as `art/sheets/grids/hires-hero-<name>-<frame>.txt` and written back by
the canonical cut (Task F10); record each in `art/sheets.md`.

**Acceptance check:** `pnpm vitest run scripts/sprites.test.ts`: an enemy with 24 × 24 `windup`
and `strike` builds `frames` with both; a 17-colour frame fails naming `frames.strike`; a `snes`
boss with a 60 × 40 idle and a 70 × 44 `strike` gets a 60 × 40 strike frame; a hero with
`windup` and no `strike` gets `hero_attack`'s hires art by identity; a hero frame whose rarity
colour lands in two regions fails; a non-hero with `windup` only fails; `expectedIds()` holds the
three effect ids; a frame native 30% larger than its idle native is listed under `frame size
drift:` and the build succeeds; the emitted module is byte-identical across two runs. Red before:
none of it exists. `pnpm sprites` builds the real manifest with 128 sprites, 0 placeholders,
`frames` on the four heroes; `claude plugin test` passes the count at 128. Full check line.

**Boundaries:** No change to the 1× or 1.5× rules for `file` and `fileHires`. No stage code.

- [ ] tests, red; implement; manifest; hand fixes; build; full check line; commit

### Task F4: contact strips and the review page for frames

**Files:**
- `scripts/contact.ts`, `scripts/contact.test.ts` — modify

**Interfaces:**
- Every contact folder (`--zone`, `--heroes`, `--world-bosses`) also writes, per actor with
  `frames`, `<kind>-<name>-frames.png`: idle A, idle B (`squash`), wind-up, strike, follow-through
  (when set), hit (`shear` with the lightened palette), left to right at 4× on the dark ground, a
  4-pixel gap between; and, once Task F6 is in, `stage-strike.png` (the 1.5× stage at 4× with the
  zone's front enemy 150 ms into its action: strike frame, lunge returning, the hero in its hit
  frame with the blink) and `stage-hit.png` (240 ms in: the hero's hit frame, blink over).
  `--heroes` adds `stage-bolt.png` (the black mage 220 ms into a bolt action: the fireball
  halfway) and `stage-burst.png` (the white mage 220 ms in).
- The review page (`.promptfall/tools/review.py`, gitignored) gets a "Frames" section per sheet:
  the sheet JPEG, the frame strips, the stage shots, the ids. Republish the review artifact
  (https://claude.ai/artifact/W5SVGYNdDG8ojecpbx9RNt) in place; "How to answer" says Kevin's
  GREEN is per sheet, on the frame strips, and asks for a REDO on any frame whose body does not
  sit on its idle's (reading 7).

**Work:** The strips need only F1 and F3; land them and publish the hero sheet now. The stage
shots need the model of Tasks F5 and F6: add them in F6's second commit. Internal structure is
your choice.

**Acceptance check:** `pnpm vitest run scripts/contact.test.ts`: `--heroes` writes
`hero-knight-frames.png` 6 cells wide (A, B, wind-up, strike, follow, hit) at 4×, and
`hero-archer-frames.png` 5 wide; a zone whose enemies have no `frames` writes no strips. The
artifact is republished. Full check line.

**Boundaries:** No plugin code.

- [ ] tests, red; implement; publish the hero sheet; full check line; commit; stage shots after F6

### Task F5: the choreography in the timeline

**Files:**
- `plugins/promptfall/hooks/stage/tuning.ts` — modify: `WINDUP_MS`, `FOLLOW_MS`, `BOLT_MS`,
  `BURST_MS`, `BLINK_MS`
- `plugins/promptfall/hooks/stage/timeline.ts` — modify
- `plugins/promptfall/hooks/stage/timeline.test.ts` — modify
- `plugins/promptfall/hooks/stage/model.ts`, `svg.ts` — modify only where an exhaustive switch
  over `Motion['kind']` needs a no-op branch for the new kinds (the behaviour lands in F6, F7)

**Interfaces:**
- `Motion` gains: `{ kind: 'windup', actor, from, until }`, `{ kind: 'strike', actor, from,
  until, shape: AttackShape }`, `{ kind: 'follow', actor, from, until }`, `{ kind: 'hit', actor,
  from, until }` and `{ kind: 'effect', actor, target, effect: EffectId, from, until, shape:
  'bolt' | 'burst' }`, with `type AttackShape = 'lunge' | 'lunge_follow' | 'bolt' | 'burst'` and
  `type EffectId = 'fireball' | 'light_burst' | 'arrow'`. `lunge` keeps its shape and plays only
  for the shapes `lunge` and `lunge_follow`. `flash` stays for the white overlay: `from` impact,
  `until` impact + `FLASH_MS` (the model shortens it at 1.5×, Task F6).
- `shapeOf(actor): AttackShape` on the timeline: enemies `lunge`; heroes by class: knight
  `lunge_follow`, black mage and archer `bolt`, white mage `burst`. The class comes from the view
  the timeline observes (`observe(view, now)` already walks the heroes).
- `ACTION_MS = max(LUNGE_MS + FOLLOW_MS, WINDUP_MS + BOLT_MS, LUNGE_MS / 2 + FLASH_MS)`.
  `WINDUP_MS === LUNGE_MS / 2` is asserted in the tuning test (or the timeline test).

**Work:** `onEffects` emits per action, from `start`, the motions of the table in "The
choreography": `windup` [0, 120); `strike` [120, 240) with the `lunge` [0, 240) for the lunge
shapes, `strike` [120, 320) for `bolt` and `burst`; `follow` [240, 360) for the knight; `effect`
[120, 320) for `bolt` (`fireball` for the black mage, `arrow` for the archer, one per hit target)
and `burst` (`light_burst`); `hit` at impact for `FLASH_MS` on each target, beside the `flash`
and the number; a heal by a white mage plays `windup`, `strike` and the burst on the healed ally
(no `hit`, no `flash`). Impact per shape: lunge and lunge_follow 120, burst 220, bolt 320. A hit
with no action (today's act-less groups) keeps impact at `LUNGE_MS / 2` and gains the `hit`
motion. Drops keep anchoring on the last hit's flash end. `isBusy` and `acting` see the new
motions.

**Acceptance check:** `claude plugin test plugins/promptfall` with the timeline tests: an enemy
attack at `start` yields `windup` [0,120), `strike` [120,240) shape `lunge`, a `lunge` [0,240),
`hit` and `flash` on the target [120,280), the number at 120; a black mage attack yields a
`strike` shape `bolt` [120,320), an `effect` fireball [120,320) and the hit at 320; an
`attack_all` by the black mage yields three fireballs; a knight yields a `follow` [240,360); a
white mage heal yields a burst `effect` on the ally and no `hit`; `ACTION_MS` is 360 and
"playback never drifts" still passes; every existing timeline test passes unchanged except where
it enumerates motion kinds. Red before: the motions do not exist. No golden moves (the scale-1
hashes are pinned by the Global constraints; the hires hashes do not change until F6 draws poses).
Full check line.

**Boundaries:** No model, compose or Svg behaviour change.

- [ ] tests, red; implement; full check line; commit

### Task F6: poses, derived frames and effects in the model, Image and Raster

**Files:**
- `plugins/promptfall/hooks/stage/model.ts` — modify
- `plugins/promptfall/hooks/stage/compose.ts` — modify: effects drawn after drops, before numbers
- `plugins/promptfall/hooks/stage/model.test.ts`, `compose.test.ts`, `loop.test.ts` — modify
- `plugins/promptfall/hooks/stage/scenarios.ts`, `golden.test.ts`, `goldens/*`,
  `scripts/stage-goldens.ts` — modify and regenerate
- `scripts/contact.ts`, `scripts/contact.test.ts` — modify: Task F4's stage shots (second commit)

**Interfaces:**
- `type Pose = 'idle' | 'idle_b' | 'windup' | 'strike' | 'follow' | 'hit'`.
  `type PoseArt = { art: SpriteArt; palette: readonly number[]; raritySlot: number | null; dx:
  number }`. `StageActor` gains `pose: Pose` and `poses: Record<Pose, PoseArt>`; its `x`, `y` are
  the idle art's position (the anchor: packing, numbers and drops measure from it and from the
  idle art's width, as today), and `art`, `palette`, `raritySlot` equal `poses[pose]`'s, kept for
  compose and the Raster. A pose draws at `x + poses[pose].dx`. `spriteId` is the idle sprite's id
  in every pose (reading 8). `StageModel` gains `effects: StageEffect[]`, with `type StageEffect
  = { spriteId: string; art: SpriteArt; x: number; y: number; flipX: boolean }`, `x`, `y` the
  art's top-left.
- `poses` at 1.5: `idle` → `hires`; `idle_b` → `squash(hires)`; `windup` → `frames?.windup.art ??
  hires`; `strike` → `frames?.strike.art ?? (hero ? hero_attack.hires : hires)`; `follow` →
  `frames?.follow.art ?? the strike art`; `hit` → `shear(hires).art` with `dx = flipX ? 0 :
  -grow` (the flip mirrors the growth to the far side) and the palette lightened after the rarity
  substitution. Every other `dx` is 0. At 1: `idle`, `idle_b`, `hit` → `full`; `windup`,
  `strike`, `follow` → `hero_attack.full` for a hero, `full` otherwise (reading 5: one drawing
  through the lunge). On the compact stage the same mapping over `compact` art (`variant(sprite,
  compact, scale)` as today; `hero_attack.compact` for the strike), never `full`. The rarity slot
  is the frame's at 1.5, the sprite's otherwise. The `hit` palette at 1 is not lightened (1×
  draws as today).
- `y` keeps today's bob at 1 and compact whatever the pose; at 1.5 there is no bob and `idle_b`
  is the squashed art at the same `y`.
- `flashing` is true inside the `flash` motion at 1 and compact, and inside its first
  `BLINK_MS` at 1.5.
- An effect's position at `now`: the sprite's `opaqueBox` centre is what moves: for `bolt`,
  linearly from the attacker's front edge at the attacker's vertical middle to the target's
  centre over the motion; for `burst`, the target's centre. `flipX` is the attacker's. Art by
  `variant(sprite, compact, scale)`. Effects never bob.

**Work:** `pose` comes from the motions at `now`: `hit` wins, then `follow`, `strike`, `windup`,
then `idle_b` when `motion === 'full'` and `bobbingAt(now)` is 1, else `idle`. Fallen heroes are
`idle`. `poses` is filled for every actor every frame (the derived arts are memoised, so this is
lookups). The Svg at 1.5 still adds the bob translate until F7; its hires goldens are regenerated
here and again in F7, said in both commits. Internal structure is your choice.

**Acceptance check:** `claude plugin test plugins/promptfall`: at 1.5, 60 ms into a knight's
action its pose is `windup` with `frames.windup.art` and the lunge offset, at 180 ms `strike`
with `hero_attack.hires` by identity, at 300 ms `follow`; the enemy it hits is `hit` at 150 ms
with `shear` art, `dx = -grow`, `x` unchanged from its idle, a lightened palette, `flashing` true
at 150 and false at 230; a hero hit by an enemy at 150 ms has `dx = 0` and `x` unchanged; at 1
the same instants give `hero_attack.full` through 60 and 180, `full` at 300, `flashing` true at
230; at rest `now = 1_000_700` gives `idle_b` with `squash(hires)` at 1.5 and `full` raised one
pixel at 1, and `idle` under `still`; a black mage action at 220 ms has a `fireball` effect whose
`opaqueBox` centre is halfway between its front edge and the target's centre, `flipX` true; the
compact stage draws every pose and effect from `compact` art and its frame stays 52 × 8. New
scenarios `windup` (a knight at 60 ms), `strike` (a knight at 180 ms, the enemy hit), `follow`
(300 ms), `bolt` (the black mage at 220 ms), `burst` (the white mage at 220 ms) in `SCENARIOS`,
with all seven golden fields; every scenario within budgets; the committed scale-1 hashes
unchanged. Red before: no `pose`, no `effects`. Full check line.

**Boundaries:** No Svg change beyond compiling (Task F7). The band call sites keep compiling
unchanged.

- [ ] tests, red; implement; scenarios and goldens; full check line; commit; then Task F4's
  stage shots (second commit)

### Task F7: the frames in the Svg

**Files:**
- `plugins/promptfall/hooks/stage/svg.ts` — modify
- `plugins/promptfall/hooks/sprites/derive.ts` — modify only to export a row helper the clips
  need (the squash's `m`, the shear's per-row shifts), pure as the rest
- `plugins/promptfall/hooks/stage/svg.test.ts`, `golden.test.ts`, `goldens/*` — modify and
  regenerate

**Interfaces:**
- `renderSvg(model, motions, opts)` keeps its signature. Under SMIL, an actor's group holds one
  `<use>` per frame in use: the frames of its `windup`/`strike`/`follow`/`hit` motions that are
  live at `now` or start before `now + SVG_FALLBACK_FRAME_MS` (reading 10) and, at 1.5 with
  `motion: 'full'`, idle A and idle B; discrete-timed `visibility` (or opacity with
  `calcMode="discrete"`) relative to `now` shows exactly one at any instant, the idle pair on the
  bob's 1 s clock (B in the second half, `begin = -(now % 1000)`) and hidden for the span of any
  pose motion, replacing the bob's translate at 1.5 (the scale-1 Svg keeps the bob). Without
  SMIL, the pose's art at `now` only. The actor's `poses` supply every art.
- Idle B is not a def: two `<use href="#aN">` of idle A's def, the rows above the dropped row
  under a `<clipPath>` translated `(0 1)`, the rows below under another. The hit frame is not a
  def either: `k + 1` `<use>` of idle A's def, one per distinct row shift, each under a row clip
  and translated by its shift, inside a `<g filter="url(#hit)">` whose filter is one
  `<feComponentTransfer>` with `<feFuncR type="gamma" exponent="0.6">` (and G, B), which is
  `lighten` applied to every fill including `currentColor`; `dx` is applied as a translate. Clip
  paths are deduplicated per art like the defs. The drawn frames are defs of their arts.
- Effects: a `<use>` per effect; a `bolt` carries an `animateTransform` translate from its start
  to its end over the motion, a `burst` an opacity hold.
- The flash overlay at 1.5 animates opacity `1;0` over `BLINK_MS`.

**Work:** `svgWithFallback` and `stageSvg` are unchanged. The adversarial fixtures in
`golden.test.ts` fill `poses` with checker arts. Internal structure is your choice.

**Acceptance check:** `claude plugin test plugins/promptfall`: the `rest` scenario's Svg at 1.5
holds one def per distinct art, two `<clipPath>` per distinct art and no `-bobPx` translate; the
`windup` scenario (60 ms) holds the knight's wind-up, strike and follow defs and the enemy's hit
clips, each `<use>` with a discrete visibility animation; the `strike` scenario (180 ms) holds no
wind-up def; a scenario built at `now` with the second action's motions starting 300 ms later
holds none of that action's defs; the `bolt` scenario holds a fireball `<use>` with a translate
from the mage's front to the target's centre; the flat Svg (SMIL off) holds only the pose's art
per actor. Budget: create the fuller legal frame of ADR 0006 as a committed fixture (a 72 × 51
boss and four 24 × 24 enemies dithered with index `(x + 3 * y) % 16 + 1`, two enemies
dissolving, three 24 × 24 checker heroes with distinct palettes, a drop; its length at rest is
recorded in the test's name) and assert that at rest with the idle pair `svgWithFallback` returns
the 1.5× Svg; the same frame with the boss 60 ms into a `lunge` action (wind-up and strike as
dithered frames) and a hero `hit` is a measurement: record its length and which Svg
`svgWithFallback` returned, in the test's name and in the ADR of Task F10. Every scenario within
budgets. Regenerate the goldens and say which `svgHash` moved. Full check line.

**Boundaries:** No Image or Raster change. No model change.

- [ ] tests, red; implement; goldens; full check line; commit

### Task F8: the monster sheets

**Files:**
- `art/sheets.md` — modify: six `## frames-monsters-<n>.png` sections
- `art/sprites-frames/enemy/*.png` — create (96), `art/manifest.json` — modify (48 entries),
  `generated.ts` — regenerated
- `scripts/sprites.test.ts` — modify (after sheet 6): the real-manifest test
- `plugins/promptfall/hooks/stage/scenarios.ts`, `goldens/*` — modify and regenerate: after
  sheet 1 a scenario `enemy-strike` (the wave fixture's goblin scout 150 ms into its action, the
  hero hit); after every sheet `pnpm stage:goldens`
- `.promptfall/contact/*`, the review artifact — republished per sheet

**Work:** Six runs, `pf3-frames-monsters-1` to `-6`, eight `nes` enemies each in manifest order
(the 48 `enemy` entries with style `nes`; sheet 1 is zone 1, the fixtures' actors). Per sheet:
`pnpm refsheet` the eight (`--columns 8 --cell 192x256 --scale 7`), assemble the prompt, write
it into `art/sheets.md`, run, cut both rows with `--grid 8x4 --colours 4 --size 16 --native
art/sheets/native --hires art/sprites-frames`, out dir `/tmp/promptfall-frame-cuts`, `--names
enemy/<name>-windup,…` for row 0 and `enemy/<name>-strike,…` for row 1 (rows 2 and 3 are the
second take: cut them to `x/` names and keep a take by eye where the first fails), manifest
`frames`, `pnpm sprites` (read its `frame size drift:` list into "Redos (frames)"), goldens,
contact, republish, commit. Two runs in flight at most. A hires golden that moves after a sheet
is the frames landing: say so in the commit; a scale-1 hash that moves is a defect.

The monster sheet body (`<ids>` is the eight names, in column order):

```text
Generate one landscape 1536x1024 sprite sheet: a strict grid of 8 columns x 4 rows, 32 small sprites, one per cell, every cell the same size (192 x 256 screen pixels). The attached reference sheet shows 8 creatures in one row, one per column, standing idle: <ids>.
Draw the SAME 8 creatures in the SAME columns, exactly the same design, size, colours and pixel size as in the reference, in new poses.
Row 1: each creature winding up to attack (coiled back, weapon, claws or jaws raised, weight on the back foot).
Row 2: each creature at the moment of its strike (lunging forward, weapon, claws or jaws swung forward).
Rows 3 and 4: a second, different take of rows 1 and 2.
Creatures face right.
```

**Acceptance check:** after each sheet `pnpm sprites` builds with 0 placeholders and the eight
entries carry `frames`; after sheet 1 the `enemy-strike` scenario exists with its goldens; after
the sixth, a test in `scripts/sprites.test.ts` reads the real manifest and asserts every `enemy`
entry of style `nes` has `frames.windup` and `frames.strike`. Report `generated.ts`'s size in the
last commit. Full check line per sheet.

**Boundaries:** No change to shipped 1× or 1.5× art. No plugin code beyond the scenario and
the goldens.

- [ ] sheets 1 and 2; 3 and 4; 5 and 6 (each: composite, prompt, run, cut, manifest, build,
  goldens, contact, publish, full check line, commit)

### Task F9: the boss sheets

**Files:**
- `art/sheets.md` — modify: fourteen `## frames-bosses-<n>.png` sections
- `art/sprites-frames/enemy/*.png` (48), `art/sprites-frames/world_boss/*.png` (8) — create;
  `art/manifest.json` — modify (28 entries); `generated.ts` — regenerated
- `scripts/sprites.test.ts` — modify (after sheet 14): the real-manifest test
- `plugins/promptfall/hooks/stage/scenarios.ts`, `golden.test.ts`, `goldens/*` — modify and
  regenerate: after sheet 1 a scenario `boss-strike` (the boss fixture's bandit captain 60 ms into
  its action) whose 1.5× SMIL Svg length the golden test records against the cap, and a note of
  it in the ADR (Task F10); after every sheet `pnpm stage:goldens`
- `.promptfall/contact/*`, the review artifact — republished per sheet

**Work:** Fourteen runs, `pf3-frames-bosses-1` to `-14`, two `snes` bosses each in manifest
order (the 24 `snes` enemies, then the four world bosses; sheet 1 holds the bandit captain). Per
sheet as Task F8, with `pnpm refsheet … --columns 2 --cell 768x512 --scale 7` and the cut
`--grid 2x2 --colours 16 --fit 48x34 --native art/sheets/native --hires art/sprites-frames`,
row 0 `--names enemy/<a>-windup,enemy/<b>-windup`, row 1 the strikes (world bosses as
`world_boss/<name>-…`). Turn bosses keep their manifest `fit`; the build fits their frames to
their idle's canvas. The 5-hour window ends this task early about twice: stop at 85%, commit,
report the reset time and the next sheet's number, and resume from it.

The boss sheet body (`<a>`, `<b>` the two names):

```text
Generate one landscape 1536x1024 sprite sheet: a strict grid of 2 columns x 2 rows, 4 large sprites, one per cell, every cell the same size (768 x 512 screen pixels). The attached reference sheet shows 2 creatures in one row: <a> on the left, <b> on the right, standing idle.
Draw the SAME 2 creatures in the SAME columns, exactly the same design, size, colours and pixel size as in the reference, in new poses.
Row 1: each creature winding up to attack (reared back, weapon, claws, jaws or magic raised, weight on the back legs).
Row 2: each creature at the moment of its strike (thrown forward, weapon, claws, jaws or magic driven forward).
Creatures face right.
```

**Acceptance check:** per sheet as Task F8; after sheet 1 the `boss-strike` scenario's 1.5×
SMIL Svg is under `SVG_MAX_CHARS` and its length is in the commit; after the fourteenth, the
manifest test asserts every `snes` entry has `frames.windup` and `frames.strike`, so every actor
but the heroes has both and every hero has `windup`. Full check line per sheet.

**Boundaries:** As Task F8.

- [ ] sheets 1 to 14, two at a time, each committed; the 85% stops recorded in `art/sheets.md`

### Task F10: redos, the canonical cut and the docs

**Files:**
- `art/sheets.md` — modify: "Redos (frames)" resolved (a `frames-redos-<n>.png` sheet per eight,
  the monster body with `<ids>` the redo names, or the boss body for two bosses), and the
  canonical cut gains every frame cut line, the effect lines, the hero frame grid write-backs and
  `rm -rf art/sprites-frames/x /tmp/promptfall-frame-cuts`
- `plugins/promptfall/README.md` — modify: the Sprites section (frames, `art/sprites-frames/`,
  `frames` and `frameRarityColors` in the manifest, the `effect` kind, `pnpm refsheet`, the
  frame size drift report); the stage section (the choreography table, the poses, the derived
  frames, the Svg's clips and frame defs, `still`)
- `CONTEXT.md` — modify: **Frame** (one drawing of a sprite's animation: idle A, idle B,
  wind-up, strike, follow-through, hit; avoid: cel, pose for the frames) and **Effect sprite**
  (the fireball, light burst or arrow the stage moves during a hero's action; avoid: projectile,
  particle, VFX; the sim's `Effect` is unrelated); the **Sprite** entry notes frames are 1.5× art
- `docs/adr/0007-drawn-and-derived-frames.md` — create: why two frames are drawn and two derived
  (readings 2 and 10, the counts), why frames sit on the idle's canvas (reading 7), why frames
  are 1.5× only (Q21: half-block terminals show one pixel a column, the compact stage has no
  room), that the effects are ordinary sprites at both densities, and the Svg headroom numbers
  from Tasks F7 and F9
- `docs/manual-pass/phase-4.md` — modify: a Part C: on Ghostty and the desktop the party
  breathes (two frames, no bob), an enemy winds up on the way out and strikes from the apex, the
  knight follows through, the black mage's fireball and the archer's arrow cross the stage, the
  white mage's light bursts on its target, a struck actor leans back and blinks (on Ghostty the
  lean is a two-frame event; look for it on a boss); on iTerm2 nothing changes but the mages,
  which now cast in place while their effect flies; `/promptfall motion still` freezes the idle;
  the desktop's idle pair is the first thing to look for (the clip on `<use>` is untested live)

**Acceptance check:** the redo sheets' sprites build; every flag, path and term the docs name
exists (`grep` each); `.promptfall/tools/recut.sh` runs the canonical cut end to end and
`git diff --exit-code art/sprites art/sprites-hires art/sprites-frames` is clean after it. Full
check line.

**Boundaries:** No plugin code beyond what a redo's build regenerates.

- [ ] redos; canonical cut; README; CONTEXT; ADR; manual pass; full check line; commit

### Task F11: the PR

**Files:** none new.

**Work:** Push, open the PR into `ai-staging` with the choreography table, the run count and
window stops, `generated.ts`'s size, the Svg headroom numbers from Tasks F7 and F9, and the manual
rundown for Part C. Say which parts were verified by tests, which by the review artifact, and
that the desktop leg needs a Claude.app relaunch. Stop there: the review is Kevin's to trigger.

- [ ] push; PR; rundown; stop

## Self-review

- Grill coverage: Q17 (the hero sheet first, the build with its PNGs in hand), Q18 (every actor:
  F2 and F3 heroes, F8 monsters, F9 bosses; the hero strike is `hero_attack`: reading 8, F3),
  Q19 (idle pair: F6, F7; wind-up and strike during the lunge: reading 1, F5, F6; hit for the
  flash's duration with the blink: F5, F6, F7; dissolve and drop unchanged: F5; `still`: F6, F7),
  Q20 (shapes per class: F5; the effect sprites: F2, F3, F5, F6, F7), Q21 (1.5× only: Global
  constraints, F3; 1× one drawing and code motion: reading 5, F6; effects at 1×: F2, F6), Q22
  (frames in use per redraw, fall-back: reading 10, F7), Q23 (references: reading 6, F2's
  composite; derived frames: F1; about 21 runs: F2, F8, F9).
- Names across tasks: `squash`/`shear`/`lighten`/`opaqueBox` (F1) used by F4, F6, F7;
  `SpriteFrames`, `frames`, `EFFECT_IDS` (F3) used by F6, F8, F9; the `Motion` kinds,
  `AttackShape`, `EffectId` (F5) used by F6, F7; `Pose`, `PoseArt`, `poses`, `StageEffect`,
  `effects` (F6) used by F7, F4; the tuning names (reading 3) used by F5, F6, F7.
- Plan review (2026-10-07; `reviewer` on opus, `reviewer` on fable, `codex-review` on astra, one
  fix pass): `ACTION_MS` 560 broke the no-drift invariant and the 500 ms action floor (now
  reading 1: the wind-up inside the lunge, `ACTION_MS` 360, 1× byte-identical); the compact stage
  drawing `full` (now `compact` for every pose and effect); the Svg unable to reach the arts of
  poses other than `now`'s (now `poses` on the actor, and `spriteId` fixed to the idle); actors
  placed from the drawn art's width (now frames on the idle's canvas, `x` the anchor, `dx` for the
  hit); Files lists missing the count test, the goldens and the real-manifest tests (added to F3,
  F5, F8, F9); enemy frames tested before they exist (F6 and F7 use a knight; `enemy-strike` and
  `boss-strike` scenarios land with their sheets); the hero sheet's grid geometry and reference
  columns (8 × 4, the composite in the sheet's column order); expired wind-up defs required
  mid-strike (now `now` inside the wind-up, and the next-redraw window); the blink shorter than
  an event frame (100 ms); `lighten(0x808080)` (`0xa9a9a9`); the shear check in canvas
  coordinates; the flipped target's anchor; the stage shots timed past their motions; effects
  positioned by canvas instead of opaque box; the hit def's cost on a boss (now clips and a gamma
  filter); `attack_all` and act-less hits (reading 11); the recut check and `rm` without
  `art/sprites-frames`; the attachments per sheet kind; the run budget (25).
- Risks named: `generated.ts` grows by about 350 KB (F8, F9 report); the 5-hour window (F9); the
  frame size drift (F3 reports, the review asks); the one-region rule on five hero frames (F3
  budgets hand fixes); the clip on `<use>` under the desktop renderer (manual pass Part C looks
  first).
