---
status: accepted
---

# Trades enter the sim as server events

A trade touches two accounts, so no client can produce it as a player event. Rather than
giving the market its own gold balance and item vault beside the sim, the ledger authors
**server events** (`listed`, `sold`, `bought`, `order_placed`, …) that the sim applies like
any other event, in a position the server dictates through a per-account cursor. The sim
stays the single ledger of inventory, roster and gold; the hash chain covers trades; the
contract suite can assert both parties' hashes after a sale.

## Considered options

- **Server-side vault and gold balance**: the market keeps its own state and the sim only
  sees grants and removals at its edges. Rejected: two ledgers for one account, and the
  spec says the server is *the* ledger.
- **Separate market gold**: a second currency-like balance for trading. Rejected: the spec
  allows one currency, and a split balance leaks into every price and fee.

## Consequences

- The sim's event union splits into player events (batchable) and server events
  (ledger-only); the batch schema accepts player events only.
- A client re-steps its un-submitted player events over arriving server events, so a spend
  it already showed can turn into a rejection: the server wins, as spec §7 already says.
- Market actions flush the client's buffer first, so the ledger validates against state at
  most one round trip old.
- Transferred items and heroes need ids the per-account counters cannot give; the ledger
  assigns them from its own namespace.
