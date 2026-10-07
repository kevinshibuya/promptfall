import { existsSync, mkdirSync, mkdtempSync, readFileSync } from 'node:fs'
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

  it('writes each sprite and stage view at 1.5x beside the 1x one', () => {
    const dir = mkdtempSync(join(tmpdir(), 'contact-'))
    const out = join(dir, 'out')
    contact({ kind: 'zone', zone: 1 }, { out, native: join(dir, 'native') })
    const folder = join(out, 'zone-1')
    const hires = readPng(join(folder, 'enemy-road_slime-hires.png'))
    expect([hires.width, hires.height]).toEqual([96, 96])
    for (const view of ['stage-rest', 'stage-boss', 'stage-turn']) {
      expect(existsSync(join(folder, `${view}-1x.png`)), view).toBe(true)
    }
    const hi = readFileSync(join(folder, 'stage-boss.png'))
    const lo = readFileSync(join(folder, 'stage-boss-1x.png'))
    expect([readPng(join(folder, 'stage-boss-1x.png')).width]).toEqual([720])
    expect(hi.equals(lo)).toBe(false)
  })

  it("writes each hero's rarity variants at 1x and 1.5x", () => {
    const dir = mkdtempSync(join(tmpdir(), 'contact-'))
    const out = join(dir, 'out')
    contact({ kind: 'heroes' }, { out, native: join(dir, 'native') })
    const folder = join(out, 'heroes')
    for (const name of [
      'hero-knight-rare',
      'hero-knight-rare-hires',
      'hero_attack-archer-epic-hires',
    ]) {
      expect(existsSync(join(folder, `${name}.png`)), name).toBe(true)
    }
    expect(
      readFileSync(join(folder, 'hero-knight-rare-hires.png')).equals(
        readFileSync(join(folder, 'hero-knight-epic-hires.png')),
      ),
    ).toBe(false)
  })
})
