#!/usr/bin/env bash
# Sourced by setup scripts after changing to the service root.
download() {
  local destination=$1 url=$2 digest=${3:-}
  mkdir -p "$(dirname -- "$destination")"
  if [[ ! -s "$destination" ]]; then
    curl -fL --retry 3 --connect-timeout 15 -C - -o "$destination.part" "$url"
    if [[ -n "$digest" ]]; then
      printf '%s  %s\n' "$digest" "$destination.part" | shasum -a 256 -c -
    fi
    mv "$destination.part" "$destination"
  elif [[ -n "$digest" ]]; then
    printf '%s  %s\n' "$digest" "$destination" | shasum -a 256 -c -
  fi
}
