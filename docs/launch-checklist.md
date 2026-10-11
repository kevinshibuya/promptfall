# Launch checklist

The human steps of the soft launch (spec #73), in order, a box each. Nothing here is a ticket: the
code for every step is built, and `deploy/README.md` holds the commands. The dates are internal and
stay here; the public order is `docs/roadmap.md`, without dates.

## The soft wave

The store, the host flags, the image and deploy, and the GitHub link gate the wave. All four are
built.

- [ ] Set the wave's date and write it on this line: `____-__-__`.
- [x] Reserve the handles: `@promptfall` on TikTok, the name the README points at (if it is taken,
      take the nearest and change the README's link in the same commit), and the same name on any
      other network you mean to post on. Taken 2026-10-11: `@promptfall` on TikTok, Instagram and X.
- [ ] Create the GitHub OAuth app under your account (Settings → Developer settings → OAuth Apps):
      name Promptfall, homepage `https://github.com/kevinshibuya/promptfall`, "Enable Device Flow"
      ticked. Keep the client id for the box's `.env`; generate no client secret.
- [ ] Point DNS for `promptfall.kevinshibuya.com` at the box's public address as a plain A record,
      DNS only (not proxied): behind a CDN proxy the mint cap would key on the proxy's addresses.
      Check it with `dig +short promptfall.kevinshibuya.com`.
- [ ] Put the project on the box and fill its `.env` (`deploy/README.md`, First deploy, steps 1
      to 3): `PROMPTFALL_GITHUB_CLIENT_ID`, a fresh `PROMPTFALL_ADMIN_TOKEN`, and the bots count,
      `PROMPTFALL_BOTS=6`.
- [ ] Append `deploy/Caddyfile.snippet` to the box's Caddyfile and reload Caddy.
- [ ] Tag `v0.3.0`, wait for the `release` workflow to go green, and make the GHCR package public
      (or log the box in to GHCR once).
- [ ] The first deploy: `deploy/deploy.sh v0.3.0`, then
      `deploy/smoke.sh https://promptfall.kevinshibuya.com` prints its health, bootstrap, batch and
      world lines.
- [ ] Create the R2 bucket `promptfall-backups` and an R2 API token with read, write and delete on
      it; write the box's `~/apps/promptfall/r2.env` (mode 600) as `deploy/README.md` shows; run
      `backup.sh` once by hand and see the copy under `nightly/`; add the cron line.
- [ ] Add a free uptime monitor on `https://promptfall.kevinshibuya.com/v1/health`, every five
      minutes, alerting your email.
- [ ] Add Promptfall's row (from `deploy/README.md`, The box ledger) to the box ledger in the
      ts6-server repo.
- [ ] Make the repo public (Settings → General → Danger Zone), after a last look for anything
      that should not be in its history, and turn on Discussions (Settings → General → Features).
- [ ] Walk `docs/manual-pass/soft-launch.md` on a second machine. Every step green before anyone
      is invited.
- [ ] Send the wave's invitations, ten to twenty people: the two install commands from the README
      and the Discussions link.

## The public listing

Bots off the market, the admin routes, the mint cap, the delete verb and the privacy paragraph gate
the listing. All five are built.

- [ ] Set the listing's date and write it on this line: `____-__-__`.
- [ ] Read what the wave said in Discussions, and fix or file what has to change first.
- [ ] Set `PROMPTFALL_BOTS=0` in the box's `.env`, redeploy the running tag
      (`deploy/deploy.sh <tag>`), and see the market and both boards with no `[bot]` name.
- [ ] Flip a flag and back over the admin route from the laptop (`deploy/README.md`, Flags), so
      the token on the laptop is known to work before it is needed.
- [ ] Check the last nightly copy is in R2 and less than a day old.
- [ ] Pace the listing's invitations: GitHub allows 50 device-code submissions an hour per OAuth
      app, so more than 50 links in one hour will fail.
- [ ] Post the listing: the install commands on TikTok and in a pinned Discussion.
