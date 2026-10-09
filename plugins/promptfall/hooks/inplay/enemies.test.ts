import { expect } from 'claude-code/testing'
import type { GameView, WorldState } from '../../types'
import { test } from '../testing'
import { BAND, sandboxOn } from './harness'

type Node = { props: Record<string, unknown>; children?: unknown[] }
type Ui = { find: (q: { key: string }) => Promise<Node | undefined> }

/** A zone and wave as one number, so "never ahead" is one comparison; a boss is wave 11. */
const rank = (zone: number, wave: number) => zone * 100 + Math.min(wave, 11)

/** The view's encounter ranked as the enemy window titles it: a zone or turn boss is the boss. */
const viewRank = (v: GameView) =>
  rank(
    v.zone,
    v.enemies.some((e) => e.kind === 'zone_boss' || e.kind === 'turn_boss') ? 11 : v.wave,
  )

/** The desktop band as a player reads it: the enemy window's title and rows, the stage's alt and backdrop. */
async function band(ui: Ui) {
  const strip = ((await ui.find({ key: 'row-strip' }))?.children ?? [])[0] as Node | undefined
  const alt = String(strip?.props.alt ?? '')
  // The enemy window leads the strip's alt: `<title>. <name> <hp> of <max> HP, … .`
  const [, title = '', list = ''] = alt.match(/^(.*?)\. (.*?)\. /) ?? []
  const rows =
    list === 'No enemies'
      ? []
      : [...list.matchAll(/(.+?) (\d+) of (\d+) HP(?:, |$)/g)].map((m) => ({
          name: m[1] ?? '',
          hp: Number(m[2]),
        }))
  const encounter = title.match(/^Zone (\d+) · (?:Wave (\d+)|Boss)$/)
  const row = await ui.find({ key: 'row-stage' })
  const stage = (row?.children ?? [])[0] as Node | undefined
  const source = String(stage?.props.source ?? '')
  const zone = Number(String(stage?.props.alt ?? '').match(/^Zone (\d+),/)?.[1] ?? 0)
  return {
    title,
    rows,
    rank: encounter ? rank(Number(encounter[1]), Number(encounter[2] ?? 11)) : 0,
    stage: { zone, backdrop: source.match(/<g id="bg">[\s\S]*?<\/g>/)?.[0] ?? '' },
  }
}

/** The rows the band holds that the view has dropped: what the stage is still playing. */
function held(shown: readonly { name: string }[], view: GameView): number {
  const live = view.enemies.map((e) => e.name)
  let n = 0
  for (const { name } of shown) {
    const i = live.indexOf(name)
    if (i < 0) n++
    else live.splice(i, 1)
  }
  return n
}

test(
  'in play, a killed monster keeps its row until its death has played, and the wave title holds until it has gone',
  { timeoutMs: 60_000 },
  async ($, on) => {
    const { view, clock } = await sandboxOn(on, $)
    const ui = await $.ui.mount({ plugin: 'promptfall', surface: 'desktop', ...BAND })
    let kept = 0
    let waveHeld = 0
    let caughtUp = 0
    for (let step = 0; step < 6000 && caughtUp === 0; step++) {
      await clock.advance(50)
      const v = view()
      const shown = await band(ui)
      const ranked = viewRank(v)
      // Never ahead of the state: the title never names a wave the view has not reached.
      expect(shown.rank).toBeLessThanOrEqual(ranked)
      const holding = held(shown.rows, v)
      if (holding > 0) kept++
      // A row the view dropped belongs to the wave the title still names.
      if (shown.rank < ranked) {
        waveHeld++
        expect(holding, 'the previous wave holds the title only while a row of it is held').toBe(
          shown.rows.length,
        )
      } else if (waveHeld > 0 && holding === 0) caughtUp++
    }
    expect(kept, 'a killed monster kept its row').toBeGreaterThan(0)
    expect(waveHeld, 'the title held a cleared wave').toBeGreaterThan(0)
    expect(caughtUp, 'the title and rows caught up').toBeGreaterThan(0)
    await ui.unmount()
  },
)

test(
  'in play, a zone boss dies against its own painting: the backdrop and the title change zone when its row leaves',
  { timeoutMs: 60_000 },
  async ($, on) => {
    const { run, view, clock } = await sandboxOn(on, $)
    const ui = await $.ui.mount({ plugin: 'promptfall', surface: 'desktop', ...BAND })
    // A party at the cap, so the boss falls rather than wiping it back to wave 1.
    for (const h of view().heroes) expect(await run(`level ${h.id} 20`)).toMatch(/ is level 20/)
    expect(await run('boss bandit')).toBe('Sandbox: Bandit Captain is next')
    for (let i = 0; i < 40 && !view().enemies.some((e) => e.name === 'Bandit Captain'); i++)
      await clock.advance(500)
    expect(view().enemies.map((e) => e.name)).toContain('Bandit Captain')
    const zone1 = (await band(ui)).stage.backdrop
    expect(zone1).not.toBe('')
    let held = 0
    let caughtUp = 0
    for (let step = 0; step < 8000 && caughtUp === 0; step++) {
      await clock.advance(50)
      const v = view()
      const shown = await band(ui)
      expect(shown.rank).toBeLessThanOrEqual(viewRank(v))
      expect(shown.stage.zone).toBeLessThanOrEqual(v.zone)
      // The stage draws zone 1 against zone 1's painting, and no other.
      if (shown.stage.zone === 1) expect(shown.stage.backdrop).toBe(zone1)
      if (v.zone === 2 && shown.stage.zone === 1) {
        held++
        expect(shown.title).toBe('Zone 1 · Boss')
        expect(shown.rows.map((r) => r.name)).toContain('Bandit Captain')
      } else if (held > 0 && shown.stage.zone === 2) {
        caughtUp++
        expect(shown.stage.backdrop).not.toBe(zone1)
        expect(shown.title).toBe('Zone 2 · Wave 1')
        expect(shown.rows.map((r) => r.name)).not.toContain('Bandit Captain')
      }
    }
    expect(held, 'the boss died in zone 1').toBeGreaterThan(0)
    expect(caughtUp, 'the band moved on to zone 2').toBeGreaterThan(0)
    await ui.unmount()
  },
)

test(
  'in play, the world boss bar drops as the hits land, never ahead of them',
  { timeoutMs: 60_000 },
  async ($, on) => {
    const { run, view, clock, states } = await sandboxOn(on, $)
    const ui = await $.ui.mount({ plugin: 'promptfall', surface: 'desktop', ...BAND })
    expect(await run('worldboss')).toBe('Sandbox: world boss The Promptwyrm has appeared')
    /** The bar as the state has it: the poll less what this party dealt past its committed tally. */
    const dealtBar = (): number | null => {
      const world = states.get('world') as WorldState
      const boss = world.snapshot?.boss
      const mine = view().boss
      if (!boss || mine?.bossId !== boss.bossId || world.committedDealt?.bossId !== boss.bossId)
        return null
      return Math.max(0, boss.hp - Math.max(0, mine.dealt - world.committedDealt.dealt))
    }
    let trailed = 0
    let caughtUp = 0
    for (let step = 0; step < 2400 && caughtUp === 0; step++) {
      await clock.advance(50)
      const state = dealtBar()
      const bar = (await band(ui)).rows.find((r) => r.name === 'The Promptwyrm')?.hp
      if (state === null || bar === undefined) continue
      // Never below the state: the bar only holds back damage still in the air.
      expect(bar).toBeGreaterThanOrEqual(state)
      if (bar > state) trailed++
      else if (trailed > 0) caughtUp++
    }
    expect(trailed, 'the bar trailed a hit in the air').toBeGreaterThan(0)
    expect(caughtUp, 'the bar caught up once it landed').toBeGreaterThan(0)
    await ui.unmount()
  },
)
