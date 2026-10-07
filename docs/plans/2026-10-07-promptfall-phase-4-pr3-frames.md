# Promptfall phase 4 PR 3: the animation frames, implementation plan

**Goal:** Every actor on the 1.5× stage breathes on a two-frame idle loop, winds up and strikes
on its own drawn frames, and shows a hit frame when struck; each hero class attacks differently,
three of them with an effect sprite that crosses the stage.
**Architecture:** Two of the four new frames per actor are drawn by gpt-image-2 against the
shipped 1.5× art (wind-up, strike) and land through the slicer and the build as 1.5×-only art on
the `Sprite`; the other two (idle B, hit) are fixed transforms of the idle art, computed in the
plugin at draw time. The timeline grows from one `lunge` per action into a choreography (wind-up,
strike, follow-through, bolt or burst, hit), the model exposes a pose per actor and a list of
effect sprites, and each renderer draws the pose's art at its scale: the 1.5× surfaces the frames,
the 1× surfaces one drawing and code motion, as today.
**Spec:** `docs/plans/2026-10-07-phase-4-pr2-hires-grill.md`, round 3 (Q17 to Q23), read at
1.5× per round 4; on top of `docs/adr/0006-two-art-densities.md`.
**Execution model:** opus

## Readings

Round 3 was answered when the art was 2×; round 4 made it 1.5× and said rounds 1 and 2 hold
with 1.5 for 2. This plan applies the same to round 3: "2× only" (Q21, Q22) reads as 1.5× only.
Where the grill left a value open, the plan fixes one; Kevin's approval of the plan is the approval
of these, and a review finding against one of them is a finding against the plan, not the grill.

1. Idle B and hit are not committed PNGs. They are pure functions of the idle art, in the plugin,
   memoised per art (Q23 says "derived from frame 1 by fixed transforms"; 160 extra PNGs for a
   one-row squash would be art to keep in step for nothing). The transforms are pinned in Task F1.
2. The timings, in ms, all in `stage/tuning.ts`: `WINDUP_MS` 160, `LUNGE_MS` 240 (unchanged),
   `FOLLOW_MS` 120, `BOLT_MS` 240, `BURST_MS` 240, `FLASH_MS` 160 (unchanged: the hit frame's
   duration, and the 1× flash), `BLINK_MS` 80 (the white at 1.5×: one event frame).
3. The white mage's heal plays its burst on the healed ally, with the same wind-up and strike
   pose; a white mage that only heals would otherwise never show Q20's attack.
4. The 1× surfaces share the timeline, so the lunge there starts `WINDUP_MS` after the action
   does (the actor stands in its idle art meanwhile), and the flash there stays `FLASH_MS`; there
   is no hit frame to shrink it for. The effect sprites draw at 1× (Q21).
5. A sheet's reference is one composite image of the batch's shipped 1.5× art, laid out in the
   sheet's columns (Task F2), not one `-i=` per native: the model then reads "column 3 of the
   reference" as "column 3 of the sheet".
6. The hero strike frame at 1.5× is the `hero_attack` sprite's 1.5× art (Q18); the build emits a
   reference to the same object, so the Svg's identity dedupe holds.
7. The frames do not feed `art/palettes/hires.json`; they snap to the master as it is. A
   re-derive would move every shipped sprite's snap for no gain.
8. In the Svg, idle B is drawn from idle A's def through a clip (two `<use>`, one translated a
   pixel down), so the idle loop costs about 200 characters per actor, not a second def. The
   drawn frames and the hit frame are defs of their own while their motion runs (Q22).

## Global constraints

- Branch `phase-4-pr3-frames` from `ai-staging`, one PR into `ai-staging`.
- Full check line, before each task's final commit:
  `pnpm lint && pnpm typecheck && pnpm test && pnpm vendor:check && pnpm sprites:check && pnpm font:check && pnpm exec tsc -p plugins/promptfall && claude plugin validate plugins/promptfall && claude plugin test plugins/promptfall`.
  The sim balance test can time out at 5 s under load: rerun it or add `--testTimeout 30000`; a
  timeout alone is not a failure, an assertion is. `.promptfall/tools/check.sh <log>` runs the
  line into a log.
- No `any`.
- Nothing in cells changes: the band's rows and columns, the compact stage, the list windows.
- Frames are 1.5× art only: `nes` 24 × 24 padded bottom-centred, `snes` at most 72 × 51, turn
  bosses fit to 36 rows, 16 colours snapped to `art/palettes/hires.json`, fit only shrinks. The
  three effect sprites are ordinary `nes` sprites with 1× and 1.5× art, kind `effect`.
- The 1× art, the 1× stage, the compact stage, the Raster path and the list windows draw as
  today, apart from reading 4 above. Every committed scale-1 golden hash that changes must be
  explained in its commit by a timing change, never by a pixel change at rest.
- The Svg cap is the engine's `SVG_MAX_CHARS` 131,072; `svgWithFallback` keeps the fall-back.
- Image runs follow the art plan's "Codex image runs" rules verbatim
  (`docs/plans/2026-10-07-promptfall-phase-4-pr2-art.md`, lines 44 to 66): `codex-run.sh` with
  labels `pf3-…`, `run_in_background: true`, Bash timeout 600000, no polling, two runs at a time at
  most, `file <out>` then `codex-usage.sh` after each, no run above 85% of the 5-hour window, a
  limit hit stops everything and reports the reset time. About 21 runs at 5% each: the boss sheets
  span two 5-hour windows. Each sheet is cut, built and committed before the next starts, so a
  stop loses nothing.
- Review never blocks: a sheet task publishes and continues. Redo ids collect in `art/sheets.md`
  under "Redos (frames)".

## The choreography

One action by attacker A on target T, starting at `start` (today's `start`), in ms from it. At
1.5× the actor draws the frame named; at 1× it draws its one drawing, and `hero_attack` where
"strike" is named for a hero, as today.

| Shape | Who | Frames and motion |
| --- | --- | --- |
| `lunge` | every enemy | 0–160 wind-up in place; 160–400 strike with the lunge (`LUNGE_PX`, out and back); impact at 280 |
| `lunge_follow` | knight | as `lunge`, then 400–520 follow-through in place |
| `bolt` | black mage (fireball), archer (arrow) | 0–160 wind-up; 160–400 strike in place while the effect flies from A's front edge, at A's vertical middle, to T's centre; impact at 400 |
| `burst` | white mage (attack and heal) | 0–160 wind-up; 160–400 strike in place while the light burst sits on T's centre; impact at 280 (the number and the hit as for a lunge) |

At impact T shows `hit` for `FLASH_MS` and, at 1.5×, the white overlay for `BLINK_MS`; at 1× the
white overlay for `FLASH_MS` as today. The number rises from impact as today. `ACTION_MS` becomes
`WINDUP_MS + BOLT_MS + FLASH_MS` (560): the longest shape to its hit's end. Dissolve, spawn and
drop are unchanged and keep their anchors (the last flash's end).

Idle: at 1.5× the actor alternates idle A and idle B on the bob's clock (`bobbingAt`: B during
the second 500 ms of each second), with no vertical bob; at 1× the 1-pixel bob as today. Under
`motion: 'still'` the idle is A and does not move; every other motion plays, as today. Fallen
heroes show idle A and never take a hit frame.

## Tasks

### Task F1: the derived frames

**Files:**
- `plugins/promptfall/hooks/sprites/derive.ts` — create: `squash`, `shear`, `lighten`
- `plugins/promptfall/hooks/sprites/derive.test.ts` — create

**Interfaces:**
- Produces: `squash(art: SpriteArt): SpriteArt` (idle B), `shear(art: SpriteArt): { art:
  SpriteArt; grow: number }` (the hit silhouette), `lighten(rgb: number): number` (the hit
  palette). `squash` and `shear` are memoised per input `SpriteArt` in a `WeakMap`, so two calls
  return the same object (the Svg dedupes defs by identity).

**Work:** Pixels are base64 row-major palette indices, index 0 transparent (`SpriteArt` in
`sprites/types.ts`); decode as `stage/compose.ts` does. Let `r0..r1` be the first and last rows
holding an opaque pixel, `H = r1 - r0 + 1`.
- `squash`: if `H < 3`, return the input. Else `m = r0 + floor(H / 2)`; rows `r0..m-1` move down
  one row, row `m` is dropped, rows below `m` stay; row `r0` ends transparent. Same width, height
  and palette.
- `shear`: `k = max(1, round(H / 12))`. The output is `k` wider, the extra columns on the left;
  row `y` in `r0..r1` is copied to `x + k - round(k * (r1 - y) / (r1 - r0))` (the top row moves
  `k` to the left of the body, the bottom row not at all: a lean back from the facing side, which
  is right). `H < 2` returns `{ art, grow: 0 }`. Same height and palette; `grow = k`.
- `lighten`: per channel `round(255 * (v / 255) ** 0.6)`; black stays black, white stays white.
  The caller lightens palettes; the rarity colour is substituted before it (Task F6).

**Acceptance check:** `claude plugin test plugins/promptfall` with `derive.test.ts`: a 24 × 24
art with a 10-row figure squashes to 9 rows with the top row moved down one and the figure's
middle row gone, the bottom row unchanged; a 2-row figure is returned as is; a 24-row figure
shears with `grow` 2, its top row shifted 2 and its bottom row 0, width 26; `lighten(0)` is 0,
`lighten(0xffffff)` is `0xffffff`, `lighten(0x808080)` is `0xa8a8a8`; `squash(a) === squash(a)`.
Red before: the module does not exist. Full check line.

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
- `pnpm refsheet <out.png> --columns <n> --cell <w>x<h> --scale <k> <kind/name>,…`: a magenta
  (`#FF00FF`) PNG `n` cells wide and one cell tall, each listed sprite's `art/sprites-hires/<kind>/
  <name>.png` scaled `k` times nearest-neighbour and bottom-centred in its cell, 24 screen pixels
  above the cell's floor. Monster sheets: `--columns 8 --cell 192x256 --scale 7`; boss sheets:
  `--columns 2 --cell 768x512 --scale 7`; the hero sheet: `--columns 8 --cell 192x256 --scale 7`
  with the eight hero poses in manifest order (knight, knight attack, black mage, …).

**Work:** `frames-common.txt` is `common.txt` with its STYLE heading's "but these are NEW designs,
not copies of the reference figures" replaced by "these are the SAME figures as the attached
reference, in new poses: same design, same size, same colours, same pixel size". The prompt is
assembled as the art plan says (`bg.txt`, the body, `frames-common.txt`, the image_gen line),
written into `art/sheets.md` before the run, with the reference composite attached first and the
dense sheet `art/sheets/dense-heroes-zone1-items.png` second.

The hero sheet body (one run, `pf3-frames-heroes`, output `art/sheets/frames-heroes.png`):

```text
Generate one landscape 1536x1024 sprite sheet: a strict grid of 8 columns x 2 rows, 16 small sprites, one per cell, every cell the same size (192 x 256 screen pixels). The attached reference sheet shows, left to right: the knight idle, the knight attacking, the black mage idle, the black mage casting, the white mage idle, the white mage casting, the archer idle, the archer shooting.
Row 1, in this order: the knight winding up (sword raised high behind the head, weight back); the knight's follow-through (sword swung down past the front foot, cape flying); the black mage gathering fire (staff raised, a small flame at its tip, robe billowing); the white mage raising the staff overhead with both hands; the archer drawing the bow (string pulled to the cheek, arrow nocked); a fireball (a round orange and yellow ball of fire with a short trailing flame, flying right); a burst of holy light (a white and gold eight-rayed star, no figure); a wooden arrow with a steel head and feather fletching, flying right, drawn horizontally.
Row 2: a second, different take of the same eight.
The five hero sprites keep the exact designs of the reference (same armour, hats, capes, colours), only in these poses. Characters face right.
```

Cut: `pnpm slice art/sheets/frames-heroes.png /tmp/promptfall-frame-cuts --grid 8x2 --colours 4
--size 16 --native art/sheets/native --hires art/sprites-frames --row <r> --names
hero/knight-windup,hero/knight-follow,hero/black_mage-windup,hero/white_mage-windup,hero/archer-windup,x/a,x/b,x/c`
for the chosen row, then the effects from the same row with `--hires art/sprites-hires` and the
out dir `art/sprites`: `--names x/d,x/e,x/f,x/g,x/h,effect/fireball,effect/light_burst,effect/arrow`.
Remove the `x/` scratch kinds. Pick the row per sprite by eye from the sheet (a contact needs
the build: Task F4 publishes it; the pick is recorded in `art/sheets.md`).

**Acceptance check:** `pnpm vitest run scripts/ref-sheet.test.ts`: two 24 × 24 sprites with
`--columns 2 --cell 192x256 --scale 7` give a 384 × 256 magenta PNG with each sprite 168 wide,
bottom-centred, its lowest opaque row at `y = 231`. Red before: the script does not exist.
`file art/sheets/frames-heroes.png` is PNG; the five frame PNGs are 24 × 24 and the three effect
pairs 16 × 16 and 24 × 24 (`sips -g pixelWidth -g pixelHeight`). The manifest and the build are
untouched, so `pnpm sprites:check` still passes. Full check line.

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
- `art/manifest.json` — modify: `frames` on the four hero entries, three effect entries
- `art/sheets.md` — modify: hand fixes recorded under the hero hand fixes
- `art/sheets/grids/hires-hero-<name>-<frame>.txt` — create per hand fix (gitignored)
- `plugins/promptfall/hooks/sprites/generated.ts` — regenerated

**Interfaces:**
- `ManifestEntry` gains `frames?: { windup: string; strike?: string; follow?: string }` (PNG paths
  under `art/`) and `frameRarityColors?: { windup: string; follow?: string }`.
- `types.ts`: `type SpriteFrame = { art: SpriteArt; raritySlot: number | null }`;
  `type SpriteFrames = { windup: SpriteFrame; strike: SpriteFrame; follow: SpriteFrame | null }`.
- `EFFECT_IDS = ['effect:fireball', 'effect:light_burst', 'effect:arrow']` in `scripts/sprites.ts`,
  appended by `expectedIds()`. Effects are `nes`, with `file` and `fileHires` like any sprite.
- The emitted `SPRITES` entries gain `frames`; a hero's `frames.strike.art` is the same object as
  its `hero_attack` sprite's `hires` (emit a reference into `ART`, not a second literal), with
  `raritySlot` that sprite's `raritySlotHires`.

**Work:** A frame PNG is processed as a `fileHires` is (`scripts/sprites.ts` 300 to 353): snap to
the hires master, at most 16 colours, the 1.5× canvas of the entry's style and fit, shrink only,
`nes` padded to 24 × 24; a breach is a build error naming the sprite and the frame
(`<id>: frames.windup …`). A hero entry with `frames` needs `frameRarityColors.windup` (and
`.follow` when `frames.follow` is set), each found in its PNG and one 8-connected region after the
snap, as `rarityColorHires`. A hero may omit `frames.strike` (the build takes `hero_attack`); a
non-hero with `frames` must give `strike`. An entry without `frames` emits `frames: null`.
`hiresMasterPaths` is unchanged (reading 7). Internal structure is your choice.

Then the real manifest: `frames: { windup: "sprites-frames/hero/knight-windup.png", follow:
"sprites-frames/hero/knight-follow.png" }` on the knight, `windup` on the other three,
`frameRarityColors` read from the cut PNGs (cape, robe, staff orb, cape: the areas `art/sheets.md`
names), and the three effect entries. A frame that fails the one-region rule gets a hand fix
through `pnpm grid`, kept as `art/sheets/grids/hires-hero-<name>-<frame>.txt` and written back by
the canonical cut (Task F10); record each in `art/sheets.md`.

**Acceptance check:** `pnpm vitest run scripts/sprites.test.ts`: an enemy with 24 × 24 `windup`
and `strike` builds `frames` with both; a 17-colour frame fails naming `frames.strike`; a hero
with `windup` and no `strike` gets `hero_attack`'s hires art by identity; a hero frame whose
rarity colour lands in two regions fails; a non-hero with `windup` only fails; `expectedIds` holds
the three effect ids; the emitted module is byte-identical across two runs. Red before: none of it
exists. `pnpm sprites` builds the real manifest with 128 sprites, 0 placeholders, `frames` on the
four heroes. Full check line.

**Boundaries:** No change to the 1× or 1.5× rules for `file` and `fileHires`. No stage code.

- [ ] tests, red; implement; manifest; hand fixes; build; full check line; commit

### Task F4: contact strips and the review page for frames

**Files:**
- `scripts/contact.ts`, `scripts/contact.test.ts` — modify

**Interfaces:**
- Every contact folder (`--zone`, `--heroes`, `--world-bosses`) also writes, per actor with
  `frames`, `<kind>-<name>-frames.png`: idle A, idle B (`squash`), wind-up, strike, follow-through
  (when set), hit (`shear` with the lightened palette), left to right at 4× on the dark ground, a
  4-pixel gap between; and for the zone's front enemy `stage-strike.png` (the 1.5× stage at 4× at
  280 ms into its lunge) and `stage-hit.png` (160 ms after impact, the hero's hit frame and blink).
  `--heroes` adds `stage-bolt.png` (the fireball mid-flight) and `stage-burst.png`.
- The review page (`.promptfall/tools/review.py`, gitignored) gets a "Frames" section per sheet:
  the sheet JPEG, the frame strips, the stage shots, the ids. Republish the review artifact
  (https://claude.ai/artifact/W5SVGYNdDG8ojecpbx9RNt) in place; "How to answer" says Kevin's
  GREEN is per sheet, on the frame strips.

**Work:** The stage shots need the model of Tasks F5 and F6 for the poses. Land this task's
strips first (they only need F1 and F3) and add the stage shots after F6; the review for the hero
sheet goes out with the strips. Internal structure is your choice.

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

**Interfaces:**
- `Motion` gains: `{ kind: 'windup', actor, from, until }`, `{ kind: 'strike', actor, from,
  until, shape: AttackShape }`, `{ kind: 'follow', actor, from, until }`, `{ kind: 'hit', actor,
  from, until }` and `{ kind: 'effect', actor, target, effect: EffectId, from, until, shape:
  'bolt' | 'burst' }`, with `type AttackShape = 'lunge' | 'lunge_follow' | 'bolt' | 'burst'` and
  `type EffectId = 'fireball' | 'light_burst' | 'arrow'`. `lunge` keeps its shape and plays only
  during a `strike` of shape `lunge` or `lunge_follow`. `flash` stays for the white overlay: `from`
  impact, `until` impact + `FLASH_MS` (the model shortens it at 1.5×, Task F6).
- `shapeOf(actor): AttackShape` on the timeline: enemies `lunge`; heroes by class: knight
  `lunge_follow`, black mage and archer `bolt`, white mage `burst`. The class comes from the view
  the timeline observes (`observe(view, now)` already walks the heroes).
- `ACTION_MS = WINDUP_MS + BOLT_MS + FLASH_MS`.

**Work:** `onEffects` emits per action, from `start`, the motions of the table in "The
choreography": `windup` 0–160; `strike` 160–400 (with the `lunge` for the lunge shapes); `follow`
400–520 for the knight; `effect` 160–400 for `bolt` (`fireball` for the black mage, `arrow` for
the archer) and `burst` (`light_burst`); `hit` at impact for `FLASH_MS` on each target, beside the
`flash` and the number; a heal by a white mage plays `windup`, `strike` and the burst on the
healed ally (no `hit`, no `flash`). Impact per shape: lunge 280, burst 280, bolt 400. Drops keep
anchoring on the last hit's flash end. `isBusy` and `acting` see the new motions.

**Acceptance check:** `claude plugin test plugins/promptfall` with the timeline tests: an enemy
attack at `start` yields `windup` [0,160), `strike` [160,400) shape `lunge`, a `lunge` [160,400),
`hit` and `flash` on the target [280,440), the number at 280; a black mage attack yields a
`strike` shape `bolt`, an `effect` fireball [160,400) and the hit at 400; a knight yields a
`follow` [400,520); a white mage heal yields a burst `effect` on the ally and no `hit`; the next
action starts no earlier than `start + 560`. Red before: the motions do not exist. The committed
scale-1 golden hashes of `rest`, `boss` and `compact` are unchanged (their `now` has no action
running); `dissolve` and `drop` may move with the impact time: regenerate and say so in the
commit. Full check line.

**Boundaries:** No model, compose or Svg change beyond what compiles (the model may ignore the
new motions until F6).

- [ ] tests, red; implement; goldens if moved; full check line; commit

### Task F6: poses, derived frames and effects in the model, Image and Raster

**Files:**
- `plugins/promptfall/hooks/stage/model.ts` — modify
- `plugins/promptfall/hooks/stage/compose.ts` — modify: effects drawn after drops, before numbers
- `plugins/promptfall/hooks/stage/model.test.ts`, `compose.test.ts`, `loop.test.ts` — modify
- `plugins/promptfall/hooks/stage/scenarios.ts`, `golden.test.ts`, `goldens/*`,
  `scripts/stage-goldens.ts` — modify and regenerate

**Interfaces:**
- `type Pose = 'idle' | 'idle_b' | 'windup' | 'strike' | 'follow' | 'hit'`. `StageActor` gains
  `pose: Pose`; its `art`, `palette`, `raritySlot`, `x`, `y` and `flashing` already reflect the
  pose at `now` (callers keep reading them). `StageModel` gains `effects: StageEffect[]`, with
  `type StageEffect = { spriteId: string; art: SpriteArt; x: number; y: number; flipX: boolean }`.
- Art by pose and scale: at 1.5, `idle` → `hires`; `idle_b` → `squash(hires)`; `windup` →
  `frames?.windup.art ?? hires`; `strike` → `frames?.strike.art ?? (hero ? hero_attack.hires :
  hires)`; `follow` → `frames?.follow.art ?? the strike art`; `hit` → `shear(hires).art`, the
  actor placed at `x - grow` when not flipped, at `x` when flipped (the flip mirrors the growth to
  the far side), the palette lightened after the rarity substitution. At 1 and compact: `idle`,
  `idle_b`, `windup`, `hit` → `full`; `strike` and `follow` → `hero_attack.full` for a hero,
  `full` otherwise; `idle_b` raises by `IDLE_BOB_PX`, as the bob does today. The rarity slot is
  the frame's at 1.5, the sprite's otherwise.
- `flashing` is true inside the `flash` motion at 1 and inside its first `BLINK_MS` at 1.5.
- An effect's position at `now`: `bolt` moves linearly from the attacker's front edge at its
  vertical middle to the target's centre over the motion; `burst` sits on the target's centre;
  `flipX` is the attacker's. Art `hires` at 1.5, `full` otherwise. Effects never bob.

**Work:** `pose` comes from the motions at `now`: `hit` wins, then `follow`, `strike`, `windup`,
then `idle_b` when `motion === 'full'` and `bobbingAt(now)` is 1, else `idle`. Fallen heroes are
`idle`. The compact stage draws poses at scale 1 and the effects at `full`. Internal structure is
your choice.

**Acceptance check:** `claude plugin test plugins/promptfall`: at 1.5, 100 ms into an enemy's
action its pose is `windup` with `frames.windup.art`, at 300 ms `strike` with the lunge offset, and
the target is `hit` with `shear` art placed `grow` to the left and a lightened palette, `flashing`
true at 300 and false at 380; at 1 the same instants give `full`, `full` with the lunge, and
`flashing` true at 380; at rest `now = 1_000_700` gives `idle_b` with `squash(hires)` at 1.5 and
`full` raised one pixel at 1, and `idle` under `still`; a black mage action at 280 ms has a
`fireball` effect halfway between its front edge and the target's centre, `flipX` true; the
compact stage shows the effect at `full`. New scenarios `windup`, `strike`, `hit`, `bolt`, `burst`
in `SCENARIOS`, each at a `now` inside the motion, with all seven golden fields; every scenario
within budgets. Red before: no `pose`, no `effects`. Full check line.

**Boundaries:** No Svg change (Task F7). The band call sites keep compiling unchanged.

- [ ] tests, red; implement; scenarios and goldens; full check line; commit; then Task F4's
  stage shots (one more commit)

### Task F7: the frames in the Svg

**Files:**
- `plugins/promptfall/hooks/stage/svg.ts` — modify
- `plugins/promptfall/hooks/stage/svg.test.ts`, `golden.test.ts`, `goldens/*` — modify and
  regenerate

**Interfaces:**
- `renderSvg(model, motions, opts)` keeps its signature. Under SMIL, an actor's group holds one
  `<use>` per frame in use: the frames of its running `windup`/`strike`/`follow`/`hit` motions and,
  at 1.5 with `motion: 'full'`, idle A and idle B; discrete-timed `visibility` (or opacity with
  `calcMode="discrete"`) relative to `now` shows exactly one at any instant, the idle pair on the
  bob's 1 s clock (B in the second half, `begin = -(now % 1000)`), replacing the bob's translate
  at 1.5 (the scale-1 Svg keeps the bob). Without SMIL, the pose's art at `now` only.
- Idle B is not a def: two `<use href="#aN">` of idle A's def, the rows above the dropped row
  under a `<clipPath>` and translated `(0 1)`, the rows below under another clip; the clip rows
  come from the same `r0`, `m` as `squash` (export a helper from `derive.ts` if needed, within
  that file's boundary of pure functions). The hit frame is a def of `shear(art).art` with the
  lightened palette (`artPaths` takes an optional palette) and `color` set to the lightened rarity
  colour; the drawn frames are defs of their arts. Defs stay deduplicated by art identity.
- Effects: a `<use>` per effect; a `bolt` carries an `animateTransform` translate from its start
  to its end over the motion, a `burst` an opacity hold.
- The flash overlay at 1.5 animates opacity `1;0` over `BLINK_MS`.

**Work:** `svgWithFallback` and `stageSvg` are unchanged. Internal structure is your choice.

**Acceptance check:** `claude plugin test plugins/promptfall`: the `rest` scenario's Svg at 1.5
holds one def per distinct art, two `<clipPath>` per actor and no `-bobPx` translate; the
`strike` scenario holds the attacker's wind-up and strike defs and the target's hit def, each
`<use>` with a discrete visibility animation; the `bolt` scenario holds a fireball `<use>` with a
translate from the mage's front to the target's centre; the flat Svg (SMIL off) holds only the
pose's art per actor; the adversarial fuller legal frame of ADR 0006 (that boss, four 16-colour
dithered enemies, two dissolving, three heroes, a drop), rebuilt at rest with the idle pair,
stays under `SVG_MAX_CHARS` with `svgWithFallback` returning the 1.5× Svg; the same frame with
the boss 300 ms into a `lunge` action (wind-up and strike as checker frames) and a hero `hit`
records its length in the test's name and `svgWithFallback` returns something under the cap
(either model); every scenario within budgets. Regenerate the goldens and say which `svgHash`
moved. Full check line.

**Boundaries:** No Image or Raster change. No model change.

- [ ] tests, red; implement; goldens; full check line; commit

### Task F8: the monster sheets

**Files:**
- `art/sheets.md` — modify: six `## frames-monsters-<n>.png` sections
- `art/sprites-frames/enemy/*.png` — create (96), `art/manifest.json` — modify (48 entries),
  `generated.ts` — regenerated
- `.promptfall/contact/*`, the review artifact — republished per sheet

**Work:** Six runs, `pf3-frames-monsters-1` to `-6`, eight `nes` enemies each in manifest order
(the 48 `enemy` entries with style `nes`). Per sheet: `pnpm refsheet` the eight (`--columns 8
--cell 192x256 --scale 7`), assemble the prompt, write it into `art/sheets.md`, run, cut both
rows with `--grid 8x4 --colours 4 --size 16 --native art/sheets/native --hires
art/sprites-frames`, out dir `/tmp/promptfall-frame-cuts`, `--names enemy/<name>-windup,…` for
row 0 and `enemy/<name>-strike,…` for row 1 (rows 2 and 3 are the second take: cut them to
`x/` names and keep a take by eye where the first fails), manifest `frames`, `pnpm sprites`,
contact, republish, commit. Two runs at a time.

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
entries carry `frames`; after the sixth, a test in `scripts/sprites.test.ts` reads the real
manifest and asserts every `enemy` entry of style `nes` has `frames.windup` and `frames.strike`.
Report `generated.ts`'s size in the last commit. Full check line per sheet.

**Boundaries:** No change to shipped 1× or 1.5× art. No plugin code.

- [ ] sheets 1 and 2; 3 and 4; 5 and 6 (each: composite, prompt, run, cut, manifest, build,
  contact, publish, full check line, commit)

### Task F9: the boss sheets

**Files:**
- `art/sheets.md` — modify: fourteen `## frames-bosses-<n>.png` sections
- `art/sprites-frames/enemy/*.png` (48), `art/sprites-frames/world_boss/*.png` (8) — create;
  `art/manifest.json` — modify (28 entries); `generated.ts` — regenerated
- `.promptfall/contact/*`, the review artifact — republished per sheet

**Work:** Fourteen runs, `pf3-frames-bosses-1` to `-14`, two `snes` bosses each in manifest
order (the 24 `snes` enemies, then the four world bosses). Per sheet as Task F8, with
`pnpm refsheet … --columns 2 --cell 768x512 --scale 7` and the cut `--grid 2x2 --colours 16
--fit 48x34 --native art/sheets/native --hires art/sprites-frames`, row 0 `--names
enemy/<a>-windup,enemy/<b>-windup`, row 1 the strikes (world bosses as `world_boss/<name>-…`).
Turn bosses keep their manifest `fit`; the build fits their frames to 36 rows. The 5-hour window
ends this task early about twice: stop at 85%, commit, report the reset time and the next sheet's
number, and resume from it.

The boss sheet body (`<a>`, `<b>` the two names):

```text
Generate one landscape 1536x1024 sprite sheet: a strict grid of 2 columns x 2 rows, 4 large sprites, one per cell, every cell the same size (768 x 512 screen pixels). The attached reference sheet shows 2 creatures in one row: <a> on the left, <b> on the right, standing idle.
Draw the SAME 2 creatures in the SAME columns, exactly the same design, size, colours and pixel size as in the reference, in new poses.
Row 1: each creature winding up to attack (reared back, weapon, claws, jaws or magic raised, weight on the back legs).
Row 2: each creature at the moment of its strike (thrown forward, weapon, claws, jaws or magic driven forward).
Creatures face right.
```

**Acceptance check:** per sheet as Task F8; after the fourteenth, the manifest test asserts every
`snes` entry has `frames.windup` and `frames.strike`, so every actor but the heroes has both and
every hero has `windup`. Full check line per sheet.

**Boundaries:** As Task F8.

- [ ] sheets 1 to 14, two at a time, each committed; the 85% stops recorded in `art/sheets.md`

### Task F10: redos, the canonical cut and the docs

**Files:**
- `art/sheets.md` — modify: "Redos (frames)" resolved (a `frames-redos-<n>.png` sheet per eight,
  the monster body with `<ids>` the redo names, or the boss body for two bosses), and the
  canonical cut gains every frame cut line, the effect lines, the hero frame grid write-backs and
  `rm -rf /tmp/promptfall-frame-cuts`
- `plugins/promptfall/README.md` — modify: the Sprites section (frames, `art/sprites-frames/`,
  `frames` and `frameRarityColors` in the manifest, the `effect` kind, `pnpm refsheet`); the
  stage section (the choreography table, the poses, the derived frames, the Svg's idle clip and
  frame defs, `still`)
- `CONTEXT.md` — modify: **Frame** (one drawing of a sprite's animation: idle A, idle B,
  wind-up, strike, follow-through, hit; avoid: cel, pose for the frames) and **Effect sprite**
  (the fireball, light burst or arrow the stage moves during a hero's action; avoid: projectile,
  particle, VFX; the sim's `Effect` is unrelated); the **Sprite** entry notes frames are 1.5× art
- `docs/adr/0007-drawn-and-derived-frames.md` — create: why two frames are drawn and two derived
  (readings 1 and 8, the counts, the Svg headroom measured in Task F7), why frames are 1.5× only
  (Q21: half-block terminals show one pixel a column, the compact stage has no room), and that
  the effects are ordinary sprites at both densities
- `docs/manual-pass/phase-4.md` — modify: a Part C: on Ghostty and the desktop the party
  breathes (two frames, no bob), an enemy winds up then strikes, the knight follows through, the
  black mage's fireball and the archer's arrow cross the stage, the white mage's light bursts on
  its target, a struck actor leans back and blinks; on iTerm2 the lunge starts a beat later than
  before and nothing else changes; `/promptfall motion still` freezes the idle

**Acceptance check:** the redo sheets' sprites build; every flag, path and term the docs name
exists (`grep` each); `.promptfall/tools/recut.sh` runs the canonical cut end to end and
`git diff --exit-code art/sprites art/sprites-hires` is clean after it. Full check line.

**Boundaries:** No plugin code beyond what a redo's build regenerates.

- [ ] redos; canonical cut; README; CONTEXT; ADR; manual pass; full check line; commit

### Task F11: the PR

**Files:** none new.

**Work:** Push, open the PR into `ai-staging` with the choreography table, the run count and
window stops, `generated.ts`'s size, the Svg headroom numbers from Task F7, and the manual
rundown for Part C. Say which parts were verified by tests, which by the review artifact, and
that the desktop leg needs a Claude.app relaunch. Stop there: the review is Kevin's to trigger.

- [ ] push; PR; rundown; stop

## Self-review

- Grill coverage: Q17 (branch and order: the hero sheet first, the build with its PNGs in hand), Q18 (every actor: F2 and F3 heroes, F8
  monsters, F9 bosses; the hero strike is `hero_attack`: reading 6, F3), Q19 (idle pair: F6, F7;
  wind-up and strike during the lunge: F5, F6; hit for the flash's duration with the blink: F5,
  F6, F7; dissolve and drop unchanged: F5; `still`: F6, F7), Q20 (shapes per class: F5; the
  effect sprites: F2, F3, F5, F6, F7), Q21 (1.5× only: Global constraints, F3; 1× one drawing and code
  motion: F6; effects at 1×: F2, F6), Q22 (frames in use per redraw, fall-back: F7), Q23
  (references: F2's composite; derived frames: F1; about 21 runs: F2, F8, F9).
- Names across tasks: `squash`/`shear`/`lighten` (F1) used by F6, F7 and F4; `SpriteFrames`,
  `frames`, `EFFECT_IDS` (F3) used by F6, F8, F9; `Pose`, `StageEffect`, `effects` (F6) used by F7
  and F4; the `Motion` kinds and `AttackShape` (F5) used by F6 and F7; the tuning names (reading
  2) used by F5, F6, F7.
- Risks named: `generated.ts` grows by about 350 KB (F8, F9 report); the 5-hour window (F9); the
  adversarial Svg mid-strike may fall back (F7 records the length); the one-region rule on five
  hero frames (F3 budgets hand fixes).
