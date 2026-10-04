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

export function textWidth(text: string): number {
  return text.length === 0 ? 0 : text.length * GLYPH_ADVANCE - 1
}

/** Draws `text` with its top-left at (x, y), opaque, clipped to the frame. */
export function drawText(frame: Frame, text: string, x: number, y: number, rgb: number): void {
  for (let c = 0; c < text.length; c++) {
    const glyph = DIGITS[text[c] ?? '']
    if (!glyph) continue
    for (let gy = 0; gy < GLYPH_HEIGHT; gy++) {
      for (let gx = 0; gx < GLYPH_WIDTH; gx++) {
        if (glyph[gy]?.[gx] !== '#') continue
        const px = x + c * GLYPH_ADVANCE + gx
        const py = y + gy
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
