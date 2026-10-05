# Combat flow manual pass

Run from the repository root on `feat/combat-flow`. Each step says what you should see; a step that
shows something else is a red. The band needs at least 116 columns and 10 free rows for the full
stage. `/promptfall account` opens the dialog on the Account tab.

The implementing session drove steps 1 to 3 on 2026-10-05 in Terminal.app (140 × 46, raster, Claude
Code 2.1.289 on Haiku 4.5), clicking through CGEvent mouse events and reading the window with
`screencapture`. It backed up the store first
(`~/.claude/plugins/store/promptfall_inline-83e0680ce122.json.combat-flow-before-driven-pass`) and
restored it afterwards, so your machine still holds the v3 save and step 1 starts from the
older-version notice. cmux ran too, but its pane was 97 columns, short of the full stage. The pass
stopped there: the account's weekly usage stood at 93%. Steps 4 to 6 are covered by tests (named
below) and are yours to see.

## Steps

1. **Reset.** `claude --plugin-dir plugins/promptfall`. The band shows
   `Promptfall: this machine's data is from an older version, reset it in /promptfall account`.
   `/promptfall account`: the tab reads `Client 0.1.0 · sim v4` and offers
   `[ Reset this machine's data ]`. Click it: a new account (`Highest zone 1 · kills 0 · wipes 0`),
   and the band's party line comes back.
   - **Driven: green.** Notice, `sim v4`, reset, new account, band back.
2. **One action at a time, during a turn.** Send a prompt that keeps the model busy for 10 seconds
   or more. The stage plays one action at a time: one unit lunges, then its hits flash and their
   numbers rise; never two units moving at once. Each hero's party-line segment ends with a
   three-cell gauge (`▰▰▱`) that fills over the ticks, turns yellow while the hero waits in the
   queue, and empties when the hero acts.
   - **Driven: green, except the colour.** 24 captures over 6 s of a turn: one number at a time
     (a 14 on the Hedge Sprite, 57 → 43), one lunge per action, the gauges moving per tick
     (`▰▰▱ · ▱▱▱ · ▰▱▱`, then `▱▱▱ · ▰▰▱ · ▱▱▱`). Terminal.app draws this band in greys, so the
     yellow could not be judged; it is covered by `band.test.ts` ("the party line draws each gauge").
     Check it in Ghostty.
3. **Idle.** Stop prompting. Ticks come every 5 s: the actions come further apart (2.5 times the
   gap), and each lunge, flash and number keeps its own speed.
   - **Driven: partly.** The party line changed once per idle tick, and enemies died and spawned
     across idle ticks. The 2.5× spacing was not measured on screen; it is pinned by
     `timeline.test.ts` ("the cadence stretches the gaps between actions, not the actions").
4. **Heal.** Let an ally drop below half HP (a turn boss, or zone 2 at level 1). The White Mage
   heals: a green number rises over the healed hero, with no flash. While every ally is above half
   HP she only attacks.
   - Not driven. Covered by `picker.test.ts` (never heals at 50%+, heals 70-80% at 25%, never when
     alone) and `combat.test.ts` ("the white mage heals with a heal effect and no hit").
5. **Black Mage.** With two or three enemies up, the Black Mage's action hits every enemy at once:
   one lunge, then a number over each enemy at the same moment.
   - Not driven. Covered by `timeline.test.ts` ("a black mage's three hits number three enemies
     at one impact").
6. **World boss.** `pnpm fake --port 7777 --data .promptfall/fake-combat.json --player-name <you> --boss-in 120`,
   then `/promptfall server http://127.0.0.1:7777`. When the boss engages, it takes turns in the
   queue like any enemy (one lunge per boss action), and your contribution in the World tab still
   rises. Finish with `/promptfall server local`.
   - Not driven. Covered by contract rules 33 to 40 (`pnpm test`) and `combat.test.ts` ("a
     world-boss hit reports its amount while the boss hp stays put").

## Known

- Wipes are more frequent than before the gauges (harness: 33 against 25 in 8 hours, 104 against
  61 in 40 hours). The pace targets hold. Seeded bots that never rest now stay in zone 1.
