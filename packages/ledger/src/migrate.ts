import { BUDGETS, type BudgetKind } from '@promptfall/protocol'
import {
  type Goods,
  hashState,
  type MigrateRefusal,
  type MigrationChain,
  migrate,
  migrateGoods,
  replay,
  type ServerEvent,
  SIM_VERSION,
  type VersionedState,
} from '@promptfall/sim'
import type { AccountRecord } from './books'

// Saves migrate (ADR 0013): the ledger brings what it stores up to the sim version on first load.

/** What a load needs to migrate: the chain, the ledger's clock and its log. */
export type Migrator = {
  chain: MigrationChain
  now: () => Promise<number>
  log: (line: string) => void
}

/** Why the chain refused, as the log line reads it. */
export function refusalText(refusal: MigrateRefusal): string {
  return refusal.reason === 'ahead'
    ? `v${refusal.from} is ahead of v${refusal.to}`
    : `gap in the chain, no step from v${refusal.at}`
}

/** Goods stored at `from`, walked through each step's goods rule. Throws on a refusal: rule one out first. */
export function walkGoods(goods: Goods, from: number, chain: MigrationChain): Goods {
  const r = migrateGoods(goods, from, { chain })
  if (!r.ok) throw new Error(`migrate: goods refused from v${from}: ${refusalText(r)}`)
  return r.goods
}

/** The event with every item and hero it carries passed through `rule`. */
function eventGoods(event: ServerEvent, rule: (goods: Goods) => Goods): ServerEvent {
  switch (event.t) {
    case 'returned':
    case 'bought':
      return { ...event, goods: rule(event.goods) }
    case 'rewarded':
      return { ...event, goods: event.goods && rule(event.goods) }
    case 'order_filled': {
      const goods = rule({ kind: 'item', item: event.item })
      return goods.kind === 'item' ? { ...event, item: goods.item } : event
    }
    default:
      return event
  }
}

/**
 * Brings a record whose committed state is behind up to the sim version, in place: the committed
 * snapshot through the chain, the log and the returns through the goods rule, the effective state
 * rebuilt by replaying the log, the committed hash recomputed and any missing bucket started full
 * on the ledger's clock. Answers the chain's refusal with the record untouched.
 */
export async function migrateRecord(
  record: AccountRecord,
  { chain, now }: Migrator,
): Promise<MigrateRefusal | null> {
  const committed = record.committedState ?? record.state
  const from = committed.v
  const result = migrate(committed as unknown as VersionedState, { chain })
  if (!result.ok) return result
  // The state walked, so the goods walk over the same versions does too.
  const rule = (goods: Goods) => walkGoods(goods, from, chain)
  record.committedState = result.state
  record.log = record.log.map(({ n, event }) => ({ n, event: eventGoods(event, rule) }))
  record.returns = record.returns.map((entry) => ({ ...entry, goods: rule(entry.goods) }))
  // The client replays the same delivery over the same snapshot, so the two agree.
  record.state = replay(
    record.committedState,
    record.log.map((e) => e.event),
  ).state
  record.committedHash = hashState(record.committedState)
  const at = await now()
  for (const kind of Object.keys(BUDGETS) as BudgetKind[]) {
    if (typeof record.buckets[kind] !== 'number') record.buckets[kind] = BUDGETS[kind].capacity
    if (typeof record.refillAt[kind] !== 'number') record.refillAt[kind] = at
  }
  return null
}

/** True when the record's committed state is not at the sim version. */
export function behind(record: AccountRecord): boolean {
  return (record.committedState ?? record.state).v !== SIM_VERSION
}
