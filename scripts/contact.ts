// Contact sheets for art review: each built sprite at ship size, its native cut beside it, and a
// zone's monsters and bosses on the real stage. One PNG per picture so the review page can caption
// each with its id.
//
// tsx scripts/contact.ts --zone <n> | --heroes | --items <name,name,…> | --world-bosses
//   [--out <dir>] [--native <dir>]
import { existsSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { content } from '@promptfall/sim'
import { SPRITES } from '../plugins/promptfall/hooks/sprites/generated'
import type { Sprite } from '../plugins/promptfall/hooks/sprites/types'
import { artFrame, composeFrame, type Frame } from '../plugins/promptfall/hooks/stage/compose'
import { boss, turnBoss, wave } from '../plugins/promptfall/hooks/stage/fixtures'
import { stageAt } from '../plugins/promptfall/hooks/stage/model'
import { StageTimeline } from '../plugins/promptfall/hooks/stage/timeline'
import { RARITY_RGB } from '../plugins/promptfall/hooks/stage/tuning'
import type { GameView } from '../plugins/promptfall/types'
import { type Rgba, readPng, writePng } from './png'

export type ContactTarget =
  | { kind: 'zone'; zone: number }
  | { kind: 'heroes' }
  | { kind: 'items'; names: string[] }
  | { kind: 'world-bosses' }

/** The terminal ground the pictures sit on. */
const BG = 0x1e1e24
const NOW = 1_000_000
/** Long past every spawn motion. */
const SETTLED = 60_000

function scaled(src: Rgba, s: number): Rgba {
  const width = src.width * s
  const height = src.height * s
  const data = new Uint8Array(width * height * 4)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const si = (Math.floor(y / s) * src.width + Math.floor(x / s)) * 4
      const on = (src.data[si + 3] ?? 0) > 0
      data.set(
        on
          ? [src.data[si] ?? 0, src.data[si + 1] ?? 0, src.data[si + 2] ?? 0, 255]
          : [BG >> 16, (BG >> 8) & 0xff, BG & 0xff, 255],
        (y * width + x) * 4,
      )
    }
  }
  return { width, height, data }
}

const rgbaOf = (f: Frame): Rgba => ({
  width: f.width,
  height: f.height,
  data: new Uint8Array(f.rgba),
})

function sprite(id: string): Sprite {
  const s = SPRITES[id]
  if (!s) throw new Error(`no sprite ${id}`)
  return s
}

/** The zone's view with its enemies swapped in, each keeping the fixture's hp and kind. */
function inZone(view: GameView, zone: number, defs: readonly string[]): GameView {
  const names = new Map(Object.values(content.enemies).map((e) => [e.id, e.name]))
  return {
    ...view,
    zone,
    zoneName: content.zones[zone - 1]?.name ?? '',
    enemies: view.enemies.slice(0, defs.length).map((e, i) => {
      const def = defs[i] ?? e.def
      return { ...e, id: `z${zone}-${i}`, def, name: names.get(def) ?? def }
    }),
  }
}

/** The view at rest on the full stage, grown for a boss. */
function staged(view: GameView): Frame {
  const t = new StageTimeline()
  t.observe(view, NOW - SETTLED)
  t.observe(view, NOW)
  const box = { columns: 120, rows: t.rowsAt(view, NOW) }
  return composeFrame(stageAt(view, t, NOW, box, { compact: false, motion: 'full' }), {
    numbers: false,
  })
}

export function contact(target: ContactTarget, opts: { out: string; native: string }): string[] {
  const label = target.kind === 'zone' ? `zone-${target.zone}` : target.kind
  const folder = join(opts.out, label)
  rmSync(folder, { recursive: true, force: true })
  mkdirSync(folder, { recursive: true })
  const written: string[] = []
  const put = (name: string, img: Rgba) => {
    const path = join(folder, `${name}.png`)
    writePng(path, img)
    written.push(path)
  }
  const shipped = (id: string, palette?: readonly number[], suffix = '') => {
    const s = sprite(id)
    const [kind, name] = id.split(':') as [string, string]
    put(`${kind}-${name}${suffix}`, scaled(rgbaOf(artFrame(s.full, palette ?? s.full.palette)), 6))
  }
  const nativeOf = (id: string) => {
    const [kind, name] = id.split(':') as [string, string]
    const path = join(opts.native, kind, `${name}.png`)
    if (existsSync(path)) put(`native-${kind}-${name}`, scaled(readPng(path), 4))
  }
  const both = (id: string) => {
    shipped(id)
    nativeOf(id)
  }

  switch (target.kind) {
    case 'zone': {
      const zone = content.zones[target.zone - 1]
      if (!zone) throw new Error(`no zone ${target.zone}`)
      for (const def of [...zone.enemies, zone.boss, zone.turnBoss]) both(`enemy:${def}`)
      put(
        'stage-rest',
        scaled(rgbaOf(staged(inZone(wave(), target.zone, zone.enemies.slice(0, 3)))), 6),
      )
      put('stage-boss', scaled(rgbaOf(staged(inZone(boss(), target.zone, [zone.boss]))), 6))
      put('stage-turn', scaled(rgbaOf(staged(inZone(turnBoss(), target.zone, [zone.turnBoss]))), 6))
      break
    }
    case 'heroes': {
      const classes = [...new Set(Object.values(content.heroTemplates).map((h) => h.cls))]
      for (const cls of classes) {
        for (const kind of ['hero', 'hero_attack']) {
          const id = `${kind}:${cls}`
          both(id)
          const s = sprite(id)
          for (const [rarity, rgb] of Object.entries(RARITY_RGB)) {
            const palette = [...s.full.palette]
            if (s.raritySlot !== null) palette[s.raritySlot] = rgb
            shipped(id, palette, `-${rarity}`)
          }
        }
      }
      break
    }
    case 'items':
      for (const name of target.names) both(`item:${name}`)
      break
    case 'world-bosses':
      for (const id of Object.keys(SPRITES).filter((k) => k.startsWith('world_boss:'))) both(id)
      break
  }
  return written
}

function parseArgs(argv: string[]): { target: ContactTarget; out: string; native: string } {
  const flag = (name: string) => {
    const i = argv.indexOf(`--${name}`)
    return i >= 0 ? argv[i + 1] : undefined
  }
  const zone = flag('zone')
  const items = flag('items')
  const target: ContactTarget | null =
    zone !== undefined
      ? { kind: 'zone', zone: Number(zone) }
      : argv.includes('--heroes')
        ? { kind: 'heroes' }
        : items !== undefined
          ? { kind: 'items', names: items.split(',') }
          : argv.includes('--world-bosses')
            ? { kind: 'world-bosses' }
            : null
  if (!target) {
    throw new Error(
      'usage: tsx scripts/contact.ts --zone <n> | --heroes | --items <name,…> | --world-bosses [--out <dir>] [--native <dir>]',
    )
  }
  return {
    target,
    out: flag('out') ?? '.promptfall/contact',
    native: flag('native') ?? 'art/sheets/native',
  }
}

function main(): void {
  const { target, out, native } = parseArgs(process.argv.slice(2))
  for (const path of contact(target, { out, native })) console.log(path)
}

if (import.meta.url === `file://${process.argv[1]}`) main()
