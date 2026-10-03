# Promptfall plugin

The Claude Code mod half of Promptfall. It runs the sim locally, sends the events in batches to
a ledger, and draws a band above the prompt. By default the ledger runs inside the plugin and
persists through `$.store`; `/promptfall server <url>` points it at an HTTP server instead, such as
the fake in `servers/fake`.

## Play

Load it from the repository root in an interactive session:

```sh
claude --plugin-dir plugins/promptfall
```

The band appears above the prompt once the session starts. Your three heroes fight on their own.
Every tool call Claude makes spawns an enemy, at most three fight at once and ten wait in a queue.
A turn with ten or more tool calls ends with a turn boss. Each prompt you submit heals the party
30% and revives the fallen. With nothing alive, the next enemy of the wave walks in, so an idle
session still fights, one round every 5 seconds instead of every 2.

A zone is ten waves and a boss. Beating the boss moves you to the next zone. A wipe sends you back
one zone at full health and costs nothing else.

### Commands

| Command | What it does |
| --- | --- |
| `/promptfall` | Opens the dialog on the Inventory tab |
| `/promptfall heroes` | Opens it on Heroes (also `inventory`, `account`, `odds`) |
| `/promptfall off` | Hides the band for this session; the game keeps playing |
| `/promptfall on` | Brings it back |
| `/promptfall farm` | Toggles farming: a beaten zone boss restarts the zone instead of advancing |
| `/promptfall server <url>` | Plays on the HTTP server at `<url>`, for every session on this machine |
| `/promptfall server local` | Goes back to the in-process ledger |

### Servers

Each server keeps its own account: nothing moves between them, so the first switch to a server
starts a fresh one there. The setting is machine-wide and a session that is not playing follows
it within 10 seconds. When the server stops answering, the status row reads
`Promptfall: server unreachable, retrying`, the band keeps ticking and buffering for two minutes,
then it reads `Promptfall: server unreachable` and progress stops until the server is back. A
switch during an outage drops what could not be sent, and the reply says how many events.

### Account tab

`Link GitHub` shows a code and a link, and polls until the server approves it, then reads
`Linked as <login>`. The fakes approve on the first poll: the in-process ledger links you as
`player`, the HTTP fake as its `--player-name`. The polling belongs to the session, so closing the
dialog does not stop it. `Reset this machine's data` deletes every Promptfall key in the store but
the lease and starts a fresh account on the same server. It is how a state from an older version
of the game is cleared: the band then reads the older-version notice and the Account tab is the
one tab that still works.

### Hotkeys

The band takes keys after a click, or after `ctrl+x` then Tab with Ctrl released (`ctrl+tab` does
not focus it). Letters only: a bare digit at an empty prompt
would answer a survey.

| Key | Band | Dialog |
| --- | --- | --- |
| `p` / `l` / `w` | Party, loot log, world tabs | |
| `c` | Collapse to one row, or expand | |
| `i` / `h` / `a` / `o` | | Inventory, Heroes, Account, Odds tabs |

Esc closes the dialog. The band collapses to one row by itself under 100 columns or when fewer
than 4 rows are free, and hides while Claude asks you a question.

### What phase 1 has

Combat, waves, zones, bosses, loot with rarities and affixes, equipping, vendoring, reforging,
a tavern, hero contracts from bosses, party swaps that apply at the next zone change, inventory
and roster expansions, and published odds. Progress lives in the Claude Code store on this
machine. One session at a time plays: another session shows `playing in another session` and
takes over within about 10 seconds of the first one quitting. Typing a prompt or `/promptfall` in a
session makes it the one that plays at once.

### What it lacks

No market UI yet, and no chat, presence, leaderboards or world bosses. No sprites or sound. The
GitHub link is approved by the fakes, not by GitHub.

## Develop

A `--plugin-dir` folder reloads on save. The game packages live in `packages/`, and a mod can
import only files inside its own folder, so `pnpm vendor` bundles them into `hooks/vendor/`.
Run it after changing `packages/sim`, `packages/protocol` or `packages/ledger` and commit the
result. CI fails when
the bundles are stale (`pnpm vendor:check`).

Two rules of the mods runtime shape the code. A hook may not pass `$` or `$.store` on, so
`register.tsx` hands the rest of the code closures written at the hook. And `claude plugin
validate` reads an atom only where the calling module declares it, so each module declares the
atoms it uses.

```sh
claude plugin validate plugins/promptfall
claude plugin test plugins/promptfall
pnpm exec tsc -p plugins/promptfall
```

`tsc -p plugins/promptfall` needs the engine's declarations, which an interactive
`claude --plugin-dir plugins/promptfall` lays under `.claude-plugin/types/` on first load. They
are generated per Claude Code version and stay uncommitted.
