#!/usr/bin/env bash
# The deploy smoke: bundles the host, builds its image, brings deploy/'s compose project up with
# a throwaway env and network, and waits up to 60 s for the health route. Exits non-zero on a
# failure or the timeout. Needs a running Docker daemon and, on a cold cache, the network for the
# base image.
set -euo pipefail

root=$(cd "$(dirname "$0")/.." && pwd)
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

# The box's names stay in the compose file; the smoke runs beside them under its own.
cat >"$tmp/override.yml" <<YAML
services:
  promptfall:
    container_name: $id
networks:
  web:
    name: $id
YAML

compose up --detach --wait --wait-timeout 60
compose exec -T promptfall node -e \
  "fetch('http://127.0.0.1:7777/v1/health').then((r) => r.text()).then((t) => console.log(t))"
echo "smoke: healthy"
