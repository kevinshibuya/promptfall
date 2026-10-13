import { MemoryKeyValue } from '@promptfall/protocol'
import { runServerContract } from '@promptfall/protocol/contract'
import type { GameState } from '@promptfall/sim'
import { approveAs, Ledger } from './ledger'
import { patchRecord, rewindRecord } from './testing'

let counter = 0

runServerContract('Ledger over MemoryKeyValue', async (clock, { flags, kv, migrations, log }) => {
  const store = kv ?? new MemoryKeyValue()
  const ledger = new Ledger({
    kv: store,
    now: clock.now,
    minClientVersion: '0.1.0',
    seedSource: () => 1000 + counter++,
    tokenSource: () => crypto.randomUUID(),
    flags,
    linkApprover: approveAs('player'),
    ...(migrations && { migrations }),
    ...(log && { log }),
  })
  return {
    client: ledger,
    host: {
      ...ledger.host,
      rewind: (id: string, v: number) => rewindRecord(store, id, v),
      patch: (id: string, fn: (s: GameState) => GameState) => patchRecord(store, id, fn),
    },
  }
})
