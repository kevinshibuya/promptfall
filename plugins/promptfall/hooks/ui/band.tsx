import { atom, type On, read, update } from 'claude-code'
import type { BandScroll, GameView, Mode, Prefs, Settings, WorldState } from '../../types'
import type { GameHandle } from '../engine'
import { GaugeTrack } from '../stage/gauges'
import { cellsOf, layoutFor } from '../stage/layout'
import { MessageLog } from '../stage/log'
import { bandCells, bandFrame, bandKey } from '../stage/loop'
import { altText } from '../stage/model'
import { svgFit } from '../stage/playfield'
import { stagedState } from '../stage/staged'
import { stageSvg } from '../stage/svg'
import { StageTimeline } from '../stage/timeline'
import {
  DESKTOP_COLUMN_PX_CEILING,
  FULL_MIN_COLUMNS,
  IMAGE_MAX_COLUMNS,
  PROBE_DELAY_MS,
  RASTER_MAX_COLUMNS,
  STAGE_MAX_COLUMNS,
  SVG_INTERACTIVE,
  SVG_SMIL,
} from '../stage/tuning'
import {
  PREFS_DEFAULT,
  parseSettings,
  SETTINGS_DEFAULT,
  SETTINGS_KEY,
  WORLD_DEFAULT,
} from '../state'
import { sceneSvg } from '../windows/svg'
import { GOLD_RGB, STRIP_MAX_COLUMNS, TEXT_RGB } from '../windows/tuning'
import { CLASS_INITIAL, clip, formatGold } from './format'
import { armProbe, PROBE_B, probeElement, probeVerdict } from './probe'
import { heroRgb, PAGE_ROWS, paged, type StripInput, stripScene, stripTracks } from './strip'

const viewAtom = atom({ plugin: 'promptfall', key: 'view' } as const, null)
const prefsAtom = atom({ plugin: 'promptfall', key: 'prefs' } as const, PREFS_DEFAULT)
const modeAtom = atom({ plugin: 'promptfall', key: 'mode' } as const, 'primary')
const noticeAtom = atom({ plugin: 'promptfall', key: 'notice' } as const, null)
const worldAtom = atom({ plugin: 'promptfall', key: 'world' } as const, WORLD_DEFAULT)
const settingsAtom = atom({ plugin: 'promptfall', key: 'settings' } as const, SETTINGS_DEFAULT)
const rendererAtom = atom({ plugin: 'promptfall', key: 'renderer' } as const, 'unknown')
/** At the newest on both log tabs: the scroll every reset goes back to. */
const SCROLL_NEWEST: BandScroll = { zone: 0, party: null, loot: null }
const scrollAtom = atom({ plugin: 'promptfall', key: 'bandScroll' } as const, SCROLL_NEWEST)

/** A run of the collapsed line: its text, dim, or in a colour. */
export type Run = { text: string; dim?: boolean; rgb?: number }

/**
 * The one-line form, `Promptfall · Z3 w4 · K184 B90 W140 · 1,240g`, as a run of coloured spans
 * cut to `cells`: the label and separators dim, each hero's HP in the party window's health
 * colour, the gold in gold; `Sandbox` and `camping` as words when they apply.
 */
export function collapsedRun(
  view: GameView,
  mode: Mode,
  notice: string | null,
  cells: number,
): Run[] {
  const wave = view.wave >= 11 ? 'boss' : `w${view.wave}`
  const sep: Run = { text: ' · ', dim: true }
  const hp = view.heroes.flatMap((h, i): Run[] => {
    const rgb = heroRgb(h)
    const run = {
      text: `${CLASS_INITIAL[h.cls] ?? '?'}${h.hp}`,
      ...(rgb === TEXT_RGB ? {} : { rgb }),
    }
    return i === 0 ? [run] : [{ text: ' ' }, run]
  })
  const parts: Run[][] = [[{ text: 'Promptfall', dim: true }]]
  if (view.account.sandbox) parts.push([{ text: 'Sandbox' }])
  parts.push([{ text: `Z${view.zone} ${wave}` }])
  if (view.camping) parts.push([{ text: 'camping' }])
  parts.push(hp, [{ text: formatGold(view.gold), rgb: GOLD_RGB }])
  if (notice) parts.push([{ text: notice }])
  if (mode === 'secondary') parts.unshift([{ text: 'playing in another session' }])
  return clipRun(
    parts.flatMap((p, i) => (i === 0 ? p : [sep, ...p])),
    cells,
  )
}

/** A run cut to `cells`, its last span ending in an ellipsis as `clip` cuts a string. */
function clipRun(run: readonly Run[], cells: number): Run[] {
  const total = run.reduce((n, r) => n + [...r.text].length, 0)
  if (total <= cells) return [...run]
  const out: Run[] = []
  let left = cells
  for (const r of run) {
    const n = [...r.text].length
    if (n < left) {
      out.push(r)
      left -= n
      continue
    }
    if (left > 0) out.push({ ...r, text: clip(r.text, left) })
    break
  }
  return out
}

const hex = (rgb: number) => `#${(rgb & 0xffffff).toString(16).padStart(6, '0')}`

export { type ShownBoss, shownBoss } from './boss'

import { worldRows } from './world-rows'

export { worldRows }

/** The desktop strip's SMIL horizon: the idle cadence, 5 s, plus a second. */
const SVG_STRIP_HORIZON_MS = 6000

/** For a band drawn without a running game (a hot reload before session.start): drawing only. */
const looseTimeline = new StageTimeline()
const looseGauges = new GaugeTrack()
const looseLog = new MessageLog()

const HOTKEYS = [
  { hotkey: 'p', label: 'party' },
  { hotkey: 'l', label: 'loot' },
  { hotkey: 'w', label: 'world' },
  { hotkey: 'c', label: '▾' },
  { hotkey: 'f', label: 'tactics' },
  // Page the Party and Loot logs: older, newer. They do nothing in the compact band.
  { hotkey: 'j', label: 'older' },
  { hotkey: 'k', label: 'newer' },
  // Shown and bound only while the party camps.
  { hotkey: 'g', label: 'go' },
] as const

export function registerBand(on: On, game: () => GameHandle | null): void {
  /** The layout line last sent to the debug log: a render at the same layout sends none. */
  let loggedLayout = ''
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const view = await read($, viewAtom)
    const mode = await read($, modeAtom)
    const handle = game()
    const loop = handle?.stage.loopFor(e.surface) ?? null
    // A survey (a permission prompt or a question) hides nothing: the band takes the rows the
    // engine gives it, as for a tall prompt, so Guard plays where it can be seen.
    if (mode === 'off') {
      loop?.mount(null)
      return next(e)
    }
    const notice = await read($, noticeAtom)
    if (view === null) {
      loop?.mount(null)
      // No game to draw (an older version's data, or no server yet): the notice alone, on one line.
      // Every notice already names the game.
      if (!notice) return next(e)
      const { Box, Text } = $.ui.resolve(e)
      const width = Math.max(20, e.props.bodyColumns)
      return (
        <Box key="band" flexDirection="column">
          <Text key="row-notice" wrap="truncate">
            {clip(notice, width - 2)}
          </Text>
        </Box>
      )
    }
    const prefs: Prefs = (await read($, prefsAtom)) ?? PREFS_DEFAULT
    const world: WorldState = (await read($, worldAtom)) ?? WORLD_DEFAULT
    // Per machine: the store is the truth, so a motion change in another session reaches this
    // band; the atom keeps this render subscribed to this session's own changes.
    await read($, settingsAtom)
    const settings: Settings = parseSettings(await $.store.get(`promptfall:${SETTINGS_KEY}`))
    const now = await $.clock.now()
    const els = $.ui.resolve(e)
    const { Box, Text, Button } = els
    const width = Math.max(20, e.props.bodyColumns)
    const terminal = e.surface === 'terminal'

    const setPrefs = (patch: Partial<Prefs>) =>
      update($, prefsAtom, (p) => ({ ...(p ?? PREFS_DEFAULT), ...patch }))
    // A tab switch and a collapse put both logs back at the newest.
    const toNewest = () => update($, scrollAtom, () => SCROLL_NEWEST)

    const tab = prefs.bandTab
    const timeline = handle?.stage.timeline ?? looseTimeline
    // Hotkeys need Buttons on screen (spike sheet): hidden in a zero-width Box on terminals and
    // the desktop (rung a′), a row of their own on VS Code and mobile, untested there (rung c).
    const hiddenKeys = terminal || e.surface === 'desktop'
    const extra: 0 | 1 = hiddenKeys ? 0 : 1
    // Every tab: the strip's enemy window reads the staged state the timeline holds.
    timeline.observe(view, now)
    const rendererNow = terminal && 'Raster' in els ? await read($, rendererAtom) : 'svg'
    // While the probe is pending, the verdict the last session recorded, else the half-block
    // rules: from the second session on the band keeps its height when the probe lands.
    const laidOut = rendererNow === 'unknown' ? (settings.probed ?? 'raster') : rendererNow
    // The stage on every tab: the band's height never moves with the tab, and the loop, which
    // lays out the same way, never finds a layout of its own to redraw for.
    const layout = layoutFor(timeline.rowsAt(view, now), e.props, e.surface, {
      extra,
      minRows: timeline.minRowsAt(view, now),
      scalable: laidOut === 'image',
    })
    // The engine's row grant at each layout, read at the manual pass to tune RASTER_MIN_ROWS
    // (#230): once a layout, not once a render.
    const stageRows = cellsOf(layout)?.rows
    const layoutLine =
      `band layout: maxRows ${e.props.maxRows}, bodyColumns ${e.props.bodyColumns}: ${layout.kind}` +
      (stageRows === undefined ? '' : `, ${stageRows} stage rows`)
    if (layoutLine !== loggedLayout) {
      loggedLayout = layoutLine
      $.ui.log(layoutLine, { to: 'debug' })
    }
    // On a terminal, layoutFor collapses when the band does not fit; the Svg surfaces never do.
    const collapsed = prefs.collapsed || mode !== 'primary' || layout.kind === 'collapsed'

    if (collapsed) {
      loop?.mount(null)
      return (
        <Box key="band" flexDirection="column">
          <Box key="row-collapsed" flexDirection="row">
            <Text wrap="truncate">
              {collapsedRun(view, mode, notice, width - 6).map((r, i) => (
                <Text
                  key={`run-${i}`}
                  {...(r.dim ? { dimColor: true } : {})}
                  {...(r.rgb === undefined ? {} : { color: hex(r.rgb) })}
                >
                  {r.text}
                </Text>
              ))}{' '}
            </Text>
            <Button
              key="collapse"
              label={prefs.collapsed ? '▸' : '·'}
              hotkey="c"
              plain
              dimColor
              onPress={() => {
                void toNewest()
                void setPrefs({ collapsed: !prefs.collapsed })
              }}
            />
          </Box>
        </Box>
      )
    }

    // The window strip: under the stage, or beside the compact stage.
    const kind = layout.kind === 'compact' ? 'compact' : 'full'
    // The log tabs' scroll holds while the band is full in the zone it was set in; a compact
    // layout or a zone change puts it back at the newest.
    const scrolled = (await read($, scrollAtom)) ?? SCROLL_NEWEST
    const logTab = tab === 'party' || tab === 'loot' ? tab : null
    const held = kind !== 'compact' && scrolled.zone === view.zone
    // Written after the render, as the probe's verdict is: this render already draws the newest.
    if (!held && (scrolled.party !== null || scrolled.loot !== null))
      $.clock.after(0, () => void toNewest())
    const scroll = held && logTab ? scrolled[logTab] : null
    const stripColumns = terminal
      ? Math.min(width, STRIP_MAX_COLUMNS)
      : Math.min(Math.max(e.props.bodyColumns, FULL_MIN_COLUMNS), STAGE_MAX_COLUMNS)
    const input: StripInput = {
      view,
      world,
      tab,
      kind,
      columns: stripColumns,
      now,
      notice,
      motion: settings.motion,
      timeline,
      gauges: handle?.stage.gauges ?? looseGauges,
      log: handle?.stage.log ?? looseLog,
      scroll,
    }
    const { scene, page } = stripScene(input)
    // `j` older, `k` newer, from the page this render drew; nothing without one (compact, World).
    const pageBy = (by: number) => {
      if (!page || !logTab || kind === 'compact') return
      const to = paged(page, by)
      void update($, scrollAtom, (s) => ({
        ...(s ?? SCROLL_NEWEST),
        zone: view.zone,
        [logTab]: to,
      }))
    }

    const press: Record<(typeof HOTKEYS)[number]['hotkey'], () => void> = {
      p: () => void toNewest().then(() => setPrefs({ bandTab: 'party' })),
      l: () => void toNewest().then(() => setPrefs({ bandTab: 'loot' })),
      w: () => void toNewest().then(() => setPrefs({ bandTab: 'world' })),
      c: () => void toNewest().then(() => setPrefs({ collapsed: true })),
      j: () => pageBy(PAGE_ROWS),
      k: () => pageBy(-PAGE_ROWS),
      f: () => {
        // The path `/promptfall farm` takes (hooks/command.ts).
        if (handle?.canApply()) handle.apply({ t: 'set_farm', on: !view.farm }, now)
      },
      // The path `/promptfall go` takes, at the keypress: camping, the last draw can be stale.
      g: () => void $.clock.now().then((at) => handle?.breakCamp(at)),
    }
    // Not `h`: that name is the JSX factory.
    const buttons = HOTKEYS.filter((k) => k.hotkey !== 'g' || view.camping).map((k) => (
      <Button
        key={`hot-${k.hotkey}`}
        label={k.label}
        hotkey={k.hotkey}
        plain
        dimColor={k.hotkey !== 'c' && k.hotkey !== 'f' && k.hotkey !== 'g' && k.label !== tab}
        onPress={press[k.hotkey]}
      />
    ))
    // On the desktop the strip sits in a column: an absolute Box takes no row there.
    const hidden = (
      <Box
        key="hotkeys"
        width={0}
        overflow="hidden"
        {...(terminal ? {} : { position: 'absolute' as const, top: 0, left: 0 })}
      >
        {buttons}
      </Box>
    )

    // The full layout is one picture on the terminal (spec #45), on every tab: the stage and the
    // strip composed on the shell, the band's box up to the host's widest element, centred past it.
    // An Image on the terminals that draw pictures, a Raster of cells on half-block ones (#61).
    // Compact is its small stage beside its window inside one line (#64).
    const picture =
      rendererNow === 'image' && 'Image' in els
        ? { renderer: 'image' as const, max: IMAGE_MAX_COLUMNS }
        : rendererNow === 'raster' && 'Raster' in els
          ? { renderer: 'raster' as const, max: RASTER_MAX_COLUMNS }
          : null
    if (terminal && picture) {
      const box = { columns: Math.min(width, picture.max), rows: layout.bandRows - extra }
      // An Image the loop found laid out as its alt takes a new key, so it is mounted afresh.
      const key = bandKey(box) + (picture.renderer === 'image' ? (loop?.remountKey() ?? '') : '')
      // The stage and its alt draw the staged state, as everywhere else.
      const shown = stagedState(view, world, timeline, now)
      let element = null
      if (picture.renderer === 'raster' && 'Raster' in els) {
        const { Raster } = els
        const { cells } = bandCells(shown, timeline, now, layout, settings.motion, box, scene)
        element = <Raster key={key} columns={box.columns} rows={box.rows} cells={cells} />
      } else if ('Image' in els) {
        const { Image } = els
        // As the stage's: a redraw of the site the loop is drawing reuses the picture it last
        // sent, the loop's next frame a beat away; anything new composes the first frame here.
        const source =
          loop?.stageSource(key, layout, tab) ??
          bandFrame(shown, timeline, now, layout, settings.motion, box, scene)
        element = (
          <Image
            key={key}
            source={source}
            columns={box.columns}
            rows={box.rows}
            alt={`${altText(shown)}\n${scene.alt}`}
          />
        )
      }
      loop?.mount({
        requestId: e.requestId,
        key,
        band: box,
        layout,
        renderer: picture.renderer,
        props: e.props,
        surface: e.surface,
        strip: { kind, columns: stripColumns, tab, extra, scroll },
      })
      return (
        <Box key="band" flexDirection="column">
          <Box key="row-band" flexDirection="row" justifyContent="center">
            {element}
            {hidden}
          </Box>
        </Box>
      )
    }

    let stage = null
    let strip = null
    let probe = null
    let renderer: 'raster' | 'image' | 'svg' | 'unknown' = 'svg'
    if (terminal && 'Raster' in els) {
      renderer = await read($, rendererAtom)
      if (renderer === 'unknown') {
        // Empty rows while the probe decides, so the band's height does not jump when it lands.
        strip = (
          <Box key="strip-empty" flexDirection="column">
            {Array.from({ length: scene.rows }, (_, i) => (
              <Text key={`strip-empty-${i}`}> </Text>
            ))}
          </Box>
        )
        // A renderer forced at session start set the atom; one forced later applies from the next
        // start, so this session still probes.
        probe = probeElement(els, renderer)
        if (probe && armProbe()) {
          const requestId = e.requestId
          $.clock.after(PROBE_DELAY_MS, () => {
            void (async () => {
              // A blit that throws settles nothing, like any other deny.
              const deny = await $.ui.blit({ requestId, key: 'probe', source: PROBE_B }).then(
                (r) => r.deny,
                (error: unknown) => String(error),
              )
              const verdict = probeVerdict(deny)
              if (verdict === null) return
              await update($, rendererAtom, () => verdict)
              // For the next session's band while its own probe is pending; the player's choice stays.
              const key = `promptfall:${SETTINGS_KEY}`
              await $.store.set(key, { ...parseSettings(await $.store.get(key)), probed: verdict })
            })()
          })
        }
      }
    } else if (!terminal && 'Svg' in els) {
      const { Svg } = els
      const tracks = SVG_SMIL ? stripTracks(input, SVG_STRIP_HORIZON_MS) : []
      strip = (
        <Svg
          key="strip"
          source={sceneSvg(scene, tracks, {
            smil: SVG_SMIL,
            width: Math.round(e.props.bodyColumns * DESKTOP_COLUMN_PX_CEILING),
            band: 'bottom',
          })}
          alt={scene.alt}
          isInteractive={SVG_INTERACTIVE}
        />
      )
    }

    // The stage: an element sized to the layout's box, its first frame drawn here so a redraw
    // is never blank; the loop blits every frame after it. It draws the staged state.
    const box = layout.box
    const staged = box ? stagedState(view, world, timeline, now) : view
    if (box && !terminal && 'Svg' in els) {
      // The band's width, its share of the shell and line drawn around the stage; on a short band
      // the whole stage scales down to the rows the strip leaves, centred on the shell (ADR 0004).
      // The 1.5x art, or the 1x art when its markup would pass the engine's cap.
      const source = stageSvg(staged, timeline, now, box, {
        smil: SVG_SMIL,
        // Wider than the band: the desktop scales it down to the band's width (ADR 0004).
        width: Math.round(e.props.bodyColumns * DESKTOP_COLUMN_PX_CEILING),
        motion: settings.motion,
        fit: svgFit(e.props, box, scene, extra),
      })
      const { Svg } = els
      stage = (
        <Svg key="stage" source={source} alt={altText(staged)} isInteractive={SVG_INTERACTIVE} />
      )
    } else if (box && terminal && renderer === 'unknown') {
      // Empty rows while the probe decides; a known renderer drew the band as one picture above.
      stage = (
        <Box key="stage-empty" flexDirection="column">
          {Array.from({ length: (cellsOf(layout) ?? box).rows }, (_, i) => (
            <Text key={`stage-empty-${i}`}> </Text>
          ))}
        </Box>
      )
    }

    // The loop: the terminals' band picture mounts it above. On the desktop SMIL plays the motion,
    // so while its stage is drawn the loop mounts there only to wake for held toasts.
    if (!terminal && (!SVG_SMIL || stage !== null)) {
      loop?.mount({
        requestId: e.requestId,
        key: 'stage',
        layout,
        renderer: SVG_SMIL ? 'smil' : 'svg',
        props: e.props,
        surface: e.surface,
        strip: { kind, columns: stripColumns, tab, extra, scroll },
      })
    } else {
      loop?.mount(null)
    }

    // On the desktop a row would leave the strip's frame at its default 300 points, as the stage's.
    const stripRow = (
      <Box key="row-strip" flexDirection={terminal ? 'row' : 'column'}>
        {strip}
        {probe}
        {hiddenKeys ? hidden : null}
      </Box>
    )
    const hotkeyRow = hiddenKeys ? null : (
      <Box key="row-hotkeys" flexDirection="row">
        {buttons.flatMap((b, i) => (i === 0 ? [b] : [<Text key={`hot-gap-${i}`}> </Text>, b]))}
      </Box>
    )

    if (layout.kind === 'compact') {
      return (
        <Box key="band" flexDirection="column">
          <Box key="row-compact" flexDirection="row">
            <Box key="compact-stage" flexDirection="column">
              <Text key="compact-above"> </Text>
              {stage}
              <Text key="compact-below"> </Text>
            </Box>
            {strip}
            {probe}
            {hidden}
          </Box>
        </Box>
      )
    }
    return (
      <Box key="band" flexDirection="column">
        {stage ? (
          // On the desktop a row would leave the stage's frame at its default 300 points.
          <Box
            key="row-stage"
            flexDirection={terminal ? 'row' : 'column'}
            {...(terminal ? { justifyContent: 'center' as const } : {})}
          >
            {stage}
          </Box>
        ) : null}
        {stripRow}
        {hotkeyRow}
      </Box>
    )
  })
}
