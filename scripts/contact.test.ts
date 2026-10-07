import { existsSync, mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { content } from '@promptfall/sim'
import { describe, expect, it } from 'vitest'
import { contact } from './contact'
import { blank, readPng, writePng } from './png'

describe('contact', () => {
  it("writes zone 1's sprites, its native cuts and its three stage views", () => {
    const dir = mkdtempSync(join(tmpdir(), 'contact-'))
    const out = join(dir, 'out')
    const native = join(dir, 'native')
    mkdirSync(join(native, 'enemy'), { recursive: true })
    writePng(join(native, 'enemy', 'road_slime.png'), blank(3, 2))
    const written = contact({ kind: 'zone', zone: 1 }, { out, native })
    const folder = join(out, 'zone-1')
    const zone = content.zones[0]
    const ids = [...(zone?.enemies ?? []), zone?.boss, zone?.turnBoss]
    expect(ids).toHaveLength(6)
    for (const id of ids) expect(existsSync(join(folder, `enemy-${id}.png`)), id).toBe(true)
    for (const view of ['stage-rest', 'stage-boss', 'stage-turn']) {
      expect(existsSync(join(folder, `${view}.png`)), view).toBe(true)
    }
    const bossView = readPng(join(folder, 'stage-boss.png'))
    expect([bossView.width, bossView.height]).toEqual([720, 204])
    const slime = join(folder, 'native-enemy-road_slime.png')
    expect(written).toContain(slime)
    expect([readPng(slime).width, readPng(slime).height]).toEqual([12, 8])
  })
})
