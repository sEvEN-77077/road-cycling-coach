#!/usr/bin/env bash
set -euo pipefail
umask 077
[[ "$(id -un)" == road-cycling ]] || { echo 'Run as the dedicated road-cycling user.' >&2; exit 1; }
state=/var/lib/road-cycling-coach
root=/srv/road-cycling-coach
cd "$root"
exec env -i PATH="$state/node/bin:/usr/local/bin:/usr/bin:/bin" HOME="$state" USER=road-cycling \
  HERMES_HOME="$state/.hermes/profiles/road-cycling" \
  COACH_HERMES_LAUNCHER="$root/deploy/hermes.sh" \
  node --env-file-if-exists="$root/.env" "$root/deploy/hermes-entry.mjs" "$@"
