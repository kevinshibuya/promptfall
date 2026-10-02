# Phase 1 manual pass

Run from the repository root on a terminal at least 100 columns wide. Each step says what you
should see. A step that shows something else is a red.

1. **Load the plugin.** Run `claude --plugin-dir plugins/promptfall`. Within 5 seconds a 4-row
   band appears above the prompt: three hero rows (Knight, BMage, WMage with names, levels and
   green HP bars) and a status row reading `Zone 1 Greenmeadow Road · wave 1/10 · 0g`. On a first
   run a toast says `Welcome to Promptfall. /promptfall heroes to meet your party`, and the status
   row shows the same line for 20 seconds.
2. **Watch it idle.** Wait 20 seconds without typing. An enemy appears in the right third of the
   first hero row, HP numbers move every 5 seconds, and kills add gold.
3. **Make Claude work.** Ask for something that takes a few tool calls, for example `list the
   files in packages/sim/src and count the lines of each`. Each tool call adds an enemy, up to
   three on screen. Rounds come every 2 seconds while the turn runs.
4. **Open the dialog.** Run `/promptfall`. A dialog opens on the Inventory tab with the tab row
   `Inventory Heroes Account Odds`. Esc closes it.
5. **Equip an item.** Once an item has dropped (the status row says `last: ...`), open
   `/promptfall`, press `equip` on it and pick a hero in the list. The item shows `[hero name]`.
   An item no hero can wear says so instead. Press `unequip` on it: the `[hero name]` goes and
   `vendor` comes back.
6. **Vendor one.** Press `vendor Ng` on an unequipped item. It leaves the list and gold rises by N.
7. **Recruit once.** On the Heroes tab (`h`), press `Recruit 200g`. With less than 200 gold a red
   line reads `Refused: not_enough_gold` and clears after 5 seconds. With enough, a new hero joins
   the roster and a toast names them.
8. **Collapse the band.** Press `ctrl+x tab` to focus the band, then `c`. The band shrinks to one
   line like `Promptfall · Z1 w3 · K60 B36 W40 · 12g`. `c` again restores 4 rows. `l` and `w`
   switch the hero rows to the loot log and the world line.
9. **Narrow the terminal.** Resize the window under 100 columns. The band drops to its one-line
   form on its own and comes back when you widen it.
10. **Switch it off and on.** Run `/promptfall off`. The band disappears and the reply reads
    `Promptfall band is off for this session`. The game keeps playing out of sight, and
    `/promptfall` still opens the dialog. Run `/promptfall on`. The band comes back with the
    progress made meanwhile.
11. **Second session.** Open another terminal in the same folder and run the same command as
    step 1. Its band is one line starting `playing in another session`, and it does not fight.
    Quit the first session: quitting releases the lease, so within about 10 seconds the second
    one takes over and its band grows back to 4 rows.
12. **Persistence.** Quit both sessions and start one again. The band comes back at the same zone,
    gold and levels, with no welcome toast. Quitting flushes the last batch, so nothing is lost;
    only a crash loses the last 15 seconds.
13. **Desktop, if available.** Open this repository in the Claude Desktop app with the plugin
    loaded (`CLAUDE_CODE_PLUGIN_DIRS` pointing at `plugins/promptfall`). The band draws and HP
    moves. This checks `session.attach` with surface `desktop`, which no test covers live.

To start over as a new player, move away the plugin's store file,
`~/.claude/plugins/store/promptfall_inline-*.json`, while no session runs. A store written
before the 2026-10-02 fix pass carries the old budget record and must be deleted.
