# Backend test patterns

All snippets assume a file in `backend/tests/`.

## Router with a fake store (Supertest)

```ts
import express from 'express';
import request from 'supertest';
import { it, expect, vi } from 'vitest';
import { createTodosRouter } from '../src/features/todos/router.ts';
import { todo } from './fixture.ts';

function setup() {
  const repository = { list: vi.fn(), create: vi.fn(), get: vi.fn(), update: vi.fn(), delete: vi.fn() };
  const app = express();
  app.use(express.json());
  app.use('/api/todos', createTodosRouter(repository));
  return { app, repository };
}

it('returns 404 when patching a missing task', async () => {
  const { app, repository } = setup();
  repository.update.mockResolvedValue(null);
  const response = await request(app).patch('/api/todos/5').send({ completed: true });
  expect(response.status).toBe(404);
  expect(response.body).toEqual({ detail: 'Task not found.' });
  expect(repository.update).toHaveBeenCalledWith(5, { completed: true });
});

it.each(['get', 'patch', 'delete'] as const)('rejects invalid ids for %s', async (method) => {
  const { app, repository } = setup();
  expect((await request(app)[method]('/api/todos/abc').send({ title: 'x' })).status).toBe(422);
  expect(repository.get).not.toHaveBeenCalled();
});
```

## App factory, error handler and health check

```ts
import request from 'supertest';
import { afterEach, it, expect, vi } from 'vitest';
import { createApp } from '../src/factory.ts';
import type { Database } from '../src/features/todos/types.ts';

afterEach(() => vi.restoreAllMocks());

function setup(todo: Record<string, unknown> = {}) {
  const database = { todo: { findFirst: vi.fn().mockResolvedValue(null), findMany: vi.fn().mockResolvedValue([]), ...todo } };
  return { app: createApp(database as unknown as Database), database };
}

it('reports health after querying the database', async () => {
  const { app, database } = setup();
  const response = await request(app).get('/api/health');
  expect(response.status).toBe(200);
  expect(response.body).toEqual({ status: 'ok' });
  expect(database.todo.findFirst).toHaveBeenCalledWith({ select: { id: true } });
});

it('hides internal errors behind a generic 500', async () => {
  const error = vi.spyOn(console, 'error').mockImplementation(() => {});
  const { app } = setup({ findMany: vi.fn().mockRejectedValue(new Error('db down')) });
  const response = await request(app).get('/api/todos');
  expect(response.status).toBe(500);
  expect(response.body).toEqual({ detail: 'Internal Server Error' });
  expect(error).toHaveBeenCalledWith(expect.objectContaining({ message: 'db down' }));
});

it('rejects malformed JSON with 422', async () => {
  const response = await request(setup().app).post('/api/todos').set('Content-Type', 'application/json').send('{bad');
  expect(response.status).toBe(422);
  expect(response.body).toEqual({ detail: 'Invalid JSON.' });
});
```

The error handler's `res.headersSent` branch can be reached by a store whose
method writes the response and then throws. The router writes, so this is
usually only reachable with a custom route. Leave it uncovered rather than
contort the test.

## Repository over the real Prisma client (no database)

See `tests/repository.test.ts`: `createDatabase('postgresql://test:test@localhost:5432/test')`
builds a client lazily, and `vi.spyOn(database.todo, 'findMany').mockResolvedValue([record])`
stubs I/O. Restore with `vi.restoreAllMocks()` in `afterEach`.

## Config (environment)

```ts
import { afterEach, it, expect, vi } from 'vitest';
import { resolveDatabaseUrl } from '../src/core/config.ts';

afterEach(() => vi.unstubAllEnvs());

function stubConnection(overrides: Record<string, string> = {}) {
  const values = { DATABASE_URL: '', POSTGRES_USER: 'user', POSTGRES_PASSWORD: 'p@ss word', POSTGRES_HOST: 'db', DB_PORT: '5433', POSTGRES_DB: 'taskly', ...overrides };
  for (const [name, value] of Object.entries(values)) vi.stubEnv(name, value);
}

it('encodes credentials when composing the URL', () => {
  stubConnection();
  expect(resolveDatabaseUrl()).toBe('postgresql://user:p%40ss%20word@db:5433/taskly');
});
```

Assert exact strings produced by the code (run once, then check that the
result is *correct*, not merely what the code returned).

## Database bootstrap

```ts
const database = { $executeRaw: vi.fn().mockResolvedValue(0) };
await initialize(database as unknown as Database);
expect(String(database.$executeRaw.mock.calls[0][0].join(''))).toContain('CREATE TABLE IF NOT EXISTS todos');
```

## Server lifecycle (`lifespan.ts`) and entry point (`main.ts`)

Mock collaborators before importing the module under test, and never let
real signal handlers or `process.exit` run:

```ts
import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, it, expect, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ createDatabase: vi.fn(), initialize: vi.fn(), createApp: vi.fn() }));
vi.mock('../src/core/database.ts', () => ({ createDatabase: mocks.createDatabase, initialize: mocks.initialize }));
vi.mock('../src/core/config.ts', () => ({ resolveDatabaseUrl: () => 'postgresql://test' }));
vi.mock('../src/factory.ts', () => ({ createApp: mocks.createApp }));

beforeEach(() => {
  vi.spyOn(process, 'once').mockImplementation(() => process); // capture handlers, register nothing
  vi.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());
```

Build a fake server with `Object.assign(new EventEmitter(), { address: () => ({ port: 8000 }), close: vi.fn((done) => done()) })`
and make `createApp` return `{ listen: vi.fn((port, host, callback) => { queueMicrotask(callback); return server; }) }`.
Read handlers registered with `process.once` from
`vi.mocked(process.once).mock.calls`. For `main.ts`, mock
`../src/core/lifespan.ts`, `await import('../src/main.ts')`, flush promises
with `await vi.waitFor(…)`, and reset `process.exitCode = undefined` in `afterEach`.
