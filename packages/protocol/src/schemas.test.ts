import { describe, expect, it } from 'vitest'
import { BatchSchema, compareSemver, HEX16, TimedEventSchema } from './schemas'

const valid = {
  batchId: crypto.randomUUID(),
  accountId: 'acct-1',
  seq: 0,
  clientVersion: '0.1.0',
  simVersion: 1,
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
