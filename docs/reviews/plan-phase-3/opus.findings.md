# Phase 3 plan review, reviewer on Opus

Target: `/Users/luizarazzera/keki/dev/personal_projects/tbh-cc-mod/docs/plans/2026-10-03-promptfall-phase-3.md` at `2143237`. I read it against the grill record, the spec, the two cloud prompts, the phase 2 plan, the code on `feat/phase-3` and the engine d.ts. `pnpm typecheck` is green on the current tree. I checked the damage and bot claims by running the sim from scratch scripts in my scratchpad. Nothing in the repo was edited.

Verdict: not ready for task 1. There is one blocker (an interface the contract suite cannot reach). Eleven majors cluster in the world boss ledger logic, the contract rules 33 to 36, the boss HP working and the client flag gates.

## Findings, most severe first

### 1. Blocker: the contract suite cannot import the ledger's tuning constants or `weekStartOf`
- **Plan lines:** L22 ("Tests import them rather than repeating the values"), rules 25 to 33 and 39 (L319-326, L516, L522). The rules use `BOSS_BASE_HP`, `WORLD_BOSS_STAT_BP`, `weekStartOf`, the 45 s TTL and the chat numbers.
- **Code:** `packages/protocol/package.json` depends only on `@promptfall/sim`. `packages/protocol/tsconfig.json` references only `../sim`. `packages/ledger` depends on protocol.
- **Defect:** the suite lives in `@promptfall/protocol`, so it can only take these constants from the ledger by creating a dependency cycle.
- **Failure:** at Task 2 the executor has three options, all bad. It can add a protocol to ledger reference, which is a cycle and breaks `tsc -b`. It can repeat the numbers, which breaks L22. Or it can stop as blocked. The suite is also meant to run against the phase 5 server, which is not the ledger.
- **Direction:** decide where the contract-visible constants and `weekStartOf` live (for example `packages/protocol/src/world.ts`), with the ledger importing them from there.
- **Confidence:** high. Verified.

### 2. Major: `advanceBoss` and `settleBoss` load and save records apart from the record the operation already holds, so writes are lost
- **Plan lines:** L169 (`advanceBoss` runs in `submit` "after authentication, before the replay"), L171 (`settleBoss`: "load the record" for every contributor), L170.
- **Code:** `ledger.ts:218-220` loads the submitter's record. `ledger.ts:294`/`298` save it at the end. `MemoryKeyValue` and `FileKeyValue` both hand back JSON copies (`kv.ts:13-16`, `file-kv.ts:36-38`).
- **Defect:** an engagement or settlement written by `advanceBoss` or `settleBoss` to the submitter is overwritten when `submit` saves its stale copy.
- **Failure 1 (spawn):** a bot's `submit` is the first operation after a grid point. `advanceBoss` engages the online bot and saves. `submit` then saves its own copy without `boss_engaged`. The bot is in `contributions` but never enters boss mode. At the kill, `boss_disengaged` to that bot is `not_engaged` and `author` throws (see finding 3).
- **Failure 2 (kill):** if `settleBoss` reloads the killer, the killer's `rewarded` and `boss_disengaged` are lost and the killer stays in boss mode for good. Rule 35 catches this case. Rules 33 to 40 never trigger a spawn from `submit`, so failure 1 ships unseen.
- **Direction:** run `advanceBoss` before the caller's record is loaded, or drop it from `submit` (the record asks only for polls and sweeps, §1.3). Pass the in-hand caller record to `settleBoss`. State that contribution and `settleBoss` run after `settle(record)` (`ledger.ts:291`) and before `deliveryOf`.
- **Confidence:** high that a literal implementation loses the write. Verified against the code.

### 3. Major: an unguarded `author` inside the multi-account boss loops can wedge the server
- **Plan lines:** L108-109 (`already_engaged`, `not_engaged`), L169 (spawn rule listed before the expiry rule), L171.
- **Code:** `ledger.ts:111-125` flushes even when the operation throws. `books.ts:105-110` makes `author` throw on a rejected event.
- **Defect:** the plan never says the ledger checks `record.state.boss` before authoring `boss_engaged` or `boss_disengaged`. It also never says expiry runs before spawn.
- **Failure:** the fake is stopped mid-boss and restarted hours later, landing inside a later window (about 11% of restarts). The spawn overwrites the open, unsettled record. The old contributors keep `state.boss` set. The new spawn's engage loop throws `already_engaged` partway, after some saves have been flushed.
- **Consequence:** every later `world`, `leaderboards`, `sweep` and `submit` retries the spawn and returns 500. A 500 on `submit` puts every player into an outage. Finding 2's lost write leads to the same state.
- **Direction:** settle an open record before spawning a new one. Skip or repair any account whose effective `state.boss` does not match, so these loops never throw. Add a `boss.test.ts` case for that.
- **Confidence:** high. Verified.

### 4. Major: the plan contradicts itself on whether a killed boss stays in the snapshot
- **Plan lines:** L164 ("`boss`: the open record as `BossView` ... null when none is open"), L171 (`closed = true` at the kill). Against these: L39 ("hp is 0 from the killing commit until endsAt"), conflict 8 (L627) and rule 35 (L518: "the snapshot now shows `hp 0` and the same `bossId`").
- **Failure:** an executor who follows L164 hides the boss at the kill. The `<name> is down` toast never fires and rule 35 fails.
- **Direction:** define it once: shown while `now < endsAt`, whether closed or not.
- **Confidence:** high.

### 5. Major: rule 36's `returns === 1` contradicts the `settleBoss` formula
- **Plan lines:** L519 against L171.
- **Defect:** C deals over 400 and is in the top 3, so the plan's formula gives C two rolls. Both go to returns.
- **Failure:** the run shows `returns === 2` and two `rewarded { goods: null }`, so the rule cannot go green as written.
- **Direction:** add three stronger contributors, or assert 2.
- **Confidence:** high.

### 6. Major: rule 33 as written cannot give `maxHp === 2 × BOSS_BASE_HP`
- **Plan lines:** L516, L169.
- **Defect:** "a poll before nextGrid" followed by `clock.advance` to `nextGrid` moves the clock 6,400,000 ms. Both presence stamps expire, so spawn counts `max(1, 0)` and HP is one base. "B ... is engaged on its next poll" also conflicts with "every online account is engaged at spawn".
- **Same group:** rule 35's 60-tick batches need clock advances between them (tick bucket capacity 70, `client.ts:102-107`), and the plan does not mention this.
- **Direction:** advance to `nextGrid − 10_000`, have both traders poll, then advance 10,000. Name the advances between rule 35's batches.
- **Confidence:** high.

### 7. Major: an undeclared narrowing makes the top-3 bonus roll depend on the 5% threshold
- **Plan lines:** L171 (`!expired && in top && contribution >= threshold`), rule 35 (L518: B gets no `rewarded`).
- **Contract:** spec §6 and record §1.3 T1 give the guaranteed drop at 5% and a bonus roll to each of the top 3, with no threshold on the bonus.
- **Failure:** a top-3 contributor under 400 gets nothing, and the conflicts list does not record this departure.
- **Direction:** either follow the spec or add the narrowing to the conflicts list with a reason.
- **Confidence:** high.

### 8. Major: the `BOSS_BASE_HP` working rests on two false premises
- **Plan lines:** L259-268. Part B (L598-605).
- **Premise 1, "R1 keeps them alive":** false. R1 only acts on a full wipe. Heroes who fall one at a time stay down until a rest or a full wipe.
  - I simulated sustained fights against each party's zone boss, with wipe-in-place (scratch script, current sim).
  - The plan's per-tick numbers match the static formula exactly (59, 55, 92, 89, 106, fresh 14).
  - Actual sustained damage per tick: 41.3 and 41.6 for the 8 h parties, 87.8 and 86.0 at 40 h, 74.9 at 120 h, and 8.3 for a fresh party, which wipes 97 times in 2000 ticks.
- **Premise 2, "bots at zone 2 to 3":** `rollBotState(1, i)` leaves 11 of 12 bots at zone 1 with `highestZone` 1, mostly level 4. They deal about 25 per tick.
- **Effect on the default fake:** HP is base times online, so kill time is about base divided by the average party's damage rate. Bots at 0.25 ticks/s need about 21 minutes alone, so the boss usually expires before it dies.
- **Effect on Part B:** two bots at speed 10 need about 128 real seconds against a 120 s window. A fresh player needs about 48 idle ticks, or about 96 s in a turn, to reach 400.
- **Consequence:** the "is down, then Boss reward twice" path in Part B step 5 will almost never happen, so the kill path goes unchecked by hand.
- **Direction:** redo the working with the measured sustained damage, and size Part B so a kill is certain.
- **Confidence:** high. Verified by simulation.

### 9. Major: the dialog gates read engine flags that a fake restart never refreshes
- **Plan lines:** L388 and L392 (`toAccountView` flags), L430 (gate from `view.account.chatOpen`), Part A step 11 (L459).
- **Code:** `engine.ts:526` (`rememberConfig`) is called only from `doStart` and `sync`. Outage recovery goes through `doFlush`, which does not call it.
- **Failure:** after a restart with `--flag chat.enabled=false`, the Chat tab still shows the compose box and posts get `chat_closed`. Step 11 fails, and so does the record §1.7 promise that clients see flags within one poll.
- **Direction:** gates read `world.snapshot.flags` first and fall back to the config.
- **Confidence:** high. Verified.

### 10. Major: the chat length is counted two different ways, so one emoji message breaks everyone's poll
- **Plan lines:** L59 (Zod `ChatMessage.text` 1..200) against L165 (`[...trimmed].length > 200`, counting code points).
- **Defect:** Zod's `.max(200)` counts UTF-16 units, while the ledger counts code points.
- **Failure:** a 150-emoji message is accepted by the ledger. `HttpClient` then throws `ServerError` (`http.ts:141-144`) on the post and on every snapshot that carries it. Cold clients asking with `since 0` stay stale until 50 newer messages arrive.
- **Direction:** count the same unit at both ends, or give the schema headroom.
- **Confidence:** high.

### 11. Major: names on the highest-zone board are never refreshed
- **Plan line:** L167 ("replace the account's row if present and lower").
- **Failure:** a player's first commit happens within 15 s of starting, before linking, so the row is stored as `adventurer`. After the player links, the row is not replaced unless the zone rises. Nearly every real player is affected, and Part A step 5 shows it.
- **Direction:** always rewrite the account's name, and take the max of the values.
- **Confidence:** high.

### 12. Major (engine behaviour unverified): chat text can carry control characters and newlines
- **Plan line:** L165 (no rule on control characters).
- **d.ts:** Code's text is "free of control characters the same way" as Text's (E:1450), and a pane `title` with one is "refused" (E:6946).
- **Failure:** one curl-posted message containing `\n` or ESC becomes the newest message. It could break or blank every client's band World row and Chat tab, and the ledger is the phase 5 server core.
- **Direction:** refuse or strip C0 and C1 control characters in the ledger, and add that to rule 27.
- **Confidence:** medium. Whether the engine refuses or strips such text is not stated.

### 13. Minor: the predicted HP bar double-counts on a secondary
- **Plan lines:** L231 (`committedDealt` null on a secondary), L570 (subtracts `view.boss.dealt − 0`).
- **Defect:** a secondary's view is the committed server state, so the bar subtracts damage the server HP already includes.
- **Direction:** on a secondary, use `view.boss.dealt` as the committed value.
- **Confidence:** high.

### 14. Minor: Task 6's executor check, answered from the d.ts
- **Plan lines:** L415, L436.
- **What the d.ts says:**
  - `InputProps` (E:5159-5200) has `value?: string`: "the person's typing replaces it until the hook draws another".
  - `key` is required and is the element's address, which `ui.input` matchers name.
- **Defect:** remounting with `compose-${composeKey}` changes that address, so the focus ring likely leaves the box after every post.
- **Codebase pattern:** the codebase already uses controlled inputs, with value from an atom and `onInput` writing it back (`ui/sell.tsx:180-190`, `ui/orders.tsx:230-238`).
- **Direction:** put `draft` in `ChatState` instead of `composeKey`. Set it to `''` after a successful post; the drawn value then changes, so the box clears. Also say whether the compose `Input` gets `autoFocus`; Part A step 4 types without first focusing it.
- **Confidence:** high on the d.ts facts, medium on the focus behaviour.

### 15. Minor: the `ContractMake.kv` runners sit outside every Files list
- **Plan lines:** L525, L507, L539-546.
- **Defect:** `packages/ledger/src/ledger.contract.test.ts` and `servers/fake/src/server.contract.test.ts` must pass `kv`, but neither Task 9 nor Task 10 lists them.
- **Confidence:** high.

### 16. Minor: two `bots.test` assertions cannot pass as worded
- **Plan lines:** L365 against L164.
- **Defect 1:** "a viewer account reports `online 12`" is wrong because the caller is counted, which makes 13.
- **Defect 2:** "`order_filled` in some bot's committed loot log" names something that is not a loot entry. An order fill logs `trade bought` and `trade sold`.
- **Confidence:** high.

### 17. Minor: the declared red windows and the PR check line are inaccurate
- **Plan lines:** L8, L464, L612.
- **Defect 1:** `servers/fake` also fails to type-check from Task 1 to Task 3, because its `handlers` record is keyed by `ROUTES` (`server.ts:142`). The header does not say so.
- **Defect 2:** the plugin does not go red after Task 1, since it compiles against the vendored d.ts until `pnpm vendor`.
- **Defect 3:** `pnpm typecheck` and `pnpm test` do not cover the plugin (`package.json` scripts). The PR check lines should add `pnpm exec tsc -p plugins/promptfall` and `claude plugin test plugins/promptfall`.
- **Confidence:** high. Verified.

### 18. Minor: nothing stops overlapping polls
- **Plan lines:** L229-231.
- **Defect:** at the 5 s cadence with a 15 s timeout, up to three polls can be in flight. A slow, older answer can overwrite a newer snapshot, so boss HP regresses and the stale flag is reset wrongly.
- **Direction:** allow one poll in flight at a time.
- **Confidence:** medium.

### 19. Minor: two paths leave the poller's state behind
- **Plan line:** L236.
- **Defect 1:** `followSetting` (`register.tsx:375-380`) switches servers without `restart`, so a secondary keeps the old server's chat mark.
- **Defect 2:** after a hot reload the poller restarts at mark 0 over a populated `messages` buffer, which duplicates messages unless they are deduplicated by id.
- **Direction:** reset in `useServer`, and deduplicate by id.
- **Confidence:** medium.

### 20. Minor: several manual-pass steps can go red when nothing is wrong
- **Part A step 5 (L453):** expects bots at "zones 2 to 3", but they start with `highestZone` 1 (simulated).
- **Part A step 4 (L452):** the rate limit fires on the fifth or sixth line depending on the earlier "hello" and typing speed.
- **Part B step 3 (L602):** says "within 5 seconds", but the player polls every 15 s until it sees the boss, then syncs.
- **Part B step 3:** says HP is higher "if a secondary session polled", which contradicts presence being keyed by account.
- **Part B:** the outcome race is covered in finding 8.
- **Confidence:** high.

### 21. Minor: the acceptance checks start fakes on port 7777
- **Plan lines:** L352, L374.
- **Defect:** 7777 is the port Kevin's own fake uses in the manual passes, so it will collide. The global rules send a second port through `devserve run --port <N>`.
- **Confidence:** high.

### 22. Minor: `rollRewardItem` returning null is not handled
- **Plan lines:** L178, L171.
- **Defect:** the plan does not say what a roll that returns `null` pays: gold only, or skipped.
- **Confidence:** high.

### 23. Minor: the plugin's refusal texts hard-code tuning numbers
- **Plan line:** L422 ("200 characters", "5 messages per 50 seconds").
- **Defect:** this breaks L22's rule that tuning lives in four named files. The vendored ledger exports the constants.

### 24. Nit: R1 applies a pending party on a boss-mode wipe
- **Plan line:** L116.
- **Defect:** spec §4.3 applies a pending party only on a zone change. This is undeclared and harmless.

### 25. Nit: conflict 3 cites the wrong valuation
- **Plan line:** L622.
- **Defect:** `heroes.ts:68` is the gold for a hero contract vendored into a full roster, not "a boss roll".

### 26. Nit: some names have two homes
- **Plan lines:** L386-388, L416.
- **Defect:** `WORLD_DEFAULT` and `WorldState` are each declared in both `hooks/world.ts` and `state.ts` or `types`. `CHAT_DEFAULT` is created in Task 5 but its `ChatState` type only arrives in Task 6.

## Consider (judgement calls)

- **Conflict 12 (L631):** the stated reason does not hold against the d.ts, which has a `ui.close` hook (E:2300, E:6893) and `$.ui.panes()`. The render-driven approach still works; just record the true reason.
- **Conflict 13 (L632, L568):** the poller-triggered `sync()` saves at most 15 s over the next flush, which already delivers `boss_engaged` through `cursor_behind`. Dropping it removes a once-per-change memory and a flush started from the poller.
- **`lastConfig` (L235):** putting `speed` in `WorldSnapshot` next to `serverNow` would remove `lastConfig`, and with it the risk that an engine recovering from an outage leaves `speed` unknown (it defaults to 1).
- **Week reset in `leaderboards()` (L166):** it writes during a read. On the in-process host a secondary has its own `Ledger` over the shared store. Phase 2 market reads already expire there, so this is a known pattern, but the reset could be computed without writing.

## Noted

- Re-minted bots and reset players leave their old accounts' rows on `pf:boards`. The part B pass avoids this with a fresh `--data`.
- With `presence.enabled` off and `worldboss.enabled` on, nobody can ever be engaged. This follows the spec literally.
- A killing commit that also hits `hash_mismatch` hands over the rewards through adopt, with no toast.

## Dismissed

- **Bosses straddling the week boundary:** not reachable. A day is exactly 8 grid steps, so midnight is a grid point and a 20-minute window never crosses Monday 00:00.
- **Mirror's default batch-id counter colliding after a restart:** no caller uses the default (suite and bots inject UUIDs).
- **`--bots 0` dividing by zero:** `cli.ts:72-73` starts no bots at 0.
- **Bot budget overflow:** checked; 6 ticks per 20 virtual s against 10 refills.

## Clean

- **Grid arithmetic:** `1_700_000_000_000 mod 10_800_000 = 4_400_000`.
- **`weekStartOf`:** the formula is right; day 0 is a Thursday.
- **`scaledBossStats`:** reproduces the zone boss's atk, def and spd exactly at every zone (offset `enemies.ts:173`, verified on all 12 zones).
- **Static damage table:** reproduced exactly, both the L263-266 numbers and the "Checks" arithmetic.
- **`hashState`:** canonical JSON over the whole state, so `boss.dealt` is covered by the hash check.
- **Authority:** contribution, zone and board values all come from the server's own replay or host mint. No client claim is trusted.
- **Outage separation:** the poll stays out of the outage path, and a thrown submit or bootstrap still enters it (`engine.ts:254-267`).
- **Vendor rule:** the injected batch-id source keeps `Mirror` free of platform globals.
- **Validate namespaces:** no new `$` namespace is needed.
- **`Input`:** exists on terminal and desktop and is absent on mobile (E:3594-3660).
- **TTL in the contract runners:** both run at speed 1.
- **Cites spot-checked:** `combat.ts:7-25` and the six `enemyStats` call sites, `progression.ts:147-153, 174-194, 273-286`, `register.tsx:50-74, 76-79, 314-323, 516-530, 566-580`, `client.ts:100-107`, `dialog.tsx:37-44`, `market.ts:46-48`, `heroes.ts:68`.
- **Conflict reasons that hold:** 4, 5, 6, 7, 10, 11, 14, 15, 16, 18, 19, 21, 22.
- **Header:** the execution model and review wave lines are right.

