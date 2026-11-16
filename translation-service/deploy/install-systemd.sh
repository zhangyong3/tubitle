#!/usr/bin/env bash
set -euo pipefail
cd -- "$(dirname -- "$0")/.."
if [[ "$EUID" != 0 || "$PWD" != /opt/tubitle-translation ]]; then
  echo 'Run as root from /opt/tubitle-translation/deploy/install-systemd.sh' >&2
  exit 1
fi
test -x .runtime/llama-server
test -s models/LMT-60-0.6B-Q4_K_M.gguf
if ! id tubitle >/dev/null 2>&1; then
  useradd --system --home-dir /opt/tubitle-translation --shell /usr/sbin/nologin tubitle
fi
mkdir -p .runtime results
chown -R tubitle:tubitle .runtime results
if [[ ! -f /etc/tubitle-translation.env ]]; then
  install -m 640 -o root -g tubitle /dev/null /etc/tubitle-translation.env
  cat > /etc/tubitle-translation.env <<'ENV'
TUBITLE_MODEL=niutrans
TUBITLE_PORT=18081
TUBITLE_BACKEND_PORT=18080
LLAMA_THREADS=4
LLAMA_PARALLEL=4
LLAMA_CTX=8192
LLAMA_GPU_LAYERS=0
ENV
fi
install -m 644 deploy/tubitle-translation.service deploy/tubitle-translation-health.service deploy/tubitle-translation-health.timer /etc/systemd/system/
install -m 755 deploy/tubitle-service.sh /usr/local/bin/tubitle-service
systemctl daemon-reload
systemctl enable --now tubitle-translation.service tubitle-translation-health.timer
