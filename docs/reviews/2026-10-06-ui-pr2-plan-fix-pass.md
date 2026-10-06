# UI PR 2 plan: review fix pass

Plan: `docs/plans/2026-10-06-ui-pr2-pane-windows.md`, reviewed at `346bc94`. One leg ran,
`reviewer` on Opus (Fable out of credits, Codex blocked until 2026-10-09 19:43). The leg returned 21
findings: 9 major, 12 minor. Each was checked against the code or the engine's d.ts before the fix.
The consolidation and fix ran inline on Opus. Two findings changed calls Kevin had approved; those
are recorded as review rulings in grill 1.20.

| # | Sev | Finding | Verified | Resolution |
|---|---|---|---|---|
| 1 | major | Renaming tab stops to `tab:<tab>` breaks Market, Chat and Account tests and `register.test.ts` | yes: `dialog.test.ts:386-461`, `register.test.ts:448-618`, outage test at :625 | Tab keys stay `tab-<tab>`; `register.test.ts` joins Task 9 with the outage test rewritten |
| 2 | major | A cursor stored as an id loses its index once the item is gone; refocusing a remembered key that no longer exists gets denied | yes: d.ts `$.ui.focus` and `autoFocus` (first take only) | `PaneCursor { id, index }`; after an action the next render focuses `PaneBuild.focus` once |
| 3 | major | The redirect direction breaks at the wrap; no rule for engine stops or for an empty ring | yes: `UiFocusInput.element` is absent for engine stops | Cyclic distance; `next(e)` with no element; keep the ring when there are no cursor stops; Task 1 asks about the wrap |
| 4 | major | On the PR 3 tabs, hidden tab Buttons join the ring with no rows to redirect to | yes (follows from the ring) | Review ruling: PR 3 tabs keep today's tab row until PR 3 |
| 5 | major | The focus hook can't compute `follow` or the ring order outside the render | yes | Lists page by cursor index (review ruling); the render caches its last build for the hook |
| 6 | major | The sell flow is split between `menu.kind 'sell'` and `dialog.sell`, which desync | yes: `sell.tsx:58`, `register.tsx` server switch | The sell window derives from `dialog.sell` alone with `sell.at`; unequip uses `keep`; every close clears `sell` |
| 7 | major | The PR 3 tabs lose today's header; the `!view` branch isn't planned | yes: `dialog.tsx:190-249` | Both unchanged (follows from #4) |
| 8 | major | Sub-window heights have no bound (the roster goes to 48) | yes: `expansions.ts:5` | Menus capped at `M − 3` and paged; floors raised to 9 (wide) and 10 (narrow) |
| 9 | major | The spike leaves `autoFocus`, `$.ui.focus` after a re-render, the redirect and the Shift+Tab wrap untested | yes | Task 1 questions 1(a)-(d) |
| 10 | minor | `listWindow` declares `rows` twice | yes | Second one renamed to `lines` |
| 11 | minor | `formatGold` writes a lowercase `g`; `formatRemaining` can't produce `3h 20m` | yes: `format.ts:14`, `time.ts:15-24` | Windows use `${formatCount(n)}G`; example fixed to `3h` |
| 12 | minor | The desktop Svg isn't capped or centred | yes: `stage/tuning.ts:47-52` | Svg `width`/`height` props inside a centring Box |
| 13 | minor | Nothing carries the "no hero can wear it" line | yes | `Equip` becomes a dim `none` item, with the line in the message window |
| 14 | minor | `Set a price` as `none` looks the same as a read-only row | yes | New `{ t: 'price' }` action; mount-level Buttons named |
| 15 | minor | `mount.tsx` must declare the atoms it uses | yes: `state.ts:10-15` | Stated in Global constraints and Task 8 |
| 16 | minor | The Svg source holds no text and Raster has no alt | yes: `windows/svg.ts` uses `<use>` | Tests decode Raster cells or read the Svg's `alt` |
| 17 | minor | A dialog atom written by older code lacks the new fields | yes | Read as `{ ...DIALOG_DEFAULT, ...dialog }` |
| 18 | minor | The spike has no desktop variant, imports across plugin roots, and names no desktop rung | yes | Desktop variant; self-contained pictures; the desktop takes (c) until its row says (a′) |
| 19 | minor | `under` depends on `priceInput`, a circular dependency; the Input's height is unknown | yes | `under` is computed from `sellState` before the build; Task 1 measures `PRICE_INPUT_ROWS` |
| 20 | minor | The transcription's grafts list should gain the new grafts | yes | Added to Task 11 |
| 21 | minor | Task 8 does too much; the invalid-price line is dropped; the close mark backs out first | yes | Split into Task 8 (mount) and Task 9 (wiring); invalid-price line kept; README note |
