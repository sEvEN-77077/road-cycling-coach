#!/usr/bin/env bash
set -euo pipefail
umask 077
[[ "$(id -u)" == 0 ]] || { echo 'Run via sudo.' >&2; exit 1; }
if [[ "$#" -lt 1 || "$#" -gt 2 || "$1" != /* ]]; then
  echo 'Usage: backup.sh /absolute/private.tar.gz [hermes|openclaw]' >&2
  exit 1
fi
for service in road-cycling-web road-cycling-hermes road-cycling-reminders road-cycling-coach; do
  if systemctl is-active --quiet "$service.service"; then
    echo "Stop $service.service before taking a consistent backup." >&2
    exit 1
  fi
done
state=var/lib/road-cycling-coach
case "${2:-openclaw}" in
  hermes) binding="$state/.hermes/profiles/road-cycling" ;;
  openclaw) binding="$state/openclaw" ;;
  *) echo 'Expected hermes or openclaw.' >&2; exit 1 ;;
esac
set -o noclobber
tar -czf - -C / "$binding" "$state/data" srv/road-cycling-coach/.env > "$1"
