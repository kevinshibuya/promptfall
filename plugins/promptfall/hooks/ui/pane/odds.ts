// The Odds tab as windows (docs/plans/2026-10-06-ui-pr3-remaining-tabs.md, "Odds"): the drop odds
// as one table (zone, its boss, the tavern), then the inventory and roster expansions as rows.
import { RARITY_RGB } from '../../stage/tuning'
import { content, RARITIES, zoneAt } from '../../vendor/sim.js'
import type { Line, Span } from '../../windows/kit'
import { DIM_RGB, MOVE_HELP, TEXT_RGB } from '../../windows/tuning'
import { padEnd, padStart } from '../format'
import { cursorRow } from './frame'
import type { PaneInput } from './input'
import { gold, listInner, rowSpans } from './inventory'
import { type ListRow, type ListSpec, listPane } from './list'
import type { PaneBuild } from './types'

const NAME_CELLS = 10
const COLUMN_CELLS = 8
/** One table for both: the sim multiplies a hero's base and growth as it does an item's base. */
const RARITY_NOTE = 'Rarity multiplies base stats, heroes and items alike.'
/** The sim scales the rarity's reforge price by the item's tier, as it scales the affixes. */
const REFORGE_NOTE = 'Reforge is priced by rarity and tier.'

/** `12.50%`: hundredths, floored. */
export function percent(weight: number, total: number): string {
  if (total <= 0) return '0%'
  const hundredths = Math.floor((weight * 10000) / total)
  return `${Math.floor(hundredths / 100)}.${String(hundredths % 100).padStart(2, '0')}%`
}

const share = (weights: Record<string, number> | undefined, rarity: string): string => {
  if (!weights) return '-'
  const total = RARITIES.reduce((sum, r) => sum + (weights[r] ?? 0), 0)
  return percent(weights[rarity] ?? 0, total)
}

function tableLine(name: Span, columns: string[]): Span[] {
  return [
    { ...name, text: padEnd('text' in name ? name.text : '', NAME_CELLS) },
    ...columns.map((c) => ({ text: padStart(c, COLUMN_CELLS) })),
  ]
}

export function oddsPane(input: PaneInput): PaneBuild {
  const { view, dialog } = input
  const inner = listInner(input)
  const zone = zoneAt(view.zone)?.def
  const rows: ListRow[] = [
    {
      spans: tableLine({ text: 'Rarity' }, ['Zone', 'Boss', 'Tavern']),
      rule: true,
      alt: 'Rarity, zone, boss, tavern',
    },
  ]
  for (const r of RARITIES) {
    const columns = [
      share(zone?.rarityWeights, r),
      share(zone?.bossRarityWeights, r),
      share(content.tavern.odds, r),
    ]
    // Stops that do nothing, as the board rows are: the page follows the ▶, so the table must
    // take one or a short pane would never show it.
    rows.push({
      key: `row:r-${r}`,
      spans: tableLine({ text: r, rgb: RARITY_RGB[r] ?? TEXT_RGB }, columns),
      action: { t: 'none' },
      alt: `${r}: zone ${columns[0]}, boss ${columns[1]}, tavern ${columns[2]}`,
    })
  }
  rows.push({ spans: [{ text: RARITY_NOTE, rgb: DIM_RGB }], alt: RARITY_NOTE })
  rows.push({ spans: [{ text: REFORGE_NOTE, rgb: DIM_RGB }], alt: REFORGE_NOTE })
  rows.push({ spans: [{ text: 'Expansions' }], rule: true, alt: 'Expansions' })
  const expansion = (
    id: 'inventory' | 'roster',
    label: string,
    cost: number | null,
    max: string,
  ): ListRow => {
    if (cost === null) return { spans: [{ text: max, rgb: DIM_RGB }], alt: max }
    const rgb = view.gold < cost ? DIM_RGB : TEXT_RGB
    return {
      key: `row:expand-${id}`,
      spans: rowSpans(inner, null, { text: label, rgb }, [
        { text: gold(cost), cells: Math.max(5, gold(cost).length), rgb },
      ]),
      action: input.readOnly
        ? { t: 'none' }
        : { t: 'event', event: { t: id === 'inventory' ? 'expand_inventory' : 'expand_roster' } },
      alt: `${label}, ${gold(cost)}`,
    }
  }
  const inv = content.expansions.inventory.step
  const ros = content.expansions.roster.step
  rows.push(
    expansion('inventory', `Inventory +${inv} slots`, view.nextInventoryCost, 'Inventory at max'),
    expansion('roster', `Roster +${ros} heroes`, view.nextRosterCost, 'Roster at max'),
  )

  const ids = rows.flatMap((r) => (r.key ? [r.key.slice(4)] : []))
  const cursor = cursorRow(dialog.cursor.odds ?? null, ids)
  const on = ids[cursor]
  const detail = (): Line[] => {
    const line = (t: string): Line => ({ spans: [{ gap: 1 }, { text: t }] })
    const have = line(`You have ${gold(view.gold)}`)
    if (on === 'expand-inventory' && view.nextInventoryCost !== null) {
      return [
        { spans: [{ gap: 1 }, { text: 'Inventory' }], rule: true },
        line(`${view.inventory.length} of ${view.inventoryCap} slots`),
        line(`+${inv} for ${gold(view.nextInventoryCost)}`),
        have,
      ]
    }
    if (on === 'expand-roster' && view.nextRosterCost !== null) {
      return [
        { spans: [{ gap: 1 }, { text: 'Roster' }], rule: true },
        line(`${view.roster.length} of ${view.rosterCap} heroes`),
        line(`+${ros} for ${gold(view.nextRosterCost)}`),
        have,
      ]
    }
    return []
  }

  const spec: ListSpec = {
    title: [{ text: `Odds · zone ${view.zone}` }],
    altTitle: `Odds in zone ${view.zone}`,
    rows,
    empty: '',
    cursor,
    detail,
    menu: null,
    yesNo: null,
    panel: null,
    error: null,
    state: [
      on?.startsWith('expand-') ? `Enter: buy it. ${MOVE_HELP}` : MOVE_HELP,
      `Drop odds in zone ${view.zone}, its boss, and the tavern.`,
    ],
    field: null,
    link: null,
  }
  return listPane(input, spec)
}
