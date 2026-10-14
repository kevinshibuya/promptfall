// Helpers for the pane tests: a window's lines as text, a build's windows by key, the terminal's
// focus ring.
import { decode } from '../../sprites/base64'
import type { Span, Win } from '../../windows/kit'
import type { RefocusIo } from './mount'
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

/**
 * The terminal's focus ring as the CLI's debug log showed it (#191), which the kit does not keep:
 * `io.focus` moves it by key on the drawing mounted when the request lands and answers `{}`, and
 * `mount` (a drawing taking the screen) keeps it by position. `advance` runs the sends `io.after`
 * left, in the order they come due.
 */
export function cliRing() {
  let mounted: string[] = []
  let at = -1
  let now = 0
  const timers: { at: number; fn: () => void }[] = []
  const io: RefocusIo = {
    after: (ms, fn) => {
      timers.push({ at: now + ms, fn })
    },
    focus: async (key) => {
      const i = mounted.indexOf(key)
      if (i < 0) return { deny: `no element ${key} is drawn` }
      at = i
      return {}
    },
  }
  return {
    io,
    mount: (b: PaneBuild) => {
      // On a terminal the field's Input comes before the stops that follow it.
      mounted = [...(b.field ? [b.field.key] : []), ...b.stops.map((s) => s.key)]
    },
    /** The person's Tab or arrows onto `key`. */
    walk: (key: string) => {
      at = mounted.indexOf(key)
    },
    on: (): string | undefined => mounted[at],
    advance: async (ms: number) => {
      const end = now + ms
      for (;;) {
        timers.sort((a, b) => a.at - b.at)
        const t = timers[0]
        if (!t || t.at > end) break
        timers.shift()
        now = t.at
        t.fn()
        // The focus answer and its `.then`.
        await Promise.resolve()
        await Promise.resolve()
      }
      now = end
    },
  }
}
