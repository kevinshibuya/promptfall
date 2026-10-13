---
status: accepted
---

# Whetstones and manuals are stackable inventory items, not counters

A hone (an item affix's value rerolled) and a drill (a hero trait's value rerolled) each consume
one good: a whetstone or a manual. The obvious shape is a counter on the save, beside gold.
Kevin chose inventory items instead (grill, 2026-10-13), so that both goods trade on the global
market and the daily goal feeds the economy: the goal pays a whetstone or a manual, drawn from
the day and the account, and most players trade for the one they lack. Both also drop, rarely:
about 1% per good from a boss kill and ten times rarer from a wave enemy, so a drop is a windfall
and the goal stays the supply.

That makes stacks a first-class inventory concept. A stack is one slot holding up to 99 of one
stackable base; a stackable that arrives joins its stack with no slot needed, and only a new
stack takes one. A listing of a stackable carries a quantity and a price each; a buy order for
one carries a quantity and a maximum each, fills partially, and is filled by any listing whose
quantity fits. Neither good has a vendor value or can be vendored: every one hones, drills or
trades, and one that finds no stack and no free slot waits as a pending reward until a slot
frees, whether it came from the goal or a kill. The save shape, the ledger's goods, the protocol schemas and the market's matching all
change, which is why this is recorded.

## Considered options

- **A counter on the save**: simplest, and not tradeable. Rejected because the trade is the
  point.
- **One good for both hones and drills**: fewer types. Rejected: two prices are two things to
  trade on, and a whetstone drilling a hero reads wrong.
- **Vendorable with a small value**: rejected. A vendor floor would set a price the market
  should set.
