# Promptfall

Promptfall is an idle fantasy RPG that runs inside Claude Code as a mod. A party of three heroes
fights above the prompt while Claude works: tool calls spawn enemies, long turns end in bosses,
and each prompt you submit is a short rest. The product and architecture contract is
[docs/spec/promptfall.md](docs/spec/promptfall.md).

## Status

Phase 1, the solo loop, is built: the deterministic sim, the batch protocol against an
in-process fake server, and the plugin with its band and dialog. Phases 2 to 5 (market, social,
art, real server) each get their own plan when their turn comes.

## Play it

```sh
pnpm install
claude --plugin-dir plugins/promptfall
```

The plugin README covers commands and hotkeys: [plugins/promptfall/README.md](plugins/promptfall/README.md).

## Repository

| Path | What it is |
| --- | --- |
| `packages/sim` | `@promptfall/sim`: the game rules and content, integer math only, with a balance harness (`pnpm --filter @promptfall/sim harness -- --hours 8`) |
| `packages/protocol` | `@promptfall/protocol`: Zod batch schemas, the `ServerClient` interface, the in-process fake server, and the server contract suite at `@promptfall/protocol/contract` |
| `plugins/promptfall` | The Claude Code mod, with the two packages bundled into `hooks/vendor/` |
| `scripts/vendor.mjs` | Builds those bundles |
| `docs/` | The spec, the phase plans and the manual-pass scripts |

## Checks

```sh
pnpm lint && pnpm typecheck && pnpm test && pnpm vendor:check
claude plugin validate plugins/promptfall
claude plugin test plugins/promptfall
pnpm exec tsc -p plugins/promptfall
```

CI runs the first line. The three plugin checks need a local Claude Code.
