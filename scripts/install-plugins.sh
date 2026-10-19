#!/usr/bin/env bash
set -euo pipefail

if [[ -n ${PASEO_SOURCE_CHECKOUT_PATH:-} ]]; then
  checkout=$PASEO_SOURCE_CHECKOUT_PATH
else
  checkout=""
  while IFS= read -r line; do
    case $line in
      "worktree "*)
        checkout=${line#worktree }
        break
        ;;
    esac
  done < <(git worktree list --porcelain)
fi
if [[ -z $checkout ]]; then
  printf 'install-plugins: cannot resolve the source checkout\n' >&2
  exit 1
fi
checkout=$(cd -- "$checkout" && pwd -P)

branch=$(git -C "$checkout" symbolic-ref --quiet --short HEAD || true)
if [[ $branch != main ]]; then
  printf 'install-plugins: %s must be on main, found %s\n' "$checkout" "${branch:-detached HEAD}" >&2
  exit 1
fi

printf 'Fetching origin/main in %s\n' "$checkout"
git -C "$checkout" fetch --quiet origin main
before=$(git -C "$checkout" rev-parse HEAD)
git -C "$checkout" merge --ff-only --quiet origin/main
after=$(git -C "$checkout" rev-parse HEAD)
if [[ $before == "$after" ]]; then
  printf 'main is already at %s\n' "${after:0:12}"
else
  printf 'main updated %s..%s\n' "${before:0:12}" "$after"
fi

printf 'Installing dependencies with pnpm\n'
(cd "$checkout" && devenv shell -- pnpm install --frozen-lockfile)

paseo_bin=$(command -v paseo || true)
if [[ -z $paseo_bin ]]; then
  paseo_bin=$checkout/node_modules/.bin/paseo
fi
if [[ ! -x $paseo_bin ]]; then
  printf 'install-plugins: paseo CLI not found\n' >&2
  exit 1
fi
if ! command -v jq >/dev/null 2>&1; then
  printf 'install-plugins: jq not found\n' >&2
  exit 1
fi

is_installed() {
  local candidate=$1
  local installed=$2
  local id
  while IFS= read -r id; do
    [[ $id == "$candidate" ]] && return 0
  done <<<"$installed"
  return 1
}

installed_ids=$("$paseo_bin" plugin ls --json | jq -r '.[].id')
available_ids=()
available_paths=()
available_descriptions=()
shopt -s nullglob
for manifest in "$checkout"/plugins/*/paseo-plugin.json; do
  plugin_dir=${manifest%/paseo-plugin.json}
  manifest_fields=$(jq -r '[.id // "", .description // ""] | @tsv' "$manifest")
  id=${manifest_fields%%$'\t'*}
  description=${manifest_fields#*$'\t'}
  if [[ -z $id ]]; then
    printf 'Skipping %s: manifest has no id\n' "$manifest" >&2
    continue
  fi
  if is_installed "$id" "$installed_ids"; then
    continue
  fi
  available_ids+=("$id")
  available_paths+=("$plugin_dir")
  available_descriptions+=("$description")
done

if (( ${#available_ids[@]} == 0 )); then
  printf 'All plugins in %s are installed\n' "$checkout/plugins"
  exit 0
fi

printf 'Plugins in %s not installed:\n' "$checkout/plugins"
for index in "${!available_ids[@]}"; do
  if [[ -n ${available_descriptions[$index]} ]]; then
    printf '  %d) %s - %s\n' "$((index + 1))" "${available_ids[$index]}" "${available_descriptions[$index]}"
  else
    printf '  %d) %s\n' "$((index + 1))" "${available_ids[$index]}"
  fi
done

printf 'Select a plugin number (empty to cancel): '
selection=""
IFS= read -r selection || true
if [[ -z $selection ]]; then
  printf 'Cancelled\n'
  exit 0
fi
if [[ ! $selection =~ ^[1-9][0-9]*$ ]] || (( selection > ${#available_ids[@]} )); then
  printf 'install-plugins: invalid selection %s\n' "$selection" >&2
  exit 1
fi

index=$((selection - 1))
id=${available_ids[$index]}
path=${available_paths[$index]}
printf 'Installing %s (%s)\n' "$id" "$path"
if ! install_output=$("$paseo_bin" plugin install "$path" --json 2>&1); then
  printf '%s\n' "$install_output" >&2
  exit 1
fi

status=$("$paseo_bin" plugin ls "$id" --json | jq -r '.[0].status // "missing"')
if [[ $status != running ]]; then
  printf 'install-plugins: %s is %s after install\n' "$id" "$status" >&2
  exit 1
fi

printf 'Installed %s\n' "$id"
