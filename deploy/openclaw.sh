#!/usr/bin/env bash
set -euo pipefail
umask 077
root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root"
[[ "$(id -un)" == road-cycling ]] || { echo 'Run as the dedicated road-cycling Linux user.' >&2; exit 1; }
state=/var/lib/road-cycling-coach
script="$state/runtime/node_modules/.bin/openclaw"
if [[ "${1:-}" == coach ]]; then
  shift
  script="$root/src/cli.mjs"
fi
exec env -i PATH="$state/node/bin:/usr/local/bin:/usr/bin:/bin" HOME="$state" USER=road-cycling LOGNAME=road-cycling \
  TERM="${TERM:-dumb}" \
  OPENCLAW_STATE_DIR="$state/openclaw" OPENCLAW_CONFIG_PATH="$state/openclaw/openclaw.json" \
  node --env-file-if-exists="$root/.env" "$script" "$@"
