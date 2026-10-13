import { expect, test } from 'claude-code/testing'
import type { DialogState, PaneCursor } from '../../../types'
import { SETTINGS_DEFAULT } from '../../state'
import { SIM_VERSION } from '../../vendor/sim.js'
import { CLIENT_VERSION } from '../../version'
import { tilePositions } from '../../windows/kit'
import { GAUGE_FULL_RGB } from '../../windows/tuning'
import { accountPane, type NoViewInput, noViewPane } from './account'
import { paneInput, paneView } from './fixtures'
import type { AccountInput, PaneInput } from './input'
import { linesOf, win } from './testing'

function input(
  dialog: Partial<DialogState> = {},
  patch: Partial<PaneInput> = {},
  account: Partial<AccountInput> = {},
): PaneInput {
  const base = paneInput({ tab: 'account', ...patch })
  return {
    ...base,
    dialog: { ...base.dialog, ...dialog },
    account: { ...base.account, leaseOwner: 's-1', ...account },
  }
}
const unlinked = () => ({ ...paneView(), account: { ...paneView().account, linked: null } })
const cursors = (b: ReturnType<typeof accountPane>) => b.stops.filter((s) => s.cursor)
const message = (b: ReturnType<typeof accountPane>) =>
  linesOf(win(b, 'message')).map((l) => l.trim())

test('the rows in order with their values; s and n gold; x not drawn', () => {
  const b = accountPane(input({}, { view: unlinked() }))
  const list = win(b, 'list')
  const lines = linesOf(list)
  expect(lines.map((l) => l.replace(/ {2,}/g, ' | '))).toEqual([
    '▶ Sound | quiet',
    ' | Motion | full',
    ' | Renderer | auto (image)',
    ' | Auto-vendor | off',
    ' | Band | shown',
    ' | Band off',
    ' | Link GitHub',
    " | Reset this machine's data",
    ' | Delete my account on this server',
  ])
  expect(lines[0]?.length).toBe(78)
  expect(list?.lines[0]?.spans).toContainEqual({ text: 'S', rgb: GAUGE_FULL_RGB })
  expect(list?.lines[1]?.spans).toContainEqual({ text: 'n', rgb: GAUGE_FULL_RGB })
  expect(list?.lines[2]?.spans.some((s) => 'rgb' in s && s.rgb === GAUGE_FULL_RGB)).toBe(false)
  expect(cursors(b).map((s) => [s.key, s.hotkey])).toEqual([
    ['row:sound', 's'],
    ['row:motion', 'n'],
    ['row:renderer', 'x'],
    ['row:autovendor', undefined],
    ['row:band', undefined],
    ['row:off', undefined],
    ['row:link', undefined],
    ['row:reset', undefined],
    ['row:delete', undefined],
  ])
})

test('the actions: settings, auto-vendor, the band, off, link, reset and delete opening their Yes/Nos on No', () => {
  const b = accountPane(input({}, { view: unlinked() }))
  expect(cursors(b).map((s) => s.action)).toEqual([
    { t: 'setting', patch: { sound: 'normal' } },
    { t: 'setting', patch: { motion: 'still' } },
    { t: 'setting', patch: { renderer: 'image' } },
    { t: 'event', event: { t: 'set_auto_vendor', on: true } },
    { t: 'band', collapsed: true },
    { t: 'off' },
    { t: 'link' },
    { t: 'open', menu: { kind: 'confirm', action: 'reset', id: '', at: 1 } },
    { t: 'open', menu: { kind: 'confirm', action: 'delete', id: '', at: 1 } },
  ])
  const forced = accountPane(
    input(
      {},
      {},
      {
        settings: { sound: 'loud', motion: 'still', renderer: 'raster', probed: null },
        collapsed: true,
      },
    ),
  )
  const lines = linesOf(win(forced, 'list'))
  expect(lines[2]?.endsWith('raster (from next start)')).toBe(true)
  expect(lines[4]?.endsWith('collapsed')).toBe(true)
  expect(cursors(forced)[2]?.action).toEqual({ t: 'setting', patch: { renderer: 'auto' } })
})

test('s cycles the sound off, quiet, normal, loud and back, the row showing the step', () => {
  const steps = ['off', 'quiet', 'normal', 'loud'] as const
  for (const [i, sound] of steps.entries()) {
    const b = accountPane(input({}, {}, { settings: { ...SETTINGS_DEFAULT, sound } }))
    expect(linesOf(win(b, 'list'))[0]?.endsWith(` ${sound}`)).toBe(true)
    const next = steps[(i + 1) % steps.length]
    expect(cursors(b)[0]?.action).toEqual({ t: 'setting', patch: { sound: next } })
  }
})

test('a session marked silent says so on the row, whole at 100 columns, and in the detail', () => {
  const b = accountPane(input({}, { columns: 100 }, { soundSilent: true }))
  const row = linesOf(win(b, 'list'))[0] ?? ''
  expect(row.replace(/ {2,}/g, ' | ')).toBe('▶ Sound | quiet, silent here')
  const detail = linesOf(win(b, 'detail'))
    .map((l) => l.trim())
    .join(' ')
  expect(detail).toContain(
    'This system has no audio player. Claude Code plays sound on macOS; the setting is kept.',
  )
  // The mark changes no step: s still cycles from the stored one.
  expect(cursors(b)[0]?.action).toEqual({ t: 'setting', patch: { sound: 'normal' } })
  // Off is off on any system: no note, no explanation.
  const off = accountPane(
    input(
      {},
      { columns: 100 },
      { soundSilent: true, settings: { ...SETTINGS_DEFAULT, sound: 'off' } },
    ),
  )
  expect(linesOf(win(off, 'list'))[0]?.trimEnd().endsWith(' off')).toBe(true)
  expect(linesOf(win(off, 'detail')).join(' ')).not.toContain('no audio player')
  // An unmarked session has neither.
  const unmarked = accountPane(input({}, { columns: 100 }))
  expect(linesOf(win(unmarked, 'list'))[0]).not.toContain('silent here')
  expect(linesOf(win(unmarked, 'detail')).join(' ')).not.toContain('no audio player')
})

test("Auto-vendor reads the account's setting and toggles it; read-only it shows and sends nothing", () => {
  const on = { ...paneView(), autoVendor: true }
  const row = (b: ReturnType<typeof accountPane>) =>
    cursors(b).find((s) => s.key === 'row:autovendor')
  const lines = (b: ReturnType<typeof accountPane>) =>
    linesOf(win(b, 'list')).map((l) => l.replace(/ {2,}/g, ' | ').trim())
  const b = accountPane(input({}, { view: on }))
  expect(lines(b)).toContain('| Auto-vendor | on')
  expect(row(b)?.action).toEqual({ t: 'event', event: { t: 'set_auto_vendor', on: false } })
  const secondary = accountPane(input({}, { view: on, readOnly: true, mode: 'secondary' }))
  expect(lines(secondary)).toContain('| Auto-vendor | on')
  expect(row(secondary)?.action).toEqual({ t: 'none' })
})

test('Link GitHub goes when linked, read-only, or while a code is pending', () => {
  const keys = (b: ReturnType<typeof accountPane>) => cursors(b).map((s) => s.key)
  expect(keys(accountPane(input()))).not.toContain('row:link')
  expect(keys(accountPane(input({}, { view: unlinked(), readOnly: true })))).not.toContain(
    'row:link',
  )
  const link = { code: 'ABCD1234', url: 'https://github.com/login/device' }
  const pending = accountPane(input({ link }, { view: unlinked() }))
  expect(keys(pending)).not.toContain('row:link')
  expect(pending.link).toEqual({ url: 'https://github.com/login/device' })
  expect(linesOf(win(pending, 'detail')).slice(-2)).toEqual([
    ' Enter ABCD1234 at',
    ' the link under this window.',
  ])
  expect(accountPane(input()).link).toBeNull()
})

test('read-only keeps the settings and Reset acting', () => {
  const b = accountPane(input({}, { readOnly: true, mode: 'secondary' }))
  expect(cursors(b)[0]?.action).toEqual({ t: 'setting', patch: { sound: 'normal' } })
  expect(cursors(b).at(-1)?.key).toBe('row:reset')
  const asking = accountPane(
    input({ menu: { kind: 'confirm', action: 'reset', id: '', at: 1 } }, { readOnly: true }),
  )
  expect(asking.focus).toBe('no')
})

test('the reset Yes/No: its question, Yes resets', () => {
  const b = accountPane(input({ menu: { kind: 'confirm', action: 'reset', id: '', at: 1 } }))
  expect(cursors(b).map((s) => [s.key, s.action])).toEqual([
    ['yes', { t: 'reset' }],
    ['no', { t: 'back' }],
  ])
  expect(b.focus).toBe('no')
  expect(message(b)).toEqual(["Reset this machine's data? The game starts over.", ''])
})

test('Delete goes read-only and on the sandbox save; its Yes/No asks first, Yes deletes', () => {
  const keys = (b: ReturnType<typeof accountPane>) => cursors(b).map((s) => s.key)
  const sandbox = { ...paneView(), account: { ...paneView().account, sandbox: true } }
  expect(keys(accountPane(input({}, { readOnly: true, mode: 'secondary' })))).not.toContain(
    'row:delete',
  )
  expect(keys(accountPane(input({}, { view: sandbox })))).not.toContain('row:delete')
  const asking = accountPane(input({ menu: { kind: 'confirm', action: 'delete', id: '', at: 1 } }))
  expect(cursors(asking).map((s) => [s.key, s.action])).toEqual([
    ['yes', { t: 'delete' }],
    ['no', { t: 'back' }],
  ])
  expect(asking.focus).toBe('no')
  expect(message(asking)).toEqual([
    'Delete your account on this server? It cannot be undone.',
    'Its listings and orders go with it; this machine starts over.',
  ])
  // Read-only, an open delete menu asks nothing.
  const readOnly = accountPane(
    input({ menu: { kind: 'confirm', action: 'delete', id: '', at: 1 } }, { readOnly: true }),
  )
  expect(keys(readOnly)).not.toContain('yes')
})

test('the detail lines and the message', () => {
  const b = accountPane(input())
  expect(linesOf(win(b, 'detail'))).toEqual([
    ' Account',
    ' Server in-process',
    ' Account a1',
    ` Client ${CLIENT_VERSION} · sim v${SIM_VERSION}`,
    ' Mode primary',
    ' Session s-1',
    ' Highest zone 1 · kills 0 · wipes 0',
    '',
    ' Linked as kevin',
  ])
  expect(linesOf(win(accountPane(input({}, { view: unlinked() })), 'detail')).at(-1)).toBe(
    ' Not linked.',
  )
  expect(message(b)).toEqual([
    'Enter: change it. Tab or arrows: move.',
    'Auto-vendor is kept per account, the rest per machine.',
  ])
})

const noView = (patch: Partial<NoViewInput> = {}): NoViewInput => {
  const { tab, dialog, mode, readOnly, notice, columns, rows } = paneInput({ tab: 'market' })
  return {
    tab,
    dialog,
    mode,
    readOnly,
    notice,
    columns,
    rows,
    server: 'in-process',
    hasGame: true,
    hasInput: true,
    ...patch,
  }
}

test('the no-view pane: one line on Market; on Account with a game, Reset, the server and the client', () => {
  const market = noViewPane(noView())
  expect(textTitle(market)).toBe('Market')
  expect(linesOf(win(market, 'list'))).toEqual(['  Promptfall has not started in this session.'])
  expect(market.stops.map((s) => s.key)).toEqual([
    'tab-inventory',
    'tab-heroes',
    'tab-market',
    'tab-orders',
    'tab-account',
    'tab-odds',
    'tab-journal',
    'tab-chat',
    'tab-leaderboards',
    'row:empty',
    'back',
  ])
  expect(linesOf(win(market, 'detail'))).toEqual([])
  expect(message(market)).toEqual(['Promptfall has not started in this session.', ''])
  const account = noViewPane(noView({ tab: 'account' }))
  expect(account.stops.filter((s) => s.cursor).map((s) => [s.key, s.action])).toEqual([
    ['row:reset', { t: 'open', menu: { kind: 'confirm', action: 'reset', id: '', at: 1 } }],
  ])
  expect(linesOf(win(account, 'detail'))).toEqual([
    ' Server in-process',
    ` Client ${CLIENT_VERSION} · sim v${SIM_VERSION}`,
  ])
  const asking = noViewPane(
    noView({
      tab: 'account',
      dialog: { ...paneInput().dialog, menu: { kind: 'confirm', action: 'reset', id: '', at: 0 } },
    }),
  )
  expect(asking.stops.find((s) => s.key === 'yes')?.action).toEqual({ t: 'reset' })
  // No game handle: Account too reads the one line.
  expect(linesOf(win(noViewPane(noView({ tab: 'account', hasGame: false })), 'list'))).toEqual([
    '  Promptfall has not started in this session.',
  ])
})

test("a ban's no-view pane follows the cursor to its Delete row, so the keys reach it", () => {
  const base = paneInput().dialog
  const at = (account: PaneCursor | null) =>
    noViewPane(
      noView({
        tab: 'account',
        banned: true,
        dialog: { ...base, cursor: { ...base.cursor, account } },
      }),
    )
  expect(at(null).focus).toBe('row:reset')
  expect(at({ id: 'delete', index: 1 }).focus).toBe('row:delete')
})

const textTitle = (b: ReturnType<typeof accountPane>) =>
  (win(b, 'list')?.title ?? []).map((s) => ('text' in s ? s.text : '')).join('')

test('wide and narrow pass tilePositions', () => {
  for (const columns of [120, 60]) {
    for (const b of [
      accountPane(input({}, { columns })),
      accountPane(
        input({ menu: { kind: 'confirm', action: 'reset', id: '', at: 1 } }, { columns }),
      ),
      noViewPane(noView({ columns, tab: 'account' })),
    ]) {
      const pos = tilePositions(b.scene)
      for (const w of b.scene.windows)
        expect([w.key, pos.get(w.key)]).toEqual([w.key, { x: w.x, y: w.y ?? 0 }])
    }
  }
})
