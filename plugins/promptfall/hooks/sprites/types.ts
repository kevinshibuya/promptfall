export type SpriteArt = {
  width: number
  height: number
  /** 0x00RRGGBB per index; index 0 is transparent and never has a colour */
  palette: readonly number[]
  /** base64 of width * height bytes, row-major palette indices */
  pixels: string
}

export type SpriteKind = 'hero' | 'hero_attack' | 'enemy' | 'world_boss' | 'item'

export type Sprite = {
  /** `${kind}:${key}`, e.g. 'hero:knight', 'enemy:road_slime'; or 'fallback' */
  id: string
  kind: SpriteKind
  style: 'nes' | 'snes'
  /** The palette index that takes the hero's rarity colour; heroes and hero attacks only, else null. */
  raritySlot: number | null
  /** 16 × 16 for every nes sprite (padded), up to 48 × 34 for snes: the full stage and the 16 px list sprite */
  full: SpriteArt
  /** At most 8 px tall, width scaled to keep the aspect: the compact stage */
  compact: SpriteArt
  /** Exactly 8 × 4, items only: half-block lists */
  small: SpriteArt | null
  /** True while the manifest aliases this id to a concept sheet sprite. */
  isPlaceholder: boolean
}
