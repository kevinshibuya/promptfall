---
status: accepted
---

# The real server is the ledger host on SQLite

The public server launches on a free-tier box shared with other projects (2 vCPU, 12 GB, no
budget), for a couple of thousand players at most. Spec §8 planned phase 5 as NestJS over Postgres
and Redis with a worker process and a long-poll event stream. The ledger already runs behind
`node:http` in the HTTP fake, on a `KeyValue` interface, with bearer tokens, flags, bots and the
world boss, and "every server host runs the same ledger" is the glossary's rule. So the real
server **is** that host, with one change: the store. The fake's file store rewrites the whole
snapshot on every operation, which fails past a few dozen accounts; a SQLite `KeyValue` (one
table, WAL on) replaces it. Presence, chat and the world snapshot stay in process memory, and the
world snapshot is built once a second and served from memory. Postgres, Redis and a worker come
back when a measured number says the host cannot keep up, not before.

## Considered options

- **Spec §8 as written**: NestJS, Postgres, Redis, Drizzle, a worker, Redis Streams. Rejected for
  the launch: weeks of work and three daemons on a shared box, for load the single host carries
  with room (2,000 players poll at 133 requests a second at rest, 400 during a world boss, and
  replay about a thousand integer-math ticks a second).
- **The file store as is**: zero work. Rejected: one whole-snapshot write per ledger operation.
- **Postgres under `KeyValue`**: the same adapter shape over a daemon. Rejected for now: the
  daemon is the cost, and SQLite's one file is the backup.

## Consequences

- Spec §8 and §12 (phase 5) are amended to this host; the long-poll event stream, the worker and
  the server lease stay out until a number asks for them.
- The HTTP fake and the real server are one program with different flags; a bug fixed in one is
  fixed in the other, and the contract suite is the real server's suite.
- Durability is SQLite's: nothing committed is lost on a crash; the nightly off-box copy of one
  file is the disaster backup.
- The leaderboards scan every account; with SQLite they are recomputed on a timer, not per
  request.
- The glossary's **Host** already names "the real server"; the term now means this host, not a
  separate program.
