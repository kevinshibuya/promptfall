# Phase 2 manual pass

Run from the repository root on a terminal at least 100 columns wide, with two terminals open.
Each step says what you should see. A step that shows something else is a red.

## Part A: ledger, HTTP fake, outages, link flow (PR 1)

1. **Start the fake.** In the first terminal run `pnpm fake --port 7777 --player-name <your name>`.
   One line appears: `promptfall fake on http://127.0.0.1:7777 seed 1 speed 1 data <path>`, the
   path ending in `.promptfall/fake.json`.
2. **Play on it.** In the second terminal run `claude --plugin-dir plugins/promptfall`, then
   `/promptfall server http://127.0.0.1:7777`. The reply reads
   `Promptfall now plays on http://127.0.0.1:7777`. `/promptfall account` shows
   `Server: http://127.0.0.1:7777` on the Account tab. The account is fresh (zone 1, 0 gold, the
   welcome line), since nothing moves between servers. The band ticks as in phase 1.
3. **Kill the fake.** Press Ctrl-C in the first terminal. Within 15 seconds the band's status row
   reads `Promptfall: server unreachable, retrying`. The band keeps ticking for two minutes, then
   the status row reads `Promptfall: server unreachable` and HP stops moving.
4. **Bring it back.** Run the step 1 command again, same `--data`. Within 45 seconds the notice
   clears and ticking resumes, with the progress made during the outage kept (gold did not reset).
5. **Link GitHub.** `/promptfall account`, press `Link GitHub`. A line reads
   `Enter <8-character code> at https://github.com/login/device`. Within 5 seconds it becomes
   `Linked as <your name>`.
6. **Back to the in-process ledger.** Run `/promptfall server local`. The reply reads
   `Promptfall now plays on in-process`.
   - With a phase 1 store on this machine, the band is one line reading
     `Promptfall · Promptfall: this machine's data is from an older version, reset it in
     /promptfall account`. `/promptfall account` shows `Server: in-process` and a
     `Reset this machine's data` button. Pressing it starts a fresh account: the band comes back
     at zone 1 with the welcome line.
   - With no phase 1 store, a fresh account starts directly.
7. **Look at the snapshot.** Quit both. `head -c 300 .promptfall/fake.json` shows JSON starting
   `{"clock":{"virtualAt":` followed by the `kv` map with `pf:` keys.
