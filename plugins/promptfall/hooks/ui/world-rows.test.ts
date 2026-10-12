import { expect, test } from 'claude-code/testing'
import type { WorldState } from '../../types'
import { wave } from '../stage/fixtures'
import { strip } from '../stage/scenarios'
import type { Scene, Win } from '../windows/kit'
import { stripScene } from './strip'
import { worldRows } from './world-rows'

const NOW = 1_000_000

/** A fresh snapshot with no boss up, chat closed, and `flags` on top. */
function worldWith(flags: Record<string, boolean>): WorldState {
  return {
    snapshot: {
      serverNow: NOW,
      speed: 1,
      online: 1,
      zones: [{ zone: 1, count: 1 }],
      here: [],
      boss: null,
      chat: [],
      flags: { 'chat.enabled': false, 'presence.enabled': true, ...flags },
    },
    fetchedAt: NOW,
    stale: false,
    messages: [],
    chatMark: 0,
    clock: { serverNow: NOW, clientNow: NOW, speed: 1 },
    committedDealt: null,
  }
}

const messageText = (scene: Scene) =>
  (scene.windows.find((w) => w.key === 'message') as Win).lines
    .flatMap((l) => l.spans)
    .map((s) => ('text' in s ? s.text : ''))
    .join('')

test('the World rows say the boss is off in place', () => {
  const view = wave()
  const off = worldRows(view, worldWith({ 'worldboss.enabled': false }), NOW)[1]
  expect(off?.text).toBe('highest zone 1 · kills 0 · wipes 0 · world boss is off')
  // On, with no boss up: the records as they were.
  const on = worldRows(view, worldWith({ 'worldboss.enabled': true }), NOW)[1]
  expect(on?.text).toBe('highest zone 1 · kills 0 · wipes 0')
  const tier2 = worldRows(
    { ...view, highestZone: 13 },
    worldWith({ 'worldboss.enabled': true }),
    NOW,
  )
  expect(tier2[1]?.text).toBe('highest zone T2 Z1 · kills 0 · wipes 0')
  // Before the first snapshot the bootstrap config's flag decides.
  const before: WorldState = { ...worldWith({}), snapshot: null }
  expect(worldRows(view, before, NOW)[1]?.text).toMatch(/ · world boss is off$/)
  const open = { ...view, account: { ...view.account, bossOpen: true } }
  expect(worldRows(open, before, NOW)[1]?.text).toBe('highest zone 1 · kills 0 · wipes 0')
  // The strip's World tab draws the same row while chat is closed, when the row has room for it.
  const input = strip('strip-world')
  const world = worldWith({ 'worldboss.enabled': false })
  const shown = (columns: number, w = world) =>
    messageText(stripScene({ ...input, world: w, columns }).scene)
  expect(shown(114)).toContain('highest zone 1 · kills 0 · wipes 0 · world boss is off')
  expect(shown(140)).toContain('highest zone 1 · kills 0 · wipes 0 · world boss is off')
  // At 120 the enemy window leaves 36 cells: the records whole, the note dropped.
  expect(shown(120)).toContain('highest zone 1 · kills 0 · wipes 0')
  expect(shown(120)).not.toContain('world boss')
  expect(shown(140, worldWith({ 'worldboss.enabled': true }))).not.toContain('world boss')
})
