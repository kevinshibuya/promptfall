// The Heroes tab as windows (docs/plans/2026-10-06-ui-pr2-pane-windows.md, "Window contents"): the
// roster list with its recruit row, the hero's detail (a party window of one, grill 1.19), its
// command window, the dismiss Yes/No, and the sell window in the detail's place.
import type { RosterHeroView } from '../../../types'
import { spriteFor } from '../../sprites/index'
import { RARITY_RGB } from '../../stage/tuning'
import type { Line } from '../../windows/kit'
import { DIM_RGB, DOWN_RGB, HP_BAR_RGB, MOVE_HELP, TEXT_RGB, WARN_RGB } from '../../windows/tuning'
import { CLASS_LABEL, clip } from '../format'
import { wrap } from '../strip'
import { cursorRow, type MenuItem, paneLayout } from './frame'
import type { PaneInput } from './input'
import { gold, listInner, rowSpans } from './inventory'
import { type ListRow, type ListSpec, listPane } from './list'
import type { PaneAction, PaneBuild } from './types'

const TRADEABLE = new Set(['rare', 'epic', 'legendary'])
const CLASS_CELLS = 10
const LEVEL_CELLS = 3
const MARK_CELLS = 5
const HP_BAR_CELLS = 8
const NEXT_ZONE = 'A new party takes the field at the next zone change.'

function mark(input: PaneInput, h: RosterHeroView): string {
  if (input.dialog.partyPick.includes(h.id)) return 'pick'
  if (h.inPendingParty) return 'next'
  if (h.inParty) return 'party'
  return ''
}

function status(input: PaneInput, h: RosterHeroView): string | null {
  if (input.dialog.partyPick.includes(h.id)) return 'Picked for the new party'
  if (h.inPendingParty && !h.inParty) return 'Joins at the next zone'
  if (h.inParty) return 'In the party'
  return null
}

function heroDetail(input: PaneInput, h: RosterHeroView, inner: number): Line[] {
  const { view } = input
  const line = (text: string, rgb?: number): Line => ({
    spans: [{ gap: 1 }, { text: clip(text, inner - 1), ...(rgb !== undefined ? { rgb } : {}) }],
  })
  const head: Line = {
    spans: [
      { gap: 1 },
      { text: clip(`${h.name} L${h.level}`, inner - 1), rgb: RARITY_RGB[h.rarity] ?? TEXT_RGB },
    ],
    rule: true,
  }
  const cls = line(`${CLASS_LABEL[h.cls] ?? h.cls} · ${h.rarity}`)
  const live = h.inParty ? view.heroes.find((x) => x.id === h.id) : undefined
  let hp: Line | null = null
  if (live) {
    const down = !live.alive || live.hp <= 0
    const rgb = down ? DOWN_RGB : live.hp * 4 < live.maxHp ? WARN_RGB : HP_BAR_RGB
    const fill = live.maxHp > 0 ? Math.floor((Math.max(0, live.hp) * 10000) / live.maxHp) : 0
    hp = {
      spans: [
        { gap: 1 },
        { text: `H ${Math.max(0, live.hp)}/${live.maxHp}` },
        { gap: 1 },
        { bar: fill, cells: HP_BAR_CELLS, rgb },
      ],
    }
  }
  const traits =
    h.traits.length > 0 ? wrap(`Traits: ${h.traits.join(', ')}`, inner - 1).map((t) => line(t)) : []
  const named = (id: string | null) =>
    id ? (view.inventory.find((i) => i.id === id)?.name ?? '-') : '-'
  const gear = [
    line(`Weapon    ${named(h.equipment.weapon)}`),
    line(`Armour    ${named(h.equipment.armour)}`),
    line(`Accessory ${named(h.equipment.accessory)}`),
  ]
  const st = status(input, h)
  const statusLine = st ? [line(st)] : []
  if (paneLayout(input.columns, input.rows).kind === 'narrow') {
    return [head, cls, ...(hp ? [hp] : traits.slice(0, 1)), ...statusLine]
  }
  return [head, cls, ...(hp ? [hp] : []), ...traits, ...gear, ...statusLine]
}

type Command = MenuItem & { action: PaneAction }

export function heroCommands(input: PaneInput, h: RosterHeroView): Command[] {
  const picked = input.dialog.partyPick.includes(h.id)
  const out: Command[] = [
    { label: picked ? 'Unpick' : 'Party', hotkey: 'p', action: { t: 'party', heroId: h.id } },
  ]
  if (TRADEABLE.has(h.rarity) && input.running)
    out.push({ label: 'Sell', hotkey: 's', action: { t: 'sell', kind: 'hero', id: h.id } })
  if (!h.inParty && !h.inPendingParty) {
    out.push({
      label: 'Dismiss',
      hotkey: 'd',
      action: { t: 'open', menu: { kind: 'confirm', action: 'dismiss', id: h.id, at: 0 } },
    })
  }
  return out
}

export function heroesPane(input: PaneInput): PaneBuild {
  const { view, dialog } = input
  const roster = view.roster
  const inner = listInner(input)
  const rows: ListRow[] = roster.map((h) => {
    const m = mark(input, h)
    return {
      key: `row:${h.id}`,
      spans: rowSpans(
        inner,
        input.art ? { art: spriteFor('hero', h.cls).full } : null,
        { text: h.name, rgb: RARITY_RGB[h.rarity] ?? TEXT_RGB },
        [
          { text: CLASS_LABEL[h.cls] ?? h.cls, cells: CLASS_CELLS },
          { text: `L${h.level}`, cells: LEVEL_CELLS },
          { text: m, cells: MARK_CELLS, rgb: DIM_RGB },
        ],
      ),
      action: input.readOnly
        ? { t: 'none' }
        : { t: 'open', menu: { kind: 'actions', tab: 'heroes', id: h.id, at: 0 } },
      alt: `${h.name}, ${CLASS_LABEL[h.cls] ?? h.cls} level ${h.level}, ${h.rarity}${m ? `, ${m}` : ''}`,
    }
  })
  if (!input.readOnly) {
    const short = view.gold < view.tavernPrice
    const rgb = short ? DIM_RGB : TEXT_RGB
    rows.push({
      key: 'row:recruit',
      spans: rowSpans(inner, input.art ? { gap: 2 } : null, { text: 'Recruit a hero', rgb }, [
        { text: gold(view.tavernPrice), cells: Math.max(5, gold(view.tavernPrice).length), rgb },
      ]),
      action: { t: 'event', event: { t: 'recruit' } },
      alt: `Recruit a hero, ${gold(view.tavernPrice)}`,
    })
  }
  const ids = rows.map((r) => r.key.slice(4))
  const cursor = cursorRow(dialog.cursor.heroes ?? null, ids)
  const current = roster.find((h) => h.id === ids[cursor])

  const picks = dialog.partyPick
  const pickLine =
    picks.length > 0
      ? `New party: ${picks.map((id) => roster.find((h) => h.id === id)?.name ?? id).join(', ')} (pick ${3 - picks.length} more).`
      : null
  const spec: ListSpec = {
    title: [{ text: `Roster ${roster.length}/${view.rosterCap} · ${gold(view.gold)}` }],
    altTitle: `Roster ${roster.length} of ${view.rosterCap}, ${gold(view.gold)}`,
    rows,
    empty: 'No heroes.',
    cursor,
    detail: current ? (w) => heroDetail(input, current, w) : null,
    menu: null,
    yesNo: null,
    state: [pickLine ?? `Enter: actions. ${MOVE_HELP}`, NEXT_ZONE],
  }

  const menu = input.readOnly ? null : dialog.menu
  const hero = menu && 'id' in menu ? roster.find((h) => h.id === menu.id) : undefined
  if (menu && hero) {
    if (menu.kind === 'actions' && menu.tab === 'heroes') {
      const commands = heroCommands(input, hero)
      spec.menu = {
        header: [{ text: hero.name }],
        items: commands,
        at: Math.max(0, Math.min(commands.length - 1, menu.at)),
      }
      spec.state = [`What will you do with ${hero.name}?`, 'q: back.']
    } else if (menu.kind === 'confirm' && menu.action === 'dismiss') {
      spec.yesNo = { at: menu.at, yes: { t: 'event', event: { t: 'dismiss', heroId: hero.id } } }
      spec.state = [`Dismiss ${hero.name}? They leave for good.`, '']
    }
    spec.detail = (w) => heroDetail(input, hero, w)
  }
  return listPane(input, spec)
}
