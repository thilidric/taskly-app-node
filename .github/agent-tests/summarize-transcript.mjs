#!/usr/bin/env node
// Extracts an audit summary from the agent's stream-json transcript: skills
// loaded, tools used, commands run, files written, blocked actions, turns and
// cost. Deterministic evidence of what the agent did, independent of its report.
//
//   node .github/agent-tests/summarize-transcript.mjs <transcript.jsonl> [--out <json>]
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const TEST_COMMAND = /tests\.mjs\s+(\w+)\s+--project\s+(\w+)/

export function summarize(lines) {
  const summary = {
    model: null, preloadedSkills: [], invokedSkills: [], tools: {}, commands: [], filesWritten: [],
    blocked: 0, turns: null, costUsd: null, durationMs: null, outcome: 'unknown',
  }
  const pending = new Map()
  for (const line of lines) {
    let event
    try { event = JSON.parse(line) } catch { continue }
    if (event.type === 'system' && event.subtype === 'init') {
      summary.model = event.model ?? null
      summary.agent = event.agent ?? null
    }
    if (event.type === 'assistant') {
      for (const block of event.message?.content ?? []) {
        if (block.type !== 'tool_use') continue
        summary.tools[block.name] = (summary.tools[block.name] ?? 0) + 1
        pending.set(block.id, block)
        if (block.name === 'Skill') summary.invokedSkills.push(block.input?.skill ?? block.input?.command ?? 'unknown')
        if (block.name === 'Bash') {
          const match = String(block.input?.command ?? '').match(TEST_COMMAND)
          summary.commands.push(match ? `${match[1]} ${match[2]}` : 'other')
        }
        if (['Write', 'Edit', 'MultiEdit'].includes(block.name) && block.input?.file_path) summary.filesWritten.push(block.input.file_path)
      }
    }
    if (event.type === 'user') {
      for (const block of event.message?.content ?? []) {
        if (block.type === 'tool_result' && block.is_error && /Blocked by test-engineer policy|permission/i.test(JSON.stringify(block.content))) summary.blocked++
      }
    }
    if (event.type === 'result') {
      summary.turns = event.num_turns ?? null
      summary.costUsd = event.total_cost_usd ?? null
      summary.durationMs = event.duration_ms ?? null
      summary.outcome = event.is_error
        ? `error: ${String(event.terminal_reason ?? event.subtype)}${event.api_error_status ? ` (HTTP ${event.api_error_status})` : ''}`
        : event.subtype ?? 'success'
      summary.blocked = Math.max(summary.blocked, event.permission_denials?.length ?? 0)
    }
  }
  summary.invokedSkills = [...new Set(summary.invokedSkills)]
  summary.filesWritten = [...new Set(summary.filesWritten.map((file) => file.replace(/\\/g, '/').replace(/^.*?\/((?:frontend|backend|\.agent)\/)/, '$1')))]
  return summary
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [file, flag, out] = process.argv.slice(2)
  let lines = []
  try { lines = readFileSync(file, 'utf8').split('\n') } catch { /* missing transcript: summarize as unknown */ }
  const summary = summarize(lines)
  if (flag === '--out' && out) writeFileSync(out, JSON.stringify(summary, null, 2))
  console.log(JSON.stringify(summary))
}
