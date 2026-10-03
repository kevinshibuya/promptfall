import type { Event } from '@promptfall/sim'
import { z } from 'zod'

export const HEX16 = z.string().regex(/^[0-9a-f]{16}$/)

export type TimedEvent = Event & { at: number }

const id = z.string().min(1).max(64)
const at = z.number().int().nonnegative()
const slot = z.enum(['weapon', 'armour', 'accessory'])

const EventSchema = z.discriminatedUnion('t', [
  z.object({ t: z.literal('tick'), at }),
  z.object({ t: z.literal('tool_call'), at }),
  z.object({ t: z.literal('turn_end'), at }),
  z.object({ t: z.literal('rest'), at }),
  z.object({ t: z.literal('equip'), heroId: id, itemId: id, at }),
  z.object({ t: z.literal('unequip'), heroId: id, slot, at }),
  z.object({ t: z.literal('vendor'), itemId: id, at }),
  z.object({ t: z.literal('reforge'), itemId: id, affixIndex: z.number().int(), at }),
  z.object({ t: z.literal('set_party'), heroIds: z.tuple([id, id, id]), at }),
  z.object({ t: z.literal('recruit'), at }),
  z.object({ t: z.literal('dismiss'), heroId: id, at }),
  z.object({ t: z.literal('set_farm'), on: z.boolean(), at }),
  z.object({ t: z.literal('expand_inventory'), at }),
  z.object({ t: z.literal('expand_roster'), at }),
])

export const TimedEventSchema: z.ZodType<TimedEvent> = EventSchema

export type Batch = {
  batchId: string
  accountId: string
  seq: number
  clientVersion: string
  simVersion: number
  baseHash: string
  resultHash: string
  events: TimedEvent[]
}

const SEMVER = /^\d+\.\d+\.\d+$/

export const BatchSchema: z.ZodType<Batch> = z.object({
  batchId: z.string().min(16).max(64),
  accountId: z.string().min(1).max(128),
  seq: z.number().int().nonnegative(),
  clientVersion: z.string().regex(SEMVER),
  simVersion: z.number().int().nonnegative(),
  baseHash: HEX16,
  resultHash: HEX16,
  events: z.array(TimedEventSchema).min(1).max(2000),
})

export function compareSemver(a: string, b: string): -1 | 0 | 1 {
  const pa = a.split('.').map((n) => Number.parseInt(n, 10) || 0)
  const pb = b.split('.').map((n) => Number.parseInt(n, 10) || 0)
  for (let i = 0; i < 3; i++) {
    const x = pa[i] ?? 0
    const y = pb[i] ?? 0
    if (x < y) return -1
    if (x > y) return 1
  }
  return 0
}
