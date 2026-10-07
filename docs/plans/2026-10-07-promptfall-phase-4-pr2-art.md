# Promptfall phase 4 PR 2: the real art, implementation plan

**Goal:** Replace every concept placeholder with generated, approved pixel art (4 heroes with attack
poses, 72 enemies, 4 world bosses, 40 items) and the four placeholder cues with CC0 clips, so the
build reports `PLACEHOLDER_COUNT === 0`.
**Architecture:** gpt-image-2 (through `codex-image`) draws dense sprite sheets on magenta;
`pnpm slice` recovers each sprite's native pixel grid and shrinks it to its canvas; the cut PNGs are
committed under `art/sprites/` and `pnpm sprites` builds them as today. A contact script renders
each batch at ship size and on the real stage for Kevin's review on one artifact page. The engine
is untouched.
**Spec:** `docs/plans/2026-10-07-phase-4-pr2-grill.md` (this PR's grill, the contract), on top of
`docs/plans/2026-10-04-phase-4-grill.md` §1.8, §1.10, §1.12 and the PR 2 hand-over in
`docs/plans/2026-10-04-promptfall-phase-4.md`.
**Execution model:** opus

## Global constraints

- Branch `phase-4-pr2-art` (exists, holds the grill). One PR into `ai-staging`.
- Full check line, before each task's final commit:
  `pnpm lint && pnpm typecheck && pnpm test && pnpm vendor:check && pnpm sprites:check && pnpm font:check && pnpm exec tsc -p plugins/promptfall && claude plugin validate plugins/promptfall && claude plugin test plugins/promptfall`.
  The sim balance test `40 hours reach zone 4 to 7` can time out at 5 s on a loaded machine: re-run
  it, or run it with `--testTimeout 30000`; that is not a failure.
- No `any`.
- Canvases, unchanged from PR 1: NES sprites (heroes, hero attack poses, monsters, items) 16 × 16,
  at most 4 colours including the black outline, snapped to `art/palettes/nes.json`; SNES sprites
  (zone bosses, turn bosses, world bosses) at most 48 × 34 and 16 colours from the 64-colour
  `art/palettes/snes.json`. Turn bosses keep their manifest `fit: { height: 24 }`. The build fails
  a sprite that breaks a rule.
- Every source sprite faces right. The stage flips heroes.
- Hero rarity slots (grill Q7, Q11): knight cape (red), black mage robe (purple), white mage chest
  sigil (teal), archer cape (gold). Each pose's `rarityColor` is the exact colour of that area in
  its cut PNG.
- Raw sheets live in the gitignored `art/sheets/`; they are never committed. Each sheet's prompt
  and slice commands are committed in `art/sheets.md` (Task 5 creates it).
- The approved inputs already saved in `art/sheets/` (gitignored, on this machine):
  `dense-heroes-zone1-items.png` (the dense sheet), `zone1-bosses.png` (zone 1 run 3),
  `zone1-r2.png`, `world-bosses-r1.png` (designs to keep), `heroes-take-a.png`, `heroes-take-b.png`,
  the scale template `tpl-zone.png`, the prompt parts `bg.txt`, `common.txt`, `tpl.txt`, `p1.txt`,
  `p2.txt`, `p4.txt`, `p5.txt`, and the picked clips `drop-a.wav`,
  `legendary-b.wav`, `level_up-b.wav`, `boss-a.wav`. If `art/sheets/` is missing, stop and report
  `blocked: art/sheets/ is gone`; the review artifact https://claude.ai/artifact/FgkfcBP9UwjDWRXc3Ubi2S
  holds JPEG copies only, which are not good enough to slice.

### Codex image runs

- Every image run goes through `~/.claude/bin/codex-run.sh <label> exec -m gpt-6-astra -C <abs dir>
  -s workspace-write --skip-git-repo-check -i=<ref> … "<prompt>"`, with `-C` and the output path
  inside the gitignored `art/sheets/` (absolute path). References use the attached `-i=<path>` form.
  Labels start `pf2-`.
- Run it with `run_in_background: true` and wait for the completion notification. Never poll and
  never sleep-loop: no Opus is spent idling on codex (Kevin, grill round 4). Independent sheets may
  run two at a time.
- After each run: `file <out>` must report PNG image data, and `~/.claude/bin/codex-usage.sh` is
  read once. A run costs about 0.7% of the weekly window and 5% of the 5-hour window.
- **A limit hit is a hard stop** for every image task: no retry, no other GPT model, no reset credit.
  Finish the non-codex tasks that do not depend on the missing sheet, then report the reset time and
  stop. A 5-hour window above 85% before a run: wait for its reset (report it), don't start a run.
- The prompt is always assembled in this order: `bg.txt`, the sheet's body, `common.txt`, then
  `Use your image_gen tool (gpt-image-2). Save the result as a PNG to <abs path>.` The magenta
  block goes first because two of three runs came back on black without it.
- Every run after Task 5 attaches the approved style references, in this order: the dense sheet
  `art/sheets/dense-heroes-zone1-items.png` and the boss sheet `art/sheets/zone1-bosses.png`.
- The sheet bodies are verbatim in this plan (Tasks 7 to 11), built from the briefs table below.

### Review

- One review artifact, created in Task 7 and updated in place after: the gate page's look (its
  file is the template, copied into `.promptfall/review/index.html`: dark ground, sprite strips at
  6×, captions with ids). Each batch section shows the raw sheet (JPEG, 1024 wide), the contact
  images, and the ids. Kevin answers per zone (or per group) with GREEN or the ids to redo.
- Review never blocks the work. A task that publishes a batch continues to the next task. Redo ids
  collect in `art/sheets.md` under "Redos" and ride the spare cells of a later sheet (Task 11).

## Briefs

One line per sprite still to generate (grill Q17). The zone theme goes into each sheet's body.
Items, places and paper show no letters or numbers.

| Zone | Theme for the prompt |
| --- | --- |
| 2 Whisperwood | an old whispering forest: moss, dim greens, pale spirit light |
| 3 Marsh of Sighs | a foggy swamp: murky teal, mud brown, reeds |
| 4 Old Barrow Hills | grave mounds under moonlight: grey stone, bone, cold blue |
| 5 Saltglass Coast | a bright shore of glassy sand: sea blue, white salt, coral |
| 6 Emberfall Caves | lava caves: black rock, orange glow, soot |
| 7 Frostvein Pass | a snowy mountain pass: ice blue, white, grey stone |
| 8 Sunken Abbey | a flooded stone abbey: teal water, wet stone, candle gold |
| 9 Ashen Waste | a grey ash desert under a red sky: ash grey, rust, bone |
| 10 Starfall Spire | a tower among the stars: deep navy, silver, starlight |
| 11 Hollow King's Court | a dead royal court: purple, tarnished gold, black |
| 12 The Unwritten Reach | a world of blank paper and ink: white, black ink, blue ink |

| Id | Role | Brief |
| --- | --- | --- |
| `bramble_wolf` | swift | a lean grey-green wolf with thorny bramble vines twined through its fur |
| `moss_golem` | tank | a squat boulder golem under thick moss, two green eye slits |
| `wood_goblin` | brute | a bark-skinned forest goblin with a heavy branch club and a leaf loincloth |
| `whisper_wisp` | caster | a pale floating spirit flame with a faint sad face, trailing wisps |
| `elder_treant` | boss | an ancient walking tree, a gnarled face in its trunk, root legs, a mossy canopy |
| `owlbear_cub` | turn boss | a hulking young owlbear: feathered owl head, brown bear body, big claws |
| `bog_lurker` | brute | a hunched mud brute draped in pond weed, long dangling arms |
| `marsh_leech` | swift | a fat striped leech rearing up, a round toothed sucker mouth |
| `mire_toad` | tank | a huge warty toad with a bloated throat sac, mud brown and olive |
| `will_o_wisp` | caster | a small blue-white ghost light with a bright core and two tiny eyes |
| `sigh_hag` | boss | a stooped swamp witch in a tattered moss shawl, long grey hair, a crooked staff with a hanging lantern |
| `giant_heron` | turn boss | a tall grey heron with a spear-like beak, wings half spread, standing in reeds |
| `barrow_wight` | caster | a gaunt ghostly corpse in rotting burial robes and a rusted circlet, cold blue eyes, casting |
| `grave_hound` | swift | a skeletal hound with glowing eyes and bare ribs |
| `bone_soldier` | brute | a skeleton warrior with a dented round shield and a notched sword |
| `cairn_crawler` | tank | a beetle-like crawler whose shell is a pile of cairn stones |
| `barrow_king` | boss | an undead king in tarnished plate and a tall crown, a great sword, a tattered cloak |
| `crypt_ogre` | turn boss | a hulking grey-skinned ogre swinging a tombstone as a club |
| `salt_crab` | tank | a big crab with a crust of white salt crystals and one giant claw |
| `gull_harpy` | swift | a harpy with gull wings and talons, white and grey feathers |
| `drowned_sailor` | brute | a waterlogged zombie sailor in a striped shirt, seaweed, a boat hook |
| `tide_witch` | caster | a sea witch with kelp hair, a shell crown and a coral staff |
| `glass_leviathan` | boss | a huge sea serpent of translucent sea glass, cyan and white, crystal fins |
| `reef_troll` | turn boss | a barnacle-crusted troll with coral growths and a driftwood club |
| `ember_imp` | swift | a small red imp with bat wings and a flaming tail |
| `magma_beetle` | tank | a heavy beetle with a cracked black shell glowing orange in the seams |
| `cinder_orc` | brute | a soot-black orc with burning eyes and a jagged iron axe |
| `flame_adept` | caster | a hooded fire cultist in red robes conjuring a fireball |
| `emberfall_wyrm` | boss | a fire dragon with molten cracks along black scales, wings spread, smoke from its jaws |
| `slag_giant` | turn boss | a giant of cooling slag and rock, lava dripping from its fists |
| `frost_wolf` | swift | a white wolf with an icy blue mane and frosted breath |
| `ice_troll` | brute | a blue-skinned troll with icicle tusks and a frozen club |
| `rime_golem` | tank | a blocky golem of packed ice and snow with a glowing blue core |
| `snow_shaman` | caster | a fur-cloaked shaman with an antler headdress and a frost staff |
| `frostvein_yeti` | boss | a huge white-furred yeti with blue ice veins along its arms, roaring |
| `avalanche_drake` | turn boss | a stocky white drake with a snow-crusted crest and icy wings |
| `drowned_monk` | brute | a bloated drowned monk in a soaked brown habit swinging a censer |
| `abbey_gargoyle` | tank | a crouching stone gargoyle with folded wings, grey and mossy |
| `bell_wraith` | caster | a hooded spectre holding a cracked bronze bell |
| `eel_serpent` | swift | a long dark eel with glowing yellow spots, jaws open |
| `sunken_abbot` | boss | a towering undead abbot in rotted vestments and a mitre, a crozier dripping water |
| `choir_of_bones` | turn boss | three singing skulls in choir collars fused onto a bone pillar |
| `ash_ghoul` | brute | a hunched grey ghoul caked in ash, long claws |
| `dust_stalker` | swift | a lean sand-coloured lizard stalker in a cloth wrap, mid-run |
| `cinder_colossus` | tank | a squat colossus of charred stone with ember cracks |
| `ash_oracle` | caster | a veiled oracle in grey robes holding a smoking bowl |
| `waste_tyrant` | boss | a giant warlord in scorched black plate, a horned helm and a huge cleaver |
| `sand_basilisk` | turn boss | a long sand-yellow lizard with a frilled crest and a stony glare |
| `star_sentinel` | tank | a silver construct guardian with a star-shaped head and a tower shield |
| `comet_hound` | swift | a blue hound with a glowing comet tail |
| `spire_warden` | brute | a warden in silver plate with a starry halberd |
| `astral_seer` | caster | a seer in a starfield cloak holding a glowing orb |
| `fallen_star` | boss | a burning fallen star: a jagged crystal core with arms of white fire |
| `void_manta` | turn boss | a dark purple manta ray gliding, star speckles on its wings |
| `hollow_knight` | brute | an empty suit of tarnished plate, only darkness inside the visor, a broad sword |
| `court_jester` | swift | a grinning undead jester in purple and gold motley with two daggers |
| `throne_guard` | tank | a heavy royal guard in gold-trimmed armour with a tower shield |
| `court_mage` | caster | a pale court magician in a tall collar and purple robes, casting |
| `hollow_king` | boss | an empty crowned royal robe with two glowing eyes and a black sceptre |
| `royal_chimera` | turn boss | a chimera with lion, goat and serpent heads in royal purple and gold |
| `ink_horror` | brute | a dripping black ink monster with many grasping arms |
| `blank_page` | swift | a living sheet of blank paper folding like a bird, one inky eye |
| `quill_golem` | tank | a golem of stacked closed books with quill feathers as spines |
| `erased_scribe` | caster | a faded scribe half rubbed out, holding a quill |
| `unwritten_one` | boss | a towering faceless figure of white paper and swirling ink, an empty outlined face |
| `margin_beast` | turn boss | a beast made of scribbled ink doodles from a page margin |
| `dragonfang` | item | a curved sword made from a dragon's tooth |
| `storm_rod` | item | a short wand crackling with blue lightning |
| `void_scepter` | item | a dark purple sceptre topped with a black orb |
| `willow_staff` | item | a pale willow staff with a few leaves |
| `silver_crook` | item | a silver shepherd's crook |
| `sacred_mace` | item | a golden mace with a sunburst head |
| `seraph_staff` | item | a white staff with small wings at the top |
| `oak_bow` | item | a plain wooden bow |
| `longbow` | item | a tall yew longbow |
| `starshot_bow` | item | a blue bow with star-shaped tips |
| `steel_plate` | item | a steel breastplate |
| `mithril_mail` | item | a shining silver-blue chainmail shirt |
| `cloth_robe` | item | a simple brown cloth robe |
| `mystic_robe` | item | a blue robe with a star pattern |
| `sage_robe` | item | a green robe with gold trim |
| `astral_robe` | item | a navy robe scattered with stars |
| `hide_coat` | item | a shaggy fur hide coat |
| `ranger_garb` | item | a green-brown hooded tunic |
| `shadow_leather` | item | black leather armour |
| `wind_cloak` | item | a pale flowing cloak |

## Narrowings against the grill

1. **Monster sheet B and the item sheet merge** (grill Q15 had them apart). Zones 10 to 12 leave
   12 monsters and there are 20 items left: exactly one 8 × 4 sheet, one run saved, and no empty
   cells that could change the model's pixel size. Redos get their own sheet in Task 11.
2. **The zone 12 boss sheet goes last** and fills its second row with redo bosses, or with a second
   take of zone 12's two bosses if no boss redo is pending, so a 2 × 2 sheet never has empty cells.
3. **`--derive-snes-master` reads `file` entries only**, so the concept aliases still in the
   manifest at Task 7 do not leak into the master (grill Q21 assumed real art only).
4. **The contact script writes a folder of PNGs, not one image**, so the review artifact can caption
   each sprite with its id in HTML; text rendered into a PNG would need a font path the stage
   doesn't have.
5. **`art/concept/` is deleted in Task 12** once no manifest entry aliases it; the `alias` support
   in `scripts/sprites.ts` stays for later content.

## Tasks

### Task 1: `pnpm slice` recovers the native grid

**Files:**
- `scripts/slice-sheet.ts` — modify: replace the point-sampled shrink in `sliceCell` with native-grid recovery and an outline-aware majority shrink; add `--native <dir>`; nothing else in the CLI changes
- `scripts/slice-sheet.test.ts` — create
- `scripts/png.ts` — modify only if a helper is missing (none expected)

**Interfaces:**
- Produces: `sliceCell(cell: Rgba, options: SliceOptions): { art: Rgba; native: Rgba }` (was `Rgba`);
  `sliceSheet(sheet, options): { art: Rgba; native: Rgba }[]`; CLI flag `--native <dir>` writing
  each cell's native art as `<dir>/<name>.png`. `SliceOptions` is unchanged.

**Work:** Port `docs/plans/phase-4-pr2/slice-prototype.ts` into `sliceCell`. The algorithm is
load-bearing; keep these exact rules:

1. Key and crop as today (`isKey`, `mainRun` on rows then columns).
2. **Art-pixel size `b`** = within the crop, scanning every second row left to right, collect the
   lengths of runs of dark pixels (all of R, G, B below 50) of length ≥ 4; take the commonest
   length `m`, then `b` = the count-weighted mean of lengths `m − 1`, `m`, `m + 1`. The outline is
   one art pixel thick, so its run is `b`. No dark run ≥ 4 in a cell: throw
   `Error('<cell index>: no outline found')`; every sprite has an outline.
3. **Grid offset**, per axis: collect the positions where neighbouring pixels differ (either side
   keyed, or squared RGB distance > 40²), scanning every second line; the offset `o` in
   `[0, b)` in steps of 0.25 that puts the most transitions within 1.5 px of a grid line
   (`o + k·b`) wins.
4. **Native art**: the grid starts at the last grid line at or before the crop's start; each native
   pixel is the commonest value among the 5 × 5 sample points at fractions 0.3, 0.4, 0.5, 0.6, 0.7
   of its block (keyed counts as transparent). Trim empty native rows and columns.
5. **Shrink**, never grow: `s = min(1, target width / W, target height / H)` where the target is
   `size × size` or the `fit` box; output `round(W·s) × round(H·s)`, at least 1. Each output pixel
   covers the native block range `[floor(i·W/w), max(floor((i+1)·W/w), floor(i·W/w)+1))` per axis.
   Transparent if more than half of the covered pixels are transparent; else outline black
   `#000000` if dark pixels are at least a third of the opaque ones; else the commonest non-dark
   colour.
6. **Quantise** to `colours`: black plus `medianCut` of the non-black colours into `colours − 1`,
   each pixel mapped with `nearest`.
7. `--size` pads to the square canvas bottom-centred, as today. `--fit` returns the shrunk art
   unpadded, as today.

The internal structure (helpers, names) is your choice.

**Acceptance check:** `pnpm vitest run scripts/slice-sheet.test.ts`, with tests that build sheets
in memory (magenta ground, a known indexed art drawn at a given block size and offset):
- a 16 × 16 art with a one-pixel outline drawn at block 11 offset 3 slices back to exactly that art;
- the same at block 7.3 (non-integer) slices back exactly;
- a 20 × 20 art at block 10 with `--size 16`: the output is 16 × 16 and every opaque pixel next to a
  transparent one is black (the outline survives the shrink);
- a 12 × 10 art with `--size 16`: 16 × 16 output with the 12 × 10 art bottom-centred, not
  upscaled;
- a cell without an outline throws `no outline found`;
- `--native` returns the unshrunk art.

Red before: the module has no `native` field and the exact round trips fail under point sampling.
Then `pnpm slice art/sheets/dense-heroes-zone1-items.png /tmp/x --grid 8x4 --row 0 --colours 4
--size 16 --names a,b,c,d,e,f,g,h` writes eight 16 × 16 PNGs. Full check line.

**Boundaries:** No change to `scripts/sprites.ts` or the plugin. On a sheet the rules above cannot
read, stop and report `blocked: <sheet, cell, what fails>`.

- [ ] tests first, red
- [ ] port the prototype into `sliceCell`, `--native`
- [ ] the dense-sheet smoke run; full check line; commit

### Task 2: `pnpm grid` for hand cleanup

**Files:**
- `scripts/sprite-grid.ts` — create: PNG ↔ text grid
- `scripts/sprite-grid.test.ts` — create
- `package.json` — modify: script `"grid": "tsx scripts/sprite-grid.ts"`

**Interfaces:**
- Produces: `toGrid(img: Rgba): string`, `fromGrid(text: string): Rgba`; CLI
  `pnpm grid <in.png>` prints the grid, `pnpm grid --png <in.txt> <out.png>` writes the PNG.

**Work:** The grid format, load-bearing so cleanup edits stay mechanical: a legend block, one line
per colour `<char> #rrggbb`, with `.` reserved for transparent and `0` for `#000000`; a blank line;
then one line per pixel row, one character per pixel. Legend characters after `0` are `1`–`9`
then `a`–`z`. Unknown characters or ragged rows: throw with the line number.

**Acceptance check:** `pnpm vitest run scripts/sprite-grid.test.ts`: a round trip of a 3-colour
sprite is pixel-exact; a ragged row throws naming its line. Red before: the module does not exist.
Full check line.

**Boundaries:** No other script changes.

- [ ] test, red; implement; full check line; commit

### Task 3: `pnpm contact`

**Files:**
- `scripts/contact.ts` — create
- `scripts/contact.test.ts` — create
- `package.json` — modify: script `"contact": "tsx scripts/contact.ts"`

**Interfaces:**
- Consumes: `SPRITES` from `plugins/promptfall/hooks/sprites/generated`, `composeFrame` from
  `stage/compose`, `stageAt` from `stage/model`, `StageTimeline` from `stage/timeline`, the fixture
  builders `wave`, `boss`, `turnBoss`, `worldBoss`, `HEROES` from `stage/fixtures`, the zone rosters
  from `@promptfall/sim` content.
- Produces: `pnpm contact --zone <n> | --heroes | --items <id,id,…> | --world-bosses`, writing
  `.promptfall/contact/<label>/` (labels `zone-<n>`, `heroes`, `items`, `world-bosses`) holding
  `<id>.png` (the built, palette-locked sprite at 6× on the terminal ground `#1e1e24`),
  `native-<id>.png` when `art/sheets/native/<id>.png` exists (4×), and for a zone `stage-rest.png`
  (its first three roster monsters against the fixture party), `stage-boss.png` (its zone boss at
  rest after the spawn has finished, stage grown) and `stage-turn.png` (its turn boss), each at 6×.
  Heroes: idle and attack poses in each rarity. Prints the written paths.

**Work:** Build each zone's views from the fixtures by swapping the enemies' `def`, `id` and `name`
for the zone's roster; the zone number goes into the view so the ground strip takes the zone's
colour. Observe the boss far enough before `now` that no spawn motion is live. Internal structure
is your choice.

**Acceptance check:** `pnpm vitest run scripts/contact.test.ts`: the zone 1 run writes six sprite
PNGs plus three stage PNGs, and `stage-boss.png` is 720 × 204 (120 columns × 34 pixel rows at 6×).
Red before: the script does not exist. Then `pnpm contact --zone 1` and `file` on its outputs. Full
check line.

**Boundaries:** No change to plugin source. `.promptfall/` is already gitignored.

- [ ] test, red; implement; full check line; commit

### Task 4: the CC0 cues

**Files:**
- `plugins/promptfall/cues/drop.wav`, `legendary.wav`, `level_up.wav`, `boss.wav` — replace with
  `art/sheets/drop-a.wav`, `legendary-b.wav`, `level_up-b.wav`, `boss-a.wav` (grill Q13: pack files
  `sfx_coin_double3`, `sfx_coin_cluster8`, `sfx_sounds_powerup3`, `sfx_alarm_loop3`)
- `scripts/placeholder-cues.ts` — delete
- `package.json` — modify: remove `cues:placeholders`
- `plugins/promptfall/README.md` — modify: the line on `cues/` names the pack instead of the
  placeholder script
- `README.md` — modify: a short credits line for Juhani Junkala's "512 Sound Effects (8-bit
  style)", CC0, https://opengameart.org/content/512-sound-effects-8-bit-style

**Interfaces:** none; `plugins/promptfall/hooks/cues.ts` keeps its paths.

**Work:** Copy the files byte for byte. If `art/sheets/` lacks them, download the pack zip from
the URL above into a fresh empty directory and take the four named files from `General Sounds/`
(`Coins/`, `Coins/`, `Positive Sounds/`, `Alarms/Alarms/`).

**Acceptance check:** `cmp` each file against its source; `afplay plugins/promptfall/cues/<n>.wav`
plays each (exit 0); `grep -r placeholder-cues` finds nothing outside `docs/`. Full check line. If
a test pins a cue's byte size, report it rather than editing the test silently.

**Boundaries:** No hook changes.

- [ ] copy, delete, docs; full check line; commit

### Task 5: land the approved samples

**Files:**
- `art/sprites/hero/{knight,black_mage,white_mage,archer}.png`,
  `art/sprites/hero_attack/{…same four}.png`,
  `art/sprites/enemy/{road_slime,field_rat,goblin_scout,hedge_sprite,bandit_captain,wild_boar}.png`,
  `art/sprites/item/{iron_sword,oak_staff,chainmail,copper_ring,bronze_axe,steel_longsword,ember_rod,healers_mace,short_bow,bronze_plate,silk_robe,leather_vest,bone_charm,silver_amulet,gold_bangle,phoenix_pendant,mithril_blade,rune_staff,elven_bow,dragon_plate}.png` — create (34 PNGs)
- `art/manifest.json` — modify: those 34 entries switch `alias` to `file`; hero entries get their
  `rarityColor`
- `art/sheets.md` — create: one section per sheet (file name, date, references, the full prompt,
  the slice commands); a "Redos" section, empty
- `plugins/promptfall/hooks/sprites/generated.ts` — regenerated by `pnpm sprites`

**Interfaces:** Consumes Task 1's `pnpm slice`.

**Work:** Slice the dense sheet with `--grid 8x4 --colours 4 --size 16`, rows 0 to 3, names in the
sheet's order: row 0 `knight,black_mage,white_mage,archer` then the same four as attack poses (cut
into `hero_attack/`); row 1 `road_slime,field_rat,goblin_scout,hedge_sprite,iron_sword,oak_staff,chainmail,copper_ring`;
row 2 `bronze_axe,steel_longsword,ember_rod,healers_mace,short_bow,bronze_plate,silk_robe,leather_vest`;
row 3 `bone_charm,silver_amulet,gold_bangle,phoenix_pendant,mithril_blade,rune_staff,elven_bow,dragon_plate`.
Slice `zone1-bosses.png` row 1 with `--grid 2x2 --row 1 --colours 16 --fit 48x34 --names
bandit_captain,wild_boar`. Write `--native art/sheets/native` on every cut. Read each hero PNG's
colours and set `rarityColor` to the rarity area's exact colour (Global constraints). The dense
sheet's prompt is `bg.txt` + `p5.txt` + `common.txt` with references `heroes-take-a.png`,
`zone1-bosses.png` and `docs/plans/phase-4-concepts/nes-sheet.png`; zone 1 run 3's is `bg.txt` +
`tpl.txt` + `p2.txt` + `common.txt` with references `tpl-zone.png` and `zone1-r2.png` (all in
`art/sheets/`). Record both in `art/sheets.md`.

**Acceptance check:** `pnpm sprites` reports 90 placeholders; `pnpm contact --zone 1`, `--heroes`
and `--items <the 20 ids>` write their folders; look at each once. Full check line. The stage goldens
draw zone 1 and the heroes, so `golden.test.ts` is expected to fail on the new art: regenerate with
`pnpm stage:goldens`, say so in the commit, and confirm the adversarial Svg budget test passes
unchanged. Any later task that changes zone 1, the heroes or the SNES master does the same. Red before: 124 placeholders.

**Boundaries:** No new art beyond these 34. A hero whose rarity area does not survive the cut
(white mage's sigil smaller than 4 pixels) is left for Task 6, not fixed here.

- [ ] slice into `art/sprites/`; manifest; `art/sheets.md`
- [ ] `pnpm sprites`; contact folders; goldens if needed; full check line; commit

### Task 6: hero cleanup

**Files:**
- `art/sprites/hero/*.png`, `art/sprites/hero_attack/*.png` — modify (8 PNGs)
- `art/manifest.json` — modify: `rarityColor` if a cleanup changes the colour
- `plugins/promptfall/hooks/sprites/generated.ts` — regenerated

**Interfaces:** Consumes Task 2's `pnpm grid`.

**Work:** For each of the 8 sprites, `pnpm grid` to a text file in `art/sheets/grids/`, edit, and
write the PNG back. Fix: stray single pixels; breaks in the outline; the idle and attack poses
using the same colours and the same palette order; each rarity area at least 10 pixels and
unbroken (enlarge the white mage's sigil into a sash or mantle in the same colour if needed); a
face readable at 16 px (eyes as single dark pixels, the black mage's eyes in a light colour on its
dark face). Keep the designs; this is cleanup, not redesign. Stay within 4 colours including black.

**Acceptance check:** `pnpm sprites` passes; `pnpm contact --heroes`; each pose in Common and
Legendary shows its rarity area in the rarity colour. Full check line.

**Boundaries:** Heroes only.

- [ ] grids out; edit; PNGs back; build; contact; full check line; commit

### Task 7: world bosses, the SNES master, review batch 1

**Files:**
- `art/sprites/world_boss/{the_promptwyrm,hallucinox,the_context_leviathan,tokenmaw}.png` — create
- `art/manifest.json` — modify: the four `world_boss:*` entries switch to `file`
- `scripts/sprites.ts` — modify: `--derive-snes-master` reads `file` entries only (Narrowing 3)
- `scripts/sprites.test.ts` — modify: a test that a derive ignores an alias
- `art/palettes/snes.json` — regenerated once
- `art/sheets.md`, `plugins/promptfall/hooks/sprites/generated.ts`, stage goldens if they change

**Work:** One image run, label `pf2-world-bosses-r2`, output `art/sheets/world-bosses-r2.png`,
references `art/sheets/world-bosses-r1.png` (the designs) then the two style references. Body:

> Generate one landscape 1536x1024 sprite sheet for a fantasy idle RPG: the four WORLD BOSSES on a
> strict 2 x 2 grid of equal cells, one boss per cell, keeping the exact designs, colours and poses
> of the FIRST attached image, only redrawn with CHUNKY pixels: the same coarse pixel size as the
> bosses in the attached zone 1 boss sheet. Richer 16-bit style: up to 16 colours each, light
> shading allowed, a black outline, hard square pixels, no anti-aliasing. All face right.
> Top left THE PROMPTWYRM, top right HALLUCINOX, bottom left THE CONTEXT LEVIATHAN, bottom right
> TOKENMAW.

Slice `--grid 2x2 --colours 16 --fit 48x34` rows 0 and 1 with `--native`. A native size above
62 × 44 (a shrink below 0.77) is a failed run: report the sizes and stop the task; don't rerun on
your own. Then the cleanup of Task 6's rules through `pnpm grid` (outline, stray pixels, a readable
face and silhouette at 48 × 34, at most 16 colours). Then the derive change (test first), `pnpm
sprites --derive-snes-master`, `pnpm sprites`. The master is now locked: no later task derives it.
Then `pnpm contact --world-bosses`, `--zone 1` (its bosses snap to the new master), `--heroes`,
`--items`, and publish **review batch 1** (heroes, zone 1, the 20 items, the world bosses) to the
review artifact (Review, above). Continue to Task 8 without waiting.

**Acceptance check:** the derive test red then green; `pnpm sprites` reports 86 placeholders;
contact folders written; the artifact URL recorded in `art/sheets.md`. Full check line.

**Boundaries:** One image run. No other sprites.

- [ ] image run in the background; slice; check native sizes
- [ ] cleanup; derive test; derive; build
- [ ] contact; review batch 1 published; full check line; commit

### Task 8: monster sheet A, zones 2 to 9

**Files:** `art/sprites/enemy/<32 ids>.png` — create; `art/manifest.json`, `art/sheets.md`,
`generated.ts` — modify.

**Work:** One image run, label `pf2-monsters-a`, output `art/sheets/monsters-a.png`, the two style
references. Body:

> Generate one landscape 1536x1024 sprite sheet: a DENSE strict grid of 8 columns x 4 rows, 32 small
> monsters, one per cell, every cell the same size (192 x 256 screen pixels). Every sprite is a tiny
> 16x16-art-pixel 8-bit sprite with at most 3 colours plus the black outline, small in its cell,
> with magenta all around it, in exactly the style and pixel size of the attached dense sheet. Each
> row holds two zones of a fantasy idle RPG, four monsters each, left to right.
> Row 1, cells 1-4, Whisperwood (<theme>): <four briefs in roster order>; cells 5-8, Marsh of
> Sighs (<theme>): <four briefs>.
> Row 2: Old Barrow Hills, then Saltglass Coast. Row 3: Emberfall Caves, then Frostvein Pass.
> Row 4: Sunken Abbey, then Ashen Waste.

Fill each `<…>` from the Briefs tables (zone theme; each monster as `NAME: brief`), roster order
per zone: zone 2 `bramble_wolf, moss_golem, wood_goblin, whisper_wisp`; zone 3 `bog_lurker,
marsh_leech, mire_toad, will_o_wisp`; zone 4 `barrow_wight, grave_hound, bone_soldier,
cairn_crawler`; zone 5 `salt_crab, gull_harpy, drowned_sailor, tide_witch`; zone 6 `ember_imp,
magma_beetle, cinder_orc, flame_adept`; zone 7 `frost_wolf, ice_troll, rime_golem, snow_shaman`;
zone 8 `drowned_monk, abbey_gargoyle, bell_wraith, eel_serpent`; zone 9 `ash_ghoul, dust_stalker,
cinder_colossus, ash_oracle`. Write the assembled prompt into `art/sheets.md` before the run.
Slice `--grid 8x4 --colours 4 --size 16 --native art/sheets/native`, rows 0 to 3, names in that
order. A sprite whose native size exceeds 21 in either axis is a redo, not a failure: log it under
Redos. Manifest, `pnpm sprites`, `pnpm contact --zone 2` … `--zone 9`, publish **review batch 2**
(the monster rows of zones 2 to 9, plus the sheet). Continue.

**Acceptance check:** 54 placeholders; contact folders; artifact updated. Full check line.

**Boundaries:** One image run. Bosses are Task 10.

- [ ] prompt into `art/sheets.md`; image run in the background
- [ ] slice; manifest; build; contact; review batch 2; full check line; commit

### Task 9: sheet B, zones 10 to 12 and the last 20 items

**Files:** `art/sprites/enemy/<12 ids>.png`, `art/sprites/item/<20 ids>.png` — create;
`art/manifest.json`, `art/sheets.md`, `generated.ts` — modify.

**Work:** One image run, label `pf2-sheet-b`, output `art/sheets/sheet-b.png`, the two style
references. Body as Task 8's dense opening (32 small sprites, 8 × 4, the dense sheet's style and
pixel size), then:

> Row 1, cells 1-4, Starfall Spire (<theme>): <briefs>; cells 5-8, Hollow King's Court (<theme>):
> <briefs>. Row 2, cells 1-4, The Unwritten Reach (<theme>): <briefs>; cells 5-8, item icons:
> <items 1-4>. Row 3, item icons: <items 5-12>. Row 4, item icons: <items 13-20>. Item icons are
> shown alone, weapons angled diagonally, no letters or symbols that read as text.

Monsters in roster order: zone 10 `star_sentinel, comet_hound, spire_warden, astral_seer`; zone 11
`hollow_knight, court_jester, throne_guard, court_mage`; zone 12 `ink_horror, blank_page,
quill_golem, erased_scribe`. Items in this order: `dragonfang, storm_rod, void_scepter,
willow_staff, silver_crook, sacred_mace, seraph_staff, oak_bow, longbow, starshot_bow,
steel_plate, mithril_mail, cloth_robe, mystic_robe, sage_robe, astral_robe, hide_coat,
ranger_garb, shadow_leather, wind_cloak`. Slice and log as Task 8. Contact `--zone 10` to `--zone
12` and `--items <the 20 ids>`; publish **review batch 3**. Continue.

**Acceptance check:** 22 placeholders; contact folders; artifact updated. Full check line.

**Boundaries:** One image run.

- [ ] prompt; image run; slice; manifest; build; contact; review batch 3; full check line; commit

### Task 10: boss sheets, zones 2 to 11

**Files:** `art/sprites/enemy/<20 ids>.png` — create; `art/manifest.json`, `art/sheets.md`,
`generated.ts` — modify.

**Work:** Five image runs, two at a time, labels `pf2-bosses-z2z3`, `-z4z5`, `-z6z7`, `-z8z9`,
`-z10z11`, outputs `art/sheets/bosses-z<a>z<b>.png`, the two style references. Body per sheet:

> Generate one landscape 1536x1024 sprite sheet: a strict 2 x 2 grid of four equal cells, one boss
> per cell, in exactly the style and the coarse pixel size of the bosses in the attached zone 1
> boss sheet: richer 16-bit style, up to 16 colours each, light shading allowed, a black outline,
> hard square pixels, no anti-aliasing. All face right.
> Top left, the zone boss of <zone a> (<theme a>): <NAME: brief>. Top right, the smaller boss of
> <zone a>, about two-thirds the size: <NAME: brief>. Bottom left, the zone boss of <zone b>
> (<theme b>): <NAME: brief>. Bottom right, the smaller boss of <zone b>: <NAME: brief>.

Slice `--grid 2x2 --colours 16 --fit 48x34 --native art/sheets/native`, rows 0 and 1, names zone
boss then turn boss. A native size above 62 × 44 is a redo (log it). After each pair of runs:
manifest, `pnpm sprites`, contact for those zones, publish the batch (**review batches 4 to 6**),
continue.

**Acceptance check:** 2 placeholders (zone 12's bosses); contact folders; artifact updated. Full
check line.

**Boundaries:** Five image runs.

- [ ] runs z2z3 and z4z5; slice; build; contact; batch 4; commit
- [ ] runs z6z7 and z8z9; slice; build; contact; batch 5; commit
- [ ] run z10z11; slice; build; contact; batch 6; full check line; commit

### Task 11: zone 12's bosses and the redos

**Files:** `art/sprites/**` — create or replace for the ids involved; `art/manifest.json`,
`art/sheets.md`, `generated.ts` — modify.

**Work:** Gather Kevin's answers so far into "Redos" in `art/sheets.md` (id, his note). Then:
- one 2 × 2 boss run, label `pf2-bosses-z12`: top row `unwritten_one` and `margin_beast`; bottom
  row the two oldest boss redos, or a second take of zone 12's two bosses if none (Narrowing 2);
- small-sprite redos: one dense 8 × 4 run per 32 redos (label `pf2-redos-<n>`), each cell's brief
  being the original brief plus Kevin's note; spare cells take a second take of the redos with the
  most notes. Never leave a dense cell empty.

Slice, build, contact, publish the batch. Repeat while Kevin names redos. When every zone, the
heroes, the items and the world bosses have Kevin's GREEN on the artifact, record each GREEN with
its date in `art/sheets.md` and finish the task.

**Acceptance check:** `pnpm sprites` reports 0 placeholders; `art/sheets.md` lists a GREEN for
zones 1 to 12, heroes, items and world bosses. Full check line.

**Boundaries:** Only ids that are new or named as redos. A design change Kevin asks for that goes
beyond a redo (a new hero design, a different canvas): stop and report `blocked: <the request>`.

- [ ] zone 12 run; slice; build; contact; batch
- [ ] redo rounds until every group is GREEN; record; full check line; commit

### Task 12: finish

**Files:**
- `art/concept/` — delete (Narrowing 5)
- `plugins/promptfall/hooks/sprites/sprites.test.ts` — modify: a test that `PLACEHOLDER_COUNT === 0`
  and no `SPRITES` entry has `isPlaceholder`
- `plugins/promptfall/hooks/stage/goldens/*` — regenerated by `pnpm stage:goldens`
- `docs/manual-pass/phase-4.md` — modify: Part B (the real art)
- `README.md` — modify: Status gains phase 4 PR 2; the `art/` row names `art/sprites/` and
  `art/sheets.md`
- `docs/plans/2026-10-07-promptfall-phase-4-pr2-art.md` — modify: tick the boxes

**Work:** Delete the concept PNGs once `grep '"alias"' art/manifest.json` finds nothing (the
`fallback` entry is a `file`). Add the test. Regenerate the stage goldens and say so in the
commit; the adversarial Svg budget test in `golden.test.ts` must pass unchanged. Part B of the
manual pass, for Ghostty (Kevin's terminal), then the desktop app: start a session, the Party tab
shows zone art and the party in rarity colours; force a zone boss with the fake server and see the
stage grow to 17 rows with the boss; a Rare drop plays the coin chime, a Legendary drop the coin
shower, a level-up the short climb, a world boss arrival the falling alarm; the Inventory list
shows the 16-pixel item sprites; the compact stage (a terminal 100 to 115 columns wide) shows the
downsampled art. Then the full check line, the `codex-computer-use` check against Ghostty and the
desktop app (skipped and said so in the PR if the codex quota is gone), push, and open the PR
against `ai-staging` with the manual-pass steps and the list of checks that ran. Stop: the review
is Kevin's to trigger.

**Acceptance check:** the new test red before the last placeholder is gone, green after; the full
check line clean on the PR's head; `gh pr view` shows the PR open against `ai-staging`.

**Boundaries:** No merge. No art changes in this task.

- [ ] delete concept art; placeholder test; goldens
- [ ] manual pass Part B; README; tick boxes
- [ ] full check line; `codex-computer-use`; push; PR; stop

## Self-review

- Grill coverage: Q1 (Tasks 7 to 11 generate everything), Q3 and Q13 (Task 4), Q4 (Tasks 2, 6, 7),
  Q6 and Q14 (Task 5), Q7 and Q11 (Global constraints, Task 6), Q8 (prompt order), Q9 and Q19
  (Task 3, Review), Q10 (direction GREEN, the style references), Q12 and Q15 (Tasks 8 to 10,
  Narrowings 1 and 2), Q16 (Task 7), Q17 (Briefs), Q18 (Task 1), Q20 (`art/sprites/`,
  `art/sheets.md`, gitignored sheets), Q21 (Task 7, Narrowing 3), Q22 (Task 4), Q23 (Review,
  Task 12), the quota rule (Codex image runs).
- Placeholder arithmetic: 125 manifest entries; `fallback` is a `file`, so `pnpm sprites` starts at
  124 placeholders (8 hero sprites, 72 enemies, 4 world bosses, 40 items). Task 5 lands 34 (8 hero
  sprites, 4 monsters, 2 bosses, 20 items) → 90; Task 7 the 4 world bosses → 86; Task 8 32
  monsters → 54; Task 9 12 monsters and 20 items → 22; Task 10 20 bosses → 2; Task 11 zone 12's
  bosses → 0.
