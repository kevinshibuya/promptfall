# Sprite sheets

Every sheet behind a sprite in `art/sprites/`: the prompt that drew it, the references attached
(in order), and the commands that cut it. The sheets themselves live in the gitignored
`art/sheets/` and are never committed. Each run went through
`~/.claude/bin/codex-run.sh <label> exec -m gpt-6-astra … -i=<ref> …` (gpt-image-2 through codex's
image_gen tool); `<repo>` is the repository root.

Review: https://claude.ai/artifact/W5SVGYNdDG8ojecpbx9RNt (batch 1 published 2026-10-07). Kevin gave every
group GREEN on the 1.5× art on 2026-10-07 (version 11).

## dense-heroes-zone1-items.png

2026-10-07, the grill's sample run. References: `art/sheets/heroes-take-a.png`,
`art/sheets/zone1-bosses.png`, `docs/plans/phase-4-concepts/nes-sheet.png`.

Prompt (`bg.txt` + `p5.txt` + `common.txt`):

```text
HARD REQUIREMENT, READ FIRST: the entire background of the image is ONE flat solid pure magenta colour, #FF00FF, edge to edge, exactly like the attached reference sheet. NOT black, NOT dark, NOT a gradient, NO vignette. NO glow, NO light halo, NO bloom, NO particles around sprites. Any spell or magic effect is drawn as a few solid hard-edged pixels with a black outline, part of the sprite, never as a soft glow.

Generate one landscape 1536x1024 sprite sheet: a DENSE strict grid of 8 columns x 4 rows, 32 small sprites, one per cell, every cell the same size (192 x 256 screen pixels). Every sprite is a tiny 16x16-art-pixel 8-bit sprite with at most 3 colours plus the black outline, small in its cell, with magenta all around it.
The heroes and monsters keep the exact designs of the attached hero and zone reference sheets (same colours, same costumes), only smaller. One change: the black mage wears a high pale scarf over the lower face and its hat tip is crooked.
Row 1: knight, black mage, white mage, archer (standing idle); then knight, black mage, white mage, archer (attack or cast pose).
Row 2: road slime, field rat, goblin scout, hedge sprite; then item icons: iron sword, oak staff, chainmail shirt, copper ring.
Row 3, item icons: bronze axe, steel longsword, ember rod (a short fiery wand), healer's mace, short bow, bronze plate armour, silk robe, leather vest.
Row 4, item icons: bone charm, silver amulet, gold bangle, phoenix pendant, mithril blade, rune staff, elven bow, dragon plate armour.
Characters face right. Item icons are shown alone, weapons angled diagonally.

STYLE (match the attached reference sheet's pixel style exactly, but these are NEW designs, not copies of the reference figures):
- Retro 8-bit console sprite art. Every sprite is built from large, perfectly square, equal-size pixel blocks on a hard grid; no anti-aliasing, no gradients, no blur, no soft shadows, no dithering on the small sprites.
- A one-block-thick pure black outline around every sprite.
- Flat fills. Each small sprite uses at most 3 colours plus the black outline.
- Every sprite faces RIGHT, shown side-on (three-quarter side view), standing on an invisible ground line at the bottom of its cell.
- Background: one flat pure magenta (#FF00FF) everywhere, edge to edge. No ground, no shadows, no frames, no borders.
- Lay the sprites out on a strict, evenly spaced grid with generous magenta gaps so no two sprites touch or overlap.
- No text, no letters, no numbers, no labels, no grid lines, no watermark.

Use your image_gen tool (gpt-image-2). Save the result as a PNG to <repo>/art/sheets/dense-heroes-zone1-items.png.
```

Cut:

```sh
D=art/sheets/dense-heroes-zone1-items.png
C="--grid 8x4 --colours 4 --size 16 --native art/sheets/native"
pnpm slice $D art/sprites $=C --row 0 --names hero/knight,hero/black_mage,hero/white_mage,hero/archer,hero_attack/knight,hero_attack/black_mage,hero_attack/white_mage,hero_attack/archer
pnpm slice $D art/sprites $=C --row 1 --names enemy/road_slime,enemy/field_rat,enemy/goblin_scout,enemy/hedge_sprite,item/iron_sword,item/oak_staff,item/chainmail,item/copper_ring
pnpm slice $D art/sprites $=C --row 2 --names item/bronze_axe,item/steel_longsword,item/ember_rod,item/healers_mace,item/short_bow,item/bronze_plate,item/silk_robe,item/leather_vest
pnpm slice $D art/sprites $=C --row 3 --names item/bone_charm,item/silver_amulet,item/gold_bangle,item/phoenix_pendant,item/mithril_blade,item/rune_staff,item/elven_bow,item/dragon_plate
```

The white mage's attack pose lost its teal sigil in the cut, so `hero_attack:white_mage` keeps its
concept alias until the hero cleanup.

## zone1-bosses.png

2026-10-07, zone 1 run 3. References: `art/sheets/tpl-zone.png` (the scale template),
`art/sheets/zone1-r2.png`. Only its boss row ships; the dense sheet supersedes its monsters.

Prompt (`bg.txt` + `tpl.txt` + `p2.txt` + `common.txt`):

```text
HARD REQUIREMENT, READ FIRST: the entire background of the image is ONE flat solid pure magenta colour, #FF00FF, edge to edge, exactly like the attached reference sheet. NOT black, NOT dark, NOT a gradient, NO vignette. NO glow, NO light halo, NO bloom, NO particles around sprites. Any spell or magic effect is drawn as a few solid hard-edged pixels with a black outline, part of the sprite, never as a soft glow.

SCALE TEMPLATE (the FIRST attached image): each grey checkerboard is ONE sprite's canvas, and each checker square is exactly ONE art pixel. Draw each sprite in the position of its checkerboard, using those squares as the pixel size: the sprite is exactly that many art pixels wide and tall at most, filling most of its canvas height, standing on the canvas bottom edge. Do not use smaller pixels than the checker squares. The checkerboards themselves must NOT appear in the output: everywhere outside the sprites is solid magenta. The other attached images are STYLE references only.

Generate one landscape 1536x1024 sprite sheet for zone 1 of a fantasy idle RPG, "Greenmeadow Road" (a sunny country road through farmland and hedges). Two rows.
Row 1: four small monsters, evenly spaced, each a 16x16-pixel 8-bit sprite at the SAME block size as the first reference sheet's small sprites (at most 3 colours plus the black outline):
1. ROAD SLIME: a squat, wobbly blob slime with a dusty road-brown tint, two dot eyes.
2. FIELD RAT: a lean, quick rat mid-scurry, long tail.
3. GOBLIN SCOUT: a scrappy goblin with a crude club and a scrap of leather armour.
4. HEDGE SPRITE: a tiny leafy fairy made of hedge leaves, glowing, casting a small spell.
Row 2: two bosses in the richer 16-bit style of the second reference sheet's bottom row (more colours, shading allowed, still a black outline, still hard square pixels, no anti-aliasing):
5. BANDIT CAPTAIN (zone boss): a burly road bandit leader with a bandana, eye patch, long coat and a heavy cutlass. About 48 pixels wide and 34 pixels tall in art pixels.
6. WILD BOAR (smaller boss): a huge angry tusked boar, bristling mane. About two-thirds the size of the bandit captain.
Use the same art-pixel block size across the whole sheet. Keep the bosses COARSE: the bandit captain is only about 3 times as wide and 2 times as tall as a row 1 monster (about 48 x 34 art pixels in total), with the same chunky blocks as the monsters, not finer detail.

STYLE (match the attached reference sheet's pixel style exactly, but these are NEW designs, not copies of the reference figures):
- Retro 8-bit console sprite art. Every sprite is built from large, perfectly square, equal-size pixel blocks on a hard grid; no anti-aliasing, no gradients, no blur, no soft shadows, no dithering on the small sprites.
- A one-block-thick pure black outline around every sprite.
- Flat fills. Each small sprite uses at most 3 colours plus the black outline.
- Every sprite faces RIGHT, shown side-on (three-quarter side view), standing on an invisible ground line at the bottom of its cell.
- Background: one flat pure magenta (#FF00FF) everywhere, edge to edge. No ground, no shadows, no frames, no borders.
- Lay the sprites out on a strict, evenly spaced grid with generous magenta gaps so no two sprites touch or overlap.
- No text, no letters, no numbers, no labels, no grid lines, no watermark.

Use your image_gen tool (gpt-image-2). Save the result as a PNG to <repo>/art/sheets/zone1-bosses.png.
```

Cut:

```sh
pnpm slice art/sheets/zone1-bosses.png art/sprites --grid 2x2 --row 1 --colours 16 --fit 48x34 --native art/sheets/native --names enemy/bandit_captain,enemy/wild_boar
```

## world-bosses-r2.png

2026-10-07, run `pf2-world-bosses-r2`. References: `art/sheets/world-bosses-r1.png` (the designs), `art/sheets/dense-heroes-zone1-items.png`, `art/sheets/zone1-bosses.png`.

Prompt:

```text
HARD REQUIREMENT, READ FIRST: the entire background of the image is ONE flat solid pure magenta colour, #FF00FF, edge to edge, exactly like the attached reference sheet. NOT black, NOT dark, NOT a gradient, NO vignette. NO glow, NO light halo, NO bloom, NO particles around sprites. Any spell or magic effect is drawn as a few solid hard-edged pixels with a black outline, part of the sprite, never as a soft glow.

Generate one landscape 1536x1024 sprite sheet for a fantasy idle RPG: the four WORLD BOSSES on a strict 2 x 2 grid of equal cells, one boss per cell, keeping the exact designs, colours and poses of the FIRST attached image, only redrawn with CHUNKY pixels: the same coarse pixel size as the bosses in the attached zone 1 boss sheet. Richer 16-bit style: up to 16 colours each, light shading allowed, a black outline, hard square pixels, no anti-aliasing. All face right.
Top left THE PROMPTWYRM, top right HALLUCINOX, bottom left THE CONTEXT LEVIATHAN, bottom right TOKENMAW.

STYLE (match the attached reference sheet's pixel style exactly, but these are NEW designs, not copies of the reference figures):
- Retro 8-bit console sprite art. Every sprite is built from large, perfectly square, equal-size pixel blocks on a hard grid; no anti-aliasing, no gradients, no blur, no soft shadows, no dithering on the small sprites.
- A one-block-thick pure black outline around every sprite.
- Flat fills. Each small sprite uses at most 3 colours plus the black outline.
- Every sprite faces RIGHT, shown side-on (three-quarter side view), standing on an invisible ground line at the bottom of its cell.
- Background: one flat pure magenta (#FF00FF) everywhere, edge to edge. No ground, no shadows, no frames, no borders.
- Lay the sprites out on a strict, evenly spaced grid with generous magenta gaps so no two sprites touch or overlap.
- No text, no letters, no numbers, no labels, no grid lines, no watermark.

Use your image_gen tool (gpt-image-2). Save the result as a PNG to <repo>/art/sheets/world-bosses-r2.png.
```

Result: failed the size check. As drawn: The Promptwyrm 47 × 53, Hallucinox 45 × 55, The Context
Leviathan 73 × 69, Tokenmaw 83 × 80 (block 8.9, 8.7, 7.0, 6.0); the cut to 48 × 34 shrinks them to
0.64 or less. The bosses came out tall in landscape cells, and the bottom pair at a finer pixel.
Nothing ships from this sheet; the rerun waits on Kevin.

## monsters-a.png

2026-10-07, run `pf2-monsters-a`. References: `art/sheets/dense-heroes-zone1-items.png`, `art/sheets/zone1-bosses.png`.

Prompt:

```text
HARD REQUIREMENT, READ FIRST: the entire background of the image is ONE flat solid pure magenta colour, #FF00FF, edge to edge, exactly like the attached reference sheet. NOT black, NOT dark, NOT a gradient, NO vignette. NO glow, NO light halo, NO bloom, NO particles around sprites. Any spell or magic effect is drawn as a few solid hard-edged pixels with a black outline, part of the sprite, never as a soft glow.

Generate one landscape 1536x1024 sprite sheet: a DENSE strict grid of 8 columns x 4 rows, 32 small monsters, one per cell, every cell the same size (192 x 256 screen pixels). Every sprite is a tiny 16x16-art-pixel 8-bit sprite with at most 3 colours plus the black outline, small in its cell, with magenta all around it, in exactly the style and pixel size of the attached dense sheet. Each row holds two zones of a fantasy idle RPG, four monsters each, left to right.
Row 1, cells 1-4, Whisperwood (an old whispering forest: moss, dim greens, pale spirit light): 1. BRAMBLE WOLF: a lean grey-green wolf with thorny bramble vines twined through its fur. 2. MOSS GOLEM: a squat boulder golem under thick moss, two green eye slits. 3. WOOD GOBLIN: a bark-skinned forest goblin with a heavy branch club and a leaf loincloth. 4. WHISPER WISP: a pale floating spirit flame with a faint sad face, trailing wisps; cells 5-8, Marsh of Sighs (a foggy swamp: murky teal, mud brown, reeds): 1. BOG LURKER: a hunched mud brute draped in pond weed, long dangling arms. 2. MARSH LEECH: a fat striped leech rearing up, a round toothed sucker mouth. 3. MIRE TOAD: a huge warty toad with a bloated throat sac, mud brown and olive. 4. WILL O WISP: a small blue-white ghost light with a bright core and two tiny eyes.
Row 2, cells 1-4, Old Barrow Hills (grave mounds under moonlight: grey stone, bone, cold blue): 1. BARROW WIGHT: a gaunt ghostly corpse in rotting burial robes and a rusted circlet, cold blue eyes, casting. 2. GRAVE HOUND: a skeletal hound with glowing eyes and bare ribs. 3. BONE SOLDIER: a skeleton warrior with a dented round shield and a notched sword. 4. CAIRN CRAWLER: a beetle-like crawler whose shell is a pile of cairn stones; cells 5-8, Saltglass Coast (a bright shore of glassy sand: sea blue, white salt, coral): 1. SALT CRAB: a big crab with a crust of white salt crystals and one giant claw. 2. GULL HARPY: a harpy with gull wings and talons, white and grey feathers. 3. DROWNED SAILOR: a waterlogged zombie sailor in a striped shirt, seaweed, a boat hook. 4. TIDE WITCH: a sea witch with kelp hair, a shell crown and a coral staff.
Row 3, cells 1-4, Emberfall Caves (lava caves: black rock, orange glow, soot): 1. EMBER IMP: a small red imp with bat wings and a flaming tail. 2. MAGMA BEETLE: a heavy beetle with a cracked black shell glowing orange in the seams. 3. CINDER ORC: a soot-black orc with burning eyes and a jagged iron axe. 4. FLAME ADEPT: a hooded fire cultist in red robes conjuring a fireball; cells 5-8, Frostvein Pass (a snowy mountain pass: ice blue, white, grey stone): 1. FROST WOLF: a white wolf with an icy blue mane and frosted breath. 2. ICE TROLL: a blue-skinned troll with icicle tusks and a frozen club. 3. RIME GOLEM: a blocky golem of packed ice and snow with a glowing blue core. 4. SNOW SHAMAN: a fur-cloaked shaman with an antler headdress and a frost staff.
Row 4, cells 1-4, Sunken Abbey (a flooded stone abbey: teal water, wet stone, candle gold): 1. DROWNED MONK: a bloated drowned monk in a soaked brown habit swinging a censer. 2. ABBEY GARGOYLE: a crouching stone gargoyle with folded wings, grey and mossy. 3. BELL WRAITH: a hooded spectre holding a cracked bronze bell. 4. EEL SERPENT: a long dark eel with glowing yellow spots, jaws open; cells 5-8, Ashen Waste (a grey ash desert under a red sky: ash grey, rust, bone): 1. ASH GHOUL: a hunched grey ghoul caked in ash, long claws. 2. DUST STALKER: a lean sand-coloured lizard stalker in a cloth wrap, mid-run. 3. CINDER COLOSSUS: a squat colossus of charred stone with ember cracks. 4. ASH ORACLE: a veiled oracle in grey robes holding a smoking bowl.

STYLE (match the attached reference sheet's pixel style exactly, but these are NEW designs, not copies of the reference figures):
- Retro 8-bit console sprite art. Every sprite is built from large, perfectly square, equal-size pixel blocks on a hard grid; no anti-aliasing, no gradients, no blur, no soft shadows, no dithering on the small sprites.
- A one-block-thick pure black outline around every sprite.
- Flat fills. Each small sprite uses at most 3 colours plus the black outline.
- Every sprite faces RIGHT, shown side-on (three-quarter side view), standing on an invisible ground line at the bottom of its cell.
- Background: one flat pure magenta (#FF00FF) everywhere, edge to edge. No ground, no shadows, no frames, no borders.
- Lay the sprites out on a strict, evenly spaced grid with generous magenta gaps so no two sprites touch or overlap.
- No text, no letters, no numbers, no labels, no grid lines, no watermark.

Use your image_gen tool (gpt-image-2). Save the result as a PNG to <repo>/art/sheets/monsters-a.png.
```

Cut (rows 0 to 3, names in roster order):

```sh
M=art/sheets/monsters-a.png
O="--grid 8x4 --colours 4 --size 16 --native art/sheets/native"
pnpm slice $M art/sprites $=O --row 0 --names enemy/bramble_wolf,enemy/moss_golem,enemy/wood_goblin,enemy/whisper_wisp,enemy/bog_lurker,enemy/marsh_leech,enemy/mire_toad,enemy/will_o_wisp
pnpm slice $M art/sprites $=O --row 1 --names enemy/barrow_wight,enemy/grave_hound,enemy/bone_soldier,enemy/cairn_crawler,enemy/salt_crab,enemy/gull_harpy,enemy/drowned_sailor,enemy/tide_witch
pnpm slice $M art/sprites $=O --row 2 --names enemy/ember_imp,enemy/magma_beetle,enemy/cinder_orc,enemy/flame_adept,enemy/frost_wolf,enemy/ice_troll,enemy/rime_golem,enemy/snow_shaman
pnpm slice $M art/sprites $=O --row 3 --names enemy/drowned_monk,enemy/abbey_gargoyle,enemy/bell_wraith,enemy/eel_serpent,enemy/ash_ghoul,enemy/dust_stalker,enemy/cinder_colossus,enemy/ash_oracle
```

Result: the model drew finer pixels (block about 6, the dense sheet's is about 7) and filled more
of each cell, so 30 of 32 came out 24 to 34 pixels as drawn, past the redo limit of 21. Only
`whisper_wisp` (13 × 18) and `will_o_wisp` (12 × 18) ship from this sheet; the rest are redos.
From sheet B on, the dense opening adds one sentence sizing each sprite against its cell.

## sheet-b.png

2026-10-07, run `pf2-sheet-b`. References: `art/sheets/dense-heroes-zone1-items.png`, `art/sheets/zone1-bosses.png`.

Prompt:

```text
HARD REQUIREMENT, READ FIRST: the entire background of the image is ONE flat solid pure magenta colour, #FF00FF, edge to edge, exactly like the attached reference sheet. NOT black, NOT dark, NOT a gradient, NO vignette. NO glow, NO light halo, NO bloom, NO particles around sprites. Any spell or magic effect is drawn as a few solid hard-edged pixels with a black outline, part of the sprite, never as a soft glow.

Generate one landscape 1536x1024 sprite sheet: a DENSE strict grid of 8 columns x 4 rows, 32 small sprites, one per cell, every cell the same size (192 x 256 screen pixels). Every sprite is a tiny 16x16-art-pixel 8-bit sprite with at most 3 colours plus the black outline, small in its cell, with magenta all around it, in exactly the style and pixel size of the attached dense sheet. Keep every sprite SMALL and CHUNKY: it covers only about half of its cell's width and half of its cell's height, built from the same large pixel blocks as the attached dense sheet; never use finer pixels to add detail.
Row 1, cells 1-4, Starfall Spire (a tower among the stars: deep navy, silver, starlight): 1. STAR SENTINEL: a silver construct guardian with a star-shaped head and a tower shield. 2. COMET HOUND: a blue hound with a glowing comet tail. 3. SPIRE WARDEN: a warden in silver plate with a starry halberd. 4. ASTRAL SEER: a seer in a starfield cloak holding a glowing orb; cells 5-8, Hollow King's Court (a dead royal court: purple, tarnished gold, black): 1. HOLLOW KNIGHT: an empty suit of tarnished plate, only darkness inside the visor, a broad sword. 2. COURT JESTER: a grinning undead jester in purple and gold motley with two daggers. 3. THRONE GUARD: a heavy royal guard in gold-trimmed armour with a tower shield. 4. COURT MAGE: a pale court magician in a tall collar and purple robes, casting. Row 2, cells 1-4, The Unwritten Reach (a world of blank paper and ink: white, black ink, blue ink): 1. INK HORROR: a dripping black ink monster with many grasping arms. 2. BLANK PAGE: a living sheet of blank paper folding like a bird, one inky eye. 3. QUILL GOLEM: a golem of stacked closed books with quill feathers as spines. 4. ERASED SCRIBE: a faded scribe half rubbed out, holding a quill; cells 5-8, item icons: 1. DRAGONFANG: a curved sword made from a dragon's tooth. 2. STORM ROD: a short wand crackling with blue lightning. 3. VOID SCEPTER: a dark purple sceptre topped with a black orb. 4. WILLOW STAFF: a pale willow staff with a few leaves. Row 3, item icons: 1. SILVER CROOK: a silver shepherd's crook. 2. SACRED MACE: a golden mace with a sunburst head. 3. SERAPH STAFF: a white staff with small wings at the top. 4. OAK BOW: a plain wooden bow. 5. LONGBOW: a tall yew longbow. 6. STARSHOT BOW: a blue bow with star-shaped tips. 7. STEEL PLATE: a steel breastplate. 8. MITHRIL MAIL: a shining silver-blue chainmail shirt. Row 4, item icons: 1. CLOTH ROBE: a simple brown cloth robe. 2. MYSTIC ROBE: a blue robe with a star pattern. 3. SAGE ROBE: a green robe with gold trim. 4. ASTRAL ROBE: a navy robe scattered with stars. 5. HIDE COAT: a shaggy fur hide coat. 6. RANGER GARB: a green-brown hooded tunic. 7. SHADOW LEATHER: black leather armour. 8. WIND CLOAK: a pale flowing cloak. Item icons are shown alone, weapons angled diagonally, no letters or symbols that read as text.

STYLE (match the attached reference sheet's pixel style exactly, but these are NEW designs, not copies of the reference figures):
- Retro 8-bit console sprite art. Every sprite is built from large, perfectly square, equal-size pixel blocks on a hard grid; no anti-aliasing, no gradients, no blur, no soft shadows, no dithering on the small sprites.
- A one-block-thick pure black outline around every sprite.
- Flat fills. Each small sprite uses at most 3 colours plus the black outline.
- Every sprite faces RIGHT, shown side-on (three-quarter side view), standing on an invisible ground line at the bottom of its cell.
- Background: one flat pure magenta (#FF00FF) everywhere, edge to edge. No ground, no shadows, no frames, no borders.
- Lay the sprites out on a strict, evenly spaced grid with generous magenta gaps so no two sprites touch or overlap.
- No text, no letters, no numbers, no labels, no grid lines, no watermark.

Use your image_gen tool (gpt-image-2). Save the result as a PNG to <repo>/art/sheets/sheet-b.png.
```

Cut (rows 0 to 3):

```sh
M=art/sheets/sheet-b.png
O="--grid 8x4 --colours 4 --size 16 --native art/sheets/native"
pnpm slice $M art/sprites $=O --row 0 --names enemy/star_sentinel,enemy/comet_hound,enemy/spire_warden,enemy/astral_seer,enemy/hollow_knight,enemy/court_jester,enemy/throne_guard,enemy/court_mage
pnpm slice $M art/sprites $=O --row 1 --names enemy/ink_horror,enemy/blank_page,enemy/quill_golem,enemy/erased_scribe,item/dragonfang,item/storm_rod,item/void_scepter,item/willow_staff
pnpm slice $M art/sprites $=O --row 2 --names item/silver_crook,item/sacred_mace,item/seraph_staff,item/oak_bow,item/longbow,item/starshot_bow,item/steel_plate,item/mithril_mail
pnpm slice $M art/sprites $=O --row 3 --names item/cloth_robe,item/mystic_robe,item/sage_robe,item/astral_robe,item/hide_coat,item/ranger_garb,item/shadow_leather,item/wind_cloak
```

Result: the size sentence brought the pixel back to the dense sheet's (block about 6.9) and most
sprites to 17 to 22 as drawn. 14 pass the 21 px limit and ship; 18 go to Redos.

## bosses-z2z3.png

2026-10-07, run `pf2-bosses-z2z3`. References: `art/sheets/dense-heroes-zone1-items.png`, `art/sheets/zone1-bosses.png`.

Prompt:

```text
HARD REQUIREMENT, READ FIRST: the entire background of the image is ONE flat solid pure magenta colour, #FF00FF, edge to edge, exactly like the attached reference sheet. NOT black, NOT dark, NOT a gradient, NO vignette. NO glow, NO light halo, NO bloom, NO particles around sprites. Any spell or magic effect is drawn as a few solid hard-edged pixels with a black outline, part of the sprite, never as a soft glow.

Generate one landscape 1536x1024 sprite sheet: a strict 2 x 2 grid of four equal cells, one boss per cell, in exactly the style and the coarse pixel size of the bosses in the attached zone 1 boss sheet: richer 16-bit style, up to 16 colours each, light shading allowed, a black outline, hard square pixels, no anti-aliasing. All face right. Each boss is no wider than twice its height.
Top left, the zone boss of Whisperwood (an old whispering forest: moss, dim greens, pale spirit light): ELDER TREANT: an ancient walking tree, a gnarled face in its trunk, root legs, a mossy canopy. Top right, the smaller boss of Whisperwood, about two-thirds the size: OWLBEAR CUB: a hulking young owlbear: feathered owl head, brown bear body, big claws. Bottom left, the zone boss of Marsh of Sighs (a foggy swamp: murky teal, mud brown, reeds): SIGH HAG: a stooped swamp witch in a tattered moss shawl, long grey hair, a crooked staff with a hanging lantern. Bottom right, the smaller boss of Marsh of Sighs: GIANT HERON: a tall grey heron with a spear-like beak, wings half spread, standing in reeds.

STYLE (match the attached reference sheet's pixel style exactly, but these are NEW designs, not copies of the reference figures):
- Retro 8-bit console sprite art. Every sprite is built from large, perfectly square, equal-size pixel blocks on a hard grid; no anti-aliasing, no gradients, no blur, no soft shadows, no dithering on the small sprites.
- A one-block-thick pure black outline around every sprite.
- Flat fills. Each small sprite uses at most 3 colours plus the black outline.
- Every sprite faces RIGHT, shown side-on (three-quarter side view), standing on an invisible ground line at the bottom of its cell.
- Background: one flat pure magenta (#FF00FF) everywhere, edge to edge. No ground, no shadows, no frames, no borders.
- Lay the sprites out on a strict, evenly spaced grid with generous magenta gaps so no two sprites touch or overlap.
- No text, no letters, no numbers, no labels, no grid lines, no watermark.

Use your image_gen tool (gpt-image-2). Save the result as a PNG to <repo>/art/sheets/bosses-z2z3.png.
```

Cut:

```sh
O="--grid 2x2 --colours 16 --fit 48x34 --native art/sheets/native"
pnpm slice art/sheets/bosses-z2z3.png art/sprites $=O --row 0 --names enemy/elder_treant,enemy/owlbear_cub
pnpm slice art/sheets/bosses-z2z3.png art/sprites $=O --row 1 --names enemy/sigh_hag,enemy/giant_heron
```

Result: a transparent background with a soft glow instead of magenta; the cut keys alpha below 128
and the glow drops out. The model used block 8 against the zone 1 bosses' 10: the owl bear cub
(46 × 36) ships, the treant (66 × 56), the hag (63 × 52) and the heron (66 × 50) are past
64 × 46 and go to Redos. From z4z5 on, the boss body adds a sentence holding the zone 1 bosses'
pixel blocks and capping how much of its cell each boss fills.

## bosses-z4z5.png

2026-10-07, run `pf2-bosses-z4z5`. References: `art/sheets/dense-heroes-zone1-items.png`, `art/sheets/zone1-bosses.png`.

Prompt:

```text
HARD REQUIREMENT, READ FIRST: the entire background of the image is ONE flat solid pure magenta colour, #FF00FF, edge to edge, exactly like the attached reference sheet. NOT black, NOT dark, NOT a gradient, NO vignette. NO glow, NO light halo, NO bloom, NO particles around sprites. Any spell or magic effect is drawn as a few solid hard-edged pixels with a black outline, part of the sprite, never as a soft glow.

Generate one landscape 1536x1024 sprite sheet: a strict 2 x 2 grid of four equal cells, one boss per cell, in exactly the style and the coarse pixel size of the bosses in the attached zone 1 boss sheet: richer 16-bit style, up to 16 colours each, light shading allowed, a black outline, hard square pixels, no anti-aliasing. All face right. Each boss is no wider than twice its height. Build every boss from the same large pixel blocks as the bosses in the attached zone 1 boss sheet, never finer pixels: each zone boss fills at most about three-quarters of its cell's width and two-thirds of its cell's height, the smaller boss less.
Top left, the zone boss of Old Barrow Hills (grave mounds under moonlight: grey stone, bone, cold blue): BARROW KING: an undead king in tarnished plate and a tall crown, a great sword, a tattered cloak. Top right, the smaller boss of Old Barrow Hills, about two-thirds the size: CRYPT OGRE: a hulking grey-skinned ogre swinging a tombstone as a club. Bottom left, the zone boss of Saltglass Coast (a bright shore of glassy sand: sea blue, white salt, coral): GLASS LEVIATHAN: a huge sea serpent of translucent sea glass, cyan and white, crystal fins. Bottom right, the smaller boss of Saltglass Coast: REEF TROLL: a barnacle-crusted troll with coral growths and a driftwood club.

STYLE (match the attached reference sheet's pixel style exactly, but these are NEW designs, not copies of the reference figures):
- Retro 8-bit console sprite art. Every sprite is built from large, perfectly square, equal-size pixel blocks on a hard grid; no anti-aliasing, no gradients, no blur, no soft shadows, no dithering on the small sprites.
- A one-block-thick pure black outline around every sprite.
- Flat fills. Each small sprite uses at most 3 colours plus the black outline.
- Every sprite faces RIGHT, shown side-on (three-quarter side view), standing on an invisible ground line at the bottom of its cell.
- Background: one flat pure magenta (#FF00FF) everywhere, edge to edge. No ground, no shadows, no frames, no borders.
- Lay the sprites out on a strict, evenly spaced grid with generous magenta gaps so no two sprites touch or overlap.
- No text, no letters, no numbers, no labels, no grid lines, no watermark.

Use your image_gen tool (gpt-image-2). Save the result as a PNG to <repo>/art/sheets/bosses-z4z5.png.
```

Cut:

```sh
O="--grid 2x2 --colours 16 --fit 48x34 --native art/sheets/native"
pnpm slice art/sheets/bosses-z4z5.png art/sprites $=O --row 0 --names enemy/barrow_king,enemy/crypt_ogre
pnpm slice art/sheets/bosses-z4z5.png art/sprites $=O --row 1 --names enemy/glass_leviathan,enemy/reef_troll
```

Result: block about 10, the zone 1 bosses' pixel; all four ship (54 × 34, 34 × 25, 57 × 38, 43 × 31).

## bosses-z6z7.png

2026-10-07, run `pf2-bosses-z6z7`. References: `art/sheets/dense-heroes-zone1-items.png`, `art/sheets/zone1-bosses.png`.

Prompt:

```text
HARD REQUIREMENT, READ FIRST: the entire background of the image is ONE flat solid pure magenta colour, #FF00FF, edge to edge, exactly like the attached reference sheet. NOT black, NOT dark, NOT a gradient, NO vignette. NO glow, NO light halo, NO bloom, NO particles around sprites. Any spell or magic effect is drawn as a few solid hard-edged pixels with a black outline, part of the sprite, never as a soft glow.

Generate one landscape 1536x1024 sprite sheet: a strict 2 x 2 grid of four equal cells, one boss per cell, in exactly the style and the coarse pixel size of the bosses in the attached zone 1 boss sheet: richer 16-bit style, up to 16 colours each, light shading allowed, a black outline, hard square pixels, no anti-aliasing. All face right. Each boss is no wider than twice its height. Build every boss from the same large pixel blocks as the bosses in the attached zone 1 boss sheet, never finer pixels: each zone boss fills at most about three-quarters of its cell's width and two-thirds of its cell's height, the smaller boss less.
Top left, the zone boss of Emberfall Caves (lava caves: black rock, orange glow, soot): EMBERFALL WYRM: a fire dragon with molten cracks along black scales, wings spread, smoke from its jaws. Top right, the smaller boss of Emberfall Caves, about two-thirds the size: SLAG GIANT: a giant of cooling slag and rock, lava dripping from its fists. Bottom left, the zone boss of Frostvein Pass (a snowy mountain pass: ice blue, white, grey stone): FROSTVEIN YETI: a huge white-furred yeti with blue ice veins along its arms, roaring. Bottom right, the smaller boss of Frostvein Pass: AVALANCHE DRAKE: a stocky white drake with a snow-crusted crest and icy wings.

STYLE (match the attached reference sheet's pixel style exactly, but these are NEW designs, not copies of the reference figures):
- Retro 8-bit console sprite art. Every sprite is built from large, perfectly square, equal-size pixel blocks on a hard grid; no anti-aliasing, no gradients, no blur, no soft shadows, no dithering on the small sprites.
- A one-block-thick pure black outline around every sprite.
- Flat fills. Each small sprite uses at most 3 colours plus the black outline.
- Every sprite faces RIGHT, shown side-on (three-quarter side view), standing on an invisible ground line at the bottom of its cell.
- Background: one flat pure magenta (#FF00FF) everywhere, edge to edge. No ground, no shadows, no frames, no borders.
- Lay the sprites out on a strict, evenly spaced grid with generous magenta gaps so no two sprites touch or overlap.
- No text, no letters, no numbers, no labels, no grid lines, no watermark.

Use your image_gen tool (gpt-image-2). Save the result as a PNG to <repo>/art/sheets/bosses-z6z7.png.
```

Cut:

```sh
O="--grid 2x2 --colours 16 --fit 48x34 --native art/sheets/native"
pnpm slice art/sheets/bosses-z6z7.png art/sprites $=O --row 0 --names enemy/emberfall_wyrm,enemy/slag_giant
pnpm slice art/sheets/bosses-z6z7.png art/sprites $=O --row 1 --names enemy/frostvein_yeti,enemy/avalanche_drake
```

Result: block about 7. The slag giant (49 × 31) and the avalanche drake (62 × 34) ship; the emberfall wyrm (77 × 43) and the frostvein yeti (71 × 42) are wider than 64 and go to Redos.

## bosses-z8z9.png

2026-10-07, run `pf2-bosses-z8z9`. References: `art/sheets/dense-heroes-zone1-items.png`, `art/sheets/zone1-bosses.png`.

Prompt:

```text
HARD REQUIREMENT, READ FIRST: the entire background of the image is ONE flat solid pure magenta colour, #FF00FF, edge to edge, exactly like the attached reference sheet. NOT black, NOT dark, NOT a gradient, NO vignette. NO glow, NO light halo, NO bloom, NO particles around sprites. Any spell or magic effect is drawn as a few solid hard-edged pixels with a black outline, part of the sprite, never as a soft glow.

Generate one landscape 1536x1024 sprite sheet: a strict 2 x 2 grid of four equal cells, one boss per cell, in exactly the style and the coarse pixel size of the bosses in the attached zone 1 boss sheet: richer 16-bit style, up to 16 colours each, light shading allowed, a black outline, hard square pixels, no anti-aliasing. All face right. Each boss is no wider than twice its height. Build every boss from the same large pixel blocks as the bosses in the attached zone 1 boss sheet, never finer pixels: each zone boss fills at most about three-quarters of its cell's width and two-thirds of its cell's height, the smaller boss less.
Top left, the zone boss of Sunken Abbey (a flooded stone abbey: teal water, wet stone, candle gold): SUNKEN ABBOT: a towering undead abbot in rotted vestments and a mitre, a crozier dripping water. Top right, the smaller boss of Sunken Abbey, about two-thirds the size: CHOIR OF BONES: three singing skulls in choir collars fused onto a bone pillar. Bottom left, the zone boss of Ashen Waste (a grey ash desert under a red sky: ash grey, rust, bone): WASTE TYRANT: a giant warlord in scorched black plate, a horned helm and a huge cleaver. Bottom right, the smaller boss of Ashen Waste: SAND BASILISK: a long sand-yellow lizard with a frilled crest and a stony glare.

STYLE (match the attached reference sheet's pixel style exactly, but these are NEW designs, not copies of the reference figures):
- Retro 8-bit console sprite art. Every sprite is built from large, perfectly square, equal-size pixel blocks on a hard grid; no anti-aliasing, no gradients, no blur, no soft shadows, no dithering on the small sprites.
- A one-block-thick pure black outline around every sprite.
- Flat fills. Each small sprite uses at most 3 colours plus the black outline.
- Every sprite faces RIGHT, shown side-on (three-quarter side view), standing on an invisible ground line at the bottom of its cell.
- Background: one flat pure magenta (#FF00FF) everywhere, edge to edge. No ground, no shadows, no frames, no borders.
- Lay the sprites out on a strict, evenly spaced grid with generous magenta gaps so no two sprites touch or overlap.
- No text, no letters, no numbers, no labels, no grid lines, no watermark.

Use your image_gen tool (gpt-image-2). Save the result as a PNG to <repo>/art/sheets/bosses-z8z9.png.
```

Cut:

```sh
O="--grid 2x2 --colours 16 --fit 48x34 --native art/sheets/native"
pnpm slice art/sheets/bosses-z8z9.png art/sprites $=O --row 0 --names enemy/sunken_abbot,enemy/choir_of_bones
pnpm slice art/sheets/bosses-z8z9.png art/sprites $=O --row 1 --names enemy/waste_tyrant,enemy/sand_basilisk
```

Result: block about 9; all four ship (36 × 38, 23 × 35, 56 × 42, 45 × 34).

## bosses-z10z11.png

2026-10-07, run `pf2-bosses-z10z11`. References: `art/sheets/dense-heroes-zone1-items.png`, `art/sheets/zone1-bosses.png`.

Prompt:

```text
HARD REQUIREMENT, READ FIRST: the entire background of the image is ONE flat solid pure magenta colour, #FF00FF, edge to edge, exactly like the attached reference sheet. NOT black, NOT dark, NOT a gradient, NO vignette. NO glow, NO light halo, NO bloom, NO particles around sprites. Any spell or magic effect is drawn as a few solid hard-edged pixels with a black outline, part of the sprite, never as a soft glow.

Generate one landscape 1536x1024 sprite sheet: a strict 2 x 2 grid of four equal cells, one boss per cell, in exactly the style and the coarse pixel size of the bosses in the attached zone 1 boss sheet: richer 16-bit style, up to 16 colours each, light shading allowed, a black outline, hard square pixels, no anti-aliasing. All face right. Each boss is no wider than twice its height. Build every boss from the same large pixel blocks as the bosses in the attached zone 1 boss sheet, never finer pixels: each zone boss fills at most about three-quarters of its cell's width and two-thirds of its cell's height, the smaller boss less.
Top left, the zone boss of Starfall Spire (a tower among the stars: deep navy, silver, starlight): FALLEN STAR: a burning fallen star: a jagged crystal core with arms of white fire. Top right, the smaller boss of Starfall Spire, about two-thirds the size: VOID MANTA: a dark purple manta ray gliding, star speckles on its wings. Bottom left, the zone boss of Hollow King's Court (a dead royal court: purple, tarnished gold, black): HOLLOW KING: an empty crowned royal robe with two glowing eyes and a black sceptre. Bottom right, the smaller boss of Hollow King's Court: ROYAL CHIMERA: a chimera with lion, goat and serpent heads in royal purple and gold.

STYLE (match the attached reference sheet's pixel style exactly, but these are NEW designs, not copies of the reference figures):
- Retro 8-bit console sprite art. Every sprite is built from large, perfectly square, equal-size pixel blocks on a hard grid; no anti-aliasing, no gradients, no blur, no soft shadows, no dithering on the small sprites.
- A one-block-thick pure black outline around every sprite.
- Flat fills. Each small sprite uses at most 3 colours plus the black outline.
- Every sprite faces RIGHT, shown side-on (three-quarter side view), standing on an invisible ground line at the bottom of its cell.
- Background: one flat pure magenta (#FF00FF) everywhere, edge to edge. No ground, no shadows, no frames, no borders.
- Lay the sprites out on a strict, evenly spaced grid with generous magenta gaps so no two sprites touch or overlap.
- No text, no letters, no numbers, no labels, no grid lines, no watermark.

Use your image_gen tool (gpt-image-2). Save the result as a PNG to <repo>/art/sheets/bosses-z10z11.png.
```

Cut:

```sh
O="--grid 2x2 --colours 16 --fit 48x34 --native art/sheets/native"
pnpm slice art/sheets/bosses-z10z11.png art/sprites $=O --row 0 --names enemy/fallen_star,enemy/void_manta
pnpm slice art/sheets/bosses-z10z11.png art/sprites $=O --row 1 --names enemy/hollow_king,enemy/royal_chimera
```

Result: block about 9 to 10; all four ship (47 × 27, 46 × 28, 56 × 43, 54 × 38).

## redos-1.png

2026-10-07, run `pf2-redos-1`. References: `art/sheets/dense-heroes-zone1-items.png`, `art/sheets/zone1-bosses.png`.
The 30 monster sheet A redos and the first two sheet B monster redos.

Prompt:

```text
HARD REQUIREMENT, READ FIRST: the entire background of the image is ONE flat solid pure magenta colour, #FF00FF, edge to edge, exactly like the attached reference sheet. NOT black, NOT dark, NOT a gradient, NO vignette. NO glow, NO light halo, NO bloom, NO particles around sprites. Any spell or magic effect is drawn as a few solid hard-edged pixels with a black outline, part of the sprite, never as a soft glow.

Generate one landscape 1536x1024 sprite sheet: a DENSE strict grid of 8 columns x 4 rows, 32 small sprites, one per cell, every cell the same size (192 x 256 screen pixels). Every sprite is a tiny 16x16-art-pixel 8-bit sprite with at most 3 colours plus the black outline, small in its cell, with magenta all around it, in exactly the style and pixel size of the attached dense sheet. Keep every sprite SMALL and CHUNKY: it covers only about half of its cell's width and half of its cell's height, built from the same large pixel blocks as the attached dense sheet; never use finer pixels to add detail. Each cell is one sprite of a fantasy idle RPG.
Row 1: 1. BRAMBLE WOLF (Whisperwood): a lean grey-green wolf with thorny bramble vines twined through its fur. 2. MOSS GOLEM (Whisperwood): a squat boulder golem under thick moss, two green eye slits. 3. WOOD GOBLIN (Whisperwood): a bark-skinned forest goblin with a heavy branch club and a leaf loincloth. 4. BOG LURKER (Marsh of Sighs): a hunched mud brute draped in pond weed, long dangling arms. 5. MARSH LEECH (Marsh of Sighs): a fat striped leech rearing up, a round toothed sucker mouth. 6. MIRE TOAD (Marsh of Sighs): a huge warty toad with a bloated throat sac, mud brown and olive. 7. BARROW WIGHT (Old Barrow Hills): a gaunt ghostly corpse in rotting burial robes and a rusted circlet, cold blue eyes, casting. 8. GRAVE HOUND (Old Barrow Hills): a skeletal hound with glowing eyes and bare ribs.
Row 2: 1. BONE SOLDIER (Old Barrow Hills): a skeleton warrior with a dented round shield and a notched sword. 2. CAIRN CRAWLER (Old Barrow Hills): a beetle-like crawler whose shell is a pile of cairn stones. 3. SALT CRAB (Saltglass Coast): a big crab with a crust of white salt crystals and one giant claw. 4. GULL HARPY (Saltglass Coast): a harpy with gull wings and talons, white and grey feathers. 5. DROWNED SAILOR (Saltglass Coast): a waterlogged zombie sailor in a striped shirt, seaweed, a boat hook. 6. TIDE WITCH (Saltglass Coast): a sea witch with kelp hair, a shell crown and a coral staff. 7. EMBER IMP (Emberfall Caves): a small red imp with bat wings and a flaming tail. 8. MAGMA BEETLE (Emberfall Caves): a heavy beetle with a cracked black shell glowing orange in the seams.
Row 3: 1. CINDER ORC (Emberfall Caves): a soot-black orc with burning eyes and a jagged iron axe. 2. FLAME ADEPT (Emberfall Caves): a hooded fire cultist in red robes conjuring a fireball. 3. FROST WOLF (Frostvein Pass): a white wolf with an icy blue mane and frosted breath. 4. ICE TROLL (Frostvein Pass): a blue-skinned troll with icicle tusks and a frozen club. 5. RIME GOLEM (Frostvein Pass): a blocky golem of packed ice and snow with a glowing blue core. 6. SNOW SHAMAN (Frostvein Pass): a fur-cloaked shaman with an antler headdress and a frost staff. 7. DROWNED MONK (Sunken Abbey): a bloated drowned monk in a soaked brown habit swinging a censer. 8. ABBEY GARGOYLE (Sunken Abbey): a crouching stone gargoyle with folded wings, grey and mossy.
Row 4: 1. BELL WRAITH (Sunken Abbey): a hooded spectre holding a cracked bronze bell. 2. EEL SERPENT (Sunken Abbey): a long dark eel with glowing yellow spots, jaws open. 3. ASH GHOUL (Ashen Waste): a hunched grey ghoul caked in ash, long claws. 4. DUST STALKER (Ashen Waste): a lean sand-coloured lizard stalker in a cloth wrap, mid-run. 5. CINDER COLOSSUS (Ashen Waste): a squat colossus of charred stone with ember cracks. 6. ASH ORACLE (Ashen Waste): a veiled oracle in grey robes holding a smoking bowl. 7. STAR SENTINEL (Starfall Spire): a silver construct guardian with a star-shaped head and a tower shield. 8. SPIRE WARDEN (Starfall Spire): a warden in silver plate with a starry halberd.

STYLE (match the attached reference sheet's pixel style exactly, but these are NEW designs, not copies of the reference figures):
- Retro 8-bit console sprite art. Every sprite is built from large, perfectly square, equal-size pixel blocks on a hard grid; no anti-aliasing, no gradients, no blur, no soft shadows, no dithering on the small sprites.
- A one-block-thick pure black outline around every sprite.
- Flat fills. Each small sprite uses at most 3 colours plus the black outline.
- Every sprite faces RIGHT, shown side-on (three-quarter side view), standing on an invisible ground line at the bottom of its cell.
- Background: one flat pure magenta (#FF00FF) everywhere, edge to edge. No ground, no shadows, no frames, no borders.
- Lay the sprites out on a strict, evenly spaced grid with generous magenta gaps so no two sprites touch or overlap.
- No text, no letters, no numbers, no labels, no grid lines, no watermark.

Use your image_gen tool (gpt-image-2). Save the result as a PNG to <repo>/art/sheets/redos-1.png.
```

Cut: as monster sheet A, names `enemy/<id>` in the order above, into a scratch folder; the two
that pass were copied into `art/sprites/enemy/`.

Result: the size sentence that fixed sheet B did not hold for a sheet of creatures: block about 6
again, 19 to 34 as drawn. `bog_lurker` (19 × 20) and `marsh_leech` (20 × 19) ship; the other 30
stay redos. Their cuts read better than sheet A's, so the review page offers them as "ship as cut".

## bosses-z12.png

2026-10-07, run `pf2-bosses-z12`. References: `art/sheets/dense-heroes-zone1-items.png`, `art/sheets/zone1-bosses.png`.
The bottom row is a second take of the same two (Narrowing 2: no boss redo was pending).

Prompt:

```text
HARD REQUIREMENT, READ FIRST: the entire background of the image is ONE flat solid pure magenta colour, #FF00FF, edge to edge, exactly like the attached reference sheet. NOT black, NOT dark, NOT a gradient, NO vignette. NO glow, NO light halo, NO bloom, NO particles around sprites. Any spell or magic effect is drawn as a few solid hard-edged pixels with a black outline, part of the sprite, never as a soft glow.

Generate one landscape 1536x1024 sprite sheet: a strict 2 x 2 grid of four equal cells, one boss per cell, in exactly the style and the coarse pixel size of the bosses in the attached zone 1 boss sheet: richer 16-bit style, up to 16 colours each, light shading allowed, a black outline, hard square pixels, no anti-aliasing. All face right. Each boss is no wider than twice its height. Build every boss from the same large pixel blocks as the bosses in the attached zone 1 boss sheet, never finer pixels: each zone boss fills at most about three-quarters of its cell's width and two-thirds of its cell's height, the smaller boss less.
Top left, the zone boss of The Unwritten Reach (a world of blank paper and ink: white, black ink, blue ink): UNWRITTEN ONE: a towering faceless figure of white paper and swirling ink, an empty outlined face. Top right, the smaller boss of The Unwritten Reach, about two-thirds the size: MARGIN BEAST: a beast made of scribbled ink doodles from a page margin. Bottom left and bottom right: a second take of the same two bosses, the zone boss then the smaller boss, same designs and pixel size, a slightly different pose.

STYLE (match the attached reference sheet's pixel style exactly, but these are NEW designs, not copies of the reference figures):
- Retro 8-bit console sprite art. Every sprite is built from large, perfectly square, equal-size pixel blocks on a hard grid; no anti-aliasing, no gradients, no blur, no soft shadows, no dithering on the small sprites.
- A one-block-thick pure black outline around every sprite.
- Flat fills. Each small sprite uses at most 3 colours plus the black outline.
- Every sprite faces RIGHT, shown side-on (three-quarter side view), standing on an invisible ground line at the bottom of its cell.
- Background: one flat pure magenta (#FF00FF) everywhere, edge to edge. No ground, no shadows, no frames, no borders.
- Lay the sprites out on a strict, evenly spaced grid with generous magenta gaps so no two sprites touch or overlap.
- No text, no letters, no numbers, no labels, no grid lines, no watermark.

Use your image_gen tool (gpt-image-2). Save the result as a PNG to <repo>/art/sheets/bosses-z12.png.
```

Result: the top row ships (unwritten_one 61 × 54, margin_beast 67 × 43 as drawn); the bottom
take was close and slightly larger. The SNES master was derived again from all 28 bosses and is
now locked.

## Redos

| Id | From | Note |
| --- | --- | --- |
| `enemy:bramble_wolf` | monsters-a | too big as drawn (over 21 px): draw smaller, at the dense sheet's chunkier pixel |
| `enemy:moss_golem` | monsters-a | too big as drawn (over 21 px): draw smaller, at the dense sheet's chunkier pixel |
| `enemy:wood_goblin` | monsters-a | too big as drawn (over 21 px): draw smaller, at the dense sheet's chunkier pixel |
| `enemy:bog_lurker` (shipped from redos-1) | monsters-a | too big as drawn (over 21 px): draw smaller, at the dense sheet's chunkier pixel |
| `enemy:marsh_leech` (shipped from redos-1) | monsters-a | too big as drawn (over 21 px): draw smaller, at the dense sheet's chunkier pixel |
| `enemy:mire_toad` | monsters-a | too big as drawn (over 21 px): draw smaller, at the dense sheet's chunkier pixel |
| `enemy:barrow_wight` | monsters-a | too big as drawn (over 21 px): draw smaller, at the dense sheet's chunkier pixel |
| `enemy:grave_hound` | monsters-a | too big as drawn (over 21 px): draw smaller, at the dense sheet's chunkier pixel |
| `enemy:bone_soldier` | monsters-a | too big as drawn (over 21 px): draw smaller, at the dense sheet's chunkier pixel |
| `enemy:cairn_crawler` | monsters-a | too big as drawn (over 21 px): draw smaller, at the dense sheet's chunkier pixel |
| `enemy:salt_crab` | monsters-a | too big as drawn (over 21 px): draw smaller, at the dense sheet's chunkier pixel |
| `enemy:gull_harpy` | monsters-a | too big as drawn (over 21 px): draw smaller, at the dense sheet's chunkier pixel |
| `enemy:drowned_sailor` | monsters-a | too big as drawn (over 21 px): draw smaller, at the dense sheet's chunkier pixel |
| `enemy:tide_witch` | monsters-a | too big as drawn (over 21 px): draw smaller, at the dense sheet's chunkier pixel |
| `enemy:ember_imp` | monsters-a | too big as drawn (over 21 px): draw smaller, at the dense sheet's chunkier pixel |
| `enemy:magma_beetle` | monsters-a | too big as drawn (over 21 px): draw smaller, at the dense sheet's chunkier pixel |
| `enemy:cinder_orc` | monsters-a | too big as drawn (over 21 px): draw smaller, at the dense sheet's chunkier pixel |
| `enemy:flame_adept` | monsters-a | too big as drawn (over 21 px): draw smaller, at the dense sheet's chunkier pixel |
| `enemy:frost_wolf` | monsters-a | too big as drawn (over 21 px): draw smaller, at the dense sheet's chunkier pixel |
| `enemy:ice_troll` | monsters-a | too big as drawn (over 21 px): draw smaller, at the dense sheet's chunkier pixel |
| `enemy:rime_golem` | monsters-a | too big as drawn (over 21 px): draw smaller, at the dense sheet's chunkier pixel |
| `enemy:snow_shaman` | monsters-a | too big as drawn (over 21 px): draw smaller, at the dense sheet's chunkier pixel |
| `enemy:drowned_monk` | monsters-a | too big as drawn (over 21 px): draw smaller, at the dense sheet's chunkier pixel |
| `enemy:abbey_gargoyle` | monsters-a | too big as drawn (over 21 px): draw smaller, at the dense sheet's chunkier pixel |
| `enemy:bell_wraith` | monsters-a | too big as drawn (over 21 px): draw smaller, at the dense sheet's chunkier pixel |
| `enemy:eel_serpent` | monsters-a | too big as drawn (over 21 px): draw smaller, at the dense sheet's chunkier pixel |
| `enemy:ash_ghoul` | monsters-a | too big as drawn (over 21 px): draw smaller, at the dense sheet's chunkier pixel |
| `enemy:dust_stalker` | monsters-a | too big as drawn (over 21 px): draw smaller, at the dense sheet's chunkier pixel |
| `enemy:cinder_colossus` | monsters-a | too big as drawn (over 21 px): draw smaller, at the dense sheet's chunkier pixel |
| `enemy:ash_oracle` | monsters-a | too big as drawn (over 21 px): draw smaller, at the dense sheet's chunkier pixel |
| `enemy:star_sentinel` | sheet-b | 24 × 24 as drawn: draw smaller, at the dense sheet's chunkier pixel |
| `enemy:spire_warden` | sheet-b | 21 × 26 as drawn: draw smaller, at the dense sheet's chunkier pixel |
| `enemy:hollow_knight` | sheet-b | 22 × 21 as drawn: draw smaller, at the dense sheet's chunkier pixel |
| `enemy:throne_guard` | sheet-b | 22 × 21 as drawn: draw smaller, at the dense sheet's chunkier pixel |
| `enemy:court_mage` | sheet-b | 21 × 23 as drawn: draw smaller, at the dense sheet's chunkier pixel |
| `enemy:ink_horror` | sheet-b | 23 × 25 as drawn: draw smaller, at the dense sheet's chunkier pixel |
| `enemy:quill_golem` | sheet-b | 20 × 22 as drawn: draw smaller, at the dense sheet's chunkier pixel |
| `item:storm_rod` | sheet-b | 16 × 22 as drawn: draw smaller |
| `item:void_scepter` | sheet-b | 18 × 26 as drawn: draw smaller |
| `item:willow_staff` | sheet-b | 21 × 27 as drawn: draw smaller |
| `item:silver_crook` | sheet-b | 13 × 22 as drawn: draw smaller |
| `item:sacred_mace` | sheet-b | 17 × 25 as drawn: draw smaller |
| `item:seraph_staff` | sheet-b | 17 × 23 as drawn: draw smaller |
| `item:longbow` | sheet-b | 14 × 24 as drawn: draw smaller |
| `item:starshot_bow` | sheet-b | 16 × 24 as drawn: draw smaller |
| `item:mystic_robe` | sheet-b | 19 × 22 as drawn: draw smaller |
| `item:hide_coat` | sheet-b | 22 × 22 as drawn: draw smaller |
| `item:ranger_garb` | sheet-b | 18 × 22 as drawn: draw smaller |
| `enemy:elder_treant` | bosses-z2z3 | 66 × 56 as drawn: the zone 1 bosses' coarser pixel |
| `enemy:sigh_hag` | bosses-z2z3 | 63 × 52 as drawn: the zone 1 bosses' coarser pixel |
| `enemy:giant_heron` | bosses-z2z3 | 66 × 50 as drawn: the zone 1 bosses' coarser pixel |
| `enemy:emberfall_wyrm` | bosses-z6z7 | 77 × 43 as drawn: the zone 1 bosses' coarser pixel |
| `enemy:frostvein_yeti` | bosses-z6z7 | 71 × 42 as drawn: the zone 1 bosses' coarser pixel |

Kevin, 2026-10-07: every redo ships from its best existing cut (no more rerolls for size), and the
world bosses ship from world-bosses-r2 as cut. The redo cuts come from: redos-1 for the 28
creature redos of monster sheet A, sheet-b for its own 18 (the star sentinel and spire warden
included, smaller there than in redos-1), and their own sheets for the five bosses. Ids that do
not read get hand cleanup with `pnpm grid`.

The SNES master was derived from all 26 real bosses and world bosses (the plan had 6: zone 1's
and the world bosses), since every boss but zone 12's was drawn by then. It is derived once more
after zone 12 lands, then locked.

## The canonical cut

2026-10-07: the magenta key was too wide (red and blue above 120, green low), so it keyed out the
bright purples of zone 11 and the purple bosses. The key is now the near-pure magenta of the ground
and its pink fringe (red and blue 180 or more, green at least 100 below them). Every shipped sprite
was re-cut with this script; it supersedes the cut commands above. The hero sprites, and
`enemy:hollow_knight`, `enemy:throne_guard`, `enemy:court_mage` and `enemy:ink_horror`, are hand-drawn
at 16 × 16 over their cuts (`art/sheets/grids/`), so after a re-cut, write them back with
`pnpm grid --png art/sheets/grids/<kind>-<name>.txt art/sprites/<kind>/<name>.png`.

2026-10-07, the 1.5× art: every call also writes the sprite's 1.5× cut to `art/sprites-hires/`
(`--hires`: the native fitted to 24 × 24 or 72 × 51, 16 colours). The 1.5× art is never
hand-drawn, except the eight hero poses below; the script ends by writing the hand-drawn 1× sprites back, so a re-cut leaves
`art/sprites` unchanged. After a re-cut, `pnpm sprites --derive-hires-master` re-derives
`art/palettes/hires.json`, then `pnpm sprites`.

The eight 1.5× hero poses carry hand fixes, kept as grids (`art/sheets/grids/hires-<kind>-<name>.txt`)
and written back by the script. The rarity slot must be one 8-connected region after the snap to
the 1.5× master, so on each pose the rarity area, shading included, is flattened to its
`rarityColorHires`, and every other pixel that snapped to the same master entry moves to the
nearest other entry:

- knight and knight attack: the cape (`#fb0803`, `#fa0904`); the plume, the shield cross and the
  tabard stripe move to a darker red.
- black mage and its attack: the robe (`#7112b3`, `#7513b8`); the hat and a sleeve edge are
  repainted `#5726a3` (a blue-violet: any purple near the robe's merges with it in the median cut).
- white mage and its attack: the staff orb (`#07e4fa`, `#11e3fb`), not the chest: the natives have
  no chest sigil in one region; the cyan specks on the body move to a lighter cyan.
- archer and its attack: the cape (`#fbeb05`, `#fbed03`).

```sh
# Re-cuts every shipped sprite from its sheet. Run from the repository root.
set -e
N="--native art/sheets/native --hires art/sprites-hires"
D="--grid 8x4 --colours 4 --size 16 $N"
B="--grid 2x2 --colours 16 --fit 48x34 $N"
s() { pnpm -s slice "$@" | grep -v ' 16x16 native\| native .* block' || true; }
cut() { pnpm -s slice "$@" >/dev/null; }
# The dense sheet: the heroes' natives only (their 16 px art is hand-drawn), then monsters and items.
cut art/sheets/dense-heroes-zone1-items.png /tmp/promptfall-hero-cuts ${=D} --row 0 --names hero/knight,hero/black_mage,hero/white_mage,hero/archer,hero_attack/knight,hero_attack/black_mage,hero_attack/white_mage,hero_attack/archer
cut art/sheets/dense-heroes-zone1-items.png art/sprites ${=D} --row 1 --names enemy/road_slime,enemy/field_rat,enemy/goblin_scout,enemy/hedge_sprite,item/iron_sword,item/oak_staff,item/chainmail,item/copper_ring
cut art/sheets/dense-heroes-zone1-items.png art/sprites ${=D} --row 2 --names item/bronze_axe,item/steel_longsword,item/ember_rod,item/healers_mace,item/short_bow,item/bronze_plate,item/silk_robe,item/leather_vest
cut art/sheets/dense-heroes-zone1-items.png art/sprites ${=D} --row 3 --names item/bone_charm,item/silver_amulet,item/gold_bangle,item/phoenix_pendant,item/mithril_blade,item/rune_staff,item/elven_bow,item/dragon_plate
cut art/sheets/zone1-bosses.png art/sprites ${=B} --row 1 --names enemy/bandit_captain,enemy/wild_boar
# Monster sheet A ships only its two wisps; the rest come from redos-1. x/ names go to a scratch kind.
cut art/sheets/monsters-a.png art/sprites ${=D} --row 0 --names x/a,x/b,x/c,enemy/whisper_wisp,x/d,x/e,x/f,enemy/will_o_wisp
cut art/sheets/redos-1.png art/sprites ${=D} --row 0 --names enemy/bramble_wolf,enemy/moss_golem,enemy/wood_goblin,enemy/bog_lurker,enemy/marsh_leech,enemy/mire_toad,enemy/barrow_wight,enemy/grave_hound
cut art/sheets/redos-1.png art/sprites ${=D} --row 1 --names enemy/bone_soldier,enemy/cairn_crawler,enemy/salt_crab,enemy/gull_harpy,enemy/drowned_sailor,enemy/tide_witch,enemy/ember_imp,enemy/magma_beetle
cut art/sheets/redos-1.png art/sprites ${=D} --row 2 --names enemy/cinder_orc,enemy/flame_adept,enemy/frost_wolf,enemy/ice_troll,enemy/rime_golem,enemy/snow_shaman,enemy/drowned_monk,enemy/abbey_gargoyle
cut art/sheets/redos-1.png art/sprites ${=D} --row 3 --names enemy/bell_wraith,enemy/eel_serpent,enemy/ash_ghoul,enemy/dust_stalker,enemy/cinder_colossus,enemy/ash_oracle,x/g,x/h
cut art/sheets/sheet-b.png art/sprites ${=D} --row 0 --names enemy/star_sentinel,enemy/comet_hound,enemy/spire_warden,enemy/astral_seer,enemy/hollow_knight,enemy/court_jester,enemy/throne_guard,enemy/court_mage
cut art/sheets/sheet-b.png art/sprites ${=D} --row 1 --names enemy/ink_horror,enemy/blank_page,enemy/quill_golem,enemy/erased_scribe,item/dragonfang,item/storm_rod,item/void_scepter,item/willow_staff
cut art/sheets/sheet-b.png art/sprites ${=D} --row 2 --names item/silver_crook,item/sacred_mace,item/seraph_staff,item/oak_bow,item/longbow,item/starshot_bow,item/steel_plate,item/mithril_mail
cut art/sheets/sheet-b.png art/sprites ${=D} --row 3 --names item/cloth_robe,item/mystic_robe,item/sage_robe,item/astral_robe,item/hide_coat,item/ranger_garb,item/shadow_leather,item/wind_cloak
cut art/sheets/world-bosses-r2.png art/sprites ${=B} --row 0 --names world_boss/the_promptwyrm,world_boss/hallucinox
cut art/sheets/world-bosses-r2.png art/sprites ${=B} --row 1 --names world_boss/the_context_leviathan,world_boss/tokenmaw
cut art/sheets/bosses-z12.png art/sprites ${=B} --row 0 --names enemy/unwritten_one,enemy/margin_beast
for z in z2z3:elder_treant,owlbear_cub:sigh_hag,giant_heron z4z5:barrow_king,crypt_ogre:glass_leviathan,reef_troll z6z7:emberfall_wyrm,slag_giant:frostvein_yeti,avalanche_drake z8z9:sunken_abbot,choir_of_bones:waste_tyrant,sand_basilisk z10z11:fallen_star,void_manta:hollow_king,royal_chimera; do
  parts=(${(s/:/)z})
  cut art/sheets/bosses-${parts[1]}.png art/sprites ${=B} --row 0 --names enemy/${parts[2]/,/,enemy/}
  cut art/sheets/bosses-${parts[1]}.png art/sprites ${=B} --row 1 --names enemy/${parts[3]/,/,enemy/}
done
# The hand-drawn 1× sprites, over their cuts, and the hand-fixed 1.5× hero poses.
for g in enemy-hollow_knight enemy-throne_guard enemy-court_mage enemy-ink_horror; do
  pnpm -s grid --png art/sheets/grids/$g.txt art/sprites/${g/-//}.png >/dev/null
done
for g in hero-knight hero-black_mage hero-white_mage hero-archer hero_attack-knight hero_attack-black_mage hero_attack-white_mage hero_attack-archer; do
  pnpm -s grid --png art/sheets/grids/hires-$g.txt art/sprites-hires/${g/-//}.png >/dev/null
done
rm -rf art/sprites/x art/sprites-hires/x art/sheets/native/x /tmp/promptfall-hero-cuts
```

## frames-heroes.png

2026-10-07, phase 4 PR 3 (Task F2): the heroes' wind-up and follow-through frames and the three
effect sprites. References: `art/sheets/ref-frames-heroes.png` (`pnpm refsheet art/sheets/ref-frames-heroes.png
--columns 8 --cell 192x256 --scale 7 hero/knight,hero_attack/knight,hero/black_mage,hero/white_mage,hero/archer,hero_attack/black_mage,hero_attack/white_mage,hero_attack/archer`),
`art/sheets/dense-heroes-zone1-items.png`.

Prompt (`bg.txt` + body + `frames-common.txt`):

```text
HARD REQUIREMENT, READ FIRST: the entire background of the image is ONE flat solid pure magenta colour, #FF00FF, edge to edge, exactly like the attached reference sheet. NOT black, NOT dark, NOT a gradient, NO vignette. NO glow, NO light halo, NO bloom, NO particles around sprites. Any spell or magic effect is drawn as a few solid hard-edged pixels with a black outline, part of the sprite, never as a soft glow.

Generate one landscape 1536x1024 sprite sheet: a strict grid of 8 columns x 4 rows, 32 small sprites, one per cell, every cell the same size (192 x 256 screen pixels). The attached reference sheet shows, left to right: column 1 the knight idle, column 2 the knight attacking, column 3 the black mage, column 4 the white mage, column 5 the archer, and columns 6 to 8 the black mage casting, the white mage casting and the archer shooting (for their staffs and bow only).
Row 1, one per column: 1 the knight winding up (sword raised high behind the head, weight back); 2 the knight's follow-through (sword swung down past the front foot, cape flying); 3 the black mage gathering fire (staff raised, a small flame at its tip, robe billowing); 4 the white mage raising the staff overhead with both hands; 5 the archer drawing the bow (string pulled to the cheek, arrow nocked); 6 a fireball (a round orange and yellow ball of fire with a short trailing flame, flying right, no figure); 7 a burst of holy light (a white and gold eight-rayed star, no figure); 8 a wooden arrow with a steel head and feather fletching, flying right, drawn horizontally, no figure.
Rows 2, 3 and 4: three more different takes of the same eight, in the same columns.
The hero sprites keep the exact designs of the reference (same armour, hats, capes, colours, same size), only in these poses. Characters face right.

STYLE (match the attached reference sheet's pixel style exactly, these are the SAME figures as the attached reference, in new poses: same design, same size, same colours, same pixel size):
- Retro 8-bit console sprite art. Every sprite is built from large, perfectly square, equal-size pixel blocks on a hard grid; no anti-aliasing, no gradients, no blur, no soft shadows, no dithering on the small sprites.
- A one-block-thick pure black outline around every sprite.
- Flat fills. Each small sprite uses at most 3 colours plus the black outline.
- Every sprite faces RIGHT, shown side-on (three-quarter side view), standing on an invisible ground line at the bottom of its cell.
- Background: one flat pure magenta (#FF00FF) everywhere, edge to edge. No ground, no shadows, no frames, no borders.
- Lay the sprites out on a strict, evenly spaced grid with generous magenta gaps so no two sprites touch or overlap.
- No text, no letters, no numbers, no labels, no grid lines, no watermark.

Use your image_gen tool (gpt-image-2). Save the result as a PNG to <repo>/art/sheets/frames-heroes.png.
```

Picks, by eye: row 1 (the first take) for the knight's wind-up and follow-through, the black mage,
the archer and the three effects; row 2 for the white mage (the staff overhead in both hands).

```sh
D=art/sheets/frames-heroes.png
C="--grid 8x4 --colours 4 --size 16 --native art/sheets/native"
pnpm slice $D /tmp/promptfall-frame-cuts $=C --hires art/sprites-frames --row 0 --names hero/knight-windup,hero/knight-follow,hero/black_mage-windup,x/w,hero/archer-windup,x/a,x/b,x/c
pnpm slice $D /tmp/promptfall-frame-cuts $=C --hires art/sprites-frames --row 1 --names x/a,x/b,x/c,hero/white_mage-windup,x/d,x/e,x/f,x/g
pnpm slice $D art/sprites $=C --hires art/sprites-hires --row 0 --names x/d,x/e,x/f,x/g,x/h,effect/fireball,effect/light_burst,effect/arrow
rm -rf art/sprites-frames/x art/sprites/x art/sprites-hires/x art/sheets/native/x /tmp/promptfall-frame-cuts
```

## Redos (frames)

| Id | Frame | From | Note |
| --- | --- | --- | --- |
