import { defineConfig } from 'vitest/config'

// One tsconfig for every module: the plugin's own extends a file Claude Code generates locally
// (git-ignored), which CI does not have, and scripts/sprites.ts imports plugin source.
export default defineConfig({ tsconfig: './tsconfig.base.json' })
