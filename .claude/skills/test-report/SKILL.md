---
name: test-report
description: Write the structured, truthful .agent/report.json that summarizes the test agent's decisions, tests written, suspected defects and observed test results. Use at the end of every test-generation run, including runs where no tests were needed.
---

# Test report

The CI workflow turns `.agent/report.json` into the pull-request comment. It
validates the file against [report.schema.json](report.schema.json) and checks
it against its own independent test run. Invalid or missing reports fail the
run.

## Rules

- Write the file with the Write tool as the **last step**, after the final test
  and coverage runs.
- Include **one decision per candidate** from the manifest (`candidates` array):
  `created`, `updated`, `deleted`, `no-change` or `skipped`.
- `testFiles` lists only files you actually created, changed or deleted, as repo-relative paths.
- `scenarios` are short behaviour statements, one per test case you added or
  changed ("returns 404 when the task does not exist"). This is what reviewers read.
- `reason` is one sentence: why this decision, citing evidence (coverage
  numbers, existing test names, the diff).
- `testRuns` holds the **final** runs only: the last `run` of the whole suite per
  project, as reported by the wrapper. Never estimate or round up.
- `coverage` uses the numbers from the final `coverage` command per project.
- `suspectedDefects` records places where the code contradicts its intent, with
  file, line and evidence. Empty array if none.
- `summary` is 1–3 plain sentences for the PR author: what changed, what was tested, anything to look at.
- Plain text only: no HTML, no Markdown links, no @-mentions. The renderer escapes everything.

## Example

```json
{
  "schemaVersion": 1,
  "mode": "pr",
  "summary": "Added tests for the new due-date sort tiebreak and the overdue badge. One suspected defect: invalid dates are treated as overdue.",
  "decisions": [
    {
      "file": "frontend/src/features/todos/utils/todos.ts",
      "action": "updated",
      "testFiles": ["frontend/src/features/todos/utils/todos.test.ts"],
      "reason": "selectTodos gained a 'due' tiebreak by priority; changed lines 52-58 were uncovered (0/4).",
      "scenarios": [
        "sorts tasks with the same due date by priority",
        "keeps tasks without a due date last"
      ]
    },
    {
      "file": "frontend/src/features/todos/components/TodoItem.tsx",
      "action": "no-change",
      "testFiles": [],
      "reason": "Only a class name changed; TodoItem.test.tsx still passes and covers the changed line.",
      "scenarios": []
    }
  ],
  "suspectedDefects": [
    {
      "file": "frontend/src/features/todos/utils/todos.ts",
      "line": 61,
      "description": "isOverdue returns true for '2026-13-01'.",
      "evidence": "String comparison against today's date without validating the date first."
    }
  ],
  "testRuns": [
    { "project": "frontend", "passed": 42, "failed": 0, "skipped": 0, "todo": 1, "stableRuns": 3 }
  ],
  "coverage": [
    { "project": "frontend", "statements": 81.2, "branches": 74.5, "changedLines": { "covered": 9, "total": 9 } }
  ],
  "notes": ["The author's TodoFilters.test.tsx already covered the new option."]
}
```
