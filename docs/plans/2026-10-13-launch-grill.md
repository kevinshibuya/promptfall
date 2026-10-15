# The launch grill, 2026-10-13

The record of the Fable grill that consolidated Kevin's manual pass (103 checks, artifact
`Rzx5vj1eXuCUAdyYSQcpgw`), the tickets he filed during it (#172 to #179) and the handoff's five
parked items. Each `/to-spec` below starts from its section here, after a `/clear`. Everything in
this file is decided unless marked **open fact**, which is a fact to look up at ticket time, not
a decision.

Build order: 1 Launch bugs, 2 Launch polish, 3 #179 waves (a ticket, no spec), 4 One stage,
5 Reactive revamp, 6 Band polish, 7 Rerolls, 8 Market rules, 9 the closing arc ticket, then #178
the pane revamp in its own grill session.

## Status

The batch's progress, kept here so a later spec or ticket reads the state of the tree it builds
on. **Rule:** the session that merges a batch PR into `ai-staging` updates this table in the same
sitting (the PR, the merge commit, the date) and notes under the spec's section anything the build
changed in the decisions above. A `/to-spec` for the next section reads this table first.

| # | Spec | Issue | Tickets | Run | PR | State |
|---|---|---|---|---|---|---|
| 1 | Launch bugs | #182 | #183, #184, #185, #186 | `afk run 182`, started 2026-10-13 | #187, merged 2026-10-13 as `259ce09` | merged |
| 2 | Launch polish | #188 | #190, #191, #192, #193, #194, #195 | `afk run 188`, started 2026-10-13 | #200, merged 2026-10-14 as `a49ef45` | merged |
| 3 | #179 waves | #179 | #204, #205 | `afk run 179`, started 2026-10-14 | #206, merged 2026-10-14 as `f08a125` | merged |
| 4 | One stage | #209 | #210, #211, #212, #213, #214, #215, #216 | `afk run 209`, started 2026-10-14, stopped during #213 and resumed once | #218, merged 2026-10-14 as `6618f4e` | merged |
| 5 | Reactive revamp | #221 | #222, #223, #224, #225, #226, #227, #228 | `afk run 221`, started 2026-10-14 | #229, merged 2026-10-14 as `16f7a0e` | merged |
| 6 | Band polish | #234 | #235, #236, #237, #238, #239, #240, #241 | `afk run 234`, started 2026-10-14, stopped on the usage limit 2026-10-15 with #235 to #240 landed; `afk resume 234` builds #241 | | paused |
| 7 | Rerolls | | | | | not started |
| 8 | Market rules | | | | | not started |
| 9 | Closing arc ticket | | | | | not started |
| — | #178 pane revamp | #178 | | | | own grill session, after 9 |

## Cross-cutting rules

- **Arcs run once, at the end** (ADR 0017). `pnpm test` excludes `packages/sim/src/harness`;
  `pnpm test:arc` runs it. No ticket's gate runs the arcs. The closing ticket (9) runs them once,
  pastes the per-seed table, and stops; a failed floor is reported, and retuning is Kevin's
  follow-up decision. #179's "update the arc expectation in the PR" paragraph moves to the closing
  ticket. Spec 1's first ticket makes the script split, so every later gate is cheap.
- Every sim-changing ticket bumps `SIM_VERSION` with a migration step, fixtures, golden and
  vendored bundles, as #169 did. Tickets that land in one build share one bump.
- A rendered surface change verifies with the headless smoke on top of typecheck and lint.
- Decided and closed, do not reopen: #70 (passed in Ghostty, three cycles), #69 (five to ten
  seconds, one flush). The session summary's goal, removed heroes at a party swap, and the
  zone-30 heal report stay closed as the handoff said. The cinematic intro and spec #131's
  deferred set (a summon, a focus bonus) stay parked until #174 to #177 have been played; ADR
  0014's test rules them: a non-fighting companion and a shape-only focus pass, a paying one does
  not.

## Dispositions of the pass notes

| Check | Verdict | Lands in |
|---|---|---|
| guard (fail) | The band hides itself on `hasSurvey` (band.tsx:82), which covers permission prompts, so Guard is never visible. | 2 |
| hunt-row, hunt-off (fail) | The World tab's second row shows the chat ticker whenever a fresh message exists, else the records row (strip.ts:246). The hunt row was displaced. | 6 |
| recruit (fail) | The engine keeps the focus ring by position while the ▶ is kept by row id; a recruit inserts a row above the recruit row. | 2 |
| returns (fail) | The item was gone, not waiting. The ledger package is shared with the public server. | 1 |
| camp | #176, plus the fire at compaction start. | 5 |
| reforge | Kevin did not see the kind change; he wants it to. | 7 |
| buy-order | Auto-fill adopted (ADR 0015); market context while pricing goes to #178. | 8, #178 |
| delete | As designed: the ban bites the login; anonymous play is a throwaway. Document, no change. | none |
| desk-stage | The desktop's picture falls back wholesale to a 1× document past the 131,072 cap (svg.ts:798), losing the drawn frames. | 4 |
| renderer | Two densities by ADR 0006; Kevin wants one. | 4 |
| level-up | Simultaneous level-up numbers overlap (no stagger, timeline.ts:849). | 2 |
| victory-hold | A boss kill emits `zone_cleared`, not `traveled`, so the step-off never plays. | 2 |
| toast-folding | Achievements fold by the spec table; Kevin wants them single. | 2 |
| link (on cmux) | A resize or remount loses the dialog state; same family as #172. | 1 |
| browse, sale-toast | Fake-only: bots buy anything under vendor ×4 and list at ×3 to ×9. | 2 |
| buy, chat | Listing detail before a buy; timestamps on chat. Posted on #178. | #178 |
| tall-prompt, ground-chest, wb-others-kill | Passed. #70 and #69 closed; #128 kept, narrowed. | 1 |

## 1. Launch bugs

- **#172, with the link flow as a third symptom.** Returning from the agents view leaves the band
  secondary and `/promptfall` brings it back narrow; on cmux, a browser tab opening shrank the
  terminal and the GitHub device code was gone when it grew back. One diagnosis on Opus, one fix
  pass. The pane rebuilds from the dialog atom on a resize (dialog.tsx:192), so the link state was
  lost higher up; `useServer` bumps `linkGen` and `clearDialog` sets `link: null` (register.tsx).
- **Returns vanish.** A cancelled listing with a full inventory should wait in returns and arrive
  when a slot frees (market.ts:147 `giveBack`, books.ts:315); Kevin's item was gone and the Orders
  tab showed nothing waiting. Diagnosis ticket on the ledger; a contract test red before the fix.
- **#128, narrowed.** All three sandbox cases showed a chest in the pass, but one chestless code
  path remains at `hooks/stage/timeline.ts:834` (the Opus re-check comment). Small, sandbox-only.
- **The test split** (ADR 0017): `test:arc`, the harness excluded from `pnpm test`.

What the build changed (PR #187):

- **The agents view.** The take-back keyed on equal `startedAt` is gone, so a resumed or forked
  conversation in a second terminal no longer takes the lease. The spare session marks itself
  `CLAUDE_BG_SOURCE=spare`; the plugin treats spare-or-unset as the spare and `slash` as the
  conversation's own process. The spare never takes a free lease, the process left behind lets go
  within 2 s, and the conversation's process picks the lease up within 2 s, so ← then Enter at once
  reads "playing in another session" for about 2 s.
- **The link flow.** The lead above was false: the link state survived the resize. The dock clipped
  the code off screen (`ui/pane/account.ts`); the code now sits directly under the Account title.
- **Returns vanish.** The lead above was false: Kevin's item had sold before the cancel. The ledger
  side is pinned by contract rules 18 and 18b. The sim still rejects a `returned` event on a full
  inventory, and the sim test the spec asked for was not added; #187 merged without either.
  A refused trade whose listing or order closed reads "Already sold, filled or expired".
- **#128 is not sandbox-only.** A monster killed in the tick it spawned, before the band drew it,
  also leaves a ground chest in real play. A chest with no row to fall from lands on the lowest
  free slot, not under the enemy in front.

## 2. Launch polish

- **The band stays up during prompts and questions.** Drop the hide on `hasSurvey`
  (band.tsx:82, spec line 32 and 907, ADR 0003 line 33, features.md). The band collapses to its
  one line only when `maxRows` forces it. Guard's revamp (5) depends on this. **Open fact:** whether
  `hasSurvey` distinguishes a permission prompt from the question tool; it only matters if the
  hide were kept for questions, which it is not.
- **Recruit cursor.** After any build that inserts a row, the focus ring re-lands on the ▶'s key
  (mount.tsx:49 and :109 describe the by-position ring).
- **Level-ups.** Simultaneous level-up numbers stagger by party slot, about 250 ms apart; the
  rise lengthens from `NUMBER_MS` 700 to about 1.2 s for level-ups only.
- **Boss kill with Push on** plays: victory hold, step-off, backdrop change, step-on, with the
  arrival line and toast at the step-on. The `zone_cleared` stage play gains the travel motion.
- **Achievement toasts never fold.** The spec's fold table (§10) and features.md move.
- **Reforge and hone menus** (the UX part of 7, buildable now for reforge): the pick menu stays
  open after a roll (`keep` on the menu items, mount.tsx:514), shows each affix's current value and
  its range before the pick, and shows the result in place.
- **The fake's bots** (bulk, codex): buy only under vendor ×2, vendor when full, a slower default
  tick, so the market can be seen on the fake.

What the build changed (PR #200):

- **The band during prompts is an engine finding.** The plugin no longer hides on `hasSurvey`,
  but in the terminal Claude Code (2.1.299) stops calling the band's render hook while a permission
  dialog or a question is up, so the band is still gone until the answer (debug log, manual pass of
  #200). Guard's revamp (5) leans on the band staying up: its huddle and shield will not show during
  a prompt until the engine changes.
- **The recruit cursor is a timing retry**, not a total rule: three `$.ui.focus` sends at 0, 50 and
  150 ms. A slow redraw or an Enter within 50 ms can still land on the hero just recruited. #202
  tracks the total fix, which needs an engine signal or a per-drawing key.
- **Level-ups:** adjacent slots stand two columns apart, so staggered numbers overprint for about
  half a second as the later one rises into the earlier one's row. Readability left open.
- **The fake's bots** heartbeat twice a round: each act once a minute, and the bot half a round on
  polls the world too, so all of them stay inside the 45 s presence TTL and join the world boss.
- **Reforge ranges** draw with a hyphen (`3-7`): the pane font has no en dash.

## 3. #179 Waves

Settled as filed. Straight to `/to-tickets`. Its arc paragraph moves to the closing ticket.

What the build changed (PR #206):

- **The spec's note on old saves was not followed.** ADR 0013's migration finish clears every fight
  outside boss mode, so a v17 save loses its encounter at the bump and nothing needs rewriting; the
  spec said the encounter would be kept.
- **Wave 11 opens no wave.** A tool call during the zone boss fight joins the boss's encounter,
  counts toward nothing, and killing those adds heals nothing. A turn boss now always arrives
  between waves, in its own fight; a tool call during it opens the next wave around it.
- **The waiting footer and the falls row are the view's counts, never staged.** The footer had
  been erased by the band's bottom line on every surface until the review's fix pass made the line
  leave the strip's footer plates alone (a `band-waiting` golden pins it).
- **A newcomer refilled in a kill's step acts before the stage lets it on**, so its first action
  plays with no lunge, against spec §10's first-action line. #207 tracks the timeline fix.
- **The early-envelope wipe ceiling is red** (seeds 7 to 9 at 23 to 25 wipes against 20): waves
  hitting together, as predicted. Left to the closing arc ticket (9) by ADR 0017.
- **The in-play strip HP test** now allows the strip under every published state while a same-tick
  heal is still to land; its random seed 42 failed the same way before #204.

## 4. One stage (ADR 0018)

- One scene: the 1.5× art, its drawn and derived frames, marks and effects, one timeline, one set
  of tuning constants, on the Image, the Raster and the desktop.
- **The Raster** renders the same scene and scales it to its box the way the Image zooms out
  (`imageScaleFor`, layout.ts:101), so at 116 to 160 columns and the fixed 17 rows it is the
  two-thirds view. The band's height does not change (ADR 0010). The 1× stage art set retires,
  with its branches: `posesOf`'s 1× branch (model.ts:347), the "1.5 only" marks (model.ts:129,
  131, 548), the 1× flash rule (model.ts:428), the Image-only scenarios (scenarios.ts:416). The
  compact stage and the list windows keep their 1× idle sprites. The Raster keeps text-cell
  damage numbers. Palette: `RASTER_MAX_PAIRS` 1024 may need area-averaging to be budgeted.
- **The desktop cap, first.** A research ticket on Opus measures encodings of the worst frame
  (ADR 0007: 216,353 characters against the 131,072 cap): merged per-colour paths, rect runs, and
  sprite frames as embedded PNG images if the sandbox shows them (**open fact**). Acceptance: every
  golden scenario's worst frame fits with headroom. The 1× fallback (`svgWithFallback`,
  svg.ts:798) is deleted. If nothing fits, the picture drops the idle pair and the hit filter
  first, never a drawn frame. `SVG_INTERACTIVE` stays false (frames blank on reload).
- **Timing parity.** The constants are shared already; a three-surface golden set for an attack
  with a hit, a dissolve and spawn, and a chest, compared by eye once at the PR.
- **Docs:** ADR 0006 superseded for the stage, ADRs 0007 and 0004 annotated, spec §10's density
  and Raster paragraphs, features.md's Interface section.

What the build changed (PR #218):

- **The desktop encoding is strokes, not embedded PNGs.** #212 read the research before Kevin's
  yes on #210 landed, and built the best path encoding by its own rule. The yes stands: the
  checker drew on the desktop app, so embedded images are a known-good option. ADR 0018 records
  both. Strokes is pixel-identical to the old markup in every Chromium look and 40 to 46%
  smaller: `step-boss` 34,007, the fuller frame at rest on the first rung at 84,894, lunging over
  zone 10 on rung 3 (no backdrop) at 114,061. PNG is a follow-up ticket if the rung-3 frame
  bothers in play; `pnpm svg:measure` stays to re-measure it.
- **A boss on the Raster at a short band goes compact.** The Raster crops the sky and does not
  zoom out (ADR 0010), so where the engine gives the band fewer rows than the 17 a boss needs the
  boss fight is the compact stage. On a 46-row Ghostty that is every boss fight; the 17-row boss
  stage on the Raster needs the band about 24 rows deep.
- **The ladder's first rung holds idle A on the SMIL-off picture too** (the review's fix pass):
  the flat branch had kept drawing idle B past rung 0. No production path reaches it.
- **`pnpm sprites:check` compares bytes** through `scripts/sprites.ts --check` instead of
  reading `git status` after a rebuild (#214's fix pass).
- **The sprites module still names the drawn frames `hires`**: #219.
- **The parity sheets live in the goldens folder** (596 KB, three sheets); the folder grows
  288 KB net after the 1× backdrops leave.
- **The run:** seven tickets, four attempts, one fix pass (#214's gate), one stop and resume
  (a SIGTERM during #213, sent to restart #212 on PNG; by then #212 had landed, so the resume
  kept strokes). The GREEN pass is `docs/manual-pass/2026-10-14-one-stage.md`.

## 5. Reactive revamp

- **#177 Enrage:** settled as filed.
- **#174 Haste:** speed lines trailing the hero across its height, light, fading to the tail,
  redrawn each bob frame; the status glyph only if the lines fail on the Raster. No variants
  step. A fallen hero shows none; Motion still draws them static. On all three surfaces (4).
- **#175 Guard:** the living heroes hop in toward the front hero and back when Guard ends,
  reusing the step motion; the front living hero holds a big blue shield on the enemies' side,
  about the hero's height, replacing the small one; the fallen stay where they fell; an enemy hit
  lands on the shield with a flash; the huddle and the big shield on every surface, art at both
  densities. Needs 2's band-stays-up.
- **#176 Camp:** camp starts at `PreCompact` (a hook the plugin does not register yet; only
  `PostCompact` at register.tsx:1211), with the heal at the start. The field clears, the enemies
  leave with their HP kept and walk back in when camp breaks; a camped zone boss cannot be
  skipped. Camp breaks on the `g` key (`/promptfall go`), the next prompt, the next tool call, a
  world boss appearing, or the session ending, so offline catch-up fights as usual. No pause
  while a world boss is engaged: the fire and the heal, no pause. The party stands idle with the
  bob stopped, gathered around the fire with Guard's huddle hop; the enemy window's rows go blank
  with a dim `camping`; the message window shows `g: back to the fight`. Haste cannot start while
  camped; Guard shows the stance only. A `camp` field on the state, sim bump.

What the build changed (PR #229):

- **Camp starts at `session.compact`**, not a classic hook: the engine's precompute and a fork's
  own compaction are filtered out, and the post-compaction handler is gone.
- **Every `turn_start` breaks camp,** since the sim cannot tell a prompt from a long turn's
  refresh; the sandbox's boss, zone and wipe grants break it too. A Haste already on when camp
  starts waits through it with its countdown frozen.
- **The off is gated on the party's own state,** not a flag of the plugin's: the sim breaks camp
  on events the plugin never sees. **A primary stepping aside breaks camp** before its flush: the
  manual pass found `/exit`'s teardown draws nowhere for seconds before the session ends, so the
  end's own break met a secondary and the next session came back camping.
- **No lunge to the shield's face:** the stage's lunge is a fixed offset in place and never reaches
  a target; a hit on Guard reads as the shield's flash.
- **Speed lines hide** in the guard stance, the hit frame and at the fire. **No status glyph:** the
  lines read on the Raster, judged on `parity-haste` at the pass.
- **The review's fix pass:** `g` reads the clock at the keypress; two breaks at once send one off;
  a huddle turned mid-slide goes back from where the party stands; a hero camp's heal raises under
  Guard joins the huddle.
- **Carried out:** #230 (a boss fight on the Raster goes compact in a large terminal) goes to 6;
  #231 (the renderer falls back to what the terminal draws, and `auto` never sits blank) waits for
  its own slot.
- **The run:** seven tickets, one review wave with its fix pass, one manual-pass fix (step 7). The
  arcs have not run since the sim bump to 19 (row 9). The GREEN pass is
  `docs/manual-pass/2026-10-14-reactive-revamp.md`.

## 6. Band polish (#173, #230)

Grilled 2026-10-14, two rounds. The facts that reshaped the earlier bullets: the message window
has two text rows under the command line, not three; a band hotkey is one digit or one lowercase
letter (the engine's Button type), so `[` and `]` are out; the strip is a drawn scene whose rows
can hold a 16 px sprite, one row tall and two cells wide, blank on the Raster; the collapsed line
is engine text that takes a colour span by span; the purse has 10 usable cells.

- **The stage stays on every tab**; the strip keeps its 5 rows under it, so the band never changes
  height. In the compact band, Loot and World swap the window's three hero rows and enemy row for
  the tab's rows (four drops; presence, records, chat and a spare), stage kept. ADR 0003 and ADR
  0010 get dated notes; `bare` leaves the terminal layouts.
- **The World tab:** presence moves to the command line's spare cells, dim, after the tabs
  (`· 12 online · zone 3: kev, ana`), shortening to its count when narrow; row 1 is the records
  row with the hunt segment and its off notices; row 2 is chat. Neither hides the other.
- **Loot rows** draw like inventory rows: every line, drop or sale, leads with its item's 16 px
  sprite and the name in the rarity colour. On the Raster, where art cells are blank, the two
  cells carry a rarity-coloured filled mark (**open fact:** which filled glyph the baked font has;
  one is added if none).
- **Logs scroll** on Party and Loot: `j` pages back to older rows, `k` forward to newer, a page is
  the window's two rows. The footer sits at the right end of the command line while scrolled back,
  in the pane's shape counted in wrapped rows (`5-6/61 ▴`), beside the `c` hint. A new line snaps
  to newest unless scrolled back. The offset is per tab and resets on a tab switch, on collapse and
  when a fight ends with a travel. Both logs keep 40 lines (**open fact:** the sim's loot-log cap,
  raised if under 40). A bounded spike inside the scrolling ticket tries the engine's `ui.scroll`
  event for the wheel and the page keys; the ticket ships with letters alone if the event does not
  reach the band or the plugin cannot deny the engine's own offset.
- **No line is ever cut:** every line wraps in full; at newest the window shows the tail, and `j`
  reaches a long line's head. A notice and `g: back to the fight` wrap in full and take the bottom
  rows they need; the log keeps the rest. No ellipsis in the message window; the enemy title's and
  the purse's clips stay. Spec §10's camping line "newest log line clipped to one row" becomes
  "the newest log row".
- **The `c` hint:** a dim `c ▾` replaces the bare `▾` at the command line's right end. The tabs do
  not show their letters.
- **The collapsed line** gets colours: each hero's HP in the party window's health colour, gold in
  the purse's gold, the label and separators dim, the notice as it is. It gains `Sandbox` and
  `camping`.
- **Tactics read `f: Next zone` / `f: Stay here`**, the `f` dim, in a purse widened to 15 columns
  (the message window keeps its 28-cell minimum at 116 columns). Alt text: "After the boss: on to
  the next zone. f: stay and repeat it." and "After the boss: stay and repeat the zone from wave 1.
  f: move on." One vocabulary: Next zone and Stay here replace Push on and Farm here everywhere
  user-facing (glossary, features.md, the records row's `· farming` becomes `· staying`, the
  compact title's `· Farm` becomes `· Stay here` when it fits); `/promptfall farm` stays as the
  command verb. The purse's `Farm` title goes.
- **The sandbox mark** leaves the purse for the message window's title (`Sandbox`, every tab, no
  row spent), the collapsed line, and the compact band's party title as ` · Sandbox` when it fits.
  The enemy title stays as it is.
- **#230, the Raster zooms out:** the Raster crops the sky to the tallest actor as today, then
  zooms what is left the way the Image does (scene widened, ratio kept, damage numbers mapped
  through the factor), down to a floor of 8 rows, one tuning constant, compact below. Judged on
  sight at the pass against a golden; a smear raises the constant. The ticket's first step
  measures the real `maxRows` at a 46-row Ghostty (about 15 by the four recorded points, so 10
  stage rows, a 0.59 zoom and heroes about 9 px tall on the Raster). ADR 0010 gets a dated note
  narrowing its crop paragraph and legibility note to "crop first", ADR 0018 a line, spec §10's
  Raster paragraph and features.md follow. No new ADR.
- **Docs:** spec §2 and §10, features.md (Interface, Tactics, the World and Loot tabs, the Sandbox
  mark), the goldens. Glossary written 2026-10-14: band, collapsed line, compact band, tactics,
  records row, presence; Strip and Playfield lose "on Loot and World the strip alone".

## 7. Rerolls (ADR 0016)

- **Reforge** (gold, Rare or better): a new affix kind the item does not carry, from its slot's
  pool, value rolled in the new range; count unchanged; price unchanged (rarity × tier).
- **Hone** (one whetstone, no gold, Rare or better): the same kind, value rerolled in its range.
- **Retrain** (gold): a new trait the hero does not carry, from the shared pool; count unchanged;
  price = the hero rarity's price × a level multiplier (the spec fixes the table).
- **Drill** (one manual, no gold): the same trait, value rerolled. A Common hero (no traits)
  shows neither row. HP clamps to the new max after any of the four.
- **Whetstones and manuals:** stackable items (ADR 0016), stack cap 99, one stack per base, a
  stackable joins its stack with no slot; no vendor value, never vendored, never auto-vendored; a
  whetstone cannot be reforged or honed. Sources: the daily goal pays one whetstone **or** one
  manual, drawn from the day and the account like the goal; and both drop from kills at about
  1% per good from a boss (zone, turn and world boss alike) and ten times rarer from a wave
  enemy. A stackable with no stack and no slot waits as a pending reward until a slot frees.
  The goal's grant is sim-side (goal.ts); the drop joins the loot roll.
- **Where:** the Inventory command window gets `Hone · N whetstones` beside `Reforge`; the hero's
  command window gets `Retrain` and `Drill · N manuals`; rows greyed when unaffordable; pick menus
  as in 2. The Inventory row reads `Whetstone ×12` with its sprite, no rarity, no tier. The purse
  shows the counts only if they fit. Hotkeys at ticket time.
- **Save and schemas:** `Item` gains a count for stackables (or a stack type), the ledger's
  `Goods` and the protocol schemas follow, sim bump. Glossary: reforge, hone, whetstone, stack,
  trait, retrain, drill, manual (written 2026-10-13).

## 8. Market rules (ADR 0015)

- **Auto-fill at listing time:** a new listing fills the matching order with the highest max,
  oldest first, at the order's max; the listing is consumed; the fee as on a sale; a seller's own
  orders never match. The sell flow keeps showing matching orders. Spec §4.5's "no auto-match"
  line goes.
- **Quantities:** a listing of a stackable carries a quantity and a price each; a buy order for a
  stackable carries a quantity and a max each, fills partially, from any listing whose quantity
  fits; the escrow is quantity × max. The order form gains a quantity field (also noted on #178).
- Builds after 7, since it needs stacks.

## 9. The closing arc ticket

Runs `pnpm test:arc` once on the integration branch after 8, pastes the per-seed table in its
closing comment, lists every floor and probe result, and stops. Retuning is a follow-up Kevin
decides on the table.
