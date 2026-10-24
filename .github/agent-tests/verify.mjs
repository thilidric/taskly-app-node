#!/usr/bin/env node
// Independently verifies the agent's (already validated) patch in a job that has
// no secrets: baseline coverage on the PR head, then apply the patch and run
// typecheck, format check, a 3x stability run of the changed test files, the
// full suite and coverage again. Nothing the agent claimed is trusted.
//
//   node .github/agent-tests/verify.mjs --patch <file> --patch-check <json> --manifest <json> --out <json>
import { execFileSync, spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { projectOf } from '../../.claude/lib/policy.mjs'

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const RUNNER = path.join(REPO_ROOT, '.claude/skills/run-unit-tests/scripts/tests.mjs')

function tests(command, project, ...args) {
  const out = `.agent/verify/${command}-${project}-${Date.now()}.json`
  const result = spawnSync(process.execPath, [RUNNER, command, '--project', project, '--out', out, ...args], { cwd: REPO_ROOT, encoding: 'utf8' })
  const file = path.join(REPO_ROOT, out)
  if (!existsSync(file)) return { ok: false, error: (result.stderr || result.stdout).slice(-2000) }
  return JSON.parse(readFileSync(file, 'utf8'))
}

const coverageView = (report) => (report.ok === undefined || report.error ? { error: report.error } : {
  ok: report.ok,
  thresholdsMet: report.thresholdsMet,
  totals: report.totals,
  tests: { passed: report.tests.passed, failed: report.tests.failed, skipped: report.tests.skipped, todo: report.tests.todo, total: report.tests.total },
  failures: report.tests.failures.slice(0, 10),
  files: report.files,
})

export function decideStatus(projects, empty) {
  const problems = []
  for (const [name, project] of Object.entries(projects)) {
    const { after } = project
    if (after.coverage.error) problems.push(`${name}: test run failed to start`)
    else {
      if (after.coverage.tests.failed > 0) problems.push(`${name}: ${after.coverage.tests.failed} failing tests`)
      if (!after.coverage.thresholdsMet) problems.push(`${name}: coverage thresholds not met`)
    }
    if (after.typecheck && !after.typecheck.ok) problems.push(`${name}: typecheck failed`)
    if (after.lint && !after.lint.ok) problems.push(`${name}: formatting check failed`)
    if (after.stability && (!after.stability.ok || after.stability.flaky)) problems.push(`${name}: changed tests are not stable across 3 runs`)
  }
  return { status: empty ? 'no-changes' : problems.length ? 'failed' : 'passed', problems }
}

function main() {
  const args = Object.fromEntries(process.argv.slice(2).reduce((pairs, arg, index, all) => (index % 2 ? pairs : [...pairs, [arg.slice(2), all[index + 1]]]), []))
  const manifest = JSON.parse(readFileSync(args.manifest, 'utf8'))
  const patchCheck = JSON.parse(readFileSync(args['patch-check'], 'utf8'))
  if (!patchCheck.ok) throw new Error('refusing to verify a patch that failed validation')
  const changedTests = patchCheck.files.filter((file) => file.status !== 'deleted').map((file) => file.path)
  const names = [...new Set([...manifest.summary.projects, ...patchCheck.files.map((file) => projectOf(file.path))])].filter(Boolean)
  // The test runner only reads manifests inside the repository.
  mkdirSync(path.join(REPO_ROOT, '.agent/verify'), { recursive: true })
  copyFileSync(args.manifest, path.join(REPO_ROOT, '.agent/verify/change-manifest.json'))
  const manifestArg = ['--manifest', '.agent/verify/change-manifest.json']

  const projects = {}
  for (const name of names) projects[name] = { before: { coverage: coverageView(tests('coverage', name, ...manifestArg)) } }

  if (!patchCheck.empty) execFileSync('git', ['apply', '--whitespace=nowarn', path.resolve(args.patch)], { cwd: REPO_ROOT, stdio: 'inherit' })

  for (const name of names) {
    const own = changedTests.filter((file) => projectOf(file) === name)
    const runnable = own.filter((file) => /\.test\.tsx?$/.test(file))
    const after = {}
    if (!patchCheck.empty) {
      after.typecheck = tests('typecheck', name)
      if (name === 'frontend' && own.length) after.lint = tests('lint', name, ...own)
      if (runnable.length) after.stability = tests('run', name, '--repeat', '3', ...runnable)
      after.coverage = coverageView(tests('coverage', name, ...manifestArg))
    } else after.coverage = projects[name].before.coverage
    projects[name].after = after
    const before = projects[name].before.coverage.tests?.total ?? 0
    const total = after.coverage.tests?.total ?? 0
    projects[name].testDelta = total - before
  }

  const { status, problems } = decideStatus(projects, patchCheck.empty)
  const result = { status, problems, changedTests, projects }
  writeFileSync(args.out, JSON.stringify(result, null, 2))
  console.log(`verification ${status}${problems.length ? `: ${problems.join('; ')}` : ''}`)
  for (const problem of problems) console.log(`::error title=Agent tests verification::${problem}`)
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main()
