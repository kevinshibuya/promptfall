import { atom, type On, read, update } from 'claude-code'
import type { BossView, GameView, Mode, Prefs, WorldState } from '../../types'
import { IN_PROCESS } from '../server'
import { PREFS_DEFAULT, WORLD_DEFAULT } from '../state'
import { gates } from '../view'
import { CLASS_INITIAL, clip, formatCount, formatGold, padEnd, padStart, waveLabel } from './format'
import { ClassGlyph, HpBar, RarityText } from './parts'
import { formatRemaining, remainingRealMs } from './time'

const viewAtom = atom({ plugin: 'promptfall', key: 'view' } as const, null)
const prefsAtom = atom({ plugin: 'promptfall', key: 'prefs' } as const, PREFS_DEFAULT)
const modeAtom = atom({ plugin: 'promptfall', key: 'mode' } as const, 'primary')
const noticeAtom = atom({ plugin: 'promptfall', key: 'notice' } as const, null)
const worldAtom = atom({ plugin: 'promptfall', key: 'world' } as const, WORLD_DEFAULT)

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

/** The snapshot's boss as this session shows it, or null when there is none. */
export type ShownBoss = {
  boss: BossView
  /** The server's HP less what this party dealt locally beyond its committed tally. */
  shownHp: number
  /** This party's tally: the view's when engaged with this boss, else the server's `yours`. */
  dealt: number
  /** True when the view is in boss mode for this boss. */
  engaged: boolean
}

/**
 * The predicted bar (R5): the server's HP wins at each poll; between polls a
 * primary subtracts what it dealt past the committed tally it reported then.
 * A null or foreign `committedDealt` subtracts nothing.
 */
export function shownBoss(view: GameView, world: WorldState): ShownBoss | null {
  const boss = world.snapshot?.boss
  if (!boss) return null
  const mine = view.boss?.bossId === boss.bossId ? view.boss : null
  if (!mine) return { boss, shownHp: boss.hp, dealt: boss.yours, engaged: false }
  const baseline =
    world.committedDealt?.bossId === boss.bossId ? world.committedDealt.dealt : mine.dealt
  const shownHp = Math.max(0, boss.hp - Math.max(0, mine.dealt - baseline))
  return { boss, shownHp, dealt: mine.dealt, engaged: true }
}

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

export function registerBand(on: On): void {
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const view = await read($, viewAtom)
    const mode = await read($, modeAtom)
    if (e.props.hasSurvey || mode === 'off') return next(e)
    const notice = await read($, noticeAtom)
    if (view === null) {
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
    const now = await $.clock.now()
    const { Box, Text, Button } = $.ui.resolve(e)
    const els = { Text }
    const width = Math.max(20, e.props.bodyColumns)

    const setPrefs = (patch: Partial<Prefs>) =>
      update($, prefsAtom, (p) => ({ ...(p ?? PREFS_DEFAULT), ...patch }))

    const collapsed =
      prefs.collapsed ||
      mode !== 'primary' ||
      e.props.bodyColumns < MIN_COLUMNS ||
      e.props.maxRows < REST_ROWS

    if (collapsed) {
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

    const enemyWidth = Math.floor(width / 3)
    const leftWidth = width - enemyWidth
    const nameWidth = Math.max(6, Math.min(30, leftWidth - 33))

    const rows = []
    if (prefs.bandTab === 'party') {
      for (let i = 0; i < 3; i++) {
        const hero = view.heroes[i]
        const enemy = view.enemies[i]
        const enemyText = enemy
          ? `${i === 0 ? '⚔' : ' '} ${enemy.glyph} ${enemy.name} ${enemy.hp}/${enemy.maxHp}`
          : ''
        const shown = view.boss ? shownBoss(view, world) : null
        let enemySlot = (
          <Text wrap="truncate">{padEnd(` ${clip(enemyText, enemyWidth - 2)}`, enemyWidth)}</Text>
        )
        if (view.boss) {
          // Boss mode: the slot's first row is the boss's name, the second its bar (or what
          // you dealt, when the snapshot has no such boss), the third empty.
          const slotText = (text: string) => (
            <Text wrap="truncate">{padEnd(` ${clip(text, enemyWidth - 2)}`, enemyWidth)}</Text>
          )
          if (i === 0) enemySlot = slotText(`⚔ ${view.boss.glyph} ${view.boss.name}`)
          else if (i === 1 && shown?.engaged) {
            const hpText = `${formatCount(shown.shownHp)}/${formatCount(shown.boss.maxHp)}`
            enemySlot = (
              <Box key="boss-slot" flexDirection="row">
                <Text>{'   '}</Text>
                {HpBar(els, shown.shownHp, shown.boss.maxHp)}
                <Text wrap="truncate">{padEnd(` ${hpText}`, enemyWidth - 13)}</Text>
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
            {hero ? HpBar(els, hero.hp, hero.maxHp) : <Text> </Text>}
            <Text wrap="truncate">{hero ? padStart(`${hero.hp}/${hero.maxHp}`, 9) : ''}</Text>
            {enemySlot}
          </Box>,
        )
      }
    } else if (prefs.bandTab === 'loot') {
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

    const tail =
      notice ??
      bossSegment(view, world, now) ??
      (view.lastDrop ? `last: ${view.lastDrop.text}` : 'no drops yet')
    const status = `Zone ${view.zone} ${view.zoneName} · ${waveLabel(view.wave)} · ${formatGold(view.gold)} · ${tail}`
    const tabsWidth = 36
    rows.push(
      <Box key="row-status" flexDirection="row">
        <Text wrap="truncate">{padEnd(status, width - tabsWidth)}</Text>
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
      </Box>,
    )

    return (
      <Box key="band" flexDirection="column">
        {rows}
      </Box>
    )
  })
}
