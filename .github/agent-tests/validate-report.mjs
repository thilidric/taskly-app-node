#!/usr/bin/env node
// Validates the agent's report against its schema and cross-checks it with the
// manifest and the validated patch, so the PR comment never repeats claims
// that contradict what actually happened.
//
//   node .github/agent-tests/validate-report.mjs --report <file> --manifest <file> --patch-check <file> [--out <json>]
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { validate } from './lib/schema.mjs'

const SCHEMA = JSON.parse(readFileSync(new URL('../../.claude/skills/test-report/report.schema.json', import.meta.url), 'utf8'))

export function checkReport(report, manifest, patchCheck) {
  const errors = validate(SCHEMA, report)
  const warnings = []
  if (errors.length) return { valid: false, errors, warnings }
  const candidates = new Set(manifest.candidates)
  const patched = new Set(patchCheck.files.map((file) => file.path))
  const decided = new Set()
  for (const decision of report.decisions) {
    if (!candidates.has(decision.file)) warnings.push(`decision for ${decision.file}, which is not a candidate`)
    decided.add(decision.file)
    for (const testFile of decision.testFiles) {
      if (!patched.has(testFile)) warnings.push(`${decision.file}: reports a change to ${testFile}, which is not in the patch`)
    }
    if (['created', 'updated', 'deleted'].includes(decision.action) && !decision.testFiles.length) {
      warnings.push(`${decision.file}: action "${decision.action}" without test files`)
    }
  }
  for (const candidate of candidates) if (!decided.has(candidate)) warnings.push(`no decision recorded for ${candidate}`)
  return { valid: true, errors, warnings }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = Object.fromEntries(process.argv.slice(2).reduce((pairs, arg, index, all) => (index % 2 ? pairs : [...pairs, [arg.slice(2), all[index + 1]]]), []))
  let result
  if (!existsSync(args.report)) result = { valid: false, errors: ['the agent did not write .agent/report.json'], warnings: [] }
  else {
    try {
      const read = (file) => JSON.parse(readFileSync(file, 'utf8'))
      result = checkReport(read(args.report), read(args.manifest), read(args['patch-check']))
    } catch (error) {
      result = { valid: false, errors: [`unreadable report: ${error.message}`], warnings: [] }
    }
  }
  if (args.out) writeFileSync(args.out, JSON.stringify(result, null, 2))
  for (const error of result.errors) console.log(`::warning title=Agent report invalid::${error}`)
  for (const warning of result.warnings) console.log(`::notice title=Agent report::${warning}`)
  console.log(result.valid ? `report valid (${result.warnings.length} warnings)` : 'report invalid')
}
