// One seed of the arc, in a child process: arc.test.ts runs its seeds four at a time.
import { runScenario, type ScenarioOptions } from './scenario'

process.once('message', (options) => {
  process.send?.(runScenario(options as ScenarioOptions), () => process.disconnect?.())
})
