---
status: accepted
---

# A listing fills a matching buy order the moment it is made

Spec §4.5 said "no auto-match": a seller saw the matching buy orders in the sell flow and
accepted one by hand, and a listing priced under an order's maximum sat beside it unfilled.
Kevin's manual pass on 2026-10-13 listed an item under an open order, expected the sale, and
got nothing. From now on the ledger fills at listing time: a new listing that matches one or
more buy orders fills the one with the highest maximum, oldest first, at the order's maximum,
and the listing is consumed. The seller gets at least the asking price, the buyer never pays
over the maximum they set, and the fee is charged as on any sale. A seller's own orders never
match their listing. The sell flow keeps showing matching orders, so a seller can still pick one
deliberately before listing.

The fill is a server-side step inside the listing's handling, authored as the same `sold` and
`bought` server events ADR 0001 defined, so both parties' hashes still cover it.

## Considered options

- **Keep the explicit accept only**: rejected. A seller who undercuts an order and gets no sale
  reads it as a broken market, and nobody benefits from the gap.
- **Fill at the listing's price instead of the order's**: rejected. The order's maximum is the
  buyer's own number; paying it is the deal they offered, and it is what makes the market worth
  listing into.
