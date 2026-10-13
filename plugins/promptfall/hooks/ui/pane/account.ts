// The Account tab as windows (docs/plans/2026-10-06-ui-pr3-remaining-tabs.md, "Account"): the
// settings and actions as rows, the machine and session facts in the detail window, the GitHub
// device-flow Link under the picture, the reset and delete Yes/Nos; and the pane with no game view.
import type { JournalView, Settings } from '../../../types'
import { dayOf } from '../../vendor/protocol.js'
import { SIM_VERSION } from '../../vendor/sim.js'
import { CLIENT_VERSION } from '../../version'
import type { Line, Span } from '../../windows/kit'
import { MOVE_HELP } from '../../windows/tuning'
import { zoneMark } from '../../zone-words'
import { clip } from '../format'
import { wrap } from '../strip'
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

/** What `s` cycles the sound through. */
export const SOUND_NEXT: Record<Settings['sound'], Settings['sound']> = {
  off: 'quiet',
  quiet: 'normal',
  normal: 'loud',
  loud: 'off',
}

const VALUE_CELLS = 24
/** After the step on a session marked silent: "quiet, silent here" is 18 of the value's 24 cells. */
const SILENT_NOTE = ', silent here'
const NO_PLAYER =
  'This system has no audio player. Claude Code plays sound on macOS; the setting is kept.'
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

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
/** The day names' cells in the pick, before the mark. */
const DAY_CELLS = 11
const short = (day: number) => DAYS[day - 1]?.slice(0, 3) ?? '?'
/** "Sat, Sun": ISO weekdays in week order. */
const dayList = (days: readonly number[]) =>
  [...days]
    .sort((a, b) => a - b)
    .map(short)
    .join(', ')

/**
 * The set in force, and the set to come until its Monday passes; past it, the set to come is in
 * force though the journal was read before.
 */
function restDaysNow(rest: JournalView['restDays'], serverNow: number) {
  const { current, next } = rest
  return next && dayOf(serverNow) < next.from
    ? { inForce: current, next: next.days }
    : { inForce: next?.days ?? current, next: null }
}

/** The Rest days row's value: "Sat, Sun", "Sat, Sun (Tue, Thu from Monday)". */
function restDaysValue(rest: ReturnType<typeof restDaysNow>): string {
  const now = dayList(rest.inForce)
  return rest.next ? `${now} (${dayList(rest.next)} from Monday)` : now
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
  const cells = Math.max(VALUE_CELLS, value.length)
  return {
    key: `row:${id}`,
    ...(hotkey ? { hotkey } : {}),
    spans: rowSpans(inner, null, label, value ? [{ text: value, cells }] : []),
    action,
    alt: value ? `${alt}: ${value}` : alt,
  }
}

function accountDetail(input: PaneInput, inner: number, silent: boolean): Line[] {
  const { view, dialog } = input
  const silence = silent
    ? [{ spans: [] }, ...wrap(NO_PLAYER, inner - 1).map((t) => text(t, inner))]
    : []
  // A pending code leads: a narrow pane, the dock included, stacks this window under the list and
  // keeps only its first lines.
  if (!view.account.linked && dialog.link) {
    return [
      head('Account'),
      text(`Enter ${dialog.link.code} at`, inner),
      text('the link under this window.', inner),
      { spans: [] },
      ...accountLines(input, inner),
      ...silence,
    ]
  }
  const link = view.account.linked
    ? [text(`Linked as ${view.account.linked}`, inner)]
    : [text('Not linked.', inner)]
  return [head('Account'), ...accountLines(input, inner), { spans: [] }, ...link, ...silence]
}

function accountLines(input: PaneInput, inner: number): Line[] {
  const { view, account } = input
  return [
    text(serverLine(account.server), inner),
    text(`Account ${view.accountId}`, inner),
    text(clientLine(), inner),
    text(`Mode ${input.mode}`, inner),
    text(`Session ${account.leaseOwner ?? 'none'}`, inner),
    text(
      `Highest zone ${zoneMark(view.highestZone)} · kills ${view.kills} · wipes ${view.wipes}`,
      inner,
    ),
  ]
}

export function accountPane(input: PaneInput): PaneBuild {
  const { view, account, dialog } = input
  const { settings } = account
  const inner = listInner(input)
  const loaded = input.journal.journal?.restDays
  const rest = loaded ? restDaysNow(loaded, input.serverNow) : null
  // Off is off on any system: the note is for a step that should be heard.
  const silent = account.soundSilent && settings.sound !== 'off'
  const renderer =
    settings.renderer === 'auto'
      ? `auto (${account.renderer})`
      : `${settings.renderer} (from next start)`
  const rows: ListRow[] = [
    setting(
      inner,
      'sound',
      hotkeySpans('Sound', 's'),
      silent ? `${settings.sound}${SILENT_NOTE}` : settings.sound,
      { t: 'setting', patch: { sound: SOUND_NEXT[settings.sound] } },
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
    // The account's, not the machine's: a secondary shows it and sends nothing.
    setting(
      inner,
      'autovendor',
      [{ text: 'Auto-vendor' }],
      view.autoVendor ? 'on' : 'off',
      input.readOnly
        ? { t: 'none' }
        : { t: 'event', event: { t: 'set_auto_vendor', on: !view.autoVendor } },
    ),
    // The account's too, from the journal: nothing to pick before it loads.
    setting(
      inner,
      'restdays',
      [{ text: 'Rest days' }],
      rest ? restDaysValue(rest) : '…',
      input.readOnly || !rest
        ? { t: 'none' }
        : { t: 'open', menu: { kind: 'rest_days', picked: [], at: 0 } },
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
    detail: (w) => accountDetail(input, w, silent),
    menu: null,
    yesNo: null,
    panel: null,
    error: input.journal.error,
    state: [
      `Enter: change it. ${MOVE_HELP}`,
      'Auto-vendor and rest days are kept per account, the rest per machine.',
    ],
    field: null,
    link: !view.account.linked && dialog.link ? { url: dialog.link.url } : null,
  }
  const menu = dialog.menu
  if (menu?.kind === 'rest_days' && rest && !input.readOnly) {
    spec.menu = {
      header: [{ text: 'Rest days' }],
      items: DAYS.map((name, i) => {
        const day = i + 1
        const mark = menu.picked.includes(day) ? 'pick' : rest.inForce.includes(day) ? 'rest' : ''
        return {
          label: `${name.padEnd(DAY_CELLS)}${mark}`.trimEnd(),
          action: { t: 'rest_day', day },
        }
      }),
      at: Math.max(0, Math.min(DAYS.length - 1, menu.at)),
    }
    spec.state = [
      menu.picked.length === 0
        ? 'Pick two rest days.'
        : `Picked ${dayList(menu.picked)}: pick one more.`,
      'They apply from next Monday. q: back.',
    ]
  }
  // Reset works in read-only mode, as today.
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
