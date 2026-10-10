import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  type Auth,
  BOSS_GRID_MS,
  HttpClient,
  type KeyValue,
  MemoryKeyValue,
  type ServerClient,
} from '@promptfall/protocol'
import { type ContractClock, Mirror, runServerContract } from '@promptfall/protocol/contract'
import {
  createInitialState,
  GAUGE_FULL,
  type GameState,
  heroStats,
  type PlayerEvent,
} from '@promptfall/sim'
import { afterAll, describe, expect, it } from 'vitest'
import { createFakeServer } from './server'
import { SqliteKeyValue } from './sqlite-kv'
import { booted, nodeFetch } from './test-support'

const open = new Set<{ close(): Promise<void> }>()
const stores = new Set<SqliteKeyValue>()
afterAll(async () => {
  await Promise.all([...open].map((s) => s.close()))
  for (const store of stores) store.close()
})

let counter = 0

async function host(clock: ContractClock, flags: Record<string, boolean>, kv: KeyValue) {
  const server = createFakeServer({
    kv,
    now: clock.now,
    speed: 1,
    flags,
    seedSource: () => 2000 + counter++,
    tokenSource: () => crypto.randomUUID(),
    playerName: 'player',
    seed: 1,
  })
  const listening = await server.listen(0)
  open.add(listening)
  return {
    client: new HttpClient({ baseUrl: `http://127.0.0.1:${listening.port}`, fetch: nodeFetch }),
    host: server.ledger.host,
    async close() {
      open.delete(listening)
      await listening.close()
    },
  }
}

function tempFile(): string {
  return join(mkdtempSync(join(tmpdir(), 'pf-contract-')), 'promptfall.sqlite')
}

function openStore(path: string): SqliteKeyValue {
  const store = new SqliteKeyValue(path)
  stores.add(store)
  return store
}

runServerContract('HTTP fake', async (clock, { flags, kv }) =>
  host(clock, flags, kv ?? new MemoryKeyValue()),
)

/** The suite's shared store (rule 40) stands for one file: each host on it opens the file anew. */
const files = new WeakMap<KeyValue, string>()

runServerContract('HTTP fake over SQLite', async (clock, { flags, kv }) => {
  let path = kv && files.get(kv)
  if (!path) {
    path = tempFile()
    if (kv) files.set(kv, path)
  }
  return host(clock, flags, openStore(path))
})

/** A party of level 40 at full HP with full gauges: it deals damage on its first tick. */
function strongState(seed: number): GameState {
  const s = createInitialState(seed)
  const battle = { gauges: s.party.map((id) => ({ id, g: GAUGE_FULL })), queue: [], busy: 0 }
  const leveled = {
    ...s,
    battle,
    roster: s.roster.map((h) => (s.party.includes(h.id) ? { ...h, level: 40 } : h)),
  }
  return {
    ...leveled,
    roster: leveled.roster.map((h) =>
      s.party.includes(h.id) ? { ...h, hp: heroStats(leveled, h).hp } : h,
    ),
  }
}

async function bossOf(client: ServerClient, auth: Auth) {
  const w = await client.world(auth, 0)
  if ('reason' in w) throw new Error('unauthorized')
  return w.boss
}

describe('HTTP fake over SQLite', () => {
  it('a restarted host on the same file resumes the boss', async () => {
    let t = 1_700_000_000_000
    const clock: ContractClock = {
      now: async () => t,
      advance: (ms) => {
        t += ms
      },
    }
    const path = tempFile()
    const firstStore = openStore(path)
    const first = await host(clock, {}, firstStore)
    const m = await first.host.mint({ state: strongState(94), name: 'Ann', linked: true })
    const auth = { deviceToken: m.deviceToken }
    const mirror = new Mirror(
      await booted(first.client, { clientVersion: '0.1.0', deviceToken: m.deviceToken }),
    )
    // Present just before the grid point, polled just after it: the boss spawns.
    clock.advance(BOSS_GRID_MS - (t % BOSS_GRID_MS) - 10_000)
    await bossOf(first.client, auth)
    clock.advance(10_000)
    expect(await bossOf(first.client, auth)).not.toBeNull()
    const info = await first.client.account(auth)
    if ('reason' in info) throw new Error('unauthorized')
    mirror.receive(info.delivery)
    const ticks: PlayerEvent[] = Array.from({ length: 5 }, () => ({ t: 'tick' }))
    const batch = mirror.batch(ticks)
    expect(await first.client.submit(batch, auth)).toMatchObject({ ok: true })
    const before = await bossOf(first.client, auth)
    expect(before?.hp).toBeLessThan(before?.maxHp ?? 0)

    // The CLI's shutdown: stop listening, flush, close the file.
    await first.close()
    firstStore.flushSync()
    firstStore.close()
    stores.delete(firstStore)

    const second = await host(clock, {}, openStore(path))
    expect(await bossOf(second.client, auth)).toEqual(before)
  })
})
