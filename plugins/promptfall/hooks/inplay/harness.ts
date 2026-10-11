// The in-play harness: a real engine over an in-memory store with a mock clock, the sandbox
// switch, and the band's mount props and strip reader. In-play tests live beside it in this folder.
import type { On } from 'claude-code'
import { mock, type TestBody } from 'claude-code/testing'
import type { GameView } from '../../types'
import { decode } from '../sprites/base64'
import { BOSS_WINDOW_MS } from '../vendor/protocol.js'
import { STRIP_ROWS } from '../windows/tuning'

export const RUN = {
  origin: { kind: 'composer' },
  presentation: { isFullscreen: false, columns: 120 },
} as const

export function harness(
  on: On,
  seed: Record<string, unknown> = {},
  env: Record<string, string> = {},
  now = 1_000_000,
) {
  // The machine plays in-process unless the seed names a server.
  const data = new Map<string, unknown>(Object.entries({ 'promptfall:server': 'local', ...seed }))
  const states = new Map<string, unknown>()
  const opened: { id: string; title?: string }[] = []
  const toasts: string[] = []
  on('store.get', (_$, e) => ({ value: data.get(e.key) }))
  on('store.set', (_$, e) => {
    data.set(e.key, JSON.parse(JSON.stringify(e.value)))
    return { value: undefined }
  })
  on('store.delete', (_$, e) => {
    data.delete(e.key)
    return { value: undefined }
  })
  on('store.keys', () => ({ value: [...data.keys()] }))
  on('state.set', async (_$, e, next) => {
    states.set(e.key, e.value)
    return next(e)
  })
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  // The sandbox switch reads the environment: unset unless a test turns the sandbox on.
  mock.env(on, env)
  on('ui.toast', (_$, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('ui.open', (_$, e) => {
    opened.push({ id: e.id, ...(e.title ? { title: e.title } : {}) })
    return { value: { isPlaced: true } }
  })
  const clock = mock.clock(on, { now })
  const view = () => states.get('view') as GameView
  return { data, states, opened, toasts, clock, view }
}

export const SANDBOX_ON = { PROMPTFALL_SANDBOX: '1' }
/** The sandbox runs the world boss grid: past the first grid window, so no grid boss engages the party. */
export const PAST_GRID_BOSS = BOSS_WINDOW_MS + 1_000_000

/** The harness with the sandbox on and the session started; `run` answers a sandbox verb's text. */
export async function sandboxOn(
  on: On,
  $: Parameters<TestBody>[0],
  seed: Record<string, unknown> = {},
) {
  const h = harness(on, seed, SANDBOX_ON, PAST_GRID_BOSS)
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  const run = async (args: string) =>
    (await $.command.run({ ...RUN, command: 'promptfall', args: `sandbox ${args}` })).text
  return { ...h, run }
}

type Found = { type?: string; props: Record<string, unknown>; children?: unknown[] }

/**
 * What the band's strip says, as text: the band Raster's strip rows (#61), or the strip Raster's
 * cells where the band is not one picture.
 */
export async function stripText(ui: {
  find: (q: { key: string }) => Promise<Found | undefined>
}): Promise<string> {
  const row = await ui.find({ key: 'row-band' })
  const band = ((row?.children ?? []) as Found[]).find((c) => c.type === 'Raster')
  const strip = band ?? (await ui.find({ key: 'strip' }))
  if (!strip) return ''
  const columns = Number(strip.props.columns)
  const bytes = decode(String(strip.props.cells))
  const words = new Uint32Array(bytes.buffer, bytes.byteOffset, bytes.length / 4)
  const lines: string[] = []
  for (let y = 0; y < words.length / 3 / columns; y++) {
    let line = ''
    for (let x = 0; x < columns; x++)
      line += String.fromCodePoint(words[(y * columns + x) * 3] ?? 32)
    lines.push(line)
  }
  return (band ? lines.slice(-STRIP_ROWS) : lines).join('\n')
}

/** The band's mount props: 30 rows by 150 columns above the prompt. */
export const BAND = {
  component: 'AbovePrompt',
  requestId: 'band-test',
  props: {
    hasSurvey: false,
    isWorking: false,
    maxRows: 30,
    bodyColumns: 150,
    scroll: { offset: 0, bodyRows: 30 },
    view: {},
  },
} as const
