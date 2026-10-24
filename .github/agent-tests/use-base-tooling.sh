#!/usr/bin/env bash
# Replaces the agent definition, skills, hooks and CI scripts in the PR checkout
# with the base branch versions, so a pull request cannot change how its own
# tests are generated, validated or verified. The index stays at the PR head.
# On the PR that introduces the tooling the base has none, so the PR's own
# version is used (bootstrap).
set -euo pipefail

base="$1"
paths=(.claude .github/agent-tests)

if git cat-file -e "${base}:.claude/agents/test-engineer.md" 2>/dev/null; then
  rm -rf "${paths[@]}"
  git checkout "$base" -- "${paths[@]}"
  git reset -q -- "${paths[@]}"
  echo "Agent tooling taken from base ${base}."
  if ! git diff --quiet "$base" HEAD -- "${paths[@]}"; then
    echo "::notice title=Agent tooling::This PR changes agent tooling; the changes take effect only after merge."
  fi
else
  echo "::notice title=Agent tooling::The base branch has no agent tooling yet; using this PR's version (bootstrap)."
fi
