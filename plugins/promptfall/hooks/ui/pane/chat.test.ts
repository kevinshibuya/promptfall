import { expect, test } from 'claude-code/testing'
import type { ChatState, DialogState, GameView, WorldState } from '../../../types'
import { tilePositions } from '../../windows/kit'
import { DIM_RGB, DOWN_RGB, WARN_RGB } from '../../windows/tuning'
import { CHAT_READ_ONLY } from '../chat'
import { GATE_CHAT_CLOSED, GATE_CHAT_LOCAL, GATE_UNLINKED } from '../trade'
import { chatPane } from './chat'
import { chatWorld, paneInput, paneView } from './fixtures'
import type { PaneInput } from './input'
import { linesOf, win } from './testing'

const openView = (patch: Partial<GameView['account']> = {}): GameView => ({
  ...paneView(),
  account: { ...paneView().account, chatOpen: true, server: 'http://fake', ...patch },
})
function input(
  world: WorldState = chatWorld(30),
  dialog: Partial<DialogState> = {},
  patch: Partial<PaneInput> = {},
  chat: Partial<ChatState> = {},
): PaneInput {
  const base = paneInput({ tab: 'chat', view: openView(), world, ...patch })
  return {
    ...base,
    chat: { ...base.chat, ...chat },
    dialog: { ...base.dialog, ...dialog },
  }
}
const cursors = (b: ReturnType<typeof chatPane>) => b.stops.filter((s) => s.cursor)
const message = (b: ReturnType<typeof chatPane>) => linesOf(win(b, 'message')).map((l) => l.trim())

test('31 and 200 messages: the newest page is full, the ▶ on the newest', () => {
  for (const n of [31, 200]) {
    const b = chatPane(input(chatWorld(n)))
    const lines = linesOf(win(b, 'list'))
    expect(lines.length).toBe(15)
    expect(lines[14]).toBe(`▶ ${['mira', 'tomas', 'kevin', 'lyra'][(n - 1) % 4]}: message ${n}`)
    expect(lines[0]?.endsWith(`message ${n - 14}`)).toBe(true)
    expect(b.focus).toBe('row:newest')
    expect(cursors(b).length).toBe(n)
  }
})

test('the name is dim; a moved ▶ shows the page holding it; a new message keeps a null ▶ on the newest', () => {
  const b = chatPane(input())
  expect(win(b, 'list')?.lines[14]?.spans).toContainEqual({ text: 'tomas:', rgb: DIM_RGB })
  const back = chatPane(input(chatWorld(30), { cursor: { chat: { id: 'm-12', index: 11 } } }))
  const lines = linesOf(win(back, 'list'))
  expect(lines[0]).toBe('  mira: message 1')
  expect(lines[11]).toBe('▶ lyra: message 12')
  expect(back.focus).toBe('row:m-12')
  const more = chatPane(input(chatWorld(31)))
  expect(more.focus).toBe('row:newest')
  expect(linesOf(win(more, 'list'))[14]).toBe('▶ kevin: message 31')
  // A ▶ moved back onto the newest follows again.
  const follows = chatPane(input(chatWorld(31), { cursor: { chat: { id: 'newest', index: 29 } } }))
  expect(follows.focus).toBe('row:newest')
})

test('a row goes to the field, the field carries the draft; no messages: row:empty does the same', () => {
  const b = chatPane(input(chatWorld(3), {}, {}, { draft: 'hello' }))
  expect(cursors(b).every((s) => s.action.t === 'field')).toBe(true)
  expect(cursors(b)[0]?.action).toEqual({ t: 'field', key: 'compose' })
  expect(b.field).toEqual({
    key: 'compose',
    label: 'say',
    placeholder: 'a message',
    value: 'hello',
    submitLabel: 'send',
  })
  const empty = chatPane(input(chatWorld(0)))
  expect(linesOf(win(empty, 'list'))).toEqual(['  No messages yet.'])
  expect(cursors(empty)).toEqual([
    { key: 'row:empty', action: { t: 'field', key: 'compose' }, cursor: true, index: 0 },
  ])
  expect(linesOf(win(empty, 'detail'))).toEqual([])
  expect(message(b)).toEqual(['Enter: write. Tab or arrows: move.', 'Tab: leave the field.'])
})

test('the gates and the read-only line; no field then', () => {
  const closed = chatPane(input(chatWorld(3), {}, { view: openView({ chatOpen: false }) }))
  expect(win(closed, 'message')?.lines[0]?.spans).toContainEqual({
    text: GATE_CHAT_CLOSED,
    rgb: WARN_RGB,
  })
  expect(closed.field).toBeNull()
  expect(cursors(closed)[0]?.action).toEqual({ t: 'none' })
  const local = chatPane(
    input(chatWorld(3), {}, { view: openView({ chatOpen: false, server: 'in-process' }) }),
  )
  expect(message(local)[0]).toBe(GATE_CHAT_LOCAL)
  const unlinked = chatPane(input(chatWorld(3), {}, { view: openView({ linked: null }) }))
  expect(message(unlinked)[0]).toBe(GATE_UNLINKED)
  const mobile = chatPane(input(chatWorld(3), {}, { hasInput: false }))
  expect(mobile.field).toBeNull()
  expect(message(mobile)).toEqual([CHAT_READ_ONLY, ''])
  const error = chatPane(input(chatWorld(3), {}, {}, { error: 'Slow down' }))
  expect(win(error, 'message')?.lines[0]?.spans).toContainEqual({
    text: 'Slow down',
    rgb: DOWN_RGB,
  })
})

test('the detail wraps a 200-character message under its name', () => {
  const world = chatWorld(2)
  const long = `${'word '.repeat(40)}`.trim()
  world.messages = [...world.messages.slice(0, 1), { id: 2, name: 'lyra', text: long, at: 0 }]
  const lines = linesOf(win(chatPane(input(world)), 'detail'))
  expect(lines[0]).toBe(' lyra')
  expect(lines.slice(1).join(' ').replace(/ +/g, ' ').trim()).toBe(long)
  expect(lines.length).toBeGreaterThan(5)
})

test('wide and narrow pass tilePositions', () => {
  for (const columns of [120, 60]) {
    const b = chatPane(input(chatWorld(30), {}, { columns }))
    const pos = tilePositions(b.scene)
    for (const w of b.scene.windows)
      expect([w.key, pos.get(w.key)]).toEqual([w.key, { x: w.x, y: w.y ?? 0 }])
  }
})
