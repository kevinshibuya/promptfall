import { runScenario, type ScenarioOptions } from './scenario'

function arg(name: string, fallback: number): number {
  const i = process.argv.indexOf(`--${name}`)
  const raw = i >= 0 ? process.argv[i + 1] : undefined
  const n = raw === undefined ? Number.NaN : Number.parseInt(raw, 10)
  return Number.isFinite(n) ? n : fallback
}

const options: ScenarioOptions = {
  seed: arg('seed', 7),
  hours: arg('hours', 8),
  activeShareBp: arg('active', 6000),
  toolCallEverySec: arg('tool-every', 8),
  turnLengthSec: arg('turn', 90),
  restEveryTurns: arg('rest-every', 1),
}

const report = runScenario(options)
console.log(JSON.stringify({ options, report }, null, 2))
