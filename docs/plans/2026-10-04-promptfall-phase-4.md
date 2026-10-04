# Promptfall phase 4 implementation plan: PR 1, the engine

**Goal:** The band's Party tab draws an animated pixel-art battle stage in every terminal and on the desktop, plays four sound cues, and shows item icons in the dialog lists, all on the grill's concept sprites as placeholders.
**Architecture:** Source PNGs under `art/` become one committed, generated TypeScript module of indexed sprites (`scripts/sprites.ts`, checked stale in CI like the vendor bundle). At runtime a pure stage model turns the game view plus a timeline of motions (fed by the sim's new output-only `hit` effect and by diffs of the enemy list) into a `Scene`; one compositor turns a scene into an RGBA frame; three encoders turn that into what each surface draws: half-block `Raster` cells, an `Image` RGBA source, or an `Svg` string with SMIL. A frame loop blits the Raster or Image at 12 frames a second during motion and 2 at rest; the desktop redraws once a round. The band grows with the stage (ADR 0003) and chooses its renderer by probing one keyed `Image` with a blit.
**Spec:** `docs/spec/promptfall.md` (§2, §3, §10, §11, §12 as amended on 2026-10-04), `docs/plans/2026-10-04-phase-4-grill.md` (the record: §1 decisions, §2 facts, §3 the spikes), `docs/adr/0003-band-grows-for-the-stage.md`, `CONTEXT.md` (Stage, Sprite, Cue)
**Execution model:** opus
**Review wave:** pending: `reviewer` on opus, `reviewer` on fable, `codex-review` on gpt-6-astra at xhigh, consolidated into one fix pass; no second wave.
**Delivery:** This plan is PR 1 of phase 4 (spec §12: the engine), Tasks 1 to 9 on `feat/phase-4`, which already holds the grill docs, into `ai-staging`. PR 2 (the art: the style-sheet gate, the sprites zone by zone, the cue clips) gets its own plan after PR 1 merges, for two reasons the record's §1.8 loop forces: every zone is a generate, slice, contact page, Kevin reviews, regenerate loop with no fixed task count, and its prompts and slicer settings depend on the pipeline as PR 1 leaves it. The hand-over facts PR 2 needs are at the end of this plan. No `SIM_VERSION` bump and no reset in PR 1. Red between tasks: Task 2 leaves `pnpm vendor:check` stale until its own `pnpm vendor`; Task 3 adds `pnpm sprites:check` and is the first commit where it passes; from Task 2's view-type change to the end of Task 2 the plugin does not type-check (`view.ts` must fill the new fields in the same task); Tasks 4 and 5 are pure modules and green on their own; Task 6 is the first commit where the band draws the stage. Each task's last commit is clean on the full check line: `pnpm lint && pnpm typecheck && pnpm test && pnpm vendor:check && pnpm sprites:check && pnpm exec tsc -p plugins/promptfall && claude plugin validate plugins/promptfall && claude plugin test plugins/promptfall`.

## Global constraints

- Everything in the phase 3 plan's global constraints still holds (`docs/plans/2026-10-03-promptfall-phase-3.md`, "Global constraints"), with these changes: `SIM_VERSION` stays `3` (record §1.12: `hit` is output only, effects feed neither the hash nor the goldens, the ledger reads only `rejected`; `packages/sim/src/golden.ts:75` `GOLDEN_HASH = '21ecdbaf9e864e9d'` is unchanged and a test says so); the `$` call list grows by exactly `ui.blit`, `ui.invalidate` and `audio.play` (spec §2 footprint: "interface (including images and sound from the mod's own files), state, store, clock, HTTP and commands"); no `$.fs`, `$.process`, `$.env` or `$.model`.
- Spec §2 and ADR 0003: the band on the Party tab is `8 + 2` rows at rest, `12 + 2` with a turn boss on the stage, `17 + 2` with a zone or world boss; it shows the full stage only when `bodyColumns >= 116` and `maxRows >= stageRows + 2`; otherwise the 4-row compact stage when `bodyColumns >= 100` and `maxRows >= 4`; otherwise 1 row. Hidden while `hasSurvey`; off under `/promptfall off`. Loot and World tabs keep 4 rows. A boss arriving never switches the tab.
- Spec §3 and record §2: `Image` draws pixels on kitty and Ghostty only, `alt` elsewhere, no capability flag; `$.ui.blit` denies on an Image drawing its alt. `Raster` is terminal only: `columns` 1 to 512, `rows` 1 to 256, cells as base64 of little-endian u32 triplets `[codePoint, fg, bg]`, colours `0x00RRGGBB` or `0x01000000` for the terminal's default, 1024 distinct colour pairs at once. `ImageSource` `{ rgba, width, height }` is base64 of `width * height * 4` bytes, at most 2 MiB decoded, width and height 1 to 2048. `Svg.source` is at most 131,072 characters; `isInteractive` runs SMIL in a sandboxed frame. `$.ui.blit` takes 120 calls a second, shows about 60, and answers `{}` or `{ deny }`. `$.audio.play({ asset }, { gain })` plays a plugin file through `afplay` on macOS and nothing on Linux or Windows; clips do not queue.
- Spec §10 motion: about 12 frames a second during an event, the idle bob at 2 a second, nothing while the band is hidden, collapsed or on another tab. The desktop redraws once a combat round. The motion setting `full | still`, default `full`; `still` drops the idle bob only.
- Spec §10 sound and record §1.5: four cues, each a strict subset of a toast: `drop` (Rare and Epic), `legendary` (Legendary drop), `level_up`, `boss` (world boss appeared). Fixed gain `0.6`. Off by default; per machine in `$.store`; only the primary plays; `/promptfall off` hides the band, not the cues.
- Spec §11 palettes: NES sprites at most 4 colours including the outline, every colour from the NES master palette; SNES bosses at most 16 colours each from one shared 64-colour master; the build fails a sprite that breaks either rule. Heroes and monsters 16 × 16; bosses up to 48 × 34; turn bosses fit 24 px tall (12 rows); the compact stage's sprites fit 8 px tall; item icons 16 × 16 on Image and Svg and 8 × 4 in half-block terminals.
- Record §1.12 verification: golden frames per renderer under the mock clock (Image RGBA hash, Raster cells hash, Svg string) for wave at rest, boss grow, compact, mid-dissolve and drop pop; budget tests (Svg under 131,072 characters, Raster under 1,024 colour pairs, Image under `IMAGE_MAX_BYTES`, zero blits while hidden); a manual pass in Ghostty, iTerm2, Terminal.app, tmux and the desktop app; real-surface checks through `codex-computer-use` before PR 1 is called done.
- Record §1.8 and spec §11: nothing third-party ships except CC0 cues. The claude-toons technique is borrowed with its MIT notice (`plugins/promptfall/NOTICE.md`); none of its Clawd art is.
- Tuning numbers live in named files and nowhere else: `plugins/promptfall/hooks/stage/tuning.ts` (the stage geometry, motion timings, frame cadences, budgets, rarity and ground colours, the cue gain), `art/palettes/nes.json` and `art/palettes/snes.json` (the master palettes), `scripts/sprites.ts` (nothing tunable: it reads the manifest and the palettes). Tests import them rather than repeating the values.
- Pure modules under `plugins/promptfall/hooks/stage/` and `hooks/sprites/` import nothing from `claude-code` but types, use no `$`, no platform global beyond `Math`, `Uint8Array`, `Uint8ClampedArray` and `Uint32Array`, so `scripts/stage-goldens.ts` can run them under `tsx`.
- Branch flow: `feat/phase-4`, PR into `ai-staging`; nothing lands on `main`.

## Shared contracts

Load-bearing shapes. Later tasks import them by these exact names.

### Sim: the `hit` effect (`packages/sim/src/types.ts`)

```ts
| { k: 'hit'; by: string; target: string; amount: number }
```

`by` and `target` are actor ids: a hero's `Hero.id` or an enemy's `Enemy.id`, on either side. One per `hitEnemy` call (pushed before the world-boss early return, so boss-mode hits report too) and one per enemy attack in `enemyAct`. A white mage heal pushes nothing. Order within a round is the actors' order, so the stage replays a round in sim order.

### View additions (`plugins/promptfall/types/index.d.ts`)

```ts
export type HeroView = { ...today; rarity: string }
export type EnemyView = { ...today; id: string; def: string }   // def: the content id; for a world boss, 'world_boss'
export type Prefs = { collapsed: boolean; bandTab: BandTab }    // unchanged
export type Renderer = 'unknown' | 'image' | 'raster'
export type Settings = { sound: boolean; motion: 'full' | 'still'; renderer: 'auto' | 'image' | 'raster' }
```

`Settings` live in `$.store` under `promptfall:settings` through `KvStore` (`hooks/storage.ts`), default `{ sound: false, motion: 'full', renderer: 'auto' }`, and are mirrored into an atom `settingsAtom` (`{ plugin: 'promptfall', key: 'settings' }`) for the drawings. A server switch (`register.tsx:367-368`) keeps `settings` as it keeps `lease`. `rendererAtom` (`{ plugin: 'promptfall', key: 'renderer' }`, a `Renderer`, initial `'unknown'`) is per session.

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
  full: SpriteArt            // as drawn on the full stage or in a 16 px list icon
  compact: SpriteArt         // at most 8 px tall, width scaled to keep the aspect, for the compact stage
  icon: SpriteArt | null     // 8 × 4, items only
  /** true while the manifest aliases this id to a concept sheet sprite */
  isPlaceholder: boolean
}

// sprites/generated.ts (written by `pnpm sprites`; never edited)
export const ART: Readonly<Record<string, { full: SpriteArt; compact: SpriteArt; icon: SpriteArt | null }>>   // by art stem
export const SPRITES: Readonly<Record<string, Sprite>>                                                        // by sprite id
export const SPRITE_COUNT: number
export const PLACEHOLDER_COUNT: number

// sprites/index.ts
export function spriteFor(kind: SpriteKind, key: string): Sprite   // an unknown key answers SPRITES['fallback'] (a 16 × 16 two-colour crate, drawn in the build from `art/fallback.png`), never throws
export function worldBossKey(name: string): string                  // lowercase, every run of non [a-z0-9] becomes '_', trimmed: 'The Promptwyrm' → 'the_promptwyrm'
export function decodePixels(art: SpriteArt): Uint8Array           // width * height indices

// sprites/base64.ts: encode(bytes: Uint8Array): string, decode(s: string): Uint8Array; standard padded base64, hand-rolled, no atob or Buffer
```

`art/manifest.json`:

```json
{
  "palettes": { "nes": "palettes/nes.json", "snes": "palettes/snes.json" },
  "sprites": [
    { "id": "hero:knight",         "file": "heroes/knight.png",         "style": "nes",  "rarityColor": "#ff00ff" },
    { "id": "hero_attack:knight",  "file": "heroes/knight-attack.png",  "style": "nes",  "rarityColor": "#ff00ff" },
    { "id": "enemy:road_slime",    "alias": "concept/nes-tank",         "style": "nes" },
    { "id": "enemy:bandit_captain", "alias": "concept/snes-boss-0",     "style": "snes" },
    { "id": "enemy:wild_boar",     "alias": "concept/snes-boss-0",      "style": "snes", "fit": { "height": 24 } },
    { "id": "world_boss:the_promptwyrm", "alias": "concept/snes-boss-3", "style": "snes" },
    { "id": "item:iron_sword",     "alias": "concept/item-weapon",      "style": "nes" }
  ]
}
```

One entry per sprite id. `file` names a PNG under `art/` holding that sprite at true size; `alias` names a PNG stem under `art/concept/` and marks the sprite a placeholder. `rarityColor` is the exact colour in the source PNG whose palette index becomes `raritySlot` (the build fails a hero whose PNG lacks it). `fit` downsamples the source to fit the box. The build fails on a duplicate id, an unknown style, a missing file, or an id the content does not know, and fails when any content id lacks an entry: the ids it expects are every `HeroClass` as `hero:` and `hero_attack:`, every key of `content.enemies` as `enemy:`, every `WORLD_BOSSES[i].name` through `worldBossKey` as `world_boss:`, every key of `itemBases` as `item:`, plus `fallback`. It reads those from `@promptfall/sim` and `@promptfall/ledger` directly (workspace imports under `tsx`).

Palette rule, per art stem after decoding: alpha under 128 is transparent (index 0); every opaque colour snaps to the nearest entry of the style's master palette (squared RGB distance); then the distinct count must be at most 4 for `nes` and 16 for `snes`, else the build fails naming the stem and the count. Downsampling (`compact`, `icon`, `fit`) is nearest-neighbour on a grid of `ceil(w / f) × ceil(h / f)` blocks, each block taking the most frequent opaque index in it, transparent only when no pixel in the block is opaque. The compact variant fits 8 px tall; `icon` is the full art fitted to 8 × 4.

### Stage (`plugins/promptfall/hooks/stage/`)

```ts
// stage/tuning.ts: every number below, exported as a const of the same name
STAGE_REST_ROWS = 8; STAGE_TURN_BOSS_ROWS = 12; STAGE_BOSS_ROWS = 17; STAGE_TEXT_ROWS = 2
COMPACT_ROWS = 4; COMPACT_STAGE_COLUMNS = 52; FULL_MIN_COLUMNS = 116; STAGE_MAX_COLUMNS = 160
SPRITE_PX = 16; ACTOR_PITCH = 24; ACTOR_EDGE = 4; COMPACT_PITCH = 8
HIT_STAGGER_MS = 150; LUNGE_MS = 240; LUNGE_PX = 4; FLASH_MS = 160; NUMBER_MS = 700; NUMBER_RISE_PX = 6
DISSOLVE_MS = 420; SPAWN_MS = 360; DROP_MS = 600; DROP_RISE_PX = 10; IDLE_FRAME_MS = 500; EVENT_FRAME_MS = 83; IDLE_BOB_PX = 1
PROBE_DELAY_MS = 300; IMAGE_SCALE = 1 /* Task 1 sets it */; IMAGE_MAX_BYTES = 1_048_576
SVG_SMIL = true /* Task 1 sets it */; SVG_FALLBACK_FRAME_MS = 167; SVG_MAX_CHARS = 131_072; RASTER_MAX_PAIRS = 1024
CUE_GAIN = 0.6
RARITY_RGB = { common: 0x9a9a9a, uncommon: 0x3fbf5f, rare: 0x3f7fff, epic: 0xd040d0, legendary: 0xf0c040 }
ZONE_GROUND: readonly number[]   // 12 entries, one 0xRRGGBB per zone, the implementer's pick from the zone names in packages/sim/src/content/zones.ts
FLASH_RGB = 0xffffff; NUMBER_RGB_HERO = 0xff5050 /* damage taken by a hero */; NUMBER_RGB_ENEMY = 0xffffff

// stage/scene.ts
export type Box = { columns: number; rows: number }     // the stage in cells; pixels are columns × (rows * 2)
export type SceneActor = {
  key: string                  // hero or enemy id; a departed enemy keeps its id until its motions end
  art: SpriteArt
  palette: readonly number[]   // the art's palette after the rarity swap, the fallen-hero dim and the flash
  x: number; y: number         // top-left in stage pixels, after lunge, bob and spawn offsets
  flipX: boolean               // source art faces right; heroes (on the right) are flipped to face left
  alpha: number                // 0 to 1: spawn ramps up, dissolve ramps down; the compositor thresholds it
}
export type SceneNumber = { text: string; x: number; y: number; rgb: number }   // x, y in stage pixels, the text's top-left
export type SceneDrop = { art: SpriteArt; x: number; y: number; alpha: number }
export type Scene = { box: Box; ground: number; actors: SceneActor[]; numbers: SceneNumber[]; drops: SceneDrop[]; alt: string }
export function sceneAt(view: GameView, timeline: StageTimeline, now: number, box: Box, opts: { compact: boolean; motion: 'full' | 'still' }): Scene

// stage/timeline.ts
export type Motion =
  | { kind: 'lunge'; actor: string; from: number; until: number; dir: 1 | -1 }
  | { kind: 'flash'; actor: string; from: number; until: number }
  | { kind: 'number'; actor: string; text: string; rgb: number; from: number; until: number }
  | { kind: 'dissolve'; actor: string; from: number; until: number }
  | { kind: 'spawn'; actor: string; from: number; until: number }
  | { kind: 'drop'; actor: string; item: string /* sprite id */; from: number; until: number }
export class StageTimeline {
  onEffects(effects: readonly Effect[], now: number): void   // hit → lunge for `by` (dir by side), flash + number for `target`, staggered HIT_STAGGER_MS per hit in order; drop → a drop motion from the last enemy that departed in this step (else the front enemy)
  observe(view: GameView, now: number): void                 // enemies new since the last observe start a spawn; enemies gone start a dissolve after their last flash ends; departed enemies' def and kind are remembered until the dissolve and any drop end; the first observe starts no spawns
  active(now: number): readonly Motion[]
  departed(now: number): readonly { id: string; def: string; kind: string; slot: number }[]
  rowsAt(view: GameView, now: number): number                // STAGE_BOSS_ROWS while a zone or world boss is in view or departed-but-animating, STAGE_TURN_BOSS_ROWS for a turn boss likewise, else STAGE_REST_ROWS
  isBusy(now: number): boolean                               // any active motion
  bobbing(now: number): 0 | 1                                // floor(now / IDLE_FRAME_MS) % 2
}

// stage/compose.ts
export type Frame = { width: number; height: number; rgba: Uint8ClampedArray }   // alpha 0 or 255 only
export function composeFrame(scene: Scene): Frame      // ground strip on the bottom two pixel rows; actors in order, drops, then numbers through font.ts; alpha thresholded by a 4 × 4 Bayer matrix (the claude-toons rule: a pixel shows where alpha * 16 > bayer[y % 4][x % 4])
// stage/font.ts: DIGITS, a 3 × 5 pixel font for '0'-'9' and '-'; drawText(frame, text, x, y, rgb)

// stage/raster.ts
export function encodeRaster(frame: Frame, numbers: readonly SceneNumber[]): string   // half-block cells: ▀ with fg top and bg bottom when both opaque; ▀ fg top, bg CLEAR for top only; ▄ fg bottom, bg CLEAR for bottom only; ' ' CLEAR/CLEAR for neither; then each number's glyphs as text cells (fg rgb, bg CLEAR) at cell (floor(x), floor(y / 2)), replacing what is under them
export function rasterPairs(cells: string): number       // distinct (fg, bg) pairs, for the budget test
export const CLEAR = 0x01000000

// stage/image.ts
export function encodeImage(frame: Frame, scale: number): { rgba: string; width: number; height: number }   // nearest-neighbour upscale by `scale`, transparent pixels stay alpha 0
export function imageBytes(frame: Frame, scale: number): number

// stage/svg.ts
export function renderSvg(scene: Scene, motions: readonly Motion[], opts: { smil: boolean; now: number; width: number }): string
// viewBox `0 0 ${columns} ${rows * 2}`, shape-rendering crispEdges, width `opts.width` CSS px and height in proportion; one <g id> per distinct art stem holding run-length <rect>s (one per horizontal run of one colour), <use>d per actor with transform; with smil: <animateTransform> for the lunge and bob, <animate opacity> for flash (a white silhouette <use> over the actor), dissolve and spawn, <text> with <animate> for numbers, each with begin = (motion.from − opts.now) ms clamped at 0; without smil, the scene as of opts.now and no animation elements
```

### The frame loop and the probe (`plugins/promptfall/hooks/stage/loop.ts`)

```ts
export type StageSite = { requestId: string; key: 'stage'; box: Box; renderer: 'raster' | 'image'; compact: boolean }
export type LoopIo = {
  now: () => Promise<number>
  after: (ms: number, fn: () => void) => Timer
  blit: (args: { requestId: string; key: string; cells?: string; source?: ImageSource }) => Promise<{ deny?: string }>
  invalidate: () => void                       // $.ui.invalidate('ui.render')
  view: () => Promise<GameView | null>
  settings: () => Promise<Settings>
}
export class StageLoop {
  constructor(io: LoopIo, timeline: StageTimeline)
  mount(site: StageSite | null): void          // the band's render hook calls it on every render: a site while the stage is drawn, null when hidden, collapsed, on another tab, or off; a change of box or renderer re-arms; null cancels the timer
  onEffects(effects: readonly Effect[]): void  // forwards to the timeline at io.now()
  blitCount: number                            // for the tests
}
```

One `after` timer at a time, re-armed at the end of each tick with `EVENT_FRAME_MS` while `timeline.isBusy(now)`, else `IDLE_FRAME_MS`; with `motion: 'still'` and nothing busy the tick blits only when the scene's actor set changed since the last blit. A tick: `timeline.observe(view)`, compute `rowsAt`; when it differs from the mounted box's rows call `io.invalidate()` and skip the blit (the next render mounts the new box); else compose, encode for the renderer, blit, ignore a deny. `mount(null)` stops the timer, so a hidden band issues zero blits.

The probe: on `session.start` with `e.surface === 'terminal'`, `rendererAtom` is `'unknown'` unless `settings.renderer` is `'image'` or `'raster'`. While unknown, the band's status row ends in `<Image key="probe" source={PROBE_SOURCE} columns={1} rows={1} alt=" " />` (`PROBE_SOURCE` is one transparent RGBA pixel) and the render hook arms `after(PROBE_DELAY_MS, probe)` once per session; `probe` blits `PROBE_SOURCE` to that key: `{}` writes `'image'`, `{ deny }` writes `'raster'`. The write re-renders the band without the probe. While unknown, the Party tab draws the stage's rows empty, so the band's height does not jump when the result lands.

### Session io additions (`plugins/promptfall/hooks/register.tsx`)

The io closures built in `session.start` and on desktop attach gain `blit: (args) => $.ui.blit(args)`, `invalidate: () => $.ui.invalidate('ui.render')`, `view: () => read($, viewAtom)`, `settings: () => read($, settingsAtom)`, `play: (asset, gain) => $.audio.play({ asset }, { gain })`. `GameSession.onEffects` forwards every effect list to `stage.onEffects` before the toast loop, and after a toast with a cue plays it when `this.role === 'primary'` and `settings.sound` (the promise's rejection is swallowed).

### Commands and settings

`/promptfall sound on|off`, `/promptfall motion full|still`, `/promptfall renderer auto|image|raster` write `settings` and answer `{ text: 'Sound on' }`, `{ text: 'Motion: still' }`, `{ text: 'Renderer: raster (restart the session to apply)' }`. The Account tab shows the three as rows with Buttons: `Sound: off  [s]`, `Motion: full  [n]`, `Renderer: auto (image)  [x]`, hotkeys `s`, `n`, `x` (none of the dialog's tab letters `i h m r a o c b`). Cue files: `plugins/promptfall/cues/drop.wav`, `legendary.wav`, `level_up.wav`, `boss.wav`.

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
- Produces: the findings that set `IMAGE_SCALE`, `SVG_SMIL` and confirm the probe rule, written into `tuning.ts` in Task 6.

**Work:** A throwaway plugin loaded with `claude --plugin-dir spikes/phase-4`, never shipped. Its `/spike` command opens a pane (`$.ui.open({ id: 'spike', title: 'phase 4 spike', focus: true })`) and the pane's render hook draws, on a terminal: (a) a 1 × 1 keyed Image with a transparent pixel, then after 300 ms a blit of the same source to it, and a Text line reading `probe: image` on `{}` or `probe: raster (<deny>)` on a deny, then two more blits at 300 ms to show the answer is stable; (b) four Images side by side, each labelled: a 16 × 16 two-colour checkerboard in `columns=2 rows=1`, the same picture in `columns=8 rows=4`, the same checkerboard pre-upscaled nearest-neighbour to 128 × 128 in `columns=8 rows=4`, and a 16 × 16 checkerboard whose dark squares are alpha 0 in `columns=8 rows=4`; (c) a Raster `columns=100 rows=8` of random half-block cells blitted every 83 ms for 5 seconds with a line counting blits sent and denies answered. On a desktop surface it draws an `isInteractive` Svg with one rect lunging through `<animateTransform type="translate" ... repeatCount="indefinite">` and one fading through `<animate attributeName="opacity">`, next to a Text line reading `SMIL: watch the squares`. Internal structure is the implementer's choice. Kevin runs it in Ghostty, iTerm2, Terminal.app, tmux (inside Ghostty) and the desktop app, and fills the findings table: probe answer per terminal; whether the 8 × 4 Image of the 16 px checker is blurred and whether the pre-upscaled one is crisp; whether alpha shows the terminal background; the blit and deny counts; whether the squares move on the desktop. Decisions from the findings, written in the doc: `IMAGE_SCALE` is `1` when Ghostty draws the 16 px checker crisp at 8 × 4, else the smallest integer at which `imageBytes` of a 160 × 34 frame stays under `IMAGE_MAX_BYTES` and the pre-upscaled checker was crisp (`8` at most); `SVG_SMIL` is `true` when the squares move; the probe rule stands when every terminal but Ghostty denies and Ghostty answers `{}`. If any terminal that draws no pixels answers `{}`, the renderer default becomes `'raster'` for every terminal and `settings.renderer = 'image'` opts in per machine (record §1.2's fallback), noted in the doc and applied in Task 6.

**Acceptance check:** `claude plugin validate spikes/phase-4` lists `ui.blit`, `ui.open`, `command.register`; `claude --plugin-dir spikes/phase-4` then `/spike` in Ghostty draws the pane. Red before: the folder does not exist. Kevin's findings are the task's exit; until they are in, Tasks 2 to 5 proceed and Task 6 reports `blocked: spike findings needed` at its tuning checkbox.

**Boundaries:** Nothing under `plugins/promptfall`. No art. The spike is not added to any workspace script or CI.

- [ ] The module, the two JSON files, the gitignore line; `claude plugin validate spikes/phase-4`
- [ ] The findings doc with the table and the decision rules; commit `docs(phase-4): spike plugin and findings sheet`
- [ ] Ask Kevin to run the five surfaces; record the findings in the doc; commit `docs(phase-4): spike findings`

### Task 2: Sim: the `hit` effect; the view carries ids and rarity

**Files:**
- `packages/sim/src/types.ts` (modify): the `hit` member of `Effect`
- `packages/sim/src/combat.ts` (modify): `hitEnemy` pushes `{ k: 'hit', by, target, amount }` first (it gains a `by: string` parameter; the four `heroAct` call sites pass `hero.id`); `enemyAct` pushes one for its attack before the `hero_fell` check
- `packages/sim/src/combat.test.ts` (create or modify if present): one round on a fixture state yields one `hit` per attack, in actor order, `by` and `target` the right ids, a world-boss hit reports its amount while the boss's hp is unchanged, a heal yields no `hit`
- `packages/sim/src/golden.test.ts` (modify): the 300-event replay's hash still equals `GOLDEN_HASH` and the replay's effects contain at least one `hit`
- `scripts/vendor.mjs` (run `pnpm vendor`): the bundles
- `plugins/promptfall/types/index.d.ts` (modify): `HeroView.rarity`, `EnemyView.id`, `EnemyView.def`
- `plugins/promptfall/hooks/view.ts` (modify): `toGameView` fills them (`def` is `'world_boss'` for the world boss)
- `plugins/promptfall/hooks/toasts.ts` (modify): `hit` answers null (it already does through the default; add it to the switch so an exhaustive check stays exhaustive if there is one)
- `plugins/promptfall/hooks/golden.test.ts`, `band.test.ts` (modify where a fixture view is built by hand): the new fields

**Interfaces:**
- Consumes: today's sim and plugin.
- Produces: `Effect` with `hit`; `HeroView.rarity`, `EnemyView.id`, `EnemyView.def`.

**Work:** Output only. No state field changes, no new RNG draw, no `SIM_VERSION` bump. The ledger's effect handling (`rejected` only) is untouched; grep `packages/ledger/src` for `effects` to confirm nothing switches exhaustively on `k`.

**Acceptance check:** `pnpm --filter @promptfall/sim test` green with the hash unchanged; `pnpm vendor && pnpm vendor:check` clean; `pnpm typecheck`, `pnpm exec tsc -p plugins/promptfall` and `claude plugin test plugins/promptfall` green. Red before: `combat.test.ts` finds no `hit` in the effects.

**Boundaries:** No stage code. No change to `resolveRound`'s order or to damage. Do not touch `progression.ts`.

- [ ] `types.ts`, `combat.ts`, `combat.test.ts` red then green; `golden.test.ts`'s hash assertion and the `hit` presence
- [ ] `pnpm vendor`; the view types and `view.ts`; fixtures in the plugin tests; run the acceptance check; commit `feat(sim): output-only hit effect; the view carries actor ids and hero rarity`

### Task 3: The sprite pipeline

**Files:**
- `package.json` (modify): devDependencies `pngjs`, `@types/pngjs`, `tsx`, `vitest`, and `@promptfall/sim`, `@promptfall/ledger` as `workspace:*` so `scripts/sprites.ts` resolves them under `tsx`; scripts `sprites: tsx scripts/sprites.ts`, `sprites:check: pnpm sprites && test -z "$(git status --porcelain -- plugins/promptfall/hooks/sprites/generated.ts)"`, `slice: tsx scripts/slice-sheet.ts`, `test:scripts: vitest run scripts`, and `test` gains `&& pnpm test:scripts`
- `.github/workflows/ci.yml` (modify): `pnpm sprites:check` after `vendor:check`
- `scripts/slice-sheet.ts` (create): `tsx scripts/slice-sheet.ts <sheet.png> <out-dir> <stem-prefix> <cols> <rows> <colours> [--names a,b,c,...]`: the port of `docs/plans/phase-4-concepts/slice.py` with its three fixes (magenta key with a fringe tolerance, crop to the main run of opaque rows and columns, palette from opaque pixels only), writing one true-size RGBA PNG per cell as `<out-dir>/<stem-prefix>-<name or index>.png`, quantised to `<colours>` colours by median cut
- `scripts/sprites.ts` (create): the build described under "Sprites": reads `art/manifest.json`, the palettes, every PNG; validates ids against the content, the palette rules, sizes (`nes` art at most 16 × 16, `snes` at most 48 × 34, `fit` applied first); emits `plugins/promptfall/hooks/sprites/generated.ts` deterministically (sorted keys, a header comment naming the script, `SPRITE_COUNT`, `PLACEHOLDER_COUNT`); exits 1 with every failure listed
- `scripts/sprites.test.ts` (create): vitest over fixtures in `scripts/fixtures/`: a 5-colour NES PNG fails naming the stem and the count, a 4-colour one passes, a 17-colour SNES one fails, `fit` downsamples 48 × 34 to at most 24 tall keeping the aspect, the majority rule on a known 2 × 2 block, `rarityColor` resolves to the right index and fails when absent, a missing content id fails, an extra id fails, the output is byte-identical across two runs
- `art/manifest.json`, `art/palettes/nes.json` (the 64-entry 2C02 palette as `#rrggbb` strings, duplicates kept so indices match the usual table), `art/palettes/snes.json` (64 entries: median cut over the opaque pixels of the four SNES concept bosses, produced once by `tsx scripts/sprites.ts --derive-snes-master` and committed), `art/fallback.png` (a 16 × 16 two-colour crate the implementer draws as a pixel array in a one-off script, committed as PNG), `art/concept/*.png` (create): the concept sprites sliced from `docs/plans/phase-4-concepts/nes-sheet.png` and `snes-sheet.png` with `pnpm slice`: NES row 1 as `nes-knight`, `nes-black_mage`, `nes-white_mage`, `nes-archer`, row 2 as `nes-brute`, `nes-swift`, `nes-tank`, `nes-caster`, at 4 colours; SNES row 3 as `snes-boss-0` to `snes-boss-3` at 16 colours; four item placeholders `item-weapon`, `item-armour`, `item-accessory`, `item-misc` drawn in the same one-off script (a sword, a chest plate, a ring, a pouch, 16 × 16, 4 NES colours)
- `plugins/promptfall/hooks/sprites/types.ts`, `base64.ts`, `index.ts`, `generated.ts` (create): the contracts above
- `plugins/promptfall/hooks/sprites/sprites.test.ts` (create): `claude plugin test`: `base64` round-trips a known vector (`encode(Uint8Array.of(0, 255, 16))` is `'AP8Q'`) and a 1,000-byte random array; every `SPRITES` entry's `pixels` decodes to `width * height` bytes with every index under `palette.length`; `spriteFor('enemy', 'road_slime').full` is 16 × 16 with at most 4 colours; `spriteFor('world_boss', worldBossKey('The Promptwyrm')).full.height <= 34`; `spriteFor('enemy', 'wild_boar')` (zone 1's turn boss, `content/enemies.ts:50`) fits 24 tall; every `item:` sprite has an `icon` of 8 × 4; an unknown key answers the fallback; `SPRITE_COUNT` equals `4 + 4 + Object.keys(content.enemies).length + WORLD_BOSSES.length + Object.keys(itemBases).length + 1`
- `plugins/promptfall/README.md` (modify): a "Sprites" section: the `art/` layout, the manifest, `pnpm sprites`, the palette rules, the placeholder aliases

**Interfaces:**
- Consumes: `content.enemies`, `content.heroTemplates`, `itemBases`, `zoneRosters` (`@promptfall/sim`), `WORLD_BOSSES` (`@promptfall/ledger`), Task 2's view fields.
- Produces: `SPRITES`, `ART`, `spriteFor`, `worldBossKey`, `decodePixels`, `encode`, `decode`.

**Work:** The manifest in PR 1 aliases every enemy to the concept monster of its archetype (brute, swift, tank, caster; `content/enemies.ts:151` maps archetypes), every zone boss to `snes-boss-<(zone − 1) % 4>`, every turn boss to the same with `fit: { height: 24 }`, the four world bosses to `snes-boss-0..3`, every item to the placeholder of its slot (`itemBases[id].slot`: weapon, armour, accessory; `misc` is unused in PR 1 but shipped for PR 2), heroes to the NES concept heroes with their attack pose aliasing the same art (no attack poses exist yet). The hero concept art's rarity colour: pick one colour in each NES hero (the cape or trim) and name it in the manifest after reading the sliced PNG's palette. The generated module is plain data: no imports, `export const` only, so the plugin bundles nothing new. `Uint8Array.prototype.toBase64` is not relied on anywhere in the plugin.

**Acceptance check:** `pnpm sprites && pnpm sprites:check` clean; `pnpm test:scripts` green; `claude plugin test plugins/promptfall` green with `sprites.test.ts`; `pnpm exec tsc -p plugins/promptfall` clean. Red before: `sprites.test.ts` cannot import `./generated`.

**Boundaries:** No stage or band code. No change to the sim's content. Nothing third-party under `art/`. `slice.py` stays as the record left it.

- [ ] Dependencies and scripts; `slice-sheet.ts`; slice the two sheets; the fallback and item placeholders; `art/manifest.json`, the two palettes
- [ ] `sprites.ts` with `sprites.test.ts` red then green; `pnpm sprites` emits `generated.ts`; CI line
- [ ] `types.ts`, `base64.ts`, `index.ts`; `sprites.test.ts` in the plugin; README; run the acceptance check; commit `feat(sprites): art pipeline, palette checks, generated sprite module on the concept sheets`

### Task 4: The stage model: timeline, scene, compositor

**Files:**
- `plugins/promptfall/hooks/stage/tuning.ts` (create): every constant under "Stage", `IMAGE_SCALE = 1` and `SVG_SMIL = true` until Task 6
- `plugins/promptfall/hooks/stage/timeline.ts`, `scene.ts`, `compose.ts`, `font.ts` (create): the contracts above
- `plugins/promptfall/hooks/stage/fixtures.ts` (create): `wave()` (zone 3, wave 2, three heroes of three rarities, three wave enemies), `boss()` (a zone boss as the only enemy), `turnBoss()`, `worldBoss()`, `empty()` (no enemies), each a `GameView`; shared by the tests and `scripts/stage-goldens.ts`
- `plugins/promptfall/hooks/stage/timeline.test.ts` (create): `claude plugin test`: four hits in one `onEffects` call start lunges at `now`, `now + 150`, `now + 300`, `now + 450` and flashes at each plus `LUNGE_MS / 2`; `observe` with an enemy removed starts its dissolve at the end of its last flash and `departed` keeps it until `until`; an enemy added starts a spawn; the first `observe` starts nothing; `rowsAt` is 17 during a zone boss's dissolve and 8 after it ends; a `drop` effect after a departure pops from that enemy's slot; `isBusy` is false once every motion ends
- `plugins/promptfall/hooks/stage/scene.test.ts` (create): at `box = { columns: 120, rows: 8 }` the wave fixture places enemy i at `x = ACTOR_EDGE + i * ACTOR_PITCH` and hero i at `x = 120 − ACTOR_EDGE − SPRITE_PX − i * ACTOR_PITCH`, feet at `y + height = 16`; heroes have `flipX`; the rare hero's `palette[raritySlot]` is `RARITY_RGB.rare`; a flashing actor's opaque palette entries are all `FLASH_RGB`; a lunging hero's `x` is lower by `LUNGE_PX` at the lunge's midpoint; `motion: 'still'` gives a bob offset of 0 and `full` gives `IDLE_BOB_PX` on alternate `bobbing` values; a fallen hero's palette is dimmed (each channel halved); compact at `{ columns: 52, rows: 4 }` uses `compact` art with `COMPACT_PITCH`; a boss at `rows: 17` has `y = 0` for a 34 px sprite; `alt` reads `Zone 3, wave 2: Goblin Scout 42/60, Field Rat 10/20 vs Aldric L5, Mira L4, Tomas L5` for the fixture
- `plugins/promptfall/hooks/stage/compose.test.ts` (create): the ground strip fills the bottom two pixel rows in the zone's colour; a transparent sprite pixel leaves alpha 0; an actor at alpha 0.5 shows about half its pixels (count within 40 to 60 percent); a number draws `font.ts` glyphs at its position; `font.ts` has 11 glyphs of 3 × 5

**Interfaces:**
- Consumes: Task 2's view fields, Task 3's sprites.
- Produces: `StageTimeline`, `Motion`, `sceneAt`, `Scene`, `SceneActor`, `SceneNumber`, `SceneDrop`, `Box`, `composeFrame`, `Frame`, `drawText`, the fixtures.

**Work:** Pure functions and one class with no clock of its own (every method takes `now`). Slot order: enemies in `view.enemies` order from the left, heroes in `view.heroes` order from the right; a departed enemy keeps the slot it had. Lunge: the actor moves `LUNGE_PX` toward the other side over the first half of `LUNGE_MS` and back over the second; a hero in a lunge draws its `hero_attack` sprite. Damage numbers: the hit's `amount` as text, `NUMBER_RGB_ENEMY` on an enemy and `NUMBER_RGB_HERO` on a hero, rising `NUMBER_RISE_PX` over `NUMBER_MS` from above the target's head. Drop pop: the item's `full` art (compact on the compact stage) rising `DROP_RISE_PX` from the departed enemy's centre, alpha ramping down over the last third. Spawn: alpha 0 to 1 over `SPAWN_MS`. Dissolve: alpha 1 to 0 over `DISSOLVE_MS`. Fallen hero: drawn in place with its palette halved, no motion. World boss: `spriteFor('world_boss', worldBossKey(enemy.name))`. Internal structure is the implementer's choice.

**Acceptance check:** `claude plugin test plugins/promptfall` green with the three new test files; `pnpm exec tsc -p plugins/promptfall` clean. Red before: the modules do not exist.

**Boundaries:** No encoder, no `$`, no band change. `tuning.ts` values are the ones listed; a value that proves wrong is a deviation to report, not to change silently.

- [ ] `tuning.ts`, `font.ts`, `fixtures.ts`; `timeline.ts` with `timeline.test.ts` red then green
- [ ] `scene.ts` with `scene.test.ts`; `compose.ts` with `compose.test.ts`; run the acceptance check; commit `feat(stage): timeline, scene and compositor`

### Task 5: The three encoders and the golden frames

**Files:**
- `plugins/promptfall/hooks/stage/raster.ts`, `image.ts`, `svg.ts` (create): the contracts above; `raster.ts` carries the MIT attribution comment for the half-block packing
- `plugins/promptfall/NOTICE.md` (create): the claude-toons MIT notice (copyright 2026 Anshu Chimala) and what was borrowed: the half-block cell packing, the Bayer alpha rule, the blit loop shape
- `scripts/stage-goldens.ts` (create): `tsx scripts/stage-goldens.ts` writes `plugins/promptfall/hooks/stage/goldens/<scenario>.json` for the five scenarios, each `{ rasterHash, imageHash, svgHash, svgChars, rasterPairs }` with a 64-bit FNV-1a hash (`imageHash` over `encodeImage(frame, 1)`, so Task 6's `IMAGE_SCALE` does not move the goldens; the image budget is checked at `IMAGE_SCALE` in the test, not stored), and `goldens/<scenario>.svg` for eyeballing; scenarios at `now = 1_000_000` on fixed boxes: `rest` (wave, 120 × 8, no motions), `boss` (boss, 120 × 17, spawn at its midpoint), `compact` (wave, 52 × 4), `dissolve` (wave with the front enemy departed, its dissolve at its midpoint, two numbers live), `drop` (the same with the drop pop at its midpoint)
- `package.json` (modify): script `stage:goldens: tsx scripts/stage-goldens.ts`
- `plugins/promptfall/hooks/stage/goldens/*.json`, `*.svg` (create, generated)
- `plugins/promptfall/hooks/stage/raster.test.ts` (create): one cell per case: both pixels opaque gives `▀` with fg top and bg bottom; top only gives `▀` with bg `CLEAR`; bottom only gives `▄`; neither gives a space with both `CLEAR`; the cell count is `columns * rows`; a number at `(x, y)` replaces the cell at `(floor x, floor y/2)` with its glyph; `rasterPairs` counts distinct pairs
- `plugins/promptfall/hooks/stage/image.test.ts` (create): `scale 1` round-trips the frame bytes; `scale 2` doubles both dimensions and repeats each pixel 2 × 2; `imageBytes` equals `width * height * 4 * scale²`
- `plugins/promptfall/hooks/stage/svg.test.ts` (create): the string starts with `<svg` and ends with `</svg>`, every opened tag closes (a stack walk over the tags in the test, no parser dependency), `viewBox` reads `0 0 120 16` for the rest scenario, each distinct art stem appears once as a `<g id=`, with `smil: true` a lunge yields one `<animateTransform` whose `begin` is `0s` for a motion already started, with `smil: false` no `<animate` appears, a scene with no motions and `smil: true` still carries the bob's `<animateTransform`
- `plugins/promptfall/hooks/stage/golden.test.ts` (create): the five scenarios hash-match their JSON on every field; budget assertions on every scenario: `svgChars < SVG_MAX_CHARS`, `rasterPairs <= RASTER_MAX_PAIRS`, `imageBytes <= IMAGE_MAX_BYTES` at `IMAGE_SCALE`; plus a worst case built in the test (boss at 160 × 17 with three heroes lunging, three numbers, a drop) under the same three budgets

**Interfaces:**
- Consumes: Task 4.
- Produces: `encodeRaster`, `rasterPairs`, `CLEAR`, `encodeImage`, `imageBytes`, `renderSvg`, the goldens.

**Work:** The Raster packing is the claude-toons rule verbatim (record facts): both opaque gives `▀` fg top bg bottom; top only `▀` fg top bg `CLEAR`; bottom only `▄` fg bottom bg `CLEAR`; neither a space `CLEAR`/`CLEAR`. Cells are `Uint32Array` triplets through `base64.encode`. The SVG keeps its size by emitting each art stem once and `<use>`ing it; a run-length `<rect>` per horizontal colour run; integer coordinates only; no `<image>`, no `<script>`, no event attributes. Regenerate the goldens only with `pnpm stage:goldens` and only when a scenario's drawing is meant to change; a golden change is called out in the commit message.

**Acceptance check:** `pnpm stage:goldens` then `claude plugin test plugins/promptfall` green including `golden.test.ts`; running `pnpm stage:goldens` again changes no file (`git status --porcelain -- plugins/promptfall/hooks/stage/goldens` empty). Red before: the encoders do not exist.

**Boundaries:** No band change, no loop, no `$`. Do not add a dependency for XML or hashing.

- [ ] `raster.ts` with `raster.test.ts` red then green; `NOTICE.md`
- [ ] `image.ts`, `svg.ts` with their tests
- [ ] `stage-goldens.ts`, the goldens, `golden.test.ts` with the budgets; run the acceptance check; commit `feat(stage): raster, image and svg encoders; golden frames and budgets`

### Task 6: The band draws the stage

**Files:**
- `plugins/promptfall/hooks/stage/tuning.ts` (modify): `IMAGE_SCALE`, `SVG_SMIL` and, if the spike said so, the renderer default, from Task 1's findings
- `plugins/promptfall/hooks/stage/loop.ts` (create): `StageLoop` and the probe helper `probeRenderer(io): Promise<Renderer>`
- `plugins/promptfall/hooks/state.ts` (modify): `settingsAtom`, `rendererAtom`, `SETTINGS_DEFAULT`
- `plugins/promptfall/types/index.d.ts` (modify): `Renderer`, `Settings`
- `plugins/promptfall/hooks/register.tsx` (modify): the io additions; `GameSession` owns one `StageTimeline` and one `StageLoop`; `onEffects` forwards; `session.start` on a terminal reads `settings` from the store into `settingsAtom` and sets `rendererAtom` from `settings.renderer` or `'unknown'`; the desktop attach path never probes and the Svg path never reads `rendererAtom`
- `plugins/promptfall/hooks/ui/band.tsx` (modify): the Party tab per spec §10: the stage element (`Raster key="stage"` or `Image key="stage"` by `rendererAtom`, `Svg key="stage"` when `e.surface !== 'terminal'`), the party line, the status row; the compact layout (today's three hero rows and status row at the left, the compact stage of `COMPACT_STAGE_COLUMNS` at the right); the collapsed rule extended with `maxRows < STAGE_TEXT_ROWS + rowsAt` and the `116` column line; the probe Image while unknown; `loop.mount(...)` on every render (null on the Loot and World tabs, collapsed, hidden, off, or `view === null`); on the Svg path the hook calls `timeline.observe` itself and passes `timeline.active(now)` to `renderSvg` with `smil: SVG_SMIL`; with `SVG_SMIL` false the loop runs on desktop too, with `SVG_FALLBACK_FRAME_MS` and `io.invalidate()` in place of a blit; the world boss's predicted HP arithmetic from `band.tsx:182-200` moves into the party line's enemy segment
- `plugins/promptfall/hooks/ui/parts.tsx` (modify): `PartyLine(els, view, world, width)`: for each of the three heroes `<name clipped to 10> L<level> <HpBar> <hp>/<max>`, joined by ` · `, a fallen hero's name dim, then the enemy segment right-aligned: `⚔ <front enemy name> <hp>/<max>` (the boss's predicted hp in boss mode), truncated at `width`
- `plugins/promptfall/hooks/band.test.ts` (modify): on `terminal` with `rendererAtom` `'raster'`, `bodyColumns 120`, `maxRows 20`: the band has 10 rows, a `Raster` keyed `stage` of `120 × 8`, the party line reads the three heroes and `⚔`; with a zone boss in view the band has 19 rows and the Raster `120 × 17`; with a turn boss 14 and `120 × 12`; with `maxRows 12` and a zone boss the compact layout: 4 rows and a Raster `52 × 4`, and after the boss departs and its motions end (`clock.advance(DISSOLVE_MS + DROP_MS + 1)`) the full 10-row layout again; with `bodyColumns 110` the compact layout; with `bodyColumns 99` one row; with `rendererAtom` `'image'` an `Image` keyed `stage` with `columns 120`, `rows 8` and a non-empty `alt`; with `'unknown'` no stage element and a 1 × 1 `Image` keyed `probe` in the status row; on `desktop` an `Svg` keyed `stage` with `isInteractive` equal to `SVG_SMIL` and the alt; Loot and World tabs stay 4 rows with no stage element and `loop.blitCount` does not grow over `clock.advance(5_000)`; on the Party tab, after a `hit` effect, `blitCount` grows by at least 10 over `clock.advance(1_000)` and the `ui.blit` hook stub receives `requestId` equal to the render's and `key 'stage'`; with `motion: 'still'` and no effects `blitCount` grows by 0 over `clock.advance(5_000)`; with `hasSurvey` true no blits
- `plugins/promptfall/hooks/register.test.ts` (modify): the probe: on a terminal start with `settings.renderer 'auto'` the first band render mounts the probe, a `ui.blit` stub answering `{}` sets `rendererAtom` to `'image'` after `clock.advance(PROBE_DELAY_MS)`, one answering `{ deny: 'alt' }` sets `'raster'`; with `settings.renderer 'raster'` no probe blit is sent; `onEffects` with a `hit` reaches the loop (`blitCount` grows)
- `plugins/promptfall/README.md` (modify): a "Stage" section: the renderers per terminal, the probe, the heights, the compact and collapsed rules, the renderer override

**Interfaces:**
- Consumes: Tasks 1 to 5.
- Produces: the phase 4 band.

**Work:** The render hook never blits; the loop does. The hook's job is to mount the right element at the right size and tell the loop. The first frame after a mount is the loop's first tick (armed at `0` ms), so a freshly mounted Raster or Image shows cells within one tick; until then the element carries a frame composed in the hook itself (same `sceneAt`, same encoder), so a redraw is never blank. The band's height comes from `timeline.rowsAt(view, now) + STAGE_TEXT_ROWS`; the loop invalidates when the rows change, so grow and shrink are redraws and every frame between is a blit. `e.props.maxRows` and `bodyColumns` decide full, compact or collapsed with the numbers in the global constraints. Secondaries stay collapsed (`mode !== 'primary'`) as today and mount nothing. The alt text is `scene.alt`.

**Acceptance check:** `claude plugin test plugins/promptfall` green with the extended band and register tests on both surfaces; `claude plugin validate plugins/promptfall` lists `ui.blit` and `ui.invalidate` beside the phase 3 calls; `pnpm exec tsc -p plugins/promptfall` clean. Red before: `band.test.ts` finds no `Raster` keyed `stage`.

**Boundaries:** No sound, no Account tab change, no command change (Task 7). No dialog change (Task 8). `rowsAt` and the geometry come from Task 4; the band does not compute its own. `blocked: spike findings needed` at the first checkbox if `docs/plans/2026-10-04-phase-4-spikes.md` has an empty findings table.

- [ ] Tuning from the spike findings; `Renderer`, `Settings`, the atoms; `loop.ts` with the probe
- [ ] `PartyLine`; the Party tab with the stage, compact and collapsed rules; `band.test.ts` red then green on both surfaces
- [ ] io additions, `GameSession` wiring, the probe on start; `register.test.ts`; README; run the acceptance check; commit `feat(plugin): the stage in the band on raster, image and svg`

### Task 7: Cues, the sound and motion settings, the commands

**Files:**
- `scripts/placeholder-cues.ts` (create): writes four 16-bit mono 22,050 Hz WAVs of 160 ms square waves at 440, 660, 880 and 220 Hz with a linear fade-out, to `plugins/promptfall/cues/drop.wav`, `legendary.wav`, `level_up.wav`, `boss.wav`; `package.json` script `cues:placeholders`
- `plugins/promptfall/cues/*.wav` (create, generated; PR 2 replaces them with the CC0 picks)
- `plugins/promptfall/hooks/cues.ts` (create): `cueFor(effect: Effect): 'drop' | 'legendary' | 'level_up' | null` (`drop` with rarity `rare` or `epic` answers `'drop'`, `legendary` answers `'legendary'`, `level_up` answers `'level_up'`, everything else null) and `CUE_ASSET: Record<Cue, string>` (`cues/<name>.wav`); the boss cue is `'boss'`, played from the world poller's appeared transition
- `plugins/promptfall/hooks/register.tsx` (modify): `onEffects` plays `cueFor(effect)` after its toast when `role === 'primary'` and `settings.sound`; the `world.ts` poller's `toast` dep for the appeared transition also plays `'boss'` under the same rule (a `cue` dep beside `toast`, `world.ts:165`)
- `plugins/promptfall/hooks/command.ts` (modify): `sound on|off`, `motion full|still`, `renderer auto|image|raster`; each writes `settings` to the store and the atom and answers the texts under "Commands and settings"; a bad argument answers `{ text: 'usage: /promptfall sound on|off' }` and so on; these three do not claim the lease
- `plugins/promptfall/hooks/ui/dialog.tsx` (modify): Account tab rows for the three settings with hotkeys `s`, `n`, `x`, each press toggling or cycling and writing the store and atom
- `plugins/promptfall/hooks/command.test.ts`, `dialog.test.ts`, `register.test.ts` (modify): the commands write the store key `promptfall:settings`; the Account rows show the state and a press cycles it; a `drop` of rarity `epic` on a primary with sound on sends one `audio.play` with `asset 'cues/drop.wav'` and `gain CUE_GAIN`, a `legendary` sends `cues/legendary.wav`, a `common` sends none, sound off sends none, a secondary sends none; a world-boss appeared transition sends `cues/boss.wav`; `/promptfall off` then an epic drop still sends the cue
- `plugins/promptfall/README.md` (modify): "Sound and motion"

**Interfaces:**
- Consumes: Task 6's `settingsAtom`, io `play`.
- Produces: the four cue files, `cueFor`, the three commands, the Account rows.

**Work:** `$.audio.play` is called without await and its rejection swallowed (Linux and Windows reject or resolve with nothing played; either is fine). The test harness stubs it with an `on('audio.play', ...)` hook that records calls (`audio.play` is in the engine's event map, d.ts line 6552, beside `ui.blit` at 6726 and `ui.invalidate` at 6696, so the band tests stub those two the same way).

**Acceptance check:** `pnpm cues:placeholders` writes four files under 20 KB each; `claude plugin validate plugins/promptfall` lists `audio.play`; `claude plugin test plugins/promptfall` green with the extended tests; `pnpm exec tsc -p plugins/promptfall` clean. Red before: `register.test.ts` sees no `audio.play` call on an epic drop.

**Boundaries:** No new toast. No cue for zone or turn bosses, wipes or chat. No volume control. Nothing in `stage/`.

- [ ] `placeholder-cues.ts` and the four files; `cues.ts`
- [ ] The commands and the Account rows with their tests red then green
- [ ] `onEffects` and the poller's cue; `register.test.ts`; README; run the acceptance check; commit `feat(plugin): sound cues, the sound, motion and renderer settings`

### Task 8: Item icons in the dialog lists

**Files:**
- `plugins/promptfall/hooks/ui/icon.tsx` (create): `ItemIcon(els, renderer, surface, sprite, key)`: on `surface !== 'terminal'` an `Svg` of the 16 px art (run-length rects, `width 16 height 16`, alt the item's name); on terminal with renderer `'image'` an `Image` of the 16 px art at `columns 2 rows 1` (`encodeImage(frame, 1)` of a 16 × 16 frame composed from the art alone); with `'raster'` a `Raster` of the `icon` art at `columns 8 rows 2`; with `'unknown'` nothing. The same helper draws a hero's sprite on Image and Svg; on raster a hero row keeps its glyph
- `plugins/promptfall/hooks/ui/dialog.tsx` (modify): the Inventory item rows (`:347-362`) and Heroes rows (`:478-488`) take the icon before the text; on raster an item row is two rows tall with the icon beside both lines (the item's text already spans two rows there)
- `plugins/promptfall/hooks/ui/market.tsx` (modify): listing rows (`:190-200`) take the icon of `l.kind === 'item'` listings; `ListingView` gains `base: string | null` (the item base, null for heroes) in `types/index.d.ts` and `view.ts:53` fills it
- `plugins/promptfall/hooks/dialog.test.ts` (modify): on terminal with `'raster'` an inventory row holds a `Raster` of `8 × 2`; with `'image'` an `Image` of `2 × 1`; on desktop an `Svg` with the item's name as alt; a heroes row on raster holds no `Raster` and its glyph text; a market item listing holds the icon and a hero listing none
- `plugins/promptfall/README.md` (modify): one line under "Sprites"

**Interfaces:**
- Consumes: Tasks 3, 5, 6 (`rendererAtom`, `encodeRaster`, `encodeImage`, `composeFrame` of a one-actor scene, or a small `artFrame(art): Frame` added to `compose.ts`).
- Produces: `ItemIcon`.

**Work:** Icons are static; nothing blits them, so they carry no `key` beyond the tree's. Cache the encoded cells and sources per sprite id in a module `Map` so a list of 30 rows encodes each distinct item once per session.

**Acceptance check:** `claude plugin test plugins/promptfall` green with the extended dialog tests; `pnpm exec tsc -p plugins/promptfall` clean. Red before: `dialog.test.ts` finds no `Raster` in an inventory row.

**Boundaries:** No change to the Orders, Sell, Chat, Leaderboards or Odds tabs. No band change.

- [ ] `icon.tsx`, `artFrame`; `ListingView.base`
- [ ] Inventory, Heroes, Market rows; `dialog.test.ts` red then green; README; run the acceptance check; commit `feat(plugin): item icons in the Inventory, Heroes and Market lists`

### Task 9: PR 1: manual pass part A, docs, pull request

**Files:**
- `docs/manual-pass/phase-4.md` (create): part A, per surface. Ghostty: the probe lands on `image` (Account tab shows `Renderer: auto (image)`), the stage draws crisp sprites at 10 rows, a turn boss grows the band to 14 and a zone boss to 19 and both shrink back after the dissolve and the drop pop, hits lunge and flash with numbers, an epic drop pops out and toasts, `/promptfall sound on` then a Rare drop plays `drop.wav`, `/promptfall motion still` stops the bob, a 110-column window shows the compact stage, 99 columns one row, `/promptfall off` hides the band and a later Rare drop still plays. iTerm2 and Terminal.app: the probe lands on `raster`, the same steps on half-blocks, numbers as text. tmux inside Ghostty: `raster`. Desktop app: the Svg, SMIL motion per the spike finding, the icons in the Inventory. For each step: what to type, what to see.
- `docs/plans/2026-10-04-promptfall-phase-4.md` (modify): tick the tasks; record every deviation reported during execution under "Spec conflicts and narrowings"
- `README.md` (root, modify): the phase 4 PR 1 status line
- `docs/spec/promptfall.md` (modify only if a task reported a deviation that the spec must carry)

**Interfaces:**
- Consumes: everything above.
- Produces: the PR.

**Work:** Run the full check line. Run the real-surface checks through `codex-computer-use` against the running desktop app and Ghostty where it can drive them, before the PR is opened. Open the PR against `ai-staging` with the manual-pass steps in the description, say which checks ran, and stop: the review is Kevin's to trigger.

**Acceptance check:** The full check line clean on the PR's head; `gh pr view` shows the PR open against `ai-staging`. Red before: no PR.

**Boundaries:** No merge. No new features. Nothing from PR 2.

- [ ] `docs/manual-pass/phase-4.md` part A; README status; tick the tasks
- [ ] `codex-computer-use` check; the full check line; push; open the PR; stop

## Spec conflicts and narrowings

1. **PR 2 gets its own plan after PR 1 merges.** The record's §1.8 loop (generate, slice, contact page, Kevin reviews, regenerate) has no fixed task count, and its prompts and slicer settings depend on the pipeline as PR 1 leaves it. The phase 3 precedent of both PRs in one file is not followed. The hand-over for that plan is below.
2. **Slicing is a tool step, not the build.** Record §1.8 says the build slices and palette-locks the sheets. Here `pnpm slice` cuts a sheet into per-sprite PNGs committed under `art/`, and `pnpm sprites` builds from those, because the hand cleanup in Aseprite or Pixelorama (heroes and world bosses) needs individual files and a build must be a pure function of committed input.
3. **Every downsample happens in the build** (record §1.11: automatic, in the build): the compact variants, the item icons, and `fit` for the turn-boss placeholders. The runtime only upscales for `Image`.
4. **The view carries actor ids and the hero's rarity.** `EnemyView.id` and `.def` and `HeroView.rarity` are new; the stage keys sprites and motions on them. The world boss keys its sprite on its name through `worldBossKey`, since `WORLD_BOSSES` has names and glyphs only.
5. **A renderer override** `/promptfall renderer auto|image|raster` is added, per machine in `settings`, so the manual pass can force a path and so record §1.2's fallback (Raster everywhere) has a switch if the spike finds a terminal that answers `{}` without drawing pixels. It applies at the next session start.
6. **The Svg dissolves and spawns by opacity**, not by the Bayer pattern the pixel surfaces use; SMIL has no per-pixel threshold. Flash is a white silhouette's opacity.
7. **Dialog hero rows on raster keep the glyph.** Record §1.10 defines the 2-row icon for items only; a hero at 8 × 4 reads as nothing, and CONTEXT.md keeps the glyph as a sprite's fallback outside the stage. Items get the 2-row icon; heroes get sprites on Image and Svg only.
8. **The frame loop re-arms one `clock.after` per tick** rather than sleeping in a detached loop (the claude-toons shape), so no wait runs against a hook's budget and `mount(null)` cancels one timer.
9. **The 64-colour SNES master is derived in PR 1** from the four concept bosses and committed. PR 2's style-sheet gate may replace it once, before mass generation, and must then re-run `pnpm sprites`.
10. **Hits within a round are staggered `HIT_STAGGER_MS` apart** in sim order, so a 6-hit round plays over about a second inside the 2-second turn cadence. The record names 12 frames a second and nothing about ordering.
11. **A fallen hero is drawn in place with a halved palette**; there is no lying-down art. Record §1.9's dissolve is for enemies.
12. **The world boss's predicted HP moves to the party line.** Phase 3's narrowing 35 gave it two rows of the enemy column; the Party tab no longer has that column. The arithmetic (`shownHp`, `baseline`) is unchanged.
13. **While the renderer is unknown the Party tab draws empty stage rows**, so the band's height does not jump when the probe lands within `PROBE_DELAY_MS`.
14. **`IMAGE_MAX_BYTES` is 1 MiB**, half the engine's 2 MiB cap, so a 17-row frame at `IMAGE_SCALE` leaves room; the spike's rule picks the scale under it.
15. **Compact stage width is 52 columns** at the band's right: three 8 px enemies at pitch 8, a 4 px gap, three heroes. The hero rows and status row keep today's layout in the remaining width (at least 48 columns at 100).
16. **Secondary sessions draw no stage.** They are collapsed today (`mode !== 'primary'`); unchanged.
17. **The cue for a world boss appearing comes from the poller's transition**, where the toast already comes from (`world.ts:165`), not from an effect.

## Out of scope

PR 2 (the style sheet, the ~124 sprites, the CC0 cue clips, hand cleanup); per-zone backdrops beyond the ground strip; sextant or braille rendering; sprites on the Loot and World tabs, the collapsed row, toasts or chat; a volume control; cues on Linux or Windows (the engine plays nothing there); equipment drawn on heroes; heal or buff motion; a headless browser smoke for the Svg (none exists in the repo; the goldens' `.svg` files and the desktop check through `codex-computer-use` stand in); attack poses as separate art (PR 1 aliases them to the idle art).

## Hand-over for the PR 2 plan

What PR 1 leaves for the art plan: `art/manifest.json` with one entry per content id, every entry an alias in PR 1; `pnpm slice` for cutting a generated sheet into PNGs; `pnpm sprites` with the palette rules and `PLACEHOLDER_COUNT` in the generated module (PR 2's exit is `PLACEHOLDER_COUNT === 0`, asserted in a test it adds); `art/palettes/snes.json` to confirm or replace at the style-sheet gate; `plugins/promptfall/cues/*.wav` to replace with the Juhani Junkala picks; the contact page is PR 2's to build (a script that tiles a zone's sliced PNGs at 4× with their ids, for Kevin's review); the codex-image prompts from the record (§2: a strict grid on pure magenta, "no text, no grid lines", about 135 to 180 s a run).
