# Combat flow manual pass

Run from the repository root on `feat/combat-flow`. Each step says what you should see; a step that
shows something else is a red. The band needs at least 116 columns and 10 free rows for the full
stage. `/promptfall account` opens the dialog on the Account tab.

The implementing session drove every step on 2026-10-05 (Claude Code 2.1.289, nested sessions on
Haiku 4.5), at commit 0f598ab:

- Terminal.app at 140 × 46 (raster). It recorded the screen text every ~0.15 s and the window every
  0.5 s, and clicked through CGEvent mouse events. Terminal.app draws the whole band in greys
  (stage numbers and HP bars included), so colours were judged in cmux.
- cmux (Ghostty engine, image renderer) in a separate window whose surface font was shrunk with
  cmd+minus to fit the full stage. It recorded `cmux read-screen` and a crop of the band about five
  times a second.
- The store was backed up first
  (`~/.claude/plugins/store/promptfall_inline-83e0680ce122.json.combat-flow-before-driven-pass`)
  and restored afterwards. Your machine still holds the v3 save, so your step 1 starts from the
  older-version notice.

## Steps

1. **Reset.** `claude --plugin-dir plugins/promptfall`. The band shows
   `Promptfall: this machine's data is from an older version, reset it in /promptfall account`.
   `/promptfall account`: the tab reads `Client 0.1.0 · sim v4` and offers
   `[ Reset this machine's data ]`. Click it: a new account (`Highest zone 1 · kills 0 · wipes 0`),
   and the band's party line comes back.
   - **Green** (Terminal.app, twice). The notice, `sim v4`, the reset, the new account, the band
     back with a gauge per hero (`60/60 ▰▱▱`).
2. **One action at a time, during a turn.** Send a prompt that keeps the model busy for 10 seconds
   or more. The stage plays one action at a time: one unit lunges, then its hits flash and their
   numbers rise; never two units moving at once. Each hero's party-line segment ends with a
   three-cell gauge (`▰▰▱`) that fills over the ticks, turns yellow while the hero waits in the
   queue, and empties when the hero acts.
   - **Green.** Ticks came every 2 s during the turn (party line at 0.2, 2.1, 4.1, 6.1, 8.2,
     10.1, 12.1, 14.0 s), then every 5 s once idle. The gauges moved every tick and emptied as
     heroes acted. Frames show one number per action. In cmux the queued gauge drew in yellow
     (Morwen `▰▰▰` while waiting, plain again after acting).
3. **Idle.** Stop prompting. Ticks come every 5 s: the actions come further apart (2.5 times the
   gap), and each lunge, flash and number keeps its own speed.
   - **Green.** Measured on the idle raster text: consecutive actions start 1.16 to 1.31 s apart
     (19 gaps), the 500 ms battle-time gap stretched 2.5 times. Animation speed itself is pinned
     by `timeline.test.ts`.
4. **Heal.** Let an ally drop below half HP. The White Mage heals: a green number rises over the
   healed hero, with no flash. While every ally is above half HP she only attacks.
   - **Green.** The knight at 25/60 went to 37/60 with no rest or wave clear (and 23 to 35, 9 to
     21 in other runs). In cmux a green `12` rose over the knight with no white flash. No heal
     happened while every hero was above half.
5. **Black Mage.** With two or three enemies up, the Black Mage's action hits every enemy at once:
   one lunge, then a number over each enemy at the same moment.
   - **Green** (Terminal.app). A frame shows `10` over two enemies at once, with no other actor
     moving.
6. **World boss.** `pnpm fake --port 7777 --data .promptfall/fake-combat.json --player-name <you> --boss-in 120`,
   then `/promptfall server http://127.0.0.1:7777`. When the boss engages, it takes turns in the
   queue like any enemy, and your contribution still rises. Finish with `/promptfall server local`.
   - **Green** (cmux, fake run through `devserve`). Tokenmaw engaged. The party line read
     `⚔ Tokenmaw ██ 51,204/52,000`, and the boss HP fell as the bots and the party fought. The boss
     hit back in turn: Selene went 40 to 18 to 0. This account's contribution
     on the server rose from 184 to 234 in 15 s.

## Known

- Wipes are more frequent than before the gauges (harness: 33 against 25 in 8 hours, 104 against
  61 in 40 hours). The pace targets hold. Seeded bots that never rest now stay in zone 1.
- Under about 130 columns the world boss's party-line segment keeps `⚔` and its HP but not its
  name (pinned in `band.test.ts`); the UI remake replaces this line.
- A hero whose gauge fills while no enemy is on the field stays queued (yellow) until the next
  enemy arrives.
