import type { Elements } from 'claude-code'
import type { GameView, WorldState } from '../../types'
import { shownBoss } from './boss'
import { CLASS_LABEL, clip, formatCount, padEnd, padStart } from './format'

type Els = Pick<Elements['terminal'], 'Text'>

export const RARITY_COLOR: Record<string, string | undefined> = {
  common: undefined,
  uncommon: 'green',
  rare: 'blue',
  epic: 'magenta',
  legendary: 'yellow',
}

/** A bar of `cells` cells (10 by default), coloured by how much is left. */
export function HpBar(els: Els, hp: number, max: number, cells = 10) {
  const { Text } = els
  const filled = max > 0 ? Math.max(0, Math.min(cells, Math.ceil((hp * cells) / max))) : 0
  const color = hp <= 0 ? 'gray' : hp * 4 <= max ? 'red' : hp * 2 <= max ? 'yellow' : 'green'
  return (
    <Text color={color} wrap="truncate">
      {'█'.repeat(filled) + '░'.repeat(cells - filled)}
    </Text>
  )
}

/** One hero's segment of the party line: 27 columns. */
const HERO_SEGMENT = 27
const SEPARATOR = ' · '
const PARTY_BAR = 6

/**
 * The line under the stage: `<name> L<level> <bar> <hp>/<max>` per hero, joined by ` · `, then
 * the front enemy (or, in boss mode, the world boss with its predicted bar) right-aligned in
 * what is left of `width`. With `wrap` (the Svg surfaces, whose text is proportional and whose
 * band grows) each hero and the enemy is a whole segment, and a segment that does not fit starts
 * the next row: no hero is cut and the boss keeps its name and bar.
 */
export function PartyLine(
  els: Els & Pick<Elements['terminal'], 'Box'>,
  view: GameView,
  world: WorldState,
  width: number,
  wrap = false,
) {
  const { Box, Text } = els
  const heroes = view.heroes.slice(0, 3).flatMap((hero, i) => {
    const parts = [
      ...(i > 0 ? [<Text key={`sep-${i}`}>{SEPARATOR}</Text>] : []),
      <Text key={`hero-${i}`} dimColor={!hero.alive} wrap="truncate">
        {`${padEnd(clip(hero.name, 8), 8)} L${padEnd(String(hero.level), 2)} `}
      </Text>,
      HpBar(els, hero.hp, hero.maxHp, PARTY_BAR),
      <Text key={`hp-${i}`} wrap="truncate">
        {padStart(`${hero.hp}/${hero.maxHp}`, HERO_SEGMENT - 13 - PARTY_BAR)}
      </Text>,
    ]
    return wrap
      ? [
          <Box key={`seg-${i}`} flexDirection="row">
            {parts}
          </Box>,
        ]
      : parts
  })
  // Wrapped, the enemy segment is as wide as it needs, up to a row of its own.
  const room = wrap ? width : Math.max(0, width - (HERO_SEGMENT * 3 + SEPARATOR.length * 3))
  const fit = (text: string) => (wrap ? clip(text, room) : padStart(clip(text, room), room))
  let enemy = (
    <Text key="enemy" wrap="truncate">
      {room > 0 ? fit(frontEnemy(view)) : ''}
    </Text>
  )
  if (view.boss) {
    const shown = shownBoss(view, world)
    const name = `⚔ ${clip(view.boss.name, 12)} `
    const hp = shown?.engaged
      ? ` ${formatCount(shown.shownHp)}/${formatCount(shown.boss.maxHp)}`
      : ''
    // `⚔ ` + the name + a space + the bar + the hp: the name gives way first, so the segment never
    // runs past `room` and squeezes the hero segments; with no room for a name, no bar either.
    const nameRoom = room - 3 - PARTY_BAR - [...hp].length
    if (shown?.engaged && nameRoom >= 4) {
      const label = `⚔ ${clip(view.boss.name, Math.min(12, nameRoom))} `
      const pad = wrap ? 0 : Math.max(0, room - [...label].length - PARTY_BAR - [...hp].length)
      enemy = (
        <Box key="enemy" flexDirection="row">
          <Text wrap="truncate">{' '.repeat(pad) + label}</Text>
          {HpBar(els, shown.shownHp, shown.boss.maxHp, PARTY_BAR)}
          <Text wrap="truncate">{hp}</Text>
        </Box>
      )
    } else if (shown?.engaged) {
      enemy = (
        <Text key="enemy" wrap="truncate">
          {fit(`⚔${hp}`)}
        </Text>
      )
    } else {
      const text = `${name}you ${formatCount(view.boss.dealt)}`
      enemy = (
        <Text key="enemy" wrap="truncate">
          {fit(text)}
        </Text>
      )
    }
  }
  if (wrap) {
    return (
      <Box key="row-party" flexDirection="row" flexWrap="wrap">
        {heroes}
        <Box key="seg-enemy" flexDirection="row" paddingLeft={3}>
          {enemy}
        </Box>
      </Box>
    )
  }
  return (
    <Box key="row-party" flexDirection="row">
      {heroes}
      <Text>{'   '}</Text>
      {enemy}
    </Box>
  )
}

function frontEnemy(view: GameView): string {
  const front = view.enemies[0]
  return front ? `⚔ ${front.name} ${front.hp}/${front.maxHp}` : ''
}

/** Text in its rarity's colour; common is dim. */
export function RarityText(els: Els, text: string, rarity: string) {
  const { Text } = els
  const color = RARITY_COLOR[rarity]
  return color ? (
    <Text color={color} wrap="truncate">
      {text}
    </Text>
  ) : (
    <Text dimColor wrap="truncate">
      {text}
    </Text>
  )
}

/** The class label padded to a column. */
export function ClassGlyph(els: Els, cls: string, width = 7) {
  const { Text } = els
  return (
    <Text bold wrap="truncate">
      {padEnd(CLASS_LABEL[cls] ?? cls, width)}
    </Text>
  )
}
