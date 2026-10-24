#!/usr/bin/env node
// Builds the change manifest the test agent works from: which files a PR
// changed, which of them are testable source files, which lines changed, and
// which existing tests already exercise them. Deterministic, no LLM involved.
//
//   node .claude/skills/pr-change-analysis/scripts/analyze-changes.mjs --base <ref> --head <ref> [--out <file>]
//   node .claude/skills/pr-change-analysis/scripts/analyze-changes.mjs --mode coverage [--out <file>]
//
// In coverage mode every testable source file is a candidate (used to raise
// coverage of the existing code base rather than of one PR).
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { AGENT_DIR, PROJECTS, classify, isTestFile, normalize } from '../../../lib/policy.mjs'

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..')
const MAX_DIFF_LINES = 300
const REF = /^[A-Za-z0-9._\/-]{1,200}$/

const git = (...args) => execFileSync('git', args, { cwd: REPO_ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })

/** Parses `git diff --name-status -M` output. */
export function parseNameStatus(output) {
  return output.split('\n').filter(Boolean).map((line) => {
    const [status, ...paths] = line.split('\t')
    const code = status[0]
    return code === 'R' || code === 'C'
      ? { status: code === 'R' ? 'renamed' : 'copied', previousPath: paths[0], path: paths[1] }
      : { status: { A: 'added', M: 'modified', D: 'deleted', T: 'modified' }[code] ?? 'modified', path: paths[0] }
  })
}

/** Returns new-file line ranges touched by a zero-context diff. */
export function parseChangedRanges(diff) {
  const ranges = []
  for (const match of diff.matchAll(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/gm)) {
    const start = Number(match[1])
    const count = match[2] === undefined ? 1 : Number(match[2])
    if (count > 0) ranges.push([start, start + count - 1])
  }
  return ranges
}

/** True when every changed line is blank or a comment, i.e. behaviour cannot have changed. */
export function isCommentOnlyDiff(diff) {
  const changed = diff.split('\n').filter((line) => /^[+-](?![+-]{2} )/.test(line)).map((line) => line.slice(1).trim())
  return changed.length > 0 && changed.every((line) => line === '' || /^(\/\/|\/\*|\*\/?|\{\s*\/\*.*\*\/\s*\})/.test(line))
}

const IMPORT = /(?:import|export)\s[^'"]*?from\s*['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/g
const MOCK = /vi\.mock\(\s*['"]([^'"]+)['"]/g
const stripExtension = (file) => file.replace(/\.(tsx?|jsx?|mjs)$/, '').replace(/\/index$/, '')

function resolvesTo(testFile, content, pattern, target) {
  for (const match of content.matchAll(pattern)) {
    const specifier = match[1] ?? match[2]
    if (!specifier.startsWith('.')) continue
    if (stripExtension(path.posix.normalize(path.posix.join(path.posix.dirname(testFile), specifier))) === target) return true
  }
  return false
}

/**
 * Finds tests related to a source file. `tests` import and exercise it;
 * `mockedBy` replace it with vi.mock, so they only need their mocks kept in
 * sync when its interface changes.
 */
export function findRelatedTests(sourcePath, testFiles, readFile) {
  const target = stripExtension(sourcePath)
  const tests = []
  const mockedBy = []
  for (const testFile of testFiles) {
    const content = readFile(testFile)
    if (resolvesTo(testFile, content, MOCK, target)) mockedBy.push(testFile)
    else if (resolvesTo(testFile, content, IMPORT, target)) tests.push(testFile)
  }
  return { tests, mockedBy }
}

/** Where a new test for the source file should live, following repo conventions. */
export function conventionalTestPath(sourcePath) {
  if (sourcePath.startsWith('frontend/')) return sourcePath.replace(/\.(tsx?)$/, '.test.$1')
  return `backend/tests/${path.posix.basename(sourcePath, '.ts')}.test.ts`
}

function listTestFiles() {
  return git('ls-files', '--cached', '--others', '--exclude-standard', '--', ...Object.values(PROJECTS).map((project) => project.root))
    .split('\n').filter((file) => file && isTestFile(file))
}

function listSourceFiles() {
  return git('ls-files', '--', ...Object.values(PROJECTS).map((project) => project.sourceDir)).split('\n').filter(Boolean)
}

function truncate(diff) {
  const lines = diff.split('\n')
  return lines.length > MAX_DIFF_LINES ? `${lines.slice(0, MAX_DIFF_LINES).join('\n')}\n… diff truncated (${lines.length} lines); read the file for the rest` : diff
}

export function buildManifest({ mode, base, head }) {
  const readFile = (file) => (existsSync(path.join(REPO_ROOT, file)) ? readFileSync(path.join(REPO_ROOT, file), 'utf8') : '')
  const testFiles = listTestFiles()
  const range = `${base}...${head}`
  const changes = mode === 'coverage'
    ? listSourceFiles().filter((file) => classify(file).testable).map((file) => ({ status: 'existing', path: file }))
    : parseNameStatus(git('diff', '--name-status', '-M', range))
  const changedPaths = new Set(changes.flatMap((change) => [change.path, change.previousPath].filter(Boolean)))

  const files = changes.map((change) => {
    const info = classify(change.path)
    const entry = { ...change, project: info.project, kind: info.kind, testable: info.testable, skipReason: info.reason }
    if (change.status === 'deleted') {
      entry.testable = false
      if (info.kind === 'source') {
        entry.skipReason = 'source file deleted'
        const { tests, mockedBy } = findRelatedTests(change.path, testFiles, readFile)
        entry.orphanedTests = [...tests, ...mockedBy].filter((test) => !changedPaths.has(test))
      }
      return entry
    }
    if (mode !== 'coverage' && (info.kind === 'source' || info.kind === 'test')) {
      const diff = git('diff', '-U0', '-M', range, '--', change.path)
      entry.changedRanges = parseChangedRanges(diff)
      if (info.testable && isCommentOnlyDiff(diff)) {
        entry.testable = false
        entry.skipReason = 'only comments or blank lines changed'
      }
      if (info.testable) entry.diff = truncate(git('diff', '-U3', '-M', range, '--', change.path))
    }
    if (info.testable) {
      const { tests, mockedBy } = findRelatedTests(change.path, testFiles, readFile)
      entry.relatedTests = tests
      entry.mockedBy = mockedBy
      entry.conventionalTestPath = conventionalTestPath(change.path)
      entry.testsChangedInPr = tests.some((test) => changedPaths.has(test))
    }
    return entry
  })

  const candidates = files.filter((file) => file.testable).map((file) => file.path)
  return {
    schemaVersion: 1,
    mode,
    base: mode === 'coverage' ? null : base,
    head: mode === 'coverage' ? git('rev-parse', 'HEAD').trim() : head,
    summary: {
      changedFiles: files.length,
      candidates: candidates.length,
      projects: [...new Set(files.filter((file) => file.testable).map((file) => file.project))],
      skipped: files.filter((file) => !file.testable).length,
    },
    candidates,
    files,
  }
}

function parseArgs(argv) {
  const options = { mode: 'pr', out: `${AGENT_DIR}/change-manifest.json` }
  for (let index = 0; index < argv.length; index += 2) {
    const [flag, value] = [argv[index], argv[index + 1]]
    if (!['--base', '--head', '--mode', '--out'].includes(flag) || value === undefined) throw new Error(`Unexpected argument: ${flag}`)
    options[flag.slice(2)] = value
  }
  if (!['pr', 'coverage'].includes(options.mode)) throw new Error('--mode must be "pr" or "coverage"')
  if (options.mode === 'pr' && !(REF.test(options.base ?? '') && REF.test(options.head ?? ''))) throw new Error('--base and --head must be git refs')
  if (!normalize(options.out, REPO_ROOT)?.startsWith(`${AGENT_DIR}/`)) throw new Error(`--out must be inside ${AGENT_DIR}/`)
  return options
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const options = parseArgs(process.argv.slice(2))
    const manifest = buildManifest(options)
    const out = path.join(REPO_ROOT, options.out)
    mkdirSync(path.dirname(out), { recursive: true })
    writeFileSync(out, `${JSON.stringify(manifest, null, 2)}\n`)
    const { summary } = manifest
    console.log(`${summary.changedFiles} files analysed, ${summary.candidates} test candidates (${summary.projects.join(', ') || 'none'}), ${summary.skipped} skipped → ${options.out}`)
    for (const file of manifest.files) console.log(`  ${file.testable ? '●' : '○'} ${file.path}${file.testable ? '' : ` — ${file.skipReason}`}`)
  } catch (error) {
    console.error(`analyze-changes: ${error.message}`)
    process.exitCode = 2
  }
}
