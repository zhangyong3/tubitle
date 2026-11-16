#!/usr/bin/env bash
set -euo pipefail
unit=tubitle-translation.service
action=${1:-status}
case "$action" in
  start|stop|restart|status) exec systemctl "$action" "$unit" ;;
  logs) exec journalctl -u "$unit" -n 100 --no-pager ;;
  model)
    case "${2:-}" in
      niutrans|q4) ;;
      *) echo 'Usage: tubitle-service model niutrans|q4' >&2; exit 1 ;;
    esac
    sed -i "s/^TUBITLE_MODEL=.*/TUBITLE_MODEL=$2/" /etc/tubitle-translation.env
    systemctl restart "$unit"
    curl -fsS --max-time 5 http://127.0.0.1:18081/health
    echo
    ;;
  health) exec curl -fsS --max-time 5 http://127.0.0.1:18081/health ;;
  *) echo 'Usage: tubitle-service start|stop|restart|status|logs|health|model niutrans|q4' >&2; exit 1 ;;
esac
