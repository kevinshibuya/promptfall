# Promptfall

Promptfall is an idle fantasy RPG that runs inside Claude Code as a mod. A party of three heroes
fights above the prompt while Claude works: tool calls spawn enemies, long turns end in bosses,
and each prompt you submit is a short rest. The product and architecture contract is
[docs/spec/promptfall.md](docs/spec/promptfall.md).

## Status

Phases 1 to 3 are built. Phase 1 is the solo loop: the deterministic sim, the batch protocol, and
the plugin with its band and dialog. Phase 2 is the market: the account ledger with server events
and deliveries, item and hero trading with buy orders, an HTTP fake server with seeded bots,
outages, server switching and the GitHub link flow. Phase 3 is the social layer: a world poll that
carries presence and the chat tail, chat with a word list and a rate limit, highest-zone and weekly
boss-damage leaderboards, bots that play through the public HTTP API like a player, and a world
boss every 3 hours that every online party fights together (sim version 3).
Phase 4, PR 1 is the art engine: a pixel-art battle stage on the band's Party tab (an `Image` in
Ghostty and kitty, half-block `Raster` cells in other terminals, an `Svg` with SMIL on the desktop,
always the full stage scaled to the band), four sound cues, sprites in the dialog's lists, and the
art pipeline that builds them, all on the concept sheets as placeholders.
Phase 4, PR 2 is the real art: 4 heroes with attack poses, 72 monsters and bosses, 4 world bosses
and 40 items, drawn by gpt-image-2 on sprite sheets and cut to size (`pnpm slice`), with the hero
sprites cleaned by hand, and four CC0 8-bit sound cues. Each sprite is drawn twice: the 1.5× art
for the full stage in Ghostty, kitty and the desktop, and the 1× art for half-block terminals, the
compact stage and the lists (ADR 0006).

The combat flow replaced "every unit acts once per tick" with action gauges, an action queue and a
weighted picker: units act one at a time, in the order their gauges filled, and each hero class
picks its action and target from its tactics (sim version 4).

The UI remake redrew the interface as Dragon Quest V command windows in three PRs. UI PR 1 ships
the window kit (frames, the Misaki Gothic 2nd font, an image, raster and Svg encoder for every
surface) and turns the band's text rows into a strip of windows under the stage: enemies, a message
window with the combat log, the party with its action gauges, and the purse. UI PR 2 draws the
dialog's Inventory and Heroes tabs as windows: a list with a ▶ cursor that follows the focus ring,
a detail window, command, pick and Yes/No windows, and the sell window. UI PR 3 does the same for
Market, Orders, Account, Odds, Chat and Leaderboards. Typed fields (prices, the chat line) and the
GitHub link sit under the picture, and a short pane drops its tab window, so an inline pane in an
ordinary terminal draws every tab.

Phase 5 is the soft launch (ADR 0012). The HTTP fake's host is the real server: the same ledger
on a SQLite store, GitHub's own device flow for the link, bots named as bots and kept off the
boards, admin routes for flags and bans, a cap on new accounts per address, and a player's own
account delete. It runs as one container on a shared box behind Caddy, with nightly backups to
Cloudflare R2, and a fresh install plays on it.

## Play it

In a Claude Code session:

```
/plugin marketplace add kevinshibuya/promptfall
/plugin install promptfall@promptfall
```

A fresh install plays on the public server, `https://promptfall.kevinshibuya.com`, with the world
boss, the market and other players. `/promptfall server local` plays offline on the in-process
fake instead (no chat, no world boss), `/promptfall server <url>` plays on any other server, and
`/promptfall server` says which one is in force.

The plugin README covers commands, hotkeys, the market and the world, and its Develop section
covers playing from a checkout and running the HTTP fake: [plugins/promptfall/README.md](plugins/promptfall/README.md).

## Repository

| Path | What it is |
| --- | --- |
| `packages/sim` | `@promptfall/sim`: the game rules and content, integer math only, with a balance harness (`pnpm --filter @promptfall/sim harness -- --hours 8`) |
| `packages/protocol` | `@promptfall/protocol`: Zod schemas for batches, server events and the market, the `ServerClient` interface, `HttpClient`, and the server contract suite at `@promptfall/protocol/contract` |
| `packages/ledger` | `@promptfall/ledger`: account records, batch replay, the server event log and deliveries, the market rules, the host privileges; run in-process by the plugin and over HTTP by the fake |
| `servers/fake` | `@promptfall/fake-server`: the ledger behind `node:http` with a JSON snapshot or a SQLite file (`--store sqlite:<path>`), a virtual clock, seeded bots that play over HTTP, server flags (`pnpm fake --port 7777 --speed 10 --bots 12 --flag chat.enabled=false`), the GitHub device flow behind `--link github` with the client id from `PROMPTFALL_GITHUB_CLIENT_ID` (`--link fake`, the default, approves every link as `--player-name`), admin flags and bans over `POST /v1/admin/flags` and `POST /v1/admin/ban` with `PROMPTFALL_ADMIN_TOKEN`, a player's own account delete over `DELETE /v1/account`, a cap of five new accounts an hour per client address, an access log line per request on stdout, and the image's `Dockerfile` |
| `plugins/promptfall` | The Claude Code mod, with the three packages bundled into `hooks/vendor/` |
| `scripts/vendor.mjs` | Builds those bundles |
| `scripts/build-server.mjs` | Bundles the server into one file, `servers/fake/dist/cli.js`, for the image (`pnpm build:server`) |
| `deploy/` | The compose project for the box (`docker-compose.yml`, `.env.example`), the Caddy site block, `deploy.sh` and `rollback.sh` from the laptop, `backup.sh` to R2 from the box's cron, and `smoke.sh`, which builds the image and waits for health or checks a running server; CI runs the smoke, and a `v*` tag pushes the image to GHCR. Its README is the runbook |
| `art/` | The sprite manifest, palettes and the sprites in `art/sprites/` (1×) and `art/sprites-hires/` (1.5×) that `pnpm sprites` turns into the plugin's sprite module, `art/sheets.md` (the prompt and cut behind each sprite sheet), and the window font's source |
| `scripts/font.ts` | Bakes the window font into the plugin's glyph module (`pnpm font`) |
| `docs/` | The spec, the ADRs, the feature list, the phase plans, the manual-pass scripts, the launch checklist and the roadmap |

## Checks

```sh
pnpm lint && pnpm typecheck && pnpm test && pnpm vendor:check && pnpm sprites:check && pnpm font:check
claude plugin validate plugins/promptfall
claude plugin test plugins/promptfall
pnpm typecheck:plugin
```

CI runs the first line: lint, the type-check of the packages and the fake server, their tests
(the contract suite runs over the in-process ledger and over HTTP), and the three generated-file
checks: the vendor bundles, the sprite module and the window glyphs. The three plugin checks need a
local Claude Code.

## Privacy

The public server stores, for each account: an account id, a device token (the random key this
machine sends with every call), the game state (the party, the items, the gold, the market
listings and orders), and the GitHub login if the account is linked. It never stores the GitHub
access token: the link reads the login with it and drops it. Chat lines are kept under the poster's
name until newer messages push them out; the channel keeps the last 200. While the server runs, it
holds in memory who is online and in which zone for 45 seconds after the last poll, and the
address a new account came from for an hour, to cap new accounts per address; a restart forgets
both. Its log has one line per request (method, path, status, time taken), with no address, token
or body. Copies of the store are taken nightly: the newest seven stay on the server, and Cloudflare
R2 keeps each for thirty days.

Delete my account on this server, on the pane's Account tab, deletes the account, its token, its
listings and orders, and its leaderboard rows, then resets this machine's save. Copies taken before
the delete age out of the backups within thirty days. Chat lines already posted stay until pushed
out. To have anything else removed, ask in GitHub Discussions.

## Talk to us

Questions, bugs and ideas go to [GitHub Discussions](https://github.com/kevinshibuya/promptfall/discussions).
Promptfall is on TikTok as [@promptfall](https://www.tiktok.com/@promptfall). What comes next is in
[docs/roadmap.md](docs/roadmap.md).

## Licence

MIT: see [LICENSE](LICENSE). The third-party code and font the plugin ships keep their own
licences, listed in [plugins/promptfall/NOTICE.md](plugins/promptfall/NOTICE.md); the sound cues
are CC0 (below).

## Credits

The four sound cues come from Juhani Junkala's "512 Sound Effects (8-bit style)", released under
CC0: https://opengameart.org/content/512-sound-effects-8-bit-style
