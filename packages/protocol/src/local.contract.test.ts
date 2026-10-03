import { runServerContract } from './contract'
import { LocalServer } from './fake/local'
import { MemoryKeyValue } from './kv'

let counter = 0

runServerContract('LocalServer over MemoryKeyValue', async (clock) => {
  return new LocalServer({
    kv: new MemoryKeyValue(),
    now: clock.now,
    minClientVersion: '0.1.0',
    seedSource: () => 1000 + counter++,
    tokenSource: () => crypto.randomUUID(),
  })
})
