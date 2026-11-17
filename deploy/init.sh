#!/usr/bin/env bash
set -euo pipefail
umask 077
root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root"
[[ "$(id -un)" == road-cycling ]] || { echo 'Run as the dedicated road-cycling Linux user.' >&2; exit 1; }
state=/var/lib/road-cycling-coach
export PATH="$state/node/bin:/usr/local/bin:/usr/bin:/bin"
node -e 'if (+process.versions.node.split(".")[0] < 24) process.exit(1)'
claw=(bash deploy/openclaw.sh)
mkdir -p "$state/openclaw" "$state/runtime" "$state/data" "$state/workspace"
npm install --prefix "$state/runtime" --save-exact openclaw@2026.11.4
if [[ ! -e .env ]]; then
  cp .env.example .env
  sed -i "s|^COACH_DB=.*|COACH_DB=$state/data/coach.sqlite|" .env
  token="$(node -p 'require("node:crypto").randomBytes(32).toString("hex")')"
  printf '\nOPENCLAW_GATEWAY_TOKEN=%s\n' "$token" >> .env
fi
chmod 600 .env
"${claw[@]}" config set gateway.mode local
"${claw[@]}" config set gateway.bind loopback
"${claw[@]}" config set gateway.port 18796 --strict-json
"${claw[@]}" config set gateway.auth.mode token
"${claw[@]}" config set gateway.controlUi.enabled false --strict-json
"${claw[@]}" config set agents.defaults.workspace "$state/workspace"
"${claw[@]}" config set agents.defaults.skipBootstrap true --strict-json
"${claw[@]}" config set tools.profile minimal
"${claw[@]}" config set session.dmScope per-account-channel-peer
"${claw[@]}" plugins install '@tencent-weixin/openclaw-weixin@2.4.10' --pin
# This links the checked-out coach source from the dedicated project directory.
"${claw[@]}" plugins install "$root" --link --force --accept-capabilities
"${claw[@]}" config set plugins.allow '["openclaw-weixin","road-cycling-coach"]' --strict-json
"${claw[@]}" config set plugins.entries.openclaw-weixin.enabled true --strict-json
"${claw[@]}" config set plugins.entries.road-cycling-coach.enabled true --strict-json
"${claw[@]}" config set 'channels.openclaw-weixin.quoteCache.enabled' false --strict-json
"${claw[@]}" plugins list
