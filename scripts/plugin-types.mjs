// Lays the engine's declarations under the plugin before `tsc -p plugins/promptfall`.
// An interactive `claude --plugin-dir plugins/promptfall` writes them on first load and they stay
// uncommitted, so a fresh worktree has none: it borrows the main checkout's, read-only.
import { execFileSync } from 'node:child_process'
import { cpSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const TYPES = 'plugins/promptfall/.claude-plugin/types'
const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const here = join(root, TYPES)

if (!existsSync(join(here, 'tsconfig.json'))) {
  // The first worktree git lists is the main checkout.
  const list = execFileSync('git', ['worktree', 'list', '--porcelain'], {
    cwd: root,
    encoding: 'utf8',
  })
  const main = list.match(/^worktree (.+)$/m)?.[1]
  const there = main && join(main, TYPES)
  if (!there || there === here || !existsSync(join(there, 'tsconfig.json'))) {
    console.error(
      `No engine declarations at ${TYPES}. Run \`claude --plugin-dir plugins/promptfall\` once in the main checkout.`,
    )
    process.exit(1)
  }
  cpSync(there, here, { recursive: true })
  console.log(`Borrowed the engine declarations from ${main}`)
}
