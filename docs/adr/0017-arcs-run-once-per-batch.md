---
status: accepted
---

# The arc suite runs once at the end of a batch, not in every ticket's gate

The harness under `packages/sim/src/harness` (nine seeds over 120 live hours, the early
envelope, the feel probe) was part of `pnpm test`, so every ticket's gate and every fix pass
paid about 100 seconds of the sim package's 112, and a sim-changing ticket could go red on an
arc floor it had no mandate to retune. Kevin asked (2026-10-13) that balance runs stop hanging
up development.

From now on `pnpm test` excludes the harness folder and `pnpm test:arc` runs it. A batch of
specs that change the sim ends with one closing ticket that runs the arcs once, pastes the
per-seed table in its closing comment, and stops there. If a floor fails (seven of nine seeds
clearing zone 12, the feel probe's hit counts), the closing ticket reports it; retuning content
numbers is Kevin's decision on the table, as a follow-up ticket. Spec §4.2's rule that the
medians are a report and never a gate is unchanged.

## Considered options

- **Keep the arcs in every gate**: rejected for the cost above, and because a per-ticket red
  arc forces a balance decision into a ticket that was about something else.
- **Keep the cheap early envelope in the gate and move only the 120-hour arcs**: rejected for
  one rule. The envelope's expectations move with the same sim changes.
