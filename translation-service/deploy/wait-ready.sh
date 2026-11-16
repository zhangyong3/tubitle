#!/usr/bin/env bash
set -euo pipefail
for ((attempt=0; attempt<90; attempt++)); do
  if curl -fsS --max-time 2 "http://127.0.0.1:${TUBITLE_PORT:-18081}/health" >/dev/null; then exit 0; fi
  sleep 1
done
echo 'Tubitle did not become ready within 90 seconds' >&2
exit 1
