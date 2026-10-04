# Phase 4 grill: sprites and sound

Grilled on 2026-10-04 on branch `feat/phase-3-boss`, on Opus 5.5 by Kevin's decision (Fable
quota nearly spent), with Kevin answering. This is the record the phase 4 planner starts
from. It holds decisions and facts, not a plan. Decisions are Kevin's unless marked; the
recommendation Kevin accepted is noted as "recommended, accepted". Written as the grill
runs, so a later round can amend an earlier node; the amendment says so.

## 1. Settled design tree

### 1.1 The stage (Kevin, Q1, recommended, accepted)

- The band's Party tab gets a **stage**: an animated side-on battle scene, enemies left,
  party right, Final Fantasy 1 battle-screen layout. The hero rows and the status row sit
  beside it. Dialog lists (inventory, heroes, market) get item and hero sprites too.
- Everything on the stage animates: idle loop, attack lunge, hit flash, death dissolve,
  spawn fade-in. The exact set is a later round.

### 1.2 Renderers per surface (Q2 recommended, accepted; amended by Kevin after the art page)

- kitty and Ghostty: the `Image` element, fed raw RGBA frames.
- Desktop, VS Code, mobile: the `Svg` element.
- Every other terminal (iTerm2, Terminal.app, Warp, tmux): the `Raster` element in
  half-blocks, the claude-toons technique. **Amended:** the first answer kept today's glyph
  band there; Kevin rejected that after seeing it: "we need proper visuals, for every
  single terminal". Glyph rows are no longer a stage fallback anywhere.
- Pixel detection: draw one keyed `Image` per session and blit it; a `deny` means the
  terminal shows the alt, so the Raster path draws. The plan opens with a spike proving it.

### 1.3 Sprite data (Q3, recommended, accepted)

- Source art is PNG in an `art/` folder. A build script turns it into a generated TS module
  of indexed sprites (palette plus pixel indices plus frames), committed, CI fails when
  stale, like the vendor bundle. Runtime composes RGBA for Image, SVG for desktop, cells
  for Raster. Indexed colour makes recolours, hit flash and dissolve palette operations.

### 1.4 Footprint (Q4, recommended, accepted)

- Spec §2 amended to "interface (including images and sound from the mod's own files),
  state, store, clock, HTTP and commands". No file system, no process spawning, no model
  calls stay.

### 1.5 Sound (Q5, Q6, Q7, recommended, accepted)

- Cues are a strict subset of toasts. Four clips: drop (Rare, Epic), legendary drop, level
  up, world boss appeared. Nothing for zone or turn bosses, wipes or chat.
- Only the primary session plays cues.
- Per-machine toggle in `$.store`, off by default, in the Account tab and as
  `/promptfall sound on|off`. Fixed gain 0.6, no volume control.

### 1.6 Art direction (Kevin, after the art directions page)

- Heroes and monsters in the NES style: 16 × 16, about 4 to 6 colours a sprite, black
  outline.
- Bosses in the SNES style: up to 48 × 34, about 14 colours, unique art for every boss,
  never an enlarged regular enemy, and really big: a boss fills the stage's full height.
- Kenney Tiny Dungeon dropped as a direction.

### 1.7 Stage size (Q8 Kevin, amending the recommendation; Q9 recommended, accepted)

- In half-block terminals the stage is 8 rows at rest (heroes and monsters at full 16 px
  detail), with the party line and the status row under it: the band is 10 rows at rest.
  While a boss is on the stage it grows to 17 rows (bosses at full 34 px SNES detail): 19
  rows in all. **Amended:** the recommendation was 12 rows in a boss fight; Kevin chose 17.
- Spec §2's "the band is 4 rows at rest" is amended to match. Collapsing to 1 row, hiding
  while Claude asks a question, collapsing under 100 columns and `/promptfall off` stay.
- A terminal too short for the full stage gets a 4-row compact stage.
- One stage geometry in rows and columns on every terminal; each renderer fills it at its
  own resolution, so Ghostty draws the same box crisp. The desktop Svg keeps the
  proportions.

### 1.8 Art production (Q11 to Q14, recommended, accepted)

- Turn bosses are SNES, about two-thirds of a zone boss.
- Sprites are generated with gpt-image-2 through codex-image, one sheet per zone (4
  monsters, zone boss, turn boss), always with the approved style sheet attached; the build
  slices and palette-locks them; Kevin reviews each zone on a contact page and rejects get
  regenerated; hand cleanup in Aseprite or Pixelorama only for the 4 heroes and 4 world
  bosses. Spec §11's licensed-pack plan is dropped: nothing third-party ships.
- Away from Final Fantasy: the black mage loses the shadowed face with glowing eyes under a
  wide brim (a visible masked face, another hat shape), the white mage loses the red
  triangle trim, the archer loses the green pointed cap.
- NES set locked to the NES master palette, at most 4 colours a sprite including the black
  outline. SNES bosses at most 16 colours each from one shared 64-colour master. The build
  fails a sprite that breaks either rule.

### 1.9 Motion (Q15, Q16, recommended, accepted)

- Animation is code-generated from one drawing (idle bob, lunge, hit flash, death dissolve,
  spawn fade-in, damage numbers) plus one drawn attack or cast pose per hero class (4 more
  sprites). Damage numbers on every surface; half-block terminals draw them as text cells
  on the stage.
- About 12 frames a second during an event, the idle bob at 2 a second, nothing while the
  band is hidden, collapsed or on another tab. Account setting "Motion: full / still",
  default full; still drops the idle bob only.

### 1.10 Items, backdrop, sound source (Q17, Q18, Q19, recommended, accepted)

- Item sprites: 16 px icons in dialog lists on Image and Svg; in half-block terminals a
  2-row icon (8 × 4 pixels) cut automatically; and on every surface a drop pops out of the
  defeated enemy on the stage.
- Behind the stage: a one-row ground strip coloured per zone, transparent above it. Full
  per-zone backdrops are later polish.
- Cues: four clips picked from Juhani Junkala's CC0 "512 Sound Effects (8-bit style)",
  committed as `.wav` in the plugin folder.

### 1.11 Stage behaviour (Q10 by consequence; Q20 to Q23, recommended, accepted)

- Q10 settled by Q8: bosses draw at full detail at 17 rows; only the compact stage and the
  2-row item icons downsample, automatically, in the build.
- The stage grows only as tall as the boss needs: 12 rows for a turn boss, 17 for zone and
  world bosses. It grows at spawn as the boss fades in and shrinks back to 8 after the
  death dissolve and the drop pop.
- Loot and World tabs keep today's 4 rows; switching tabs changes the band's height. A
  boss arriving never switches the tab.
- The zone ground strip is the stage's bottom row, inside its height.
- Compact 4-row stage (side by side with the hero rows, sprites downsampled) when `maxRows`
  is under what the full stage needs now, or `bodyColumns` is 100 to 115. Collapsed to 1
  row under 100 columns or `maxRows` under 4. A boss on a terminal too short for 19 rows
  shows downsampled in the compact stage.

### 1.12 Hits, rarity, gate, PRs, verification (Q24 to Q28, recommended, accepted)

- The sim gains an output-only effect `{ k: 'hit', by, target, amount }`, one per attack.
  No state change, no `SIM_VERSION` bump (effects feed neither the hash nor the goldens;
  the ledger reads only `rejected`). The vendored bundle is rebuilt; a test proves state
  hashes unchanged.
- One sprite per hero class; one palette slot (trim or cape) takes the rarity colour:
  Common grey, Uncommon green, Rare blue, Epic magenta, Legendary gold. Equipment is not
  drawn.
- First art deliverable: a style sheet Kevin approves before mass generation (4 redesigned
  heroes with attack poses, zone 1's 4 monsters, zone boss and turn boss, one world boss,
  4 item icons). Every later sheet attaches it as the reference.
- Two PRs into `ai-staging`. PR 1, engine: pixel-detection spike, sprite pipeline and
  palette checks, three renderers, stage layout (grow, compact, collapse), animation set,
  the `hit` effect, cues and the motion toggle, item icons in lists, on the concept sprites
  as placeholders. PR 2, art: the style sheet gate, then the ~124 sprites zone by zone, and
  the four cue clips.
- Verification on top of the spec's bar: golden frames per renderer under a mock clock
  (Image RGBA hash, Raster cells, Svg string) for wave, boss grow, compact, dissolve and
  drop pop; budget tests (Svg under 131,072 characters, Raster under 1,024 colour pairs, no
  frames while hidden); a manual pass in Ghostty, iTerm2, Terminal.app, tmux and the
  desktop app; real-surface checks through `codex-computer-use` before the batch is done.

### 1.13 Desktop motion, names, cues, text surfaces (Q29 to Q33, recommended, accepted)

- Desktop, VS Code and mobile: one redraw per combat round, an `isInteractive` Svg carrying
  that round's lunge, flash, dissolve and damage number as SMIL with timed begins, plus a
  looping idle bob. The engine PR's spike proves SMIL runs there; if not, redraws at most 6
  a second.
- The front enemy's name and HP ride the party line (`⚔ Goblin Brute 42/60`); a boss keeps
  its status-row segment. No names drawn over the art.
- Cues follow toasts: `/promptfall off` hides the band, not the cues; the sound toggle
  silences them.
- ADR 0003 records the band growing for the stage.
- Text stays text on the Loot tab, the World tab, the collapsed row, toasts and chat.
  Every Image and Svg carries an alt summarising the scene.

## 2. Facts gathered

- Content to draw: 4 hero classes, 72 enemies (12 zones × brute, swift, tank, caster,
  zone boss, turn boss), 4 world bosses, 40 item bases. Glyphs today are per archetype.
- `Image` shows pixels on kitty and Ghostty only; alt elsewhere; tmux passes none. No
  capability flag; `$.ui.blit` denies on an Image drawing its alt.
- `Raster`: terminal only, cells of one BMP glyph plus fg plus bg, 1 to 512 columns, 1 to
  256 rows, 1024 colour pairs at once, `$.ui.blit` repaints up to 120 a second, about 60
  shown. Half-blocks give 2 pixels per row; sextants are outside the BMP and refused.
- Desktop, VS Code and mobile have `Svg` (at most 131,072 characters, an image, or a
  sandboxed frame with SMIL when `isInteractive`), no Image or Raster.
- `$.audio.play({ asset })` plays a plugin file through `afplay` on macOS; Linux and Windows
  terminals play nothing; clips do not queue; gain 0 to 4; loop with an abort signal.
- Kevin's terminal is Ghostty (default config: 13 pt, cells about 8 × 17 px).
- Repo `kevinshibuya/promptfall` is private.
- Licences: Time Fantasy forbids redistributing raw files; 0x72 DungeonTileset II and
  Kenney are CC0; Shikashi's icons are CC BY 4.0 (credit Matt Firth and game-icons.net);
  Juhani Junkala's 512 8-bit sound effects are CC0; PixelLab assigns output ownership;
  Retro Diffusion and OpenAI terms unconfirmed.
- Generated concepts (gpt-image-2): the black mage and white mage read as Final Fantasy's
  own designs, the NES archer as Link.
- The sim's `Effect` union (`packages/sim/src/types.ts:127`) has no per-hit effect: drops,
  gold, level up, wave and zone cleared, boss spawned, hero fell, wipe, party applied,
  recruited, rejected, rewarded, traded. Who hit whom for how much is not reported.
- Half-block cost: a 16 px sprite is 16 columns × 8 rows; three heroes plus three monsters
  need about 110 columns. The art page: https://claude.ai/artifact/1nJaaRAXGsfi53PFnf9nqB

## 3. For the planner

- Spikes that open PR 1: `Image` alt detection through a refused blit; whether Ghostty
  smooths a scaled `Image` (if it does, compose frames at an integer upscale); SMIL in an
  `isInteractive` Svg on the desktop.
- Spec sections amended by this grill: §2 (band size, footprint), §3 (Raster, Svg, audio
  facts), §10 (band rows, stage, sound), §11 (art), §12 (phase 4 in two PRs).
- Nothing open. The frontier closed after four rounds.
