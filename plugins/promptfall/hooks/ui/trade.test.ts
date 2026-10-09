import { expect, test } from 'claude-code/testing'
import { errorText } from './trade'

test('a paused refusal says the game is paused, not that it plays in another session', () => {
  expect(errorText(new Error('paused'))).toBe('Promptfall is paused')
  expect(errorText(new Error('not_primary'))).toBe('Playing in another session')
  expect(errorText(new Error('unreachable'))).toBe('Server unreachable')
})
