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
| `/promptfall heroes` | Opens it on Heroes (also `inventory`, `market`, `orders`, `account`, `odds`) |
| `/promptfall chat` | Opens it on Chat, the cursor in the compose box |
| `/promptfall leaderboards` | Opens it on Leaderboards and loads the boards |
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

### Market

Rare, epic and legendary items and heroes trade between players. The Market tab (`m`) browses
listings ten at a time: toggle items or heroes and cheapest or newest, filter by base (items),
class (heroes) and minimum rarity, page with `prev` and `next`. `buy` asks `Buy <name> for
<price>g?`; `y` confirms, `n` cancels. The goods arrive with a 24-hour cooldown before they can
be listed again, and a bought hero arrives at level 1.

`sell` on a Rare+ item (Inventory) or hero (Heroes) opens the sell panel. An item shows the buy
orders it matches first: `accept` sells it at once at the order's price. Then `List for` takes a
price, with the listing fee (2%, at least 1 gold, kept on cancel) and what you get after the 5%
sale fee. A hero must be out of the party and wear nothing; goods in cooldown say when they
become tradeable. Listings and orders expire after 7 days.

The Orders tab (`r`) lists your listings and buy orders, each with `cancel` and the time left,
the count of returns waiting (cancelled goods that found no free slot; they arrive when one
frees), and `New order`: a base, a minimum rarity, an optional affix and a maximum price, held
in escrow until the order fills, is cancelled or expires. Trading needs a linked account and an
open market; cancelling works either way. Sales, purchases and returns toast and show in the
loot log.

### World

Every session polls the server's world every 15 seconds, every 5 while the Chat tab is shown, and
never blocks the game on it: a poll that fails is skipped and the next one tries again. The
band's World tab (`w`) has three rows: who is online and who shares your zone
(`13 online · zone 1: Ashgrove, Brindle`, or `nobody else here`), your highest zone, kills and
wipes, and the last chat line. The first row dims when no poll has answered for 45 seconds.

The Chat tab (`c` in the dialog) shows the last 14 messages, newest at the bottom, and a compose
box; Enter posts. Posting needs a linked account, and any session may post, the one playing or
not. The server refuses, and the tab flashes for 5 seconds: a line over 200 characters (an emoji
counts two), more than 5 quick messages (then one every 10 seconds), a blocked word, or an empty
line. During an outage a post answers `Server unreachable`. On mobile the tab is read-only.

The Leaderboards tab (`b`) shows who is online by zone, the 20 highest zones reached, and this
week's world boss damage (the week starts Monday 00:00 UTC). Your row is cyan. Names are GitHub logins; an unlinked account shows as `adventurer`.

Each part sits behind a server flag: when the server turns chat, presence or the boards off, the
tab says so within one poll. The in-process ledger has chat off: its World tab reads
`1 online` and `chat is closed`.

### World boss

A world boss spawns every 3 hours on the server's clock (00:00, 03:00, ... UTC) and lives 20
minutes or until it dies. Its HP is 4,000 for each account online when it spawns. Every account
online is engaged at the spawn, and one that comes online later is engaged on its first poll.
Engaged, the party fights the boss instead of waves: tool calls spawn nothing (they still count
toward the turn boss), a wiped party is healed in place with no retreat, and nothing drops, since
the boss never dies on your side. The server counts the damage your committed batches dealt.

The band shows it: the Party tab's first enemy row is the boss with its bar (the server's HP, less
what your party dealt since the last poll), the status row ends in `boss 62% · 11m`, and the World
tab's second row reads `World boss <name> <bar> 62% · 11m left · you <damage>`. Toasts say when a
boss appears and when it is down. While a boss is live every session polls the world every 5
seconds.

Rewards land when the boss dies, or when its window ends: a guaranteed boss-rarity item for 200
damage or more (5% of the base), and on a kill one bonus roll each for the top 3. Each reward
toasts `Boss reward: <item> (<rarity>)` and shows as `boss reward <item> (+<gold>g)` in the loot
log. An item with no free slot waits in the returns queue and arrives when one frees. The boss
board counts every hit, past the boss's remaining HP too.

The world boss changed the sim, so the game is at sim version 3. A store or a fake snapshot from
phase 2 is behind it: the band reads the older-version notice, and `/promptfall account`,
`Reset this machine's data` starts a fresh account. The in-process ledger has no world boss.

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
| `i` / `h` / `m` / `r` / `a` / `o` | | Inventory, Heroes, Market, Orders, Account, Odds tabs |
| `c` / `b` | | Chat and Leaderboards tabs (outside the compose box) |
| `y` / `n` | | Confirm or cancel a purchase |

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

No sprites or sound. No mute or ban: the word list is
the only filter. The GitHub link is approved by the fakes, not by GitHub, and the in-process ledger
has no bots, so its market is yours alone and its chat is closed.

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
