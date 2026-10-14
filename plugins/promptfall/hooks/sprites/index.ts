import { decode } from './base64'
import { BACKDROPS, SPRITES } from './generated'
import type { Sprite, SpriteArt, SpriteKind } from './types'

export { worldBossKey } from './keys'
export type { Sprite, SpriteArt, SpriteKind } from './types'

const FALLBACK = SPRITES.fallback as Sprite

/** The sprite for a content key; an unknown key answers the fallback crate, never throws. */
export function spriteFor(kind: SpriteKind, key: string): Sprite {
  return SPRITES[`${kind}:${key}`] ?? FALLBACK
}

/**
 * The zone's 1.5x stage backdrop, or null when the zone
 * has none: the stage then draws the ground strip alone.
 */
export function backdropFor(zone: number): SpriteArt | null {
  return BACKDROPS[String(zone)] ?? null
}

/** width * height palette indices, row-major. */
export function decodePixels(art: SpriteArt): Uint8Array {
  return decode(art.pixels)
}
