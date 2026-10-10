#!/usr/bin/env bash
# The nightly backup, run on the box from cron (see deploy/README.md for the line). Asks the host
# for a fresh copy over SIGUSR1, waits for it in the backups volume, gzips it and ships it to R2
# with a one-shot rclone container, under nightly/ with thirty days kept. Any failed step exits
# non-zero with the step named on stderr.
set -euo pipefail

if [ "${1:-}" = -h ] || [ "${1:-}" = --help ]; then
  cat <<'USAGE'
usage: deploy/backup.sh

  PROMPTFALL_DIR             the compose project's directory (default ~/apps/promptfall)
  PROMPTFALL_R2_ENV          rclone's R2 remote as RCLONE_CONFIG_R2_* lines (default
                             $PROMPTFALL_DIR/r2.env)
  PROMPTFALL_R2_BUCKET       the bucket (default promptfall-backups)
  PROMPTFALL_BACKUPS_VOLUME  the volume the host copies into (default promptfall_backups)
  PROMPTFALL_RCLONE_IMAGE    the rclone image (default rclone/rclone:1.75.1)
  PROMPTFALL_BACKUP_WAIT     seconds to wait for the new copy (default 60)
USAGE
  exit 0
fi

dir=${PROMPTFALL_DIR:-$HOME/apps/promptfall}
r2env=${PROMPTFALL_R2_ENV:-$dir/r2.env}
bucket=${PROMPTFALL_R2_BUCKET:-promptfall-backups}
volume=${PROMPTFALL_BACKUPS_VOLUME:-promptfall_backups}
rclone_image=${PROMPTFALL_RCLONE_IMAGE:-rclone/rclone:1.75.1}
wait=${PROMPTFALL_BACKUP_WAIT:-60}

fail() {
  echo "promptfall backup: $*" >&2
  exit 1
}

cd "$dir" || fail "no project directory at $dir"
[ -r "$r2env" ] || fail "rclone: no R2 settings at $r2env"

rclone() {
  # The remote comes from the env file; no config file to look for.
  docker run --rm --env-file "$r2env" -v "$volume:/backups:ro" "$rclone_image" --config /dev/null "$@"
}

# The newest copy the host has written, or nothing.
newest() {
  local listing
  listing=$(docker compose exec -T promptfall ls -1 /backups) ||
    fail "copy: cannot list /backups in the promptfall container"
  printf '%s\n' "$listing" | grep -E '^promptfall-[0-9]{8}T[0-9]{9}Z\.sqlite$' | tail -n 1 || true
}

before=$(newest)
docker compose kill --signal SIGUSR1 promptfall >/dev/null ||
  fail "signal: SIGUSR1 did not reach the promptfall container"

copy=
for _ in $(seq 1 "$wait"); do
  copy=$(newest)
  if [ -n "$copy" ] && [ "$copy" != "$before" ]; then break; fi
  copy=
  sleep 1
done
[ -n "$copy" ] || fail "copy: no new copy in /backups after ${wait} s (docker compose logs promptfall)"

gz="$copy.gz"
cleanup() {
  docker compose exec -T promptfall rm -f "/backups/$gz" >/dev/null 2>&1 || true
}
trap cleanup EXIT
docker compose exec -T promptfall gzip --keep --force "/backups/$copy" ||
  fail "gzip: could not compress /backups/$copy"

rclone version >/dev/null || fail "rclone: $rclone_image does not run"
rclone copyto "/backups/$gz" "r2:$bucket/nightly/$gz" ||
  fail "upload: rclone could not copy $gz to r2:$bucket/nightly/"
[ -n "$(rclone lsf "r2:$bucket/nightly/$gz")" ] ||
  fail "upload: $gz is not in r2:$bucket/nightly/ after the copy"
rclone delete --min-age 30d "r2:$bucket/nightly/" ||
  fail "retention: rclone could not delete copies older than thirty days"

echo "promptfall backup: shipped r2:$bucket/nightly/$gz"
