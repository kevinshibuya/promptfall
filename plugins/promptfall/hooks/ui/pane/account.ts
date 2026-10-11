// The Account tab as windows (docs/plans/2026-10-06-ui-pr3-remaining-tabs.md, "Account"): the
// settings and actions as rows, the machine and session facts in the detail window, the GitHub
// device-flow Link under the picture, the reset and delete Yes/Nos; and the pane with no game view.
import type { Settings } from '../../../types'
import { SIM_VERSION } from '../../vendor/sim.js'
import { CLIENT_VERSION } from '../../version'
import type { Line, Span } from '../../windows/kit'
import { MOVE_HELP } from '../../windows/tuning'
import { clip } from '../format'
import { cursorRow, hotkeySpans, TAB_LABELS } from './frame'
import type { FrameInput, PaneInput } from './input'
import { listInner, rowSpans } from './inventory'
import { type ListRow, type ListSpec, listPane } from './list'
import type { PaneAction, PaneBuild } from './types'

/** What `x` cycles the renderer setting through. */
export const RENDERER_NEXT: Record<Settings['renderer'], Settings['renderer']> = {
  auto: 'image',
  image: 'raster',
  raster: 'auto',
}

const VALUE_CELLS = 24
const RESET = "Reset this machine's data"
const RESET_QUESTION = "Reset this machine's data? The game starts over."
const NOT_STARTED = 'Promptfall has not started in this session.'
const RESET_ACTION: PaneAction = {
  t: 'open',
  menu: { kind: 'confirm', action: 'reset', id: '', at: 1 },
}
const DELETE = 'Delete my account on this server'
const DELETE_QUESTION = 'Delete your account on this server? It cannot be undone.'
const DELETE_DETAIL = 'Its listings and orders go with it; this machine starts over.'
const DELETE_ACTION: PaneAction = {
  t: 'open',
  menu: { kind: 'confirm', action: 'delete', id: '', at: 1 },
}

const text = (t: string, inner: number): Line => ({
  spans: [{ gap: 1 }, { text: clip(t, inner - 1) }],
})
const head = (t: string): Line => ({ spans: [{ gap: 1 }, { text: t }], rule: true })
const serverLine = (server: string) => `Server ${server}`
const clientLine = () => `Client ${CLIENT_VERSION} · sim v${SIM_VERSION}`

function setting(
  inner: number,
  id: string,
  label: Span[],
  value: string,
  action: PaneAction,
  hotkey?: string,
): ListRow {
  const alt = label.map((s) => ('text' in s ? s.text : '')).join('')
  return {
    key: `row:${id}`,
    ...(hotkey ? { hotkey } : {}),
    spans: rowSpans(inner, null, label, value ? [{ text: value, cells: VALUE_CELLS }] : []),
    action,
    alt: value ? `${alt}: ${value}` : alt,
  }
}

function accountDetail(input: PaneInput, inner: number): Line[] {
  const { view, account, dialog } = input
  const link = view.account.linked
    ? [text(`Linked as ${view.account.linked}`, inner)]
    : dialog.link
      ? [text(`Enter ${dialog.link.code} at`, inner), text('the link under this window.', inner)]
      : [text('Not linked.', inner)]
  return [
    head('Account'),
    text(serverLine(account.server), inner),
    text(`Account ${view.accountId}`, inner),
    text(clientLine(), inner),
    text(`Mode ${input.mode}`, inner),
    text(`Session ${account.leaseOwner ?? 'none'}`, inner),
    text(`Highest zone ${view.highestZone} · kills ${view.kills} · wipes ${view.wipes}`, inner),
    { spans: [] },
    ...link,
  ]
}

export function accountPane(input: PaneInput): PaneBuild {
  const { view, account, dialog } = input
  const { settings } = account
  const inner = listInner(input)
  const renderer =
    settings.renderer === 'auto'
      ? `auto (${account.renderer})`
      : `${settings.renderer} (from next start)`
  const rows: ListRow[] = [
    setting(
      inner,
      'sound',
      hotkeySpans('Sound', 's'),
      settings.sound ? 'on' : 'off',
      { t: 'setting', patch: { sound: !settings.sound } },
      's',
    ),
    setting(
      inner,
      'motion',
      hotkeySpans('Motion', 'n'),
      settings.motion,
      { t: 'setting', patch: { motion: settings.motion === 'full' ? 'still' : 'full' } },
      'n',
    ),
    setting(
      inner,
      'renderer',
      hotkeySpans('Renderer', 'x'),
      renderer,
      { t: 'setting', patch: { renderer: RENDERER_NEXT[settings.renderer] } },
      'x',
    ),
    setting(inner, 'band', [{ text: 'Band' }], account.collapsed ? 'collapsed' : 'shown', {
      t: 'band',
      collapsed: !account.collapsed,
    }),
    setting(inner, 'off', [{ text: 'Band off' }], '', { t: 'off' }),
  ]
  // The sandbox save never links.
  if (!view.account.linked && !view.account.sandbox && !dialog.link && !input.readOnly)
    rows.push(setting(inner, 'link', [{ text: 'Link GitHub' }], '', { t: 'link' }))
  rows.push(setting(inner, 'reset', [{ text: RESET }], '', RESET_ACTION))
  // The server's delete needs the lease; the sandbox save holds no account on a server. A ban
  // pauses play, but lets the delete through.
  const deleting = !view.account.sandbox && (!input.readOnly || input.banned === true)
  if (deleting) rows.push(setting(inner, 'delete', [{ text: DELETE }], '', DELETE_ACTION))

  const ids = rows.flatMap((r) => (r.key ? [r.key.slice(4)] : []))
  const cursor = cursorRow(dialog.cursor.account ?? null, ids)

  const spec: ListSpec = {
    title: [{ text: 'Account' }],
    altTitle: 'Account',
    rows,
    empty: '',
    cursor,
    detail: (w) => accountDetail(input, w),
    menu: null,
    yesNo: null,
    panel: null,
    error: null,
    state: [`Enter: change it. ${MOVE_HELP}`, 'Settings are kept per machine.'],
    field: null,
    link: !view.account.linked && dialog.link ? { url: dialog.link.url } : null,
  }
  // Reset works in read-only mode, as today.
  const menu = dialog.menu
  if (menu?.kind === 'confirm' && menu.action === 'reset') {
    spec.yesNo = { at: menu.at, yes: { t: 'reset' } }
    spec.state = [RESET_QUESTION, '']
  }
  if (deleting && menu?.kind === 'confirm' && menu.action === 'delete') {
    spec.yesNo = { at: menu.at, yes: { t: 'delete' } }
    spec.state = [DELETE_QUESTION, DELETE_DETAIL]
  }
  return listPane(input, spec)
}

export type NoViewInput = FrameInput & { server: string; hasGame: boolean; hasInput: boolean }

/**
 * The pane before a game view exists: one line, and on Account the server, the client and Reset,
 * and Delete when a ban refused the start.
 */
export function noViewPane(input: NoViewInput): PaneBuild {
  const label = TAB_LABELS.find((t) => t.tab === input.tab)?.label ?? input.tab
  const resetting = input.tab === 'account' && input.hasGame
  const deleting = resetting && input.banned === true
  const rows: ListRow[] = resetting
    ? [{ key: 'row:reset', spans: [{ text: RESET }], action: RESET_ACTION, alt: RESET }]
    : [{ spans: [{ text: NOT_STARTED }], alt: NOT_STARTED }]
  if (deleting)
    rows.push({ key: 'row:delete', spans: [{ text: DELETE }], action: DELETE_ACTION, alt: DELETE })
  // The cursor the keys move, as on the playing Account tab: a ban's Delete is the second row.
  const ids = rows.flatMap((r) => (r.key ? [r.key.slice(4)] : []))
  const spec: ListSpec = {
    title: [{ text: label }],
    altTitle: label,
    rows,
    empty: NOT_STARTED,
    cursor: cursorRow(input.dialog.cursor.account ?? null, ids),
    detail: resetting
      ? (w) => [text(serverLine(input.server), w), text(clientLine(), w)]
      : () => [],
    menu: null,
    yesNo: null,
    panel: null,
    error: null,
    state: [NOT_STARTED, ''],
    field: null,
    link: null,
  }
  const menu = input.dialog.menu
  if (resetting && menu?.kind === 'confirm' && menu.action === 'reset') {
    spec.yesNo = { at: menu.at, yes: { t: 'reset' } }
    spec.state = [RESET_QUESTION, '']
  }
  if (deleting && menu?.kind === 'confirm' && menu.action === 'delete') {
    spec.yesNo = { at: menu.at, yes: { t: 'delete' } }
    spec.state = [DELETE_QUESTION, DELETE_DETAIL]
  }
  return listPane(input, spec)
}
