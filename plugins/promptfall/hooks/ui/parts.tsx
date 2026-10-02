import type { Elements } from 'claude-code'
import { CLASS_LABEL, padEnd } from './format'

type Els = Pick<Elements['terminal'], 'Text'>

export const RARITY_COLOR: Record<string, string | undefined> = {
  common: undefined,
  uncommon: 'green',
  rare: 'blue',
  epic: 'magenta',
  legendary: 'yellow',
}

const CELLS = 10

/** A 10-cell bar, coloured by how much is left. */
export function HpBar(els: Els, hp: number, max: number) {
  const { Text } = els
  const filled = max > 0 ? Math.max(0, Math.min(CELLS, Math.ceil((hp * CELLS) / max))) : 0
  const color = hp <= 0 ? 'gray' : hp * 4 <= max ? 'red' : hp * 2 <= max ? 'yellow' : 'green'
  return (
    <Text color={color} wrap="truncate">
      {'█'.repeat(filled) + '░'.repeat(CELLS - filled)}
    </Text>
  )
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
