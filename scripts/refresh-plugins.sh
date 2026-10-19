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
  printf 'refresh-plugins: cannot resolve the source checkout\n' >&2
  exit 1
fi
checkout=$(cd -- "$checkout" && pwd -P)

branch=$(git -C "$checkout" symbolic-ref --quiet --short HEAD || true)
if [[ $branch != main ]]; then
  printf 'refresh-plugins: %s must be on main, found %s\n' "$checkout" "${branch:-detached HEAD}" >&2
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

if ! git -C "$checkout" diff --quiet "$before" "$after" -- \
  pnpm-lock.yaml pnpm-workspace.yaml package.json ':(glob)plugins/*/package.json'; then
  printf 'Dependency manifests changed, installing with pnpm\n'
  (cd "$checkout" && devenv shell -- pnpm install --frozen-lockfile)
fi

paseo_bin=$(command -v paseo || true)
if [[ -z $paseo_bin ]]; then
  paseo_bin=$checkout/node_modules/.bin/paseo
fi
if [[ ! -x $paseo_bin ]]; then
  printf 'refresh-plugins: paseo CLI not found\n' >&2
  exit 1
fi
if ! command -v jq >/dev/null 2>&1; then
  printf 'refresh-plugins: jq not found\n' >&2
  exit 1
fi

plugins_root=$checkout/plugins/
listing=$("$paseo_bin" plugin ls --json)
plugin_ids=()
plugin_paths=()
disabled=()
while IFS=$'\t' read -r id enabled path; do
  [[ -n $id ]] || continue
  [[ $path == "$plugins_root"* ]] || continue
  if [[ $enabled == 1 ]]; then
    plugin_ids+=("$id")
    plugin_paths+=("$path")
  else
    disabled+=("$id")
  fi
done <<<"$(
  jq -r '.[] | select(.installation.identity.kind == "directory") | [.id, (if .enabled then 1 else 0 end), .installation.identity.path] | @tsv' <<<"$listing"
)"

if (( ${#disabled[@]} > 0 )); then
  for id in "${disabled[@]}"; do
    printf 'Skipping disabled plugin %s\n' "$id"
  done
fi

if (( ${#plugin_ids[@]} == 0 )); then
  printf 'No enabled directory plugins installed from %s\n' "$plugins_root"
  exit 0
fi

failed=()
for index in "${!plugin_ids[@]}"; do
  id=${plugin_ids[$index]}
  printf 'Reloading %s (%s)\n' "$id" "${plugin_paths[$index]}"
  if ! reload_output=$("$paseo_bin" plugin reload "$id" --json 2>&1); then
    printf '%s\n' "$reload_output" >&2
    failed+=("$id")
  fi
done

for id in "${plugin_ids[@]}"; do
  status=$("$paseo_bin" plugin ls "$id" --json | jq -r '.[0].status // "missing"')
  if [[ $status != running ]]; then
    printf 'refresh-plugins: %s is %s after reload\n' "$id" "$status" >&2
    failed+=("$id")
  fi
done

if (( ${#failed[@]} > 0 )); then
  printf 'refresh-plugins: failed to refresh %s\n' "${failed[*]}" >&2
  exit 1
fi

printf 'Refreshed %d plugin(s) from %s\n' "${#plugin_ids[@]}" "$after"
