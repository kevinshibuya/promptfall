#!/usr/bin/env bash
# Puts PREVIOUS_IMAGE back on the box, the way deploy.sh puts a release there. A second rollback
# rolls forward again. Same environment and flags as deploy.sh: see deploy/deploy.sh --help.
set -euo pipefail

exec "$(dirname "$0")/deploy.sh" --rollback "$@"
