#!/usr/bin/env bash
set -euo pipefail
umask 077
[[ "$(id -un)" == road-cycling ]] || { echo 'Run as the dedicated road-cycling user.' >&2; exit 1; }
state=/var/lib/road-cycling-coach
root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
binary="$state/.local/bin/hermes"
profile="$state/.hermes/profiles/road-cycling"
test -x "$binary"
if [[ ! -d "$profile" ]]; then
  env -i PATH="$state/.local/bin:$state/node/bin:/usr/local/bin:/usr/bin:/bin" \
    HOME="$state" USER=road-cycling LOGNAME=road-cycling "$binary" profile create road-cycling --no-credentials
fi
test -d "$profile"
plugin="$profile/plugins/road-cycling-coach"
install -d -m 700 "$plugin"
install -m 600 "$root/deploy/hermes-plugin/plugin.yaml" "$root/deploy/hermes-plugin/__init__.py" "$plugin/"
if [[ ! -e "$root/.env" ]]; then
  install -m 600 "$root/.env.example" "$root/.env"
  sed -i "s|^COACH_DB=.*|COACH_DB=$state/data/coach.sqlite|" "$root/.env"
fi
bash "$root/deploy/hermes.sh" plugins enable road-cycling-coach
bash "$root/deploy/hermes.sh" config set gateway.standalone true
bash "$root/deploy/hermes.sh" config set plugins.hook_callback_timeout 15
