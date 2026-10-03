# PR 4 review, Opus leg

**Verdict: no blocker or major survives.** The ledger's mutex and flush discipline holds. `world()` writes nothing to the store, so it never flushes. `chat()` validates before it mutates anything. `offerZone` copies the rows before changing them. The bots' mirror protocol is correct (cursor_behind, adopt, stipend, market deliveries). The poller's epoch and generation guards also hold. What survives is three minor defects (one in the code, one plan-conform behaviour that can make a manual-pass step read red, one wrong doc line) and some test gaps.

Scope reviewed: `git diff ai-staging..feat/phase-3` under packages/, servers/fake, plugins/promptfall (vendor excluded), plus docs/manual-pass/phase-3.md and the READMEs.

Verification I ran:
- `pnpm --filter @promptfall/ledger test`: 104 passed.
- `pnpm --filter @promptfall/fake-server test`: 72 passed.
- Both ran on the working tree, which is PR 2's head. PR 2 touches ledger/world.ts, ledger.ts, bots.ts and suite.ts, so this is not a run of PR 1 alone.
- An HTTP repro script against `createFakeServer`, output quoted below.
- I did not run `claude plugin test`.

## Act on

1. **minor, CONFIRMED: a chat line over 2000 UTF-16 units flashes `Server unreachable` instead of the too-long refusal.**
   - Where: `packages/protocol/src/world.ts:99` (`ChatBodySchema` is `.max(2000)`), `servers/fake/src/server.ts:175`, `plugins/promptfall/hooks/register.tsx:366-377`, `plugins/promptfall/hooks/ui/chat.tsx:25-48`.
   - Scenario: paste 2001+ characters into the compose box and press Enter. The fake answers 400 schema. HttpClient throws a ServerError with status 400. `GameSession.chat` catches every throw as `unreachable`, so `errorText` flashes `Server unreachable` while the server is up.
   - Repro output: `201: {"ok":false,"reason":"too_long"}` / `2001 threw ServerError 400 POST /v1/chat: status 400`.
   - This contradicts the plugin README ("a line over 200 characters … flashes") and spec §7's meaning of the unreachable text.
   - Fix: in `postChat`, check the length locally the same way it already refuses an empty line (`text.replace(/\p{Cc}/gu,'').trim().length > CHAT_MAX_CHARS` flashes `chatRefusalText('too_long')`). Or have `GameSession.chat` map a ServerError with a 4xx status to `{ ok: false, reason: 'too_long' }`.

2. **minor, CONFIRMED (follows the plan's formula): the chat bucket keeps counting while it is full, so an idle account gets about 6 quick messages, not 5.**
   - Where: `packages/ledger/src/world.ts:118-125` (`refillChat`).
   - Scenario: an account posts at T, idles until T+95 s, then posts 5 lines. At T+100 s a sixth line also passes. Repro: `burst true,…,true` (11 of 11 accepted across T, T+95 s, T+100 s). While the bucket is full, `refillAt` only moves by whole periods, so up to 9.99 s of "credit" waits for the first spend.
   - Effect on the manual pass: part A step 4 expects "the fifth or sixth reads `Slow down`". If Kevin types the burst more than about 5 s after `hello`, the seventh can be the first refusal, which is a false red. The tab text "5 quick messages, then one every 10 seconds" also overstates the limit.
   - The plan prescribes the formula ("as the batch buckets do"). For batches, a carried remainder protects a steady honest cadence; for a chat burst limit it only adds burst.
   - Fix: when the refilled tokens hit `CHAT_BUCKET_CAPACITY`, set `refillAt = now`. Rule 28 still passes. Or keep the formula and widen the step 4 wording.

3. **minor, CONFIRMED (doc): manual pass step 8's "The online count in both stays 13" cannot be read in the secondary's band.**
   - Where: `docs/manual-pass/phase-3.md` step 8; `plugins/promptfall/hooks/ui/band.tsx:79` (`collapsed = … mode !== 'primary' …`).
   - Scenario: the secondary's band is always the one-line `playing in another session · …`, with no World tab and no online count. Kevin either records a red or guesses.
   - Fix: point step 8 at the secondary's Leaderboards tab ("`Online by zone` sums to 13"), or limit the claim to the first terminal.

## Consider

4. **minor, PLAUSIBLE: a secondary that follows a switch made elsewhere keeps the old server's `boards` and `chat` atoms.**
   - Where: `register.tsx:435-440` (`followSetting` calls `useServer`, which resets only `world`; only `restart` publishes `CHAT_DEFAULT`/`BOARDS_DEFAULT`).
   - Effect: an open Leaderboards tab lists the old server's rows, unhighlighted, until it is reopened.
   - This matches the plan (only `restart` and `clearDialog` reset those atoms) and the phase 2 market atoms. Fix if wanted: publish both defaults in `followSetting`.

5. **nit, PLAUSIBLE: the in-flight guard releases before the snapshot is applied.**
   - Where: `plugins/promptfall/hooks/world.ts:121-154`. The `finally` clears `inFlight` when the fetch settles. `await deps.now()`, the state write and the publish come after that.
   - Effect: a timer tick in that window starts a second poll with the old `chatMark`. The merge drops the duplicates. An older snapshot can land over a newer one only if the second HTTP round trip beats the first poll's `$.clock.now()`, which practically never happens.
   - Fix: read `now` before the fetch, or clear `inFlight` after the publish (keeping the epoch check).

6. **minor, PLAUSIBLE: a bot bootstrap that fails at startup can crash the fake.**
   - Where: `servers/fake/src/bots.ts:336,352`.
   - Scenario: `ready` now makes HTTP bootstraps. If one rejects (say a 500), `await ready` sits outside the `try`, every `tick()` rejects, and `void tick().finally(loop)` raises an unhandled rejection, which Node turns into a process exit.
   - The pattern predates this PR, but the HTTP path adds ways to fail. Fix: move `await ready` inside the `try`, or add `.catch` on the loop promise.

## Noted

- **Chat mark after the fake's data is wiped under a running session.** `world(since > newest id)` silently answers `[]`, and the merge by id would drop new messages whose ids match old buffered ones. In practice it is covered: the engine pauses with the mismatch notice, and `/promptfall server` then runs `restart`, which resets the poller. Hardening options: the ledger answers `since >= nextId` as `since = 0`, or the poller resets when the account id changes.
- **World tab zone mismatch.** Row 1 labels `zone ${view.zone}` (local, up to 15 s ahead) while `here` comes from the server's committed zone. Briefly inconsistent after a zone change.
- **Fast cadence on a closed or gated Chat tab.** `chatSeen` runs even when the tab shows `Chat is closed.` or the link gate, so the in-process host polls every 5 s while that tab is open.
- **In-process board timing.** Step 12's "Leaderboards tab lists you alone" waits for the in-process account's first commit (up to 15 s); bootstrap offers no board row.
- **Top-level README overclaims slightly.** It says phase 3's first half built "weekly boss-damage leaderboards"; that list is always empty in PR 1. The plugin README says so correctly.
- **Known deviations, judged acceptable.**
  - `weekStart` as `int`: `weekStartOf(0)` really is negative (1969-12-29).
  - Structural d.ts types: the contract file must import nothing.
  - "Both kinds" read from listings plus sold/returned trades: hero listings sell within the run.
  - Cadence counted as GET requests: a stronger check than recorded periods.

## Dismissed

- **Display names over 128 characters failing every snapshot's schema.** Dismissed as hypothetical: only an operator's `--player-name` can produce one, and `AccountSchema` already breaks that player's own bootstrap.
- **`WorldPoller.stop()` leaving `inFlight` stuck.** Dismissed as hypothetical: `stop()` runs only when the process ends, and every `session.start` builds a new `GameSession`.
- **In-process aliasing of stored arrays (`boards.zone`, chat messages).** Nothing mutates them in place: `offerZone` copies, and chat builds new arrays.
- **Old module pollers surviving a hot reload.** Missing context: the phase 2 tick and flush timers have the same exposure and their tests cover it.
- **Cf/Zl characters (bidi overrides, U+2028) in chat.** Plan narrowing 24 scopes the stripping to `\p{Cc}` on purpose.
- **Presence zone read from `record.state` rather than `committedState`.** Server events never change the zone.
- **Two quick Enter presses posting twice.** The atom read on `busy` guards it; the leftover window is a nitpick.

## Residual test gaps

- **Rule 25 only proves 0 < TTL ≤ 45 000.** A and B poll at the same instant, and after `advance(PRESENCE_TTL_MS)` both have expired, so a 1 ms TTL passes. Add `advance(PRESENCE_TTL_MS - 1)` and expect A still online.
- **Nothing tests the speed-scaled default TTL** (`PRESENCE_TTL_MS × speed`, narrowing 4). Both contract runners use speed 1. Suggested test: a ledger with `speed: 10` keeps an account online across a 150 000 ms virtual gap.
- **Rule 26's `chat: []` with chat off is vacuous.** The closed market never had a message. A shared kv with posts made while open would prove the snapshot hides them.
- **No test pins the chat bucket's full-bucket behaviour** (finding 2), and no plugin test covers a 4xx on chat (finding 1).
- **Rule 31 never commits a raised zone.** The value path through `submit`'s `offerZone` is covered only by the unit test in `world.test.ts`; contract coverage is the row insert and the name refresh.
- **No test of a secondary's Leaderboards or Chat atoms after a followed switch** (finding 4).

