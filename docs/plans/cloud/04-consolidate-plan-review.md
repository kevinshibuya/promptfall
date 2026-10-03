# Cloud prompt 4: consolidate the phase 3 plan review into one fix pass, then apply it

Open a new Claude Code session on claude.ai/code, repository `kevinshibuya/promptfall`, branch `feat/phase-3`, model Fable. Paste one line:

```
Check out branch feat/phase-3, pull, and follow docs/plans/cloud/04-consolidate-plan-review.md
```

---

You consolidate the single review wave on the phase 3 implementation plan into one fix pass, and then apply it to the plan. Kevin's rule is one review wave and one consolidated fix pass. There is no second wave, so the pass has to be complete: after you, the plan goes to execution on Opus.

## What this clone lacks

A fresh clone has no user-level setup: Kevin's global instructions, skills and agents, codex and a browser are all missing. The engine's type definitions (`plugins/promptfall/.claude-plugin/types/`) are gitignored. Every engine fact the findings lean on was checked on Kevin's machine and is in `docs/reviews/plan-phase-3/local-facts.md`; the earlier engine facts are in `docs/plans/cloud/01-phase-3-grill.md`. Treat both as the evidence for the engine. You can run `pnpm install`, `pnpm typecheck`, `pnpm test` and scratch scripts against the sim, but not `claude plugin test` or `claude plugin validate`.

Two tools on Kevin's machine that the plan may name:
- `devserve run [--port N] [--ttl <minutes>] -- <cmd...>` runs a process on a second port and kills it when the session ends. Kevin's rule: an agent never starts a dev server, and any process an acceptance check starts on a port goes through `devserve run --port <N> -- <cmd>`. Port 7777 is Kevin's own fake in the manual passes; acceptance checks use another port.
- `codex` and the `reviewer` agent run the PR reviews. Each PR's review is two legs (`reviewer` on Opus, `codex-review`), no Fable leg, until Kevin says otherwise. The plan already says so.

Write in English, plainly: short sentences, no filler, no inflated words, no em dashes. Invent no facts. When something can't be checked, say so and rule on it anyway, stating the risk.

## The inputs

- **The plan:** `docs/plans/2026-10-03-promptfall-phase-3.md`.
- **Its contract:** the grill record `docs/plans/2026-10-03-phase-3-grill.md`; the spec `docs/spec/promptfall.md`; `CONTEXT.md`; `docs/adr/0001-*.md` and `docs/adr/0002-*.md`; the planner prompt `docs/plans/cloud/02-phase-3-plan.md`.
- **The three legs**, all in `docs/reviews/plan-phase-3/`:
  - `opus.findings.md`: `reviewer` on Opus, 26 findings. It read the engine d.ts and ran the sim from scratch scripts to measure sustained damage.
  - `fable.findings.md`: `reviewer` on Fable, in a clone like yours.
  - `codex.findings.md`: codex gpt-6-astra at xhigh, 24 findings, its final message verbatim. Its `[P1]`/`[P2]` tags are codex's own; the body of each line opens with its severity.
- **Local facts:** `docs/reviews/plan-phase-3/local-facts.md`.

The legs overlap heavily on the world boss ledger logic. Findings are evidence, not orders.

## The job

### 1. Rule on every finding, once

Merge duplicates across legs, and cite every leg that raised a finding. Before you rule, verify the finding against the plan text, the code, or the local facts. For each finding, give:
- the ruling: fix now, defer (to a named later phase), or reject;
- the reasoning;
- for a fix, the concrete change to the plan.

### 2. Settle these explicitly

Each one is contested between legs, cuts across tasks, or touches the record or the spec:

- **The boss lifecycle in the ledger, as one contract.** Three legs found the same family: `advanceBoss` checks spawn before expiry, so an open boss is overwritten unsettled after a clock jump; `advanceBoss` and `settleBoss` write accounts through the store while `submit` holds the submitter's record, so a later save loses the engage or the rewards; a refused `author` inside a multi-account loop half-writes and then 500s every poll. Codex adds: a restart with `worldboss.enabled=false` mid-fight leaves engaged accounts in boss mode forever. Write the ordering once (settle before spawn; where `advanceBoss` may run, and whether it runs in `submit` at all, given the record says polls and sweeps; which record `settleBoss` uses for the caller; where contribution runs relative to `settle(record)` and `deliveryOf`), the rule that keeps these loops from ever throwing, the flag-off cleanup, and the `boss.test.ts` cases that prove each.
- **Where contract-visible constants live.** The Opus leg's blocker: the contract suite is in `@promptfall/protocol`, which cannot import the ledger's tuning constants or `weekStartOf` without a cycle. Verify against the package manifests and rule on their home.
- **`BOSS_BASE_HP` and the kill-time claim.** The Fable leg reproduced the plan's per-tick table exactly. The Opus leg reproduced the same static numbers but measured sustained damage much lower (fallen heroes stay down until a rest or a full wipe; R1 acts only on a full wipe), and found 11 of 12 bots at zone 1. Both can be true. Run your own scratch measurement on this tree, rule on which number sizes the boss, and redo the working. Then make manual pass part B certain to show a kill, or say plainly that it shows an expiry and how the kill path gets checked instead.
- **The top-3 bonus and the 5% threshold.** All legs flag that the plan gates the bonus on the threshold, which the record (§1.3, T1) and spec §6 do not. Follow the spec, or put the departure to Kevin (step 3).
- **A killed boss in the snapshot.** The plan says both "null when none is open" and "hp 0 until `endsAt`". Define it once, consistent with the `<name> is down` toast and rule 35.
- **Chat delivery and limits.** Codex: advancing the chat mark to the id of one's own post skips messages posted by others in between. Opus: the Zod schema counts UTF-16 units while the ledger counts code points, so one emoji-heavy message makes every snapshot fail to parse; and no rule stops control characters (see local facts on what the engine does with them). Codex: posting must answer the unreachable text during an outage, as the record says (§1.1). Rule on each.
- **Flags reaching the dialog gates.** All legs: the gates read the bootstrap config, which a primary never refreshes, so part A step 11 is red as designed. Rule on the source of truth for gates, given record §1.7 ("a client sees a change within one poll").
- **The secondary's predicted HP and leaderboard writes.** The predicted bar double-counts on a secondary (Opus, codex). A leaderboard read writes the weekly reset from a secondary without the lease (codex, Opus "consider").
- **Conflicts 12 and 13.** The local facts show the engine has a `ui.close` hook and `$.ui.panes()`, so conflict 12's reason is wrong; decide whether the design changes or only the reason. On 13, rule whether the poller-triggered `sync()` stays.
- **Acceptance checks and red windows.** The PR check lines omit the plugin (`pnpm exec tsc -p plugins/promptfall`, `claude plugin test plugins/promptfall`); `servers/fake` is red from Task 1 to Task 3; fakes in acceptance checks use port 7777 and must go through `devserve`. Fix them all in one pass.
- **The Task 6 executor check.** The local facts answer it: `Input` takes `value`. Replace the remount with a controlled draft, and say whether the compose box gets `autoFocus`.

### 3. Kevin's decisions

Some rulings change what the grill record or the spec says (the bonus threshold if you keep it, the boss sizing rule "base × online count at spawn", adding `--boss-at` or another dev override for the manual pass, anything in §1 of the record). Don't apply those alone. Before you apply anything, put them to Kevin as one round in this format, each with your recommended answer:

```
❓ **Q1** - **<title>**: <question, with the options>

➡️ <your recommended answer, and why>

---
```

Kevin types the answers. Then apply. Ask nothing the repo or the local facts can answer.

### 4. Write the fix pass

Write `docs/reviews/2026-10-03-phase-3-plan-fix-pass.md` (use the real date if it differs), in the shape of `docs/reviews/2026-10-03-phase-2-plan-fix-pass.md`, with four sections:
1. The rulings: every finding, the legs that raised it, the ruling, a one-line reason. Group as that file does (blockers, majors taken, minors taken, deferred, rejected).
2. The reasoning for every contested or spec-touching ruling. Kevin reads this, so give reasons, not just verdicts.
3. Kevin's answers to the round, verbatim.
4. The ordered list of plan amendments.

Commit it alone as `docs(review): phase 3 plan consolidated fix pass` and push.

### 5. Apply the amendments to the plan

- Keep the plan's format: header, global constraints, shared contracts, tasks with Files, Interfaces, Work, Acceptance check and Boundaries, out of scope, and "Spec conflicts and narrowings".
- Change the header's `Review wave:` line to read that the wave is done on the date (reviewer on opus, reviewer on fable, codex-review on gpt-6-astra at xhigh), that this is the fixed plan, consolidated in the fix pass file, and that there is no second wave.
- Every command you add or change must work as written on macOS with pnpm.
- Every acceptance check names a real command and a real red state.
- Re-run the plan self-review:
  - every decision in the record's §1 has a task;
  - no placeholders;
  - names and types match across tasks;
  - every departure is in "Spec conflicts and narrowings", renumbered if needed.
- Commit as `docs(plan): apply the phase 3 review fix pass` and push.

## Rules

- You write only the fix pass and the plan. Don't edit the grill record, the spec, `CONTEXT.md`, the ADRs, any findings file or anything under `docs/plans/cloud/`. A correction to the record or the spec goes into the plan's "Spec conflicts and narrowings" and the fix pass, and the local session applies it after Kevin's approval.
- Nothing gets implemented. No file under `packages/`, `servers/`, `plugins/` or `scripts/` changes.
- Push only to `feat/phase-3`. Never push to `ai-staging` or `main`, and open no PR.
- When both commits are pushed, tell Kevin: "Fix pass applied and pushed to feat/phase-3. Your local session verifies the plan against it next."
