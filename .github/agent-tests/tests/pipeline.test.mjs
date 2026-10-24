import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { validatePatch } from '../validate-patch.mjs'
import { checkReport } from '../validate-report.mjs'
import { decideStatus } from '../verify.mjs'
import { summarize } from '../summarize-transcript.mjs'
import { MARKER, render } from '../render-comment.mjs'
import { upsertComment } from '../publish-comment.mjs'
import { text } from '../lib/markdown.mjs'

const filePatch = (file, added, header = '') =>
  `diff --git a/${file} b/${file}\n${header}--- a/${file}\n+++ b/${file}\n@@ -0,0 +1,${added.length} @@\n${added.map((line) => `+${line}`).join('\n')}\n`

describe('patch validation', () => {
  it('accepts new and modified test files', () => {
    const patch = filePatch('frontend/src/lib/http.test.ts', ["it('works', () => {})"], 'new file mode 100644\n') +
      filePatch('backend/tests/router.test.ts', ["it('also works', () => {});"])
    const result = validatePatch(patch)
    assert.equal(result.ok, true, result.violations.join('\n'))
    assert.deepEqual(result.files.map((file) => file.status), ['added', 'modified'])
  })

  it('rejects application code, protected files and quoted paths', () => {
    for (const file of ['backend/src/factory.ts', 'frontend/src/test/setup.ts', '.github/workflows/agent-tests.yml']) {
      assert.equal(validatePatch(filePatch(file, ['x'])).ok, false, file)
    }
    const quoted = 'diff --git "a/frontend/src/a b.test.ts" "b/frontend/src/a b.test.ts"\n+x\n'
    assert.equal(validatePatch(quoted).ok, false)
  })

  it('rejects renames out of test locations, symlinks, binaries and weakened tests', () => {
    const rename = 'diff --git a/backend/src/factory.ts b/backend/tests/factory.test.ts\nrename from backend/src/factory.ts\nrename to backend/tests/factory.test.ts\n'
    assert.equal(validatePatch(rename).ok, false)
    assert.equal(validatePatch(filePatch('backend/tests/link.ts', ['../src/x'], 'new file mode 120000\n')).ok, false)
    assert.equal(validatePatch('diff --git a/backend/tests/a.ts b/backend/tests/a.ts\nGIT binary patch\n').ok, false)
    const skipped = validatePatch(filePatch('backend/tests/a.test.ts', ["it.skip('x', () => {});"]))
    assert.match(skipped.violations[0], /skipped test/)
  })

  it('treats an empty patch as valid and empty', () => {
    assert.deepEqual(validatePatch(''), { ok: true, empty: true, violations: [], files: [] })
  })
})

const report = {
  schemaVersion: 1,
  mode: 'pr',
  summary: 'Added tests.',
  decisions: [{ file: 'frontend/src/lib/http.ts', action: 'created', testFiles: ['frontend/src/lib/http.test.ts'], reason: 'No tests.', scenarios: ['x'] }],
  suspectedDefects: [],
  testRuns: [{ project: 'frontend', passed: 3, failed: 0 }],
}
const manifest = { candidates: ['frontend/src/lib/http.ts', 'frontend/src/App.tsx'], summary: { candidates: 2, projects: ['frontend'] }, files: [] }
const patchCheck = { ok: true, empty: false, violations: [], files: [{ path: 'frontend/src/lib/http.test.ts', status: 'added', added: 10, removed: 0 }] }

describe('report validation', () => {
  it('accepts a schema-valid report and cross-checks it with the manifest and patch', () => {
    const result = checkReport(report, manifest, patchCheck)
    assert.equal(result.valid, true)
    assert.deepEqual(result.warnings, ['no decision recorded for frontend/src/App.tsx'])
  })

  it('warns when the report claims test files that are not in the patch', () => {
    const result = checkReport(report, manifest, { ...patchCheck, files: [] })
    assert.ok(result.warnings.some((warning) => warning.includes('not in the patch')))
  })

  it('rejects schema violations', () => {
    const result = checkReport({ ...report, decisions: [{ ...report.decisions[0], action: 'rewrote' }], extra: true }, manifest, patchCheck)
    assert.equal(result.valid, false)
    assert.ok(result.errors.some((error) => error.includes('unexpected property extra')))
    assert.ok(result.errors.some((error) => error.includes('action')))
  })
})

describe('verification status', () => {
  const project = (after) => ({ before: { coverage: {} }, after: { coverage: { tests: { failed: 0 }, thresholdsMet: true }, typecheck: { ok: true }, ...after } })

  it('passes only when every check passes', () => {
    assert.equal(decideStatus({ frontend: project({}) }, false).status, 'passed')
    assert.equal(decideStatus({ frontend: project({}) }, true).status, 'no-changes')
    assert.equal(decideStatus({ frontend: project({ typecheck: { ok: false } }) }, false).status, 'failed')
    assert.equal(decideStatus({ frontend: project({ stability: { ok: true, flaky: true } }) }, false).status, 'failed')
    assert.equal(decideStatus({ backend: project({ coverage: { tests: { failed: 0 }, thresholdsMet: false } }) }, false).status, 'failed')
    assert.equal(decideStatus({ backend: project({ coverage: { error: 'boom' } }) }, false).status, 'failed')
  })
})

describe('transcript summary', () => {
  it('extracts skills, tools, commands, blocked actions and cost', () => {
    const lines = [
      { type: 'system', subtype: 'init', model: 'claude-sonnet-5-5' },
      { type: 'assistant', message: { content: [
        { type: 'tool_use', id: '1', name: 'Skill', input: { skill: 'frontend-unit-tests' } },
        { type: 'tool_use', id: '2', name: 'Bash', input: { command: 'node .claude/skills/run-unit-tests/scripts/tests.mjs coverage --project frontend' } },
        { type: 'tool_use', id: '3', name: 'Write', input: { file_path: '/home/runner/work/repo/repo/frontend/src/lib/http.test.ts' } },
        { type: 'tool_use', id: '4', name: 'Bash', input: { command: 'curl x' } },
      ] } },
      { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: '4', is_error: true, content: 'Blocked by test-engineer policy: …' }] } },
      { type: 'result', subtype: 'success', is_error: false, num_turns: 12, total_cost_usd: 0.42, duration_ms: 90000 },
      'not json',
    ].map((line) => (typeof line === 'string' ? line : JSON.stringify(line)))
    const summary = summarize(lines)
    assert.deepEqual(summary.invokedSkills, ['frontend-unit-tests'])
    assert.deepEqual(summary.commands, ['coverage frontend', 'other (blocked)'])
    assert.deepEqual(summary.filesWritten, ['frontend/src/lib/http.test.ts'])
    assert.equal(summary.blocked, 1)
    assert.equal(summary.turns, 12)
    assert.equal(summary.outcome, 'success')
  })
})

describe('comment rendering', () => {
  it('escapes model-written text', () => {
    const escaped = text('<img src=x onerror=alert(1)> @org/team [link](https://evil.example) | `code`')
    assert.ok(!escaped.includes('<img'))
    assert.ok(!/@org/.test(escaped))
    assert.ok(!escaped.includes('](https://'))
    assert.ok(!/(?<!\\)\|/.test(escaped))
  })

  const verification = {
    status: 'passed',
    problems: [],
    projects: { frontend: {
      before: { coverage: { tests: { total: 18 }, totals: { statements: 46.4, branches: 43.8 }, files: { a: { changedStatements: { covered: 0, total: 4 } } } } },
      after: { typecheck: { ok: true }, lint: { ok: true }, stability: { ok: true, flaky: false },
        coverage: { tests: { total: 25, failed: 0 }, totals: { statements: 52.1, branches: 50 }, files: { a: { changedStatements: { covered: 4, total: 4 } } } } },
    } },
  }

  it('renders a committed, verified run with decisions and verification table', () => {
    const body = render({ manifest, report, reportCheck: { valid: true, errors: [], warnings: [] }, patchCheck, verification,
      transcript: null, agentConfig: { name: 'test-engineer', skills: ['run-unit-tests'] }, commit: 'abcdef1234567890', push: 'pushed', agentOutcome: 'success' })
    assert.ok(body.startsWith(MARKER))
    assert.match(body, /Tests generated, verified and committed/)
    assert.match(body, /18 → 25 ✅/)
    assert.match(body, /0\/4 → 4\/4/)
    assert.match(body, /🆕 created/)
  })

  it('reports policy rejections and agent failures', () => {
    assert.match(render({ manifest, patchCheck: { ...patchCheck, ok: false, violations: ['backend/src/x.ts: not a test file'] } }), /rejected by policy/)
    assert.match(render({ manifest, patchCheck, verification: { ...verification, status: 'no-changes' }, agentOutcome: 'failure' }), /Agent run failed/)
    assert.match(render({ manifest: { ...manifest, summary: { candidates: 0 } } }), /No testable source changes/)
  })
})

describe('sticky comment', () => {
  function fakeGitHub(existing) {
    const calls = []
    const fetchImpl = async (url, init = {}) => {
      calls.push({ url, method: init.method ?? 'GET', body: init.body })
      const payload = url.includes('/comments?') ? existing : { html_url: 'https://github.com/c/1' }
      return { ok: true, json: async () => payload, text: async () => '' }
    }
    return { calls, fetchImpl }
  }

  it('updates the existing bot comment instead of adding another', async () => {
    const github = fakeGitHub([{ id: 9, user: { type: 'User' }, body: `${MARKER} spoof` }, { id: 7, user: { type: 'Bot' }, body: `${MARKER}\nold` }])
    const result = await upsertComment({ repository: 'o/r', pr: '3', body: `${MARKER}\nnew`, token: 't', api: 'https://api', fetchImpl: github.fetchImpl })
    assert.equal(result.action, 'updated')
    assert.equal(github.calls.at(-1).method, 'PATCH')
    assert.match(github.calls.at(-1).url, /comments\/7$/)
  })

  it('creates a comment, or skips when only updates are allowed', async () => {
    const created = fakeGitHub([])
    assert.equal((await upsertComment({ repository: 'o/r', pr: '3', body: 'x', token: 't', api: 'https://api', fetchImpl: created.fetchImpl })).action, 'created')
    const skipped = fakeGitHub([])
    assert.equal((await upsertComment({ repository: 'o/r', pr: '3', body: 'x', token: 't', updateOnly: true, api: 'https://api', fetchImpl: skipped.fetchImpl })).action, 'skipped')
    assert.equal(skipped.calls.length, 1)
  })
})
