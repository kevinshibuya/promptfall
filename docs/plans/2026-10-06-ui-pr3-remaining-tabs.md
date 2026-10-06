# UI PR 3: Market, Orders, Account, Odds, Chat and Leaderboards as windows, implementation plan

**Goal:** Draw the pane's last six tabs as Dragon Quest V windows on PR 2's frame (tab window,
list with a ▶, detail window, command, pick, form and Yes/No windows, message window), keyboard
driven, on every surface, and keep the pane usable inline by dropping the tab window when rows are
short.
**Architecture:** PR 2's frame grows three things: list lines that take no stop (headings, notes),
a panel slot for any window that takes the detail window's place (the sell window, the order
form), and a field or link under the picture. Each tab gets a pure builder in `hooks/ui/pane/`
that returns a `PaneBuild`, as `inventoryPane` does. The mount runs the new actions (market
queries, buys, cancels, the order form, settings, link, reset) and probes the renderer when the
band hasn't. The dialog draws every tab, and the no-view branch, through the pane.
**Spec:** `docs/plans/2026-10-05-ui-remake-grill.md` (section 1 is binding; 1.21 holds this plan's
own calls), `docs/plans/2026-10-06-ui-pr2-pane-windows.md` (the frame this plan extends),
`docs/design/ui-remake/transcription.md`, `docs/adr/0005-interface-drawn-as-windows.md`,
`docs/plans/2026-10-05-ui-remake-spikes.md` ("PR 2 pane spike"), and `docs/spec/promptfall.md`
§10 (amended in Task 11).
**Execution model:** opus

Planning note: Kevin had this plan written on Opus 5.5 in the main session (2026-10-06) and asked
for no Fable at any step. Codex is blocked until 2026-10-09 19:43 (0 reset credits), so the review
wave is `reviewer` on Opus alone. Its 16 findings and three suggestions were hand-verified and
folded into this version in one fix pass, on Opus (`docs/reviews/2026-10-06-ui-pr3-plan-fix-pass.md`).

## Global constraints

- Every surface ships the windows in this PR (grill 1.3): image terminals (kitty, Ghostty), raster
  terminals (box-drawing text), desktop, VS Code and mobile (Svg).
- Keyboard only (grill 1.4): Tab, the arrows, Enter, Escape, `q` and letter hotkeys. Escape closes
  the pane; `q` backs out (PR 2 spike). No pointer handling beyond what Buttons already do.
- Text in windows is the baked pixel font (grill 1.5). Under the picture, only the typed fields
  (sell price, order price, chat line) and the GitHub device-flow `Link` (grill 1.21).
- The pane draws at most `PANE_MAX_COLUMNS = 120` columns, centred, and at most `PANE_ROWS = 24`
  rows (grill 1.9). PR 2's layout floors, `DETAIL_COLUMNS`, `MESSAGE_ROWS` and the other pane
  constants keep their values.
- Each window Image stays under `IMAGE_MAX_BYTES` (1 MiB). The pane Svg stays under
  `PANE_SVG_MAX_CHARS = 120,000`.
- Button hotkeys are one digit or one lowercase letter. Tab hotkeys stay `i h m r a o c b` on the
  keys `tab-<tab>`. Account keeps `s n x`. Yes/No keep `y n`; `q` is back; `p` is play here in
  secondary mode.
- Every PR 2 pane golden (`pane-inventory` … `pane-small`) and every strip and stage golden stays
  byte-identical. A change to one is a defect in this plan's refactor, not a golden to regenerate.
- Every module that calls `read` or `update` on an atom declares that atom itself
  (`hooks/state.ts`'s rule for `claude plugin validate`).
- The plugin reads no files at runtime. No sim change: `SIM_VERSION` stays 4, nothing under
  `packages/` changes, no new `GameView` field. No protocol or ledger change.
- Gold in windows is `${formatCount(n)}G` (`gold` in `ui/pane/inventory.ts`).
- The absence list in the transcription holds, except the grafts grill 1.20 and 1.21 name (list
  sprites in Market rows, gold hotkey letters, dim columns, your leaderboard rows in gold, the
  divider under list headings).
- Colours are judged in cmux, never in Terminal.app.
- `bin/check-design-tells.sh` runs on every Write and Edit; override only with a
  `design-tells: acknowledged` comment defended in the commit message.
- Plugin tests import `claude-code/testing` and run only through
  `claude plugin test plugins/promptfall`.
- Full check line, run before each task's final commit from Task 2 on:
  `pnpm lint && pnpm typecheck && pnpm test && pnpm vendor:check && pnpm sprites:check && pnpm font:check && pnpm exec tsc -p plugins/promptfall && claude plugin validate plugins/promptfall && claude plugin test plugins/promptfall`.
  Task 1 runs `pnpm lint` only.
- No `any`.

## Shared contracts

### Constants (`plugins/promptfall/hooks/windows/tuning.ts`)

| Name | Value | Meaning |
|---|---|---|
| `FIELD_ROWS` | 1 | the rows a field takes on a terminal; replaces `PRICE_INPUT_ROWS` (same value) |
| `LINK_ROWS` | Task 1 | the rows the device-flow `Link` takes on a terminal |
| `FIELD_HELP` | Task 1 | the message line that says how to leave a field: `'Tab: leave the field.'` or `'Esc: leave the field.'` |
| `MARKET_PER_PAGE` | 10 | the server's page size (today's `PER_PAGE` in `ui/market.tsx`, moved here) |
| `CHAT_KEEP` | 200 | the messages the client holds (`WorldState.messages`); for the Chat list's alt and tests only |

### Dialog state (`plugins/promptfall/types/index.d.ts`, modified)

```ts
/** A Market filter or an order-form field a pick window sets. */
export type PickField = 'base' | 'cls' | 'minRarity' | 'orderBase' | 'orderRarity' | 'orderAffix'

/** A sub-window open over a list (grill 1.20, 1.21). `at` is its ▶ row. */
export type PaneMenu =
  | { kind: 'actions'; tab: 'inventory' | 'heroes'; id: string; at: number }
  | { kind: 'equip'; itemId: string; at: number }
  | { kind: 'reforge'; itemId: string; at: number }
  | {
      kind: 'confirm'
      action: 'vendor' | 'dismiss' | 'buy' | 'cancel-listing' | 'cancel-order' | 'reset'
      id: string // the item, hero, listing or order; '' for reset
      at: number // 0 Yes, 1 No
    }
  | { kind: 'filter'; at: number } // the Market filter window
  | { kind: 'pick'; field: PickField; at: number }

export type DialogState = {
  // … PR 2's fields, with `cursor` widened:
  cursor: Partial<Record<DialogTab, PaneCursor | null>>
  /** The order form's ▶ row (Orders, while `orders.form` is set and no pick is open). */
  formAt: number
}
```

`DIALOG_DEFAULT.cursor` stays `{ inventory: null, heroes: null }`; a tab missing from `cursor` reads
as `null`. PR 2's literals (`{ inventory: …, heroes: null }`) compile unchanged. `DIALOG_DEFAULT`
gains `formAt: 0`; the `form` action resets it to 0 when it opens a form.

`withCursor` writes, in order: a `row:` key, the list cursor; else with `sell`, `sell.at`; else with
`menu`, `menu.at`; else on Orders, `formAt`. `stopsSignature`'s window string gains `filter`,
`pick:<field>`, `confirm:<action>:<id>` and `form` (the order form with no pick open).

`MarketState.confirm` goes in Task 9 (the buy Yes/No is the dialog's `menu`, as Vendor's is).

### Pane input (`plugins/promptfall/hooks/ui/pane/input.ts`, modified)

```ts
/** What the frame reads: layout, the read-only rule, the dialog state, the tab. */
export type FrameInput = {
  tab: DialogTab
  dialog: DialogState
  mode: Mode
  readOnly: boolean
  notice: string | null
  columns: number
  rows: number
}

/** Machine and session facts the Account tab shows. */
export type AccountInput = {
  server: string // the server label: 'in-process' or the URL
  leaseOwner: string | null
  settings: Settings
  renderer: Renderer // the probe's verdict, for `auto (image)`
  collapsed: boolean // prefs.collapsed
}

export type PaneInput = FrameInput & {
  view: GameView
  world: WorldState | null
  running: boolean
  art: boolean
  hasInput: boolean
  remainingMs: (deadline: number) => number
  market: MarketState
  orders: OrdersState
  chat: ChatState
  boards: BoardsState
  account: AccountInput
}

/** A message line: plain text in TEXT_RGB, or spans (a gate line in WARN_RGB). */
export type MessageLine = string | Span[]

/** The message window's two lines. Rules 1 to 4 are the frame's; `error` is rule 4's text. */
export function messageLines(
  input: FrameInput,
  error: string | null,
  state: [MessageLine, MessageLine],
): [Span[], Span[]]
```

Rule 4 becomes "the tab's error, in `DOWN_RGB`": `sell.error` on Inventory and Heroes,
`market.error`, `orders.error`, `chat.error`, `boards.error` on their tabs. The builders pass it.

### Ring stops, actions, the field (`plugins/promptfall/hooks/ui/pane/types.ts`, modified)

Load-bearing: the builders return actions as data and the mount runs them.

```ts
export type PaneFieldKey = 'price' | 'order-price' | 'compose'

/** An Input under the picture. Shown only where the surface has an Input. */
export type PaneField = {
  key: PaneFieldKey
  label: string
  placeholder: string
  value: string
  submitLabel: string
}

export type PaneAction =
  // PR 2's members, `price` replaced by `field`:
  | { t: 'tab'; tab: DialogTab }
  | { t: 'open'; menu: PaneMenu }
  | { t: 'back' } // see "Back" below
  | { t: 'event'; event: PlayerEvent; keep?: true }
  | { t: 'party'; heroId: string }
  | { t: 'sell'; kind: 'item' | 'hero'; id: string }
  | { t: 'accept'; orderId: string; price: number }
  | { t: 'list'; price: number }
  | { t: 'field'; key: PaneFieldKey } // focuses the field under the picture
  | { t: 'claim' }
  | { t: 'none' }
  // New:
  | { t: 'query'; query: MarketQuery; menu: PaneMenu | null } // loadMarket, cursor.market cleared, then `menu`
  | { t: 'buy'; listingId: string } // confirmBuy; closes the menu
  | { t: 'cancel'; what: 'listing' | 'order'; id: string } // ordersTrade cancel; closes the menu
  | { t: 'form'; form: NonNullable<OrdersState['form']> | null; menu: PaneMenu | null } // sets orders.form, then `menu`
  | { t: 'place' } // places the order form (placeOrder)
  | { t: 'setting'; patch: Partial<Settings> } // merges into the stored settings
  | { t: 'band'; collapsed: boolean } // prefs.collapsed
  | { t: 'off' } // game()?.setOff(true)
  | { t: 'link' } // game()?.link()
  | { t: 'reset' } // game()?.reset(); closes the menu

export type PaneBuild = {
  scene: PaneScene
  stops: readonly Stop[]
  focus: string | null
  /** The field under the picture, or null. Replaces PR 2's `priceInput`. */
  field: PaneField | null
  /** The device-flow URL under the picture (Account), or null. */
  link: { url: string } | null
}
```

`Stop` does not change. `query` sets `menu` and clears `cursor.market` before it awaits
`loadMarket`, so a pick window never stays open through a slow fetch. **Back**, in order, the first that applies: a Market pick (`base`, `cls`,
`minRarity`) goes back to the filter window with its ▶ on that field's row; an order pick
(`orderBase`, `orderRarity`, `orderAffix`) closes, showing the form again; any other menu closes;
else the sell flow closes; else, on Orders, an open form closes; else nothing.

### Stop keys

PR 2's keys stay. New row keys, unique within a tab:

| Tab | Rows |
|---|---|
| Market | `row:filters` (hotkey `f`), `row:prev`, `row:next`, `row:<listingId>` |
| Orders | `row:l-<listingId>`, `row:o-<orderId>`, `row:new` |
| Account | `row:sound` (`s`), `row:motion` (`n`), `row:renderer` (`x`), `row:band`, `row:off`, `row:link`, `row:reset` |
| Odds | `row:expand-inventory`, `row:expand-roster` |
| Chat | `row:m-<messageId>`, and `row:newest` for the newest message |
| Leaderboards | `row:z-<accountId>`, `row:d-<accountId>` |

Menu, pick and form items are `menu:<i>`; Yes/No are `yes` and `no`, as in PR 2.

## Layout

PR 2's Layout section holds, with two changes.

**Short panes.** `paneLayout` first tries PR 2's layout. When the middle falls under the floor
(9 wide, `NARROW_DETAIL_ROWS + 4` narrow) but would meet it without the tab window, the layout
keeps its kind with `tabRows: 0` and the middle starting at row 0: no tab window, the tab stops
still mounted for their hotkeys. Otherwise `small`, as in PR 2. At 24 rows nothing changes. At 14
rows (an inline pane in a 105 × 50 terminal) both wide and narrow fit.

**Under the picture.** On a terminal the dialog builds once at `min(PANE_ROWS, bodyRows)`; if the
build has a `field` it builds again with `FIELD_ROWS` fewer rows, if it has a `link` with
`LINK_ROWS` fewer. A build never has both. The builders are pure, so the second build is cheap.
This replaces PR 2's pre-check through `sellState`. Known cost: a narrow pane (under 96 columns)
at exactly 14 rows with a field showing has a 13-row picture, under the narrow floor without the
tab window, so it reads "needs more room". A wide inline pane (96 columns and up) fits.

**The panel slot.** A panel (the sell window, the order form) takes the whole right column (wide)
or the band (narrow), as PR 2's sell window does. A pick opened from a panel takes the panel's
place: the same slot, `menuWindow`, whole column.

**Paging with lines.** A list holds lines with stops and lines without. The ▶ row's *line* sets
the page (`page(line, shown)`), as the sell window already does. `ListSpec.cursor` stays the stop
position (the `cursorRow` result); `listPane` maps it to its line. A list with `fromEnd` (Chat)
cuts its pages from the last line back, so the newest page is always full:
`end = total − floor((total − 1 − line) / shown) · shown`, the page is lines `max(0, end − shown)`
up to `end`. Still a pure function of the line and the count.

**A list always has a cursor stop.** When no row has a key (nothing loaded, closed, empty, both
expansions at max, the no-view pane), the first line becomes the stop `row:empty` with
`ListSpec.emptyAction` (default `none`). With no cursor stop at all, PR 2's focus hook keeps the
ring on whatever tab or back Button holds it, and Enter would press it (grill 1.20's ruling).

**Leaving a field.** While the ring is on a field (`ringOnInput`), a move onto a non-cursor stop
lands on `build.focus`, not on the next cursor stop in the direction of travel: leaving the field
puts the ring back on the ▶. Without this, Shift+Tab from Chat's field wraps onto the oldest
message.

## Window contents

Words below are the window text, verbatim. `MOVE_HELP` is `Tab or arrows: move.` Every list
row is laid out by `rowSpans` (PR 2): the ▶ cell and a gap, then the left part, then the
right-aligned columns. A heading line has `rule: true` and no stop. "Dim" is `DIM_RGB`.

### Market

**List window.** Title `Market: <search> · 1,240G`, clipped to the window, where `<search>` joins,
with `, `: `items` or `heroes`; the base's name or the class label when set; `rare+`, `epic+` or
`legendary+` when set; `cheapest` or `newest`. Rows, in order:
1. `Filters`, the `f` drawn gold. Action `open` the filter window at 0. `rowSpans` takes the
   name as one span or a span list (`hotkeySpans`), so a row label can carry its gold letter.
2. `Previous page`, while `query.page > 0`. Action `query` with `page − 1`, menu null.
3. One row per listing on the page: `{ art }` (where `art` is on: the item base's sprite, or the
   hero class's), the name in its rarity colour; right-aligned the seller's name, 10 cells, dim
   (`yours` for your own; dropped when the inner width is under 40), a gap, the price, 10 cells.
   Action: `open` a `confirm` `buy` Yes/No; `none` for your own listings, in read-only mode, or
   while `gateLine` gives a line.
4. `Next page`, while `(page + 1) · MARKET_PER_PAGE < total`. Action `query` with `page + 1`.

With no page loaded, the listing rows are one line: `Loading the market…` while busy, else
`Nothing loaded yet.` With a page and no listings: `No listings match.`

Default ▶ (no `cursor.market`): the first listing, else `Filters`.

**Detail window**, for the ▶ row. A listing: header the name in its rarity colour, with a rule;
`Rare weapon` (rarity capitalised, then the item base's slot from `content.itemBases`) or
`Rare Knight` (the hero's class label); the listing's `detail` wrapped to the width (`wrap`); a
blank line; `Seller kevin` or `Your listing`; `Price 1,200G`; `Expires in 6d`
(`formatRemaining(remainingMs(expiresAt))`). On `Filters`, `Previous page` or `Next page`: header
`Search` with a rule; `Kind    items`; `Sort    cheapest`; `Base    any` (or `Class   any`);
`Rarity  any` (or `rare+`); a blank line; `Page 2 of 5 · 43 listings` (no page loaded: blank).

**Filter window** (`menu.kind 'filter'`, a command window in the menu slot): header `Filters` with
a rule; items `Kind: items`, `Sort: cheapest`, `Base: any` (`Class: any` for heroes), `Rarity: any`.
Kind and Sort run `query` with the flipped value, page 0, and menu `{ kind: 'filter', at }` (the
window stays, the ▶ on the same item). Flipping the kind drops `base` and `cls` and keeps
`minRarity`, as today. Base, Class and Rarity `open` a pick window on the current value.

**Pick windows** (`menu.kind 'pick'`): header `Base`, `Class` or `Rarity` with a rule; items `any`
then, for Base, every item base by name (sorted by id, as today); for Class, the four class labels;
for Rarity, `rare`, `epic`, `legendary`. The ▶ starts on the current value. Picking runs `query`
with that filter set (or cleared by `any`), page 0, and menu `{ kind: 'filter', at: <the field's
row> }`.

**Yes/No** (`confirm` `buy`): Yes runs `buy`, No goes back.

**Message window**, the first that applies after rules 1 to 4: Yes/No open:
`Buy Silk Robe for 1,200G?`, blank. Filter window: `Change the search.`, `q: back.` A pick:
`Show which base?` (`class?`, `rarity at least?`), `q: back.` A gate (`gateLine`): the gate line in
`WARN_RGB`, `Browsing still works.` The ▶ on your listing: `This listing is yours.`, `MOVE_HELP`.
The ▶ on a listing: `Enter: buy. ` + `MOVE_HELP`; second line `Loading the market…` while busy,
else `Page 2 of 5 · 43 listings.`. The ▶ on `Filters`: `Enter: change the search.`, same second
line. On a page row: `Enter: next page.` (or `previous page.`), same second line.

### Orders

**List window.** Title `Orders · 1,240G`. Rows, in order:
1. `Returns waiting: 3` in `WARN_RGB`, no stop, while `returns > 0`.
2. Heading `My listings`. Then one row per listing: the name in its rarity colour; right-aligned
   the price, 10 cells. Action `open` a `confirm` `cancel-listing` Yes/No (`none` in read-only).
   None: a dim line `None.`
3. Heading `My buy orders`. Then one row per order: `<name> <rarity>+` in the minimum rarity's
   colour; right-aligned `≤` and the max price, 11 cells (`≤1,200G`). Action `open` a `confirm`
   `cancel-order` Yes/No (`none` in read-only). None: `None.`
4. `New buy order`, unless read-only or `gateLine` gives a line. Action `form` with today's
   default (`steel_longsword`, `rare`, no affix, empty price), menu null.

Not loaded: one line `Loading your orders…` while busy, else `Nothing loaded yet.`

**Detail window.** A listing: header the name in its rarity colour with a rule; the rarity and
slot line as Market's; its `detail` wrapped; a blank line; `Listed for 1,200G`;
`Expires in 6d`. An order: header `Buy order` with a rule; the base's name; `Rare or better`
(`Epic or better` …); `With Vicious` or `Any affix`; `Up to 1,200G, held`; `Expires in 6d`. On
`New buy order`: header `New buy order` with a rule; `Gold is held until the order fills or you`;
`cancel it.`

**Order form** (the panel, while `orders.form` is set, the view is not read-only and `gateLine`
gives no line, as `ordersBody` hides it today; its ▶ is `dialog.formAt`): header `New buy order` with a rule; items:
`Base: Steel Longsword` (opens pick `orderBase`), `Rarity: rare+` (pick `orderRarity`), `Affix:
any` (pick `orderAffix`); then, where the surface has an Input, `Price: 1,200G` or `Set a price`
(action `field` `order-price`), else one item per preset (`formatCount` of `baseValue × m` for
`m` in 2, 3, 5, 8, today's `PRESETS`), each a `form` action setting `maxPrice`; then `Place order`
when the price is valid and the orders are not busy (action `place`), else `Place order` dim with
`none`. The field `order-price`: label `max price`, placeholder `gold`, submit label `place`.

**Order picks**: header `Base`, `Rarity` or `Affix` with a rule; Base lists every base by name;
Rarity `rare`, `epic`, `legendary`; Affix `any` then every affix by name (sorted by id). Picking
runs `form` with that field set and menu null.

**Yes/No**: Yes runs `cancel` for the listing or the order, No goes back.

**Message window**: Yes/No: `Cancel the listing of Silk Robe? The fee is kept.` or
`Cancel the buy order? 1,200G comes back.`, blank. A pick: `Which base?` (`Which rarity at
least?`, `Which affix?`), `q: back.` The form: `Buy order: Steel Longsword rare+, any affix, up
to 1,200G.` once the price is valid, `A price from 1 to 1,000,000 gold` once one is typed and
invalid, else `Pick what to buy, then a price.`; second line `q: back.` A gate: the gate line in
`WARN_RGB`, blank. Else `Enter: cancel it. ` + `MOVE_HELP` on a listing or order,
`Enter: place a buy order.` on `New buy order`; second line `Returned goods wait for a free slot.`
while returns wait, else blank.

### Account

**List window.** Title `Account`. Rows (label left, value right-aligned in 24 cells, clipped):
- `Sound` / `on` or `off` (hotkey `s`), action `setting` `{ sound: !sound }`.
- `Motion` / `full` or `still` (`n`), action `setting` with the other.
- `Renderer` / `auto (image)` (the renderer in brackets), or `raster (from next start)` when
  forced (`x`, not drawn: the label has no `x`), action `setting` with `RENDERER_NEXT` (moved
  from `dialog.tsx`).
- `Band` / `shown` or `collapsed`, action `band` with the other.
- `Band off`, action `off`.
- `Link GitHub`, only when not linked, no code pending and not read-only; action `link`.
- `Reset this machine's data`, action `open` a `confirm` `reset` Yes/No at 1: the ▶ opens on No,
  since rows above it can vanish (`Link GitHub`) and the ▶ clamps onto it.

Settings, the band rows and Reset act in read-only mode, as today.

**Detail window** (not ▶ dependent): header `Account` with a rule; `Server in-process` (clipped);
`Account acct-1`; `Client 0.4.0 · sim v4`; `Mode primary`; `Session <owner>` or `Session none`;
`Highest zone 3 · kills 120 · wipes 2`; a blank line; then `Linked as kevin`, or while a code is
pending `Enter ABCD1234 at` and `the link under this window.`, else `Not linked.`

**Link**: while a code is pending, `PaneBuild.link` is `{ url }` and the mount draws a `Link` under
the picture (key `link-url`, label the URL).

**Message window**: Yes/No: `Reset this machine's data? The game starts over.`, blank. Else
`Enter: change it. ` + `MOVE_HELP`; second line `Settings are kept per machine.`

**No game view.** `noViewPane` (Task 6): the tab window; a list window titled with the tab's label
holding one line, `Promptfall has not started in this session.` (the `row:empty` stop); an empty
detail window; the
message window `Promptfall has not started in this session.`, blank. On Account with a game handle,
the list holds `Reset this machine's data` (the reset Yes/No) and the detail `Server …` and
`Client …`. The tab, back and reset stops mount.

### Odds

**List window.** Title `Odds · zone 3`. Lines, no stops: a heading, `Rarity` in 10 cells, then `Zone`,
`Boss` and `Tavern` each right-aligned in 8 cells; one line per rarity in `RARITIES`
order, the name in its rarity colour (10 cells), then the zone, boss and tavern percentages, 8
cells each, right-aligned (`percent`, moved from `dialog.tsx`). A zone without content shows `-`.
Then a heading `Expansions`. Then:
- `Inventory +10 slots` / `500G` (`content.expansions.inventory.step`, `view.nextInventoryCost`),
  action `event` `{ t: 'expand_inventory' }`, dim when gold is short; `Inventory at max`, dim, no
  stop, when the cost is null.
- `Roster +4 heroes` / `400G`, the same for the roster.
In read-only mode the two rows carry `none`.

**Detail window**: on the inventory row: header `Inventory` with a rule; `20 of 30 slots`;
`+10 for 500G`; `You have 1,240G`. On the roster row: `Roster`, `4 of 6 heroes`, `+4 for 400G`,
`You have 1,240G`. No stop: empty.

**Message window**: `Enter: buy it. ` + `MOVE_HELP` (or `MOVE_HELP` alone with no stop); second
line `Drop odds in zone 3, its boss, and the tavern.`

### Chat

**List window.** Title `Chat`. One row per message in `world.messages`, oldest first: the name and
a colon, dim, then a gap and the text, clipped to the row. The newest's key is `row:newest`, the
rest `row:m-<id>`. Action `field` `compose` where the field shows, else `none`. No messages: one
line `No messages yet.`, the `row:empty` stop, its action `field` `compose` where the field shows.
Pages cut from the end (`fromEnd`).

Default ▶ (no `cursor.chat`, or `cursor.chat.id === 'newest'`): the newest row. So the ▶ follows
new messages until it is moved, and moving it back onto the newest follows again.

**Detail window**: header the ▶ message's name with a rule; its text wrapped to the width. No
messages: empty.

**Field** `compose`: label `say`, placeholder `a message`, value `chat.draft`, submit label
`send`. Shown when the surface has an Input and the chat gate is open (today's rule: `gates` chat
open and linked). Not focused when the tab opens (grill 1.21).

**Message window**: the chat gate (`GATE_CHAT_LOCAL`, `GATE_CHAT_CLOSED` or `GATE_UNLINKED`, as
`chatBody` picks it) in `WARN_RGB`, blank. No Input: `CHAT_READ_ONLY`, blank. Else
`Enter: write. ` + `MOVE_HELP`; second line `FIELD_HELP`.

### Leaderboards

**List window.** Title `Leaderboards`. Closed (`leaderboardsOpen` false): one line
`Leaderboards are closed.` Loading with nothing yet: `Loading…`. Else: heading `Highest zone`;
one row per entry, `1. kevin` on the left, `zone 12` right-aligned (10 cells); heading
`Boss damage this week`; one row per entry with the value `formatCount`ed, or the line
`No boss damage yet this week.` Your rows (`accountId`) draw in `GAUGE_FULL_RGB`. Every row's
action is `none`: the rows are stops so Up and Down page through them.

**Detail window**: header `Online` with a rule; `onlineLine`'s text wrapped (`presence is off`,
`connecting to the world…`, `nobody online`, or `Online by zone: z1 3 · z2 5`), each capitalised
as a sentence.

**Message window**: closed: `Leaderboards are closed.` in `WARN_RGB`, blank. Else `MOVE_HELP`;
second line `The boss board resets Monday 00:00 UTC.`

## Task list

### Task 1: The fields spike

**Files:**
- `spikes/ui-remake/hooks/register.tsx` (modify): `/spike-pane` gains a `Link` under its `Input`
  (key `link-url`, label `https://github.com/login/device`) and a log line for `ui.close` and for
  `ui.focus` moves off the Input; its `ui.close` hook stops refusing the first close (PR 2 already
  answered that question, and a refused close would hand the keyboard to the prompt and confound
  question 1); nothing else changes.
- `docs/plans/2026-10-05-ui-remake-spikes.md` (modify): a section `## PR 3 fields spike`.

**Interfaces:** Produces `LINK_ROWS`, `FIELD_HELP`, and whether the `Link` joins the focus ring.

**Work:** Questions:
1. **Escape in a field.** With the ring on the `Input`, does Escape close the pane (a `ui.close`
   by the person) or move the ring off the field with the pane still holding the keyboard (the next
   `q` backs out, Down moves the ring)?
2. **Tab off a field.** From the `Input`, where does Tab go: the engine stop, then the first stop
   (as PR 2 found), or the `Link`?
3. **The Link.** How many rows does it take on a terminal? Does it join the ring?

Drive cmux and Terminal.app yourself (`HANDOFF-ui-pr1.archived.md` §"Dead ends and facts"). The
desktop row is Kevin's unless he is away and says so (check `pgrep -lf -i "league|riot"` and ask).

Decisions the section sets:
- `FIELD_HELP`: question 1 "moves the ring off": `'Esc: leave the field.'`; "closes the pane":
  `'Tab: leave the field.'`.
- `LINK_ROWS`: question 3's row count.
- If the Link joins the ring, the focus hook passes it (it holds no stop), as it passes the
  field; write that down for Task 8.

**Acceptance check:** the section's findings table has a row each for cmux and Terminal.app with
every question answered and a desktop row answered or marked Kevin's; the decisions name
`FIELD_HELP`, `LINK_ROWS` and the Link's ring rule. `pnpm lint` passes.

**Boundaries:** Nothing under `plugins/`. On ambiguity, stop and report `blocked: <ambiguity>`.

- [x] The Link and the log lines in `/spike-pane`
- [x] Drive cmux and Terminal.app; fill the table
- [x] Decisions; `pnpm lint`; commit `spike(ui): the PR 3 fields: Escape and Tab in an Input, a Link`

### Task 2: Dialog state and the pane input

**Files:**
- `plugins/promptfall/types/index.d.ts` (modify): `PickField`; `PaneMenu`'s new members;
  `DialogState.cursor` widened and `formAt`, as in Shared contracts.
- `plugins/promptfall/hooks/state.ts` (modify): `DIALOG_DEFAULT.formAt = 0`.
- `plugins/promptfall/hooks/ui/pane/input.ts` (modify): `FrameInput`, `AccountInput`; `PaneInput`
  as in Shared contracts; `messageLines(input, error, state)`.
- `plugins/promptfall/hooks/ui/pane/fixtures.ts` (modify): `paneInput` fills the new fields
  (`MARKET_DEFAULT`, `ORDERS_DEFAULT`, `CHAT_DEFAULT`, `BOARDS_DEFAULT`, and an `AccountInput` of
  `in-process`, `null`, `SETTINGS_DEFAULT`, `'image'`, `false`).
- `plugins/promptfall/hooks/ui/pane/list.ts`, `inventory.ts`, `heroes.ts`, `sell.ts` (modify):
  only what the `messageLines` signature, the `cursor` widening and the new `PaneMenu` members need
  to compile (Inventory and Heroes pass `sell.error` as `error`; `cursor.inventory ?? null`;
  `inventory.ts:178`'s `'itemId' in menu ? menu.itemId : menu.id` becomes a narrowing that
  handles the `filter` and `pick` members, which carry no id).
- `plugins/promptfall/hooks/ui/pane/mount.tsx` (modify): `withCursor` and `last` take any
  `DialogTab`; nothing else.
- `plugins/promptfall/hooks/ui/dialog.tsx` (modify): builds the wider `PaneInput` for the two
  pane tabs (reads the market, orders, chat, boards, prefs, renderer, lease and server atoms it
  already reads, or declares them; `AccountInput.settings` is
  `parseSettings(await $.store.get('promptfall:settings'))`, as the Account body reads it today,
  with the settings atom read only to keep the render subscribed); the window string at line 303
  handles the new `PaneMenu` members (`menu.kind` for `filter`, `pick:<field>` for a pick);
  nothing else.
- `plugins/promptfall/hooks/ui/pane/frame.test.ts`, `inventory.test.ts` (modify): the
  `messageLines` calls.

**Interfaces:** Produces the types and signatures in Shared contracts, by those names.

**Work:** Types and plumbing only; no behaviour change. Internal structure is your choice.

**Acceptance check:** the full check line passes; every PR 2 pane golden matches. Red before:
`PickField` does not exist.

**Boundaries:** No new window, action or layout.

- [x] Types, `PaneInput`, fixtures, `messageLines`; run the check, commit

### Task 3: The frame grows lines, panels, fields and short panes

**Files:**
- `plugins/promptfall/hooks/ui/pane/types.ts` (modify): `PaneFieldKey`, `PaneField`, the
  `PaneAction` members, `PaneBuild.field` and `.link` (dropping `priceInput`), as in Shared
  contracts.
- `plugins/promptfall/hooks/windows/tuning.ts` (modify): `FIELD_ROWS` (dropping
  `PRICE_INPUT_ROWS`), `LINK_ROWS`, `FIELD_HELP`, `MARKET_PER_PAGE`, `CHAT_KEEP`.
- `plugins/promptfall/hooks/ui/pane/frame.ts` (modify): the short-pane rule in `paneLayout`;
  `assemble` takes no tab window when `tabRows` is 0.
- `plugins/promptfall/hooks/ui/pane/list.ts` (modify): `ListRow` and `ListSpec` as below;
  `listPane(input: FrameInput, spec)`.
- `plugins/promptfall/hooks/ui/pane/sell.ts` (modify): `SellBuild` becomes `PanelBuild`
  (`priceInput` → `field`); the `price` action becomes `field` `price`.
- `plugins/promptfall/hooks/ui/pane/inventory.ts`, `heroes.ts` (modify): pass the sell window as
  `spec.panel`; nothing else.
- `plugins/promptfall/hooks/ui/pane/mount.tsx` (modify): `priceInput` → `field`, the `price`
  action → `field`; the field draws with the build's `PaneField` props; no new behaviour.
- `plugins/promptfall/hooks/ui/dialog.tsx` (modify): the build-twice rule in Layout replaces the
  `sellState` pre-check; the price handlers move to the `field` callbacks.
- `plugins/promptfall/hooks/ui/pane/frame.test.ts` (modify: `paneLayout(120, 15)` and
  `paneLayout(60, tabRows + 13)` turn wide and narrow under the short-pane rule; the floors move
  to `120 × 12` and `60 × 13`), `list.test.ts` (create), `sell.test.ts`, `inventory.test.ts`,
  `mount.test.tsx` (modify: `priceInput` → `field`).

**Interfaces:**
- Consumes: Task 2.
- Produces, in `list.ts`:

```ts
export type ListRow = {
  /** `row:<id>`; absent for a line that takes no stop (a heading, a note). */
  key?: string
  hotkey?: string
  spans: Span[]
  /** Present exactly when `key` is. */
  action?: PaneAction
  /** A heading: DQ's divider under the line. */
  rule?: true
  alt: string
}

export type PanelBuild = {
  win: Win
  stops: Stop[] // `menu:<i>` per item
  /** The panel's ▶ item. */
  at: number
  state: [MessageLine, MessageLine]
  field: PaneField | null
}

export type ListSpec = {
  title: Span[]
  altTitle: string
  rows: readonly ListRow[]
  empty: string
  /** The ▶ as a stop position among the rows with a key; -1 with none. */
  cursor: number
  detail: ((inner: number) => Line[]) | null
  menu: {
    header: Span[]
    items: readonly (MenuItem & { action: PaneAction })[]
    at: number
    /** A pick over a panel: takes the panel's slot. */
    wholeColumn?: true
  } | null
  yesNo: { at: number; yes: PaneAction } | null
  /** A window in the detail window's place; `build` is called with its slot. */
  panel: ((at: Rect) => PanelBuild) | null
  /** Rule 4's text: the tab's error. */
  error: string | null
  state: [MessageLine, MessageLine]
  /** Pages cut from the last line back (Chat). */
  fromEnd?: true
  /** The `row:empty` stop's action when no row has a key; `none` when absent. */
  emptyAction?: PaneAction
  /** The field when no panel brings one (Chat's compose), else null. */
  field: PaneField | null
  link: { url: string } | null
}
```

**Work:**
- Rows without a key draw like any row (the ▶ cell blank) and take no stop; with `rule` they
  draw the divider. Row stops carry `index` = their stop position. The ▶ row's line sets the page.
  A row's `hotkey` goes on its stop, and its label's letter draws gold (`hotkeySpans`) when the
  builder asks for it in the spans.
- The panel: `listPane` counts its lines with a tall dry run (as PR 2 does for the sell window),
  takes the menu slot with `wholeColumn`, and the panel's stops, state and field replace the row
  stops, the spec's state and field. `focus` is `menu:<at>` from the panel's own ▶.
- The short-pane rule as Layout says.
- Internal structure is your choice.

**Acceptance check:** every PR 2 pane golden matches, byte for byte. New tests: at 120 × 14 the
layout is wide with `tabRows` 0 and middle 10; at 60 × 14 narrow with middle 10; at 120 × 12 small;
`assemble` with no tab window passes `tilePositions`; a list of a heading, two rows, a heading,
one row gives three stops with `index` 0, 1, 2 and the heading lines carry `rule`; with 20 lines
and the ▶ on the stop at line 18, a 17-row window (15 lines) shows lines 15 to 19; with
`fromEnd`, 31 lines and the ▶ on line 30, the window shows lines 16 to 30, and the ▶ on line 10
shows lines 1 to 15; a list of only keyless lines mounts one `row:empty` cursor stop carrying
`emptyAction`; a `panel` replaces the
detail window and its stops replace the rows; a `wholeColumn` menu takes the panel's slot;
`messageLines` puts `error` in `DOWN_RGB`; the sell window's `Set a price` is a `field` `price`
action and its build has `field.key` `price`. Red before: `ListRow.key` is required.

**Boundaries:** No new tab. Inventory and Heroes draw what they drew.

- [x] Types, constants; `ListRow` lines and paging; tests
- [x] The panel slot, the sell window through it, `wholeColumn`; tests
- [x] Short panes; `field` and `link` through the mount and the dialog; tests
- [x] Goldens unchanged; run the check, commit

### Task 4: The Market windows

**Files:**
- `plugins/promptfall/hooks/ui/pane/market.ts` (create): `marketPane(input: PaneInput): PaneBuild`.
- `plugins/promptfall/hooks/ui/pane/inventory.ts` (modify): `rowSpans`'s name parameter takes
  `Span | Span[]`; nothing else (PR 2 goldens unchanged).
- `plugins/promptfall/hooks/ui/pane/fixtures.ts` (modify): `listing(id, patch)` and a market page
  of three listings (a rare sword by `seller-1`, an epic hero by `a1` (yours: `paneView()`'s `accountId`), a
  legendary ring)
  with `total: 23`.
- `plugins/promptfall/hooks/ui/pane/market.test.ts` (create).

**Interfaces:**
- Consumes: Tasks 2 and 3; `spriteFor`; `gateLine` (`ui/trade.ts`); `content`, `CLASS_LABEL`,
  `formatRemaining`, `wrap`, `gold`, `rowSpans`, `listInner`.
- Produces: `marketPane`; `searchText(query: MarketQuery): string` (the title's search, reused by
  the alt and the detail).

**Work:** Per Window contents, "Market". `rowSpans` (`inventory.ts`, in this task's Files) takes
the name as a span or a span list. `query` actions carry the whole next `MarketQuery`
(the builder computes it, as `withFilter` does today; move `withFilter` into this module).

**Acceptance check:** new tests on the fixture page: the title reads
`Market: items, cheapest · 1,240G`; the rows in order (`Filters`, three listings, `Next page`; no
`Previous page` on page 0), the price column and `yours`; Enter on a listing is a `confirm` `buy`
menu, on yours `none`; the default ▶ is the first listing; the filter window's items and the
flipped `query` each carries (kind flip drops `base`); a Base pick lists 41 items with `any` first
and pages, and picking sets `base` with menu `filter` at 2; the Yes/No's `yes` runs `buy`; a gate
makes listing rows `none` and puts the gate line in the message window; read-only keeps `Filters`
working; `market.error` reads red; no page: `Loading the market…` while busy; the detail of a
listing and of `Filters` verbatim; wide and narrow pass `tilePositions`. Red before: the module
does not exist.

**Boundaries:** No mounting. `ui/market.tsx` stays as it is until Task 9.

- [x] List, rows, default ▶, detail; tests
- [x] Filter window, picks, Yes/No, gate, read-only, messages; tests
- [x] Run the check, commit

### Task 5: The Orders windows

**Files:**
- `plugins/promptfall/hooks/ui/pane/orders.ts` (create): `ordersPane(input: PaneInput): PaneBuild`
  and the order form as a panel.
- `plugins/promptfall/hooks/ui/orders.tsx` (modify): export `baseValue` and `PRESETS`; nothing
  else (`ordersBody`'s output does not change).
- `plugins/promptfall/hooks/ui/pane/fixtures.ts` (modify): an orders fixture (two listings, one
  order with an affix, `returns: 2`).
- `plugins/promptfall/hooks/ui/pane/orders.test.ts` (create).

**Interfaces:**
- Consumes: Tasks 2 to 4 (`gold`, `rowSpans`); `validPrice`; `content`.
- Produces: `ordersPane`.

**Work:** Per Window contents, "Orders". The form's picks open as `menu` with `wholeColumn` while
`orders.form` is set; picking runs `form` with the patched form and menu null.

**Acceptance check:** new tests: the rows in order with the returns line, both headings, the rows'
price columns (`≤1,200G` for the order) and `New buy order`; Enter on a listing and an order opens
their Yes/No and `yes` runs `cancel` with the right `what` and id; the Yes/No questions verbatim;
empty sections read `None.`; read-only: rows `none`, no `New buy order`; a gate: no `New buy
order`, the gate line; the form's items with `Set a price` (field `order-price`), with a typed
valid price `Price: 1,200G` and `Place order` running `place`, with an invalid one `Place order`
dim and the range line; with `hasInput: false` the four presets; `formAt: 4` puts the ▶ and the
build's `focus` (`menu:4`) on `Place order`; a Base pick takes the form's slot and picking returns
to the form; with the form set and read-only, or gated, no form panel shows; `back` rules are the mount's (Task 8), not tested here. Red
before: the module does not exist.

**Boundaries:** No mounting. `ordersBody` behaves as before.

- [x] Rows, detail, Yes/No; tests
- [x] The form, its picks, presets; tests
- [x] Run the check, commit

### Task 6: The Account and Odds windows, and the no-view pane

**Files:**
- `plugins/promptfall/hooks/ui/pane/account.ts` (create): `accountPane(input: PaneInput):
  PaneBuild`, `noViewPane(input: NoViewInput): PaneBuild`, `RENDERER_NEXT` (moved from
  `dialog.tsx` in Task 9; defined here now).
- `plugins/promptfall/hooks/ui/pane/odds.ts` (create): `oddsPane(input: PaneInput): PaneBuild`,
  `percent` (the same arithmetic as `dialog.tsx`'s, which goes in Task 9).
- `plugins/promptfall/hooks/ui/pane/account.test.ts`, `odds.test.ts` (create).

**Interfaces:**
- Consumes: Tasks 2 and 3; `CLIENT_VERSION`, `SIM_VERSION`, `content`, `RARITIES`.
- Produces: `accountPane`, `noViewPane`, `oddsPane`, `RENDERER_NEXT`, `percent`, and

```ts
export type NoViewInput = FrameInput & { server: string; hasGame: boolean; hasInput: boolean }
```

**Work:** Per Window contents, "Account" and "Odds". The Account rows' values right-align in 24
cells and clip. The Yes/No for reset runs `reset`.

**Acceptance check:** new tests: Account rows in order with values and the gold `s` and `n`;
`row:sound` carries `setting { sound: true }` from off; a forced renderer reads
`raster (from next start)`; `Link GitHub` absent when linked, read-only or a code is pending; a
pending code gives the two detail lines and `link.url`; reset opens the Yes/No whose `yes` runs
`reset`; the detail lines verbatim; read-only keeps the setting actions. `noViewPane` on Market
draws the one line and mounts only the tab and back stops; on Account with a game it adds the reset
row. Odds: the five rarity lines' percentages match today's `oddsLine` for zone 1 and the tavern;
the expansion rows' actions, dim when gold is short, `Inventory at max` with a null cost;
read-only rows `none`; the detail lines. Red before: the modules do not exist.

**Boundaries:** No mounting. `dialog.tsx` unchanged.

- [x] Account, detail, link, reset; tests
- [x] The no-view pane; tests
- [x] Odds; tests
- [x] Run the check, commit

### Task 7: The Chat and Leaderboards windows

**Files:**
- `plugins/promptfall/hooks/ui/pane/chat.ts` (create): `chatPane(input: PaneInput): PaneBuild`.
- `plugins/promptfall/hooks/ui/pane/leaderboards.ts` (create): `boardsPane(input: PaneInput):
  PaneBuild`.
- `plugins/promptfall/hooks/ui/leaderboards.tsx` (modify): export `onlineLine`; nothing else.
- `plugins/promptfall/hooks/ui/chat.tsx` (modify): export the gate choice as
  `chatGate(view, world): string | null`, used by `chatBody` and `chatPane`.
- `plugins/promptfall/hooks/ui/pane/fixtures.ts` (modify): a world with 30 messages and a boards
  fixture of 20 highest-zone and 20 damage rows, `a1` (`paneView()`'s `accountId`) in both.
- `plugins/promptfall/hooks/ui/pane/chat.test.ts`, `leaderboards.test.ts` (create).

**Interfaces:** Consumes Tasks 2 and 3. Produces `chatPane`, `boardsPane`, `chatGate`.

**Work:** Per Window contents, "Chat" and "Leaderboards".

**Acceptance check:** Chat at 120 × 24 (15 lines shown): 31 and 200 messages each show 15 rows on
the newest page with the ▶ on `row:newest`; `cursor.chat = { id: 'm-12', index: 11 }` shows the
page holding it; adding a message with `cursor.chat` null keeps the ▶ on the newest; no messages:
`row:empty` carries `field` `compose` where the field shows; a row's action is `field` `compose` and the build's
`field` carries `chat.draft`; the gates and `CHAT_READ_ONLY` (with `hasInput: false`, no field)
in the message window; the detail wraps a 200-character message. Leaderboards: both headings, the
rows `1. kevin` / `zone 12`, your rows in `GAUGE_FULL_RGB`, `No boss damage yet this week.`, the
closed line, every row `none`, the 42 lines page by the ▶; the detail's online line. Red before: the
modules do not exist.

**Boundaries:** No mounting. `chatBody` and `boardsBody` behave as before.

- [x] Chat; tests
- [x] Leaderboards; tests
- [x] Run the check, commit

### Task 8: The mount: actions, back, the field and link, the probe

**Files:**
- `plugins/promptfall/hooks/ui/pane/mount.tsx` (modify): the new actions in `runAction`; the Back
  rule in Shared contracts; the `Link` under the picture; the focus hook passes the `Link` (per
  Task 1) and any field key; the probe while the renderer is unknown.
- `plugins/promptfall/hooks/ui/probe.tsx` (create): the probe, moved out of `ui/band.tsx`:
  `probeElement(els, $, requestId, renderer)` returns the probe Image (or null) and arms the blit
  once per module, as the band does today.
- `plugins/promptfall/hooks/ui/band.tsx` (modify): uses `probeElement`; behaviour unchanged.
- `plugins/promptfall/hooks/ui/market.tsx` (modify): `confirmBuy(game, listingId, query, upd,
  after)` takes the listing id instead of reading `market.confirm`.
- `plugins/promptfall/hooks/ui/orders.tsx` (modify): `placeOrder(game, current, upd, after)`, the
  submit today inlined in `dialog.tsx` (one order at a time, the busy guard, the form closes on
  success).
- `plugins/promptfall/hooks/ui/dialog.tsx` (modify): builds the new `ActionContext` members,
  passes `probe` and the `field` callbacks to `paneElement`, and calls `confirmBuy` and
  `placeOrder` with their new signatures from the old Market and Orders wiring, which stays until
  Task 9; nothing else.
- `plugins/promptfall/hooks/ui/pane/mount.test.tsx` (modify).

**Interfaces:**
- Consumes: Tasks 2 to 7.
- Produces: `ActionContext` gains

```ts
  updMarket: Updater<MarketState>
  updOrders: Updater<OrdersState>
  market: () => Promise<MarketState>
  orders: () => Promise<OrdersState>
  setSettings: (patch: Partial<Settings>) => Promise<void>
  setCollapsed: (collapsed: boolean) => Promise<void>
  /** Puts the ring on a field; replaces `focusPrice`. */
  focusField: (key: PaneFieldKey) => Promise<void>
  tab: () => Promise<DialogTab>
```

  and `PaneDraw` replaces `price` with
  `field: { onInput: (key: PaneFieldKey, text: string) => void; onSubmit: (key: PaneFieldKey, text: string) => void }`
  and gains `probe: RenderElement | null`.

**Work:**
- Actions: `query` runs `loadMarket` with the query, clears `cursor.market`, then sets `menu`;
  `buy` clears the menu and runs `confirmBuy`; `cancel` clears the menu and runs `ordersTrade` with
  `cancelListing` or `cancelOrder`; `form` sets `orders.form` and then `menu`; `place` runs
  `placeOrder`; `setting` runs `setSettings`; `band` runs `setCollapsed`; `off`, `link` run the
  game handle's; `reset` clears the menu, then `game()?.reset()`; `field` runs `focusField`. Each
  action that needs a game handle does nothing without one.
- Re-focus (PR 2's signature rule) covers the new tabs unchanged: the window part of the signature
  adds `filter`, `pick:<field>`, `confirm:<action>:<id>` and `form` for the order form.
- The field: under the picture while `build.field` holds and the surface has an Input, keyed by
  its `key`, with its props; `ringOnInput` treats any field key as the field.
- The Link: under the picture while `build.link` holds, `Link key="link-url"`, on every surface.
- The probe: on a terminal while the renderer atom is `unknown`, the pane draws `probeElement`'s
  Image in its zero-width stops Box, so a docked pane with a collapsed band still settles the
  renderer. Whether the engine takes a blit to an Image in a clipped Box is untested; if Task 11's
  pass finds it refused, move the probe to the end of the picture's row Box (1 column) in a
  separate fix commit.
- Leaving a field: the focus hook applies Layout's "Leaving a field" rule.

**Acceptance check:** `mount.test.tsx` gains: a press on a `query` stop calls a stub `loadMarket`
path (through a stub game handle's `market.browse`) and clears `cursor.market`; `back` from a
`pick` `minRarity` lands on `{ kind: 'filter', at: 3 }`; `back` from `pick` `orderBase` keeps
`orders.form`; `back` on Orders with only the form open closes it; `buy` calls `client.buy` once
with the id; `reset` calls the handle's `reset`; a build with `link` draws `Link` keyed `link-url`
on terminal and desktop; a build with `field` `compose` draws an Input keyed `compose`; with the
renderer `unknown` on a terminal the pane draws the probe Image and a taken blit sets the renderer
to `image` (and the probe tests in `register.test.ts` and `band.test.ts` still pass); with the ring
on `compose`, a move onto `back` lands on `row:newest`, not on the oldest row; on Orders with only
the form open, a `ui.focus` onto `menu:3` writes `formAt: 3`. Red before: the actions do not exist.

**Boundaries:** No change to what any builder draws. The band draws exactly as before.

Execution note (2026-10-06): the hooks loader never follows `$` across an import, so
`probeElement(els, $, …)` cannot load. `ui/probe.tsx` holds what the callers share (the Image,
`PROBE_B`, the pending flag as `armProbe()`, the verdict as `probeVerdict(deny)`); the band and the
dialog each send the blit with `$` in their own module. The pane's probe test lives in
`register.test.ts` beside the band's, since only the plugin's own module may call `$.clock.after`.
A Link is an inline element: the drawn tree keeps no key on it, so tests find it by type.

- [x] `confirmBuy`, `placeOrder`; the new actions; Back; tests
- [x] The field and the Link; the focus hook; tests
- [x] The probe module; the band on it; the pane's probe; tests
- [x] Run the check, commit

### Task 9: The dialog wiring

**Files:**
- `plugins/promptfall/hooks/ui/dialog.tsx` (modify): every tab, and the no-view branch, draws
  `paneElement` of its builder; the field callbacks (`price` as today; `order-price` sets
  `maxPrice` then `placeOrder`; `compose` sets the draft and, unless `chat.busy` as read from the
atom at submit time (today's guard), runs `postChat`); the Chat tab still
  calls `running.chatSeen(clientNow)` on each draw; `TABS`, `pick`, `percent`, `oddsLine`,
  `RENDERER_NEXT` and the old bodies go.
- `plugins/promptfall/hooks/ui/market.tsx` (modify): `marketBody`, `withFilter`, `MarketActions`,
  `ListingSprite` go; `loadMarket` and `confirmBuy` stay.
- `plugins/promptfall/hooks/ui/orders.tsx` (modify): `ordersBody` and `OrdersActions` go.
- `plugins/promptfall/hooks/ui/chat.tsx` (modify): `chatBody` and `ChatActions` go; `CHAT_LINES`
  goes.
- `plugins/promptfall/hooks/ui/leaderboards.tsx` (modify): `boardsBody` goes.
- `plugins/promptfall/hooks/ui/sprites.tsx` (delete) and `DESKTOP_LIST_SPRITE_COLUMNS` in
  `stage/tuning.ts` (remove), once nothing imports them.
- `plugins/promptfall/hooks/ui/trade.ts` (modify): `PickFn` and `Els` go if nothing imports them.
- `plugins/promptfall/types/index.d.ts`, `plugins/promptfall/hooks/state.ts` (modify):
  `MarketState.confirm` goes.
- `plugins/promptfall/hooks/register.tsx` (modify): only if `MarketState.confirm` is named there.
- `plugins/promptfall/hooks/dialog.test.ts` (modify): replace the Market, Orders, Chat,
  Leaderboards, Account and list-sprite tests (from "the other tabs keep today's tab row" at line
  202, the Market tests at 421-461, 529-610, the Chat and Leaderboards tests at 610-805, the
  Account tests at 806-847, and the sprite and row-fit tests at 848-990) with the tests below; the
  Inventory, Heroes and sell tests stay, except the sell test at 484-500, which buys through
  `buy-L*` and `buy-confirm`: it buys through the listing's `row:` stop and `yes` instead.
- `plugins/promptfall/hooks/register.test.ts` (modify): the link tests press `row:link` and read
  `Enter … at` and `Linked as player` through `paneText`; the reset test presses `row:reset`, then
  `yes`.

**Interfaces:** Consumes Tasks 2 to 8.

**Work:** Wire as the Files list says. A tab's builder is picked by the tab; `remember` stores
every tab's build. Read every atom through its default, as today.

**Acceptance check:** the full check line, with the replaced tests, on terminal (raster) and
desktop: each tab draws its windows and no `Text` rows of the old bodies; Market: `tab-market`
loads the page (stub browse sees page 0), `row:filters`, then `menu:0` flips the kind and refetches
page 0, a listing row then `yes` buys once and the item arrives; a server switch drops a pending
buy Yes/No and the market page; a secondary still browses. Orders: `row:new`, a Base pick, typing a
price in `order-price` and submitting places a `NewOrder`; a listing row, `yes` cancels it. Chat:
the newest message shows, `compose` submit posts and the box empties, a refusal flashes red for
5 s, in an outage the post reads `Server unreachable`, the gates, a secondary posts; without an
Input (mobile) the read-only line and no field. Leaderboards: fetched on open, both boards, mine in
gold, closed said in place; `/promptfall chat` and `/promptfall leaderboards` open on those tabs.
Account: `row:sound` writes the store and merges with another session's settings; `row:link`
shows the code and the Link; `row:reset`, `yes` resets. The no-view pane on Account resets.
Odds: `row:expand-inventory` applies the expansion. Red before: the replaced tests fail on the
old Button keys.

**Boundaries:** No band change beyond Task 8's probe move. Nothing the builders draw changes here.

- [x] Dialog wiring, field callbacks, no-view pane; remove the old bodies and helpers
- [x] Replace the dialog and register tests; run the check, commit

### Task 10: Scenarios, goldens and the Svg budget

**Files:**
- `plugins/promptfall/hooks/stage/scenarios.ts` (modify): `PANE_SCENARIOS` gains `pane-market`
  (wide), `pane-market-filter` (filter window open), `pane-market-buy` (Yes/No),
  `pane-market-narrow` (60 × 24), `pane-orders`, `pane-orders-form` (form with a typed price),
  `pane-account`, `pane-account-link` (a code pending), `pane-odds`, `pane-chat`,
  `pane-leaderboards`, `pane-short` (Market at 120 × 14, no tab window), `pane-no-view`.
- `scripts/stage-goldens.ts` (modify), `plugins/promptfall/hooks/stage/goldens/index.ts` and the new
  `pane-*` files (generated).
- `plugins/promptfall/hooks/stage/golden.test.ts` (modify): the new goldens, and a second budget
  test: the fullest Market pane (wide, 120 × 24, ten listings with 30-character names and sprites,
  both page rows, the Base pick open) under `PANE_SVG_MAX_CHARS`.

**Interfaces:** Consumes Tasks 4 to 7.

**Work:** If the budget does not fit, stop and report `blocked: the Market pane Svg is <n>
characters` rather than changing the encoder.

**Acceptance check:** `pnpm stage:goldens` writes the files; `claude plugin test` passes every pane
golden (PR 2's unchanged) and both budgets; look at every new PNG. Red before: the scenarios do not
exist.

**Boundaries:** No strip golden changes; no PR 2 pane golden changes.

- [ ] Scenarios and fixtures
- [ ] Generate, look at every PNG; the budget test
- [ ] Run the check, commit `test(pane): the PR 3 scenarios, goldens and PNGs, the Market budget`

### Task 11: Docs, the driven pass, the pull request

**Files:**
- `docs/spec/promptfall.md` (modify): §10's Dialog paragraph (all eight tabs as windows; short
  panes drop the tab window), the Chat and Leaderboards paragraph (rows, the detail, the field not
  focused on open, paging back through the client's 200), the Market and Orders paragraph (the
  filter window, page rows, the buy and cancel Yes/No, the order form), the Account paragraph
  (Reset asks), and "the other six tabs keep their text rows" goes.
- `docs/adr/0005-interface-drawn-as-windows.md` (modify): a dated PR 3 note: fields and the Link
  under the picture; short panes drop the tab window; the pane probes.
- `docs/design/ui-remake/transcription.md` (modify): "Grafts, by name" gains your leaderboard rows
  in gold and the divider under list headings (grill 1.21).
- `CONTEXT.md` (modify): Filter window, Form window, Field (under the picture).
- `plugins/promptfall/README.md` (modify): each tab's keys; `f` for Market filters; Enter on a
  listing buys, on your listing or order cancels; the chat field is one Enter away;
  `FIELD_HELP`'s key.
- `docs/manual-pass/2026-10-06-ui-pr3.md` (create): the driven pass.
- `docs/plans/2026-10-06-ui-pr3-remaining-tabs.md` (modify): tick the boxes.

**Work:** Load `unslop` before writing. Back up Kevin's save first and restore it after, byte for
byte, as the PR 2 pass did; run against the HTTP fake on a seeded, linked account. Drive cmux
(image) and Terminal.app (raster) through: each tab opens with its windows; Market: Down to a
listing, Enter, `y` buys; `f`, flip the kind, pick a class, `q` back to the list; `Next page`;
Orders: the bought item listed from Inventory shows under My listings, Enter, `y` cancels it;
`New buy order`, a base, a price in the field, Enter places it; Account: `s` toggles sound, Reset
asks and `n` keeps the save; Odds: the table, an expansion with too little gold refused in the
message window; Chat: Enter goes to the field, a line posts, Tab or Escape (as `FIELD_HELP`
says) leaves it, Up pages back; Leaderboards: both boards, your row gold; an inline pane at
105 × 50 draws without the tab window and the tab hotkeys switch tabs; a docked pane with the band
collapsed settles on image without `/promptfall renderer image` (reset the setting to `auto` for
this step and restore it after). The desktop, standalone Ghostty and VS Code rows are Kevin's.
Then open the PR into `ai-staging` with the manual test rundown and which parts were verified
here.

**Acceptance check:** the full check line passes; the manual-pass doc has every step on cmux and
Terminal.app with its result; the PR is open.

**Boundaries:** No code change here except a fix the pass finds, committed separately with its
own test.

- [ ] Spec, ADR note, transcription grafts, glossary, plugin README
- [ ] Driven pass
- [ ] Ticks, PR

## Out of scope

Clicks inside pictures (grill 1.4). Chat history past the client's 200 messages. A filter for the
Orders lists. Any band change beyond moving the probe. Real sprite art (phase 4 PR 2). Lowering
the layout floors further for 80 × 24 inline panes.
