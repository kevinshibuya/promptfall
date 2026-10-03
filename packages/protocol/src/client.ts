import type { EventKind, GameState } from '@promptfall/sim'
import type { Batch } from './schemas'

export type Auth = { deviceToken: string }

export type BatchAck =
  | { ok: true; seq: number; hash: string; duplicate: boolean }
  | { ok: false; reason: 'unauthorized' }
  | { ok: false; reason: 'version_gate'; minClientVersion: string }
  | { ok: false; reason: 'sim_version'; simVersion: number }
  | { ok: false; reason: 'seq_mismatch'; seq: number; state: GameState; hash: string }
  | {
      ok: false
      reason: 'hash_mismatch'
      seq: number
      state: GameState
      hash: string
      revokedItemIds: string[]
    }
  | {
      ok: false
      reason: 'rate_capped'
      seq: number
      state: GameState
      hash: string
      kind: EventKind
    }

export type ServerConfig = {
  minClientVersion: string
  simVersion: number
  flags: Record<string, boolean>
}

export type Account = {
  accountId: string
  seed: number
  createdAt: number
  displayName: string | null
  linked: null | { provider: 'github'; login: string }
}

export type Bootstrap = {
  deviceToken: string
  account: Account
  config: ServerConfig
  state: GameState
  seq: number
  hash: string
}

export interface ServerClient {
  bootstrap(input: { clientVersion: string; deviceToken: string | null }): Promise<Bootstrap>
  submit(batch: Batch, auth: Auth): Promise<BatchAck>
}

export type BudgetKind = 'tick' | 'tool_call' | 'rest' | 'turn_end'

export const BUDGETS: Record<BudgetKind, { refillMs: number; capacity: number }> = {
  tick: { refillMs: 2000, capacity: 70 },
  tool_call: { refillMs: 1000, capacity: 140 },
  rest: { refillMs: 5000, capacity: 30 },
  turn_end: { refillMs: 5000, capacity: 30 },
}
