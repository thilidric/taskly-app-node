#!/usr/bin/env node
// Validates the agent's patch before anything trusts it: every touched path must
// be a writable test file, no binaries, symlinks or mode changes, no
// suite-weakening constructs in added lines, and bounded size.
//
//   node .github/agent-tests/validate-patch.mjs <patch-file> [--out <json>]
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { FORBIDDEN_TEST_PATTERNS, isPatchable, normalize } from '../../.claude/lib/policy.mjs'

export const LIMITS = { files: 40, addedLines: 6000, bytes: 512 * 1024 }

/** Splits a `git diff` into per-file sections with their headers and added lines. */
export function parsePatch(text) {
  const files = []
  let current = null
  for (const line of text.split('\n')) {
    if (line.startsWith('diff --git ')) {
      // Quoted headers (unusual characters in a path) do not match and fail closed.
      const header = line.match(/^diff --git a\/([^\s"]+) b\/([^\s"]+)$/)
      current = { oldPath: header?.[1] ?? line, path: header?.[2] ?? line, status: 'modified', added: [], removed: 0, binary: false, modes: [] }
      files.push(current)
      continue
    }
    if (!current) continue
    if (line.startsWith('new file mode ')) { current.status = 'added'; current.modes.push(line.slice(14)) }
    else if (line.startsWith('deleted file mode ')) { current.status = 'deleted'; current.modes.push(line.slice(18)) }
    else if (line.startsWith('old mode ') || line.startsWith('new mode ')) current.modes.push(`change:${line.slice(9)}`)
    else if (line.startsWith('rename from ')) current.status = 'renamed'
    else if (line.startsWith('GIT binary patch') || line.startsWith('Binary files ')) current.binary = true
    else if (line.startsWith('+') && !line.startsWith('+++ ')) current.added.push(line.slice(1))
    else if (line.startsWith('-') && !line.startsWith('--- ')) current.removed++
  }
  return files
}

export function validatePatch(text) {
  const violations = []
  if (Buffer.byteLength(text) > LIMITS.bytes) violations.push(`patch is larger than ${LIMITS.bytes / 1024} KiB`)
  const files = parsePatch(text)
  if (files.length > LIMITS.files) violations.push(`patch touches ${files.length} files (limit ${LIMITS.files})`)
  let addedLines = 0
  for (const file of files) {
    addedLines += file.added.length
    for (const candidate of new Set([file.oldPath, file.path])) {
      const normalized = normalize(candidate, '/repo')
      if (normalized !== candidate || !isPatchable(candidate)) violations.push(`${candidate}: not a test file the agent may change`)
    }
    if (file.binary) violations.push(`${file.path}: binary content`)
    if (file.modes.some((mode) => mode !== '100644')) violations.push(`${file.path}: unexpected file mode (${file.modes.join(', ')})`)
    file.added.forEach((line, index) => {
      for (const [pattern, reason] of FORBIDDEN_TEST_PATTERNS) {
        if (pattern.test(line)) violations.push(`${file.path}: added line ${index + 1}: ${reason}`)
      }
    })
  }
  if (addedLines > LIMITS.addedLines) violations.push(`patch adds ${addedLines} lines (limit ${LIMITS.addedLines})`)
  return {
    ok: violations.length === 0,
    empty: files.length === 0,
    violations,
    files: files.map(({ path: file, status, added, removed }) => ({ path: file, status, added: added.length, removed })),
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [patchFile, flag, out] = process.argv.slice(2)
  const result = validatePatch(readFileSync(patchFile, 'utf8'))
  if (flag === '--out' && out) writeFileSync(out, JSON.stringify(result, null, 2))
  console.log(result.empty ? 'patch is empty' : `${result.files.length} files: ${result.files.map((file) => `${file.status} ${file.path} (+${file.added}/-${file.removed})`).join(', ')}`)
  for (const violation of result.violations) console.error(`::error title=Agent patch rejected::${violation}`)
  process.exitCode = result.ok ? 0 : 1
}
