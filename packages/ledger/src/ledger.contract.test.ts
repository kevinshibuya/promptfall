import { MemoryKeyValue } from '@promptfall/protocol'
import { runServerContract } from '@promptfall/protocol/contract'
import { approveAs, Ledger } from './ledger'

let counter = 0

runServerContract('Ledger over MemoryKeyValue', async (clock, { flags, kv }) => {
  const ledger = new Ledger({
    kv: kv ?? new MemoryKeyValue(),
    now: clock.now,
    minClientVersion: '0.1.0',
    seedSource: () => 1000 + counter++,
    tokenSource: () => crypto.randomUUID(),
    flags,
    linkApprover: approveAs('player'),
  })
  return { client: ledger, host: ledger.host }
})
