// The staged state (GLOSSARY): the fight as the stage has played it so far, the sim's state less
// every hit, heal and death the stage has not landed yet and every drop it has not revealed. The
// one place that asks the timeline about landings; the stage and the band's windows read what it
// builds.
import type { EnemyView, GameView, LootView, WorldState } from '../../types'
import type { StageTimeline } from './timeline'

/** The HP change still to land on each actor after `now`. */
function pendingBy(timeline: StageTimeline, now: number): Map<string, number> {
  const out = new Map<string, number>()
  for (const l of timeline.pending(now)) out.set(l.actor, (out.get(l.actor) ?? 0) + l.delta)
  return out
}

/**
 * The Loot rows less each drop and vendored row whose own item's reveal is still to come. A row
 * whose item no chest holds shows at once, as every market row does.
 */
function revealed(loot: readonly LootView[], timeline: StageTimeline, now: number): LootView[] {
  return loot.filter((row) => {
    if (row.kind === 'market' || row.itemId === null) return true
    const show = timeline.showAt(row.itemId)
    return show === null || show <= now
  })
}

/**
 * The world boss's bar: the last poll's HP less the damage this party has landed since the
 * poll's baseline (its committed tally then). Damage dealt but still in the air is not landed,
 * so a poll that already counts it does not lead the stage. Null when this party is not engaged
 * with the polled boss.
 */
function worldBossRow(
  row: EnemyView,
  view: GameView,
  world: WorldState,
  inAir: number,
): EnemyView | null {
  const boss = world.snapshot?.boss
  if (row.kind !== 'world_boss' || !boss || view.boss?.bossId !== boss.bossId) return null
  const dealt = view.boss.dealt
  const baseline = world.committedDealt?.bossId === boss.bossId ? world.committedDealt.dealt : dealt
  const hp = Math.max(0, Math.min(boss.maxHp, boss.hp - (dealt - inAir - baseline)))
  return { ...row, hp, maxHp: boss.maxHp }
}

/**
 * The staged state at `now`, in the view's shape. The caller has observed `view` on `timeline`
 * first. A hero carries his HP less the landings still pending and stands while it is above zero;
 * a change the state made without a blow (a wipe's heal, a revive) is one of those landings.
 * The enemies are the timeline's line in arrival order, a departed one kept while it is held,
 * each with its HP staged the same way. The zone and wave hold the previous ones while a departed
 * enemy seen in them is held, or while a travel's party steps off. The world boss is staged like
 * any enemy, its bar from the poll. The Loot rows leave out a drop until its own chest's reveal
 * shows it; the last drop is their newest.
 */
export function stagedState(
  view: GameView,
  world: WorldState,
  timeline: StageTimeline,
  now: number,
): GameView {
  const pending = pendingBy(timeline, now)
  const staged = (hp: number, maxHp: number, id: string) =>
    Math.max(0, Math.min(maxHp, hp - (pending.get(id) ?? 0)))
  const heroes = view.heroes.map((h) => {
    const hp = staged(h.hp, h.maxHp, h.id)
    return hp === h.hp && h.alive === hp > 0 ? h : { ...h, hp, alive: hp > 0 }
  })
  const line = timeline.lineup()
  const live = new Map(view.enemies.map((e) => [e.id, e]))
  // A departed row carries the HP the timeline predicts it left with: 0 for a kill, its last HP
  // when it left alive.
  const enemies = line.map(({ row, departed }) => {
    const current = departed ? row : (live.get(row.id) ?? row)
    const bar = worldBossRow(current, view, world, -(pending.get(current.id) ?? 0))
    if (bar) return bar
    const hp = staged(current.hp, current.maxHp, current.id)
    return hp === current.hp ? current : { ...current, hp }
  })
  // The encounter stays on the earliest wave or zone a held enemy was seen in, or on the scene a
  // travel leaves until its backdrop changes.
  const before = line.find((l) => l.departed && (l.zone !== view.zone || l.wave !== view.wave))
  const encounter = before
    ? { zone: before.zone, zoneName: before.zoneName, wave: before.wave }
    : (timeline.travelSceneAt(now) ?? {})
  const loot = timeline.pendingReveals(now) > 0 ? revealed(view.loot, timeline, now) : null
  const rows = loot ? { loot, lastDrop: loot.at(-1) ?? null } : {}
  return { ...view, ...encounter, heroes, enemies, ...rows }
}

/**
 * The hits and heals landing after `now` and by `now + horizonMs`, per actor in time order: what
 * a renderer that schedules its own motion (the desktop's bar tracks) keys from.
 */
export function landingsWithin(
  timeline: StageTimeline,
  now: number,
  horizonMs: number,
): Map<string, { at: number; delta: number }[]> {
  const out = new Map<string, { at: number; delta: number }[]>()
  const landings = [...timeline.pending(now)].sort((a, b) => a.at - b.at)
  for (const l of landings) {
    if (l.at > now + horizonMs) break
    const list = out.get(l.actor) ?? []
    list.push({ at: l.at, delta: l.delta })
    out.set(l.actor, list)
  }
  return out
}
