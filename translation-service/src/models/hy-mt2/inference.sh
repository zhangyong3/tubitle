#!/usr/bin/env bash
set -euo pipefail
cd -- "$(dirname -- "$0")/../../.."
server=${LLAMA_SERVER:-llama-server}
if [[ -z "${LLAMA_SERVER:-}" && -x .runtime/llama-server ]]; then
  server=./.runtime/llama-server
fi
model=${MODEL_PATH:-models/Hy-MT2-1.8B-Q4_K_M.gguf}
if [[ ! -f "$model" ]]; then
  echo "Missing $model. Run bash service.sh setup <model> first." >&2
  exit 1
fi
exec "$server" --model "$model" --alias "${LLAMA_MODEL_ALIAS:-hy-mt2-1.8b-q4}" \
  --host 127.0.0.1 --port "${LLAMA_PORT:-18080}" --jinja --no-webui \
  --ctx-size "${LLAMA_CTX:-8192}" --parallel "${LLAMA_PARALLEL:-4}" \
  --threads "${LLAMA_THREADS:-8}" --n-gpu-layers "${LLAMA_GPU_LAYERS:-auto}"
