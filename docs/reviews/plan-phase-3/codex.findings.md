# Phase 3 plan review, codex (gpt-6-astra, xhigh)

Run log: `~/.claude/codex-runs/20261003-133258-5303-plan3-review-custom.log` (exit 0, 798 s). The final message, verbatim:

The plan contains authority, lifecycle, delivery, and executable-contract defects. Clean areas: server-owned inputs, integer boss scaling, hash coverage, version/reset design, platform-free Mirror extraction, TTL speed rationale, fetch timeout and outage separation, mobile/key/toast/redraw assumptions, reward-event splitting rationale, PR split, and deferred scope; local types confirm Input.value and ui.close. The current plugin typecheck passed and read-only combat probes ran; package tests and live manual checks were not run.

Full review comments:

- [P1] Specify one working account record throughout boss processing — ~/keki/dev/personal_projects/tbh-cc-mod/docs/plans/2026-10-03-promptfall-phase-3.md:169-171
  Blocker. The boss helpers reload accounts that the enclosing operation already holds. On a killing submit, `settleBoss` loads the killer before the replayed state is saved, so rewards can be authored against stale state and then overwritten by submit's final save. Spawn and expiry have the same stale-record risk after authentication. Verified against `packages/ledger/src/ledger.ts:220-221,282-295`, `books.ts:163-169`, and the JSON-copy storage implementations. Specify record ownership and the save/settle ordering explicitly.

- [P1] Settle an expired boss before replacing its record — ~/keki/dev/personal_projects/tbh-cc-mod/docs/plans/2026-10-03-promptfall-phase-3.md:169-169
  Major. If the fake stops mid-boss and resumes during a later spawn window, this algorithm replaces the old record before checking its expiry. Its contributions and unpaid rewards disappear, while its accounts remain engaged with the old boss. Their next engagement then fails with `already_engaged`. Verified against the restart clock in `servers/fake/src/clock.ts:23-25` and the planned event preconditions. Require old-boss settlement before replacement.

- [P1] Define cleanup when the boss flag is disabled mid-fight — ~/keki/dev/personal_projects/tbh-cc-mod/docs/plans/2026-10-03-promptfall-phase-3.md:169-169
  Major. Restarting an active fake with `--flag worldboss.enabled=false` makes `advanceBoss` do nothing forever, including expiry and disengagement. The snapshot hides the boss, but engaged accounts keep fighting their immortal local enemy and cannot resume progression. Contract-verified against the specified flag restart behavior and boss lifecycle; phase 3 is not implemented yet. Define how disabling the feature settles or disengages existing participants.

- [P1] Keep posting from skipping unseen chat messages — ~/keki/dev/personal_projects/tbh-cc-mod/docs/plans/2026-10-03-promptfall-phase-3.md:233-233
  Major. Suppose the client's mark is 10, another account posts message 11, and this account posts message 12 before polling. Advancing the mark to 12 immediately makes subsequent polls exclude message 11 permanently. This also discards intervening messages from an already-running poll because merging filters against the advanced mark. Contract-verified from the specified cursor and filtering algorithms. Keep optimistic message insertion separate from the fetched-history watermark.

- [P2] Reconcile closed boss records with the required down snapshot — ~/keki/dev/personal_projects/tbh-cc-mod/docs/plans/2026-10-03-promptfall-phase-3.md:164-164
  Major. This snapshot rule returns only an open record, while settlement sets `closed = true` immediately on a kill. That contradicts the explicit requirement to retain `hp: 0` until `endsAt`, and prevents the required down transition and toast. Contract-only verification: lines 39, 171, 518 and 627 require incompatible results. Resolve whether snapshot visibility follows the window or the settlement flag.

- [P2] Resolve the added threshold condition on top-three bonuses — ~/keki/dev/personal_projects/tbh-cc-mod/docs/plans/2026-10-03-promptfall-phase-3.md:171-171
  Major. The extra `contribution >= threshold` condition denies a bonus to a top-three contributor below 400 damage. The spec (§6) and grill record (§1.3) attach the threshold to the guaranteed drop, but award a bonus to each top-three contributor without that condition. Rule 35 further entrenches the conflicting interpretation. Contract-only verification. Resolve this departure explicitly rather than silently narrowing eligibility.

- [P2] Recalculate boss HP with individual hero deaths included — ~/keki/dev/personal_projects/tbh-cc-mod/docs/plans/2026-10-03-promptfall-phase-3.md:268-268
  Major. R1 does not keep all three heroes alive: fallen heroes stop acting until the entire party wipes. Verified against `packages/sim/src/combat.ts:102-115` and `progression.ts:274-284`. Read-only probes using the cited eight-hour harness states and existing combat reached 8,000 damage in 189 and 191 idle ticks, about 15.8 to 15.9 minutes, not 12. Recalculate the working and threshold timing using actual combat survival.

- [P2] Give secondary sessions a snapshot-aligned prediction baseline — ~/keki/dev/personal_projects/tbh-cc-mod/docs/plans/2026-10-03-promptfall-phase-3.md:570-570
  Major. Secondaries deliberately publish `committedDealt: null`, so this formula subtracts their account's entire replayed contribution from global HP again. For example, a snapshot at 6,000 HP after this account dealt 2,000 is displayed as 4,000. Verified against secondary delivery replay in `plugins/promptfall/hooks/register.tsx:437-464` and the planned null baseline at line 231. Use a contribution baseline belonging to the same snapshot on both session roles.

- [P2] Propagate polled flags to the dialog gates — ~/keki/dev/personal_projects/tbh-cc-mod/docs/plans/2026-10-03-promptfall-phase-3.md:430-430
  Major. The Chat gate reads `view.account.chatOpen`, but polling updates only the world atom. After restarting with chat disabled, the ticker closes while a playing primary's compose box remains enabled indefinitely unless another operation syncs account configuration. Verified against `plugins/promptfall/hooks/view.ts:133-144` and `engine.ts:415-436,526-541`; submit acknowledgments do not refresh configuration. Specify how snapshot flags update the gates.

- [P2] Keep secondary leaderboard reads from writing shared local state — ~/keki/dev/personal_projects/tbh-cc-mod/docs/plans/2026-10-03-promptfall-phase-3.md:166-166
  Major. A leaderboard read resets and persists the weekly portion of `pf:boards`, while secondaries call it without the lease. Each local session constructs a separate Ledger with its own mutex, so a secondary can overwrite a concurrent primary's updated zone board with its older copy. Verified against `plugins/promptfall/hooks/server.ts:24-34`, `register.tsx:136-143`, and `packages/ledger/src/ledger.ts:115-125`. Specify a single-writer-safe rollover path for the in-process host.

- [P2] Use the same character-count rule in chat and wire schemas — ~/keki/dev/personal_projects/tbh-cc-mod/docs/plans/2026-10-03-promptfall-phase-3.md:59-59
  Major. The ledger explicitly counts Unicode code points with `[...trimmed].length`, while a normal Zod string maximum counts UTF-16 code units. A message containing 101 emoji is therefore accepted and persisted by the ledger but rejected when HttpClient parses its response and later world snapshots. Verified against the existing schema-parsing transport in `packages/protocol/src/http.ts:137-146`. State one matching Unicode length rule for both layers.

- [P2] Refresh leaderboard names without requiring a higher score — ~/keki/dev/personal_projects/tbh-cc-mod/docs/plans/2026-10-03-promptfall-phase-3.md:167-167
  Major. An anonymous player can enter the board as `adventurer`, link their account, and remain at the same highest zone. This replacement rule never updates their stored name until their score rises, so the board does not show their current display name. Verified against linking in `packages/ledger/src/ledger.ts:348-363`. Refresh identity fields independently of score improvement.

- [P2] Preserve the explicit chat gate during an active outage — ~/keki/dev/personal_projects/tbh-cc-mod/docs/plans/2026-10-03-promptfall-phase-3.md:233-233
  Major. Directly calling the chat endpoint bypasses the engine's outage guard. If submit fails with a 5xx while chat remains reachable, this path successfully posts despite the contract requiring `Server unreachable` during an outage. Verified against the trade guard in `plugins/promptfall/hooks/engine.ts:395-400` and outage state at lines 514-515. Specify the outage check without routing chat through a flush or lease acquisition.

- [P2] Include the plugin's ServerClient test adapter in Task 5 — ~/keki/dev/personal_projects/tbh-cc-mod/docs/plans/2026-10-03-promptfall-phase-3.md:390-395
  Major. After vendoring the expanded interface, `Recorder implements ServerClient` lacks all three new methods, so Task 5's plugin typecheck cannot pass. Its file, `plugins/promptfall/hooks/engine.test.ts:28-123`, is excluded from this task and appears only in Task 11, after PR 1 must already be green. Verified against the code and plugin tsconfig. Add this required adapter update to the task's [Files boundary](docs/plans/cloud/02-phase-3-plan.md#L83-L85).

- [P2] Authorize both contract-runner changes for shared storage — ~/keki/dev/personal_projects/tbh-cc-mod/docs/plans/2026-10-03-promptfall-phase-3.md:523-525
  Major. Rule 40 requires both runners to reuse `options.kv`, but neither runner is in Task 9 or Task 10's Files list. Both currently unconditionally create a new `MemoryKeyValue`, so a second host cannot resume the first boss. Verified at `packages/ledger/src/ledger.contract.test.ts:7-9` and `servers/fake/src/server.contract.test.ts:14-16`. Include both paths in the applicable [Files boundary](docs/plans/cloud/02-phase-3-plan.md#L83-L85).

- [P2] Include the existing server-event count assertion in Task 8 — ~/keki/dev/personal_projects/tbh-cc-mod/docs/plans/2026-10-03-promptfall-phase-3.md:483-486
  Major. Adding three event kinds leaves `packages/sim/src/server-events.test.ts:61-63` asserting exactly nine kinds. Updating full GameState literals does not address that assertion, and the file has no explicit task entry, so the required sim test run remains red under the stated boundary. Code-verified. Include the event-count regression update in the [Files boundary](docs/plans/cloud/02-phase-3-plan.md#L83-L85).

- [P2] Refresh presence before the grid test advances into spawning — ~/keki/dev/personal_projects/tbh-cc-mod/docs/plans/2026-10-03-promptfall-phase-3.md:516-516
  Major. Advancing from the specified initial clock to `nextGrid` advances 6,400,000 ms, far beyond the 45,000 ms TTL. Both traders have expired when `advanceBoss` runs before A's new stamp, so the prescribed algorithm sizes the boss at 8,000, not 16,000. Arithmetic and contract verified; the phase-3 test does not exist yet. Specify heartbeats within the TTL immediately before the grid boundary.

- [P2] Advance the clock between the killing test's large batches — ~/keki/dev/personal_projects/tbh-cc-mod/docs/plans/2026-10-03-promptfall-phase-3.md:518-518
  Major. A level-40 party does not kill the two-party, 16,000-HP boss in its first 60 ticks. The next 60-tick batch is rate-capped because the tick bucket holds 70 and only ten remain without a clock advance. Verified against `packages/protocol/src/client.ts:102-107`, `packages/ledger/src/ledger.ts:258-275`, and combat stats. Specify the refill advances so rule 35 can reach its killing acknowledgment.

- [P2] Reconcile the returns test with its top-three reward count — ~/keki/dev/personal_projects/tbh-cc-mod/docs/plans/2026-10-03-promptfall-phase-3.md:519-519
  Major. C is above threshold and among the top three in this two-contributor scenario, so the settlement contract awards two rolls. With a full inventory, both items enter returns, contradicting the required `returns === 1`. Freeing one slot also leaves one return waiting. Contract-only verification against line 171. Resolve the fixture and expected count before implementation rather than choosing between conflicting contracts.

- [P2] Observe order fills through a representation that retains them — ~/keki/dev/personal_projects/tbh-cc-mod/docs/plans/2026-10-03-promptfall-phase-3.md:365-365
  Major. No committed loot log can contain `order_filled`: that server event records a normal `trade` entry with `what: 'bought'`. The required assertion therefore cannot pass without changing the sim, which PR 1 forbids. Verified at `packages/sim/src/server-events.ts:104-110` and `types.ts:46-56`. Observe successful fill responses or their deliveries instead.

- [P2] Run enough bot rounds before asserting chat history — ~/keki/dev/personal_projects/tbh-cc-mod/docs/plans/2026-10-03-promptfall-phase-3.md:365-365
  Major. Thirty-six round-robin ticks give each of twelve bots only three acts, but chat occurs every sixth act. The required history from two bot names is therefore still empty at this checkpoint. Contract-only verification against lines 201 and 203. Specify a later chat checkpoint consistent with the configured cadence.

- [P2] Count the viewer's heartbeat in the bot presence assertion — ~/keki/dev/personal_projects/tbh-cc-mod/docs/plans/2026-10-03-promptfall-phase-3.md:365-365
  Major. If all twelve bots are online, requesting the snapshot through a separate current viewer account stamps that viewer too, producing 13 online rather than the required 12. The snapshot contract explicitly includes the caller. Contract-only verification against line 164. Reconcile the viewer fixture with the asserted population.

- [P2] Use distinct accounts to measure background heartbeat expiry — ~/keki/dev/personal_projects/tbh-cc-mod/docs/plans/2026-10-03-promptfall-phase-3.md:457-457
  Minor. Both terminals use the same account, and the visible terminal continues heartbeating it. The online count therefore stays 13 even if every timer in the hidden secondary stops, so this test cannot settle the stated open item. Verified against shared-token session behavior in `plugins/promptfall/hooks/register.tsx:437-445` and account-keyed presence. Use an independently identifiable background account or observe its requests directly.

- [P2] Allow the slow poll interval for first boss visibility — ~/keki/dev/personal_projects/tbh-cc-mod/docs/plans/2026-10-03-promptfall-phase-3.md:602-602
  Minor. Bots can spawn the boss promptly on the server, but they cannot notify the plugin. Before its first boss snapshot, the plugin still polls every 15 seconds, so a correct implementation can miss this five-second acceptance deadline. Contract-verified against lines 229-230; the engine fetch API provides no push path. Adjust the manual timing expectation to the discovery cadence.
