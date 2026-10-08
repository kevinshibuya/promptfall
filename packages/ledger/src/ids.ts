import type { KeyValue } from '@promptfall/protocol'

export const COUNTER_KEY = 'pf:counter'

/** The next ledger id for a prefix (`L` listings, `O` orders, `t` transferred goods, `r` boss rewards, `sb` sandbox bosses), base 36 over one global counter. */
export async function nextLedgerId(
  kv: KeyValue,
  prefix: 'L' | 'O' | 't' | 'r' | 'sb',
): Promise<string> {
  const raw = await kv.get(COUNTER_KEY)
  const n = typeof raw === 'number' ? raw : 0
  await kv.set(COUNTER_KEY, n + 1)
  return prefix + n.toString(36)
}
