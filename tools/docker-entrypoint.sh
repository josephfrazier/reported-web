#!/bin/sh
set -eu

if [ ! -d node_modules ] || [ -z "$(ls -A node_modules 2>/dev/null)" ]; then
  yarn install --frozen-lockfile
fi

exec yarn start
