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

it('prefers the override argument over the environment', () => {
  stubConnection({ DATABASE_URL: 'postgresql://env/db' });
  expect(resolveDatabaseUrl('postgresql://override/db')).toBe('postgresql://override/db');
});

it('uses DATABASE_URL and rewrites the SQLAlchemy driver prefix', () => {
  stubConnection({ DATABASE_URL: 'postgresql+psycopg://u:p@h:5432/d' });
  expect(resolveDatabaseUrl()).toBe('postgresql://u:p@h:5432/d');
});

it.each(['POSTGRES_USER', 'POSTGRES_PASSWORD', 'POSTGRES_HOST', 'DB_PORT', 'POSTGRES_DB'])('throws naming %s when it is missing', (name) => {
  stubConnection({ [name]: '' });
  expect(() => resolveDatabaseUrl()).toThrow(`Missing environment variable: ${name}`);
});
