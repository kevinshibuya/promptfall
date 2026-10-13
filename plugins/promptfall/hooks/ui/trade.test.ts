import { expect, test } from 'claude-code/testing'
import { errorText, refusalText } from './trade'

test('a paused refusal says the game is paused, not that it plays in another session', () => {
  expect(errorText(new Error('paused'))).toBe('Promptfall is paused')
  expect(errorText(new Error('not_primary'))).toBe('Playing in another session')
  expect(errorText(new Error('unreachable'))).toBe('Server unreachable')
})

test('a listing or order already closed says it sold, filled or expired, never the bare token', () => {
  expect(refusalText('gone')).toBe('Already sold, filled or expired')
})
