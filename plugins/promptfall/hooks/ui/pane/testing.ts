// Helpers for the pane tests: a window's lines as text, a build's windows by key.
import { decode } from '../../sprites/base64'
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

type Found = { props: Record<string, unknown> } | undefined
type Finder = { find: (query: { type: string }) => Promise<Found> }

/** What the mounted pane's picture says: the Raster's cells as text rows, else the Svg's alt. */
export async function paneText(ui: Finder): Promise<string> {
  const raster = await ui.find({ type: 'Raster' })
  if (raster) {
    const columns = Number(raster.props.columns)
    const bytes = decode(String(raster.props.cells))
    const words = new Uint32Array(bytes.buffer, bytes.byteOffset, bytes.length / 4)
    const rows: string[] = []
    for (let i = 0; i < words.length / 3; i += columns) {
      let row = ''
      for (let x = 0; x < columns; x++) row += String.fromCodePoint(words[(i + x) * 3] ?? 32)
      rows.push(row.trimEnd())
    }
    return rows.join('\n')
  }
  const svg = await ui.find({ type: 'Svg' })
  return String(svg?.props.alt ?? '')
}
