#!/usr/bin/env node
// PreToolUse hook for the test-engineer agent (registered in its frontmatter,
// so it never affects other Claude Code sessions in this repository).
// - File writes are allowed only for test files and the .agent/ scratch dir.
// - Bash is allowed only for the skills' own scripts, with plain arguments.
// Exit code 2 blocks the tool call and shows the reason to the agent.
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { isAgentWritable, normalize } from '../lib/policy.mjs'

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

const ALLOWED_SCRIPTS = [
  '.claude/skills/run-unit-tests/scripts/tests.mjs',
  '.claude/skills/pr-change-analysis/scripts/analyze-changes.mjs',
  '.claude/skills/pr-change-analysis/scripts/search.mjs',
]
// Unquoted words: plain characters only, so the shell cannot expand, substitute,
// redirect or chain anything.
const SAFE_WORD = /^[A-Za-z0-9_@%+=:,./-]+$/

/**
 * Splits a command into words. Single-quoted words are allowed because bash
 * treats their content literally (used for search patterns). Returns null if
 * anything else could be interpreted by the shell.
 */
export function tokenize(command) {
  const words = []
  for (const match of String(command ?? '').trim().matchAll(/'([^']*)'|(\S+)/g)) {
    if (match[1] !== undefined) {
      if (/[\n\r]/.test(match[1])) return null
      words.push({ value: match[1], quoted: true })
    } else if (SAFE_WORD.test(match[2])) words.push({ value: match[2], quoted: false })
    else return null
  }
  return words
}

export function checkBash(command) {
  const usage = `Only these commands are available: ${ALLOWED_SCRIPTS.map((script) => `node ${script} …`).join(' | ')}. Use Read for files and the search script to find code.`
  const words = tokenize(command)
  if (!words) return `Shell syntax is not allowed (no pipes, redirects, $, backticks, double quotes or unquoted globs); wrap patterns in single quotes. ${usage}`
  if (words[0]?.value !== 'node' || words[0].quoted || !ALLOWED_SCRIPTS.includes(words[1]?.value)) return usage
  const unsafe = words.slice(2).find((word) => !word.quoted && word.value.includes('..'))
  if (unsafe) return `Argument "${unsafe.value}" is not allowed: pass repo-relative paths.`
  return null
}

export function checkWrite(file, repoRoot = REPO_ROOT) {
  const relative = normalize(file, repoRoot)
  if (!relative) return `${file} is outside the repository.`
  if (!isAgentWritable(relative)) {
    return `${relative} is not a test file. You may only create or edit test files (frontend/src/**/*.test.ts(x), frontend/src/test/** except setup.ts, backend/tests/**) and files in .agent/. Never change application code; report suspected defects instead.`
  }
  return null
}

export function decide(event, repoRoot = REPO_ROOT) {
  const input = event.tool_input ?? {}
  switch (event.tool_name) {
    case 'Bash':
      return checkBash(input.command)
    case 'Write':
    case 'Edit':
    case 'MultiEdit':
      return checkWrite(input.file_path, repoRoot)
    case 'NotebookEdit':
      return checkWrite(input.notebook_path, repoRoot)
    default:
      return null
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let reason
  try {
    reason = decide(JSON.parse(readFileSync(0, 'utf8')))
  } catch (error) {
    reason = `Guard could not parse the tool call (${error.message}); blocked by default.`
  }
  if (reason) {
    process.stderr.write(`Blocked by test-engineer policy: ${reason}\n`)
    process.exitCode = 2
  }
}
