#!/usr/bin/env bash
set -euo pipefail
cd -- "$(dirname -- "$0")/../../.."
source src/models/download.sh
if [[ -x .runtime/llama-server ]] || command -v llama-server >/dev/null; then exit 0; fi
if [[ "$(uname -s)/$(uname -m)" != Darwin/arm64 ]]; then
  echo "Install llama-server from https://github.com/ggml-org/llama.cpp/releases (tested: b12140) and rerun." >&2
  exit 1
fi
release=b12140
archive=".runtime/llama-${release}-macos-arm64.tar.gz"
download "$archive" "https://github.com/ggml-org/llama.cpp/releases/download/$release/llama-$release-bin-macos-arm64.tar.gz"
tar -xzf "$archive" -C .runtime --strip-components=1
test -x .runtime/llama-server
