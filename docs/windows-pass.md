# Windows pass

Steps for a tester on Windows with Windows Terminal. Nobody has run Promptfall on Windows yet. The
game should work there as on macOS, drawn in half-block cells, with one exception: Claude Code
plays no sound on a Windows terminal, and the game should say so. Each step says what you should
see. Anything else is a finding: note it in the form at the end, with a screenshot.

Linux runs the same steps with its shell's syntax (step 8 becomes `PROMPTFALL_SANDBOX=1 claude`).

You need Windows 10 or 11, Windows Terminal, PowerShell, and a Claude account.

## Install

1. **Claude Code.** Install it as Anthropic's Claude Code setup page says for Windows, then open a PowerShell tab in Windows Terminal and run `claude --version`. Write the
   version down.
2. **The plugin.** Run `claude`, then type:

   ```
   /plugin marketplace add kevinshibuya/promptfall
   /plugin install promptfall@promptfall
   ```

   Quit with `/exit` and start `claude` again. A band appears above the prompt with the battle.
   On this first launch a toast says `Welcome to Promptfall. /promptfall heroes to meet your
   party`, and for 20 seconds the band's message window reads `Sound on; /promptfall sound off
   silences it. Welcome to Promptfall. /promptfall heroes to meet your party.` (a narrow band
   clips the end; the opt-out at its start is what matters).
3. **The versions.** Type `/promptfall account`. The detail window on the right has a line
   `Client <version> · sim v<n>`: write the whole line down. Write down the Windows version
   (run `winver`) and Windows Terminal's (Settings, About).

## The band at three widths

To check the window's width, run `$Host.UI.RawUI.WindowSize.Width` in a PowerShell tab of the
same size. The band needs height too: keep the window at least 40 rows tall.

4. **120 columns.** The Party tab (`p`) is one picture on a flat charcoal background: the battle
   stage, drawn in half-block characters (`▀▄`, two pixels a cell, in colour), with a strip of
   windows under it (enemies, the combat log, the party with its gauges, the gold). One white line
   with cut corners runs around the stage and the strip together. Enemies stand at the left, the
   three heroes at the right, and they bob and step forward to strike. Click the band (or press
   `ctrl+x`, then Tab with Ctrl released) so it takes keys, then press `l` and `w`: Loot and World
   show the strip alone. Press `p` to go back.
5. **100 columns.** Narrow the window to about 100 columns. The band becomes the compact form: a
   small stage beside one party window, both inside one white line.
6. **Under 100.** Narrow to about 90 columns. The band is one row of plain text, such as
   `Promptfall · Z1 w4 · K12 B0 W0 · 120g`. Widen back to 120 columns.

## The pane

7. **Each tab.** Type `/promptfall`. A dialog opens on Inventory. Visit every tab by its letter: `i`
   Inventory, `h` Heroes, `m` Market, `r` Orders, `a` Account, `o` Odds, `c` Chat, `b`
   Leaderboards. Each draws as framed windows with a `▶` cursor on its list, and nothing overlaps
   or wraps out of its frame. On Account, the rows read `Sound` with `quiet`, and `Renderer` with
   `auto (raster)`. (Sound may already read `quiet, silent here` if a Rare drop, a level-up or a
   zone arrival has toasted: step 13 explains.) Escape closes the dialog.

## The sandbox

The sandbox is a separate save where commands hand out what play would earn. It does not touch
the game you started above.

8. **Switch it on.** Quit Claude Code. In the same PowerShell tab:

   ```powershell
   $env:PROMPTFALL_SANDBOX = "1"
   claude
   ```

   The band shows `Sandbox` where the tactics normally sit. The switch lasts for this tab only.
9. **A boss.** Type `/promptfall sandbox boss treant`. It answers `Sandbox: Elder Treant is next`.
   Within a few seconds the Elder Treant appears at the left of the stage, larger than the other
   enemies, and the combat log names it.
10. **A wipe.** Type `/promptfall sandbox wipe`. It answers that the party fell. The heroes fall on
    the stage, a toast says the party fell, and the combat log has a line saying so.
11. **A Legendary item.** Type `/promptfall sandbox item oak staff legendary`. It answers
    `Sandbox: Oak Staff (legendary) dropped`. A hero strikes the front enemy down, a chest falls
    and opens, and the staff rises out of it. As it rises, a toast says `Legendary drop: Oak Staff`
    and the item shows on the Loot tab (`l`).

## The silence

12. **No sound.** Through steps 9 to 11, with your speakers or headphones on, no sound plays. The
    Legendary toast in step 11 has a cue on macOS; here it shows with no sound.
13. **The Account row.** Type `/promptfall account`. The Sound row now reads `quiet, silent here`,
    and the detail window says `This system has no audio player. Claude Code plays sound on macOS;
    the setting is kept.` The mark belongs to the session: this one started at `quiet` alone, and
   the first cue it tried marked it.
14. **The steps.** On the Account tab, press `s` a few times. The row cycles `normal`, `loud`,
    `off`, `quiet`; `silent here` follows every step but `off`. Stop on `quiet`.

When you are done, quit Claude Code. The variable goes with the tab; a new tab starts without the
sandbox.

## The form

Copy this into a message to Kevin.

```
Terminal and version:            Windows Terminal ...
Windows version (winver):        ...
Claude Code version:             ...
Promptfall client version:       ...

Steps that differed from the description (number, what you saw):
- ...

Anything else you noticed:
- ...
```

Attach a screenshot of each step that differed, and one of the band at 120 columns (step 4)
either way.
