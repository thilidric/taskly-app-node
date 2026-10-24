#!/usr/bin/env node
// Renders the sticky PR comment (and job summary) from the run's artifacts.
// Deterministic data (manifest, patch check, verification, transcript) decides
// the outcome; the agent's report only contributes escaped explanatory text.
//
//   node .github/agent-tests/render-comment.mjs --dir <artifacts dir> [--commit <sha>] [--push <status>]
//     [--run-url <url>] [--agent-outcome <success|failure|skipped|cancelled>] [--out <file>]
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { code, table, text } from './lib/markdown.mjs'

export const MARKER = '<!-- agent-tests-report -->'
const ACTION_LABEL = { created: '🆕 created', updated: '✏️ updated', deleted: '🗑️ deleted', 'no-change': '✔️ no change', skipped: '⏭️ skipped' }

const percent = (value) => (typeof value === 'number' ? `${value.toFixed(1)}%` : 'n/a')
const mark = (check) => (check === undefined ? '—' : check.ok && !check.flaky ? '✅' : '❌')

function changedLines(files = {}) {
  let covered = 0
  let total = 0
  for (const file of Object.values(files)) {
    if (file.changedStatements) {
      covered += file.changedStatements.covered
      total += file.changedStatements.total
    }
  }
  return total ? `${covered}/${total}` : 'n/a'
}

function headline({ manifest, patchCheck, verification, agentOutcome, push }) {
  if (manifest && manifest.summary.candidates === 0) return ['➖', 'No testable source changes; nothing to do']
  if (patchCheck && !patchCheck.ok) return ['⛔', 'Generated patch rejected by policy; nothing was committed']
  if (agentOutcome === 'cancelled') return ['❌', 'Run cancelled (superseded by a newer push?)']
  if (agentOutcome === 'failure') {
    return ['❌', verification?.status === 'passed'
      ? 'Agent stopped early (error or budget); its partial tests passed verification but were not committed'
      : 'Agent run failed; nothing was committed']
  }
  if (!verification) return ['❌', 'Agent run failed before verification']
  if (verification.status === 'no-changes') return ['➖', 'Agent reviewed the changes; no test changes needed']
  if (verification.status === 'failed') return ['⚠️', 'Generated tests failed independent verification; nothing was committed']
  if (push === 'pushed') return ['✅', 'Tests generated, verified and committed to this PR']
  if (push === 'pr-opened') return ['✅', 'Tests generated and verified; opened a pull request with them']
  if (push === 'stale') return ['⏸️', 'Tests verified, but the PR moved on while the agent ran; a new run will follow']
  return ['✅', 'Tests generated and verified (not committed; download the patch artifact)']
}

export function render({ manifest, report, reportCheck, patchCheck, verification, transcript, agentConfig, commit, push, runUrl, agentOutcome }) {
  const [icon, title] = headline({ manifest, patchCheck, verification, agentOutcome, push })
  const out = [MARKER, `## ${icon} Test agent: ${title}`, '']

  if (report?.summary && reportCheck?.valid) out.push(`> ${text(report.summary, 1500)}`, '')
  if (commit && push === 'pushed') out.push(`Committed as ${code(commit.slice(0, 12))}. The tests were re-run independently before committing.`, '')

  if (patchCheck && !patchCheck.ok) {
    out.push('**Policy violations**', '', ...patchCheck.violations.slice(0, 20).map((violation) => `- ${text(violation, 300)}`), '')
  }
  if (verification?.problems?.length) {
    out.push('**Verification problems**', '', ...verification.problems.map((problem) => `- ${text(problem, 300)}`), '')
  }

  if (report && reportCheck?.valid && report.decisions.length) {
    out.push('### Decisions', '', table(['Changed file', 'Decision', 'Test files', 'Why'],
      report.decisions.map((decision) => [
        code(decision.file),
        ACTION_LABEL[decision.action],
        decision.testFiles.map((file) => code(file)).join('<br>') || '—',
        text(decision.reason, 400),
      ])), '')
    const withScenarios = report.decisions.filter((decision) => decision.scenarios.length)
    if (withScenarios.length) {
      const count = withScenarios.reduce((sum, decision) => sum + decision.scenarios.length, 0)
      out.push(`<details><summary>Scenarios covered (${count})</summary>`, '')
      for (const decision of withScenarios) {
        out.push(`**${code(decision.file)}**`, '', ...decision.scenarios.map((scenario) => `- ${text(scenario, 300)}`), '')
      }
      out.push('</details>', '')
    }
  }

  if (report && reportCheck?.valid && report.suspectedDefects.length) {
    out.push('### 🐞 Suspected defects (source left unchanged, please review)', '')
    for (const defect of report.suspectedDefects) {
      out.push(`- ${code(`${defect.file}${defect.line ? `:${defect.line}` : ''}`)}: ${text(defect.description, 400)}<br><sub>${text(defect.evidence, 600)}</sub>`)
    }
    out.push('')
  }

  if (verification) {
    out.push('### Independent verification', '', '_Re-run in a separate job without secrets, on the PR head with the patch applied._', '')
    out.push(table(['Project', 'Tests (before → after)', 'Typecheck', 'Format', 'Stable ×3', 'Changed lines covered', 'Statements', 'Branches'],
      Object.entries(verification.projects).map(([name, project]) => {
        const before = project.before.coverage
        const after = project.after.coverage
        const tests = after.tests
          ? `${before.tests?.total ?? '?'} → ${after.tests.total} ${after.tests.failed ? `❌ ${after.tests.failed} failing` : '✅'}`
          : '❌ did not run'
        return [name, tests, mark(project.after.typecheck), mark(project.after.lint), mark(project.after.stability),
          `${changedLines(before.files)} → ${changedLines(after.files)}`,
          `${percent(before.totals?.statements)} → ${percent(after.totals?.statements)}`,
          `${percent(before.totals?.branches)} → ${percent(after.totals?.branches)}`]
      })), '')
    const failures = Object.values(verification.projects).flatMap((project) => project.after.coverage.failures ?? [])
    if (failures.length) {
      out.push('<details><summary>Failing tests</summary>', '', ...failures.map((failure) => `- ${code(failure.file)} › ${text(failure.test, 200)}`), '', '</details>', '')
    }
  }

  const skipped = manifest?.files.filter((file) => !file.testable) ?? []
  if (skipped.length) {
    out.push(`<details><summary>Files not considered for tests (${skipped.length})</summary>`, '',
      table(['File', 'Reason'], skipped.slice(0, 50).map((file) => [code(file.path), text(file.skipReason, 200)])), '', '</details>', '')
  }

  if (transcript || agentConfig) {
    const tools = Object.entries(transcript?.tools ?? {}).map(([name, count]) => `${name} ×${count}`).join(', ')
    const commands = Object.entries((transcript?.commands ?? []).reduce((counts, command) => ({ ...counts, [command]: (counts[command] ?? 0) + 1 }), {}))
      .map(([command, count]) => `${command} ×${count}`).join(', ')
    out.push('<details><summary>Agent run details</summary>', '')
    out.push(`- Agent: ${code(agentConfig?.name ?? 'test-engineer')}, model ${code(transcript?.model ?? 'unknown')}, outcome ${code(transcript?.outcome ?? agentOutcome ?? 'unknown')}`)
    if (agentConfig?.skills?.length) out.push(`- Skills preloaded: ${agentConfig.skills.map((skill) => code(skill)).join(', ')}`)
    out.push(`- Skills invoked on demand: ${transcript?.invokedSkills?.length ? transcript.invokedSkills.map((skill) => code(skill)).join(', ') : 'none'}`)
    if (tools) out.push(`- Tool calls: ${tools}`)
    if (commands) out.push(`- Test commands: ${commands}`)
    out.push(`- Actions blocked by policy: ${transcript?.blocked ?? 0}`)
    if (transcript?.turns !== null && transcript?.turns !== undefined) {
      out.push(`- Turns: ${transcript.turns}, duration: ${Math.round((transcript.durationMs ?? 0) / 1000)} s, cost: ${transcript.costUsd !== null ? `$${transcript.costUsd.toFixed(2)}` : 'n/a'}`)
    }
    if (reportCheck && !reportCheck.valid) out.push(`- ⚠️ Report invalid: ${reportCheck.errors.slice(0, 5).map((error) => text(error, 200)).join('; ')}`)
    for (const warning of reportCheck?.warnings?.slice(0, 10) ?? []) out.push(`- ⚠️ ${text(warning, 300)}`)
    out.push('', '</details>', '')
  }

  const footer = [runUrl ? `[Workflow run](${runUrl})` : null, manifest?.head ? `head ${code(manifest.head.slice(0, 12))}` : null,
    'Add the `skip-agent-tests` label to opt out.'].filter(Boolean)
  out.push(`<sub>${footer.join(' · ')}</sub>`)
  return out.join('\n')
}

/** Reads `skills:` and `name:` from the agent's frontmatter. */
export function readAgentConfig(file) {
  if (!existsSync(file)) return null
  const frontmatter = readFileSync(file, 'utf8').split('---')[1] ?? ''
  const name = frontmatter.match(/^name:\s*(.+)$/m)?.[1].trim()
  const skills = [...(frontmatter.match(/^skills:\n((?:\s+-\s+.+\n?)+)/m)?.[1] ?? '').matchAll(/-\s+(\S+)/g)].map((match) => match[1])
  return { name, skills }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = Object.fromEntries(process.argv.slice(2).reduce((pairs, arg, index, all) => (index % 2 ? pairs : [...pairs, [arg.slice(2), all[index + 1]]]), []))
  const read = (name) => {
    const file = path.join(args.dir, name)
    try { return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null } catch { return null }
  }
  const body = render({
    manifest: read('change-manifest.json'),
    report: read('report.json'),
    reportCheck: read('report-check.json'),
    patchCheck: read('patch-check.json'),
    verification: read('verification.json'),
    transcript: read('transcript-summary.json'),
    agentConfig: readAgentConfig(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../.claude/agents/test-engineer.md')),
    commit: args.commit || null,
    push: args.push || null,
    runUrl: args['run-url'] || null,
    agentOutcome: args['agent-outcome'] || null,
  })
  if (args.out) writeFileSync(args.out, body)
  else console.log(body)
}
