# UI PR 2: the Inventory and Heroes tabs as windows, implementation plan

**Goal:** Draw the pane's Inventory and Heroes tabs as Dragon Quest V windows (a tab window, a
list with a ▶ cursor, a detail window, command and Yes/No windows, a sell window, a message
window), keyboard driven, on every surface.
**Architecture:** Pure scene builders (`hooks/ui/pane/`) turn the view and the dialog state into a
`PaneScene` (the window kit's `Scene` plus a tile tree) and a list of ring stops, each stop a
hidden Button with a `PaneAction` as data. A mount draws the scene per surface (one Image per
window laid out by the tile tree, one Raster, or one Svg), mounts the stops, and runs their
actions; a `ui.focus` hook moves the ▶ cursor with the focus ring. The window kit gains a row
position, a sprite span and the tile tree.
**Spec:** `docs/plans/2026-10-05-ui-remake-grill.md` (section 1 is binding; 1.20 holds this plan's
own calls and the review rulings), `docs/design/ui-remake/transcription.md`,
`docs/adr/0005-interface-drawn-as-windows.md`, `docs/plans/2026-10-05-ui-remake-spikes.md`
("PR 2 notes"), and `docs/spec/promptfall.md` §10 (amended in Task 11).
**Execution model:** opus

Planning note: Fable is out of credits, so Kevin had this plan written on Opus 5.5 in the main
session (2026-10-06) and approved its design and grill 1.20. Its review wave ran `reviewer` on
Opus only: Fable is out and Codex is blocked until 2026-10-09 19:43. The leg's 21 findings were
hand-verified and folded into this version in one fix pass, on Opus; the two that changed an
approved call are recorded in grill 1.20 under "Review rulings".

## Global constraints

- Every surface ships the windows in this PR (grill 1.3): image terminals (kitty, Ghostty), raster
  terminals (box-drawing text), desktop, VS Code and mobile (Svg).
- Keyboard only (grill 1.4): Tab, the arrows (as the spike finds them), Enter, Escape, `q` and
  letter hotkeys. No pointer handling beyond what Buttons already do.
- Text in windows is the baked pixel font (grill 1.5). The one exception is a typed value: the
  sell price stays an `Input` under the picture (grill 1.5, 1.9).
- The pane draws at most `PANE_MAX_COLUMNS = 120` columns, centred on wider bodies, and at most
  `PANE_ROWS = 24` rows (grill 1.9).
- A window cell is `CELL_W × CELL_H = 8 × 16` picture pixels at `WINDOW_SCALE = 1`. Each window
  Image stays under the plugin's `IMAGE_MAX_BYTES` (1 MiB); the cap does not change (grill 1.20).
  The largest window, the wide list at 80 × 17 cells, is 696,320 bytes.
- An `Svg` source is at most 131,072 characters (engine). The pane's budget is
  `PANE_SVG_MAX_CHARS = 120,000`.
- Button hotkeys are one digit or one lowercase letter (engine). Tab hotkeys stay `i h m r a o c
  b`, and the tab Buttons keep their keys `tab-<tab>` (tests and `register.test.ts` press them).
  Account keeps `s n x`.
- The Market, Orders, Account, Odds, Chat and Leaderboards tabs do not change in this PR: they keep
  today's visible tab Button row, header and body (grill 1.20, review rulings). The `!view` branch
  (no game view yet) does not change either.
- Every module that calls `read` or `update` on an atom declares that atom itself
  (`hooks/state.ts`'s rule for `claude plugin validate`).
- The plugin reads no files at runtime. No sim change: `SIM_VERSION` stays 4 and nothing under
  `packages/` changes. No new `GameView` field.
- Gold in windows is `${formatCount(n)}G` (`ui/format.ts`), as the band writes it; `formatGold`
  (lowercase `g`) stays for Ink text.
- The absence list in the transcription holds, except the grafts grill 1.20 names (the list
  sprites, the gold hotkey letters, the dim columns).
- Colours are judged in cmux, never in Terminal.app.
- `bin/check-design-tells.sh` runs on every Write and Edit; override only with a
  `design-tells: acknowledged` comment defended in the commit message.
- Plugin tests import `claude-code/testing` and run only through
  `claude plugin test plugins/promptfall`.
- Full check line, run before each task's final commit from Task 2 on:
  `pnpm lint && pnpm typecheck && pnpm test && pnpm vendor:check && pnpm sprites:check && pnpm font:check && pnpm exec tsc -p plugins/promptfall && claude plugin validate plugins/promptfall && claude plugin test plugins/promptfall`.
  Task 1 runs `pnpm lint` only (it ships no plugin code).
- No `any`.

## Shared contracts

### Pane constants (`plugins/promptfall/hooks/windows/tuning.ts`, appended)

| Name | Value | Meaning |
|---|---|---|
| `PANE_ROWS` | 24 | the most rows the pane's picture takes (grill 1.9); also the `rows` `$.ui.open` asks |
| `PANE_MAX_COLUMNS` | 120 | the most columns (grill 1.9) |
| `PANE_MIN_COLUMNS` | 40 | below this the pane draws the too-small window |
| `PANE_WIDE_COLUMNS` | 96 | from here the detail window sits beside the list; below, under it |
| `DETAIL_COLUMNS` | 40 | the wide layout's right column |
| `NARROW_DETAIL_ROWS` | 6 | the narrow layout's detail window: border, 4 lines, border |
| `MESSAGE_ROWS` | 4 | the message window: border, 2 lines, border |
| `YESNO_COLUMNS` | 8 | border, pad, `▶Yes` or ` No`, pad, border |
| `ART_CELLS` | 2 | a sprite span: 16 × 16 picture pixels |
| `PANE_SVG_MAX_CHARS` | 120,000 | the pane Svg's budget |
| `PRICE_INPUT_ROWS` | 1 | the rows an `Input` takes on a terminal (Task 1) |
| `MOVE_HELP` | `'Tab or arrows: move.'` | the message window's move hint (Task 1: the arrows move the ring) |

### Window kit additions (`plugins/promptfall/hooks/windows/kit.ts`)

Load-bearing: all three encoders and every builder share these shapes.

```ts
// Span gains one member:
  | { art: SpriteArt } // ART_CELLS cells: the sprite fitted into 16 × 16 px; raster draws two blank cells

// Win gains one field:
  /** The window's top row in the scene; 0 when absent (every strip window). */
  y?: number

/** How the image mount stacks a scene's windows: Ink lays Images out in Boxes, not at (x, y). */
export type Tile =
  | { win: string } // a window, by key
  | { gap: { columns: number; rows: number } } // blank cells
  | { row: readonly Tile[] } // children left to right
  | { column: readonly Tile[] } // children top to bottom

export type PaneScene = Scene & { tiles: Tile }

/** Each window's (x, y) as the tile tree places it; a builder's tiles must agree with its windows. */
export function tilePositions(scene: PaneScene): Map<string, { x: number; y: number }>
```

`tilePositions` walks the tree from (0, 0): a `row` advances x by each child's width, a `column`
advances y by each child's height; a child's size is its window's `columns × rows`, a gap's own
size, a nested row's summed widths and tallest height, a nested column's widest width and summed
heights.

### Ring stops and pane actions (`plugins/promptfall/hooks/ui/pane/types.ts`, create)

Load-bearing: the builders return actions as data and the mount runs them.

```ts
import type { DialogTab, PaneMenu } from '../../../types'
import type { PlayerEvent } from '../../vendor/sim.js'
import type { PaneScene } from '../../windows/kit'

export type PaneAction =
  | { t: 'tab'; tab: DialogTab }
  | { t: 'open'; menu: PaneMenu } // opens a command, pick or Yes/No window
  | { t: 'back' } // closes the open sub-window, else the sell flow; nothing at the top level
  | { t: 'event'; event: PlayerEvent; keep?: true } // applied through `act`; closes the menu unless `keep`
  | { t: 'party'; heroId: string } // toggles a pick; the third pick sends set_party
  | { t: 'sell'; kind: 'item' | 'hero'; id: string } // openSell; closes the menu
  | { t: 'accept'; orderId: string; price: number } // sellTrade with fillOrder
  | { t: 'list'; price: number } // sellTrade with list
  | { t: 'price' } // focuses the price Input
  | { t: 'claim' } // play here (secondary mode)
  | { t: 'none' } // the cursor stops here; Enter does nothing

export type Stop = {
  /** The hidden Button's key: what ui.focus and ui.press name. Unique in the pane. */
  key: string
  /** One lowercase letter or digit, or none. */
  hotkey?: string
  action: PaneAction
  /** True for the stops the ▶ cursor lands on; false for tab, back and claim Buttons. */
  cursor: boolean
  /** A cursor stop's row in its window (list row, menu item, 0 Yes / 1 No). */
  index?: number
}

export type PaneBuild = {
  scene: PaneScene
  /** In ring order: the order the hidden Buttons are mounted. */
  stops: readonly Stop[]
  /** The cursor stop the ring belongs on now: the open window's ▶ row, else the list's. */
  focus: string | null
  /** True while the sell price Input shows under the picture. */
  priceInput: boolean
}
```

Stop keys: `row:<id>` for list rows (`row:recruit` for the recruit row), `menu:<index>` for
command, pick and sell window items, `yes` and `no`, `tab-<tab>` for the tab hotkeys (today's
keys), `back` (hotkey `q`), `claim` (hotkey `p`, secondary mode only). Mount-level Buttons that are
not stops: `j` and `k` (if Task 1 adds them) and the rung (c) row `▲ ▼ ok back`.

### Dialog state (`plugins/promptfall/types/index.d.ts`, modified)

```ts
/** A sub-window open over the Inventory or Heroes list (grill 1.20). `at` is its ▶ row. */
export type PaneMenu =
  | { kind: 'actions'; tab: 'inventory' | 'heroes'; id: string; at: number }
  | { kind: 'equip'; itemId: string; at: number }
  | { kind: 'reforge'; itemId: string; at: number }
  | { kind: 'confirm'; action: 'vendor' | 'dismiss'; id: string; at: number } // at 0 Yes, 1 No

/** The ▶ row of a list: the id it was on, and its index then (for when the id is gone). */
export type PaneCursor = { id: string; index: number }

export type SellState = {
  kind: TradeKindView
  id: string
  matching: OrderView[]
  price: string
  error: string | null
  /** The sell window's ▶ row. */
  at: number
}

export type DialogState = {
  menu: PaneMenu | null // replaces itemPick (Task 9 removes itemPick)
  partyPick: string[]
  paneNotice: string | null
  link: { code: string; url: string } | null
  /** The sell flow; the sell window shows exactly while this is set. */
  sell: SellState | null
  cursor: { inventory: PaneCursor | null; heroes: PaneCursor | null }
}
```

Every read of the dialog atom goes through `{ ...DIALOG_DEFAULT, ...dialog }`, so a value written
by older code (a hot reload in a live session) reads with the new fields at their defaults.

## Layout

All in cells. `W = min(PANE_MAX_COLUMNS, bodyColumns)`. On a terminal,
`H = min(PANE_ROWS, scroll.bodyRows − under)`, where `under` is computed before the build:
`PRICE_INPUT_ROWS` when `dialog.sell` is set, the surface has an Input, and `sellState` (Task 5)
says the price form shows; plus 1 when the terminal takes the rung (c) row. On the Svg surfaces
`H = PANE_ROWS`. The terminal centres the picture with `paddingLeft = floor((bodyColumns − W) /
2)`. The desktop passes the Svg element `width` and `height` props for `W` columns and `H` rows at
the desktop's points per column and row, inside a Box that centres it (check the engine's Svg
props and `stage/tuning.ts`'s desktop notes; a markup width alone makes the desktop fill the slot).

- **Tab window**: x 0, y 0, `W` wide, `2 + L` rows, where `L` is the lines the eight labels take
  when laid left to right in `W − 4` inner cells (one cursor cell, the label, two gap cells; a
  label that does not fit starts the next line). The current tab has `▶` in its cursor cell. Each
  label draws its hotkey letter (its first occurrence in the label, ignoring case, so `A` in
  `Account`) in `GAUGE_FULL_RGB`, the rest in `TEXT_RGB` (grill 1.20).
- **Message window**: x 0, y `H − MESSAGE_ROWS`, `W` wide, `MESSAGE_ROWS` rows, two lines.
- **Middle**: rows `2 + L` to `H − MESSAGE_ROWS − 1`; its height is `M`.
- **Wide** (`W ≥ PANE_WIDE_COLUMNS`): the list window at x 0, `W − DETAIL_COLUMNS` wide, `M` rows;
  the right column at x `W − DETAIL_COLUMNS`. With no sub-window the detail window takes the whole
  column. A command or pick window of `n` items is `min(3 + n, M − 3)` rows (border, header line
  with a rule, the items, border), at the column's foot, and the detail window takes the rest (at
  least 3 rows). A Yes/No window is `YESNO_COLUMNS × 4` at the column's foot, right-aligned, with a
  gap of `(DETAIL_COLUMNS − YESNO_COLUMNS) × 4` to its left; the detail window takes the rest. The
  sell window replaces the detail window and takes the whole column.
- **Narrow** (`PANE_MIN_COLUMNS ≤ W < PANE_WIDE_COLUMNS`): the list window full width; under it a
  band, full width, holding the detail window (`NARROW_DETAIL_ROWS` rows), or a command, pick or
  sell window (`max(NARROW_DETAIL_ROWS, min(3 + n, M − 4))` rows). The list takes the rest. A
  Yes/No window sits at the right end of the band (detail `W − YESNO_COLUMNS` wide; under the
  Yes/No a gap of the band's rows less 4).
- **Too small**: `W < PANE_MIN_COLUMNS`, or `M` under 9 (wide) or under `NARROW_DETAIL_ROWS + 4`
  (narrow): only the message window, reading `The pane needs more room.` and
  `Widen it or give it more rows.` Only the tab stops mount.

**Paging, not scrolling.** A list, command, pick or sell window that shows `k` rows of `total`
shows the page holding its ▶ row: rows `floor(index / k) · k` up to `k` more. While rows are
hidden its footer reads `13-24/40`, with `▼` after it while a later page exists. The page is a
pure function of the cursor index, so no scroll state exists. A list window's title is
`Inventory 12/20 · 1,240G` or `Roster 4/6 · 1,240G`.

## Window contents

Words below are the window text, verbatim.

**Inventory list row** (inner width `I`): cursor (1), gap (1), `{ art }` (2, only where `art` is
on), gap (1), the name in its `RARITY_RGB`, clipped to fit; then, right-aligned, the wearer (the
hero name's first word, 7 cells, `DIM_RGB`, blank when not worn; dropped when `I < 30`), a gap, and
the shop value (`120G`, 5 cells). Empty inventory: one row `Nothing yet.` and no row stops.

**Item detail** (wide; narrow keeps the first four lines): header line, the name in its rarity
colour, with a rule; `Rare weapon` (rarity capitalised, then the slot); one line per affix; a
blank line; `Worn by Aldric` or `Not worn`; `For Knight, Archer` (the classes' labels from
`CLASS_LABEL`); `Shop value 120G`; `Reforge 30G` when it has affixes; `Tradeable in 3h`
(`formatRemaining`) while its `tradeableAt` is ahead.

**Item command window**: header line `Silk Robe` (clipped) with a rule, then the items that apply,
in this order: `Equip` (not worn), `Unequip` (worn), `Sell` (not worn, rarity rare or better, a
game running), `Vendor 12G` (not worn), `Reforge 30G` (has affixes). Hotkeys `e u s v f`, the
letter drawn gold in its label. Equip opens the equip pick; when no hero of the item's classes
exists, `Equip` draws in `DIM_RGB` with action `none` and the message window's second line reads
`No hero of a class can wear it.` while the ▶ is on it. Reforge opens the reforge pick, Vendor the
Yes/No, Sell the sell flow, Unequip applies `unequip` at once.

**Equip pick**: header `Equip on`, one item per hero of a class that can wear it,
`Aldric  Knight L4`. Picking applies `equip`.

**Reforge pick**: header `Reforge 30G`, one item per affix. Picking applies `reforge` with that
index.

**Heroes list row**: cursor, gap, `{ art }` (where on), gap, the name in its rarity colour; then
right-aligned the class label (10 cells), a gap, `L12` (3 cells), a gap, and a 5-cell mark,
`DIM_RGB`: `party`, `next` (in the pending party), `pick` (in `partyPick`), or blank. The last row
is `Recruit a hero` with the price right-aligned (`120G`), `DIM_RGB` when gold is short; it is
absent in read-only mode.

**Hero detail** (a party window of one, grill 1.19): header `Aldric L4` with a rule;
`Knight · rare`; for a hero in the party, `H 42/60` and an 8-cell HP bar (`HP_BAR_RGB`, the
strip's warn and down colours under 25% and at 0), from `view.heroes` by id; `Traits: Brave,
Swift` wrapped to the width (`wrap` from `ui/strip.ts`); `Weapon    Iron Sword`,
`Armour    -`, `Accessory -` (names from `view.inventory` by id); then `In the party`,
`Joins at the next zone` or `Picked for the new party` when one applies. Narrow keeps the header,
the class line, the H line or traits, and the status line.

**Hero command window**: header the hero's name with a rule; `Party` (or `Unpick` while picked;
hotkey `p` for both), `Sell` (rare or better, a game running; `s`), `Dismiss` (not in the party or
the pending party; `d`). Party and Unpick toggle the pick; the third pick sends `set_party` and
clears the picks. Dismiss opens the Yes/No.

**Yes/No**: `▶Yes` / ` No`, hotkeys `y` and `n`; the message window asks
`Sell Iron Sword to the shop for 12G?` or `Dismiss Aldric? They leave for good.` Yes applies
`vendor` or `dismiss`; No goes back.

**Sell window** (replaces the detail window; shown exactly while `dialog.sell` is set; its ▶ row is
`sell.at`): header `Sell Silk Robe` in the rarity colour, with a rule. Then, in this order, the
first that applies, as today's panel decides it (`sellState`, Task 5): `It is no longer yours.`;
the gate line (`gateLine`); `Tradeable in 3h`; `In the party`; `Unequip first`, followed by items
`Unequip weapon` and so on (each applies `unequip` with `keep`, so the flow stays open, as today).
Otherwise, for an item, `Buy orders` and one item per matching order, `1,200G, you get 1,140G`
(`saleNet`), or `No buy orders match.`; then `Set a price` (action `price`). The price Input under
the picture is focused by `Set a price`; a valid typed price shows `Fee 60G · you get 1,140G` in the
message window, a typed invalid one `A price from 1 to 1,000,000 gold`, and the Input's submit lists
a valid price. Where the surface has no Input (mobile), the presets replace `Set a price` as items
(`2,400G` and so on, today's `ITEM_PRESETS` and `HERO_PRESETS`), and choosing one lists at that
price. A refusal (`sell.error`) reads in the message window's first line in `DOWN_RGB`. Every close
of the flow (back, a successful trade, a server switch) clears `sell`; opening it clears `menu`.

**Message window**, first line then second, the first rule that applies:
1. Too small: as in Layout.
2. Read-only: the existing reason (`Playing in another session: this view is read-only.`, the
   paused notice, or `Promptfall is not playing in this session.`), `WARN_RGB`; second line
   `p: play here.` in secondary mode, else blank.
3. `paneNotice`: `Refused: <notice>` in `DOWN_RGB`; second line the state's help below.
4. `sell.error`: as above.
5. Yes/No open: the question; blank.
6. Command window open: `What will you do with Silk Robe?` (or the hero's name); `q: back.`, or
   the Equip line above.
7. Equip pick: `Equip Silk Robe on whom?`; `q: back.` Reforge pick: `Reforge which affix?`;
   `It costs 30G. q: back.` Sell window: the fee or invalid-price line once a price is typed, else
   `Pick an order or set a price.`; `q: back.`
8. Heroes with picks: `New party: Aldric, Lyra (pick 1 more).`;
   `A new party takes the field at the next zone change.`
9. Inventory: `Enter: actions. ` followed by `MOVE_HELP`; blank. Empty inventory:
   `Items drop as the party fights.`; blank.
10. Heroes: `Enter: actions. ` followed by `MOVE_HELP`;
    `A new party takes the field at the next zone change.`

Every window's `alt` is its text in reading order; the list's alt names the cursor row
(`Inventory 12 of 20: ▶ Silk Robe, rare armour, 120G; …`), and the scene's alt joins the windows'.

## Task list

### Task 1: The pane spike

**Files:**
- `spikes/ui-remake/hooks/register.tsx` (modify): a `/spike-pane` command and its pane; nothing
  else in the spike changes. It stays self-contained: the window Images are plain rectangles of
  `0x303028` with a 2 px `0xf0f0e8` frame, made in the spike, no import from `plugins/`.
- `docs/plans/2026-10-05-ui-remake-spikes.md` (modify): a section `## PR 2 pane spike` with the
  questions, how to run, a findings table and the decisions.

**Interfaces:** Produces `MOVE_HELP`, `PRICE_INPUT_ROWS`, the back-out rung, the cursor rung per
surface, and the image mount's layout (tile tree confirmed or `blocked`).

**Work:** `/spike-pane` opens a pane (`closeOnEscape: true`, `rows: 24`). On a terminal it holds a
row Box with: a 3 × 2 grid of 40 × 6 window Images laid out with nested row and column Boxes and
one 8 × 4 gap Box; and, beside the grid, a zero-width `overflow="hidden"` Box holding eight plain
one-space Buttons `s0`…`s7` (no hotkeys; `s3` has `autoFocus`) and one Button with hotkey `q`.
Under it an `Input`, a `Text` log of the last four `ui.focus` elements (with their origin) and
`ui.press` keys, and a `ui.focus` hook that redirects the first move onto `s5` to `s6` with
`next({ ...e, element: 's6' })`. Pressing `q` re-renders the pane, then calls `$.ui.focus` onto
`s1`. A `ui.close` hook refuses the first `origin: person` close (no `next`) and logs it. On the
desktop the same, with one Svg of the grid instead of the Images and the zero-width Box absolutely
positioned at 0, 0 (as `hooks/ui/band.tsx` does). Questions:

1. **Hidden ring.** (a) Does Tab walk `s0`…`s7` (`ui.focus` names each), Shift+Tab walk back, and
   Enter press the focused hidden Button? (b) Does the ring start on `s3` (`autoFocus`) when the
   pane opens with focus? (c) After `q`, does `$.ui.focus` land on `s1` (a hidden Button, after a
   re-render)? (d) Does the redirect land on `s6`? Where does Shift+Tab go from `s0`: wrap to the
   last Button, or an engine stop (`ui.focus` with no element)?
2. **Arrows.** Do Up and Down move the ring among them (a `ui.focus` per press), or scroll?
3. **Escape refused.** After the refused close, does the pane keep the keyboard (does `q` fire
   without a click)?
4. **Tiles.** Do the six Images and the gap land where the tile tree says, with no extra rows or
   columns?
5. **Input height.** How many rows does the `Input` take?

Drive cmux and Terminal.app yourself (the driving notes in `HANDOFF-ui-pr1.archived.md`
§"Dead ends and facts"). Drive the desktop app too if Claude.app is installed and Kevin is not
using the Mac (check `pgrep -lf -i "league|riot"` and ask him before driving); else leave its row
as Kevin's.

Decisions the section sets:
- Cursor rung per surface: (a′) hidden stops in a zero-width Box when question 1 (a) to (d) hold
  there; else (c): a visible row under the picture of plain Buttons `▲` (hotkey `k`), `▼` (`j`),
  `ok`, `back`; `▲` and `▼` move the cursor (or `menu.at`, or `sell.at`) directly in the dialog
  state, `ok` runs the cursor stop's action, `back` runs `back`. VS Code and mobile take (c)
  without a test (spike sheet: untested surfaces keep rung c). The desktop takes (c) until its row
  says (a′).
- `MOVE_HELP`: question 2 yes on terminals: `'Tab or arrows: move.'`; no: `'Tab: move. j/k also
  move.'`, and mount-level `j`/`k` Buttons join the hidden Box on terminals.
- Back-out: question 3 yes: Escape backs out of a sub-window by refusing the close, and closes
  the pane at the top level; no: Escape always closes the pane, and `q` is the only back-out.
  `q` backs out in both cases.
- Wrap: question 1 (d)'s answer is written down for Task 8's redirect.
- `PRICE_INPUT_ROWS`: question 5's answer.
- Tiles: question 4 yes: the image mount uses the tile tree. No: stop, report
  `blocked: Images do not tile in nested Boxes` with the screenshot path.

**Acceptance check:** the section's findings table has a row each for cmux and Terminal.app with
every question answered, and a desktop row answered or marked Kevin's; the decisions name the
rung per surface, `MOVE_HELP`, the back-out, the wrap and `PRICE_INPUT_ROWS`. `pnpm lint` passes.

**Boundaries:** Nothing under `plugins/`. On ambiguity, stop and report `blocked: <ambiguity>`.

- [x] `/spike-pane`: the tile grid, the hidden stops, the Input, the logs, the hooks; the desktop variant
- [x] Drive cmux and Terminal.app (and the desktop if allowed); fill the table (desktop: Kevin's)
- [x] Decisions; `pnpm lint`; commit `spike(ui): the PR 2 pane: hidden ring, arrows, Escape, tiles`

### Task 2: The window kit: rows, sprites, tiles

**Files:**
- `plugins/promptfall/hooks/windows/kit.ts` (modify): `y` on `Win`, the `{ art }` span (and its
  cell count in `spanCells` and a `kind: 'art'` member of `Placed`), `Tile`, `PaneScene`,
  `tilePositions`.
- `plugins/promptfall/hooks/windows/tuning.ts` (modify): the pane constants (`MOVE_HELP` and
  `PRICE_INPUT_ROWS` from Task 1).
- `plugins/promptfall/hooks/windows/image.ts` (modify): draw `art` spans.
- `plugins/promptfall/hooks/windows/raster.ts` (modify): place windows at `y`; `art` draws two
  blank field cells.
- `plugins/promptfall/hooks/windows/svg.ts` (modify): place windows at `y`; draw `art` spans.
- `plugins/promptfall/hooks/stage/svg.ts` (modify): export `artPaths`, nothing else.
- `plugins/promptfall/hooks/windows/kit.test.ts` (create), `image.test.ts`, `raster.test.ts`,
  `svg.test.ts` (modify): the tests below.

**Interfaces:**
- Consumes: `SpriteArt` (`hooks/sprites/types.ts`), `artFrame` (`stage/compose.ts`), `artPaths`.
- Produces: the kit additions in Shared contracts, by those names.

**Work:** `y` defaults to 0, so every strip window and every strip golden stays byte-identical.
An `art` span fits the sprite into 16 × 16 px: an art of at most 16 × 16 draws at native size,
centred; a larger one is scaled down nearest-neighbour by the smallest whole divisor that fits,
centred. The image encoder draws the fitted pixels into the window frame (index 0 stays field).
The Svg encoder draws them with `artPaths` inside a `<g transform>`. The raster encoder draws two
blank cells. Internal structure is your choice.

**Acceptance check:** `claude plugin test plugins/promptfall` with new tests: `tilePositions` of a
nested row/column/gap tree; a window at `y = 3` lands at row 3 in `sceneCells` and at
`y = 48` px in `sceneSvg`; a 16 × 16 art span's pixels appear in `windowFrame` at the span's cell;
a 48 × 34 art is scaled by 3 to 16 × 11 and centred; raster draws spaces for it; every
`STRIP_GOLDENS` and stage golden still matches. Red before: the new tests fail to compile.

**Boundaries:** No change to what the strip draws. Nothing under `ui/`.

- [ ] Kit types, `tilePositions`, constants; kit tests
- [ ] Image, raster, Svg: `y` and `art`; their tests
- [ ] Goldens unchanged; run the check, commit

### Task 3: Dialog state and pane types

**Files:**
- `plugins/promptfall/types/index.d.ts` (modify): `PaneMenu`, `PaneCursor`; `SellState` gains `at`;
  `DialogState` gains `menu` and `cursor` (keep `itemPick` until Task 9).
- `plugins/promptfall/hooks/state.ts` (modify): `DIALOG_DEFAULT` gains `menu: null` and
  `cursor: { inventory: null, heroes: null }`.
- `plugins/promptfall/hooks/ui/sell.tsx` (modify): `openSell` sets `at: 0`.
- `plugins/promptfall/hooks/ui/dialog.tsx` (modify): the one read of the dialog atom becomes
  `{ ...DIALOG_DEFAULT, ...dialog }`; nothing else.
- `plugins/promptfall/hooks/ui/pane/types.ts` (create): `PaneAction`, `Stop`, `PaneBuild` as in
  Shared contracts.

**Interfaces:** Produces the types above, by those names.

**Work:** Types and defaults only. Check `hooks/storage.ts` and `hooks/register.tsx` for any other
place that builds or persists a `DialogState` or a `SellState` (`register.tsx` spreads
`d ?? DIALOG_DEFAULT`); each reads through the default as above.

**Acceptance check:** the full check line passes; `pnpm exec tsc -p plugins/promptfall` compiles
the new file. Red before: `ui/pane/types.ts` does not exist.

**Boundaries:** No behaviour change.

- [ ] Types and defaults; run the check, commit

### Task 4: The pane frame

**Files:**
- `plugins/promptfall/hooks/ui/pane/frame.ts` (create): the layout and the shared windows.
- `plugins/promptfall/hooks/ui/pane/input.ts` (create): `PaneInput` and the message window's
  first four rules, shared by Tasks 5 to 7.
- `plugins/promptfall/hooks/ui/pane/frame.test.ts` (create).

**Interfaces:**
- Consumes: the kit, the pane constants, `formatCount` and `clip` (`ui/format.ts`), `wrap`
  (`ui/strip.ts`), `RARITY_RGB` (`stage/tuning.ts`).
- Produces:
  - `paneLayout(columns: number, rows: number): PaneLayout`, where `PaneLayout` is
    `{ kind: 'wide' | 'narrow' | 'small'; columns: number; rows: number; tabRows: number;
    middle: { y: number; rows: number } }`; the tab line count comes from the eight labels.
  - `tabWindow(columns: number, tab: DialogTab): Win` and `TAB_LABELS` (label, hotkey per tab,
    today's order and letters).
  - `messageWindow(layout: PaneLayout, first: Span[], second: Span[]): Win`.
  - `page(index: number, shown: number): number` (the first row of the page holding `index`).
  - `listWindow(opts: { key: string; x: number; y: number; columns: number; rows: number;
    title: Span[]; lines: Line[]; cursor: number }): Win` (the page, the footer and the `▼` rule
    in Layout).
  - `menuWindow(opts: { key: string; x: number; y: number; columns: number; rows: number;
    header: Span[]; items: { label: string; hotkey?: string; rgb?: number }[]; at: number }): Win`
    (paged like a list when the items outnumber `rows − 3`).
  - `yesNoWindow(x: number, y: number, at: number): Win`.
  - `assemble(layout: PaneLayout, parts: { tab: Win; list?: Win; right?: Win[]; yesNo?: Win;
    message: Win }): PaneScene`: the windows and the tile tree for the layout, wide or narrow, as
    Layout describes.
  - In `input.ts`:

```ts
export type PaneInput = {
  tab: 'inventory' | 'heroes'
  view: GameView
  dialog: DialogState
  mode: Mode
  readOnly: boolean
  notice: string | null
  world: WorldState | null
  /** A game handle exists: Sell needs one. */
  running: boolean
  columns: number
  rows: number
  /** Pixel encoders draw sprites; false on raster. */
  art: boolean
  /** The surface has an Input (the sell price). */
  hasInput: boolean
  remainingMs: (deadline: number) => number
}
/** The message window's two lines: rules 1 to 4 here; `state` carries the caller's rule 5 to 10 lines. */
export function messageLines(input: PaneInput, state: [string, string]): [Span[], Span[]]
```

**Work:** Pure functions, no `claude-code` imports. The hotkey letter in a label or item is its
first occurrence ignoring case, drawn gold; a label without its letter draws plain. Internal
structure is your choice.

**Acceptance check:** new tests: at 120 × 24 the tab window is 3 rows, the middle is 17 rows and
the layout is wide; at 60 × 24 narrow; at 40 columns the tab labels take 3 lines; at 39 columns, or
a middle under the floors, `small`; `assemble` tiles agree with every window's `x`/`y` through
`tilePositions` for wide and narrow, with and without a command window and a Yes/No; a command
window of 12 items in a 17-row middle is 14 rows and leaves the detail window 3; `page` for index
0, 14, 15 and 39 with 15 shown; the list footer reads `16-30/40▼` on the second page and has no
`▼` on the last; a 20-item menu pages by `at`; the gold letter spans of `Leaderboards` (b),
`Orders` (r) and `Account` (A); `messageLines` for too small, read-only secondary
(`p: play here.`) and a refusal. Red before: the module does not exist.

**Boundaries:** No mounting, no surface code.

- [ ] Layout and `page`; tests
- [ ] Tab, message, list, menu, Yes/No windows; `assemble`; `PaneInput`, `messageLines`; tests
- [ ] Run the check, commit

### Task 5: The sell window

**Files:**
- `plugins/promptfall/hooks/ui/pane/sell.ts` (create): `sellWindow(input: PaneInput, at: Rect):
  SellBuild`, where `Rect` is `{ x: number; y: number; columns: number; rows: number }` and
  `SellBuild` is `{ win: Win; stops: Stop[]; state: [string, string]; priceInput: boolean }`.
- `plugins/promptfall/hooks/ui/sell.tsx` (modify): export the pure decision the panel makes (gone,
  gate, cooldown, in party, unequip first, or the orders and price) as
  `sellState(view, world, sell, remainingMs)`, used by both `sellBody` and `sellWindow`; export
  `ITEM_PRESETS` and `HERO_PRESETS`.
- `plugins/promptfall/hooks/ui/pane/sell.test.ts` (create).

**Interfaces:**
- Consumes: Task 4, `gateLine` (`ui/trade.ts`), `saleNet`, `listingFee`, `validPrice`
  (`vendor/ledger.js`), `formatRemaining` (`ui/time.ts`).
- Produces: `sellWindow`, `sellState`, `Rect`, `SellBuild`.

**Work:** Per Window contents, "Sell window", and message rule 7. Stops `menu:<i>` per item, with
`cursor: true` and `index`: an `Unequip <slot>` item carries the `unequip` event with `keep`; an
order carries `accept`; a preset carries `list`; `Set a price` carries `price`. `priceInput` is
true when the price form shows and the surface has an Input.

**Acceptance check:** new tests: each panel state's window text verbatim; an item with two
matching orders lists them with nets, then `Set a price`; a hero has no orders section; with
`hasInput: false` the presets replace `Set a price`; a typed valid price gives the fee line and an
invalid one the range line; `sellBody`'s existing tests still pass. Red before: the module does
not exist.

**Boundaries:** `sellBody`'s behaviour does not change in this task. No mounting.

- [ ] `sellState` out of `sellBody`; existing tests green
- [ ] `sellWindow`; tests
- [ ] Run the check, commit

### Task 6: The Inventory windows

**Files:**
- `plugins/promptfall/hooks/ui/pane/inventory.ts` (create): `inventoryPane(input: PaneInput):
  PaneBuild`.
- `plugins/promptfall/hooks/ui/pane/inventory.test.ts` (create).

**Interfaces:**
- Consumes: Tasks 4 and 5, `spriteFor` (`hooks/sprites/index.ts`), `CLASS_LABEL`
  (`ui/format.ts`), `formatRemaining` (`ui/time.ts`).
- Produces: `inventoryPane`; the cursor rule `cursorRow(cursor: PaneCursor | null, ids: string[]):
  number` in `frame.ts` (the id's row if present, else the stored index clamped to the list), which
  Task 7 reuses.

**Work:** The list, detail, command, equip pick, reforge pick and Yes/No windows and their stops,
per Window contents and Layout. Stops, in ring order: the tab stops (`tab-<tab>`, hotkeys,
`cursor: false`); then, with no sub-window, `row:<itemId>` per item (`cursor: true`, `index`,
action `open` an `actions` menu, or `none` in read-only mode); with a sub-window open, only its
items (`menu:<i>`, or `yes` and `no`) as cursor stops; then `back` (always) and `claim` (secondary
mode), `cursor: false`. `focus` is the open window's ▶ stop, else the list's cursor row stop (the
`cursorRow` rule), else null. With `dialog.sell` set, the right column (or the narrow band) is
`sellWindow`'s and its stops replace the row stops.

**Acceptance check:** new tests on a fixture view (three items: a worn common weapon, a rare
armour with two affixes, an epic accessory): the list rows' text and colours; the cursor row's
detail lines verbatim; the command window's items for each item, in order, with their hotkeys;
`Unequip` is an `event` action carrying `unequip`; `Vendor 12G` opens a `confirm` menu whose `yes`
stop carries the `vendor` event; the equip pick lists only heroes of the item's classes, and with
none `Equip` is a dim `none` item with its message line; read-only rows carry `none`; a cursor on
a vendored id falls to the same index; the sell window replaces the detail window; wide and narrow
scenes pass `tilePositions`; 40 items at 120 × 24 show 15 rows and the footer. Red before: the
module does not exist.

**Boundaries:** No mounting. No change to `ui/dialog.tsx`.

- [ ] List, detail, stops, `cursorRow`; tests
- [ ] Command window, picks, Yes/No, the sell column; tests
- [ ] Run the check, commit

### Task 7: The Heroes windows

**Files:**
- `plugins/promptfall/hooks/ui/pane/heroes.ts` (create): `heroesPane(input: PaneInput):
  PaneBuild`.
- `plugins/promptfall/hooks/ui/pane/heroes.test.ts` (create).

**Interfaces:** Consumes Tasks 4 to 6 (`cursorRow`). Produces `heroesPane`.

**Work:** The roster list (with the recruit row), the hero detail window, the hero command window
and the dismiss Yes/No, per Window contents. Stops as in Task 6: `row:<heroId>`, `row:recruit`
(action `event` with `recruit`), menus, the sell column. `Party` and `Unpick` are `party` actions.

**Acceptance check:** new tests on a fixture roster of five (three in the party, one picked, one
on the bench): the row marks `party`, `pick`, blank; a party hero's detail has the H line and bar,
a bench hero's has none; equipment names resolve from the inventory, `-` for empty slots;
`Dismiss` is absent for party heroes; the recruit row's price is dim when gold is short and the
row is absent in read-only mode; the picks' message line; tiles agree. Red before: the module does
not exist.

**Boundaries:** As Task 6.

- [ ] List, recruit row, detail; tests
- [ ] Command window, Yes/No; tests
- [ ] Run the check, commit

### Task 8: The mount

**Files:**
- `plugins/promptfall/hooks/ui/pane/mount.tsx` (create): `paneElement(...)`, which draws a
  `PaneBuild` per surface and mounts its stops; `runAction(...)`; `paneFocus(...)`, the `ui.focus`
  hook's body; `paneClose(...)`, the `ui.close` hook's body. It declares every atom it reads or
  updates.
- `plugins/promptfall/hooks/ui/pane/mount.test.ts` (create): the mount against hand-built
  `PaneBuild`s, through a test-only pane registered in the test file.

**Interfaces:**
- Consumes: Tasks 2 to 7; `encodeImage` (`stage/image.ts`), `windowFrame`, `windowKey`,
  `sceneCells`, `sceneSvg`; `fnv1a64` (`stage/hash.ts`); `openSell`, `sellTrade`.
- Produces: `paneElement`, `runAction`, `paneFocus`, `paneClose`, used by `dialog.tsx` in Task 9.

**Work:**
- Surface: a terminal with renderer `image` draws one Image per window inside Boxes that follow
  the tile tree (a gap is a Box of its size); renderer `raster` or `unknown` draws one Raster of
  the scene (grill 1.20); the desktop, VS Code and mobile draw one Svg of the scene (no SMIL), with
  `isInteractive` as the band sets it, sized and centred as Layout says. On a terminal the picture
  sits in a row Box with the centring padding.
- Image sources are cached by window key and `fnv1a64` of the window's JSON, 64 entries, so a
  cursor move re-encodes only the windows that changed.
- Stops: on rung (a′) surfaces, one plain one-space Button per stop in a zero-width
  `overflow="hidden"` Box inside the picture's row Box, so it takes no row (absolutely positioned
  at 0, 0 on the desktop, as the band does), in `PaneBuild.stops` order, the `focus` stop with
  `autoFocus`. On rung (c) surfaces the stops stay hidden for their hotkeys and the `▲ ▼ ok back`
  row draws under the picture.
- The last build: each render stores its `PaneBuild` at module level, keyed by the pane's
  `requestId`. The focus hook reads the ring order and each stop's `cursor` and `index` from it.
- The focus hook (matcher `requestId: 'promptfall'`), on the Inventory and Heroes tabs only:
  - no `element` (an engine stop): pass `next(e)`;
  - a cursor stop: write the cursor (`row:<id>` sets `cursor[tab] = { id, index }`; `menu:<i>`,
    `yes`, `no` set `menu.at`, or `sell.at` in the sell window), then `next(e)`;
  - a non-cursor stop (a tab, `back`, `claim`): redirect to the next cursor stop in the direction
    of travel, by `next({ ...e, element })`. The direction is forward when
    `(target − last) mod n ≤ n / 2`, where `n` is the stop count, `target` the element's index and
    `last` the index of the cursor stop the ring was on; with Task 1's wrap answer for the ends;
  - no cursor stops in the build (empty inventory, too small): keep the ring where it is (return
    `{}` without `next`).
- Re-focus: an action that changes which stops exist (`open`, `back`, `event`, `sell`, `tab`, and
  any close of the sell flow) sets a module-level flag; the next render, after it builds, calls
  `$.ui.focus` on the new build's `focus` once (deferred with `$.clock.after(0, …)`) and clears the
  flag. Nothing focuses a remembered key.
- Actions: `tab` updates the tab atom as `openTab` does; `open` sets `menu`; `back` clears `menu`,
  else `sell`; `event` runs `act`, then clears `menu` unless `keep`; `party` updates `partyPick`
  and sends `set_party` on the third; `sell` clears `menu` and runs `openSell`; `accept` and `list`
  run `sellTrade` as today (its close clears `sell`); `price` focuses the Input (key `price`);
  `claim` runs `game()?.claim()`; `none` does nothing.
- Escape: Task 1 found that a refused close hands the keyboard to the prompt, so Escape always
  closes the pane: `paneClose` passes every close, and `q` is the only back-out.
- The price Input: under the picture while `priceInput` holds, key `price`, `onInput` sets
  `sell.price`, `onSubmit` lists a valid price as today.

**Acceptance check:** `mount.test.ts`: a hand-built two-row build draws a Raster on terminal
(raster), one Svg on desktop with the scene's alt and the sized `width`, and one Image per window
with distinct keys with renderer `image`; a press on a stop runs its action (a stub `act` sees the
event); a `ui.focus` onto a row stop writes `cursor` with its index; onto `tab-market` from the last
row it redirects to the first row, and Shift+Tab from the first row onto `back` redirects to the
last row; with no cursor stops the hook keeps the ring; after `open` the next render focuses
`menu:0`; a close by the person passes while a menu is open. Red before:
the module does not exist.

**Boundaries:** No change to `ui/dialog.tsx` yet. No band change.

- [ ] Surfaces, tiles, cache, centring, sizing; tests
- [ ] Stops, rung (c) row, the last build, the focus hook; tests
- [ ] Actions, re-focus, Escape, the price Input; tests
- [ ] Run the check, commit

### Task 9: The dialog wiring

**Files:**
- `plugins/promptfall/hooks/ui/dialog.tsx` (modify): with a view, the Inventory and Heroes tabs
  draw `paneElement` of `inventoryPane` or `heroesPane`; registers the `ui.focus` and `ui.close`
  hooks through `paneFocus` and `paneClose`; the `itemPick` code and the old Inventory and Heroes
  bodies go. The six other tabs and the `!view` branch keep today's tab Button row, header and
  body unchanged.
- `plugins/promptfall/hooks/register.tsx` (modify): the server switch's `sell: null` also clears
  `menu`; nothing else.
- `plugins/promptfall/hooks/ui/sell.tsx` (modify): `sellBody` goes (the sell window replaces it).
- `plugins/promptfall/hooks/command.ts` (modify): `rows: PANE_ROWS`.
- `plugins/promptfall/types/index.d.ts`, `plugins/promptfall/hooks/state.ts` (modify): drop
  `itemPick`.
- `plugins/promptfall/hooks/dialog.test.ts` (modify): replace the Inventory, Heroes, list-sprite
  and row-fit tests for those two tabs (the ones pressing `vendor-*`, `recruit`, `party-*`,
  `unequip-*`, `sell-*`, the sprite-row tests at lines 795-880 for Inventory and Heroes, the
  40-column row tests at 960-1006 and the sprite placement test at 1079) with the tests below;
  the Market, Orders, Chat, Leaderboards and Account tests stay and still press `tab-<tab>`.
- `plugins/promptfall/hooks/register.test.ts` (modify): the outage test at line 625 finds
  `Promptfall: server unreachable` in the message window (decoded Raster cells), not in a `Text`.

**Interfaces:** Consumes Tasks 4 to 8.

**Work:** Wire as the Files list says. A test helper decodes a Raster's cells to text (codepoint
per cell, rows joined), for assertions on terminal scenes.

**Acceptance check:** the full check line, with the replaced tests, on terminal (raster) and
desktop: the pane draws the windows and no `Text` of the old rows; `row:iseed`, then the Vendor
item, then `yes` vendors the item (gold 2, inventory empty); `back` after opening a menu clears
it; three `party` presses set the party; `row:recruit` without gold puts
`Refused: not_enough_gold` in the message window (decoded cells on terminal, the Svg's alt on
desktop); unequip from the sell window keeps the sell window; a server switch closes the sell
window and the menu; Market still draws today's tab row and body; the outage test passes. Red
before: the replaced tests fail on the old Button keys.

**Boundaries:** The Market, Orders, Account, Odds, Chat and Leaderboards bodies and their header
do not change. No band change.

- [ ] Dialog wiring, hooks, `rows: PANE_ROWS`, drop `itemPick` and `sellBody`, the server switch
- [ ] Replace the dialog tests, the outage test; run the check, commit

### Task 10: Scenarios, goldens and the Svg budget

**Files:**
- `plugins/promptfall/hooks/stage/scenarios.ts` (modify): `PANE_SCENARIOS` and their inputs:
  `pane-inventory` (120 × 24, wide), `pane-inventory-actions` (command window open),
  `pane-inventory-vendor` (Yes/No), `pane-inventory-narrow` (60 × 24), `pane-heroes`,
  `pane-heroes-picks`, `pane-sell` (two orders and the price), `pane-small` (36 × 24);
  `paneGoldenOf`, `panePicture`, `paneSvgOf` shaped like the strip's.
- `scripts/stage-goldens.ts` (modify): writes `PANE_GOLDENS` and `stage/goldens/pane-*.png` and
  `pane-*.svg`.
- `plugins/promptfall/hooks/stage/goldens/index.ts` and the new `pane-*` files (generated).
- `plugins/promptfall/hooks/stage/golden.test.ts` (modify): the pane goldens, and the budget test.

**Interfaces:** Consumes Tasks 4 to 7. Produces the goldens.

**Work:** The budget test builds the fullest pane it can (wide, 120 × 24, 15 rows of 30-character
names with sprites, a full detail window, a command window open) and asserts `sceneSvg` under
`PANE_SVG_MAX_CHARS`. If it does not fit, stop and report `blocked: the pane Svg is <n>
characters` rather than changing the encoder.

**Acceptance check:** `pnpm stage:goldens` writes the files; `claude plugin test` passes the pane
goldens and the budget; the PNGs open and show each scenario (look at each one). Red before: the
scenarios do not exist.

**Boundaries:** No strip golden changes.

- [ ] Scenarios and golden helpers
- [ ] Generate, look at every PNG; budget test
- [ ] Run the check, commit `test(pane): scenarios, goldens and PNGs, the Svg budget`

### Task 11: Docs, the driven pass, the pull request

**Files:**
- `docs/spec/promptfall.md` (modify): §10's Dialog paragraph (Inventory and Heroes as windows: 24
  rows, at most 120 columns centred, the keys, Escape and `q`, the Yes/No on vendor and dismiss),
  the selling sentence (the sell window), the item sprites paragraph (Image and Svg only, in the
  window lists; none on half-block terminals).
- `docs/adr/0005-interface-drawn-as-windows.md` (modify, only if Tasks 1 to 10 contradicted it): a
  dated note.
- `docs/design/ui-remake/transcription.md` (modify): "Grafts, by name" gains the gold hotkey
  letters, the list sprites and the dim columns (grill 1.20).
- `CONTEXT.md` (modify): Tab window, Command window, Ring stop, Sell window.
- `plugins/promptfall/README.md` (modify): the Inventory and Heroes keys, Escape (closes the pane)
  and `q` (backs out of a sub-window), the Yes/No on vendor and dismiss.
- `docs/manual-pass/2026-10-06-ui-pr2.md` (create): the driven pass.
- `docs/plans/2026-10-06-ui-pr2-pane-windows.md` (modify): tick the boxes.

**Work:** Load `unslop` before writing. Back up Kevin's save first (as the UI PR 1 pass did) and
restore it after. Drive cmux (image, colour) and Terminal.app (raster) through: `/promptfall`
opens on Inventory at 24 rows, centred on a wide terminal; move the cursor down a long list and
see the pages, the footer and `▼`; Enter on an item, Vendor, Yes; Equip on a hero; Reforge; `q` backs
out and Escape closes the pane; Heroes: pick three, the message line, the party changes at the next zone;
Recruit without gold shows the refusal; Dismiss asks; Sell on a rare item with the price Input,
an invalid price, then a valid one; a narrow docked pane (fullscreen, 110+ columns); a too-small
pane; Market keeps today's tab row; a secondary session reads read-only and `p` plays here. The
desktop, standalone Ghostty and VS Code rows are Kevin's. Then open the PR into `ai-staging` with
the manual test rundown and which parts were verified here.

**Acceptance check:** the full check line passes; the manual-pass doc has every step on cmux and
Terminal.app with its result; the PR is open.

**Boundaries:** No code change here except a fix the pass finds, committed separately with its
own test.

- [ ] Spec, ADR note if needed, transcription grafts, glossary, plugin README
- [ ] Driven pass
- [ ] Ticks, PR

## Out of scope

The Market, Orders, Account, Odds, Chat and Leaderboards tabs (UI PR 3, which also brings the tab
window to them). Clicks inside pictures (grill 1.4). The inventory and roster expansions (they
stay on the Odds tab). New hero stats in the view. SMIL in the pane. Any band change. Real sprite
art (phase 4 PR 2).
