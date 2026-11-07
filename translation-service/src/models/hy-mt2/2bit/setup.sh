#!/usr/bin/env bash
set -euo pipefail
cd -- "$(dirname -- "$0")/../../../.."

model=models/Hy-MT2-1.8B-2Bit.gguf
build=.runtime/q2-src/legacy
mkdir -p models "$build"
if [[ ! -f "$model" ]]; then
  curl -fsSL --retry 2 --connect-timeout 15 -C - -o "$model.part" \
    'https://huggingface.co/tencent/Hy-MT2-1.8B-2Bit-GGUF/resolve/edf68a9/Hy-MT2-1.8B-2Bit.gguf'
  printf '%s  %s\n' dcc33bbae9b28d923c8c76a64f6157840841d26f8774f3dfd770d5fabeeb1cd7 "$model.part" | shasum -a 256 -c -
  mv "$model.part" "$model"
else
  printf '%s  %s\n' dcc33bbae9b28d923c8c76a64f6157840841d26f8774f3dfd770d5fabeeb1cd7 "$model" | shasum -a 256 -c -
fi
if [[ -x "$build/build/bin/llama-server" ]]; then exit 0; fi
archive=.runtime/q2-src/llama-q2-legacy.tar.gz
if [[ ! -f "$build/CMakeLists.txt" ]]; then
  if [[ ! -f "$archive" ]]; then
    curl -fsSL --retry 2 --connect-timeout 15 -o "$archive.part" \
      'https://codeload.github.com/chaxu01/llama.cpp/tar.gz/92c448af6'
    mv "$archive.part" "$archive"
  fi
  tar -xzf "$archive" -C "$build" --strip-components=1
fi
kleidiai=OFF
case "$(uname -m)" in arm64|aarch64) kleidiai=ON ;; esac
cmake -S "$build" -B "$build/build" -DCMAKE_BUILD_TYPE=Release -DGGML_METAL=OFF -DGGML_CPU_KLEIDIAI="$kleidiai"
cmake --build "$build/build" --target llama-server --parallel "${BUILD_JOBS:-4}"
