// Single source of truth for what the test agent may touch and which files are
// worth testing. Used by the agent's write guard hook, the change analysis
// skill, the test runner skill and the CI patch validator, so the rules cannot
// drift apart. Keep the exclusions in sync with each project's coverage config
// (frontend/vite.config.ts, backend/vitest.config.ts).
import path from 'node:path'

export const PROJECTS = {
  frontend: {
    root: 'frontend',
    sourceDir: 'frontend/src',
    testLocation: 'co-located: <dir>/<Name>.test.ts(x) next to the source file',
    skill: 'frontend-unit-tests',
  },
  backend: {
    root: 'backend',
    sourceDir: 'backend/src',
    testLocation: 'backend/tests/<module>.test.ts',
    skill: 'backend-unit-tests',
  },
}

// Directory for agent scratch files and the report. Writable, never committed.
export const AGENT_DIR = '.agent'

const TEST_FILE = {
  frontend: [/^frontend\/src\/.+\.test\.tsx?$/, /^frontend\/src\/test\/.+\.tsx?$/],
  backend: [/^backend\/tests\/.+\.ts$/],
}

// Shared test infrastructure that changes the behaviour of every test. A change
// here could silently weaken the whole suite, so it stays human-owned.
const PROTECTED = [/^frontend\/src\/test\/setup\.ts$/, /^frontend\/src\/design-system\/mocks\.tsx$/]

const EXCLUDED_SOURCE = {
  frontend: [
    [/^frontend\/src\/main\.tsx$/, 'application entry point (excluded from coverage)'],
    [/^frontend\/src\/test\//, 'test infrastructure'],
    [/^frontend\/src\/design-system\//, 'design system (covered by Storybook, excluded from coverage)'],
    [/(^|\/)types\.ts$|\.types\.ts$/, 'type declarations only'],
    [/(^|\/)index\.ts$/, 'barrel re-export'],
    [/(^|\/)constants\.tsx?$|\.constants\.ts$/, 'constants (excluded from coverage)'],
    [/^frontend\/src\/features\/todos\/api\/queryKeys\.ts$/, 'static query keys (excluded from coverage)'],
    [/^frontend\/src\/lib\/queryClient\.ts$/, 'static client configuration (excluded from coverage)'],
    [/\.stories\.tsx?$/, 'Storybook story'],
    [/\.d\.ts$/, 'type declarations only'],
  ],
  backend: [
    [/(^|\/)types\.ts$/, 'type declarations only (excluded from coverage)'],
    [/^backend\/src\/generated\//, 'generated Prisma client'],
    [/\.d\.ts$/, 'type declarations only'],
  ],
}

/** Normalizes a path to repo-relative POSIX form; returns null if it escapes the repo. */
export function normalize(file, repoRoot = process.cwd()) {
  if (typeof file !== 'string' || !file || file.includes('\0')) return null
  const absolute = path.resolve(repoRoot, file)
  const relative = path.relative(path.resolve(repoRoot), absolute)
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) return null
  return relative.split(path.sep).join('/')
}

export function projectOf(file) {
  return Object.keys(PROJECTS).find((name) => file.startsWith(`${PROJECTS[name].root}/`)) ?? null
}

export function isTestFile(file) {
  const project = projectOf(file)
  return Boolean(project) && TEST_FILE[project].some((pattern) => pattern.test(file))
}

export function isProtected(file) {
  return PROTECTED.some((pattern) => pattern.test(file))
}

/** Files the agent may create, edit or delete. */
export function isAgentWritable(file) {
  if (file === AGENT_DIR || file.startsWith(`${AGENT_DIR}/`)) return true
  return isTestFile(file) && !isProtected(file)
}

/** Files that may appear in the agent's patch (the scratch directory never does). */
export function isPatchable(file) {
  return isTestFile(file) && !isProtected(file)
}

/**
 * Classifies a changed file for test generation.
 * kind: source | test | other. testable is true only for source files that the
 * project's coverage config measures.
 */
export function classify(file) {
  const project = projectOf(file)
  if (!project) return { project: null, kind: 'other', testable: false, reason: 'outside the frontend and backend projects' }
  if (isTestFile(file)) return { project, kind: 'test', testable: false, reason: 'test file' }
  const inSource = file.startsWith(`${PROJECTS[project].sourceDir}/`)
  const isCode = /\.(ts|tsx)$/.test(file)
  if (!inSource || !isCode) {
    return { project, kind: 'other', testable: false, reason: inSource ? 'not TypeScript code' : 'configuration, tooling or documentation' }
  }
  const excluded = EXCLUDED_SOURCE[project].find(([pattern]) => pattern.test(file))
  if (excluded) return { project, kind: 'source', testable: false, reason: excluded[1] }
  return { project, kind: 'source', testable: true, reason: null }
}

/** Patterns that weaken or bypass a test suite; rejected in added test lines. */
export const FORBIDDEN_TEST_PATTERNS = [
  [/\b(?:it|test|describe|suite)\.only\s*\(/, 'focused test (.only) would skip the rest of the suite'],
  [/\b(?:it|test|describe|suite)\.skip(?:If)?\s*\(|\bx(?:it|describe|test)\s*\(/, 'skipped test'],
  [/@ts-nocheck|@ts-ignore/, 'type checking suppressed'],
  [/\bchild_process\b/, 'tests must not spawn processes'],
]
