#!/usr/bin/env bash
set -euo pipefail

cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.."

if [[ ! -f .git ]]; then
  printf '%s\n' "Teardown must run in a linked Git worktree." >&2
  exit 1
fi

rm -rf -- node_modules .devenv .direnv

if [[ -d plugins && ! -L plugins ]]; then
  for plugin_directory in plugins/*; do
    if [[ -d "$plugin_directory" && ! -L "$plugin_directory" ]]; then
      rm -rf -- "$plugin_directory/node_modules"
    fi
  done
fi
