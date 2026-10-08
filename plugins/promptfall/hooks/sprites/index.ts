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
 * The zone's stage backdrop at `scale` (the 1x painting, or its 1.5x twin), or null when the zone
 * has none: the stage then draws the ground strip alone.
 */
export function backdropFor(zone: number, scale: 1 | 1.5): SpriteArt | null {
  const b = BACKDROPS[String(zone)]
  if (!b) return null
  return scale === 1 ? b.full : b.hires
}

/** width * height palette indices, row-major. */
export function decodePixels(art: SpriteArt): Uint8Array {
  return decode(art.pixels)
}
