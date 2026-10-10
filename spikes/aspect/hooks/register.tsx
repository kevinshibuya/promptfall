// Spec #45's experiment. Throwaway: never shipped, never in CI.
// `claude --plugin-dir spikes/aspect`, then `/aspect` opens the pane. Each picture sits in a
// cell box ruled by `#` rows above and below and `|` columns beside it: a stretched picture
// meets the rulers on all four sides, a fitted one leaves terminal background inside them.
import type { Register } from 'claude-code'

const PANE = 'aspect'

function b64(bytes: Uint8Array): string {
  let s = ''
  for (let i = 0; i < bytes.length; i += 8192) {
    s += String.fromCharCode(...bytes.subarray(i, i + 8192))
  }
  return btoa(s)
}

/** An opaque picture: a magenta frame, a white circle, a grid, and red, green, blue, yellow corners (TL, TR, BL, BR). */
function picture(width: number, height: number) {
  const out = new Uint8Array(width * height * 4)
  const r = Math.min(width, height) / 2 - 4
  const corner = Math.max(4, Math.round(Math.min(width, height) / 8))
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let p = 0x203040
      if (x % 20 === 0 || y % 20 === 0) p = 0x506070
      const dx = x - width / 2 + 0.5
      const dy = y - height / 2 + 0.5
      const d = Math.sqrt(dx * dx + dy * dy)
      if (Math.abs(d - r) < 1.5) p = 0xffffff
      if (x < 2 || y < 2 || x >= width - 2 || y >= height - 2) p = 0xff00ff
      const left = x < corner
      const right = x >= width - corner
      const top = y < corner
      const bottom = y >= height - corner
      if (top && left) p = 0xff0000
      if (top && right) p = 0x00ff00
      if (bottom && left) p = 0x0000ff
      if (bottom && right) p = 0xffff00
      const i = (y * width + x) * 4
      out[i] = (p >>> 16) & 0xff
      out[i + 1] = (p >>> 8) & 0xff
      out[i + 2] = p & 0xff
      out[i + 3] = 0xff
    }
  }
  return { rgba: b64(out), width, height }
}

type Case = {
  key: string
  label: string
  width: number
  height: number
  columns: number
  rows: number
}

const CASES: Case[] = [
  // A square picture in a wide box: stretch makes a wide ellipse, fit leaves columns beside it.
  {
    key: 'square',
    label: 'A: 120x120 px picture in a 40x5 cell box',
    width: 120,
    height: 120,
    columns: 40,
    rows: 5,
  },
  // A 12:1 picture in a near-square box: stretch makes a tall ellipse, fit leaves rows above or below.
  {
    key: 'wide',
    label: 'B: 480x40 px picture in a 20x10 cell box',
    width: 480,
    height: 40,
    columns: 20,
    rows: 10,
  },
  // The band's own ratio, 8x16 px a cell: any residue here is the terminal's cell aspect, not 1:2.
  {
    key: 'band',
    label: 'C: 640x176 px picture (8x16 px a cell) in an 80x11 cell box',
    width: 640,
    height: 176,
    columns: 80,
    rows: 11,
  },
]
const CASED = CASES.map((c) => ({ ...c, source: picture(c.width, c.height) }))

let blit = 'pending'

export const register: Register = (on) => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'aspect',
      description: 'Spec #45 experiment: Image stretch or fit',
    })
    return next(e)
  })

  on('command.run', { command: 'aspect' }, async ($) => {
    await $.ui.open({ id: PANE, title: 'aspect spike', focus: true })
    return { text: 'Aspect pane opened.' }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e, next) => {
    if (e.surface !== 'terminal') return next(e)
    const els = $.ui.resolve(e)
    if (!('Image' in els)) return next(e)
    const { Box, Text, Image } = els
    // One blit after the first render says whether the engine draws Images here, and why not.
    if (blit === 'pending') {
      blit = 'sent'
      const requestId = e.requestId
      const source = CASED[0]?.source
      $.clock.after(500, () => {
        void (async () => {
          if (!source) return
          const r = await $.ui.blit({ requestId, key: 'square', source }).then(
            (x) => (x.deny ? `deny: ${x.deny}` : 'drawn (no deny)'),
            (error: unknown) => `threw: ${String(error)}`,
          )
          blit = r
          $.ui.invalidate('ui.render')
        })()
      })
    }
    return (
      <Box flexDirection="column">
        <Text>{`blit: ${blit}`}</Text>
        {CASED.map((c) => (
          <Box key={`case-${c.key}`} flexDirection="column">
            <Text>{c.label}</Text>
            <Text>{` ${'#'.repeat(c.columns)} `}</Text>
            <Box flexDirection="row">
              <Box flexDirection="column">
                {Array.from({ length: c.rows }, (_, r) => (
                  <Text key={`l${r}`}>|</Text>
                ))}
              </Box>
              <Image
                key={c.key}
                source={c.source}
                columns={c.columns}
                rows={c.rows}
                alt={c.label}
              />
              <Box flexDirection="column">
                {Array.from({ length: c.rows }, (_, r) => (
                  <Text key={`r${r}`}>|</Text>
                ))}
              </Box>
            </Box>
            <Text>{` ${'#'.repeat(c.columns)} `}</Text>
          </Box>
        ))}
      </Box>
    )
  })
}
