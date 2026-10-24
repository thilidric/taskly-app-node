# SOLUTION — test-engineer agent for Taskly

An agentic workflow that, for every pull request, analyzes what changed in the
React frontend and the Express backend. Where tests are warranted, it creates or
updates Vitest unit tests, proves they pass in an independent job, commits them
to the PR and reports in a sticky PR comment. The same agent and skills also
raised the coverage of the existing code base ("coverage mode").

```
PR opened / pushed
  │
  ├─ plan      (read-only)        deterministic diff analysis → change-manifest.json
  ├─ generate  (LLM, no GH write) Claude Code runs the test-engineer agent → patch + report
  ├─ verify    (no secrets)       re-validate patch, apply, typecheck, format, 3× stability, full suite + coverage
  └─ publish   (GH write, no LLM) commit verified tests to the PR branch, upsert the PR comment
```

## Main technical decisions

| Decision | Rationale |
| --- | --- |
| **Claude Code CLI as the agent runtime**, run headless (`claude -p --agent test-engineer`) | Custom agents, skills and hooks are native, file-based features. The same definitions work in CI and in a developer's interactive session. A pinned CLI version (`2.1.310`) gives reproducible runs. |
| **One custom agent + five skills** | The agent holds the workflow and the non-negotiable rules. Skills hold reusable know-how. Three skills that every run needs are declared in the agent's `skills:` list. The two project skills are loaded only when files of that project are involved. In both real runs the transcript shows the agent loading all five through the Skill tool. |
| **Deterministic work lives in scripts, judgement in the LLM** | The diff parsing, test discovery, coverage maths, patch validation and reporting are plain Node scripts with unit tests. The model decides *what* to test and writes the tests. |
| **Four jobs split by privilege** | The job holding the LLM credential has no GitHub write token and blocked egress. The job with write access runs no LLM and no project code. Verification runs without secrets. A prompt-injected or misbehaving agent can at worst produce a patch, which is then rejected. |
| **Trust nothing the agent says** | Its patch is validated twice (generate and verify) against a single policy file and re-run from scratch. The PR comment's outcome comes from deterministic artifacts; the agent's report only adds escaped explanatory text. |
| **Tests only, never source** | Enforced at three layers: the agent's `PreToolUse` hook, its permission allowlist and the CI patch validator. Suspected product bugs are reported, not "fixed" or encoded in assertions. |
| **Commit to the PR branch** (not a separate PR) | Tests stay with the change they test and reviewers see them in the same diff. The push uses a compare-and-swap check: it is skipped if the branch moved while the agent ran. |

## How to run it

**Prerequisites** (once per repository)

1. GitHub Actions enabled. Secret **`CLAUDE_CODE_OAUTH_TOKEN`** (from
   `claude setup-token`, uses a Claude Pro/Max subscription) **or**
   `ANTHROPIC_API_KEY`.
2. *Settings → Actions → General → Workflow permissions*: enable *Allow GitHub
   Actions to create and approve pull requests* (coverage mode opens a PR).
3. Optional repository variables: `AGENT_TESTS_MODEL` (default `sonnet`),
   `AGENT_TESTS_BUDGET_USD` (default `5`), `AGENT_TESTS_COVERAGE_BUDGET_USD`
   (default `15`).

**PR mode (automatic):** open or push to a non-draft PR from a branch of this
repository. The *Agent tests* workflow runs and the result appears as a PR
comment, a job summary and, if tests were added, a `test: … [agent-tests]`
commit on the PR branch. To opt out, add the `skip-agent-tests` label.

**Coverage mode (manual):** *Actions → Agent tests → Run workflow* or
`gh workflow run agent-tests.yml -f mode=coverage`. The agent targets the whole
code base and opens a PR with the tests.

**Locally (same agent, same skills):**

```bash
cd frontend && npm ci && cd ../backend && npm ci && cd ..
node .claude/skills/pr-change-analysis/scripts/analyze-changes.mjs --base origin/main --head HEAD
claude --agent test-engineer "mode: pr. The change manifest is at .agent/change-manifest.json."
node --test ".github/agent-tests/tests/*.test.mjs"   # tests of the guardrails and CI scripts
```

## Where things are defined and how they are used

| Path | Role | Used when |
| --- | --- | --- |
| [`.claude/agents/test-engineer.md`](.claude/agents/test-engineer.md) | **Custom agent**: rules, 7-step workflow, quality bar. Frontmatter sets its tools, preloaded skills, `maxTurns` and its own `PreToolUse` hook | `generate` job, as the main thread via `--agent` |
| [`.claude/skills/pr-change-analysis/`](.claude/skills/pr-change-analysis/SKILL.md) | Reads the change manifest and applies the create/update/skip rubric. `scripts/analyze-changes.mjs` builds the manifest (changed lines, related tests, tests that mock the file, conventional test path); `scripts/search.mjs` is the agent's read-only code search | preloaded; the manifest script also runs in the `plan` job |
| [`.claude/skills/run-unit-tests/`](.claude/skills/run-unit-tests/SKILL.md) | Runs, type-checks, formats and measures coverage (including **changed-line coverage**) through one safe wrapper, `scripts/tests.mjs` (no shell, secrets stripped from the env), plus failure triage | preloaded; the wrapper is also used by the `verify` job |
| [`.claude/skills/frontend-unit-tests/`](.claude/skills/frontend-unit-tests/SKILL.md) | RTL/userEvent conventions, design-system mocks, TanStack Query hook patterns, fetch stubbing, fake timers | invoked on demand for `frontend/` files |
| [`.claude/skills/backend-unit-tests/`](.claude/skills/backend-unit-tests/SKILL.md) | Supertest/Express 5, Prisma without a database, env stubbing, lifecycle mocking | invoked on demand for `backend/` files |
| [`.claude/skills/test-report/`](.claude/skills/test-report/SKILL.md) | Structure and honesty rules of `.agent/report.json` (+ JSON schema) | preloaded; final step |
| [`.claude/lib/policy.mjs`](.claude/lib/policy.mjs) | Single source of truth: testable files, writable paths, forbidden test constructs | hook, skills, validator |
| [`.claude/hooks/guard.mjs`](.claude/hooks/guard.mjs) | Blocks writes outside test files and any shell command except the skills' scripts (single-quoted arguments only, no shell syntax) | every agent write and Bash call. Registered in the agent's frontmatter and in the CI settings |
| [`.claude/test-engineer.settings.json`](.claude/test-engineer.settings.json) | CI permission allowlist (`--permission-mode dontAsk` denies everything else) | `generate` job |
| [`.github/workflows/agent-tests.yml`](.github/workflows/agent-tests.yml) | The agentic workflow (plan → generate → verify → publish) | PR events, manual dispatch |
| [`.github/agent-tests/`](.github/agent-tests/) | Patch/report validation, independent verifier, transcript audit, comment renderer/publisher, commit script, and their tests | CI |

Every skill pattern was checked by running it against this code base before it was written into the skill.

## Security and reliability measures

- **Secrets:** fork PRs never run the agent, since they get no secrets. The PR
  title, body and comments are never put in the prompt. Dependencies are
  installed with `--ignore-scripts` before the credential enters the job. The
  test wrapper runs code under test with an allowlisted environment, so tests
  cannot read the token.
- **Least privilege:** `permissions: {}` by default, then per job:
  `contents: read`, except `publish` with `contents: write` and
  `pull-requests: write`. All actions are pinned to commit SHAs.
  `persist-credentials: false` everywhere except the push.
- **Network:** `step-security/harden-runner` with `egress-policy: block` and an
  allowlist (Anthropic API, npm registry, GitHub) in the job that has the credential.
- **Prompt injection:** repository content is declared to be data in the
  agent's rules. The tool surface is minimal: `Read`, test-file writes and the
  skills' three scripts. Even a fully hijacked agent can only produce a patch, which the
  validator rejects unless it touches test files only.
- **PR cannot change its own guard rails:** the agent definition, skills, hooks
  and CI scripts are taken from the **base** branch (`use-base-tooling.sh`).
- **Correctness:** a test is shipped only if it passes typecheck, Prettier and
  three consecutive runs (flakiness), keeps the whole suite green and meets the
  coverage thresholds. All of this is checked by a job that never saw the agent.
  `.only`, `.skip`, `@ts-ignore` and `child_process` are rejected.
- **Bounded cost and blast radius:** `--max-budget-usd`, `maxTurns`, job
  timeouts, a patch size limit and per-PR concurrency with cancel-in-progress.
- **Auditability:** the stream-json transcript and a summary of it (skills used,
  tool calls, blocked actions, turns, cost) are uploaded as artifacts and
  summarized in the PR comment.

## Results

### 1. Missing tests in the existing application (coverage mode)

The agent ran in coverage mode ([run](https://github.com/thilidric/taskly-app-node/actions/runs/40091256040))
and its verified tests were merged in [PR #1](https://github.com/thilidric/taskly-app-node/pull/1).
That commit is authored by `github-actions[bot]`.

| Project | Tests | Statements | Branches |
| --- | --- | --- | --- |
| backend | 48 → **83** | 30.2% → **98.5%** | 33.3% → **97.9%** |
| frontend | 18 → **98** | 46.4% → **98.8%** | 43.8% → **97.8%** |

The run covered 24 test files (17 new, 7 extended), in 96 turns, 5.4 min,
$1.00 equivalent, with no suspected defects. The remaining gaps are named in the
agent's report: an unreachable `res.headersSent` branch, the lifespan
force-exit timer, one `DeleteTodoDialog` guard and two sort tiebreaks.

### 2. Example PR run: [PR #2 "feat: task progress summary"](https://github.com/thilidric/taskly-app-node/pull/2)

The PR adds `GET /api/todos/summary` (backend) and a `TodoSummary` card plus
`summarizeTodos()` (frontend), deliberately without tests.
[Workflow run](https://github.com/thilidric/taskly-app-node/actions/runs/40093859853).

1. **plan** classified 7 changed files: 5 candidates; `openapi.json` and
   `styles.css` skipped as non-code.
2. **generate.** The agent loaded `pr-change-analysis` and `run-unit-tests`.
   It read the manifest and ran coverage, which showed backend changed lines at
   1/12 covered and frontend at 8/8. It then loaded `backend-unit-tests` and
   `frontend-unit-tests`, wrote the tests, formatted and type-checked them,
   ran `--repeat 3` and coverage again, and finally loaded `test-report` and
   wrote the report.

   The guard blocked two commands (`git diff …` and a `S=…; node $S …`
   compound command), and the agent switched to the allowed form each time.
   The run took 39 turns, 85 s and $0.29.
3. **Decisions** (from the PR comment):

   | Changed file | Decision | Why |
   | --- | --- | --- |
   | `backend/src/features/todos/summary.ts` | created `tests/summary.test.ts` | new aggregation logic with branches |
   | `backend/src/features/todos/router.ts` | updated `tests/router.test.ts` | `/summary` must win over `/:id`; asserts that `repository.get` is not called |
   | `frontend/src/features/todos/utils/todos.ts` | updated `todos.test.ts` | `summarizeTodos` untested |
   | `frontend/src/features/todos/components/TodoSummary.tsx` | created `TodoSummary.test.tsx` | empty, singular/plural, all-done and overdue branches |
   | `frontend/src/features/todos/TodosPage.tsx` | updated `TodosPage.test.tsx` | the summary must use **all** tasks, not the filtered list |

   Frontend changed lines were already 8/8 covered, because the page test
   rendered the new component, yet nothing asserted its behaviour. The agent
   therefore still added tests, following the "coverage is a signal, not the
   goal" rule.
4. **verify** (no secrets) re-ran everything. Every check passed and nothing
   was flaky:

   | Project | Tests | Changed lines covered | Statements | Branches |
   | --- | --- | --- | --- | --- |
   | backend | 83 → 88 | 1/12 → **12/12** | 90.8% → 98.6% | 82.5% → 98.3% |
   | frontend | 98 → 107 | 8/8 → 8/8 | 98.9% → 98.9% | 95.2% → 98.0% |

   Both projects passed typecheck and 3 stability runs. Formatting applies to
   the frontend only, and it passed.
5. **publish** pushed `test: add unit tests for changes in #2 [agent-tests]` to
   the PR branch and posted the sticky comment with decisions, 15 scenarios,
   the verification table and run details.

### Rollout notes

The first real runs found three problems, all fixed:

- Prisma's engine download was blocked by the egress allowlist. This showed
  the firewall works; `binaries.prisma.sh` was added.
- The pinned Claude Code build has no `Glob`/`Grep` tools, so I added a
  read-only `search.mjs` to the analysis skill instead of allowing arbitrary
  shell commands.
- A relative path bug in `commit.sh` stopped coverage mode just before it
  opened its PR. The branch had already been pushed, so PR #1 was opened by
  hand from the run's artifacts, and the PR says so.

## Assumptions

- PRs come from branches of this repository. Fork PRs are skipped by design.
- Unit tests only (Vitest, no database or browser). This matches the existing
  suites, which mock Prisma and the design system.
- "Appropriate to test" means changed **testable** code as defined by each
  project's coverage config: no tests for the design system (Storybook),
  types, barrels or config.
- Committing straight to the PR branch is acceptable to authors, who can revert
  the agent's commit like any other.

## Limitations

- Commits pushed with `GITHUB_TOKEN` don't trigger other workflows, so the `CI`
  workflow doesn't re-run on the agent's commit. The `verify` job runs the
  equivalent checks, but a required-checks setup would need a GitHub App token.
- LLM output varies between runs. The guard rails make it safe, not identical.
- Test *quality* beyond passing, typing, stability and coverage is judged by the
  agent's rubric and human review. There is no mutation testing yet.
- Egress blocking relies on harden-runner's free tier, which covers public
  repositories only. On private repositories the job would fall back to `audit`.
- Policy file classifications duplicate the coverage `exclude` lists of both
  projects and must be kept in sync by hand.
- In a run, the agent re-analyses the whole PR diff, not just the latest push.
  This is correct but repeats work on long-lived PRs.

## What I would change for production

- **GitHub App** instead of `GITHUB_TOKEN`, so CI re-runs on agent commits, plus
  a dedicated bot identity and signed commits.
- **Protected environment** for the model credential (required reviewers or
  branch filters) and OIDC-based short-lived credentials (Bedrock/Vertex) instead of a static token.
- **Mutation testing** (Stryker) on changed files to measure whether new tests
  actually catch regressions, and feed the results back to the agent.
- **Incremental runs:** analyse only commits since the last agent commit. Cache
  coverage baselines per base commit.
- **Suggest mode** (review comments with suggested changes) as an alternative
  to direct commits, configurable per repository or label. A `/agent-tests`
  comment command to re-run on demand.
- **Evaluation suite** for the agent and skills: a set of historical PRs with
  expected decisions, run on every change to `.claude/`, to catch prompt regressions.
- Derive the policy file classifications from the Vitest configs, and extend
  the change analysis to follow dependencies (a change in a shared util marks
  its importers' tests as affected).
