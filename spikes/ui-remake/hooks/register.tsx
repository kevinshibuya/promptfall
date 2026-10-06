// UI remake spikes (docs/plans/2026-10-05-ui-remake-spikes.md). Throwaway: never shipped, never in CI.
// `claude --plugin-dir spikes/ui-remake`: the band shows the paint-over and hidden-hotkey probes;
// `/spike-ui` opens the pane with the sharpness runs, the focus ring and the click probe;
// `/spike-pane` opens the PR 2 pane probe: the hidden ring, the arrows, Escape, tiles, the Input.
import type { Register, Timer, UiBlitArgs, UiBlitResult } from 'claude-code'

const PANE = 'spike-ui'
const CELL_W = 8
const CELL_H = 16
const BLITS = 50
const FIELD = 0xff282828
const WHITE = 0xfff8f8f8

type Io = {
  now: () => Promise<number>
  after: (ms: number, fn: () => void) => Timer
  blit: (args: UiBlitArgs) => Promise<UiBlitResult>
  invalidate: () => void
}
let io: Io | null = null

const counts = { x: 0, y: 0, k: 0, r: 0, q: 0, click: 0 }
const focusLog: string[] = []
const pressLog: string[] = []

function b64(bytes: Uint8Array): string {
  let s = ''
  for (let i = 0; i < bytes.length; i += 8192)
    s += String.fromCharCode(...bytes.subarray(i, i + 8192))
  return btoa(s)
}

/** 8 × 16 test glyphs, '#' on. Rough stand-ins for a pixel font's strokes. */
const GLYPHS: Record<string, string[]> = {
  A: [
    '........',
    '........',
    '...##...',
    '..#..#..',
    '.#....#.',
    '.#....#.',
    '.#....#.',
    '.######.',
    '.#....#.',
    '.#....#.',
    '.#....#.',
    '.#....#.',
    '........',
    '........',
    '........',
    '........',
  ],
  g: [
    '........',
    '........',
    '........',
    '........',
    '........',
    '..####..',
    '.#....#.',
    '.#....#.',
    '.#....#.',
    '.#...##.',
    '..###.#.',
    '......#.',
    '.#....#.',
    '..####..',
    '........',
    '........',
  ],
  1: [
    '........',
    '........',
    '...#....',
    '..##....',
    '.#.#....',
    '...#....',
    '...#....',
    '...#....',
    '...#....',
    '...#....',
    '...#....',
    '.#####..',
    '........',
    '........',
    '........',
    '........',
  ],
}

/**
 * A window-like test picture `columns × rows` cells at `scale`: field, a 2 px rounded white
 * border, then per inner cell either a 1 px checker, 1 px vertical lines, or a test glyph.
 * `shift` alternates the pattern so a blit is a real change.
 */
function picture(columns: number, rows: number, scale: number, shift: number) {
  const w = columns * CELL_W
  const h = rows * CELL_H
  const out = new Uint8Array(w * scale * h * scale * 4)
  const at = (x: number, y: number): number => {
    const inBorder = x < 2 || y < 2 || x >= w - 2 || y >= h - 2
    const corner = (x < 3 || x >= w - 3) && (y < 3 || y >= h - 3)
    if (corner && (x === 0 || x === w - 1) && (y === 0 || y === h - 1)) return 0
    if (inBorder) return WHITE
    const cx = Math.floor(x / CELL_W)
    const cy = Math.floor(y / CELL_H)
    if (cx === 0 || cy === 0 || cx === columns - 1 || cy === rows - 1) return FIELD
    const third = Math.floor((cx * 3) / columns)
    const px = x % CELL_W
    const py = y % CELL_H
    if (third === 0) return (x + y + shift) % 2 === 0 ? WHITE : FIELD
    if (third === 1) return (x + shift) % 2 === 0 ? WHITE : FIELD
    const ch = ['A', 'g', '1'][(cx + cy + shift) % 3] ?? 'A'
    return GLYPHS[ch]?.[py]?.[px] === '#' ? WHITE : FIELD
  }
  const W = w * scale
  for (let y = 0; y < h * scale; y++) {
    for (let x = 0; x < W; x++) {
      const p = at(Math.floor(x / scale), Math.floor(y / scale))
      const i = (y * W + x) * 4
      out[i] = (p >>> 16) & 0xff
      out[i + 1] = (p >>> 8) & 0xff
      out[i + 2] = p & 0xff
      out[i + 3] = (p >>> 24) & 0xff
    }
  }
  return { bytes: out.length, source: { rgba: b64(out), width: W, height: h * scale } }
}

/** Raster cells for a box-drawn window `columns × rows`, field as bg. */
function rasterWindow(columns: number, rows: number): string {
  const words = new Uint32Array(columns * rows * 3)
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < columns; x++) {
      let ch = 0x20
      if (y === 0) ch = x === 0 ? 0x256d : x === columns - 1 ? 0x256e : 0x2500
      else if (y === rows - 1) ch = x === 0 ? 0x2570 : x === columns - 1 ? 0x256f : 0x2500
      else if (x === 0 || x === columns - 1) ch = 0x2502
      const w = (y * columns + x) * 3
      words[w] = ch
      words[w + 1] = 0xf8f8f8
      words[w + 2] = 0x282828
    }
  }
  return b64(new Uint8Array(words.buffer))
}

const BAND_PIC = picture(40, 5, 1, 0)
const BAND_CELLS = rasterWindow(40, 3)
const BAND_SVG = [
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 80" shape-rendering="crispEdges">',
  '<rect x="1" y="1" width="318" height="78" rx="3" fill="#282828" stroke="#f8f8f8" stroke-width="2"/>',
  '<text x="12" y="30" fill="#f8f8f8" font-family="monospace" font-size="14">svg window</text>',
  '</svg>',
].join('')

type Variant = { label: string; columns: number; rows: number; scale: number }
const VARIANTS: Variant[] = [
  { label: 'strip 120x5 scale 1', columns: 120, rows: 5, scale: 1 },
  { label: 'strip 120x5 scale 2', columns: 120, rows: 5, scale: 2 },
  { label: 'pane 120x24 scale 1', columns: 120, rows: 24, scale: 1 },
  { label: 'pane 120x24 scale 2', columns: 120, rows: 24, scale: 2 },
]
type RunResult = {
  bytes: number
  sent: number
  denies: number
  firstDeny: string
  meanMs: number
  done: boolean
}
const runs: RunResult[] = VARIANTS.map(() => ({
  bytes: 0,
  sent: 0,
  denies: 0,
  firstDeny: '',
  meanMs: 0,
  done: false,
}))
let current = 0
let running = false
/** The first source each variant renders with: always scale 1 (a source past 2 MiB may not render). */
const FIRST = VARIANTS.map((v) => picture(v.columns, v.rows, 1, 0).source)

const sleep = (ms: number) => new Promise<void>((resolve) => io?.after(ms, resolve))

async function runVariant(i: number): Promise<void> {
  const x = io
  const v = VARIANTS[i]
  const r = runs[i]
  if (!x || !v || !r || running) return
  running = true
  const a = picture(v.columns, v.rows, v.scale, 1)
  const b = picture(v.columns, v.rows, v.scale, 0)
  r.bytes = a.bytes
  let total = 0
  await sleep(300)
  for (let k = 0; k < BLITS; k++) {
    const t0 = await x.now()
    const res = await x.blit({
      requestId: PANE,
      key: `v${i}`,
      source: k % 2 === 0 ? a.source : b.source,
    })
    total += (await x.now()) - t0
    r.sent += 1
    if (res.deny !== undefined) {
      r.denies += 1
      if (!r.firstDeny) r.firstDeny = res.deny
    }
    await sleep(83)
  }
  // Leave the variant's own scale on screen for the eye.
  await x.blit({ requestId: PANE, key: `v${i}`, source: b.source })
  r.meanMs = total / BLITS
  r.done = true
  running = false
  x.invalidate()
}

export const register: Register = (on) => {
  on('session.start', async ($, e, next) => {
    io = {
      now: () => $.clock.now(),
      after: (ms, fn) => $.clock.after(ms, fn),
      blit: (args) => $.ui.blit(args),
      invalidate: () => $.ui.invalidate('ui.render'),
    }
    await $.command.register({ name: 'spike-ui', description: 'UI remake spike pane' })
    await $.command.register({ name: 'spike-pane', description: 'UI PR 2 pane spike' })
    return next(e)
  })

  on('command.run', { command: 'spike-ui' }, async ($) => {
    io = {
      now: () => $.clock.now(),
      after: (ms, fn) => $.clock.after(ms, fn),
      blit: (args) => $.ui.blit(args),
      invalidate: () => $.ui.invalidate('ui.render'),
    }
    await $.ui.open({ id: PANE, title: 'ui remake spike', focus: true, rows: 34 })
    return { text: 'Spike pane opened.' }
  })

  registerPaneSpike(on)

  on('ui.focus', { requestId: PANE }, async (_$, e, next) => {
    focusLog.push(`${e.element ?? '(engine stop)'} by ${e.origin.kind}`)
    if (focusLog.length > 4) focusLog.shift()
    return next(e)
  })

  on('ui.press', { plugin: 'ui-remake-spike' }, async (_$, e, next) => {
    pressLog.push(String(e.element))
    if (pressLog.length > 4) pressLog.shift()
    return next(e)
  })

  // The band: paint over a picture, and hotkeys on Buttons out of view.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const els = $.ui.resolve(e)
    const { Box, Text, Button } = els
    const bump = (k: keyof typeof counts) => () => {
      counts[k] += 1
      $.ui.invalidate('ui.render')
    }
    const tally = `x(over picture)=${counts.x} r(over raster)=${counts.r} y(zero-width)=${counts.y} k(past edge)=${counts.k}`
    const hidden = (
      <Box key="hidden" width={0} overflow="hidden">
        <Button key="hid-y" label="hidden" hotkey="y" plain onPress={bump('y')} />
      </Box>
    )
    const past = (
      <Box key="past" position="absolute" left={e.props.bodyColumns + 4} top={0}>
        <Button key="past-k" label="past" hotkey="k" plain onPress={bump('k')} />
      </Box>
    )
    const over = (key: string, hotkey: 'x' | 'r', k: 'x' | 'r') => (
      <Box key={key} position="absolute" top={1} left={2} flexDirection="row">
        <Text>TEXT OVER </Text>
        <Button key={`${key}-b`} label="over" hotkey={hotkey} plain onPress={bump(k)} />
      </Box>
    )
    if (e.surface !== 'terminal') {
      if (!('Svg' in els)) return next(e)
      const { Svg } = els
      return (
        <Box key="band" flexDirection="column">
          <Box key="svg-wrap" flexDirection="column">
            <Svg key="svg" source={BAND_SVG} alt="svg window" width={320} height={80} />
            {over('svg-over', 'x', 'x')}
          </Box>
          <Box key="tally-row" flexDirection="row">
            <Text>{tally}</Text>
            {hidden}
          </Box>
          {past}
        </Box>
      )
    }
    if (!('Raster' in els)) return next(e)
    const { Image, Raster } = els
    return (
      <Box key="band" flexDirection="column">
        <Box key="img-wrap" flexDirection="row">
          <Image key="win" source={BAND_PIC.source} columns={40} rows={5} alt="IMAGE ALT" />
          {over('img-over', 'x', 'x')}
        </Box>
        <Box key="ras-wrap" flexDirection="row">
          <Raster key="ras" columns={40} rows={3} cells={BAND_CELLS} />
          {over('ras-over', 'r', 'r')}
        </Box>
        <Box key="tally-row" flexDirection="row">
          <Text>{tally}</Text>
          {hidden}
        </Box>
        {past}
      </Box>
    )
  })

  // The pane: sharpness and cost, the focus ring, clicks.
  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e, next) => {
    const els = $.ui.resolve(e)
    if (e.surface !== 'terminal' || !('Image' in els)) return next(e)
    const { Box, Text, Button, Image } = els
    const v = VARIANTS[current] as Variant
    const r = runs[current] as RunResult
    if (!r.done && !running) void runVariant(current)
    const stat = r.done
      ? `bytes ${r.bytes}  sent ${r.sent}  denies ${r.denies}  mean blit ${r.meanMs.toFixed(1)} ms${r.firstDeny ? `  deny: ${r.firstDeny}` : ''}`
      : 'running…'
    return (
      <Box key="pane" flexDirection="column">
        <Box key="ring" flexDirection="row">
          <Button key="alpha" label="alpha" onPress={() => undefined} />
          <Text> </Text>
          <Button key="beta" label="beta" onPress={() => undefined} />
          <Text> </Text>
          <Button
            key="space"
            label=" "
            hotkey="q"
            plain
            onPress={() => {
              counts.q += 1
              $.ui.invalidate('ui.render')
            }}
          />
          <Text> </Text>
          <Button
            key="next"
            label="next"
            hotkey="n"
            onPress={() => {
              current = (current + 1) % VARIANTS.length
              $.ui.invalidate('ui.render')
            }}
          />
        </Box>
        <Text key="focus">{`focus: ${focusLog.join(' | ') || '-'}  press: ${pressLog.join(' | ') || '-'}  q=${counts.q} click=${counts.click}`}</Text>
        <Box key="click-wrap" flexDirection="row">
          <Image
            key="clickpic"
            source={BAND_PIC.source}
            columns={20}
            rows={2}
            alt="click picture"
          />
          <Box key="click-over" position="absolute" top={0} left={4}>
            <Button
              key="click-b"
              label="click"
              plain
              onPress={() => {
                counts.click += 1
                $.ui.invalidate('ui.render')
              }}
            />
          </Box>
        </Box>
        <Text key="label">{`${v.label}: ${stat}`}</Text>
        <Image
          key={`v${current}`}
          source={FIRST[current] ?? BAND_PIC.source}
          columns={v.columns}
          rows={v.rows}
          alt={v.label}
        />
      </Box>
    )
  })
}

// The PR 2 pane spike (docs/plans/2026-10-06-ui-pr2-pane-windows.md, Task 1).
const PANE2 = 'spike-pane'
// The plan's sizes; the grid shrinks to the body it is given (a small cmux window seats ~9 rows).
const WIN_COLUMNS = 40
const WIN_ROWS = 6
const WIN_FIELD = 0xff303028
const WIN_FRAME = 0xfff0f0e8
const GAP_COLUMNS = 8
const GAP_ROWS = 4
const STOPS = ['s0', 's1', 's2', 's3', 's4', 's5', 's6', 's7']

/** A plain window rectangle: field with a 2 px frame. */
function plainWindow(columns: number, rows: number) {
  const w = columns * CELL_W
  const h = rows * CELL_H
  const out = new Uint8Array(w * h * 4)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = x < 2 || y < 2 || x >= w - 2 || y >= h - 2 ? WIN_FRAME : WIN_FIELD
      const i = (y * w + x) * 4
      out[i] = (p >>> 16) & 0xff
      out[i + 1] = (p >>> 8) & 0xff
      out[i + 2] = p & 0xff
      out[i + 3] = (p >>> 24) & 0xff
    }
  }
  return { rgba: b64(out), width: w, height: h }
}
type Size = { columns: number; rows: number; gapRows: number }
function gridSize(bodyColumns: number, bodyRows: number): Size {
  // Two rows for the log and the Input.
  const room = bodyRows - 2
  const rows = Math.max(2, Math.min(WIN_ROWS, Math.floor((room - 1) / 2)))
  return {
    columns: Math.min(WIN_COLUMNS, Math.floor(bodyColumns / 3)),
    rows,
    gapRows: Math.max(1, Math.min(GAP_ROWS, room - 2 * rows)),
  }
}
const plainCache = new Map<string, ReturnType<typeof plainWindow>>()
function plain(columns: number, rows: number) {
  const k = `${columns}x${rows}`
  const hit = plainCache.get(k)
  if (hit) return hit
  const made = plainWindow(columns, rows)
  plainCache.set(k, made)
  return made
}

// The tile tree: a row of three columns; the middle one holds the gap between its windows, so
// w4 sits 4 rows lower than w3 and w5. 120 × 16 cells.
function gridSvg(size: Size): string {
  const W = size.columns * CELL_W
  const H = size.rows * CELL_H
  const at: [number, number][] = [
    [0, 0],
    [0, H],
    [W, 0],
    [W, H + size.gapRows * CELL_H],
    [2 * W, 0],
    [2 * W, H],
  ]
  const rects = at.map(
    ([x, y]) =>
      `<rect x="${x + 1}" y="${y + 1}" width="${W - 2}" height="${H - 2}" fill="#303028" stroke="#f0f0e8" stroke-width="2"/>`,
  )
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${3 * W} ${2 * H + size.gapRows * CELL_H}" shape-rendering="crispEdges">${rects.join('')}</svg>`
}

const paneLog: string[] = []
const log = (line: string) => {
  paneLog.push(line)
  if (paneLog.length > 4) paneLog.shift()
}
let redirected = false
let refusedClose = false
let typed = ''

function registerPaneSpike(on: Parameters<Register>[0]): void {
  on('command.run', { command: 'spike-pane' }, async ($) => {
    redirected = false
    refusedClose = false
    paneLog.length = 0
    await $.ui.open({ id: PANE2, title: 'pane spike', focus: true, closeOnEscape: true, rows: 24 })
    return { text: 'Pane spike opened.' }
  })

  on('ui.focus', { requestId: PANE2 }, async ($, e, next) => {
    const origin = e.origin.kind === 'plugin' ? 'plugin' : 'person'
    log(`focus ${e.element ?? '(engine stop)'} by ${origin}`)
    $.ui.invalidate('ui.render')
    if (e.element === 's5' && !redirected) {
      redirected = true
      log('redirect s5 -> s6')
      return next({ ...e, element: 's6' })
    }
    return next(e)
  })

  on('ui.press', { requestId: PANE2 }, async ($, e, next) => {
    log(`press ${String(e.element)}`)
    $.ui.invalidate('ui.render')
    return next(e)
  })

  on('ui.close', { id: PANE2 }, async ($, e, next) => {
    if (e.origin.kind === 'person' && !refusedClose) {
      refusedClose = true
      log('close refused')
      $.ui.invalidate('ui.render')
      return { deny: 'spike: first person close refused' }
    }
    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE2 }, async ($, e, next) => {
    const els = $.ui.resolve(e)
    const { Box, Text, Button } = els
    const Input = 'Input' in els ? els.Input : undefined
    const terminal = e.surface === 'terminal'
    const size = terminal
      ? gridSize(e.props.bodyColumns, e.props.scroll.bodyRows)
      : { columns: WIN_COLUMNS, rows: WIN_ROWS, gapRows: GAP_ROWS }
    const onQ = () => {
      log('q pressed')
      $.ui.invalidate('ui.render')
      void $.ui.focus({ requestId: PANE2, key: 's1' }).then((r) => {
        log(`focus(s1) ${r.deny ?? 'ok'}`)
        $.ui.invalidate('ui.render')
      })
    }
    const hidden = (
      <Box
        key="ring"
        width={0}
        overflow="hidden"
        {...(terminal ? {} : { position: 'absolute' as const, top: 0, left: 0 })}
      >
        {STOPS.map((k) => (
          <Button
            key={k}
            label=" "
            plain
            {...(k === 's3' ? { autoFocus: true as const } : {})}
            onPress={() => undefined}
          />
        ))}
        <Button key="back" label=" " hotkey="q" plain onPress={onQ} />
      </Box>
    )
    let grid = null
    if (terminal && 'Image' in els) {
      const { Image } = els
      const win = (k: string) => (
        <Image
          key={k}
          source={plain(size.columns, size.rows)}
          columns={size.columns}
          rows={size.rows}
          alt={k}
        />
      )
      grid = (
        <Box key="grid" flexDirection="row">
          <Box key="c0" flexDirection="column">
            {win('w0')}
            {win('w1')}
          </Box>
          <Box key="c1" flexDirection="column">
            {win('w2')}
            <Box key="gap" width={GAP_COLUMNS} height={size.gapRows} />
            {win('w3')}
          </Box>
          <Box key="c2" flexDirection="column">
            {win('w4')}
            {win('w5')}
          </Box>
        </Box>
      )
    } else if (!terminal && 'Svg' in els) {
      const { Svg } = els
      grid = (
        <Svg
          key="grid"
          source={gridSvg(size)}
          alt="pane spike grid"
          width={3 * size.columns * CELL_W}
          height={(2 * size.rows + size.gapRows) * CELL_H}
        />
      )
    }
    if (!grid) return next(e)
    return (
      <Box key="pane" flexDirection="column">
        <Text key="log">{`${size.columns}x${size.rows} gap ${size.gapRows} | ${paneLog.join(' | ') || '-'}`}</Text>
        <Box key="top" flexDirection="row">
          {grid}
          {hidden}
        </Box>
        {Input && (
          <Input
            key="price"
            label="price"
            placeholder="gold"
            value={typed}
            submitLabel="list"
            onInput={(v: string) => {
              typed = v
            }}
            onSubmit={(v: string) => {
              log(`submit ${v}`)
              $.ui.invalidate('ui.render')
            }}
          />
        )}
      </Box>
    )
  })
}
