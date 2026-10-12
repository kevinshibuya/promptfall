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
A process or module that runs the ledger and exposes it to clients. There are two programs:
the in-process fake inside the plugin, and the HTTP host in `servers/fake`, which runs as the
HTTP fake on a laptop and as the real server on the box (ADR 0012).

**In-process fake**:
The host that runs inside the plugin on the local store, chosen by the `local` server
setting and pinned by the sandbox; no infrastructure, no bots. A fresh install plays on the
public server instead.
_Avoid_: local server, LocalServer (the class name only)

**HTTP fake**:
The HTTP host run as a separate local process speaking the real HTTP protocol, for
development: bots, a clock `--speed` can run fast, and a link that approves itself.
_Avoid_: dev server, mock server

**Real server**:
The HTTP host started with the production flags: SQLite for the store, the real clock,
GitHub's device flow for the link. One container on the box.
_Avoid_: backend, API server, prod

**Public server**:
The real server at `promptfall.kevinshibuya.com`, where a fresh install plays.
_Avoid_: official server, main server

**Bot**:
A seeded account inside a host that plays and trades through the same public API as a
player: it submits batches, lists, buys, chats and fights the world boss. Named so it reads as
one, and kept off the leaderboards.
_Avoid_: NPC, agent, simulated player

**Cursor**:
An account's position in its stream of server events. A batch declares the cursor its
client has applied.

**Delivery**:
The server events pending past a client's cursor, carried on a response.
_Avoid_: event stream (the long-poll ADR 0012 leaves out), pending events, push

**Primary session**:
The one session per account that ticks and submits; every other session renders read-only.
_Avoid_: active session, owner

**Migration**:
The rewrite of a stored state from one sim version to the next, so a save keeps its heroes,
items and gold across a bump. Runs on the ledger's records and on the machine's save alike. A
save is never reset for being old (ADR 0013).
_Avoid_: upgrade, conversion, reset (that is what a migration replaces)

### Market

**Listing**:
A fixed-price offer of one item or hero, open until bought, cancelled or expired.
_Avoid_: sale, auction, offer

**Buy order**:
A standing request to buy an item matching a base type, a minimum rarity, at most one
affix and a maximum price, with the gold escrowed. Fulfilled only by a seller accepting it.
_Avoid_: bid, want, request

**Escrow**:
Gold held by the ledger for an open buy order; refunded on cancel or expiry, gone with the
account when the account is deleted.

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
_Avoid_: stream, long-poll, sync

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

**Wipe**:
Every hero down. The party restarts the zone it is in at wave 1, healed, and nothing is lost.
An everyday event, not a weighty one.
_Avoid_: death, game over, party kill, retreat (that is the fall-back after several wipes)

**Retreat**:
The fall-back one zone the party makes after its third wipe in a zone with no boss kill between
them. The weighty event a wipe used to be.
_Avoid_: wipe, defeat, demotion

**Travel**:
The player's move of the party to any zone up to the highest it has reached, at once, the
encounter cleared with no drops and no XP. Navigation, never a cost.
_Avoid_: teleport, warp, zone select, fast travel

**Tier**:
A full pass of the twelve zones at one difficulty. Clearing zone 12's boss opens the next tier,
where the same zones hold stronger enemies and drop a tier higher. The ladder stays one ladder:
tier 2's zone 1 ranks above tier 1's zone 12.
_Avoid_: prestige, New Game+, difficulty, loop, ascension

**Reactive event**:
A change in the fight that answers what Claude is doing: Haste while a turn runs, Enrage on a
failed tool call, Camp on compaction, Guard while a permission waits, and the enemy kind a tool
kind spawns. Every one is seen on the stage and read in the combat log. None changes what an
enemy drops.
_Avoid_: trigger, integration, buff (that is one kind), bonus

**Haste**:
The reactive event of a running turn: every hero's gauge fills faster while Claude works, speed
streaks on the party.
_Avoid_: speed-up, boost, turbo, frenzy

**Enrage**:
The reactive event of a failed tool call: the front enemy's next hit lands harder, a red flash
on it.
_Avoid_: rage, berserk, punishment, penalty

**Camp**:
The reactive event of a compaction: the party camps and heals, a campfire on the stage.
_Avoid_: rest (that is a prompt), inn, respite, break

**Guard**:
The reactive event of a waiting permission prompt: the heroes hold a guard stance, take less
damage and attack nobody until the player answers.
_Avoid_: defend, pause, block, shield wall

### Progress

**Tavern guarantee**:
The tavern's promise that a recruit of at least a given rarity comes within a set number of
recruits, one count per rarity, published on the Odds tab beside the odds. Contracts from
bosses are drops and never count.
_Avoid_: pity, pity counter, pity timer, mercy

**Session summary**:
What the game tells the player on the first tick of a session about the play since the last
one: kills, zones, levels, rare drops, gold and sales. One toast and the message window's first
line. Nothing is summarised after a short break.
_Avoid_: recap, while you were away (there is no away progress), report

**Achievement**:
A thing done once and kept for good, counted in play that happens anyway (kills, bosses, zones,
drops, recruits, collections). Never counted in logins, tool calls or turns.
_Avoid_: trophy, badge, milestone, quest

**Daily goal**:
One target a day per account, in play that happens anyway (kills, zone bosses, rare drops, a
turn boss, a world boss), scaled to the party's zone and paid in gold when met. Set the same
way on client and server from the day and the account, so nobody has to deliver it. A missed
goal costs nothing but the streak.
_Avoid_: daily quest, daily, task, mission, challenge

**Streak**:
The count of consecutive work days on which the daily goal was met. A work day missed ends it.
A rest day neither counts nor ends it. Its lengths are achievements; the streak itself pays
nothing.
_Avoid_: login streak (nothing counts a login), combo, chain, run

**Rest day**:
A weekday the player names as off, two a week, Saturday and Sunday unless changed. A change
takes effect from the next Monday.
_Avoid_: freeze, skip, forgiveness, grace day

**Weekly hunt**:
One target a week shared by every player on the server, counted in play that happens anyway,
with a progress bar on the World tab and a reward to every contributor when it is met.
_Avoid_: event, community goal, raid, world quest

**Journal**:
The pane's tab for what the player has seen and done: the bestiary by zone, the item
collection, the achievements, the daily goal and the streak, each with its mark.
_Avoid_: bestiary tab, collection, codex, trophies

### Presentation

**Stage**:
The animated battle scene in the band's Party tab: the encounter's enemies on the left, the
party on the right, side-on. Drawn on every surface, in whatever pixels the surface has;
glyph rows are never the stage's fallback.
_Avoid_: scene, arena, battlefield, viewport

**Staged state**:
The fight as the stage has played it so far: the sim's state less every hit, heal and death the
stage has not landed yet. The stage and every window of the band draw the staged state; the sim,
the server and the pane deal in the state, and so do the toasts, except at a show time.
_Avoid_: shown state, played state, predicted HP, animation state

**Sprite**:
The pixel art of one hero class, enemy, world boss or item, with its animation frames.
Replaces the glyph where pixels draw; the glyph stays as its fallback. Each sprite has two
drawings of the same design: its **1.5× art**, for the stage on surfaces that draw pictures, and
its **1× art**, for half-block terminals, the compact stage and the list windows. Its frames are
1.5× art only.
_Avoid_: portrait (the hero template's field name, unused), icon, image

**Frame**:
One drawing of a sprite's animation on the stage: idle A, idle B, wind-up, strike,
follow-through or hit. Wind-up, strike and follow-through are drawn; idle B and hit are derived
from idle A by fixed transforms. Every frame sits on the idle art's canvas.
_Avoid_: cel, pose (for the frames themselves; a pose is which frame an actor shows)

**Effect sprite**:
The fireball, light burst or arrow the stage moves during a hero's action: a bolt flies from the
caster to its target, a burst sits on it. An ordinary sprite of kind `effect`. The sim's
`Effect` (a combat event) is unrelated.
_Avoid_: projectile, particle, VFX

**Lunge**:
The thrust an enemy or the knight makes at its target during its wind-up and strike, out and
back. The mages and the archer strike in place.
_Avoid_: charge, dash, step (that is the move before the action)

**Step**:
The pace every attacker takes forward, toward the other side, before its wind-up, whatever its
action (a heal steps the same way), holds through the action and takes back after it. The same
distance for every actor, the world boss included.
_Avoid_: lunge (the thrust itself), hop, jump, approach

**Chest**:
The box a kill leaves where the enemy stood when it drops an item. One chest, whatever the
rarity; the rarity shows in the reveal.
_Avoid_: loot box, crate, drop (that is the item)

**Reveal**:
The chest opening and the item rising out of it on a glow in its rarity colour, held longer the
rarer the item. Its show time is the item fully risen. The next enemy enters after it.
_Avoid_: drop animation, unboxing, loot pop

**Show time**:
The moment the stage plays an event the words also tell: a drop's item fully risen, a zone
arrival's backdrop changed. A line or toast about such an event lands at its show time, not
before; an event the stage never plays, or plays while no band is drawn, has none, and its words
land with the state.
_Avoid_: reveal time (that is one show time), animation end, delay

**Held line**:
A combat log line or toast that waits for its show time. A drop's and a zone arrival's are held;
a hit line, a wipe's or a level-up's is not.
_Avoid_: delayed line, queued toast, deferred message

**Window**:
A framed box of the game's interface, as Dragon Quest V draws it: a charcoal field, a thin white
line with cut corners, text in the game's pixel font. The band's strip and all eight of the
pane's tabs are made of windows.
_Avoid_: panel, card, frame, box, dialog (the pane as a whole)

**Strip**:
The row of windows under the stage: the enemy window, the message window, the party window and
the purse. Beside the compact stage it is one party window; on Loot and World it is the band.
_Avoid_: HUD, status bar, party line (the text row it replaced)

**Playfield**:
What a band tab draws, set into the shell: on Party the stage with the strip beneath it, on Loot
and World the strip alone. One width, centred, edged by one window line, so the stage and the
strip read as one picture.
_Avoid_: frame (a sprite's drawing), game area, viewport, screen

**Shell**:
The charcoal field that fills the band's box around the playfield, whatever the terminal's width
and whatever rows the prompt leaves. The band is the shell with the playfield on it; the terminal
never shows through.
_Avoid_: frame, bezel, border, background, chrome

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

**Toast**:
One sentence the primary session raises over the transcript for an event worth a glance away
from Claude's work: rare good news, a state that wants a decision, or money that moved. Subject
first, in the game's voice. Routine combat never toasts; the combat log carries it. A toast is
short-lived or long-lived by the weight of its event.
_Avoid_: notification (the whole layer, toasts and cues together), alert, popup, banner

**Burst**:
The effects the engine hands over together: one tick's, or one delivery's. Toasts fold within a
burst and never across two.
_Avoid_: batch (that is a submission of player events), tick (one of the two kinds of burst)

**Fold**:
Several effects of one kind in a burst becoming one toast that carries the count and the sum.
A legendary, epic or rare drop, a vendored item, a recruit, a reward, a wipe or a zone arrival
never folds: a toast with a show time lands at its own.
_Avoid_: group, coalesce, merge, summary toast

**Cue**:
A short sound the primary session plays alongside a toast. Every cue has a toast; most
toasts have no cue.
_Avoid_: sound effect, sfx, alert, chime

### Development

**Sandbox**:
A separate save on a fake host where verbs hand out what play would earn: a boss, an item, a
level, gold, a zone. Each one is a server event, so the sim and the toasts treat it as real.
The real server has no sandbox. The band says so while it is on.
_Avoid_: cheat, debug mode, creative mode, dev mode, god mode
