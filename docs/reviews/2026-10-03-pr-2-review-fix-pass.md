# Phase 2 PR 1 fix pass: PR #2 review consolidation

Consolidates the three-leg review of PR #2 (`feat/phase-2` into `ai-staging`, Tasks 1 to 6 of
`docs/plans/2026-10-03-promptfall-phase-2.md`): `codex-review` on gpt-6-astra at xhigh,
`reviewer` on opus, `reviewer` on fable, plus the main session's verification of each finding and
its manual pass (both parts, against the fake, green). Written by `reasoner` (fable) on
2026-10-03; the main session (opus) executes it item by item, test first. One fix pass, no second
review wave: after it, the verification line, a re-run of manual-pass steps 3 to 6, then Kevin's
own pass and GREEN.

Contract: the plan's "Shared contracts" section stays binding. No item below changes it except
where section "Needs Kevin's ruling" says so, and that one is not executed until he rules.

PR #3 (`feat/phase-2-market`) is stacked on this branch: every fix lands on `feat/phase-2` and is
merged forward. The items that touch PR 3 are flagged inline and collected at the end.

## Decisions that cut across items

**A demoted session discards its engine.** Item 1 fixes the stale-batch retry by replacing the
engine on demotion, the same move `useServer` already makes for a switch. The plan already says a
demoted primary's buffer is never submitted and that promotion clears it, so nothing the player
could have kept is lost; what goes away is the retry timer and the publishes of an engine that no
longer owns the view. Items 5 and 9 ride on the same engine lifecycle.

**The timeout lives in the transport, not the engine.** Item 3 puts a 15 s timeout in the
session's `$.http.fetch` adapter. A fetch that does not answer in time becomes a thrown fetch,
which `HttpClient` already reports as `ServerUnreachable` and the engine already treats as an
outage. The in-process ledger cannot hang, so the engine needs no timer of its own and its tests
stay as they are.

**Thrown-is-outage stays until Kevin rules.** Finding F asks whether a 4xx on submit should keep
being retried forever. That is a contract sentence, so it is in "Needs Kevin's ruling" with both
options costed, and nothing in this pass depends on the answer.

**Dismissed or deferred, with the reason written down**: L (ledger guards go in with the first
real `host.credit` caller, PR 3 Task 8), M (phase 5), T (PR 3 Task 7), Q, N, R, V. Sections
"Deferred" and "Dismissed".

## Order and method

Items run in the order below. Each one: write the test, see it fail, make the change, see it
pass, commit. Items touching `packages/ledger` or `packages/protocol` end with
`pnpm vendor && pnpm vendor:check` (the plugin tests read the committed bundles). The
`register.test.ts` `remote()` helper gains `requests: { method: string; path: string }[]` and
returns its `ledger` in item 1; later items use both.

1. Demoted primary keeps its engine alive and retries a stale batch (A)
2. HTTP fake dies on an undecodable path segment (B)
3. A server that accepts and never answers holds the engine forever (C)
4. `claim()` promotes on a stale server setting (H)
5. `trade` runs the market call after a pausing flush (E)
6. A secondary with an unknown token mints an orphan every 10 s (D)
7. Trailing slash makes a second account on the same server (I)
8. Link code stays on screen after a switch; `link()` rejects out of a press (J, K)
9. A stopped engine writes its token after reset or switch (G)
10. Read-only reason and the doubled band prefix (O)
11. The fake's default data path is under `servers/fake` (P)
12. Ledger flush bookkeeping (S, U)
13. Test gaps: re-step reject, drop count, rule 10

---

## 1. Demoted primary keeps its engine alive and retries a stale batch (A)

**Finding.** All three legs; verified. `engine.ts` lines 469 to 472: the outage retry callback
checks `outageGen`, `outage` and `stopped`, then runs `doFlush()` straight through the engine's
lock. `register.tsx` `becomeSecondary` (line 323) changes the role and refreshes; the engine is
untouched, so its retry timer fires and submits the batch it held when the lease was lost. The
15 s path (`flushIfOwner`) checks `holds()` first; the retry path bypasses it. If the stale batch
lands after the new primary bootstrapped, the new primary's next batch gets `seq_mismatch` and
adopts, losing up to a flush interval; the old engine also publishes its ack's view over the
secondary's read-only view.

**Decision.** `becomeSecondary` replaces the engine when the session was primary:

```ts
private async becomeSecondary(): Promise<void> {
  if (this.role === 'primary') {
    this.engine.stop()
    this.engine = this.makeEngine()
  }
  this.role = 'secondary'
  ...
```

`stop()` already sets `stopped`, clears `outage` and bumps `outageGen`, so the pending retry
callback returns at its first check and a stopped engine's `publish` is a no-op. `becomePrimary`
calls `engine.start()`, which the fresh engine answers with a bootstrap, as today. The
`start()`-time and `restart()`-time calls to `becomeSecondary` run with `role === 'secondary'`
and make no second engine. A submit already in flight at the moment of demotion still lands on
the server; that is the phase 1 race `flushIfOwner` narrows and this item does not widen it.

Delete the comment on `register.tsx` line 149 ("A demoted primary keeps its buffer...") and
replace it with one line saying the demotion discards the engine.

**Files.** `plugins/promptfall/hooks/register.tsx`; `plugins/promptfall/hooks/register.test.ts`.

**Test first.** In `register.test.ts`, extend `remote()` so `net` also records
`requests.push({ method, path })` for every fetch, and return `{ ...net, ledger }`. New test "a
primary demoted during an outage never submits the batch it held": start on `URL_A` through
`/promptfall server`, `turn.start`, three tool calls, `net.down = true`, `time.advance(16_000)`
(notice is `RETRYING_NOTICE`; one `POST /v1/batches` recorded). Then
`data.set(LEASE, { owner: 'someone-else', until: 9_999_999_999_999 })`, `time.advance(10_000)`,
expect `mode` `secondary`. `net.down = false`, `time.advance(60_000)`. Assert the count of
`requests` with `path === '/v1/batches'` is still 1, and that `last.get('mode')` is
`secondary`. Before the fix the retry at 1 s, 2 s, 4 s... submits once the network is back
(count 2). Keep the existing test "a demoted primary stops flushing, and the welcome shows once":
it must still pass (the welcome is latched on the session, not the engine).

**Done when** `claude plugin test plugins/promptfall` passes with the new test; the two existing
lease tests unchanged.

## 2. HTTP fake dies on an undecodable path segment (B)

**Finding.** All three legs; opus and fable reproduced. `servers/fake/src/server.ts`: `handle`
runs `new URL(...)` and `match()` (which calls `decodeURIComponent` on `:id` segments) before
its `try`; `createServer` calls `void handle(req, res)`. `DELETE /v1/listings/%E0%A4%A` throws
`URIError` synchronously inside `handle`, the promise rejects unhandled, Node exits, and the
request hangs. One malformed request from any client kills the dev server.

**Decision.** Two small changes. `match()` treats an undecodable segment as no match:

```ts
try { params[p.slice(1)] = decodeURIComponent(v) } catch { return null }
```

so the request is answered `404 { error: 'route' }`. And `handle` moves its whole body, routing
included, inside the existing `try`, so anything else that throws before the handler runs
(including `new URL` on a hostile request line) is answered `500 { error: 'internal' }` instead
of escaping. No `unhandledRejection` handler in `cli.ts`: a crash from a real bug should still
crash.

**Files.** `servers/fake/src/server.ts`; `servers/fake/src/server.test.ts`.

**Test first.** In `server.test.ts`, under `describe('HTTP fake')`: "an undecodable path segment
is a 404 and the server stays up": `raw('DELETE', '/v1/listings/%E0%A4%A', { token })` answers
`{ status: 404, body: { error: 'route' } }`; then `raw('GET', '/v1/health')` answers 200.
Before the fix the first call hangs until the test times out (the process exits in `cli.ts`; in
vitest the rejection surfaces as an unhandled error).

**Done when** `pnpm --filter @promptfall/fake-server test` passes with the new case.

## 3. A server that accepts and never answers holds the engine forever (C)

**Finding.** Opus medium, fable consider; verified. `HttpInit` in the engine's declarations
(`.claude-plugin/types/claude-code/index.d.ts` line 4898) has `method`, `headers`, `body`,
`auth`, `socketPath`: no timeout and no signal, and nothing says the host times out on its own.
A fetch that never settles keeps `doFlush` awaiting under the lock: no outage is entered (nothing
threw), `flushIfIdle` returns at once while `held > 0`, the band keeps ticking with no notice,
and `/promptfall server local` waits on `engine.flush()` and never returns.

**Decision.** A timeout in the session's fetch adapter, in `register.tsx`, shared by the two
places that build an `Io`:

```ts
const FETCH_TIMEOUT_MS = 15_000

/** `$.http.fetch` that gives up after `FETCH_TIMEOUT_MS`: a hung server is an outage, not a held lock. */
function timedFetch(http: (url: string, init: HttpInit) => Promise<HttpResponse>,
                    after: (ms: number, fn: () => void) => Timer): FetchLike {
  return (url, init) =>
    new Promise((resolve, reject) => {
      const timer = after(FETCH_TIMEOUT_MS, () => reject(new Error('timeout')))
      http(url, init).then(
        (r) => { timer.cancel(); resolve({ status: r.status, ok: r.ok, text: r.text }) },
        (error) => { timer.cancel(); reject(error) },
      )
    })
}
```

Both `Io` literals use `fetch: timedFetch($.http.fetch, (ms, fn) => $.clock.after(ms, fn))`.
`HttpClient` turns the rejection into `ServerUnreachable`; the engine enters the outage and
retries on the backoff, as for a refused connection. 15 s is the flush interval: a hung call
costs at most one skipped flush, and a bootstrap carrying a full state (about 10 KB measured on a
state after 20 000 events) is nowhere near it. Nothing changes in `engine.ts`, so the engine
tests' exact timer lists (`the backoff doubles up to 30 s...`) are untouched.

**Files.** `plugins/promptfall/hooks/register.tsx`; `plugins/promptfall/hooks/register.test.ts`.

**Test first.** In `register.test.ts`, using the file's own `clock(on)` helper (its `after`
honours cancel through `next.signal`): "a server that never answers is an outage after 15 s".
`store(on, { 'promptfall:server': URL_A })`, `on('http.fetch', () => new Promise(() => {}))`,
session start. `time.advance(14_000)`: `last.get('notice')` is not `RETRYING_NOTICE`.
`time.advance(2_000)`: it is. Then `/promptfall server local` resolves with
`Promptfall now plays on in-process` (before the fix the command never returns, because
`engine.flush()` queues behind the hung `doStart`). Before the fix the notice never appears.

**Done when** the plugin tests pass, including the three existing server tests, whose
`remote()` fetch answers at once and never hits the timer.

## 4. `claim()` promotes on a stale server setting (H)

**Finding.** Codex P2; verified. `renew()` (line 331) follows the machine-wide setting only while
`role === 'secondary'`; `claim()` (line 286) promotes without reading it. A secondary that the
player types into inside the 10 s after another session switched servers becomes primary on the
old server, and since primaries never follow the setting, it stays there until it is demoted
or restarted: one session plays on A, the machine says B.

**Decision.** Factor the two lines of `renew()` into `followSetting()` and call it from
`claim()` before `claim(kv, ...)`:

```ts
/** The server setting is machine-wide: a session that is not primary follows a switch made elsewhere. */
private async followSetting(): Promise<void> {
  const setting = await this.readSetting()
  if (setting === this.setting) return
  this.useServer(setting)
  await this.io.publish({ server: setting })
}
```

`renew()` keeps its `role === 'secondary'` guard around the call; `claim()` calls it after its
`role === 'primary'` early return, so a primary is never re-pointed.

**Files.** `plugins/promptfall/hooks/register.tsx`; `plugins/promptfall/hooks/register.test.ts`.

**Test first.** "the player's claim follows a server switch made in another session":
`store(on, { 'promptfall:lease': { owner: 'other', until: 9_999_999_999_999 } })`,
`remote(on)`, session start (`mode` `secondary`, `server` null). Then
`data.set('promptfall:server', URL_A)` and at once
`$.prompt.submit({ ..., origin: { kind: 'composer' } })`. Assert `mode` `primary`,
`last.get('server')` is `URL_A`, `(last.get('view') as GameView).account.server` is `URL_A`,
and `data.has('promptfall:token:' + URL_A)`. Before the fix the view says `in-process`.

**Done when** the plugin tests pass; "the session the player uses takes the lease back" unchanged.

## 5. `trade` runs the market call after a pausing flush (E)

**Finding.** Opus low; verified. `engine.ts` `trade()` checks `paused` before taking the lock,
then `doFlush()`, then checks only `outage`. A flush ending in `version_gate`, `sim_version` or
`unauthorized` sets `paused` and the market call still runs. The engine contract says `trade`
throws `not_primary` when the engine is paused. PR 3's Market and Orders tabs are the callers.

**Decision.** One line after the flush, before the token check:

```ts
if (this.paused !== null) throw new Error('not_primary')
```

**Files.** `plugins/promptfall/hooks/engine.ts`; `plugins/promptfall/hooks/engine.test.ts`.

**Test first.** "a flush that pauses the engine stops the trade": start, `apply tick`,
`client.fakeNextAck = { ok: false, reason: 'unauthorized' }`, then
`engine.trade(async () => { called = true; return { ok: false, reason: 'gone' } })` rejects
with `not_primary`; `called` is false; `engine.isPaused()` is true. Before the fix `called` is
true and the promise resolves.

**Done when** the plugin tests pass.

## 6. A secondary with an unknown token mints an orphan every 10 s (D)

**Finding.** Opus low-medium; plausible from code, reproduced by reasoning: the fake restarted on
a new `--data` file leaves `token:<url>` pointing at an account the server no longer has.
`refresh()` (line 346) bootstraps with it; the ledger mints a fresh account for an unknown token
and the secondary shows it, writes nothing, and does it again at the next renewal: one orphan
account on the server every 10 s for as long as the session is a secondary. The primary mints
and stores a new token at its next `start()`; between a server reset and that start, or while the
primary sits paused on `MISMATCH_NOTICE`, the orphans pile up.

**Decision.** Latch the token the server did not recognise:

```ts
private orphanToken: string | null = null
...
const token = await this.kv.get(this.server.tokenKey)
if (typeof token !== 'string' || token === this.orphanToken) return
...
if (boot.deviceToken !== token) {
  // The server minted for this token: it is unknown there. Wait for the primary to store a new one.
  this.orphanToken = token
  return
}
```

`useServer` resets `orphanToken = null`. The first unknown bootstrap still mints one orphan; the
protocol has no read-only bootstrap and this pass does not add one.

**Files.** `plugins/promptfall/hooks/register.tsx`; `plugins/promptfall/hooks/register.test.ts`.

**Test first.** "a secondary stops bootstrapping with a token the server does not know":
`store(on, { 'promptfall:server': URL_A, ['promptfall:token:' + URL_A]: 'stale', 'promptfall:lease': { owner: 'other', until: 9_999_999_999_999 } })`,
`const net = remote(on)`, session start, `time.advance(30_000)`. Assert the count of
`requests` with `path === '/v1/bootstrap'` is 1. Then mint a known token through
`net.ledger.bootstrap({ clientVersion: '0.1.0', deviceToken: null })`, write it to the store
key, `time.advance(10_000)`: the count is 2 and `last.get('view')` is truthy. Before the fix the
first count is 4.

**Done when** the plugin tests pass.

## 7. Trailing slash makes a second account on the same server (I)

**Finding.** Codex P2, opus consider; verified. `command.ts` `serverTarget` accepts any
`https?://\S+`; `server.ts` builds `tokenKey = 'token:' + setting` from it unchanged, while
`HttpClient` strips one trailing slash. `http://x:7777` and `http://x:7777/` are two settings,
two token keys, two accounts on one server, and two labels in the view.

**Decision.** Normalise once, where the URL enters: in `serverTarget`,
`const url = rest.replace(/\/+$/, '')` before the regex test, and return `url`. Everything
downstream (setting, token key, label) then agrees.

**Files.** `plugins/promptfall/hooks/command.ts`; `plugins/promptfall/hooks/register.test.ts`
(the command harness has no `http.fetch` mock; the register file has `remote()`).

**Test first.** "a trailing slash on the server URL is dropped": `remote(on)`, start,
`/promptfall server ${URL_A}/`; the reply is `Promptfall now plays on ${URL_A}` (no slash),
`data.get('promptfall:server')` is `URL_A`, `data.has('promptfall:token:' + URL_A)`.

**Done when** the plugin tests pass.

## 8. Link code stays on screen after a switch; `link()` rejects out of a press (J, K)

**Findings.** J: codex P2, fable consider; verified. `useServer` bumps `linkGen`, so the poll
stops, but nothing clears `dialog.link`: the code stays on the Account tab with no poll behind it
until a reset or a later link completes. A hot reload leaves the same orphaned code, since the
dialog atom survives the reload and the poll does not. K: fable consider. `link()` is the
`onPress` of `Link GitHub`; `engine.call` throws `unreachable` during an outage and `linkStart`
throwing is rewrapped the same way, so the press returns a rejected promise the UI drops on the
floor. What the host does with an unhandled rejection from a plugin is not documented; it should
not get one.

**Decision.** J: `restart()` clears the link (`await this.io.dialogLink(null)`) before
`becomePrimary`/`becomeSecondary`, and `start()` clears it once before acquiring the lease;
`reset()` drops its own call since it goes through `restart()`. K: `link()` swallows the start
failure:

```ts
let start: LinkStart | Unauthorized
try {
  start = await engine.call((client, auth) => client.linkStart(auth))
} catch {
  return
}
```

The band already carries the outage notice; a press that does nothing during an outage is the
right amount of feedback.

**Files.** `plugins/promptfall/hooks/register.tsx`; `plugins/promptfall/hooks/register.test.ts`.

**Test first.** Two tests. "a server switch clears a pending link code": in-process start,
mount the pane, `tab-account`, `link-github` (the `Enter ... at` line is found), then
`/promptfall server ${URL_A}` with `remote(on)`; assert
`(last.get('dialog') as { link: unknown }).link` is null. Before the fix it still holds the
code. "pressing Link GitHub during an outage does nothing": start on `URL_A`, `net.down = true`,
`time.advance(16_000)`, mount, `tab-account`, `link-github`; the press resolves, no
`Enter ... at` line, the notice is still `RETRYING_NOTICE`. Whether the test kit fails a test on
an unhandled rejection is unverified, so the assertions are on the visible state.

**Done when** the plugin tests pass, including "the link flow against the in-process ledger".

## 9. A stopped engine writes its token after reset or switch (G)

**Finding.** Codex P2, opus noted, fable called it hypothetical; verified in code. `doStart`
awaits the bootstrap, then writes `tokenKey` and the state without checking `stopped`. A reset
(`stop`, delete every key, `restart`) or a switch with a bootstrap in flight lets the old
engine's write land after the delete; the next session start then bootstraps with the old token
and the reset did not reset. The window is one bootstrap round trip, so it is narrow, but the
cost of the guard is one line and the test is cheap.

**Decision.** After the `try`/`catch` around `bootstrap` in `doStart`:
`if (this.stopped) return`.

**Files.** `plugins/promptfall/hooks/engine.ts`; `plugins/promptfall/hooks/engine.test.ts`.

**Test first.** Give `Recorder` a `holdBootstrap: Promise<void> | null` awaited after
`bootstraps += 1`. "a stopped engine's in-flight bootstrap writes nothing": set the hold, call
`engine.start()` (not awaited), wait until `client.bootstraps === 1` (two `setTimeout(0)`
turns), `engine.stop()`, release the hold, await `start()`. Assert `await kv.get('deviceToken')`
is undefined and `engine.state()` is null. Before the fix the token is a string.

**Done when** the plugin tests pass.

## 10. Read-only reason and the doubled band prefix (O)

**Findings.** Opus and fable. `dialog.tsx` line 70 to 102: past 120 s of outage `canApply()` is
false with `mode` still `primary`, so the read-only header reads `Promptfall is not playing in
this session.` while the band says `Promptfall: server unreachable`. And `band.tsx` line 38, the
no-view branch, renders `Promptfall · ${notice}` though every notice already names the game
(`Promptfall: ...`, `Update Promptfall: ...`), giving `Promptfall · Promptfall: this machine's
data...`, which the manual pass currently spells out as expected.

**Decision.** Dialog: in the primary branch use the notice when there is one:
`: (notice ?? 'Promptfall is not playing in this session.')`. Band: the no-view line is
`clip(notice, width - 2)`. Update `docs/manual-pass/phase-2.md` step 6 to the unprefixed line.

**Files.** `plugins/promptfall/hooks/ui/dialog.tsx`; `plugins/promptfall/hooks/ui/band.tsx`;
`plugins/promptfall/hooks/band.test.ts` ("with no game view the band is the notice on one
line": the expected text loses the prefix); `plugins/promptfall/hooks/register.test.ts`;
`docs/manual-pass/phase-2.md`.

**Test first.** Band: adjust the existing test's expectation. Dialog, in `register.test.ts`
(the dialog harness has no failing server): "past 120 s the dialog's read-only line is the
outage notice": start on `URL_A`, `net.down = true`, `time.advance(16_000)`,
`time.advance(120_000)`, mount the pane; `ui.find({ text: /Promptfall: server unreachable/ })`
is defined and `ui.find({ text: /not playing in this session/ })` is undefined.

**Done when** the plugin tests pass.

## 11. The fake's default data path is under `servers/fake` (P)

**Finding.** Opus noted; confirmed by the main session. `pnpm fake` is
`pnpm --filter @promptfall/fake-server start`, which runs the script with the package directory
as its cwd, so the default `--data .promptfall/fake.json` resolves to
`servers/fake/.promptfall/fake.json`. Manual-pass step 7, run "from the repository root", looks
in `.promptfall/fake.json` and finds nothing. The main session's pass gave `--data` explicitly.

**Decision.** Resolve the default against where `pnpm` was invoked:
`const data = resolve(process.env.INIT_CWD ?? process.cwd(), values.data)` in `cli.ts`. pnpm
(like npm) sets `INIT_CWD` to the invoking directory (asserted from knowledge of pnpm, not from
a file in this tree); an absolute `--data` is unaffected since `resolve` restarts at an absolute
segment, and running `tsx src/cli.ts` by hand keeps today's behaviour. The manual-pass doc is
then right as written.

**Files.** `servers/fake/src/cli.ts`.

**Verification** (no unit test reaches `cli.ts`): from the repository root,
`pnpm fake --port 0` prints `data /Users/.../tbh-cc-mod/.promptfall/fake.json`; Ctrl-C. Paste
the line in the commit body.

## 12. Ledger flush bookkeeping (S, U)

**Findings.** Fable noted both. S: `books.ts` `TrackedKeyValue.flush` sets `dirty = false`
before `await this.inner.flush?.()`, so a flush that throws (disk full on the fake) is not
retried by the next read-only operation; the data stays in memory and goes out with the next
write. U: `Ledger.run` flushes in `finally`, so an operation that throws after a `set` persists a
partial write. Today every mutating path orders its writes last or validates first (`author`
throws before `record` is touched), so it holds; it deserves one sentence where the next person
will read it.

**Decision.** S: swap the two lines so `dirty` clears only after a successful flush. U: a
comment on `run()`: "The flush runs even when `fn` threw, so an operation must validate before
its first `set`; `author` throws before it touches the record for that reason."

**Files.** `packages/ledger/src/books.ts`; `packages/ledger/src/ledger.ts`;
`packages/ledger/src/ledger.test.ts`; then `pnpm vendor && pnpm vendor:check`.

**Test first.** Under `describe('Ledger flush')`: "a failed flush is retried by the next
operation": a `KeyValue` over `MemoryKeyValue` whose `flush` throws on its first call and
counts calls; `host.credit(...)` rejects; `account(auth)` resolves and the count is 2. Before
the fix the count is 1.

**Done when** `pnpm --filter @promptfall/ledger test` passes and `vendor:check` is clean.

## 13. Test gaps: re-step reject, drop count, rule 10

**Re-step producing a rejected effect** (`engine.test.ts`). The initial roster is `h0` to `h3`
with `h3` benched and bare, and a hero's `listed` needs only that (checked in
`server-events.ts` lines 46 to 52). "a server event that invalidates a buffered event re-steps
it as rejected": start, `engine.apply({ t: 'set_party', heroIds: ['h0', 'h1', 'h3'] }, at())`,
then `client.fakeNextAck = { ok: false, reason: 'cursor_behind', delivery: { cursor: 1, events: [{ n: 1, event: { t: 'listed', listingId: 'L1', kind: 'hero', id: 'h3', fee: 0 } }] } }`,
`await engine.flush()`. Assert `effects` contains `'rejected'` exactly once and
`client.acks.at(-1)` has reason `cursor_mismatch` (the resubmit at cursor 1 meets a ledger at
cursor 0 and the engine adopts; that is the fake delivery's doing, not a bug). This proves the
`restep` path hands `rejected` to `onEffects`; the pane notice wiring from `onEffects` is
already covered by the direct-apply tests.

**Drop count** (`register.test.ts`, "/promptfall server local during an outage..."): replace
the `\d+` match with a capture and `expect(Number(m[1])).toBeGreaterThanOrEqual(4)`: three tool
calls sat in the failed batch and one more in the buffer; ticks depend on cadence and are not
pinned.

**Rule 10** (`packages/protocol/src/contract/suite.ts`): after `expect(after.seq).toBe(0)`,
add `expect(after.state).toEqual(boot.state)` and `expect(after.cursor).toBe(0)`: the
`cursor_mismatch` neither committed a batch nor moved the committed point. Then
`pnpm --filter @promptfall/ledger test && pnpm --filter @promptfall/fake-server test` (both run
the suite) and `pnpm vendor:check`.

---

## Needs Kevin's ruling: F, a refused batch is retried forever

**Finding.** Fable medium-low, opus consider. `HttpClient` throws `ServerError` on any non-200
and on a 200 body that fails its schema; the in-process `Ledger.submit` throws `ZodError` on a
batch that fails `BatchSchema`; `engine.ts` line 240 catches every throw as an outage and retries
the same batch verbatim. A batch the server will refuse every time (a `clientVersion` that fails
the `^\d+\.\d+\.\d+$` regex, more than 2000 events, a schema change the bundle has not caught up
with) freezes the game after 120 s under `Promptfall: server unreachable`, with nothing telling
the player or the developer why.

**What is reachable today.** Nothing: `CLIENT_VERSION` is generated from `plugin.json`
(`0.1.0`), batch ids are UUIDs, `at` is floored, a buffer cannot reach 2000 events before the
server rate cap answers, and `vendor:check` keeps the bundle and the server on one schema. The
phase 5 case is the real one: a server that tightens `BatchSchema` would 400 an old client at
step 0, before step 4 can answer `version_gate`.

**The contract sentence.** Global constraints: "A thrown submit or bootstrap is an outage."
Engine contract, `flush()`: "Thrown: outage (below), `sent` kept."

**Option (a), keep it.** No code change. Add one line to the plan's "Out of scope" or the phase
5 notes: the real server runs the version gate before the body schema, so an old client is told
to update rather than refused at 400. Cost now: zero. Risk: a future schema mistake shows up as
a silent freeze in development, caught by the first manual pass.

**Option (b), a `ServerError` on submit drops the batch and resyncs.** In `doFlush`'s catch:
if `error.name === 'ServerError'`, `this.notice('Promptfall resynced', 10_000)`, `await this.doResync()`, return; otherwise the outage as today. Bootstrap keeps thrown-is-outage. Engine
only, about eight lines, one engine test with the `Recorder` throwing an error named
`ServerError` (bootstraps become 2, the batch is gone, the next flush is `ok`). Cost: a
transient 500 during a server deploy loses up to one flush interval instead of retrying
losslessly; a body that fails its schema still ends in an outage because the resync's bootstrap
fails the same way. The sentence becomes: "A thrown submit or bootstrap is an outage, except a
submit that threw `ServerError` (a non-200 or a body failing its schema), which drops the batch
and resyncs."

**Lean.** (a), by a little: nothing can trigger it in phase 2 or PR 3, and (b) trades a
lossless retry on transient 500s for a diagnosis aid that the phase 5 server design (gate before
schema) removes the need for. If Kevin wants the freeze impossible rather than unreachable, (b)
is ready as written and does not disturb any other item here.

## Deferred

- **L, ledger values the wire schemas refuse** (`credited.reason` over 64 chars, negative or
  non-integer `gold`, a minted `name` over 128): one bad `host.credit` makes every response for
  that account fail `HttpClient`'s parse, a permanent outage with no way out but a reset. No
  caller exists yet. **PR 3, Task 8**, with the bots as the first caller: `credit` throws on
  `!Number.isInteger(gold) || gold < 0 || reason.length > 64`, `mint` on `name.length > 128`;
  one test each in `ledger.test.ts`. The `.strict()` suggestion for `ItemSchema`/`HeroSchema`
  is dismissed: an unknown field can only come from a sim version the other side does not run,
  and `simVersion` refuses that batch before any hash is compared.
- **M, a delivery with a gap** (`fresh[0].n > cursor + 1` after a 500-entry log fold or a
  `host.settle` on a player's account) is applied on a committed state that lacks the folded
  head; the next flush gets `cursor_mismatch` and adopts. Needs 500 server events between two
  flushes, or a `settle` on a player, neither of which PR 3 produces. **Phase 5 hardening**: in
  `receive`, a gap triggers `doResync()` instead of applying.
- **T, `expireDue` runs before `authenticate`** in `marketRead`/`marketWrite`: harmless while
  `expireDue` is empty, write work for unauthenticated callers once PR 3 fills it. **PR 3,
  Task 7**: move the `expireDue` call after the authentication check in both helpers; one case
  in `market.test.ts`, an unauthenticated `buy` leaves an expired listing open.
- **Q, the virtual clock steps back** after a SIGKILL during a read-only stretch and a restart
  at a lower speed (the clock is persisted on writes only). Dev tool, two unusual events in a
  row, and the ledger's arithmetic tolerates it (`max(0, now - refillAt)`; deadlines get
  longer, not shorter). If it ever bites: flush the snapshot from the sweep timer in `cli.ts`.
  Noted here, nowhere else.

## Dismissed

- **N, the Reset button shows during a first-start outage.** It does what its label says, and
  the first-start case (store points at a server that is down, no view) is exactly where a player
  who gave up on that server needs it. Hiding it would need a second notice to explain why.
- **R, `switchServer` drops a tick or two** between `flush()` and `useServer`. The plan says one
  flush; the window is milliseconds and the loss is a tick.
- **V, plugin store size.** Measured: a state after 20 000 events with a full 30-slot inventory
  and a 50-line loot log is 10.4 KB (`JSON.stringify`); an item is about 100 B, a hero about
  210 B. Worst case with expanded caps: two states at about 25 KB each, a 500-entry log of
  goods-carrying events at about 300 B each (150 KB), the 200-entry batch ring (14 KB): about
  220 KB for the one in-process account, under 6% of the 4 MiB cap.

## PR 3 interactions

- Item 1: `becomeSecondary` discards the engine; PR 3's tabs reach the engine through
  `GameSession.trade`/`sync`, which already check the role. No change on their side.
- Item 5: PR 3's market calls depend on `trade` throwing `not_primary` after a pausing flush;
  the Market tab should show the pause notice, not a market refusal.
- Item 8: `restart()` now clears `dialog.link`; PR 3's dialog state additions must keep `link` in
  `DialogState`.
- L and T land in Tasks 8 and 7 as written above. Append this line to each task's Work
  paragraph when PR 3 resumes: "PR 1 review follow-up: see
  `docs/reviews/2026-10-03-pr-2-review-fix-pass.md`, Deferred."

## Verification

`pnpm lint && pnpm typecheck && pnpm test && pnpm vendor:check` in one run, then
`claude plugin validate plugins/promptfall` (still `http.fetch` and no new namespace) and
`claude plugin test plugins/promptfall`. Re-run manual-pass steps 3 to 6 against the fake
(outage, recovery, link, switch back) and step 7 from the repository root without `--data`.
Paste the outputs in the fix commits or the PR comment.
