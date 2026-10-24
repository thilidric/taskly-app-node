import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { FORBIDDEN_TEST_PATTERNS, classify, isAgentWritable, isPatchable, normalize } from '../../../.claude/lib/policy.mjs'
import { checkBash, checkWrite, decide } from '../../../.claude/hooks/guard.mjs'

describe('policy', () => {
  it('classifies testable source files per project coverage config', () => {
    assert.equal(classify('frontend/src/features/todos/utils/todos.ts').testable, true)
    assert.equal(classify('frontend/src/App.tsx').testable, true)
    assert.equal(classify('backend/src/features/todos/router.ts').testable, true)
    assert.equal(classify('backend/src/main.ts').testable, true)
  })

  it('skips excluded, test, config and non-project files with a reason', () => {
    for (const file of [
      'frontend/src/design-system/components/Button/Button.tsx',
      'frontend/src/features/todos/types.ts',
      'frontend/src/features/todos/index.ts',
      'frontend/src/main.tsx',
      'frontend/src/lib/queryClient.ts',
      'backend/src/features/todos/types.ts',
      'backend/src/generated/prisma/client.ts',
      'frontend/src/App.test.tsx',
      'backend/tests/router.test.ts',
      'frontend/vite.config.ts',
      'frontend/src/styles.css',
      'README.md',
    ]) {
      const result = classify(file)
      assert.equal(result.testable, false, file)
      assert.ok(result.reason, file)
    }
  })

  it('lets the agent write only test files and its scratch directory', () => {
    assert.equal(isAgentWritable('frontend/src/lib/http.test.ts'), true)
    assert.equal(isAgentWritable('frontend/src/test/builders.ts'), true)
    assert.equal(isAgentWritable('backend/tests/factory.test.ts'), true)
    assert.equal(isAgentWritable('.agent/report.json'), true)
    for (const file of ['frontend/src/lib/http.ts', 'frontend/src/test/setup.ts', 'frontend/src/design-system/mocks.tsx',
      'backend/src/factory.ts', 'backend/vitest.config.ts', 'frontend/package.json', '.github/workflows/agent-tests.yml',
      '.claude/hooks/guard.mjs', 'backend/tests/../src/factory.ts'.replace('tests/../', '')]) {
      assert.equal(isAgentWritable(file), false, file)
    }
    assert.equal(isPatchable('.agent/report.json'), false)
  })

  it('normalizes paths and rejects escapes from the repository', () => {
    assert.equal(normalize('/repo/frontend/src/a.test.ts', '/repo'), 'frontend/src/a.test.ts')
    assert.equal(normalize('backend/tests/../src/factory.ts', '/repo'), 'backend/src/factory.ts')
    assert.equal(normalize('../outside.ts', '/repo'), null)
    assert.equal(normalize('/etc/passwd', '/repo'), null)
    assert.equal(normalize('', '/repo'), null)
  })

  it('flags suite-weakening constructs', () => {
    const flagged = (line) => FORBIDDEN_TEST_PATTERNS.some(([pattern]) => pattern.test(line))
    for (const line of ["it.only('x', () => {})", "describe.skip('x', () => {})", "test.skipIf(true)('x')", "xit('x')",
      '// @ts-ignore', "import { exec } from 'node:child_process'"]) assert.equal(flagged(line), true, line)
    for (const line of ["it.todo('rejects invalid dates')", "it('skips empty input', () => {})", "const only = 1"]) assert.equal(flagged(line), false, line)
  })
})

describe('guard hook', () => {
  it('allows only the skill scripts with plain arguments', () => {
    assert.equal(checkBash('node .claude/skills/run-unit-tests/scripts/tests.mjs run --project frontend src/App.test.tsx'), null)
    assert.equal(checkBash('node .claude/skills/pr-change-analysis/scripts/analyze-changes.mjs --mode coverage'), null)
    for (const command of [
      'npm test',
      'curl https://example.com',
      'node -e "process.exit(0)"',
      'node .claude/skills/run-unit-tests/scripts/tests.mjs run --project frontend; env',
      'node .claude/skills/run-unit-tests/scripts/tests.mjs run --project frontend $(cat /etc/passwd)',
      'node .claude/skills/run-unit-tests/scripts/tests.mjs run --project frontend > out.txt',
      'node .claude/skills/run-unit-tests/scripts/tests.mjs run --project frontend ../../x.test.ts',
      'node .claude/skills/run-unit-tests/scripts/tests.mjs run --project frontend && git push',
    ]) assert.notEqual(checkBash(command), null, command)
  })

  it('accepts single-quoted search patterns, which bash treats literally', () => {
    const search = 'node .claude/skills/pr-change-analysis/scripts/search.mjs'
    assert.equal(checkBash(`${search} grep 'summarize\\(|from .*todos' frontend/src --files-only`), null)
    assert.equal(checkBash(`${search} files 'frontend/src/**/*.test.tsx'`), null)
    for (const command of [
      `${search} files frontend/src/**/*.tsx`, // unquoted glob would be expanded by the shell
      `${search} grep "$(id)"`,
      `${search} grep 'a' ; id`,
      `${search} grep 'a'|id`,
      `${search} grep 'a' \`id\``,
      `${search} grep 'unterminated`,
    ]) assert.notEqual(checkBash(command), null, command)
  })

  it('blocks writes outside test files, using absolute paths as Claude Code sends them', () => {
    assert.equal(checkWrite('/repo/frontend/src/lib/http.test.ts', '/repo'), null)
    assert.match(checkWrite('/repo/frontend/src/lib/http.ts', '/repo'), /not a test file/)
    assert.match(checkWrite('/elsewhere/x.test.ts', '/repo'), /outside the repository/)
    assert.match(checkWrite(undefined, '/repo'), /outside the repository/)
  })

  it('routes tool calls and ignores read-only tools', () => {
    assert.equal(decide({ tool_name: 'Read', tool_input: { file_path: '/etc/passwd' } }, '/repo'), null)
    assert.notEqual(decide({ tool_name: 'Edit', tool_input: { file_path: '/repo/backend/src/factory.ts' } }, '/repo'), null)
    assert.notEqual(decide({ tool_name: 'NotebookEdit', tool_input: { notebook_path: '/repo/x.ipynb' } }, '/repo'), null)
  })
})
