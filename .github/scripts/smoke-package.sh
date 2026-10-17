#!/usr/bin/env bash
set -euo pipefail

repo_dir="$PWD"
smoke_dir="$(mktemp -d)"
cleanup() {
  cd "$repo_dir"
  rm -rf "$smoke_dir"
}
trap cleanup EXIT

expected_version="$(node -p 'require("./package.json").version')"
package_file="$(npm pack --pack-destination "$smoke_dir" --silent)"
npm install --prefix "$smoke_dir/install" --ignore-scripts --no-audit --no-fund "$smoke_dir/$package_file"

# Run the installed command shims outside the checkout, without access to src or dist there.
cd "$smoke_dir/install"
for bin in scu skills-check-updates; do
  help="$("./node_modules/.bin/$bin" --help)"
  [[ "$help" == *"Usage: scu"* ]]
  [[ "$("./node_modules/.bin/$bin" --version)" == "$expected_version" ]]
  printf '%s: help and version OK\n' "$bin"
done
