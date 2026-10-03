# Cloud prompt 2: the phase 3 implementation plan

Open a Claude Code session on claude.ai/code, repository `kevinshibuya/promptfall`, branch `feat/phase-3`, model Fable. Paste one line:

```
Check out branch feat/phase-3, pull, and follow docs/plans/cloud/02-phase-3-plan.md
```

---

You are writing the implementation plan for Promptfall phase 3: presence, chat, leaderboards and the world boss, against the fakes. You write a plan, not code. Execution happens later on Kevin's machine, in a session on Opus that has never seen this conversation or the grill.

## Read first

All in this clone:

1. `docs/plans/2026-10-03-phase-3-grill.md`, the grill record. With the spec, it is what the plan argues from. §1 is the settled design, §5 the open items, §6 the facts with `file:line` cites, §7 the PR split.
2. `docs/spec/promptfall.md`, as amended by the grill (§3, §4.6, §6 to §10, §12).
3. `CONTEXT.md` and `docs/adr/0001-trades-as-server-events.md`, `docs/adr/0002-world-boss-as-boss-mode.md`.
4. `docs/plans/2026-10-03-promptfall-phase-2.md`, the shipped phase 2 plan. It is the model for this plan's shape: header, global constraints, shared contracts, tasks, out of scope. Its global constraints still hold unless phase 3 changes one; say which.
5. `docs/plans/cloud/01-phase-3-grill.md`, section "The plugin engine, from sources outside the repo": the engine facts. Don't edit that file.
6. `docs/manual-pass/phase-2.md`, the model for the manual pass this plan's PR tasks write.
7. The code the record cites. Check every cite you lean on; the tree is at the grill's commit plus doc changes only.

## What this clone lacks, and the rules those files would have given you

Kevin's global instructions, user-level skills (`writing-plans`), agents and codex are missing. `HANDOFF.md` is local only and never in git; what it holds that the plan needs is below. The engine's type definitions (`plugins/promptfall/.claude-plugin/types/`) are gitignored. When a task needs an engine API the plugin does not already use, don't guess its shape: write a first step that has the executor read it from the d.ts on Kevin's machine, and name what the task does if the API is missing. There is no browser, and you cannot run `claude plugin test` or `claude plugin validate` here; they stay in acceptance checks for the executor. `pnpm install`, `pnpm typecheck` and `pnpm test` do run here, so use them to confirm any fact about the current tree you depend on.

### Facts from HANDOFF.md, for the manual pass and dev tooling

- Fast-forwarding the fake past cooldowns: stop it, start it with `--speed 2000 --bots 0` for about 50 s, then restart at the normal speed. The virtual clock rebases monotonically, so it never steps back. The same move can bring the clock close to a 3 hour boss grid point; the plan decides whether manual pass part B uses it instead of waiting at `--speed 10`.
- `pnpm fake` runs in `servers/fake`; a relative `--data` resolves against `INIT_CWD`, the repo root when run from there.
- Giving a test account gold: `host.credit` on a stopped fake's snapshot, through a small tsx script over `FileKeyValue` plus `Ledger`.
- `claude plugin test` can refuse with "hooks modules are turned off ... rollout switch". Starting `claude` once with network access refreshes it. An acceptance check that runs it should say so.
- Manual passes drive a real `claude --plugin-dir plugins/promptfall`. Focus shows as reverse video. Tab cycles the dialog's tabs, then the body buttons, then the close button. A focused `Input` draws bold with `⏎ <submitLabel>` and takes every printable key, so a tab hotkey typed while the compose box has focus goes into the message. A focused `Select` expands inline. The pane opens with `holdToasts`, so toasts appear only after Esc. Shift-tab cycles Claude Code's permission mode; a manual step never uses it.
- Kevin's standing call: each PR's review runs two legs, `reviewer` on Opus and `codex-review`, with no Fable leg until Kevin says otherwise. The plan's PR tasks say so.

### How a plan is written

This is the `writing-plans` skill, in full:

- Write for an engineer with zero context: every task self-contained, every requirement traceable to the spec or the grill record.
- A plan is a set of contracts, not pre-written code. Each task has an unambiguous objective, a hard Files boundary and a named acceptance check. Ship verbatim code only where the shape is load-bearing: a concurrency or locking contract, a protocol or schema shape, an algorithm with reasoned-through edge cases, an already-derived fix. Everything else is the implementer's to write.
- Header:

  ```markdown
  # <Feature> implementation plan

  **Goal:** <one sentence>
  **Architecture:** <2-3 sentences>
  **Spec:** <paths; the plan argues from the spec, so it travels with it>
  **Execution model:** opus

  ## Global constraints
  <the spec's project-wide requirements, one line each, exact values verbatim>
  ```

- Execution model is `opus` unless one of three reasons holds, written as `fable, because <reason>`: (a) an Opus attempt at high effort already failed on this task; (b) the plan changes architecture across many files, where each task depends on judgement made in the previous one; (c) the root cause is still ambiguous and the plan is really an investigation. The list is closed. Expect `opus`.
- Task structure:

  ```markdown
  ### Task N: <component>

  **Files:**
  - `exact/path.ts` (create|modify): <what changes here>; nothing outside this list

  **Interfaces:**
  - Consumes: <exact signatures from earlier tasks>
  - Produces: <exact names and types later tasks rely on>

  **Work:** <design intent + binding constraints; state the freedoms explicitly
  ("internal structure is your choice"). Verbatim code only for load-bearing shapes.>

  **Acceptance check:** <the test or command, its exact invocation, and the red
  state expected before the task is implemented>

  **Boundaries:** <what this task must NOT touch. On ambiguity: stop and report
  `blocked: <the specific ambiguity>` rather than improvising>

  - [ ] one checkbox per 2-5 minute step, ending in: run the check, commit
  ```

- No placeholders. "TBD", "handle edge cases" and "similar to Task N" are plan failures.
- The Files list is a boundary, not a suggestion.
- A departure from the spec or the record is written down, not absorbed. The plan ends with a "Spec conflicts and narrowings" section, numbered, naming every place it departs from or sharpens a decision, and why.
- Self-review before you push: every decision in the record's §1 and every spec requirement for phase 3 has a task; no placeholder patterns; names and types match across tasks.

### Kevin's standing rules that apply here

- English for everything written down.
- Prefer the simpler solution, and propose it when one exists.
- Nothing gets implemented in this session. You create or edit no file outside `docs/plans/`, except a correction you list in "Spec conflicts and narrowings" (and even then, leave the spec and record unedited).
- Verification prefers typecheck, lint and focused tests over builds. An agent never starts a dev server; a manual-pass step that runs `pnpm fake` is Kevin's step, and an acceptance check that needs a running fake starts it on a throwaway `--data` path and stops it, as phase 2's Task 4 does.
- TypeScript: no `any` unless nothing else compiles.
- Write plainly: short sentences, no filler, no inflated words, no em dashes.
- Invent no facts. An engine behaviour not in the engine facts is a step for the executor to check.
- Stop and ask before anything that costs money, creates an account or touches a shared machine.

## The plan

Save as `docs/plans/2026-10-03-promptfall-phase-3.md` (use the real date if it differs). One plan, two PRs, as the record's §7 splits them. It must cover, at least:

- **Header lines beyond the template,** as phase 2's plan has them: `Review wave:` reading `pending: one wave (reviewer on opus, reviewer on fable, codex-review on gpt-6-astra at xhigh), consolidated into one fix pass`, and `Delivery:` naming the branches. PR 1 builds on `feat/phase-3` (which also holds the grill docs). PR 2 on `feat/phase-3-boss`, branched from PR 1's head. Both PRs go into `ai-staging`. Say where in each PR the tree may be red between tasks, and that each PR's last commit is clean.
- **Shared contracts,** verbatim where load-bearing: the protocol schemas (`WorldSnapshot`, `ChatMessage`, `ChatResult`, `Boards`, `BossView`), the three routes and their refusals, the `ServerClient` additions, the new server events (`boss_engaged`, `boss_disengaged`, `rewarded`) and `state.boss`, the ledger's new methods and host options (flags, presence TTL), the `world_boss` enemy kind, the fake's `--flag` CLI, and the plugin engine's world-poll contract (cadence switching, the stale rule, how a thrown poll stays out of the outage machinery while a thrown submit still enters it).
- **The tuning numbers** from the record's §5 "Numbers that are tuning", each set to a value in one named config location, with the boss base HP and per-zone scaling derived from the sim's real combat numbers (cite the files), so "the parties present kill it in about 12 minutes" is a computed claim with its working shown, not a guess.
- **The chat word list:** where it lives in the ledger package and its format (record §5). Keep it small and clearly a placeholder list in content, but real in mechanism.
- **Presence in ledger memory** (record §1.2), including how the contract suite's TTL case drives the clock on both hosts.
- **Boss mode in the sim** (record §1.3, ADR 0002, spec §4.6) with rules R1 to R5, `SIM_VERSION` 3 and the golden and determinism tests updated. A determinism test generator that includes the boss events.
- **Contribution and rewards in the ledger** (record §1.3): the `dealt` delta on commit, the killing commit, expiry, the 5% threshold, top-3 bonus rolls, goods to returns when there is no free slot, an offline contributor's delivery.
- **Bots as HTTP clients** (record §1.9): `HttpClient` over Node's fetch against the fake's own port, a mirror, batches of ticks with tool calls and turn ends, `fill` in the weights, chat lines, `mint` and `credit` in-process, `settle` retired. Say what happens to bot accounts already in a phase 2 snapshot under `SIM_VERSION` 3.
- **The plugin:** the world poll in the engine; the World tab rows; the Chat tab on `c` (the compose `Input`, refusal flashes, the gate in place, read-only on mobile); the Leaderboards tab on `b`; `/promptfall chat|leaderboards`; the in-process host's flags; then in PR 2 the boss in the Party tab's enemy slot with predicted HP, the status row segment, the World tab boss row, the three toasts, the reward in the loot log. `claude plugin validate` must list the same namespaces as phase 2 unless a task needs a new one; name it if so.
- **The open items from the record's §5:** each either settled by a task, given an executor check, or carried to "Out of scope" with its phase. The idle-timer question becomes a manual-pass step.
- **Two PR tasks,** each with its manual pass written into `docs/manual-pass/phase-3.md` (part A for PR 1, part B for PR 2, in phase 2's format: numbered steps, each saying what Kevin should see), README updates, and the acceptance check `pnpm lint && pnpm typecheck && pnpm test && pnpm vendor:check` green in one run pasted into the PR body. PR 2's manual pass includes the state reset that `SIM_VERSION` 3 forces.
- **Out of scope,** naming each deferred item's phase: the long-poll stream, Redis presence, mute and ban, the admin CLI, pushed flag changes, deferred items M and Q, `--boss-at` unless the plan adds it, sound cues for the boss (phase 4).

## Output and wrap-up

Commit the plan, and push, to `feat/phase-3`. Commit messages are one line in the form `docs(plan): <what>`. Commit as you go if the plan is long. Never push to `ai-staging` or `main`, don't open a PR, and don't edit the grill record, the spec, `CONTEXT.md`, the ADRs or anything under `docs/plans/cloud/`.

When the plan is pushed, tell Kevin: "Phase 3 plan pushed to feat/phase-3. The review wave runs next, from your local session."
