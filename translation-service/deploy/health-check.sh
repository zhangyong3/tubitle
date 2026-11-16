#!/usr/bin/env bash
set -euo pipefail
unit=tubitle-translation.service
# An intentional stop must stay stopped.
if ! systemctl is-active --quiet "$unit"; then exit 0; fi
state=/var/lib/tubitle-translation-health
mkdir -p "$state"
if curl -fsS --max-time 5 http://127.0.0.1:18081/health >/dev/null; then
  rm -f "$state/failures"
  exit 0
fi
failures=0
if [[ -f "$state/failures" ]]; then read -r failures < "$state/failures"; fi
failures=$((failures+1))
echo "$failures" > "$state/failures"
echo "Tubitle health check failed ($failures consecutive failures)" >&2
if (( failures >= 3 )); then
  rm -f "$state/failures"
  echo 'Restarting Tubitle after three failed health checks' >&2
  systemctl restart "$unit"
fi
