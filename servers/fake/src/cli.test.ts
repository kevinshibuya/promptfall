import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const CLI = join(import.meta.dirname, 'cli.ts')

/** The CLI under tsx, its stdout collected from the start. */
function run(args: string[], env: Record<string, string | undefined> = process.env) {
  const child = spawn(process.execPath, ['--import', 'tsx', CLI, ...args], {
    cwd: import.meta.dirname,
    env,
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
    /** Waits until stdout matches, failing when the process exits first. */
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

describe('the host CLI', () => {
  it('--help lists --host and exits before any store opens', async () => {
    const store = join(mkdtempSync(join(tmpdir(), 'pf-cli-')), 'never.sqlite')
    const cli = run(['--help', '--store', `sqlite:${store}`])
    expect(await cli.exit).toBe(0)
    expect(cli.out()).toMatch(/^ {2}--host <addr> /m)
    expect(existsSync(store)).toBe(false)
  })

  it('binds the --host it is given and logs each request on stdout', async () => {
    const store = join(mkdtempSync(join(tmpdir(), 'pf-cli-')), 'pf.sqlite')
    const cli = run([
      '--host',
      '0.0.0.0',
      '--port',
      '0',
      '--bots',
      '0',
      '--store',
      `sqlite:${store}`,
    ])
    try {
      const [, port] = await cli.waitFor(/on http:\/\/0\.0\.0\.0:(\d+) /)
      const r = await fetch(`http://127.0.0.1:${port}/v1/health`)
      expect(r.status).toBe(200)
      await cli.waitFor(/^GET \/v1\/health 200 \d+ms$/m)
    } finally {
      cli.child.kill('SIGTERM')
      await cli.exit
    }
  })

  it('--link takes github or fake; a github host names a missing client id at start', async () => {
    const bad = run(['--link', 'gitlab'])
    expect(await bad.exit).toBe(2)
    const store = join(mkdtempSync(join(tmpdir(), 'pf-cli-')), 'pf.sqlite')
    const { PROMPTFALL_GITHUB_CLIENT_ID: _, ...env } = process.env
    const cli = run(
      ['--port', '0', '--bots', '0', '--store', `sqlite:${store}`, '--link', 'github'],
      env,
    )
    try {
      await cli.waitFor(/ link github \(no PROMPTFALL_GITHUB_CLIENT_ID: link starts refused\)/)
    } finally {
      cli.child.kill('SIGTERM')
      await cli.exit
    }
  })
})
