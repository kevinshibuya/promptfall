import { expect, test } from 'claude-code/testing'
import { zoneHead, zoneMark, zonePhrase, zoneWords } from './zone-words'

test('the leaderboard mark: the plain number inside tier 1, the tier and base zone past it', () => {
  expect(zoneMark(1)).toBe('1')
  expect(zoneMark(12)).toBe('12')
  expect(zoneMark(13)).toBe('T2 Z1')
  expect(zoneMark(24)).toBe('T2 Z12')
  expect(zoneMark(25)).toBe('T3 Z1')
  expect(zoneMark(36)).toBe('T3 Z12')
  // A row that words its zone inside tier 1 keeps its word there; past it the mark stands alone.
  expect(zoneMark(12, 'z')).toBe('z12')
  expect(zoneMark(13, 'z')).toBe('T2 Z1')
  expect(zoneMark(4, 'zone ')).toBe('zone 4')
})

test('a zone in words carries its tier past 12 and is unchanged inside tier 1', () => {
  expect(zonePhrase(4)).toBe('zone 4')
  expect(zonePhrase(13)).toBe('tier 2, zone 1')
  expect(zoneHead(4)).toBe('Zone 4')
  expect(zoneHead(13)).toBe('Tier 2, zone 1')
  expect(zoneWords(4)).toBe('zone 4, Old Barrow Hills')
  expect(zoneWords(13)).toBe('tier 2, zone 1, Greenmeadow Road')
  expect(zoneWords(36)).toBe('tier 3, zone 12, The Unwritten Reach')
})
