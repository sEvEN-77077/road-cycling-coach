#!/usr/bin/env bash
set -euo pipefail
umask 077
[[ "$(id -un)" == road-cycling ]] || { echo 'Run as the dedicated road-cycling Linux user.' >&2; exit 1; }
state=/var/lib/road-cycling-coach
if [[ -e "$state/node" || -L "$state/node" ]]; then
  "$state/node/bin/node" --version
  exit
fi
case "$(uname -m)" in
  x86_64) arch=x64 ;;
  aarch64) arch=arm64 ;;
  *) echo 'Unsupported Node.js binary architecture.' >&2; exit 1 ;;
esac

temp="$(mktemp -d -- "$state/node-download.XXXXXXXX")"
trap 'rm -rf -- "$temp"' EXIT
cd "$temp"
download=(curl -fsSL --proto '=https' --proto-redir '=https' --retry 2 --connect-timeout 10 --max-time 120)
base=https://nodejs.org/dist
"${download[@]}" "$base/latest-v24.x/SHASUMS256.txt" -o SHASUMS256.txt
suffix="-linux-$arch.tar.gz"
awk -v suffix="$suffix" '
  $2 ~ /^node-v24\.[0-9]+\.[0-9]+-linux-/ &&
    substr($2, length($2) - length(suffix) + 1) == suffix { printf "%s  %s\n", $1, $2 }
' SHASUMS256.txt > selected.sha256
[[ "$(wc -l < selected.sha256)" -eq 1 ]]
read -r checksum archive < selected.sha256
[[ "$checksum" =~ ^[a-fA-F0-9]{64}$ && "$archive" =~ ^node-v24\.[0-9]+\.[0-9]+-linux-(x64|arm64)\.tar\.gz$ ]]
version="${archive#node-}"
version="${version%$suffix}"
"${download[@]}" "$base/$version/$archive" -o "$archive"
sha256sum --check --status selected.sha256
mkdir node
tar -xzf "$archive" --strip-components=1 -C node
node/bin/node --version
mv -T --no-clobber -- node "$state/node"
