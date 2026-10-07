import { expect, test } from 'claude-code/testing'
import { WORLD_BOSSES } from '../vendor/ledger.js'
import { content } from '../vendor/sim.js'
import { decode, encode } from './base64'
import { PLACEHOLDER_COUNT, SPRITE_COUNT, SPRITES } from './generated'
import { decodePixels, spriteFor, worldBossKey } from './index'
import type { SpriteArt } from './types'

const distinctColours = (art: SpriteArt) =>
  new Set([...decodePixels(art)].filter((v) => v !== 0)).size

test('base64 round-trips a known vector and an array past one chunk', () => {
  expect(encode(Uint8Array.of(0, 255, 16))).toBe('AP8Q')
  expect([...decode('AP8Q')]).toEqual([0, 255, 16])
  const big = new Uint8Array(20_000).map((_, i) => (i * 7) % 256)
  expect([...decode(encode(big))]).toEqual([...big])
})

test('every sprite decodes to width * height indices inside its palette', () => {
  for (const sprite of Object.values(SPRITES)) {
    for (const art of [sprite.full, sprite.compact, sprite.small]) {
      if (art === null) continue
      const px = decodePixels(art)
      expect(px.length).toBe(art.width * art.height)
      expect(Math.max(...px)).toBeLessThan(art.palette.length)
    }
    expect(sprite.compact.height).toBeLessThanOrEqual(8)
  }
})

test('enemies, bosses and items have the sizes the stage and lists need', () => {
  const slime = spriteFor('enemy', 'road_slime').full
  expect([slime.width, slime.height]).toEqual([16, 16])
  expect(distinctColours(slime)).toBeLessThanOrEqual(4)
  expect(spriteFor('world_boss', worldBossKey('The Promptwyrm')).full.height).toBeLessThanOrEqual(
    34,
  )
  // Zone 1's turn boss fits 24 px tall.
  expect(spriteFor('enemy', 'wild_boar').full.height).toBeLessThanOrEqual(24)
  for (const sprite of Object.values(SPRITES).filter((s) => s.kind === 'item')) {
    expect([sprite.small?.width, sprite.small?.height]).toEqual([8, 4])
  }
})

test('heroes carry a rarity slot inside their palette', () => {
  const knight = spriteFor('hero', 'knight')
  expect(knight.raritySlot).not.toBeNull()
  expect(knight.raritySlot ?? 0).toBeGreaterThan(0)
  expect(knight.raritySlot ?? 99).toBeLessThan(knight.full.palette.length)
})

test('an unknown key answers the fallback', () => {
  expect(spriteFor('enemy', 'no_such_enemy').id).toBe('fallback')
  expect(spriteFor('item', 'no_such_item').small).not.toBeNull()
  expect(worldBossKey('The Context Leviathan')).toBe('the_context_leviathan')
})

test('one sprite per content id, plus the fallback', () => {
  expect(SPRITE_COUNT).toBe(
    4 +
      4 +
      Object.keys(content.enemies).length +
      WORLD_BOSSES.length +
      Object.keys(content.itemBases).length +
      1,
  )
})

test('every sprite is real art: no placeholders left', () => {
  expect(PLACEHOLDER_COUNT).toBe(0)
  expect(
    Object.values(SPRITES)
      .filter((s) => s.isPlaceholder)
      .map((s) => s.id),
  ).toEqual([])
})
