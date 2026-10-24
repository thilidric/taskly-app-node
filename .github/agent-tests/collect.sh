#!/usr/bin/env bash
# Runs after the agent in the generate job: turns its working-tree changes into
# a patch, then validates the patch and the report with the trusted tooling.
# Everything lands in .agent/out for upload. Never fails the job by itself;
# the verify and publish jobs decide what the results mean.
set -uo pipefail

out=.agent/out
plan="${RUNNER_TEMP:?}/plan/change-manifest.json"   # pristine copy; the agent can write to .agent/
tooling="${RUNNER_TEMP}/tooling"
mkdir -p "$out" "$tooling"

# Keep a copy of the trusted tooling before the overlay is undone.
cp -r .claude .github "$tooling/"

# Restore the PR's own tooling so the base-branch overlay is not part of the diff.
for path in .claude .github/agent-tests; do
  rm -rf "$path"
  git checkout HEAD -- "$path" 2>/dev/null || true
done

# Every change outside .agent/ goes into the patch; the validator rejects anything that is not a test.
git add -A -- . ':(exclude).agent'
git diff --cached --binary --no-color HEAD > "$out/agent.patch"
git reset -q

[ -f .agent/report.json ] && cp .agent/report.json "$out/report.json"
[ -f .agent/transcript.jsonl ] && cp .agent/transcript.jsonl "$out/transcript.jsonl"

node "$tooling/.github/agent-tests/validate-patch.mjs" "$out/agent.patch" --out "$out/patch-check.generate.json"
node "$tooling/.github/agent-tests/validate-report.mjs" --report "$out/report.json" --manifest "$plan" \
  --patch-check "$out/patch-check.generate.json" --out "$out/report-check.json"
node "$tooling/.github/agent-tests/summarize-transcript.mjs" "$out/transcript.jsonl" --out "$out/transcript-summary.json" > /dev/null
exit 0
