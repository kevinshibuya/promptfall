#!/usr/bin/env bash
# The deploy smoke, two ways.
#   deploy/smoke.sh        bundles the host, builds its image, brings deploy/'s compose project up
#                          with a throwaway env and network, waits up to 60 s for health, then runs
#                          the smoke by URL against it. Needs a running Docker daemon and, on a
#                          cold cache, the network for the base image.
#   deploy/smoke.sh <url>  the smoke by URL alone: health, a bootstrap, one batch, one world poll.
#                          Each run mints one account on that server.
# Both exit non-zero on the first failure. Both need the repo's pnpm install.
set -euo pipefail

root=$(cd "$(dirname "$0")/.." && pwd)

by_url() {
  pnpm --silent --dir "$root/servers/fake" exec tsx src/smoke-url.ts "$1"
}

case ${1:-} in
  -h | --help)
    sed -n '2,9s/^# \{0,1\}//p' "$0"
    echo "usage: deploy/smoke.sh [url]"
    exit 0
    ;;
  -*)
    echo "smoke: unknown option $1 (see --help)" >&2
    exit 2
    ;;
  ?*)
    by_url "$1"
    exit 0
    ;;
esac

id="promptfall-smoke-$$"
image="$id:local"
tmp=$(mktemp -d)

compose() {
  docker compose -p "$id" \
    -f "$root/deploy/docker-compose.yml" -f "$tmp/override.yml" \
    --env-file "$tmp/.env" "$@"
}

cleanup() {
  status=$?
  if [ -f "$tmp/override.yml" ]; then
    if [ "$status" -ne 0 ]; then compose logs --no-color || true; fi
    compose down --volumes --remove-orphans >/dev/null 2>&1 || true
  fi
  docker network rm "$id" >/dev/null 2>&1 || true
  docker image rm "$image" >/dev/null 2>&1 || true
  rm -rf "$tmp"
  exit "$status"
}
trap cleanup EXIT

pnpm --dir "$root" build:server
docker build --quiet --tag "$image" "$root/servers/fake"
docker network create "$id" >/dev/null

cat >"$tmp/.env" <<ENV
IMAGE=$image
PREVIOUS_IMAGE=$image
PROMPTFALL_BOTS=2
PROMPTFALL_GITHUB_CLIENT_ID=smoke
PROMPTFALL_ADMIN_TOKEN=smoke-$$
ENV

# The box's names stay in the compose file; the smoke runs beside them under its own, with the
# port published on loopback so the smoke by URL can reach it.
cat >"$tmp/override.yml" <<YAML
services:
  promptfall:
    container_name: $id
    ports:
      - "127.0.0.1::7777"
networks:
  web:
    name: $id
YAML

compose up --detach --wait --wait-timeout 60
address=$(compose port promptfall 7777)
by_url "http://$address"
echo "smoke: healthy at $address"
