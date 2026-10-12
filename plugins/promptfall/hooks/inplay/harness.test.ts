import { expect } from 'claude-code/testing'
import { test } from '../testing'
import { BAND, sandboxOn, stripText } from './harness'

test('in play, the band mounts over the sandboxed engine and its strip reads as text', async ($, on) => {
  const { view } = await sandboxOn(on, $, {
    'promptfall:settings': { sound: 'off', motion: 'full', renderer: 'raster' },
  })
  const ui = await $.ui.mount({ plugin: 'promptfall', surface: 'terminal', ...BAND })
  const strip = await stripText(ui)
  // The strip's title names the zone and wave the engine is playing.
  expect(strip).toContain(`Zone ${view().zone} · Wave ${view().wave}`)
  await ui.unmount()
})
