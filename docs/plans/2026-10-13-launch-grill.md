# The launch grill, 2026-10-13

The record of the Fable grill that consolidated Kevin's manual pass (103 checks, artifact
`Rzx5vj1eXuCUAdyYSQcpgw`), the tickets he filed during it (#172 to #179) and the handoff's five
parked items. Each `/to-spec` below starts from its section here, after a `/clear`. Everything in
this file is decided unless marked **open fact**, which is a fact to look up at ticket time, not
a decision.

Build order: 1 Launch bugs, 2 Launch polish, 3 #179 waves (a ticket, no spec), 4 One stage,
5 Reactive revamp, 6 Band polish, 7 Rerolls, 8 Market rules, 9 the closing arc ticket, then #178
the pane revamp in its own grill session.

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

## 3. #179 Waves

Settled as filed. Straight to `/to-tickets`. Its arc paragraph moves to the closing ticket.

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

## 6. Band polish (#173)

- The stage stays on every tab; the strip keeps its 5 rows under it, so the band never changes
  height.
- **The World tab is three fixed rows:** presence, records (the hunt row and its "off" notices),
  chat. Neither chat nor the hunt hides the other.
- Loot rows draw like inventory rows: sprites at text height, a rarity slot glyph if that does not
  read.
- Logs page back with two hotkeys, `[` and `]` if the band can bind them else `k` and `j`
  (**open fact**), a `3/9` footer while scrolled back, snap to newest on a new line unless scrolled
  back. No line is ever cut: every line wraps in full, no ellipsis in the message window.
- The `c` hint replaces the bare `▾`; the collapsed line gets the band's colours.
- Tactics read `Next zone ▸` / `Stay here ↻` with a dim `f` and spelled-out alt text; the sandbox
  mark moves to the collapsed line and the enemy window's title.

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
