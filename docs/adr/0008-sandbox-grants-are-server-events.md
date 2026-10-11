---
status: accepted
---

# The sandbox hands things out as server events, never as client-side state

A sandbox verb (a boss on demand, an item, a level, gold, a zone) must land in a sim that is
deterministic and replayed by the ledger, so it cannot be a client-side mutation: the next
batch would fail the hash check and the ledger would revoke it. It is not a player event
either: the batch schema is a closed list the real server shares, and a cheat is not something
a client originates. So each verb asks the host to author a **server event** for the account,
the way the ledger already authors `credited` for an admin, in a cursor-dictated position; the
sim applies it like a trade, and the effects, the combat log, the toasts and the cues fire as
in real play. The host authors one only when its `sandbox.enabled` flag is on, which the
in-process fake and the HTTP fake can set and the real server never does. A sandboxed account
is a separate save, never linked, so nothing it holds can reach the market.

## Considered options

- **A sandbox player event**: one more kind in the batch schema, rejected by the ledger unless
  the flag is on. Rejected: it widens the protocol the real server validates, and it makes the
  glossary's "player event" (an event a client originates) a lie for one kind.
- **Direct state mutation in the plugin**: the fastest to write. Rejected: breaks the hash
  chain, so the ledger revokes what was granted; and nothing downstream (effects, toasts, the
  log) would fire, which defeats the sandbox's main use, triggering real events on demand.
- **A sandbox save that skips the ledger entirely**: a plugin-only mode with no host. Rejected:
  two code paths for one game, and the sandbox could no longer exercise delivery, boss mode or
  trades.

## Consequences

- The sim's server-event union grows by the sandbox kinds; `SIM_VERSION` moves if the state
  shape changes, which the grants avoid by reusing the existing drop, level-up, zone and
  encounter paths.
- The verbs reach the ledger only in process: the sandbox pins the plugin to the in-process
  ledger. The HTTP fake can switch `sandbox.enabled` on with `--flag`, but it has no route for the
  verbs, and neither has the real server, so the verbs cannot exist against a remote host.
- A sandbox grant shows in the combat log and toasts exactly as play would, so a screenshot of
  a sandbox is only told apart by the band's `Sandbox` mark.
