import type { Elements, RenderSurface } from 'claude-code'
import type { Renderer } from '../../types'
import type { Sprite } from '../sprites/types'
import { artFrame } from '../stage/compose'
import { encodeImage } from '../stage/image'
import { encodeRaster } from '../stage/raster'
import { artSvg } from '../stage/svg'

type Els = Partial<Pick<Elements['terminal'], 'Raster' | 'Image'>> &
  Partial<Pick<Elements['desktop'], 'Svg'>>

/** List sprites are static: each encoding is made once per sprite and kept. */
const cache = new Map<string, string | { rgba: string; width: number; height: number }>()

function cached<T extends string | { rgba: string; width: number; height: number }>(
  key: string,
  make: () => T,
): T {
  let v = cache.get(key) as T | undefined
  if (v === undefined) {
    v = make()
    cache.set(key, v)
  }
  return v
}

/**
 * A sprite at the head of a dialog row: an Svg of the 16 px art off the terminal; on a terminal
 * an Image of it in 2 × 1 cells where pictures draw, or the 8 × 4 small art as a 8 × 2 Raster of
 * half-blocks (items only: a hero at 8 × 4 reads as nothing, so heroes keep their glyph there).
 * `key` names the Raster, which every tree needs unique.
 */
export function ListSprite(
  els: Els,
  renderer: Renderer,
  surface: RenderSurface,
  sprite: Sprite,
  alt: string,
  key: string,
) {
  if (surface !== 'terminal') {
    const { Svg } = els
    if (!Svg) return null
    const source = cached(`svg:${sprite.id}`, () => artSvg(sprite.full))
    return <Svg source={source} alt={alt} width={16} height={16} />
  }
  if (renderer === 'image' && els.Image) {
    const { Image } = els
    const source = cached(`image:${sprite.id}`, () => encodeImage(artFrame(sprite.full), 1))
    return <Image source={source} columns={2} rows={1} alt={alt} />
  }
  if (renderer === 'raster' && sprite.small && els.Raster) {
    const { Raster } = els
    const small = sprite.small
    const cells = cached(`raster:${sprite.id}`, () => encodeRaster(artFrame(small), []))
    return <Raster key={key} columns={8} rows={2} cells={cells} />
  }
  return null
}
