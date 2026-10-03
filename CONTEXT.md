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
A seeded account inside the HTTP fake that trades through the same ledger API as a player.
_Avoid_: NPC, agent, simulated player

**Cursor**:
An account's position in its stream of server events. A batch declares the cursor its
client has applied.

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
