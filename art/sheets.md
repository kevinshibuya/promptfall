# Sprite sheets

Every sheet behind a sprite in `art/sprites/`: the prompt that drew it, the references attached
(in order), and the commands that cut it. The sheets themselves live in the gitignored
`art/sheets/` and are never committed. Each run went through
`~/.claude/bin/codex-run.sh <label> exec -m gpt-6-astra … -i=<ref> …` (gpt-image-2 through codex's
image_gen tool); `<repo>` is the repository root.

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

## Redos

None yet.
