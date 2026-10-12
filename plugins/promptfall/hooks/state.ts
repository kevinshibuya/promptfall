import type {
  BoardsState,
  ChatState,
  DialogState,
  MarketState,
  OrdersState,
  Prefs,
  Settings,
  Sound,
  WorldState,
} from '../types'

// The session's values are declared in types/index.d.ts. The scan behind
// `claude plugin validate` reads an atom only where it is declared in the
// module that calls `read` or `update`, so each module declares the atoms it
// uses, as `atom({ plugin: 'promptfall', key }, initial)`, with these initials.

export const PREFS_DEFAULT: Prefs = { collapsed: false, bandTab: 'party' }
export const DIALOG_DEFAULT: DialogState = {
  menu: null,
  partyPick: [],
  paneNotice: null,
  link: null,
  sell: null,
  cursor: { inventory: null, heroes: null },
  formAt: 0,
}
export const MARKET_DEFAULT: MarketState = {
  query: { kind: 'item', sort: 'price', page: 0 },
  page: null,
  busy: false,
  error: null,
}
export const ORDERS_DEFAULT: OrdersState = { mine: null, form: null, busy: false, error: null }
export const WORLD_DEFAULT: WorldState = {
  snapshot: null,
  fetchedAt: null,
  stale: false,
  messages: [],
  chatMark: 0,
  clock: null,
  committedDealt: null,
}
export const CHAT_DEFAULT: ChatState = { draft: '', busy: false, error: null }
export const BOARDS_DEFAULT: BoardsState = { boards: null, busy: false, error: null }
export const SETTINGS_DEFAULT: Settings = {
  sound: 'quiet',
  motion: 'full',
  renderer: 'auto',
  probed: null,
}
/** The store key of the settings, under `promptfall:`; `reset()` keeps it as it keeps the lease. */
export const SETTINGS_KEY = 'settings'

const SOUND_STEPS: readonly Sound[] = ['off', 'quiet', 'normal', 'loud']
const isSound = (v: unknown): v is Sound => SOUND_STEPS.includes(v as Sound)

/**
 * A stored boolean: from before the volume steps, written by the renderer probe as often as by
 * the player, so it carries no choice. It reads as quiet, and the primary says sound is now on.
 */
export const soundWasBoolean = (raw: unknown): boolean =>
  typeof raw === 'object' && raw !== null && typeof (raw as { sound?: unknown }).sound === 'boolean'

/** The stored settings over the defaults; a missing or malformed field takes its default. */
export function parseSettings(raw: unknown): Settings {
  const r = (typeof raw === 'object' && raw !== null ? raw : {}) as Partial<
    Record<keyof Settings, unknown>
  >
  return {
    // A boolean from before the steps reads as the default too: see soundWasBoolean.
    sound: isSound(r.sound) ? r.sound : SETTINGS_DEFAULT.sound,
    motion: r.motion === 'still' || r.motion === 'full' ? r.motion : SETTINGS_DEFAULT.motion,
    renderer:
      r.renderer === 'image' || r.renderer === 'raster' || r.renderer === 'auto'
        ? r.renderer
        : SETTINGS_DEFAULT.renderer,
    probed: r.probed === 'image' || r.probed === 'raster' ? r.probed : SETTINGS_DEFAULT.probed,
  }
}

/**
 * A settings subcommand (`sound off|quiet|normal|loud`, `motion full|still`,
 * `renderer auto|image|raster`):
 * the change and its answer, a usage line for a bad value, or null for another subcommand.
 */
export function settingCommand(
  arg: string,
): { patch: Partial<Settings>; text: string } | { usage: string } | null {
  const [name, value, ...extra] = arg.split(/\s+/)
  const ok = extra.length === 0
  if (name === 'sound') {
    // `on`, from before the steps, means the default step.
    const step = value === 'on' ? 'quiet' : value
    if (!ok || !isSound(step)) return { usage: 'usage: /promptfall sound off|quiet|normal|loud' }
    return { patch: { sound: step }, text: `Sound: ${step}` }
  }
  if (name === 'motion') {
    if (!ok || (value !== 'full' && value !== 'still')) {
      return { usage: 'usage: /promptfall motion full|still' }
    }
    return { patch: { motion: value }, text: `Motion: ${value}` }
  }
  if (name === 'renderer') {
    if (!ok || (value !== 'auto' && value !== 'image' && value !== 'raster')) {
      return { usage: 'usage: /promptfall renderer auto|image|raster' }
    }
    return {
      patch: { renderer: value },
      text: `Renderer: ${value} (applies at the next session start)`,
    }
  }
  return null
}
