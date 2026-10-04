# Promptfall phase 4 implementation plan: PR 1, the desktop stage

**Goal:** The desktop app draws the full stage, scaled to its band, grows it for bosses, passes the whole Part A manual pass against the HTTP fake, and the session ends with an evidence page of the stage on every surface.
**Architecture:** `layoutFor` learns the surface: terminals keep the 100/116 cell thresholds, every Svg surface always gets the full layout with the art `clamp(bodyColumns, 116, 160)` pixels wide (ADR 0004). The band's Svg is sized so the desktop scales it to the band's width, by whichever of two mechanisms a live check on the real app proves works; the boss heights are not checked against `maxRows` unless that check shows the desktop clips a taller band. Dialog rows drop their glyph where a sprite draws and fit the pane's `bodyColumns`. The desktop pass runs through `codex-computer-use` against the HTTP fake in a run-triage-rerun loop, settles `SVG_SMIL`, and feeds PR #6 and the evidence artifact.
**Spec:** `docs/spec/promptfall.md` (§2, §10; §10 amended by Task 5), `docs/adr/0004-desktop-stage-scales.md` (amends ADR 0003), `docs/adr/0003-band-grows-for-the-stage.md`, `CONTEXT.md` (Stage, Sprite), `docs/manual-pass/phase-4.md`, `HANDOFF.md` (the finding and the measured desktop facts), `docs/plans/2026-10-04-promptfall-phase-4.md` (PR 1's plan; its narrowings 7 and 21 bind here)
**Execution model:** opus
**Delivery:** Tasks 0 to 8 on `feat/phase-4`, PR #6 into `ai-staging`, after `b3a6f91`. Every code task is test-first: the test is shown red on the old code before the change. Each task's last commit is clean on the full check line: `pnpm lint && pnpm typecheck && pnpm test && pnpm vendor:check && pnpm sprites:check && pnpm exec tsc -p plugins/promptfall && claude plugin validate plugins/promptfall && claude plugin test plugins/promptfall` (205 plugin tests pass on `b3a6f91`). Task 1 commits a document only; Tasks 7 and 8 commit nothing of their own beyond the comment and artifact edits they describe. The three-leg review is Kevin's to trigger: the plan ends at Task 8, not at a review.

## Global constraints

- Kevin's decisions of 2026-10-04 (the grilling round that produced ADR 0004) are settled and not re-decided here: the desktop stops using cell thresholds and always draws the full stage with the art `clamp(bodyColumns, 116, 160)` px wide, scaled to the band's width; terminals keep 116/100 unchanged; the desktop ignores `maxRows` and grows to 8+2, 12+2, 17+2 rows unless the live check shows it clips or scrolls a taller band, in which case the boss stage scales to fit `maxRows` (that branch is taken only on the check's evidence and said in chat); no new bots; the pass and the evidence page run against the HTTP fake; dialog rows drop the glyph where a sprite draws; the "isn't a command here" line is a PR known issue, no code; everything lands on PR #6; the evidence page is a new Artifact and the last task; PR 2 is out of scope.
- Measured desktop facts (HANDOFF.md, Claude.app 2.19675.0, bundled Claude Code 2.1.286): `AbovePrompt` props `bodyColumns 95, maxRows 12` with the window 1440 × 823 points, `60 × 12` at 864 points; `mode 'primary'`, `prefs.collapsed false`. Hot reload does not reach a running desktop session: every code change needs a NEW desktop session. `launchctl setenv CLAUDE_CODE_PLUGIN_DIRS <repo>/plugins/promptfall` is set and Claude.app was relaunched under it; Task 6 unsets it at the end.
- Stage geometry (`plugins/promptfall/hooks/stage/tuning.ts`): `STAGE_REST_ROWS 8`, `STAGE_TURN_BOSS_ROWS 12`, `STAGE_BOSS_ROWS 17`, `STAGE_TEXT_ROWS 2`, `COMPACT_ROWS 4`, `COMPACT_STAGE_COLUMNS 52`, `FULL_MIN_COLUMNS 116`, `MIN_COLUMNS 100`, `STAGE_MAX_COLUMNS 160`, `SPRITE_PX 16`, `ACTOR_PITCH 18`, `ACTOR_EDGE 4`. Six actors with no overlap need `2 × (ACTOR_EDGE + 2 × ACTOR_PITCH + SPRITE_PX) = 112` px; at 95 px the sides overlap by 17 (ADR 0004). Tuning numbers live in `tuning.ts` and nowhere else; tests import them.
- Engine facts (`plugins/promptfall/.claude-plugin/types/claude-code/index.d.ts`): `RenderSurface = 'terminal' | 'desktop' | 'mobile' | 'vscode'` (9509); `SvgProps` (11385): `width`/`height` are CSS px, "absent, the box takes the markup's own width up to the slot", height absent is "the markup's own height at the drawn width", `isInteractive` runs SMIL in a sandboxed frame; `Pane` props: `bodyColumns` ("cells across the body, inside the frame"), `placement: 'dock' | 'inline'`; `BoxProps` has `width?: number | string`, `flexWrap`, `overflow`; `Raster` and `Image` are terminal-only; `Svg` exists on desktop, vscode and mobile. The desktop gets the same io as the terminal (`register.tsx:668-681`: `blit`, `invalidate`, `play`).
- Code facts: `ui/band.tsx:199-226` collapses on `prefs.collapsed || mode !== 'primary' || layout.kind === 'collapsed' || bodyColumns < MIN_COLUMNS || maxRows < REST_ROWS` (`REST_ROWS = 4`, band.tsx:28); the desktop path (`band.tsx:241-268`) renders `<Svg key="stage" width={box.columns * SVG_PX_PER_COLUMN} isInteractive={SVG_SMIL}>` with `SVG_PX_PER_COLUMN = 8` (band.tsx:105) and no height; `stage/svg.ts:178-181` emits `viewBox="0 0 W H" width=opts.width height=round(width × H / W)`; `stage/loop.ts:180-185` re-runs `layoutFor(rows, site.props)` each tick and tears the site down on a layout change; `loop.ts:187-191` is the `'svg'` site, the `SVG_SMIL = false` fallback. `ui/dialog.tsx` reads nothing from `e.props`; item rows (`:399`) and hero rows (`:534`) print `${glyph} ${name} …` beside `ListSprite`; market listing rows (`ui/market.tsx:196-210`) print no glyph. `ListSprite` (`ui/sprites.tsx`) answers an `Svg 16 × 16` off the terminal, an `Image 2 × 1` on `image`, an `8 × 2 Raster` on `raster` for items only, else `null`.
- Tests: `hooks/band.test.ts` `band(bodyColumns = 120, maxRows = 8)`; the only desktop test (`:544-552`) mounts `band(120, 20)`; `hooks/dialog.test.ts` `PANE` has `bodyColumns 100`, `placement 'inline'`; every test starts the session on `terminal` and mounts the desktop afterwards (kept).
- The HTTP fake: `pnpm fake --port 7777 --data <path> --player-name <name> [--boss-in <seconds>] [--speed <n>] [--bots <n>, default 12]` (`servers/fake/src/cli.ts:16-30`); the plugin switches with `/promptfall server http://127.0.0.1:7777` and back with `/promptfall server local`; trading and chat need the account linked: `/promptfall account`, `Link GitHub`, `Linked as <name>` within about 5 s on the fake (`docs/manual-pass/phase-2.md` step 5). Bots list, buy any listing (the player's included), place and fill buy orders, cancel and chat (`servers/fake/src/bots.ts`). The in-process fake stays bot-less.
- Only the primary session draws the stage; a `/promptfall …` command claims the lease for the session that typed it. One recorded or passed session at a time.
- Kevin's global rules: TypeScript, `any` only when nothing else compiles; the simpler solution; no completion claim without the command output in the same turn; a slice touching a rendered surface verifies live; bulk output (codex reports, frame inspection) goes to a `scout` and comes back as a summary; the codex quota is account-wide (`~/.claude/bin/codex-usage.sh` before each codex run; a limit hit is a hard stop for every GPT lane until the reset it reports).
- CONTEXT.md governs names: `Stage`, `Sprite` ("replaces the glyph where pixels draw; the glyph stays as its fallback"); no "scene", "icon", "image" for the sprite.
- Branch flow: `feat/phase-4`, PR #6 into `ai-staging`; nothing lands on `main`.

## Live check results

Task 1 fills this table from the real desktop app before any code changes; Tasks 2 and 4 branch on it. Until then every cell reads `unmeasured`.

Measured 2026-10-04 from the screenshots under `.promptfall/evidence/desktop-2026-10-04/live-check/` (the codex run hit the GPT usage limit after taking every capture and before writing its report; a `scout` measured the captures by eye, about ±2 pt; the main session checked `probe-w-1440.png` and `probe-r-1440.png` itself). Capture scale 2.

| Fact | 1440 × 823 points (95 × 12) | 864 × 823 points (60 × 12) |
| --- | --- | --- |
| Band body width; points per `bodyColumn` | 768 pt; 8.1 | 494 pt; 8.2 |
| Svg A (no `width`, interactive, markup 4000 × 500) | 752 × 94 pt, aspect kept, band width less 8 pt padding a side | 478 × 60 pt, aspect kept |
| Svg A′ (as A, image) | 752 × 94 pt, aspect kept | 478 × 60 pt, aspect kept |
| Svg B (`width={4000}`, interactive) | 752 × 94 pt: scaled to fit, not cut, no sideways scroll | 478 × 60 pt, scaled to fit |
| R probe (zone-boss geometry 116 × 34, markup `95 × 16` px wide) | drawn 512 × 149 pt, centred: the desktop caps an Svg at about 150 pt tall and keeps its aspect; `party`, `status` visible, `END` cut at the band's bottom, reachable by scrolling inside the band (no `n more` row, no scrollbar) | 478 × 140 pt (band width; under the cap); `END` reachable by scrolling |
| Rows r01 to r24 (information only) | r01 to r10 visible, r11 cut, the rest by scrolling: the band's visible area is capped at about 248 pt; text rows are 19 pt | same: 248 pt cap, 19 pt rows |
| Band `bodyColumns × maxRows` with the pane docked | `95 × 12` (the band shifts left, same width) | n/a |
| Docked pane readout; width; points per pane column | `[pane dock 33]`; 266 pt inside; 8.1 | n/a |
| Pane probe: `█` × 32 then `|` | wraps to a second row (`|` visible there): a `█` is about 13 pt, 1.6 columns, in the desktop's proportional font; the buttons wrap 3 + 3 | n/a |
| Party-line probe (27, 27, 27, 20 `█` runs in a wrapping row) | wraps: runs 1 and 2 on row 1, runs 3 and 4 on row 2 | wraps: one run per row |

**Correction from the pass (Task 6, run 1 and the session's own run 2):** the "about 150 pt" Svg cap was the interactive frame's default height (300 × 150), not a desktop rule: in a row Box the frame also kept its default 300 pt width. As an image (`SVG_INTERACTIVE = false`, chosen in Task 6) the boss stage draws at full aspect, about 752 × 220 pt at 95 columns, and the band scrolls its status row away. So the height branch is **R-fit** after all: `DESKTOP_ROW_PX = 19`, `DESKTOP_TEXT_ROWS = 3`, the boss stage scaled to `(maxRows − 3) × 19` points.

**Letters:** **S1** (Svg A scales to the band with its aspect kept at both widths). **R-grow, with the desktop's own cap**: the desktop caps an Svg at about 150 pt tall (the boss stage draws narrower than the band, aspect kept) and the band's visible area at about 248 pt with scrolling beyond; the full stage plus its text rows stays under 248 pt (rest 104 + 57, boss 150 + 57 at 95 columns), so the plugin adds no height handling and R-fit is not needed (deviation from the branch rule: the R probe's `END` was cut because the probe stacked a readout row, three buttons and three text rows under the Svg, about 280 pt, not because the real band overflows). **P-cells**: `bodyColumns` measures the pane and the band at 8.1 pt a column at both widths; text is proportional, so a clip by `bodyColumns` characters fits ordinary text and overruns only for wide glyphs such as `█` (Task 4 relies on wrapping, not on the clip alone); `DESKTOP_LIST_SPRITE_COLUMNS = 2` (16 px ÷ 8.1). **W-wrap**: the desktop wraps a `flexWrap="wrap"` row by segment.

**Branches decided by the table** (Task 1 writes the chosen letters under the table):
- Width: **S1** when Svg A (the `SVG_SMIL` path: interactive) draws at the band's width with its aspect kept (height = width ÷ 8 within 2 points) at both window widths; otherwise **S2**. Svg A′ is recorded for the `SVG_SMIL = false` fallback: if Task 6 flips `SVG_SMIL`, the S letter is re-decided from A′ and Task 2's sizing follows it in the same fix commit.
- Height: **R-grow** when the R probe's `END` row is visible with no `n more` row and no scrolling at both widths; otherwise **R-fit** (the ADR 0004 fallback; said in chat with the screenshot before Task 2 is written). The 24-row probe does not decide this.
- Pane: **P-cells** when the pane probe's `|` is visible on one line at the pane's right edge; otherwise `blocked: the desktop pane's bodyColumns does not measure its width (<readout>, <points>)` at Task 4. The points per pane column measured here set `DESKTOP_LIST_SPRITE_COLUMNS = ceil(16 / points per pane column)` for Task 4.
- Party line: **W-wrap** when the party-line probe's segments wrap to a second row; otherwise **W-rows** (Task 2b builds the rows itself).

## Task list

### Task 0: Commit the plan and ADR 0004

**Files:**
- `docs/plans/2026-10-04-promptfall-phase-4-desktop.md`, `docs/adr/0004-desktop-stage-scales.md` (add)

**Work:** Both documents are untracked after the grilling round and the review wave. Commit them together so the branch carries the ADR the later tasks and PR #6 cite.

**Acceptance check:** `git status --porcelain` empty after the commit. Red before: both files show as `??`.

- [x] Commit `docs(phase-4): the desktop plan and ADR 0004`

### Task 1: The live check on the real desktop

**Files:**
- `plugins/promptfall/hooks/ui/band.tsx` (modify, TEMPORARY, never committed): a readout tree on non-terminal surfaces
- `plugins/promptfall/hooks/ui/dialog.tsx` (modify, TEMPORARY, never committed): a readout line and a probe row at the top of the pane body
- `docs/plans/2026-10-04-promptfall-phase-4-desktop.md` (modify): the "Live check results" table and the branch letters
- `.promptfall/evidence/desktop-2026-10-04/live-check/` (create, git-ignored): the codex prompt, report and screenshots

**Interfaces:**
- Consumes: nothing.
- Produces: the filled table; the branch letters S1/S2, R-grow/R-fit, P-cells; the measured `points per bodyColumn` and `row height` Task 2 may need as tuning constants.

**Work:** A measurement, not a fix. In `band.tsx`, before the collapsed check and regardless of `mode`, when `e.surface !== 'terminal'` return a `Box flexDirection="column"` holding: a `Text` `[${e.props.bodyColumns}x${e.props.maxRows} ${e.surface}]`, a row of three `Button`s (`probe-w`, `probe-r`, `probe-rows`) that switch which probe shows (a module-level variable plus `$.ui.invalidate('ui.render')`, or `prefs.bandTab`: the implementer's choice), then the selected probe. **probe-w** (the default): **Svg A** `<Svg source={PROBE_SVG} alt="probe A" isInteractive />` with no `width`; **Svg A′** the same with `isInteractive={false}`; the party-line probe (see the table); **Svg B** last: the same source with `width={4000}` and `isInteractive`. **probe-r**: one `Svg` whose source is `renderSvg` of a zone-boss stage model at `{ columns: 116, rows: 17 }` with `opts.width = bodyColumns × 16` (or any SVG with `viewBox="0 0 116 34"` and that markup width), `isInteractive`, then two `Text` rows `party` and `status` and a `Text` `END`. **probe-rows**: 24 `Text` rows `r01` … `r24`. `PROBE_SVG` is exactly `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80 10" width="4000" height="500" shape-rendering="crispEdges"><rect width="80" height="10" fill="#6f8cff"/><rect x="0.5" y="0.5" width="79" height="9" fill="none" stroke="#000"/><line x1="0" y1="0" x2="80" y2="10" stroke="#fff"/></svg>` (aspect 8:1; the diagonal shows whether the aspect survives). In `dialog.tsx`, first in `body`: a `Text` `[pane ${e.props.placement} ${e.props.bodyColumns}]`; a `<Box width={e.props.bodyColumns}>` holding one `Text wrap="truncate"` of 200 `x` characters; a `<Box flexDirection="row" flexWrap="wrap" gap={1}>` of six `Button`s labelled `button-1` … `button-6`. Then run `codex-computer-use` (skill; `~/.claude/bin/codex-run.sh desktop-live-check exec -m gpt-6-astra -C "$PWD" --add-dir "$ARTIFACT_DIR" -s danger-full-access -o "$REPORT" "$(cat "$PROMPT")"`, Bash timeout 900000) with a prompt modelled on `.promptfall/evidence/desktop-2026-10-04/pass-prompt.md`: activate Claude, start a NEW session in the repo from the "+" beside the "promptfall" project group, send `/promptfall motion full`, capture the window for each of the three probes (click `probe-w`, `probe-r`, `probe-rows` in turn; `<repo>/.promptfall/tools/drv/winid.sh Claude ""` may pick a hidden window: use the on-screen Claude window about 1440 points wide, `screencapture -x -o -l <id>`), open `/promptfall` for the pane, capture again (the band's readout gives its `bodyColumns` while docked), resize the window to 864 points wide (System Events), capture both again, restore the size. Points from pixels: the capture's `sips -g pixelWidth` divided by the window's width in points (1440 or 864) is the scale (2 on this Mac); report every measurement in points. For each cell of the table the report gives the number or the word, with the screenshot path. No source edits by codex; the session may stay open. A `scout` reads the report and screenshots and answers the table; the main session checks the numbers the branches turn on (Svg A's width and height ratio; the R probe's `END`; the pane probe's `|`; the party-line wrap) against the screenshots itself before writing the letters.

**Acceptance check:** `git status --porcelain` shows only `docs/plans/2026-10-04-promptfall-phase-4-desktop.md` (Task 0 committed the ADR) after `git checkout -- plugins/promptfall/hooks/ui/band.tsx plugins/promptfall/hooks/ui/dialog.tsx`; the table has no `unmeasured` cell and four branch letters; `claude plugin test plugins/promptfall` green (205) on the restored tree. Red before: every cell `unmeasured`.

**Boundaries:** No permanent code change. No fix for anything the readout shows. If the codex run is BLOCKED (plugin not loaded, no band at all), check `launchctl getenv CLAUDE_CODE_PLUGIN_DIRS` prints the plugins path and that the session is new; a second BLOCKED stops the task with `blocked: desktop live check cannot run (<report line>)`. If Svg A and Svg B behave the same way and both scale, S1 still wins (it needs no measured constant). If the 1440 and 864 captures disagree on a branch, stop with `blocked: live check disagrees between widths (<cells>)` and put both screenshots in front of Kevin.

- [x] Temporary readouts in `band.tsx` and `dialog.tsx`; the prompt under `live-check/`; `~/.claude/bin/codex-usage.sh` under 90 %; the codex run (hit the GPT limit after the captures)
- [x] `scout` measured the captures; the branch-deciding captures checked by hand; the table and the letters written
- [x] `git checkout --` the two readout files; run the check; commit `docs(phase-4): desktop live check results`

### Task 2: The desktop always draws the full stage, scaled to the band

**Files:**
- `plugins/promptfall/hooks/stage/layout.ts` (modify): `layoutFor(rows, props, surface)`
- `plugins/promptfall/hooks/stage/layout.test.ts` (modify): the desktop cases; the terminal cases gain the third argument
- `plugins/promptfall/hooks/stage/loop.ts` (modify): `StageSite.surface`; the tick's `layoutFor` call passes it
- `plugins/promptfall/hooks/stage/loop.test.ts` (modify): fixtures gain `surface: 'terminal'`; one desktop `'svg'` site test
- `plugins/promptfall/hooks/stage/tuning.ts` (modify): the desktop sizing constants the branch needs
- `plugins/promptfall/hooks/ui/band.tsx` (modify): the collapse condition, both `layoutFor` calls, the Svg's sizing, the loop mount's `surface`
- `plugins/promptfall/hooks/band.test.ts` (modify): the desktop at `band(95, 12)` and `band(60, 12)`
- `plugins/promptfall/README.md` (modify): the "Stage" section's Renderers and "Compact and collapsed" bullets say the desktop rule

**Interfaces:**
- Consumes: the branch letters from Task 1.
- Produces:
  ```ts
  // stage/layout.ts
  export function layoutFor(
    rows: number,
    props: { bodyColumns: number; maxRows: number },
    surface: RenderSurface,            // import type { RenderSurface } from 'claude-code'
  ): Layout
  // stage/loop.ts
  export type StageSite = { …today; surface: RenderSurface }
  // stage/tuning.ts, by branch:
  export const DESKTOP_COLUMN_PX_CEILING = 16   // S1: above any measured points per bodyColumn
  export const DESKTOP_COLUMN_PX = <measured, one decimal>   // S2 or R-fit
  export const DESKTOP_ROW_PX = <measured row height, one decimal>   // R-fit only
  ```

**Work:** `layoutFor` with `surface === 'terminal'` is byte-for-byte today's rule. Any other surface answers `{ kind: 'full', box: { columns: Math.min(Math.max(props.bodyColumns, FULL_MIN_COLUMNS), STAGE_MAX_COLUMNS), rows }, bandRows: rows + STAGE_TEXT_ROWS }` and never `compact` or `collapsed` (ADR 0004: vscode and mobile draw an Svg too, so they take the desktop rule; narrowing 1). `sameLayout` is unchanged. The band's collapse condition drops `e.props.bodyColumns < MIN_COLUMNS || e.props.maxRows < REST_ROWS`: on a terminal both are already what `layoutFor` collapses on (`MIN_COLUMNS` is the compact floor and `REST_ROWS` equals `COMPACT_ROWS`; the Loot and World tabs go through `layoutFor(4, …)` and collapse in the same two cases), so terminals keep their behaviour and the desktop collapses only on `prefs.collapsed`, `mode !== 'primary'` or `hasSurvey` (handled at `band.tsx:170`); remove the two local constants (`band.tsx:27-28`) if nothing else uses them. Both `layoutFor` calls in the hook pass `e.surface`; the mount passes `surface: e.surface`; the loop's tick passes `site.surface`.

The Svg's size, by Task 1's letters:
- **S1**: no `width` prop. `renderSvg`'s `opts.width` is `Math.round(e.props.bodyColumns * DESKTOP_COLUMN_PX_CEILING)`, so the markup is always wider than the slot and the engine scales it to the band's width, height following. If Task 1 measured 16 or more points per column, raise the ceiling to the next multiple of 4 above the measurement and say so in the commit. `SVG_PX_PER_COLUMN` goes away.
- **S2**: `width={Math.round(e.props.bodyColumns * DESKTOP_COLUMN_PX)}` as both the prop and `opts.width`. `SVG_PX_PER_COLUMN` goes away.
- **R-grow**: no height handling.
- **R-fit** (implies S2-style explicit sizing): `cap = (e.props.maxRows - STAGE_TEXT_ROWS) * DESKTOP_ROW_PX`; natural height `h = width * (box.rows * 2) / box.columns`; when `h > cap`, `width = Math.floor(cap * box.columns / (box.rows * 2))` and pass `height={Math.round(cap)}` too; `opts.width` follows the final width. The rest stage (16 px tall) is never capped at 12 rows; the arithmetic for the boss stages is in the test.
The alt stays `model.alt`; `isInteractive={SVG_SMIL}` stays; the `'svg'` loop site stays the `SVG_SMIL === false` path. Internal structure is the implementer's. README bullets: Renderers gains "On the desktop the stage is always the full one, the art 116 to 160 pixels wide scaled to the band's width"; "Compact and collapsed" opens with "On terminals,".

Three existing tests loop over both surfaces and change on the desktop; split their expectations by surface, terminal assertions unchanged: "the band draws the party and the zone…" (`band.test.ts` ~:110: 4 rows at `band()` on terminal; on desktop 3 rows, the stage, the party line, the status row), "narrow terminals get one row" (~:130: terminal only, 1 row at `band(80)`; a desktop counterpart expects the full stage, 3 rows, at `band(80)`), "tabs and collapse write prefs" (~:142: the 4-row expectations become 3 on desktop for the Party tab; Loot and World stay 4 on both). With Task 2b the desktop party line may be two rows: count rows by the band's top-level children as the existing `rows(ui)` helper does and update the numbers after 2b in that task.

**Acceptance check:** `claude plugin test plugins/promptfall` green with: `layout.test.ts`: `layoutFor(8, { bodyColumns: 95, maxRows: 12 }, 'desktop')` equals `{ kind: 'full', box: { columns: 116, rows: 8 }, bandRows: 10 }`; `layoutFor(17, { bodyColumns: 60, maxRows: 12 }, 'desktop')` equals `{ kind: 'full', box: { columns: 116, rows: 17 }, bandRows: 19 }`; `layoutFor(8, { bodyColumns: 130, maxRows: 12 }, 'desktop').box.columns === 130`; `… 200 …` gives `160`; `'vscode'` behaves as `'desktop'`; the existing terminal cases pass with `'terminal'`. `band.test.ts`: on `desktop` at `band(95, 12)` an `Svg` is found whose `source` matches `/viewBox="0 0 116 16"/` and whose `alt` starts with `Zone 1`; at `band(60, 12)` the same; at `band(130, 12)` `/viewBox="0 0 130 16"/`; with a zone boss in view at `band(95, 12)` `/viewBox="0 0 116 34"/` and the party line's `⚔` text present (the band did not go compact: no hero rows, no `Raster`); S1: `props.width` undefined and the source's `width="` equals `95 * DESKTOP_COLUMN_PX_CEILING`; S2: `props.width === Math.round(95 * DESKTOP_COLUMN_PX)`; R-fit: with a zone boss at `band(95, 12)` `props.height === Math.round(10 * DESKTOP_ROW_PX)` and `props.width === Math.floor(10 * DESKTOP_ROW_PX * 116 / 34)`; on `terminal` the existing 99-column and 110-column cases are unchanged. `loop.test.ts`: an `'svg'` site with `surface: 'desktop'`, `props { bodyColumns: 95, maxRows: 12 }` and a zone boss already observed by the timeline (advance past `SPAWN_MS` before counting) is not torn down for a layout change: after the motions end, `clock.advance(1_000)` adds no invalidation and the site's mount generation is unchanged. `pnpm exec tsc -p plugins/promptfall` clean (every `layoutFor` caller and `StageSite` literal carries the surface). Red before: the `band(95, 12)` desktop test finds no `Svg` (the band is the collapsed line).

**Boundaries:** No change to the terminal thresholds or to `stage/model.ts`. No dialog change. No `SVG_SMIL` change (Task 6). If the measured points per column or row is missing from Task 1's table for the branch chosen, `blocked: Task 1 table lacks <cell>`.

- [x] `layout.test.ts` desktop cases red; `layoutFor` with the surface; green
- [x] `band.test.ts` desktop tests at 95 × 12 and 60 × 12 red; the collapse condition, the calls, the Svg sizing per branch, the tuning constants; `loop.ts` `surface` and its test; green
- [x] README bullets; run the check; commit `fix(stage): the desktop always draws the full stage, scaled to the band (ADR 0004)`

### Task 2b: The party line wraps on the Svg surfaces

**Files:**
- `plugins/promptfall/hooks/ui/parts.tsx` (modify): `PartyLine` on non-terminal surfaces
- `plugins/promptfall/hooks/ui/band.tsx` (modify): pass the surface to `PartyLine` if it does not have it
- `plugins/promptfall/hooks/stage/tuning.ts` (modify): `ENEMY_SEGMENT_MIN` if a constant is needed
- `plugins/promptfall/hooks/band.test.ts` (modify): desktop party line at 95 and 60 columns; the row counts from Task 2

**Interfaces:**
- Consumes: Task 1's W letter; Task 2's desktop full layout.
- Produces: nothing new outside `parts.tsx`.

**Work:** Review finding M4 and Kevin's goal ("everything that works under the terminals should work perfectly, with proper adaptations, on the desktop"; decided by default in the fix pass and reported to Kevin): at 95 columns `PartyLine` leaves 5 columns for the enemy, so a boss shows `⚔ 1,…` with no name and no bar, and at 60 the hero segments truncate. On terminals nothing changes. On every other surface the party line is built from whole segments (three 27-column hero segments and the enemy or boss segment at the width it needs, at least `ENEMY_SEGMENT_MIN = 20`) and a segment that does not fit on the current row starts the next one. **W-wrap**: a `Box flexDirection="row" flexWrap="wrap"` of fixed-width segment Texts. **W-rows**: compute the rows in `parts.tsx` (greedy fill by `bodyColumns`) and return a column of row Boxes. The boss segment keeps its name and its 6-cell bar whenever it has a row of its own. The band's height on the desktop grows by the extra rows; ADR 0004's "grows whatever `maxRows` says" covers it.

**Acceptance check:** `claude plugin test plugins/promptfall` green with, in `band.test.ts` on `desktop`: at `band(95, 12)` with a zone boss engaged, a `Text` matches `/⚔ .+ [█░]{6}/` (or the bar's actual glyphs, read from `parts.tsx`) and the three hero names are present untruncated; at `band(60, 12)` the three hero names are present untruncated; on `terminal` the existing party-line tests pass unchanged. Red before: at `band(95, 12)` on desktop no `Text` holds the boss name.

**Boundaries:** No terminal change. No change to the segment contents, only to their placement.

- [x] The desktop party-line tests red; the wrap; the row counts in the Task 2 tests; green
- [x] Run the check; commit `fix(band): the party line wraps on the desktop`

### Task 3: Dialog rows drop the glyph where a sprite draws

**Files:**
- `plugins/promptfall/hooks/ui/dialog.tsx` (modify): the item row (`:399`) and the hero row (`:534`)
- `plugins/promptfall/hooks/dialog.test.ts` (modify): the glyph rule on both surfaces and three renderers

**Interfaces:**
- Consumes: `ListSprite` as it is (`null` where no sprite draws).
- Produces: nothing new.

**Work:** CONTEXT.md: a sprite "replaces the glyph where pixels draw; the glyph stays as its fallback". Compute the row's sprite once (`const sprite = ListSprite(…)`), draw it, and lead the text with `${glyph} ` only when `sprite === null`. That alone keeps PR 1's narrowing 7 (heroes on `raster` have no sprite, so their glyph stays) and the probe-pending case (`renderer 'unknown'` on a terminal: no sprite yet, glyph shown). Market listing rows already print no glyph: nothing to do there (narrowing 3).

**Acceptance check:** `claude plugin test plugins/promptfall` green with, in `dialog.test.ts`: on `desktop` an Inventory row's first `Text` matches `/^Iron Sword \(/` and no `Text` matches `/^\/ Iron Sword/`; the same on `terminal` with `RENDERER('image')`; on `terminal` with `RENDERER('raster')` the item row has no glyph and the Heroes row keeps it (the existing test at `:792` still passes); on `terminal` with the renderer atom `'unknown'` the item row text starts with the glyph. `pnpm exec tsc -p plugins/promptfall` clean. Red before: on `desktop` a `Text` matching `/^\/ Iron Sword/` exists.

**Boundaries:** No change to `ListSprite`, to `market.tsx`, or to the Loot tab, toasts or chat (PR 1 out of scope: sprites there). No width handling (Task 4).

- [x] The four glyph tests red; the item and hero rows; green
- [x] Run the check; commit `fix(dialog): rows drop the glyph where a sprite draws`

### Task 4: Dialog rows fit the pane's columns

**Files:**
- `plugins/promptfall/hooks/ui/sprites.tsx` (modify): `listSpriteColumns`
- `plugins/promptfall/hooks/stage/tuning.ts` (modify): `DESKTOP_LIST_SPRITE_COLUMNS` from Task 1
- `plugins/promptfall/hooks/ui/dialog.tsx` (modify): the pane width; Inventory and Heroes rows
- `plugins/promptfall/hooks/ui/market.tsx` (modify): `marketBody` takes the row width; listing rows fit it
- `plugins/promptfall/hooks/dialog.test.ts` (modify): rows at a 40-column pane

**Interfaces:**
- Consumes: Task 3's rows; Task 1's `P-cells`.
- Produces:
  ```ts
  // ui/sprites.tsx: the cells a ListSprite takes in the row, 0 where it draws nothing
  export function listSpriteColumns(renderer: Renderer, surface: RenderSurface, sprite: Sprite): number
  // 0 where no sprite draws; 2 for an Image; 8 for a Raster; DESKTOP_LIST_SPRITE_COLUMNS off the terminal
  // ui/market.tsx: the listing rows get a descriptor per listing instead of a bare element
  type ListingSprite = { element: JSX.Element | null; columns: number }
  ```

**Work:** The evidence (`.promptfall/evidence/desktop-2026-10-04/12-dialog.png`): in the docked desktop pane the name row's affix text and the buttons row run off the right edge. The dialog never reads `bodyColumns`; it does now: `const width = Math.max(20, e.props.bodyColumns)` (the band's own pattern, `band.tsx:196`). For each sprite-led row (Inventory items, Heroes, Market listings) `rowWidth = width − (cols > 0 ? cols + 1 : 0)` where `cols = listSpriteColumns(…)` (the `gap={1}` after the sprite). The name text is `clip(text, rowWidth)` (`ui/format.ts:19`). The secondary text (item affixes, hero traits plus the `[party]` marker, a listing's affixes) stays on the name row when `name.length + 1 + secondary.length <= rowWidth`, otherwise it moves to its own row under the name: a `Box paddingLeft={2}` holding the Text, clipped to `rowWidth − 2` (`TextProps` has no padding); a secondary row is omitted when empty. The Heroes row today is one row (sprite, name, traits, marker, then `sell`, `party`, `dismiss`; `dialog.tsx:523-570`): it becomes a name row and an actions row like the item rows. The actions rows (`equip`, `vendor`, `sell`, `reforge`; a hero's `sell`, `party`, `dismiss`; a listing's `buy`) get `flexWrap="wrap"` so buttons that do not fit wrap instead of clipping; on terminals they already fit, so nothing changes there. `marketBody` gains a `width: number` parameter after `readOnly`, and its sprite callback (`market.tsx:81-90`) returns a `ListingSprite` (`dialog.tsx:317-325` builds it with `listSpriteColumns`), so a Raster item listing reserves 8 columns and a Raster hero listing none; the Orders, Chat and Leaderboards tabs are untouched (narrowing 4; the pass loop catches them if they clip). Internal structure (a shared `fitRow` helper or three inline computations) is the implementer's.

**Acceptance check:** `claude plugin test plugins/promptfall` green with, in `dialog.test.ts`, a `NARROW` pane (`PANE` with `bodyColumns: 40`, `placement: 'dock'`) and a seeded inventory holding one item whose name plus affixes exceeds 37 characters: on `desktop` (with `DESKTOP_LIST_SPRITE_COLUMNS` = 2 for the arithmetic; use the constant) every horizontal Box under the `item-<id>` Box that holds Text has the sum of its Texts' lengths plus one per gap at most `40 − (DESKTOP_LIST_SPRITE_COLUMNS + 1)`, the affixed item has a `Box` with `paddingLeft` 2 holding its affixes under its name, and the `item-actions-<id>` Box has `flexWrap === 'wrap'`; on `terminal` with `RENDERER('raster')` every `Text` in the row has `text.length <= 31` (8 sprite cells + 1); a Heroes row and a Market listing row obey the same bound at 40 columns; at `PANE` (100 columns) the existing tests still pass unchanged. Red before: a `Text` in the item row longer than 37 characters on `desktop` at 40 columns.

**Boundaries:** No change to what a row says, only to how it fits. No Box `width` in cells on the desktop beyond the probe result (`P-cells` only says `bodyColumns` is truthful; the fit is done in text, not in Box widths). Not `P-cells` from Task 1: stop with `blocked: the desktop pane's bodyColumns does not measure its width (<readout>, <points>)`.

- [x] `listSpriteColumns` with a unit assertion for the three answers; the narrow-pane tests red
- [x] The width, the three rows, `marketBody`'s parameter; green
- [x] Run the check; commit `fix(dialog): rows fit the pane's columns`

### Task 5: Docs: spec §10, the manual pass's Desktop section, README

**Files:**
- `docs/spec/promptfall.md` (modify): §10, the Party tab paragraph (`:388-399`)
- `docs/manual-pass/phase-4.md` (modify): replace "### Desktop app" (steps 15 and 16) with the Desktop section below; the preamble's "The band needs room" sentence gains "on terminals"
- `README.md` (root, modify): the phase 4 status line names the desktop stage as scaled; the SMIL mention stays until Task 6 settles it
- `docs/plans/2026-10-04-promptfall-phase-4.md` (modify): a line at the end of "Spec conflicts and narrowings" pointing to this plan for the desktop

**Interfaces:**
- Consumes: Tasks 2 to 4 (and 2b) as landed; Task 1's R letter.
- Produces: the Desktop section Task 6 runs.

**Work:** Spec §10: "Kitty and Ghostty draw it as an Image, every other terminal as a half-block Raster, desktop, VS Code and mobile as an Svg, one geometry for all. Compact 4-row stage … One line when … Hidden while `hasSurvey`." becomes: the same renderer sentence ending "an Svg: one art geometry for all, in cells on terminals and scaled on the Svg surfaces (ADR 0004)."; then "On terminals: compact 4-row stage (…) when `maxRows` is under what the full stage needs or `bodyColumns` is 100 to 115; one line when `bodyColumns` is under 100 or `maxRows` is under 4."; then "On the Svg surfaces: always the full stage, the art `clamp(bodyColumns, 116, 160)` pixels wide scaled to the band's width, growing to the boss heights whatever `maxRows` says" (R-fit: "…, scaled down to fit `maxRows` where the surface clips a taller band"); "the band collapses only by hand, as a secondary, or while `hasSurvey`." Keep the rest of the paragraph.

The Desktop section of the manual pass, each step with what to type and what to see, numbered on from 14:

15. **Start.** `pnpm fake --port 7777 --data .promptfall/fake-desktop.json --player-name <you> --boss-in 300` in a terminal. In Claude.app a NEW Code session in the repo (the "+" beside the "promptfall" project group). `/promptfall server http://127.0.0.1:7777`: the reply names the server. `/promptfall account`, `Link GitHub`: `Linked as <you>` within about 5 s. Known: the composer prints "/promptfall isn't a command here." under each `/promptfall` command although the command ran (the reply shows); the desktop's command list does not know plugin commands.
16. **The stage at rest.** The band is the full stage as wide as the band (an SVG: heroes on the right on the ground strip), then the party line, then the status row. Narrow the window to about 860 points: still the full stage, smaller; never the compact or one-row band. The party line's segments wrap: no hero name is cut, and an enemy segment that does not fit starts a second row.
17. **A fight.** Enemies fade in at the left; on each round attackers lunge, the hit actor flashes white, a number rises; a dead enemy fades away and its drop pops out. At rest the sprites bob (SMIL; with `SVG_SMIL = false` there is no bob at rest and the motions redraw about 6 times a second instead). Click `loot` then `party`, and press the collapse control twice, while a motion runs: the motion does not jump back to its start.
18. **Turn boss.** Prompt the session "Run the Bash command true 10 times as separate tool calls" (approve them) and let the turn end: once the field is empty a turn boss arrives (a turn of 10+ tool calls is the only trigger; a wipe cancels it): the stage grows (its art is 24 px tall, the boss stands above the heroes) and shrinks back after its dissolve and drop.
19. **World boss.** Sound is on from step 21's setup (run step 21's first two actions before this step: the boss cue fires only when the boss appears). About 300 s after the fake started the world boss toast shows and `boss.wav` is logged; the stage grows to the 34 px art, and the boss segment, on its own row of the party line, shows the boss name and a 6-cell bar. (A zone boss at wave 11 shows the same height.) R-fit only: the boss stage is scaled so the band stays within 12 rows.
20. **Motion.** `/promptfall motion still`: the bob stops; hits, flashes and fades still play. `/promptfall motion full` brings it back (with `SVG_SMIL = false`: no bob in either mode; check only that hits and fades still play under `still`).
21. **Sound.** `/promptfall sound on`; `.promptfall/tools/drv/afplay_watch.sh <log>` in a terminal logs `drop.wav`, `level_up.wav`, `boss.wav` as their toasts show. `/promptfall sound off`.
22. **Tabs and hotkeys.** Click the band, then `l`, `w`, `p`: Loot and World keep four rows and draw no stage; `c` collapses to one line and back.
23. **Off.** `/promptfall off` hides the band; with sound on a Rare drop still plays. `/promptfall on`.
24. **Toasts.** A Rare or better drop, a level up and the world boss each toast.
25. **Inventory.** `/promptfall` opens the docked pane. Each row leads with its 16 px sprite and no glyph; the name row and the buttons fit the pane's width (long affixes drop to their own line, buttons wrap, nothing is cut at the right edge). `equip`, `vendor` and `reforge` work.
26. **Heroes.** Rows lead with the class sprite, no glyph, and fit the pane. `sell` opens the sell form.
27. **Market.** Listings from the bots lead with the item's or the class's sprite. Buy one (`buy`, then confirm): gold drops, the item shows in Inventory, a toast. List an item (`sell` in Inventory, a price): it shows in Market and Orders; a bot may buy it within a few minutes (a toast and gold).
28. **Orders.** Place a buy order from the form; it shows under Orders; cancel it (the escrow returns); cancel the listing from step 27.
29. **Chat.** Post a line: it shows in the tail beside the bots' lines.
30. **Account, Odds, Leaderboards.** Account shows the server URL and the linked name (its Renderer row is the terminal probe's; record what it reads). Odds and Leaderboards draw their tables.
31. **Finish.** `/promptfall server local`.

n/a lines under the section: "n/a: the renderer probe, the Account tab's `Renderer: auto (…)` and `/promptfall renderer image|raster` are terminal-only (the desktop has one renderer, the Svg)"; "n/a: compact and one-row widths: the desktop never uses the cell thresholds (ADR 0004)".

**Acceptance check:** the full check line clean (docs only, so unchanged from Task 4's head); `tr '\n' ' ' < docs/spec/promptfall.md | tr -s ' ' | grep -c "one art geometry for all"` prints 1 and the same pipe with `grep -c "one geometry for all"` prints 0 (the old phrase is split across a line break, so a plain grep cannot go red); `grep -c "^[0-9]*\. \*\*" docs/manual-pass/phase-4.md` counts 31 steps. Red before: the spec still says the shared thresholds; the manual pass has steps 15 and 16 only.

**Boundaries:** No change to ADR 0004 (its facts hold against Tasks 1 to 4; if Task 1's R-fit was taken, the ADR already names it as the fallback and needs no edit). No code.

- [x] Spec §10; the Desktop section; README line; the PR 1 plan pointer
- [x] Run the check; commit `docs(phase-4): the desktop stage in the spec, the manual pass and the README`

### Task 6: The desktop pass loop, the SMIL row, `SVG_SMIL`

**Files:**
- `.promptfall/evidence/desktop-2026-10-04/pass-run<N>/` (create, git-ignored): prompt, report, screenshots, frames, GIFs per run
- `.promptfall/evidence/desktop-2026-10-04/media/` (create, git-ignored): `desktop-fight.gif`, `desktop-boss.gif` for Task 8
- `docs/plans/2026-10-04-phase-4-spikes.md` (modify): the Desktop app row (`SMIL moves`, `Redraw restarts`) and the result note
- `plugins/promptfall/hooks/stage/tuning.ts` (modify only if the row says `no`): `SVG_SMIL = false` with the comment updated
- `README.md`, `plugins/promptfall/README.md` (modify only if `SVG_SMIL` flips): "with SMIL" wording
- `docs/manual-pass/phase-4.md` (modify): "Known:" lines for reds classed as engine or desktop limits
- any plugin file a red needs, each with its test (see the loop)

**Interfaces:**
- Consumes: Task 5's Desktop section; the HTTP fake; `codex-computer-use`.
- Produces: the pass table for Task 7; the desktop media for Task 8; `SVG_SMIL` settled.

**Work:** The loop has four moves and a cap.
1. **Run.** Preconditions: tree clean on the Task 5 commit; `launchctl getenv CLAUDE_CODE_PLUGIN_DIRS` prints the plugins path; `~/.claude/bin/codex-usage.sh` under 90 %. The main session starts the fake (step 15's command, as a background task) immediately before the codex run, so `--boss-in 300` counts from the run's start; the prompt says the fake is running and skips its start line. The prompt (`pass-run1/prompt.md`, modelled on `pass-prompt.md`) carries steps 15 to 31 verbatim with their expected observations, the setup facts, the window-capture recipe, "a NEW session", "no source edits", and asks for the report to be appended step by step as each step finishes (a run cut short by the timeout still counts for the steps it reported), and for: PASS / FAIL / NOT SEEN per step with one line and evidence paths; for steps 17 to 19 a 7 fps burst of about 25 s each (`screencapture -x -o -l <id> frames/f%03d.png` with `sleep 0.14`), frame inspection for bob, lunge, flash, numbers, fade, growth; the redraw test of step 17 with frames; and two GIFs under 15 MB from the stage region, `media/desktop-fight.gif` (rest and a fight) and `media/desktop-boss.gif` (the world boss arriving), `ffmpeg -framerate 7 -i frames/f%03d.png -vf "crop=W:H:X:Y,scale=iw/2:-1:flags=neighbor,split[a][b];[a]palettegen[p];[b][p]paletteuse"`. Run through `~/.claude/bin/codex-run.sh desktop-pass-run1 exec -m gpt-6-astra -C "$PWD" --add-dir "$ARTIFACT_DIR" -s danger-full-access -o "$REPORT" "$(cat "$PROMPT")"` with a 1500000 ms Bash timeout. A nonzero exit or an empty report is a failed run, not a result. A `scout` reads the report and frames and answers a step table; the main session looks at the screenshot of every FAIL itself.
2. **Triage.** Each FAIL or NOT SEEN is one of: (a) a plugin bug: write the test that fails on the current code, fix, run the check, commit `fix(<area>): <what>` (one commit per bug); (b) an engine or desktop limit (the plugin's tree is right, the surface draws it wrong): a "Known:" line in the manual pass step and a known-issue line for Task 7, no code; (c) a driver problem or a timing miss (the boss had not arrived, a click missed): no change, re-run the step. A red whose class is unclear after reading its evidence is (a) only if a failing test can be written; otherwise it is reported, not guessed.
3. **Re-run.** Every re-run first repeats the setup in its NEW desktop session: `/promptfall server http://127.0.0.1:7777` (step 31 of the previous run switched to local), which also claims the lease, the account link check, `/promptfall sound on` and the watcher when a boss or sound step is in the run, and the fake restarted with a fresh `--boss-in` when a boss step is in the run. Then only the steps that were red and the steps that depend on them (a fix to the stage re-runs 16 to 19; a dialog fix re-runs 25 to 28), in a NEW desktop session, with a fresh `--boss-in` if a boss step is among them. Same prompt shape, `pass-run2/`, `pass-run3/`.
4. **Cap.** Three codex runs in total for this task. Whatever is still red after run 3 goes to Kevin with its evidence as an open item, in chat and in Task 7's comment; it is not fixed blind and does not block Task 7.

If `SVG_SMIL` flips to `false`, the S letter is re-decided from Task 1's Svg A′ cell (Task 2's sizing changed in the same fix commit if it differs), and the re-run prompt carries steps 17 and 20 with their `SVG_SMIL = false` wording. If `Redraw restarts` is `yes` with `SVG_SMIL` true, it is a red of its own: class (a) only if a test can show the plugin changes the Svg source on a redraw that has no new motion; otherwise it goes to Kevin with its frames as an open item.

SMIL from run 1's rest frames: `SMIL moves` is `yes` when consecutive rest frames show the sprites shift vertically at about 2 Hz with no redraw (no change in the party line between the frames); `Redraw restarts` is `yes` when the step 17 redraw frames show a running motion jump to its start on the redraw frame. Fill the Desktop app row of the spikes table and add a "Result, desktop" line under "Result, applied in Task 6". `SVG_SMIL` stays `true` on `yes`; on `no` it becomes `false` (the `'svg'` loop site takes over: redraws at `SVG_FALLBACK_FRAME_MS` while a motion is live, no bob; PR 1 narrowing 21), the two READMEs drop "with SMIL", `media/desktop-fight.gif` is re-recorded in the next run, and the commit is `fix(stage): SVG_SMIL off, the desktop Svg does not run SMIL`. When the pass is done: `/promptfall server local` in the desktop session, `launchctl unsetenv CLAUDE_CODE_PLUGIN_DIRS`, quit and reopen Claude.app, `pkill -f nudge.js; pkill caffeinate` if either survives from the previous session. The fake keeps running for Task 8.

**Acceptance check:** `pass-run1/report.md` exists and is non-empty with a line per step 15 to 31; every red is classed (a), (b) or (c) in the step table kept in `.promptfall/evidence/desktop-2026-10-04/pass-table.md` with its commit, known line or re-run result; the spikes doc's Desktop app row has no empty cell; `media/desktop-fight.gif` and `media/desktop-boss.gif` exist and `stat -f %z` shows each under 15,000,000; the full check line clean on the task's last commit; `launchctl getenv CLAUDE_CODE_PLUGIN_DIRS` prints nothing. Red before: no run, the spikes row empty, no media.

**Boundaries:** No fix without a failing test. No second cap. No change to terminal behaviour unless a desktop fix's test also covers the terminal case it touches. A codex limit hit stops every GPT lane until the reset it reports: finish the triage of what is in hand, record the reset time in chat, and continue with Task 7 on the runs that happened.

- [x] Preconditions; `pass-run1/prompt.md`; run 1; `scout` summary; the step table
- [x] Triage; fixes with tests and commits; "Known:" lines; the spikes row and `SVG_SMIL`; commit `docs(phase-4): desktop spike row and pass results` (with the `fix(stage)` commit first if SMIL is off)
- [ ] Re-runs up to the cap; the table final; media checked under 15 MB; `/promptfall server local`; unset the env; relaunch Claude.app; run the check on the last commit

### Task 7: PR #6: body and the results comment

**Files:**
- none in the tree; `gh` edits PR #6's body and posts one comment

**Interfaces:**
- Consumes: Task 6's step table and known issues; Task 1's table; Tasks 2 to 5's commits.
- Produces: the PR text and the comment id Task 8 appends to.

**Work:** First `git branch --show-current` is `feat/phase-4`, `git push`, and `gh pr view 6 --json headRefOid -q .headRefOid` equals `git rev-parse HEAD` (the commit the check line and the pass ran on). Then `gh pr view 6 --json body -q .body > <scratch>/pr-body.md`; edit: under "What's in it" a **Desktop** paragraph (ADR 0004: the full stage always, scaled to the band, the boss heights; S/R letters; glyphs dropped where a sprite draws; rows fit the pane; `SVG_SMIL` result); "Verified here" gains the desktop pass run through `codex-computer-use` against the HTTP fake and the live check; "Manual pass" item 8 reads the new section; a **Known issues** list: "/promptfall isn't a command here." under each command on the desktop (the desktop's command list does not know plugin commands; the command runs), Terminal.app's grey Raster cells, the party line's short enemy segment at 95 columns (narrowing 8), plus every (b) line from Task 6. Keep the body's closing lines and add the session link the system reminder asks for. `gh pr edit 6 --body-file <scratch>/pr-body.md`. Then `gh pr comment 6 --body-file <scratch>/desktop-results.md`: a heading "Manual pass, part A: the desktop app (2026-10-04)", the live-check table in short, the step table (step, result, one line, evidence file), "Fixed along the way" with commits and their tests, "Known, not fixed here", "Open after the cap" if any. Then stop: the review is Kevin's.

**Acceptance check:** `gh pr view 6 --json body -q .body | grep -c "Desktop"` is at least 2; `gh api repos/kevinshibuya/promptfall/issues/6/comments --jq '.[].id'` lists a new id after `5978204863` whose body starts with the heading; record that id for Task 8. the PR's head SHA equals the local `HEAD`. Red before: the body says nothing of the desktop pass and the last comment reads "Not run: the desktop app".

**Boundaries:** No merge, no review trigger, no label changes.

- [ ] Body edit; the results comment; the comment id noted in chat

### Task 8: The evidence page

**Files:**
- `.promptfall/tools/drv/rec.sh` (create, git-ignored): `rec.sh <cgwindowid> <dir> <seconds>`: a 7 fps `screencapture -x -o -l` burst into `<dir>/f%03d.png`
- `.promptfall/tools/drv/gif.sh` (create, git-ignored): `gif.sh <dir> <crop W:H:X:Y> <out>`: the palette GIF at half scale with `flags=neighbor`; prints the byte size; writes `<out>.mp4` instead (`-c:v libx264 -pix_fmt yuv420p -crf 23`, crop and `scale=iw/2:-2`) when the GIF exceeds 15,000,000 bytes
- `.promptfall/evidence/desktop-2026-10-04/media/` (git-ignored): `ghostty.gif`, `iterm2.gif`, `tmux-ghostty.gif`, `terminal-app.gif`, `cmux.gif`, `ghostty-boss.gif`, plus Task 6's `desktop-fight.gif` and `desktop-boss.gif`
- `<scratchpad>/evidence-page/index.html` (create): the artifact page

**Interfaces:**
- Consumes: the HTTP fake; the drivers in `.promptfall/tools/drv` (`gh_new.sh <font-size> <command>` prints a Ghostty terminal id, `gh_in.sh <id> <text>`, `winid.sh <owner> <title-substring>`, `it_in.sh <window-id> <text>`, `shot.sh`); the Artifact tool.
- Produces: the artifact URL, appended to Task 7's comment.

**Work:** Recording, one surface at a time, each in a new Claude Code session on the HTTP fake so the stage is live: restart the fake with `--boss-in 75` (same `--data`), open the surface at 130 columns or more at a 13 pt font (Ghostty: `gh_new.sh 13 "cd <repo> && claude --plugin-dir plugins/promptfall"`; iTerm2: `osascript -e 'tell application "iTerm" to create window with default profile'` then `it_in.sh`; tmux in Ghostty: a Ghostty surface running `tmux new -s rec` and `claude` inside; Terminal.app: `osascript -e 'tell application "Terminal" to do script "cd <repo> && claude --plugin-dir plugins/promptfall"'`; cmux: `cmux workspace create` and `cmux send`), `/promptfall server http://127.0.0.1:7777` in it (claims the lease), wait for the probe to land, then `rec.sh <id> <dir> 25` started about 55 s after the fake started, so the clip holds the bob, a round or two and the world boss arriving; a still of the window first to read the crop rectangle of the band (in capture pixels). `ghostty-boss.gif` is the boss stretch of the Ghostty clip cut separately; the other surfaces get one clip each (narrowing 6). Close each session with `/exit` before the next. Every file under 15,000,000 bytes (`stat -f %z`), else the mp4 fallback.

The page: `Artifact` `action: "quickstart"` with `intent: "other"` first; then the `artifact-design` guidance it returns (or the skill) and the `artifact-capabilities` skill for the `assets` capability; read the directions page once more with `action: "read"` for the facts header it uses (cell 8 × 17 px, band 120 columns, 16 × 16 and up to 48 × 34 sprites) so the two pages share their vocabulary. Write `index.html`: a title of two to four words (`Promptfall Stage Evidence`), a `description` naming the date, commit and the HTTP fake; a header with the facts; one section per surface in this order: Ghostty (Image), iTerm2 (Raster), tmux in Ghostty (Raster, 256 colours), Terminal.app (Raster, known greys), cmux (Ghostty engine, Image), desktop (Svg, `SVG_SMIL` as settled); each section: the renderer, the columns and rows measured from the clip, the clip (`<img>` for a GIF, `<video autoplay muted loop playsinline>` for an mp4), a two-line caption of what to look for (the probe result, the motion, the boss growth, the known limits), and the desktop section the live-check numbers; a closing section "What changed since the directions page" (ADR 0003's heights, ADR 0004's desktop rule, the real art is PR 2) with a link to `https://claude.ai/artifact/1nJaaRAXGsfi53PFnf9nqB`. Colour tokens on `:root` with dark and light redefinitions as the design contract says; the page works at phone width; no external scripts needed. Publish once (`icon: "stage"`, `capabilities` per the capabilities skill with `assets`), upload the media with `asset: true` and `file_paths` (all image files in one call; the mp4s with it, they are video), put each returned asset URL into the page exactly as given, republish to the same path. Then `gh api repos/kevinshibuya/promptfall/issues/comments/<Task 7 id> -X PATCH -f body="$(gh api repos/kevinshibuya/promptfall/issues/comments/<id> --jq .body)

Evidence page: <artifact url>"`. Stop the fake. Tell Kevin the URL and offer the pin in one line.

**Acceptance check:** `Artifact` `action: "list"` with `scope: "assets"` on the new URL lists eight media (seven when a surface could not be recorded, said so on the page); `action: "read"` of the page shows one section per surface and the link to the directions page; `gh api …/comments/<id> --jq .body | tail -1` reads `Evidence page: <url>`; `stat -f %z` on every media file under 15,000,000. Red before: no artifact, the comment without the link.

**Boundaries:** A new artifact, never a publish to the directions page's URL. No source edits. A surface whose session cannot be driven after two attempts gets a section with a still (a `screencapture` of the window) and the sentence "clip not recorded: <why>", not a stall. The desktop clips come from Task 6; the desktop is not relaunched here.

- [ ] `rec.sh`, `gif.sh`; the five terminal clips and the Ghostty boss cut; sizes checked
- [ ] `quickstart`; the design and capabilities guidance; `index.html`; publish; assets; the URLs in the page; republish
- [ ] The comment patched with the URL; the fake stopped; the URL and the pin offer in chat

## Spec conflicts and narrowings

1. **`layoutFor` takes the surface, and every non-terminal surface takes the desktop rule.** ADR 0004 speaks of the desktop; vscode and mobile also draw the Svg (spec §2), so the cell thresholds are wrong there for the same reason. Neither is tested live here (out of scope).
2. **The band's collapse condition loses its two cell checks.** `bodyColumns < MIN_COLUMNS || maxRows < REST_ROWS` repeats what `layoutFor` already decides on a terminal (`MIN_COLUMNS` is the compact floor; `REST_ROWS === COMPACT_ROWS === 4`; the Loot and World tabs run `layoutFor(4, …)`), so dropping them changes nothing on terminals and is what lets the desktop through. The 99-column and 3-row tests stand as the proof.
3. **Market listing rows had no glyph.** The brief placed a glyph print at `dialog.tsx:322`; that line is the `ListSprite` call for listings and `market.tsx:200` prints the name alone. Task 3 touches items and heroes only.
4. **Pane fit covers the three sprite-led lists.** Inventory, Heroes and Market rows fit `bodyColumns`; Orders, Chat, Leaderboards, Account and Odds are left to the pass loop, which fixes them with a test if they clip.
5. **The fit is done in text, not in Box widths.** Text is clipped to the row width in cells (`clip`), the secondary text drops to its own row when it does not fit, and the buttons row wraps. A Box `width` in cells on the desktop was not relied on because its unit there is unverified; the live check only confirms `bodyColumns` is truthful.
6. **One clip per surface for the evidence page, plus a boss clip on Ghostty and on the desktop.** Six surfaces with rest, fight and boss each would be twelve recordings; the world boss on the HTTP fake arrives in every clip anyway when the burst is timed after `--boss-in`.
7. **The desktop media come from the pass run**, not from a separate recording: the pass already bursts the stage, and the desktop app is relaunched without the plugin at the end of Task 6.
8. **The party line wraps on the desktop (fix pass, replacing the planner's "stays cell-sized").** At 95 columns `PartyLine` leaves the enemy 5 columns and a boss shows no name and no bar; at 60 the hero segments truncate. Both review legs flagged it against Kevin's parity goal. Task 2b wraps whole segments onto further rows on the Svg surfaces. Decided by default in the fix pass (Kevin was away; cheap to reverse) and reported to him.
9. **The live check's readout is never committed.** It is a working-tree edit reverted with `git checkout --` before Task 2's red test, so the branch's history holds no probe code.
10. **`flexWrap` on the buttons row is verified live, not by a test.** The test asserts the prop; whether the desktop wraps is step 25's observation.
11. **S1's markup width is a ceiling, not a measurement.** With the slot clamping the Svg, the only requirement is that the markup be wider than the band; `DESKTOP_COLUMN_PX_CEILING = 16` sits above the roughly 11 points per column seen, and a desktop zoomed past it only draws the stage a little narrower than the band.
12. **The pass loop is capped at three codex runs.** Reds that survive are Kevin's to see with their evidence, not to be guessed at.
13. **The Account tab's Renderer row on the desktop is recorded, not asserted.** The probe is terminal-only (PR 1), so the row reads whatever the atom holds there.
14. **Task 7's comment is posted before the evidence page exists** and patched with its URL in Task 8, so the results reach the PR even if a recording stalls.
15. **The review wave ran two legs.** Fable was out of usage credits; the Fable `reviewer` leg could only run as a claude.ai/code session Kevin opens, and Kevin asked for Fable-blocked work to be finished inline. The opus `reviewer` and codex astra (xhigh) legs ran; the fix pass was consolidated inline on Opus.
16. **The pass loop's class (b) and its cap of three runs** are the planner's additions to Kevin's "each red gets a failing test then a fix": kept, and reported to him; a red that is the engine's or the desktop's own limit has no plugin test to write.

## Out of scope

PR 2 (the real art); bots in the in-process fake; a fix for the desktop's "isn't a command here." line (the desktop's command list, not the plugin); Terminal.app's grey Raster cells; live checks on vscode and mobile (they take the desktop rule untested); a headless browser smoke for the Svg (none exists in the repo; the desktop pass stands in); any change to the terminal thresholds; a second review wave or triggering the review.
