# Deploy

Promptfall runs on the shared Oracle box as one container in `~/apps/promptfall`, behind the
box's Caddy at `promptfall.kevinshibuya.com`. Nothing of Promptfall's listens on the host: Caddy
reaches `promptfall:7777` on the `web` network. Secrets live only in the box's `.env` and
`r2.env`; the box's ssh address lives only in your shell as `PROMPTFALL_BOX`.

| File | What it is |
| --- | --- |
| `docker-compose.yml` | The project: one service, 512m, `restart: unless-stopped`, the `web` network, a healthcheck on `/v1/health`, the `data` and `backups` volumes. |
| `.env.example` | The box's `.env` with placeholders. |
| `Caddyfile.snippet` | The site block for the box's Caddyfile. |
| `deploy.sh` | A release, from the laptop over ssh. `--help` for the flags. |
| `rollback.sh` | Puts `PREVIOUS_IMAGE` back, from the laptop over ssh. |
| `backup.sh` | The nightly copy to R2, from the box's cron. |
| `smoke.sh` | The smoke: with no argument, the image built and run locally; with a URL, that server. |

The examples below run from the repo root on the laptop unless they say "on the box".

## First deploy

1. On the box, make the project's directory and put the compose file, the env and the backup
   script in it:

   ```sh
   scp deploy/docker-compose.yml deploy/.env.example deploy/backup.sh "$PROMPTFALL_BOX":
   ssh "$PROMPTFALL_BOX"
   mkdir -p ~/apps/promptfall
   mv docker-compose.yml backup.sh ~/apps/promptfall/
   mv .env.example ~/apps/promptfall/.env
   chmod 600 ~/apps/promptfall/.env
   ```

2. On the box, fill `.env`: `PROMPTFALL_BOTS` (6 for the soft wave, 0 at the public listing),
   `PROMPTFALL_GITHUB_CLIENT_ID` from the GitHub OAuth app, and a long random
   `PROMPTFALL_ADMIN_TOKEN` (`openssl rand -hex 32`). `deploy.sh` writes `IMAGE` and
   `PREVIOUS_IMAGE`; leave the placeholders.
3. While the GHCR package is private, log the box in once with a token that can read packages:
   `docker login ghcr.io -u kevinshibuya`. A public package needs nothing.
4. Append `Caddyfile.snippet` to the box's Caddyfile and reload Caddy (`docker exec caddy caddy
   reload --config /etc/caddy/Caddyfile`, with the Caddy container's own name and path). The DNS
   record for `promptfall.kevinshibuya.com` points at the box.
5. From the laptop, deploy the release and smoke it:

   ```sh
   export PROMPTFALL_BOX=ubuntu@<box address>
   deploy/deploy.sh v0.3.0
   deploy/smoke.sh https://promptfall.kevinshibuya.com
   ```

6. Set up the backups (below) and add the box ledger row (last section).

## A release

1. Tag and push: `git tag v0.3.1 && git push origin v0.3.1`. The `release` workflow builds the
   image for arm64 and amd64 and pushes `ghcr.io/kevinshibuya/promptfall:v0.3.1`. Wait for it to
   go green.
2. `deploy/deploy.sh --dry-run v0.3.1` prints what will run on the box, without connecting.
3. `deploy/deploy.sh v0.3.1` pulls the image, writes `IMAGE=…:v0.3.1` and
   `PREVIOUS_IMAGE=<the image that was running>` into `.env`, runs `docker compose up -d` and polls
   `/v1/health` inside the container for up to 60 s. A failure prints the last log lines and the
   rollback command. Redeploying the running tag keeps the rollback target it had.
4. `deploy/smoke.sh https://promptfall.kevinshibuya.com`: health, a bootstrap, one batch, one
   world poll. Each run mints one account on the server.

The host writes a backup copy on the way down (SIGTERM), so every release leaves a copy of the
store as it was just before.

## A rollback

`deploy/rollback.sh` swaps `IMAGE` and `PREVIOUS_IMAGE` in the box's `.env`, brings the project up
on the previous image and polls health, as a deploy does. A second rollback rolls forward again.
`--dry-run` prints it without connecting. Smoke it afterwards as after a release.

A rollback changes the image, not the data: the store stays as the newer image left it.

## Backups

The host is started with `--backup-dir /backups` and writes a consistent copy of its SQLite file
(SQLite's online backup API) into the `backups` volume daily at 03:00 UTC, on SIGUSR1 and on
SIGTERM, keeping the newest seven as `promptfall-<UTC stamp>.sqlite`. Each copy logs one line,
`promptfall backup: <scheduled|signal|shutdown> <path>`, in `docker compose logs`.

`backup.sh` runs on the box from cron. It sends SIGUSR1 through compose, waits up to 60 s for the
new copy, gzips it in the volume, and ships it to R2 with a one-shot rclone container that mounts
the `backups` volume read-only, under `nightly/` in the bucket. It deletes `nightly/` objects older
than thirty days. Any failed step (the signal, the copy, the gzip, rclone, the upload, the
retention) exits non-zero with a `promptfall backup: <step>: …` line on stderr.

On the box, `~/apps/promptfall/r2.env` (mode 600) holds rclone's R2 remote. The token needs
read, write and delete on the bucket:

```sh
RCLONE_CONFIG_R2_TYPE=s3
RCLONE_CONFIG_R2_PROVIDER=Cloudflare
RCLONE_CONFIG_R2_ACCESS_KEY_ID=<R2 access key id>
RCLONE_CONFIG_R2_SECRET_ACCESS_KEY=<R2 secret access key>
RCLONE_CONFIG_R2_ENDPOINT=https://<account id>.r2.cloudflarestorage.com
RCLONE_CONFIG_R2_NO_CHECK_BUCKET=true
```

The bucket is `promptfall-backups` unless `PROMPTFALL_R2_BUCKET` says otherwise; `backup.sh
--help` lists the rest. Run it once by hand to see it ship, then add the cron line (`crontab -e`
on the box), half an hour after the host's own copy:

```cron
30 3 * * * $HOME/apps/promptfall/backup.sh >>$HOME/apps/promptfall/backup.log 2>&1
```

Cron runs with a short `PATH`. If `docker` is not in `/usr/bin`, put
`PATH=/usr/local/bin:/usr/bin:/bin` above the line.

## Restore from R2

On the box, into a scratch directory first, so the copy is checked before anything live changes.
`<copy>` is a name from the listing, such as `promptfall-20261010T030000123Z.sqlite`.

```sh
cd ~/apps/promptfall
mkdir -p ~/promptfall-restore
rclone_image=rclone/rclone:1.75.1

# 1. What R2 holds.
docker run --rm --env-file r2.env "$rclone_image" lsf r2:promptfall-backups/nightly/

# 2. Fetch one copy into the scratch directory, as you, and unpack it.
docker run --rm --user "$(id -u):$(id -g)" --env-file r2.env -v ~/promptfall-restore:/restore \
  "$rclone_image" copyto r2:promptfall-backups/nightly/<copy>.gz /restore/<copy>.gz
gunzip ~/promptfall-restore/<copy>.gz

# 3. Check it with the image's own Node: SQLite's integrity check and the number of keys.
docker run --rm --user "$(id -u):$(id -g)" -v ~/promptfall-restore:/restore \
  --entrypoint node "$(sed -n 's/^IMAGE=//p' .env)" -e "
    const { DatabaseSync } = require('node:sqlite')
    const db = new DatabaseSync('/restore/<copy>')
    console.log(db.prepare('PRAGMA integrity_check').get().integrity_check)
    console.log(db.prepare('SELECT count(*) AS n FROM kv').get().n, 'keys')"
```

Step 3 prints `ok` and a key count. The scratch copy can stop there. To put it live:

```sh
# 4. Stop the host (it writes one last copy of the store it holds), swap the file, start it.
docker compose stop promptfall
docker run --rm --user root --entrypoint sh \
  -v promptfall_data:/data -v ~/promptfall-restore:/restore \
  "$(sed -n 's/^IMAGE=//p' .env)" -c '
    cp /restore/<copy> /data/promptfall.sqlite.new &&
    rm -f /data/promptfall.sqlite-wal /data/promptfall.sqlite-shm &&
    mv /data/promptfall.sqlite.new /data/promptfall.sqlite &&
    chown node:node /data/promptfall.sqlite'
docker compose start promptfall
```

Then, from the laptop, `deploy/smoke.sh https://promptfall.kevinshibuya.com`.

## Volumes

| Volume | Mounted at | Holds |
| --- | --- | --- |
| `promptfall_data` | `/data` | The store, `promptfall.sqlite` with its `-wal` and `-shm` files. The only state the server has. |
| `promptfall_backups` | `/backups` | The host's seven newest copies, and for a moment the `.gz` `backup.sh` is shipping. |

Both belong to the image's `node` user. `docker compose down` keeps them; `down --volumes` deletes
the store.

## The box ledger

Add this row to the box ledger in the ts6-server repo, in that ledger's columns:

| Project | Directory | Ports | Memory | Volumes | Backup |
| --- | --- | --- | --- | --- | --- |
| promptfall | `~/apps/promptfall` | none on the host; Caddy → `promptfall:7777` on `web`, `promptfall.kevinshibuya.com` | `mem_limit` 512m | `promptfall_data`, `promptfall_backups` | host copies daily 03:00 UTC (seven kept); `backup.sh` at 03:30 UTC to R2 `promptfall-backups/nightly/`, thirty days |
