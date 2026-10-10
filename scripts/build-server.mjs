// Bundles the host (servers/fake/src/cli.ts) into one file, servers/fake/dist/cli.js:
// the workspace packages and zod inside it, Node's built-ins outside. The image runs that file.
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'tsup'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const server = join(root, 'servers/fake')
const out = join(server, 'dist')

await build({
  entry: { cli: join(server, 'src/cli.ts') },
  format: ['esm'],
  outDir: out,
  splitting: false,
  minify: false,
  sourcemap: false,
  // tsc -b writes the declarations beside it.
  clean: false,
  target: 'node22',
  platform: 'node',
  silent: true,
  tsconfig: join(server, 'tsconfig.json'),
  noExternal: [/.*/],
  // node:sqlite has no bare name.
  removeNodeProtocol: false,
  esbuildOptions(options) {
    options.conditions = ['import', 'module', 'default']
  },
})

const text = readFileSync(join(out, 'cli.js'), 'utf8')
if (text.includes('vitest'))
  throw new Error('cli.js mentions vitest: a test leaked into the bundle')
for (const [, spec] of text.matchAll(/(?:from|import\()\s*['"]([^'"]+)['"]/g)) {
  if (!spec.startsWith('node:')) throw new Error(`cli.js still imports ${spec}`)
}
