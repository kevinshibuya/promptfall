// The Leaderboards tab as windows (docs/plans/2026-10-06-ui-pr3-remaining-tabs.md, "Leaderboards"):
// both boards in one list under their headings, your rows in gold (a graft); who is online by zone
// in the detail window.
import type { BoardRow } from '../../../types'
import { gates } from '../../view'
import type { Line } from '../../windows/kit'
import { GAUGE_FULL_RGB, MOVE_HELP, TEXT_RGB, WARN_RGB } from '../../windows/tuning'
import { formatCount } from '../format'
import { onlineLine } from '../leaderboards'
import { wrap } from '../strip'
import { GATE_BOARDS_CLOSED } from '../trade'
import { cursorRow } from './frame'
import type { MessageLine, PaneInput } from './input'
import { capital, listInner, rowSpans } from './inventory'
import { type ListRow, type ListSpec, listPane } from './list'
import type { PaneBuild } from './types'

const VALUE_CELLS = 10

export function boardsPane(input: PaneInput): PaneBuild {
  const { view, world, boards, dialog } = input
  const inner = listInner(input)
  const open = gates(world, view.account).leaderboardsOpen
  const rows: ListRow[] = []
  const board = (prefix: string, list: readonly BoardRow[], value: (r: BoardRow) => string) =>
    list.map((r, i): ListRow => {
      const rgb = r.accountId === view.accountId ? GAUGE_FULL_RGB : TEXT_RGB
      return {
        key: `row:${prefix}-${r.accountId}`,
        spans: rowSpans(inner, null, { text: `${i + 1}. ${r.name}`, rgb }, [
          { text: value(r), cells: VALUE_CELLS, rgb },
        ]),
        action: { t: 'none' },
        alt: `${i + 1}. ${r.name}, ${value(r)}`,
      }
    })
  if (!open) {
    rows.push({ spans: [{ text: GATE_BOARDS_CLOSED }], alt: GATE_BOARDS_CLOSED })
  } else if (boards.busy && !boards.boards) {
    rows.push({ spans: [{ text: 'Loading…' }], alt: 'Loading' })
  } else {
    const highest = boards.boards?.highestZone ?? []
    const damage = boards.boards?.damage ?? []
    rows.push({ spans: [{ text: 'Highest zone' }], rule: true, alt: 'Highest zone' })
    rows.push(...board('z', highest, (r) => `zone ${r.value}`))
    rows.push({
      spans: [{ text: 'Boss damage this week' }],
      rule: true,
      alt: 'Boss damage this week',
    })
    if (damage.length === 0) {
      rows.push({
        spans: [{ text: 'No boss damage yet this week.' }],
        alt: 'No boss damage yet this week',
      })
    }
    rows.push(...board('d', damage, (r) => formatCount(r.value)))
  }

  const ids = rows.flatMap((r) => (r.key ? [r.key.slice(4)] : []))
  const cursor = cursorRow(dialog.cursor.leaderboards ?? null, ids)
  const state: [MessageLine, MessageLine] = open
    ? [MOVE_HELP, 'The boss board resets Monday 00:00 UTC.']
    : [[{ text: GATE_BOARDS_CLOSED, rgb: WARN_RGB }], '']

  const spec: ListSpec = {
    title: [{ text: 'Leaderboards' }],
    altTitle: 'Leaderboards',
    rows,
    empty: '',
    cursor,
    detail: (w): Line[] => [
      { spans: [{ gap: 1 }, { text: 'Online' }], rule: true },
      ...wrap(capital(onlineLine(view, world)), w - 1).map((t) => ({
        spans: [{ gap: 1 }, { text: t }],
      })),
    ],
    menu: null,
    yesNo: null,
    panel: null,
    error: boards.error,
    state,
    field: null,
    link: null,
  }
  return listPane(input, spec)
}
