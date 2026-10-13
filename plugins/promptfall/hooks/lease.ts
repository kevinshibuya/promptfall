import type { KeyValue } from './vendor/protocol.js'

export const LEASE_KEY = 'lease'
export const LEASE_TTL_MS = 30_000

/**
 * `startedAt`: when the holder's session began, as the engine counts it (a resumed or forked session
 * keeps its first launch). Left out by a holder that could not read it, and by older records.
 */
export type Lease = { owner: string; until: number; startedAt?: number }

function isLease(value: unknown): value is Lease {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as Lease).owner === 'string' &&
    typeof (value as Lease).until === 'number'
  )
}

function leaseOf(owner: string, now: number, startedAt: number | undefined): Lease {
  return startedAt === undefined
    ? { owner, until: now + LEASE_TTL_MS }
    : { owner, until: now + LEASE_TTL_MS, startedAt }
}

/**
 * Takes or renews the primary-session lease. `$.store` has no compare-and-set,
 * so this writes, reads back and trusts the read: best effort, as the spec says.
 */
export async function acquire(
  kv: KeyValue,
  owner: string,
  now: number,
  startedAt?: number,
): Promise<boolean> {
  const held = await kv.get(LEASE_KEY)
  const free = !isLease(held) || held.until <= now || held.owner === owner
  if (!free) return false
  await kv.set(LEASE_KEY, leaseOf(owner, now, startedAt))
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
export async function claim(
  kv: KeyValue,
  owner: string,
  now: number,
  startedAt?: number,
): Promise<boolean> {
  await kv.set(LEASE_KEY, leaseOf(owner, now, startedAt))
  const after = await kv.get(LEASE_KEY)
  return isLease(after) && after.owner === owner
}

/** Whether `owner` holds the lease right now. */
export async function holds(kv: KeyValue, owner: string): Promise<boolean> {
  const held = await kv.get(LEASE_KEY)
  return isLease(held) && held.owner === owner
}

/**
 * Whether another owner holds the lease for the session that began at `startedAt`: this session,
 * from the process it left. The agents view moves a conversation into a new process, which mints
 * a new owner while the old one still renews.
 */
export async function heldBySameSession(
  kv: KeyValue,
  owner: string,
  startedAt: number | undefined,
): Promise<boolean> {
  const held = await kv.get(LEASE_KEY)
  return (
    startedAt !== undefined && isLease(held) && held.owner !== owner && held.startedAt === startedAt
  )
}
