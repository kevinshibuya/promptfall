// Phase 4 spikes (docs/plans/2026-10-04-phase-4-spikes.md). Throwaway: never shipped, never in CI.
// `claude --plugin-dir spikes/phase-4`, then `/spike` opens the pane.
import type { Register, Timer, UiBlitArgs, UiBlitResult } from 'claude-code'

const PANE = 'spike'
const FRAME_MS = 83
const RUN_MS = 5_000
const PROBE_MS = 300
const SCALES = [1, 2, 4, 6] as const
const CHECK_W = 120
const CHECK_H = 16
const RASTER_COLUMNS = 100
const RASTER_ROWS = 8
const CLEAR = 0x01000000

type Io = {
  now: () => Promise<number>
  after: (ms: number, fn: () => void) => Timer
  blit: (args: UiBlitArgs) => Promise<UiBlitResult>
  invalidate: () => void
}

type Run = {
  label: string
  sent: number
  denies: number
  firstDeny: string
  totalMs: number
  done: boolean
}

const results = {
  probe: [] as string[],
  nothing: '',
  scales: SCALES.map(
    (s): Run => ({
      label: `scale ${s}`,
      sent: 0,
      denies: 0,
      firstDeny: '',
      totalMs: 0,
      done: false,
    }),
  ),
  raster: { label: 'raster', sent: 0, denies: 0, firstDeny: '', totalMs: 0, done: false } as Run,
  redraws: 0,
}
let io: Io | null = null
let started = false

function b64(bytes: Uint8Array): string {
  let s = ''
  for (let i = 0; i < bytes.length; i += 8192) {
    s += String.fromCharCode(...bytes.subarray(i, i + 8192))
  }
  return btoa(s)
}

function rgba(width: number, height: number, pixel: (x: number, y: number) => number): string {
  const out = new Uint8Array(width * height * 4)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const p = pixel(x, y) // 0xAARRGGBB
      const i = (y * width + x) * 4
      out[i] = (p >>> 16) & 0xff
      out[i + 1] = (p >>> 8) & 0xff
      out[i + 2] = p & 0xff
      out[i + 3] = (p >>> 24) & 0xff
    }
  }
  return b64(out)
}

const PROBE_A = { rgba: rgba(1, 1, () => 0x00000000), width: 1, height: 1 }
const PROBE_B = { rgba: rgba(1, 1, () => 0x01000000), width: 1, height: 1 }

/** The 120 × 16 checker with 2 px squares, shifted `shift` squares, upscaled nearest-neighbour by `scale`. */
function checker(scale: number, shift: number) {
  const width = CHECK_W * scale
  const height = CHECK_H * scale
  const src = rgba(width, height, (x, y) => {
    const cx = Math.floor(x / scale / 2) + shift
    const cy = Math.floor(y / scale / 2)
    return (cx + cy) % 2 === 0 ? 0xff2038c0 : 0xfff0d040
  })
  return { rgba: src, width, height }
}

/** 16 × 16, 4 px squares; the dark squares are alpha 0. */
const ALPHA_CHECK = {
  rgba: rgba(16, 16, (x, y) =>
    (Math.floor(x / 4) + Math.floor(y / 4)) % 2 === 0 ? 0xffe04040 : 0x00000000,
  ),
  width: 16,
  height: 16,
}

const RASTER_COLOURS = [0xc84c0c, 0x2038c0, 0xf0d040, 0x3fbf5f, 0xd040d0, 0xffffff, 0x000000, CLEAR]

function randomCells(): string {
  const words = new Uint32Array(RASTER_COLUMNS * RASTER_ROWS * 3)
  for (let i = 0; i < RASTER_COLUMNS * RASTER_ROWS; i++) {
    words[i * 3] = Math.random() < 0.5 ? 0x2580 : 0x2584
    words[i * 3 + 1] = RASTER_COLOURS[Math.floor(Math.random() * 7)] ?? 0
    words[i * 3 + 2] = RASTER_COLOURS[Math.floor(Math.random() * RASTER_COLOURS.length)] ?? CLEAR
  }
  return b64(new Uint8Array(words.buffer))
}

const INITIAL_CELLS = randomCells()
const INITIAL_CHECKS = SCALES.map((s) => checker(s, 0))

const SVG = [
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 40" width="480" height="160">',
  '<rect x="0" y="0" width="120" height="40" fill="#202030"/>',
  '<rect x="10" y="12" width="16" height="16" fill="#f0d040">',
  '<animateTransform attributeName="transform" type="translate" values="0 0; 30 0; 0 0" dur="1s" repeatCount="indefinite"/>',
  '</rect>',
  '<rect x="80" y="12" width="16" height="16" fill="#d040d0">',
  '<animate attributeName="opacity" values="1; 0; 1" dur="1.5s" repeatCount="indefinite"/>',
  '</rect>',
  '</svg>',
].join('')

const sleep = (ms: number) => new Promise<void>((resolve) => io?.after(ms, resolve))

async function timed(run: Run, blit: () => Promise<{ deny?: string }>): Promise<void> {
  const x = io
  if (!x) return
  const t0 = await x.now()
  const r = await blit()
  const t1 = await x.now()
  run.sent += 1
  run.totalMs += t1 - t0
  if (r.deny !== undefined) {
    run.denies += 1
    if (run.firstDeny === '') run.firstDeny = r.deny
  }
}

async function runAll(): Promise<void> {
  const x = io
  if (!x) return
  await sleep(PROBE_MS)
  for (let i = 0; i < 3; i++) {
    const r = await x.blit({
      requestId: PANE,
      key: 'probe',
      source: i % 2 === 0 ? PROBE_B : PROBE_A,
    })
    results.probe.push(r.deny === undefined ? 'image' : r.deny)
    x.invalidate()
    await sleep(PROBE_MS)
  }
  const n = await x.blit({ requestId: PANE, key: 'nothing', source: PROBE_B })
  results.nothing = n.deny === undefined ? '{}' : n.deny
  x.invalidate()

  for (const [i, scale] of SCALES.entries()) {
    const run = results.scales[i]
    if (!run) continue
    const frames = [checker(scale, 1), checker(scale, 0)]
    const t0 = await x.now()
    for (let k = 0; (await x.now()) - t0 < RUN_MS; k++) {
      await timed(run, () =>
        x.blit({ requestId: PANE, key: `scale${scale}`, source: frames[k % 2] ?? PROBE_A }),
      )
      await sleep(FRAME_MS)
    }
    run.done = true
    x.invalidate()
  }

  const t0 = await x.now()
  while ((await x.now()) - t0 < RUN_MS) {
    await timed(results.raster, () =>
      x.blit({ requestId: PANE, key: 'raster', cells: randomCells() }),
    )
    await sleep(FRAME_MS)
  }
  results.raster.done = true
  x.invalidate()
}

function line(run: Run): string {
  const mean = run.sent === 0 ? 0 : run.totalMs / run.sent
  const deny = run.firstDeny === '' ? '' : `  first deny: ${run.firstDeny}`
  return `${run.label}: ${run.done ? 'done' : 'running'}  sent ${run.sent}  denies ${run.denies}  mean blit ${mean.toFixed(1)} ms${deny}`
}

export const register: Register = (on) => {
  on('session.start', async ($, e, next) => {
    io = {
      now: () => $.clock.now(),
      after: (ms, fn) => $.clock.after(ms, fn),
      blit: (args) => $.ui.blit(args),
      invalidate: () => $.ui.invalidate('ui.render'),
    }
    await $.command.register({
      name: 'spike',
      description: 'Phase 4 spike: Image probe, scaling, Raster, SMIL',
    })
    return next(e)
  })

  on('command.run', { command: 'spike' }, async ($) => {
    io = {
      now: () => $.clock.now(),
      after: (ms, fn) => $.clock.after(ms, fn),
      blit: (args) => $.ui.blit(args),
      invalidate: () => $.ui.invalidate('ui.render'),
    }
    started = false
    results.probe = []
    results.nothing = ''
    for (const r of [...results.scales, results.raster])
      Object.assign(r, { sent: 0, denies: 0, firstDeny: '', totalMs: 0, done: false })
    await $.ui.open({ id: PANE, title: 'phase 4 spike', focus: true })
    return { text: 'Spike pane opened.' }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e, next) => {
    if (e.surface !== 'terminal') {
      const els = $.ui.resolve(e)
      if (!('Svg' in els)) return next(e)
      const { Box, Text, Button, Svg } = els
      return (
        <Box flexDirection="column">
          <Text>SMIL: watch the squares (left one slides, right one fades)</Text>
          <Svg
            source={SVG}
            alt="two squares, one sliding, one fading"
            width={480}
            height={160}
            isInteractive
          />
          <Text dimColor>
            redraws: {String(results.redraws)} (the source is byte-identical each time)
          </Text>
          <Button
            label="redraw"
            onPress={() => {
              results.redraws += 1
              $.ui.invalidate('ui.render')
            }}
          />
        </Box>
      )
    }

    const els = $.ui.resolve(e)
    if (!('Raster' in els)) return next(e)
    const { Box, Text, Image, Raster } = els
    if (!started) {
      started = true
      void runAll()
    }
    return (
      <Box flexDirection="column">
        <Box flexDirection="row">
          <Image key="probe" source={PROBE_A} columns={1} rows={1} alt=" " />
          <Text>
            {' '}
            probe: {results.probe.length === 0 ? 'pending' : results.probe.join('  |  ')}
          </Text>
        </Box>
        <Text>
          blit to an unmounted key: {results.nothing === '' ? 'pending' : results.nothing}
        </Text>
        {SCALES.map((_, i) => (
          <Text>{line(results.scales[i] as Run)}</Text>
        ))}
        <Text>{line(results.raster)}</Text>
        {[...SCALES.entries()].reverse().map(([i, scale]) => (
          <Box flexDirection="column">
            <Text>scale {String(scale)}</Text>
            <Image
              key={`scale${scale}`}
              source={INITIAL_CHECKS[i] ?? PROBE_A}
              columns={CHECK_W}
              rows={CHECK_H / 2}
              alt={`checker at scale ${scale}`}
            />
          </Box>
        ))}
        <Box flexDirection="row">
          <Image key="alpha" source={ALPHA_CHECK} columns={2} rows={1} alt="a" />
          <Text> alpha: the gaps in the red squares should show the terminal background</Text>
        </Box>
        <Raster key="raster" columns={RASTER_COLUMNS} rows={RASTER_ROWS} cells={INITIAL_CELLS} />
      </Box>
    )
  })
}
