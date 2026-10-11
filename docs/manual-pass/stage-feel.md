# Stage feel manual pass (spec #72)

Checks the step, the chest and the reveal by eye, and that the log and the Loot tab wait for the
reveal. Run from the repository root. Each step says what you should see; a step that shows
something else is a red. The timings are tunables (`plugins/promptfall/hooks/stage/tuning.ts`):
note a step that feels too fast or too slow beside its red or green.

Run it in the sandbox, so items and bosses come on demand: start each session with
`PROMPTFALL_SANDBOX=1`. Start with `/promptfall motion full` and `/promptfall sound off`. On
Ghostty the band needs at least 116 columns and 19 free rows for a zone boss.

## Ghostty

1. **Start.** `PROMPTFALL_SANDBOX=1 claude --plugin-dir plugins/promptfall` in a window at least
   130 columns wide. The band's Party tab shows the party on the right and the purse reads
   `Sandbox`.
2. **A hero acts.** Run a few tool calls and watch the knight. Before it swings it steps a short
   way left, toward the enemies, holds there through its lunge and the hit, then steps back into
   line. The black mage and the white mage step too before they cast, and step back while the
   spell flies. The damage number rises over the target at the strike, not at the step.
3. **An enemy acts.** Watch a monster attack: it steps right toward the party by the same short
   distance, lunges from there, and steps back. The hero it hit flashes and the party window's HP
   bar drops at the strike.
4. **A boss acts.** `/promptfall sandbox boss elder treant` answers `Sandbox: Elder Treant is
   next`; the band grows and the boss walks on at the next empty tick. When it attacks it steps the
   same short distance as a goblin did, not a long slide, and steps back after its blow.
5. **A common drop.** `/promptfall sandbox item iron sword` answers `Sandbox: Iron Sword (common)
   dropped`. A closed chest falls onto the front monster's ground, sits for a beat, opens over
   about half a second, and the sword rises out of it on a small grey glow. The log's
   `Drop: Iron Sword.` line types out only once the sword has risen, not when the reply came back.
   The sword holds a little under a second, then the sword, its glow and the chest fade.
6. **A legendary drop.** `/promptfall sandbox item oak staff legendary`. The same chest, then the
   staff rises on a wider gold glow and holds about two seconds before it fades. The
   `Legendary drop: Oak Staff` toast appears when the reply comes back, before the chest opens;
   the log's `Legendary drop: Oak Staff.` line types once the staff has risen.
7. **A kill's drop.** Play until a monster dies with a drop. It dithers away while the chest falls
   out of it and lands where it stood; the reveal plays as in step 5, and the next monster walks on
   only after the chest has faded. The `… is defeated!` line types after the killing blow, the drop
   line after the item has risen, and hit lines in between are not held up by the drop line.
8. **A full inventory.** Repeat `/promptfall sandbox item iron sword` until the reply reads
   `Sandbox: Iron Sword vendored, inventory full`. The chest and the reveal play the same; the
   log's `Inventory full: Iron Sword vendored for …G.` line types once the sword has risen.
9. **The Loot tab during a reveal.** Press `l`, then run `/promptfall sandbox item oak staff rare`.
   The Loot rows do not change while the chest falls and opens; the `Oak Staff (rare)` row appears
   as the staff would have risen, about a second and a half after the reply, not at the next
   redraw. A sale from the Market tab shows its row at once.
10. **Motion still.** `/promptfall motion still`, then repeat step 2 and step 5. The bob stops; the
    step, the lunge, the chest and the reveal still play, and log lines show whole.
    `/promptfall motion full` afterwards.

## Desktop

Open this repository in the Claude Desktop app with the plugin loaded (`CLAUDE_CODE_PLUGIN_DIRS`
pointing at `plugins/promptfall`) and `PROMPTFALL_SANDBOX=1` in its environment.

11. **The step.** Repeat steps 2 to 4. The same step out, hold and step back plays without a
    redraw, on heroes, monsters and the boss.
12. **The reveal.** Repeat steps 5 and 6. The chest falls, opens and the item rises on its glow in
    one picture; the drop line types out once the item has risen.
13. **The Loot tab.** Repeat step 9 on the desktop. The new row appears at the band's next redraw
    after the item has risen, never before the chest has opened.
14. **A full inventory.** Repeat step 8: the vendored drop plays its chest, and its line waits for
    the reveal.
