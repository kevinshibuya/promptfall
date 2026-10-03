# Promptfall

Promptfall is an idle fantasy RPG that runs inside Claude Code as a mod. A party of three heroes
fights above the prompt while Claude works: tool calls spawn enemies, long turns end in bosses,
and each prompt you submit is a short rest. The product and architecture contract is
[docs/spec/promptfall.md](docs/spec/promptfall.md).

## Status

Phases 1 and 2 are built. Phase 1 is the solo loop: the deterministic sim, the batch protocol,
and the plugin with its band and dialog. Phase 2 is the market: the account ledger with server
events and deliveries, item and hero trading with buy orders, an HTTP fake server with seeded
bots, outages, server switching and the GitHub link flow. Phases 3 to 5 (social, art, real
server) each get their own plan when their turn comes.

## Play it

```sh
pnpm install
claude --plugin-dir plugins/promptfall
```

The plugin plays on an in-process ledger by default. To trade with bots, run the HTTP fake and
point the plugin at it:

```sh
pnpm fake --port 7777 --speed 10        # one terminal: the fake, with 12 bots
/promptfall server http://127.0.0.1:7777   # in the Claude Code session
```

The plugin README covers commands, hotkeys and the market: [plugins/promptfall/README.md](plugins/promptfall/README.md).

## Repository

| Path | What it is |
| --- | --- |
| `packages/sim` | `@promptfall/sim`: the game rules and content, integer math only, with a balance harness (`pnpm --filter @promptfall/sim harness -- --hours 8`) |
| `packages/protocol` | `@promptfall/protocol`: Zod schemas for batches, server events and the market, the `ServerClient` interface, `HttpClient`, and the server contract suite at `@promptfall/protocol/contract` |
| `packages/ledger` | `@promptfall/ledger`: account records, batch replay, the server event log and deliveries, the market rules, the host privileges; run in-process by the plugin and over HTTP by the fake |
| `servers/fake` | `@promptfall/fake-server`: the ledger behind `node:http` with a JSON snapshot, a virtual clock and seeded bots (`pnpm fake --port 7777 --speed 10 --bots 12`) |
| `plugins/promptfall` | The Claude Code mod, with the three packages bundled into `hooks/vendor/` |
| `scripts/vendor.mjs` | Builds those bundles |
| `docs/` | The spec, the phase plans and the manual-pass scripts |

## Checks

```sh
pnpm lint && pnpm typecheck && pnpm test && pnpm vendor:check
claude plugin validate plugins/promptfall
claude plugin test plugins/promptfall
pnpm exec tsc -p plugins/promptfall
```

CI runs the first line: lint, the type-check of the packages and the fake server, their tests
(the contract suite runs over the in-process ledger and over HTTP), and the vendor check. The
three plugin checks need a local Claude Code.
