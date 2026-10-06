# UI PR 3 plan: review fix pass

Plan: `docs/plans/2026-10-06-ui-pr3-remaining-tabs.md`, reviewed at `4ad4b42`. One leg ran,
`reviewer` on Opus. Kevin asked for no Fable, and Codex is blocked until 2026-10-09 19:43. The
leg returned 16 findings and three suggestions. Each finding was checked against the code before
the fix (the cited lines read; the focus and paging ones worked through `focusMove`, `withCursor`
and `page`). The fix ran inline on Opus. Findings 3, 4, 5 and 13 change what the player sees, so
they are recorded as review rulings in grill 1.21.

| # | Sev | Finding | Verified | Resolution |
|---|---|---|---|---|
| 1 | major | Task 8 changes `ActionContext`, `PaneDraw` and `confirmBuy`, but `dialog.tsx` builds and calls them and isn't in its Files | yes: `dialog.tsx:319-362`, `:405` | `dialog.tsx` joins Task 8's Files |
| 2 | major | The order form's ▶ has nowhere to live; `withCursor` drops the move, rung (c) can't reach `Place order` | yes: `types/index.d.ts:156`, `mount.tsx:291-299` | `DialogState.formAt`; `withCursor` and the signature know it; tests in Tasks 5 and 8 |
| 3 | major | Chat's top-anchored pages leave the newest page with 1 to 5 rows | yes: `frame.ts:145` | `fromEnd` paging for Chat; tests at 31 and 200 messages |
| 4 | major | Leaving a field redirects the ring onto the oldest chat message | yes: `mount.tsx:279-286` | Leaving a field lands on `build.focus`; test in Task 8 |
| 5 | major | Tabs with no cursor stop strand the ring; an empty Chat can't reach its field | yes: `mount.tsx:276` | Every list has a cursor stop: `row:empty` with `emptyAction` |
| 6 | major | Task 2's new `PaneMenu` members break two `'itemId' in menu` narrowings | yes: `dialog.tsx:303`, `inventory.ts:178` | Both named in Task 2 |
| 7 | major | Builders can't colour message lines; gate lines need `WARN_RGB` | yes: `input.ts:35,50` | `MessageLine = string \| Span[]` |
| 8 | major | Task 9 breaks a sell test that buys through `buy-L*` and `buy-confirm` | yes: `dialog.test.ts:484-500` | Added to Task 9's rewrite |
| 9 | minor | The fixtures' account id is `a1`, not `acct-1` | yes: `stage/fixtures.ts:68` | Fixtures use `a1` |
| 10 | major | The order form would show to read-only and gated players | yes: `orders.tsx:184-192` | The panel shows only when not read-only and not gated; test |
| 11 | minor | A double Enter in Chat posts twice without today's busy guard | yes: `dialog.tsx:384` | The `compose` submit keeps the guard |
| 12 | minor | Task 3's floor tests flip, `inventory.test.ts` reads `priceInput`, the paging example is off by two | yes: `frame.test.ts:49,53`, `inventory.test.ts:178` | Files and numbers corrected |
| 13 | minor | A narrow 14-row pane with a field drops under the floor | yes (arithmetic) | Stated in Layout as a known cost |
| 14 | minor | `orderSummary` can't serve both bodies: the wording differs | yes | Dropped; the form writes its own line |
| 15 | minor | Account settings must come from the store, not the atom | yes: `dialog.tsx:515` | Stated in Task 2 |
| 16 | minor | The spike's refused close confounds the Escape question | yes: `spikes/ui-remake/hooks/register.tsx:500-505` | Task 1 drops the refusal |
| s1 | — | Reset's Yes/No should open on No | yes: the ▶ clamps onto Reset when `Link GitHub` vanishes | Opens at 1 |
| s2 | — | `query` should set the menu before awaiting the fetch | yes | Stated in Shared contracts |
| s3 | — | `Renderer` has no `x`; `rowSpans` takes one name span | yes | `x` noted as not drawn; `rowSpans` takes a span list (Task 4) |

Noted, no change: the pane probe sits in a clipped Box, untested until Task 11 (Task 8 names the
fallback); read-only's message rule hides an open window's question, as in PR 2.
