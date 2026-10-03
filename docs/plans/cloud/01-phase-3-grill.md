# Cloud prompt 1: grill Promptfall phase 3

Open a Claude Code session on claude.ai/code, repository `kevinshibuya/promptfall`, branch `feat/phase-3`, model Fable. Paste one line:

```
Check out branch feat/phase-3, pull, and follow docs/plans/cloud/01-phase-3-grill.md
```

---

You are running a design grill with Kevin for phase 3 of Promptfall: presence, chat, leaderboards and world bosses, against the HTTP fake. The grill ends with its decisions committed to this branch: spec amendments, glossary entries and ADRs where they earn one. It does not end with a plan. The plan is a separate session with its own prompt, which Kevin's local session writes after you push.

## Read first

All in this clone. Read them before the first round:

- `HANDOFF.md`, especially "Questions the grill must settle" and "Dead ends and facts". It is the trail of the session that shipped phase 2. It is authoritative; don't re-derive what it states.
- `docs/spec/promptfall.md`, the whole spec, with §6 (Social), §7 (Simulation and authority), §8 (Server, phase 5), §9 (Fake servers and the contract suite), §10 (Client structure) and §12 (Phases) closest to this work.
- `CONTEXT.md`, the glossary. Use its terms and call out any drift from them.
- `docs/adr/0001-trades-as-server-events.md`, the server-event pattern that boss rewards will likely follow.
- `docs/plans/2026-10-03-promptfall-phase-2.md`, the shipped phase 2 plan. Its "Out of scope" (line 639) puts "the long-poll stream" in phase 5, which contradicts spec §9 (line 306). The grill settles it.
- `docs/reviews/2026-10-03-pr-2-review-fix-pass.md`, for deferred items M (resync on a delivery gap) and Q (fake clock after SIGKILL).
- The code: `packages/ledger`, `packages/protocol` (contract suite, `HttpClient`), `servers/fake` (HTTP fake and bots), `plugins/promptfall/hooks` (the plugin). Read code yourself, or through a subagent, before asking Kevin anything the code answers.

## What this clone lacks, and the rules those files would have given you

Kevin's global instructions, his user-level skills (`grill-with-docs`, `grilling`, `domain-modeling`), his agents and codex are missing. So are the Claude Code plugin engine's type definitions and the `plugin-authoring` skill; their facts are below. There is no browser, and the egress policy blocks vendor pages.

### The plugin engine, from sources outside the repo

Gathered locally on 2026-10-03 from the engine's d.ts at `plugins/promptfall/.claude-plugin/types/claude-code/index.d.ts`. That folder is gitignored, so it is not in this clone. "E:n" is a line in that file. Treat these as facts; anything not listed is unknown, so mark it open rather than guess.

**HTTP.**
- `$.http.fetch(url, init?) => Promise<HttpResponse>` (E:3289). It "resolves `{ status, ok, headers, text }` once the body is read" (E:3263-3281). The body arrives whole as `text`. There is no streaming.
- `HttpInit` has exactly five fields: `method`, `headers`, `body` (text), `auth`, `socketPath` (E:4898-4932). There is no abort signal and no timeout field.
- Nothing is documented on concurrency limits or response size caps.
- The plugin wraps every fetch in `timedFetch`, which races it against a 15 s timer (`FETCH_TIMEOUT_MS`, `plugins/promptfall/hooks/register.tsx:50-73`). Since fetch has no abort, a timed-out request is not cancelled; it is only ignored.
- In `plugins/promptfall/hooks/engine.ts`, a timeout, an unreachable host, a 5xx or an unreadable body all enter an outage (lines 254-267, 474-504). Backoff starts at 1 s, caps at 30 s, with jitter. After 120 s the outage expires and the unreachable notice shows. A 4xx on submit pauses with the update notice.

**Timers.**
- `$.clock.after(ms, fn)` and `$.clock.every(ms, fn)` both return a cancellable timer, and the minimum interval is 1 ms (E:3245-3258). `$.clock.sleep(ms, { signal })` takes an abort signal (E:3235-3244).
- A hot reload cancels pending waits (E:3214-3216).
- Nothing is documented on timer behaviour in an idle or backgrounded session.
- The plugin's cadences live in `register.tsx:76-82`: tick 2 s during a turn and 5 s idle, flush every 15 s, lease renewal every 10 s.

**UI.**
- Terminal elements: Box, Text, Button, Input, Select, Link, Code, Markdown, Client, Raster, Image (E:3594-3660). There is no List, ScrollView or Tabs element. Mobile has no Input or Select.
- The band (`AbovePrompt`, E:9569-9620) scrolls a tree taller than its `maxRows`. Its scroll position is owned by the engine and moved by the wheel or by keys while the band is focused. The band is capped at half the terminal's rows, prompt included. `isWorking` is true during a turn.
- A pane is opened by `$.ui.open` with `id`, `title`, `focus`, `closeOnEscape`, `holdToasts`, `rows` and `columns` (E:6933-6990). `$.ui.scroll({ in, to, block })` scrolls a pane or band site (E:2325-2338).
- `$.ui.toast(text, { timeoutMs })` defaults to 4000 ms (E:2247-2261). Toasts stack in the top-right corner. While a pane with `holdToasts` is open, they are held until it closes.
- `$.ui.status(text)` is one pinned status line per plugin under the prompt (E:2262-2273).
- Redraws: `$.ui.invalidate` runs "ten a second at most, thirty in the terminal for its shown pane, expanded band and prompt hint" (E:2168-2170).

**Storage and sessions.**
- `$.store` (get, set, delete, keys) refuses a store over 4 MiB of JSON in total (E:3143-3166). It is machine-wide; the primary lease lives in it (`plugins/promptfall/hooks/lease.ts`).
- `$.session.id()` returns the transcript file's name (E:2590). No API lists the other concurrent sessions.
- The `session.end` hook gets one short bound for all hooks, 1.5 s by default (E:10357-10395). `/clear` ends a session with no new `session.start`.
- Primary and secondary: a 30 s lease in the store, renewed every 10 s. Only the primary applies events, submits and trades (`register.tsx:190-203`, `register.tsx:386-431`, `lease.ts`).

**Alerts.** `$.audio.play` plays only on macOS (E:2457-2473). There is no OS notification API.

### Grilling

- Map the work as a design tree. Every decision branches into the decisions that hang off it.
- Work in rounds. The frontier is every decision whose prerequisites are already settled. Ask the whole frontier in one round. A question whose answer depends on another question still open in the same round waits for a later round.
- Ask each round as plain text, numbered, each question with your recommended answer:

  ```
  ❓ **Q1** - **<title>**: <question, with the options>

  ➡️ <your recommended answer, and why>

  ---
  ```

- Kevin types his answers. `AskUserQuestion` is only for approving a finished design or draft, never for the design questions themselves.
- Facts are your job, decisions are Kevin's. Never ask Kevin something the repo can answer. When a frontier question needs a fact, look it up (a subagent is fine) and ask the rest of the frontier meanwhile; only the questions downstream of the lookup wait. When a fact is out of reach from the clone, say so, mark it open, and name what would settle it.
- The grill ends when the frontier is empty: every branch visited, nothing silently assumed. Don't write the closing record until Kevin confirms you share the same understanding.

### Domain modeling (the docs layer of the grill)

- Challenge against the glossary. When Kevin uses a term that conflicts with `CONTEXT.md`, say so at once: "the glossary defines X as A, you seem to mean B; which is it?"
- Sharpen fuzzy language. Propose one canonical term for a vague or overloaded one.
- Stress-test with concrete scenarios that probe the edges: a boss that dies while a party is offline mid-batch, a chat message posted from a secondary session, two sessions on one account heartbeating, a client on the in-process fake, a fake killed and restarted mid-boss.
- Cross-reference with code. When Kevin states how something works and the code disagrees, surface it.
- Update `CONTEXT.md` the moment a term settles, not in a batch at the end. It is a glossary and nothing else: no implementation details. Format: terms grouped under `###` subheadings, each a bold `**Term**:` line, a one or two sentence definition of what it is, and an `_Avoid_:` line listing the rejected synonyms. Only terms specific to this project; no general programming concepts.
- Offer an ADR only when all three hold: hard to reverse, surprising without context, and the result of a real trade-off. If any is missing, skip it. ADRs live in `docs/adr/`, numbered on from `0001` (so the next is `0002-<slug>.md`). An ADR can be one paragraph: a title, then one to three sentences on the context, the decision and why. Add Considered Options or Consequences only when they carry real value.

### Kevin's standing rules that apply here

- English for everything written down.
- Prefer the simpler solution, and propose it when one exists.
- Nothing gets implemented in this session. No edits under `packages/`, `servers/`, `plugins/` or `scripts/`. Your output is decisions and documents.
- Write plainly: short sentences, no filler, no inflated words, no em dashes.
- Invent no facts. A number, a limit or an engine behaviour comes from the repo, from the facts above, or is marked open.
- Stop and ask before anything that costs money, creates an account or touches a shared machine.
- Phase 5 is the real server (NestJS, Postgres, Redis, a worker). Phase 3 runs against the fakes only. A decision that shapes phase 5 is fine, and should be said as such; building phase 5 pieces is not.

## The first frontier

Open with a short summary of phase 3 as the spec states it, and the contradictions you found while reading. Then ask the first round. Compute the frontier yourself; these are the roots as the local session sees them, plus anything your reading turns up:

- **Delivery: which phase builds the event stream.** Spec §9 says the stream arrives in phase 3 and chat is "delivered through the event stream" (§6). The phase 2 plan put the long-poll stream in phase 5. Phase 2 delivers server events on responses with an explicit cursor, so a stream is an addition. Options include: a long-poll stream now, polling an account delivery endpoint now with the stream in phase 5, or chat and boss state riding on existing responses. This is a root: chat, presence and the boss banner all hang off it.
- **Long-poll against the plugin's fetch.** Facts above: `$.http.fetch` resolves only once the body is read, with no streaming and no abort, and the plugin wraps every fetch in a 15 s timeout that counts a timeout as an outage. A held long-poll needs its own timeout and a failure path that is not an outage, or the design polls instead. Only asked if the delivery root leaves a long-poll in play.
- **World boss: where its state lives.** Batches carry player events only, and the ledger replays them. "Every online party deals damage through its normal batches; the server tallies contribution" means the ledger derives boss damage from replayed combat. Rewards are rolled server-side, so they become server events (ADR 0001's pattern). Decide whether boss state lives in sim state or beside it, how a party's ticks turn into boss damage (does the party fight the boss in its own sim, or does its normal combat contribute), how spawns are scheduled against the fake's clock and `--speed`, and what the in-process fake does.
- **Presence on the fakes.** "Heartbeats in Redis with a TTL" is the phase 5 shape. Decide what the fakes hold, what a heartbeat is (its own call, or implied by batches), whether a secondary session heartbeats, and what "in a zone" means for presence.
- **Social features on the in-process fake.** It is the default server and has no other players. Decide whether chat, presence, leaderboards and the boss exist there, are hidden, or are said in place like a closed market.
- **Bots** gain chat, presence and the boss (§9). They keep using public methods plus host `mint`, `credit` and `settle` only. Decide what they say in chat (and from where), how they appear in presence, and how they join a boss.

Later branches, once their prerequisites settle:

- **Chat rules.** The linked-account gate, the 200 character limit, the per-account rate limit (its numbers, and whether the fakes enforce it), the word blocklist (where it lives, what a match does), history length kept and served, and what the client shows on a rejection.
- **Leaderboards.** Highest zone reached (all time) and world boss damage (weekly reset): who computes them, from what (the ledger's replayed state, or client claims), when the week resets on the fake's clock, how many rows, and the name blocklist.
- **Moderation in phase 3.** The spec lists name and chat blocklists, admin mute and ban, and the `chat.enabled` flag; the admin CLI is phase 5. Decide what phase 3 carries.
- **Protocol and contract suite.** New routes and schemas, the cursor's role for chat and boss events, and which contract cases run against both fakes.
- **Client surfaces.** The Chat tab in the dialog (history, compose, the rejection states), the World tab's presence names and one-line chat ticker, the boss banner with a global HP bar, the new toasts (boss spawn, boss down, boss reward), and what each shows during an outage.
- **Phase 2 leftovers.** Whether deferred item M (resync on a delivery gap) becomes necessary once chat and boss events flow, or stays in phase 5.
- **PR split.** Phase 2 shipped as two PRs. Propose the split for phase 3 and the order.

## Output and wrap-up

Commit to `feat/phase-3` as the grill goes, and push after each commit:

- `CONTEXT.md`: terms as they settle.
- `docs/adr/0002-*.md` and on: only the ADRs that pass the three-part test.
- `docs/spec/promptfall.md`: amend §6, §8, §9, §10 and §12 where decisions change them. The spec stays the description of the product; don't paste the grill transcript into it.

The closing record is `docs/plans/2026-10-03-phase-3-grill.md` (use the real date if it differs). It holds:

- the settled design tree, each decision with who made it;
- the glossary terms added or changed, by name;
- the ADRs written, by file;
- the spec sections amended, by section;
- the open items, each with what would settle it;
- the facts you relied on, citing `file:line` or the engine facts above, so the planner does not re-derive them;
- the proposed PR split and order, as the planner's starting point.

Commit messages are one line in the form `docs(grill): <what>`. Never push to `ai-staging` or `main`, and don't open a PR. Don't edit `HANDOFF.md` or anything under `docs/plans/cloud/`.

When the record is pushed, tell Kevin: "Phase 3 grill pushed to feat/phase-3. The plan prompt comes next, from your local session."
