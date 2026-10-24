#!/usr/bin/env node
// Safe, deterministic entry point for running the projects' test tooling.
// The agent may run only this script, so it validates every argument, never
// uses a shell, strips secrets from the environment of the code under test,
// and prints a compact summary instead of raw tool output.
//
//   node .claude/skills/run-unit-tests/scripts/tests.mjs <command> --project <frontend|backend> [options] [files...]
//
// Commands:
//   run        Run the whole suite, or only the given test files. --repeat N reruns to detect flakiness.
//   coverage   Run the whole suite with coverage; report the given source files (default: candidates
//              from --manifest, or all files). Includes coverage of the PR's changed lines.
//   typecheck  Type-check the project, including test files.
//   format     Format the given test files with the project's formatter (frontend only).
//   lint       Check formatting of the given test files without writing.
// Options: --json (machine-readable output), --out <file> (also write JSON there),
//          --manifest <file> (change manifest from pr-change-analysis).
import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { AGENT_DIR, PROJECTS, isTestFile, normalize, projectOf } from '../../../lib/policy.mjs'
import { expandRanges, indexByRepoPath, summarizeFile, totals } from '../../../lib/coverage.mjs'

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..')
const TIMEOUT_MS = 10 * 60 * 1000
const MAX_FAILURES = 10
const MAX_MESSAGE_LINES = 25

// Only what the toolchains need. Notably absent: ANTHROPIC_*, GITHUB_TOKEN,
// ACTIONS_* and NODE_OPTIONS, so code under test cannot read or inject them.
const ENV_ALLOWLIST = ['PATH', 'HOME', 'USERPROFILE', 'TMPDIR', 'TEMP', 'TMP', 'LANG', 'LC_ALL', 'TZ', 'SystemRoot',
  'SYSTEMROOT', 'WINDIR', 'ComSpec', 'PATHEXT', 'APPDATA', 'LOCALAPPDATA', 'PROGRAMDATA']

export function sanitizedEnv(source = process.env) {
  const env = { CI: 'true', FORCE_COLOR: '0', NO_COLOR: '1', CHECKPOINT_DISABLE: '1' }
  for (const name of ENV_ALLOWLIST) if (source[name] !== undefined) env[name] = source[name]
  return env
}

export function parseArgs(argv) {
  const [command, ...rest] = argv
  const options = { command, files: [], json: false, repeat: 1 }
  for (let index = 0; index < rest.length; index++) {
    const arg = rest[index]
    const value = () => {
      const next = rest[++index]
      if (next === undefined || next.startsWith('--')) throw new UsageError(`${arg} requires a value`)
      return next
    }
    if (arg === '--project') options.project = value()
    else if (arg === '--json') options.json = true
    else if (arg === '--out') options.out = value()
    else if (arg === '--manifest') options.manifest = value()
    else if (arg === '--repeat') options.repeat = Number(value())
    else if (arg.startsWith('--')) throw new UsageError(`Unknown option ${arg}`)
    else options.files.push(arg)
  }
  if (!['run', 'coverage', 'typecheck', 'format', 'lint'].includes(command)) throw new UsageError(`Unknown command: ${command ?? '(none)'}`)
  if (!PROJECTS[options.project]) throw new UsageError('--project must be "frontend" or "backend"')
  if (!Number.isInteger(options.repeat) || options.repeat < 1 || options.repeat > 5) throw new UsageError('--repeat must be 1-5')
  options.files = options.files.map((file) => validateFile(file, options))
  return options
}

class UsageError extends Error {}

function validateFile(file, { command, project }) {
  // Accept repo-relative or project-relative paths.
  const candidates = [normalize(file, REPO_ROOT), normalize(path.join(PROJECTS[project].root, file), REPO_ROOT)]
  const resolved = candidates.find((candidate) => candidate && projectOf(candidate) === project && existsSync(path.join(REPO_ROOT, candidate)))
  if (!resolved) throw new UsageError(`Not an existing ${project} file: ${file}`)
  if (command !== 'coverage' && !isTestFile(resolved)) throw new UsageError(`Not a ${project} test file: ${file}`)
  if (command === 'coverage' && isTestFile(resolved)) throw new UsageError(`coverage takes source files, got a test file: ${file}`)
  return resolved
}

function binary(project, relative) {
  const file = path.join(REPO_ROOT, PROJECTS[project].root, 'node_modules', relative)
  if (!existsSync(file)) throw new UsageError(`Missing ${relative}; run "npm ci" in ${PROJECTS[project].root} first`)
  return file
}

function exec(project, args) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, args, {
      cwd: path.join(REPO_ROOT, PROJECTS[project].root),
      env: sanitizedEnv(),
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let output = ''
    child.stdout.on('data', (chunk) => { output += chunk })
    child.stderr.on('data', (chunk) => { output += chunk })
    const timer = setTimeout(() => child.kill('SIGKILL'), TIMEOUT_MS)
    child.on('close', (code, signal) => {
      clearTimeout(timer)
      resolve({ code: signal ? 124 : code, output, timedOut: signal === 'SIGKILL' })
    })
  })
}

const projectRelative = (project, file) => path.relative(PROJECTS[project].root, file).split(path.sep).join('/')

function trimMessage(message = '') {
  const clean = message.replace(/\x1b\[[0-9;]*m/g, '')
  const lines = clean.split('\n')
  return lines.length > MAX_MESSAGE_LINES ? [...lines.slice(0, MAX_MESSAGE_LINES), `… (${lines.length - MAX_MESSAGE_LINES} more lines)`].join('\n') : clean
}

export function summarizeResults(json) {
  const failures = []
  for (const file of json.testResults ?? []) {
    const relative = path.relative(REPO_ROOT, file.name).split(path.sep).join('/')
    const failedAssertions = (file.assertionResults ?? []).filter((test) => test.status === 'failed')
    for (const test of failedAssertions) failures.push({ file: relative, test: test.fullName, message: trimMessage(test.failureMessages?.join('\n')) })
    // A suite that fails to load (syntax/import error) has no assertion results.
    if (file.status === 'failed' && !failedAssertions.length) failures.push({ file: relative, test: '(suite failed to load)', message: trimMessage(file.message) })
  }
  return {
    files: json.numTotalTestSuites ?? 0,
    total: json.numTotalTests ?? 0,
    passed: json.numPassedTests ?? 0,
    failed: json.numFailedTests ?? 0,
    skipped: (json.numPendingTests ?? 0),
    todo: json.numTodoTests ?? 0,
    failures,
  }
}

async function runVitest(options, extraArgs = []) {
  const temp = mkdtempSync(path.join(os.tmpdir(), 'agent-tests-'))
  const resultsFile = path.join(temp, 'results.json')
  try {
    const args = [binary(options.project, 'vitest/vitest.mjs'), 'run', '--reporter=json', `--outputFile=${resultsFile}`,
      ...extraArgs(temp), ...options.files.map((file) => projectRelative(options.project, file))]
    const result = await exec(options.project, args)
    const json = existsSync(resultsFile) ? JSON.parse(readFileSync(resultsFile, 'utf8')) : null
    const coverageFile = path.join(temp, 'coverage', 'coverage-final.json')
    const coverage = existsSync(coverageFile) ? JSON.parse(readFileSync(coverageFile, 'utf8')) : null
    return { ...result, json, coverage }
  } finally {
    rmSync(temp, { recursive: true, force: true })
  }
}

function toolError(result) {
  return result.timedOut ? 'Timed out after 10 minutes.' : trimMessage(result.output.split('\n').slice(-40).join('\n'))
}

async function commandRun(options) {
  const runs = []
  for (let attempt = 1; attempt <= options.repeat; attempt++) {
    const result = await runVitest(options, () => [])
    if (!result.json) return { ok: false, error: toolError(result) }
    runs.push(summarizeResults(result.json))
  }
  const last = runs.at(-1)
  const outcomes = new Set(runs.map((run) => `${run.passed}/${run.failed}`))
  return { ok: runs.every((run) => run.failed === 0), ...last, runs: runs.length, flaky: outcomes.size > 1 }
}

function loadManifest(file) {
  if (!file) return null
  const resolved = normalize(file, REPO_ROOT)
  if (!resolved || !existsSync(path.join(REPO_ROOT, resolved))) throw new UsageError(`Manifest not found: ${file}`)
  return JSON.parse(readFileSync(path.join(REPO_ROOT, resolved), 'utf8'))
}

async function commandCoverage(options) {
  const manifest = loadManifest(options.manifest)
  const result = await runVitest({ ...options, files: [] }, (temp) => [
    '--coverage.enabled=true', '--coverage.reporter=json', `--coverage.reportsDirectory=${path.join(temp, 'coverage')}`,
  ])
  if (!result.json || !result.coverage) return { ok: false, error: toolError(result) }
  const tests = summarizeResults(result.json)
  const indexed = indexByRepoPath(result.coverage, path.join(REPO_ROOT, PROJECTS[options.project].root))
  const byRepoPath = Object.fromEntries(Object.entries(indexed).map(([file, data]) => [`${PROJECTS[options.project].root}/${file}`, data]))
  const manifestFiles = (manifest?.files ?? []).filter((file) => file.project === options.project && file.testable)
  const wanted = options.files.length ? options.files : manifestFiles.length ? manifestFiles.map((file) => file.path) : Object.keys(byRepoPath)
  const ranges = Object.fromEntries(manifestFiles.map((file) => [file.path, file.changedRanges]))
  const files = {}
  for (const file of wanted) {
    const data = byRepoPath[file]
    files[file] = data ? summarizeFile(data, ranges[file] ? expandRanges(ranges[file]) : null) : { missing: 'not instrumented (not imported by any test and outside coverage include)' }
  }
  // Threshold failures make vitest exit non-zero even when every test passes.
  return { ok: tests.failed === 0, thresholdsMet: result.code === 0 || tests.failed > 0, tests, totals: totals(byRepoPath), files }
}

async function commandTypecheck(options) {
  const result = await exec(options.project, [binary(options.project, 'typescript/bin/tsc'), '--noEmit', '-p', 'tsconfig.json'])
  const errors = result.output.split('\n').filter((line) => /error TS\d+/.test(line))
  return { ok: result.code === 0, errorCount: errors.length, errors: errors.slice(0, 30), ...(result.code !== 0 && !errors.length ? { error: toolError(result) } : {}) }
}

async function commandFormat(options, write) {
  if (options.project !== 'frontend') return { ok: true, note: 'backend has no formatter configured; match the surrounding style by hand' }
  if (!options.files.length) throw new UsageError('format/lint needs test files')
  const result = await exec(options.project, [binary(options.project, 'prettier/bin/prettier.cjs'), write ? '--write' : '--check',
    ...options.files.map((file) => projectRelative(options.project, file))])
  return { ok: result.code === 0, output: trimMessage(result.output) }
}

function render(command, report) {
  if (report.error) return `${command}: FAILED TO RUN\n${report.error}`
  if (command === 'run') {
    const head = `tests: ${report.passed} passed, ${report.failed} failed, ${report.skipped} skipped, ${report.todo} todo (${report.total} total in ${report.files} files)` +
      (report.runs > 1 ? ` — ${report.runs} runs, ${report.flaky ? 'FLAKY: results differed between runs' : 'stable'}` : '')
    const shown = report.failures.slice(0, MAX_FAILURES).map((failure) => `\n✗ ${failure.file} › ${failure.test}\n${failure.message}`)
    const more = report.failures.length > MAX_FAILURES ? `\n… ${report.failures.length - MAX_FAILURES} more failures` : ''
    return head + shown.join('\n') + more
  }
  if (command === 'coverage') {
    const lines = [`tests: ${report.tests.passed} passed, ${report.tests.failed} failed; project totals: ${report.totals.statements}% statements, ${report.totals.branches}% branches${report.thresholdsMet ? '' : ' — COVERAGE THRESHOLDS NOT MET'}`]
    for (const [file, summary] of Object.entries(report.files)) {
      if (summary.missing) { lines.push(`${file}: ${summary.missing}`); continue }
      const changed = summary.changedStatements ? ` | changed lines: ${summary.changedStatements.covered}/${summary.changedStatements.total} statements covered` : ''
      lines.push(`${file}: ${summary.statements}% stmts, ${summary.branches}% branches, ${summary.functions}% funcs${changed}` +
        (summary.uncoveredLines.length ? `\n  uncovered lines: ${summary.uncoveredLines.join(', ')}` : '') +
        (summary.uncoveredBranchLines.length ? `\n  uncovered branches at lines: ${summary.uncoveredBranchLines.join(', ')}` : ''))
    }
    for (const failure of report.tests.failures.slice(0, MAX_FAILURES)) lines.push(`✗ ${failure.file} › ${failure.test}\n${failure.message}`)
    return lines.join('\n')
  }
  if (command === 'typecheck') return report.ok ? 'typecheck: ok' : `typecheck: ${report.errorCount} errors\n${report.errors.join('\n')}${report.error ?? ''}`
  return report.note ?? (report.ok ? `${command}: ok` : `${command}: issues found\n${report.output}`)
}

export async function main(argv) {
  let options
  try {
    options = parseArgs(argv)
  } catch (error) {
    if (!(error instanceof UsageError)) throw error
    console.error(`usage error: ${error.message}`)
    return 2
  }
  try {
    const handlers = {
      run: commandRun,
      coverage: commandCoverage,
      typecheck: commandTypecheck,
      format: (opts) => commandFormat(opts, true),
      lint: (opts) => commandFormat(opts, false),
    }
    const report = await handlers[options.command](options)
    const json = JSON.stringify({ command: options.command, project: options.project, ...report }, null, 2)
    if (options.out) {
      const out = normalize(options.out, REPO_ROOT)
      if (!out?.startsWith(`${AGENT_DIR}/`)) throw new UsageError(`--out must be inside ${AGENT_DIR}/`)
      mkdirSync(path.dirname(path.join(REPO_ROOT, out)), { recursive: true })
      writeFileSync(path.join(REPO_ROOT, out), json)
    }
    console.log(options.json ? json : render(options.command, report))
    return report.ok ? 0 : 1
  } catch (error) {
    if (!(error instanceof UsageError)) throw error
    console.error(`usage error: ${error.message}`)
    return 2
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await main(process.argv.slice(2))
}
