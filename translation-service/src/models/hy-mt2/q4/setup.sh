#!/usr/bin/env bash
set -euo pipefail
cd -- "$(dirname -- "$0")/../../../.."
release=b12140
model=Hy-MT2-1.8B-Q4_K_M.gguf
digest=dc5f44fcf1fa496ee7ad725982c0c8c553a4de00259b53af84c4b89fb0c06699
mkdir -p models .runtime
if [[ ! -f "models/$model" ]]; then
  curl -fL --retry 2 --connect-timeout 15 -C - -o "models/$model.part" \
    "https://huggingface.co/tencent/Hy-MT2-1.8B-GGUF/resolve/b27182d/$model"
  printf '%s  %s\n' "$digest" "models/$model.part" | shasum -a 256 -c -
  mv "models/$model.part" "models/$model"
else
  printf '%s  %s\n' "$digest" "models/$model" | shasum -a 256 -c -
fi
if [[ -x .runtime/llama-server ]] || command -v llama-server >/dev/null; then
  exit 0
fi
if [[ "$(uname -s)/$(uname -m)" != Darwin/arm64 ]]; then
  echo "Install llama-server from https://github.com/ggml-org/llama.cpp/releases and rerun." >&2
  exit 1
fi
archive=".runtime/llama-${release}-macos-arm64.tar.gz"
if [[ ! -f "$archive" ]]; then
  curl -fL --retry 2 --connect-timeout 15 -o "$archive.part" \
    "https://github.com/ggml-org/llama.cpp/releases/download/$release/llama-$release-bin-macos-arm64.tar.gz"
  mv "$archive.part" "$archive"
fi
tar -xzf "$archive" -C .runtime --strip-components=1
test -x .runtime/llama-server
