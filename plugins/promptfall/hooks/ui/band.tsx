import { atom, type Elements, type On, read, update } from 'claude-code'
import type { GameView, Mode, Prefs, Settings, WorldState } from '../../types'
import type { GameHandle } from '../engine'
import { IN_PROCESS } from '../server'
import { encode } from '../sprites/base64'
import { type Layout, layoutFor } from '../stage/layout'
import { stageFrame, stageKey } from '../stage/loop'
import { stageAt } from '../stage/model'
import { renderSvg } from '../stage/svg'
import { StageTimeline } from '../stage/timeline'
import { COMPACT_STAGE_COLUMNS, PROBE_ALT_DENY, PROBE_DELAY_MS, SVG_SMIL } from '../stage/tuning'
import { PREFS_DEFAULT, SETTINGS_DEFAULT, WORLD_DEFAULT } from '../state'
import { gates } from '../view'
import { type ShownBoss, shownBoss } from './boss'
import { CLASS_INITIAL, clip, formatCount, formatGold, padEnd, padStart, waveLabel } from './format'
import { ClassGlyph, HpBar, PartyLine, RarityText } from './parts'
import { formatRemaining, remainingRealMs } from './time'

const viewAtom = atom({ plugin: 'promptfall', key: 'view' } as const, null)
const prefsAtom = atom({ plugin: 'promptfall', key: 'prefs' } as const, PREFS_DEFAULT)
const modeAtom = atom({ plugin: 'promptfall', key: 'mode' } as const, 'primary')
const noticeAtom = atom({ plugin: 'promptfall', key: 'notice' } as const, null)
const worldAtom = atom({ plugin: 'promptfall', key: 'world' } as const, WORLD_DEFAULT)
const settingsAtom = atom({ plugin: 'promptfall', key: 'settings' } as const, SETTINGS_DEFAULT)
const rendererAtom = atom({ plugin: 'promptfall', key: 'renderer' } as const, 'unknown')

const MIN_COLUMNS = 100
const REST_ROWS = 4

/** The one-line form: `Promptfall · Z3 w4 · K184 B90 W140 · 1,240g`. */
export function collapsedLine(view: GameView, mode: Mode, notice: string | null): string {
  const wave = view.wave >= 11 ? 'boss' : `w${view.wave}`
  const hp = view.heroes.map((h) => `${CLASS_INITIAL[h.cls] ?? '?'}${h.hp}`).join(' ')
  const parts = ['Promptfall', `Z${view.zone} ${wave}`, hp, formatGold(view.gold)]
  if (notice) parts.push(notice)
  const line = parts.join(' · ')
  return mode === 'secondary' ? `playing in another session · ${line}` : line
}

export { type ShownBoss, shownBoss } from './boss'

const BOSS_BAR_CELLS = 8

function pctOf(shown: ShownBoss): number {
  return shown.boss.maxHp > 0 ? Math.floor((shown.shownHp * 100) / shown.boss.maxHp) : 0
}

function remainingOf(shown: ShownBoss, world: WorldState, now: number): string {
  if (!world.clock) return ''
  return formatRemaining(remainingRealMs(shown.boss.endsAt, world.clock, now))
}

/** The status row's boss segment while the boss is live: `boss 62% · 11m`. */
export function bossSegment(view: GameView, world: WorldState, now: number): string | null {
  const shown = shownBoss(view, world)
  if (!shown || shown.boss.hp <= 0) return null
  return `boss ${pctOf(shown)}% · ${remainingOf(shown, world, now)}`
}

/** The World tab's three rows: who is around, the account's records or the boss, the chat ticker. */
export function worldRows(
  view: GameView,
  world: WorldState,
  now = 0,
): { text: string; dim: boolean }[] {
  const open = gates(world, view.account)
  const snapshot = world.snapshot
  let presence: { text: string; dim: boolean }
  if (!open.presenceOpen) presence = { text: 'presence is off', dim: true }
  else if (!snapshot) presence = { text: 'connecting to the world…', dim: true }
  else {
    const here = snapshot.here.length > 0 ? snapshot.here.join(', ') : 'nobody else here'
    presence = { text: `${snapshot.online} online · zone ${view.zone}: ${here}`, dim: world.stale }
  }
  const shown = shownBoss(view, world)
  let records = `highest zone ${view.highestZone} · kills ${view.kills} · wipes ${view.wipes}${view.farm ? ' · farming' : ''}`
  if (shown && shown.boss.hp > 0) {
    const max = shown.boss.maxHp
    const filled =
      max > 0 ? Math.min(BOSS_BAR_CELLS, Math.ceil((shown.shownHp * BOSS_BAR_CELLS) / max)) : 0
    const bar = '█'.repeat(filled) + '░'.repeat(BOSS_BAR_CELLS - filled)
    records = `World boss ${shown.boss.name} ${bar} ${pctOf(shown)}% · ${remainingOf(shown, world, now)} left · you ${formatCount(shown.dealt)}`
  } else if (shown) {
    records = `${shown.boss.name} is down · you ${formatCount(shown.dealt)}`
  }
  const last = world.messages.at(-1)
  const chat = !open.chatOpen
    ? {
        text: view.account.server === IN_PROCESS ? 'chat needs a server' : 'chat is closed',
        dim: true,
      }
    : last
      ? { text: `${last.name}: ${last.text}`, dim: false }
      : { text: 'chat is quiet', dim: true }
  return [presence, { text: records, dim: false }, chat]
}

type Els = Pick<Elements['terminal'], 'Box' | 'Text'>

/** One transparent pixel: what the probe's Image draws first. */
const PROBE_A = { rgba: encode(Uint8Array.of(0, 0, 0, 0)), width: 1, height: 1 }
/** One pixel of alpha 1: a source different from PROBE_A, so the blit is a real swap. */
const PROBE_B = { rgba: encode(Uint8Array.of(0, 0, 0, 1)), width: 1, height: 1 }
/** The SVG's CSS pixels per stage column. */
const SVG_PX_PER_COLUMN = 8
const STATUS_TABS_WIDTH = 36

/** A probe armed and not yet answered; module state, so a reload may arm one more. */
let probePending = false
/** For a band drawn without a running game (a hot reload before session.start): drawing only. */
const looseTimeline = new StageTimeline()

/** The compact layout's three hero rows, each with its enemy slot, in `width` columns. */
function heroRows(els: Els, view: GameView, world: WorldState, width: number) {
  const { Box, Text } = els
  const bar = 6
  const enemyWidth = Math.max(12, Math.floor(width / 3))
  // The class (7), the level (5), the bar and the hp (9) take the rest.
  const nameWidth = Math.max(4, width - enemyWidth - (21 + bar))
  const shown = view.boss ? shownBoss(view, world) : null
  const rows = []
  for (let i = 0; i < 3; i++) {
    const hero = view.heroes[i]
    const enemy = view.enemies[i]
    const enemyText = enemy
      ? `${i === 0 ? '⚔' : ' '} ${enemy.glyph} ${enemy.name} ${enemy.hp}/${enemy.maxHp}`
      : ''
    const slotText = (text: string) => (
      <Text wrap="truncate">{padEnd(` ${clip(text, enemyWidth - 2)}`, enemyWidth)}</Text>
    )
    let enemySlot = slotText(enemyText)
    if (view.boss) {
      // Boss mode: the slot's first row is the boss's name, the second its bar (or what
      // you dealt, when the snapshot has no such boss), the third empty.
      if (i === 0) enemySlot = slotText(`⚔ ${view.boss.glyph} ${view.boss.name}`)
      else if (i === 1 && shown?.engaged) {
        const hpText = `${formatCount(shown.shownHp)}/${formatCount(shown.boss.maxHp)}`
        enemySlot = (
          <Box key="boss-slot" flexDirection="row">
            <Text>{'   '}</Text>
            {HpBar(els, shown.shownHp, shown.boss.maxHp, bar)}
            <Text wrap="truncate">{padEnd(` ${hpText}`, Math.max(0, enemyWidth - 3 - bar))}</Text>
          </Box>
        )
      } else if (i === 1) enemySlot = slotText(`  you ${formatCount(view.boss.dealt)}`)
      else enemySlot = slotText('')
    }
    rows.push(
      <Box key={`row-${i}`} flexDirection="row">
        {hero ? ClassGlyph(els, hero.cls) : <Text>{padEnd('', 7)}</Text>}
        <Text dimColor={hero ? !hero.alive : true} wrap="truncate">
          {padEnd(hero?.name ?? '', nameWidth)}
        </Text>
        <Text wrap="truncate">{hero ? ` L${padEnd(String(hero.level), 3)}` : ''}</Text>
        {hero ? HpBar(els, hero.hp, hero.maxHp, bar) : <Text> </Text>}
        <Text wrap="truncate">{hero ? padStart(`${hero.hp}/${hero.maxHp}`, 9) : ''}</Text>
        {enemySlot}
      </Box>,
    )
  }
  return rows
}

export function registerBand(on: On, game: () => GameHandle | null): void {
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const view = await read($, viewAtom)
    const mode = await read($, modeAtom)
    const handle = game()
    const loop = handle?.stage.loopFor(e.surface) ?? null
    if (e.props.hasSurvey || mode === 'off') {
      loop?.mount(null)
      return next(e)
    }
    const notice = await read($, noticeAtom)
    if (view === null) {
      loop?.mount(null)
      // No game to draw (an older version's data, or no server yet): the notice alone, on one line.
      // Every notice already names the game.
      if (!notice) return next(e)
      const { Box, Text } = $.ui.resolve(e)
      const width = Math.max(20, e.props.bodyColumns)
      return (
        <Box key="band" flexDirection="column">
          <Text key="row-notice" wrap="truncate">
            {clip(notice, width - 2)}
          </Text>
        </Box>
      )
    }
    const prefs: Prefs = (await read($, prefsAtom)) ?? PREFS_DEFAULT
    const world: WorldState = (await read($, worldAtom)) ?? WORLD_DEFAULT
    const settings: Settings = (await read($, settingsAtom)) ?? SETTINGS_DEFAULT
    const now = await $.clock.now()
    const els = $.ui.resolve(e)
    const { Box, Text, Button } = els
    const width = Math.max(20, e.props.bodyColumns)

    const setPrefs = (patch: Partial<Prefs>) =>
      update($, prefsAtom, (p) => ({ ...(p ?? PREFS_DEFAULT), ...patch }))

    // The Party tab sizes itself to the stage; Loot and World keep four rows.
    const party = prefs.bandTab === 'party'
    const timeline = handle?.stage.timeline ?? looseTimeline
    let layout: Layout = layoutFor(4, e.props)
    if (party) {
      timeline.observe(view, now)
      layout = layoutFor(timeline.rowsAt(view, now), e.props)
    }
    const collapsed =
      prefs.collapsed ||
      mode !== 'primary' ||
      layout.kind === 'collapsed' ||
      e.props.bodyColumns < MIN_COLUMNS ||
      e.props.maxRows < REST_ROWS

    if (collapsed) {
      loop?.mount(null)
      return (
        <Box key="band" flexDirection="column">
          <Box key="row-collapsed" flexDirection="row">
            <Text wrap="truncate">{clip(collapsedLine(view, mode, notice), width - 6)} </Text>
            <Button
              key="collapse"
              label={prefs.collapsed ? '▸' : '·'}
              hotkey="c"
              plain
              dimColor
              onPress={() => setPrefs({ collapsed: !prefs.collapsed })}
            />
          </Box>
        </Box>
      )
    }

    // The stage: an element sized to the layout's box, its first frame drawn here so a redraw
    // is never blank; the loop blits every frame after it.
    let stage = null
    let probe = null
    if (party && layout.box) {
      const box = layout.box
      if (e.surface !== 'terminal') {
        if ('Svg' in els) {
          const model = stageAt(view, timeline, now, box, {
            compact: layout.kind === 'compact',
            motion: settings.motion,
          })
          const source = renderSvg(model, timeline.active(now), {
            smil: SVG_SMIL,
            now,
            width: box.columns * SVG_PX_PER_COLUMN,
            motion: settings.motion,
          })
          const { Svg } = els
          stage = (
            <Svg
              key="stage"
              source={source}
              alt={model.alt}
              width={box.columns * SVG_PX_PER_COLUMN}
              isInteractive={SVG_SMIL}
            />
          )
        }
        loop?.mount(
          SVG_SMIL
            ? null
            : { requestId: e.requestId, key: 'stage', layout, renderer: 'svg', props: e.props },
        )
      } else if ('Raster' in els) {
        const renderer = await read($, rendererAtom)
        if (renderer === 'unknown') {
          // Empty rows while the probe decides, so the band's height does not jump when it lands.
          stage = (
            <Box key="stage-empty" flexDirection="column">
              {Array.from({ length: box.rows }, (_, i) => (
                <Text key={`stage-empty-${i}`}> </Text>
              ))}
            </Box>
          )
          loop?.mount(null)
          if (settings.renderer === 'auto') {
            const { Image } = els
            probe = <Image key="probe" source={PROBE_A} columns={1} rows={1} alt=" " />
            if (!probePending) {
              probePending = true
              const requestId = e.requestId
              $.clock.after(PROBE_DELAY_MS, () => {
                void (async () => {
                  const r = await $.ui.blit({ requestId, key: 'probe', source: PROBE_B })
                  probePending = false
                  // Only the no-pictures deny settles on raster; any other leaves it unknown.
                  if (r.deny === undefined) await update($, rendererAtom, () => 'image')
                  else if (r.deny.startsWith(PROBE_ALT_DENY))
                    await update($, rendererAtom, () => 'raster')
                })()
              })
            }
          }
        } else {
          const frame = stageFrame(view, timeline, now, layout, renderer, settings.motion)
          const { Raster, Image } = els
          if ('cells' in frame) {
            stage = <Raster key="stage" columns={box.columns} rows={box.rows} cells={frame.cells} />
          } else {
            const model = stageAt(view, timeline, now, box, {
              compact: layout.kind === 'compact',
              motion: settings.motion,
            })
            stage = (
              <Image
                key={stageKey(box)}
                source={frame.source}
                columns={box.columns}
                rows={box.rows}
                alt={model.alt}
              />
            )
          }
          const key = renderer === 'image' ? stageKey(box) : 'stage'
          loop?.mount({ requestId: e.requestId, key, layout, renderer, props: e.props })
        }
      }
    } else {
      loop?.mount(null)
    }

    const statusRow = (rowWidth: number) => {
      const tail =
        notice ??
        bossSegment(view, world, now) ??
        (view.lastDrop ? `last: ${view.lastDrop.text}` : 'no drops yet')
      const status = `Zone ${view.zone} ${view.zoneName} · ${waveLabel(view.wave)} · ${formatGold(view.gold)} · ${tail}`
      return (
        <Box key="row-status" flexDirection="row">
          <Text wrap="truncate">
            {`${padEnd(status, rowWidth - STATUS_TABS_WIDTH - 1 - (probe ? 1 : 0))} `}
          </Text>
          <Button
            key="tab-party"
            label="party"
            hotkey="p"
            plain
            dimColor={prefs.bandTab !== 'party'}
            onPress={() => setPrefs({ bandTab: 'party' })}
          />
          <Text> </Text>
          <Button
            key="tab-loot"
            label="loot"
            hotkey="l"
            plain
            dimColor={prefs.bandTab !== 'loot'}
            onPress={() => setPrefs({ bandTab: 'loot' })}
          />
          <Text> </Text>
          <Button
            key="tab-world"
            label="world"
            hotkey="w"
            plain
            dimColor={prefs.bandTab !== 'world'}
            onPress={() => setPrefs({ bandTab: 'world' })}
          />
          <Text> </Text>
          <Button
            key="collapse"
            label="▾"
            hotkey="c"
            plain
            dimColor
            onPress={() => setPrefs({ collapsed: true })}
          />
          {probe}
        </Box>
      )
    }

    if (party && layout.kind === 'full') {
      return (
        <Box key="band" flexDirection="column">
          <Box key="row-stage" flexDirection="row">
            {stage}
          </Box>
          {PartyLine(els, view, world, width)}
          {statusRow(width)}
        </Box>
      )
    }

    if (party && layout.kind === 'compact') {
      const left = Math.max(20, width - COMPACT_STAGE_COLUMNS)
      return (
        <Box key="band" flexDirection="column">
          <Box key="row-compact" flexDirection="row">
            <Box key="compact-rows" flexDirection="column">
              {heroRows(els, view, world, left)}
              {statusRow(left)}
            </Box>
            {stage}
          </Box>
        </Box>
      )
    }

    const rows = []
    if (prefs.bandTab === 'loot') {
      const lines = view.loot.slice(-3)
      for (let i = 0; i < 3; i++) {
        const line = lines[i]
        rows.push(
          <Box key={`row-${i}`} flexDirection="row">
            {line ? (
              RarityText(els, clip(line.text, width), line.rarity)
            ) : (
              <Text dimColor>{i === 0 ? 'No loot yet' : ' '}</Text>
            )}
          </Box>,
        )
      }
    } else {
      worldRows(view, world, now).forEach((row, i) => {
        rows.push(
          <Box key={`row-${i}`} flexDirection="row">
            <Text key={`world-${i}`} dimColor={row.dim} wrap="truncate">
              {clip(row.text, width)}
            </Text>
          </Box>,
        )
      })
    }
    rows.push(statusRow(width))
    return (
      <Box key="band" flexDirection="column">
        {rows}
      </Box>
    )
  })
}
