import type { KeyValue } from './vendor/protocol.js'

export const LEASE_KEY = 'lease'
export const LEASE_TTL_MS = 30_000

export type Lease = { owner: string; until: number }

function isLease(value: unknown): value is Lease {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as Lease).owner === 'string' &&
    typeof (value as Lease).until === 'number'
  )
}

/**
 * Takes or renews the primary-session lease. `$.store` has no compare-and-set,
 * so this writes, reads back and trusts the read: best effort, as the spec says.
 */
export async function acquire(kv: KeyValue, owner: string, now: number): Promise<boolean> {
  const held = await kv.get(LEASE_KEY)
  const free = !isLease(held) || held.until <= now || held.owner === owner
  if (!free) return false
  await kv.set(LEASE_KEY, { owner, until: now + LEASE_TTL_MS } satisfies Lease)
  const after = await kv.get(LEASE_KEY)
  return isLease(after) && after.owner === owner
}

/** Gives the lease up at once, if `owner` holds it, so the next session need not wait out the TTL. */
export async function release(kv: KeyValue, owner: string): Promise<void> {
  const held = await kv.get(LEASE_KEY)
  if (isLease(held) && held.owner === owner) await kv.delete(LEASE_KEY)
}

/**
 * Takes the lease whoever holds it: the player is using this session, so it plays.
 * The session that held it sees the change before its next flush and steps back.
 */
export async function claim(kv: KeyValue, owner: string, now: number): Promise<boolean> {
  await kv.set(LEASE_KEY, { owner, until: now + LEASE_TTL_MS } satisfies Lease)
  const after = await kv.get(LEASE_KEY)
  return isLease(after) && after.owner === owner
}

/** Whether `owner` holds the lease right now. */
export async function holds(kv: KeyValue, owner: string): Promise<boolean> {
  const held = await kv.get(LEASE_KEY)
  return isLease(held) && held.owner === owner
}
