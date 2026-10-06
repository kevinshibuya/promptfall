// Helpers for the pane tests: a window's lines as text, a build's windows by key.
import type { Span, Win } from '../../windows/kit'
import type { PaneBuild } from './types'

/** A span run as cells: ▶ or a space for the cursor, `@@` for a sprite, spaces for a gap. */
export function textOf(spans: readonly Span[]): string {
  return spans
    .map((s) => {
      if ('text' in s) return s.text
      if ('cursor' in s) return s.cursor ? '▶' : ' '
      if ('gap' in s) return ' '.repeat(s.gap)
      if ('art' in s) return '@@'
      return ''
    })
    .join('')
}

export function linesOf(w: Win | undefined): string[] {
  return (w?.lines ?? []).map((l) => textOf(l.spans).trimEnd())
}

export function win(b: PaneBuild, key: string): Win | undefined {
  return b.scene.windows.find((w) => w.key === key)
}
