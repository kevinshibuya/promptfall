// The desktop smoke: each stage golden scenario's desktop Svg (SMIL on), loaded as an Svg document
// in headless Chromium. A scenario fails when its root does not render, when a console error or a
// page error fires, or when it reaches the Svg cap. Broken documents run first and must fail, so
// a smoke that cannot see a failure fails too. `pnpm smoke:desktop`; needs Playwright's Chromium
// (`pnpm exec playwright install chromium`).
import { type Browser, chromium } from 'playwright'
import { renders, SCENARIOS, stage } from '../plugins/promptfall/hooks/stage/scenarios'
import { SVG_MAX_CHARS } from '../plugins/promptfall/hooks/stage/tuning'

export type Doc = { name: string; svg: string }

const URL = 'http://smoke.test/band.svg'
/** How long a document runs after its load, so its SMIL starts before the errors are read. */
const SETTLE_MS = 200

/** Why `doc` fails the smoke, or null when it loads clean. */
export async function smoke(browser: Browser, doc: Doc): Promise<string | null> {
  if (doc.svg.length >= SVG_MAX_CHARS) {
    return `${doc.svg.length} characters, at or over the cap of ${SVG_MAX_CHARS}`
  }
  const page = await browser.newPage()
  try {
    const errors: string[] = []
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(`console error: ${m.text()}`)
    })
    page.on('pageerror', (e) => errors.push(`page error: ${e.message}`))
    // Served as an Svg document, so the strict XML parser reads it as the desktop's does.
    await page.route(URL, (r) => r.fulfill({ contentType: 'image/svg+xml', body: doc.svg }))
    await page.goto(URL, { waitUntil: 'load' })
    await page.waitForTimeout(SETTLE_MS)
    const root = await page.evaluate(() => {
      const el = document.documentElement
      const box = el.getBoundingClientRect()
      return {
        svg: el.namespaceURI === 'http://www.w3.org/2000/svg' && el.localName === 'svg',
        parseError: document.getElementsByTagName('parsererror').length > 0,
        width: box.width,
        height: box.height,
      }
    })
    if (root.parseError) return 'the document does not parse'
    if (!root.svg) return 'the root is not an svg element'
    if (root.width <= 0 || root.height <= 0) {
      return `the root renders ${root.width} × ${root.height}`
    }
    return errors[0] ?? null
  } finally {
    await page.close()
  }
}

const NS = 'xmlns="http://www.w3.org/2000/svg"'
/** Documents the smoke must fail: the self-test of its failure path. */
const BROKEN: readonly Doc[] = [
  { name: 'broken: unclosed element', svg: `<svg ${NS} width="10" height="10"><g><rect/></svg>` },
  { name: 'broken: empty root', svg: `<svg ${NS} width="0" height="0"/>` },
  {
    name: 'broken: console error',
    svg: `<svg ${NS} width="10" height="10"><script>console.error('boom')</script><rect width="10" height="10"/></svg>`,
  },
  {
    name: 'broken: page error',
    svg: `<svg ${NS} width="10" height="10"><script>throw new Error('boom')</script><rect width="10" height="10"/></svg>`,
  },
  {
    name: 'broken: over the cap',
    svg: `<svg ${NS} width="10" height="10"><!--${'x'.repeat(SVG_MAX_CHARS)}--></svg>`,
  },
]

async function main(): Promise<number> {
  const started = Date.now()
  const browser = await chromium.launch()
  try {
    for (const doc of BROKEN) {
      const why = await smoke(browser, doc)
      if (why === null) {
        console.log(`FAIL ${doc.name}: the smoke passed a broken document`)
        return 1
      }
      console.log(`ok   ${doc.name} (fails: ${why})`)
    }
    for (const name of SCENARIOS) {
      const why = await smoke(browser, { name, svg: renders(stage(name)).svg })
      if (why !== null) {
        console.log(`FAIL ${name}: ${why}`)
        return 1
      }
      console.log(`ok   ${name}`)
    }
  } finally {
    await browser.close()
  }
  console.log(`${SCENARIOS.length} scenarios clean in ${Date.now() - started} ms`)
  return 0
}

process.exitCode = await main()
