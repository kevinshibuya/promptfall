// The renderer probe (moved out of ui/band.tsx for UI PR 3): a 1 × 1 Image whose blit the engine
// takes where the terminal draws pictures, and refuses with the alt's deny where it does not. The
// band and the pane both mount it while the renderer is unknown, so a docked pane with a collapsed
// band still settles it. The hooks loader never follows `$` across an import, so each caller arms
// its own blit with `$` in its own module; this one holds what they share.
import type { Elements, RenderElement } from 'claude-code'
import type { Renderer } from '../../types'
import { encode } from '../sprites/base64'
import { PROBE_ALT_DENY } from '../stage/tuning'

/** One transparent pixel: what the probe's Image draws first. */
const PROBE_A = { rgba: encode(Uint8Array.of(0, 0, 0, 0)), width: 1, height: 1 }
/** One pixel of alpha 1: a source different from PROBE_A, so the blit is a real swap. */
export const PROBE_B = { rgba: encode(Uint8Array.of(0, 0, 0, 1)), width: 1, height: 1 }

/** A probe armed and not yet answered; module state, so a reload may arm one more. */
let probePending = false

/** The probe Image while `renderer` is unknown and the surface has Images, else null. */
export function probeElement(
  els: Partial<Pick<Elements['terminal'], 'Image'>>,
  renderer: Renderer,
): RenderElement | null {
  const { Image } = els
  if (renderer !== 'unknown' || !Image) return null
  return <Image key="probe" source={PROBE_A} columns={1} rows={1} alt=" " />
}

/** True for the one caller that should send the blit now: no other probe is waiting. */
export function armProbe(): boolean {
  if (probePending) return false
  probePending = true
  return true
}

/**
 * The renderer a blit's answer settles on: taken is image; the no-pictures deny is raster; any
 * other deny settles nothing, and the next drawing probes again.
 */
export function probeVerdict(deny: string | undefined): Renderer | null {
  probePending = false
  if (deny === undefined) return 'image'
  return deny.startsWith(PROBE_ALT_DENY) ? 'raster' : null
}
