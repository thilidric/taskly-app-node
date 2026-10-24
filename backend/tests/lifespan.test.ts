import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, it, expect, vi } from 'vitest';
import { start } from '../src/core/lifespan.ts';

const mocks = vi.hoisted(() => ({ createDatabase: vi.fn(), initialize: vi.fn(), createApp: vi.fn() }));
vi.mock('../src/core/database.ts', () => ({ createDatabase: mocks.createDatabase, initialize: mocks.initialize }));
vi.mock('../src/core/config.ts', () => ({ resolveDatabaseUrl: () => 'postgresql://test' }));
vi.mock('../src/factory.ts', () => ({ createApp: mocks.createApp }));

beforeEach(() => {
  vi.spyOn(process, 'once').mockImplementation(() => process);
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.stubEnv('API_PORT', '');
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.useRealTimers();
  process.exitCode = undefined;
  mocks.createDatabase.mockReset();
  mocks.initialize.mockReset();
  mocks.createApp.mockReset();
});

function setup() {
  const database = { $connect: vi.fn().mockResolvedValue(undefined), $disconnect: vi.fn().mockResolvedValue(undefined) };
  const server = Object.assign(new EventEmitter(), { address: () => ({ port: 8000 }), close: vi.fn((done: () => void) => done()) });
  const app = { listen: vi.fn((port: number, host: string, callback: () => void) => { queueMicrotask(callback); return server; }) };
  mocks.createDatabase.mockReturnValue(database);
  mocks.initialize.mockResolvedValue(undefined);
  mocks.createApp.mockReturnValue(app);
  return { database, server, app };
}

it('connects, initializes, listens on the default port and logs it', async () => {
  const { database, app, server } = setup();
  const result = await start();
  expect(mocks.createDatabase).toHaveBeenCalledWith('postgresql://test');
  expect(database.$connect).toHaveBeenCalled();
  expect(mocks.initialize).toHaveBeenCalledWith(database);
  expect(app.listen).toHaveBeenCalledWith(8000, '0.0.0.0', expect.any(Function));
  expect(console.log).toHaveBeenCalledWith('Taskly App Node API listening on port 8000');
  expect(result).toEqual({ server, database });
});

it('listens on API_PORT when set', async () => {
  vi.stubEnv('API_PORT', '9123');
  const { app } = setup();
  await start();
  expect(app.listen).toHaveBeenCalledWith(9123, '0.0.0.0', expect.any(Function));
});

it('registers SIGTERM and SIGINT handlers that close the server and disconnect', async () => {
  const { server, database } = setup();
  await start();
  const calls = vi.mocked(process.once).mock.calls;
  expect(calls.map(([name]) => name)).toEqual(['SIGTERM', 'SIGINT']);
  (calls[0][1] as () => void)();
  expect(server.close).toHaveBeenCalled();
  await vi.waitFor(() => expect(database.$disconnect).toHaveBeenCalledOnce());
  expect(process.exitCode).toBeUndefined();
});

it('sets a failing exit code when disconnect fails during shutdown', async () => {
  const { database } = setup();
  database.$disconnect.mockRejectedValue(new Error('boom'));
  await start();
  (vi.mocked(process.once).mock.calls[0][1] as () => void)();
  await vi.waitFor(() => expect(process.exitCode).toBe(1));
  expect(console.error).toHaveBeenCalledWith(expect.objectContaining({ message: 'boom' }));
});

it('disconnects and rethrows when initialization fails', async () => {
  const { database } = setup();
  mocks.initialize.mockRejectedValue(new Error('init failed'));
  await expect(start()).rejects.toThrow('init failed');
  expect(database.$disconnect).toHaveBeenCalledOnce();
  expect(mocks.createApp).not.toHaveBeenCalled();
});

it('disconnects and rethrows when the server emits a listen error', async () => {
  const { database, app, server } = setup();
  app.listen.mockImplementation(() => { queueMicrotask(() => server.emit('error', new Error('EADDRINUSE'))); return server; });
  await expect(start()).rejects.toThrow('EADDRINUSE');
  expect(database.$disconnect).toHaveBeenCalledOnce();
});
