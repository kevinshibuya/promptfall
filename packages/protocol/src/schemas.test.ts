import { SANDBOX_EVENT_KINDS, type SandboxEvent } from '@promptfall/sim'
import { describe, expect, it } from 'vitest'
import { DeliverySchema } from './market'
import {
  BatchSchema,
  compareSemver,
  HEX16,
  PLAYER_EVENT_KINDS,
  ServerEventSchema,
  TimedEventSchema,
} from './schemas'

const valid = {
  batchId: crypto.randomUUID(),
  accountId: 'acct-1',
  seq: 0,
  clientVersion: '0.1.0',
  simVersion: 2,
  cursor: 0,
  baseHash: '0123456789abcdef',
  resultHash: 'fedcba9876543210',
  events: [
    { t: 'tick', at: 1 },
    { t: 'equip', heroId: 'h0', itemId: 'i1', at: 2 },
    { t: 'set_party', heroIds: ['h0', 'h1', 'h2'], at: 3 },
  ],
}

describe('BatchSchema', () => {
  it('parses a valid batch', () => {
    expect(BatchSchema.parse(valid)).toEqual(valid)
  })

  it('accepts crypto.randomUUID() as a batchId', () => {
    expect(BatchSchema.safeParse({ ...valid, batchId: crypto.randomUUID() }).success).toBe(true)
  })

  it('rejects an empty events array', () => {
    expect(BatchSchema.safeParse({ ...valid, events: [] }).success).toBe(false)
  })

  it('rejects 2001 events', () => {
    const events = Array.from({ length: 2001 }, (_, i) => ({ t: 'tick', at: i }))
    expect(BatchSchema.safeParse({ ...valid, events }).success).toBe(false)
  })

  it('accepts 2000 events', () => {
    const events = Array.from({ length: 2000 }, (_, i) => ({ t: 'tick', at: i }))
    expect(BatchSchema.safeParse({ ...valid, events }).success).toBe(true)
  })

  it('rejects a 15 char hash', () => {
    expect(BatchSchema.safeParse({ ...valid, baseHash: '0123456789abcde' }).success).toBe(false)
  })

  it('rejects a 10 char batchId', () => {
    expect(BatchSchema.safeParse({ ...valid, batchId: '0123456789' }).success).toBe(false)
  })

  it('rejects an unknown event kind', () => {
    expect(TimedEventSchema.safeParse({ t: 'cheat', at: 1 }).success).toBe(false)
  })

  it('rejects a batch without a cursor', () => {
    const { cursor: _cursor, ...rest } = valid
    expect(BatchSchema.safeParse(rest).success).toBe(false)
  })

  it('rejects a negative cursor', () => {
    expect(BatchSchema.safeParse({ ...valid, cursor: -1 }).success).toBe(false)
  })

  it('rejects a batch carrying a server event', () => {
    const credited = { t: 'credited', gold: 1000, reason: 'cheat', at: 4 }
    expect(TimedEventSchema.safeParse(credited).success).toBe(false)
    expect(BatchSchema.safeParse({ ...valid, events: [...valid.events, credited] }).success).toBe(
      false,
    )
  })

  it('rejects an event without a timestamp', () => {
    expect(TimedEventSchema.safeParse({ t: 'tick' }).success).toBe(false)
  })
})

describe('HEX16', () => {
  it('wants 16 lowercase hex chars', () => {
    expect(HEX16.safeParse('0123456789abcdef').success).toBe(true)
    expect(HEX16.safeParse('0123456789ABCDEF').success).toBe(false)
  })
})

describe('compareSemver', () => {
  it('compares numerically', () => {
    expect(compareSemver('0.1.0', '0.1.0')).toBe(0)
    expect(compareSemver('0.0.9', '0.1.0')).toBe(-1)
    expect(compareSemver('0.10.0', '0.9.0')).toBe(1)
    expect(compareSemver('1.0.0', '0.99.99')).toBe(1)
  })
})

describe('boss events', () => {
  const engaged = {
    t: 'boss_engaged',
    bossId: 'wb1',
    name: 'The Promptwyrm',
    glyph: '☠',
    stats: { hp: 630, atk: 14, def: 4, spd: 5 },
  }

  it('a delivery carrying boss_engaged, boss_disengaged and rewarded parses', () => {
    const delivery = {
      cursor: 3,
      events: [
        { n: 1, event: engaged },
        { n: 2, event: { t: 'rewarded', bossId: 'wb1', goods: null, gold: 45 } },
        { n: 3, event: { t: 'boss_disengaged', bossId: 'wb1' } },
      ],
    }
    expect(DeliverySchema.parse(delivery)).toEqual(delivery)
  })

  it('stats are non-negative integers and gold is non-negative', () => {
    const bad = { ...engaged, stats: { ...engaged.stats, atk: -1 } }
    expect(ServerEventSchema.safeParse(bad).success).toBe(false)
    expect(
      ServerEventSchema.safeParse({ t: 'rewarded', bossId: 'wb1', goods: null, gold: -5 }).success,
    ).toBe(false)
  })

  it('a batch carrying boss_engaged fails', () => {
    const batch = { ...valid, events: [{ ...engaged, at: 1 }] }
    expect(BatchSchema.safeParse(batch).success).toBe(false)
  })
})

describe('sandbox events', () => {
  const grants: SandboxEvent[] = [
    { t: 'sandbox_boss', zone: 3, boss: 'zone_boss' },
    { t: 'sandbox_boss', zone: 4, boss: 'turn_boss' },
    { t: 'sandbox_item', base: 'oak_staff', rarity: 'legendary' },
    { t: 'sandbox_level', heroId: 'h1', level: 10 },
    { t: 'sandbox_zone', zone: 4 },
    { t: 'sandbox_recruit', rarity: 'epic' },
    { t: 'sandbox_wipe' },
  ]

  it('a delivery carrying every sandbox kind parses', () => {
    expect(new Set(grants.map((g) => g.t))).toEqual(new Set(SANDBOX_EVENT_KINDS))
    const delivery = {
      cursor: grants.length,
      events: grants.map((event, i) => ({ n: i + 1, event })),
    }
    expect(DeliverySchema.parse(delivery)).toEqual(delivery)
  })

  it.each([
    { t: 'sandbox_boss', zone: 0, boss: 'zone_boss' },
    { t: 'sandbox_boss', zone: 3, boss: 'world_boss' },
    { t: 'sandbox_item', base: 'oak_staff', rarity: 'mythic' },
    { t: 'sandbox_level', heroId: 'h1', level: 2.5 },
    { t: 'sandbox_zone', zone: -1 },
    { t: 'sandbox_recruit' },
  ])('rejects %o', (bad) => {
    expect(ServerEventSchema.safeParse(bad).success).toBe(false)
  })

  it('a batch carrying a sandbox event fails, and the player kinds are unchanged', () => {
    for (const grant of grants) {
      const batch = { ...valid, events: [{ ...grant, at: 1 }] }
      expect(BatchSchema.safeParse(batch).success).toBe(false)
    }
    expect(PLAYER_EVENT_KINDS).toHaveLength(14)
    for (const kind of SANDBOX_EVENT_KINDS) expect(PLAYER_EVENT_KINDS).not.toContain(kind)
  })
})
