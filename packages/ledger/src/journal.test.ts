import {
  type Auth,
  type BatchAck,
  DAY_MS,
  type Delivery,
  type Journal,
  MemoryKeyValue,
} from '@promptfall/protocol'
import { Mirror } from '@promptfall/protocol/mirror'
import {
  createInitialState,
  dailyGoal,
  type GameState,
  type GoalKind,
  goalGold,
  type PlayerEvent,
} from '@promptfall/sim'
import { describe, expect, it } from 'vitest'
import { emptyJournal, isWorkDay, type JournalRecord, journalKey, setRestDays } from './journal'
import { approveAs, Ledger } from './ledger'
import { patchRecord } from './testing'

class CountingKeyValue extends MemoryKeyValue {
  writes = 0
  async set(key: string, value: unknown): Promise<void> {
    this.writes += 1
    await super.set(key, value)
  }
  async delete(key: string): Promise<void> {
    this.writes += 1
    await super.delete(key)
  }
}

/** Monday 20 November 2023, a UTC day index. */
const MON = 19_681
const TUE = MON + 1
const WED = MON + 2
const THU = MON + 3
const FRI = MON + 4
const SAT = MON + 5
const SUN = MON + 6

const tick: PlayerEvent = { t: 'tick' }

/** Raises the count a goal of this kind reads by `n`, as play would. */
function raise(kind: GoalKind, n: number): (s: GameState) => GameState {
  return (s) => {
    const t = s.tallies
    switch (kind) {
      case 'kills':
        return { ...s, stats: { ...s.stats, kills: s.stats.kills + n } }
      case 'zone_bosses':
        return { ...s, tallies: { ...t, zoneBosses: t.zoneBosses + n } }
      case 'rare_drops':
        return { ...s, tallies: { ...t, drops: { ...t.drops, rare: t.drops.rare + n } } }
      case 'turn_boss':
        return { ...s, tallies: { ...t, turnBosses: t.turnBosses + n } }
    }
  }
}

const reasons = (d: Delivery) =>
  d.events.flatMap((e) => (e.event.t === 'credited' ? [e.event.reason] : []))
const credits = (d: Delivery) =>
  d.events.flatMap((e) => (e.event.t === 'credited' ? [e.event] : []))

/** A ledger on a clock set at 10:00 on a day index, and one minted account playing it. */
async function play(day: number, state: GameState = createInitialState(5)) {
  let t = day * DAY_MS + 10 * 3_600_000
  let n = 0
  const kv = new CountingKeyValue()
  const ledger = new Ledger({
    kv,
    now: async () => t,
    minClientVersion: '0.1.0',
    seedSource: () => 7,
    tokenSource: () => `token-${n++}`,
    linkApprover: approveAs('player'),
  })
  const minted = await ledger.host.mint({ state, name: 'Ann', linked: true })
  const auth: Auth = { deviceToken: minted.deviceToken }
  let mirror = await boot()

  async function boot(): Promise<Mirror> {
    const b = await ledger.bootstrap({ clientVersion: '0.1.0', deviceToken: minted.deviceToken })
    if ('refusal' in b) throw new Error(b.refusal)
    return new Mirror(b)
  }

  async function read(): Promise<Journal> {
    const j = await ledger.journal(auth)
    if ('reason' in j) throw new Error(j.reason)
    return j
  }

  return {
    ledger,
    kv,
    auth,
    accountId: minted.accountId,
    /** Moves the clock to 10:00 on a day index. */
    on(next: number) {
      t = next * DAY_MS + 10 * 3_600_000
    },
    /** Commits one tick from the mirror; answers what the commit delivered. */
    async commit(overrides: { resultHash?: string } = {}): Promise<Delivery> {
      const batch = mirror.batch([tick], overrides)
      const ack: BatchAck = await ledger.submit(batch, auth)
      if (ack.ok) {
        mirror.commit([tick])
        mirror.receive(ack.delivery)
        return ack.delivery
      }
      if (ack.reason !== 'hash_mismatch') throw new Error(ack.reason)
      mirror.adopt(ack)
      return { cursor: ack.cursor, events: [] }
    },
    /** Rewrites the stored state, then boots the mirror anew from it. */
    async patch(fn: (s: GameState) => GameState) {
      await patchRecord(kv, minted.accountId, fn)
      mirror = await boot()
    },
    read,
    /** Opens the day if needed, then meets its goal: the commit that meets it answers. */
    async meet(): Promise<Delivery> {
      await this.commit()
      const { goal } = (await read()).day
      await this.patch(raise(goal.kind, goal.target))
      return this.commit()
    },
    async stored(): Promise<JournalRecord | undefined> {
      return (await kv.get(journalKey(minted.accountId))) as JournalRecord | undefined
    },
  }
}

describe('achievements', () => {
  it('a commit crossing a thousand kills pays the kills ladder step 2 once, with its time', async () => {
    const p = await play(MON, {
      ...createInitialState(5),
      stats: { kills: 999, bosses: 0, wipes: 0 },
    })
    expect(reasons(await p.commit())).toContain('achievement:kills:1')
    await p.patch((s) => ({ ...s, stats: { ...s.stats, kills: 1000 } }))
    const crossing = await p.commit()
    expect(credits(crossing).filter((c) => c.reason.startsWith('achievement:'))).toEqual([
      { t: 'credited', gold: 400, reason: 'achievement:kills:2' },
    ])
    expect(reasons(await p.commit()).filter((r) => r.startsWith('achievement:'))).toEqual([])
    const kills = (await p.read()).achievements.find((a) => a.id === 'kills')
    expect(kills?.steps).toEqual([
      { step: 1, at: MON * DAY_MS + 10 * 3_600_000 },
      { step: 2, at: MON * DAY_MS + 10 * 3_600_000 },
    ])
  })

  it("a veteran's first commit pays every step its totals pass, in that one commit", async () => {
    const s = createInitialState(5)
    const veteran: GameState = {
      ...s,
      highestZone: 14,
      stats: { kills: 12_000, bosses: 60, wipes: 3 },
      tallies: { ...s.tallies, zoneBosses: 60, cleanZoneBosses: 1 },
    }
    const p = await play(MON, veteran)
    const paid = reasons(await p.commit()).filter((r) => r.startsWith('achievement:'))
    expect(paid.sort()).toEqual(
      [
        'achievement:kills:1',
        'achievement:kills:2',
        'achievement:kills:3',
        'achievement:zone_bosses:1',
        'achievement:zone_bosses:2',
        'achievement:zone_6:1',
        'achievement:zone_12:1',
        'achievement:tier_2:1',
        'achievement:clean_boss:1',
      ].sort(),
    )
    expect(reasons(await p.commit()).filter((r) => r.startsWith('achievement:'))).toEqual([])
  })

  it('a hero bought in a rarity pays the first-rarity one-off, with no recruit and no mark', async () => {
    const s = createInitialState(5)
    const p = await play(MON, s)
    expect(reasons(await p.commit())).not.toContain('achievement:first_epic:1')
    // A bought hero arrives in the roster alone: no recruit tally, no collection mark.
    await p.patch((st) => ({
      ...st,
      roster: st.roster.map((h, i) => (i === 0 ? { ...h, rarity: 'epic' as const } : h)),
    }))
    expect(reasons(await p.commit())).toContain('achievement:first_epic:1')
  })

  it('the no-wipe one-off reads the clean zone boss tally, not the boss total', async () => {
    const s = createInitialState(5)
    const p = await play(MON, { ...s, tallies: { ...s.tallies, zoneBosses: 5 } })
    expect(reasons(await p.commit())).not.toContain('achievement:clean_boss:1')
    await p.patch((st) => ({ ...st, tallies: { ...st.tallies, cleanZoneBosses: 1 } }))
    expect(reasons(await p.commit())).toContain('achievement:clean_boss:1')
  })

  it('pays on the hash mismatch path too: the adopted state carries the credits', async () => {
    const s = createInitialState(5)
    const p = await play(MON, { ...s, stats: { ...s.stats, kills: 150 } })
    const gold = s.gold
    await p.commit({ resultHash: '0000000000000000' })
    const j = await p.read()
    expect(j.achievements.map((a) => a.id)).toContain('kills')
    const b = await p.ledger.bootstrap({ clientVersion: '0.1.0', deviceToken: p.auth.deviceToken })
    if ('refusal' in b) throw new Error(b.refusal)
    expect(b.state.gold).toBeGreaterThanOrEqual(gold + 100)
  })
})

describe('the daily goal', () => {
  it('the first commit of a day opens it at the committed counts, with the drawn goal', async () => {
    const s = createInitialState(5)
    const p = await play(MON, { ...s, stats: { ...s.stats, kills: 40 } })
    await p.commit()
    const j = await p.read()
    expect(j.day).toEqual({
      index: MON,
      goal: dailyGoal(MON, p.accountId, 1),
      progress: 0,
      met: false,
      resetsAt: (MON + 1) * DAY_MS,
    })
    expect((await p.stored())?.day?.baseline.kills).toBe(40)
  })

  it('the commit that meets it pays the zone gold once; a later commit pays nothing more', async () => {
    const p = await play(MON)
    const met = await p.meet()
    expect(credits(met).filter((c) => c.reason.startsWith('goal:'))).toEqual([
      { t: 'credited', gold: goalGold(1), reason: `goal:${MON}` },
    ])
    expect(reasons(await p.commit()).filter((r) => r.startsWith('goal:'))).toEqual([])
    const j = await p.read()
    expect(j.day.met).toBe(true)
    expect(j.day.progress).toBeGreaterThanOrEqual(j.day.goal.target)
    expect(j.goalsMet).toBe(1)
    expect(j.streak).toEqual({ length: 1, lastMet: MON })
  })

  it('pays at the zone the day opened at, though the party moved since', async () => {
    const p = await play(MON, { ...createInitialState(5), zone: 7, highestZone: 7 })
    await p.commit()
    const { goal } = (await p.read()).day
    await p.patch((s) => raise(goal.kind, goal.target)({ ...s, zone: 2 }))
    const paid = credits(await p.commit()).find((c) => c.reason === `goal:${MON}`)
    expect(paid?.gold).toBe(goalGold(7))
  })

  it('a read before the day opens answers its goal at progress 0 and writes nothing', async () => {
    const p = await play(MON)
    await p.meet()
    p.on(TUE)
    const writes = p.kv.writes
    const j = await p.read()
    expect(p.kv.writes).toBe(writes)
    expect(j.day).toMatchObject({ index: TUE, progress: 0, met: false })
    expect(j.day.goal).toEqual(dailyGoal(TUE, p.accountId, 1))
  })
})

describe('the streak', () => {
  it('grows by one on the work day after the last met one', async () => {
    const p = await play(MON)
    await p.meet()
    p.on(TUE)
    await p.meet()
    expect((await p.read()).streak).toEqual({ length: 2, lastMet: TUE })
  })

  it('a missed work day zeroes it on a read, without writing, and the next met sets it to one', async () => {
    const p = await play(MON)
    await p.meet()
    p.on(TUE)
    await p.meet()
    p.on(THU)
    const writes = p.kv.writes
    expect((await p.read()).streak.length).toBe(0)
    expect(p.kv.writes).toBe(writes)
    expect((await p.stored())?.streak.length).toBe(2)
    await p.meet()
    expect((await p.read()).streak).toEqual({ length: 1, lastMet: THU })
  })

  it('the next commit persists a zeroed streak', async () => {
    const p = await play(MON)
    await p.meet()
    p.on(WED)
    await p.commit()
    expect((await p.stored())?.streak.length).toBe(0)
  })

  it('a rest day between two met days neither grows nor breaks it', async () => {
    const p = await play(THU)
    await p.meet()
    p.on(FRI)
    await p.meet()
    p.on(SAT)
    expect((await p.read()).streak.length).toBe(2)
    p.on(SUN)
    await p.meet()
    expect((await p.read()).streak).toEqual({ length: 2, lastMet: FRI })
    expect((await p.read()).goalsMet).toBe(3)
    p.on(MON + 7)
    expect((await p.read()).streak.length).toBe(2)
    await p.meet()
    expect((await p.read()).streak).toEqual({ length: 3, lastMet: MON + 7 })
  })

  it('a goal met on a rest day still pays its gold', async () => {
    const p = await play(SAT)
    const met = await p.meet()
    expect(reasons(met)).toContain(`goal:${SAT}`)
    expect((await p.read()).streak).toEqual({ length: 0, lastMet: null })
  })

  it('the streak ladder pays at the commit that meets the fifth work day', async () => {
    const p = await play(MON)
    for (const day of [MON, TUE, WED, THU]) {
      p.on(day)
      expect(reasons(await p.meet())).not.toContain('achievement:streak:1')
    }
    p.on(FRI)
    expect(reasons(await p.meet())).toContain('achievement:streak:1')
    expect((await p.read()).streak.length).toBe(5)
  })
})

describe('rest days', () => {
  it('a fresh journal rests on Saturday and Sunday, with nothing to come', async () => {
    const p = await play(MON)
    const j = await p.read()
    expect(j.restDays).toEqual({ current: [6, 7], next: null })
    expect(j.streak).toEqual({ length: 0, lastMet: null })
    expect(j.achievements).toEqual([])
  })

  it('a write stores two weekdays from next Monday, and the read says both sets', async () => {
    const p = await play(WED)
    const r = await p.ledger.setRestDays(p.auth, [3, 1])
    expect(r).toMatchObject({ ok: true })
    const want = { current: [6, 7], next: { days: [1, 3], from: MON + 7 } }
    if (r.ok) expect(r.journal.restDays).toEqual(want)
    expect((await p.read()).restDays).toEqual(want)
    p.on(MON + 7)
    expect((await p.read()).restDays).toEqual({ current: [1, 3], next: null })
  })

  it('a write on a Monday applies from the Monday a week on', async () => {
    const p = await play(MON)
    const r = await p.ledger.setRestDays(p.auth, [2, 4])
    if (!r.ok) throw new Error(r.reason)
    expect(r.journal.restDays.next).toEqual({ days: [2, 4], from: MON + 7 })
  })

  it('the week after the Monday judges its days by the new set', async () => {
    const p = await play(FRI)
    await p.meet()
    await p.ledger.setRestDays(p.auth, [1, 2])
    // Monday and Tuesday are rest days from MON + 7: Friday to Wednesday misses nothing.
    p.on(MON + 9)
    expect((await p.read()).streak.length).toBe(1)
    await p.meet()
    expect((await p.read()).streak).toEqual({ length: 2, lastMet: MON + 9 })
    for (const day of [MON + 10, MON + 11]) {
      p.on(day)
      await p.meet()
    }
    expect((await p.read()).streak.length).toBe(4)
    // Saturday is a work day now: on Sunday, missing it has broken the streak.
    p.on(MON + 13)
    expect((await p.read()).streak.length).toBe(0)
  })

  it('a change never makes a past day a rest day', () => {
    const j = emptyJournal()
    setRestDays(j, [1, 2], TUE * DAY_MS)
    expect(isWorkDay(j, MON)).toBe(true)
    expect(isWorkDay(j, TUE)).toBe(true)
    expect(isWorkDay(j, SAT)).toBe(false)
    expect(isWorkDay(j, MON + 7)).toBe(false)
    expect(isWorkDay(j, SAT + 7)).toBe(true)
  })

  it('a missed work day stays missed after a change made later', async () => {
    const p = await play(MON)
    await p.meet()
    // Tuesday goes unmet; on Wednesday the player rests Tuesdays from next week on.
    p.on(WED)
    await p.ledger.setRestDays(p.auth, [2, 3])
    p.on(MON + 7)
    expect((await p.read()).streak.length).toBe(0)
  })

  it('refuses one day, three, two equal and a day out of range, and stores nothing', async () => {
    const p = await play(MON)
    const writes = p.kv.writes
    expect(await p.ledger.setRestDays(p.auth, [6])).toEqual({
      ok: false,
      reason: 'rest_days_count',
    })
    expect(await p.ledger.setRestDays(p.auth, [1, 2, 3])).toEqual({
      ok: false,
      reason: 'rest_days_count',
    })
    expect(await p.ledger.setRestDays(p.auth, [4, 4])).toEqual({
      ok: false,
      reason: 'rest_days_same',
    })
    expect(await p.ledger.setRestDays(p.auth, [0, 3])).toEqual({
      ok: false,
      reason: 'rest_days_range',
    })
    expect(await p.ledger.setRestDays(p.auth, [3, 8])).toEqual({
      ok: false,
      reason: 'rest_days_range',
    })
    expect(await p.ledger.setRestDays(p.auth, [1.5, 3])).toEqual({
      ok: false,
      reason: 'rest_days_range',
    })
    expect(p.kv.writes).toBe(writes)
  })

  it('a second write before the Monday replaces the set to come', async () => {
    const p = await play(TUE)
    await p.ledger.setRestDays(p.auth, [1, 2])
    await p.ledger.setRestDays(p.auth, [4, 5])
    expect((await p.read()).restDays).toEqual({
      current: [6, 7],
      next: { days: [4, 5], from: MON + 7 },
    })
  })
})

describe('the journal calls', () => {
  it('refuse a token the books do not know', async () => {
    const p = await play(MON)
    const stranger = { deviceToken: 'nobody' }
    expect(await p.ledger.journal(stranger)).toEqual({ reason: 'unauthorized' })
    expect(await p.ledger.setRestDays(stranger, [1, 2])).toEqual({
      ok: false,
      reason: 'unauthorized',
    })
  })

  it('refuse a banned account with its reason', async () => {
    const p = await play(MON)
    await p.ledger.host.ban(p.accountId, 'spam')
    expect(await p.ledger.journal(p.auth)).toMatchObject({ reason: 'banned' })
    expect(await p.ledger.setRestDays(p.auth, [1, 2])).toMatchObject({
      ok: false,
      reason: 'banned',
    })
  })

  it('an account delete takes its journal with it', async () => {
    const p = await play(MON)
    await p.meet()
    expect(await p.stored()).toBeDefined()
    await p.ledger.deleteAccount(p.auth)
    expect(await p.stored()).toBeUndefined()
  })

  it('a fresh account commits with nothing paid', async () => {
    const p = await play(MON)
    expect(await p.commit()).toEqual({ cursor: 0, events: [] })
  })
})
