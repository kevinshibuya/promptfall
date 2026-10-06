// The Chat tab as windows (docs/plans/2026-10-06-ui-pr3-remaining-tabs.md, "Chat"): the messages
// one line each, paged from the newest back; the ▶ message whole in the detail window; the compose
// field under the picture, one Enter away (not focused when the tab opens, grill 1.21).
import type { ChatMessage } from '../../../types'
import type { Line, Span } from '../../windows/kit'
import { CHAT_KEEP, DIM_RGB, FIELD_HELP, MOVE_HELP, WARN_RGB } from '../../windows/tuning'
import { CHAT_READ_ONLY, chatGate } from '../chat'
import { clip } from '../format'
import { wrap } from '../strip'
import { cursorRow } from './frame'
import type { MessageLine, PaneInput } from './input'
import { listInner } from './inventory'
import { type ListRow, type ListSpec, listPane } from './list'
import type { PaneAction, PaneBuild, PaneField } from './types'

const NEWEST = 'newest'

function messageSpans(m: ChatMessage, width: number): Span[] {
  const name = clip(`${m.name}:`, width)
  const room = width - [...name].length - 1
  return [
    { text: name, rgb: DIM_RGB },
    ...(room > 0 ? [{ gap: 1 }, { text: clip(m.text, room) }] : []),
  ]
}

export function chatPane(input: PaneInput): PaneBuild {
  const { view, world, chat, dialog } = input
  const messages = world?.messages ?? []
  const inner = listInner(input)
  const gate = chatGate(view, world)
  const field: PaneField | null =
    input.hasInput && !gate
      ? {
          key: 'compose',
          label: 'say',
          placeholder: 'a message',
          value: chat.draft,
          submitLabel: 'send',
        }
      : null
  const action: PaneAction = field ? { t: 'field', key: 'compose' } : { t: 'none' }
  // The ▶ cell and a gap come first (listWindow adds them).
  const rows: ListRow[] = messages.map((m, i) => ({
    key: i === messages.length - 1 ? `row:${NEWEST}` : `row:m-${m.id}`,
    spans: messageSpans(m, inner - 2),
    action,
    alt: `${m.name}: ${m.text}`,
  }))
  if (rows.length === 0)
    rows.push({ spans: [{ text: 'No messages yet.' }], alt: 'No messages yet' })

  const ids = messages.map((m, i) => (i === messages.length - 1 ? NEWEST : `m-${m.id}`))
  const saved = dialog.cursor.chat ?? null
  // No cursor, or one on the newest: the ▶ follows new messages.
  const cursor = !saved || saved.id === NEWEST ? ids.length - 1 : cursorRow(saved, ids)
  const on = messages[cursor]

  let state: [MessageLine, MessageLine]
  if (gate) state = [[{ text: gate, rgb: WARN_RGB }], '']
  else if (!input.hasInput) state = [CHAT_READ_ONLY, '']
  else state = [`Enter: write. ${MOVE_HELP}`, FIELD_HELP]

  const spec: ListSpec = {
    title: [{ text: 'Chat' }],
    altTitle: `Chat, ${messages.length} of the last ${CHAT_KEEP} messages`,
    rows,
    empty: 'No messages yet.',
    cursor,
    detail: on
      ? (w): Line[] => [
          { spans: [{ gap: 1 }, { text: clip(on.name, w - 1) }], rule: true },
          ...wrap(on.text, w - 1).map((t) => ({ spans: [{ gap: 1 }, { text: t }] })),
        ]
      : null,
    menu: null,
    yesNo: null,
    panel: null,
    error: chat.error,
    state,
    fromEnd: true,
    emptyAction: action,
    field,
    link: null,
  }
  return listPane(input, spec)
}
