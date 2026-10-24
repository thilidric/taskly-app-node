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

it('does not advertise Express in headers', async () => {
  expect((await request(setup().app).get('/api/health')).headers['x-powered-by']).toBeUndefined();
});

it('serves the OpenAPI specification', async () => {
  const response = await request(setup().app).get('/openapi.json');
  expect(response.status).toBe(200);
  expect(response.body).toHaveProperty('openapi');
});

it('answers unknown routes with a JSON 404', async () => {
  const response = await request(setup().app).get('/nope');
  expect(response.status).toBe(404);
  expect(response.body).toEqual({ detail: 'Not Found' });
});

it('hides internal errors behind a generic 500 and logs them', async () => {
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

it('rejects oversized bodies with 413', async () => {
  const response = await request(setup().app).post('/api/todos').send({ title: 'x'.repeat(200_000) });
  expect(response.status).toBe(413);
  expect(response.body).toEqual({ detail: 'Request body too large.' });
});
