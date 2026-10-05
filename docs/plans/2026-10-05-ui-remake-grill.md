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

### 1.7 The band strip (Q9, Q12, Q13, Q14, Q20, recommended, accepted)

- Grouped, as Dragon Quest V's battle screen: an **enemy window** under the enemies, one line
  per enemy with its name and HP bar (at most 3); a **party window** under the heroes, one
  column per hero; a **message window** for the log. Placement of the message window is a
  later round (the 3-enemy case leaves little room between the two).
- The band tabs become a command line on the message window (`▶Party Loot World ▾`, same
  hotkeys `p`, `l`, `w`, `c`). Party shows the log, Loot the latest drops, World the world
  boss.
- Compact (100-115 columns, or short): one party window beside the 52-column stage, the front
  enemy as an extra line in it. Collapsed (1 row): stays one text line.
- Bosses: the enemy window shows the boss on one line with a long bar and its numbers (the
  world boss with today's predicted bar), minions on the lines below. Stage heights unchanged.

### 1.8 The combat log (Q10 Kevin: every event; Q11 recommended, accepted)

- The log prints every event, hits included, Dragon Quest style. Kevin chose this over the
  recommended notable-events-only. Pacing under a burst of hits is a later round.
- Messages type out letter by letter when the Motion setting is full, instantly when reduced.
  No blip sound.

### 1.9 The pane (Q15, Q16, recommended, accepted)

- 24 rows, at most 120 columns, centred on wider terminals.
- Market filters become command windows inside the picture. Only typed values (chat message,
  order price and quantity) stay `Input`s under the picture.

### 1.10 Spikes (Q17, recommended, accepted)

- The plan's first task, run like phase 4's (the implementing session drives cmux and
  Terminal.app; Kevin checks standalone Ghostty and the desktop): text over an `Image`, image
  sharpness at pane size, clicks, and whether the pane's focus ring (Tab, arrows, Enter over
  hidden Buttons) can drive the ▶ cursor or a `Client` is needed. If neither, no cursor:
  digits pick rows, letters pick actions.

### 1.11 ADR 0005 (Q18, recommended, accepted)

- `docs/adr/0005-interface-drawn-as-windows.md`: one window model, three encoders, the font
  baked in.

### 1.12 References (Q19, Q21, recommended, accepted)

- Eight Dragon Quest V Super Famicom screenshots (5 battle, 3 dialogue) from
  https://www.hardcoregaming101.net/dragon-quest-v-hand-of-the-heavenly-bride/ are the
  references for the band and the message window. They are not committed (copyright); the
  page is the source.
- No menu, item list, shop or status screenshots were found (MobyGames blocks scripts; the
  strategy sites cover the remakes). The pane is built from the anatomy in hand: header row
  and divider, ▶ lists, right-aligned number columns, Yes/No windows, the message window and
  its ▼. Kevin may add menu shots before the PR 2 plan.
- What the references show that the mockups got wrong: the field is dark charcoal, not black;
  the border is a single white rounded line; the party and command windows have a header row
  (names, or the acting hero) under a white divider; the party window has one column per
  member with H, M and Lv rows; HP is numbers only (the bar is the Pokémon graft); the enemy
  window lists groups with counts; a small tactics window sits top right.

### 1.13 Strip details (Q22 to Q27, recommended, accepted)

- The message window sits between the enemy window and the party window: about 32 characters
  at 120 columns, wider on wider terminals. The strip is about 5 rows; the band at rest is
  about 13 rows (spec §2 amended once the strip is final).
- A hit reads on one line: "Aldric hits Wood Goblin for 12." Kills, drops and level-ups use
  Dragon Quest's wording ("Wood Goblin is defeated!", "Found a Silk Robe!", "Morwen reached
  level 5!").
- Pacing: lines queue; when the queue falls more than one tick behind, pending hit lines are
  skipped (never kills, drops, level-ups, deaths or sales) and typing speeds up. Likely amended
  by the combat flow below, which plays one action at a time.
- One line of the pixel font is one terminal row; windows are laid out in whole cells.
- Party window: a header row with the names, a white divider, an "H" row (number plus the
  borrowed bar), an "Lv" row. A hero's column turns orange under 25% HP and red at 0 (to check
  against Dragon Quest V during transcription). Amended by 1.14 for the action gauge.
- A small tactics window shows "Push on" or "Farm here" (the `farm` state), toggled with `f`.

### 1.14 Action gauges (Kevin, raised during round 3)

- Kevin is changing combat to an Active Time Battle flow, as in the Super Famicom Final Fantasy
  games: every unit's gauge fills; a unit with a full gauge joins a queue; units act one at a
  time in the order their gauges filled; the action (basic attack, skill, technique) is picked
  at random, weighted by how much sense it makes (a healer heals an ally under 50%). Skills and
  techniques are future work; the flow comes first.
- For this remake: the party window shows each hero's action gauge filling. Enemy gauges are
  never shown.
- The combat flow itself is a sim change with its own grill, plan and PR, not part of this
  grill.

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
- A wave holds at most 3 enemies at once (`packages/sim/src/progression.ts:153`); with 3
  enemies and 3 heroes at 120 columns the stage is full edge to edge.
- The `hit` effect carries `by`, `target` and `amount` only (`hooks/vendor/sim.d.ts:257-261`).
