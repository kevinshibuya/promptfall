// The Journal tab as windows (spec #132, "Journal tab"): Today, a row per base zone reached,
// Collection and Achievements; Enter opens a row's page, a pane menu in the detail column. The
// bestiary and the collection read the view's tallies; the goal, its progress, the streak and the
// achievements read the journal, loaded on open as the leaderboards are.
import type { DailyGoalView, JournalView, PaneMenu } from '../../../types'
import { RARITY_RGB } from '../../stage/tuning'
import { dayOf } from '../../vendor/protocol.js'
import { content, dailyGoal, LADDER_END, RARITIES, zoneAt } from '../../vendor/sim.js'
import type { Line, Span } from '../../windows/kit'
import {
  DETAIL_COLUMNS,
  DIM_RGB,
  GAUGE_FULL_RGB,
  MOVE_HELP,
  TEXT_RGB,
  WARN_RGB,
} from '../../windows/tuning'
import { zonePhrase } from '../../zone-words'
import { formatCount, formatGold, padEnd, padStart } from '../format'
import { cursorRow, type MenuItem, paneLayout } from './frame'
import type { MessageLine, PaneInput } from './input'
import { capital, listInner, rowSpans } from './inventory'
import { type ListRow, type ListSpec, listPane } from './list'
import type { PaneAction, PaneBuild } from './types'

/** The right column of a list row: "45/150", "2/6", "0/200". */
const COUNT_CELLS = 9
/** A zone page's two count columns. */
const PAGE_COUNT_CELLS = 6
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const TRAVEL_LINE = 'Travel from a zone page, or /promptfall travel <zone>.'
const LOADING = 'Loading…'
const NOT_LOADED = 'The journal has not loaded.'

type JournalMenu = Extract<
  PaneMenu,
  { kind: 'journal_zone' | 'journal_collection' | 'journal_achievements' }
>
type PageItem = MenuItem & { action: PaneAction }

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

/** The goal as an order: "Kill 150 enemies", "Beat a turn boss". */
export function goalWords(goal: DailyGoalView): string {
  switch (goal.kind) {
    case 'kills':
      return `Kill ${plural(goal.target, 'enemy', 'enemies')}`
    case 'zone_bosses':
      return `Beat ${plural(goal.target, 'zone boss', 'zone bosses')}`
    case 'rare_drops':
      return `Find ${plural(goal.target, 'Rare or better drop', 'Rare or better drops')}`
    case 'turn_boss':
      return 'Beat a turn boss'
  }
}

/** "Oct 13": a server time as its UTC day. */
function shortDate(at: number): string {
  const d = new Date(at)
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`
}

/** "Resets in 5 h": whole hours, rounded up, so the last hour reads 1 h. */
function resetsIn(ms: number): string {
  return ms <= 0 ? 'Resets now' : `Resets in ${Math.ceil(ms / 3_600_000)} h`
}

/** A base zone's six enemies: its four wave enemies, its zone boss and its turn boss. */
function zoneEnemies(base: number): string[] {
  const z = zoneAt(base)?.def
  return z ? [...z.enemies, z.boss, z.turnBoss] : []
}

function zoneName(base: number): string {
  return zoneAt(base)?.def.name ?? ''
}

/** The highest base zone reached: every one of the twelve past tier 1. */
function highestBase(highestZone: number): number {
  return Math.min(content.zones.length, highestZone)
}

/** The running zones of `base` the party has reached, tier 1 first, but the one it is in. */
function travelZones(base: number, input: PaneInput): number[] {
  const top = Math.min(input.view.highestZone, LADDER_END)
  const zones: number[] = []
  for (let z = base; z <= top; z += content.zones.length) if (z !== input.view.zone) zones.push(z)
  return zones
}

type Achieved = { crossed: number; last: number | null }
function achieved(journal: JournalView | null, id: string): Achieved {
  const steps = journal?.achievements.find((a) => a.id === id)?.steps ?? []
  let crossed = 0
  let last: number | null = null
  for (const s of steps) {
    if (s.step > crossed) {
      crossed = s.step
      last = s.at
    }
  }
  return { crossed, last }
}

const TOTAL_STEPS = content.achievements.reduce((n, a) => n + a.steps.length, 0)
const crossedSteps = (journal: JournalView) =>
  content.achievements.reduce(
    (n, a) => n + Math.min(a.steps.length, achieved(journal, a.id).crossed),
    0,
  )

function collectionCounts(input: PaneInput): { held: number; complete: number; total: number } {
  const bases = Object.keys(content.itemBases)
  let held = 0
  let complete = 0
  for (const id of bases) {
    const marks = input.view.tallies.collection[id]
    const n = RARITIES.filter((r) => (marks?.[r] ?? 0) > 0).length
    held += n
    if (n === RARITIES.length) complete += 1
  }
  return { held, complete, total: bases.length * RARITIES.length }
}

/** The cells a page's line has: its window's columns less the border and the ▶ cell. */
function pageCells(input: PaneInput): number {
  const layout = paneLayout(input.columns, input.rows)
  return (layout.kind === 'wide' ? DETAIL_COLUMNS : layout.columns) - 3
}

function zonePage(input: PaneInput, base: number, cells: number) {
  const tallies = input.view.tallies.enemies
  const def = zoneAt(base)?.def
  const nameCells = cells - 2 - 2 * PAGE_COUNT_CELLS
  const items: PageItem[] = zoneEnemies(base).map((id) => {
    const enemy = content.enemies[id]
    const name = enemy?.name ?? id
    const seen = tallies[id]?.seen ?? 0
    const defeated = tallies[id]?.defeated ?? 0
    const boss = id === def?.boss
    const role = boss ? ', the zone boss' : id === def?.turnBoss ? ', the turn boss' : ''
    return {
      label: `${name}${role}: seen ${seen}, defeated ${defeated}`,
      spans: [
        defeated > 0 ? { text: '*', rgb: GAUGE_FULL_RGB } : { text: '·', rgb: DIM_RGB },
        { text: ' ' },
        { text: padEnd(name, nameCells), rgb: boss ? WARN_RGB : TEXT_RGB },
        { text: padStart(formatCount(seen), PAGE_COUNT_CELLS) },
        { text: padStart(formatCount(defeated), PAGE_COUNT_CELLS) },
      ],
      action: { t: 'none' },
    }
  })
  const zones = travelZones(base, input)
  // Inside tier 1 a zone has one running zone: past it, a page names each tier reached.
  const one = input.view.highestZone <= content.zones.length
  zones.forEach((z, i) => {
    items.push({
      label: one ? 'Travel here' : `Travel to ${zonePhrase(z)}`,
      ...(i === 0 ? { hotkey: 't' } : {}),
      action: input.readOnly ? { t: 'none' } : { t: 'event', event: { t: 'travel', zone: z } },
    })
  })
  const header: Span[] = [
    {
      text:
        padEnd(zoneName(base), cells - 2 * PAGE_COUNT_CELLS) +
        padStart('seen', PAGE_COUNT_CELLS) +
        padStart('won', PAGE_COUNT_CELLS),
    },
  ]
  let first: MessageLine = 'q: back.'
  if (zones.length === 1 && one) first = 'Enter on Travel here: go there. q: back.'
  else if (zones.length > 0) first = 'Enter on a Travel line: go there. q: back.'
  const state: [MessageLine, MessageLine] = [first, 'Seen and won: each enemy met and defeated.']
  return { header, items, state }
}

function collectionPage(input: PaneInput, cells: number) {
  const { held, total } = collectionCounts(input)
  const items: PageItem[] = Object.values(content.itemBases).map((b) => {
    const marks = input.view.tallies.collection[b.id]
    const have = RARITIES.filter((r) => (marks?.[r] ?? 0) > 0)
    return {
      label: `${b.name}: ${have.length > 0 ? have.join(', ') : 'none held'}`,
      spans: [
        { text: padEnd(b.name, cells - RARITIES.length) },
        ...RARITIES.map(
          (r): Span =>
            (marks?.[r] ?? 0) > 0
              ? { text: r.charAt(0).toUpperCase(), rgb: RARITY_RGB[r] ?? TEXT_RGB }
              : { text: '·', rgb: DIM_RGB },
        ),
      ],
      action: { t: 'none' },
    }
  })
  return {
    header: [{ text: `Collection · ${held} of ${total} held` }],
    items,
    state: ['q: back.', 'C U R E L: held in common, uncommon, rare, epic, legendary.'] as [
      MessageLine,
      MessageLine,
    ],
  }
}

function achievementsPage(input: PaneInput, cells: number) {
  const { journal, busy } = input.journal
  const state: [MessageLine, MessageLine] = [
    'q: back.',
    'Marks: the steps crossed, then the next step’s gold and the last date.',
  ]
  if (!journal) {
    const text = busy ? LOADING : NOT_LOADED
    return {
      header: [{ text: 'Achievements' }],
      items: [{ label: text, action: { t: 'none' } }] as PageItem[],
      state,
    }
  }
  const MARK_CELLS = 4
  const GOLD_CELLS = 8
  const DATE_CELLS = 7
  const nameCells = cells - MARK_CELLS - GOLD_CELLS - DATE_CELLS
  const items: PageItem[] = content.achievements.map((a) => {
    const { crossed, last } = achieved(journal, a.id)
    const next = a.steps[crossed]
    const name = capital(a.name)
    const marks: Span[] = a.steps.map((_, i) =>
      i < crossed ? { text: '*', rgb: GAUGE_FULL_RGB } : { text: '·', rgb: DIM_RGB },
    )
    const gold = next ? formatGold(next.gold) : ''
    const date = last === null ? '' : shortDate(last)
    return {
      label: `${name}: ${crossed} of ${a.steps.length}${next ? `, next ${gold}` : ''}${date ? `, ${date}` : ''}`,
      spans: [
        { text: padEnd(name, nameCells) },
        ...marks,
        { text: ' '.repeat(MARK_CELLS - a.steps.length) },
        { text: padStart(gold, GOLD_CELLS) },
        { text: padStart(date, DATE_CELLS) },
      ],
      action: { t: 'none' },
    }
  })
  return {
    header: [{ text: `Achievements · ${crossedSteps(journal)} of ${TOTAL_STEPS} steps` }],
    items,
    state,
  }
}

function journalMenu(menu: PaneMenu | null): JournalMenu | null {
  if (
    menu?.kind === 'journal_zone' ||
    menu?.kind === 'journal_collection' ||
    menu?.kind === 'journal_achievements'
  )
    return menu
  return null
}

export function journalPane(input: PaneInput): PaneBuild {
  const { view, dialog, journal: slice } = input
  const journal = slice.journal
  const inner = listInner(input)
  // Before the read answers, the goal the shared function names for the local day and zone.
  const goal = journal?.day.goal ?? dailyGoal(dayOf(input.serverNow), view.accountId, view.zone)
  const count = (text: string, rgb = TEXT_RGB) => [{ text, cells: COUNT_CELLS, rgb }]

  const rows: ListRow[] = [{ spans: [{ text: 'Today' }], rule: true, alt: 'Today' }]
  let progress = '…'
  if (journal) progress = journal.day.met ? 'met' : `${journal.day.progress}/${goal.target}`
  rows.push({
    key: 'row:today',
    spans: rowSpans(
      inner,
      null,
      { text: goalWords(goal) },
      count(progress, journal?.day.met ? GAUGE_FULL_RGB : TEXT_RGB),
    ),
    action: { t: 'none' },
    alt: `Today: ${goalWords(goal)}, ${journal ? progress : 'loading'}`,
  })
  const streak = journal ? plural(journal.streak.length, 'work day', 'work days') : ''
  const resets = journal ? resetsIn(input.remainingMs(journal.day.resetsAt)) : ''
  if (journal) {
    const text = `${resets} · streak ${streak}`
    rows.push({ spans: [{ text }], alt: text })
  } else if (slice.busy) {
    rows.push({ spans: [{ text: LOADING }], alt: 'Loading' })
  }

  rows.push({ spans: [{ text: 'Bestiary' }], rule: true, alt: 'Bestiary' })
  const defeatedIn = (base: number) =>
    zoneEnemies(base).filter((id) => (view.tallies.enemies[id]?.defeated ?? 0) > 0).length
  for (let base = 1; base <= highestBase(view.highestZone); base++) {
    const label = `Zone ${base}, ${zoneName(base)}`
    const of = `${defeatedIn(base)}/${zoneEnemies(base).length}`
    rows.push({
      key: `row:zone-${base}`,
      spans: rowSpans(inner, null, { text: label }, count(of)),
      action: { t: 'open', menu: { kind: 'journal_zone', zone: base, at: 0 } },
      alt: `${label}, ${of} defeated`,
    })
  }
  const books = collectionCounts(input)
  rows.push({
    key: 'row:collection',
    spans: rowSpans(inner, null, { text: 'Collection' }, count(`${books.held}/${books.total}`)),
    action: { t: 'open', menu: { kind: 'journal_collection', at: 0 } },
    alt: `Collection, ${books.held} of ${books.total} held`,
  })
  const steps = journal ? `${crossedSteps(journal)}/${TOTAL_STEPS}` : '…'
  rows.push({
    key: 'row:achievements',
    spans: rowSpans(inner, null, { text: 'Achievements' }, count(steps)),
    action: { t: 'open', menu: { kind: 'journal_achievements', at: 0 } },
    alt: `Achievements, ${journal ? `${steps} steps` : 'loading'}`,
  })

  const ids = rows.flatMap((r) => (r.key ? [r.key.slice(4)] : []))
  const cursor = cursorRow(dialog.cursor.journal ?? null, ids)
  const on = ids[cursor] ?? ''

  const detail = (w: number): Line[] => {
    const head = (t: string): Line => ({ spans: [{ gap: 1 }, { text: t }], rule: true })
    const line = (t: string): Line => ({
      spans: [{ gap: 1 }, { text: padEnd(t, w - 1).trimEnd() }],
    })
    if (on === 'today') {
      if (!journal) return [head('Today'), line(goalWords(goal)), line(slice.busy ? LOADING : '')]
      const rest = journal.restDays.current.map((d) => WEEKDAYS[d - 1] ?? '').join(', ')
      return [
        head('Today'),
        line(goalWords(goal)),
        line(journal.day.met ? 'Met' : `Progress ${journal.day.progress} of ${goal.target}`),
        line(resets),
        line(`Streak: ${streak}`),
        line(`Rest days: ${rest || 'none'}`),
      ]
    }
    if (on.startsWith('zone-')) {
      const base = Number(on.slice(5))
      const lines = [
        head(`Zone ${base}, ${zoneName(base)}`),
        line(`${defeatedIn(base)} of ${zoneEnemies(base).length} enemies defeated`),
      ]
      if (zoneAt(view.zone)?.base === base) lines.push(line('The party is here.'))
      return lines
    }
    if (on === 'collection') {
      const bases = Object.keys(content.itemBases).length
      return [
        head('Collection'),
        line(`${books.held} of ${books.total} held`),
        line(`${books.complete} of ${bases} bases in every rarity`),
      ]
    }
    return [
      head('Achievements'),
      line(journal ? `${crossedSteps(journal)} of ${TOTAL_STEPS} steps crossed` : LOADING),
    ]
  }

  const open = journalMenu(dialog.menu)
  const cells = pageCells(input)
  let page: ReturnType<typeof zonePage> | null = null
  if (open?.kind === 'journal_zone') page = zonePage(input, open.zone, cells)
  else if (open?.kind === 'journal_collection') page = collectionPage(input, cells)
  else if (open?.kind === 'journal_achievements') page = achievementsPage(input, cells)

  const opens = on.startsWith('zone-') || on === 'collection' || on === 'achievements'
  const spec: ListSpec = {
    title: [{ text: 'Journal' }],
    altTitle: 'Journal',
    rows,
    empty: '',
    cursor,
    detail,
    menu:
      open && page
        ? { header: page.header, items: page.items, at: open.at, wholeColumn: true }
        : null,
    yesNo: null,
    panel: null,
    error: slice.error,
    state: page?.state ?? [opens ? `Enter: open its page. ${MOVE_HELP}` : MOVE_HELP, TRAVEL_LINE],
    field: null,
    link: null,
  }
  return listPane(input, spec)
}
