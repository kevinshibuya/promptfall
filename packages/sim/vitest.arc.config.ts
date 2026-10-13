import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['src/harness/**/*.{test,spec}.?(c|m)[jt]s?(x)'],
  },
})
