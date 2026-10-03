import { atom, type On, read, update } from 'claude-code'
import type { GameView, Mode, Prefs, WorldState } from '../../types'
import { PREFS_DEFAULT, WORLD_DEFAULT } from '../state'
import { gates } from '../view'
import { CLASS_INITIAL, clip, formatGold, padEnd, padStart, waveLabel } from './format'
import { ClassGlyph, HpBar, RarityText } from './parts'

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

/** The World tab's three rows: who is around, the account's records, the chat ticker. */
export function worldRows(view: GameView, world: WorldState): { text: string; dim: boolean }[] {
  const open = gates(world, view.account)
  const snapshot = world.snapshot
  let presence: { text: string; dim: boolean }
  if (!open.presenceOpen) presence = { text: 'presence is off', dim: true }
  else if (!snapshot) presence = { text: 'connecting to the world…', dim: true }
  else {
    const here = snapshot.here.length > 0 ? snapshot.here.join(', ') : 'nobody else here'
    presence = { text: `${snapshot.online} online · zone ${view.zone}: ${here}`, dim: world.stale }
  }
  const records = `highest zone ${view.highestZone} · kills ${view.kills} · wipes ${view.wipes}${view.farm ? ' · farming' : ''}`
  const last = world.messages.at(-1)
  const chat = !open.chatOpen
    ? { text: 'chat is closed', dim: true }
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
        rows.push(
          <Box key={`row-${i}`} flexDirection="row">
            {hero ? ClassGlyph(els, hero.cls) : <Text>{padEnd('', 7)}</Text>}
            <Text dimColor={hero ? !hero.alive : true} wrap="truncate">
              {padEnd(hero?.name ?? '', nameWidth)}
            </Text>
            <Text wrap="truncate">{hero ? ` L${padEnd(String(hero.level), 3)}` : ''}</Text>
            {hero ? HpBar(els, hero.hp, hero.maxHp) : <Text> </Text>}
            <Text wrap="truncate">{hero ? padStart(`${hero.hp}/${hero.maxHp}`, 9) : ''}</Text>
            <Text wrap="truncate">{padEnd(` ${clip(enemyText, enemyWidth - 2)}`, enemyWidth)}</Text>
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
      worldRows(view, world).forEach((row, i) => {
        rows.push(
          <Box key={`row-${i}`} flexDirection="row">
            <Text key={`world-${i}`} dimColor={row.dim} wrap="truncate">
              {clip(row.text, width)}
            </Text>
          </Box>,
        )
      })
    }

    const tail = notice ?? (view.lastDrop ? `last: ${view.lastDrop.text}` : 'no drops yet')
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
