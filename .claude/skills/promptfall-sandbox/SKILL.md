---
name: promptfall-sandbox
description: Promptfall's sandbox verbs. Use when a task needs a boss, item, level, gold, zone, recruit, wipe or world boss on demand, or tests toasts, the log or the stage after one.
---

# Promptfall sandbox

The sandbox is a separate save on the in-process fake where `/promptfall sandbox <verb>` hands out what play would earn. Each verb asks the ledger to author a server event for the account (ADR `sandbox-grants-are-server-events`); the sim applies it through play's own path, so the effects, the combat log, the toasts and the cues fire as in real play. The verbs live in `plugins/promptfall/hooks/sandbox.ts`, the grants in `packages/sim/src/server-events.ts`, the host calls and the world boss in `packages/ledger/src/ledger.ts` and `boss.ts`.

## The switch and the save

- `PROMPTFALL_SANDBOX=1` in Claude Code's environment turns it on, read through `$.env.get` at session start. Off, the `sandbox` verb is missing from the argument hint and any `/promptfall sandbox …` answers `Sandbox is off. Start Claude Code with PROMPTFALL_SANDBOX=1.`
- On, the plugin plays the in-process ledger with `sandbox.enabled` and `worldboss.enabled` on and chat off. A stored server URL is ignored; `/promptfall server` answers that the sandbox pins the server.
- The save lives under the store prefix `promptfall-sandbox:` (books, device token, lease), so the first bootstrap mints its own account and a real session can play beside it. The settings stay under `promptfall:`, shared. The account never links: the Account tab has no Link GitHub row.
- The purse shows `Sandbox` where the tactics line sits.

## The verbs

`/promptfall sandbox` alone lists them. Every verb but `reset` claims the primary first. A grant syncs before and after the host call, so by the time the reply returns the view, the log and the toasts already have it. A drop's log line, Loot row, toast and cue are held lines: with a band drawn they land at the chest's reveal, after the reply. A zone boss struck down by `item` holds its zone line and arrival toast too: they land when the backdrop changes, after the drop's.

| Verb | Arguments | What lands | Reply |
| --- | --- | --- | --- |
| `boss` | `<name>`, a zone boss or turn boss | `sandbox_boss`: the party moves to the boss's zone if elsewhere, the encounter ends with no drops or XP, and the next empty tick spawns the boss (`boss_spawned`, its log line) | `Sandbox: Elder Treant is next` |
| `worldboss` | none | Ledger-side: a world boss whose window starts now engages every online account; boss mode starts, and one world poll raises the `World boss The Promptwyrm has appeared` toast | `Sandbox: world boss The Promptwyrm has appeared`, or `Sandbox: a world boss is already live` |
| `worldboss end` | none | Ledger-side: the live boss settles as if its window had passed, every engaged account is paid as `rewarded` (toast `Your share of The Promptwyrm: …`) and disengaged, and the world snapshot shows it at 0 HP, so the poll raises `World boss The Promptwyrm is down` | `Sandbox: The Promptwyrm is down, rewards delivered`, or `Sandbox: no world boss is live` |
| `item` | `<base> [rarity]`, common by default | `sandbox_item`: the sim's own roll; the front living hero acts and strikes the front enemy (not a world boss) down, an `act` then a lethal `hit`, and the kill settles through `onEnemyKilled` (XP, gold, wave or zone progress) with the item as its drop in place of the roll, so the stage plays the fade, the chest and the reveal on it. With no such enemy the item drops alone: against a world boss its chest falls on the boss, and between spawns a chest on the empty ground still plays on the front slot, the next enemy entering after it fades. Then the drop intake: `drop` (log line, `lastDrop`, a toast from rare up: `Legendary drop: Oak Staff`, `Rare drop: …`, `Epic drop: …`) or, inventory full or sold by the auto-vendor setting, `drop_vendored` and the vendor gold | `Sandbox: Oak Staff (legendary) dropped`, `Sandbox: Oak Staff vendored, inventory full`, or with room and auto-vendor selling it `Sandbox: Iron Sword auto-vendored, 2G` |
| `level` | `<hero> <n>` | `sandbox_level`: XP through the XP path one level at a time up to `n` or the rarity cap, a `level_up` for each; the burst folds them into one toast at the highest, `Aldric the Bold reached level 7` | `Sandbox: Aldric the Bold is level 7`, `… is already level 7`, or `… is level 20, the common cap` |
| `gold` | `<n>` | `credited` with reason `sandbox`; no toast | `Sandbox: 5000 gold added` |
| `zone` | `<n>`, 1 to 36 | `sandbox_zone`: the zone change (wave 1, highest zone bumped), the encounter ended | `Sandbox: zone 4, Old Barrow Hills`, `Sandbox: tier 2, zone 1, Greenmeadow Road` past 12, or `Sandbox: zones run 1 to 36` |
| `recruit` | `[rarity]`, common by default | `sandbox_recruit`: a hero of that rarity through the recruit path, `hero_recruited` with `via: 'sandbox'`, toast `Epic recruit: <name>` | `Sandbox: <name> (epic) recruited`, or `Sandbox: roster full, nobody recruited` |
| `wipe` | none | `sandbox_wipe`: the wipe path, as if every party hero hit 0 HP: the `wipe` effect, the zone restarted at wave 1, the wipe counted, toast `The party fell, back to wave 1 of zone 3, Marsh of Sighs`; the third in a zone is the `retreat` effect, one zone back, toast `The party retreats to zone 2, Whisperwood` | `Sandbox: the party fell, back to wave 1 of zone 3`; the third `Sandbox: the party retreats to zone 2` |
| `reset` | none | The account reset: books and token go, lease and settings stay, a fresh account bootstraps in the same session | `Sandbox: the save starts over` |

`worldboss` draws its boss from the ledger's `WORLD_BOSSES` (The Promptwyrm, The Context Leviathan and the rest), so the replies and toasts name whichever spawned.

In boss mode `boss`, `zone` and `wipe` answer `Sandbox: the party is fighting a world boss, nothing changed` and change nothing; `item`, `level` and `recruit` apply. Bad arguments answer the verb's `Usage: /promptfall sandbox …` line, an unknown verb answers `No sandbox verb 'x'.` and the listing, and any other refusal answers `Sandbox: nothing changed (<reason>)`. A primary paused on an update or a reset notice answers `Promptfall is paused`, and a session that still cannot play after the claim answers `Promptfall is not playing in this session`.

## Names

`boss` matches zone and turn bosses by enemy name, `item` item bases by name or id, `level` the roster's heroes by name (epithet included), a rarity by its name (`common` to `legendary`). A name matches as a case-insensitive prefix of the display name, of any word in it, or of the id: `treant`, `elder` and `elder_t` all find Elder Treant.

- One match runs.
- Several answer `Which one: Oak Staff, Oak Bow` and run nothing. Heroes who share a name show their id, `Aldric the Bold (h3k)`, and the id picks one.
- None answers `No boss named 'x'` (or item, hero, rarity) and, on the next line, the full list for that kind.

In `item`, the last word is the rarity unless the whole argument names a base. The exact names are in the `promptfall-content` skill's reference.

## Driving a verb from a plugin test

Plugin tests run with `claude plugin test plugins/promptfall`. The verb tests are in `plugins/promptfall/hooks/command.test.ts` (the sim-backed verbs and the world boss, through its `sandboxOn` helper) and `hooks/sandbox.test.ts` (the switch, the save, `gold`, `reset`). Start a new test from one of them.

The harness answers the store events from a `Map`, records `state.set` into a second one, and records each `ui.toast` event's text. It turns the sandbox on with `mock.env(on, { PROMPTFALL_SANDBOX: '1' })` before `$.session.start`; `sandbox.test.ts` also answers `env.get` from a function to flip the variable mid-run. A verb runs as `$.command.run({ ...RUN, command: 'promptfall', args: 'sandbox <verb> <args>' })` and its reply is the result's `text`.

After the reply, read the grant where a player would see it:

- **The view**, `states.get('view')`: `inventory`, `roster`, `zone`, `wave`, `gold`, `enemies`, `boss`, `lastDrop`, `loot`, `wipes`.
- **The toasts**, the recorded texts. Toasts fire on the primary only, and a drop toasts only from rare up. Empty the array before the verb under test.
- **The stage and the log**, through `$.ui.mount` of the band, as the world-boss test reads the strip.
- **A spawned boss** waits for the next empty tick: `await clock.advance(5_000)`, then read `enemies`.

The raw effects are the sim's: `packages/sim/src/sandbox.test.ts` asserts state and effects per grant kind, and `packages/ledger/src/sandbox.test.ts` the flag gate and the world-boss calls.

```ts
const { run, view, toasts } = await sandboxOn(on, $)
await run('zone 3')
expect(await run('wipe')).toBe('Sandbox: the party fell, back to wave 1 of zone 3')
expect(toasts).toContain('The party fell, back to wave 1 of zone 3, Marsh of Sighs')
```

## The world boss in the sandbox

- The sandbox ledger runs the world boss on its grid too, beside the verbs. A test whose clock starts inside a grid window finds a grid boss engaged and `boss`, `zone` and `wipe` refused, which is why `sandboxOn` starts the clock at `BOSS_WINDOW_MS + 1_000_000`. In a live session a world boss can appear by itself.
- The grid does not spawn while a stored boss is open; sandbox bosses take ids from their own `sb` space.
- A settle pays every engaged account as if each had reached the reward threshold, so `worldboss` then `worldboss end` with nothing dealt still delivers one `Your share of The Promptwyrm: …` toast, and in a test with several accounts every engaged one is paid.
