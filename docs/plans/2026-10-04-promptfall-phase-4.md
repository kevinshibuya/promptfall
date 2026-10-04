# Promptfall phase 4 implementation plan: PR 1, the engine

**Goal:** The band's Party tab draws an animated pixel-art battle stage in every terminal and on the desktop, plays four sound cues, and shows item and hero sprites in the dialog lists, all on the grill's concept sprites as placeholders.
**Architecture:** Source PNGs under `art/` become one committed, generated TypeScript module of indexed sprites (`scripts/sprites.ts`, checked stale in CI like the vendor bundle). At runtime a pure stage model turns the game view plus a timeline of motions (fed by the sim's new output-only `hit` effect and by diffs of the enemy list) into a `StageModel`; one compositor turns that into an RGBA frame; three encoders turn the frame into what each surface draws: half-block `Raster` cells, an `Image` RGBA source, or an `Svg` string with SMIL. A frame loop per surface blits the Raster or Image at 12 frames a second during motion and 2 at rest; the desktop redraws once a round. The band grows with the stage (ADR 0003) and chooses its terminal renderer by probing one keyed `Image` with a blit.
**Spec:** `docs/spec/promptfall.md` (§2, §3, §10, §11, §12 as amended on 2026-10-04), `docs/plans/2026-10-04-phase-4-grill.md` (the record: §1 decisions, §2 facts, §3 the spikes), `docs/adr/0003-band-grows-for-the-stage.md`, `CONTEXT.md` (Stage, Sprite, Cue)
**Execution model:** opus
**Review wave:** done 2026-10-04: `reviewer` on opus, `reviewer` on fable, `codex-review` on gpt-6-astra at xhigh. This is the fixed plan, consolidated in `docs/reviews/2026-10-04-phase-4-plan-fix-pass.md`; there is no second wave.
**Delivery:** This plan is PR 1 of phase 4 (spec §12: the engine), Tasks 1 to 9 on `feat/phase-4`, which already holds the grill docs, into `ai-staging`. PR 2 (the art: the style-sheet gate, the sprites zone by zone, the cue clips) gets its own plan after PR 1 merges, because its prompts, slicer settings and contact page depend on the pipeline as PR 1 leaves it. The hand-over facts PR 2 needs are at the end of this plan. No `SIM_VERSION` bump and no reset in PR 1. Red between tasks: Task 2 leaves `pnpm vendor:check` stale until its own `pnpm vendor`; from Task 2's view-type change to the end of Task 2 the plugin does not type-check (`view.ts` fills the new fields in the same task); Task 3 adds `pnpm sprites:check`; Tasks 4 and 5 are pure modules and green on their own; Task 6 is the first commit where the band draws the stage. Each task's last commit is clean on the full check line: `pnpm lint && pnpm typecheck && pnpm test && pnpm vendor:check && pnpm sprites:check && pnpm exec tsc -p plugins/promptfall && claude plugin validate plugins/promptfall && claude plugin test plugins/promptfall`; Tasks 1 and 2 run it without `pnpm sprites:check`, which Task 3 introduces.

## Global constraints

- Everything in the phase 3 plan's global constraints still holds (`docs/plans/2026-10-03-promptfall-phase-3.md`, "Global constraints"), with these changes: `SIM_VERSION` stays `3` (record §1.12: `hit` is output only, effects feed neither the hash nor the goldens, the ledger reads only `rejected`; `packages/sim/src/golden.ts:75` `GOLDEN_HASH = '21ecdbaf9e864e9d'` is unchanged and a test says so); the `$` call list grows by exactly `ui.blit`, `ui.invalidate` and `audio.play` (spec §2 footprint: "interface (including images and sound from the mod's own files), state, store, clock, HTTP and commands"); no `$.fs`, `$.process`, `$.env` or `$.model`.
- Spec §2 and ADR 0003: the band on the Party tab is `8 + 2` rows at rest, `12 + 2` with a turn boss on the stage, `17 + 2` with a zone or world boss; it shows the full stage only when `bodyColumns >= 116` and `maxRows >= stageRows + 2`; otherwise the 4-row compact stage when `bodyColumns >= 100` and `maxRows >= 4`; otherwise 1 row. Hidden while `hasSurvey`; off under `/promptfall off`. Loot and World tabs keep 4 rows. A boss arriving never switches the tab.
- Spec §3 and record §2: `Image` draws pixels on kitty and Ghostty only, `alt` elsewhere, no capability flag; `$.ui.blit` denies on an Image drawing its alt, and also when nothing of the plugin's is mounted at the key or the size differs (d.ts `UiBlitResult`, 12975-12985). `Raster` is terminal only: `columns` 1 to 512, `rows` 1 to 256, cells as base64 of little-endian u32 triplets `[codePoint, fg, bg]`, colours `0x00RRGGBB` or `0x01000000` for the terminal's default, 1024 distinct colour pairs at once. `ImageSource` `{ rgba, width, height }` is base64 of `width * height * 4` bytes, at most 2 MiB decoded, width and height 1 to 2048; a source equal to the last drawn sends nothing. `Svg.source` is at most 131,072 characters; `isInteractive` runs SMIL in a sandboxed frame. `$.ui.blit` takes 120 calls a second, shows about 60, and answers `{}` or `{ deny }`. `$.audio.play({ asset }, { gain })` plays a plugin file through `afplay` on macOS and nothing on Linux or Windows; clips do not queue. `btoa` and `atob` exist in the plugin runtime (d.ts 14107).
- Spec §10 motion: about 12 frames a second during an event, the idle bob at 2 a second, nothing while the band is hidden, collapsed or on another tab. The desktop redraws once a combat round. The motion setting `full | still`, default `full`; `still` drops the idle bob only.
- Spec §10 sound and record §1.5: four cues, each a strict subset of a toast: `drop` (Rare and Epic), `legendary` (Legendary drop), `level_up`, `boss` (world boss appeared). Fixed gain `0.6`. Off by default; per machine in `$.store`; only the primary plays; `/promptfall off` hides the band, not the cues.
- Spec §11 palettes: NES sprites at most 4 colours including the outline, every colour from the NES master palette; SNES bosses at most 16 colours each from one shared 64-colour master; the build fails a sprite that breaks either rule. Heroes and monsters on a 16 × 16 canvas; bosses up to 48 × 34; turn bosses fit 24 px tall (12 rows); the compact stage's sprites fit 8 px tall; item icons 16 × 16 on Image and Svg and 8 × 4 in half-block terminals.
- Record §1.12 verification: golden frames per renderer under the mock clock (Image RGBA hash, Raster cells hash, Svg string) for wave at rest, boss grow, compact, mid-dissolve and drop pop; budget tests (Svg under 131,072 characters, Raster under 1,024 colour pairs, Image under `IMAGE_MAX_BYTES`, zero blits while hidden); a manual pass in Ghostty, iTerm2, Terminal.app, tmux and the desktop app; real-surface checks through `codex-computer-use` before PR 1 is called done.
- Record §1.8 and spec §11: nothing third-party ships except CC0 cues. The claude-toons technique is borrowed with its MIT notice (`plugins/promptfall/NOTICE.md`); none of its Clawd art is.
- Tuning numbers live in named files and nowhere else: `plugins/promptfall/hooks/stage/tuning.ts` (the stage geometry, motion timings, frame cadences, budgets, rarity and ground colours, the cue gain), `art/palettes/nes.json` and `art/palettes/snes.json` (the master palettes). Tests import them rather than repeating the values.
- Pure modules under `plugins/promptfall/hooks/stage/` and `hooks/sprites/` import nothing from `claude-code` but types, use no `$`, no platform global beyond `Math`, `btoa`, `atob`, `Uint8Array`, `Uint8ClampedArray` and `Uint32Array`, so `scripts/stage-goldens.ts` can run them under `tsx` (Node has `btoa` and `atob` too).
- CONTEXT.md governs names: `Stage` avoids "scene"; `Sprite` avoids "icon" and "image". The code says `StageModel`, `stageAt`, `small` and `ListSprite` where the record says scene and icon.
- Atoms: the validator's scan reads an atom only where it is declared in the module that calls `read` or `update` (`hooks/state.ts:11-14`), so each module declares the atoms it uses with the shared initials, and every key is in `PluginState.promptfall` (`types/index.d.ts`).
- Branch flow: `feat/phase-4`, PR into `ai-staging`; nothing lands on `main`.

## Shared contracts

Load-bearing shapes. Later tasks import them by these exact names.

### Sim: the `hit` effect (`packages/sim/src/types.ts`)

```ts
| { k: 'hit'; by: string; target: string; amount: number }
```

`by` and `target` are actor ids: a hero's `Hero.id` or an enemy's `Enemy.id`, on either side. One per `hitEnemy` call (pushed before the world-boss early return, so boss-mode hits report too) and one per enemy attack in `enemyAct`. A white mage heal pushes nothing. Order within a round is the actors' order, so the stage replays a round in sim order, and a `drop` or `drop_vendored` always follows the `hit` that killed its enemy (`combat.ts:46-54` then `progression.ts:226-245`).

### View additions (`plugins/promptfall/types/index.d.ts`)

```ts
export type HeroView = { ...today; rarity: string }
export type EnemyView = { ...today; id: string; def: string }   // def: the content id; for a world boss, 'world_boss'
export type ItemView = { ...today; base: string }               // the content id, Task 8
export type ListingView = { ...today; base: string | null; cls: string | null }   // the item base, or the hero class; Task 8
export type Renderer = 'unknown' | 'image' | 'raster'
export type Settings = { sound: boolean; motion: 'full' | 'still'; renderer: 'auto' | 'image' | 'raster' }
// PluginState.promptfall gains: settings: Settings; renderer: Renderer
```

`Settings` live in `$.store` under `promptfall:settings` through `StoreKeyValue` (`hooks/storage.ts:17`), default `SETTINGS_DEFAULT = { sound: false, motion: 'full', renderer: 'auto' }` (`hooks/state.ts`), and are mirrored into the atom `{ plugin: 'promptfall', key: 'settings' }` for the drawings. `GameSession.reset()` (`register.tsx:363-370`) keeps `promptfall:settings` as it keeps the lease (`key !== LEASE_KEY && key !== SETTINGS_KEY`). The atom `{ plugin: 'promptfall', key: 'renderer' }` (a `Renderer`, initial `'unknown'`) is per session and owned by `ui/band.tsx`.

### Sprites (`plugins/promptfall/hooks/sprites/`)

```ts
// sprites/types.ts
export type SpriteArt = {
  width: number
  height: number
  /** 0x00RRGGBB per index; index 0 is transparent and never has a colour */
  palette: readonly number[]
  /** base64 of width * height bytes, row-major palette indices */
  pixels: string
}
export type SpriteKind = 'hero' | 'hero_attack' | 'enemy' | 'world_boss' | 'item'
export type Sprite = {
  id: string                 // `${kind}:${key}`, e.g. 'hero:knight', 'hero_attack:knight', 'enemy:road_slime', 'world_boss:the_promptwyrm', 'item:iron_sword'
  kind: SpriteKind
  style: 'nes' | 'snes'
  /** the palette index that takes the hero's rarity colour; heroes and hero attacks only, else null */
  raritySlot: number | null
  full: SpriteArt            // 16 × 16 for every nes sprite (padded), up to 48 × 34 for snes; the full stage and the 16 px list sprite
  compact: SpriteArt         // at most 8 px tall, width scaled to keep the aspect, for the compact stage
  small: SpriteArt | null    // exactly 8 × 4, items only, for half-block lists
  /** true while the manifest aliases this id to a concept sheet sprite */
  isPlaceholder: boolean
}

// sprites/generated.ts (written by `pnpm sprites`; never edited; excluded from biome)
export const ART: Readonly<Record<string, { full: SpriteArt; compact: SpriteArt; small: SpriteArt | null }>>   // by art stem
export const SPRITES: Readonly<Record<string, Sprite>>                                                         // by sprite id
export const SPRITE_COUNT: number
export const PLACEHOLDER_COUNT: number

// sprites/index.ts
export function spriteFor(kind: SpriteKind, key: string): Sprite   // an unknown key answers SPRITES['fallback'] (a 16 × 16 two-colour crate from `art/fallback.png`), never throws
export function worldBossKey(name: string): string                  // lowercase, every run of non [a-z0-9] becomes '_', trimmed: 'The Promptwyrm' → 'the_promptwyrm'
export function decodePixels(art: SpriteArt): Uint8Array           // width * height indices

// sprites/base64.ts
export function encode(bytes: Uint8Array): string   // btoa over String.fromCharCode in 8 KiB chunks; standard padded base64
export function decode(s: string): Uint8Array       // atob
```

`art/manifest.json` (PR 1's shape; every PR 1 entry is an alias; the `file` and `rarityColor` fields are PR 2's):

```json
{
  "palettes": { "nes": "palettes/nes.json", "snes": "palettes/snes.json" },
  "sprites": [
    { "id": "hero:knight",          "alias": "concept/nes-knight",   "style": "nes",  "rarityColor": "#c84c0c" },
    { "id": "hero_attack:knight",   "alias": "concept/nes-knight",   "style": "nes",  "rarityColor": "#c84c0c" },
    { "id": "enemy:road_slime",     "alias": "concept/nes-tank",     "style": "nes" },
    { "id": "enemy:bandit_captain", "alias": "concept/snes-boss-0",  "style": "snes" },
    { "id": "enemy:wild_boar",      "alias": "concept/snes-boss-0",  "style": "snes", "fit": { "height": 24 } },
    { "id": "world_boss:the_promptwyrm", "alias": "concept/snes-boss-3", "style": "snes" },
    { "id": "item:iron_sword",      "alias": "concept/item-weapon",  "style": "nes" },
    { "id": "fallback",             "file": "fallback.png",          "style": "nes" }
  ]
}
```

One entry per sprite id. `file` names a PNG under `art/` holding that sprite at true size; `alias` names a PNG stem under `art/concept/` and marks the sprite a placeholder. `rarityColor` is the exact colour in the source PNG whose palette index becomes `raritySlot` (the build fails a hero whose PNG lacks it; in PR 1 it is read off each concept hero's sliced palette and written into the manifest by hand). `fit` downsamples the source to fit the box. The build fails on a duplicate id, an unknown style, a missing file, or an id the content does not know, and fails when any content id lacks an entry: the ids it expects are every hero class (deduped from `content.heroTemplates[*].cls`) as `hero:` and `hero_attack:`, every key of `content.enemies` as `enemy:`, every `WORLD_BOSSES[i].name` through `worldBossKey` as `world_boss:`, every key of `content.itemBases` as `item:`, plus `fallback`. `content` is `@promptfall/sim`'s export (`packages/sim/src/index.ts:11`), `WORLD_BOSSES` is `@promptfall/ledger`'s (`ledger/src/index.ts:4`); the script runs under `tsx` with both as root workspace devDependencies.

Palette rule, per art stem after decoding: alpha under 128 is transparent (index 0); every opaque colour snaps to the nearest entry of the style's master palette (squared RGB distance); then the distinct count must be at most 4 for `nes` and 16 for `snes`, else the build fails naming the stem and the count. Canvas rule: `nes` art larger than 16 × 16 fails; smaller art is padded with transparency to 16 × 16, bottom-centred; `snes` art larger than 48 × 34 fails and is kept at its size. Downsampling to a target `W × H` maps output pixel `(i, j)` to the source block `x ∈ [floor(i·w/W), floor((i+1)·w/W))`, `y ∈ [floor(j·h/H), floor((j+1)·h/H))`, taking the most frequent opaque index in the block, transparent only when no pixel in it is opaque; factors differ per axis. `compact` fits 8 px tall keeping the aspect (`W = round(w · 8 / h)`, `H = 8`); `small` is `8 × 4` from the full art (a 2-row half-block sprite is 8 columns by 2 rows, square on screen); `fit: { height: 24 }` is `W = round(w · 24 / h)`, `H = 24`.

### Stage (`plugins/promptfall/hooks/stage/`)

```ts
// stage/tuning.ts: every number below, exported as a const of the same name
STAGE_REST_ROWS = 8; STAGE_TURN_BOSS_ROWS = 12; STAGE_BOSS_ROWS = 17; STAGE_TEXT_ROWS = 2
COMPACT_ROWS = 4; COMPACT_STAGE_COLUMNS = 52; FULL_MIN_COLUMNS = 116; MIN_COLUMNS = 100; STAGE_MAX_COLUMNS = 160
SPRITE_PX = 16; ACTOR_PITCH = 18; ACTOR_EDGE = 4; COMPACT_PITCH = 8
HIT_STAGGER_MS = 150; LUNGE_MS = 240; LUNGE_PX = 4; FLASH_MS = 160; NUMBER_MS = 700; NUMBER_RISE_PX = 6
DISSOLVE_MS = 420; SPAWN_MS = 360; DROP_MS = 600; DROP_RISE_PX = 10; IDLE_FRAME_MS = 500; EVENT_FRAME_MS = 83; IDLE_BOB_PX = 1
PROBE_DELAY_MS = 300; IMAGE_SCALE = 1 /* Task 1 sets it */; IMAGE_MAX_BYTES = 1_048_576
SVG_SMIL = true /* Task 1 sets it */; SVG_FALLBACK_FRAME_MS = 167; SVG_MAX_CHARS = 131_072; RASTER_MAX_PAIRS = 1024
CUE_GAIN = 0.6
RARITY_RGB = { common: 0x9a9a9a, uncommon: 0x3fbf5f, rare: 0x3f7fff, epic: 0xd040d0, legendary: 0xf0c040 }
ZONE_GROUND: readonly number[]   // 12 entries, one 0xRRGGBB per zone, the implementer's pick from the zone names in packages/sim/src/content/zones.ts
FLASH_RGB = 0xffffff; NUMBER_RGB_HERO = 0xff5050 /* damage taken by a hero */; NUMBER_RGB_ENEMY = 0xffffff

// stage/layout.ts
export type Box = { columns: number; rows: number }     // the stage in cells; pixels are columns × (rows * 2)
export type Layout =
  | { kind: 'full'; box: Box; bandRows: number }        // box.columns = min(bodyColumns, STAGE_MAX_COLUMNS), box.rows = timeline.rowsAt, bandRows = box.rows + STAGE_TEXT_ROWS
  | { kind: 'compact'; box: Box; bandRows: 4 }          // box = { COMPACT_STAGE_COLUMNS, COMPACT_ROWS }
  | { kind: 'collapsed'; box: null; bandRows: 1 }
export function layoutFor(rows: number, props: { bodyColumns: number; maxRows: number }): Layout
// full when bodyColumns >= FULL_MIN_COLUMNS and maxRows >= rows + STAGE_TEXT_ROWS; else compact when bodyColumns >= MIN_COLUMNS and maxRows >= COMPACT_ROWS; else collapsed. `rows` is timeline.rowsAt(view, now).
export function sameLayout(a: Layout, b: Layout): boolean   // kind and box equal

// stage/model.ts
export type StageActor = {
  key: string                  // hero or enemy id; a departed enemy keeps its id until its motions end
  spriteId: string
  art: SpriteArt
  palette: readonly number[]   // the art's palette after the rarity swap, the fallen-hero dim and the flash
  x: number; y: number         // top-left in stage pixels, after lunge, bob and spawn offsets
  flipX: boolean               // source art faces right; heroes (on the right) are flipped to face left
  alpha: number                // 0 to 1: spawn ramps up, dissolve ramps down; the compositor thresholds it
  fallen: boolean              // a hero at 0 hp: drawn with each palette channel halved (opacity 0.5 on Svg)
  flashing: boolean
}
export type StageNumber = { text: string; x: number; y: number; rgb: number }   // the text's top-left in stage pixels, already clamped inside the frame
export type StageDrop = { spriteId: string; art: SpriteArt; x: number; y: number; alpha: number }
export type StageModel = { box: Box; ground: number; actors: StageActor[]; numbers: StageNumber[]; drops: StageDrop[]; alt: string }
export function stageAt(view: GameView, timeline: StageTimeline, now: number, box: Box, opts: { compact: boolean; motion: 'full' | 'still' }): StageModel

// stage/timeline.ts
export type Motion =
  | { kind: 'lunge'; actor: string; from: number; until: number; dir: 1 | -1 }
  | { kind: 'flash'; actor: string; from: number; until: number }
  | { kind: 'number'; actor: string; text: string; rgb: number; from: number; until: number }
  | { kind: 'dissolve'; actor: string; from: number; until: number }
  | { kind: 'spawn'; actor: string; from: number; until: number }
  | { kind: 'drop'; actor: string; item: string /* sprite id */; from: number; until: number }
export type Known = { id: string; spriteId: string; kind: string; slot: number; name: string }
export class StageTimeline {
  observe(view: GameView, now: number): void
  // Enemies new since the last observe take the lowest free slot in 0..2 and start a spawn; enemies gone start a dissolve when their last flash ends (now, if none); departed enemies keep their Known entry and slot until their dissolve and any drop end; the first observe assigns slots and starts nothing. Each Known stores the sprite id resolved at observe (spriteFor('world_boss', worldBossKey(enemy.name)) for a world boss, spriteFor('enemy', enemy.def) otherwise), so a departed world boss still draws.
  onEffects(effects: readonly Effect[], now: number): void
  // hit → a lunge for `by` (dir −1 for a hero, +1 for an enemy), a flash and a number for `target`, the i-th hit of the list at now + i * HIT_STAGGER_MS, its flash and number at that plus LUNGE_MS / 2; drop or drop_vendored → a drop motion from the target of the nearest preceding hit in the same list (the front enemy if none), starting when that hit's flash ends; a motion naming an actor the timeline has not observed (neither a hero in the last view nor a Known enemy) is dropped.
  active(now: number): readonly Motion[]
  known(): readonly Known[]                                  // live and departed enemies with their slots
  rowsAt(view: GameView, now: number): number                // STAGE_BOSS_ROWS while a zone or world boss is in view or Known-and-animating, STAGE_TURN_BOSS_ROWS for a turn boss likewise, else STAGE_REST_ROWS
  isBusy(now: number): boolean                               // any active motion
  bobbing(now: number): 0 | 1                                // floor(now / IDLE_FRAME_MS) % 2
}

// stage/compose.ts
export type Frame = { width: number; height: number; rgba: Uint8ClampedArray }   // alpha 0 or 255 only
export function composeFrame(model: StageModel, opts: { numbers: boolean }): Frame
// ground strip on the bottom two pixel rows; actors in slot order, drops, then (when opts.numbers) the numbers through font.ts; alpha thresholded by a 4 × 4 Bayer matrix (the claude-toons rule: a pixel shows where alpha * 16 > bayer[y % 4][x % 4])
export function artFrame(art: SpriteArt, palette?: readonly number[]): Frame   // one sprite alone, for the list sprites
// stage/font.ts: DIGITS, a 3 × 5 pixel font for '0'-'9' and '-'; drawText(frame, text, x, y, rgb)
// stage/hash.ts: fnv1a64(bytes: Uint8Array | string): string   // 16 hex chars

// stage/raster.ts
export function encodeRaster(frame: Frame, numbers: readonly StageNumber[]): string   // half-block cells: ▀ with fg top and bg bottom when both opaque; ▀ fg top, bg CLEAR for top only; ▄ fg bottom, bg CLEAR for bottom only; ' ' CLEAR/CLEAR for neither; then each number's glyphs as text cells (fg rgb, bg CLEAR) at cell (floor(x), floor(y / 2)), clamped inside the box, replacing what is under them; the frame passed in was composed with numbers: false
export function rasterPairs(cells: string): number       // distinct (fg, bg) pairs, for the budget test
export const CLEAR = 0x01000000

// stage/image.ts
export function encodeImage(frame: Frame, scale: number): { rgba: string; width: number; height: number }   // nearest-neighbour upscale by `scale`, transparent pixels stay alpha 0; the frame was composed with numbers: true
export function imageBytes(frame: Frame, scale: number): number

// stage/svg.ts
export function renderSvg(model: StageModel, motions: readonly Motion[], opts: { smil: boolean; now: number; width: number; motion: 'full' | 'still' }): string
// viewBox `0 0 ${columns} ${rows * 2}`, shape-rendering crispEdges, width `opts.width` CSS px and height in proportion. Art: one <g id="<stem>"> per distinct art stem, holding one <path> per colour whose d is the run-length `M x y h w v 1 h -w z` of that colour's horizontal runs; the rarity-slot colour's path has fill="currentColor" and each <use> sets color to its actor's rarity. Per actor: a <use href="#stem"> with transform (translate, and scale(-1,1) for flipX); fallen → opacity 0.5; flash → a second <use> with filter="url(#flash)" (feFlood white, feComposite operator="in" in2="SourceAlpha") whose opacity animates. With smil: <animateTransform> for the lunge, and for the bob only when opts.motion is 'full'; <animate opacity> for flash, dissolve and spawn; <text> with <animate> for numbers; <use> of the item with animated translate and opacity for drops; every begin is `(motion.from − opts.now) / 1000`s, negative for a motion already under way; motions with until <= now are omitted. Without smil, the model as of opts.now and no animation elements.
```

Placement in `stageAt`: enemies by their Known slot from the left, `x = ACTOR_EDGE + slot * ACTOR_PITCH`; heroes by `view.heroes` index from the right, `x = columns − ACTOR_EDGE − width − index * ACTOR_PITCH`; feet on the bottom edge, `y = rows * 2 − height`; a boss at 17 rows has `y = 0`. On the compact box the pitch is `COMPACT_PITCH` and the edge 0. Lunge: the actor moves `LUNGE_PX` toward the other side over the first half of `LUNGE_MS` and back over the second; a hero in a lunge draws its `hero_attack` sprite. Numbers: the hit's `amount`, `NUMBER_RGB_ENEMY` on an enemy and `NUMBER_RGB_HERO` on a hero, centred over the actor, the text's top at `clamp(actorTop + 2 − progress * NUMBER_RISE_PX, 0, height − 5)`. Drop: the item's `full` art (`compact` on the compact box) from the departed enemy's centre, rising `DROP_RISE_PX` over `DROP_MS`, alpha ramping down over the last third. Spawn: alpha 0 to 1 over `SPAWN_MS`. Dissolve: alpha 1 to 0 over `DISSOLVE_MS`. Fallen hero: in place, palette halved, no motion. Alt: `Zone <zone>, wave <wave>: <enemy name> <hp>/<max>, … vs <hero name> L<level>, …`, with a departed enemy omitted.

### The frame loop and the probe

```ts
// stage/loop.ts
export type StageSite = { requestId: string; key: 'stage'; layout: Layout; renderer: 'raster' | 'image' | 'svg' }
export type LoopIo = {
  now: () => Promise<number>
  after: (ms: number, fn: () => void) => Timer
  blit: (args: UiBlitArgs) => Promise<UiBlitResult>
  invalidate: () => void                       // $.ui.invalidate('ui.render')
  view: () => Promise<GameView | null>
  settings: () => Promise<Settings>
}
export class StageLoop {
  constructor(io: LoopIo, timeline: StageTimeline)
  mount(site: StageSite | null): void          // the band's render hook calls it on every render of its surface: a site while the stage is drawn, null when hidden, collapsed, on another tab, off, or view === null; a changed site or null bumps the generation; null cancels the timer
  wake(): void                                 // cancels the pending timer and arms one at 0 ms; GameSession.onEffects calls it on every loop after feeding the timeline
  blitCount: number                            // for the loop's own unit tests
}
```

One `after` timer at a time, re-armed at the end of each tick with `EVENT_FRAME_MS` while `timeline.isBusy(now)`, else `IDLE_FRAME_MS`. A tick captures the mount generation and gives up after any await when it changed. A tick: `timeline.observe(view, now)`; `layoutFor(timeline.rowsAt(view, now), props)` with the props the site was mounted with; when `!sameLayout(site.layout, …)`, `io.invalidate()` and no blit (the next render mounts the new site); else, for `'raster'` and `'image'`, compose, encode, blit; for `'svg'` (the `SVG_SMIL` false fallback only), `io.invalidate()` while busy and nothing at rest, at `SVG_FALLBACK_FRAME_MS`. With `motion: 'still'` and nothing busy, the tick blits once when the previous tick was busy or the actor set changed since the last blit, else skips. A deny stops the loop until the next `mount`. `mount(null)` stops the timer, so a hidden band issues zero blits. `GameSession` owns one `StageTimeline` and one `StageLoop` per surface (`'terminal'`, `'desktop'`, created lazily), so a desktop render never touches the terminal's timer.

The probe (`ui/band.tsx`): on a terminal render with `rendererAtom` `'unknown'` and `settings.renderer` `'auto'`, while the band is drawing the full or compact Party tab, the status row ends in `<Image key="probe" source={PROBE_A} columns={1} rows={1} alt=" " />` (`PROBE_A`: one transparent pixel) and that render arms `$.clock.after(PROBE_DELAY_MS, probe)` unless a probe is already pending. `probe` blits `PROBE_B` (one pixel of alpha 1, rgb 0) to that key: `{}` writes `'image'`; a deny whose text names the alt (the exact string from Task 1's findings) writes `'raster'`; any other deny leaves `'unknown'`, and the next render that draws the probe arms it again. `settings.renderer` `'image'` or `'raster'` writes the atom at session start and skips the probe. While unknown, the Party tab draws the stage's rows empty, so the band's height does not jump when the result lands. The desktop never probes; the Svg path never reads `rendererAtom`.

### Session io additions (`plugins/promptfall/hooks/register.tsx`)

The io closures built in `session.start` and on desktop attach gain `blit: (args) => $.ui.blit(args)`, `invalidate: () => $.ui.invalidate('ui.render')`, `view: () => read($, viewAtom)`, `settings: () => read($, settingsAtom)`, `play: (asset, gain) => $.audio.play({ asset }, { gain })`. `GameHandle` (`engine.ts:58`) gains `stage: { timeline: StageTimeline; loopFor(surface: RenderSurface): StageLoop }`. `GameSession.onEffects` feeds `timeline.onEffects(effects, now)` and wakes every loop before the toast loop, and after a toast with a cue plays it when `this.role === 'primary'` and `settings.sound` (the promise's rejection is swallowed). `registerBand(on, game: () => GameHandle | null)` like `registerDialog`.

### Commands and settings

`/promptfall sound on|off`, `/promptfall motion full|still`, `/promptfall renderer auto|image|raster` claim the lease like every other subcommand (`command.ts:52`), write `settings` to the store and the atom, and answer `{ text: 'Sound on' }`, `{ text: 'Motion: still' }`, `{ text: 'Renderer: raster (applies at the next session start)' }`. The Account tab shows the three as rows with Buttons: `Sound: off  [s]`, `Motion: full  [n]`, `Renderer: auto (image)  [x]`, hotkeys `s`, `n`, `x` (none of the dialog's tab letters `i h m r a o c b`). `export type Cue = 'drop' | 'legendary' | 'level_up' | 'boss'`; cue files `plugins/promptfall/cues/<cue>.wav`.

## Task list

### Task 1: The three spikes

**Files:**
- `spikes/phase-4/.claude-plugin/plugin.json` (create): `{ "name": "phase-4-spike", "version": "0.1.0", "description": "Phase 4 spikes: Image probe, Ghostty scaling, desktop SMIL" }`
- `spikes/phase-4/hooks/hooks.json` (create): `{ "modules": ["./register.tsx"] }`
- `spikes/phase-4/hooks/register.tsx` (create): the spike module
- `docs/plans/2026-10-04-phase-4-spikes.md` (create): the three questions, how to run, a findings table Kevin fills, the constants each answer sets
- `.gitignore` (modify): `spikes/*/.claude-plugin/types/`

**Interfaces:**
- Consumes: the plugin API (`Image`, `Raster`, `Svg`, `$.ui.blit`, `$.ui.open`, `$.command.register`).
- Produces: the findings that set `IMAGE_SCALE`, `SVG_SMIL`, the probe's alt deny string, and confirm the probe rule; applied in Task 6.

**Work:** A throwaway plugin loaded with `claude --plugin-dir spikes/phase-4`, never shipped. Its `/spike` command opens a pane (`$.ui.open({ id: 'spike', title: 'phase 4 spike', focus: true })`) whose render hook draws, on a terminal: (a) a 1 × 1 keyed Image with a transparent pixel, then after 300 ms a blit of a different 1 × 1 pixel to it, and a Text line reading `probe: image` on `{}` or `probe: <the deny text verbatim>` on a deny, repeated twice more at 300 ms to show the answer is stable; a second line showing the deny text of a blit to a key that is not mounted (`key: 'nothing'`), so the two strings are on record; (b) the stage's own case: a 120 × 16 two-colour checkerboard (2 px squares) drawn as four Images in `columns=120 rows=8`, pre-upscaled nearest-neighbour by 1, 2, 4 and 6, each labelled, each blitted with a new frame (the checker shifted one square) every 83 ms for 5 s, with a line per scale counting blits sent, denies, and the mean `await $.ui.blit` time in ms; plus a 16 × 16 checker whose dark squares are alpha 0 in `columns=2 rows=1`; (c) a Raster `columns=100 rows=8` of random half-block cells blitted every 83 ms for 5 s with a line counting blits and denies. On a desktop surface it draws an `isInteractive` Svg with one rect lunging through `<animateTransform type="translate" ... repeatCount="indefinite">` and one fading through `<animate attributeName="opacity">`, a Text line reading `SMIL: watch the squares`, and a Button `redraw` that re-renders with a byte-identical source, so Kevin can see whether the animation restarts. Internal structure is the implementer's choice. Kevin runs it in Ghostty, iTerm2, Terminal.app, tmux (inside Ghostty) and the desktop app, and fills the findings table: the probe answer and both deny strings per terminal; which scales read crisp and the blit times; whether alpha shows the terminal background; the Raster blit and deny counts; whether the squares move on the desktop and whether the redraw restarts them. Decisions from the findings, written in the doc: `IMAGE_SCALE` is the smallest scale among 1, 2, 4, 6 that Kevin reads as crisp in Ghostty (6 keeps a 160 × 34 frame at 783,360 bytes, under `IMAGE_MAX_BYTES`); none crisp means `1` and a note; `SVG_SMIL` is `true` when the squares move; the probe rule stands when every terminal but Ghostty denies naming the alt and Ghostty answers `{}`. If a terminal that draws no pixels answers `{}`, the renderer default becomes `'raster'` for every terminal and `settings.renderer = 'image'` opts in per machine (record §1.2's fallback), noted in the doc and applied in Task 6.

**Acceptance check:** `claude plugin validate spikes/phase-4` lists `ui.blit`, `ui.open`, `command.register`; `claude --plugin-dir spikes/phase-4` then `/spike` in Ghostty draws the pane. Red before: the folder does not exist. Kevin's findings are the task's exit; until they are in, Tasks 2 to 5 proceed and Task 6 reports `blocked: spike findings needed` at its tuning checkbox.

**Boundaries:** Nothing under `plugins/promptfall`. No art. The spike is not added to any workspace script or CI.

- [x] The module, the two JSON files, the gitignore line; `claude plugin validate spikes/phase-4`
- [x] The findings doc with the table and the decision rules; commit `docs(phase-4): spike plugin and findings sheet`
- [ ] Ask Kevin to run the five surfaces; record the findings in the doc; commit `docs(phase-4): spike findings`. Partial: cmux (Ghostty's engine) and Terminal.app run and recorded by the implementing session on 2026-10-04 and applied; iTerm2, tmux, standalone Ghostty and the desktop app are not installed on this Mac and stay Kevin's (the manual pass covers them)

### Task 2: Sim: the `hit` effect; the view carries ids and rarity

**Files:**
- `packages/sim/src/types.ts` (modify): the `hit` member of `Effect`
- `packages/sim/src/combat.ts` (modify): `hitEnemy(s, by, enemy, amount, effects)` pushes `{ k: 'hit', by, target: enemy.id, amount }` first; the four call sites (`:65`, `:73`, `:96`, `:104`) pass `hero.id`; `enemyAct` pushes `{ k: 'hit', by: enemy.id, target: target.id, amount }` before the `hero_fell` check (`:120-121`)
- `packages/sim/src/combat.test.ts` (modify): one round on a fixture state yields one `hit` per attack, in actor order, `by` and `target` the right ids, a world-boss hit reports its amount while the boss's hp is unchanged, a heal yields no `hit`, a kill's `drop` follows its `hit`
- `packages/sim/src/golden.test.ts` (modify): the 300-event replay's hash still equals `GOLDEN_HASH` and the replay's effects contain at least one `hit`
- `scripts/vendor.mjs` (run `pnpm vendor`): the bundles
- `plugins/promptfall/types/index.d.ts` (modify): `HeroView.rarity`, `EnemyView.id`, `EnemyView.def`
- `plugins/promptfall/hooks/view.ts` (modify): `toGameView` fills them (`def` is `'world_boss'` for the world boss, `view.ts:203-212`)
- `plugins/promptfall/hooks/golden.test.ts`, `band.test.ts` (modify where a fixture view is built by hand): the new fields

**Interfaces:**
- Consumes: today's sim and plugin.
- Produces: `Effect` with `hit`; `HeroView.rarity`, `EnemyView.id`, `EnemyView.def`.

**Work:** Output only. No state field changes, no new RNG draw, no `SIM_VERSION` bump. The ledger's effect handling reads `rejected` only (`packages/ledger/src/books.ts:122`); `toasts.ts:42` has a `default` arm, so nothing switches exhaustively on `k`.

**Acceptance check:** `pnpm --filter @promptfall/sim test` green with the hash unchanged; `pnpm vendor && pnpm vendor:check` clean; `pnpm typecheck`, `pnpm exec tsc -p plugins/promptfall` and `claude plugin test plugins/promptfall` green. Red before: `combat.test.ts` finds no `hit` in the effects.

**Boundaries:** No stage code. No change to `resolveRound`'s order or to damage. Do not touch `progression.ts`.

- [x] `types.ts`, `combat.ts`, `combat.test.ts` red then green; `golden.test.ts`'s hash assertion and the `hit` presence
- [x] `pnpm vendor`; the view types and `view.ts`; fixtures in the plugin tests; run the acceptance check; commit `feat(sim): output-only hit effect; the view carries actor ids and hero rarity`

### Task 3: The sprite pipeline

**Files:**
- `package.json` (modify): devDependencies `pngjs`, `@types/pngjs`, `tsx`, `vitest`, and `@promptfall/sim`, `@promptfall/ledger` as `workspace:*`; scripts `sprites: tsx scripts/sprites.ts`, `sprites:check: pnpm sprites && test -z "$(git status --porcelain -- plugins/promptfall/hooks/sprites/generated.ts)"`, `slice: tsx scripts/slice-sheet.ts`, `test:scripts: vitest run scripts`, and `test` gains `&& pnpm test:scripts`
- `biome.json` (modify): `"!plugins/promptfall/hooks/sprites/generated.ts"` in `files.includes`
- `.github/workflows/ci.yml` (modify): `pnpm sprites:check` after `vendor:check`
- `scripts/slice-sheet.ts` (create): `tsx scripts/slice-sheet.ts <sheet.png> <out-dir> --grid <cols>x<rows> [--row <r>] --colours <n> (--size <n> | --fit <w>x<h>) [--names a,b,c]`: the port of `docs/plans/phase-4-concepts/slice.py` with its three fixes (magenta key with a fringe tolerance, crop to the main run of opaque rows and columns, palette from opaque pixels only), writing one RGBA PNG per cell as `<out-dir>/<name or index>.png`, quantised to `--colours` by median cut; `--size n` scales the cropped sprite to fit `n × n` keeping the aspect and pads it to that canvas bottom-centred; `--fit w×h` scales to fit without padding
- `scripts/sprites.ts` (create): the build described under "Sprites": reads `art/manifest.json`, the palettes, every PNG; validates ids against the content, the palette rules, the canvas rules (`fit` applied first); emits `plugins/promptfall/hooks/sprites/generated.ts` deterministically (sorted keys, a header comment naming the script, `SPRITE_COUNT`, `PLACEHOLDER_COUNT`); exits 1 with every failure listed; `--derive-snes-master` writes `art/palettes/snes.json` from the opaque pixels of every `snes` stem by median cut to 64
- `scripts/sprites.test.ts` (create): vitest over fixtures in `scripts/fixtures/`: a 5-colour NES PNG fails naming the stem and the count, a 4-colour one passes, a 17-colour SNES one fails, a 12 × 9 NES PNG pads to 16 × 16 bottom-centred, a 17 × 16 NES PNG fails, `fit` downsamples 48 × 34 to 24 tall keeping the aspect, the per-axis block rule on a known 4 × 4 → 2 × 1 case, `small` of a 16 × 16 is 8 × 4, `rarityColor` resolves to the right index and fails when absent, a missing content id fails, an extra id fails, the output is byte-identical across two runs
- `art/manifest.json`, `art/palettes/nes.json` (the 64-entry 2C02 palette as `#rrggbb` strings, duplicates kept so indices match the usual table), `art/palettes/snes.json` (from `--derive-snes-master`, committed), `art/fallback.png` (a 16 × 16 two-colour crate the implementer draws as a pixel array in a one-off script, committed as PNG), `art/concept/*.png` (create): the concept sprites sliced from `docs/plans/phase-4-concepts/nes-sheet.png` and `snes-sheet.png` with `pnpm slice`: NES row 0 as `nes-knight`, `nes-black_mage`, `nes-white_mage`, `nes-archer` and row 1 as `nes-brute`, `nes-swift`, `nes-tank`, `nes-caster`, both `--colours 4 --size 16`; SNES row 2 as `snes-boss-0` to `snes-boss-3`, `--colours 16 --fit 48x34`; four item placeholders `item-weapon`, `item-armour`, `item-accessory`, `item-misc` drawn in the same one-off script (a sword, a chest plate, a ring, a pouch, 16 × 16, 4 NES colours)
- `plugins/promptfall/hooks/sprites/types.ts`, `base64.ts`, `index.ts`, `generated.ts` (create): the contracts above
- `plugins/promptfall/hooks/sprites/sprites.test.ts` (create): `claude plugin test`: `base64` round-trips a known vector (`encode(Uint8Array.of(0, 255, 16))` is `'AP8Q'`) and a 20,000-byte array (past one chunk); every `SPRITES` entry's `pixels` decodes to `width * height` bytes with every index under `palette.length`; `spriteFor('enemy', 'road_slime').full` is 16 × 16 with at most 4 colours; `spriteFor('world_boss', worldBossKey('The Promptwyrm')).full.height <= 34`; `spriteFor('enemy', 'wild_boar')` (zone 1's turn boss, `content/enemies.ts:50`) fits 24 tall; every `item:` sprite has a `small` of 8 × 4; an unknown key answers the fallback; `SPRITE_COUNT` equals `4 + 4 + Object.keys(content.enemies).length + WORLD_BOSSES.length + Object.keys(content.itemBases).length + 1`
- `plugins/promptfall/README.md` (modify): a "Sprites" section: the `art/` layout, the manifest, `pnpm slice` and `pnpm sprites`, the palette and canvas rules, the placeholder aliases

**Interfaces:**
- Consumes: `content` (`@promptfall/sim`), `WORLD_BOSSES` (`@promptfall/ledger`), Task 2's view fields.
- Produces: `SPRITES`, `ART`, `spriteFor`, `worldBossKey`, `decodePixels`, `encode`, `decode`.

**Work:** The manifest in PR 1 aliases every enemy to the concept monster of its archetype (brute, swift, tank, caster; `content/enemies.ts:151` maps archetypes), every zone boss to `snes-boss-<(zone − 1) % 4>`, every turn boss to the same with `fit: { height: 24 }`, the four world bosses to `snes-boss-0..3`, every item to the placeholder of its slot (`content.itemBases[id].slot`: weapon, armour, accessory; `item-misc` is unused in PR 1 and shipped for PR 2), heroes to the NES concept heroes with their attack pose aliasing the same art (no attack poses exist yet). For each concept hero, read the sliced PNG's palette, pick the cape or trim colour, and write it as `rarityColor`. The generated module is plain data: no imports, `export const` only. The build runs under `tsx` and uses Node's `Buffer` for its own base64; the plugin's `base64.ts` uses `btoa` and `atob`.

**Acceptance check:** `pnpm sprites && pnpm sprites:check` clean; `pnpm lint` clean with the exclusion; `pnpm test:scripts` green; `claude plugin test plugins/promptfall` green with `sprites.test.ts`; `pnpm exec tsc -p plugins/promptfall` clean. Red before: `sprites.test.ts` cannot import `./generated`.

**Boundaries:** No stage or band code. No change to the sim's content. Nothing third-party under `art/`. `slice.py` stays as the record left it.

- [x] Dependencies and scripts; `slice-sheet.ts`; slice the two sheets; the fallback and item placeholders; `art/manifest.json`, the two palettes; the biome exclusion
- [x] `sprites.ts` with `sprites.test.ts` red then green; `pnpm sprites` emits `generated.ts`; CI line
- [x] `types.ts`, `base64.ts`, `index.ts`; `sprites.test.ts` in the plugin; README; run the acceptance check; commit `feat(sprites): art pipeline, palette checks, generated sprite module on the concept sheets`

### Task 4: The stage model: layout, timeline, model, compositor

**Files:**
- `plugins/promptfall/hooks/stage/tuning.ts` (create): every constant under "Stage", `IMAGE_SCALE = 1` and `SVG_SMIL = true` until Task 6
- `plugins/promptfall/hooks/stage/layout.ts`, `timeline.ts`, `model.ts`, `compose.ts`, `font.ts`, `hash.ts` (create): the contracts above
- `plugins/promptfall/hooks/stage/fixtures.ts` (create): `wave()` (zone 1, wave 2, three heroes of rarities common, rare and legendary named Aldric L5, Mira L4, Tomas L5, enemies Goblin Scout 42/60, Field Rat 10/20, Road Slime 30/90 in that order), `boss()` (Bandit Captain as the only enemy), `turnBoss()` (Wild Boar), `worldBoss()` (The Promptwyrm, `def: 'world_boss'`), `empty()` (no enemies), each a `GameView`; shared by the tests and `scripts/stage-goldens.ts`
- `plugins/promptfall/hooks/stage/layout.test.ts` (create): `claude plugin test`: `layoutFor(8, { bodyColumns: 120, maxRows: 20 })` is full with box `120 × 8` and `bandRows 10`; rows 17 at `maxRows 20` is full `120 × 17`, 19; rows 17 at `maxRows 12` is compact; `bodyColumns 115` is compact; `bodyColumns 99` is collapsed; `maxRows 3` is collapsed; `bodyColumns 200` gives `box.columns 160`
- `plugins/promptfall/hooks/stage/timeline.test.ts` (create): four hits in one `onEffects` call start lunges at `now`, `now + 150`, `now + 300`, `now + 450` and flashes at each plus `LUNGE_MS / 2`; `observe` with an enemy removed starts its dissolve at the end of its last flash and `known()` keeps it with its slot until `until`; the survivors keep their slots and a new enemy takes the lowest free slot; an enemy added starts a spawn; the first `observe` starts nothing; `rowsAt` is 17 during a zone boss's dissolve and 8 after it ends; a `drop` after a `hit` on the slot-2 enemy pops from slot 2; a `drop_vendored` pops too; a hit naming an unknown id is dropped; a departed world boss's `Known.spriteId` is `world_boss:the_promptwyrm`; `isBusy` is false once every motion ends
- `plugins/promptfall/hooks/stage/model.test.ts` (create): at `box = { columns: 116, rows: 8 }` the wave fixture places enemy slot i at `x = 4 + 18 i` and hero i at `x = 116 − 4 − 16 − 18 i`, feet at `y + height = 16`, and no two actors overlap; with a 48 px boss in slot 0 and three heroes at 116 columns no overlap either; heroes have `flipX`; the rare hero's `palette[raritySlot]` is `RARITY_RGB.rare`; a flashing actor's opaque palette entries are all `FLASH_RGB`; a lunging hero's `x` is lower by `LUNGE_PX` at the lunge's midpoint; `motion: 'still'` gives a bob offset of 0 and `full` gives `IDLE_BOB_PX` on alternate `bobbing` values; a fallen hero's palette is halved per channel; compact at `{ columns: 52, rows: 4 }` uses `compact` art with `COMPACT_PITCH` and edge 0; a boss at `rows: 17` has `y = 0` for a 34 px sprite; a number on a 16 px actor at rest has `y` in `[0, 11]`; `alt` reads `Zone 1, wave 2: Goblin Scout 42/60, Field Rat 10/20, Road Slime 30/90 vs Aldric L5, Mira L4, Tomas L5`
- `plugins/promptfall/hooks/stage/compose.test.ts` (create): the ground strip fills the bottom two pixel rows in the zone's colour; a transparent sprite pixel leaves alpha 0; an actor at alpha 0.5 shows about half its pixels (40 to 60 percent); with `numbers: true` a number draws `font.ts` glyphs at its position and with `numbers: false` nothing there; `artFrame` of a 16 × 16 art is 16 × 16; `font.ts` has 11 glyphs of 3 × 5; `fnv1a64('')` is `'cbf29ce484222325'`

**Interfaces:**
- Consumes: Task 2's view fields, Task 3's sprites.
- Produces: `layoutFor`, `sameLayout`, `Layout`, `Box`, `StageTimeline`, `Motion`, `Known`, `stageAt`, `StageModel`, `StageActor`, `StageNumber`, `StageDrop`, `composeFrame`, `artFrame`, `Frame`, `drawText`, `fnv1a64`, the fixtures.

**Work:** Pure functions and one class with no clock of its own (every method takes `now`). Internal structure is the implementer's choice; the placement, motion and number rules under "Stage" are binding.

**Acceptance check:** `claude plugin test plugins/promptfall` green with the four new test files; `pnpm exec tsc -p plugins/promptfall` clean. Red before: the modules do not exist.

**Boundaries:** No encoder, no `$`, no band change. `tuning.ts` values are the ones listed; a value that proves wrong is a deviation to report, not to change silently.

- [x] `tuning.ts`, `font.ts`, `hash.ts`, `fixtures.ts`; `layout.ts` with `layout.test.ts`; `timeline.ts` with `timeline.test.ts` red then green
- [x] `model.ts` with `model.test.ts`; `compose.ts` with `compose.test.ts`; run the acceptance check; commit `feat(stage): layout, timeline, model and compositor`

### Task 5: The three encoders and the golden frames

**Files:**
- `plugins/promptfall/hooks/stage/raster.ts`, `image.ts`, `svg.ts` (create): the contracts above; `raster.ts` carries the MIT attribution comment for the half-block packing
- `plugins/promptfall/NOTICE.md` (create): the claude-toons MIT notice (copyright 2026 Anshu Chimala) and what was borrowed: the half-block cell packing, the Bayer alpha rule, the blit loop shape
- `scripts/stage-goldens.ts` (create): `tsx scripts/stage-goldens.ts` writes `plugins/promptfall/hooks/stage/goldens/index.ts` exporting `GOLDENS: Record<scenario, { rasterHash, imageHash, svgHash, svgChars, rasterPairs }>` (`fnv1a64`; `imageHash` over `encodeImage(frame, 1)` so Task 6's `IMAGE_SCALE` does not move it; `svgHash` over `renderSvg` with `smil: true`, `motion: 'full'`, `width: 960`) and `goldens/<scenario>.svg` for eyeballing; scenarios at `now = 1_000_000`: `rest` (wave, 120 × 8, no motions), `boss` (boss, 120 × 17, spawn at its midpoint), `compact` (wave, 52 × 4), `dissolve` (wave with the slot-0 enemy departed, its dissolve at its midpoint, two numbers live), `drop` (the same with the drop pop at its midpoint)
- `package.json` (modify): script `stage:goldens: tsx scripts/stage-goldens.ts`
- `biome.json` (modify): `"!plugins/promptfall/hooks/stage/goldens"` in `files.includes`
- `plugins/promptfall/hooks/stage/goldens/index.ts`, `*.svg` (create, generated)
- `plugins/promptfall/hooks/stage/raster.test.ts` (create): one cell per case: both pixels opaque gives `▀` with fg top and bg bottom; top only gives `▀` with bg `CLEAR`; bottom only gives `▄`; neither gives a space with both `CLEAR`; the cell count is `columns * rows`; a number at `(x, y)` replaces the cell at `(floor x, floor y/2)` with its glyph and a number at the frame's last row stays inside; `rasterPairs` counts distinct pairs
- `plugins/promptfall/hooks/stage/image.test.ts` (create): `scale 1` round-trips the frame bytes; `scale 2` doubles both dimensions and repeats each pixel 2 × 2; `imageBytes` equals `width * height * 4 * scale²`
- `plugins/promptfall/hooks/stage/svg.test.ts` (create): the string starts with `<svg` and ends with `</svg>`, every opened tag closes (a stack walk over the tags in the test, no parser dependency), `viewBox` reads `0 0 120 16` for the rest scenario, each distinct art stem appears once as a `<g id=`, one `<path` per colour in it, the rarity colour's path has `fill="currentColor"`; with `smil: true` a lunge started 100 ms before `now` yields one `<animateTransform` with `begin="-0.1s"`, a motion with `until <= now` yields nothing, a flash yields a `filter="url(#flash)"` `<use>`, a drop yields an animated `<use>`; with `smil: false` no `<animate` appears; with `motion: 'full'` and no motions the bob's `<animateTransform` is present and with `'still'` absent
- `plugins/promptfall/hooks/stage/golden.test.ts` (create): the five scenarios hash-match `GOLDENS` on every field; budget assertions on every scenario: `svgChars < SVG_MAX_CHARS`, `rasterPairs <= RASTER_MAX_PAIRS`, `imageBytes(frame, IMAGE_SCALE) <= IMAGE_MAX_BYTES`; plus two worst cases built in the test under the same three budgets: the concept boss at 160 × 17 with three heroes lunging, three numbers and a drop; and an adversarial legal-art case with a 48 × 34 two-colour checkerboard boss, three distinct 16 × 16 checkerboard heroes with distinct palettes, and a checkerboard drop

**Interfaces:**
- Consumes: Task 4.
- Produces: `encodeRaster`, `rasterPairs`, `CLEAR`, `encodeImage`, `imageBytes`, `renderSvg`, `GOLDENS`.

**Work:** The Raster packing is the claude-toons rule verbatim (record facts). Cells are `Uint32Array` triplets through `base64.encode`. The SVG keeps its size by emitting each art stem once as paths and `<use>`ing it; integer coordinates only; no `<image>`, no `<script>`, no event attributes. Regenerate the goldens only with `pnpm stage:goldens` and only when a scenario's drawing is meant to change; a golden change is called out in the commit message.

**Acceptance check:** `pnpm stage:goldens` then `claude plugin test plugins/promptfall` green including `golden.test.ts`; running `pnpm stage:goldens` again changes no file (`git status --porcelain -- plugins/promptfall/hooks/stage/goldens` empty); `pnpm lint` clean. Red before: the encoders do not exist.

**Boundaries:** No band change, no loop, no `$`. Do not add a dependency for XML or hashing.

- [x] `raster.ts` with `raster.test.ts` red then green; `NOTICE.md`
- [x] `image.ts`, `svg.ts` with their tests
- [x] `stage-goldens.ts`, the goldens, the biome exclusion, `golden.test.ts` with the budgets; run the acceptance check; commit `feat(stage): raster, image and svg encoders; golden frames and budgets`

### Task 6: The band draws the stage

**Files:**
- `plugins/promptfall/hooks/stage/tuning.ts` (modify): `IMAGE_SCALE`, `SVG_SMIL`, the probe's alt deny text as `PROBE_ALT_DENY`, and, if the spike said so, the renderer default, from Task 1's findings
- `plugins/promptfall/hooks/stage/loop.ts` (create): `StageLoop`
- `plugins/promptfall/hooks/stage/loop.test.ts` (create): with a fake `LoopIo` and the mock clock: a mounted raster site blits within `EVENT_FRAME_MS` after `wake()` and every `EVENT_FRAME_MS` while busy, every `IDLE_FRAME_MS` at rest; `mount(null)` then `clock.advance(5_000)` adds no blit; a layout change invalidates once and blits nothing until a new mount; a deny stops the blits until the next mount; a tick that spans a `mount(null)` during its `view()` await blits nothing; with `motion: 'still'` one settled blit follows the last motion and then none; an `'svg'` site invalidates at `SVG_FALLBACK_FRAME_MS` while busy and never at rest
- `plugins/promptfall/hooks/state.ts` (modify): `SETTINGS_DEFAULT`
- `plugins/promptfall/types/index.d.ts` (modify): `Renderer`, `Settings`, the two `PluginState` keys
- `plugins/promptfall/hooks/engine.ts` (modify): `GameHandle.stage`
- `plugins/promptfall/hooks/register.tsx` (modify): the io additions; `GameSession` owns the timeline and the per-surface loops; `onEffects` feeds and wakes; `session.start` on a terminal reads `settings` from the store into the settings atom (declared in `register.tsx`) and, with `settings.renderer` not `'auto'`, writes the renderer atom; `reset()` keeps `SETTINGS_KEY`; `registerBand(on, () => game)`
- `plugins/promptfall/hooks/ui/band.tsx` (modify): declares the `renderer` and `settings` atoms it reads; the Party tab per spec §10 through `layoutFor`: `timeline.observe(view, now)` first, then the layout, then the stage element (`Raster key="stage"` or `Image key="stage"` by the renderer atom, `Svg key="stage"` when `e.surface !== 'terminal'`, with `isInteractive={SVG_SMIL}` and `motion` from settings), the first frame composed in the hook so a redraw is never blank, the party line, the status row; the compact layout (today's three hero rows with their enemy slot and the status row at the left in `bodyColumns − COMPACT_STAGE_COLUMNS` columns, the compact stage at the right); the collapsed row for `kind: 'collapsed'`; the probe as specified; `game.stage.loopFor(e.surface).mount(...)` on every render of the Party tab's full or compact layout with the site's layout and renderer, `mount(null)` on the Loot and World tabs, collapsed, hidden, off, or `view === null`; on the Svg path with `SVG_SMIL` true the hook passes `timeline.active(now)` to `renderSvg` and mounts nothing; with `SVG_SMIL` false it mounts an `'svg'` site; the world boss's predicted HP arithmetic from `band.tsx:182-200` moves into the party line's enemy segment
- `plugins/promptfall/hooks/ui/parts.tsx` (modify): `PartyLine(els, view, world, width)`: three hero segments `<name clipped to 8> L<level> <HpBar of 6 cells> <hp>/<max>` (27 columns each, a fallen hero's name dim), joined by ` · `, then the enemy segment in the remaining `width − 90` columns, right-aligned and truncated: `⚔ <front enemy name> <hp>/<max>`, or in boss mode `⚔ <boss name clipped to 12> <HpBar of 6 cells> <shownHp>/<maxHp>` with phase 3's `shownHp` and `baseline`; `HpBar` takes an optional width (default 10)
- `plugins/promptfall/hooks/band.test.ts` (modify): the harness stubs `ui.blit` (recording calls, answering `{}`), `ui.invalidate` (recording, then `next(e)`) and `audio.play`; on `terminal` with the renderer atom `'raster'`, `bodyColumns 120`, `maxRows 20`: the band has 10 rows, a `Raster` keyed `stage` of `120 × 8`, the party line reads the three heroes and `⚔`; with a zone boss in view the band has 19 rows and the Raster `120 × 17`; with a turn boss 14 and `120 × 12`; with `maxRows 12` and a zone boss the compact layout: 4 rows and a Raster `52 × 4`, and after the boss departs and its motions end (`clock.advance(DISSOLVE_MS + DROP_MS + 1)`) the full 10-row layout again; with `bodyColumns 110` the compact layout with the enemy slot text in the hero rows; with `bodyColumns 99` one row; with the renderer atom `'image'` an `Image` keyed `stage` with `columns 120`, `rows 8` and a non-empty `alt`; with `'unknown'` no stage element and a 1 × 1 `Image` keyed `probe` in the status row; on `desktop` an `Svg` keyed `stage` with `isInteractive` equal to `SVG_SMIL` and the alt; Loot and World tabs stay 4 rows with no stage element and the blit stub sees no call over `clock.advance(5_000)`; on the Party tab, after a `hit` effect, the blit stub sees at least 10 calls over `clock.advance(1_000)` with `requestId` equal to the render's and `key 'stage'`; with `motion: 'still'` and no effects no calls over `clock.advance(5_000)`; with `hasSurvey` true none
- `plugins/promptfall/hooks/register.test.ts` (modify): the probe: on a terminal start with `settings.renderer 'auto'` the first Party-tab render mounts the probe, a blit stub answering `{}` sets the renderer atom to `'image'` after `clock.advance(PROBE_DELAY_MS)` and the blit it saw carried a source different from the mounted one; a stub answering `{ deny: PROBE_ALT_DENY }` sets `'raster'`; a stub answering `{ deny: 'nothing mounted' }` leaves `'unknown'` and a later render arms a second probe; with `settings.renderer 'raster'` no probe blit is sent; a render that draws no probe (collapsed) arms nothing; `onEffects` with a `hit` wakes the loop (a blit follows within `EVENT_FRAME_MS`)
- `plugins/promptfall/README.md` (modify): a "Stage" section: the renderers per terminal, the probe, the heights, the compact and collapsed rules, the renderer override

**Interfaces:**
- Consumes: Tasks 1 to 5.
- Produces: the phase 4 band.

**Work:** The render hook never blits; the loop does. The hook's job is to observe, pick the layout, mount the right element at the right size and tell the loop. The band's height is the layout's `bandRows`; the loop invalidates when the layout changes, so grow and shrink are redraws and every frame between is a blit. Secondaries stay collapsed (`mode !== 'primary'`) as today and mount nothing. The alt text is `model.alt`.

**Acceptance check:** `claude plugin test plugins/promptfall` green with the loop, band and register tests on both surfaces; `claude plugin validate plugins/promptfall` lists `ui.blit` and `ui.invalidate` beside the phase 3 calls; `pnpm exec tsc -p plugins/promptfall` clean. Red before: `band.test.ts` finds no `Raster` keyed `stage`.

**Boundaries:** No sound, no Account tab change, no command change (Task 7). No dialog change (Task 8). The geometry comes from Task 4; the band computes none of its own. `blocked: spike findings needed` at the first checkbox if `docs/plans/2026-10-04-phase-4-spikes.md` has an empty findings table.

- [x] Tuning from the spike findings; `Renderer`, `Settings`, `PluginState`, `SETTINGS_DEFAULT`; `loop.ts` with `loop.test.ts` red then green (`IMAGE_SCALE = 6`, `PROBE_ALT_DENY` as a prefix; `SVG_SMIL = true` provisional until the desktop row is filled)
- [x] `PartyLine`; the Party tab with the stage, compact and collapsed layouts, the probe; `band.test.ts` red then green on both surfaces
- [x] io additions, `GameHandle.stage`, `GameSession` wiring, `reset()`; `register.test.ts`; README; run the acceptance check; commit `feat(plugin): the stage in the band on raster, image and svg`

### Task 7: Cues, the sound and motion settings, the commands

**Files:**
- `scripts/placeholder-cues.ts` (create): writes four 16-bit mono 22,050 Hz WAVs of 160 ms square waves at 440, 660, 880 and 220 Hz with a linear fade-out, to `plugins/promptfall/cues/drop.wav`, `legendary.wav`, `level_up.wav`, `boss.wav`; `package.json` script `cues:placeholders`
- `plugins/promptfall/cues/*.wav` (create, generated; PR 2 replaces them with the CC0 picks)
- `plugins/promptfall/hooks/cues.ts` (create): `Cue`, `cueFor(effect: Effect): Cue | null` (`drop` with rarity `rare` or `epic` answers `'drop'`, `legendary` answers `'legendary'`, `level_up` answers `'level_up'`, everything else null) and `CUE_ASSET: Record<Cue, string>` (`cues/<cue>.wav`)
- `plugins/promptfall/hooks/world.ts` (modify): `bossTransition` returns `{ kind: 'appeared' | 'down'; text: string } | null`; the poller's deps gain `cue: (cue: Cue) => void`, called with `'boss'` on `kind: 'appeared'` beside the toast (`world.ts:165`)
- `plugins/promptfall/hooks/register.tsx` (modify): `onEffects` plays `cueFor(effect)` after its toast when `role === 'primary'` and `settings.sound`; the poller's `cue` dep plays under the same rule
- `plugins/promptfall/hooks/command.ts` (modify): `sound on|off`, `motion full|still`, `renderer auto|image|raster`, each claiming the lease like the others, writing `settings` to the store and the atom (declared in `command.ts`), answering the texts under "Commands and settings"; a bad argument answers `{ text: 'usage: /promptfall sound on|off' }` and so on
- `plugins/promptfall/hooks/ui/dialog.tsx` (modify): Account tab rows for the three settings with hotkeys `s`, `n`, `x`, each press toggling or cycling and writing the store and the atom (declared in `dialog.tsx`)
- `plugins/promptfall/hooks/command.test.ts`, `dialog.test.ts`, `register.test.ts`, `world.test.ts` if present else `register.test.ts` (modify): the commands write the store key `promptfall:settings` and claim the lease; the Account rows show the state and a press cycles it; a `drop` of rarity `epic` on a primary with sound on sends one `audio.play` with `asset 'cues/drop.wav'` and `gain CUE_GAIN`, a `legendary` sends `cues/legendary.wav`, a `common` sends none, sound off sends none, a secondary sends none; a world-boss appeared transition sends `cues/boss.wav` and a down transition none; `/promptfall off` then an epic drop still sends the cue
- `plugins/promptfall/README.md` (modify): "Sound and motion"

**Interfaces:**
- Consumes: Task 6's settings atom, io `play`.
- Produces: the four cue files, `Cue`, `cueFor`, the three commands, the Account rows.

**Work:** `$.audio.play` is called without await and its rejection swallowed (Linux and Windows reject or resolve with nothing played; either is fine). The test harness stubs it with an `on('audio.play', ...)` hook that records calls (`audio.play` is in the engine's event map, d.ts 6552).

**Acceptance check:** `pnpm cues:placeholders` writes four files under 20 KB each; `claude plugin validate plugins/promptfall` lists `audio.play`; `claude plugin test plugins/promptfall` green with the extended tests; `pnpm exec tsc -p plugins/promptfall` clean. Red before: `register.test.ts` sees no `audio.play` call on an epic drop.

**Boundaries:** No new toast. No cue for zone or turn bosses, wipes or chat. No volume control. Nothing in `stage/`.

- [x] `placeholder-cues.ts` and the four files; `cues.ts`; `bossTransition`'s kind
- [x] The commands and the Account rows with their tests red then green
- [x] `onEffects` and the poller's cue; `register.test.ts`; README; run the acceptance check; commit `feat(plugin): sound cues, the sound, motion and renderer settings`

### Task 8: Sprites in the dialog lists

**Files:**
- `plugins/promptfall/hooks/ui/sprites.tsx` (create): `ListSprite(els, renderer, surface, sprite, alt)`: on `surface !== 'terminal'` an `Svg` of the 16 px art (`renderSvg`-style paths, `width 16 height 16`, the alt); on terminal with renderer `'image'` an `Image` of the 16 px art at `columns 2 rows 1` (`encodeImage(artFrame(art), 1)`); with `'raster'` and a `small` art a `Raster` of it at `columns 8 rows 2`; with `'raster'` and no `small` (heroes) nothing; with `'unknown'` nothing. Encoded cells and sources are cached per sprite id in a module `Map`
- `plugins/promptfall/types/index.d.ts` (modify): `ItemView.base`, `ListingView.base`, `ListingView.cls`
- `plugins/promptfall/hooks/view.ts` (modify): fills them (`view.ts:116-134` for items, `:53` for listings)
- `plugins/promptfall/hooks/ui/dialog.tsx` (modify): the Inventory item rows (`:347-362`) take `ListSprite` of `spriteFor('item', item.base)` before the text, on raster beside both of the item's two lines; the Heroes rows (`:478-488`) take `spriteFor('hero', hero.cls)`
- `plugins/promptfall/hooks/ui/market.tsx` (modify): listing rows (`:190-200`) take the item's or the hero class's sprite by `l.kind`
- `plugins/promptfall/hooks/dialog.test.ts` (modify): on terminal with `'raster'` an inventory row holds a `Raster` of `8 × 2` whose cells equal `encodeRaster(artFrame(spriteFor('item', base).small), [])`; with `'image'` an `Image` of `2 × 1`; on desktop an `Svg` with the item's name as alt; a heroes row on raster holds no `Raster` and its glyph text, and on desktop an `Svg`; a market item listing holds the item sprite and a hero listing the class sprite on desktop and nothing on raster
- `plugins/promptfall/README.md` (modify): one line under "Sprites"

**Interfaces:**
- Consumes: Tasks 3, 5, 6.
- Produces: `ListSprite`, `ItemView.base`, `ListingView.base`, `ListingView.cls`.

**Work:** List sprites are static; nothing blits them, so they carry no `key` beyond the tree's.

**Acceptance check:** `claude plugin test plugins/promptfall` green with the extended dialog tests; `pnpm exec tsc -p plugins/promptfall` clean. Red before: `dialog.test.ts` finds no `Raster` in an inventory row.

**Boundaries:** No change to the Orders, Sell, Chat, Leaderboards or Odds tabs. No band change.

- [x] `sprites.tsx`; the three view fields in `types` and `view.ts`
- [x] Inventory, Heroes, Market rows; `dialog.test.ts` red then green; README; run the acceptance check; commit `feat(plugin): item and hero sprites in the Inventory, Heroes and Market lists`

### Task 9: PR 1: manual pass part A, docs, pull request

**Files:**
- `docs/manual-pass/phase-4.md` (create): part A, per surface. Ghostty: the probe lands on `image` (Account tab shows `Renderer: auto (image)`), the stage draws crisp sprites at 10 rows, a turn boss grows the band to 14 and a zone boss to 19 and both shrink back after the dissolve and the drop pop, hits lunge and flash with numbers, an epic drop pops out and toasts, `/promptfall sound on` then a Rare drop plays `drop.wav`, `/promptfall motion still` stops the bob, a 110-column window shows the compact stage, 99 columns one row, `/promptfall off` hides the band and a later Rare drop still plays. iTerm2 and Terminal.app: the probe lands on `raster`, the same steps on half-blocks, numbers as text. tmux inside Ghostty: `raster`. Desktop app: the Svg, SMIL motion per the spike finding, the sprites in the Inventory. For each step: what to type, what to see.
- `docs/plans/2026-10-04-promptfall-phase-4.md` (modify): tick the tasks; record every deviation reported during execution under "Spec conflicts and narrowings"
- `README.md` (root, modify): the phase 4 PR 1 status line
- `docs/spec/promptfall.md` (modify only if a task reported a deviation that the spec must carry)

**Interfaces:**
- Consumes: everything above.
- Produces: the PR.

**Work:** Run the full check line. Run the real-surface checks through `codex-computer-use` against the running desktop app and Ghostty where it can drive them, before the PR is opened. Open the PR against `ai-staging` with the manual-pass steps in the description, say which checks ran, and stop: the review is Kevin's to trigger.

**Acceptance check:** The full check line clean on the PR's head; `gh pr view` shows the PR open against `ai-staging`. Red before: no PR.

**Boundaries:** No merge. No new features. Nothing from PR 2.

- [x] `docs/manual-pass/phase-4.md` part A; README status; tick the tasks
- [x] `codex-computer-use` check; the full check line; push; open the PR; stop. The codex run on Terminal.app passed the layouts and failed the colours: Terminal.app paints Raster cells in black and grey, an engine and terminal limit (the same cells draw in colour in Ghostty's engine); recorded in the manual pass

## Spec conflicts and narrowings

1. **PR 2 gets its own plan after PR 1 merges.** Its prompts, slicer settings and contact page depend on the pipeline as PR 1 leaves it. The phase 3 precedent of both PRs in one file is not followed. The hand-over for that plan is below.
2. **Slicing is a tool step, not the build.** Record §1.8 says the build slices and palette-locks the sheets. Here `pnpm slice` cuts a sheet into per-sprite PNGs committed under `art/`, and `pnpm sprites` builds from those, because the hand cleanup in Aseprite or Pixelorama (heroes and world bosses) needs individual files and a build must be a pure function of committed input.
3. **Every downsample happens in the build** (record §1.11: automatic, in the build): the compact variants, the 8 × 4 list sprites, and `fit` for the turn-boss placeholders. The runtime only upscales for `Image`.
4. **The view carries actor ids, the hero's rarity, and item bases.** `EnemyView.id` and `.def`, `HeroView.rarity`, `ItemView.base`, `ListingView.base` and `.cls` are new; the stage and the lists key sprites and motions on them. The world boss keys its sprite on its name through `worldBossKey`, since `WORLD_BOSSES` has names and glyphs only.
5. **A renderer override** `/promptfall renderer auto|image|raster` is added, per machine in `settings`, so the manual pass can force a path and so record §1.2's fallback (Raster everywhere) has a switch if the spike finds a terminal that answers `{}` without drawing pixels. It applies at the next session start.
6. **The Svg dissolves and spawns by opacity**, not by the Bayer pattern the pixel surfaces use; SMIL has no per-pixel threshold. Flash is a white-filtered copy's opacity; a fallen hero is opacity 0.5.
7. **Dialog hero rows on raster keep the glyph.** Record §1.10 defines the 2-row sprite for items only; a hero at 8 × 4 reads as nothing, and CONTEXT.md keeps the glyph as a sprite's fallback outside the stage. Items get the 2-row sprite; heroes get sprites on Image and Svg only, in the Heroes and Market lists.
8. **The frame loop re-arms one `clock.after` per tick** rather than sleeping in a detached loop (the claude-toons shape), so no wait runs against a hook's budget and `mount(null)` cancels one timer. `onEffects` wakes it, so the first lunge of a round draws.
9. **The 64-colour SNES master is derived in PR 1** from the four concept bosses and committed. PR 2's style-sheet gate may replace it once, before mass generation, and must then re-run `pnpm sprites`.
10. **Hits within a round are staggered `HIT_STAGGER_MS` apart** in sim order, so a 6-hit round plays over about a second inside the 2-second turn cadence. The record names 12 frames a second and nothing about ordering.
11. **A fallen hero is drawn in place with a halved palette**; there is no lying-down art. Record §1.9's dissolve is for enemies.
12. **The world boss's predicted HP moves to the party line.** Phase 3's narrowing 35 gave it two rows of the enemy column; the Party tab no longer has that column in the full layout. The arithmetic (`shownHp`, `baseline`) is unchanged, and the segment keeps a 6-cell global bar (spec §10). The compact layout keeps today's hero rows with their enemy slot, so the front enemy is named there.
13. **While the renderer is unknown the Party tab draws empty stage rows**, so the band's height does not jump when the probe lands within `PROBE_DELAY_MS`. Only a deny naming the alt settles on raster; any other deny re-arms the probe.
14. **`IMAGE_MAX_BYTES` is 1 MiB**, half the engine's 2 MiB cap; `IMAGE_SCALE` is at most 6.
15. **Compact stage width is 52 columns** at the band's right: three 8 px enemies at pitch 8, a 4 px gap, three heroes. The hero rows and status row keep today's layout in the remaining width (48 columns at 100).
16. **Secondary sessions draw no stage.** They are collapsed today (`mode !== 'primary'`); unchanged.
17. **The cue for a world boss appearing comes from the poller's transition**, where the toast already comes from (`world.ts:165`), not from an effect.
18. **Damage numbers float inside the frame**, over the actor's upper body, because the rest stage is exactly as tall as its sprites. The record says "damage numbers on every surface" and nothing about a lane.
19. **Slots are stable through a departure.** A departed enemy keeps its slot until its dissolve and drop end, survivors keep theirs, and a new enemy takes the lowest free slot; the sim's compacted `encounter.enemies` order does not move sprites mid-dissolve.
20. **The Svg emits one `<path>` per colour per art stem**, about 12 characters a run, so a dithered 48 × 34 boss stays far under 131,072 characters; run-length `<rect>`s would not.
21. **The desktop fallback (`SVG_SMIL` false) drops the idle bob**: redraws at 6 a second only while a motion is live. The record allows "redraws at most 6 a second" and the bob at rest would be redraws for nothing.
22. **The settings commands claim the lease** like every other subcommand, so the session that typed `/promptfall sound on` is the primary that plays; the Account tab's rows run in the session that opened the dialog, which claimed it too.
23. **Glossary names.** CONTEXT.md avoids "scene" and "icon": the code says `StageModel`, `stageAt`, `small` and `ListSprite` where the record says scene and icon.
24. **The probe matches the alt deny as a prefix.** The engine's deny for a terminal without pictures ends with its cause in parentheses, which differs per terminal (`(env: terminal=Apple_Terminal, not asked yet, no answer)`), so `PROBE_ALT_DENY` is the fixed part, `the Image draws its alt here: the terminal draws no placeholder images`, and the probe settles on raster when the deny starts with it.
25. **The spike ran on two surfaces before Kevin's run.** The implementing session drove cmux (Ghostty's engine) through its CLI and Terminal.app through AppleScript, recorded both rows, and set `IMAGE_SCALE = 6` from a window capture of the scales. iTerm2, tmux, standalone Ghostty and the desktop app are not installed on that Mac; their rows, and `SVG_SMIL` (kept `true`, as `SvgProps.isInteractive` documents SMIL), wait for Kevin's manual pass.
26. **`StageSite` carries the band's props** (`{ bodyColumns, maxRows }`), so a tick can recompute the layout with `layoutFor` as the contract says; the contract's site had no props to compute it from.
27. **`onEffects` carries the event time.** `GameEngine`'s dep is `onEffects(effects, at?)`: `apply` passes the event's `at`, a delivery passes nothing and the session uses the last `at`. The timeline is fed synchronously, before the render that observes the same step's view.
28. **`ListSprite` takes the row's key as a sixth argument.** `Raster` requires a key unique in its tree, and one sprite repeats across rows.
29. **A batch plays each distinct cue once, in effect order** (a kill that drops an Epic and levels a hero plays `drop` and `level_up`); clips overlap rather than queue.
30. **The Svg's lunge keeps the idle art.** SMIL has no cheap sprite swap; PR 1 aliases every attack pose to the idle art, so nothing shows. PR 2 decides when real attack poses land.
31. **Smaller additions.** `stage/scenarios.ts` holds the golden scenarios that `golden.test.ts` and `scripts/stage-goldens.ts` share; `parseSettings` and `settingCommand` live in `state.ts`; a desktop attach reads the settings too (for the motion setting); `types/index.d.ts` aliases `Settings` and `Renderer` outside the `claude-code` augmentation, where `Settings` names the engine's own export; a forced renderer reads `Renderer: raster (from next start)` on the Account tab.

## Out of scope

PR 2 (the style sheet, the ~124 sprites, the CC0 cue clips, hand cleanup); per-zone backdrops beyond the ground strip; sextant or braille rendering; sprites on the Loot and World tabs, the collapsed row, toasts or chat; a volume control; cues on Linux or Windows (the engine plays nothing there); equipment drawn on heroes; heal or buff motion; a headless browser smoke for the Svg (none exists in the repo; the goldens' `.svg` files and the desktop check through `codex-computer-use` stand in); attack poses as separate art (PR 1 aliases them to the idle art); caching the Svg string across re-renders (negative `begin` offsets make a re-render resume mid-motion, so the cache would only save work).

## Hand-over for the PR 2 plan

What PR 1 leaves for the art plan: `art/manifest.json` with one entry per content id, every entry an alias in PR 1; `pnpm slice` with `--grid`, `--row`, `--size` or `--fit`, `--colours` and `--names` for cutting a generated sheet into PNGs; `pnpm sprites` with the palette and canvas rules and `PLACEHOLDER_COUNT` in the generated module (PR 2's exit is `PLACEHOLDER_COUNT === 0`, asserted in a test it adds); `art/palettes/snes.json` to confirm or replace at the style-sheet gate; `plugins/promptfall/cues/*.wav` to replace with the Juhani Junkala picks; the contact page is PR 2's to build (a script that tiles a zone's sliced PNGs at 4× with their ids, for Kevin's review); the codex-image prompts from the record (§2: a strict grid on pure magenta, "no text, no grid lines", about 135 to 180 s a run); the adversarial Svg budget test in `golden.test.ts`, which PR 2's real art must keep green.
