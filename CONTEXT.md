# Promptfall

The idle RPG that runs inside Claude Code as a mod: a party fights above the prompt while
Claude works, and from phase 2 on players trade on a global market. One context; the sim,
the protocol, the servers and the plugin share this language.

## Language

### Authority

**Sim**:
The deterministic rules package. An ordered list of events in, a state and a hash out.
_Avoid_: engine (that is the plugin's scheduler), game logic

**Player event**:
An event a client originates and submits in a batch: combat ticks, rests, equips, vendoring.
The server replays it and may reject the batch.
_Avoid_: command, action, input

**Server event**:
An event only the ledger can author, applied to one account's state in a position the
server dictates. Every effect of a trade on a party's inventory, roster or gold is one.
_Avoid_: ledger event, authoritative event, grant

**Ledger**:
The pure server core: account records, batch replay and the market rules, over an injected
clock and store. Every server host runs the same ledger.
_Avoid_: backend, server logic, fake logic

**Host**:
A process or module that runs the ledger and exposes it to clients: the in-process fake,
the HTTP fake, the real server.

**In-process fake**:
The host that runs inside the plugin on the local store. The default server; no
infrastructure, no bots.
_Avoid_: local server, LocalServer (the class name only)

**HTTP fake**:
The host that runs as a separate local process speaking the real HTTP protocol, with bots.
_Avoid_: dev server, mock server

**Bot**:
A seeded account inside the HTTP fake that plays and trades through the same public API as
a player: it submits batches, lists, buys, chats and fights the world boss.
_Avoid_: NPC, agent, simulated player

**Cursor**:
An account's position in its stream of server events. A batch declares the cursor its
client has applied.

**Delivery**:
The server events pending past a client's cursor, carried on a response.
_Avoid_: event stream (phase 5's long-poll), pending events, push

**Primary session**:
The one session per account that ticks and submits; every other session renders read-only.
_Avoid_: active session, owner

### Market

**Listing**:
A fixed-price offer of one item or hero, open until bought, cancelled or expired.
_Avoid_: sale, auction, offer

**Buy order**:
A standing request to buy an item matching a base type, a minimum rarity, at most one
affix and a maximum price, with the gold escrowed. Fulfilled only by a seller accepting it.
_Avoid_: bid, want, request

**Escrow**:
Gold held by the ledger for an open buy order; refunded on cancel or expiry.

**Linked account**:
An account tied to a GitHub login. The gate on trading and chat.
_Avoid_: verified account, registered account

**Returns**:
The ledger's holding for an item or hero coming back from a listing to an owner with no
free slot. Delivered as soon as a slot frees; never vendored.
_Avoid_: mailbox, pending items

**Cooldown**:
The 24 hours after a transfer during which an item or hero cannot be listed again.
_Avoid_: binding, lock

### World

**World poll**:
The read a session makes for a world snapshot. It is also the session's heartbeat.
_Avoid_: stream, long-poll (phase 5), sync

**World snapshot**:
What the world poll answers: presence, the live world boss and the chat tail. Never sim
state.
_Avoid_: world state, feed, stream, event stream

**Chat mark**:
The id of the last chat message a client has shown; a poll asks for newer ones only.
_Avoid_: chat cursor (the cursor is per account and for server events), offset, since

**Heartbeat**:
The world poll's side effect of stamping an account present, in its zone, at the server's
clock.
_Avoid_: ping, keepalive, check-in

**Online**:
An account with a heartbeat inside the presence TTL.
_Avoid_: active, connected, logged in

**World boss**:
The shared enemy with one global HP that every online party damages during its window. The
zone boss and the turn boss stay sim enemies of one party.
_Avoid_: raid boss, global boss, event boss, boss (alone)

**Boss mode**:
The stretch during which a party's encounter is the world boss: entered by the server
event `boss_engaged`, left by `boss_disengaged`. Normal waves pause.
_Avoid_: raid, boss fight, boss phase

**Contribution**:
An account's tallied damage to one world boss, read by the server from the party's
committed state.
_Avoid_: score, participation, damage share

**Reward**:
What the server rolls for a contributor when a world boss dies or expires, delivered as
the server event `rewarded`.
_Avoid_: loot (that is a drop), prize, payout

### Combat

**Battle time**:
The sim's own clock. Each tick advances it by a fixed slice; it never reads the wall clock.
_Avoid_: game time, real time, elapsed time

**Action gauge**:
A unit's bar that fills with battle time, faster with more speed. A unit whose gauge is full
joins the action queue. Heroes' gauges show in the band; enemies' never do.
_Avoid_: ATB bar, timer, charge, cooldown

**Action queue**:
The units whose action gauges are full, in the order they filled. The first one acts; nobody
else acts until its action is over.
_Avoid_: turn order, initiative, round

**Action**:
What a unit does when its turn in the action queue comes: an attack, a heal, later a skill or
a technique. Picked by a weighted draw among the actions that make sense right now.
_Avoid_: move, command, turn, ability

### Presentation

**Stage**:
The animated battle scene in the band's Party tab: the encounter's enemies on the left, the
party on the right, side-on. Drawn on every surface, in whatever pixels the surface has;
glyph rows are never the stage's fallback.
_Avoid_: scene, arena, battlefield, viewport

**Sprite**:
The pixel art of one hero class, enemy, world boss or item, with its animation frames.
Replaces the glyph where pixels draw; the glyph stays as its fallback. Each sprite has two
drawings of the same design: its **2× art**, for the stage on surfaces that draw pictures, and
its **1× art**, for half-block terminals, the compact stage and the list windows.
_Avoid_: portrait (the hero template's field name, unused), icon, image

**Window**:
A framed box of the game's interface, as Dragon Quest V draws it: a charcoal field, a thin white
line with cut corners, text in the game's pixel font. The band's strip and all eight of the
pane's tabs are made of windows.
_Avoid_: panel, card, frame, box, dialog (the pane as a whole)

**Strip**:
The row of windows under the stage: the enemy window, the message window, the party window and
the purse. Beside the compact stage it is one party window; on Loot and World it is the band.
_Avoid_: HUD, status bar, party line (the text row it replaced)

**Message window**:
The strip's middle window: the command line on top, then the combat log, the latest drops or
the World rows, by tab. In the pane, the two-line window at the foot: what the keys do, the
question a Yes/No asks, a refusal.
_Avoid_: log panel, chat box

**Command line**:
The message window's first row, `▶Party Loot World ▾`: the band tabs, ▶ on the current one.
_Avoid_: tab bar, menu

**Tab window**:
The pane's top window: the eight tab labels, ▶ on the current one, each hotkey letter gold.
_Avoid_: tab bar, header

**Command window**:
The window that opens over the Inventory or Heroes list on Enter: the actions that apply to the
▶ row (Equip, Sell, Vendor; Party, Dismiss), each with a gold hotkey letter. The equip and
reforge picks are command windows too.
_Avoid_: context menu, action menu, popup

**Filter window**:
The Market's command window for the search: kind and sort flip in place; base, class and rarity
open a pick. `f` opens it from the list's `Filters` row.
_Avoid_: filter bar, search form

**Form window**:
A window in the detail window's place that collects a choice before it is sent: the sell window
and the new buy order. Its picks take its place while open, and `q` returns to it.
_Avoid_: dialog, modal, panel

**Field**:
A typed input under the pane's picture: the sell price, the order price or the chat line. One at
a time; Enter submits it and Tab leaves it (Escape closes the pane).
_Avoid_: text box, input bar, compose box

**Ring stop**:
A hidden one-space Button the pane mounts per list row, command item, Yes and No, tab and back.
The focus ring walks them; the ▶ follows the ring onto the cursor stops.
_Avoid_: focus target, hidden button

**Sell window**:
The window that takes the detail window's place while selling: matching buy orders with their
nets, then Set a price (or preset prices where there is no price field).
_Avoid_: sell panel (the text form it replaced), sell dialog

**Purse**:
The strip's last window: the gold and the tactics (Push on, or Farm here; `f` toggles).
_Avoid_: wallet, status window

**Combat log**:
The running account of the encounter, one short line per event (hits, kills, drops, level-ups,
deaths, sales), printed in the band's message window as it happens.
_Avoid_: battle log, feed, history, last drop

**Cue**:
A short sound the primary session plays alongside a toast. Every cue has a toast; most
toasts have no cue.
_Avoid_: sound effect, sfx, alert, chime
