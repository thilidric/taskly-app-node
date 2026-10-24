import { it, expect, vi } from 'vitest';
import { createDatabase, initialize } from '../src/core/database.ts';
import type { Database } from '../src/features/todos/types.ts';

it('creates the todos table idempotently', async () => {
  const database = { $executeRaw: vi.fn().mockResolvedValue(0) };
  await initialize(database as unknown as Database);
  expect(database.$executeRaw).toHaveBeenCalledOnce();
  expect(String(database.$executeRaw.mock.calls[0][0].join(''))).toContain('CREATE TABLE IF NOT EXISTS todos');
});

it('builds a client without opening a connection', () => {
  expect(createDatabase('postgresql://test:test@localhost:5432/test').todo).toBeDefined();
});
