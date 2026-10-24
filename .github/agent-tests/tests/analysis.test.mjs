import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  conventionalTestPath, findRelatedTests, isCommentOnlyDiff, parseChangedRanges, parseNameStatus,
} from '../../../.claude/skills/pr-change-analysis/scripts/analyze-changes.mjs'
import { expandRanges, summarizeFile } from '../../../.claude/lib/coverage.mjs'
import { globToRegExp, grep, searchFiles } from '../../../.claude/skills/pr-change-analysis/scripts/search.mjs'

describe('search script', () => {
  it('converts globs', () => {
    assert.ok(globToRegExp('frontend/src/**/*.test.tsx').test('frontend/src/a/b/C.test.tsx'))
    assert.ok(globToRegExp('frontend/src/**/*.test.tsx').test('frontend/src/C.test.tsx'))
    assert.ok(!globToRegExp('frontend/src/*.tsx').test('frontend/src/a/C.tsx'))
    assert.ok(globToRegExp('backend/{src,tests}/*.ts').test('backend/tests/x.ts'))
  })

  it('finds files and text in the repository, skipping dependencies', () => {
    assert.ok(searchFiles('backend/src/**/*.ts').includes('backend/src/factory.ts'))
    assert.ok(!searchFiles('**/package.json').some((file) => file.includes('node_modules')))
    assert.deepEqual(grep('export function createApp', ['backend/src'], { filesOnly: true }), ['backend/src/factory.ts'])
    assert.throws(() => grep('x', ['../outside']), /outside the repository/)
  })
})

describe('change analysis', () => {
  it('parses name-status output including renames and deletions', () => {
    assert.deepEqual(parseNameStatus('M\tfrontend/src/App.tsx\nA\tbackend/src/new.ts\nD\told.ts\nR087\ta.ts\tb.ts\n'), [
      { status: 'modified', path: 'frontend/src/App.tsx' },
      { status: 'added', path: 'backend/src/new.ts' },
      { status: 'deleted', path: 'old.ts' },
      { status: 'renamed', previousPath: 'a.ts', path: 'b.ts' },
    ])
  })

  it('extracts new-file line ranges from zero-context hunks', () => {
    const diff = '@@ -10,2 +10,3 @@ x\n+a\n@@ -20 +21 @@\n+b\n@@ -30,4 +32,0 @@\n-c\n'
    assert.deepEqual(parseChangedRanges(diff), [[10, 12], [21, 21]])
  })

  it('detects comment-only diffs', () => {
    assert.equal(isCommentOnlyDiff('--- a/x\n+++ b/x\n@@ -1 +1 @@\n-// old\n+// new\n+\n'), true)
    assert.equal(isCommentOnlyDiff('--- a/x\n+++ b/x\n@@ -1 +1 @@\n-// old\n+const a = 1\n'), false)
    assert.equal(isCommentOnlyDiff(''), false)
  })

  it('separates tests that exercise a module from tests that mock it', () => {
    const files = {
      'frontend/src/a/Foo.test.tsx': "import { Foo } from './Foo'",
      'frontend/src/Page.test.tsx': "vi.mock('./a/Foo', () => ({}))\nimport { Page } from './Page'",
      'frontend/src/Other.test.tsx': "import { Bar } from './a/Bar'",
      'backend/tests/router.test.ts': "import { createTodosRouter } from '../src/features/todos/router.ts';",
    }
    const read = (file) => files[file]
    assert.deepEqual(findRelatedTests('frontend/src/a/Foo.tsx', Object.keys(files), read), {
      tests: ['frontend/src/a/Foo.test.tsx'], mockedBy: ['frontend/src/Page.test.tsx'],
    })
    assert.deepEqual(findRelatedTests('backend/src/features/todos/router.ts', Object.keys(files), read).tests, ['backend/tests/router.test.ts'])
  })

  it('follows repo conventions for new test paths', () => {
    assert.equal(conventionalTestPath('frontend/src/lib/http.ts'), 'frontend/src/lib/http.test.ts')
    assert.equal(conventionalTestPath('frontend/src/app/AppProviders.tsx'), 'frontend/src/app/AppProviders.test.tsx')
    assert.equal(conventionalTestPath('backend/src/core/config.ts'), 'backend/tests/config.test.ts')
  })
})

describe('coverage summary', () => {
  const data = {
    statementMap: { 0: { start: { line: 1 }, end: { line: 1 } }, 1: { start: { line: 2 }, end: { line: 3 } }, 2: { start: { line: 5 }, end: { line: 5 } } },
    s: { 0: 1, 1: 0, 2: 0 },
    branchMap: { 0: { loc: { start: { line: 2 } }, locations: [{ start: { line: 2 } }, {}] } },
    b: { 0: [1, 0] },
    fnMap: { 0: {} },
    f: { 0: 1 },
  }

  it('reports percentages, uncovered lines and branch lines', () => {
    const summary = summarizeFile(data)
    assert.equal(summary.statements, 33.33)
    assert.equal(summary.branches, 50)
    assert.equal(summary.functions, 100)
    assert.deepEqual(summary.uncoveredLines, ['2-3', '5'])
    assert.deepEqual(summary.uncoveredBranchLines, ['2'])
  })

  it('measures coverage of changed lines only', () => {
    assert.deepEqual(summarizeFile(data, expandRanges([[1, 2]])).changedStatements, { covered: 1, total: 2, pct: 50 })
    assert.deepEqual(summarizeFile(data, []).changedStatements, { covered: 0, total: 0, pct: 100 })
  })
})

describe('search options', () => {
  it('parses supported options and rejects unknown ones with guidance', async () => {
    const { parseGrepArgs } = await import('../../../.claude/skills/pr-change-analysis/scripts/search.mjs')
    assert.deepEqual(parseGrepArgs(['backend', '--context', '5', '--files-only']), { paths: ['backend'], filesOnly: true, ignoreCase: false, context: 5 })
    assert.throws(() => parseGrepArgs(['-A30']), /supported: --files-only/)
  })
})
