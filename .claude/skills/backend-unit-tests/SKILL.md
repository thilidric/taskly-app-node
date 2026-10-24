---
name: backend-unit-tests
description: Conventions and proven patterns for writing Vitest + Supertest unit tests in the Taskly backend (Express 5, Zod 4, Prisma 7). Tests never need a running PostgreSQL. Use before creating or editing any backend/tests file.
when_to_use: Writing or fixing tests for Express routers, the app factory and error handler, Zod validators, mappers, the Prisma repository, config, database bootstrap or server lifecycle under backend/src.
user-invocable: true
---

# Backend unit tests (backend/)

Stack: Vitest 4 (`node` environment, **no globals**), Supertest 7, Express 5
(async handler errors reach the error middleware), Zod 4 and Prisma 7 with the
`pg` adapter. Coverage thresholds require **100%** for
`src/features/todos/{validators,mappers}.ts`.

## Conventions (match them exactly)

- **Location:** flat `backend/tests/<module>.test.ts` (`src/features/todos/router.ts`
  → `tests/router.test.ts`). The Vitest include is `tests/**/*.test.ts`.
  Helpers without `.test` (like `tests/fixture.ts`) are allowed.
- **Imports:** relative with the **`.ts` extension**:
  `import { createApp } from '../src/factory.ts'`. Test APIs come explicitly
  from `vitest`.
- **Style:** semicolons, single quotes, compact. Short tests stay on few
  lines, and `it.each` is used for input tables. No formatter is configured, so
  mirror `tests/router.test.ts`.
- **Fixtures:** `record` (a Prisma row with `Date` objects) and `todo` (the API
  JSON shape) from `tests/fixture.ts`. Spread to vary them.
- **No real I/O:** no database, no network, no listening ports (Supertest
  binds ephemeral ports internally, which is fine), no `process.exit`.

## Choose the right seam

| Unit | Test through | Fake |
| --- | --- | --- |
| `features/todos/router.ts` | Supertest on `express()` + `express.json()` + router | a `TodoStore` object of `vi.fn()` |
| `factory.ts` (`createApp`) | Supertest on `createApp(database)` | a minimal `Database` object cast with `as unknown as Database` |
| `api/health.ts` | Supertest via `createApp` or a bare router | `database.todo.findFirst` |
| `features/todos/repository.ts` | direct calls | real Prisma client from `createDatabase(url)` with `vi.spyOn(database.todo, …)` (no connection is opened) |
| `validators.ts`, `mappers.ts` | direct calls | nothing |
| `core/config.ts` | direct calls | `vi.stubEnv` (+ `vi.unstubAllEnvs()` in `afterEach`) |
| `core/database.ts` `initialize` | direct call | object with `$executeRaw: vi.fn()` |
| `core/lifespan.ts`, `main.ts` | dynamic import after `vi.mock` of collaborators | mocked `createDatabase`, `createApp`, `process.once`, `console` |

Patterns for each row are in [patterns.md](patterns.md), verified against this
code base. Read the relevant section first.

## What to assert for HTTP code

- Status code **and** body (`{ detail: … }` shapes: `'Task not found.'`,
  `'Invalid JSON.'`, `'Not Found'`, Zod `issues` arrays for 422).
- Exact repository calls (`toHaveBeenCalledWith(1, { completed: true })`), and
  `not.toHaveBeenCalled()` when validation must stop the request.
- Param validation runs before handlers: `/api/todos/abc` → 422 for GET, PATCH and DELETE.
- 204 responses have an empty body.

## Pitfalls seen in this repo

- `src/core/config.ts` loads the root `.env` with dotenv **at import time**.
  Make tests independent of a developer's `.env`: stub **every** variable the
  code reads, including `vi.stubEnv('DATABASE_URL', '')` when testing the
  composed URL.
- `createApp` reads `openapi.json` relative to the module, so it works in
  tests without stubbing.
- The error handler logs with `console.error`. Silence it and assert on it:
  `const error = vi.spyOn(console, 'error').mockImplementation(() => {})`,
  then `vi.restoreAllMocks()` in `afterEach`.
- `express.json()` rejects bodies over 100 kB with 413, and malformed JSON
  with 422 (`entity.parse.failed`). Send raw strings with
  `.set('Content-Type', 'application/json').send('{bad')`.
- `idSchema` coerces strings. `'1.5'`, `'0'` and `'9007199254740992'` are
  rejected (see `validators.test.ts`).
- Type the store fake as `TodoStore` (or let inference work through
  `createTodosRouter(repository)`), so typecheck catches interface drift.
