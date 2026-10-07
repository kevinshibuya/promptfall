import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { blank, parseHex, type Rgba, readPng } from './png'
import {
  type BuildInput,
  buildSprites,
  downsample,
  emitModule,
  hiresMasterPaths,
  type Indexed,
  type Manifest,
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

/** In-memory PNGs by path, checked before the fixtures. */
const MEM = new Map<string, Rgba>()

function image(width: number, height: number, colour: (x: number, y: number) => number | null) {
  const img = blank(width, height)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const c = colour(x, y)
      if (c === null) continue
      img.data.set([(c >> 16) & 0xff, (c >> 8) & 0xff, c & 0xff, 255], (y * width + x) * 4)
    }
  }
  return img
}

function build(sprites: ManifestEntry[], expected = sprites.map((s) => s.id)) {
  const input: BuildInput = {
    manifest: { palettes: { nes: '', snes: '' }, sprites },
    palettes: { nes: NES, snes: SNES, hires: SNES },
    load: (path) => {
      const mem = MEM.get(path)
      if (mem) return mem
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

  describe('the hires variant', () => {
    const solid = (w: number, h: number, c = 0xc84c0c) => image(w, h, () => c)
    MEM.set('hi/24.png', solid(24, 24))
    MEM.set('hi/30.png', solid(30, 30))
    MEM.set('hi/boss30.png', solid(40, 30))
    MEM.set(
      'hi/17.png',
      image(17, 4, (x) => SNES[x] ?? 0),
    )

    it('builds a 24 × 24 hires from a 24 × 24 fileHires', () => {
      const r = build([item('nes-4.png', { fileHires: 'hi/24.png' })])
      expect(r.errors).toEqual([])
      expect(r.art.get('nes-4')?.hires).toMatchObject({ width: 24, height: 24 })
    })

    it('fails a 17-colour fileHires', () => {
      const r = build([item('nes-4.png', { fileHires: 'hi/17.png' })])
      expect(r.errors).toEqual(['item:thing: hires 17 colours, the 1.5x art allows 16'])
    })

    it('shrinks a fileHires larger than the canvas to fit it', () => {
      const r = build([item('nes-4.png', { fileHires: 'hi/30.png' })])
      expect(r.errors).toEqual([])
      const hires = r.art.get('nes-4')?.hires
      expect(hires).toMatchObject({ width: 24, height: 24 })
      expect([...(hires?.idx ?? [])].every((v) => v !== 0)).toBe(true)
    })

    it("never grows a turn boss's fileHires to its 36-row fit", () => {
      const r = build([
        {
          id: 'enemy:boar',
          file: 'snes-48x34.png',
          fileHires: 'hi/boss30.png',
          style: 'snes',
          fit: { height: 24 },
        },
      ])
      expect(r.errors).toEqual([])
      expect(r.art.get('snes-48x34@h24')?.hires).toMatchObject({ width: 40, height: 30 })
    })

    it('fails a hero whose rarity slot lands in two separate regions after the snap', () => {
      const RED = 0xc84c0c
      const NEAR = 0xc84c0d // a different source colour that snaps to the same master entry
      const hero = (fileHires: string): ManifestEntry => ({
        id: 'hero:knight',
        file: 'nes-4.png',
        fileHires,
        style: 'nes',
        rarityColor: '#c84c0c',
        rarityColorHires: '#c84c0c',
      })
      const two = (b: number) => image(24, 24, (x) => (x < 4 ? RED : x > 19 ? b : 0xfcfcfc))
      MEM.set(
        'hi/one.png',
        image(24, 24, (x) => (x < 4 ? RED : 0xfcfcfc)),
      )
      MEM.set('hi/two.png', two(RED))
      MEM.set('hi/twonear.png', two(NEAR))
      const one = build([hero('hi/one.png')])
      expect(one.errors).toEqual([])
      const slot = one.sprites[0]?.raritySlotHires ?? -1
      expect(one.art.get('nes-4')?.hires.palette[slot]).toBe(RED)
      for (const path of ['hi/two.png', 'hi/twonear.png']) {
        expect(build([hero(path)]).errors).toEqual([
          'hero:knight: rarityColorHires is not one region',
        ])
      }
      expect(build([{ ...hero('hi/one.png'), rarityColorHires: undefined }]).errors).toEqual([
        'hero:knight: a hero with fileHires needs a rarityColorHires',
      ])
    })

    it('gives an entry without fileHires its full art at 1.5 times its size', () => {
      const r = build([
        item('nes-4.png'),
        { id: 'enemy:boar', file: 'snes-48x34.png', style: 'snes' },
        { id: 'hero:knight', file: 'nes-12x9.png', style: 'nes', rarityColor: '#c84c0c' },
      ])
      expect(r.errors).toEqual([])
      const v = r.art.get('nes-4')
      expect(v?.hires).toMatchObject({ width: 24, height: 24, palette: v?.full.palette })
      // Nearest neighbour: hires (i, j) reads full (floor(i / 1.5), floor(j / 1.5)).
      const full = v?.full
      const hires = v?.hires
      for (const [i, j] of [
        [0, 0],
        [5, 7],
        [23, 23],
      ] as const) {
        expect(hires?.idx[j * 24 + i]).toBe(
          full?.idx[Math.floor(j / 1.5) * 16 + Math.floor(i / 1.5)],
        )
      }
      expect(r.art.get('snes-48x34')?.hires).toMatchObject({ width: 72, height: 51 })
      const knight = r.sprites.find((s) => s.id === 'hero:knight')
      expect(knight?.raritySlotHires).toBe(knight?.raritySlot)
    })

    it('fails a fileHires when the manifest names no hires master', () => {
      const input: BuildInput = {
        manifest: {
          palettes: { nes: '', snes: '' },
          sprites: [item('hi/24.png', { fileHires: 'hi/24.png' })],
        },
        palettes: { nes: NES, snes: SNES, hires: [] },
        load: (path) => MEM.get(path) ?? null,
        expected: ['item:thing'],
      }
      expect(buildSprites(input).errors).toEqual(['item:thing: fileHires needs palettes.hires'])
    })

    it('derives the hires master from fileHires paths only, each once', () => {
      const manifest: Manifest = {
        palettes: { nes: '', snes: '' },
        sprites: [
          {
            id: 'enemy:a',
            file: 'sprites/enemy/a.png',
            fileHires: 'sprites-hires/enemy/a.png',
            style: 'nes',
          },
          { id: 'enemy:b', file: 'sprites/enemy/b.png', style: 'nes' },
          {
            id: 'enemy:c',
            file: 'sprites/enemy/a.png',
            fileHires: 'sprites-hires/enemy/a.png',
            style: 'nes',
          },
          {
            id: 'world_boss:d',
            file: 'sprites/world_boss/d.png',
            fileHires: 'sprites-hires/world_boss/d.png',
            style: 'snes',
          },
        ],
      }
      expect(hiresMasterPaths(manifest)).toEqual([
        'sprites-hires/enemy/a.png',
        'sprites-hires/world_boss/d.png',
      ])
    })

    it('emits hires and raritySlotHires, byte-identical across two runs', () => {
      const entries: ManifestEntry[] = [
        item('nes-12x9.png', { fileHires: 'hi/24.png' }),
        { id: 'hero:knight', alias: 'nes-4', style: 'nes', rarityColor: '#c84c0c' },
        { id: 'enemy:boar', file: 'snes-48x34.png', style: 'snes', fit: { height: 24 } },
      ]
      const a = emitModule(build(entries))
      expect(a).toBe(emitModule(build([...entries].reverse())))
      expect(a).toContain('hires: { width: 24, height: 24')
      expect(a).toMatch(/'hero:knight': \{[^\n]*raritySlotHires: \d+/)
    })
  })

  it('gives every file entry of the real manifest but the fallback a fileHires', () => {
    const manifest = JSON.parse(
      readFileSync(join(import.meta.dirname, '../art/manifest.json'), 'utf8'),
    ) as Manifest
    const missing = manifest.sprites.filter(
      (s) => s.file !== undefined && s.id !== 'fallback' && s.fileHires === undefined,
    )
    expect(missing.map((s) => s.id)).toEqual([])
    expect(manifest.palettes.hires).toBe('palettes/hires.json')
  })
})
