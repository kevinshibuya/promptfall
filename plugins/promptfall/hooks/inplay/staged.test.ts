import { expect } from 'claude-code/testing'
import { test } from '../testing'
import { BAND, sandboxOn } from './harness'

type Node = { props: Record<string, unknown>; children?: unknown[] }

test('in play, a hero stands until the blow that kills him lands', async ($, on) => {
  const { run, view, clock } = await sandboxOn(on, $)
  // The desktop draws the stage at each redraw, a fallen hero at half opacity.
  const ui = await $.ui.mount({ plugin: 'promptfall', surface: 'desktop', ...BAND })
  const fallen = async () => {
    const row = await ui.find({ key: 'row-stage' })
    const stage = (row?.children ?? [])[0] as Node | undefined
    return (String(stage?.props.source ?? '').match(/opacity="0\.5"/g) ?? []).length
  }
  // Zone 6 kills a hero within a minute or so.
  expect(await run('zone 6')).toMatch(/^Sandbox: zone 6/)
  let died = 0
  let trailed = 0
  let caughtUp = 0
  // The most heroes the state has had dead since the stage last caught up with it. A cleared
  // wave revives the party, and the stage may still be playing the blows that felled them.
  let fell = 0
  for (let step = 0; step < 2400 && caughtUp === 0; step++) {
    await clock.advance(50)
    const dead = view().heroes.filter((h) => !h.alive).length
    const drawn = await fallen()
    fell = Math.max(fell, dead)
    // Never ahead of the state: a hero dims only once the state has had him dead.
    expect(drawn).toBeLessThanOrEqual(fell)
    if (dead > 0) died++
    if (drawn < dead) trailed++
    else if (trailed > 0 && drawn > 0) caughtUp++
    if (drawn <= dead) fell = dead
  }
  expect(died, 'a hero died').toBeGreaterThan(0)
  // The tick that killed him drew him standing, and the redraw after the blow landed dims him.
  expect(trailed, 'the stage trailed a death').toBeGreaterThan(0)
  expect(caughtUp, 'the stage caught up').toBeGreaterThan(0)
  await ui.unmount()
})
