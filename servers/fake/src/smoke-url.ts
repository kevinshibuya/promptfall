import { fileURLToPath } from 'node:url'
import { type FetchLike, HealthSchema, HttpClient, MIN_CLIENT_VERSION } from '@promptfall/protocol'
import { Mirror } from '@promptfall/protocol/mirror'
import { nodeFetch } from './node-fetch'

/** Runs `fn`; a throw comes back as `<step>: <why>`. */
async function step<T>(name: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn()
  } catch (error) {
    throw new Error(`${name}: ${(error as Error).message}`)
  }
}

/**
 * The smoke by URL: the health route, a bootstrap that mints an account, one
 * batch of one tick that must commit, and one world poll, each logged as it
 * passes. Throws at the first step that fails, the step named in the message.
 */
export async function smokeUrl(
  baseUrl: string,
  fetch: FetchLike,
  log: (line: string) => void,
): Promise<void> {
  const base = baseUrl.replace(/\/$/, '')
  const client = new HttpClient({ baseUrl: base, fetch })

  const health = await step('health', async () => {
    const r = await fetch(`${base}/v1/health`, { method: 'GET', headers: {} })
    if (r.status !== 200) throw new Error(`status ${r.status}`)
    return HealthSchema.parse(JSON.parse(r.text))
  })
  log(`smoke: health ok, sim ${health.simVersion}`)

  const boot = await step('bootstrap', async () => {
    const boot = await client.bootstrap({ clientVersion: MIN_CLIENT_VERSION, deviceToken: null })
    if ('refusal' in boot) throw new Error(`refused: ${boot.refusal}, ${boot.message}`)
    return boot
  })
  log(`smoke: bootstrap ok, account ${boot.account.accountId}`)

  const mirror = new Mirror(boot)
  const ack = await step('batch', async () => {
    const ack = await client.submit(mirror.batch([{ t: 'tick' }]), mirror.auth())
    if (!ack.ok) throw new Error(`refused: ${ack.reason}`)
    return ack
  })
  log(`smoke: batch ok, seq ${ack.seq}`)

  const world = await step('world', async () => {
    const world = await client.world(mirror.auth(), 0)
    if ('reason' in world) throw new Error(`refused: ${world.reason}`)
    return world
  })
  log(`smoke: world ok, ${world.online} online`)
}

// `tsx src/smoke-url.ts <url>`: what deploy/smoke.sh runs.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const url = process.argv[2]
  if (!url) {
    console.error('usage: tsx src/smoke-url.ts <url>')
    process.exit(2)
  }
  try {
    await smokeUrl(url, nodeFetch, (line) => console.log(line))
  } catch (error) {
    console.error(`smoke: ${(error as Error).message}`)
    process.exit(1)
  }
}
