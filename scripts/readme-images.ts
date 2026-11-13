// Writes docs/readme/: the README's pictures, all drawn by the game's own code or cut from its
// committed art, upscaled by whole numbers with nearest-neighbour sampling so no pixel blurs.
//   band-loop.webp   the band at 165 columns playing one round: the knight, the goblin's answer,
//                    the black mage's fireball, the white mage's burst (needs `img2webp`, libwebp)
//   world-boss.png, camp.png, reveal.png
//                    stage scenarios at their golden instant, as the Image surface draws them
//   band-zoomed.png, pane-market.png, pane-heroes.png
//                    copies of the stage goldens (`pnpm stage:goldens`)
//   bestiary.png     every zone's six enemies standing on that zone's backdrop, then the world bosses
//   heroes.png       each hero's drawn poses: idle, wind-up, strike, follow-through, victory
//   items.png        the 40 item bases
// Run: `pnpm readme:images`.
import { execFileSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { content } from '@promptfall/sim'
import { composeFrame, type Frame } from '../plugins/promptfall/hooks/stage/compose'
import { wave } from '../plugins/promptfall/hooks/stage/fixtures'
import { layoutFor } from '../plugins/promptfall/hooks/stage/layout'
import { stageAt } from '../plugins/promptfall/hooks/stage/model'
import { composeBand } from '../plugins/promptfall/hooks/stage/playfield'
import {
  caseOf,
  GOLDEN_NOW,
  type Scenario,
  strip,
} from '../plugins/promptfall/hooks/stage/scenarios'
import { stagedState } from '../plugins/promptfall/hooks/stage/staged'
import { StageTimeline } from '../plugins/promptfall/hooks/stage/timeline'
import { STAGE_MAX_COLUMNS } from '../plugins/promptfall/hooks/stage/tuning'
import { WORLD_DEFAULT } from '../plugins/promptfall/hooks/state'
import { stripScene } from '../plugins/promptfall/hooks/ui/strip'
import type { Effect } from '../plugins/promptfall/hooks/vendor/sim.js'
import { blank, type Rgba, readPng, writePng } from './png'

const ROOT = join(import.meta.dirname, '..')
const OUT = join(ROOT, 'docs/readme')
const GOLDENS = join(ROOT, 'plugins/promptfall/hooks/stage/goldens')
const ART = join(ROOT, 'art')
/** The terminal background the goldens lay their pixels on. */
const BG = [0x1e, 0x1e, 0x24] as const

mkdirSync(OUT, { recursive: true })

/** A frame on the terminal background, every pixel `scale` × `scale`. */
function flatten(pic: Frame | Rgba, scale: number): Rgba {
  const src = 'rgba' in pic ? pic.rgba : pic.data
  const out = blank(pic.width * scale, pic.height * scale)
  for (let y = 0; y < out.height; y++) {
    for (let x = 0; x < out.width; x++) {
      const si = (Math.floor(y / scale) * pic.width + Math.floor(x / scale)) * 4
      const di = (y * out.width + x) * 4
      const on = (src[si + 3] ?? 0) > 0
      out.data[di] = on ? (src[si] ?? 0) : BG[0]
      out.data[di + 1] = on ? (src[si + 1] ?? 0) : BG[1]
      out.data[di + 2] = on ? (src[si + 2] ?? 0) : BG[2]
      out.data[di + 3] = 255
    }
  }
  return out
}

/** Draws `src` onto `dst` at (x, y), opaque pixels only. */
function blit(dst: Rgba, src: Rgba, x: number, y: number): void {
  for (let sy = 0; sy < src.height; sy++) {
    for (let sx = 0; sx < src.width; sx++) {
      const si = (sy * src.width + sx) * 4
      if ((src.data[si + 3] ?? 0) === 0) continue
      const dx = x + sx
      const dy = y + sy
      if (dx < 0 || dy < 0 || dx >= dst.width || dy >= dst.height) continue
      const di = (dy * dst.width + dx) * 4
      for (let c = 0; c < 4; c++) dst.data[di + c] = src.data[si + c] ?? 0
    }
  }
}

/** `src` repeated across a strip `width` wide, as the stage tiles a zone's backdrop. */
function tiled(src: Rgba, width: number): Rgba {
  const out = blank(width, src.height)
  for (let x = 0; x < width; x += src.width) blit(out, src, x, 0)
  return out
}

function filled(width: number, height: number): Rgba {
  const out = blank(width, height)
  for (let i = 0; i < out.data.length; i += 4) {
    out.data[i] = BG[0]
    out.data[i + 1] = BG[1]
    out.data[i + 2] = BG[2]
    out.data[i + 3] = 255
  }
  return out
}

const sprite = (path: string): Rgba => readPng(join(ART, path))

/** One row of sprites standing on its ground: bottom-aligned, `gap` apart, centred on `under`. */
function row(sprites: Rgba[], under: Rgba, gap: number, ground: number): Rgba {
  const out = { ...under, data: new Uint8Array(under.data) }
  const width = sprites.reduce((w, s) => w + s.width, 0) + gap * (sprites.length - 1)
  let x = Math.floor((under.width - width) / 2)
  for (const s of sprites) {
    blit(out, s, x, under.height - ground - s.height)
    x += s.width + gap
  }
  return out
}

function stack(rows: Rgba[], gap: number): Rgba {
  const width = Math.max(...rows.map((r) => r.width))
  const out = filled(width, rows.reduce((h, r) => h + r.height, 0) + gap * (rows.length - 1))
  let y = 0
  for (const r of rows) {
    blit(out, r, 0, y)
    y += r.height + gap
  }
  return out
}

function save(name: string, image: Rgba, scale: number): void {
  writePng(join(OUT, name), flatten(image, scale))
}

// The bestiary: one row per zone, its four wave enemies, its boss and its turn boss on its own
// backdrop; the four world bosses under them on the terminal background.
const ROW_WIDTH = 264
const zoneRows = content.zones.map((zone, i) => {
  const ids = [...zone.enemies, zone.boss, zone.turnBoss]
  return row(
    ids.map((id) => sprite(`sprites-hires/enemy/${id}.png`)),
    tiled(sprite(`backdrops-hires/zone-${i + 1}.png`), ROW_WIDTH),
    4,
    1,
  )
})
const worldBosses = readdirSync(join(ART, 'sprites-hires/world_boss'))
  .sort()
  .map((f) => sprite(`sprites-hires/world_boss/${f}`))
save('bestiary.png', stack([...zoneRows, row(worldBosses, filled(ROW_WIDTH, 53), 8, 1)], 2), 3)

// The heroes: one row each, idle, wind-up, strike, the knight's follow-through, victory.
const CELL = 28
const HEROES = ['knight', 'black_mage', 'white_mage', 'archer'] as const
const heroRows = HEROES.map((h) => {
  const poses = [
    sprite(`sprites-hires/hero/${h}.png`),
    sprite(`sprites-frames/hero/${h}-windup.png`),
    sprite(`sprites-hires/hero_attack/${h}.png`),
    ...(h === 'knight' ? [sprite('sprites-frames/hero/knight-follow.png')] : []),
    sprite(`sprites-frames/hero/${h}-victory.png`),
  ]
  const out = filled(CELL * 5, CELL)
  poses.forEach((p, i) => {
    blit(out, p, i * CELL + Math.floor((CELL - p.width) / 2), CELL - p.height - 2)
  })
  return out
})
save('heroes.png', stack(heroRows, 0), 5)

// The items: the 40 bases, eight to a row.
const items = readdirSync(join(ART, 'sprites-hires/item')).sort()
const COLS = 8
const sheet = filled(COLS * CELL, Math.ceil(items.length / COLS) * CELL)
items.forEach((f, i) => {
  const s = sprite(`sprites-hires/item/${f}`)
  const x = (i % COLS) * CELL + Math.floor((CELL - s.width) / 2)
  const y = Math.floor(i / COLS) * CELL + Math.floor((CELL - s.height) / 2)
  blit(sheet, s, x, y)
})
save('items.png', sheet, 3)

// Stage scenarios at their golden instant, the 1.5x frame the Image surface draws.
const STILLS: Array<[string, Scenario]> = [
  ['world-boss.png', 'step-boss'],
  ['camp.png', 'camp'],
  ['reveal.png', 'reveal-legendary'],
]
for (const [name, scenario] of STILLS) {
  const c = caseOf(scenario)
  save(name, flatten(composeFrame(c.at(c.now).model, { numbers: true }), 1), 4)
}

for (const name of ['band-zoomed.png', 'pane-market.png', 'pane-heroes.png']) {
  copyFileSync(join(GOLDENS, name), join(OUT, name))
}

// The band loop: one round on the wave fixture at 165 columns, sampled every FRAME_MS until every
// motion is over, then held to a whole idle cycle so the loop's seam falls on a rest.
const FRAME_MS = 40
const IDLE_CYCLE_MS = 1000
const COLUMNS = 165
const ROUND: Effect[] = [
  { k: 'act', actor: 'h1', action: 'attack', at: 0 },
  { k: 'hit', by: 'h1', target: 'e1', amount: 9 },
  { k: 'act', actor: 'e1', action: 'attack', at: 500 },
  { k: 'hit', by: 'e1', target: 'h1', amount: 5 },
  { k: 'act', actor: 'h2', action: 'attack', at: 1000 },
  { k: 'hit', by: 'h2', target: 'e2', amount: 6 },
  { k: 'act', actor: 'h3', action: 'attack', at: 1500 },
  { k: 'hit', by: 'h3', target: 'e3', amount: 8 },
]
const view = wave()
const t = new StageTimeline()
const start = GOLDEN_NOW
t.observe(view, start - IDLE_CYCLE_MS)
t.onEffects(ROUND, start)
const rows = t.rowsAt(view, start)
const layout = layoutFor(rows, { bodyColumns: COLUMNS, maxRows: 22 }, 'terminal', {
  tab: 'party',
  extra: 0,
  scalable: true,
})
if (layout.kind !== 'full') throw new Error(`a ${COLUMNS}-column band is not full`)
const scene = stripScene({
  ...strip('strip-rest'),
  columns: Math.min(COLUMNS, STAGE_MAX_COLUMNS),
}).scene
const box = { columns: COLUMNS, rows: layout.bandRows }
let end = start
while (t.active(end).length > 0 && end < start + 20_000) end += FRAME_MS
end = start + Math.ceil((end - start + 400) / IDLE_CYCLE_MS) * IDLE_CYCLE_MS
const tmp = mkdtempSync(join(tmpdir(), 'promptfall-loop-'))
try {
  const files: string[] = []
  for (let at = start; at < end; at += FRAME_MS) {
    const model = stageAt(stagedState(view, WORLD_DEFAULT, t, at), t, at, layout.box, {
      compact: false,
      motion: 'full',
    })
    const file = join(tmp, `${String(files.length).padStart(4, '0')}.png`)
    writePng(file, flatten(composeBand(box, composeFrame(model, { numbers: true }), scene), 1))
    files.push(file)
  }
  const args = ['-loop', '0', '-min_size']
  for (const f of files) args.push('-lossless', '-d', String(FRAME_MS), f)
  execFileSync('img2webp', [...args, '-o', join(OUT, 'band-loop.webp')])
  console.log(`band-loop.webp: ${files.length} frames, ${end - start} ms`)
} finally {
  rmSync(tmp, { recursive: true, force: true })
}
console.log(`${OUT}: written`)
