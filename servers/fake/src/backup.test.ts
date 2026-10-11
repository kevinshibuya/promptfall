import { spawn } from 'node:child_process'
import { mkdtempSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { startBackups } from './backup'
import { SqliteKeyValue } from './sqlite-kv'

const DAY = 86_400_000
const CLI = join(import.meta.dirname, 'cli.ts')

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), 'pf-backup-'))
}

function copiesIn(dir: string): string[] {
  return readdirSync(dir).sort()
}

/** A timer that fires only when the test says so, moving the injected clock to its deadline. */
function manualTimer(clock: { now: number }) {
  const pending: { at: number; fn: () => void; cancelled: boolean }[] = []
  return {
    schedule(ms: number, fn: () => void) {
      const entry = { at: clock.now + ms, fn, cancelled: false }
      pending.push(entry)
      return {
        cancel: () => {
          entry.cancelled = true
        },
      }
    },
    /** Delays of the timers still armed. */
    armed: () => pending.filter((e) => !e.cancelled).map((e) => e.at - clock.now),
    fireNext() {
      const next = pending.find((e) => !e.cancelled)
      if (!next) throw new Error('no timer armed')
      next.cancelled = true
      clock.now = next.at
      next.fn()
    },
  }
}

/** The CLI under tsx, its stdout collected from the start. */
function run(args: string[]) {
  const child = spawn(process.execPath, ['--import', 'tsx', CLI, ...args], {
    cwd: import.meta.dirname,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let out = ''
  let err = ''
  child.stdout.on('data', (chunk: Buffer) => {
    out += chunk.toString('utf8')
  })
  child.stderr.on('data', (chunk: Buffer) => {
    err += chunk.toString('utf8')
  })
  const exit = new Promise<number | null>((resolve) => child.once('exit', resolve))
  return {
    child,
    exit,
    out: () => out,
    err: () => err,
    async waitFor(pattern: RegExp): Promise<RegExpExecArray> {
      for (;;) {
        const m = pattern.exec(out)
        if (m) return m
        if (child.exitCode !== null) throw new Error(`exit ${child.exitCode}: ${err}`)
        await new Promise((r) => setTimeout(r, 20))
      }
    },
  }
}

describe('a backup copy is written on schedule, on SIGUSR1 and on SIGTERM, keeping seven', () => {
  it('the scheduled copy lands at the fixed UTC time, then every day after', async () => {
    const dir = tempDir()
    const clock = { now: Date.UTC(2026, 9, 10, 1, 0, 0) }
    const timer = manualTimer(clock)
    const lines: string[] = []
    const backups = startBackups({
      dir,
      copy: async (path) => writeFileSync(path, 'copy'),
      realNow: () => clock.now,
      schedule: timer.schedule,
      log: (line) => lines.push(line),
      at: { hour: 3, minute: 30 },
    })
    // 01:00 UTC: the first copy is due at 03:30, two and a half hours away.
    expect(timer.armed()).toEqual([2.5 * 3_600_000])
    timer.fireNext()
    await backups.idle()
    expect(copiesIn(dir)).toEqual(['promptfall-20261010T033000000Z.sqlite'])
    expect(lines).toEqual([
      `promptfall backup: scheduled ${join(dir, 'promptfall-20261010T033000000Z.sqlite')}`,
    ])
    // At the time itself the next one is a day out, not now.
    expect(timer.armed()).toEqual([DAY])
    backups.stop()
    expect(timer.armed()).toEqual([])
  })

  it('a copy on demand logs its reason, and only the newest seven are kept', async () => {
    const dir = tempDir()
    const clock = { now: Date.UTC(2026, 9, 1, 12, 0, 0) }
    const timer = manualTimer(clock)
    const lines: string[] = []
    const backups = startBackups({
      dir,
      copy: async (path) => writeFileSync(path, 'copy'),
      realNow: () => clock.now,
      schedule: timer.schedule,
      log: (line) => lines.push(line),
    })
    // Not a copy: left alone by the pruning.
    writeFileSync(join(dir, 'promptfall-20261001T120000000Z.sqlite.gz'), 'shipped')
    const written: (string | null)[] = []
    for (let i = 0; i < 9; i++) {
      clock.now += 60_000
      written.push(await backups.copy(i % 2 === 0 ? 'signal' : 'shutdown'))
    }
    backups.stop()
    const copies = copiesIn(dir).filter((f) => f.endsWith('.sqlite'))
    expect(copies).toHaveLength(7)
    expect(copies.map((f) => join(dir, f))).toEqual(written.slice(2))
    expect(copiesIn(dir)).toContain('promptfall-20261001T120000000Z.sqlite.gz')
    expect(lines[0]).toBe(`promptfall backup: signal ${written[0]}`)
    expect(lines[1]).toBe(`promptfall backup: shutdown ${written[1]}`)
  })

  it('a failed copy is logged, leaves no partial file and keeps the schedule', async () => {
    const dir = tempDir()
    const clock = { now: Date.UTC(2026, 9, 10, 4, 0, 0) }
    const timer = manualTimer(clock)
    const lines: string[] = []
    const backups = startBackups({
      dir,
      copy: async (path) => {
        writeFileSync(path, 'half')
        throw new Error('disk full')
      },
      realNow: () => clock.now,
      schedule: timer.schedule,
      log: (line) => lines.push(line),
      at: { hour: 3, minute: 30 },
    })
    // 04:00 is past today's 03:30: tomorrow's.
    expect(timer.armed()).toEqual([DAY - 30 * 60_000])
    expect(await backups.copy('signal')).toBeNull()
    expect(copiesIn(dir)).toEqual([])
    expect(lines).toEqual(['promptfall backup: signal failed: disk full'])
    expect(timer.armed()).toHaveLength(1)
    backups.stop()
  })

  it('the host writes a copy on SIGUSR1 and another on SIGTERM, each one a store that opens', async () => {
    const root = tempDir()
    const store = join(root, 'data', 'pf.sqlite')
    const dir = join(root, 'backups')
    const cli = run([
      '--port',
      '0',
      '--bots',
      '0',
      '--store',
      `sqlite:${store}`,
      '--backup-dir',
      dir,
    ])
    let accountId = ''
    try {
      const [, port] = await cli.waitFor(/on http:\/\/127\.0\.0\.1:(\d+) .*backups /)
      const boot = await fetch(`http://127.0.0.1:${port}/v1/bootstrap`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ clientVersion: '0.0.0', deviceToken: null }),
      })
      expect(boot.status).toBe(200)
      accountId = ((await boot.json()) as { account: { accountId: string } }).account.accountId
      cli.child.kill('SIGUSR1')
      await cli.waitFor(/^promptfall backup: signal .*\.sqlite$/m)
      cli.child.kill('SIGTERM')
      expect(await cli.exit).toBe(0)
    } finally {
      if (cli.child.exitCode === null) cli.child.kill('SIGKILL')
    }
    expect(cli.out()).toMatch(/^promptfall backup: shutdown .*\.sqlite$/m)
    const copies = copiesIn(dir)
    expect(copies).toHaveLength(2)
    for (const name of copies) {
      const copy = new SqliteKeyValue(join(dir, name))
      expect(await copy.get(`pf:acct:${accountId}:record`)).toBeDefined()
      copy.close()
    }
  })

  it('--backup-dir without a SQLite store is refused', async () => {
    const cli = run(['--port', '0', '--bots', '0', '--backup-dir', tempDir()])
    expect(await cli.exit).toBe(2)
    expect(cli.err()).toMatch(/--backup-dir wants --store sqlite:<path>/)
  })
})
