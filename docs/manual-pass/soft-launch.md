# Soft launch manual pass

The pass before the wave's invitations (`docs/launch-checklist.md`). Two machines: the **laptop**,
with this checkout, `PROMPTFALL_ADMIN_TOKEN` and `PROMPTFALL_BOX` in its shell, and a **second
machine** that has never run Promptfall, with Claude Code and Docker and no checkout. The repo is
public, `v0.3.0` is deployed and smoked, and the server runs `PROMPTFALL_BOTS=6`. Each step says
what you should see; a step that shows something else is a red.

## Part A: a fresh install on the public server

1. **Install.** On the second machine, in a Claude Code session, run
   `/plugin marketplace add kevinshibuya/promptfall`, then `/plugin install promptfall@promptfall`,
   and restart the session. The band draws above the prompt, the first launch toasts its welcome,
   and the party fights in zone 1.
2. **The default server.** Run `/promptfall server`. It names
   `https://promptfall.kevinshibuya.com`. Open `/promptfall account`: the detail window reads
   `Server https://promptfall.kevinshibuya.com` and an `Account <id>` line. Write the id down.
3. **Other people.** Press `w` on the band within 15 seconds. The World tab counts at least 7
   online (you and six bots). `/promptfall leaderboards` shows your row and no `[bot]` name on
   either board.

## Part B: a real GitHub link

4. **Start the link.** On the Account tab, run Link GitHub. The detail window shows GitHub's code
   (`XXXX-XXXX`), and under the picture the URL `https://github.com/login/device`.
5. **Authorise.** Open the URL in a browser signed in to a real GitHub account, enter the code and
   authorise Promptfall. Within one poll interval (about 5 seconds) the Account tab reads
   `Linked as <your GitHub login>`.
6. **The name.** Post `hello from the wave` in `/promptfall chat`. The line shows under your
   GitHub login. On the laptop, run `ssh "$PROMPTFALL_BOX" 'cd ~/apps/promptfall && docker compose
   logs --since 10m promptfall'`: access lines for the link calls, and no code, token or login in
   any of them.

## Part C: a trade with a bot

7. **Buy from a bot.** Open `/promptfall market`. Listings by `[bot] ` names are there; if none is
   yet, wait a few minutes (a bot acts every 20 seconds). Enter on a bot's listing you can afford,
   answer Yes: the gold leaves the purse, the item or hero lands in the inventory or roster, and a
   purchase toast shows.
8. **Sell to a bot.** List a Rare or better item at a low price from its Sell command. Within a few
   minutes a bot buys it: a sale toast, and the gold net of the 5% fee in the purse.

## Part D: a world boss at `--boss-in`

The public server keeps the real three-hour grid, so the boss runs on the released image on the
second machine, with its own store and a fake link.

9. **Start it.** On the second machine run
    `docker run --rm -p 127.0.0.1:7778:7777 -e PROMPTFALL_ADMIN_TOKEN=pass-token ghcr.io/kevinshibuya/promptfall:v0.3.0 --host 0.0.0.0 --store sqlite:/tmp/pass.sqlite --bots 6 --boss-in 90`.
    Its first line names the address and the store.
10. **Point at it.** `/promptfall server http://127.0.0.1:7778`. The band boots a fresh account
    there. Link GitHub on the Account tab: the fake link approves on the first poll as `player`.
11. **The boss.** About 90 seconds after the start, the "World boss … has appeared" toast shows,
    the stage holds the boss alone, and the enemy window shows its global HP bar and time left,
    dropping as the party's and the bots' hits land. When it dies or expires, the "… is down" toast
    shows, and a reward toasts as "Your share of …" if the party dealt enough.

## Part E: a ban

12. **Ban the scratch account.** Read its id on the Account tab, then on the second machine run
    `curl -sS -X POST http://127.0.0.1:7778/v1/admin/ban -H 'authorization: Bearer pass-token' -H 'content-type: application/json' -d '{"accountId": "<id>", "reason": "manual pass"}'`.
    It answers the id with `banned: {reason, at}`. The container's output has one
    `admin <time> ban <id> ok` line and no token.
13. **The player's side.** Within one cadence the band pauses and reads
    `Promptfall: this account is banned: manual pass`. Start a new session: it reads the same line.
14. **Back.** Stop the container (Ctrl-C) and run
    `/promptfall server https://promptfall.kevinshibuya.com`. The linked account from Part B plays
    again.

## Part F: a flag flip

15. **Off.** On the laptop, flip chat off as `deploy/README.md` (Flags) shows, with
    `{"chat.enabled": false}`. It answers the flags in force with chat off. Within 15 seconds, on the
    second machine, `/promptfall chat` says chat is closed and a post is refused.
16. **It persists.** On the laptop, restart the server:
    `ssh "$PROMPTFALL_BOX" 'cd ~/apps/promptfall && docker compose restart promptfall'`. Once the
    band is back from "server unreachable", chat is still closed.
17. **On.** Flip it back with `{"chat.enabled": true}`. Chat opens again within 15 seconds. The logs
    show one `admin <time> flags chat.enabled=… ok` line per call and no token.

## Part G: a delete

18. **Delete.** On the second machine, on the Account tab, run Delete my account on this server.
    It asks `Delete your account on this server? It cannot be undone.` Answer Yes. The message
    window reads `Promptfall: your account on this server is deleted. A fresh one plays here now.`,
    the Account tab shows a new `Account <id>`, unlinked, and the party starts over in zone 1.
19. **Gone.** Your old name is on neither board, and your listings from step 8 (if any were left)
    are not in the market.

## Part H: a restore from R2

20. **Ship a copy.** On the box, `~/apps/promptfall/backup.sh` exits 0, and the new copy is listed
    under `nightly/` in R2.
21. **Restore to scratch.** Follow `deploy/README.md`, Restore from R2, steps 1 to 3, into
    `~/promptfall-restore`. Step 3 prints `ok` and a key count above zero. Stop there: the live store
    is not touched. Remove `~/promptfall-restore` afterwards.

## Findings

Write here what went red, with the step number, before the wave is invited.
