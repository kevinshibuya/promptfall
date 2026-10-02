# Promptfall plugin

The Claude Code mod half of Promptfall. Its hooks run the deterministic sim locally, batch the
events to an in-process fake server that persists through `$.store`, and draw the band above
the prompt.

## Load it

From the repository root, in an interactive session:

```sh
claude --plugin-dir plugins/promptfall
```

A `--plugin-dir` folder hot-reloads on save. The game packages live in `packages/`, and a mod
can import only files inside its own folder, so `pnpm vendor` bundles them into
`hooks/vendor/`. Run it after changing `packages/sim` or `packages/protocol`, and commit the
result: CI fails when the bundles are stale (`pnpm vendor:check`).

`.claude-plugin/types/` and `tsconfig.json` are laid by the engine on load and committed so
`tsc -p plugins/promptfall` works without a session. They belong to the Claude Code build that
wrote them; a newer build rewrites them on its next load.

## Check it

```sh
claude plugin validate plugins/promptfall
claude plugin test plugins/promptfall
pnpm exec tsc -p plugins/promptfall
```
