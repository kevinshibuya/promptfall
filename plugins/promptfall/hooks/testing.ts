// The kit's `test` with a longer default budget. A test that boots the engine takes 2 to 4 s on
// an idle machine, so the kit's 5 s default fails it on a loaded one, with no assertion wrong.
// At a load average near 30 the slowest band tests take 10 to 12 s alone, and more when every
// file runs at once, so the budget is twice that. A test's own `timeoutMs` still wins.
import { test as kitTest, type TestRest } from 'claude-code/testing'

const BUDGET_MS = 30_000

export const test = (name: string, ...rest: TestRest) =>
  rest.length === 1
    ? kitTest(name, { timeoutMs: BUDGET_MS }, rest[0])
    : kitTest(name, { timeoutMs: BUDGET_MS, ...rest[0] }, rest[1])
