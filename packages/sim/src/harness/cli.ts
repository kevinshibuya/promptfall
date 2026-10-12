import { parseArgs, USAGE } from './args'
import { outOfBand, probe } from './probe'
import { runScenario } from './scenario'

const parsed = parseArgs(process.argv.slice(2))

if (parsed.mode === 'error') {
  console.error(`${parsed.message}\n${USAGE}`)
  process.exit(2)
}

if (parsed.mode === 'probe') {
  try {
    const p = probe(parsed.tier)
    console.log(JSON.stringify({ probe: p }, null, 2))
    const out = parsed.assert ? outOfBand(p) : []
    for (const line of out) console.error(line)
    if (out.length > 0) process.exit(1)
  } catch (e) {
    console.error((e as Error).message)
    process.exit(1)
  }
} else {
  const { options } = parsed
  const report = runScenario(options)
  const cadence = options.cadence.kind === 'fixed' ? options.cadence : options.cadence.name
  console.log(JSON.stringify({ options: { ...options, cadence }, report }, null, 2))
}
