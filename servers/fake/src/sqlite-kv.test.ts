import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it } from 'vitest'
import { SqliteKeyValue } from './sqlite-kv'

const open: SqliteKeyValue[] = []
afterEach(() => {
  for (const store of open.splice(0)) store.close()
})

function fileIn(name = 'promptfall.sqlite'): string {
  return join(mkdtempSync(join(tmpdir(), 'pf-sqlite-')), 'nested', name)
}

function openAt(path: string): SqliteKeyValue {
  const store = new SqliteKeyValue(path)
  open.push(store)
  return store
}

describe('SqliteKeyValue', () => {
  it('writes are invisible on disk until flush commits them as one transaction', async () => {
    const path = fileIn()
    const a = openAt(path)
    await a.set('pf:counter', 3)
    await a.set('pf:acct:x:record', { deep: { list: [1, 2] } })
    // A second connection on the file sees nothing of the buffer.
    const b = openAt(path)
    expect(await b.get('pf:counter')).toBeUndefined()
    expect(await b.get('pf:acct:x:record')).toBeUndefined()
    await a.flush()
    expect(await b.get('pf:counter')).toBe(3)
    expect(await b.get('pf:acct:x:record')).toEqual({ deep: { list: [1, 2] } })
  })

  it('a flush that fails writes nothing and keeps the buffer for the next one', async () => {
    const path = fileIn()
    const a = openAt(path)
    await a.set('pf:a', 1)
    await a.flush()
    // Another writer holds the file's write lock.
    const other = new DatabaseSync(path)
    other.exec('BEGIN IMMEDIATE')
    await a.set('pf:a', 2)
    await a.set('pf:b', 2)
    await a.delete('pf:a')
    await expect(a.flush()).rejects.toThrow()
    other.exec('ROLLBACK')
    const b = openAt(path)
    expect(await b.get('pf:a')).toBe(1)
    expect(await b.get('pf:b')).toBeUndefined()
    // The store still reads its own buffer, and the next flush lands it whole.
    expect(await a.get('pf:a')).toBeUndefined()
    expect(await a.get('pf:b')).toBe(2)
    await a.flush()
    other.close()
    expect(await b.get('pf:a')).toBeUndefined()
    expect(await b.get('pf:b')).toBe(2)
  })

  it('a crash between set and flush leaves the file as it was', async () => {
    const path = fileIn()
    const a = openAt(path)
    await a.set('pf:kept', 'yes')
    await a.flush()
    await a.set('pf:kept', 'no')
    await a.set('pf:lost', 1)
    a.close()
    open.splice(open.indexOf(a), 1)
    const b = openAt(path)
    expect(await b.get('pf:kept')).toBe('yes')
    expect(await b.get('pf:lost')).toBeUndefined()
  })

  it('a reopened store reads every flushed key, deletes included', async () => {
    const path = fileIn()
    const a = openAt(path)
    await a.set('pf:one', 1)
    await a.set('pf:two', [2])
    await a.set('pf:gone', true)
    await a.flush()
    await a.delete('pf:gone')
    await a.flush()
    a.close()
    open.splice(open.indexOf(a), 1)
    const b = openAt(path)
    expect(await b.get('pf:one')).toBe(1)
    expect(await b.get('pf:two')).toEqual([2])
    expect(await b.get('pf:gone')).toBeUndefined()
  })

  it('the clock row is written with every flush and survives a reopen', async () => {
    const path = fileIn()
    const a = openAt(path)
    expect(a.persistedClock).toBeNull()
    let virtualAt = 123
    a.attachClock(() => ({ virtualAt, realAt: 456 }))
    // Nothing buffered: the flush still puts the clock on disk.
    a.flushSync()
    expect(openAt(path).persistedClock).toEqual({ virtualAt: 123, realAt: 456 })
    virtualAt = 789
    await a.set('pf:counter', 1)
    await a.flush()
    a.close()
    open.splice(open.indexOf(a), 1)
    const b = openAt(path)
    expect(b.persistedClock).toEqual({ virtualAt: 789, realAt: 456 })
    expect(await b.get('pf:counter')).toBe(1)
  })

  it('a backup copy opens and reads every committed key', async () => {
    const path = fileIn()
    const a = openAt(path)
    a.attachClock(() => ({ virtualAt: 5, realAt: 6 }))
    await a.set('pf:one', 1)
    await a.set('pf:two', { two: 2 })
    await a.flush()
    // Uncommitted: not in the copy.
    await a.set('pf:pending', true)
    const copyPath = fileIn('copy.sqlite')
    await a.backup(copyPath)
    const copy = openAt(copyPath)
    expect(await copy.get('pf:one')).toBe(1)
    expect(await copy.get('pf:two')).toEqual({ two: 2 })
    expect(await copy.get('pf:pending')).toBeUndefined()
    expect(copy.persistedClock).toEqual({ virtualAt: 5, realAt: 6 })
    // The live store carries on.
    expect(await a.get('pf:pending')).toBe(true)
  })
})
