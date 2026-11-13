# PR 4 review, second Opus leg

**Verdict: nothing blocks the merge.** All eleven applied fixes are correct and none of them causes a regression. I found two new minor defects and one judgement call. None of them is a blocker or a major.

## What I ran, against PR 1's head (not the working tree)

I extracted `git archive feat/phase-3` into the scratchpad, installed offline, and copied in the gitignored engine types from the working tree.

- `pnpm typecheck`: clean.
- `pnpm test`: all green. sim 91, protocol 43, ledger 84, fake 61.
- `node scripts/vendor.mjs`: the rebuilt bundles and `version.ts` are byte-identical to the committed ones, so `vendor:check` would pass.
- `pnpm exec tsc -p plugins/promptfall`: clean.
- `pnpm lint`: clean.
- `claude plugin test plugins/promptfall`: **not run.** It refuses with "hooks modules are turned off in this process: the rollout switch was saved off", both in the copy and in the repo. Every plugin-side claim below comes from reading the code, not from a test run.
- An HTTP probe against `createFakeServer` on PR 1's code; output quoted under findings 1 and 3.

## Fix verification

| Fix | Verdict |
| --- | --- |
| `refillChat` full-bucket rule (`packages/ledger/src/world.ts:122-130`) | Correct. When the bucket is full, the next token comes 10 s after the first spend, which is standard token-bucket behaviour. I traced rule 28 by hand under the new rule and it passes. The part A step 4 "fifth or sixth" wording holds for any normal typing speed. |
| `postChat` local length check (`ui/chat.tsx:34-43`) | Correct for the case it targets. One hole is left; see finding 1. |
| `followSetting` atom reset (`register.tsx:336-343`) | Correct: `CHAT_DEFAULT` and `BOARDS_DEFAULT` go out with `server`. No test covers it (see the gaps). |
| `WorldPoller` in-flight guard with `pollOnce` (`hooks/world.ts:121-158`) | Correct. The guard now holds through the publish. `reset()` clears `inFlight` and bumps `epoch`, and an abandoned poll's `finally` sees the epoch mismatch and leaves the new poll's guard alone. I traced back-to-back resets (a followed switch, then a restart) and they are safe. `stop()` bumps the epoch without clearing `inFlight`; that is unreachable in practice (Dismissed). |
| Bots `ready` handling (`servers/fake/src/bots.ts:173-175, 337-344`) | Correct: no unhandled rejection, and `tick` returns. But the failure is now silent in the CLI; see finding 2. |
| Rule 25 TTL boundary (`suite.ts` rule 25) | Correct. At TTL − 1, A is online. At the TTL, `online 1` is B, which polled at TTL − 1. |
| Speed-scaled TTL test (`packages/ledger/src/world.test.ts`, "presence on a fast clock") | Correct but one-sided. It fails for the unscaled 45 s TTL but passes for any TTL ≥ 150 s (see the gaps). |
| Dialog tab wrap (`ui/dialog.tsx:160`) | Correct. `flexWrap` and `columnGap` are real Box props (engine d.ts:799-805). |
| Chat name Box (`ui/chat.tsx:86-92`) | Correct. `flexShrink={0}` keeps the colon with the name. |
| In-process `GATE_CHAT_LOCAL` and the band's `chat needs a server` (`ui/chat.tsx:95-101`, `ui/band.tsx`) | Correct, and the same text appears in the plugin README and manual pass step 12. |
| Doc fixes (step 8 reads the count from the World tab and the secondary's Leaderboards; step 3 says about 100 s; step 4 says about 10 s) | Accurate. A bot's sixth act is at tick 60 + i, about 101 s at 1.67 s per tick. 12 bots each posting every 120 s gives one line every 10 s. |

## Act on

1. **minor, CONFIRMED: a paste longer than 2000 characters that strips to 200 or fewer still flashes `Server unreachable`.**
   - Where: `plugins/promptfall/hooks/ui/chat.tsx:35-46` and `packages/protocol/src/world.ts:99`.
   - The local check measures the cleaned text, but `game.chat(text)` sends the raw text. `ChatBodySchema` caps the raw text at 2000, so the fake answers 400, `HttpClient` throws `ServerError`, and `GameSession.chat` reports `unreachable`.
   - Probe: `' '.repeat(2100) + 'hi'` gave `cleaned length 2` and then `padded threw ServerError: POST /v1/chat: status 400`.
   - It needs a whitespace- or control-padded paste, so it is rare, but it is what the first fix set out to close.
   - Fix: send `cleaned` (`game.chat(cleaned)`). The server's own strip and trim do nothing to it, it is never over 200, so it is always well under the wire cap.

2. **minor, CONFIRMED (traced): a failed bot start no longer crashes the fake, but now nothing reports it.**
   - Where: `servers/fake/src/bots.ts:340-343` and `servers/fake/src/cli.ts` (the `log` passed to `startBots` writes only when `PROMPTFALL_DEBUG` is set).
   - Scenario: one bootstrap during `ready` throws (a 500, or a corrupted `--data`). The fake keeps serving with zero bots and prints nothing. Manual pass step 3 then reads `1 online` with no clue why, and each tick logs `bots failed to start` to a sink nobody sees.
   - Fix: report the start failure through `console.error` once, for example a `ready.catch` that writes to stderr, or an `onError` option in `BotOptions` that the CLI wires to stderr. Leave per-act refusals on the debug log.

## Consider

3. **minor, CONFIRMED: the highest-zone board keeps rows of accounts that a reset or a bot re-mint left behind, so one public name can show twice.**
   - Where: `packages/ledger/src/world.ts:187-203`. Rows are keyed by `accountId`, and nothing removes the row of an account that will never play again.
   - Probe: minting a second `player` account gave `[{player, 6}, {Ann, 1}, {player, 1}]`.
   - In PR 1 the trigger is `/promptfall reset` on the HTTP fake: it mints a new account and the old one stays in the store with its row.
   - The bigger case is PR 2: `SIM_VERSION` 3 re-mints all 12 bots on any existing `--data`, including the default `.promptfall/fake.json`, and the orphaned phase 2 bots keep their (higher) rows. The board would then be dominated by duplicate, frozen bot names.
   - The plan accepts orphaned records ("the manual pass avoids [it] by starting from a fresh `--data`"), so this is plan-consistent. Options: when the bots re-mint, drop the orphan's board row (the fake owns `pf:bot:<i>`, so it knows the old account id), or say in the root README that a phase 3 fake wants a fresh `--data`.

## Noted

- **Chat ids can be reused after a crash that skipped the flush.** If the fake dies after acknowledging a post but before writing it (SIGKILL), the restarted fake hands out those ids again. A client holding the old ids drops the new messages in the merge, and `since` skips them. Same family as deferred item Q; acceptable for the fake.
- **Typing during an in-flight post is lost.** `postChat` sets `draft: ''` when the post succeeds (`chat.tsx:48`), which overwrites anything typed while the request was out. The plan prescribes clearing the draft on success.
- **A post that straddles a server switch.** `GameSession.chat` inserts `result.message` into the poller even if a switch happened mid-call (`register.tsx` `chat()`), so an old-server id can sit in the new server's buffer and hide the new server's message with the same id. It needs a switch during the round trip.
- **A hot reload that coincides with a switch made elsewhere.** `WorldPoller.start()` keeps the atom's held messages (`hooks/world.ts:63-68`). If another session changed the server during the reload, those are the old server's messages, with the same id-collision effect as above. Very rare.
- **Points the first leg already noted, which still stand:** the World tab's `zone ${view.zone}` is local while `here` uses the committed zone; a closed or gated Chat tab keeps the 5 s cadence; a mark past a wiped store's last id; the root README's mention of weekly boss-damage boards (now qualified with "The world boss is phase 3's second half").

## Dismissed

- **`WorldPoller.stop()` bumps the epoch but leaves `inFlight` true if a poll is in flight, so a later `start()` would never poll** (hypothetical vs actual). `stop()` runs only from `end(processEnds = true)`, and every `session.start` or `session.attach` builds a new `GameSession` and a new poller (`register.tsx` hook wiring). Nothing restarts a stopped poller.
- **U+2028 and RLO (U+202E) are stored and shown verbatim.** Probe: `a b‮c` was accepted. Plan narrowing 24 limits stripping to `\p{Cc}` on purpose, and the engine d.ts rules I found (E:1450, E:5395, E:6946) talk about control characters, not format characters, for drawn text.
- **Names over 128 characters breaking other players' snapshot and boards schemas.** Only an operator's `--player-name` can produce one (same reasoning as the first leg).
- **The `maintenance` flag resolves but nothing reads it.** It was already a `LedgerFlag` before this PR, and the PR only adds a default.
- **Two Enter presses racing the `busy` read.** Nitpick, as the first leg ruled.
- **Ledger ordering under the mutex.** `world`, `chat` and `leaderboards` read `now` inside `run`. `chat` checks everything before its first write. `world` and `leaderboards` write nothing, so `TrackedKeyValue.flush` does nothing. `offerZone` runs before `books.save` but cannot throw except on a store failure. The codex probe's 5 accepted then `rate_limited` matches this.
- **Bots' mirror protocol.** The stipend `credited` event reaches the mirror through the next ack's `cursor_behind` and resubmit. A second `cursor_behind` in a row drops that act's batch and the next act retries. A thrown submit leaves the mirror as it was, and the server's `seq_mismatch` or `duplicate` answer recovers it.
- **Auth on the new routes.** All three authenticate inside the ledger. `world` validates `since` before checking auth, so a bad `since` with a bad token is a 400; that is harmless.

## Residual test gaps

- **The plugin suite was not run by this leg** (rollout switch off), so none of the register, dialog or band tests were confirmed green on PR 1's head.
- **No plugin test sends a server-side chat refusal through `postChat`.** The only one was `too_long`, and the new local check now catches it before the call. Add one canned `blocked` or `rate_limited` answer from the fake route in `dialog.test.ts`.
- **No test that a followed switch resets the `chat` and `boards` atoms** (fix 4).
- **No test for a failed bot start** (fix 6): a host whose `mint` rejects should leave `tick()` resolving and the loop alive.
- **The speed-scaled TTL test only proves a lower bound.** Add a poll at 450 000 ms (45 s × 10) after the last heartbeat and expect `online 1`.
- **Rule 26's `chat: []` is still vacuous** (no posts made while open), and **rule 31 still never commits a raised zone** over the contract. Both carry over from the first leg.
- **No test of a padded paste over 2000 raw characters** (finding 1).

Files: `plugins/promptfall/hooks/ui/chat.tsx`, `servers/fake/src/bots.ts`, `servers/fake/src/cli.ts`, `packages/ledger/src/world.ts`, `plugins/promptfall/hooks/world.ts`, `plugins/promptfall/hooks/register.tsx`. The probe is `servers/fake/src/probe.test.ts` inside the `pr1/` copy in the session scratchpad, not in the repo.
