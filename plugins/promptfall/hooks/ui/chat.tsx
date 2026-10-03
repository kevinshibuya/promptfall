import type { ChatState, GameView, WorldState } from '../../types'
import type { GameHandle } from '../engine'
import { IN_PROCESS } from '../server'
import { CHAT_MAX_CHARS } from '../vendor/protocol.js'
import { gates } from '../view'
import {
  type After,
  chatRefusalText,
  type Els,
  errorText,
  flash,
  GATE_CHAT_CLOSED,
  GATE_CHAT_LOCAL,
  GATE_UNLINKED,
  type Updater,
} from './trade'

/** The pane opens with 20 rows: the tabs, the compose box and the messages that fit. */
export const CHAT_LINES = 14
export const CHAT_READ_ONLY = 'Posting needs a terminal or the desktop app.'

export type ChatActions = {
  setDraft: (text: string) => Promise<void>
  post: (text: string) => Promise<void>
}

/** Posts a line: an empty one is refused here; on success the box empties. */
export async function postChat(
  game: GameHandle,
  text: string,
  upd: Updater<ChatState>,
  after: After,
): Promise<void> {
  // Judged here as the server judges it, so a paste past the wire limit is not a 400 read as an outage.
  const cleaned = text.replace(/\p{Cc}/gu, '').trim()
  if (cleaned === '') {
    await flash(upd, after, chatRefusalText('empty'))
    return
  }
  if (cleaned.length > CHAT_MAX_CHARS) {
    await flash(upd, after, chatRefusalText('too_long'))
    return
  }
  await upd((s) => ({ ...s, draft: text, busy: true }))
  try {
    // The cleaned text goes out: a padded paste can be long raw yet short once stripped.
    const r = await game.chat(cleaned)
    if (r.ok) {
      await upd((s) => ({ ...s, draft: '', busy: false }))
      return
    }
    await upd((s) => ({ ...s, busy: false }))
    await flash(upd, after, chatRefusalText(r.reason))
  } catch (error) {
    await upd((s) => ({ ...s, busy: false }))
    await flash(upd, after, errorText(error))
  }
}

/** The Chat tab: the last messages, newest at the bottom, then the compose box or why there is none. */
export function chatBody(
  els: Els,
  view: GameView,
  world: WorldState,
  chat: ChatState,
  actions: ChatActions,
) {
  const { Box, Text, Input } = els
  const body = []
  if (chat.error) {
    body.push(
      <Text key="chat-error" color="red" wrap="truncate">
        {chat.error}
      </Text>,
    )
  }
  const shown = world.messages.slice(-CHAT_LINES)
  if (shown.length === 0) {
    body.push(
      <Text key="chat-empty" dimColor>
        No messages yet.
      </Text>,
    )
  }
  for (const m of shown) {
    body.push(
      <Box key={`chat-${m.id}`} flexDirection="row" gap={1}>
        {/* The name never shrinks: a long line truncates its text, not the colon onto a new row. */}
        <Box key={`chat-name-${m.id}`} flexShrink={0}>
          <Text dimColor>{`${m.name}:`}</Text>
        </Box>
        <Text wrap="truncate">{m.text}</Text>
      </Box>,
    )
  }
  const gate = !gates(world, view.account).chatOpen
    ? view.account.server === IN_PROCESS
      ? GATE_CHAT_LOCAL
      : GATE_CHAT_CLOSED
    : view.account.linked
      ? null
      : GATE_UNLINKED
  if (gate) {
    body.push(
      <Text key="chat-gate" color="yellow" wrap="wrap">
        {gate}
      </Text>,
    )
  } else if (Input) {
    body.push(
      <Input
        key="chat-compose"
        label="say"
        placeholder="a message"
        value={chat.draft}
        autoFocus
        submitLabel="send"
        onInput={(text: string) => void actions.setDraft(text)}
        onSubmit={(text: string) => void actions.post(text)}
      />,
    )
  } else {
    body.push(
      <Text key="chat-read-only" dimColor>
        {CHAT_READ_ONLY}
      </Text>,
    )
  }
  return body
}
