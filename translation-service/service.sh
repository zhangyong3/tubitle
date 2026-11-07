#!/usr/bin/env bash
set -euo pipefail
cd -- "$(dirname -- "$0")"
exec node src/runtime/service.mjs "$@"
