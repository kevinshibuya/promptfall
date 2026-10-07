import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseHex, readPng } from './png'
import {
  type BuildInput,
  buildSprites,
  downsample,
  emitModule,
  type Indexed,
  type ManifestEntry,
  snesMasterPaths,
} from './sprites'

const FIXTURES = join(import.meta.dirname, 'fixtures')
const NES = (
  JSON.parse(
    readFileSync(join(import.meta.dirname, '../art/palettes/nes.json'), 'utf8'),
  ) as string[]
).map(parseHex)
const SNES = [...new Set(NES)]

function build(sprites: ManifestEntry[], expected = sprites.map((s) => s.id)) {
  const input: BuildInput = {
    manifest: { palettes: { nes: '', snes: '' }, sprites },
    palettes: { nes: NES, snes: SNES },
    load: (path) => {
      try {
        return readPng(join(FIXTURES, path))
      } catch {
        return null
      }
    },
    expected,
  }
  return buildSprites(input)
}

const item = (file: string, extra: Partial<ManifestEntry> = {}): ManifestEntry => ({
  id: 'item:thing',
  file,
  style: 'nes',
  ...extra,
})

describe('sprites build', () => {
  it('fails a 5-colour nes sprite, naming the stem and the count', () => {
    expect(build([item('nes-5.png')]).errors).toEqual(['nes-5: 5 colours, nes allows 4'])
  })

  it('passes a 4-colour nes sprite', () => {
    const r = build([item('nes-4.png')])
    expect(r.errors).toEqual([])
    expect(r.art.get('nes-4')?.full.palette).toHaveLength(5)
  })

  it('fails a 17-colour snes sprite', () => {
    const r = build([{ id: 'enemy:boss', file: 'snes-17.png', style: 'snes' }])
    expect(r.errors).toEqual(['snes-17: 17 colours, snes allows 16'])
  })

  it('pads a 12 × 9 nes sprite to 16 × 16, bottom-centred', () => {
    const full = build([item('nes-12x9.png')]).art.get('nes-12x9')?.full
    expect(full).toMatchObject({ width: 16, height: 16 })
    const opaque = (x: number, y: number) => (full?.idx[y * 16 + x] ?? 0) !== 0
    expect(opaque(2, 7)).toBe(true) // the top-left of the art at (2, 7)
    expect(opaque(13, 15)).toBe(true)
    expect(opaque(1, 15)).toBe(false)
    expect(opaque(14, 15)).toBe(false)
    expect(opaque(2, 6)).toBe(false)
  })

  it('fails a 17 × 16 nes sprite', () => {
    expect(build([item('nes-17x16.png')]).errors).toEqual([
      'nes-17x16: 17 x 16 exceeds the nes canvas of 16 x 16',
    ])
  })

  it('fit downsamples 48 × 34 to 24 tall, keeping the aspect', () => {
    const r = build([
      { id: 'enemy:boar', file: 'snes-48x34.png', style: 'snes', fit: { height: 24 } },
    ])
    expect(r.errors).toEqual([])
    expect(r.art.get('snes-48x34@h24')?.full).toMatchObject({ width: 34, height: 24 })
  })

  it('takes the most frequent opaque index per block, per axis', () => {
    // 4 × 4 → 2 × 1: each output pixel reads a 2 × 4 block.
    const art: Indexed = {
      width: 4,
      height: 4,
      palette: [0, 0x111111, 0x222222],
      idx: Uint8Array.of(1, 2, 0, 0, 2, 2, 0, 0, 1, 2, 0, 1, 0, 0, 0, 0),
    }
    const out = downsample(art, 2, 1)
    expect([...out.idx]).toEqual([2, 1])
    const empty = downsample({ ...art, idx: new Uint8Array(16) }, 2, 1)
    expect([...empty.idx]).toEqual([0, 0])
  })

  it('makes an 8 × 4 small sprite of a 16 × 16', () => {
    expect(build([item('nes-4.png')]).art.get('nes-4')?.small).toMatchObject({
      width: 8,
      height: 4,
    })
  })

  it('resolves rarityColor to its index, and fails a hero without it in its PNG', () => {
    const hero = (rarityColor: string): ManifestEntry => ({
      id: 'hero:knight',
      file: 'nes-4.png',
      style: 'nes',
      rarityColor,
    })
    const ok = build([hero('#c84c0c')])
    expect(ok.errors).toEqual([])
    const slot = ok.sprites[0]?.raritySlot ?? -1
    expect(ok.art.get('nes-4')?.full.palette[slot]).toBe(0xc84c0c)
    expect(build([hero('#00a800')]).errors).toEqual([
      'hero:knight: rarityColor #00a800 is not in its PNG',
    ])
  })

  it('fails a missing content id and an extra one', () => {
    const r = build([item('nes-4.png')], ['item:thing', 'item:other'])
    expect(r.errors).toEqual(['item:other: no manifest entry'])
    const extra = build(
      [item('nes-4.png'), item('nes-4.png', { id: 'item:extra' })],
      ['item:thing'],
    )
    expect(extra.errors).toEqual(['item:extra: not a content id'])
  })

  it('fails a duplicate id, an unknown style and a missing file', () => {
    const r = build([
      item('nes-4.png'),
      item('nes-4.png'),
      { id: 'enemy:a', file: 'nes-4.png', style: 'gba' },
      { id: 'enemy:b', file: 'nope.png', style: 'nes' },
    ])
    expect(r.errors).toEqual([
      'item:thing: duplicate id',
      'enemy:a: unknown style gba',
      'enemy:b: missing file art/nope.png',
    ])
  })

  it('emits a byte-identical module across two runs', () => {
    const entries: ManifestEntry[] = [
      item('nes-12x9.png'),
      { id: 'hero:knight', alias: 'nes-4', style: 'nes', rarityColor: '#c84c0c' },
      { id: 'enemy:boar', file: 'snes-48x34.png', style: 'snes', fit: { height: 24 } },
    ]
    const a = emitModule(build(entries))
    const b = emitModule(build([...entries].reverse()))
    expect(a).toBe(b)
    expect(a).toContain('export const SPRITE_COUNT = 3')
    expect(a).toContain('export const PLACEHOLDER_COUNT = 1')
    expect(a).not.toMatch(/^import /m)
  })

  it('derives the snes master from snes files only, each path once', () => {
    const sprites: ManifestEntry[] = [
      { id: 'enemy:captain', file: 'sprites/enemy/captain.png', style: 'snes' },
      { id: 'enemy:boar', alias: 'concept/snes-boss-0', style: 'snes' },
      { id: 'enemy:rat', file: 'sprites/enemy/rat.png', style: 'nes' },
      { id: 'world_boss:wyrm', file: 'sprites/enemy/captain.png', style: 'snes' },
      { id: 'world_boss:maw', file: 'sprites/world_boss/maw.png', style: 'snes' },
    ]
    expect(snesMasterPaths({ palettes: { nes: '', snes: '' }, sprites })).toEqual([
      'sprites/enemy/captain.png',
      'sprites/world_boss/maw.png',
    ])
  })
})
