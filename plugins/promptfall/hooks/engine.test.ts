import type { PluginState } from 'claude-code'
import { expect, test } from 'claude-code/testing'
import { GameEngine } from './engine'
import {
  type Auth,
  type Batch,
  type BatchAck,
  LocalServer,
  MemoryKeyValue,
  type ServerClient,
} from './vendor/protocol.js'
import { createInitialState, hashState } from './vendor/sim.js'

type Patch = Partial<PluginState['promptfall']>

/** A ServerClient that records batches and can hold or corrupt the next submit. */
class Recorder implements ServerClient {
  batches: Batch[] = []
  acks: BatchAck[] = []
  corruptNextSeq = false
  hold: Promise<void> | null = null
  constructor(private readonly inner: ServerClient) {}

  bootstrap(input: { clientVersion: string; deviceToken: string | null }) {
    return this.inner.bootstrap(input)
  }

  async submit(batch: Batch, auth: Auth): Promise<BatchAck> {
    const sent = this.corruptNextSeq ? { ...batch, seq: batch.seq + 5 } : batch
    this.corruptNextSeq = false
    this.batches.push(sent)
    if (this.hold) await this.hold
    const ack = await this.inner.submit(sent, auth)
    this.acks.push(ack)
    return ack
  }
}

function setup(kv = new MemoryKeyValue()) {
  let t = 1_000_000
  const now = async () => t
  const server = new LocalServer({
    kv,
    now,
    minClientVersion: '0.1.0',
    seedSource: () => 4242,
    tokenSource: () => crypto.randomUUID(),
  })
  const client = new Recorder(server)
  const patches: Patch[] = []
  const engine = new GameEngine({
    client,
    kv,
    now,
    newBatchId: () => crypto.randomUUID(),
    publish: async (patch) => {
      patches.push(patch)
    },
    onEffects: () => undefined,
  })
  return { kv, client, engine, patches, advance: (ms: number) => (t += ms), at: () => t }
}

test('start saves the device token and a second engine finds the same account', async () => {
  const a = setup()
  await a.engine.start()
  const token = await a.kv.get('deviceToken')
  expect(typeof token).toBe('string')
  expect(a.patches.some((p) => p.view?.firstRun === true)).toBe(true)
  const b = setup(a.kv)
  await b.engine.start()
  expect(b.engine.accountId()).toBe(a.engine.accountId())
  expect(b.patches.some((p) => p.view?.firstRun === false)).toBe(true)
})

test('twelve events flush as one batch from the initial hash', async () => {
  const { engine, client, at } = setup()
  await engine.start()
  for (let i = 0; i < 5; i++) engine.apply({ t: 'tool_call' }, at())
  for (let i = 0; i < 7; i++) engine.apply({ t: 'tick' }, at())
  await engine.flush()
  expect(client.batches).toHaveLength(1)
  expect(client.batches[0]?.events).toHaveLength(12)
  expect(client.batches[0]?.baseHash).toBe(hashState(createInitialState(4242)))
  expect(client.acks[0]).toMatchObject({ ok: true, seq: 1, duplicate: false })
})

test('a flush during a flush submits nothing', async () => {
  const { engine, client, at } = setup()
  await engine.start()
  engine.apply({ t: 'tick' }, at())
  let release: () => void = () => undefined
  client.hold = new Promise<void>((resolve) => {
    release = resolve
  })
  const first = engine.flush()
  engine.apply({ t: 'tick' }, at())
  await engine.flush()
  expect(client.batches).toHaveLength(1)
  release()
  await first
  client.hold = null
  await engine.flush()
  expect(client.batches).toHaveLength(2)
  expect(client.acks.map((a) => a.ok)).toEqual([true, true])
})

test('a seq mismatch adopts the server and the next flush succeeds', async () => {
  const { engine, client, at } = setup()
  await engine.start()
  engine.apply({ t: 'tick' }, at())
  client.corruptNextSeq = true
  await engine.flush()
  expect(client.acks[0]).toMatchObject({ ok: false, reason: 'seq_mismatch', seq: 0 })
  engine.apply({ t: 'tool_call' }, at())
  await engine.flush()
  expect(client.acks[1]).toMatchObject({ ok: true, seq: 1 })
})
