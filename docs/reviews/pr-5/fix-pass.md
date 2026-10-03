# PR 5 fix pass

Legs: `reviewer` on Opus (`opus.md`, no blocker or major) and `codex-review` (astra, xhigh). The codex leg's first run hit the account's usage limit mid-review and produced no findings; it reruns on the fixed head.

Each Opus finding, checked against the code by hand:

| # | Finding | Verdict | Change |
| --- | --- | --- | --- |
| 1 | Step 4 promises `boss 100% · 2m`; the first poll lands under 2 minutes, so it reads `1m` | Real (doc) | Step 4 reads `1m` and says why |
| 2 | Rule 40's `online === 1` cannot fail with one trader | Real | Two traders on the first host; the second host counts one, the first still two |
| 3 | Presence off with the boss on: a boss nobody can engage | Real | With presence off the poll counts as online for engaging the caller; the spawn is sized for one; ledger test added |
| 4 | Flag off: a submit before the first poll or sweep still contributes | Real | `contribute` ignores batches while the flag is off (narrowing 25); ledger test added |
| 5 | At 100 columns the Party tab clips the boss name to `⚔ ☠ Th…` | Real | The boss gets two rows of the enemy column: the name, then the bar and HP; band test renders at 100 columns |
| 6 | A reload during a live boss toasts "has appeared" again | Real, nit | The poller keeps the held snapshot until its first poll; poller test added |
| 7 | README reward line wrong for a reward with no slot; step 6's 15 s can be 20 | Real (doc) | Both corrected |
| gap | No test that a batch after `endsAt` (before a settle) counts nothing, that the sweep settles an expiry, or that the snapshot hides a boss with the flag off | Real | Three ledger tests added |

Left as noted, not changed: the `committedDealt` read racing a flush (display only, corrected by the next poll), the boss not shown in a secondary's one-line band (as before this PR), a turn boss in progress dropped at `boss_engaged` (the plan's rule), no reward toast on a killing `hash_mismatch` (the client adopts the state; the plan's rule), the `hash_mismatch` kill path without a dedicated ledger test, and `--boss-in`'s CLI wiring covered by the devserve check only.

The manual pass's server side ran against the fake on 2026-10-03 (a scripted HTTP player at the plugin's cadences): part B steps 1 to 9 behaved as written. The lone party dealt about 8.7 a tick and passed 200 about 30 s after the spawn; the expiry paid one reward then the disengage. Twelve bots and the player (52,000 HP) killed the boss about 75 s after it appeared; the player's reward came with the disengage; a restart mid-boss resumed the same boss with its HP and `endsAt`.

## Second leg

The codex leg hit the account's usage limit mid-run and left no findings (its one probe showed eight concurrent chat posts serialised to five accepted and three `rate_limited`). Kevin had the cross-check run as a second, fresh-context Opus `reviewer` instead (`opus-second.md`): nothing blocks the merge, all six fixes confirmed correct, and a scratch replay showed the v3 sim matches `feat/phase-3`'s on non-boss paths. Taken:

| # | Finding | Change |
| --- | --- | --- |
| 1 | The plan did not record the fix-pass deviations | Narrowings 34 to 36 (and 32, 33 on PR 1's side) |
| 2 | `world()`'s comment says it writes nothing | Says it writes only to engage the caller with a live boss |
| 3 | README's HP line wrong with presence off | One clause added |
| 4 | A held snapshot without its clock could read `boss 62% · ` | The held clock comes along |
| gap | Nothing pins non-boss behaviour across the version bump | `goldenEvents({ boss: false })` must still reach the v2 golden hash with the boss field stripped; it does |
