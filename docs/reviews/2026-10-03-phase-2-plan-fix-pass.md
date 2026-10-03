# Phase 2 plan: review wave and fix pass

Plan: `docs/plans/2026-10-03-promptfall-phase-2.md` at `54262d1`. One wave on 2026-10-03:
`reviewer` on opus (xhigh), `reviewer` on fable (xhigh), `codex-review` on gpt-6-astra at xhigh
(log `~/.claude/codex-runs/20261003-004439-209-plan-review-promptfall-p2.log`, exit 0, 737 s).
Consolidated inline on Fable. Findings are evidence; each line below is the ruling.

## Blockers, all three legs

1. **Bootstrap as a write.** The plan made every bootstrap a new committed point; the secondary
   session bootstraps every 10 s, so a trade followed by a secondary refresh cost the primary a
   flush (`hash_mismatch`) or looped on `cursor_behind` with an empty delivery. Ruling: bootstrap
   writes nothing for a known token. The record keeps `committedState` beside the effective
   `state`; bootstrap answers the committed state, cursor and hash plus the log as a delivery.
   Only state-carrying refusals and `host.settle` move the committed point. Log ring of 500.
2. **Flush and trade unserialised.** A timed flush during a market call could clear `pending`
   under a delivery or re-step without the in-flight batch. Ruling: one lock around every server
   call in the engine; `receive` only inside it; the timer skips while the lock is held.
3. **Outage retries not idempotent.** A fresh `batchId` on retry turned a lost ack into
   `seq_mismatch` and dropped the outage buffer. Ruling: the batch in flight is immutable until
   answered and retried verbatim; later events queue behind it; a `duplicate` with a foreign hash
   resyncs through a read-only bootstrap.

## Majors, taken

- Outage pause blocked its own retry (engine guard): outage is its own state; retries bypass the
  120 s apply guard; `after` is a required dep. Manual A4 allows 45 s.
- Thrown bootstrap unhandled: enters the outage state, retries `start()`.
- `switchServer` during an outage: drops the unsent buffer and reports the count (chosen over
  refusing the switch; nothing moves between servers anyway).
- `AccountInfo` lacked `delivery`; reads lacked an `unauthorized` shape: both added.
- Mirror under-specified: it mirrors the engine (committed, pending, cursor).
- "Committed state" wording in the ledger rules meant the effective state: fixed; an authored
  event that would be rejected makes the ledger throw without writing.
- v1 store path unreachable (dialog returns early without a view): the Account tab renders
  without a view; the ledger tolerates a v1 record; manual A6 expects the notice.
- Virtual clock rewound on restart: `{ virtualAt, realAt }` persisted; monotonic resume.
- Snapshot per `set` left a buy half-durable: `KeyValue.flush?()`, called once per ledger
  operation; the file fake persists there.
- Expiry only on the 60 s sweep: `expireDue` runs inside every market call.
- Returns stored bare `Goods`: now `{ listingId, goods }`, with a `pf:returns` index for sweep,
  delivered per kind, hero unchanged (the reset is for transfers only).
- `market_closed` vs cancellation: cancels work with the market closed (spec §5 amended).
- `URLSearchParams` under the vendor tsconfig: hand-rolled encoder; a vendor check for it.
- Task 2 could not type-check with the suite frozen: mechanical suite edits allowed in Task 2.
- Bot seed script yielded no bosses or spare heroes: seeded gold, periodic vendoring and
  recruits, and a population assertion in the test.
- Countdowns against `$.clock.now()` wrong at `--speed 10`: `ServerConfig.serverNow` and
  `speed`; the dialog shows real time left.
- Cooldown not visible to the sell flow: `tradeableAt` in both owned-goods views.
- Base and class filters missing from the Market tab: added; buy confirm on `y`.
- `pnpm fake -- --port` double separator (probed): root script without `--`, `cli.ts` strips one.

## Minors, taken

`placeOrder` needs Rare+; the in-process host sweeps before each timed flush; the reset keeps the
lease; `apply` takes `PlayerEvent`; `draft`/`reject` move to `draft.ts` (import cycle); two
constructors, not three; `pushLog` is in `heroes.ts`; Task 3 recovers `local.ts` via `git show`;
`market.enabled` default resolved in the ledger; post-commit `hash_mismatch` state taken after
`deliverReturns`; `promptfall:server` is machine-wide; link polling owned by the session; Task 5
split into 5a and 5b; `GameStateSchema` named; `createFakeServer` and `startBots` signatures
named; `granted` renamed `credited` (CONTEXT.md avoids "grant"); spec §7's event list and §9's
sweep wording follow the plan.

## Not taken

- Refusing `switchServer` during an outage (fable/codex variants): a dead fake would then trap
  the player on it; dropping with a count is honest and bounded by the 2-minute buffer.
- A durable multi-key transaction for the in-process host: `$.store` has no atomic multi-key
  write; phase 1 already accepts that, recorded under Out of scope.
