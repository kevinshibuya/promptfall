# PR 4 fix pass

Legs: `reviewer` on Opus (`opus.md`, no blocker or major) and `codex-review` (astra, xhigh). The codex leg's first run hit the account's usage limit mid-review and produced no findings; it reruns on the fixed head.

Each Opus finding, checked against the code by hand:

| # | Finding | Verdict | Change |
| --- | --- | --- | --- |
| 1 | A paste over 2000 UTF-16 units is a 400 that flashes `Server unreachable` | Real | `postChat` judges the text as the server does (control characters stripped, trimmed) and flashes the too-long refusal without a call; dialog test added |
| 2 | A full chat bucket keeps counting, so an idle account bursts 6 | Real | `refillChat` restarts the clock when the bucket is full: a burst is the capacity and no more; unit test added; rule 28 unchanged and green |
| 3 | Manual pass step 8 reads the online count from a secondary's band, which is one line | Real (doc) | Step 8 reads it from the first terminal's World tab and the second's Leaderboards |
| 4 | A followed switch keeps the old server's chat draft and boards | Real, minor | `followSetting` resets both atoms |
| 5 | The in-flight guard drops before the answer is applied | Real, nit | The guard is held until the snapshot is published |
| 6 | A failed bot start is an unhandled rejection that ends the fake | Real | `ready` gets a handler; `tick` logs and returns |
| gap | Rule 25 proves only 0 < TTL ≤ 45 s | Real | Rule 25 polls at TTL − 1 (online) and at the TTL (gone) |
| gap | Nothing tests the speed-scaled TTL | Real | Ledger test at speed 10 across a 150 s virtual gap |
| noted | README claims the damage board in PR 1 | Real (doc) | README says it fills once the world boss lands |

Also from the manual pass's server-side run: part A step 3's "a bot's chat line within a minute" is about 100 s after the fake starts (a bot speaks every sixth act, one act per 20 s), and step 4's "every few seconds" is about every 10. Both lines corrected.

Left as noted, not changed: the zone label versus the committed zone for up to 15 s, the fast cadence while a closed or gated Chat tab is shown, a mark past a wiped store's last id (covered by the mismatch pause), rule 26's vacuous `chat: []`, rule 31 not committing a raised zone (the unit test covers it).
