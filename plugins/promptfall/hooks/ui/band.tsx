import { atom, type On, read, update } from 'claude-code'
import type { GameView, Mode, Prefs, Settings, WorldState } from '../../types'
import type { GameHandle } from '../engine'
import { GaugeTrack } from '../stage/gauges'
import { cellsOf, layoutFor } from '../stage/layout'
import { MessageLog } from '../stage/log'
import { bandCells, bandFrame, bandKey, stageFrame, stageKey } from '../stage/loop'
import { altText } from '../stage/model'
import { svgFit } from '../stage/playfield'
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
import { windowKey, windowSource } from '../windows/image'
import { sceneCells } from '../windows/raster'
import { sceneSvg } from '../windows/svg'
import { STRIP_MAX_COLUMNS } from '../windows/tuning'
import { CLASS_INITIAL, clip, formatGold } from './format'
import { armProbe, PROBE_B, probeElement, probeVerdict } from './probe'
import { type StripInput, stripScene, stripTracks } from './strip'

const viewAtom = atom({ plugin: 'promptfall', key: 'view' } as const, null)
const prefsAtom = atom({ plugin: 'promptfall', key: 'prefs' } as const, PREFS_DEFAULT)
const modeAtom = atom({ plugin: 'promptfall', key: 'mode' } as const, 'primary')
const noticeAtom = atom({ plugin: 'promptfall', key: 'notice' } as const, null)
const worldAtom = atom({ plugin: 'promptfall', key: 'world' } as const, WORLD_DEFAULT)
const settingsAtom = atom({ plugin: 'promptfall', key: 'settings' } as const, SETTINGS_DEFAULT)
const rendererAtom = atom({ plugin: 'promptfall', key: 'renderer' } as const, 'unknown')

/** The one-line form: `Promptfall · Z3 w4 · K184 B90 W140 · 1,240g`. */
export function collapsedLine(view: GameView, mode: Mode, notice: string | null): string {
  const wave = view.wave >= 11 ? 'boss' : `w${view.wave}`
  const hp = view.heroes.map((h) => `${CLASS_INITIAL[h.cls] ?? '?'}${h.hp}`).join(' ')
  const parts = ['Promptfall', `Z${view.zone} ${wave}`, hp, formatGold(view.gold)]
  if (notice) parts.push(notice)
  const line = parts.join(' · ')
  return mode === 'secondary' ? `playing in another session · ${line}` : line
}

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
  { hotkey: 'f', label: 'farm' },
] as const

export function registerBand(on: On, game: () => GameHandle | null): void {
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const view = await read($, viewAtom)
    const mode = await read($, modeAtom)
    const handle = game()
    const loop = handle?.stage.loopFor(e.surface) ?? null
    if (e.props.hasSurvey || mode === 'off') {
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

    const tab = prefs.bandTab
    const party = tab === 'party'
    const timeline = handle?.stage.timeline ?? looseTimeline
    // Hotkeys need Buttons on screen (spike sheet): hidden in a zero-width Box on terminals and
    // the desktop (rung a′), a row of their own on VS Code and mobile, untested there (rung c).
    const hiddenKeys = terminal || e.surface === 'desktop'
    const extra: 0 | 1 = hiddenKeys ? 0 : 1
    if (party) timeline.observe(view, now)
    const rendererNow = terminal && 'Raster' in els ? await read($, rendererAtom) : 'svg'
    const layout = layoutFor(party ? timeline.rowsAt(view, now) : 0, e.props, e.surface, {
      tab,
      extra,
      minRows: party ? timeline.minRowsAt(view, now) : undefined,
      scalable: rendererNow === 'image',
    })
    // On a terminal, layoutFor collapses when the band does not fit; the Svg surfaces never do.
    const collapsed = prefs.collapsed || mode !== 'primary' || layout.kind === 'collapsed'

    if (collapsed) {
      loop?.mount(null)
      return (
        <Box key="band" flexDirection="column">
          <Box key="row-collapsed" flexDirection="row">
            <Text wrap="truncate">{clip(collapsedLine(view, mode, notice), width - 6)} </Text>
            <Button
              key="collapse"
              label={prefs.collapsed ? '▸' : '·'}
              hotkey="c"
              plain
              dimColor
              onPress={() => setPrefs({ collapsed: !prefs.collapsed })}
            />
          </Box>
        </Box>
      )
    }

    // The window strip: under the stage, beside the compact stage, or alone on Loot and World.
    const kind = layout.kind === 'full' ? 'full' : layout.kind === 'compact' ? 'compact' : 'bare'
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
    }
    const { scene } = stripScene(input)

    const press: Record<(typeof HOTKEYS)[number]['hotkey'], () => void> = {
      p: () => void setPrefs({ bandTab: 'party' }),
      l: () => void setPrefs({ bandTab: 'loot' }),
      w: () => void setPrefs({ bandTab: 'world' }),
      c: () => void setPrefs({ collapsed: true }),
      f: () => {
        // The path `/promptfall farm` takes (hooks/command.ts).
        if (handle?.canApply()) handle.apply({ t: 'set_farm', on: !view.farm }, now)
      },
    }
    // Not `h`: that name is the JSX factory.
    const buttons = HOTKEYS.map((k) => (
      <Button
        key={`hot-${k.hotkey}`}
        label={k.label}
        hotkey={k.hotkey}
        plain
        dimColor={k.hotkey !== 'c' && k.hotkey !== 'f' && k.label !== tab}
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

    // The Party tab's full layout is one picture on the terminal (spec #45): the stage and the
    // strip composed on the shell, the band's box up to the host's widest element, centred past it.
    // An Image on the terminals that draw pictures, a Raster of cells on half-block ones (#61).
    const picture =
      rendererNow === 'image' && 'Image' in els
        ? { renderer: 'image' as const, max: IMAGE_MAX_COLUMNS }
        : rendererNow === 'raster' && 'Raster' in els
          ? { renderer: 'raster' as const, max: RASTER_MAX_COLUMNS }
          : null
    if (terminal && picture && layout.kind === 'full') {
      const box = { columns: Math.min(width, picture.max), rows: layout.bandRows - extra }
      const key = bandKey(box)
      let element = null
      if (picture.renderer === 'raster' && 'Raster' in els) {
        const { Raster } = els
        const { cells } = bandCells(view, timeline, now, layout, settings.motion, box, scene)
        element = <Raster key={key} columns={box.columns} rows={box.rows} cells={cells} />
      } else if ('Image' in els) {
        const { Image } = els
        // As the stage's: a redraw of the site the loop is drawing reuses the picture it last
        // sent, the loop's next frame a beat away; anything new composes the first frame here.
        const source =
          loop?.stageSource(key, layout) ??
          bandFrame(view, timeline, now, layout, settings.motion, box, scene)
        element = (
          <Image
            key={key}
            source={source}
            columns={box.columns}
            rows={box.rows}
            alt={`${altText(view)}\n${scene.alt}`}
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
        strip: { kind, columns: stripColumns, tab, extra },
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
      const { Raster, Image } = els
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
              if (verdict) await update($, rendererAtom, () => verdict)
            })()
          })
        }
      } else if (renderer === 'raster') {
        strip = (
          <Raster key="strip" columns={scene.columns} rows={scene.rows} cells={sceneCells(scene)} />
        )
      } else {
        strip = (
          <Box key="strip-windows" flexDirection="row">
            {scene.windows.map((w) => (
              <Image
                key={windowKey(w)}
                source={windowSource(w)}
                columns={w.columns}
                rows={w.rows}
                alt={w.alt}
              />
            ))}
          </Box>
        )
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
            band: party,
          })}
          alt={scene.alt}
          isInteractive={SVG_INTERACTIVE}
        />
      )
    }

    // The stage: an element sized to the layout's box, its first frame drawn here so a redraw
    // is never blank; the loop blits every frame after it.
    const box = layout.box
    if (box && !terminal && 'Svg' in els) {
      // The band's width, its share of the shell and line drawn around the stage; on a short band
      // the whole stage scales down to the rows the strip leaves, centred on the shell (ADR 0004).
      // The 1.5x art, or the 1x art when its markup would pass the engine's cap.
      const source = stageSvg(view, timeline, now, box, {
        smil: SVG_SMIL,
        // Wider than the band: the desktop scales it down to the band's width (ADR 0004).
        width: Math.round(e.props.bodyColumns * DESKTOP_COLUMN_PX_CEILING),
        motion: settings.motion,
        fit: svgFit(e.props, box, scene, extra),
      })
      const { Svg } = els
      stage = (
        <Svg key="stage" source={source} alt={altText(view)} isInteractive={SVG_INTERACTIVE} />
      )
    } else if (box && terminal && 'Raster' in els) {
      const { Raster, Image } = els
      if (renderer === 'unknown') {
        stage = (
          <Box key="stage-empty" flexDirection="column">
            {Array.from({ length: (cellsOf(layout) ?? box).rows }, (_, i) => (
              <Text key={`stage-empty-${i}`}> </Text>
            ))}
          </Box>
        )
      } else {
        const cells = cellsOf(layout) ?? box
        // A redraw of the site the loop is drawing reuses the picture it last sent: the engine
        // sends nothing for a source it already drew, and the loop's next frame is at most a beat
        // away. A new size or layout, a stage drawn again, or no loop yet, composes once.
        const reused =
          renderer === 'image' ? (loop?.stageSource(stageKey(cells), layout) ?? null) : null
        const frame =
          reused !== null
            ? { source: reused }
            : stageFrame(
                view,
                timeline,
                now,
                layout,
                renderer === 'raster' ? 'raster' : 'image',
                settings.motion,
              )
        if ('cells' in frame) {
          // The cells the stage shows: the box, or its bottom rows on a short band (ADR 0010).
          stage = (
            <Raster key="stage" columns={cells.columns} rows={cells.rows} cells={frame.cells} />
          )
        } else {
          stage = (
            <Image
              key={stageKey(cells)}
              source={frame.source}
              columns={cells.columns}
              rows={cells.rows}
              alt={altText(view)}
            />
          )
        }
      }
    }

    // The loop: terminals blit the stage and the strip; the desktop runs on SMIL.
    if (terminal && (renderer === 'raster' || renderer === 'image')) {
      loop?.mount({
        requestId: e.requestId,
        key: box ? (renderer === 'image' ? stageKey(cellsOf(layout) ?? box) : 'stage') : '',
        layout,
        renderer,
        props: e.props,
        surface: e.surface,
        strip: { kind, columns: stripColumns, tab, extra },
      })
    } else if (!terminal && !SVG_SMIL) {
      loop?.mount({
        requestId: e.requestId,
        key: 'stage',
        layout,
        renderer: 'svg',
        props: e.props,
        surface: e.surface,
        strip: { kind, columns: stripColumns, tab, extra },
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
