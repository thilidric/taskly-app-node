---
name: pr-change-analysis
description: Analyze a pull request's changes in the Taskly monorepo and decide, per changed file, whether unit tests must be created, updated, or can be skipped. Use at the start of any test-generation task, for a PR or for coverage mode.
when_to_use: Reading .agent/change-manifest.json, mapping source files to their tests, or deciding create/update/skip for changed code.
user-invocable: true
---

# PR change analysis

Turns a diff into concrete testing decisions. A deterministic script does the
mechanical part (what changed, which lines, which tests are related). Your job
is the judgement: what behaviour changed and what needs testing.

## 1. Get the change manifest

In CI the workflow has already written `.agent/change-manifest.json`. Locally,
create it yourself:

```bash
node .claude/skills/pr-change-analysis/scripts/analyze-changes.mjs --base origin/main --head HEAD
node .claude/skills/pr-change-analysis/scripts/analyze-changes.mjs --mode coverage   # whole code base
```

Manifest fields per file (see [reference.md](reference.md) for the full schema):

| Field | Meaning |
| --- | --- |
| `testable` | `true` = a candidate: source code that the coverage config measures |
| `skipReason` | why a non-candidate was skipped (types, barrel, design system, config, comment-only diff…) |
| `diff`, `changedRanges` | the change itself; `changedRanges` are new-file line ranges `[start, end]` |
| `relatedTests` | tests that import and exercise the file. Start here when updating |
| `mockedBy` | tests that `vi.mock` the file. Update them only if the file's exports or signatures changed |
| `conventionalTestPath` | where a new test file belongs if none exists |
| `testsChangedInPr` | the author already touched related tests. Review them, don't duplicate them |
| `orphanedTests` | for deleted sources: tests that may now be dead |

Trust `testable: false` from the script. Don't generate tests for skipped files.

## 2. Understand each candidate

Search the code with the read-only search script. Wrap patterns in single quotes:

```bash
node .claude/skills/pr-change-analysis/scripts/search.mjs files 'frontend/src/**/*.test.tsx'
node .claude/skills/pr-change-analysis/scripts/search.mjs grep 'from .*utils/todos' frontend/src --files-only
node .claude/skills/pr-change-analysis/scripts/search.mjs grep 'summarize\(' backend
```

For every candidate, before deciding:

1. Read the `diff` and then the **whole** source file. Context matters.
2. Read each file in `relatedTests`. Know what is already asserted.
3. Search for importers of the file to understand how callers use it,
   especially when exports or signatures changed.
4. Classify the change: new behaviour · changed behaviour · bug fix · refactor
   (no behaviour change) · presentation only (markup or copy) · deletion.

## 3. Decide: create, update, skip or no-change

| Situation | Decision |
| --- | --- |
| No test exercises the file and the change has behaviour | **create** at `conventionalTestPath` |
| A test exists but doesn't assert the new or changed behaviour | **update**: add cases to the existing file |
| A PR change intentionally alters behaviour and an existing test now fails | **update** the expectation, and say so in the report |
| An existing test now fails and the change does **not** clearly intend it | **don't touch the test**: record a suspected defect (likely regression) |
| The module's exports or signatures changed and `mockedBy` tests no longer type-check | **update** those mocks only |
| Refactor with no behaviour change, existing tests pass and cover the changed lines | **no-change** (explain which tests cover it) |
| Author's tests already cover the new behaviour (check assertions, not just coverage) | **no-change**, or **update** for missing edge cases only |
| Copy or markup change already asserted by text in tests | **update** the assertion. If not asserted at all, test it only if it is user-facing behaviour (labels, roles, messages) |
| Source deleted and `orphanedTests` now fail to compile | **delete** the dead test cases or files |

What to test in changed code, in priority order:

1. Every new or changed branch: `if`/ternary/`??`/`&&`/early returns/`catch`.
2. Boundaries: empty, max length, null or undefined, invalid input, error responses.
3. Contracts across modules: HTTP status and body, calls to repositories, APIs and
   callbacks with exact arguments.
4. User-visible results: rendered text, roles, disabled states, emitted callbacks.

Coverage tells you where to look: uncovered changed lines definitely need tests.
It does not prove adequacy: covered lines may have no assertions about them.

## 4. Record decisions

Every candidate gets exactly one decision in `.agent/report.json` (test-report
skill), with a one-sentence reason and the scenarios you covered. Skipped
non-candidates don't need entries; the workflow lists them from the manifest.

## Pitfalls

- Don't test the design system (`frontend/src/design-system/**`): it is excluded
  from coverage and other tests mock it.
- A PR may touch both projects. Handle each with its own skill and test runner.
- Generated Prisma code (`backend/src/generated`) is never tested or read.
