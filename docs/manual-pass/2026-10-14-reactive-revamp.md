# Manual pass: reactive revamp (spec #221, PR #229)

Driven on 2026-10-14 by the main session on Opus, on Kevin's go, at `c862197` (steps 1 to 5)
and `1fb03c2` (steps 6 to 10, after step 7's fix). Ghostty at about 180 × 46, the font three
steps smaller from step 8 on, the plugin loaded with `--plugin-dir` from a scratch folder (the
repo holds a project-scoped install) and `PROMPTFALL_SANDBOX=1`. The renderer was forced to
`raster`: on `auto` the band stayed blank (#231). Keystrokes went in through AppleScript, refused
whenever Ghostty was not frontmost; pictures came out through `screencapture`. A first run on the
codex computer-use lane was thrown away: its band never drew and it judged steps on empty rows.

| # | Step | Result |
| --- | --- | --- |
| 1 | A prompt that keeps Claude busy: Aldric and Morwen trail speed lines in their class colours; Selene, in her white hit frame, shows none; the log reads "The party quickens." | green |
| 2 | `touch probe.txt && sleep 6`, approved at its permission prompt: the three press together behind the tall blue shield on the front hero, hits land, and they slide back as the tool resolves | green |
| 3 | `/compact`: the field empties, the party huddles at the fire ahead of the front hero, Aldric raised from 0 to 48 by the heal and huddled with the rest; dim `camping`, `g: back to the fight`, "The party makes camp while Claude gathers its thoughts." | green |
| 4 | Five seconds into camp, ctrl+x tab then `g`: a quarter-second later the break is mid-play (the fire fading, the party sliding back, the wisps walking in), not a snap; "The party breaks camp."; the `g` line gone | green |
| 5 | `/compact`, then `/promptfall go` twice: "Back to the fight.", then "The party is not camping." | green |
| 6 | `/compact`, then a prompt: camp breaks as the turn starts and the Wood Goblin walks back in; Haste runs the short turn | green |
| 7 | `/compact`, `/exit`, a new session: the party is fighting and the ledger's state reads `camp: false` | green after the fix; red at `c862197` and at `3fa4c40` |
| 8 | Elder Treant on the field, a Whisper Wisp joining in front, then a failing `ls`: "Claude stumbles. Elder Treant is enraged!"; the Treant flashes red and holds the tint until its next hit lands, the wisp untinted | green |
| 9 | A narrow window while camping: the compact band shows the fire, no enemy and a dim `camping` | green |
| 10 | `/promptfall sandbox worldboss`, then `/compact`: the fire between Tokenmaw and the party for its 4 seconds, the heal (Aldric 73 to 105), the boss stays, no huddle, no `g` line | green |
| 11 | `parity-haste.png` by eye: the lines read on the Image and the desktop, chunkier and dimmer but still streaks on the Raster | green: the status-glyph fallback is not built |

## Step 7

At `c862197` the new session drew `camping`, and a loop that read the sandbox ledger's record from
the plugin store (`state.camp` after `/exit`) stayed red on `3fa4c40` too, so the review's fix pass
did not cause it. A tagged store record in `end()` showed the session ending as a secondary: `/exit`'s
teardown draws on no surface for about five seconds before `session.end`, the 2-second drawn check
steps the primary aside first (flush, secondary, lease released), and the end's own break found
`canApply` false. `1fb03c2` breaks camp in the step-aside, before its flush, while the lease is
still held; a reactive test pins it, and the live loop went green.

## Notes, none of them blocking

- On the Raster a zone or world boss fight goes compact whenever the band gets fewer than 22 rows,
  which a 46-row Ghostty always does at the default font: #230, for row 6.
- `auto` sat on the probe's empty rows, and a forced `image` drew the band as its alt text: #231.
- Below the compact width the band collapses to one line, and that line has no camp marker.
- CI did not run: GitHub refused to start the jobs over the account's billing.
