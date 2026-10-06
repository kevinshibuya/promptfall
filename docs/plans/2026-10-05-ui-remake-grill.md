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

### 1.15 Order, gauges, the acting hero, closing (Q28 to Q31, recommended, accepted)

- The combat flow (1.14) is its own pipeline: its grill runs next, in this session; its PR
  lands first. Order: combat PR, then UI PR 1 (band), UI PR 2, UI PR 3, then phase 4 PR 2
  (art). This amends 1.1, which put the remake straight after phase 4 PR 1.
- Party window, final: per hero column, a header with the name and level ("Aldric L4"), a
  white divider, an H row (number plus bar), and an unlabelled action gauge row that fills
  left to right and turns gold when full and queued. The reference's Lv row is dropped. The
  strip stays about 5 rows.
- The acting hero gets a ▶ beside its name in the party window header while its action plays,
  on top of the stage's lunge.
- The UI grill closes here. Three nodes move to the combat grill: log pacing under one action
  at a time (1.13's skipping rule may go), the gauge's fill rate and how "full" shows in time,
  and the order the stage plays events in.

### 1.16 Planning gaps (round 4, while planning UI PR 1, recommended, accepted)

Raised by the UI PR 1 planner on 2026-10-05 (Opus 5.5, Fable still out); Kevin took every
recommendation.

- Zone, wave, gold and tactics: "Zone 3 · Wave 2" is the enemy window's title. A small window at
  the strip's right end holds gold ("1,240G") and tactics ("Push on" or "Farm here", `f`
  toggles). The zone name leaves the band (it stays in the alt, the World tab and the "Zone 3
  cleared!" line).
- The status tail: a notice is a message window line, shown at once, never typed. Boss % and time
  left sit on the boss's line in the enemy window (1.7). The last drop is a log line and the Loot
  tab. Nothing else carries the tail.
- Loot and World tabs: no stage. The band is the strip alone; the message window shows the last
  two drops or the World lines (online in your zone, then the chat ticker or your records). The
  other windows stay.
- Compact (100-115 columns, or short) grows from 4 to 6 rows: the 52-column stage centred
  vertically, beside one party window whose top border carries "Z3 · W2 · 1,240G", then three
  hero rows (`Aldric L4 H 42 ▬▬ ▰▰▱`, ▶ on the acting hero), a front enemy row, and the command
  line `▶Party Loot World ▾` in its bottom border. No message window and no log in compact. Under
  4 rows of height the band collapses to one line.
- A Black Mage action is one line: "Morwen hits 3 foes for 8, 9 and 7." Kills follow on their own
  lines.
- The log's words: "Aldric hits Wood Goblin for 12." / "Wood Goblin hits Aldric for 5.";
  "Lyra heals Aldric for 14."; "Wood Goblin is defeated!"; "Found a Silk Robe!"; "Found a Rusty
  Sword, sold for 3G."; "Morwen reached level 5!"; "Aldric falls!"; "Grave Lord appears!";
  "Zone 3 cleared!"; "The party retreats to zone 2."; "Sold Silk Robe for 120G."; "Boss reward:
  50G." Gold, wave_cleared and the other effects print nothing.
- Pacing: 1.13's skip rule stays as a safety valve only (hit lines dropped when the queue falls
  more than a tick behind; never kills, drops, level-ups, deaths or sales); typing speeds up while
  two or more lines wait. This settles the node 1.15 moved to the combat grill.
- Tab hotkeys need Buttons on screen. The spike picks the first rung that works: (a) plain
  Buttons positioned over the command line in the picture; (b) a 3-cell column of Buttons at the
  strip's right edge; (c) one text row of Buttons under the strip (band +1 row).
- Planner's calls, cheap to change: a window cell is 8 x 16 picture pixels (DotGothic16's Latin
  glyphs), the spike checks sharpness; the desktop strip is a second `Svg` under the stage,
  gauges animate with SMIL and typing is a stepped clip; gauges fill smoothly by replaying
  `gaugePerStep` from the timeline's action starts, snapping to the view's value when the tick's
  playback ends.

### 1.17 Plan review rulings (2026-10-05, on Opus, Fable out)

Made in the UI PR 1 plan's fix pass, inline on Opus because `reasoner` needs Fable; Kevin can
overturn either.

- Compact collapses under 6 rows, not 4. 1.16's "under 4 rows" carried today's threshold over,
  but a 6-row compact band cannot fit a 4 or 5 row terminal; the band never draws taller than the
  terminal shows. On Loot and World (5 rows) the band collapses under 5.
- The world boss's time left sits in the enemy window's title ("World boss · 11m"), not on the
  boss's line (1.16): the line's 21 cells hold the name, the bar and the percentage, and no more.

### 1.18 The font (Kevin, during UI PR 1's transcription)

- The windows bake **Misaki Gothic 2nd** (美咲ゴシック第2, Num Kadoma; free to use, modify and
  redistribute), its full-width Latin forms at 8 px, each 8 x 8 glyph placed in the 8 x 16 cell
  from row 5, as Dragon Quest V places its type. This replaces 1.5's DotGothic16: measured
  against the references, DQ V's type has 7 px caps, 1 px strokes and a 16 px line (9 px of
  leading); DotGothic16 has 13 px caps and a 24 px line, so in a 16 px row it leaves no leading
  and clips descenders. Accepted cost: lowercase reads letter-spaced (narrow glyphs on an 8 px
  advance).

### 1.19 Menu references for UI PR 2 (2026-10-06, Kevin delegated the search)

- No menu shots were added. A second search found the Dragons Den gallery
  (https://www.woodus.com/den/games/dq5snes/screenshots.php, 32 Super Famicom shots, fan
  translation; not committed). It shows battle, dialogue and field scenes only: no item list,
  status, equipment or shop screen. The Japanese strategy sites cover the remakes.
- Two things it adds to 1.12's anatomy, both consistent with it: the Yes/No window sits top
  right with a ▶ on the chosen line (shots 016, 032), and a party of one keeps the same window,
  shrunk to a single column: name header, then H, M, L rows (shot 011).
- The PR 2 plan builds the pane from 1.12's anatomy plus these two.

### 1.20 Planning gaps for UI PR 2 (2026-10-06, planner's calls)

Made while planning UI PR 2 (`docs/plans/2026-10-06-ui-pr2-pane-windows.md`), inline on Opus 5.5
because Fable is out; Kevin approves or overturns each before the review wave.

- **The tab window heads the Inventory and Heroes tabs.** The eight tabs become one window at the
  pane's top, `▶` on the current tab, the hotkeys hidden. Amended by the review rulings below: the
  six PR 3 tabs keep today's visible tab row until PR 3 brings the window to them.
- **Hotkey letters are drawn gold inside their labels** (`Inventory`, `Orders`, `Account`; the
  first occurrence, ignoring case). A graft: the engine's plain Button accents its hotkey the
  same way. Why: the old Button row showed the keys; a window needs another way to.
- **One Image per window, laid out by a tile tree; `IMAGE_MAX_BYTES` stays 1 MiB.** Why: a cursor
  move then re-encodes and blits only the windows it changed, and the largest window
  (80 × 17 cells) is about 700 KB. Raising the cap would buy one 1.5 MB blit per keypress.
- **Two layouts and a floor.** From 96 columns the detail window sits beside the list (40
  columns); from 40 to 95 it sits under it (6 rows); below 40 columns, or too few rows, the pane
  says it needs more room. Why: a docked pane is often 50 to 80 columns.
- **Item and hero sprites stay in the list rows**, against the transcription's absence list
  ("icons beside list items"). Spec §10 and phase 4 put 16 px icons in these lists, and phase 4
  PR 2's art feeds them. Raster terminals draw none, since a window row is one cell tall and the
  old 8 × 2 icon needs two. The call most likely to be overturned: the alternative is no icons
  in the list and the cursor item's sprite in the detail window.
- **Gold sits in the list window's title** (`Inventory 12/20 · 1,240G`), not in a purse window.
  Why: the band's purse needs a strip slot, while the pane's title has the room.
- **Enter on a row opens a command window** (DQ's command window: a header, a divider, ▶
  items). Equip and Reforge open a pick window; Unequip, Recruit and party picks act at once, as
  today. **Vendor and Dismiss now ask Yes/No first.** Why: both can't be undone, and today one
  stray Enter does either.
- **Recruit is the roster list's last row** (`Recruit a hero  120G`), not a button. Why: it keeps
  every action on the cursor.
- **The hero detail is a party window of one** (1.19): header `Aldric L4`, divider, class, an H
  row with a bar for party heroes only, traits, equipment, status. No new view fields: bench
  heroes have no HP in the view.
- **The cursor follows the focus ring.** It moves through hidden one-space Buttons, one per row
  (spike PR 2 notes). Tab and Back Buttons on the ring are skipped by redirecting. Where the
  spike finds hidden Buttons can't take focus, and on VS Code and mobile, a visible `▲ ▼ ok back`
  row does the same.
- **Escape backs out of a sub-window and `q` always does.** Escape refuses the pane's close while
  a sub-window is open, if the spike finds the keyboard stays in the pane; else Escape closes
  the pane and `q` is the only way back.
- **A pane spike runs first** (Task 1). It answers three questions PR 1's spike left open: whether
  hidden Buttons join the ring, whether the arrows move it, and whether a refused Escape keeps
  the keyboard. It also checks that Images tile in nested Boxes. The cursor and the back-out
  depend on the answers.
- **Before the band's probe lands, the pane draws raster.** Why: raster always draws, and the
  probe settles within a second of the band showing.
- **The sell flow becomes a sell window** in the detail window's place: matching orders as ▶
  items, then `Set a price`, which focuses the price `Input` under the picture (typed values stay
  Inputs, 1.5). Mobile, with no Input, picks a preset price.
- **Worn items show the wearer's first name** in a dim column, not DQ's `E` mark, which the
  references in hand don't show.

Review rulings (2026-10-06, the plan's one review wave: `reviewer` on Opus, 21 findings, each
hand-verified; made inline on Opus, Fable out; Kevin can overturn either):

- **The six PR 3 tabs keep today's tab Button row, header and body until PR 3.** Their hidden tab
  Buttons would join the focus ring with no rows to redirect to, so Tab and Enter would switch tabs
  by accident; the header also carries their read-only line and refusals. The cost of the
  original call was a focus rule per tab; PR 3 gets it for free once those tabs have rows.
- **Lists and menus page; they don't scroll.** The ▶ row's page is a pure function of its index,
  so the focus hook needs no scroll state it cannot compute outside the render. DQ's lists page
  too. The roster reaches 48 and an equip pick can list most of it, so every sub-window pages.

### 1.21 Planning gaps for UI PR 3 (2026-10-06, planner's calls)

Made while planning UI PR 3 (`docs/plans/2026-10-06-ui-pr3-remaining-tabs.md`) inline on Opus 5.5.
Kevin asked for the whole pass on Opus, with no Fable. He approves or overturns each.

Shared:

- **Every tab is a list window with a detail window beside or under it.** PR 2's frame carries
  all six. Market lists listings, Orders your listings and orders, Account its settings, Odds
  the odds table and the expansions, Chat the messages, Leaderboards both boards. Why: one
  layout, one cursor rule, one paging rule. The tab window now heads all eight tabs (1.20's
  ruling said PR 3 brings it).
- **A list can hold lines that take no stop.** Headings (`My listings`, `Highest zone`) carry
  DQ's divider under them and no ▶. The `Returns waiting` line and the Odds table rows work the same way.
  Why: Orders, Odds and Leaderboards have sections, and the absence list rules out a second
  label colour, so the divider marks them.
- **Forms take the detail window's place, as the sell window does.** The new buy order is a
  form window. Its picks (base, rarity, affix) take the form's place while open, and `q` or a
  pick returns to it. The price is a field under the picture (1.5). Mobile lists presets.
- **Fields and links sit under the picture.** The sell price, the order price and the chat line
  are `Input`s. The GitHub device-flow URL is a real `Link`, because a URL baked into a picture
  can't be opened. One field or link at a time.
- **Short panes drop the tab window.** When the rows can't hold the tab window and the layout's
  floor, the tab window goes; the tab hotkeys still work, and every list title already names
  its tab. Why: PR 2's open item 1. An inline pane in a 105 × 50 terminal gets 14 rows and the
  windows need 16, so after this PR all eight tabs would show only "needs more room" inline,
  where the six text tabs work today. Without the tab window, 14 rows fit both layouts.
  Inline at 80 × 24 (7 rows) still doesn't fit.
- **The pane probes the renderer itself.** A docked pane collapses the band, and a collapsed
  band never probes, so the pane drew raster in cmux until `/promptfall renderer image` was set
  (PR 2 pass, note 2). The pane mounts the band's probe Image while the renderer is unknown.
- **Reset asks Yes/No.** It can't be undone, the same reason Vendor and Dismiss ask.

Per tab:

- **Market.** The list's first row is `Filters` (hotkey `f`). It opens a filter window:
  `Kind`, `Sort` toggle in place, `Base` (or `Class`) and `Rarity` open a pick window, and a pick
  returns to the filter window. `Previous page` and `Next page` are rows, before and after the
  ten listings, because the server pages by ten and mobile reaches only cursor rows. The title
  carries the search and the gold (`Market: items, rare+, cheapest · 1,240G`). Enter on a
  listing asks Yes/No (`Buy Silk Robe for 1,200G?`, `y` and `n` as today). Your own listings
  read `yours` and Enter does nothing on them. The listing sprites stay, as in Inventory (none
  on raster). `MarketState.confirm` goes: the Yes/No is the dialog's menu, like Vendor's.
- **Orders.** Rows: the returns line, `My listings` and its rows, `My buy orders` and its rows,
  then `New buy order`. Enter on a listing or an order asks Yes/No to cancel it, naming what
  happens to the fee or the escrow.
- **Account.** The rows are the actions: `Sound`, `Motion`, `Renderer` (hotkeys `s n x` as
  today), `Band` (collapse or show), `Band off`, `Link GitHub`, `Reset this machine's data`. The
  detail window holds today's read-only lines. Settings and Reset work in read-only mode, as
  today; Link doesn't. With no game view, the pane shows the tab window, the message
  `Promptfall has not started in this session.`, and on Account the server, the client and
  Reset.
- **Odds.** The table is one block of lines, a rarity per row with zone, boss and tavern
  columns. The two expansions follow as rows, dim when gold is short (as Recruit).
- **Chat.** Messages are rows, one line each, clipped, and the detail window shows the ▶
  message whole. The ▶ starts on the newest and follows new ones until moved; moving it back
  onto the newest follows again. Up pages back through the 200 the client holds (today shows
  14). Enter focuses the compose field. **The field is not focused when the tab opens**
  (today's compose box is): with the ring on a row the tab hotkeys work, and Enter is one key
  to the field. The call most likely to be overturned.
- **Leaderboards.** Both boards in one list, under their headings; the rows are stops that do
  nothing, so Up and Down page through 40 rows. The detail window shows who is online by zone.
  Your rows are gold, a graft (today's cyan has no place in DQ's palette).

Review rulings (2026-10-06, the plan's one review wave: `reviewer` on Opus, 16 findings, each
hand-verified; made inline on Opus; Kevin can overturn any):

- **Chat pages from the newest back.** Pages cut from the top would leave the newest page with as
  few as one message. Cut from the end, the newest page is always full.
- **Leaving a field puts the ring back on the ▶.** Otherwise Shift+Tab from the chat field wraps
  onto the oldest message.
- **Every list has a cursor stop.** An empty or closed tab's one line becomes a stop that does
  nothing (on an empty Chat, it focuses the field). With no cursor stop the ring sits on a tab
  Button and Enter would switch tabs (1.20's ruling).
- **Reset's Yes/No opens on No.** The ▶ can clamp onto Reset when `Link GitHub` vanishes above it.
- **Known cost of short panes:** a pane under 96 columns at exactly 14 rows reads "needs more
  room" while a field shows. Wide inline panes (96 columns up) fit.

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

## 3. For the planner

- Start from this record, `docs/design/ui-remake/README.md`, ADR 0005, and the comparison page
  (https://claude.ai/artifact/MnNPLXiqrkMG3BxW8CjCMh, direction B). The mockups are style
  studies; the references (1.12) win where they disagree.
- The combat grill's record settles the gauge data, the action events and the log pacing the
  band consumes. Plan UI PR 1 after it.
- Task 1 is the spikes (1.10). The transcription of the eight references, slot by slot
  (design-from-references), comes before any layout code.
- Spec amendments land with the PRs that make them true: §2 (band rows at rest and with a
  boss, once the strip's height is final), §10 (the band's strip, the band tabs as a command
  line, the pane as windows, the pane size).
- Every PR ships its windows on every surface (1.3): RGBA image, Svg, box-drawing text.
