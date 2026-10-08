import type { Frame } from './compose'

export const GLYPH_WIDTH = 3
export const GLYPH_HEIGHT = 5
/** Advance per glyph: the glyph and a 1 px gap. */
export const GLYPH_ADVANCE = 4

/** A 3 × 5 pixel font for '0'-'9' and '-', rows top to bottom. */
export const DIGITS: Readonly<Record<string, readonly string[]>> = {
  '0': ['###', '#.#', '#.#', '#.#', '###'],
  '1': ['.#.', '##.', '.#.', '.#.', '###'],
  '2': ['###', '..#', '###', '#..', '###'],
  '3': ['###', '..#', '.##', '..#', '###'],
  '4': ['#.#', '#.#', '###', '..#', '..#'],
  '5': ['###', '#..', '###', '..#', '###'],
  '6': ['###', '#..', '###', '#.#', '###'],
  '7': ['###', '..#', '.#.', '.#.', '.#.'],
  '8': ['###', '#.#', '###', '#.#', '###'],
  '9': ['###', '#.#', '###', '..#', '###'],
  '-': ['...', '...', '###', '...', '...'],
}

/** The glyph pixel's size in stage pixels: 2 × 2 blocks on the 1.5x stage, 1 at scale 1. */
export function glyphBlock(scale: number): number {
  return scale === 1 ? 1 : 2
}

export function textWidth(text: string, block = 1): number {
  return text.length === 0 ? 0 : (text.length * GLYPH_ADVANCE - 1) * block
}

/** The one-pixel outline under a damage number, so white reads on a pale backdrop (zone 12). */
export const TEXT_OUTLINE_RGB = 0x000000

/**
 * `drawText` over a one-stage-pixel outline in `TEXT_OUTLINE_RGB`: the text drawn at the eight
 * neighbouring offsets first, then in its colour on top.
 */
export function drawOutlinedText(
  frame: Frame,
  text: string,
  x: number,
  y: number,
  rgb: number,
  block = 1,
): void {
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (dx !== 0 || dy !== 0) drawText(frame, text, x + dx, y + dy, TEXT_OUTLINE_RGB, block)
    }
  }
  drawText(frame, text, x, y, rgb, block)
}

/** Draws `text` with its top-left at (x, y), opaque, clipped to the frame; each glyph pixel a `block` square. */
export function drawText(
  frame: Frame,
  text: string,
  x: number,
  y: number,
  rgb: number,
  block = 1,
): void {
  for (let c = 0; c < text.length; c++) {
    const glyph = DIGITS[text[c] ?? '']
    if (!glyph) continue
    for (let gy = 0; gy < GLYPH_HEIGHT; gy++) {
      for (let gx = 0; gx < GLYPH_WIDTH; gx++) {
        if (glyph[gy]?.[gx] !== '#') continue
        for (let by = 0; by < block; by++) {
          for (let bx = 0; bx < block; bx++) {
            const px = x + (c * GLYPH_ADVANCE + gx) * block + bx
            const py = y + gy * block + by
            if (px < 0 || py < 0 || px >= frame.width || py >= frame.height) continue
            const i = (py * frame.width + px) * 4
            frame.rgba[i] = (rgb >> 16) & 0xff
            frame.rgba[i + 1] = (rgb >> 8) & 0xff
            frame.rgba[i + 2] = rgb & 0xff
            frame.rgba[i + 3] = 255
          }
        }
      }
    }
  }
}
