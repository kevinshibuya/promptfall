import type { KeyValue } from '@promptfall/protocol'
import { type GameState, hashState } from '@promptfall/sim'
import { type AccountRecord, recordKey } from './books'

/**
 * For test hosts only: rewrites a stored record as one written at sim version `v`, both snapshots
 * stamped `v` and its log kept, so a contract rule can load a record from another version.
 */
export async function rewindRecord(kv: KeyValue, accountId: string, v: number): Promise<void> {
  const record = (await kv.get(recordKey(accountId))) as AccountRecord | undefined
  if (!record) throw new Error(`rewind: no account ${accountId}`)
  const committedState = { ...record.committedState, v } as unknown as GameState
  const state = { ...record.state, v } as unknown as GameState
  await kv.set(recordKey(accountId), {
    ...record,
    state,
    committedState,
    committedHash: hashState(committedState),
  })
}
