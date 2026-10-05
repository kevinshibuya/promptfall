# UI remake grill: command windows

Grilled on 2026-10-05 on branch `feat/ui-remake`, on Opus 5.5 (Fable out of credits locally and
in the cloud), with Kevin answering. This is the record the UI remake planner starts from. It
holds decisions and facts, not a plan. Decisions are Kevin's; "recommended, accepted" marks a
recommendation Kevin took. Written as the grill runs, so a later round can amend an earlier
node; the amendment says so.

Style direction: B, Command Windows (`docs/design/ui-remake/README.md`).

## 1. Settled design tree

### 1.1 Delivery (Q1, Q2, recommended, accepted)

- Three PRs into `ai-staging`: PR 1 is the window kit (frames, font, cursor, renderers) and the
  band; PR 2 is the Inventory and Heroes tabs; PR 3 is Market, Orders, Account, Odds, Chat and
  Leaderboards.
- The remake goes before phase 4 PR 2 (the real sprite art). B's chrome is black and white, so
  it does not wait on the sprite palette.

### 1.2 References (Q3, recommended, accepted)

- Claude gathers Dragon Quest V (Super Famicom) screenshots and shows Kevin a contact sheet;
  Kevin approves the set; the anatomy is transcribed from it before any layout work.

### 1.3 Surfaces (Q4, Kevin: every surface at once)

- Every surface gets the windows in the same PR: image terminals (kitty, Ghostty), terminals
  without images (Raster stage, windows drawn in box-drawing characters), desktop, VS Code and
  mobile (Svg). Each PR ships its windows on all of them.

### 1.4 Input (Q5, recommended, accepted)

- Keyboard only in v1: arrows, Enter, Escape and letter shortcuts. Clicks inside the pictures
  come later, if the click spike finds a cheap way.

### 1.5 Text (Q6, Q8, recommended, accepted)

- Text inside windows is a pixel font baked into the window pictures, not terminal text over
  them. Fields the player types into (chat, order forms) stay real `Input`s in a row under
  the picture.
- The font is DotGothic16 (SIL Open Font License), to be checked against Dragon Quest V's real
  type during transcription.

### 1.6 Band height (Q7, recommended, accepted, widened by Kevin)

- The two text rows under the stage become a window strip of at least 3 rows. Kevin: "expand
  as much as needed to have space for our new style". Spec §2's "10 rows at rest" gets amended
  to whatever the strip needs.

## 2. Facts gathered

- Band layouts are `full | compact | collapsed` (`hooks/stage/layout.ts:13-42`): full at 116+
  columns, compact (52×4 stage, 4 rows) at 100-115, collapsed (1 row) below. Off-terminal
  surfaces are always full.
- The status row carries zone, wave, gold, a tail (notice, boss, or `last: <drop>`), and the
  band tab Buttons `p` party, `l` loot, `w` world, `c` collapse (`hooks/ui/band.tsx:363-412`).
- No combat log exists. The sim emits hit, drop, drop_vendored, gold, level_up, wave_cleared,
  zone_cleared, boss_spawned, hero_fell, wipe, party_applied, hero_recruited, rejected,
  rewarded and traded effects; only the loot log is kept as text (`hooks/view.ts:16,233`).
- The pane opens at `rows: 20` with no columns (`hooks/command.ts:108-115`). Its focus ring
  moves on Tab, arrows and click among Buttons; Enter presses the focused one (engine d.ts
  998, 3944). Only a `Client` gets raw keys, and a `Client` cannot draw `Image`.
- Stage frames are raw RGBA upscaled 6× by the plugin, no PNG (`hooks/stage/image.ts:4-24`).
  The engine caps an Image at 2 MiB decoded. Nothing in the engine says whether an absolute
  Box paints over an Image, or how an Image is scaled.
- The phase 4 spikes were driven by the implementing session through cmux (Ghostty engine)
  and Terminal.app (`docs/plans/2026-10-04-phase-4-spikes.md`).
