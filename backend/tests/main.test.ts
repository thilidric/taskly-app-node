import { afterEach, beforeEach, it, expect, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ start: vi.fn() }));
vi.mock('../src/core/lifespan.ts', () => ({ start: mocks.start }));

beforeEach(() => {
  vi.resetModules();
  mocks.start.mockReset();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
  process.exitCode = undefined;
});

it('starts the server without touching the exit code', async () => {
  mocks.start.mockResolvedValue({});
  await import('../src/main.ts');
  expect(mocks.start).toHaveBeenCalledOnce();
  await Promise.resolve();
  expect(process.exitCode).toBeUndefined();
});

it('logs the startup error and sets a failing exit code', async () => {
  const failure = new Error('no db');
  mocks.start.mockRejectedValue(failure);
  await import('../src/main.ts');
  await vi.waitFor(() => expect(process.exitCode).toBe(1));
  expect(console.error).toHaveBeenCalledWith('Cannot start Taskly App Node API:', failure);
});
