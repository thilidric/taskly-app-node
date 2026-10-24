#!/usr/bin/env bash
# Installs dependencies of the affected projects without npm lifecycle scripts
# (a compromised dependency cannot run code at install time), then generates
# the Prisma client explicitly for the backend.
#   install.sh '["frontend","backend"]'
set -euo pipefail

projects="$1"
for project in frontend backend; do
  if [[ "$projects" == *"\"${project}\""* ]]; then
    echo "::group::npm ci (${project})"
    npm ci --prefix "$project" --ignore-scripts --no-audit --no-fund
    echo "::endgroup::"
  fi
done

if [[ "$projects" == *'"backend"'* ]]; then
  (cd backend && node node_modules/prisma/build/index.js generate)
fi
