#!/usr/bin/env bash
# A release onto the box, run from the laptop over ssh. deploy/rollback.sh runs this with --rollback.
set -euo pipefail

usage() {
  cat <<'USAGE'
usage: deploy/deploy.sh [--dry-run] <tag>
       deploy/rollback.sh [--dry-run]

Deploys the image tagged <tag> to the box over ssh: pulls it, writes IMAGE and PREVIOUS_IMAGE in
the project's .env, brings the compose project up and polls /v1/health. A failed deploy says how
to roll back. The rollback swaps PREVIOUS_IMAGE back in the same way.

  PROMPTFALL_BOX     the box's ssh destination (user@host or an ssh config alias), set in your
                     shell and never in the repo; a real run refuses without it
  PROMPTFALL_DIR     the project's directory on the box (default ~/apps/promptfall)
  PROMPTFALL_IMAGE   the image repository (default ghcr.io/kevinshibuya/promptfall)
  --dry-run          print the exact commands without connecting
  -h, --help         print this and exit
USAGE
}

fail() {
  echo "deploy: $*" >&2
  exit 2
}

mode=deploy
dry=0
tag=
while [ $# -gt 0 ]; do
  case $1 in
    -h | --help)
      usage
      exit 0
      ;;
    --dry-run) dry=1 ;;
    --rollback) mode=rollback ;;
    -*) fail "unknown option $1 (see --help)" ;;
    *)
      [ -z "$tag" ] || fail "one tag only (see --help)"
      tag=$1
      ;;
  esac
  shift
done

dir=${PROMPTFALL_DIR:-'~/apps/promptfall'}
repo=${PROMPTFALL_IMAGE:-ghcr.io/kevinshibuya/promptfall}
# Everything below travels on the ssh command line, so each value is plain.
safe='^[A-Za-z0-9._/:~@-]+$'
[[ $dir =~ $safe ]] || fail "PROMPTFALL_DIR has characters a path here does not need: $dir"
[[ $repo =~ $safe ]] || fail "PROMPTFALL_IMAGE has characters an image name does not need: $repo"
if [ "$mode" = deploy ]; then
  [ -n "$tag" ] || fail "which tag? (see --help)"
  [[ $tag =~ ^[A-Za-z0-9._-]+$ ]] || fail "a tag is letters, digits, dots, dashes and underscores: $tag"
  image="$repo:$tag"
else
  [ -z "$tag" ] || fail "a rollback takes no tag: it swaps PREVIOUS_IMAGE back"
  image=-
fi

# Runs on the box: bash -s -- <mode> <dir> <image>.
read -r -d '' remote <<'REMOTE' || true
set -euo pipefail
mode=$1
cd "$2"
image=$3
current=$(sed -n 's/^IMAGE=//p' .env)
previous=$(sed -n 's/^PREVIOUS_IMAGE=//p' .env)
if [ "$mode" = rollback ]; then
  [ -n "$previous" ] || { echo "deploy: no PREVIOUS_IMAGE in .env to roll back to" >&2; exit 1; }
  image=$previous
  previous=$current
elif [ "$image" != "$current" ]; then
  # A redeploy of the running tag keeps the rollback target it had.
  previous=${current:-$image}
fi
docker pull "$image"
tmp=$(mktemp .env.XXXXXX)
grep -v -e '^IMAGE=' -e '^PREVIOUS_IMAGE=' .env >"$tmp" || true
printf 'IMAGE=%s\nPREVIOUS_IMAGE=%s\n' "$image" "$previous" >>"$tmp"
chmod 600 "$tmp"
mv "$tmp" .env
echo "deploy: IMAGE=$image PREVIOUS_IMAGE=$previous"
docker compose up --detach --remove-orphans
for _ in $(seq 1 30); do
  if docker compose exec -T promptfall node -e "fetch('http://127.0.0.1:7777/v1/health').then((r) => r.text().then((t) => { console.log(t); process.exit(r.ok ? 0 : 1) }), () => process.exit(1))"; then
    echo "deploy: $image is healthy"
    exit 0
  fi
  sleep 2
done
echo "deploy: $image did not answer /v1/health within 60 s" >&2
docker compose logs --tail 50 promptfall >&2 || true
exit 1
REMOTE

box=${PROMPTFALL_BOX:-}
if [ "$dry" = 1 ]; then
  echo "ssh ${box:-\$PROMPTFALL_BOX} bash -s -- $mode $dir $image <<'REMOTE'"
  printf '%s\n' "$remote"
  echo "REMOTE"
  exit 0
fi
[ -n "$box" ] || fail "PROMPTFALL_BOX is not set: export the box's ssh destination in your shell (never in the repo)"

if ssh "$box" bash -s -- "$mode" "$dir" "$image" <<<"$remote"; then
  exit 0
fi
if [ "$mode" = deploy ]; then
  echo "deploy: $image failed on the box; to put the previous image back: deploy/rollback.sh" >&2
else
  echo "deploy: the rollback failed on the box; ssh $box and read docker compose logs in $dir" >&2
fi
exit 1
