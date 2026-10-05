# UI PR 1: the window kit and the band, implementation plan

**Goal:** Replace the band's two text rows with a strip of Dragon Quest V style windows (enemy,
message, party, purse), drawn by one window model through three encoders, with smooth action
gauges and a typed combat log.
**Architecture:** A cell-based window model (`hooks/windows/kit.ts`) describes windows, their
text and bars. Three encoders draw it: one RGBA picture per window for terminals that draw
images, raster text cells for terminals that draw none, and one `Svg` with SMIL for the desktop,
VS Code and mobile. The pixel font (Misaki Gothic 2nd, grill 1.18) is baked into a generated TS
module. A strip
builder turns the view, the stage timeline, a gauge tracker and a message log into a scene; the
stage loop blits the strip with the stage.
**Spec:** `docs/plans/2026-10-05-ui-remake-grill.md` (section 1 is binding, 1.16 to 1.18 included),
`docs/design/ui-remake/README.md`, `docs/adr/0005-interface-drawn-as-windows.md`, and
`docs/spec/promptfall.md` (amended in Task 10).
**Execution model:** opus

Review wave note: Fable is out of credits locally and in the cloud, so this plan was written on
Opus 5.5. Its review wave ran `reviewer` on Opus only: the Fable `reviewer` leg cannot run, and
the `codex-review` leg hit the account-wide codex usage limit mid-run (no findings; GPT lanes
blocked until 2026-10-09 19:43). The Opus leg's 17 findings were folded into this version in one
fix pass, on Opus (no `reasoner` without Fable); the two rulings it needed are grill 1.17.

## Global constraints

- Every surface ships the strip in this PR (grill 1.3): image terminals (kitty, Ghostty), terminals
  without images (raster text cells), and the Svg surfaces (desktop, VS Code, mobile).
- Keyboard only (grill 1.4). No pointer handling.
- Text inside windows is the baked pixel font, never terminal text laid over a picture
  (grill 1.5). The raster encoder is the exception the ADR names: box-drawing text for terminals
  that draw no pictures.
- One line of the pixel font is one terminal row; windows are laid out in whole cells
  (grill 1.13). A window cell is `CELL_W × CELL_H = 8 × 16` picture pixels before
  `WINDOW_SCALE`.
- The plugin reads no files at runtime (spec §2's footprint): the font ships as a generated TS
  module, as the sprites do.
- Engine limits: an `Image` source is at most 2 MiB decoded and 2048 px a side; the plugin's own
  cap is `IMAGE_MAX_BYTES` (1 MiB) per Image. An `Svg` source is at most 131,072 characters.
- Motion `still` types every line at once and drops the bob, as today. Gauges still fill: they
  are information, not decoration.
- No sim change. `SIM_VERSION` stays 4. Nothing under `packages/` changes.
- Colours are judged in cmux, never in Terminal.app (it draws the whole band in greys).
- The log's words are the approved table in grill 1.16, verbatim.
- `bin/check-design-tells.sh` runs on every Write and Edit; override only with a
  `design-tells: acknowledged` comment defended in the commit message.
- Plugin tests import `claude-code/testing` and run only through
  `claude plugin test plugins/promptfall`.
- Full check line, run before each task's final commit from Task 3 on:
  `pnpm lint && pnpm typecheck && pnpm test && pnpm vendor:check && pnpm sprites:check && pnpm font:check && pnpm exec tsc -p plugins/promptfall && claude plugin validate plugins/promptfall && claude plugin test plugins/promptfall`.
  Tasks 1 and 2 run `pnpm lint` only (they ship no plugin code).

## Shared contracts

### Window constants (`plugins/promptfall/hooks/windows/tuning.ts`)

| Name | Start value | Set by |
|---|---|---|
| `CELL_W`, `CELL_H` | 8, 16 | fixed (Dragon Quest V's text grid: 8 px advance, 16 px line) |
| `WINDOW_SCALE` | 1 | Task 1: 1 (crisp in the Ghostty engine) |
| `FIELD_RGB` | 0x303028 | Task 2 (sampled) |
| `BORDER_RGB`, `TEXT_RGB` | 0xf0f0e8 | Task 2 (sampled) |
| `DIM_RGB` | 0x888880 | Task 2 |
| `WARN_RGB` (under 25% HP) | 0xf8a030 | Task 2 (grill 1.13: check against DQ V) |
| `DOWN_RGB` (0 HP) | 0xe83830 | Task 2 |
| `HP_BAR_RGB`, `BAR_BACK_RGB` | 0x58d858, 0x484840 | Task 2 (the Pokémon graft) |
| `GAUGE_RGB`, `GAUGE_FULL_RGB` | 0x58a8f8, 0xf8d038 (gold) | Task 2 |
| `BORDER_PX`, `MARGIN_PX`, `PAD_PX` | 2, 1, 4 | Task 2: the white line, the field outside it, the field between it and the content cell; the rest of a border cell is transparent (`docs/design/ui-remake/transcription.md`, "The frame in whole cells") |
| `GLYPH_Y` | 5 | Task 2: the 8 × 8 glyph's first row in the 16 px cell |
| `STRIP_ROWS` | 5 | fixed: border, 3 inner rows, border |
| `COMPACT_WINDOW_ROWS` | 6 | fixed (grill 1.16): the compact band's rows; the compact stage box stays 4 rows (`COMPACT_STAGE_ROWS`, Task 9) |
| `STRIP_MAX_COLUMNS` | 160 | fixed: a strip or compact band is laid out in at most `STAGE_MAX_COLUMNS` columns, as the stage is |
| `ENEMY_COLUMNS` | 25 | fixed: border, pad, name 12, gap, bar 8, pad, border (21 content cells) |
| `PARTY_COLUMNS` | 42 | fixed: border, pad, 3 hero columns of 12 with a gap between, pad, border |
| `PURSE_COLUMNS` | 13 | fixed: border, pad, 9 ("Farm here"), pad, border |
| `MESSAGE_MIN_COLUMNS` | 28 | fixed: the message window takes every column the others leave |
| `CHAR_MS`, `CHAR_FAST_MS` | 18, 6 | typing speed; fast while 2 or more lines wait |
| `LINE_MIN_MS` | 300 | the least time a line holds the bottom row before the next one |
| `LOG_KEEP` | 40 | lines the log keeps |
| `GAUGE_FRAME_MS` | 250 | loop delay while only gauges move (capped by `restDelay(now)` so the bob keeps its phase) |
| `STRIP_SVG_MAX_CHARS` | 65,536 | the strip Svg's budget; SMIL frames past it are cut from the tail |

### The window model (`plugins/promptfall/hooks/windows/kit.ts`)

This is the shape all three encoders share, so it is given in full:

```ts
/** A run of text, or a bar, or the ▶ cursor cell, laid left to right in a line. */
export type Span =
  | { text: string; rgb?: number }                 // TEXT_RGB when absent; one cell per character
  | { bar: number; cells: number; rgb: number }    // bar: fill 0..10000 over `cells` cells, BAR_BACK_RGB behind
  | { cursor: boolean }                            // one cell: ▶ when true, blank when false
  | { gap: number }                                // blank cells

export type Line = {
  spans: readonly Span[]
  /** Pixel encoders draw a 1 px BORDER_RGB rule along this line's bottom edge; raster draws nothing. */
  rule?: boolean
  /** Characters of text shown, counted over the line's text spans; absent = all. Typing. */
  reveal?: number
}

export type Win = {
  /** Stable id: the Image key's stem and the Svg group id. */
  key: string
  /** Cells, border included. A strip window spans every row of the strip: y = 0, rows = scene rows. */
  x: number
  columns: number
  rows: number
  /** Drawn into the top border from column 1, with one border cell kept on each side. */
  title?: readonly Span[]
  /** Drawn into the bottom border the same way (compact's command line). */
  footer?: readonly Span[]
  /** Inner rows, top to bottom; at most rows - 2. A missing row is blank. */
  lines: readonly Line[]
  /** The text a screen reader gets for this window. */
  alt: string
}

export type Scene = { columns: number; rows: number; windows: readonly Win[]; alt: string }

/** Desktop only: how parts of the scene change over the next `horizon` ms, as SMIL. */
export type Track =
  | {
      kind: 'bar'
      window: string
      line: number
      /** Index of the bar span in that line. */
      span: number
      /** Linear between keys; `at` in ms after the scene's now, non-decreasing, the first at 0.
       *  Two keys at one `at` are a jump (a gauge reset). */
      keys: readonly { at: number; fill: number }[]
      /** The bar's colour switches to this while fill is 10000. */
      fullRgb: number
    }
  | {
      kind: 'lines'
      window: string
      /** Each frame replaces the window's inner lines from its `at` until the next frame's. */
      frames: readonly { at: number; lines: readonly Line[]; typing?: { line: number; charMs: number } }[]
    }
  | {
      kind: 'cursor'
      window: string
      line: number
      /** Index of the cursor span in that line. */
      span: number
      /** ▶ shows during each interval, ms after the scene's now. */
      on: readonly { from: number; until: number }[]
    }
```

Spans that do not fit a line are clipped at the window's inner edge; text never wraps inside an
encoder (wrapping is the builder's job). A character the font lacks draws as `?`; Task 8 tests
that the builder emits none.

### Encoders (`plugins/promptfall/hooks/windows/`)

```ts
// image.ts: one window at native size (CELL_W × CELL_H per cell); encodeImage(frame, WINDOW_SCALE)
// from stage/image.ts turns it into an Image source.
export function windowFrame(win: Win): Frame              // Frame from stage/compose.ts
export function windowKey(win: Win): string               // `win-${key}-${columns}x${rows}`

// raster.ts: the whole scene as Raster cells (codepoint, fg, bg per cell, as stage/raster.ts),
// box-drawing borders ╭─╮│╰╯, field FIELD_RGB as bg, bars as ▬ (filled in the bar colour, empty
// in BAR_BACK_RGB), ▶ for the cursor.
export function sceneCells(scene: Scene): string

// svg.ts: the whole scene; glyphs defined once as <symbol> and placed with <use>; tracks as SMIL
// when `smil` is true (ignored otherwise). Width in CSS px; the viewBox is the native size.
export function sceneSvg(scene: Scene, tracks: readonly Track[], opts: { smil: boolean; width: number }): string
```

### Timeline additions (`plugins/promptfall/hooks/stage/timeline.ts`)

```ts
export function groups(effects: readonly Effect[]): Group[]       // exported as is, with `Group`
// onEffects now answers each group's wall-clock start, aligned with groups(effects):
onEffects(effects: readonly Effect[], now: number, cadenceMs?: number): number[]
/** The hero or enemy whose action is playing: from its start until the next action starts or
 *  start + max(ACTION_MS, ACTION_STEPS × STEP_MS × cadenceMs / TICK_MS), whichever is first. */
acting(now: number): string | null
/** Wall-clock starts of this actor's actions still held (kept until 2 × cadence after start). */
actionStarts(actor: string): readonly number[]
/** Every action still held, in start order; `until` is the end of the interval `acting` uses. */
actions(): readonly { actor: string; start: number; until: number }[]
```

A group whose actor is not on the stage still gets a start (today it only skips the lunge);
`onEffects` records `{ actor, start, until }` for every group with an `act`.

### The gauge tracker (`plugins/promptfall/hooks/stage/gauges.ts`)

The algorithm is load-bearing (it decides what a player reads as "about to act"), so here it is
in full:

```ts
type Record = {
  from: number      // gauge drawn when the batch landed (continuity: no jump at batch start)
  fromAt: number    // wall ms the batch landed
  perMs: number     // gaugePerStep × TICK_MS / (STEP_MS × cadenceMs)
  resets: number[]  // this hero's action starts scheduled by this batch (timeline.actionStarts, ≥ fromAt)
  endAt: number     // max(fromAt + cadenceMs, last reset + 1)
  to: number        // the view's gauge after the batch
}

export class GaugeTrack {
  /** Every applied event, effects or none, after timeline.onEffects for the same batch. */
  onTick(view: GameView, now: number, cadenceMs: number, timeline: StageTimeline): void
  /** 0..GAUGE_FULL to draw. No record yet: hero.gauge. */
  at(hero: HeroView, now: number): number
  /** A living hero's drawn gauge is still rising toward its cap. */
  isFilling(view: GameView, now: number): boolean
  /** Piecewise-linear keys for SMIL over [now, now + horizonMs]: corners at each reset and at full. */
  keys(hero: HeroView, now: number, horizonMs: number): { at: number; fill: number }[]
}

// at(hero, now):           hero is the CURRENT view's HeroView
//   if !hero.alive: 0
//   r = record for hero.id; if none: hero.gauge
//   if now >= r.endAt: hero.gauge            (the current view: a resync or delivery wins)
//   last = greatest reset ≤ now
//   g = last !== undefined ? r.perMs × (now − last) : r.from + r.perMs × (now − r.fromAt)
//   cap = (a reset > now remains in r.resets) ? GAUGE_FULL : r.to
//   clamp(floor(g), 0, min(cap, GAUGE_FULL))
```

After a hero's last reset in a tick (or with none), its gauge only rises to the tick's end value,
so capping at `to` is exact: a spawn-only tick (the sim fills nothing) holds, a wave cleared
mid-tick stops where the sim stopped, a wipe drops to 0. A full gauge draws in `GAUGE_FULL_RGB`
(gold); in the sim full implies queued, so this matches grill 1.15's "full and queued".

### The message log (`plugins/promptfall/hooks/stage/log.ts`)

```ts
export type LogLine = {
  text: string
  rgb?: number          // rarity colour for drops, TEXT_RGB otherwise
  key: boolean          // never skipped: kills, drops, level-ups, deaths, sales, everything but hits and heals
  at: number            // wall ms the line starts typing
  charMs: number        // CHAR_FAST_MS when 2+ earlier lines are unfinished (not done typing) at its
                        // group's start; CHAR_MS otherwise
}

export class MessageLog {
  /** Every applied batch, after timeline.onEffects; starts = its return value. */
  onEffects(effects: readonly Effect[], starts: readonly number[], view: GameView,
            now: number, cadenceMs: number, timeline: StageTimeline): void
  /** Lines shown by `now`, oldest first, the last one revealed to its typed length. */
  shown(now: number, motion: Settings['motion']): { text: string; rgb?: number; revealed: number }[]
  /** A line is waiting or still typing. */
  isBusy(now: number, motion: Settings['motion']): boolean
  /** Lines starting in (now, now + horizonMs], for SMIL. */
  upcoming(now: number, horizonMs: number): readonly LogLine[]
}
```

Rules:

- One action group gives its lines in effect order: the action line, then its consequences.
- Action lines: a `hit` gives "Aldric hits Wood Goblin for 12." (enemy actors the same way); a
  Black Mage action with 2 or more hits gives one line, "Morwen hits 3 foes for 8, 9 and 7."
  (2 hits: "for 8 and 9"); a `heal` gives "Lyra heals Aldric for 14.".
- Consequences, in effect order: `drop` "Found a Silk Robe!" (rarity colour); `drop_vendored`
  "Found a Rusty Sword, sold for 3G."; `level_up` "Morwen reached level 5!"; `hero_fell`
  "Aldric falls!"; `boss_spawned` "Grave Lord appears!"; `zone_cleared` "Zone 3 cleared!";
  `wipe` "The party retreats to zone 2."; `traded` "Sold Silk Robe for 120G."; `rewarded`
  "Boss reward: 50G." (with goods: "Boss reward: Silk Robe and 50G."). Every other effect prints
  nothing.
- A kill: a `hit` target absent from `view.enemies` after the batch, that is not a world boss,
  prints "Wood Goblin is defeated!" right after the action holding the last `hit` on it.
- Names: the log keeps its own id → { name, kind } map, updated from every view it receives
  (enemies stay in it after they leave). Heroes use `HeroView.shortName` (the name without its
  epithet, added in Task 7). `boss_spawned` carries a `def`: the name is the view's enemy with
  that `def`, else the def. Item and trade wording reuse the loot log's names in `hooks/view.ts`.
- Pacing: a line's `at` is `max(its group's start, previous line's at + LINE_MIN_MS, previous line's
  at + its typing time)`. A non-key line whose `at` would land more than `cadenceMs` after its
  group's start is dropped (grill 1.13's skip rule, kept as a safety valve).
- Effects before any `act` (a delivery, a resync) take `now` as their start.

### The strip builder (`plugins/promptfall/hooks/ui/strip.ts`)

```ts
export type StripInput = {
  view: GameView
  world: WorldState
  tab: BandTab
  /** full: under the stage; compact: the party window beside the compact stage; bare: Loot/World. */
  kind: 'full' | 'compact' | 'bare'
  columns: number
  now: number
  notice: string | null
  motion: Settings['motion']
  timeline: StageTimeline
  gauges: GaugeTrack
  log: MessageLog
}
export type Hotspot = { hotkey: 'p' | 'l' | 'w' | 'c' | 'f'; label: string; x: number; y: number; columns: number }

export function stripScene(input: StripInput): { scene: Scene; hotspots: readonly Hotspot[] }
export function stripTracks(input: StripInput, horizonMs: number): Track[]
```

`columns` is the band's columns capped at `STRIP_MAX_COLUMNS`; on the Svg surfaces it is the
stage's `clamp(bodyColumns, 116, 160)` (ADR 0004: the desktop scales the picture to the band).
Windows, left to right, in `full` and `bare` (`bare` drops the enemy window under 116 columns):

| Window | Columns | Title | Inner rows |
|---|---|---|---|
| enemy | `ENEMY_COLUMNS` | "Zone 3 · Wave 2"; a zone or turn boss "Zone 3 · Boss"; the world boss "World boss · 11m" (grill 1.17) | one per live enemy in slot order (at most 3): name (12, clipped), a gap, an 8-cell HP bar. A boss's line: name (8), a gap, the 8-cell bar, the percentage right-aligned in 4 ("62%", "100%"). |
| message | the rest, at least `MESSAGE_MIN_COLUMNS` | none | 1: the command line `▶Party Loot World` with ▶ on the current tab and `▾` right-aligned; 2-3: Party the log's last two rows, Loot the last two drops (rarity colour, "No loot yet" dim), World `worldRows`' presence row, then its chat row when chat is open and has a message, else "highest zone 7 · kills 184 · wipes 3" (the records text without the boss variant, so no `█░`). A notice replaces row 3 on every tab, in full, never typed. |
| party | `PARTY_COLUMNS` | none | 3 hero columns of 12 cells. 1: cursor cell (▶ while `timeline.acting(now)` is this hero), "Aldric L4" (`shortName` clipped to fit), `rule`. 2: "H", the HP right-aligned, an HP bar in the cells left. 3: the gauge bar across all 12 cells. A hero under 25% HP draws its column's text in `WARN_RGB`, at 0 in `DOWN_RGB` with an empty dim gauge. |
| purse | `PURSE_COLUMNS` | none | 1: gold ("1,240G", `formatGold` without its unit then "G"); 2: "Push on" or "Farm here". |

Log rows: a log line longer than the message window's inner width wraps at a word boundary onto
two rows; the window shows the newest two rows, so a wrapped line fills both. Typing reveals
across the wrap.

`compact`: one party window, `columns` = `min(bodyColumns, STRIP_MAX_COLUMNS)` −
`COMPACT_STAGE_COLUMNS`, `COMPACT_WINDOW_ROWS` rows. Title "Z3 · W2 · 1,240G" (" · Farm"
appended when farming and it fits). Inner rows 1-3: one per hero, cursor cell, `shortName`, " L4",
" H", HP right-aligned in 4, an HP bar, a gauge bar (the bars share what the row leaves, HP
first). Row 4: the front enemy's name and HP bar, or the boss line; a notice replaces it while
set. Footer: the command line.

Hotspots: one per command line item (`p` Party, `l` Loot, `w` World, `c` ▾) at its cells, and `f`
over the purse's tactics row (compact: over the title). The band uses them only on hotkey rung (a)
(Task 1).

`alt`: per window, its text in reading order ("Party: Aldric level 4, HP 42 of 60, gauge full;
…"); the scene's alt joins them.

## Task list

### Task 1: Spikes

**Files:**
- `spikes/ui-remake/` (create): a throwaway plugin, never shipped and never in CI, shaped like
  `spikes/phase-4/`.
- `docs/plans/2026-10-05-ui-remake-spikes.md` (create): the findings sheet, shaped like
  `docs/plans/2026-10-04-phase-4-spikes.md` (questions, how to run, findings table, decisions).

**Interfaces:** Produces the values Task 4 and Task 9 read: `WINDOW_SCALE`, the hotkey rung per
surface, and the PR 2 notes.

**Work:** `/spike-ui` opens a pane and draws in the band. Five questions:

1. **Over a picture.** Does an absolutely positioned `Box` holding a `Text` and a plain `Button`
   paint over an `Image` (Ghostty engine), over a `Raster` (Terminal.app), over an `Svg`
   (desktop)? Does that Button's hotkey fire while the band holds the keyboard?
2. **Sharpness and cost.** A 1-px checkerboard plus 1-px vertical and horizontal lines (a glyph's
   strokes) at 8 × 16 px per cell, scale 1 and scale 2, at strip size (120 × 5 cells) and pane
   size (120 × 24): crisp or soft in the Ghostty engine; bytes; mean blit ms over 50 blits.
3. **Clicks.** Does a click on an `Image` raise anything the plugin sees?
4. **The pane's focus ring.** In a pane of plain Buttons, does Tab/arrow movement tell the plugin
   which Button holds focus (an event, or `onFocus`)? Does a Button with a one-space label join
   the ring and keep its hotkey?
5. **Hotkeys off screen.** Does a band Button keep its hotkey when it is clipped out of the band
   (zero-width Box, or past the right edge)?

Drive cmux and Terminal.app yourself (HANDOFF's driving notes: osascript, `key code 36`, cmux
`read-screen`, `screencapture`); the desktop row is Kevin's.

Decisions the sheet sets:
- `WINDOW_SCALE`: 1 if scale 1 reads crisp in the Ghostty engine; else 2. The widest window is
  the message window of a 160-column band, 80 columns: 640 px at scale 1, 1,280 px and 819,200
  bytes at scale 2, inside both the 2048 px side and `IMAGE_MAX_BYTES`.
- Hotkey rung per surface, first that works: (a) Buttons over the command line, (b) a 3-cell
  column of plain Buttons at the strip's right edge (the strip's windows lose 3 columns), (c) one
  text row of Buttons under the strip (band + 1 row). Question 5 answering yes adds rung (a′):
  Buttons clipped out of view, no visible chrome; it ranks first.
- PR 2 notes, not applied here: the pane picture's bytes and blit time at 120 × 24, the focus
  ring answer, the click answer.

**Acceptance check:** the sheet's findings table has a row each for cmux and Terminal.app, every
question answered or marked "Kevin's"; the decisions section names `WINDOW_SCALE` and the rung for
terminals with and without images. `pnpm lint` passes.

**Boundaries:** Nothing under `plugins/`. If question 1 and 5 both fail on a surface and rung (b)
also fails there: stop, report `blocked: no rung holds hotkeys on <surface>`.

- [x] Spike plugin: band probe (questions 1, 2, 5), pane probe (3, 4)
- [x] Drive cmux and Terminal.app, fill the table
- [x] Decisions, run the check, commit (WINDOW_SCALE 1; rung (a′) on terminals, (c) on the Svg surfaces until Kevin's desktop row)

### Task 2: Transcribe the references

**Files:**
- `docs/design/ui-remake/transcription.md` (create): the anatomy, slot by slot, and the kit
  values it sets.
- `docs/design/ui-remake/README.md` (modify): "Open before a plan" items 1-4 point at the
  transcription and the spike sheet; item 5 notes it was settled by grill 1.1 and 1.15.

**Interfaces:** Produces the values in the "Set by Task 2" rows of the constants table, and the
corner, cursor (▶), ▼, ▾ and divider bitmaps at `CELL_W × CELL_H` as `#`/`.` rows.

**Work:** Load the `design-from-references` skill and follow it. The eight Dragon Quest V Super
Famicom screenshots (5 battle, 3 dialogue) on
https://www.hardcoregaming101.net/dragon-quest-v-hand-of-the-heavenly-bride/ are the references
(grill 1.12); fetch them into the scratchpad, never commit them. One battle screenshot is the
spine. Per reference, a slot table: field colour (sampled hex), border colour, border thickness
and corner shape in source pixels, inner padding, text colour, line pitch, title placement,
cursor shape and position, number alignment, divider. Then a comparison of DQ V's type with
DotGothic16 at 8 × 16 (cap height, stroke width, letter spacing); if DotGothic16 reads wrong
against it, stop and report (the font is Kevin's call, grill 1.5). Then the kit values table, in
the source's 256 × 224 pixels converted to the 8 × 16 cell. Elements the references cannot back
(the HP bar, the gauge, the purse window's contents) are named grafts with their source.

Gate: ask Kevin to approve the transcription (AskUserQuestion, approve a draft) before Task 4.

**Acceptance check:** the sheet has a slot table per reference, the font comparison, a kit values
table covering every "Task 2" row of the constants table, and the five bitmaps. Kevin approved.
`pnpm lint` passes.

**Boundaries:** No code. Window widths and strip rows stay as the constants table says; a reference
that argues for different ones is a note for Kevin, not a change.

- [x] Fetch the references, pick the spine (dq5-8)
- [x] Slot tables, font comparison (Kevin chose Misaki Gothic 2nd, grill 1.18)
- [x] Kit values and bitmaps; Kevin's approval; run the check, commit

### Task 3: Bake the font

**Files:**
- `art/fonts/misaki_gothic_2nd.ttf`, `art/fonts/misaki.txt` (create): from Num Kadoma's
  `misaki_ttf_2021-05-05.zip` (littlelimit.net/misaki.htm); `misaki.txt` holds the licence.
- `scripts/font.ts` (create): reads the TTF, writes `plugins/promptfall/hooks/windows/glyphs.ts`.
- `scripts/font.test.ts` (create).
- `plugins/promptfall/hooks/windows/glyphs.ts` (create, generated).
- `package.json` (modify): `font` and `font:check` scripts (shaped like `sprites` and
  `sprites:check`); `opentype.js` as a dev dependency.
- `plugins/promptfall/NOTICE.md` (modify): a Misaki font section, its licence text, and that the
  plugin ships glyph bitmaps derived from it, not the font file.
- `.github/workflows/ci.yml` (modify): a `pnpm font:check` step after `pnpm sprites:check`.

**Interfaces:** Produces `GLYPH_W = 8`, `GLYPH_H = 16`,
`glyph(ch: string): Uint8Array | null` (16 row bytes, bit 7 the leftmost pixel; null for a
character not in the set).

**Work:** Each baked character is drawn from Misaki Gothic 2nd's full-width form (ASCII
0x21-0x7E as U+FF01-FF5E; space blank; `·` from U+30FB; `…` from U+2026) at 8 px per em, by
sampling each pixel's centre against the outline (the font is drawn on a pixel grid, so this is
exact), and placed in the 16-row cell at rows 5-12 (`GLYPH_Y = 5`, Task 2). Fail the script,
naming the character, if any outline point of a baked glyph falls off the 1 px grid or its
advance is not 8 px. The set: printable ASCII, `·`, `…`, and the Latin-1 letters the font
carries. ▶, ▼ and ▾ come from Task 2's bitmaps, written into the generated module from a small
table in `scripts/font.ts`. Internal encoding of the module is your choice (hex or base64 rows).

**Acceptance check:** `pnpm vitest run scripts/font.test.ts` passes with tests that: `H` and `6`
match the rows Task 2 transcribed against DQ V; every printable ASCII character bakes; a non-grid outline point fails
the script; `pnpm font:check` fails after a hand edit to `glyphs.ts`. Red before: no script. Then
the full check line.

**Boundaries:** Nothing under `hooks/` but the generated file. No runtime file reads.

- [x] Fetch the font and licence
- [x] Script, grid check, hand glyphs
- [x] Tests, NOTICE, run the check, commit

### Task 4: The window model and the image encoder

**Files:**
- `plugins/promptfall/hooks/windows/tuning.ts` (create): the constants table, with Task 1 and
  Task 2's values.
- `plugins/promptfall/hooks/windows/kit.ts` (create): the model types (verbatim above) and the
  helpers both other encoders need (text measuring over spans, clipping, `?` fallback).
- `plugins/promptfall/hooks/windows/image.ts` (create): `windowFrame`, `windowKey`.
- `plugins/promptfall/hooks/windows/image.test.ts` (create).

**Interfaces:** Consumes `glyph` (Task 3), `Frame` (stage/compose.ts), `encodeImage`
(stage/image.ts). Produces the model types, `windowFrame`, `windowKey`.

**Work:** Draw a window at native size: field, border with Task 2's corners and thickness, title
and footer cut into the border with a cell of field on each side, inner rows at `y = 1..rows-2`
cells, spans left to right, bars as filled cells over `BAR_BACK_RGB` with the fill rounded to whole
picture pixels, the cursor bitmap, a 1-px rule under a `rule` line, `reveal` cutting text spans
mid-line. Alpha is 255 everywhere inside the window.

**Acceptance check:** `claude plugin test plugins/promptfall` passes with tests that: a 10 × 3
window's frame is 80 × 48 px; its corner pixels match Task 2's bitmap; a title shows its glyph
pixels in the top border row; a bar at 5000 over 4 cells fills 16 px; `reveal: 3` on "Hello"
draws exactly three glyphs; an unknown character draws `?`; `imageBytes` of the widest strip
window (the message window of a 160-column band, 80 columns) at `WINDOW_SCALE` is under
`IMAGE_MAX_BYTES` and its width under 2048 px. Red before:
no module. Then the full check line.

**Boundaries:** No band, loop or stage change.

- [x] Constants and model
- [x] Frame drawing
- [x] Tests, run the check, commit

### Task 5: The raster and Svg encoders

**Files:**
- `plugins/promptfall/hooks/windows/raster.ts`, `raster.test.ts` (create): `sceneCells`.
- `plugins/promptfall/hooks/windows/svg.ts`, `svg.test.ts` (create): `sceneSvg`.

**Interfaces:** Consumes the model (Task 4). Produces `sceneCells`, `sceneSvg`.

**Work:** Raster: one cell per model cell, the byte layout of `stage/raster.ts` (codepoint, fg,
bg; little-endian u32), field as bg. Titles and footers cut into `─` the same way the pixel
encoder does. A `rule` draws nothing. Svg: native viewBox (`columns × CELL_W` by
`rows × CELL_H`), crisp edges (`shape-rendering="crispEdges"`), each used glyph once as a
`<symbol>`, then `<use>`. With `smil`: a `bar` track animates the bar's width through its keys
(linear, `keyTimes` from `at`) and sets `fullRgb` while at 10000; a `lines` track draws each frame
as a group shown from its `at` to the next frame's; a frame's `typing` line reveals through a
clip rectangle whose width steps one cell per `charMs` (`calcMode="discrete"`); a `cursor` track
shows its ▶ through `<set>` over each interval. Frames past
`STRIP_SVG_MAX_CHARS` are cut from the tail.

**Acceptance check:** `claude plugin test plugins/promptfall` passes with tests that: a 10 × 3
window's cells start `╭` and end `╯`, with the title's characters in row 0; a bar at 5000 over 4
cells gives two filled `▬` and two empty; the Svg of a two-window scene defines each glyph once;
a bar track gives an `<animate>` whose `values` follow its keys, and two keys at one `at` give a
jump, not a ramp; a five-second `lines` track at a
200-character-per-frame load stays under `STRIP_SVG_MAX_CHARS`; `smil: false` emits no
`<animate>` or `<set>`. Red before: no modules. Then the full check line.

**Boundaries:** No band, loop or stage change.

- [x] Raster cells
- [x] Svg, static
- [x] Svg tracks, budget; tests, run the check, commit

### Task 6: The timeline's actions and the gauge tracker

**Files:**
- `plugins/promptfall/hooks/stage/timeline.ts` (modify): export `groups` and `Group`; `onEffects`
  returns the starts; record actions; `acting`, `actionStarts`, `actions`.
- `plugins/promptfall/hooks/stage/timeline.test.ts` (modify).
- `plugins/promptfall/hooks/stage/gauges.ts`, `gauges.test.ts` (create): `GaugeTrack`.

**Interfaces:** Consumes `ACTION_STEPS`, `STEP_MS`, `TICK_MS`, `GAUGE_FULL` from
`hooks/vendor/sim.js`. Produces the timeline additions and `GaugeTrack`, verbatim above.

**Work:** Today's motions, starts and no-overlap rule do not change; the starts are what
`onEffects` already computes. Prune the action records as motions are pruned.

**Acceptance check:** `claude plugin test plugins/promptfall` passes with tests that: `onEffects`
returns one start per group, equal to the lunge's `from`; `acting` names the actor during its
action and the next actor once that one starts; at cadence 5000 the ▶ window is
`ACTION_STEPS × STEP_MS × 2.5` ms; a hero at gauge 2000 with `gaugePerStep` 150 at cadence 2000
draws 2000 + 150 × 5 = 2750 after 500 ms; a hero whose action starts at +800 ms draws 0 at
+800 and `perMs × 200` at +1000; after `endAt` it draws the current view's gauge, and a view
published without a batch (a resync) is drawn at once once `endAt` passed; a spawn-only tick
(`to` equal to `from`) holds the gauge flat; a wipe (`to` 0) draws 0; a fallen hero draws 0; a
second batch landing mid-fill starts from the drawn value, not the view's; `keys` puts two keys at
a reset. Red before: `acting` does not exist. Then the full check line.

**Boundaries:** No change to what the stage draws (its goldens stay byte-identical: run
`pnpm stage:goldens` and confirm `git status` shows no change under `stage/goldens/`).

- [x] Timeline: groups, starts, action records, acting
- [x] Gauge tracker
- [x] Tests, goldens unchanged, run the check, commit

### Task 7: The message log and its wiring

**Files:**
- `plugins/promptfall/hooks/stage/log.ts`, `log.test.ts` (create): `MessageLog`.
- `plugins/promptfall/hooks/engine.ts` (modify): the `onEffects` dep becomes
  `onEffects(effects: Effect[], at: number | undefined, view: GameView | null)`, called on every
  `apply` (effects or none) and on every restep that publishes or has effects, with the view it
  computed for that publish (computed once, used for both); `GameHandle.stage` gains
  `gauges: GaugeTrack` and `log: MessageLog`.
- `plugins/promptfall/hooks/engine.test.ts` (modify): the dep fires on an effect-less tick, with
  the view.
- `plugins/promptfall/hooks/register.tsx` (modify): makes the two; its `onEffects` feeds the
  timeline, then (when the view is not null) `gauges.onTick` and `log.onEffects`, with the
  timeline's starts, the view and the cadence. Toasts and the pane notice keep their behaviour
  (an empty list toasts nothing).
- `plugins/promptfall/hooks/view.ts`, `plugins/promptfall/types/index.d.ts` (modify):
  `HeroView.shortName` (the template's name, no epithet).
- `plugins/promptfall/hooks/stage/fixtures.ts` (modify): `shortName` on fixture heroes.
- `plugins/promptfall/hooks/register.test.ts` (modify): the wiring test.

**Interfaces:** Consumes Task 6. Produces `MessageLog` (verbatim above) and
`handle.stage.gauges`, `handle.stage.log`.

**Work:** Today `onEffects` fires only with effects (`engine.ts:233`, `:402`) and the view reaches
the atom through an async queue, so register cannot read it synchronously; the dep change above
fixes both. Under the combat flow a tick where nobody acts has no effects, and gauges still fill
on it.

**Acceptance check:** `claude plugin test plugins/promptfall` passes with tests that: each row of
the grill 1.16 wording table prints exactly as written; a Black Mage action with three hits prints
one line ending "for 8, 9 and 7."; a kill prints "is defeated!" after the killing action and not
for a world boss; two actions 500 ms apart at cadence 2000 start their lines 500 ms apart; a
burst whose hit lines would fall more than a cadence behind drops hit lines and keeps a drop and a
level-up (the two-actions test uses lines short enough to type in under 500 ms); a line typed at `CHAR_MS` shows 3 characters 3 × `CHAR_MS` ms after its `at`; motion
`still` shows every line whole; a hit that kills an enemy whose spawn tick had no effects
still prints "is defeated!"; and in `register.test.ts`, a tick applied through the engine
leaves lines in `handle.stage.log`, and an effect-less tick leaves a record in
`handle.stage.gauges`. Red before: no module.
Then the full check line.

**Boundaries:** No band change. No toast change.

- [ ] Log lines and pacing
- [ ] Register wiring, empty-tick check
- [ ] Tests, run the check, commit

### Task 8: The strip builder and its goldens

**Files:**
- `plugins/promptfall/hooks/ui/strip.ts`, `strip.test.ts` (create): `stripScene`, `stripTracks`.
- `plugins/promptfall/hooks/stage/scenarios.ts` (modify): strip scenarios `strip-rest`,
  `strip-boss`, `strip-world-boss`, `strip-low-hp`, `strip-compact`, `strip-loot`, `strip-world`,
  `strip-notice`, each with an image hash (all windows), a cells hash and an Svg hash.
- `plugins/promptfall/hooks/stage/goldens/` (regenerated): adds `strip-*.svg` and `strip-*.png`.
- `plugins/promptfall/hooks/stage/golden.test.ts` (modify): the strip goldens.
- `scripts/stage-goldens.ts` (modify): writes the strip goldens and a PNG of each strip scenario
  (through `writePng` from `scripts/png.ts`) for eyeballing.

**Interfaces:** Consumes Tasks 4-7, `worldRows`, `shownBoss`, `formatGold` from `hooks/ui/`.
Produces `stripScene`, `stripTracks`, `Hotspot`.

**Work:** Follow the builder contract above. `stripTracks` builds a `bar` track per living hero
from `gauges.keys`, a `cursor` track per hero from the timeline's action records (the same
interval `acting` uses), and one `lines` track for the message window from `log.upcoming`, over
the given horizon. Scenario fixtures reuse `stage/fixtures.ts`.

Gate: show Kevin the `strip-*.png` files (AskUserQuestion, approve a draft) before Task 9. A
red from him is fixed here, not in Task 9.

**Acceptance check:** `claude plugin test plugins/promptfall` passes with tests that: at 120
columns the four windows' widths sum to 120 and the message window is 40 wide; at 116 it is 36;
`bare` at 110 has no enemy window; the enemy window titles read "Zone 3 · Wave 2", "Zone 3 ·
Boss", "World boss · 11m"; ▶ sits on the acting hero and on the current tab; a hero at 20% HP has
`WARN_RGB` text and one at 0 `DOWN_RGB`; a notice replaces the third message row on Loot; a 40-
character log line in a 30-wide message window fills both rows; hotspots cover the command line's
words; the alt names every hero's HP and gauge; across every strip scenario, every tab and a
notice, every character the scene holds has a glyph (no `?`); a 250-column band's windows are laid
out in 160; the strip goldens match. Red before: no module.
Then the full check line.

**Boundaries:** No band or loop change. The stage goldens stay byte-identical.

- [ ] Window contents per kind
- [ ] Tracks, hotspots, alt
- [ ] Scenarios, goldens, PNGs; Kevin's look; run the check, commit

### Task 9: The band draws the strip

**Files:**
- `plugins/promptfall/hooks/ui/band.tsx` (modify): the full, compact, Loot and World branches draw
  the strip; the status row and its tab Buttons go; the hotkey rung from Task 1; the `f` hotkey.
- `plugins/promptfall/hooks/ui/parts.tsx` (modify): remove `PartyLine` and anything only it used.
- `plugins/promptfall/hooks/stage/layout.ts` (modify): the contract below.
- `plugins/promptfall/hooks/stage/tuning.ts` (modify): `STAGE_TEXT_ROWS` and `DESKTOP_TEXT_ROWS`
  go; `COMPACT_ROWS` (4) is renamed `COMPACT_STAGE_ROWS` and keeps sizing the compact stage box.
- `plugins/promptfall/hooks/stage/svg.ts` (modify): its compact test reads `COMPACT_STAGE_ROWS`.
- `plugins/promptfall/hooks/stage/loop.ts` (modify): the site and io below; each frame blits the
  strip; the frame delay rule below.
- `plugins/promptfall/hooks/register.tsx` (modify): builds the extended `LoopIo`.
- `plugins/promptfall/hooks/band.test.ts`, `stage/layout.test.ts`, `stage/loop.test.ts`,
  `stage/svg.test.ts` (modify).

**Interfaces:** Consumes `stripScene`, `stripTracks`, the encoders, `handle.stage.gauges` and
`handle.stage.log`.

**Layout contract** (`layout.ts`):

```ts
export type Layout =
  | { kind: 'full'; box: Box; bandRows: number }                 // rows + STRIP_ROWS + extra
  | { kind: 'compact'; box: Box; bandRows: number }              // box 52 × COMPACT_STAGE_ROWS; COMPACT_WINDOW_ROWS + extra
  | { kind: 'bare'; box: null; bandRows: number }                // Loot, World: STRIP_ROWS + extra
  | { kind: 'collapsed'; box: null; bandRows: 1 }
export function layoutFor(rows: number, props: { bodyColumns: number; maxRows: number },
  surface: RenderSurface, opts: { tab: BandTab; extra: 0 | 1 }): Layout
```

`extra` is 1 on hotkey rung (c) for that renderer. Terminal: Party is `full` when
`bodyColumns ≥ 116` and `maxRows ≥ rows + STRIP_ROWS + extra`, else `compact` when
`bodyColumns ≥ 100` and `maxRows ≥ COMPACT_WINDOW_ROWS + extra` (grill 1.17), else `collapsed`;
Loot and World are `bare` when `bodyColumns ≥ 100` and `maxRows ≥ STRIP_ROWS + extra`, else
`collapsed`. Svg surfaces: Party always `full`, Loot and World always `bare`.

**Loop contract** (`loop.ts`): `StageSite` gains
`strip: { kind: 'full' | 'compact' | 'bare'; columns: number; tab: BandTab; keys: readonly string[] }`
(`keys` the window Image keys on `image`, `['strip']` on `raster`). `LoopIo` gains
`strip: () => Promise<{ world: WorldState; notice: string | null; gauges: GaugeTrack; log: MessageLog } | null>`.
A `bare` site's frame checks only that `layoutFor` still answers `bare` for its props (a boss
spawning on Loot is not a layout change) and blits no stage. The loop caches each window's last
encoded source by its `Win` JSON and skips the encode and the blit when it is unchanged.

**Work:**
- Image terminals: one `Image` per strip window (key `windowKey`, alt the window's `alt`), in a
  row `Box`, left to right; the loop blits each window every frame (an unchanged source sends
  nothing). Raster terminals: one `Raster` keyed `strip`, blitted the same way. Probe pending: the
  strip's rows empty, as the stage does; the 1 × 1 probe `Image` moves from the deleted status row
  into the first empty strip row, and arms on every tab (Loot and World need the renderer too).
- Svg surfaces: a second `Svg` under the stage, `stripScene` (at the stage's columns) plus
  `stripTracks` over a horizon of the cadence plus 1 s, rendered on each band render (once a tick,
  as the stage), scaled to the band's width; the stage's fit cap subtracts the strip's height in desktop rows
  (`ceil(stripHeightPx / DESKTOP_ROW_PX)`), replacing `DESKTOP_TEXT_ROWS`.
- Compact: the 52-column stage centred vertically in 6 rows (a blank row above and below), the
  party window beside it on the right.
- Loot and World: `kind: 'bare'`, no stage, the band is the strip.
- Collapsed: unchanged.
- Hotkeys: `p`, `l`, `w`, `c` as today; `f` toggles farm through the path `/promptfall farm` uses
  (`hooks/command.ts:96-103`). Placed per Task 1's rung for the surface; on rung (a) at the
  hotspots. The desktop takes rung (c) unless Kevin's desktop row in the spike sheet says a higher
  rung works there.
- Loop delay: `EVENT_FRAME_MS` while the timeline or the log is busy;
  `min(GAUGE_FRAME_MS, restDelay(now))` while a gauge fills; else `restDelay(now)`. Motion `still`'s frame skip also needs the strip unchanged since
  the last blit.

**Acceptance check:** `claude plugin test plugins/promptfall` passes with tests that:
- terminal, image and raster renderers: the Party band at rest is 13 rows (14 on rung c), a zone
  boss 22, compact 6, Loot and World 5; a Party band with `maxRows` 5 collapses; the image band
  mounts four window Images with alts; the raster band mounts a `strip` Raster; the probe arms on
  the World tab; a boss spawning while on Loot keeps the loop running;
- desktop: two Svgs; at 95 columns the strip Svg is laid out in 116 columns and scaled; the World
  tab draws the strip Svg alone;
- every surface: `p`, `l`, `w`, `c` switch and collapse; `f` applies `set_farm` and the purse reads
  "Farm here";
- loop: it blits the strip on the World tab and stops when collapsed; with only a gauge filling it
  re-arms at `min(GAUGE_FRAME_MS, restDelay)`; an unchanged window is not blitted twice.
Red before: the band has a status row. Then the full check line.

**Boundaries:** No pane (dialog) change; that is PR 2. No change to what the stage itself draws.

- [ ] Layout rows and constants
- [ ] Loop: strip blits, delay rule, Loot and World
- [ ] Band branches per surface, hotkeys, `f`
- [ ] Remove the status row and `PartyLine`; tests, run the check, commit

### Task 10: Docs, the driven pass, the pull request

**Files:**
- `docs/spec/promptfall.md` (modify): §2 (13 rows at rest on the Party tab, up to 22 in a zone or
  world boss fight, compact 6 rows, Loot and World 5; plus 1 everywhere on rung c); §10's band
  tab, Party tab, stage motion, Loot, World and world boss paragraphs (the strip, the command
  line, the log, the purse and `f`; the loop now runs on Loot and World for the strip).
- `docs/adr/0003-band-grows-for-the-stage.md` (modify): an "Amended" note for the new row counts.
- `docs/adr/0005-interface-drawn-as-windows.md` (modify, only if Tasks 1-9 contradicted it): a
  dated note.
- `CONTEXT.md` (modify): Window, Strip, Message window, Command line, Combat log, Purse.
- `docs/manual-pass/2026-10-05-ui-pr1.md` (create): the driven pass.
- `docs/plans/2026-10-05-ui-pr1-window-band.md` (modify): tick the boxes.

**Work:** Load `unslop` before writing the spec and glossary text. Drive the band in cmux (image,
colour) and Terminal.app (raster) with the HANDOFF's driving notes, through: a turn at rest, a
fight with the log typing, a level-up and a drop line, a wipe, a zone boss (22 rows), compact at
110 columns, Loot, World, `f`, collapse and back, motion `still`. Capture window screenshots into
the scratchpad (not committed); the manual-pass doc records each step's result. The desktop and
standalone Ghostty rows are Kevin's. Then open the PR into `ai-staging` with the manual test
rundown and which parts were verified here.

**Acceptance check:** the full check line passes; the manual-pass doc has every step driven on
cmux and Terminal.app with its result; the PR is open.

**Boundaries:** No code change here except a fix found by the pass, committed separately with
its own test.

- [ ] Spec, ADRs, glossary
- [ ] Driven pass
- [ ] Ticks, PR
