import { spawnSync } from 'node:child_process'
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const DEPLOY = join(import.meta.dirname, '..', 'deploy')

// Stand-ins on PATH. Each logs its argv to $STUB_LOG; $STUB_FAIL names the step that fails.
const STUBS: Record<string, string> = {
  // ssh joins its arguments into one remote command line, as the real one does, and runs it here.
  ssh: `#!/usr/bin/env bash
echo "ssh $*" >>"$STUB_LOG"
shift
exec bash -c "$*"
`,
  sleep: '#!/usr/bin/env bash\n',
  docker: `#!/usr/bin/env bash
echo "docker $*" >>"$STUB_LOG"
copies="$STUB_STATE/copies"
fails() { [ "\${STUB_FAIL:-}" = "$1" ]; }
case "$*" in
  'pull '*) fails pull && exit 1; exit 0 ;;
  'compose up '*) exit 0 ;;
  *' node -e '*) fails health && exit 1; echo '{"ok":true}'; exit 0 ;;
  'compose logs '*) exit 0 ;;
  *' ls -1 /backups') fails list && exit 1; cat "$copies" 2>/dev/null; exit 0 ;;
  'compose kill '*)
    fails signal && exit 1
    fails copy || echo "promptfall-20261010T030000000Z.sqlite" >>"$copies"
    exit 0 ;;
  *' gzip '*) fails gzip && exit 1; exit 0 ;;
  *' rm -f '*) exit 0 ;;
  *' version') fails rclone && exit 1; exit 0 ;;
  *' copyto '*) fails upload && exit 1; exit 0 ;;
  *' lsf '*) fails missing || echo "promptfall-20261010T030000000Z.sqlite.gz"; exit 0 ;;
  *' delete '*) fails retention && exit 1; exit 0 ;;
esac
echo "stub docker: unexpected $*" >&2
exit 3
`,
}

function sandbox() {
  const root = mkdtempSync(join(tmpdir(), 'pf-deploy-'))
  const bin = join(root, 'bin')
  const state = join(root, 'state')
  const box = join(root, 'apps', 'promptfall')
  for (const d of [bin, state, box]) mkdirSync(d, { recursive: true })
  for (const [name, text] of Object.entries(STUBS)) {
    writeFileSync(join(bin, name), text)
    chmodSync(join(bin, name), 0o755)
  }
  const log = join(root, 'calls.log')
  writeFileSync(log, '')
  return {
    box,
    state,
    run(script: string, args: string[], env: Record<string, string> = {}) {
      const r = spawnSync(join(DEPLOY, script), args, {
        encoding: 'utf8',
        env: {
          PATH: `${bin}:${process.env.PATH}`,
          HOME: root,
          STUB_LOG: log,
          STUB_STATE: state,
          PROMPTFALL_DIR: box,
          ...env,
        },
      })
      return { status: r.status, out: r.stdout, err: r.stderr }
    },
    calls: () => readFileSync(log, 'utf8').trim().split('\n').filter(Boolean),
  }
}

describe('deploy.sh and rollback.sh', () => {
  it('--dry-run prints the ssh line and the remote script without connecting', () => {
    const s = sandbox()
    const r = s.run('deploy.sh', ['--dry-run', 'v0.3.0'])
    expect(r.status).toBe(0)
    expect(r.out).toContain(`ssh $PROMPTFALL_BOX bash -s -- deploy ${s.box} `)
    expect(r.out).toContain('ghcr.io/kevinshibuya/promptfall:v0.3.0')
    expect(r.out).toContain('docker compose up --detach')
    expect(s.calls()).toEqual([])
  })

  it('a real run without PROMPTFALL_BOX refuses before any ssh', () => {
    const s = sandbox()
    const r = s.run('deploy.sh', ['v0.3.0'])
    expect(r.status).toBe(2)
    expect(r.err).toMatch(/PROMPTFALL_BOX is not set/)
    expect(s.calls()).toEqual([])
  })

  it('refuses a tag that would not be plain on the ssh line', () => {
    const s = sandbox()
    const r = s.run('deploy.sh', ['v1;rm -rf ~'], { PROMPTFALL_BOX: 'box' })
    expect(r.status).toBe(2)
    expect(s.calls()).toEqual([])
  })

  it('a deploy pulls the tag, keeps the running image as PREVIOUS_IMAGE and waits for health', () => {
    const s = sandbox()
    const env = join(s.box, '.env')
    writeFileSync(
      env,
      'IMAGE=ghcr.io/kevinshibuya/promptfall:v0.2.0\nPREVIOUS_IMAGE=old\nPROMPTFALL_BOTS=6\n',
    )
    const r = s.run('deploy.sh', ['v0.3.0'], { PROMPTFALL_BOX: 'kevin@box' })
    expect(r.status).toBe(0)
    expect(readFileSync(env, 'utf8')).toBe(
      'PROMPTFALL_BOTS=6\nIMAGE=ghcr.io/kevinshibuya/promptfall:v0.3.0\nPREVIOUS_IMAGE=ghcr.io/kevinshibuya/promptfall:v0.2.0\n',
    )
    const calls = s.calls()
    expect(calls[0]).toMatch(/^ssh kevin@box bash -s -- deploy /)
    expect(calls).toContain('docker pull ghcr.io/kevinshibuya/promptfall:v0.3.0')
    expect(calls).toContain('docker compose up --detach --remove-orphans')
    // Each probe is bounded, so a container that accepts and stalls cannot hold the deploy.
    expect(calls.find((c) => c.includes(' node -e '))).toContain('AbortSignal.timeout(5000)')
    expect(r.out).toContain('is healthy')
  })

  it('a redeploy of the running tag keeps the rollback target', () => {
    const s = sandbox()
    const env = join(s.box, '.env')
    writeFileSync(
      env,
      'IMAGE=ghcr.io/kevinshibuya/promptfall:v0.3.0\nPREVIOUS_IMAGE=ghcr.io/kevinshibuya/promptfall:v0.2.0\n',
    )
    expect(s.run('deploy.sh', ['v0.3.0'], { PROMPTFALL_BOX: 'box' }).status).toBe(0)
    expect(readFileSync(env, 'utf8')).toBe(
      'IMAGE=ghcr.io/kevinshibuya/promptfall:v0.3.0\nPREVIOUS_IMAGE=ghcr.io/kevinshibuya/promptfall:v0.2.0\n',
    )
  })

  it('an unhealthy deploy fails and says how to roll back', () => {
    const s = sandbox()
    writeFileSync(join(s.box, '.env'), 'IMAGE=a\nPREVIOUS_IMAGE=a\n')
    const r = s.run('deploy.sh', ['v0.3.0'], { PROMPTFALL_BOX: 'box', STUB_FAIL: 'health' })
    expect(r.status).toBe(1)
    expect(r.err).toMatch(/did not answer \/v1\/health/)
    expect(r.err).toMatch(/deploy\/rollback\.sh/)
  })

  it('a rollback swaps PREVIOUS_IMAGE back, and a second one rolls forward', () => {
    const s = sandbox()
    const env = join(s.box, '.env')
    writeFileSync(env, 'IMAGE=new\nPREVIOUS_IMAGE=old\n')
    expect(s.run('rollback.sh', [], { PROMPTFALL_BOX: 'box' }).status).toBe(0)
    expect(readFileSync(env, 'utf8')).toBe('IMAGE=old\nPREVIOUS_IMAGE=new\n')
    expect(s.calls()).toContain('docker pull old')
    expect(s.run('rollback.sh', [], { PROMPTFALL_BOX: 'box' }).status).toBe(0)
    expect(readFileSync(env, 'utf8')).toBe('IMAGE=new\nPREVIOUS_IMAGE=old\n')
  })

  it('a rollback takes no tag and dry-runs like a deploy', () => {
    const s = sandbox()
    expect(s.run('rollback.sh', ['v1'], { PROMPTFALL_BOX: 'box' }).status).toBe(2)
    const r = s.run('rollback.sh', ['--dry-run'])
    expect(r.status).toBe(0)
    expect(r.out).toContain('bash -s -- rollback ')
    expect(s.calls()).toEqual([])
  })
})

describe('backup.sh', () => {
  function boxWithR2() {
    const s = sandbox()
    writeFileSync(join(s.box, 'r2.env'), 'RCLONE_CONFIG_R2_TYPE=s3\n')
    writeFileSync(join(s.state, 'copies'), 'promptfall-20261009T030000000Z.sqlite\n')
    return s
  }

  it('signals the host, waits for the new copy, gzips it and ships it under nightly/', () => {
    const s = boxWithR2()
    const r = s.run('backup.sh', [], { PROMPTFALL_BACKUP_WAIT: '3' })
    expect(r.err).toBe('')
    expect(r.status).toBe(0)
    const calls = s.calls()
    expect(calls).toContain('docker compose kill --signal SIGUSR1 promptfall')
    expect(calls).toContain(
      'docker compose exec -T promptfall gzip --keep --force /backups/promptfall-20261010T030000000Z.sqlite',
    )
    expect(calls.find((c) => c.includes(' copyto '))).toMatch(
      /-v promptfall_backups:\/backups:ro rclone\/rclone:\S+ --config \/dev\/null copyto \/backups\/promptfall-20261010T030000000Z\.sqlite\.gz r2:promptfall-backups\/nightly\/promptfall-20261010T030000000Z\.sqlite\.gz$/,
    )
    expect(calls.find((c) => c.includes(' delete '))).toMatch(
      /delete --min-age 30d r2:promptfall-backups\/nightly\/$/,
    )
    expect(r.out).toContain('shipped r2:promptfall-backups/nightly/')
  })

  it.each([
    ['signal', /^promptfall backup: signal: /m],
    ['copy', /^promptfall backup: copy: no new copy/m],
    ['list', /^promptfall backup: copy: cannot list/m],
    ['gzip', /^promptfall backup: gzip: /m],
    ['rclone', /^promptfall backup: rclone: /m],
    ['upload', /^promptfall backup: upload: rclone could not copy/m],
    ['missing', /^promptfall backup: upload: .* is not in r2:/m],
    ['retention', /^promptfall backup: retention: /m],
  ])('fails loudly when %s fails', (step, message) => {
    const s = boxWithR2()
    const r = s.run('backup.sh', [], { PROMPTFALL_BACKUP_WAIT: '3', STUB_FAIL: step })
    expect(r.status).not.toBe(0)
    expect(r.err).toMatch(message)
  })

  it('refuses without the R2 settings', () => {
    const s = sandbox()
    const r = s.run('backup.sh', [])
    expect(r.status).toBe(1)
    expect(r.err).toMatch(/rclone: no R2 settings/)
    expect(s.calls()).toEqual([])
  })
})
