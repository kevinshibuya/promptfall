# Phase 3 plan review: local facts

Checked on Kevin's machine on 2026-10-03 against the engine's d.ts,
`plugins/promptfall/.claude-plugin/types/claude-code/index.d.ts` (gitignored, so not in a
clone). "E:n" is a line in that file. These settle the engine claims in the findings that a
clone cannot check.

## `Input` (`InputProps`, E:5159-5200)

- `key: string` is required. It is the element's address, the name a `ui.input` matcher uses.
- `value?: string`: "The text the field holds when drawn; the person's typing replaces it
  until the hook draws another." A controlled input works: draw `value` from an atom, write
  it back from `onInput`, and draw `''` after a post to clear the box.
- `submitLabel?: string`: "What Enter does, in a word or two, drawn beside the field while
  it has focus (`send`). Defaults to `submit`."
- `autoFocus?: true`: "The site's focus ring starts here when the site takes the keyboard,
  instead of on nothing ... A pane opened with `focus`, or the person's focus chord or click,
  is the take. Of several in one site the first drawn wins."
- `onInput?: (value, e) => void` runs on every change. `onSubmit: (value, e) => void` runs on
  Enter.
- The plugin already uses controlled inputs this way: `plugins/promptfall/hooks/ui/sell.tsx`
  and `ui/orders.tsx:228-238` (`value={form.maxPrice}`, `onInput` writing it back).
- Not stated: whether changing `key` (a remount) keeps the focus ring on the field.

## Pane close

- `ui.close` is a hook event (E:6583, E:6802). Its input is `PaneCloseInput`: the pane closing
  and its origin, `plugin`, `person` or `unload` (E:2295-2302, E:6890-6896). A hook answering
  without `next` keeps the pane open, except on an unload.
- `$.ui.panes(): Promise<readonly UiPane[]>` lists the open panes (E:2323; example at E:2320).
- So the plan's conflict 12 reason ("no pane-close hook among the engine facts") is true of the
  facts handed to the planner, but the engine has one.

## Control characters

- A pane `title`: "a control character is refused" (E:6946).
- `Code` `source` is "bounded and free of control characters the same way" as a Text's string
  (E:1450).
- `Markdown` `text`: "At most 10000 characters, tab and newline its only control characters"
  (E:5395).
- Hover `scope` and similar names: "no control characters" (E:723, E:11851).
- Not stated: what a `Text` child string containing a newline, ESC or another control
  character does (refused, stripped, or the whole tree refused). Treat it as unsafe.

## Codex run

`~/.claude/codex-runs/20261003-133258-5303-plan3-review-custom.log`, gpt-6-astra at xhigh,
exit 0, 798 s, registry line written. `codex.findings.md` is its final message verbatim.

## Opus run

`reviewer` on Opus, fresh context, read the d.ts locally and ran the sim from scratch scripts
to measure sustained damage. `opus.findings.md` is its report verbatim.
