# Cloud prompt 3: the Fable review leg of the phase 3 plan

Open a Claude Code session on claude.ai/code, repository `kevinshibuya/promptfall`, branch `feat/phase-3`, model Fable. Paste one line:

```
Check out branch feat/phase-3, pull, and follow docs/plans/cloud/03-fable-plan-review.md
```

---

You are one leg of a three-leg review of the phase 3 implementation plan. The other two legs (a `reviewer` on Opus and codex on gpt-6-astra) run on Kevin's machine. You work alone and from a fresh context: do not open anything under `docs/reviews/` except the file you write, and do not open `docs/plans/cloud/04-*` if it exists.

## What this clone lacks

A fresh clone has no user-level setup: Kevin's global instructions, skills and agents, codex and a browser are all missing. The engine's type definitions (`plugins/promptfall/.claude-plugin/types/`) are gitignored, so they are not here. Their facts are in `docs/plans/cloud/01-phase-3-grill.md`, section "The plugin engine, from sources outside the repo". An engine claim the plan makes that those facts don't cover is a finding at "unverified", not a guess. You can run `pnpm install`, `pnpm typecheck` and `pnpm test`, but not `claude plugin test` or `claude plugin validate`.

## The review

You are one leg of a three-leg review of one implementation plan. You judge work that exists against a contract that exists. Where the contract contradicts itself, report the contradiction and don't pick a side. You fix nothing and edit no file.

**Target:** `docs/plans/2026-10-03-promptfall-phase-3.md` (branch `feat/phase-3`): Promptfall phase 3, presence, chat, leaderboards and the world boss, in two PRs and twelve tasks.

**The contract:**
- The grill record `docs/plans/2026-10-03-phase-3-grill.md` (§1 decisions, §5 open items, §6 facts with cites, §7 PR split).
- The spec `docs/spec/promptfall.md` as amended (§3, §4.6, §6 to §10, §12), `CONTEXT.md`, `docs/adr/0001-trades-as-server-events.md`, `docs/adr/0002-world-boss-as-boss-mode.md`.
- The prompt the planner followed, `docs/plans/cloud/02-phase-3-plan.md`, which lists what the plan must cover; and the engine facts in `docs/plans/cloud/01-phase-3-grill.md` ("The plugin engine, from sources outside the repo").
- The shipped phase 2 plan `docs/plans/2026-10-03-promptfall-phase-2.md`, whose global constraints still hold unless the phase 3 plan says otherwise.
- The code on this branch: `packages/sim`, `packages/protocol`, `packages/ledger`, `servers/fake`, `plugins/promptfall/hooks`. Every `file:line` the plan cites is checkable.

The plan will be executed by an engineer on Opus with zero context, on Kevin's Mac. Review it as a set of contracts that engineer must follow without improvising.

**Priorities, most important first:**
1. Authority and determinism. The server is the ledger; the sim is deterministic (integer-only, no `Date`, no `Math.random`, no floats in `packages/sim/src`). Look for: a client claim the server trusts (contribution, zone, leaderboard values); boss mode breaking replay or the hash; server events applied in a position the server does not dictate; anything that lets two hosts diverge on the same contract rule; the ledger mutex and flush discipline broken; presence or chat state that breaks the in-process host's single-writer safety.
2. The world boss end to end. Spawn grid and window on the virtual clock and `--speed`, HP sizing, `boss_engaged` reaching online and newly online accounts (including a playing primary, a secondary, an account in an outage), contribution from the `dealt` delta on commit, ticks after the end, the killing commit, expiry, the 5% threshold, top-3 bonus rolls, goods to returns, an offline contributor's delivery, a fake restart mid-boss, `SIM_VERSION` 3 and the reset. Check the `BOSS_BASE_HP = 8000` working and the kill-time claim by hand against the sim's combat code.
3. The plugin against the engine facts. The world poll must stay out of the outage machinery while a thrown submit or bootstrap still enters it; the 15 s fetch timeout; redraw limits; `holdToasts`; the compose `Input` taking every printable key; `claude plugin validate` namespaces; no platform globals in vendored code (`scripts/tsconfig.vendor.json`).
4. Spec and record coverage. Every decision in the record's §1 and every phase 3 requirement has a task. Every departure is in the plan's "Spec conflicts and narrowings" with a reason that holds. Judge those reasons, above all: a top-3 contributor getting two `rewarded` events; the presence TTL as 45 real seconds scaled by speed on the fake; the Chat tab's fast cadence driven by renders; `boss_engaged` reaching a playing primary through a `sync()` the poller triggers; the Mirror moved to the protocol root.
5. Executability: exact file paths; commands that work as written on macOS with pnpm; acceptance checks that name a real command and a real red state; the declared red windows between tasks accurate; Files boundaries respected; interfaces consistent between tasks; task order workable; contract rule numbers 25 to 40 consistent; no placeholders.
6. Simpler alternatives where the plan is heavier than the job.

**Output:** findings, most severe first. Each finding gives:
- its severity (blocker, major, minor or nit);
- the plan line (and the code `file:line` when relevant);
- the defect, in one sentence;
- a concrete failure scenario (when and what goes wrong);
- your confidence, and whether you verified it against the code.

Then name every area that came up clean. No fixes beyond a one-line direction, no praise. Write in English, plainly: short sentences, no em dashes. Invent no facts; when something can't be checked, say so.

## Output

Write the findings to `docs/reviews/plan-phase-3/fable.findings.md`, starting with the heading `# Phase 3 plan review, reviewer on Fable`. Commit only that file as `docs(review): phase 3 plan, fable leg` and push to `feat/phase-3`. Never push to `ai-staging` or `main`, and open no PR. Then tell Kevin: "Fable leg pushed to feat/phase-3. The consolidation prompt comes next, from your local session."
