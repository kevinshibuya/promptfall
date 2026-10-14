import { existsSync, mkdirSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { content } from '@promptfall/sim'
import { describe, expect, it } from 'vitest'
import { shear } from '../plugins/promptfall/hooks/sprites/derive'
import { SPRITES } from '../plugins/promptfall/hooks/sprites/generated'
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

  it('writes each sprite at 1.5x beside the 1x one, and each stage view at 1.5x alone', () => {
    const dir = mkdtempSync(join(tmpdir(), 'contact-'))
    const out = join(dir, 'out')
    contact({ kind: 'zone', zone: 1 }, { out, native: join(dir, 'native') })
    const folder = join(out, 'zone-1')
    const hires = readPng(join(folder, 'enemy-road_slime-hires.png'))
    expect([hires.width, hires.height]).toEqual([96, 96])
    const lo = readPng(join(folder, 'enemy-road_slime.png'))
    expect([lo.width, lo.height]).toEqual([96, 96])
    for (const view of ['stage-rest', 'stage-boss', 'stage-turn']) {
      expect(existsSync(join(folder, `${view}.png`)), view).toBe(true)
      expect(existsSync(join(folder, `${view}-1x.png`)), view).toBe(false)
    }
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

  it("writes each hero's frame strip: A, B, wind-up, strike, follow-through when set, hit", () => {
    const dir = mkdtempSync(join(tmpdir(), 'contact-'))
    const out = join(dir, 'out')
    contact({ kind: 'heroes' }, { out, native: join(dir, 'native') })
    const folder = join(out, 'heroes')
    const width = (id: string, cells: number) => {
      const hires = SPRITES[id]?.hires
      if (!hires) throw new Error(id)
      const { grow } = shear(hires)
      return (hires.width * cells + grow) * 4 + (cells - 1) * 4
    }
    const knight = readPng(join(folder, 'hero-knight-frames.png'))
    expect([knight.width, knight.height]).toEqual([width('hero:knight', 6), 24 * 4])
    const archer = readPng(join(folder, 'hero-archer-frames.png'))
    expect(archer.width).toBe(width('hero:archer', 5))
    expect(existsSync(join(folder, 'hero_attack-knight-frames.png'))).toBe(false)
  })

  it('writes a frame strip exactly for the zone actors with frames', () => {
    const dir = mkdtempSync(join(tmpdir(), 'contact-'))
    const out = join(dir, 'out')
    contact({ kind: 'zone', zone: 1 }, { out, native: join(dir, 'native') })
    const zone = content.zones[0]
    for (const def of [...(zone?.enemies ?? []), zone?.boss, zone?.turnBoss]) {
      const framed = SPRITES[`enemy:${def}`]?.frames != null
      expect(existsSync(join(out, 'zone-1', `enemy-${def}-frames.png`)), def).toBe(framed)
    }
  })

  it('writes the action shots: a strike and a hit per zone, a bolt and a burst for the heroes', () => {
    const dir = mkdtempSync(join(tmpdir(), 'contact-'))
    const out = join(dir, 'out')
    contact({ kind: 'zone', zone: 1 }, { out, native: join(dir, 'native') })
    contact({ kind: 'heroes' }, { out, native: join(dir, 'native') })
    for (const shot of [
      'zone-1/stage-strike',
      'zone-1/stage-hit',
      'heroes/stage-bolt',
      'heroes/stage-burst',
    ]) {
      const img = readPng(join(out, `${shot}.png`))
      expect([img.width, img.height], shot).toEqual([720, 204])
    }
    const strike = readFileSync(join(out, 'zone-1/stage-strike.png'))
    expect(strike.equals(readFileSync(join(out, 'zone-1/stage-hit.png')))).toBe(false)
  })
})
