---
name: run-unit-tests
description: Run, type-check, format and measure coverage of Taskly unit tests (frontend and backend) through one safe wrapper script, then triage failures. Use whenever tests must be executed or verified.
when_to_use: Running Vitest, checking coverage of changed lines, type-checking tests, formatting test files, investigating test failures or flakiness.
user-invocable: true
---

# Run unit tests

All test execution goes through one wrapper. It is the **only** shell command
available to the test agent:

```bash
node .claude/skills/run-unit-tests/scripts/tests.mjs <command> --project <frontend|backend> [options] [files...]
```

The wrapper runs the project's own Vitest, TypeScript and Prettier binaries
without a shell. It strips secrets from the environment of the code under test
and prints a compact summary. Paths may be repo-relative
(`frontend/src/App.test.tsx`) or project-relative (`src/App.test.tsx`).

| Command | Use |
| --- | --- |
| `run [testFiles…]` | Run the given test files, or the whole suite if none are given. `--repeat 3` reruns them to detect flakiness |
| `coverage [sourceFiles…]` | Run the whole suite with coverage and report per-file %, uncovered lines and uncovered branch lines. `--manifest .agent/change-manifest.json` also reports **changed-line coverage** for PR candidates |
| `typecheck` | `tsc --noEmit` for the project. Test files are type-checked too, so run it after every round of edits |
| `format <testFiles…>` | Prettier `--write` (frontend only. The backend has no formatter, so match its style by hand) |
| `lint <testFiles…>` | Prettier `--check` without writing |

Add `--json` for machine-readable output. Exit codes: `0` ok, `1` failures, `2` usage error.

## Standard sequence

```bash
S=.claude/skills/run-unit-tests/scripts/tests.mjs
node $S coverage --project frontend --manifest .agent/change-manifest.json   # 1. baseline + changed-line gaps
node $S run --project frontend frontend/src/x/Foo.test.tsx                     # 2. iterate on what you write
node $S typecheck --project frontend                                           # 3. types (tests included)
node $S format --project frontend frontend/src/x/Foo.test.tsx                  # 4. style
node $S run --project frontend --repeat 3 frontend/src/x/Foo.test.tsx          # 5. stability
node $S run --project frontend                                                 # 6. whole suite still green
node $S coverage --project frontend --manifest .agent/change-manifest.json   # 7. final numbers for the report
```

Repeat for `backend` when backend files changed. Write the final numbers from
steps 6–7 into the report.

## Triage a failing test

Read the failure message first. Classify it before changing anything:

1. **Test bug** (wrong query, wrong expectation about markup, missing `await`,
   missing provider or mock, wrong import path). Fix the test.
2. **Environment or setup issue** (module mocked in the wrong place, fake timers
   fighting `userEvent`, leaked state between tests). Check the project skill's
   patterns, fix the setup and restore mocks in `afterEach`.
3. **Product defect.** The code contradicts its evident intent. Don't change the
   source and don't bend the assertion. Replace the case with
   `it.todo('<expected behaviour>')` and record it under `suspectedDefects` in
   the report.
4. **Pre-existing failure** (failed in the baseline before you touched
   anything). Don't fix it by editing the test unless the PR intentionally
   changed that behaviour. Report it.

Limits: three fix attempts per failing test. After that, delete the case and
report it. Never leave a failing test, `.skip` or `.only` behind.

## Reading coverage output

```
frontend/src/lib/http.ts: 62.5% stmts, 50% branches, 100% funcs | changed lines: 4/6 statements covered
  uncovered lines: 14-16
  uncovered branches at lines: 12, 20
```

- `changed lines` refers to statements on the PR's changed lines. Aim for all of them.
- `uncovered branches at lines` lists lines with a branch arm never taken. Add a case for each.
- `COVERAGE THRESHOLDS NOT MET` means a project threshold failed (the backend
  enforces 100% on `validators.ts` and `mappers.ts`). Treat it as a failure.
