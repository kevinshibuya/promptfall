import { randomInt, randomUUID } from 'node:crypto'
import { resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { HttpClient } from '@promptfall/protocol'
import { bossInRebase, nextGridPoint } from './boss-in'
import { startBots } from './bots'
import { VirtualClock } from './clock'
import { FileKeyValue } from './file-kv'
import { parseFlags, parsePlayerName } from './flags'
import { nodeFetch } from './node-fetch'
import { createFakeServer } from './server'
import type { HostStore } from './store'

// `pnpm fake -- --port 7777` passes a leading `--`; `pnpm fake --port 7777` does not.
const argv = process.argv.slice(2)
if (argv[0] === '--') argv.shift()

const { values } = parseArgs({
  args: argv,
  options: {
    port: { type: 'string', default: '7777' },
    seed: { type: 'string', default: '1' },
    speed: { type: 'string', default: '1' },
    'player-name': { type: 'string', default: 'player' },
    data: { type: 'string', default: '.promptfall/fake.json' },
    bots: { type: 'string', default: '12' },
    flag: { type: 'string', multiple: true, default: [] },
    'boss-in': { type: 'string' },
    store: { type: 'string' },
    help: { type: 'boolean', short: 'h', default: false },
  },
  strict: true,
})

if (values.help) {
  console.log(`usage: pnpm fake [-- flags]

  --port <n>          port to listen on (default 7777; 0 picks one)
  --seed <n>          world seed (default 1)
  --speed <x>         virtual ms per real ms (default 1)
  --player-name <s>   the login a link approves (default player)
  --data <path>       the JSON store file (default .promptfall/fake.json)
  --store sqlite:<path>
                      run on a SQLite file instead of the JSON store
  --bots <n>          bots on the market (default 12; 0 for none)
  --flag <name>=true|false
                      set a server flag; repeatable
  --boss-in <s>       move the clock so the next world boss spawns in about s real seconds
  -h, --help          print this and exit`)
  process.exit(0)
}

function positive(name: string, raw: string, integer: boolean): number {
  const n = Number(raw)
  if (!Number.isFinite(n) || n <= 0 || (integer && !Number.isInteger(n))) {
    console.error(`promptfall fake: --${name} wants a positive ${integer ? 'integer' : 'number'}`)
    process.exit(2)
  }
  return n
}

const port = Number(values.port)
if (!Number.isInteger(port) || port < 0 || port > 65535) {
  console.error('promptfall fake: --port wants 0 to 65535')
  process.exit(2)
}
const seed = positive('seed', values.seed, true)
const speed = positive('speed', values.speed, false)
// `pnpm fake` runs in servers/fake; a relative --data or --store path is relative to where pnpm was invoked.
const cwd = process.env.INIT_CWD ?? process.cwd()
const data = resolve(cwd, values.data)
const SQLITE = 'sqlite:'
let sqlitePath: string | null = null
if (values.store !== undefined) {
  if (!values.store.startsWith(SQLITE) || values.store.length === SQLITE.length) {
    console.error('promptfall fake: --store wants sqlite:<path>')
    process.exit(2)
  }
  sqlitePath = resolve(cwd, values.store.slice(SQLITE.length))
}
const botCount = Number(values.bots)
if (!Number.isInteger(botCount) || botCount < 0) {
  console.error('promptfall fake: --bots wants 0 or more')
  process.exit(2)
}

let flags: ReturnType<typeof parseFlags>
try {
  flags = parseFlags(values.flag)
} catch (error) {
  console.error(`promptfall fake: ${(error as Error).message}`)
  process.exit(2)
}

let playerName: string
try {
  playerName = parsePlayerName(values['player-name'])
} catch (error) {
  console.error(`promptfall fake: ${(error as Error).message}`)
  process.exit(2)
}

const bossIn = values['boss-in'] === undefined ? null : positive('boss-in', values['boss-in'], true)

// node:sqlite loads only for a SQLite run, so the JSON default runs as it did.
const kv: HostStore =
  sqlitePath === null
    ? new FileKeyValue(data)
    : new (await import('./sqlite-kv')).SqliteKeyValue(sqlitePath)
// --boss-in: a dev flag for the manual pass. The clock only ever moves forward, so it stays
// monotonic; the file's clock is rebased at the first flush.
let persisted = kv.persistedClock
if (bossIn !== null) {
  const realNow = Date.now()
  const virtualNow = persisted
    ? persisted.virtualAt + Math.max(0, realNow - persisted.realAt) * speed
    : realNow
  const target = bossInRebase(virtualNow, bossIn, speed)
  if (target !== null) persisted = { virtualAt: target, realAt: realNow }
}
const clock = new VirtualClock({ speed, persisted })
kv.attachClock(() => clock.snapshot())

const server = createFakeServer({
  kv,
  now: () => clock.now(),
  speed,
  flags,
  seedSource: () => randomInt(0, 2 ** 32),
  tokenSource: () => randomUUID(),
  playerName,
  seed,
})

const listening = await server.listen(port)
/** Real seconds to the next grid point. */
function bossInSeconds(): number {
  const now = clock.nowSync()
  return Math.round((nextGridPoint(now) - now) / speed / 1000)
}

const passed = Object.entries(flags).map(([name, value]) => `${name}=${value}`)
console.log(
  `promptfall fake on http://127.0.0.1:${listening.port} seed ${seed} speed ${speed} ${sqlitePath === null ? `data ${data}` : `store sqlite:${sqlitePath}`}` +
    (passed.length > 0 ? ` flags ${passed.join(',')}` : '') +
    (bossIn !== null ? ` boss in ${bossInSeconds()}s` : ''),
)
// The clock is on disk from the start, so a restart never resumes behind it.
kv.flushSync()

const bots =
  botCount > 0
    ? startBots({
        client: new HttpClient({ baseUrl: `http://127.0.0.1:${listening.port}`, fetch: nodeFetch }),
        host: server.ledger.host,
        kv,
        seed,
        count: botCount,
        speed,
        schedule: (ms, fn) => {
          const handle = setTimeout(fn, ms)
          return { cancel: () => clearTimeout(handle) }
        },
        log: (line) => {
          if (process.env.PROMPTFALL_DEBUG) console.debug(line)
        },
        onError: (line) => console.error(line),
      })
    : null

const sweep = setInterval(() => {
  server.ledger.host.sweep().catch((error) => console.error('promptfall fake: sweep', error))
}, 60_000 / speed)

let closing = false
async function shutdown(): Promise<void> {
  if (closing) return
  closing = true
  clearInterval(sweep)
  bots?.stop()
  await listening.close()
  kv.flushSync()
  kv.close()
  console.log('promptfall fake stopped')
  process.exit(0)
}

process.on('SIGINT', () => void shutdown())
process.on('SIGTERM', () => void shutdown())
