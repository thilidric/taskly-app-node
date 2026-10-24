#!/usr/bin/env node
// Read-only code search for the test agent (this Claude Code build has no Glob or
// Grep tools, and the agent may not run arbitrary shell commands).
//
//   node .claude/skills/pr-change-analysis/scripts/search.mjs files '<glob>'
//   node .claude/skills/pr-change-analysis/scripts/search.mjs grep '<regex>' [path ...] [--files-only] [--ignore-case] [--context N]
//
// Paths are repo-relative. node_modules, .git, build output, coverage, the
// generated Prisma client and .env files are never searched.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { normalize } from '../../../lib/policy.mjs'

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..')
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'coverage', 'storybook-static', '.vite', 'generated', '.agent'])
const MAX_RESULTS = 200
const MAX_LINE = 200

export function globToRegExp(glob) {
  let source = ''
  for (let index = 0; index < glob.length; index++) {
    const char = glob[index]
    if (char === '*' && glob[index + 1] === '*') {
      source += glob[index + 2] === '/' ? '(?:.*/)?' : '.*'
      index += glob[index + 2] === '/' ? 2 : 1
    } else if (char === '*') source += '[^/]*'
    else if (char === '?') source += '[^/]'
    else if (char === '{') source += '(?:'
    else if (char === '}') source += ')'
    else if (char === ',') source += '|'
    else source += char.replace(/[.+^$()|[\]\\]/g, '\\$&')
  }
  return new RegExp(`^${source}$`)
}

function* walk(relativeDir) {
  for (const entry of readdirSync(path.join(REPO_ROOT, relativeDir), { withFileTypes: true })) {
    const relative = relativeDir ? `${relativeDir}/${entry.name}` : entry.name
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) yield* walk(relative)
    } else if (entry.isFile() && !/^\.env(\.|$)/.test(entry.name)) yield relative
  }
}

function roots(paths) {
  if (!paths.length) return ['']
  return paths.map((item) => {
    const relative = normalize(item, REPO_ROOT)
    if (relative === null && path.resolve(REPO_ROOT, item) !== REPO_ROOT) throw new Error(`Path outside the repository: ${item}`)
    return relative ?? ''
  })
}

function* filesUnder(paths) {
  for (const root of roots(paths)) {
    const absolute = path.join(REPO_ROOT, root)
    if (statSync(absolute, { throwIfNoEntry: false })?.isFile()) yield root
    else yield* walk(root)
  }
}

export function searchFiles(glob) {
  const pattern = globToRegExp(glob)
  return [...walk('')].filter((file) => pattern.test(file)).sort()
}

export function grep(regex, paths = [], { filesOnly = false, ignoreCase = false, context = 0 } = {}) {
  const pattern = new RegExp(regex, ignoreCase ? 'i' : '')
  const results = []
  for (const file of filesUnder(paths)) {
    if (!/\.(m?[jt]sx?|json|md|prisma|css|html|ya?ml)$/.test(file)) continue
    const lines = readFileSync(path.join(REPO_ROOT, file), 'utf8').split('\n')
    for (let index = 0; index < lines.length; index++) {
      if (!pattern.test(lines[index])) continue
      if (filesOnly) {
        results.push(file)
        break
      }
      const shown = lines.slice(index, index + 1 + context).map((line, offset) => `${file}:${index + 1 + offset}: ${line.slice(0, MAX_LINE)}`)
      results.push(shown.join('\n'))
    }
  }
  return results
}

export function parseGrepArgs(args) {
  const options = { paths: [], filesOnly: false, ignoreCase: false, context: 0 }
  for (let index = 0; index < args.length; index++) {
    const arg = args[index]
    if (arg === '--files-only') options.filesOnly = true
    else if (arg === '--ignore-case') options.ignoreCase = true
    else if (arg === '--context') options.context = Math.min(Math.max(Number(args[++index]) || 0, 0), 60)
    else if (arg.startsWith('-')) throw new Error(`unknown option ${arg}; supported: --files-only, --ignore-case, --context <lines after match>`)
    else options.paths.push(arg)
  }
  return options
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [command, pattern, ...rest] = process.argv.slice(2)
  try {
    if (!pattern) throw new Error('usage: search.mjs files <glob> | grep <regex> [path ...] [--files-only] [--ignore-case]')
    const results = command === 'files'
      ? searchFiles(pattern)
      : command === 'grep'
        ? (() => { const { paths, ...options } = parseGrepArgs(rest); return grep(pattern, paths, options) })()
        : (() => { throw new Error(`unknown command ${command}`) })()
    console.log(results.slice(0, MAX_RESULTS).join('\n') || '(no matches)')
    if (results.length > MAX_RESULTS) console.log(`… ${results.length - MAX_RESULTS} more; narrow the pattern or path`)
  } catch (error) {
    console.error(`search: ${error.message}`)
    process.exitCode = 2
  }
}
