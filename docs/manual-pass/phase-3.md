# Phase 3 manual pass

Run from the repository root on terminals at least 100 columns wide, with three terminals open.
Each step says what you should see. A step that shows something else is a red.

Focus is shown in reverse video. In the dialog, Tab cycles the tabs, then the body's buttons,
then close. A focused `Input` takes every printable key, so press Tab or click out of the chat
compose box before typing a tab hotkey. The pane holds toasts until you press Esc.

## Part A: presence, chat, leaderboards, bots over HTTP (PR 1)

1. **Start the fake.** In the first terminal run `pnpm fake --port 7777 --player-name <your name>`.
   One line appears: `promptfall fake on http://127.0.0.1:7777 seed 1 speed 1 data <path>`, with
   no `flags` part at the end.
2. **Play on it.** In the second terminal run `claude --plugin-dir plugins/promptfall`, then
   `/promptfall server http://127.0.0.1:7777`, and link in the Account tab (`/promptfall account`,
   `Link GitHub`), as in phase 2 part A steps 2 and 5.
3. **World tab.** Press `w` on the band within 15 seconds. Row 1 reads
   `13 online · zone 1: ...` with the names of bots in zone 1, or `nobody else here`. Row 2 reads
   `highest zone 1 · kills ... · wipes ...`. Row 3 shows a bot's chat line about 100 seconds after
   the fake started (a bot speaks on every sixth act, one act per 20 seconds), and
   `chat is quiet` before that.
4. **Chat.** Run `/promptfall chat`. The last messages show, newest at the bottom, with bot lines
   arriving about every 10 seconds, and the cursor is already in the compose box. Type `hello` and press
   Enter: your line appears at once with your name, and the box is empty again.
   - Paste a 201-character line: `Too long: 200 characters at most` in red for 5 seconds, and
     nothing is posted.
   - Send short lines quickly: the fifth or sixth (the `hello` spent one token) reads
     `Slow down: 5 quick messages, then one every 10 seconds`.
   - Send `what the heck`: `That word is not allowed here`.
5. **Leaderboards.** Press Tab until the compose box loses focus, then `b`. The tab shows
   `Online by zone` with counts summing to 13, then `Highest zone` with the bots' names at zone 1 or
   2 (they start near zone 1 and climb as they play) and your row in cyan at zone 1, then
   `Boss damage this week` reading `no boss damage yet this week`. `/promptfall leaderboards` opens
   the same tab.
6. **Kill the fake.** Press Ctrl-C in the first terminal. Within 15 seconds the band's status row
   reads the retrying notice, as in phase 2. After 45 seconds the World tab's first row is dim
   (stale). A chat post flashes `Server unreachable`. The band keeps ticking.
7. **Bring it back.** Restart with the step 1 command and the same `--data`. Within 15 seconds the
   World tab is bright again, and the chat tail resumes with no gap in what you can see.
8. **Two sessions.** In a third terminal open a second `claude --plugin-dir plugins/promptfall`.
   Its band reads `playing in another session`. `/promptfall chat` there still posts: a line from
   the second session shows in the first within 15 seconds. The online count stays 13 (one entry
   per account): the first terminal's World tab reads `13 online`, and in the second terminal's
   `/promptfall leaderboards` the `Online by zone` counts sum to 13 (its band is the one-line
   secondary form, with no World tab).
9. **Backgrounded terminal.** Both sessions are one account, so the online count cannot show
   whether a hidden session's timers fire. Instead, hide or minimise the first terminal (the
   primary) for 2 minutes and watch the third terminal's band:
   - If it keeps reading `playing in another session`, the hidden primary kept renewing its 30 s
     lease, so its timers fire while backgrounded.
   - If within about 45 seconds it starts ticking as the primary, the lease lapsed and they do not.

   Bring the first terminal back (it becomes the secondary if it lost the lease). Write which it
   was under "Findings" below: it settles the open item on idle timers.
10. **Snapshot size.** Run
    `curl -s 'localhost:7777/v1/world' -H 'authorization: Bearer <a token from .promptfall/fake.json>' | wc -c`.
    It prints under 16000 bytes with a full chat tail. Note the number under "Findings" (the open
    item on response size).
11. **A flag off.** Stop the fake and start it with `--flag chat.enabled=false` added. The startup
    line ends in `flags chat.enabled=false`. Within 15 seconds the band's row 3 reads
    `chat is closed`, and the Chat tab reads `Chat is closed.` with no compose box. The
    Leaderboards tab still loads. Restart without the flag.
12. **In-process.** Run `/promptfall server local`. The World tab reads
    `1 online · zone N: nobody else here` and `chat is closed`, the Chat tab says
    `Chat is closed.`, and the Leaderboards tab lists you alone.

## Part B: the world boss (PR 2)

The fake runs at speed 10, so a boss window is 2 real minutes. Three bosses are fought, each one
brought near with `--boss-in <seconds>`, because the three outcomes need different company:

- An expiry needs you alone: a fresh party deals about 500 in the window against 4,000 HP.
- A certain kill needs the twelve bots: they deal about 85,000 in the window against 52,000 HP,
  so the kill lands at about 75 to 95 seconds.
- A restart mid-boss needs a third window.

A reward on a kill needs `you` over 200 before the kill lands, so start the turn before the
spawn. A fresh player beside twelve bots never reaches the top 3, so the bonus roll is proven by
contract rule 35 instead.

1. **Reset.** `SIM_VERSION` is 3, so a phase 2 store and a phase 2 fake snapshot are both behind
   it. Start the fake on a fresh path with no bots and the first boss four minutes out:
   `pnpm fake --port 7777 --speed 10 --bots 0 --player-name <you> --data .promptfall/fake-p3.json --boss-in 240`.
   The startup line ends in `boss in 240s`.
   - In the plugin session run `/promptfall server http://127.0.0.1:7777`: a fresh account there.
   - Then run `/promptfall server local`: the band is one line with the older-version notice. In
     `/promptfall account` press `Reset this machine's data`: a fresh in-process account.
   - Go back to the fake with `/promptfall server http://127.0.0.1:7777` and link.
2. **When is the boss?** Run `curl -s localhost:7777/v1/health`. `now` is in virtual ms; the real
   seconds until the spawn are `(10800000 - now % 10800000) / 10000`. Note them.
3. **Start the turn first.** About 20 seconds before the spawn, ask Claude to run `sleep 5` thirty
   times, one at a time: the party ticks every 2 seconds through the whole window.
4. **It appears.** Within 15 seconds of the spawn (your session polls every 15 s until it has seen
   a boss, then every 5):
   - A toast reads `World boss <name> has appeared` (after Esc if the dialog is open).
   - The Party tab's first enemy row reads `⚔ ☠ <name>` with a bar and `4,000/4,000` (1 online ×
     4,000: you alone; more if a viewer account, such as a curl, polled inside the last 45 s).
   - The status row ends in `boss 100% · 2m`.
   - The World tab's row 2 reads the boss line with `you 0`.
5. **Fight it.** `you` on the World tab rises by about 8 a tick (a fresh party). Heroes fall, and
   the whole party is healed in place on a wipe, with no retreat and no wipe toast. The bar falls
   between polls and corrects at each poll. No enemy spawns from the tool calls.
6. **It withdraws.** At the 2-minute mark the status row's segment disappears, with no down
   toast. Within 15 seconds:
   - One toast reads `Boss reward: <item> (<rarity>)`: you passed 200 (5% of the base) about 50 s
     into the turn.
   - The item is in the Inventory tab, and the loot log has one `boss reward ...` line.
   - The band is back to waves.
7. **Leaderboards.** In `/promptfall leaderboards`, `Boss damage this week` lists you alone,
   highlighted.
8. **It dies.** Ctrl-C the fake and restart it with twelve bots and a boss a minute out:
   `pnpm fake --port 7777 --speed 10 --bots 12 --player-name <you> --data .promptfall/fake-p3.json --boss-in 60`
   (same `--data`: your account and the window's boss history carry over).
   - Start the `sleep 5` loop again about 20 seconds before the spawn.
   - It appears as in step 4, with `52,000/52,000` (13 online × 4,000: you and the bots, who poll
     every 2 real seconds).
   - Within 2 minutes a toast reads `<name> is down`, expected at about 75 to 95 seconds; the bar
     on the Party tab falls steadily between polls.
   - Within 15 seconds after that: one `Boss reward: ...` toast and loot line if `you` passed 200
     before the kill. It does when the turn started before the spawn. With `you` under 200 there
     is no reward, which is the threshold working, not a red. There is no second reward (the
     bots hold the top 3). The band is back to waves.
   - In `/promptfall leaderboards`, `Boss damage this week` lists the bots above you, your row
     highlighted.
9. **A restart mid-boss.** Ctrl-C the fake and restart with the step 8 command. 30 seconds after
   the boss appears, Ctrl-C again and restart with the same command without `--boss-in`. Within
   15 seconds the boss line is back with the HP it had (the bots keep hitting it) and the fight
   resumes; the online count rebuilds from the polls.
10. **In-process.** Run `/promptfall server local` (the reset was done in step 1). No boss ever
    appears there; the World tab reads `1 online` and `chat is closed`.
11. **Validate.** `claude plugin validate plugins/promptfall` lists the same namespaces as phase 2.

## Findings

- Idle timers (step 9):
- World snapshot size (step 10): 4,516 bytes with a full 50-message tail of bot lines, measured against the fake on 2026-10-03; 50 messages at the 200-character limit come to about 14 KB, under 16,000.
