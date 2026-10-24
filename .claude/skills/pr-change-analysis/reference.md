# Change manifest reference

Written by `scripts/analyze-changes.mjs` to `.agent/change-manifest.json`.

```jsonc
{
  "schemaVersion": 1,
  "mode": "pr",                    // "pr" | "coverage"
  "base": "<sha>",                 // null in coverage mode
  "head": "<sha>",
  "summary": { "changedFiles": 4, "candidates": 2, "projects": ["frontend"], "skipped": 2 },
  "candidates": ["frontend/src/features/todos/utils/todos.ts"],
  "files": [
    {
      "path": "frontend/src/features/todos/utils/todos.ts",
      "status": "modified",        // added | modified | deleted | renamed | copied | existing (coverage mode)
      "previousPath": "…",         // renames only
      "project": "frontend",       // frontend | backend | null
      "kind": "source",            // source | test | other
      "testable": true,
      "skipReason": null,
      "changedRanges": [[48, 60]], // PR mode only
      "diff": "@@ … @@ …",          // PR mode, candidates only, truncated to 300 lines
      "relatedTests": ["frontend/src/features/todos/utils/todos.test.ts"],
      "mockedBy": ["frontend/src/features/todos/TodosPage.test.tsx"],
      "conventionalTestPath": "frontend/src/features/todos/utils/todos.test.ts",
      "testsChangedInPr": false
    }
  ]
}
```

## Classification rules

Defined once in `.claude/lib/policy.mjs`, which the guard hook and CI validator
also use. Mirrors the coverage config of each project:

- **frontend** candidates: `frontend/src/**/*.{ts,tsx}` except `main.tsx`,
  `src/test/**`, `src/design-system/**`, `types.ts`/`*.types.ts`, `index.ts`
  barrels, constants, `api/queryKeys.ts`, `lib/queryClient.ts`, stories.
- **backend** candidates: `backend/src/**/*.ts` except `types.ts` and
  `src/generated/**`.
- A modified candidate whose diff only touches comments or blank lines is skipped.

## Test conventions used for `conventionalTestPath`

- frontend: co-located, `Foo.tsx` → `Foo.test.tsx`, `foo.ts` → `foo.test.ts`.
- backend: flat `backend/tests/` directory named after the module,
  `src/features/todos/router.ts` → `tests/router.test.ts`. If two modules share
  a basename, prefix with the folder (`tests/core-config.test.ts`).
