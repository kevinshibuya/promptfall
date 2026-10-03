import { HttpClient, MemoryKeyValue } from '@promptfall/protocol'
import { runServerContract } from '@promptfall/protocol/contract'
import { afterAll } from 'vitest'
import { createFakeServer } from './server'
import { nodeFetch } from './test-support'

const open: { close(): Promise<void> }[] = []
afterAll(async () => {
  await Promise.all(open.map((s) => s.close()))
})

let counter = 0

runServerContract('HTTP fake', async (clock, { flags }) => {
  const server = createFakeServer({
    kv: new MemoryKeyValue(),
    now: clock.now,
    speed: 1,
    flags,
    seedSource: () => 2000 + counter++,
    tokenSource: () => crypto.randomUUID(),
    playerName: 'player',
    seed: 1,
  })
  const listening = await server.listen(0)
  open.push(listening)
  return {
    client: new HttpClient({ baseUrl: `http://127.0.0.1:${listening.port}`, fetch: nodeFetch }),
    host: server.ledger.host,
  }
})
