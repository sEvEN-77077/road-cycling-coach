#!/usr/bin/env bash
set -euo pipefail
umask 077
[[ "$(id -un)" == road-cycling ]] || { echo 'Run as the dedicated road-cycling user.' >&2; exit 1; }
state=/var/lib/road-cycling-coach
profile="$state/.hermes/profiles/road-cycling"
test -d "$profile"
cd /srv/road-cycling-coach
exec env -i PATH="$state/.local/bin:$state/node/bin:/usr/local/bin:/usr/bin:/bin" \
  HOME="$state" USER=road-cycling LOGNAME=road-cycling HERMES_HOME="$profile" TERM="${TERM:-dumb}" \
  "$state/.local/bin/hermes" "$@"
