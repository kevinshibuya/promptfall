import { mkdirSync, readdirSync, renameSync, rmSync } from 'node:fs'
import { join } from 'node:path'

/** Copies kept in the directory; the oldest go first. */
export const BACKUP_KEEP = 7
/** The daily copy's time, UTC. The box's cron asks for its own copy over SIGUSR1 later on. */
export const BACKUP_AT_UTC = { hour: 3, minute: 0 }

const DAY = 86_400_000
/** `promptfall-<UTC stamp>.sqlite`: the name sorts by time. */
const COPY = /^promptfall-\d{8}T\d{9}Z\.sqlite$/

export type Backups = {
  /** Writes one copy now; answers its path, or null when it failed (logged). */
  copy(reason: string): Promise<string | null>
  /** Resolves when every copy asked for so far has finished. */
  idle(): Promise<void>
  /** Disarms the daily timer. */
  stop(): void
}

/** Real ms until the next `at` strictly after `now`. */
function untilNext(now: number, at: { hour: number; minute: number }): number {
  const d = new Date(now)
  let next = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), at.hour, at.minute)
  if (next <= now) next += DAY
  return next - now
}

/**
 * The host's backups: a consistent copy of the store in `dir` daily at a fixed
 * UTC time and whenever `copy` is called, keeping the newest `keep`. Copies run
 * one at a time; each lands under a temporary name and is renamed when whole,
 * so a reader of `dir` never sees half a copy.
 */
export function startBackups(options: {
  dir: string
  /** Writes a consistent copy of the store to the path. */
  copy: (path: string) => Promise<void>
  realNow?: () => number
  schedule: (ms: number, fn: () => void) => { cancel(): void }
  log: (line: string) => void
  keep?: number
  at?: { hour: number; minute: number }
}): Backups {
  const { dir, log } = options
  const realNow = options.realNow ?? Date.now
  const keep = options.keep ?? BACKUP_KEEP
  const at = options.at ?? BACKUP_AT_UTC
  let chain: Promise<unknown> = Promise.resolve()
  let timer: { cancel(): void } | null = null

  async function write(reason: string): Promise<string | null> {
    const stamp = new Date(realNow()).toISOString().replace(/[-:.]/g, '')
    const path = join(dir, `promptfall-${stamp}.sqlite`)
    const partial = `${path}.partial`
    try {
      mkdirSync(dir, { recursive: true })
      await options.copy(partial)
      renameSync(partial, path)
    } catch (error) {
      rmSync(partial, { force: true })
      log(`promptfall backup: ${reason} failed: ${(error as Error).message}`)
      return null
    }
    log(`promptfall backup: ${reason} ${path}`)
    const copies = readdirSync(dir)
      .filter((name) => COPY.test(name))
      .sort()
    for (const old of copies.slice(0, Math.max(0, copies.length - keep))) {
      rmSync(join(dir, old), { force: true })
    }
    return path
  }

  function copy(reason: string): Promise<string | null> {
    const next = chain.then(() => write(reason))
    chain = next
    return next
  }

  function arm(): void {
    timer = options.schedule(untilNext(realNow(), at), () => {
      void copy('scheduled')
      arm()
    })
  }
  arm()

  return {
    copy,
    idle: () => chain.then(() => undefined),
    stop: () => {
      timer?.cancel()
      timer = null
    },
  }
}
