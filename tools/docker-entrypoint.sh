#!/usr/bin/env bash
set -eu

install_state_file="node_modules/.install-state"
current_install_state="$(sha256sum package.json yarn.lock | sha256sum | awk '{ print $1 }')"
needs_install="false"

if [ ! -d node_modules ] || [ -z "$(ls -A node_modules 2>/dev/null)" ]; then
  needs_install="true"
elif [ ! -f "$install_state_file" ] || [ "$(cat "$install_state_file")" != "$current_install_state" ]; then
  needs_install="true"
fi

if [ "$needs_install" = "true" ]; then
  yarn install --frozen-lockfile
  printf '%s\n' "$current_install_state" > "$install_state_file"
fi

exec yarn start
